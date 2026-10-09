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

- the catalogue (categories, collections, models), and the lookbook of the models: their place in it, their sheets and the galleries of their photographs;
- the releases of the models in a limited number of pieces (drops), the entries of ORBES accounts in their draws (and the places PLATINE and PALLADIUM owners reserve directly during an early access), and the seed of each draw; since migration `0038` (plan NEXT LOT §3.6.F), a draw's sizes with their pieces and the size each entry chose;
- the LIVE RELEASES (migration `0021`), releases lived live and without a draw: their sizes and stock, the entries of ORBES accounts through the room, the line, their turn, the piece held and its reservation, the add-ons, the interest (I'LL BE THERE), the host's lines, and the per-tier windows;
- the orders of every sales channel (migration `0022`, LIVE RELEASE+): the stock of each model and size by location and its ledger, the orders step by step with their history, the atelier's pieces to make with their reserved ORBES identities, the carriers, the returns, the invoices and credit notes, and the journal of every change that future connections will read;
- the releases' and collectors' settings (migration `0023`, LIVE RELEASE+): a LIVE RELEASE's after-room and its guests, its surprise, its access by participation and by segment, its question after and the answers, the segments of collectors, and the sign-ins and scans counted per hour without any account;
- the owners' circle: the posts ORBES publishes for the owners of a piece by tier (notes, invitations, polls), their photographs, the answers to its invitations, the votes in its polls, and its visits counted per day without any account;
- the words of the benefits of the club's tiers, as the console changed them;
- THE PRIVATE SALON: the price and the lowest tier of the lookbook's reserved models, and the requests owners make for them, until ORBES Client Services closes them;
- the models an ADMIN discontinued, and when;
- the variants of a model (migration `0024`, plan NOCTURNE): MONOLITHE in steel, in gold, in blue, each a model of its own linked to its main model, with its label and the colour of its dot; and a draw's price;
- the test entrants (migration `0024_z`, 2026-10-07): the pool of test accounts the console sends into a release, their tier and seniority, each test of a release with its settings, its report and its peaks, and what each of its test entrants was drawn to do;
- the messages between a collector and ORBES Client Services (migration `0025`, plan NEXT-NINE, CS-01): one conversation per collector, its status on the console's Messages board, and its messages, the collector's with what each concerns (a piece, an order, a release, a scan, a model) and the answers; no file, nothing emailed;
- the new claim codes made by Client Services for a piece not registered yet (migration `0034`, plan NEXT LOT §3.4): who made each one, why, for whom (staff, or the buyer of the piece's open order), and where it stands; a buyer's code waits sealed until its one reading, never in clear;
- the supply chain's orders (migration `0036`, plan NEXT LOT §3.5): the supplier orders and their lines, the receptions the agent counts and ORBES confirms, the cards of the pieces they issue (each claim code sealed until the card is attached), the rejected pieces sent back to their supplier, and the counts the agent proposes;
- fulfilment (migration `0037`, plan NEXT LOT §3.5): orders waiting for supplier stock and served the oldest first, the order a size exchange creates, the parcels the agent packs and ships (their checklist and their packing photo, internal, erased 14 days after delivery) and the order cases (returns, size exchanges and parcel problems);
- the collector's delivery address and engraving (migration `0039`, plan NEXT LOT §3.6.B and §3.6.C): the addresses a collector saves (YOUR ADDRESSES, at most 5, one of them the default), each order's delivery country and phone with who entered its address and when it was replaced, the engraving's price per currency and each engraving's price and author, and the supplementary invoices and the credit notes for single lines of an engraving added or removed after payment;
- the supply chain's access and suppliers (migration `0035`, plan NEXT LOT §3.5): the LOGISTICS role of the people at the logistics agent and the locations each of their logins works at, a location's postal address, and the suppliers that make ORBES's pieces, with the supplier of each model and, where it differs, of each size;
- every issued product, its genome and every code ever signed for it, together with the public half of every signing key;
- customer accounts, staff (admin) users and their login sessions, and the one-time codes with which ORBES Client Services lets a customer recover a forgotten password;
- ownership, ownership transfers, warranties and service records;
- every verification request (scan) and its authentication decision;
- customers' reports on scans that were not authentic (where they saw or bought the piece), and the cases staff follow up;
- the scans of every complete day counted by country, result and event type, an anonymous record that outlives the scan history;
- anomaly findings and revocations;
- an append-only, hash-chained audit log of every mutation.

It never holds private signing keys, raw IP addresses, raw device identifiers, plaintext passwords, claim codes, transfer codes, recovery codes, registration tokens or session tokens. A buyer's new claim code (§5.76) is held only sealed (AES-256-GCM under a key that never reaches the database), only while it waits for its one reading.

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

- **Identifiers:** `uuid` primary keys generated by `gen_random_uuid()`, except `categories.id` (the 5-bit category index), `cryptographic_keys.key_id` (the 1-byte key id), `sessions.id_hash` and `scan_tokens.id_hash` (SHA-256 of a secret token), `audit_logs.id` (`bigserial`), `scan_daily_stats` (its four keys, §5.24), `media_objects.sha256` (the hex SHA-256 of the image's bytes, §5.26), `model_images` and `circle_post_images` (the model or the post, and the photograph, §5.28, §5.32), `circle_rsvps` and `circle_poll_votes` (the post and the account, §5.33, §5.34), `live_access_models` (the release and the model, §5.40), `live_entry_addons` (the entry and the add-on, §5.42), `live_interest` (the release and the account, §5.43), `live_tier_windows` (the release and the tier, §5.45), `circle_daily_visits` (its day, §5.35) and `club_tiers` (its tier's name, §5.36); `shop_requests` has a uuid (§5.37); `stock_movements`, `order_events` and `event_journal` a `bigint` identity (§5.48, §5.52, §5.56), `sku_thresholds` its SKU and location (§5.49), `order_alert_settings` the one id 1 (§5.57), `after_room_guests` its after-room and entry (§5.59), `release_answers` its release and account (§5.60), `activity_hourly` its hour, country and tier (§5.61), and `guarantee_settings` the one id 1 (§5.70).
- **Time:** every timestamp is `timestamptz`. Calendar dates (`production_date`, warranty dates) are `date` and evaluated in UTC by the services.
- **Enumerations:** `text` columns with `CHECK (… IN (…))`, which are simpler to migrate than PostgreSQL enums. Each list is mirrored in `db/schema.ts` (`test/db/schema.test.ts` holds the migration's literal list to it) and, where the console reads it, in `web/admin/types.ts`: among the latest, `LOOKBOOK_STATES`, `DROP_ENTRY_STATUSES`, `CIRCLE_POST_KINDS` and `CIRCLE_RSVP_ANSWERS` (§5.31, §5.33) `CLUB_TIER_NAMES` (§5.36) and `SHOP_REQUEST_STATUSES` (§5.37); with LIVE RELEASE+, `ORDER_CHANNELS`, `ORDER_STATUSES`, `ORDER_RESERVATIONS`, `STOCK_MOVEMENT_REASONS`, `BENCH_ITEM_STATUSES`, `RETURN_OUTCOMES`, `INVOICE_KINDS`, `SHOP_REQUEST_OUTCOMES` and `ACCESS_COMBINES` (§5.46 to §5.61); with the house's guarantee, `GUARANTEE_SCOPES` and `GUARANTEE_STATUSES` (§5.69), and `GUARANTEE_CLOSED_REASONS` in `db/schema.ts`.
- **Foreign keys:** every foreign key is `ON DELETE RESTRICT` and every foreign-key column is the leading column of an index (checked by `test/db/migrations.test.ts`).
- **Integrity guards** (defence in depth against application bugs and ad-hoc SQL), all raising SQLSTATE `OR001`:
  - `audit_logs` and `product_status_history` are append-only: `UPDATE`, `DELETE` and `TRUNCATE` are rejected;
  - `categories.id` and `categories.code` are immutable and categories are never deleted;
  - the cryptographic identity columns of `products`, `codes` and `cryptographic_keys` are immutable, as are a model's category and SKU prefix, a gallery row's model, photograph and author, a release's sealed seed and its commitment (§5.29), an entry's id, release, account and creation time (§5.30), a circle post's id, kind, author and creation (§5.31), a circle photograph's post, image and author (§5.32), an answer's post, account and creation (§5.33), a tier's name (§5.36), and a request's id, account, model, creation and note (§5.37), an order's id, channel, source, release, account, model and reservation time (§5.51), a piece to make's id, order, SKU, release and identity (§5.53), a SKU's model and size (§5.47), a house's guarantee's id, account, target and grant (§5.69), and every column of the event journal but `consumed_by` (§5.56); a vote in a poll cannot be updated at all (§5.34); `genomes` and `media_objects` rows cannot be updated at all; the stock ledger and an order's history are append-only, and a return, an invoice and an after-room's guest are never changed nor deleted (§5.48, §5.52, §5.54, §5.55, §5.59);
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
  MODELS |o--o{ MODELS : "variant_of (a variant and its main model)"
  MEDIA_OBJECTS |o--o{ MODELS : "image_sha256 (reference photograph)"
  MEDIA_OBJECTS |o--o{ PRODUCTS : "photo_sha256 (photograph of the piece)"
  ADMIN_USERS |o--o{ MEDIA_OBJECTS : "created_by"
  MODELS ||--o{ MODEL_IMAGES : "model_id (lookbook gallery)"
  MEDIA_OBJECTS ||--o{ MODEL_IMAGES : "sha256"
  ADMIN_USERS |o--o{ MODEL_IMAGES : "created_by"
  MODELS ||--o{ DROPS : "model_id (release)"
  ADMIN_USERS |o--o{ DROPS : "created_by"
  DROPS ||--o{ DROP_ENTRIES : "drop_id"
  ACCOUNTS ||--o{ DROP_ENTRIES : "account_id (one per drop)"
  ADMIN_USERS |o--o{ DROP_ENTRIES : "handled_by"
  ADMIN_USERS |o--o{ CIRCLE_POSTS : "created_by"
  DROPS |o--o{ CIRCLE_POSTS : "drop_id (link)"
  MODELS |o--o{ CIRCLE_POSTS : "model_id (link)"
  CIRCLE_POSTS ||--o{ CIRCLE_POST_IMAGES : "post_id"
  MEDIA_OBJECTS |o--o{ DROPS : "silhouette_sha256 (LIVE)"
  COLLECTIONS |o--o{ DROPS : "access_collection_id (LIVE)"
  DROPS ||--o{ DROP_SIZES : "drop_id (LIVE)"
  DROPS ||--o{ LIVE_ENTRIES : "drop_id"
  DROP_SIZES ||--o{ LIVE_ENTRIES : "(drop_id, size_id)"
  ACCOUNTS ||--o{ LIVE_ENTRIES : "account_id (one per drop)"
  ADMIN_USERS |o--o{ LIVE_ENTRIES : "let_in_by, removed_by, handled_by"
  DROPS ||--o{ LIVE_ACCESS_MODELS : "drop_id"
  MODELS ||--o{ LIVE_ACCESS_MODELS : "model_id"
  DROPS ||--o{ LIVE_ADDONS : "drop_id"
  LIVE_ENTRIES ||--o{ LIVE_ENTRY_ADDONS : "entry_id"
  LIVE_ADDONS ||--o{ LIVE_ENTRY_ADDONS : "addon_id"
  DROPS ||--o{ LIVE_INTEREST : "drop_id"
  ACCOUNTS ||--o{ LIVE_INTEREST : "account_id (one per drop)"
  DROP_SIZES ||--o{ LIVE_INTEREST : "(drop_id, size_id)"
  DROPS ||--o{ LIVE_MESSAGES : "drop_id"
  ADMIN_USERS |o--o{ LIVE_MESSAGES : "created_by"
  DROPS ||--o{ LIVE_TIER_WINDOWS : "drop_id"
  MEDIA_OBJECTS ||--o{ CIRCLE_POST_IMAGES : "sha256"
  ADMIN_USERS |o--o{ CIRCLE_POST_IMAGES : "created_by"
  CIRCLE_POSTS ||--o{ CIRCLE_RSVPS : "post_id"
  ACCOUNTS ||--o{ CIRCLE_RSVPS : "account_id (one per post)"
  CIRCLE_POSTS ||--o{ CIRCLE_POLL_VOTES : "post_id"
  ACCOUNTS ||--o{ CIRCLE_POLL_VOTES : "account_id (one per poll)"
  ADMIN_USERS |o--o{ CLUB_TIERS : "updated_by"
  ADMIN_USERS |o--o{ MODELS : "discontinued_by"
  ACCOUNTS ||--o{ SHOP_REQUESTS : "account_id (one OPEN per model)"
  MODELS ||--o{ SHOP_REQUESTS : "model_id (private salon)"
  ADMIN_USERS |o--o{ SHOP_REQUESTS : "handled_by"
  MODELS ||--o{ SKUS : "model_id (one per size)"
  SKUS |o--o{ PRODUCTS : "(model_id, sku_id)"
  SKUS |o--o{ DROP_SIZES : "sku_id"
  STOCK_LOCATIONS |o--o{ DROPS : "stock_location_id"
  SKUS ||--o{ STOCK_MOVEMENTS : "sku_id (the ledger)"
  STOCK_LOCATIONS ||--o{ STOCK_MOVEMENTS : "location_id"
  SKUS ||--o{ SKU_THRESHOLDS : "sku_id"
  STOCK_LOCATIONS ||--o{ SKU_THRESHOLDS : "location_id"
  LIVE_ENTRIES |o--o{ ORDERS : "live_entry_id (one per piece)"
  DROP_ENTRIES |o--o| ORDERS : "drop_entry_id"
  SHOP_REQUESTS |o--o| ORDERS : "shop_request_id (ACCEPTED)"
  ACCOUNTS ||--o{ ORDERS : "account_id"
  SKUS |o--o{ ORDERS : "(model_id, sku_id)"
  STOCK_LOCATIONS ||--o{ ORDERS : "location_id"
  CARRIERS |o--o{ ORDERS : "carrier_id"
  PRODUCTS |o--o{ ORDERS : "product_id (one open order)"
  PRODUCTS ||--o{ CLAIM_CODE_RENEWALS : "product_id (one WAITING at most)"
  ORDERS |o--o{ CLAIM_CODE_RENEWALS : "order_id (BUYER, UNSHOWN)"
  ACCOUNTS |o--o{ CLAIM_CODE_RENEWALS : "account_id (BUYER)"
  ADMIN_USERS |o--o{ CLAIM_CODE_RENEWALS : "created_by"
  ORDERS ||--o{ ORDER_EVENTS : "order_id"
  ORDERS |o--o{ BENCH_ITEMS : "order_id (NULL: for the stock)"
  PRODUCTS ||--o| BENCH_ITEMS : "product_id (reserved identity)"
  ORDERS ||--o| RETURNS : "order_id"
  OWNERSHIP |o--o| RETURNS : "ownership_id (taken back)"
  ORDERS ||--o{ INVOICES : "order_id (one main invoice)"
  INVOICES |o--o{ INVOICES : "credits_invoice_id (single lines, then one in full)"
  INVOICES |o--o{ INVOICES : "supplements_invoice_id (an engraving after PAID)"
  ACCOUNTS ||--o{ ACCOUNT_ADDRESSES : "account_id (YOUR ADDRESSES, one default)"
  ORDERS }o..o{ EVENT_JOURNAL : "entity_id (no FK)"
  ADMIN_USERS ||--o{ ADMIN_USER_LOCATIONS : "admin_user_id (LOGISTICS)"
  STOCK_LOCATIONS ||--o{ ADMIN_USER_LOCATIONS : "stock_location_id"
  SUPPLIERS |o--o{ MODELS : "supplier_id"
  SUPPLIERS |o--o{ SKUS : "supplier_id (the size's own)"
  SUPPLIERS ||--o{ SUPPLIER_ORDERS : "supplier_id (one DRAFT per location)"
  STOCK_LOCATIONS ||--o{ SUPPLIER_ORDERS : "location_id (deliver to)"
  SUPPLIER_ORDERS ||--o{ SUPPLIER_ORDER_LINES : "supplier_order_id"
  SKUS ||--o{ SUPPLIER_ORDER_LINES : "sku_id"
  SUPPLIER_ORDERS ||--o{ RECEPTIONS : "supplier_order_id (one open)"
  RECEPTIONS ||--o{ RECEPTION_LINES : "reception_id"
  SUPPLIER_ORDER_LINES |o--o{ RECEPTION_LINES : "supplier_order_line_id (NULL: not on the order)"
  RECEPTION_LINES |o--o{ PRODUCTS : "reception_line_id (issued by it)"
  RECEPTION_LINES |o--o{ STOCK_MOVEMENTS : "reception_line_id (RECEIVED)"
  PRODUCTS ||--o| CARD_PRINTS : "product_id (sealed until attached)"
  RECEPTIONS ||--o{ SUPPLIER_RETURNS : "reception_id"
  SKUS ||--o{ STOCK_CORRECTIONS : "sku_id"
  ORDERS ||--o{ SHIPMENTS : "order_id (the parcel's first; one open)"
  SHIPMENTS ||--o{ SHIPMENT_ITEMS : "shipment_id"
  ORDERS ||--o{ SHIPMENT_ITEMS : "order_id"
  ORDERS ||--o{ ORDER_CASES : "order_id (one not ended)"
  SHIPMENTS |o--o{ ORDER_CASES : "shipment_id (parcel problems)"
  ORDERS |o--o| ORDERS : "exchange_of_order_id (EXCHANGE)"
  DROPS |o--o| DROPS : "parent_drop_id (after-room)"
  SEGMENTS |o--o{ DROPS : "access_segment_id"
  SEGMENTS |o--o{ CIRCLE_POSTS : "segment_id"
  DROPS ||--o{ AFTER_ROOM_GUESTS : "drop_id (the after-room)"
  LIVE_ENTRIES ||--o| AFTER_ROOM_GUESTS : "entry_id"
  DROPS ||--o{ RELEASE_ANSWERS : "drop_id"
  ACCOUNTS ||--o{ RELEASE_ANSWERS : "account_id"
  ADMIN_USERS |o--o{ SEGMENTS : "created_by"
  SCAN_EVENTS }o..o{ ACTIVITY_HOURLY : "counted by hour (no FK)"
  ACCOUNTS ||--o| CLIENT_CONVERSATIONS : "account_id (one per collector)"
  ADMIN_USERS |o--o{ CLIENT_CONVERSATIONS : "answered_by, closed_by"
  CLIENT_CONVERSATIONS ||--o{ CLIENT_MESSAGES : "conversation_id"
  ADMIN_USERS |o--o{ CLIENT_MESSAGES : "admin_id (an answer)"
  PRODUCTS |o--o{ CLIENT_MESSAGES : "product_id (PIECE, SCAN)"
  ORDERS |o--o{ CLIENT_MESSAGES : "order_id (ORDER)"
  DROPS |o--o{ CLIENT_MESSAGES : "drop_id (RELEASE)"
  MODELS |o--o{ CLUB_PROGRAM_SETTINGS : "gift_platine_model_id, gift_palladium_model_id"
  ADMIN_USERS |o--o{ CLUB_PROGRAM_SETTINGS : "updated_by"
  ADMIN_USERS |o--o{ SHIPPING_RATES : "updated_by"
  ADMIN_USERS |o--o{ ENGRAVING_PRICES : "updated_by"
  ACCOUNTS ||--o{ TIER_GRANTS : "account_id (once per tier and kind)"
  MODELS |o--o{ TIER_GRANTS : "model_id (a gift as given)"
  TIER_GRANTS ||--o{ CREDIT_USES : "grant_id"
  ORDERS ||--o{ CREDIT_USES : "order_id"
  TIER_GRANTS |o--o{ ORDERS : "gift_grant_id (a GIFT order)"
  ORDERS |o--o{ ORDERS : "with_order_id (travels with)"
  ACCOUNTS ||--o{ HOUSE_GUARANTEES : "account_id (the house's guarantee)"
  DROPS |o--o{ HOUSE_GUARANTEES : "drop_id (RELEASE), covered_drop_id (set aside), used_drop_id"
  MODELS |o--o{ HOUSE_GUARANTEES : "model_id (MODEL)"
  COLLECTIONS |o--o{ HOUSE_GUARANTEES : "collection_id (COLLECTION)"
  ADMIN_USERS |o--o{ HOUSE_GUARANTEES : "granted_by, updated_by, revoked_by"
  HOUSE_GUARANTEES |o--o| DROP_ENTRIES : "guarantee_id (used once)"
  HOUSE_GUARANTEES |o--o| LIVE_ENTRIES : "guarantee_id (used once)"
  ADMIN_USERS |o--o{ GUARANTEE_SETTINGS : "updated_by"
  ACCOUNTS ||--o{ CARE_REQUESTS : "account_id (yearly care)"
  PRODUCTS ||--o{ CARE_REQUESTS : "product_id (once a year unless cancelled)"
  SERVICE_RECORDS |o--o| CARE_REQUESTS : "service_record_id (YEARLY_CARE)"
  CARRIERS |o--o{ CARE_REQUESTS : "label_carrier_id, return_carrier_id"
  ADMIN_USERS |o--o{ CARE_REQUESTS : "handled_by"
  MODELS |o--o{ CLIENT_MESSAGES : "model_id (MODEL)"
  SHOP_REQUESTS |o--o{ CLIENT_MESSAGES : "shop_request_id (MODEL)"
  SCAN_EVENTS }o..o{ CLIENT_MESSAGES : "scan_event_id (no FK, cleared with the scan)"

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
  PRODUCTS ||--o{ OWNERSHIP_CERTIFICATES : "product_id"
  OWNERSHIP ||--o{ OWNERSHIP_CERTIFICATES : "ownership_id"
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
    text photo_sha256 FK "nullable"
  }
  MEDIA_OBJECTS {
    text sha256 PK "hex SHA-256 of bytes"
    text mime "image/jpeg | image/webp"
    bytea bytes "at most 1 MiB, metadata stripped"
    int width "1..4096"
    int height "1..4096"
  }
  MODEL_IMAGES {
    uuid model_id PK "FK"
    text sha256 PK "FK"
    smallint position "1..8, unique per model"
    text alt "nullable"
  }
  DROPS {
    uuid id PK
    uuid model_id FK
    int quantity ">= 1"
    timestamptz opens_at
    timestamptz closes_at "after opens_at"
    text seed_enc "sealed seed, immutable"
    bytea seed_hash "SHA-256 of the seed, immutable"
    bytea seed "revealed by the draw"
    timestamptz drawn_at "nullable"
  }
  DROP_ENTRIES {
    uuid id PK "published by the draw"
    uuid drop_id FK
    uuid account_id FK "unique per drop"
    text status "ENTERED | SELECTED | WAITLISTED | CONFIRMED | LAPSED | WITHDRAWN"
    smallint tier "0..3, at the draw"
    smallint seniority "full years, at the draw (or at a direct reservation)"
    int rank "nullable"
  }
  CIRCLE_POSTS {
    uuid id PK
    text kind "NOTE | INVITATION | POLL, immutable"
    smallint min_tier "1..3"
    timestamptz event_at "invitation only"
    int capacity "invitation only, nullable"
    text_array poll_options "poll only, 2..6"
    timestamptz published_at "nullable"
  }
  CIRCLE_POST_IMAGES {
    uuid post_id PK "FK"
    text sha256 PK "FK"
    smallint position "1..4, unique per post"
  }
  CIRCLE_RSVPS {
    uuid post_id PK "FK"
    uuid account_id PK "FK"
    text answer "YES | NO"
  }
  CIRCLE_POLL_VOTES {
    uuid post_id PK "FK"
    uuid account_id PK "FK"
    smallint option_index "0..5, final"
  }
  CIRCLE_DAILY_VISITS {
    date day PK
    int visits "no account"
  }
  CLUB_TIERS {
    text tier PK "TITANE | PLATINE | PALLADIUM"
    text benefits "1..600"
    uuid updated_by FK "nullable"
  }
  CLUB_PROGRAM_SETTINGS {
    smallint id PK "1"
    smallint early_access_palladium_hours "4"
    smallint early_access_platine_hours "2, at most PALLADIUM's"
    uuid gift_platine_model_id FK "nullable"
    uuid gift_palladium_model_id FK "nullable"
    integer credit_platine_minor "5000"
    integer credit_palladium_minor "10000"
  }
  SHIPPING_RATES {
    text currency PK "EUR | GBP | USD | CHF"
    text service PK "STANDARD | EXPRESS"
    integer fee_minor "0..100000000"
  }
  ORDERS {
    uuid id PK "reference OR-…"
    text channel "LIVE | DRAW | SALON | GIFT | EXCHANGE"
    uuid account_id FK
    text status "RESERVED | PAID | SHIPPED | DELIVERED | CANCELLED | RETURNED"
    text reservation "STOCK | AWAITING, nullable"
    text buyer_name "personal, never audited"
  }
  STOCK_MOVEMENTS {
    bigint id PK
    uuid sku_id FK
    uuid location_id FK
    int delta "never 0, append-only"
    text reason
  }
  INVOICES {
    uuid id PK
    text kind "INVOICE | CREDIT_NOTE"
    int sequence "per kind and year"
    int vat_minor "NULL: no VAT"
  }
  SHOP_REQUESTS {
    uuid id PK
    uuid account_id FK
    uuid model_id FK
    text note "nullable, 1..500"
    text status "OPEN | CLOSED"
    uuid handled_by FK "nullable"
    text resolution_note "nullable, 1..2000"
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
| `image_sha256` | `text` | NULL | — | Migration `0012_media` (F-04). FK → `media_objects.sha256`: the model's reference photograph, shown on the authentic results of its pieces (`product.imageUrl`, [API §9.2](API.md#92-response)), and the cover of its lookbook sheet. Set and cleared by `MediaService` (below); not part of the identity guard. |
| `slug` | `text` | NULL | — | Migration `0014_model_lookbook` (P-R02). The address of its lookbook sheet, `/verify/lookbook/<slug>`. `models_slug_format`: `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80)`; unique (`models_slug_key`; a duplicate is `409 SLUG_TAKEN`). Fixed once `published_at` is set (a service rule, `409 SLUG_LOCKED`), and present then (`models_published_slug`: `CHECK (published_at IS NULL OR slug IS NOT NULL)`). |
| `lookbook` | `text` | NOT NULL | `'HIDDEN'` | Migration `0014_model_lookbook`. `CHECK (lookbook IN ('HIDDEN','PUBLIC','RESERVED'))` (`LOOKBOOK_STATES`): nowhere, listed for everyone, or listed for the owners of a piece only (unlisted, not confidential). `models_lookbook_slug`: `CHECK (lookbook = 'HIDDEN' OR slug IS NOT NULL)`. Every model that existed before the migration stays HIDDEN, without an address. |
| `story` | `text` | NULL | — | Migration `0014_model_lookbook`. Plain paragraphs (a blank line between two), no Markdown; `CHECK (length(btrim(story)) BETWEEN 1 AND 4000)`. |
| `specs` | `text` | NULL | — | Migration `0014_model_lookbook`. One `Label: value` line per specification, no figure in a label (the service's rule, `normalizeSpecs`); `CHECK (length(btrim(specs)) BETWEEN 1 AND 1000)`. |
| `published_at` | `timestamptz` | NULL | — | Migration `0014_model_lookbook`. When the model first left HIDDEN (the service's clock); never cleared. |
| `discontinued_at` | `timestamptz` | NULL | — | Migration `0019_model_discontinued` (P-R06). When an ADMIN discontinued the model; NULL while it is not, cleared when it is reinstated. Its UTC year is said *DISCONTINUED · <year>* on the authentic results of its pieces (`product.discontinuedYear`), its lookbook sheet and the ownership certificates of its pieces (page and PDF), read live. `models_discontinued_inactive`: `CHECK (discontinued_at IS NULL OR NOT active)`, a discontinued model is never active. |
| `discontinued_by` | `uuid` | NULL | — | Migration `0019_model_discontinued`. FK → `admin_users.id` (ON DELETE RESTRICT): the ADMIN who discontinued it; NULL for a script, and cleared with `discontinued_at`. `models_discontinued_by_when`: `CHECK (discontinued_by IS NULL OR discontinued_at IS NOT NULL)`. A staff id, nothing personal of a customer. |
| `price_label` | `text` | NULL | — | Migration `0020_private_salon` (P-X08). The price THE PRIVATE SALON shows for the model while it is RESERVED (« € 4 800 », « Price on request »); NULL: none. `models_price_label_check`: `CHECK (length(btrim(price_label)) BETWEEN 1 AND 60)`; the service trims it and collapses its spaces. |
| `private_min_tier` | `smallint` | NOT NULL | `1` | Migration `0020_private_salon`. The lowest tier of the club a RESERVED model is shown to: 1 TITANE (every owner), 2 PLATINE, 3 PALLADIUM. `models_private_min_tier_check`: `CHECK (private_min_tier BETWEEN 1 AND 3)`. Below it, its sheet answers 404 like a model not in the collection. |
| `base_price_minor`, `base_currency` | `int`, `text` | NULL | — | Migration `0022_orders_stock` (N2). The model's base price for the Shopify product export (releases keep their own): 0 to 100 000 000, `^[A-Z]{3}$`; `models_base_price`: both or neither. |
| `care_guide` | `text` | NULL | — | Migration `0022_orders_stock` (M6). `CHECK (length(btrim(care_guide)) BETWEEN 1 AND 8000)`: the care guide MY PIECES shows with each order of the model (its care instructions, then the house's text, stand in without it). |
| `variant_of` | `uuid` | NULL | — | Migration `0024_model_variants` (plan NOCTURNE, N1). FK → `models.id` (`models_variant_of_fkey`, ON DELETE RESTRICT): the **main model** of a variant, NULL for a main model or a model alone. A variant **is** a model: its pieces, SKUs, stock, releases and orders point at it as at any model. `models_variant_self`: `CHECK (variant_of <> id)`. Never chained: a variant's main model is never a variant, and a model with variants never becomes one (the trigger `models_variant_rules`, below). |
| `variant_label` | `text` | NULL | — | Migration `0024_model_variants`. Its name among its model's dots (« Steel »), 1 to 40 characters, trimmed (`models_variant_label_check`). Required on a variant (`models_variant_labelled`: `CHECK (variant_of IS NULL OR variant_label IS NOT NULL)`) and on a model that has variants (the trigger): the main model carries its own label, so it is one of the dots. Unique within a model and its variants whatever its case (`models_variant_label_key`, a unique index on `(coalesce(variant_of, id), lower(variant_label))`; `409 VARIANT_LABEL_TAKEN`). |
| `variant_swatch` | `text` | NULL | — | Migration `0024_model_variants`. The dot's colour, `#RRGGBB` in capitals (`models_variant_swatch_check`: `CHECK (variant_swatch ~ '^#[0-9A-F]{6}$')`); the verification app draws the dot from it with a soft highlight (BRAND-DESIGN-SYSTEM §3.11). A label and its colour go together (`models_variant_dot`: `CHECK ((variant_label IS NULL) = (variant_swatch IS NULL))`). |
| `size_kind` | `text` | NULL | — | Migration `0030_account_sizes` (plan NEXT-NINE, AC-01). `models_size_kind_check`: `CHECK (size_kind IN ('RING','BRACELET','WRIST','NECKLACE'))` (`SIZE_KINDS`, mirrored in `db/schema.ts` and `web/admin/types.ts`): which saved size of a collector (§5.71) preselects the model's size; NULL: none, or, on a variant, its main model's (`services/sizes.ts` `sizeKindOf`). Set from the console's Sizes section (`PUT /api/admin/models/:id/sizes`, OPERATOR, audited `model.sizes.update`). |
| `size_type` | `text` | NULL | — | Migration `0033_model_sizes` (plan NEXT LOT, §3.3). `models_size_type_check`: `CHECK (size_type IN ('RING','BRACELET','NECKLACE','WATCH','ONE_SIZE'))` (`SIZE_TYPES`, mirrored in `db/schema.ts` and `web/admin/types.ts`): the model's size type, what its sizes are ticked from in the Catalogue (`services/sizes.ts` `standardSizes`: French ring sizes 40 to 76, bracelets 14 to 24 cm by 0.5, necklaces 35 to 100 cm by 1; WATCH and ONE_SIZE a single SKU, its label NULL). NULL: 'To give', the model's sizes work as before 0033 (a size named anywhere is created, `ensureSku`) until staff give it its type; every model existing at 0033 starts so. `models_size_type_kind`: `CHECK (size_type IS NULL OR size_kind IS NOT DISTINCT FROM (CASE size_type WHEN 'RING' THEN 'RING' WHEN 'BRACELET' THEN 'BRACELET' WHEN 'NECKLACE' THEN 'NECKLACE' WHEN 'WATCH' THEN 'WRIST' ELSE NULL END))`: once a model has its type, `size_kind` is derived from it (a watch preselects with the wrist, a model of one size with none). Set by `SizeService.declare` (`PUT /api/admin/models/:id/sizes` with `sizeType`, OPERATOR, audited `model.sizes.declare`), at creation (`CatalogService.createModel`, `POST /api/admin/models` with `sizeType`), and copied by ADD A VARIANT. Once given, never cleared, only changed. |
| `supplier_id` | `uuid` | NULL | — | Migration `0035_logistics_access` (plan NEXT LOT §3.5: « each model (or each size) has its supplier »). FK → `suppliers.id` (§5.77, ON DELETE RESTRICT), led by `models_supplier_id_idx`. The supplier that makes the model's pieces; NULL: none, and on a variant its main model's. A size may name its own (`skus.supplier_id`, §5.47), which wins: `services/suppliers.ts` `supplierOf` reads the size's, else the model's, else the main model's. Set by `SupplierService.setModelSupplier` (`PUT /api/admin/models/:id/supplier`, OPERATOR, audited `model.supplier`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; unique `sku_prefix`; unique `slug` (`models_slug_key`, migration `0014_model_lookbook`); `models_collection_id_idx (collection_id)`; `models_category_id_idx (category_id)`; `models_image_sha256_idx (image_sha256)` (migration `0012_media`); `models_discontinued_by_idx (discontinued_by)` (migration `0019_model_discontinued`), which leads with the foreign key; `models_variant_of_idx (variant_of)`, which leads the variants' foreign key, and the unique `models_variant_label_key (coalesce(variant_of, id), lower(variant_label))` (migration `0024_model_variants`).
- **Triggers:** `models_immutable_identity` (BEFORE UPDATE, guards `id`, `category_id`, `sku_prefix`, `created_at`; migration `0010_models_active`), raising `OR001`: the category is in the identity of every piece issued with the model, the SKU prefix starts every SKU issued with it. `models_variant_rules` (migration `0024_model_variants`; BEFORE INSERT or UPDATE OF `variant_of`, `variant_label`, row level, function `orbes_models_variant_rules()`) reads the rows a CHECK cannot: the main model `FOR SHARE` (a change of it waits, then is read again) and whether the model has variants; it refuses a chain (a variant of a variant, or a model with variants made a variant) and a main model without its own label as a CHECK does, SQLSTATE `23514` with the constraint names `models_variant_no_chain` and `models_variant_main_labelled`.
- **Written by:** `CatalogService.createModel` (`POST /api/admin/models`, OPERATOR), insert plus audit `model.create` in one transaction. `CatalogService.updateModel` (`PATCH /api/admin/models/:id`, OPERATOR, A-10) changes `name`, `default_material`, `care_instructions`, `collection_id` and `active`, never the category nor the SKU prefix (400, and the trigger above), under a row lock (`FOR UPDATE`), with the audit entry `model.update` (the changed fields before and after, and `issuedPieces`: the products of the model) in the same transaction; a change that changes nothing writes nothing. The name, `type`, care instructions and collection are read live by every public result of the model's pieces ([API §9.2](API.md#92-response)). `MediaService.setModelImage` and `removeModelImage` (`POST` and `DELETE /api/admin/models/:id/image`, OPERATOR, F-04) set and clear `image_sha256` under a row lock, with the audit entry `model.image.set` or `model.image.remove` (the image's hash, type, size and dimensions, the one it replaced and `issuedPieces`) in the same transaction. The lookbook (P-R02, [API §13.4](API.md#134-models)): `CatalogService.updateModel` also changes `lookbook`, `slug`, `story` and `specs`, under the same row lock and audit entry (`model.update`, a story as its length and SHA-256, never its words), and sets `published_at` the first time the model leaves HIDDEN (audited as `publishedAt`). Read by the public lookbook (`LookbookService`: the PUBLIC models and their sheets) and THE PRIVATE SALON (`SalonService`, P-X08: the RESERVED ones, for an account that holds a piece, from the tier `private_min_tier` up, with `price_label`); `product.lookbook` of an AUTHENTIC result names the `slug` of a PUBLIC model. THE PRIVATE SALON (P-X08, [API §13.4](API.md#134-models)): `CatalogService.updateModel` also changes `price_label` and `private_min_tier`, under the same row lock and audit entry (`model.update`, before and after). DISCONTINUED (P-R06): `CatalogService.discontinueModel` (`POST /api/admin/models/:id/discontinue`, **ADMIN**) sets `discontinued_at`, `discontinued_by` and `active = false` in one transaction under the row lock, audited `model.discontinue` (`{ name, skuPrefix, discontinuedAt, wasActive, issuedPieces }`); `reinstateModel` (`…/reinstate`, ADMIN) clears both and sets `active = true`, audited `model.reinstate` (`{ name, skuPrefix, discontinuedAt, issuedPieces }`, the previous date). An edit that would make a discontinued model active is refused (`409 MODEL_DISCONTINUED`), and `models_discontinued_inactive` refuses it below the service. LIVE RELEASE+ (N2, M6): `CatalogService.updateModel` also changes `base_price_minor` with `base_currency` (sent together, or both cleared) and `care_guide`, under the same row lock and audit entry (`model.update`, the care guide as `{ length, sha256 }`, never its words); a model's Shopify ids live on its SKUs (§5.47). Plan NOCTURNE (N1, migration `0024_model_variants`): `CatalogService.createVariant` (`POST /api/admin/models/:id/variants`, OPERATOR, ADD A VARIANT) locks the main model (`FOR UPDATE`), refuses a main model that is itself a variant (`409 MODEL_IS_VARIANT`), gives the main model its own label and colour when it has none yet (its first variant; audited `model.update`, before and after), then inserts the variant, a copy of its category, collection, name, type, story, specifications, care instructions and care guide with its own label, colour and SKU prefix, HIDDEN from the lookbook, active, without a material, prices or photographs yet, audited `model.variant.create` (`{ mainId, name, type, skuPrefix, category, collectionId, label, swatch, copied, sizeType?, sizes }`), in one transaction; since plan NEXT LOT §3.3 the variant also copies its main model's `size_type` and `size_kind` (or takes the `sizeType` given for a main model with none yet) and, as SKUs of its own under its prefix (`ensureSku`) with their fits, its main model's offered sizes (a watch or a model of one size its ONE SIZE), never linked to them afterwards; `CatalogService.updateModel` changes `variant_label` with `variant_swatch` (sent together; cleared together on a model alone only, `409 VARIANT_LABEL_REQUIRED`), audited `model.update`. The lookbook reads a main model and its variants as one entry, its dots (`LookbookService`), and the Shopify product export as one product, option 1 Variant and option 2 Size (§5.47). No delete path exists.
- **Pairs (PAIRS WELL WITH):** the models a main model's sheet ends with are rows of `model_pairs` (§5.72, migration `0031_model_pairs`, plan NEXT-NINE BP-34), set by `CatalogService.setPairs`; a variant's sheet reads its main model's.

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
| `variant` | `text` | NULL | — | The piece's free text set at issuance: its **size** (plan NOCTURNE, N1: the console's field and the app's line are named Size, SIZE 17 on a result, MY PIECES and a piece's page; values written before, a colour or a finish, are shown as they are). Not the model's variant, which is a model of its own (§5.3 `variant_of`). |
| `material` | `text` | NOT NULL | — | |
| `production_batch` | `text` | NULL | — | |
| `production_date` | `date` | NULL | — | The service refuses dates after tomorrow (UTC). |
| `status` | `text` | NOT NULL | `'ISSUED'` | `CHECK` in the 13 product statuses (§7.1): the 12 of `0001`, and RESERVED (migration `0022_orders_stock`, L6), an identity reserved for a piece to make, never claimable (`products_reserved`: `CHECK (status <> 'RESERVED' OR claim_secret_hash IS NULL)`). |
| `ownership_state` | `text` | NOT NULL | `'UNREGISTERED'` | `CHECK (ownership_state IN ('UNREGISTERED','REGISTERED','OWNED','TRANSFER_PENDING'))` (§7.3). |
| `auth_policy` | `text` | NOT NULL | `'PRINTED_CODE'` | `CHECK (auth_policy ~ '^[A-Z][A-Z_]*(\+[A-Z][A-Z_]*)*$')`. The service accepts only combinations of `PRINTED_CODE`, `SECURE_NFC`, `SECURE_ELEMENT`, `TAMPER_EVIDENT` that include `PRINTED_CODE`. Hardware authenticators are not implemented. |
| `claim_secret_hash` | `text` | NULL | — | scrypt hash (`scrypt$15$8$1$<salt>$<hash>`) of the canonical 12-character claim code. NULL when the product was issued without a claim code. The code itself is shown once at issuance and never stored. |
| `photo_sha256` | `text` | NULL | — | Migration `0012_media` (F-04). FK → `media_objects.sha256`: the photograph of this piece, taken at issuance. Since plan NOCTURNE (decision 9: the model's photograph is the reference for a piece) the console's only: shown to ORBES staff on the product page, never in an answer a collector receives (no `photoUrl` on a result nor in MY PIECES). Not part of the identity guard. |
| `sku_id` | `uuid` | NULL | — | Migration `0022_orders_stock`. `products_sku_fkey`: FK `(model_id, sku_id)` → `skus (model_id, id)` (§5.47), a SKU of its own model; `products_sku_id_idx`. Set at issuance, at a reservation, and at boot for the pieces issued before (`linkSkus`). |
| `reception_line_id` | `uuid` | NULL | — | Migration `0036_supplier_orders` (plan NEXT LOT §3.5). FK → `reception_lines.id` (§5.81), led by `products_reception_line_idx`: the reception that issued the piece; NULL for any other. |
| `stock_entered_at` | `timestamptz` | NULL | — | Migration `0036_supplier_orders`. When the piece first entered the stock (its reception's issuing; never cleared). Backfilled with the time of the piece's earliest `PRODUCED` movement, where one exists: a count made by hand (`ADJUSTED`) names no piece and a Generator piece has no `PRODUCED`, so neither gets one; the packing scan accepts only a piece with it, and a count no such piece backs is shown to ORBES as `NO PIECE` until it is counted in (plan §3.5.6.6). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Immutable. |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Maintained by trigger unless set explicitly. |

Table constraints:

- `UNIQUE (year, category_id, serial)`.
- `products_packed_identity_consistent`: `packed_identity = ((year − 2000) << 25) | (category_id << 20) | serial`, the same packing as the core `packIdentity()` (7 + 5 + 20 bits).
- `products_product_id_consistent`: the two year digits of `product_id` equal `year − 2000` and its serial part equals `serial`. The category **letter** is not cross-checked against `category_id` by the database; the application derives it from the category registry.

- **Indexes:** primary key; unique `product_id`; unique `packed_identity`; unique `(year, category_id, serial)`; `products_category_id_idx`, `products_model_id_idx`, `products_collection_id_idx`, `products_status_idx`; `products_production_batch_idx` on `(production_batch)` (migration `0007_print_batch_indexes`), for the batch filters of the products and codes lists and a batch's print sheet ([API §14.1, §15.5, §15.9](API.md#155-get-apiadmincodes)); `products_photo_sha256_idx (photo_sha256)` (migration `0012_media`).
- **Triggers:** `products_touch_updated_at`; `products_immutable_identity` guarding `id`, `product_id`, `packed_identity`, `year`, `category_id`, `serial`, `created_at` (`OR001`).
- **Written by:**
  - `IssuanceService.issueProduct` inserts the row (status `ISSUED`, ownership `UNREGISTERED`). The serial is `max(serial) + 1` per `(year, category)` under the `SERIAL_ALLOCATION` advisory lock, or an explicit serial.
  - `LifecycleService` updates `status` (and, for transitions made on behalf of other services, `ownership_state`) and `updated_at`.
  - `OwnershipService` updates `ownership_state` and `updated_at` directly when a transfer is initiated, cancelled or expires, and when ownership is confirmed.
  - `MediaService.setProductPhoto` and `removeProductPhoto` (`POST` and `DELETE /api/admin/products/:productId/photo`, OPERATOR, F-04) set and clear `photo_sha256` and `updated_at` under a row lock, audited `product.photo.set` / `product.photo.remove` in the same transaction.
  - LIVE RELEASE+ (L6, `services/issuance.ts`, until plan NEXT LOT step 5.13): `reserveIdentity` inserted a RESERVED row for a piece to make (the next serial under `SERIAL_ALLOCATION`, its genome and its warranty, no claim code, nothing in `product_status_history`), journaled `product.reserve`; `confirmReservedIdentity` issued it when the atelier finished the piece; `retireReservedIdentity` retired one whose piece would not be made. All three are removed with the atelier: no identity is reserved any more, and those reserved before stay as they are, reserved and unused (§3.5.8 of the plan). A reception issues its pieces with `issueStockIdentity` (§5.80). A return (`OrderService.returnOrder`, §5.54) sets `ownership_state` back to UNREGISTERED when ORBES takes the ownership back, and a new `claim_secret_hash` when the piece goes back to stock.
  - No other code path updates the descriptive columns (`sku`, `model_id`, `collection_id`, `variant`, `material`, `production_batch`, `production_date`, `auth_policy`, `claim_secret_hash`) after issuance, although the database would allow it.
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
| `display_name` | `text` | NULL | — | ≤ 80 characters, no control characters or `<` `>`. Since migration `0040_account_profiles` (plan CUSTOMER INTELLIGENCE §3.1), written « First Last » from the first and last name a sign-up gives, and kept so by `ProfileService` when YOUR PROFILE or Client Services changes them (§5.92); the accounts made before keep theirs until a name is saved. |
| `country` | `char(2)` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. The `country` of the registration body (ISO 3166-1 alpha-2, stored upper case): required by `POST /api/v1/account/register` since plan CUSTOMER INTELLIGENCE §3.1 (one of `src/shared/countries.ts`), optional for internal callers. Changed by YOUR PROFILE's COUNTRY (`ProfileService`, never cleared once given): the profile's country lives here, not in `account_profiles` (§5.92). |
| `status` | `text` | NOT NULL | `'ACTIVE'` | `CHECK (status IN ('ACTIVE','LOCKED','DELETED'))`. Only ACTIVE accounts can log in or use a session. LOCKED is set and cleared by ORBES Client Services (A-06, `POST /api/admin/owners/:id/lock` and `/unlock`); no code path sets DELETED in this version. |
| `failed_logins` | `int` | NOT NULL | `0` | `CHECK (failed_logins >= 0)`. Wrong passwords in the current throttle window (migration `0002_platform_guards`). From 10 within 15 minutes, logins to the account are refused with the generic `INVALID_CREDENTIALS` until the window ends; reset to 0 by a successful login. |
| `failed_logins_since` | `timestamptz` | NULL | — | Start of the throttle window (the first failure); NULL when there is none. A failure after the window has ended starts a new one. |
| `shopify_customer_id` | `text` | NULL | — | Migration `0022_orders_stock` (N3). A positive decimal, unique (`accounts_shopify_customer_key`): the Shopify customer the account will be, matched by email once the store exists. No code writes it in this lot. |
| `transfers_frozen_until` | `timestamptz` | NULL | — | Migration `0005_account_recovery`. Set to now + 72 hours by an assisted recovery of the password (§5.23): until then `OwnershipService.initiateTransfer` refuses new transfers out of the account (`409 TRANSFERS_PAUSED`). NULL when no recovery happened; a past value has no effect. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Trigger-maintained. |

- **Indexes:** primary key; unique `email_normalized`; `accounts_created_at_idx (created_at)` (migration `0032_growth_indexes`, plan NEXT-NINE BP-29): GROWTH's accounts created in each month of its window ([API §16.31](API.md#1631-growth-extension-of-the-contract)).
- **Triggers:** `accounts_touch_updated_at`.
- **Written by:** `AuthService.registerAccount` (audit `account.register`), `AuthService.login` (password re-hash; throttle counter, audit `account.login_failed` with `failedLogins`, `account.login_throttled`), `AuthService.changePassword` (`POST /api/v1/account/password`; a wrong current password counts in the throttle, `account.login_failed` with `via: "password_change"`; audit `account.password_change`), `AuthService.confirmAccountPassword` (PIECE FOUND, `POST /api/v1/ownership/incidents/resolve`, F-01: the account's password typed again; a wrong one counts in the throttle, `account.login_failed` with `via: "incident_resolve"`; nothing written when it is right), `AccountRecoveryService.recover` (`POST /api/v1/account/recover`: the new password, the throttle cleared and `transfers_frozen_until`, in the transaction that uses the recovery code; audit `account.recover`), `OwnerService.lock` and `unlock` (`services/owners.ts`, A-06: `status` LOCKED, in one transaction with every session of the account deleted, its pending transfers cancelled, §5.13, its open links to ownership certificates withdrawn, §5.27, its open entries in releases withdrawn, §5.30, its open requests of the private salon closed, §5.37, and its open recovery code revoked, §5.23; audit `account.lock` with `{ sessionsRevoked, transfersCancelled, recoveryCodesRevoked, certificatesRevoked, dropEntriesWithdrawn }`; back to ACTIVE, audit `account.unlock`). `AuthService.login` reads the account's status and password hash again `FOR NO KEY UPDATE` in the transaction that opens the session, so a sign-in whose password check was under way when a lock, a recovery or a password change committed is refused, and a re-hash is written only over the hash that was checked; `AuthService.changePassword` does the same before it writes the new hash (§8.2). A-06 needs no schema change: the LOCKED status exists since migration `0001_initial`, the owner's sheet reads `ownership` (index on `account_id`) and `scan_events` (index `scan_events_account_id_idx`), and a search by REF is a primary-key range scan of `scan_events.id`.
- **Privacy:** `email` and `display_name` are personal data. They are **never written to `audit_logs`**, whose entries name account ids only, so that an erasure request does not collide with the append-only log.

### 5.10 `admin_users`

Staff accounts for the admin console.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `email_normalized` | `text` | NOT NULL | — | UNIQUE |
| `email` | `text` | NOT NULL | — | |
| `password_hash` | `text` | NOT NULL | — | scrypt, as for accounts. |
| `role` | `text` | NOT NULL | — | `CHECK (role IN ('ADMIN','OPERATOR','AUDITOR','RETAIL','LOGISTICS'))`. RETAIL (migration `0008_retail_mode`, A-08): a seller, ranked under AUDITOR, who reaches the sale mode only (API §2.3). LOGISTICS (migration `0035_logistics_access`, plan NEXT LOT §3.5): one login per person at the logistics agent, ranked with RETAIL, who reaches the Logistics routes of its own locations only (§5.90, API §2.3). |
| `totp_secret_enc` | `text` | NULL | — | NULL until TOTP is enrolled. Sealed with AES-256-GCM (`v1.<iv>.<ciphertext‖tag>`, base64url) under a key derived by HKDF-SHA-256 from `KEY_ENCRYPTION_KEY` (or from `COOKIE_SECRET` when no key encryption key is configured), with the admin id as associated data. The plaintext holds the base32 secret and the last accepted time step (replay protection). |
| `failed_logins` | `int` | NOT NULL | `0` | `CHECK (failed_logins >= 0)`. Reset on a successful login. |
| `locked_until` | `timestamptz` | NULL | — | Set to now + 15 min when `failed_logins` reaches 10, and again on every further failure. |
| `disabled_at` | `timestamptz` | NULL | — | A disabled admin cannot log in and its sessions stop working. Set and cleared by `AuthService.setAdminDisabled` (the console's Team page, `scripts/admin.ts disable` / `enable`), which deletes the admin's sessions in the same transaction. |
| `password_change_required` | `boolean` | NOT NULL | `false` | Migration `0006_admin_password_change_required`. True for a staff account created from the console with a temporary password (`AuthService.createStaff`); the guard then refuses every admin route but logout, `me` and the password change (`403 PASSWORD_CHANGE_REQUIRED`, API §2.4). Cleared by `changePassword`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | Trigger-maintained. |

- **Indexes:** primary key; unique `email_normalized`.
- **Triggers:** `admin_users_touch_updated_at`.
- **Written by:** `AuthService`: `createAdmin` (the first-run bootstrap from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`, and `scripts/admin.ts create`; any role, a LOGISTICS one with its locations), `createStaff` (`POST /api/admin/admins`, ADMIN: OPERATOR, AUDITOR, RETAIL or LOGISTICS with a temporary password, `password_change_required = true`; a LOGISTICS login with its locations, §5.90), `adminLogin` and its failure counter, `enableTotp`, `disableTotp`, `changePassword` (`POST /api/admin/auth/password`: new hash, `password_change_required = false`, counter reset; a wrong current password counts as a failure), `setAdminRole`, `setAdminDisabled` and `unlockAdmin` (the Team routes, API §17.9–§17.11, and `scripts/admin.ts role` / `disable` / `enable`). `setAdminRole` and `setAdminDisabled` run under the `ADMIN_ROSTER` advisory lock (§8.3) and refuse to leave no active ADMIN (`LAST_ADMIN`). Audit actions `admin.create`, `admin.login`, `admin.login_failed`, `admin.logout`, `admin.password_change`, `admin.role_change`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.sessions_revoke`, `admin.totp.enable`, `admin.totp.disable`; a password, temporary or not, never enters the log.

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
| `ended_reason` | `text` | NULL | — | `TRANSFERRED_OUT` (a transfer accepted) and, since LIVE RELEASE+, `RETURNED` (ORBES taking the ownership back with the return of its order, `OrderService.returnOrder`, `returns.ownership_id`, §5.54): the only values written. |

- **Indexes:** primary key; `ownership_single_current`: unique `(product_id) WHERE ended_at IS NULL`; `ownership_product_id_idx (product_id, started_at)`; `ownership_account_id_idx (account_id)`; `ownership_account_started_idx (account_id, started_at)` (migration `0032_growth_indexes`, plan NEXT-NINE BP-29): GROWTH's first ownership of an account (« Registered owners »), its pieces in the order they came (repeat buying, the tiers reached over all history).
- **Written by:** `OwnershipService`: `registerFirst` (insert; audit `ownership.register`; it then delivers the order of that account linked to the piece while SHIPPED, §5.51), `acceptTransfer` (ends the current row, inserts the new one; audit `ownership.transfer.accept`), `confirmOwnership` (`verified = true`; audit `ownership.confirm`); `OrderService.returnOrder` (ends the current row `RETURNED`; audit `ownership.reclaim`). Ownership never changes a product's cryptographic identity.
- **Referenced by:** `ownership_certificates.ownership_id` (§5.27): a certificate holds while its ownership period is current, so ending the row ends every certificate of that period.

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
| `type` | `text` | NOT NULL | — | `CHECK (type IN ('INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION','YEARLY_CARE'))` (`SERVICE_TYPES`; YEARLY_CARE since migration `0028_yearly_care`, opened by the yearly care only, §5.68) |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK (status IN ('OPEN','COMPLETED','CANCELLED'))` |
| `location` | `text` | NULL | — | ≤ 200 characters. Visible to the owner. |
| `notes` | `text` | NULL | — | ≤ 4 000 characters. Internal: never shown to owners. Closing notes are appended. |
| `opened_at` | `timestamptz` | NOT NULL | `now()` | |
| `closed_at` | `timestamptz` | NULL | — | `CHECK (closed_at IS NULL OR closed_at >= opened_at)` |
| `performed_by` | `text` | NULL | — | Workshop or technician; defaults to the acting user's label (e.g. `admin:<uuid>`). Internal. |

- **Indexes:** primary key; `service_records_product_id_idx (product_id, opened_at)`.
- **Written by:** `WarrantyService.openService` (moves the product to SERVICED; audit `service.open`), `completeService` (audit `service.complete`) and `cancelService` (audit `service.cancel`; service only, no HTTP route). When the last open record of a SERVICED product closes, the product returns to its pre-service status. Each takes the caller's transaction when given one: the yearly care (§5.68) opens, completes and cancels its YEARLY_CARE record in the transaction of its own step. `POST /api/admin/products/:productId/services` refuses YEARLY_CARE (`422 VALIDATION_FAILED`).

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

Single-use tokens that bind an action to a fresh scan of that product: registration tokens (`FIRST_REGISTRATION`), minted by an `AUTHENTIC_FIRST_REGISTRATION` verification for the first registration, or by a `SUSPICIOUS_ACTIVITY` one that comes from the scan history alone on a piece shipped with a claim code, which only that claim code can then use (reason `REGISTRATION_WITH_CLAIM_CODE`, API §9.4 step 10); sale tokens (`SALE_ACTIVATION`, migration `0008_retail_mode`, A-08), minted by a staff scan of the sale mode for the warranty activation; and transfer tokens (`TRANSFER_ACCEPT`, migration `0011_scan_token_transfer_accept`, F-03), minted by the verification of a signed-in account that is not the owner of a piece whose transfer is pending, for the acceptance of that transfer, on an authentic result, or on a `SUSPICIOUS_ACTIVITY` result that comes from the scan history alone (reason `TRANSFER_WITH_TRANSFER_CODE`, the registration's exception: strangers scanning copies of a code shown in a listing must not lock out the recipient, who holds the transfer code; the state shown does not change). Neither a registration nor a transfer token is ever minted on a staff scan. A token of one purpose is refused for the others.

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
| `reasons` | `text[]` | NOT NULL | `'{}'` | Machine reasons, e.g. `MALFORMED:CRC`, `UNKNOWN_KEY`, `BAD_SIGNATURE`, `PRODUCT_NOT_REGISTERED`, `CODE_NOT_REGISTERED`, `CODE_MISMATCH`, `KEY_REVOKED`, `UNSUPPORTED_GENOME_VERSION`, `UNSUPPORTED_CODE_VERSION`, `GENOME_MISMATCH`, `CODE_SUPERSEDED`, `CODE_REVOKED`, `PRODUCT_<STATUS>`, `ANOMALY:<TYPE>`, `RISK_THRESHOLD`, `RISK_THRESHOLD_OWNER`, `REGISTRATION_WITH_CLAIM_CODE` (a registration token was issued on a scan that is suspicious from its history alone), `TRANSFER_WITH_TRANSFER_CODE` (a transfer token was issued on a scan that is suspicious from its history alone, F-03, §5.17). |
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
| `target_type` | `text` | NULL | — | e.g. `product`, `code`, `key`, `category`, `collection`, `model`, `account`, `admin`, `anomaly`, `scan`, `drop`. |
| `target_id` | `text` | NULL | — | Products are referenced by canonical id; codes, accounts, admins, anomalies and scans by uuid; keys by key id; categories by letter. |
| `details` | `jsonb` | NOT NULL | `'{}'` | JSON object, ≤ 64 KiB. Never secrets, raw IPs, private keys or customer PII. |
| `ip_hash` | `text` | NULL | — | HMAC pseudonym of the actor's IP (§5.16). |
| `prev_hash` | `bytea` | NOT NULL | — | `CHECK (octet_length = 32)`. Hash of the previous entry; 32 zero bytes for the first entry. |
| `hash` | `bytea` | NOT NULL | — | UNIQUE. `CHECK (octet_length = 32)`. |

Hash chain: `hash = SHA-256(prev_hash ‖ UTF-8(canonicalJSON(entry)))`, where `entry` is the stored row keyed by column name, `{ action, actor_id, actor_type, details, id, ip_hash, occurred_at, target_id, target_type }`, with keys sorted, no whitespace, `occurred_at` as ISO-8601 UTC with milliseconds and absent values as `null`. Because column names are used, an auditor can recompute the chain from a plain SQL export.

- **Indexes:** primary key; unique `hash`; `audit_logs_prev_hash_key`: unique `(prev_hash)` (each entry can be the predecessor of only one entry, so a forked chain fails at insert time); `audit_logs_occurred_at_idx`; `audit_logs_target_idx (target_type, target_id)`. No index on the actor: the one read by actor, the right-of-access export of an account (API §16.13, the entries it made as well as those about it), is a rare ADMIN request and reads the whole log.
- **Triggers:** `audit_logs_append_only` (BEFORE UPDATE OR DELETE, row level) and `audit_logs_no_truncate` (BEFORE TRUNCATE, statement level), both raising `OR001` with "audit_logs is append-only".
- **Written by:** `AuditService.record` only, under the `AUDIT_CHAIN` advisory lock, normally inside the transaction of the change it describes. `verifyChain()` (`GET /api/admin/audit/verify`) recomputes every hash and link; `head()` returns the newest id and hash for external anchoring. The chain detects edits and deletions inside the log, not the removal of the newest entries; anchor the head outside the database (§11).
- **Actions recorded:** `account.register`, `account.login`, `account.login_failed`, `account.logout`, `account.password_change`, `admin.create`, `admin.login`, `admin.login_failed`, `admin.logout`, `admin.password_change`, `admin.role_change`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.sessions_revoke`, `admin.totp.enable`, `admin.totp.disable`, `category.create`, `category.activate`, `category.deactivate`, `collection.create`, `collection.update`, `model.create`, `model.update`, `model.image.set`, `model.image.remove`, `model.gallery.add`, `model.gallery.remove`, `model.gallery.update`, `model.discontinue`, `model.reinstate`, `model.variant.create`, `model.sizes.update`, `model.sizes.declare`, `model.pairs`, `product.issue`, `product.issue_batch`, `product.transition`, `product.reinstate`, `product.photo.set`, `product.photo.remove`, `code.reissue`, `code.revoke`, `code.render`, `code.render_sheet`, `code.sheet_manifest`, `certificate.render`, `certificate.render_refused`, `claim_code.renew`, `claim_code.read`, `claim_code.withdraw`, `key.rotate`, `key.retire`, `key.revoke`, `key.revoke.amend`, `warranty.activate`, `warranty.void`, `warranty.extend`, `service.open`, `service.complete`, `service.cancel`, `ownership.register`, `ownership.claim_failed`, `ownership.transfer.initiate`, `ownership.transfer.accept`, `ownership.transfer.cancel`, `ownership.transfer.expire`, `ownership.confirm`, `ownership.incident`, `ownership.incident.resolve`, `ownership.certificate.create`, `ownership.certificate.revoke`, `anomaly.update`, `retailer.create`, `retailer.update`, `scan.report`, `scan.report.close`, `account.recovery_code.issue`, `account.recover`, `account.recover_failed`, `account.recover_throttled`, `account.lock`, `account.unlock`, `account.export`, `account.sizes.update`, `account.address.create`, `account.address.update`, `account.address.remove`, `account.address.default`, `account.profile.update`, `heard_option.setup`, `heard_option.create`, `heard_option.update`, `heard_option.order`, `order.address`, `order.engraving`, `order.engraving_prices.update`, `drop.create`, `drop.update`, `drop.publish`, `drop.cancel`, `drop.draw`, `drop.enter`, `drop.withdraw`, `drop.reserve`, `drop.size`, `drop.entry.confirm`, `drop.entry.lapse`, `drop.entry.offer`, `circle.post.create`, `circle.post.update`, `circle.post.publish`, `circle.post.unpublish`, `circle.post.photo.add`, `circle.post.photo.remove`, `circle.post.photo.update`, `circle.rsvp`, `club.tier.update`, `shop.request`, `shop.request.close`, `message.write`, `message.answer`, `message.take`, `message.assign`, `message.close`, `club.program.update`, `order.shipping_rates.update`, `order.shipping`, `club.grant`, `order.gift`, `order.credit.apply`, `order.credit.remove`, `order.credit.release`, `care.request`, `care.cancel`, `care.label`, `care.receive`, `care.return`, `care.complete`, `guarantee.grant`, `guarantee.update`, `guarantee.revoke`, `guarantee.cover`, `guarantee.carry`, `guarantee.expire`, `guarantee.use`, `guarantee.settings`, `supplier.create`, `supplier.update`, `model.supplier`. Verifications themselves are recorded in `scan_events`, not in the audit log. `certificate.render` ([API §15.7](API.md#157-post-apiadmincertificates-extension-of-the-contract)) targets the product when the file holds one card and carries `{ productIds, count, format, layout, layoutStatus, codeIssues }`, `codeIssues` being the issue of the ORBES CODE printed on each card, in `productIds` order (plan NEXT LOT §3.2: the card carries the code, so the log says which code went into which box); `certificate.render_refused` carries `{ reason, productIds, refused, format, layout }`; **neither ever carries a claim code**. A buyer's new card (SAVE YOUR NEW CARD, plan NEXT LOT §3.4) adds `orderId` and `by: 'buyer'` to both, the account being the actor. NEW CLAIM CODE (§5.76) records `claim_code.renew` (the staff member; `{ renewalId, for: 'STAFF' | 'BUYER', orderId?, accountId?, reason, replacedRenewalId? }`), `claim_code.read` (the buyer's account, its one reading; `{ renewalId, orderId }`) and `claim_code.withdraw` (`{ renewalId, reason: 'renewed_again' | 'order_cancelled' | 'order_returned' | 'registered' | 'unreadable' | 'superseded', orderId, unshownRenewalId? }`), each targeting the product; **none ever carries a code, sealed or clear**. `ownership.register` from YOUR ORDERS (REGISTER THIS PIECE) carries `{ via: 'order', orderId }` in place of the scan's `scanEventId`. `scan.report` and `scan.report.close` both target the scan (§5.22) and never carry the customer's words or the resolution note. The four `account.recover*` actions target the account (§5.23) and never carry the code or the email; neither do `account.lock`, `account.unlock` and `account.export` (A-06), which carry counts only. `ownership.certificate.create` and `ownership.certificate.revoke` (F-06, §5.27) both target the product (`targetType` `product`) and carry the certificate's id (`certificateId`; plus `expiresAt` and `validDays` on create, and `reason`, `account_locked` or `account_recovery`, on a withdrawal by a lock or an assisted recovery), never the token. The four photograph actions (F-04, §5.26) carry the image's SHA-256, type, dimensions and size and the one it replaced, never its bytes. A model's lookbook (P-R02, §5.3) is audited by `model.update`, its story as `{ length, sha256 }`, never its words, and its first publication as `publishedAt`; the three gallery actions (§5.28) target the model and carry the photograph's SHA-256 and position (with the image's type, dimensions and size on an addition), or the gallery's photographs and alternative texts before and after a new order, never the image's bytes. The eleven `drop.*` actions (P-R03 and P-X02, §5.29, §5.30) target the release (`targetType` `drop`) and name an entry by its id (`entryId`), never an email: `drop.create` carries the release's fields and its seed's SHA-256 (`seedHash`), `drop.update` the values changed before and after (the description as `{ length, sha256 }`), `drop.publish` the `seedHash`, `drop.cancel` whether it was published and how many entries it had, `drop.draw` the counts and the seed it reveals, `drop.enter` and `drop.withdraw` the entry (the account as actor; `again: true` for an entry again; a withdrawal by a lock has the ADMIN as actor and `reason: "account_locked"`), `drop.reserve` (P-X02) the entry, the tier that allowed it and its `respondBy` (the account as actor), `drop.create`, `drop.update` and `drop.publish` also `earlyAccessHours` and `earlyAccessPlatineHours` (and `drop.publish` `earlyAccessOpensAt` and `earlyAccessPlatineOpensAt`), and the three console actions on an entry its rank (`drop.entry.offer` its `respondBy` too, `noted: true` when a note was written, never its words). Plan NEXT LOT §3.6.F (migration `0038`): `drop.create`, `drop.update` and `drop.publish` carry the draw's sizes (`sizes`, `[{ label, pieces }]`); `drop.enter`, `drop.reserve` and `drop.entry.offer` the size (`sizeId`); `drop.size`, the account as actor, `{ entryId, sizeId, before }` (and `guaranteeId`, `guaranteeBefore` when its guarantee was bound or unbound); `drop.draw` the counts per size (`sizes`, `[{ sizeId, label, places, selected, waitlisted }]`). No personal data. The eight `circle.*` actions (P-X01, §5.31 to §5.33) target the post (`targetType` `circle_post`): `circle.post.create` its fields, the body as `{ length, sha256 }`, `circle.post.update` the values changed before and after, `circle.post.publish` its kind and tier, `circle.post.unpublish` when it had been published, the three photograph actions as the gallery's do, and `circle.rsvp` the answer and the one it replaced (`previous`), the account as actor. **A vote in a poll is never audited** (§5.34): the log is permanent, and a vote is an opinion; nor is a visit (§5.35). `club.tier.update` (P-X04, §5.36) targets the tier (`targetType` `club_tier`) and carries `{ tier, benefits, previous }` (`benefits` null when the default words are restored), no personal data. `model.variant.create` (plan NOCTURNE, N1, §5.3) targets the new variant and carries `{ mainId, name, type, skuPrefix, category, collectionId, label, swatch, copied }`, no personal data; a variant's label and colour changed later, and the main model's given on its first variant, are audited `model.update`, before and after. `model.discontinue` and `model.reinstate` (P-R06, §5.3) target the model and carry `{ name, skuPrefix, discontinuedAt, issuedPieces }` (`wasActive` too on a discontinuation; on a reinstatement, `discontinuedAt` is the date it had been discontinued); a model's price and tier in the private salon (P-X08) are audited by `model.update`, before and after. `shop.request` and `shop.request.close` (P-X08, §5.37) target the request (`targetType` `shop_request`) and carry `{ modelId }` (plus `reason: "account_locked"` on a closing by a lock): `shop.request` the account as actor, `shop.request.close` the console user. **Neither the account's note nor the console's closing note is ever audited**: the first is the account's own words, the second may name the client. The `drop.live.*` actions (the LIVE RELEASES, §5.29 and §5.38 to §5.45) target the release (`targetType` `drop`) and name entries, sizes, add-ons and messages by id, never an email: the console's `drop.live.create`, `.update` (each setting before and after, the description as `{ length, sha256 }`), `.publish`, `.cancel`, `.silhouette.set`, `.silhouette.remove`, `.pause`, `.resume` (`pausedMs`), `.extend` (the close before and after), `.stock` (the size, the stock before and after, the new quantity and the quantity line the announcement promised), `.free`, `.let_in` (the entry and its place), `.message` (its id and its text, staff words), `.end` (the reason, the time, the entries ended), `.remove` (the entry and the status it left; `reason: "account_locked"` for a lock's), `.board.issue` (`replaced` when it replaces a link; never the secret), `.board.revoke` and `.resolve` (the outcome, `noted: true` with a note, never its words); the engine's, the system as actor, `drop.live.queue` (the entries placed at T0) and `drop.live.end` (SOLD_OUT, CLOSED); the account's, the account as actor, `drop.live.enter` (the entry, size and quantity; its place after T0), `.size` (before and after), `.leave` (the status it left), `.interest` and `.interest.withdraw` (the size), `.secure` (the entry and `gestureMs`, the length of the hold), `.addons` (their ids), `.confirm` (the quantity) and `.release`. A PRESS changes no state and is not audited. **LIVE RELEASE+** (migrations `0022`, `0023`): the orders' `order.create`, `order.pay`, `order.ship`, `order.deliver`, `order.cancel`, `order.return`, `order.location`, `order.terms`, `order.buyer` and `order.link` target the order (`targetType` `order`) and carry its step before and after, ids and facts (the carrier, a declared value, where a piece goes, `noted: true` when a note was written), **never the buyer's name or address nor an engraving's words** (`order.buyer` and `order.terms` name the fields written, `fields`, never what they say); `order.alerts` (ADMIN) the delays before and after; `ownership.reclaim` (a return taking an ownership back) targets the product with the account's id, the order and the outcome, followed by `ownership.transfer.cancel` (`reason: "order_returned"`) for a transfer it cancels; `invoice.issue` and `invoice.credit` target the document with the order's id, its number, currency and total, never the buyer; the atelier's `bench.create`, `bench.start`, `bench.done` (with `product.issue` for the identity it issues), `bench.cancel`, `bench.sheet` (the work sheets printed) and `code.sign` (a reserved identity's code signed for its sheet) target the piece to make or the code (written no more since plan NEXT LOT step 5.13 removed the atelier, as `order.link` `{ via: 'bench' | 'stock' }`: since then `order.link` comes only with the packing scan, `{ via: 'scan' }`; the entries written stay); the stock's `stock.setup` (the first boot's presets, once), `stock.transfer`, `stock.adjust` (counts, ids and the note's presence), `stock.threshold`, `stock.location.create`, `stock.location.update`, `carrier.create` and `carrier.update`; `model.shopify` (the Shopify ids before and after); `segment.create`, `segment.update` (before and after) and `segment.delete`, a segment's name and criteria, which name no account; `drop.live.after_room.open` (the after-room, its guests' count, its door's times) and `drop.live.after_room.skip` (why it never opened), the system or the console as actor; and `drop.live.answer`, the account as actor, the release's id and **the position of the answer** (and the one it replaced), nothing else. **MESSAGES** (migration `0025`, plan NEXT-NINE, CS-01, §5.62, §5.63): `message.write` (the account as actor), `message.answer`, `message.take`, `message.assign` (ADMIN) and `message.close` target the conversation (`targetType` `client_conversation`) and carry its id, the message's id, the kind of a context (`context`, never its label), whether a closed conversation reopened (`reopened`), who answered it before and after (`before`, `after`) or the status a closing left (`from`): **never a message's words**. **THE PROGRAM** (migration `0026`, plan NEXT-NINE, BP-19 T2, §5.64, §5.65): `club.program.update` (ADMIN, `targetType` `club_program_settings`) and `order.shipping_rates.update` (ADMIN, `targetType` `shipping_rates`) carry the settings before and after (`before`, `after`): figures and model ids, no personal data. `order.shipping` (migration `0027`, BP-19 T4) targets the order with its step and the shipping set (`service`, `minor`, `benefit`; `rate: true` when the rate of its currency, on its first price or when its currency changes, `withOrderId` for an order following the one it travels with, `freeBefore` when a free benefit gave way); `order.create` carries the shipping fixed at the creation and the order it travels with. **The tiers' grants** (migration `0027`, BP-19 T5, §5.66, §5.67): `club.grant` targets the account (`targetType` `account`, the system as actor) with the grant's id, tier and kind (a CREDIT's amount, currency and expiry); `order.gift` targets the order a welcome gift travels with (the gift's order, the grant, the tier, the model, `sizeToChoose`); `order.credit.apply` the order (the amount, its currency, each use's id, grant, tier and part), `order.credit.remove` and `order.credit.release` the order (the reason, the amount, the uses given back). No personal data. **The yearly care** (migration `0028`, BP-19 T6, §5.68): `care.request`, `care.cancel`, `care.label`, `care.receive`, `care.return` and `care.complete` target the request (`targetType` `care_request`) with its id, the piece's serial and the year (the tier on a request; who cancelled and from which step; a label's carrier and size); never the return name nor the address. **THE HOUSE'S GUARANTEE** (migration `0029`, IN-01, §5.69, §5.70): `guarantee.grant`, `.update`, `.revoke`, `.cover`, `.carry`, `.expire` and `.use` target the guarantee (`targetType` `house_guarantee`) with the account's id, the release, model or collection's ids, its pieces, validity and shown, and whether a note was given (`noted`), **never the note's words nor an email**; `guarantee.settings` (ADMIN, `targetType` `guarantee_settings`) the defaults before and after. `drop.enter`, `drop.reserve`, `drop.withdraw`, `drop.live.enter`, `drop.live.leave` and `drop.live.remove` name the guarantee an entry uses (`guaranteeId`); `drop.draw` counts the guaranteed places and pieces, `drop.live.queue` the guaranteed entries. **YOUR SIZES** (migration `0030`, plan NEXT-NINE, AC-01, §5.71): `account.sizes.update` targets the account (`targetType` `account`, the account as actor) and carries the kinds set and cleared (`set`, `cleared`), **never the measures**, and is not recorded when nothing changed; `model.sizes.update` (OPERATOR) targets the model (`targetType` `model`) and carries the size kind before and after (`sizeKind`, when it changed) and the SKUs whose fit was written (`skus`), and `model.sizes.declare` (OPERATOR, plan NEXT LOT §3.3) targets the model and carries its size type before and after (`sizeType`, when it changed) and the codes of the SKUs `added`, `reinstated`, `setAside` and `removed` (codes, since a removed SKU's id no longer exists; never personal data); `model.create` carries the `sizeType` given at creation, and is not recorded when the kind is unchanged and no fit was written; no personal data. `model.pairs` (plan NEXT-NINE, BP-34, §5.72) targets the main model (`targetType` `model`) and carries `{ before, after }`, the picked models' ids in their order; the same picks again are not recorded; no personal data. **LOGISTICS and the suppliers** (migration `0035`, plan NEXT LOT §3.5, §5.77, §5.90): `admin.create` and `admin.role_change` carry a LOGISTICS login's locations (`stockLocationIds`); `supplier.create` targets the supplier (`targetType` `supplier`) with its name, currency and state; `supplier.update` the names of the fields changed (`fields`), never a contact's words; `model.supplier` targets the model with the supplier ids before and after, the model's (`supplierId`) and its sizes' (`sizes`, by SKU id); no personal data. **The supplier orders** (migration `0036`, plan NEXT LOT §3.5.6.3, §5.78 to §5.83): `supplier_order.create`, `.draft` (`{ skuId, quantity, from }`), `.update` (`{ fields }`), `.discard`, `.send`, `.confirm`, `.cancel_rest` (`{ pieces, to }`), `.invoice`, `.invoice_paid` and `supplier_return.settle` target the supplier order (`targetType` `supplier_order`) with its reference, ids, counts and amounts, never a note's words nor a supplier's contact. **The receptions** (migration `0036`, plan NEXT LOT §3.5.6.5, §5.80 to §5.83): `reception.record` and `.update` (`{ supplierOrderId, lines: [{ skuId, accepted, rejected }] }`), `.send_back` (`{ supplierOrderId, noted }`), `.confirm` (`{ supplierOrderId, reference, accepted, rejected, lines, status }`), `.issued` (`{ supplierOrderId, identities }`, by the system), `card.print` (`{ receptionId, run, layout, productIds, skipped }`) and `card.attached` (`{ receptionId, cards }`) target the reception (`targetType` `reception`); `supplier_return.returned` targets the supplier order; each piece issued is a `product.issue` with its `receptionId` and `receptionLineId`, by the confirming admin. Never a note's words nor a claim code, sealed or clear. **Logistics' stock** (plan NEXT LOT §3.5.6.6, §5.84): `stock.correction.propose` (`{ correctionId, locationId, delta }`), `.approve` (with `movementId`, beside the movement's `stock.adjust`) and `.decline` target the SKU (`targetType` `sku`), never the reason's or the note's words; `stock.count_in` (`{ skuId, productIds }`) targets the SKU, never the note. **Waiting orders served** (migration `0037`, §5.51): `order.serve` targets the order, by the system, `{ reservation: 'STOCK', skuId, locationId, queueFirst? }`. **Packing and shipping** (migration `0037`, plan NEXT LOT §3.5.6.8, §5.85, §5.86): `order.pack.start` (`{ shipmentId, parcel }`), `order.pack.scan` (`{ shipmentId, productId, scanId }`, after the piece's `order.link` `{ via: 'scan' }`), `order.pack.photo` (`{ shipmentId, sha256, bytes }`, **never the photo**) and `order.pack.check` (`{ shipmentId, keys }`, the checklist's lines) target each order of the parcel, the agent or ORBES staff as actor; Ship writes each order's `order.ship`, and `warranty.activate` with `{ via: 'ship', orderId }` for each piece whose warranty starts there (question 14, no point of sale); Mark delivered each order's `order.deliver` `{ by: 'logistics' }`. No name, address, phone, claim code nor photo bytes. **Order cases** (migration `0037`, plan NEXT LOT §3.5.6.7, §5.87): `order.case.open` (`{ caseId, kind, reason?, sizeLabel?, shipmentId?, by }`; `by: 'account'`, the account as actor, for a return or an exchange the collector asks from YOUR ORDERS, §3.6.D), `order.case.receive` (`{ caseId, kind, pieceState }`), `order.case.decide` (`{ caseId, kind, outcome, pieceTo, exchangeOrderId?, shipmentId? }`) and `order.case.cancel` (`{ caseId, kind, by? }`: `by: 'registration'` when a buyer's registration ends a parcel problem) target the case's order; `order.reship` (`{ caseId, shipmentId, reservation, queueFirst? }`) each order of a parcel shipped again; `order.exchange` (`{ exchangeOrderId, skuId }`) the order exchanged, beside the EXCHANGE order's `order.create`, `order.pay` and `invoice.issue`; the pieces of a lost parcel `product.transition` to REVOKED (`via: 'order.case.decide'`). **Never the note, the agent's or ORBES's words.** **YOUR ADDRESSES and the delivery address** (migration `0039`, plan NEXT LOT §3.6.B, §5.88, §5.51): `account.address.create` (`{ addressId, country, isDefault }`), `.update` (`{ addressId, country, fields }`), `.remove` (`{ addressId, country, defaultNow? }`) and `.default` (`{ addressId, country }`) target the account, the account as actor; `order.address` (`{ by: 'collector', country, changed }`) targets the order, the account as actor; `order.buyer` (Client Services) carries `changed` (an address replaced after it was first entered) and the `country`; `order.create` the default address put on the order (`address: { by: 'collector', country }`). **Never a name, an address's lines nor a phone.** **The engraving** (migration `0039`, plan NEXT LOT §3.6.C, §5.89): `order.engraving` targets the order (`{ by: 'collector' | 'staff', priced, addon, removed?, currency? }`: who typed it, the price it took or none, whether it is the release's add-on, a removal, a currency changed), the account or the console user as actor; `order.engraving_prices.update` (ADMIN, `targetType` `engraving_prices`) the prices before and after; `invoice.issue` carries `supplements` (the order's invoice's number) on a supplementary invoice, `invoice.credit` `scope: 'LINES'` and `reason: 'engraving'` on a credit note for single lines, `scope: 'FULL'` and `remains: true` on one that credits what remains. **Never the engraving's words.** **TEST ENTRANTS** (migration `0024_z`, §5.73 to §5.75): `test_run.start`, `test_run.add`, `test_run.stop`, `test_run.confirm`, `test_run.release` and `test_run.end` target the test (`targetType` `test_run`), the ADMIN as actor: the release's id, its mode, the test entrants sent (and their tiers), the test entrant's account and entry for a confirmation or release by hand, and, for END TEST, the status it ended from, the report's checks passed and what the clean-up did (counts); the test entrants' own actions are audited by the routes as any account's (`drop.enter`, `drop.live.secure`, …); END TEST's clean-up writes `drop.withdraw`, `drop.entry.lapse` (with `from`, the status it left), `drop.live.interest.withdraw` and a CONFIRMED LIVE entry's `drop.live.remove` (`from: "CONFIRMED"`) with `reason: "test_ended"`, and `drop.live.remove`, `order.cancel` (a GIFT order's too) and `order.credit.release` as their services write them. **YOUR PROFILE** (migration `0040`, plan CUSTOMER INTELLIGENCE §3.1, §5.91 to §5.93): `account.register` carries `{ profile: true, heardOptionId }` when the sign-up gave the names (the answer's id, or null), **never the names nor the country**; `account.profile.update` targets the account (`targetType` `account`), the account or the console user as actor, with `{ by: 'collector' | 'staff', fields, tastes?, birthDate? }`: the names of the fields changed (`firstName`, `lastName`, `country`, `city`, `phone`, `birthDate`, `instagram`, `heard`, `tastes`), the tastes' counts (`{ pieces, finishes, added, removed }`) and `birthDate: 'set'` when a date is entered (`'changed'` or `'cleared'` by Client Services); **never a value**, and nothing when nothing changed. `account.address.create` and `.update` carry `by: 'staff'` when Client Services wrote the default address (`AddressService.setDefaultByStaff`), never its words. `heard_option.setup` (the system, the first boot's answers, `{ labels }`), `heard_option.create` (`{ label }`), `heard_option.update` (`{ before, after }`, each `{ label, active }`) and `heard_option.order` (`{ labels }`, in their new order) target the answers (`targetType` `heard_option`), the ADMIN as actor: house words, no personal data.
- `ownership.claim_failed` entries double as the counter for the claim-code attempt limit (5 failures per product per rolling hour) (since the piece's latest new claim code, §5.76, when it is more recent: a new code starts with five fresh attempts), so the limit holds across server instances and restarts. `account.recover_failed` entries do the same for the recovery-code limit (5 wrong guesses per code per rolling hour: the entries naming the open code, `details.recoveryCodeId`; §5.23).
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
- **Written by:** `AccountRecoveryService` (`services/account-recovery.ts`). `issue` (`POST /api/admin/owners/:id/recovery-code`, ADMIN; an ACTIVE account only) locks the account row, revokes the open code and inserts the new one (audit `account.recovery_code.issue` with `{ recoveryCodeId, expiresAt, replaced }`). `recover` (`POST /api/v1/account/recover`) locks the account row and reads the open code. Without one, or once it has expired, the attempt is committed as `account.recover_failed` with its reason (`NO_OPEN_CODE`, `EXPIRED`) and does not count. Otherwise it counts the `account.recover_failed` entries of the last hour that name this code (`details->>'recoveryCodeId'`, read through the `audit_logs_target_idx` index on the account; at most 5; then `account.recover_throttled`, the code is not checked), and checks the code against its hash (a wrong guess is committed as `account.recover_failed` with `{ recoveryCodeId, attempt, reason: "MISMATCH" }` before the answer); then, in one transaction, it re-locks the account, sets `used_at` only if the code is still open, writes the new password, clears the login throttle, sets `transfers_frozen_until` to now + 72 hours, deletes every session of the account, withdraws its open links to ownership certificates (§5.27) and cancels its pending transfers (§5.13), and records `account.recover` (with `certificatesRevoked`). A LOCKED account is refused and its code is not used. `OwnerService.lock` (A-06) revokes the account's open, unexpired code in the lock's transaction (counted as `recoveryCodesRevoked` in `account.lock`), so a code issued before a lock fails after the unlock.
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

### 5.26 `media_objects`

The photographs of the catalogue and of the pieces (migration `0012_media`, recommendation F-04): a model's reference photograph (`models.image_sha256`, phase 1) and the photograph of one piece taken at issuance (`products.photo_sha256`, phase 2), served publicly by `GET /api/v1/media/:sha256` ([API §8.6](API.md#86-get-apiv1mediasha256)); and, from migration `0014_model_lookbook` (P-R02), the photographs of a model's lookbook gallery (`model_images`, §5.28); from migration `0016_circle` (P-X01), the photographs of a circle post (`circle_post_images`, §5.32). One storage for all of them.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `sha256` | `text` | NOT NULL | — | PK. `CHECK (sha256 ~ '^[0-9a-f]{64}$')`, and `media_objects_sha256_consistent`: `sha256 = encode(sha256(bytes), 'hex')`, recomputed by the database. Content-addressed: the same photograph is one row, and its URL names its content. |
| `mime` | `text` | NOT NULL | — | `CHECK (mime IN ('image/jpeg','image/webp'))` (`MEDIA_MIME_TYPES`), read from the bytes, never from a file name. |
| `bytes` | `bytea` | NOT NULL | — | `CHECK (octet_length BETWEEN 1 AND 1048576)`: at most 1 MiB, the body limit of the upload routes. Stored **after** EXIF, XMP and every other metadata segment or chunk were removed (`genome/src/server/media/image.ts`): no GPS position, camera settings, serial number, software or thumbnail. The colour profile (ICC) is kept whole, with its own text (in a device's profile, its maker and model). |
| `width`, `height` | `int` | NOT NULL | — | `CHECK (BETWEEN 1 AND 4096)`, read from the JPEG frame header or the WebP bitstream. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`: the console user who uploaded it; NULL when a script stored it (system actor). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |

- **Indexes:** primary key; `media_objects_created_by_idx (created_by)`. The five foreign keys that point here lead `models_image_sha256_idx`, `products_photo_sha256_idx`, `model_images_sha256_idx`, `circle_post_images_sha256_idx` and `drops_silhouette_sha256_idx` (a LIVE RELEASE's silhouette, §5.29).
- **Triggers:** `media_objects_immutable` (BEFORE UPDATE, `OR001` "media objects are content-addressed and never change").
- **Written by:** `MediaService` (`src/server/services/media.ts`) only: `INSERT … ON CONFLICT (sha256) DO NOTHING` in the transaction that points a model, a gallery, a circle post, a LIVE RELEASE (its silhouette) or a piece to the image, then `SELECT … FOR KEY SHARE` of the row (inserted again, once, if it has just been deleted). Once that transaction has committed, an image that no model, no gallery, no circle post, no LIVE RELEASE's silhouette and no piece uses any more (`deleteIfUnused`) (the one replaced or removed) is deleted. `DO NOTHING` locks no row that already exists, so without the `FOR KEY SHARE` that delete could remove the row between an upload of the very same bytes and the pointer it then writes (whose foreign key would fail, a 500); locked, the delete waits for the upload, whose pointer its `ON DELETE RESTRICT` check then sees: the delete is refused (and skipped), and the row stays, used. The size of the table is bounded by the photographs in use.
- **Read by:** `GET /api/v1/media/:sha256` (public, `Cache-Control: public, max-age=31536000, immutable`, its own rate group `media`). A verification names an image only on an `AUTHENTIC*` result; the owner's list of pieces (`GET /api/v1/account/products`, MY PIECES) names those of the account's own pieces; the lookbook names a shown model's cover and gallery (a RESERVED model's too, to an owner: unlisted, not confidential); an ownership certificate names none.
- **Privacy:** photographs of objects, stripped of their metadata; a photograph showing a person is out of place here (the console says what each one is for). Included in the database backups (§11) like every other table.
- **Storage and disk:** the photographs live in this `bytea` column (TOAST), so in the database volume (`orbes_pgdata` on the VPS stack), and every `pg_dump`, so every backup archive, holds all of them (a gallery adds up to 8 per model: P-R02); a JPEG or WebP does not compress any further. With `P` the size of the photographs in use and `A` the number of archives kept (14 nightly, up to 14 event archives and the weekly copies: about 20 to 35 on the VPS), they take about **P × (1 + A)** of the disk. The owner's decision of 2026-10-03 keeps them as they are (2 000 px at most on the longer side, 1 MB at most) and watches the disk: `backup.sh` logs `photos: <count>, <size> MB` (`count(*)` and `sum(octet_length(bytes))`, MB = 1 048 576 bytes) on every run, `photos: 0, 0.0 MB` while this table does not exist yet. The size and orphan queries, and the thresholds (75 % of `/` or 300 MB of photographs: decide with the host owner; 80 %: alert), are in [DEPLOYMENT §15.12](DEPLOYMENT.md#1512-monitoring-and-routine-checks). No schema change: OPS-D2 only reads this table.

### 5.27 `ownership_certificates`

The shareable ownership certificate (migration `0013_ownership_certificates`, F-06; §5.26 is `media_objects`, F-04's migration `0012`, which deploys before it): a link the current owner of a piece creates in MY PIECES for a buyer at a distance or an insurer, which shows the live record of the piece (the piece, its GENOME, the ownership and its date, the warranty, no loss or theft reported) and never a person ([API §8.7 and §11.7](API.md#87-post-apiv1certificateslookup-and-post-apiv1certificatespdf-extension-of-the-contract)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. The owner withdraws a link by it (`DELETE /api/v1/ownership/certificates/:id`); never shown to the public. |
| `token_hash` | `bytea` | NOT NULL | — | UNIQUE. `CHECK (octet_length = 32)`. SHA-256 of the link's 32 random bytes (written in the link as 52 Crockford base32 characters, after the `#` of `/verify/c#`). The token is shown once, at creation; a reader of the table cannot open a certificate. Unlike a transfer code (§5.13), no key is needed: 256 random bits cannot be guessed offline. |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id`. |
| `ownership_id` | `uuid` | NOT NULL | — | FK → `ownership.id`: the ownership period the certificate was created in. Once it ends (a transfer, a change by ORBES Client Services), the certificate is no longer valid, for good: a later period of the same account is another row. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `expires_at` | `timestamptz` | NOT NULL | — | `ownership_certificates_lifetime`: `CHECK (expires_at > created_at AND expires_at - created_at <= interval '90 days')` (absolute time). Creation + 1 to 90 days, as the owner chose (30 by default). |
| `revoked_at` | `timestamptz` | NULL | — | `CHECK (revoked_at IS NULL OR revoked_at >= created_at)`. Set when the owner withdraws the link; from then on it answers as an unknown one. |

- **Indexes:** primary key; unique `token_hash` (`ownership_certificates_token_hash_key`: the lookup); `ownership_certificates_product_idx (product_id, created_at)` and `ownership_certificates_ownership_idx (ownership_id, created_at)`, which lead with the foreign keys (the owner's links, the limit of 10 links in use per piece).
- **Validity, computed at each lookup, never stored:** not withdrawn (else 404), not expired, its ownership period still current, and the piece neither in nor, since `created_at`, ever moved to LOST, STOLEN, REVOKED, COUNTERFEIT_FLAGGED or RETIRED (read from `product_status_history`, §5.5: a piece found again does not bring an earlier certificate back).
- **Written by:** `OwnershipCertificateService` (`services/ownership-certificates.ts`): `create` (`POST /api/v1/ownership/certificates`; the account row FOR SHARE, then the request's session row FOR SHARE (`sessions`, §5.11: one an assisted recovery or a password change deleted meanwhile answers 401 and nothing is written), then the product FOR UPDATE, lock order account → session → product as in §8.2; audit `ownership.certificate.create` with `{ certificateId, expiresAt, validDays }`), `revoke` (`DELETE /api/v1/ownership/certificates/:id`; one conditional `UPDATE … WHERE revoked_at IS NULL` on a link of the account's ownership periods; audit `ownership.certificate.revoke` with `{ certificateId }`). `withdrawAccountCertificates` (the same file) sets `revoked_at` on every open link of an account (not withdrawn, not expired, of a piece it owns now) in the transaction of `OwnerService.lock` (A-06, §5.9) and of `AccountRecoveryService.recover` (C-04, §5.23), to `greatest(<the caller's clock>, created_at)`: the caller reads its clock before it locks the account row, and on PostgreSQL a creation's `FOR SHARE` can go ahead of a lock already waiting, so a link may bear a later time than the lock's; it is then withdrawn at its own creation time and the CHECK `revoked_at >= created_at` holds (otherwise the lock or the recovery would fail with a 500), before the transfers are cancelled, so a link created by whoever held the account stops showing the record; each is audited `ownership.certificate.revoke` with `{ certificateId, reason }` (`account_locked`, `account_recovery`) by the lock's ADMIN or the recovering account, after the row locks, and counted as `certificatesRevoked` in `account.lock` or `account.recover`. Never the token in the audit log.
- **Read by:** the public lookup and PDF (`POST /api/v1/certificates/lookup` and `/pdf`, by `token_hash`), MY PIECES (`GET /api/v1/ownership/certificates`: the account's open links, without tokens), and the account's export (`OwnerService.exportData`, `GET /api/admin/owners/:id/export`: every link of its current and past ownership periods, with its state, never `token_hash` or `id`).
- **Retention:** rows are kept, expired or withdrawn (never deleted; the audit log names them by id). They hold no personal data of their own: the account is reached through `ownership_id`. An account's export lists every link it created, open, ended or withdrawn, with its dates and state (`certificates`, whoever withdrew it); its activity names the creations and the withdrawals the account made itself or that its assisted recovery made (actor: the account). A withdrawal by a lock is audited with the ADMIN as actor and the piece as target (§5.21), so it shows in the export's `certificates` (`revokedAt`), not in its activity.

### 5.28 `model_images`

The gallery of a model's lookbook sheet (migration `0014_model_lookbook`, P-R02; §5.27 is `ownership_certificates`): up to 8 photographs beside the cover (the reference photograph, `models.image_sha256`, which is not a row here), in an order, each with its alternative text ([API §13.4](API.md#134-models)). Shown on the sheet of a PUBLIC model to everyone, of a RESERVED one to the owners of a piece ([API §8.8, §10.9](API.md#88-get-apiv1lookbook-and-get-apiv1lookbookslug-extension-of-the-contract)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `model_id` | `uuid` | NOT NULL | — | PK (with `sha256`). FK → `models.id`. |
| `sha256` | `text` | NOT NULL | — | PK (with `model_id`). FK → `media_objects.sha256`: the photograph, stored once by MediaService (§5.26). |
| `position` | `smallint` | NOT NULL | — | `CHECK (position BETWEEN 1 AND 8)`; unique per model (`model_images_position_key`, `DEFERRABLE INITIALLY DEFERRED`: a reorder may swap two positions inside its transaction, the uniqueness is checked at commit). So a gallery holds 8 photographs at most, in the database itself. MediaService keeps them 1 to n. |
| `alt` | `text` | NULL | — | `CHECK (length(btrim(alt)) BETWEEN 1 AND 200)`. NULL: the sheet's default (*The MONOLITHE RING model, photographed by ORBES*). One line (the service's rule). |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`: the console user who added it; NULL when a script did. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |

- **Indexes:** primary key `(model_id, sha256)`, which leads with the model; `model_images_position_key (model_id, position)`; `model_images_sha256_idx (sha256)` and `model_images_created_by_idx (created_by)`, which lead with the other two foreign keys.
- **Triggers:** `model_images_immutable_identity` (BEFORE UPDATE, guards `model_id`, `sha256`, `created_by`, `created_at`), raising `OR001`: a row is moved or retitled, never given to another model or photograph.
- **Written by:** `MediaService` only (`addModelGalleryImage`, `removeModelGalleryImage`, `arrangeModelGallery`: `POST`, `DELETE` and `PATCH /api/admin/models/:id/gallery`, OPERATOR), each in one transaction that locks the model's row first (`FOR UPDATE`), with its audit entry (`model.gallery.add` with the image's facts and its position, `model.gallery.remove` with its hash and position, `model.gallery.update` with the gallery before and after). Adding the model's reference photograph is refused (`409 IMAGE_IS_COVER`); a removed photograph that nothing else uses is deleted from `media_objects` once the change has committed.
- **Read by:** the console (`GET /api/admin/models`, `/:id`: `gallery`), the lookbook's sheets (in their order; a photograph that has become the cover since is left out there) and their cards (the first photograph, for a model without a cover).
- **Privacy:** photographs of objects, stripped of their metadata, like every other of §5.26. No personal data.

### 5.29 `drops`

The releases of a model in a limited number of pieces (migration `0015_drops`, P-R03; *releases* on the screens): created by the console (OPERATOR) as drafts, published on /verify, entered by ORBES accounts (§5.30), then drawn by an ADMIN by tier, seniority and the order of a seed committed at creation ([API §8.9, §10.10, §16.19](API.md#89-get-apiv1drops-get-apiv1dropsid-and-get-apiv1dropsidentries-extension-of-the-contract)). The state is computed, never stored (`dropState`, `services/drops.ts`): `DRAFT` (`published_at` NULL), `UPCOMING` (before `opens_at`), `OPEN` (`opens_at` ≤ now < `closes_at`), `CLOSED`, `DRAWN` (`drawn_at` set), `CANCELLED` (`cancelled_at` set).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Drawn by the service (`randomUUID`) before the insert: the seed is sealed with it as associated data. |
| `model_id` | `uuid` | NOT NULL | — | FK → `models.id`. A model offered for new pieces at creation and at publication (`409 MODEL_INACTIVE`, a service rule). |
| `title` | `text` | NOT NULL | — | `CHECK (length(btrim(title)) BETWEEN 1 AND 120)`; one line (the service's rule). |
| `description` | `text` | NULL | — | `CHECK (length(btrim(description)) BETWEEN 1 AND 2000)`. Plain paragraphs; the one field that changes once published. |
| `quantity` | `int` | NOT NULL | — | `CHECK (quantity >= 1)`; at most 10 000 (the request's rule). The places of the draw. |
| `opens_at`, `closes_at` | `timestamptz` | NOT NULL | — | The window of entries. `drops_window`: `CHECK (closes_at > opens_at)`. |
| `purchase_window_hours` | `smallint` | NOT NULL | `48` | `CHECK (purchase_window_hours BETWEEN 1 AND 336)`: how long a place drawn or reserved is held (`drop_entries.respond_by`). |
| `early_access_hours` | `smallint` | NOT NULL | `48` | Migration `0017_drop_early_access` (P-X02). `CHECK (early_access_hours BETWEEN 0 AND 336)`: how long before `opens_at` the accounts PLATINE or PALLADIUM (tier 2 or 3, read at the moment of their request) **reserve a place directly**, first come, first served, within `quantity`; 0: no early access. The early access runs from `opens_at − early_access_hours`, or the publication when later (`earlyAccessOpensAt`), to `opens_at`; then the places left follow the draw. Set with the other fields while a DRAFT, fixed once published (a service rule). |
| `early_access_platine_hours` | `smallint` | NULL | — | Migration `0026_club_program` (plan NEXT-NINE, BP-19 T3). `CHECK (early_access_platine_hours BETWEEN 0 AND 336)`, `drops_platine_window` `CHECK (early_access_platine_hours <= early_access_hours)`: PLATINE's early access, never longer than PALLADIUM's, which `early_access_hours` then is (its default stays 48 for the previous image); NULL: from the same time as PALLADIUM, so every drop published before keeps its behaviour. `drops_live_platine`: `CHECK (mode = 'DRAW' OR early_access_platine_hours IS NULL)`, never on a LIVE RELEASE. |
| `published_at` | `timestamptz` | NULL | — | Set once by the publication; never cleared. |
| `cancelled_at` | `timestamptz` | NULL | — | Set by a cancellation. `drops_cancelled_before_draw`: `CHECK (cancelled_at IS NULL OR drawn_at IS NULL)`. |
| `seed_enc` | `text` | NOT NULL | — | The seed of the draw, 32 random bytes drawn at creation, sealed with AES-256-GCM (`v1.<iv>.<ciphertext‖tag>`, base64url: `CHECK (seed_enc ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$')`) under a key derived by HKDF-SHA-256 from `KEY_ENCRYPTION_KEY` (from `COOKIE_SECRET` without one; info `orbes/drop-seed/v1`), as `admin_users.totp_secret_enc` is, with `orbes/drop/<id>` as associated data: a sealed seed moved to another release does not open. Immutable. |
| `seed_hash` | `bytea` | NOT NULL | — | `CHECK (octet_length(seed_hash) = 32)`. SHA-256 of the seed: the commitment /verify shows from the publication on. Immutable. |
| `seed` | `bytea` | NULL | — | The seed in clear, written by the draw only, which publishes it. `drops_seed`: `CHECK (seed IS NULL OR (octet_length(seed) = 32 AND seed_hash = sha256(seed)))`, so the database itself refuses a draw with another seed than the committed one; `drops_drawn`: `CHECK ((drawn_at IS NULL) = (seed IS NULL))`. |
| `drawn_at` | `timestamptz` | NULL | — | Set by the draw. `drops_drawn_after_close`: `CHECK (drawn_at IS NULL OR (published_at IS NOT NULL AND drawn_at >= closes_at))`. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`: the console user who created it. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |

- **Indexes:** primary key; `drops_model_id_idx (model_id)` and `drops_created_by_idx (created_by)`, which lead with the foreign keys; `drops_published_opens_idx (opens_at) WHERE published_at IS NOT NULL`, the public list.
- **Triggers:** `drops_immutable_seed` (BEFORE UPDATE, guards `seed_enc` and `seed_hash`), raising `OR001`: a release is drawn with the seed its published fingerprint commits to, or not at all.
- **Written by:** `DropService` (`services/drops.ts`) only, each change under the release's row lock (`FOR UPDATE`) with its audit entry: `create` (`POST /api/admin/drops`; `drop.create`, with `earlyAccessHours` and `earlyAccessPlatineHours`, THE PROGRAM's when the console sends none, §5.64), `update` (`PATCH`: any field of a draft, `early_access_hours` included, the description only once published; `drop.update`), `publish` (`drop.publish`, with `earlyAccessHours` and the actual opening of the direct reservations, `earlyAccessOpensAt`), `cancel` (before the draw; `drop.cancel`), `draw` (ADMIN, after `closes_at`, once: opens the seed, checks it against `seed_hash` (`503 DROP_SEED_UNAVAILABLE` otherwise), ranks the entries (§5.30), then writes `seed` and `drawn_at`; `drop.draw`, with the seed). A direct reservation (§5.30) takes the release's row `FOR UPDATE` too, without writing it: the places are counted one request after the other.
- **Read by:** the public list and page (`GET /api/v1/drops`, `/:id`: published releases only; `seed` once drawn, never `seed_enc`), the account's status (`GET /api/v1/club/status`), the console (`GET /api/admin/drops`, `/:id`: never `seed_enc`, `seed` once drawn).
- **Keys:** the key that seals the seeds comes from `KEY_ENCRYPTION_KEY` (from `COOKIE_SECRET` without one). Changing it leaves the seeds of the releases not drawn yet unreadable: their draw then fails closed, and such a release is cancelled and created again. A backup and that secret open every sealed seed (§11): before its draw, the seed of a release is a secret like a TOTP secret.
- **Privacy:** no personal data (the author is a staff id).

**A LIVE RELEASE** (migration `0021_live_release`, plan of 2026-10-04; [API §8.10, §10.12, §16.23](API.md#810-the-live-releases-get-apiv1live-and-the-boutique-board-extension-of-the-contract)) is a row of `drops` whose `mode` is `LIVE`: lived live, never drawn (`drawn_at` stays NULL, `early_access_hours` is 0), its sealed seed ordering the line within a tier and never revealed. `drops_draw_fields` holds every column below NULL (and `paused_ms_total` 0) for a DRAW, but `price_minor` and `currency` since migration `0024_model_variants` (plan NOCTURNE, addition 5: a draw's price, both or neither, `drops_draw_price`); `drops_live_fields` requires the settings for a LIVE one. `quantity` is the sum of its sizes' stock (§5.38). Its phase is computed (`livePhase`, `services/live.ts`): `DRAFT`, `HIDDEN` (published, before `announce_at`), `ANNOUNCED`, `ROOM` (from `opens_at − room_opens_minutes`), `LIVE` (from `opens_at`, T0), `ENDED` (from `ended_at` or `closes_at`), `CANCELLED`.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `mode` | `text` | NOT NULL | `'DRAW'` | `CHECK (mode IN ('DRAW','LIVE'))` (`DROP_MODES`): every drop before 0021 is a DRAW. |
| `live_min_tier` | `smallint` | NULL | — | `CHECK (live_min_tier BETWEEN 0 AND 3)`: who may enter, 0 any ORBES account … 3 PALLADIUM; narrowed by §5.40 and `access_collection_id`. |
| `tier_priority` | `boolean` | NULL | — | The line at T0 by tier first (true by default, a service rule). |
| `room_opens_minutes` | `smallint` | NULL | — | `CHECK (room_opens_minutes BETWEEN 1 AND 60)`; 5 by default. |
| `turn_seconds` | `smallint` | NULL | — | `CHECK (turn_seconds BETWEEN 10 AND 300)`; 30 by default; per tier in §5.45. |
| `pay_minutes` | `smallint` | NULL | — | `CHECK (pay_minutes BETWEEN 1 AND 60)`; 5 by default; per tier in §5.45. |
| `per_account` | `smallint` | NULL | — | `CHECK (per_account BETWEEN 1 AND 5)`; 1 by default. |
| `price_minor`, `currency` | `int`, `text` | NULL | — | `CHECK (price_minor >= 0)`, `CHECK (currency ~ '^[A-Z]{3}$')` (EUR, GBP, USD or CHF, a service rule). Public from the announcement. On a DRAW too since migration `0024_model_variants` (plan NOCTURNE, addition 5), both or neither (`drops_draw_price`: `CHECK (mode = 'LIVE' OR (price_minor IS NULL) = (currency IS NULL))`): the price its card and page show, set in the console while a DRAFT, and the price an order created from one of its entries takes (§5.51). |
| `announce_at`, `silhouette_at`, `name_at`, `photo_at` | `timestamptz` | NULL | — | The staged reveals: `announce_at` NULL is the publication, a NULL stage the announcement. `drops_live_stages`: each after the one before (a NULL read as the announcement), all at the room's opening at the latest. |
| `silhouette_sha256` | `text` | NULL | — | FK → `media_objects.sha256` (`drops_silhouette_sha256_idx`): an uploaded silhouette (§5.26: kept while a release uses it). |
| `access_collection_id` | `uuid` | NULL | — | FK → `collections.id` (`drops_access_collection_id_idx`): the owners of a piece of this collection. |
| `quantity_line` | `text` | NULL | — | `CHECK (length(btrim(quantity_line)) BETWEEN 1 AND 40)`: the quantity as the announcement says it (`25 PIECES` by default, from the stock). |
| `paused_at`, `paused_ms_total` | `timestamptz`, `bigint` | NULL, NOT NULL | —, `0` | A pause in progress (`drops_live_paused`: once published), and every pause that ended, in milliseconds (`CHECK (paused_ms_total >= 0)`). |
| `ended_at`, `ended_reason` | `timestamptz`, `text` | NULL | — | `CHECK (ended_reason IN ('SOLD_OUT','CLOSED','ENDED'))` (`LIVE_END_REASONS`); `drops_live_ended`: set together, once published. |
| `board_token_hash`, `board_token_issued_at` | `bytea`, `timestamptz` | NULL | — | The boutique board's secret link: `CHECK (octet_length(board_token_hash) = 32)`, the SHA-256 of its secret (unique, `drops_board_token_hash_key`), and when it was issued; `drops_board_token`: both or neither. |

A LIVE RELEASE's row is written by `LiveConsoleService` (create, update until the announcement, publish, cancel before the room opens; `drop.live.create`, `.update`, `.publish`, `.cancel`), `MediaService` (the silhouette, until the announcement; `drop.live.silhouette.set`, `.remove`) and `LiveService` (the live controls, the board's link, the engine's end), each under the release's `FOR UPDATE`. The draw's service (`DropService`) leaves a LIVE one out of its lists and refuses it (`409 DROP_LIVE`).

**LIVE RELEASE+** (migrations `0022` and `0023`, plan of 2026-10-04): `stock_location_id` on every drop, and the settings below on a LIVE one only (`drops_draw_plus`: all NULL for a DRAW; NULL on a LIVE drop reads as the setting's default, so the previous image's drops stay valid).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `stock_location_id` | `uuid` | NULL | — | Migration `0022`. FK → `stock_locations.id` (§5.46), `drops_stock_location_id_idx`: where its orders hold or have made their pieces, and the stock the feasibility check and the size mix read; NULL: the default location. |
| `parent_drop_id` | `uuid` | NULL | — | FK → `drops.id`; `drops_parent_drop_id_key`, unique: an **after-room** (A3) is a child LIVE RELEASE of the release it follows, one at most. Until the parent sells out it is a DRAFT whose times are the latest it could open; at the sell-out (`settleAfterRoom`) it is published (`published_at` the sell-out, `opens_at` that plus its delay, `closes_at` that plus its length) for the guests remembered then (§5.59), or cancelled when the parent ends otherwise (`drop.live.after_room.open`, `.skip`). It is never listed, in PAST neither, and answers 404 to anyone but its guests from its opening. |
| `after_room_delay_minutes`, `after_room_length_minutes` | `smallint` | NULL | — | 1–60 (10 by default) and 5–120 (15 by default), exactly with a parent. `drops_after_room` keeps an after-room at tier 0, without a model or collection rule, staged reveals, a silhouette, a board link, a surprise, a participation or segment rule, a way to combine, or a question of its own (`surprise_enabled` and `question_enabled` false). |
| `surprise_enabled`, `surprise_text` | `boolean`, `text` | NULL | — | A4: one surprise in every box, its description internal (1–500 characters, required once enabled: `drops_surprise`), copied onto each order and piece to make; the public reads a flag only. |
| `min_participations` | `smallint` | NULL | — | A5: 1–100, the releases an account must have taken part in (computed, `services/participation.ts`; the release itself never counts). |
| `access_segment_id` | `uuid` | NULL | — | N5: FK → `segments.id` (§5.58), `drops_access_segment_id_idx`: a segment whose members may enter, said FOR SELECTED COLLECTORS. |
| `access_combine` | `text` | NULL | — | `CHECK (access_combine IN ('AND','OR'))` (`ACCESS_COMBINES`): how every access rule of the release combines; NULL reads as AND. |
| `question_enabled`, `question_text`, `question_answers` | `boolean`, `text`, `text[]` | NULL | — | G4: the question after (on by default when NULL); its text (1–120 characters) and its 2 to 6 answers, both or neither (`drops_question`; neither: the default question). |

Written by `LiveConsoleService` (the settings, the after-room's child rewritten on every save with the parent's turn and pay windows, per tier too, pieces per person and currency; `409 LIVE_AFTER_ROOM` for any action on an after-room of its own) and the engine (the after-room settled at the parent's end), under the parent's `FOR UPDATE` then the child's.

### 5.30 `drop_entries`

The entries of ORBES accounts in the releases (migration `0015_drops`, P-R03): one row per account and release, whose id the draw publishes ([API §8.9, §10.10](API.md#1010-the-clubs-releases-and-tiers-get-apiv1clubstatus-post-apiv1clubdropsidenter-withdraw-and-reserve-extension-of-the-contract)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. The entry's id: the account reads it in MY PIECES, the draw's list publishes it with the entry's tier, seniority and rank, never the account. |
| `drop_id` | `uuid` | NOT NULL | — | FK → `drops.id`. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`. One entry per account and release, a direct reservation included: `drop_entries_drop_account_key`, unique `(drop_id, account_id)` (a second is `409 DROP_ALREADY_ENTERED`, or `409 DROP_ALREADY_RESERVED`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | The first entry; an entry again keeps it. |
| `status` | `text` | NOT NULL | `'ENTERED'` | `CHECK (status IN ('ENTERED','SELECTED','WAITLISTED','CONFIRMED','LAPSED','WITHDRAWN'))` (`DROP_ENTRY_STATUSES`). ENTERED, WITHDRAWN by its account until the draw (and ENTERED again on the same row: never a deletion and a new row, which would let a draw be run again with other ids), SELECTED (a place held) or WAITLISTED by the draw, then CONFIRMED (the sale concluded by ORBES Client Services) or LAPSED by the console. |
| `tier` | `smallint` | NULL | — | `CHECK (tier BETWEEN 0 AND 3)`: the account's tier at the draw (0 none, 1 TITANE, 2 PLATINE, 3 PALLADIUM), never at its entry; for a direct reservation (P-X02), at the moment of its request (2 or 3). |
| `seniority` | `smallint` | NULL | — | `CHECK (seniority >= 0)`: the account's full years since its first ownership began, at the draw (or at a direct reservation's request). `drop_entries_standing`: `CHECK ((tier IS NULL) = (seniority IS NULL) AND (rank IS NULL OR tier IS NOT NULL))`. |
| `rank` | `int` | NULL | — | `CHECK (rank >= 1)`: its place in the draw's order. |
| `respond_by` | `timestamptz` | NULL | — | The end of the place held: the draw's time (or OFFER NEXT's, or a direct reservation's) plus `drops.purchase_window_hours`. |
| `handled_by` | `uuid` | NULL | — | FK → `admin_users.id`: who concluded it (CONFIRMED or LAPSED). |
| `handled_at` | `timestamptz` | NULL | — | When. `CHECK (handled_at IS NULL OR handled_at >= created_at)`; `drop_entries_lapsed`: `CHECK (status <> 'LAPSED' OR handled_at >= respond_by)`, so a place is never lapsed before its time, in the database itself. |
| `note` | `text` | NULL | — | `CHECK (length(btrim(note)) BETWEEN 1 AND 500)`: the console's note on the conclusion. |
| `guarantee_id` | `uuid` | NULL | — | Migration `0029_house_guarantee` (plan NEXT-NINE, IN-01). FK → `house_guarantees.id` (§5.69); `drop_entries_guarantee_key`, unique: a guarantee is used by one entry. Set when its holder enters (or reserves during its own early access), cleared by WITHDRAW, a lock, a revocation, and when its release ends with it unused. `drop_entries_guaranteed`: `CHECK (guarantee_id IS NULL OR (rank IS NULL AND tier IS NULL))`: a guaranteed entry is never ranked nor tiered. |
| `pieces` | `smallint` | NOT NULL | `1` | Migration `0029`. `CHECK (pieces BETWEEN 1 AND 5)`; `drop_entries_pieces`: `CHECK (pieces = 1 OR guarantee_id IS NOT NULL)`: the pieces of the place, its guarantee's. Every count of places held is in pieces. |
| `size_id` | `uuid` | NULL | — | Migration `0038_draw_sizes` (plan NEXT LOT §3.6.F). `drop_entries_size_fkey`: FK `(drop_id, size_id)` → `drop_sizes (drop_id, id)` (§5.38), ON DELETE RESTRICT: the size the entry chose, one of its own release's. NULL in a draw without sizes (one published before this lot keeps one pool). No CHECK ties a draw to sizes: `DropService` requires a size on every entry of a draw that has sizes (ENTER, RESERVE), changes it while entries are open (`drop.size`), and a place reserved directly keeps it. |

The statuses hold their facts: `drop_entries_entered` (an ENTERED entry has no tier, rank, `respond_by` or `handled_at`), `drop_entries_withdrawn` (no rank), `drop_entries_waitlisted` (a rank), `drop_entries_held` (SELECTED, CONFIRMED and LAPSED have a `respond_by`), `drop_entries_handled` (CONFIRMED and LAPSED have a `handled_at`).

**A direct reservation** (P-X02, migration `0017_drop_early_access` adds no column here) is a row created SELECTED during the release's early access, with its `respond_by`, the tier and seniority of the moment of the request, and **no rank**: it is identified as `tier IS NOT NULL AND rank IS NULL` (`isReservation`). The draw never ranks it (it ranks only the entries still ENTERED) and gives only the places left, `quantity` less the entries SELECTED or CONFIRMED; the draw's public list never shows it. Its account never withdraws it; the console concludes it (CONFIRMED) or lets it lapse after its time (LAPSED), as a place drawn, and a lapsed one gives its place back to the draw.

- **Indexes:** primary key; `drop_entries_drop_account_key (drop_id, account_id)`, which leads with the release; `drop_entries_account_idx (account_id, created_at)`, the account's entries; `drop_entries_handled_by_idx (handled_by)`; `drop_entries_drop_status_idx (drop_id, status, rank)`, the draw's list, the next of the waiting list and the places taken. `drop_entries_size_idx (drop_id, size_id, status, rank)` (0038), the counts per size, each size's waiting list and the draw's fill per size.
- **Triggers:** `drop_entries_immutable_identity` (BEFORE UPDATE, guards `id`, `drop_id`, `account_id`, `created_at`), raising `OR001`.
- **Written by:** `DropService` only. `enter` and `withdraw` (`POST /api/v1/club/drops/:id/enter`, `/withdraw`): the account's row `FOR SHARE` (`readActingAccount`: a LOCKED account is refused), then the release's `FOR SHARE`, refused once `drawn_at` is set; audit `drop.enter`, `drop.withdraw`. `reserve` (`POST /api/v1/club/drops/:id/reserve`, P-X02): the account's row `FOR SHARE`, then the release's **`FOR UPDATE`**, so two reservations count the places held one after the other; inside the early access only, for a tier of at least PLATINE read then (`tierOf`), while SELECTED and CONFIRMED stay under `quantity`; audit `drop.reserve` with `{ entryId, tier, respondBy }`. Plan NEXT LOT §3.6.F (`size_id`): in a draw with sizes, `enter` and `reserve` write the size chosen (a reservation refused once its size is full: the pieces held or sold in it and those of its guaranteed entries waiting), `changeSize` (`POST /api/v1/club/drops/:id/size`, under the same locks, the entry's row `FOR UPDATE`) changes an ENTERED entry's size while entries are open, audited `drop.size`; `withdraw` keeps it. `draw` (§5.29): every ENTERED entry, under the release's `FOR UPDATE`, gets its account's tier and seniority read then (`clubStandings`, `services/club.ts`: open ownerships of pieces neither REVOKED, COUNTERFEIT_FLAGGED nor RETIRED, and the first `started_at`; `ownership` is only read), its rank, and SELECTED with `respond_by` or WAITLISTED, in statements of 500 rows. In a draw with sizes, the draw ranks every ENTERED entry once, then selects in rank order while the entry's size has a piece left (its pieces less those held or sold in it and those of the guaranteed entries just selected in it). `confirm`, `lapse` (after `respond_by` only) and `offerNext` (the first WAITLISTED by rank, while SELECTED and CONFIRMED stay under `quantity`; in a draw with sizes, per size, within its pieces), under the release's row lock, audited `drop.entry.confirm`, `.lapse`, `.offer`. `withdrawAccountEntries`, in the transaction of `OwnerService.lock` (§5.9): the account's ENTERED entries of releases neither drawn nor cancelled become WITHDRAWN (their releases read `FOR SHARE` first, as an entry does), before the transfers are cancelled, each audited `drop.withdraw` with `reason: "account_locked"` after the row locks.
- **The house's guarantee** (IN-01): the draw selects the entries ENTERED with a guarantee first, SELECTED for their pieces without a rank or a tier, their guarantees USED, then ranks the others for the places left (`quantity` less the pieces held or sold and those just selected); a holder's reservation is SELECTED with its guarantee, no tier; a reservation never takes a piece a guarantee set aside for the release covers (DROP_FULL). CONFIRMED creates one order per piece (§5.51).
- **Read by:** the draw's public list (`GET /api/v1/drops/:id/entries`: the ranked entries' `id`, `tier`, `seniority`, `rank`, never the account nor a direct reservation; the release's page lists the guaranteed entries apart once drawn, `guaranteed`: `id` and `pieces`, never an account), the release's page (`reserved`, the count of direct reservations held or sold), the account's status (its own entries), the console (`GET /api/admin/drops/:id/entries`: the account's email, masked for an AUDITOR), and the account's export (`OwnerService.exportData`: every entry, never the note nor who concluded it).
- **Privacy:** an entry is personal data: the account, its standing at the draw (or at its direct reservation), the status of a purchase. What the draw publishes (the id, tier, seniority and rank of each entry) names no account; only the account knows its entry's id. Kept as long as the account (§10), exported with it (API §16.13).

### 5.31 `circle_posts`

The posts of the owners' circle (migration `0016_circle`, P-X01): created by the console (OPERATOR), published for the owners of a piece from a tier up, read on /verify/circle ([API §10.11, §16.20](API.md#1011-the-circle-get-apiv1clubcircle-get-apiv1clubcircleid-post-rsvp-and-post-vote-extension-of-the-contract)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Immutable. |
| `kind` | `text` | NOT NULL | — | `CHECK (kind IN ('NOTE','INVITATION','POLL'))` (`CIRCLE_POST_KINDS`). Immutable: a post never changes kind. |
| `title` | `text` | NOT NULL | — | `CHECK (length(btrim(title)) BETWEEN 1 AND 120)`; one line (the service's rule). |
| `body` | `text` | NULL | — | `CHECK (length(btrim(body)) BETWEEN 1 AND 6000)`. Plain paragraphs, a blank line between two, no Markdown (drawn as a model's story is). |
| `min_tier` | `smallint` | NOT NULL | `1` | `CHECK (min_tier BETWEEN 1 AND 3)`: the lowest tier that reads it, 1 TITANE (every owner), 2 PLATINE, 3 PALLADIUM. |
| `segment_id` | `uuid` | NULL | — | Migration `0023_releases_collectors` (N5). FK → `segments.id` (§5.58), `circle_posts_segment_id_idx`: read by that segment's members only, among its tiers, read again at every request (the same 404 for anyone else); NULL: its tiers. |
| `experience` | `text` | NULL | — | Migration `0026_club_program` (plan NEXT-NINE, BP-19 T7). `CHECK (experience IN ('MEMBERS_EVENING','LAUNCH_PREVIEW','PARTNER_EXPERIENCE'))` (`CIRCLE_EXPERIENCES`), `circle_posts_experience` `CHECK (experience IS NULL OR kind = 'INVITATION')`: what an invitation is, its tier set by THE PROGRAM (§5.64): `CircleService.create` and `update` write `min_tier` from the program's tier for it when the experience is set (another kind refuses one, 422). |
| `event_at` | `timestamptz` | NULL | — | An invitation's event: required for an invitation, set on no other kind (`circle_posts_invitation`: `CHECK ((kind = 'INVITATION') = (event_at IS NOT NULL))`). Answers close when it begins. |
| `event_place` | `text` | NULL | — | `CHECK (length(btrim(event_place)) BETWEEN 1 AND 200)`. |
| `capacity` | `int` | NULL | — | `CHECK (capacity BETWEEN 1 AND 10000)`: the places an invitation's YES may take; NULL: no limit. `circle_posts_invitation_only`: `CHECK (kind = 'INVITATION' OR (event_place IS NULL AND capacity IS NULL))`. |
| `poll_options` | `text[]` | NULL | — | A poll's options: `circle_posts_poll` (`CHECK ((kind = 'POLL') = (poll_options IS NOT NULL))`) and `circle_posts_poll_options` (2 to 6 options, none NULL). Each option one line of at most 40 characters, each different (the service's rule). |
| `drop_id` | `uuid` | NULL | — | FK → `drops.id`: a release the post links (shown to members once published). |
| `model_id` | `uuid` | NULL | — | FK → `models.id`: a model of the lookbook the post links (shown while PUBLIC or RESERVED). |
| `external_url` | `text` | NULL | — | `CHECK (external_url ~ '^https://[^\s]+$' AND length(external_url) <= 500)`. Its host must be one of `CIRCLE_LINK_HOSTS` (`services/circle.ts`: theorbes.com, youtube.com, vimeo.com and their subdomains): a service rule, so a host is added in the code without a migration. |
| `published_at` | `timestamptz` | NULL | — | NULL: not shown in the circle (never published, or withdrawn); set by a publication, cleared by a withdrawal. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`: the console user who created it; NULL when a script did. Immutable. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. Immutable. |

- **Indexes:** primary key; `circle_posts_drop_id_idx (drop_id)`, `circle_posts_model_id_idx (model_id)` and `circle_posts_created_by_idx (created_by)`, which lead with the foreign keys; `circle_posts_published_idx (published_at) WHERE published_at IS NOT NULL`, the feed.
- **Triggers:** `circle_posts_immutable_identity` (BEFORE UPDATE, guards `id`, `kind`, `created_by`, `created_at`), raising `OR001`.
- **Written by:** `CircleService` (`services/circle.ts`) only, each change under the post's row lock (`FOR UPDATE`) with its audit entry: `create` (`POST /api/admin/circle/posts`; `circle.post.create`, the body as its length and SHA-256), `update` (`PATCH`: any field but the kind; a poll's options no longer once a vote exists, an invitation's capacity never under its YES; `circle.post.update`), `publish` and `unpublish` (`circle.post.publish`, `circle.post.unpublish`). A post is never deleted.
- **Read by:** the feed and a post (`GET /api/v1/club/circle`, `/:id`: published, `min_tier` ≤ the reader's tier read at the request; the feed without `body`), the console (`GET /api/admin/circle/posts`, `/:id`).
- **Privacy:** no personal data (the author is a staff id).

### 5.32 `circle_post_images`

The photographs of a circle post (migration `0016_circle`): at most 4, in an order, each with its alternative text ([API §16.20](API.md#1620-the-circle-the-club-pages-posts-extension-of-the-contract)).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `post_id` | `uuid` | NOT NULL | — | PK (with `sha256`). FK → `circle_posts.id`. |
| `sha256` | `text` | NOT NULL | — | PK (with `post_id`). FK → `media_objects.sha256`: the photograph, stored once by MediaService (§5.26). |
| `position` | `smallint` | NOT NULL | — | `CHECK (position BETWEEN 1 AND 4)`; unique per post (`circle_post_images_position_key`, `DEFERRABLE INITIALLY DEFERRED`: a reorder may swap two positions inside its transaction). MediaService keeps them 1 to n. |
| `alt` | `text` | NULL | — | `CHECK (length(btrim(alt)) BETWEEN 1 AND 200)`. NULL: the post's default (*<title>, photographed by ORBES*). |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |

- **Indexes:** primary key `(post_id, sha256)`, which leads with the post; `circle_post_images_position_key (post_id, position)`; `circle_post_images_sha256_idx (sha256)` and `circle_post_images_created_by_idx (created_by)`.
- **Triggers:** `circle_post_images_immutable_identity` (BEFORE UPDATE, guards `post_id`, `sha256`, `created_by`, `created_at`), raising `OR001`.
- **Written by:** `MediaService` only (`addCirclePostPhoto`, `removeCirclePostPhoto`, `arrangeCirclePostPhotos`: `POST`, `DELETE` and `PATCH /api/admin/circle/posts/:id/photos`, OPERATOR), each under the post's row lock (`FOR UPDATE`), audited `circle.post.photo.add`, `.remove`, `.update`. A removed photograph that nothing else uses is deleted from `media_objects` once the change has committed: `deleteIfUnused` counts the models, the galleries, the circle's photographs and the pieces.
- **Read by:** the feed (the first photograph, the card's cover), a post, the console.
- **Privacy:** photographs published for the owners, stripped of their metadata like every other of §5.26; served at `/api/v1/media/<sha256>`, **unlisted, not confidential**.

### 5.33 `circle_rsvps`

The answers to the circle's invitations (migration `0016_circle`): one per account and post, changed in place.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `post_id` | `uuid` | NOT NULL | — | PK (with `account_id`). FK → `circle_posts.id` (an INVITATION: the service's rule). |
| `account_id` | `uuid` | NOT NULL | — | PK (with `post_id`). FK → `accounts.id`. |
| `answer` | `text` | NOT NULL | — | `CHECK (answer IN ('YES','NO'))` (`CIRCLE_RSVP_ANSWERS`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | The first answer. Immutable. |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | The latest change. `CHECK (updated_at >= created_at)`. |

- **Indexes:** primary key `(post_id, account_id)`, which leads with the post; `circle_rsvps_account_idx (account_id, created_at)`, the account's answers.
- **Triggers:** `circle_rsvps_immutable_identity` (BEFORE UPDATE, guards `post_id`, `account_id`, `created_at`), raising `OR001`.
- **Written by:** `CircleService.rsvp` (`POST /api/v1/club/circle/:id/rsvp`): the account's row `FOR SHARE` (a LOCKED account is refused), its tier read then, the post's row **`FOR UPDATE`**, under which the YES of every account are counted, so they never pass `capacity`; refused from `event_at` on. The same answer again writes nothing; another is audited `circle.rsvp` (the account as actor, `{ answer, previous? }`).
- **Read by:** a post (the reader's own answer, the places left), the feed (the reader's answers), the console (`GET /api/admin/circle/posts/:id/answers`, the account's email masked for an AUDITOR; the counts by answer), and the account's export (`circleAnswers`).
- **Privacy:** personal data: an account's answer to an invitation and its times. Kept with the account (no purge, a lock leaves it as it is), exported with it (API §16.13).

### 5.34 `circle_poll_votes`

The votes in the circle's polls (migration `0016_circle`): one per account and poll, final.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `post_id` | `uuid` | NOT NULL | — | PK (with `account_id`). FK → `circle_posts.id` (a POLL: the service's rule). |
| `account_id` | `uuid` | NOT NULL | — | PK (with `post_id`). FK → `accounts.id`. |
| `option_index` | `smallint` | NOT NULL | — | `CHECK (option_index BETWEEN 0 AND 5)`: the index of the option voted (an option of this poll: the service's rule). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | When. |

- **Indexes:** primary key `(post_id, account_id)`; `circle_poll_votes_account_idx (account_id, created_at)`.
- **Triggers:** `circle_poll_votes_final` (BEFORE UPDATE, `orbes_reject_mutation('a vote is final')`), raising `OR001`: a vote never changes.
- **Written by:** `CircleService.vote` (`POST /api/v1/club/circle/:id/vote`), under the post's row `FOR SHARE`, so a change of its options (`FOR UPDATE`) waits, then is refused (`409 CIRCLE_POLL_VOTED`). **Never audited**: the audit log is permanent, and a vote is an opinion.
- **Read by:** a post (the reader's vote, then the results by option, only once the reader voted), the console (the results), the account's export (`circleVotes`, with the option's words).
- **Privacy:** personal data: an account's opinion in a poll. Shown to members only as totals, after their own vote; never in the audit log. Kept with the account (no purge), exported with it.

### 5.35 `circle_daily_visits`

The visits of the circle per UTC day (migration `0016_circle`): a count, and nothing else.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `day` | `date` | NOT NULL | — | PK: the UTC day. |
| `visits` | `int` | NOT NULL | `0` | `CHECK (visits >= 0)`. |

- **Written by:** `CircleService.feed`: the first page of the feed adds one to the day's row (`INSERT … ON CONFLICT (day) DO UPDATE SET visits = visits + 1`), best effort (a failure is logged, the feed still answers).
- **Read by:** the console's Analytics panel *The Circle* (`GET /api/admin/analytics/circle`).
- **Privacy:** no account, no address, no device: a count per day, which names nobody. Kept per day (no purge).

### 5.36 `club_tiers`

The words of the club's tiers' benefits, as the console changed them (migration `0018_club_tiers`, P-X04; [API §10.10, §16.21](API.md#1621-the-tiers-the-club-pages-benefits-extension-of-the-contract)). **No row is inserted**: the words by default are constants of the code, in English (`services/club.ts` `CLUB_TIER_DEFAULT_BENEFITS`); the table keeps only what the console changed, and a tier restored to its default loses its row. The thresholds (1, 5 and 10 pieces) are a constant of the code, never here.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `tier` | `text` | NOT NULL | — | PK. `CHECK (tier IN ('TITANE','PLATINE','PALLADIUM'))` (`CLUB_TIER_NAMES`). Immutable. |
| `benefits` | `text` | NOT NULL | — | `CHECK (length(btrim(benefits)) BETWEEN 1 AND 600)`: what the tier adds to the ones below it, one benefit per line, at most 8 lines (the service's rule, `CLUB_TIER_BENEFIT_LINES`). |
| `updated_by` | `uuid` | NULL | — | FK → `admin_users.id` (ON DELETE RESTRICT): the console user who wrote them; NULL when a script did. |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | When. |

- **Indexes:** primary key; `club_tiers_updated_by_idx (updated_by)`, which leads with the foreign key.
- **Triggers:** `club_tiers_immutable_tier` (BEFORE UPDATE, guards `tier`), raising `OR001`.
- **Written by:** `ClubService.updateTier` (`PATCH /api/admin/club/tiers/:tier`, OPERATOR), under the row's lock, audited `club.tier.update` with `{ tier, benefits, previous }` (`benefits` NULL: the default restored, the row deleted).
- **Read by:** the club's status (`GET /api/v1/club/status`: `benefits`, `next.benefits`), the console (`GET /api/admin/club/tiers`).
- **Privacy:** staff-written text and a staff id; nothing personal. The tier a customer reads is computed from `ownership`, read only.

### 5.37 `shop_requests`

The requests of THE PRIVATE SALON (migration `0020_private_salon`, P-X08; [API §10.9, §16.22](API.md#1622-the-private-salon-the-club-pages-requests-extension-of-the-contract)): an owner's request for a RESERVED model of the lookbook (REQUEST THIS PIECE), OPEN until the console closes it with a note, or until the account is locked. ORBES Client Services concludes the sale outside the service: no payment and no email go through this table.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` (ON DELETE RESTRICT): who requested. |
| `model_id` | `uuid` | NOT NULL | — | FK → `models.id` (ON DELETE RESTRICT): the model requested. |
| `note` | `text` | NULL | — | `CHECK (length(btrim(note)) BETWEEN 1 AND 500)`: the account's own words for ORBES Client Services (a size, a finish, the best time to call); NULL without one. Personal data. |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK (status IN ('OPEN','CLOSED'))` (`SHOP_REQUEST_STATUSES`, mirrored in `db/schema.ts` and `web/admin/types.ts`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | When it was requested (the service's clock). |
| `handled_by` | `uuid` | NULL | — | FK → `admin_users.id` (ON DELETE RESTRICT): the console user who closed it (the lock's ADMIN for a closing by a lock); NULL while open, or closed by a script. |
| `handled_at` | `timestamptz` | NULL | — | When it was closed. |
| `resolution_note` | `text` | NULL | — | `CHECK (length(btrim(resolution_note)) BETWEEN 1 AND 2000)`: what was done for the client, written by the console when it closes the request; NULL while open, and for a closing by a lock. |
| `size_label` | `text` | NULL | — | Migration `0030_account_sizes` (plan NEXT-NINE, AC-01). `shop_requests_size_label_check`: `CHECK (length(size_label) BETWEEN 1 AND 100 AND size_label = btrim(size_label))`: the size asked with REQUEST THIS PIECE, one of the model's (its SKU's label, `SalonService.request`); NULL for NOT SURE YET or a model of one size. Never changes. ACCEPTED's order takes it with its SKU. |
| `outcome` | `text` | NULL | — | Migration `0022_orders_stock`. `CHECK (outcome IN ('ACCEPTED','DECLINED'))` (`SHOP_REQUEST_OUTCOMES`), set when the request is closed (`shop_requests_outcome_closed`); NULL for one closed before 0022. ACCEPTED creates the request's order (§5.51) in the same transaction; a lock closes as DECLINED. |

The statuses hold their facts: `shop_requests_closed` (`CHECK ((status = 'CLOSED') = (handled_at IS NOT NULL))`), `shop_requests_handled` (`CHECK (handled_by IS NULL OR handled_at IS NOT NULL)`), `shop_requests_resolution` (`CHECK (resolution_note IS NULL OR status = 'CLOSED')`), `shop_requests_handled_after` (`CHECK (handled_at IS NULL OR handled_at >= created_at)`).

- **Indexes:** primary key; `shop_requests_account_idx (account_id, created_at)`, the account's requests (its export), which leads with the foreign key; `shop_requests_model_idx (model_id)`; `shop_requests_handled_by_idx (handled_by)`; `shop_requests_queue_idx (status, created_at)`, the console's Requests tab (open first, the newest first); **`shop_requests_one_open`**, unique `(account_id, model_id) WHERE status = 'OPEN'`: one OPEN request per account and model (a second is `409 SHOP_REQUEST_OPEN`), a closed one may be followed by another.
- **Triggers:** `shop_requests_immutable_identity` (BEFORE UPDATE, `orbes_guard_immutable_columns('id', 'account_id', 'model_id', 'created_at', 'note', 'size_label')`, created again by migration `0030_account_sizes` with `size_label`; its down restores 0020's), raising `OR001`: a request's id, account, model, creation, note and size never change.
- **Written by:** `SalonService` (`services/salon.ts`) only. `request` (`POST /api/v1/club/lookbook/:slug/request`): the model read through the lookbook from the account's tier (`LookbookService.sheetOf`), then in one transaction the account's row `FOR SHARE` (a LOCKED account is refused, and a lock under way finishes first), the insert and the audit entry `shop.request` (`{ modelId }`, the account as actor). `close` (`POST /api/admin/club/requests/:id/close`, OPERATOR): the request's row `FOR UPDATE`, then `CLOSED`, `handled_by`, `handled_at` (never before its creation), `resolution_note` and its `outcome` (the order of an ACCEPTED one created in the same transaction), audited `shop.request.close` (`{ modelId, outcome }`, and the order's id). `closeAccountShopRequests`, in the transaction of `OwnerService.lock` (§5.9): every OPEN request of the account `CLOSED`, handled by the lock's ADMIN, without a note, before the pending transfers are cancelled; audited `shop.request.close` with `reason: "account_locked"` after them (§8.2). No delete path exists.
- **Read by:** the club's sheet (`salon.request`, the account's OPEN request), the console (`GET /api/admin/club/requests`, the account's email masked for an AUDITOR), and the right-of-access export (`OwnerService.exportData`, `shopRequests`: every request of the account with its note and the console's closing note, never who closed it; API §16.13).
- **Retention:** kept with the account, like the entries of the releases (§5.30): a closed request stays, with its notes, as long as the account exists (§10).
- **Privacy:** `note` is the account's own words and `resolution_note` the console's about the client: personal data, exported under the right of access, never copied into the audit log. The account's email is never stored here (it is read from `accounts`).

---

### 5.38 `drop_sizes`

The sizes of a LIVE RELEASE (migration `0021_live_release`; §5.29's `mode` LIVE), each with its stock: a one-size release has one row. The release's `quantity` is the sum of its sizes' stock, kept by the services. Since migration `0038_draw_sizes` (plan NEXT LOT §3.6.F) a draw's sizes too: each `stock` is the pieces of that size (a size at 0 is left out), 1 to 24 of them, `quantity` their sum; an entry names its size (§5.30 `size_id`). A draw published before keeps none (one pool).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. `drop_sizes_drop_size_key`: unique `(drop_id, id)`, the target of the composite foreign keys of §5.39 and §5.43, so an entry and an interest name a size of their own release. |
| `drop_id` | `uuid` | NOT NULL | — | FK → `drops.id`. 1 to 24 sizes per release (`position`, and the service's rule). |
| `label` | `text` | NOT NULL | — | `CHECK (length(label) BETWEEN 1 AND 12 AND label = btrim(label))`; `drop_sizes_label_key`: unique `(drop_id, label)`. |
| `position` | `smallint` | NOT NULL | — | `CHECK (position BETWEEN 1 AND 24)`; `drop_sizes_position_key`: unique `(drop_id, position)`. The order shown. |
| `stock` | `int` | NOT NULL | — | `CHECK (stock BETWEEN 0 AND 10000)`. Set with the other settings until the announcement; afterwards it only rises, by ADD PIECES (`drop.live.stock`). |
| `sku_id` | `uuid` | NULL | — | Migration `0022_orders_stock`. FK → `skus.id` (§5.47), `drop_sizes_sku_id_idx`: the model and size sold, linked when the size is written (and at boot for those written before). The release's quantity on sale stays this table's `stock`: the stock ledger is the house's. |

- **Indexes:** primary key; the three unique keys, which lead with the release.
- **Triggers:** `drop_sizes_immutable_identity` (BEFORE UPDATE, guards `id` and `drop_id`), raising `OR001`.
- **Written by:** `LiveConsoleService` (`create`, `update`: a list given replaces the release's, a row with the id of an existing size kept) under the release's `FOR UPDATE`; `LiveService.addPieces` (the size's row `FOR UPDATE`, after the release's). A draw's: `DropService.create` and `update` while a DRAFT (a list given replaces the draft's: no entry names a size before publication), under the release's `FOR UPDATE`, each linked to its SKU (`linkDropSizes`).
- **Read by:** the public page (`sizes`, API §8.10), the room's snapshot (per size: stock, left, held), the console, the engine (the pieces free per size: its stock less the quantities of its entries in `TURN`, `SECURED` and `CONFIRMED`).
- **Privacy:** no personal data.

### 5.39 `live_entries`

The entries of ORBES accounts in the LIVE RELEASES (migration `0021_live_release`, [API §10.12](API.md#1012-the-live-releases-the-accounts-room-line-turn-and-reservation-extension-of-the-contract)): one per account and release, through the room, the line, a turn, a piece held, its reservation and its outcome.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. The entry's id; its reference `LR-` and its first 8 hexadecimal characters. |
| `drop_id` | `uuid` | NOT NULL | — | FK → `drops.id`. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`. `live_entries_drop_account_key`: unique `(drop_id, account_id)`: one entry per account and release (an entry that left the room before T0 enters again on the same row). |
| `size_id` | `uuid` | NOT NULL | — | `live_entries_size_fkey`: FK `(drop_id, size_id)` → `drop_sizes (drop_id, id)`: a size of its own release. Changes until T0 only (a service rule). |
| `quantity` | `smallint` | NOT NULL | — | `CHECK (quantity BETWEEN 1 AND 5)`; at most the release's `per_account` (a service rule). |
| `status` | `text` | NOT NULL | `'WAITING'` | `CHECK (status IN ('WAITING','QUEUED','TURN','SECURED','CONFIRMED','MISSED','EXPIRED','RELEASED','LEFT','REMOVED','ENDED'))` (`LIVE_ENTRY_STATUSES`). |
| `tier` | `smallint` | NOT NULL | — | `CHECK (tier BETWEEN 0 AND 3)`: the club's tier at entry, read again at T0 for the line. |
| `position` | `int` | NULL | — | `CHECK (position >= 1)`; `live_entries_drop_position_key`: unique `(drop_id, position)`. The place in the line: at T0 by tier then `sha256(seed ‖ id)`, later arrivals behind. |
| `joined_at`, `queued_at` | `timestamptz` | NOT NULL, NULL | `now()`, — | `live_entries_line`: `CHECK ((position IS NULL) = (queued_at IS NULL) AND (queued_at IS NULL OR queued_at >= joined_at))`. |
| `turn_at`, `turn_expires_at` | `timestamptz` | NULL | — | The turn and its deadline (the entry's tier's turn window), moved by a pause. |
| `turn_token_hash` | `bytea` | NULL | — | `CHECK (octet_length(turn_token_hash) = 32)`: the SHA-256 of the turn's secret (HMAC-SHA-256 of the entry and the turn's start under a key derived from `KEY_ENCRYPTION_KEY`, or `COOKIE_SECRET` without one); the secret itself is never stored. `live_entries_turn_fields`: the three turn columns set together, after `queued_at`, the deadline after the start. |
| `press_started_at` | `timestamptz` | NULL | — | The seal pressed, on the server's clock. `live_entries_press_after_turn`. |
| `gesture_ms` | `int` | NULL | — | `CHECK (gesture_ms >= 1400)`: the hold, from the press to the secure (`LIVE_GESTURE_MIN_MS`), kept for the console's bot radar. |
| `secured_at`, `hold_expires_at` | `timestamptz` | NULL | — | The piece held and its deadline (the pay window). `live_entries_secured_fields`: set with `gesture_ms`, after the press. |
| `confirmed_at` | `timestamptz` | NULL | — | PAY. `live_entries_confirmed_after`. |
| `ended_at` | `timestamptz` | NULL | — | Set by `MISSED`, `EXPIRED`, `RELEASED`, `LEFT`, `REMOVED` and `ENDED`; `live_entries_ended_after_join`. |
| `let_in_by` | `uuid` | NULL | — | FK → `admin_users.id`: the console user who let it take its turn out of order. `live_entries_let_in_turn`: only with a turn. |
| `removed_by`, `removed_at` | `uuid`, `timestamptz` | NULL | — | FK → `admin_users.id`, and when (equal to `ended_at`; `live_entries_removed_fields`). A lock's removal names its ADMIN. |
| `handled_by`, `handled_at` | `uuid`, `timestamptz` | NULL | — | FK → `admin_users.id`: who concluded or cancelled the reservation, and when. |
| `resolution` | `text` | NULL | — | `CHECK (resolution IN ('CONCLUDED','CANCELLED'))`: ORBES Client Services' outcome, of a `CONFIRMED` entry only. |
| `resolution_note` | `text` | NULL | — | `CHECK (length(btrim(resolution_note)) BETWEEN 1 AND 500)`; never in the audit log. `live_entries_handled_fields` holds the four together. |
| `network_hash` | `bytea` | NULL | — | `CHECK (octet_length(network_hash) = 32)`: HMAC-SHA-256, keyed with `IP_HASH_PEPPER`, of the entry's network (its /24 in IPv4, /48 in IPv6), never the address; for the bot radar (many entries from one network). **Erased** 30 days after the release's end or cancellation (§10). |
| `country` | `text` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`: the country of the entry's request (the location of API §4), nothing finer. |
| `guarantee_id` | `uuid` | NULL | — | Migration `0029_house_guarantee` (plan NEXT-NINE, IN-01). FK → `house_guarantees.id` (§5.69); `live_entries_guarantee_key`, unique. The holder's entry: let in whatever the release's rule, up to max(`per_account`, its pieces), first in line at T0 and first among those waiting in its size afterwards (the turns, the places ahead, the console's list and the after-room's guests order by `guarantee_id IS NULL`, then `position`); its turn uses the guarantee (USED). Cleared by LEAVE, REMOVE and a lock before the turn, and at the release's end or cancellation when unused. |

The statuses hold their facts, one CHECK each: `live_entries_status_waiting` (no place, not ended), `_queued` (a place, no turn), `_turn` (a turn, not secured), `_secured` (secured, not confirmed), `_confirmed` (`status = 'CONFIRMED'` exactly when `confirmed_at` is set, never ended), `_missed` (a turn, never secured, ended), `_returned` (`EXPIRED` and `RELEASED`: secured, ended), `_left` (`LEFT` and `ENDED`: never secured, ended), `_removed` (`status = 'REMOVED'` exactly when `removed_at` is set).

- **Indexes:** primary key; the two unique keys; `live_entries_line_idx (drop_id, status, position)`, the line and its head; `live_entries_size_status_idx (drop_id, size_id, status)`, the pieces held per size and the composite foreign key; `live_entries_account_idx (account_id, joined_at)`, MY PIECES; `live_entries_let_in_by_idx`, `live_entries_removed_by_idx`, `live_entries_handled_by_idx`.
- **Triggers:** `live_entries_immutable_identity` (BEFORE UPDATE, guards `id`, `drop_id`, `account_id`), raising `OR001`.
- **Written by:** `LiveService` only (`services/live.ts`): the customer's actions (§8.2: the account's row `FOR SHARE`, the release's, then the entry's), the console's controls, and the engine's pass (`advance`: the line at T0, `MISSED` and `EXPIRED` at their logical deadlines, the end, the turns); `removeAccountLiveEntries` in the transaction of `OwnerService.lock`; `LiveConsoleService.resolve` (the outcome); housekeeping (`eraseLiveNetworkHashes`).
- **Read by:** the account's own state, stream and MY PIECES (its entry only, the turn's secret while it is its turn), the room's snapshot (counts only), the console (the line with the account's email, masked for an AUDITOR; the reservations; the intelligence), the account's export (every entry, never `network_hash`, nor who let it in, removed it or concluded it).
- **Privacy:** personal data: the account, its steps and their times, the length of its hold, its country, its network's keyed hash (30 days), the reservation and its note. Kept as long as the account (§10), but the network's hash; exported with it (API §16.13).

### 5.40 `live_access_models`

The models whose owners may enter a LIVE RELEASE (choice 35), with `drops.access_collection_id` for a collection. Primary key `(drop_id, model_id)`; FK `drop_id` → `drops.id`, `model_id` → `models.id`; `live_access_models_model_idx (model_id)`. Written by `LiveConsoleService` (until the announcement); read by `accessOf` (a piece of one of them held now) and the rule in words. No personal data.

### 5.41 `live_addons`

The add-ons a LIVE RELEASE offers with a piece held (choice 34: engraving, a gift box, ORBES Care…): `id` (PK), `drop_id` (FK → `drops.id`), `label` (`CHECK (length(btrim(label)) BETWEEN 1 AND 40)`), `line` (NULL, 1–120 characters), `price_minor` (`CHECK (price_minor >= 0)`, per piece, in the release's currency), `position` (1–6, `live_addons_position_key` unique `(drop_id, position)`, which leads with the release). `live_addons_immutable_identity` guards `id` and `drop_id`. Written by `LiveConsoleService` (until the announcement). No personal data.

### 5.42 `live_entry_addons`

The add-ons an entry chose for its piece held: primary key `(entry_id, addon_id)`; FK `entry_id` → `live_entries.id`, `addon_id` → `live_addons.id` (`live_entry_addons_addon_idx`); `price_minor` (`CHECK (price_minor >= 0)`), **the add-on's price when it was chosen**, so a reservation's total never moves. Replaced as a whole by `setAddons`; deleted with a piece given back, a hold that ends or is freed, and a removal. Personal data with its entry; exported with it.

### 5.43 `live_interest`

I'LL BE THERE (choice 30): one row per account and release, primary key `(drop_id, account_id)`; `size_id` with `live_interest_size_fkey`, FK `(drop_id, size_id)` → `drop_sizes (drop_id, id)`; `created_at`. Indexes `live_interest_account_idx (account_id)` and `live_interest_size_idx (drop_id, size_id)` (the planner and the radar). Written by `LiveService.setInterest` (its size changed in place) and `withdrawInterest` (**deleted**), from the announcement to T0, and by a lock (withdrawn from the releases not opened yet). Read as a public count (API §8.10, never who), by the account itself, and by the console's intelligence. Personal data; exported with the account.

### 5.44 `live_messages`

The host's lines into the room (choice 31): `id` (PK), `drop_id` (FK → `drops.id`), `text` (`CHECK (length(btrim(text)) BETWEEN 1 AND 140)`, one line), `created_by` (FK → `admin_users.id`, `live_messages_created_by_idx`), `created_at`; `live_messages_drop_idx (drop_id, created_at)`, the latest first. `live_messages_immutable` rejects any update (`orbes_reject_mutation`): a line said is never changed. Staff text, no personal data; the latest is in the room's snapshot.

### 5.45 `live_tier_windows`

Optional per-tier turn and pay windows (choice 3: e.g. PALLADIUM, 10 minutes to pay): primary key `(drop_id, tier)`, `tier` 0–3, `turn_seconds` (NULL, 10–300), `pay_minutes` (NULL, 1–60), `live_tier_windows_some`: at least one of the two. An entry's turn and hold take its tier's window where one is set, the release's otherwise (`windowsFor`). No personal data.

---

The tables below come with LIVE RELEASE+ (plan of 2026-10-04): migration `0022_orders_stock` (§5.46 to §5.57: the stock, the orders of every sales channel, the atelier, the invoices and the event journal) and migration `0023_releases_collectors` (§5.58 to §5.61: the segments, the after-room's guests, the answers to the question after, the activity by hour). Every foreign key is `ON DELETE RESTRICT` and leads an index.

### 5.46 `stock_locations`

Where pieces are kept ([API §16.24](API.md#1624-orders-logistics-locations-and-carriers-extension-of-the-contract)): `id` (PK), `name` (`CHECK (length(name) BETWEEN 1 AND 60 AND name = btrim(name))`; `stock_locations_name_key`, unique `lower(name)`), `is_default` (NOT NULL, `false`; `stock_locations_one_default`, unique `(is_default) WHERE is_default`: at most one), `shopify_location_id` (NULL, a positive decimal, unique: the Shopify location it will be), `created_at`. `stock_locations_immutable_identity` guards `id` and `created_at`. `address` (migration `0035_logistics_access`, plan NEXT LOT §3.5; `text`, NULL): the location's postal address, `stock_locations_address_check` (`CHECK (char_length(address) BETWEEN 1 AND 500 AND address = btrim(address))`: trimmed, line breaks kept), printed as « Deliver to » on a supplier order's PDF and given as the return address; NULL: none yet.

- **Written by:** `ensureStockSetup` (`services/stock.ts`, at every start through `OrderService.prepare`): FRANCE WAREHOUSE (the default) and LOGISTICS WAREHOUSE, inserted only while the table is empty (`ON CONFLICT DO NOTHING`), audited `stock.setup` once; `StockService` (the console's Settings, ADMIN): a location added (`stock.location.create`), renamed or made the default, the previous default cleared in the same transaction (`stock.location.update`).
- **Read by:** Logistics (the Atelier until plan NEXT LOT step 5.13), the Orders board and an order's page, a release's stock location, the feasibility check and the size mix. No personal data.

### 5.47 `skus`

A model in one size: `id` (PK), `model_id` (FK → `models.id`), `size_label` (NULL for a model in one size, else 1–100 characters, trimmed: the label of a release's size or of a piece's `variant`), `code` (`CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._/ -]{0,63}$')`, unique: the model's SKU prefix and the size, `deriveSku`), `shopify_product_id` and `shopify_variant_id` (NULL, positive decimals; the variant unique), `created_at`. `skus_model_size_key`: a unique index on `(model_id, upper(size_label))` `NULLS NOT DISTINCT`, one row per model and size whatever the case the size is written in (`Small` and `SMALL` are one SKU); `skus_model_sku_key`, unique `(model_id, id)`, the target of the composite foreign keys `products_sku_fkey` and `orders_sku_fkey` (a piece's or an order's SKU is one of its own model). **No stock column**: the stock is the ledger's (§5.48). `skus_immutable_identity` guards `id`, `model_id`, `size_label` and `created_at`. `fit_min_mm` and `fit_max_mm` (migration `0030_account_sizes`, plan NEXT-NINE AC-01; `smallint`, NULL): the measures the size fits, in whole millimetres of its model's size kind (a French ring size, or centimetres × 10), both or neither, from 1 to 1 000, the first at most the second (`skus_fit`); NULL: the size's label itself is read as the measure (`services/sizes.ts` `labelToMm`). Set from the console's Sizes section (`PUT /api/admin/models/:id/sizes`, audited `model.sizes.update`); read to match a saved size (§5.71). `set_aside_at` (`timestamptz`, NULL) and `set_aside_by` (`uuid`, NULL, FK → `admin_users.id`, led by `skus_set_aside_by_idx`), migration `0033_model_sizes` (plan NEXT LOT, §3.3): since 0033 a model's sizes are **declared** in the Catalogue, each **offered** (`set_aside_at` NULL) or **set aside** (no longer offered for new releases, supplier orders or the private salon; its stock, pieces, orders and history keep it, and it can be reinstated); `set_aside_by` the admin who set it aside, NULL for a script, never without its time (`skus_set_aside`: `CHECK (set_aside_by IS NULL OR set_aside_at IS NOT NULL)`). A declared size is **removed** (its row deleted) only when nothing uses it (`services/sizes.ts` `SKU_USES`: a stock movement, an order, a piece, a release's size, a minimum, a bench item, from migration `0036` a supplier-order line, a reception line, a return to a supplier or a stock correction, an OPEN salon request of the model in that size, a Shopify id), otherwise set aside; the RESTRICT foreign keys stay the backstop. `skus_model_offered_idx (model_id) WHERE set_aside_at IS NULL` serves a model's offered sizes. `skus_immutable_identity` is unchanged. `supplier_id` (`uuid`, NULL, FK → `suppliers.id`, led by `skus_supplier_id_idx`), migration `0035_logistics_access`: the size's own supplier, over its model's (§5.3 `supplier_id`); NULL: its model's. Set with the model's (`SupplierService.setModelSupplier`, audited `model.supplier`).

- **Written by:** `SizeService.declare`, `removeSize` and `reinstateSize` (`services/sizes.ts`, the Catalogue's Sizes, OPERATOR, audited `model.sizes.declare`: the model's row `FOR NO KEY UPDATE`, then each SKU it removes or sets aside `FOR UPDATE` in id order), and `ensureSku` (`services/stock.ts`): by issuance (a piece's SKU), the console's sizes of a LIVE RELEASE (`drop_sizes.sku_id`), PAY (an order's), at boot (`linkSkus`: the pieces and sizes written before 0022, or by the previous image), and the Shopify ids pasted back (`ShopifyService`, `PUT /api/admin/models/:id/shopify`, OPERATOR, under the advisory lock `SHOPIFY_PRODUCT`; audited `model.shopify`, the ids before and after; `409 SHOPIFY_PRODUCT_TAKEN`, `SHOPIFY_VARIANT_TAKEN`).
- **Read by:** Logistics (stock per SKU and location; the Atelier until plan NEXT LOT step 5.13), the orders, the Catalogue's Shopify column and the product export (N2). No personal data.

### 5.48 `stock_movements`

The ledger of the stock, **append-only**: `id` (`bigint` identity, PK), `sku_id` (FK → `skus.id`), `location_id` (FK → `stock_locations.id`), `delta` (`CHECK (delta <> 0 AND delta BETWEEN -10000 AND 10000)`), `reason` (`CHECK (reason IN ('PRODUCED','ADJUSTED','TRANSFER_OUT','TRANSFER_IN','SHIPPED','RETURNED'))`, `STOCK_MOVEMENT_REASONS`; `RECEIVED` added by migration `0036`), `order_id` (NULL, FK → `orders.id`), `product_id` (NULL, FK → `products.id`), `transfer_id` (NULL), `note` (NULL, 1–500 characters), `actor_type` and `actor_id` (as in §5.5), `created_at`.

- **Its rules, in CHECKs:** `stock_movements_sign` (PRODUCED, TRANSFER_IN and RETURNED add, TRANSFER_OUT and SHIPPED take away, ADJUSTED either way); `_transfer` (a transfer's two halves, and only they, carry a `transfer_id`; `stock_movements_transfer_key`, unique `(transfer_id, reason)`, at most one of each); `_piece` (a movement that names a piece moves one); `_order` (SHIPPED −1 and RETURNED +1 with their order, PRODUCED +1 with its piece, RECEIVED with neither order nor piece but its reception line, nothing else names an order). Migration `0036_supplier_orders` (plan NEXT LOT §3.5): `reception_line_id` (NULL, FK → `reception_lines.id`, led by `stock_movements_reception_line_idx`), present exactly for RECEIVED (`stock_movements_received`), a reception line's pieces entering the stock, positive (`stock_movements_sign`).
- **Balances:** per (SKU, location), on hand is the sum of the deltas (`stock_movements_balance_idx (sku_id, location_id)`); reserved, the orders holding one of them (`orders.reservation` STOCK, `orders_stock_reservation_idx`); available, on hand less reserved, never below 0 (`stockLevel`). An adjustment or a transfer never takes a reserved piece (`409 STOCK_NOT_AVAILABLE`).
- **Indexes:** primary key; the balance index; `stock_movements_location_idx`, `_order_idx`, `_product_idx`; the transfer key.
- **Triggers:** `stock_movements_append_only` (BEFORE UPDATE OR DELETE, `OR001`).
- **Written by:** `recordMovement` (`services/stock.ts`) only, each change under the SKU's row lock (`lockSku`, §8.2), journaled `stock.move`: a piece finished by the atelier (PRODUCED, until plan NEXT LOT step 5.13; the rows written stay), a reception's pieces issued (RECEIVED, §5.80), a count corrected (ADJUSTED, with its note, `stock.adjust`, OPERATOR), a transfer (`stock.transfer`, OPERATOR), an order shipped (SHIPPED) or returned to stock (RETURNED).
- **Privacy:** no personal data (staff ids and notes about pieces).

### 5.49 `sku_thresholds`

The minimum of a SKU at a location (L2): primary key `(sku_id, location_id)`, `minimum` (`CHECK (minimum BETWEEN 1 AND 10000)`), `updated_by` (NULL, FK → `admin_users.id`), `updated_at`; `sku_thresholds_location_idx`, `sku_thresholds_updated_by_idx`. Written by `LogisticsService.setMinimum` (`PUT /api/admin/logistics/minimums`, OPERATOR; a minimum cleared deletes the row; the atelier's `PUT /api/admin/atelier/thresholds` is removed, plan NEXT LOT step 5.13), audited `stock.threshold`. Below it, the supplier orders' proposal counts what lacks (`underMinimum`, §5.78); no piece is made any more. No personal data.

### 5.50 `carriers`

The carriers an order ships with: `id` (PK), `name` (1–60 characters, trimmed; `carriers_name_key`, unique `lower(name)`), `tracking_url` (`CHECK (length(tracking_url) <= 500 AND tracking_url ~ '^https://[^[:space:]]+$' AND strpos(tracking_url, '{tracking}') > 0)`: https, the number in place of `{tracking}`), `active` (NOT NULL, `true`: false is set aside, never offered again, the orders shipped with it keeping it), `created_at`. `carriers_immutable_identity` guards `id` and `created_at`. Written by `ensureStockSetup` (Colissimo, Chronopost, DHL Express and UPS while the table is empty, `stock.setup`) and `StockService` (Settings, ADMIN: `carrier.create`, `carrier.update`). No personal data.

### 5.51 `orders`

One order per piece sold, by every sales channel ([API §10.13, §10.14, §16.24, §16.25](API.md#1013-get-apiv1accountorders-extension-of-the-contract)): created in the transaction that commits the sale, followed step by step by ORBES Client Services in the console and by its buyer in MY PIECES.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Its reference `OR-` and its first 8 hexadecimal characters. |
| `channel` | `text` | NOT NULL | — | `CHECK (channel IN ('LIVE','DRAW','SALON','GIFT'))` (`ORDER_CHANNELS`; GIFT, a welcome gift, since migration `0027_tier_grants`). |
| `live_entry_id`, `piece` | `uuid`, `smallint` | NULL, NOT NULL | —, `1` | FK → `live_entries.id`; `piece` 1–5, which piece of the entry's quantity; `orders_live_entry_key`, unique `(live_entry_id, piece)`. |
| `drop_entry_id` | `uuid` | NULL | — | FK → `drop_entries.id`: an entry of a draw confirmed by Client Services; `orders_drop_entry_key`, unique `(drop_entry_id, piece)` since migration `0029_house_guarantee`: one order per piece of the entry (several for a place guaranteed by the house for several pieces, the first carrying the shipping and any welcome gift, the others travelling with it). |
| `shop_request_id` | `uuid` | NULL | — | FK → `shop_requests.id`, unique: a request of the private salon closed ACCEPTED. |
| `drop_id` | `uuid` | NULL | — | FK → `drops.id`: the release of a LIVE or DRAW order (an after-room's for its guests). |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`: who bought it. |
| `model_id`, `size_label`, `sku_id` | `uuid`, `text`, `uuid` | NOT NULL, NULL, NULL | — | The model; the size (1–100 characters; NULL while a draw's or a salon's size is not entered); its SKU, `orders_sku_fkey` → `skus (model_id, id)`. |
| `price_minor`, `currency` | `int`, `text` | NULL | — | 0 to 100 000 000; `^[A-Z]{3}$`; `orders_price`: both or neither (a LIVE order's are the release's; a draw's are the draw's when it has a price, plan NOCTURNE, addition 5, else entered by Client Services like a salon's). |
| `addons` | `jsonb` | NOT NULL | `'[]'` | The add-ons as sold, a JSON array of at most 6 (`{ label, priceMinor }`). |
| `surprise` | `text` | NULL | — | 1–500 characters: the release's surprise when it has one (an after-room's: its parent's), a snapshot. |
| `engraving_text` | `text` | NULL | — | 1–120 characters, entered by Client Services; since migration `0039` also typed by the collector in YOUR ORDERS until packing starts (at most 20 characters there). |
| `engraving_minor`, `engraving_by` | `int`, `text` | NULL | — | Migration `0039_order_delivery` (plan NEXT LOT §3.6.C). The price the engraving was taken at, 0 to 100 000 000 in the order's currency (Orders → Settings, Engraving, §5.89, read then and kept), only with its words and the order's currency (`orders_engraving_price`); NULL for one bought as the release's ENGRAVING add-on (its price is the add-on's) and for one entered before 0039. `CHECK (engraving_by IN ('COLLECTOR','STAFF'))` (`ADDRESS_SOURCES`): who typed the words, present exactly with them (`orders_engraving_by`; an engraving of before reads STAFF). |
| `buyer_name`, `buyer_address` | `text` | NULL | — | 1–200 and 1–1000 characters: the delivery name and address, entered by Client Services (decision 31) and since migration `0039` by the collector in YOUR ORDERS. **Personal data, never in the audit log, the order's events nor the journal** (they say a buyer was entered, never who). |
| `buyer_country`, `buyer_phone` | `text` | NULL | — | Migration `0039_order_delivery` (plan NEXT LOT §3.6.B): the delivery address's country (`^[A-Z]{2}$`, ISO 3166-1 alpha-2, `src/shared/countries.ts`) and phone with its country code (`^\+[0-9][0-9 ().-]{5,24}$`). Personal data, as the name and address. |
| `address_by`, `address_at`, `address_changed_at` | `text`, `timestamptz`, `timestamptz` | NULL | — | Migration `0039`. `CHECK (address_by IN ('COLLECTOR','STAFF'))` (`ADDRESS_SOURCES`): who entered the delivery address and when, both or neither (`orders_address_by`); when it was replaced after it was first entered, never before (`orders_address_changed`): the agent's ADDRESS CHANGED until the parcel ships. An order travelling with another (`with_order_id`) never carries its own country, phone nor author (`orders_address_travels`): it is delivered with that order, to its address; its name and address entered before 0039 stay as they are. The migration set `address_by` STAFF at the order's latest `order.buyer` event (its reservation when none) on every order with an address that does not travel. |
| `status` | `text` | NOT NULL | `'RESERVED'` | `CHECK (status IN ('RESERVED','PAID','SHIPPED','DELIVERED','CANCELLED','RETURNED'))` (`ORDER_STATUSES`). |
| `reserved_at`, `paid_at`, `shipped_at`, `delivered_at`, `cancelled_at`, `returned_at` | `timestamptz` | NOT NULL, NULL… | `now()`, — | The time it reached each step. |
| `location_id` | `uuid` | NOT NULL | — | FK → `stock_locations.id`: where its piece is held or made (the release's stock location, else the default). |
| `reservation` | `text` | NULL | — | `CHECK (reservation IN ('STOCK','AWAITING'))` (`ORDER_RESERVATIONS`; BENCH, a piece to make, until migration `0037_fulfilment`, which made those rows AWAITING): what it holds while RESERVED or PAID, one piece of its SKU in stock, or nothing yet, waiting for supplier stock (never shown to the collector); `orders_reservation`: only with a SKU, never shipped nor cancelled. Waiting orders are served strictly by date, whatever their channel, each time a piece becomes available at their location (`serveWaiting`, `order.serve`), a reshipment first (`queue_first`). |
| `queue_first` | `boolean` | NOT NULL | `false` | Migration `0037_fulfilment`: a reshipment after a parcel lost or damaged, served ahead of the oldest-first queue. `orders_awaiting_idx (sku_id, location_id, queue_first DESC, reserved_at, id) WHERE reservation = 'AWAITING'`: the queue in serving order. |
| `exchange_of_order_id` | `uuid` | NULL | — | Migration `0037_fulfilment`: an EXCHANGE order's original (FK → `orders.id`, unique `orders_exchange_of_order_key`, never itself, part of the identity guard); present exactly on the channel EXCHANGE (`orders_source`), which names no other source and keeps its original's release. |
| `packing_started_at` | `timestamptz` | NULL | — | Migration `0037_fulfilment`: Start packing, set on every order of a parcel and never cleared, only once paid (`orders_packing`): the moment after which the collector no longer changes the delivery address nor the engraving. |
| `carrier_id`, `tracking_number`, `declared_value_minor` | `uuid`, `text`, `int` | NULL | — | FK → `carriers.id`; `^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$`; 0 to 100 000 000 in its currency, for the insurance. `orders_shipment`: the carrier and the number with `shipped_at`, a declared value only once shipped and priced. |
| `product_id` | `uuid` | NULL | — | FK → `products.id`: the piece that fulfils it; `orders_product_key`, unique `(product_id) WHERE status IN ('RESERVED','PAID','SHIPPED','DELIVERED')`: one open order per piece. |
| `shopify_order_id` | `text` | NULL | — | A positive decimal, unique: the Shopify order it will be. |
| `with_order_id` | `uuid` | NULL | — | Migration `0027_tier_grants` (plan NEXT-NINE, BP-19 T4, T5). FK → `orders.id` (`orders_with_order_idx`), never itself (`orders_with_order`): the order it travels with, a GIFT order's, the 2nd to 5th piece of a LIVE entry's, and (migration `0029`) the 2nd to 5th piece of a draw's guaranteed place; never changed. |
| `gift_grant_id` | `uuid` | NULL | — | Migration `0027`. FK → `tier_grants.id` (§5.66, `orders_gift_grant_idx`): a GIFT order's grant; `orders_gift_grant_key`, unique `(gift_grant_id) WHERE status <> 'CANCELLED'`: one open GIFT order per grant. |
| `shipping_service`, `shipping_minor` | `text`, `int` | NULL | — | Migration `0027`. `CHECK (shipping_service IN ('STANDARD','EXPRESS'))` (`SHIPPING_SERVICES`), 0 to 100 000 000 in its currency; `orders_shipping`: both or neither. NULL: no shipping (an order of before, or below the free tiers without a fee or rate, as before). Fixed at the order's creation (the tier read then, THE PROGRAM, §5.64, or the rate of its currency, §5.65), entered by Client Services while RESERVED; an order travelling with another carries its service at 0. |
| `shipping_benefit` | `smallint` | NULL | — | Migration `0027`. `CHECK (shipping_benefit IN (2, 3))`, `orders_shipping_benefit`: at 0 only. The tier that made the shipping free. |

The steps hold their facts: `orders_source` (each channel exactly its source; a SALON order has no release; only a LIVE or, since migration `0029`, a DRAW order has a `piece` above 1), `orders_times` (each step after the one before), `orders_steps` (shipped after paid, delivered or returned after shipped, never cancelled once shipped), and one CHECK per status (`orders_status_reserved`, `_paid`, `_shipped`, `_delivered`, `_cancelled`, `_returned`).

- **Indexes:** primary key; the unique keys above; `orders_drop_idx (drop_id, status)`, `orders_account_idx (account_id, reserved_at)` (MY PIECES and the export), `orders_model_sku_idx (model_id, sku_id)`, `orders_location_idx`, `orders_carrier_idx`, `orders_product_idx`; `orders_board_idx (status, reserved_at)`, the board; `orders_stock_reservation_idx (sku_id, location_id) WHERE reservation = 'STOCK'`, the reserved stock; `orders_paid_idx (account_id, paid_at) WHERE paid_at IS NOT NULL` (migration `0032_growth_indexes`, plan NEXT-NINE BP-29): an account's paid orders in the order they were paid, for GROWTH (« Buyers », lifetime value, repeat buying).
- **Triggers:** `orders_immutable_identity` (BEFORE UPDATE) guards `id`, `channel`, `live_entry_id`, `piece`, `drop_entry_id`, `shop_request_id`, `drop_id`, `account_id`, `model_id` and `reserved_at`, and since migration `0027` `with_order_id` and `gift_grant_id` (`OR001`). `orders_source` gains GIFT: no release (as the private salon), its grant and the order it travels with; a grant on a GIFT order only.
- **Written by:** `services/orders.ts` only: `ordersForLiveEntry` (in PAY's transaction, one per piece), `orderForDrawEntry` (a draw's entry CONFIRMED, `DropService`), `orderForShopRequest` (a salon request closed ACCEPTED, `SalonService`), and at boot `OrderService.prepare` (the sales confirmed before 0022: a LIVE resolution CONCLUDED becomes PAID, CANCELLED becomes CANCELLED); the steps (`transition`: exactly `ORDER_TRANSITIONS`, §7.4), `returnOrder`, `changeLocation`, `setTerms`, `setBuyer` (OPERATOR), `setAddress` (the collector's delivery address, plan NEXT LOT §3.6.B), `createOrder` (the account's default address put on a new order of its own) and `attachPiece` (the atelier, `order.link`); `deliverOnRegistration` (in `OwnershipService.registerFirst`); `attachGifts` (a welcome gift, GIFT, on the first order of a sale, BP-19 T5), `applyCredit` and `removeCredit` (§5.67). Each change writes one row of §5.52, one audit entry (`order.*`) and one journal entry (§5.56) in its transaction, under the lock order of §8.2.
- **Read by:** the board, an order's page, the packing slip and the CSV (`FulfilmentService`, the buyer masked for an AUDITOR by the routes), the client sheet, MY PIECES (`forAccount`: the account's own, never the location, what it holds, the surprise, the declared value, the notes or who handled it), the invoices, the Shopify order export, the account's export.
- **Retention:** kept with the account (§10). **Privacy:** personal data: the account, what it bought, the buyer's name and address and the engraving's words.

### 5.52 `order_events`

An order's history, **append-only**: `id` (`bigint` identity, PK), `order_id` (FK → `orders.id`; `order_events_order_idx (order_id, id)`), `action` (`CHECK (action ~ '^order\.[a-z_]+(\.[a-z_]+)*$')`: its audit action, `order.create`, `order.pay`…), `status` (the order's after it), `note` (NULL, 1–500 characters: Client Services' words), `details` (a JSON object: ids and facts, never personal data; `fields` names what Client Services wrote, never its words), `actor_type`, `actor_id`, `created_at`. `order_events_append_only` rejects any update or delete (`OR001`). Written by `recordChange` (`services/orders.ts`) in each change's transaction; read by the order's page and timing (the board's late marks read when an order became paid and ready), MY PIECES (the step times), the client sheet (the notes) and the export (each step with its note). Personal data through its notes.

### 5.53 `bench_items`

The atelier's pieces to make ([API §16.24](API.md#1624-orders-logistics-locations-and-carriers-extension-of-the-contract)): `id` (PK), `order_id` (NULL: a piece for the stock; FK → `orders.id`; `bench_items_one_open`, unique `(order_id) WHERE status IN ('TO_MAKE','IN_PROGRESS')`), `sku_id` (FK → `skus.id`), `location_id` (FK → `stock_locations.id`: where the finished piece goes, moved with its order), `drop_id` (NULL, FK → `drops.id`: its release), `product_id` (FK → `products.id`, unique: **its ORBES identity, reserved at creation**, L6), `status` (`CHECK (status IN ('TO_MAKE','IN_PROGRESS','DONE','CANCELLED'))`, `BENCH_ITEM_STATUSES`), `engraving_text` and `surprise` (NULL, as the order's), `created_at`, `started_at`, `done_at`, `cancelled_at`. One CHECK per status and `bench_items_times`; `bench_items_immutable_identity` guards `id`, `order_id`, `sku_id`, `drop_id`, `product_id`, `created_at`.

- **Indexes:** `bench_items_order_idx`, `bench_items_sku_idx (sku_id, status)`, `bench_items_location_idx`, `bench_items_drop_idx (drop_id, status)`, the two unique keys.
- **Written by:** `AtelierService` (OPERATOR: pieces for the stock confirmed from a suggestion, `bench.create`; `start`, `bench.start`; `done`, which issues the identity in one signing transaction, `bench.done`, PRODUCED +1, the piece entering the stock (`products.stock_entered_at`) and serving an order waiting for it there; a stock piece cancelled, `bench.cancel`; the work sheets, `bench.sheet`, which sign each identity's code, `code.sign`). Journaled `bench.*`, never the engraving's words. Until migration `0037_fulfilment` an order that found no piece available created one (`bench.create`, its identity reserved); since then it waits for supplier stock (§5.51, AWAITING), and `0037` cancelled the open pieces to make, their RESERVED identities left as they are, reserved and unused. The atelier is removed in step 5.13 of the next lot (`AtelierService`, its routes): nothing writes the table any more, and its rows are kept.
- **Privacy:** the engraving text with its order; nothing else personal.

### 5.54 `returns`

An order returned, once (`returns_order_key`): `id` (PK), `order_id` (FK → `orders.id`), `outcome` (`CHECK (outcome IN ('RESTOCKED','ARCHIVED'))`, `RETURN_OUTCOMES`), `location_id` (FK → `stock_locations.id`, `returns_location_idx`; `returns_location`: exactly for RESTOCKED), `note` (NOT NULL, 1–500 characters), `ownership_id` (NULL, FK → `ownership.id`, unique: the ownership ORBES took back, ended `RETURNED`, when the piece was registered to an account: its buyer, or whoever it was transferred to), `created_by` (NULL, FK → `admin_users.id`, `returns_created_by_idx`), `created_at`. `returns_immutable` rejects any update or delete. Written by `OrderService.returnOrder` (`POST /api/admin/orders/:id/return`, OPERATOR; §7.3, §7.4). Read by the order's page. Personal data through its note and the ownership it names.

### 5.55 `invoices`

The invoices and credit notes ([API §16.25](API.md#1625-invoices-and-credit-notes-extension-of-the-contract)), **never changed nor deleted** (`invoices_immutable`, `OR001`: a credit note follows an invoice):

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `kind` | `text` | NOT NULL | — | `CHECK (kind IN ('INVOICE','CREDIT_NOTE'))` (`INVOICE_KINDS`). |
| `year`, `sequence` | `smallint`, `int` | NOT NULL | — | 2000–2099, 1–999 999; `invoices_number_key`, unique `(kind, year, sequence)`: `INV-2026-000001`, `CN-2026-000001`, in sequence per kind and UTC year under the advisory lock `INVOICE_NUMBER` (§8.3). |
| `order_id` | `uuid` | NOT NULL | — | FK → `orders.id`; `invoices_one_per_order`, unique `(order_id) WHERE kind = 'INVOICE'` and, since migration `0039`, `AND supplements_invoice_id IS NULL`: one main invoice per order, its supplementary ones beside it. |
| `credits_invoice_id` | `uuid` | NULL | — | FK → `invoices.id` (`invoices_credits_idx`): the invoice a credit note credits; `invoices_credit`: exactly for a credit note. Until migration `0039` unique (`invoices_credits_key`: once, in full); since then an invoice takes credit notes for single lines, then at most one for what remains (`invoices_full_credit_key`, unique `(credits_invoice_id) WHERE credit_scope = 'FULL'`). |
| `supplements_invoice_id` | `uuid` | NULL | — | Migration `0039_order_delivery` (plan NEXT LOT §3.6.C). FK → `invoices.id` (`invoices_supplements_idx`): a **supplementary invoice**'s main invoice (an engraving added after PAID, one ENGRAVING line); on an INVOICE only (`invoices_supplements`). |
| `credit_scope` | `text` | NULL | — | Migration `0039`. `CHECK (credit_scope IN ('FULL','LINES'))` (`CREDIT_SCOPES`), present exactly on a credit note (`invoices_credit_scope`): FULL credits what remains of its invoice (every credit note of before 0039), LINES single lines (an engraving removed after PAID). The migration set FULL on the credit notes of before, `invoices_immutable` dropped for that one statement and made again as 0022 made it. |
| `issuer`, `buyer` | `jsonb` | NOT NULL | — | JSON objects, as issued: CONGLOMERAT LLC and its address (`INVOICE_ISSUER`); the buyer's name and address entered on the order (an order travelling with another: that order's, plan NEXT LOT §3.6.B), since migration `0039` its `country` by its English name (absent from an invoice of before), and the account's email. |
| `lines` | `jsonb` | NOT NULL | — | A JSON array of at least one line, each `{ kind, label, detail, amountMinor }`: the piece (`PIECE`: its model, size and where it was sold), then each add-on (`ADDON`), and since plan NEXT-NINE (BP-19 T4, T5) its shipping (`SHIPPING`: *SHIPPING · STANDARD*, *FREE · PLATINE* when its tier made it free; none for an order travelling with another), a credit taken off it (`CREDIT`, negative) and a welcome gift travelling with it (`GIFT`, at 0), and since plan NEXT LOT §3.6.C an engraving priced from the settings (`ENGRAVING`, *Engraving*, never its words); each read back with its own kind (`linesOf`; an unknown kind reads as `PIECE`). A GIFT order has no invoice of its own. |
| `currency`, `subtotal_minor`, `total_minor` | `text`, `int`, `int` | NOT NULL | — | `invoices_total`: the total is the subtotal plus the VAT. |
| `vat_rate_bp`, `vat_minor` | `int` | NULL | — | 0–10 000 basis points, ≥ 0; `invoices_vat`: both or neither. **NULL: no VAT** (the owner's decision, choice 22). |
| `issued_at` | `timestamptz` | NOT NULL | `now()` | `invoices_issued_idx`, the month's documents and CSV. |

- **Written by:** `issueInvoice` (at PAID), `issueCreditNote` (a paid order cancelled or returned: every invoice of the order for what is still invoiced, FULL), and since migration `0039` `issueSupplementaryInvoice` (an engraving added after PAID) and `issueLineCreditNote` (an engraving removed after PAID, LINES) in the order's transaction (`services/invoices.ts`), journaled `invoice.issue` and `invoice.credit` (the document without its buyer), audited with ids, numbers and amounts.
- **Read by:** the console's Invoices page, its PDFs and the month's CSV (the buyer masked for an AUDITOR), an order's page, the buyer's own PDFs in MY PIECES (`/api/v1/account/orders/:id/invoice.pdf`, `/credit-note.pdf`), the account's export (number, kind, date, total).
- **Retention:** permanent, like the audit log. **Privacy:** the buyer's name, address and email, as issued.

### 5.56 `event_journal`

Every change of an order, the stock, a piece to make, an identity or an invoice (N1), written **once, in the transaction of the change**, for the connections to come (Shopify, Whop, the accountant): `id` (`bigint` identity, PK: the order to read and replay in), `type` (`CHECK (type ~ '^[a-z_]+(\.[a-z_]+)+$')`: `order.pay`, `stock.move`, `bench.done`, `product.reserve`, `product.retire`, `product.issue`, `product.transition`, `invoice.issue`…), `entity_type` (`order`, `stock_movement`, `bench_item`, `product`, `invoice`, and since plan NEXT LOT `supplier_order` and `shipment` (a packing photo erased, `shipment.photo.erase`: its id, order and time, never the photo): `JOURNAL_ENTITY_TYPES`) and `entity_id`, `payload` (a JSON object: the entity as it stands after the change, never the buyer's details nor an engraving's words), `created_at`, `consumed_by` (`text[]`, the readers that acknowledged it). `event_journal_entity_idx (entity_type, entity_id, id)`. `event_journal_immutable` guards every column but `consumed_by`; `event_journal_no_delete` rejects a delete. Written by `writeJournal` (`services/journal.ts`); read by `readJournal` (in order, or what a reader has not consumed), acknowledged by `acknowledgeJournal`, replayed by the pure `replayJournal`. No route reads it yet: nothing consumes it in this lot (TERMS-FACTS N10). Kept for good; account ids only.

### 5.57 `order_alert_settings`

The delays after which an order stands out on the board (M3), one row at most (`id` 1, `CHECK (id = 1)`), none inserted (the defaults are the columns'): `reserved_days` (2), `ready_days` (5 since migration `0037_fulfilment`, which turned a stored 3, the old default, into 5: paid with its piece ready, not shipped), `shipped_days` (10), `unregistered_days` (30: delivered, its piece not registered by its buyer), each 1–90 (365 for the last), `updated_by` (FK → `admin_users.id`), `updated_at`. Written by `FulfilmentService` (`PUT /api/admin/orders/alerts`, ADMIN), audited `order.alerts`. No personal data.

### 5.58 `segments`

Saved groups of collectors (N5, [API §16.26](API.md#1626-segments-extension-of-the-contract)): `id` (PK), `name` (1–60 characters, trimmed; `segments_name_key`, unique `lower(name)`), `criteria` (a JSON object: a rule tree, ALL or ANY of its rules, one nested level, each criterion negatable, `services/segments.ts`), `created_by` (NULL, FK → `admin_users.id`, `segments_created_by_idx`), `created_at`, `updated_at` (`segments_updated_after`). `segments_immutable_identity` guards `id`, `created_by` and `created_at`. **No member is stored**: its members, the ACTIVE accounts its criteria match, are read live wherever it decides (`drops.access_segment_id`, `circle_posts.segment_id`). Written by `SegmentService` (OPERATOR: `segment.create`, `.update`, `.delete`; a segment in use is never deleted, `409 SEGMENT_IN_USE`). No personal data in the row; its CSV of members, computed, masks the emails for an AUDITOR.

### 5.59 `after_room_guests`

An after-room's guests (A3): primary key `(drop_id, entry_id)`; `drop_id` (FK → `drops.id`: the after-room), `entry_id` (FK → `live_entries.id`, unique: an entry of its parent, remembered once), `position` (≥ 1; `after_room_guests_position_key`, unique `(drop_id, position)`: their order in the parent's line), `remembered_at`. `after_room_guests_immutable` rejects any update. Written by `settleAfterRoom` (`services/after-room.ts`) in the transaction of the parent's sell-out: its entries still WAITING or QUEUED. Read by the after-room's visibility and line (`afterRoomPlace`), the guest's entry (`entry.afterRoom`), the console, and the export (`afterRoomPlace`). Personal data with its entry.

### 5.60 `release_answers`

The answers to the question after (G4): primary key `(drop_id, account_id)`, one per account and release; `drop_id` (FK → `drops.id`), `account_id` (FK → `accounts.id`, `release_answers_account_idx`), `answer` (`CHECK (answer BETWEEN 1 AND 6)`: the position of the answer chosen), `answered_at` (the latest: an answer changes in place). `release_answers_immutable_identity` guards `drop_id` and `account_id`. Written by `QuestionService.answer` (`PUT /api/v1/live/:id/answer`, CSRF), audited `drop.live.answer` with positions only. Read by the console (counts per answer), the client sheet, the segments' ANSWER criterion and the export (`releaseAnswers`). Personal data; kept with the account.

### 5.61 `activity_hourly`

The sign-ins and scans of each complete UTC hour, by country and tier (G3): primary key `(hour, country, tier)`; `hour` (`CHECK (extract(epoch FROM hour) % 3600 = 0)`), `country` (`char(2)`, `ZZ` unknown), `tier` (0–3, the account's when the hour is counted; 0 without an account), `sign_ins`, `scans` (≥ 0). **No account, no address, no device.** Written by `aggregateActivity` (`services/activity.ts`) in housekeeping and before each reading, one transaction per pass (§10); read by the best time to open (the console's release page and Analytics). Kept: aggregates only.

### 5.62 `client_conversations`

Migration `0025_client_messages` (plan NEXT-NINE, CS-01; [API §10.17, §16.28](API.md#1017-messages-get-and-post-apiv1accountmessages-post-apiv1accountmessagesread-get-apiv1accountmessagesunread-extension-of-the-contract)): **one conversation per collector** between it and ORBES Client Services.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`; unique (`client_conversations_account_key`): one per collector. |
| `status` | `text` | NOT NULL | `'TO_ANSWER'` | `CHECK IN ('TO_ANSWER','ANSWERED','CLOSED')` (`CLIENT_CONVERSATION_STATUSES`): the collector wrote last, ORBES Client Services answered, or staff closed it. The collector never sees it; writing again reopens a CLOSED one. |
| `answered_by` | `uuid` | NULL | — | FK → `admin_users.id` (`client_conversations_answered_by_idx`): who answers it (the first answer, Take it, or an ADMIN's assignment). |
| `waiting_since` | `timestamptz` | NULL | — | The first collector message not answered yet; set exactly while TO_ANSWER (`client_conversations_waiting`: `CHECK ((status = 'TO_ANSWER') = (waiting_since IS NOT NULL))`). |
| `last_message_at` | `timestamptz` | NOT NULL | — | Its latest message. |
| `collector_read_at` | `timestamptz` | NULL | — | Up to when the collector has read the answers (MESSAGES opened); NULL before the first reading. |
| `closed_at`, `closed_by` | `timestamptz`, `uuid` | NULL | — | When and by whom (FK → `admin_users.id`, `client_conversations_closed_by_idx`) it was closed; set exactly while CLOSED (`client_conversations_closed`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; `client_conversations_account_key (account_id)`; `client_conversations_answered_by_idx`, `client_conversations_closed_by_idx`, each leading its foreign key; `client_conversations_board_idx (status, waiting_since, last_message_at)`, the Messages board.
- **Triggers:** `client_conversations_immutable_identity` (`orbes_guard_immutable_columns('id', 'account_id', 'created_at')`).
- **Written by:** `MessageService` (`services/messages.ts`) only: created by the collector's first message (never by staff: there is no `Write to the client`), held `FOR UPDATE` by each message, answer, take, assignment and closing. No delete path exists; kept with the account.

### 5.63 `client_messages`

The messages of a conversation (CS-01), oldest first: the collector's words and Client Services' answers, plain text, **no file**.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `conversation_id` | `uuid` | NOT NULL | — | FK → `client_conversations.id`; `client_messages_conversation_idx (conversation_id, created_at)`. |
| `author` | `text` | NOT NULL | — | `CHECK IN ('COLLECTOR','STAFF')` (`CLIENT_MESSAGE_AUTHORS`). |
| `admin_id` | `uuid` | NULL | — | FK → `admin_users.id` (`client_messages_admin_id_idx`): the staff member, exactly on a STAFF message (`client_messages_author`). Never shown to the collector: the answers are signed ORBES Client Services. |
| `body` | `text` | NOT NULL | — | `CHECK (length(btrim(body)) BETWEEN 1 AND 4000)`; the service holds a collector to 2 000 characters (`MESSAGE_LIMITS`). Personal data. |
| `context_kind` | `text` | NULL | — | `CHECK IN ('PIECE','ORDER','RELEASE','SCAN','MODEL')` (`CLIENT_MESSAGE_CONTEXTS`): what a collector's message concerns; NULL on a STAFF message (`client_messages_staff_plain`) and on one written from MESSAGES. |
| `context_label` | `text` | NULL | — | 1 to 120 characters, a snapshot the server wrote (`MONOLITHE · O26-J-00184`); present exactly with `context_kind` (`client_messages_label`). |
| `product_id`, `order_id`, `drop_id`, `model_id`, `shop_request_id` | `uuid` | NULL | — | FKs → `products`, `orders`, `drops`, `models`, `shop_requests` (ON DELETE RESTRICT), each leading its own index (`client_messages_<column>_idx`). |
| `scan_event_id` | `uuid` | NULL | — | The scan, **without a foreign key**: the scan retention clears it when it deletes the scan (§10); `client_messages_scan_event_idx` (partial, while set). |
| `scan_ref` | `char(8)` | NULL | — | `CHECK (scan_ref ~ '^[0-9A-F]{8}$')`: the scan's REF, kept after the scan is deleted. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | A conversation's messages are written in order (just after its latest when the clock has not moved). |

- **`client_messages_context`:** a PIECE names its `product_id`, an ORDER its `order_id`, a RELEASE its `drop_id`, a SCAN its `scan_ref` (and may name its `product_id` and `scan_event_id`), a MODEL its `model_id` (and may name its `shop_request_id`); nothing else; a message without a kind names nothing.
- **Triggers:** `client_messages_immutable` (`orbes_guard_immutable_columns` on every column but `scan_event_id`), `client_messages_no_delete` (BEFORE DELETE) and `client_messages_no_truncate` (BEFORE TRUNCATE), `orbes_reject_mutation`: a message is never changed nor deleted.
- **Written by:** `MessageService.write` (`POST /api/v1/account/messages`: the context checked and labelled, then in one transaction the account `FOR SHARE`, the rate of 10 an hour, the conversation `FOR UPDATE`, the message; audited `message.write`), `MessageService.writeIn` (plan NEXT LOT §3.6.D: a return or an exchange asked from YOUR ORDERS, the collector's own message about the order written in the request's transaction, without the rate) and `answer` (`POST /api/admin/messages/:id/answer`, OPERATOR, audited `message.answer`). Read by the account's MESSAGES, the console's board and conversation, and the export (`messages`, API §16.13). **Never in the audit log**: no entry holds a message's words. Kept with the account, never deleted.

### 5.64 `club_program_settings`

Migration `0026_club_program` (plan NEXT-NINE, BP-19 T2; [API §16.21](API.md#1621-the-tiers-the-club-pages-benefits-extension-of-the-contract)): **THE PROGRAM**, the figures of the tiers' benefits set in the console's Club → Tiers. One row at most (`id` 1, `CHECK (id = 1)`), none inserted: the defaults are the columns' (`DEFAULT_PROGRAM`, `services/club-program.ts`), as `order_alert_settings` (§5.57).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `smallint` | NOT NULL | `1` | PK, `CHECK (id = 1)`. |
| `early_access_palladium_hours`, `early_access_platine_hours` | `smallint` | NOT NULL | `4`, `2` | Each `CHECK (… BETWEEN 0 AND 336)`; `club_program_settings_early_access` `CHECK (early_access_platine_hours <= early_access_palladium_hours)`. A new draw's early access by default (§5.29); 0: none. |
| `shipping_free_platine`, `shipping_free_palladium` | `text` | NOT NULL | `'STANDARD'`, `'EXPRESS'` | `CHECK IN ('NONE','STANDARD','EXPRESS')` (`SHIPPING_FREE_LEVELS`): the free shipping of each tier. |
| `care_pieces_platine` | `smallint` | NOT NULL | `1` | `CHECK (… BETWEEN 0 AND 20)`: the pieces cared for a year; 0: none. |
| `care_pieces_palladium` | `smallint` | NULL | NULL | `CHECK (… BETWEEN 0 AND 20)`; NULL: every piece. |
| `messages_priority_min_tier` | `smallint` | NOT NULL | `2` | `CHECK IN (0, 2, 3)`: the Messages board's priority from PLATINE or PALLADIUM; 0: off. Read by `MessageService` at each board, conversation and summary (BP-19 T8): it drives the order and the mark. |
| `gift_platine_model_id`, `gift_palladium_model_id` | `uuid` | NULL | — | FK → `models.id`, each leading its index (`club_program_settings_gift_platine_model_id_idx`, `…_gift_palladium_model_id_idx`): the welcome gift of each tier; NULL: none. Active when set (a service rule; one discontinued since may stay, and gives no gift). |
| `credit_platine_minor`, `credit_palladium_minor` | `integer` | NOT NULL | `5000`, `10000` | `CHECK (… BETWEEN 0 AND 100000000)`: each tier's credit in minor units; 0: none. |
| `credit_currency` | `text` | NOT NULL | `'EUR'` | `CHECK IN ('EUR','GBP','USD','CHF')` (`HOUSE_CURRENCIES`): the one currency of the credit. |
| `credit_validity_months` | `smallint` | NOT NULL | `12` | `CHECK (… BETWEEN 1 AND 60)`. |
| `credit_channels` | `text[]` | NOT NULL | `'{DRAW,LIVE,SALON}'` | `CHECK (credit_channels <@ ARRAY['DRAW','LIVE','SALON'] AND cardinality(credit_channels) >= 1)` (`CREDIT_CHANNELS`). |
| `experience_members_evening_min_tier`, `experience_launch_preview_min_tier`, `experience_partner_min_tier` | `smallint` | NOT NULL | `2`, `3`, `3` | Each `CHECK (… BETWEEN 1 AND 3)`: the lowest tier invited to each experience of the circle (§5.31). |
| `updated_by` | `uuid` | NULL | — | FK → `admin_users.id` (`club_program_settings_updated_by_idx`). |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Written by:** `ClubProgramService.update` (`PUT /api/admin/club/program`, ADMIN), audited `club.program.update`. **Read by:** `ClubProgramService` (the console's THE PROGRAM and each tier's program lines). No personal data.

### 5.65 `shipping_rates`

Migration `0026_club_program` (plan NEXT-NINE, BP-19 T2; [API §16.24](API.md#1624-orders-logistics-locations-and-carriers-extension-of-the-contract)): **SHIPPING**, optional, what an order's delivery costs below the free shipping of PLATINE and PALLADIUM. None inserted: without a rate, an order carries no shipping, as before.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `currency` | `text` | NOT NULL | — | `CHECK IN ('EUR','GBP','USD','CHF')` (`HOUSE_CURRENCIES`). |
| `service` | `text` | NOT NULL | — | `CHECK IN ('STANDARD','EXPRESS')` (`SHIPPING_SERVICES`). |
| `fee_minor` | `integer` | NOT NULL | — | `CHECK (fee_minor BETWEEN 0 AND 100000000)`. |
| `updated_by` | `uuid` | NULL | — | FK → `admin_users.id` (`shipping_rates_updated_by_idx`). |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Key:** `shipping_rates_pkey PRIMARY KEY (currency, service)`: one rate per currency and service.
- **Written by:** `ClubProgramService.setShippingRates` (`PUT /api/admin/orders/shipping-rates`, ADMIN): the rates set whole, a rate left out deleted; audited `order.shipping_rates.update`. No personal data.

### 5.66 `tier_grants`

Migration `0027_tier_grants` (plan NEXT-NINE, BP-19 T5): what an account received on reaching a tier, **its welcome gift and its credit, once per tier and per account, ever**.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`, leading `tier_grants_once`. |
| `tier` | `smallint` | NOT NULL | — | `CHECK (tier IN (2, 3))`: PLATINE, PALLADIUM. |
| `kind` | `text` | NOT NULL | — | `CHECK (kind IN ('GIFT','CREDIT'))` (`TIER_GRANT_KINDS`). `tier_grants_once`, unique `(account_id, tier, kind)`: the « EVER ». |
| `granted_at` | `timestamptz` | NOT NULL | `now()` | |
| `amount_minor`, `currency`, `expires_at` | `int`, `text`, `timestamptz` | NULL | — | A CREDIT's amount (1–100 000 000 minor units), currency (`^[A-Z]{3}$`) and expiry (`tier_grants_expiry`: after the grant); `tier_grants_credit`: exactly on a CREDIT. |
| `model_id` | `uuid` | NULL | — | FK → `models.id` (`tier_grants_model_id_idx`): a GIFT's model as given, set each time it is attached to an order; `tier_grants_gift`: never on a CREDIT. |

- **Triggers:** `tier_grants_immutable` (BEFORE UPDATE: `id`, `account_id`, `tier`, `kind`, `granted_at`, `amount_minor`, `currency`, `expires_at`), `tier_grants_no_delete` (BEFORE DELETE, *a grant is never taken back*). It waits while the account is below its tier. No personal data beyond the account it names.
- **Written by:** `ensureGrants` (`services/tier-grants.ts`), in the transaction that may raise the tier: a first registration, a transfer accepted, a piece reinstated, an order's creation, `ClubService.status`, and `TierGrantService.prepare` at boot (§9); `INSERT … ON CONFLICT ON CONSTRAINT tier_grants_once DO NOTHING`, audited `club.grant` only for a row inserted. `model_id` by `attachGifts` (`services/orders.ts`). **Read by:** the gift's order (`attachGifts`), the credit's balance (`creditBalances`), an order's page, and the account's export (`accountTierGrants`, API §16.13 `tierGrants`: every grant with its model, amount, currency, expiry and balance).

### 5.67 `credit_uses`

Migration `0027_tier_grants` (plan NEXT-NINE, BP-19 T5): a credit taken off an order by Client Services. Never deleted (`credit_uses_no_delete`); only its release changes (`credit_uses_immutable` guards the rest). A grant's balance is its amount less its open uses.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `grant_id`, `order_id` | `uuid` | NOT NULL | — | FK → `tier_grants.id` (`credit_uses_grant_idx`), `orders.id` (`credit_uses_order_idx`); `credit_uses_open_key`, unique `(grant_id, order_id) WHERE released_at IS NULL`. |
| `amount_minor` | `int` | NOT NULL | — | 1–100 000 000, in the grant's currency. |
| `applied_by`, `applied_at` | `uuid`, `timestamptz` | NULL, NOT NULL | —, `now()` | FK → `admin_users.id` (`credit_uses_applied_by_idx`). |
| `released_at`, `released_reason`, `released_by` | `timestamptz`, `text`, `uuid` | NULL | — | `CHECK (released_reason IN ('REMOVED','CANCELLED','RETURNED'))` (`CREDIT_RELEASE_REASONS`); `credit_uses_released`: both or neither; `released_by` FK → `admin_users.id` (`credit_uses_released_by_idx`), only once released; `credit_uses_times`: after it was applied. |

- **Written by:** `OrderService.applyCredit` (`POST /api/admin/orders/:id/credit`, OPERATOR; a second application on one grant releases the open use as `REMOVED` and inserts the whole), `removeCredit` (`DELETE`), a cancellation and a return (`CANCELLED`, `RETURNED`); audited `order.credit.apply`, `order.credit.remove`, `order.credit.release`. **Read by:** the invoice's CREDIT lines (§5.55), an order's page, MY PIECES' `creditMinor`, and the account's export (API §16.13 `tierGrants[].uses`: the order's reference, the amount, `applied_at`, `released_at` and `released_reason`; never `applied_by` nor `released_by`).

### 5.68 `care_requests`

Migration `0028_yearly_care` (plan NEXT-NINE, BP-19 T6): a collector's request for the **yearly care** of a piece it holds, and its steps. PLATINE 1 piece a year, PALLADIUM every piece (THE PROGRAM, §5.64), the year in UTC. Never deleted (`care_requests_no_delete`, *a care request is cancelled, never deleted*); `care_requests_immutable` guards `id`, `account_id`, `product_id`, `year`, `tier`, `requested_at`, `return_name` and `return_address` (to change the address, the collector cancels and asks again).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`, leading `care_requests_account_idx (account_id, year)`. |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` (`care_requests_product_idx`). `care_requests_once`, unique `(product_id, year) WHERE status <> 'CANCELLED'`: once per piece and year, whoever holds it. |
| `year` | `smallint` | NOT NULL | — | 2026–2099: the calendar year in UTC. |
| `tier` | `smallint` | NOT NULL | — | `CHECK (tier IN (2, 3))`: the tier the account held when it asked. |
| `status` | `text` | NOT NULL | `'REQUESTED'` | `CHECK (status IN ('REQUESTED','LABEL_SENT','RECEIVED','RETURNING','DONE','CANCELLED'))` (`CARE_REQUEST_STATUSES`); `care_requests_status_idx (status, requested_at)`, the board's order. |
| `requested_at` | `timestamptz` | NOT NULL | `now()` | |
| `return_name`, `return_address` | `text` | NOT NULL | — | 1–200 and 1–1 000 characters once trimmed (as an order's buyer, §5.51): where the piece returns, as the collector gave it in the request's own form. **Personal data**: never in the audit log; in the account's export. |
| `label_pdf` | `bytea` | NULL | — | The prepaid label (1 byte to 2 MiB), its PDF as Client Services sent it; erased 30 days after the request ends (§10). |
| `label_carrier_id`, `label_tracking`, `label_at` | `uuid`, `text`, `timestamptz` | NULL | — | The label's carrier (FK → `carriers.id`, `care_requests_label_carrier_idx`), tracking number (an order's rule) and time; `care_requests_label`: all three or none, the PDF only with them. |
| `service_record_id`, `received_at` | `uuid`, `timestamptz` | NULL | — | The YEARLY_CARE record opened when the piece reached the atelier (FK → `service_records.id`, unique); `care_requests_received`: both or neither. |
| `return_carrier_id`, `return_tracking`, `return_shipped_at` | `uuid`, `text`, `timestamptz` | NULL | — | The piece shipped back (FK → `carriers.id`, `care_requests_return_carrier_idx`); `care_requests_return`: all three or none. |
| `done_at` | `timestamptz` | NULL | — | |
| `cancelled_at`, `cancelled_by` | `timestamptz`, `text` | NULL | — | `CHECK (cancelled_by IN ('account','admin'))`; `care_requests_cancelled`: both or neither. |
| `note` | `text` | NULL | — | 1–500 characters: ORBES's note on a cancellation. Staff only. |
| `handled_by` | `uuid` | NULL | — | FK → `admin_users.id` (`care_requests_handled_by_idx`): the console user of the latest step. |

- **`care_requests_steps`:** the columns each status needs, each later step keeping those of the earlier ones: REQUESTED none of the steps' times; LABEL_SENT the label's three; RECEIVED those and the record; RETURNING those and the return's three; DONE those and `done_at`; CANCELLED `cancelled_at` and `cancelled_by`, never shipped back nor done. `(status = 'CANCELLED') = (cancelled_at IS NOT NULL)`. `care_requests_times`: each step after the one before.
- **Written by:** `CareService` (`services/care.ts`): `request` (the account `FOR UPDATE`, then the year's requests; audit `care.request`), `cancelByAccount` (REQUESTED only; `care.cancel`), and the console's steps, each under the request's row lock and in one transaction with the service record it opens or closes: `sendLabel` (`care.label`), `receive` (`care.receive`, `WarrantyService.openService`), `shipBack` (`care.return`), `complete` (`care.complete`, `completeService`), `cancel` (`care.cancel`, `cancelService` of an open record). **Read by:** the piece's SERVICE tab (`GET /api/v1/account/products/:productId/care`), the label's download (its own account only), the Yearly care board (API §16.29), the Messages board's `care` link (an open request, §5.62), the account's export. No step writes a message.

### 5.69 `house_guarantees`

Migration `0029_house_guarantee` (plan NEXT-NINE, §3.3 IN-01, [API §16.30](API.md)): **THE HOUSE'S GUARANTEE**, a place at a coming release granted by ORBES Client Services to one account. Personal, used once, never transferred, never sold, always within the release's pieces. `house_guarantees_immutable` guards `id`, `account_id`, `scope`, `drop_id`, `model_id`, `collection_id`, `granted_by` and `granted_at` (`OR001`).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`, leading `house_guarantees_account_idx (account_id, status)`. |
| `scope` | `text` | NOT NULL | — | `CHECK (scope IN ('RELEASE','MODEL','COLLECTION'))` (`GUARANTEE_SCOPES`): a chosen release, the next release of a model (a main model covers its variants, a variant itself), or of a collection. |
| `drop_id`, `model_id`, `collection_id` | `uuid` | NULL | — | FK → `drops.id`, `models.id`, `collections.id` (`house_guarantees_drop_idx`, `_model_idx`, `_collection_idx`). `house_guarantees_scope`: exactly one target, matching the scope. |
| `pieces` | `smallint` | NOT NULL | `1` | 1–5: in a draw, selected first for these pieces; in a LIVE RELEASE, up to max(`per_account`, this). |
| `valid_until` | `timestamptz` | NOT NULL | — | The end of a day in Paris: it covers a release opening by then, and is honoured until that release ends. `house_guarantees_valid`: after `granted_at`. |
| `visible` | `boolean` | NOT NULL | `true` | Shown to the client. Off, nothing appears for its holder anywhere in the app (the public list after the draw shows its line, unmarked); the export still carries it. |
| `note` | `text` | NULL | — | 1–500 characters once trimmed, for Client Services: never in the app nor the audit log; in the account's export, with `revoke_note`. |
| `covered_drop_id`, `covered_at` | `uuid`, `timestamptz` | NULL | — | The release it is set aside for (FK → `drops.id`, `house_guarantees_covered_drop_idx`, and `house_guarantees_covered_idx (covered_drop_id) WHERE status = 'ACTIVE'`); `house_guarantees_cover`: both or neither; `house_guarantees_release_cover`: a chosen release's own release only. Once set aside, never switched; carried to the next release of its model or collection when its release ends without it. |
| `status` | `text` | NOT NULL | `'ACTIVE'` | `CHECK (status IN ('ACTIVE','USED','EXPIRED','REVOKED'))` (`GUARANTEE_STATUSES`). The computed state is never stored: USED, REVOKED, EXPIRED as stored; ACTIVE and bound to an entry, ENTERED; ACTIVE and set aside for a release opening by `valid_until`, SET ASIDE; ACTIVE past `valid_until` and not so set aside, EXPIRED; otherwise WAITING FOR A RELEASE. |
| `used_at`, `used_drop_id` | `timestamptz`, `uuid` | NULL | — | When and where it was used (FK → `drops.id`, `house_guarantees_used_drop_idx`); `house_guarantees_used`: exactly when USED. |
| `closed_at`, `closed_reason` | `timestamptz`, `text` | NULL | — | `CHECK (closed_reason IN ('USED','RELEASE_ENDED','RELEASE_CANCELLED','REVOKED'))`; `house_guarantees_closed`: set exactly when not ACTIVE, together. |
| `revoked_by`, `revoke_note` | `uuid`, `text` | NULL | — | FK → `admin_users.id` (`house_guarantees_revoked_by_idx`); `house_guarantees_revoked`: exactly when REVOKED. The note: 1–500 characters, for Client Services: never in the app nor the audit log; in the account's export (`revokeNote`), next to `note`. |
| `granted_by`, `granted_at` | `uuid`, `timestamptz` | NULL, NOT NULL | —, `now()` | FK → `admin_users.id` (`house_guarantees_granted_by_idx`; NULL for a script). |
| `updated_by`, `updated_at` | `uuid`, `timestamptz` | NULL | — | FK → `admin_users.id` (`house_guarantees_updated_by_idx`): the latest change. |

- **Indexes:** besides those above, `house_guarantees_waiting_idx (scope, model_id, collection_id) WHERE status = 'ACTIVE' AND covered_drop_id IS NULL` (the guarantees a publication sets aside) and `house_guarantees_one_per_release`, unique `(account_id, covered_drop_id) WHERE status = 'ACTIVE' AND covered_drop_id IS NOT NULL`: one ACTIVE guarantee per account and release.
- **Written by:** `GuaranteeService` (`services/guarantees.ts`): `grant`, `update`, `revoke` (OPERATOR; audited `guarantee.grant`, `.update`, `.revoke`, never the note's words), `coverOnPublish` (`DropService.publish`, `LiveConsoleService.publish`; `guarantee.cover`), `useGuarantees` (the draw, a holder's reservation, a LIVE turn; `guarantee.use`), `releaseCovered` (a draw, a cancellation, every end of a LIVE RELEASE: `guarantee.carry` or `guarantee.expire`). **Read by:** the client sheet, a release's guarantees in the console (the email masked for an AUDITOR), the club's status (the guarantees shown only), a LIVE RELEASE's state (its pieces, when shown), the account's export (every one, with its note).

### 5.70 `guarantee_settings`

Migration `0029_house_guarantee`: the Grant dialog's defaults (Orders → Settings, House guarantee), one row at most (`id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)`), none inserted: the defaults are its columns'. `valid_days` 90 (1–730), `pieces` 1 (1–5), `visible` true; `updated_by` (FK → `admin_users.id`, `guarantee_settings_updated_by_idx`) and `updated_at`. Written by `GuaranteeService.saveSettings` (ADMIN, audited `guarantee.settings` before and after); read by the console.

### 5.71 `account_sizes`

Migration `0030_account_sizes` (plan NEXT-NINE, §3.4 AC-01; [API §10.19](API.md)): **YOUR SIZES**, the sizes a collector saves in its account.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` (ON DELETE RESTRICT). |
| `kind` | `text` | NOT NULL | — | `CHECK (kind IN ('RING','BRACELET','WRIST','NECKLACE'))` (`SIZE_KINDS`): a ring size, a bracelet size, a wrist (for watches), a necklace length. |
| `value_mm` | `smallint` | NOT NULL | — | In whole millimetres: the French ring size itself, or centimetres × 10. `account_sizes_value`: a ring 40–76; a bracelet 140–240 by 5; a wrist 120–240 by 5; a necklace 350–1 000 by 10 (`services/sizes.ts` `SIZE_RANGES`). |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | When it was last saved. |

- **Keys:** `PRIMARY KEY (account_id, kind)`: one size per account and kind; it leads with the foreign key, so no other index is needed. A **cleared size is a deleted row**.
- **Written by:** `SizeService.set` (`PUT /api/v1/account/sizes`), whole: a kind given a value upserted, the others deleted; audited `account.sizes.update` with the kinds set and cleared, never the measures.
- **Read by:** the account (`GET /api/v1/account/sizes`); the LIVE state's `savedSize` (`LiveRoomService`, only without an entry or an interest), the salon's `suggestedSize` (`SalonService`) and a GIFT order's hint (`giftOf.savedSize`), each through `matchSavedSize` (a SKU's fit range first, else its label read as a measure, exactly one match); the right-of-access export (`OwnerService.exportData`, `sizes`). Never in segments, the owner sheet or the draws.
- **Retention:** kept with the account until the collector clears them (§10). Personal data: the privacy policy's account section says so.

### 5.72 `model_pairs`

Migration `0031_model_pairs` (plan NEXT-NINE, §3.7 BP-34; [API §13.4 and §8.8](API.md)): **PAIRS WELL WITH**, the two or three models a model's sheet in THE COLLECTION ends with, picked in the console.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `model_id` | `uuid` | NOT NULL | — | FK → `models.id` (ON DELETE RESTRICT). The model whose sheet ends with the pair: a main model or a model alone (the service's rule; a variant's sheet is its main model's). |
| `position` | `smallint` | NOT NULL | — | `model_pairs_position_check`: `CHECK (position BETWEEN 1 AND 3)`: the pair's place in the row. |
| `paired_model_id` | `uuid` | NOT NULL | — | FK → `models.id` (ON DELETE RESTRICT). The model shown: any model, from any collection, a variant included (its card then opens its own address). `model_pairs_not_self`: `CHECK (paired_model_id <> model_id)`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | When it was picked. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id` (ON DELETE RESTRICT); NULL for a script. |

- **Keys and indexes:** `PRIMARY KEY (model_id, position)`, which leads with the model's foreign key; `model_pairs_model_paired_key`, unique `(model_id, paired_model_id)`: a model picked once per model; `model_pairs_paired_model_idx (paired_model_id)` and `model_pairs_created_by_idx (created_by)`: every foreign key leads an index.
- **Rules held by the service** (`CatalogService.setPairs`, `PUT /api/admin/models/:id/pairs`): 0, 2 or 3 rows per model; `model_id` is never a variant (`409 MODEL_IS_VARIANT`); a pair is never of the model's own variant group (`409 PAIR_SAME_MODEL`). The model's row is locked (`FOR UPDATE`) while its rows are deleted and written again in one transaction; the same picks again write nothing. Audited `model.pairs` with the ids before and after.
- **Read by:** a lookbook sheet's `pairs` (`services/lookbook.ts` `pairsOf`, public and through the club: each pair the reader may see, never discontinued, else the fallback from the model's collection), and the console's record of a model (`CatalogService.getModel`: `pairs` with whether each is shown, `pairsFallback`).
- **Retention:** kept until the console changes the model's pairs; no personal data.

### 5.73 `test_entrants`

The pool of test accounts (migration `0024_z_test_entrants`, the owner's lot of 2026-10-07, TEST ENTRANTS; [API §16.32](API.md#1632-test-entrants-a-releases-tests-extension-of-the-contract)): one row per account of the pool, `account_id` (PK, FK → `accounts.id`). The accounts are ordinary rows of `accounts` (§5.9): `test-0001@orbes.test`, `test-0002@orbes.test`, … (four digits at least), display name `TEST 0001`, ACTIVE, a `password_hash` that is no scrypt encoding (`!test-entrant: never signs in`), so no password ever signs one in; a press sets their `country` and moves their `created_at` back (the profile's account age). At most 5 000 accounts in the pool, a rule of the service (`409 TEST_POOL_FULL`).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | PK. FK → `accounts.id` (ON DELETE RESTRICT). |
| `tier` | `smallint` | NOT NULL | `0` | `CHECK (tier BETWEEN 0 AND 3)`: the tier the club reads for the account instead of its pieces (`services/club.ts` `clubStandings`: every reader of a tier, the draw, the early access, the LIVE line, the access rule), its pieces read as the tier's threshold (1, 3, 5). |
| `seniority` | `smallint` | NOT NULL | `0` | `CHECK (seniority BETWEEN 0 AND 50)`: its seniority, read the same way. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | When it joined the pool. |

- **Written by:** `TestEntrantService` (`services/test-entrants.ts`): a press (SEND TEST ENTRANTS, ADD MORE) creates the missing accounts with their rows (a number some account already uses is skipped), and sets the tier and seniority of each account it sends. Never deleted: the pool is reused from test to test.
- **Read by:** `clubStandings` and `tierOf` (the test row wins over the pieces), `isTestEntrant` (`services/club.ts`: a test account counts as owning a LIVE RELEASE's models and collection, `services/live.ts` `accessOf`), the console's test panel (`real` and `test` entries of a release). Nothing else of the code tells a test account apart: its entries, orders and participation count as any collector's.

### 5.74 `test_runs`

A test of a release (migration `0024_z_test_entrants`): `id` (PK, `gen_random_uuid()`), `drop_id` (FK → `drops.id`), `mode` (`CHECK (mode IN ('DRAW','LIVE'))`, the release's), `status` (`CHECK (status IN ('RUNNING','DONE','STOPPED','INTERRUPTED','ENDED'))`, `TEST_RUN_STATUSES`; `'RUNNING'` by default), `settings` (`jsonb`, `CHECK (jsonb_typeof(settings) = 'array')`: each press, START then each ADD MORE, with its time, its test entrants and its settings), `entrants` (`CHECK (entrants BETWEEN 0 AND 5000)`), `created_by` (FK → `admin_users.id`, the ADMIN who started it), `created_at`, `ended_at` and `ended_by` (FK → `admin_users.id`) of END TEST, `report` (`jsonb` object or NULL: the TEST REPORT, five checks with their plain lines, and the peaks), `peaks` (`jsonb` object or NULL: the test's running maxima from the server status sampler, saved every ~10 s while it runs). `test_runs_ended`: `CHECK ((status = 'ENDED') = (ended_at IS NOT NULL) AND (ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL OR ended_at >= created_at))`.

- **Indexes:** primary key; `test_runs_drop_idx (drop_id, created_at)`, a release's tests; `test_runs_created_by_idx (created_by)`; `test_runs_ended_by_idx (ended_by)`; **`test_runs_one_running`**, unique on `(status) WHERE status = 'RUNNING'`: at most one RUNNING test in the whole database, one test at a time.
- **Written by:** `TestEntrantService`: `start` (ADMIN, audited `test_run.start`), `addMore` (the run's row `FOR UPDATE`, `test_run.add`), `stop` (`test_run.stop`), `end` (`test_run.end`: a RUNNING or DONE test is STOPPED first, so neither its bots nor the sweeper act during the clean-up, the report written before the clean-up and kept if the clean-up is cut short, then ENDED), the runner (RUNNING → DONE once every test entrant has acted; the peaks), and `boot`, at each start of the app: RUNNING → INTERRUPTED (its test entrants were in the previous process's memory). Never deleted: the history of a release's tests.

### 5.75 `test_run_entrants`

The test entrants of a test (migration `0024_z_test_entrants`): primary key `(run_id, account_id)`; `run_id` (FK → `test_runs.id`), `account_id` (FK → `test_entrants.account_id`, `test_run_entrants_account_idx`), `network` (`CHECK (network ~ '^100\.[0-9]{1,3}\.[0-9]{1,3}\.0/24$')`: the `/24` of `100.64.0.0/10`, RFC 6598, it comes from, its own or the shared `100.127.255.0/24`), `plan` (`jsonb` object: what it was drawn to do: its place, address, tier, arrival; on a draw whether it reserves, withdraws, confirms by itself; on a LIVE RELEASE I'LL BE THERE, its size, pieces, add-on, what it does on its turn and its hold), `outcome` (`CHECK (outcome ~ '^[A-Z_]{1,40}$')`, NULL until it has acted: `ENTERED`, `RESERVED`, `WITHDRAWN`, `REFUSED`, `CONFIRMED`, `NOT_CONFIRMED`, `RELEASED`, `MISSED`, `LEFT`, …), `confirm_due_at` (a draw's place it confirms by itself: when, 5 to 60 s after the sweeper first saw it held), `updated_at`.

- **Written by:** `TestEntrantService`: a press inserts its test entrants; the runner writes each one's outcome; the sweeper (every 5 s while a draw's test is RUNNING or DONE) sets `confirm_due_at` and, once due, confirms the place by the staff's Confirm (§5.30) with the test's ADMIN as actor; driven from the database, so a restart resumes it.
- **Privacy:** none: test accounts are ORBES's own.

END TEST (API §16.32) writes no row of its own beyond the run's: it cancels the test's open orders through `OrderService.transition` (§5.51), the orders before the GIFT orders travelling with them (each re-read before its cancel: a GIFT order its order's cancellation closed is skipped), which releases their `credit_uses` (§5.67, `released_reason` `CANCELLED`); then any GIFT order of the test still RESERVED or PAID is cancelled the same way and any credit use still open on a cancelled order of the test is released through `OrderService.releaseCancelledCredit`; the test accounts' `tier_grants` (§5.66) stay, never deleted; it REMOVES its open LIVE entries through `LiveService.remove` (§5.39) and, under the release's row lock, its `CONFIRMED` ones once their orders are cancelled (`removed_at` = `ended_at` now, `confirmed_at` cleared so `live_entries_status_confirmed` holds, their add-ons deleted), deletes its I'LL BE THERE before T0 (§5.43) and its accounts' sessions (§5.11), and in a draw, under the release's row lock (`FOR UPDATE`), sets its `ENTERED` entries `WITHDRAWN` and its `SELECTED`, `CONFIRMED` and `WAITLISTED` ones `LAPSED` with `respond_by` and `handled_at` both now (so `drop_entries_lapsed` holds without any change to it; the rank is kept, the draw's public list unchanged), `handled_by` the ADMIN and the note « END TEST: a test entrant's place, closed with its test. ».

### 5.76 `claim_code_renewals`

Migration `0034_claim_code_renewals` (plan NEXT LOT of 2026-10-07, §3.4, deployment H1; [API §15.10 and §10.20](API.md)): **New claim code**, one row per new claim code made for a piece not registered yet (its card lost), or made unseen when a sold piece's order was cancelled. The code itself is never stored: the row keeps the scrypt hash it wrote into `products.claim_secret_hash`, and a buyer's code sealed while it waits.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` (ON DELETE RESTRICT). |
| `kind` | `text` | NOT NULL | — | `CHECK (kind IN ('STAFF','BUYER','UNSHOWN'))` (`CLAIM_RENEWAL_KINDS`): shown once to the staff member (a piece with no buyer); sealed for the buyer of the piece's open order; made unseen at that order's cancellation. |
| `order_id` | `uuid` | NULL | — | FK → `orders.id` (ON DELETE RESTRICT). BUYER and UNSHOWN: the order it was made for. |
| `account_id` | `uuid` | NULL | — | FK → `accounts.id` (ON DELETE RESTRICT). BUYER: the order's account at the time. `claim_code_renewals_target`: STAFF neither, BUYER both, UNSHOWN the order alone. |
| `claim_hash` | `text` | NOT NULL | — | The scrypt hash this row wrote into `products.claim_secret_hash`. The row is the piece's current code while the two are equal, whatever changed the piece's hash since (a return, a later lot). |
| `sealed_code` | `text` | NULL | — | A BUYER's code sealed with AES-256-GCM (`crypto/secretbox.ts`, HKDF info `orbes/claim-code-reveal/v1` over `KEY_ENCRYPTION_KEY`, or `COOKIE_SECRET` without one), its AAD `claim-renewal:<id>:<order_id>:<account_id>` so it cannot be moved to another row. `claim_code_renewals_sealed`: set exactly while `status = 'WAITING'`, wiped when it is read or withdrawn. |
| `status` | `text` | NOT NULL | — | `CHECK (status IN ('SHOWN','UNSHOWN','WAITING','READ','WITHDRAWN'))` (`CLAIM_RENEWAL_STATUSES`); `claim_code_renewals_kind_status`: STAFF is SHOWN, UNSHOWN is UNSHOWN, BUYER WAITING, READ or WITHDRAWN. |
| `read_at` | `timestamptz` | NULL | — | `claim_code_renewals_read`: set exactly when READ (the buyer's one reading). |
| `withdrawn_at` | `timestamptz` | NULL | — | With `withdrawn_reason`, set exactly when WITHDRAWN (`claim_code_renewals_withdrawn`). |
| `withdrawn_reason` | `text` | NULL | — | `CHECK (withdrawn_reason IN ('RENEWED_AGAIN','ORDER_CANCELLED','ORDER_RETURNED','REGISTERED','UNREADABLE','SUPERSEDED'))` (`CLAIM_RENEWAL_WITHDRAWN_REASONS`): a newer code; its order cancelled or returned; the piece registered; a key that no longer opens it; the piece's code changed by another path. |
| `reason` | `text` | NULL | — | The staff member's reason, `CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500)`; `claim_code_renewals_reason`: present exactly when the kind is not UNSHOWN. Also in the audit entry. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id` (ON DELETE RESTRICT): who made it (an UNSHOWN row: who cancelled the order); NULL for the system. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | When it was made. |

- **Indexes:** primary key; `claim_code_renewals_product_idx (product_id, created_at)`, a piece's codes newest first; `claim_code_renewals_order_idx (order_id)`, `claim_code_renewals_account_idx (account_id)` and `claim_code_renewals_created_by_idx (created_by)`: every foreign key leads an index; **`claim_code_renewals_waiting_key`**, unique on `(product_id) WHERE status = 'WAITING'`: at most one code waits per piece.
- **Guards:** `claim_code_renewals_immutable` (`id`, `product_id`, `kind`, `order_id`, `account_id`, `claim_hash`, `reason`, `created_by`, `created_at` never change); `claim_code_renewals_no_delete` and `claim_code_renewals_no_truncate` (`'claim code renewals are kept'`).
- **Written by:** `ClaimRenewalService` (`services/claim-renewals.ts`): `renew` (OPERATOR) inserts a STAFF or a BUYER row, withdraws a waiting one (`RENEWED_AGAIN`) and writes the new hash into the piece, under the piece's lock; `reveal` (the buyer, once) sets READ and wipes the sealed code, or withdraws the row (`SUPERSEDED`, `REGISTERED`, `UNREADABLE`); `withdrawOnCancel` (an order's cancellation, `services/orders.ts` `step()`) withdraws a waiting code (`ORDER_CANCELLED`), inserts an UNSHOWN row and writes its fresh hash, so a code the ex-buyer read stops too; `returnOrder` withdraws a waiting code (`ORDER_RETURNED`); `registerFirst` withdraws one (`REGISTERED`, a safety net).
- **Read by:** the console's product page (`claimCode`: the situation and the `New claim codes` history, never `sealed_code`) and order page; YOUR ORDERS (`claimCode` of an order: its status and date only); the account's export (`claimCodes`: dates and statuses); `checkClaimCode` (the claim-code attempt limit counts the failures since the piece's latest row).
- **Privacy:** a BUYER row names an account and an order. It is kept forever, like the orders it names; its sealed code exists only while it waits. Backups hold sealed codes only.

### 5.77 `suppliers`

Migration `0035_logistics_access` (plan NEXT LOT of 2026-10-07, §3.5, deployment H2; [API §16.33](API.md)): the suppliers ORBES orders its pieces from (« ORBES does not make its pieces: suppliers do »).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `name` | `text` | NOT NULL | — | 1–120 characters, trimmed; `suppliers_name_key`, unique `lower(name)`: `409 SUPPLIER_NAME_TAKEN`. |
| `contact_name` | `text` | NULL | — | 1–120 characters, trimmed. |
| `email` | `text` | NULL | — | 1–254 characters, trimmed. The supplier's own address: ORBES writes to it outside the console, which sends no email. |
| `phone` | `text` | NULL | — | 1–40 characters, trimmed. |
| `address` | `text` | NULL | — | 1–500 characters, trimmed, line breaks kept (the « To » of a supplier order's PDF). |
| `currency` | `text` | NULL | — | `CHECK (currency ~ '^[A-Z]{3}$')`: an ISO 4217 code; the service accepts only a currency with two decimals (every amount is kept and printed in hundredths), so BIF, CLP, JPY, KWD, TND and the other zero- or three-decimal codes are refused (`400`). A new draft takes it. |
| `note` | `text` | NULL | — | 1–1 000 characters, trimmed. |
| `active` | `boolean` | NOT NULL | `true` | An inactive supplier stays on its models and orders and is offered for no new draft. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id` (ON DELETE RESTRICT), led by `suppliers_created_by_idx`; NULL for a script. |

- **Guards:** `suppliers_immutable_identity` (`id`, `created_at`, `created_by` never change); `suppliers_no_delete` and `suppliers_no_truncate` (`'suppliers are set inactive, never deleted'`).
- **Written by:** `SupplierService.create` and `update` (`services/suppliers.ts`; `POST /api/admin/suppliers`, `PATCH /api/admin/suppliers/:id`, OPERATOR), audited `supplier.create` (`{ name, currency, active }`) and `supplier.update` (`{ fields }`: the names of the fields changed, never the contact's words).
- **Read by:** the console's Supplier orders page (Suppliers, AUDITOR and up; never a LOGISTICS login) and a model's Sizes section (its supplier and each size's).
- **Privacy:** a contact's name, email and phone are a company's business contact, read by ORBES staff only.

### 5.78 `supplier_orders`

Migration `0036_supplier_orders` (plan NEXT LOT §3.5.5.2; [API §16.33](API.md)): what ORBES orders from a supplier (§5.77), delivered to a location. `id` (PK; its reference `SO-` and the id's first eight hex figures, never stored), `supplier_id` (FK → `suppliers.id`), `location_id` (FK → `stock_locations.id`, deliver to), `status` (`SUPPLIER_ORDER_STATUSES`: DRAFT → SENT → EXPECTED, an optional step, the supplier having confirmed it → PARTLY_RECEIVED → RECEIVED; CANCELLED when the rest is cancelled with nothing accepted), `currency` (three capitals; two-decimal currencies only, by the service), `shipping_minor` (0–100 000 000 hundredths; NULL: no shipping cost), `expected_on` (`date`), `note` (1–1 000, printed on its PDF), `sent_at`/`sent_by`, `supplier_confirmed_at`/`_by`, `received_at`, `rest_cancelled_at`/`_by`/`rest_cancelled_note`, the supplier's invoice `invoice_number` (1–60), `invoice_minor` (`bigint`), `invoice_date` (all three or none: `supplier_orders_invoice`) and `invoice_paid_at`/`_by` (only with an invoice: `supplier_orders_invoice_paid`), `created_at`, `created_by`, `updated_at`.

- **Its rules, in CHECKs:** `supplier_orders_sent` (a sent order or later has its `sent_at`, currency and expected date), `_draft` (DRAFT exactly while not sent), `_confirmed` (EXPECTED with its confirmation, none before SENT), `_received` (RECEIVED exactly with `received_at`), `_rest_cancelled` (the rest cancelled only on RECEIVED or CANCELLED, CANCELLED with it, its time and note together); each `_by` only with its time.
- **Indexes:** `supplier_orders_one_draft`, unique `(supplier_id, location_id) WHERE status = 'DRAFT'` (one draft per supplier and location); `supplier_orders_status_idx (status, expected_on)`; one index leading each foreign key.
- **Guards:** `supplier_orders_immutable_identity` (`id`, `supplier_id`, `location_id`, `created_at`, `created_by`). A DRAFT is deleted when discarded (it never left ORBES); a sent order is never deleted (its lines, receptions and returns hold it, RESTRICT).
- **Privacy:** no personal data; prices are ORBES's, never sent to a LOGISTICS login.

### 5.79 `supplier_order_lines`

A SKU of a supplier order (migration `0036`): `id`, `supplier_order_id`, `sku_id` (FK → `skus.id`, a use of the size, `SKU_USES`), `quantity` (1–10 000), `unit_price_minor` (NULL until set, required to send; hundredths), what came of it, `accepted_quantity`, `rejected_quantity`, `credited_quantity` (rejected pieces the supplier credited), `rest_cancelled_quantity` (each 0–100 000, `0` by default), `created_at`. `supplier_order_lines_order_sku_key`, unique `(supplier_order_id, sku_id)`; `supplier_order_lines_sku_idx`. Still expected on a line: max(0, quantity − accepted − credited − rest cancelled). `supplier_order_lines_immutable_identity` guards `id`, `supplier_order_id`, `sku_id`, `created_at`.

### 5.80 `receptions`

A delivery counted by the agent against its supplier order, at its location (migration `0036`): `id`, `supplier_order_id`, `location_id`, `status` (`RECEPTION_STATUSES`: TO_CONFIRM, then CONFIRMED by ORBES or SENT_BACK to be counted again, then TO_CONFIRM anew), `delivery_note` (1–60, the supplier's number), `note` (1–1 000), `counted_at`/`counted_by`, `sent_back_at`/`_by`/`sent_back_note` (together: `receptions_sent_back`, SENT_BACK with them), `confirmed_at`/`_by` (exactly when CONFIRMED: `receptions_confirmed`), `issued_at` (every identity issued, only once confirmed: `receptions_issued`), `cards_attached_at`/`_by` (only once issued: `receptions_cards_attached`), `created_at`. `receptions_one_open`, unique `(supplier_order_id) WHERE status IN ('TO_CONFIRM','SENT_BACK')`: one open reception per supplier order. `receptions_location_idx (location_id, status)`; an index leading each foreign key. `receptions_immutable_identity` guards `id`, `supplier_order_id`, `location_id`, `created_at`.

### 5.81 `reception_lines`

A SKU of a reception (migration `0036`): `id`, `reception_id`, `sku_id` (a use of the size), `supplier_order_line_id` (NULL: a piece not on the order), `accepted` and `rejected` (0–10 000 each; at least one piece: `reception_lines_pieces`), `issued` (the identities the worker issued so far, 0 to `accepted`: `reception_lines_issued`; restart-safe), `note` (1–500, the agent's: required by the service for pieces beyond those expected or not on the order). `reception_lines_reception_sku_key`, unique `(reception_id, sku_id)`; an index leading each foreign key. `reception_lines_immutable_identity` guards `id`, `reception_id`, `sku_id`, `supplier_order_line_id`.

### 5.82 `card_prints`

A piece issued by a reception and its card (migration `0036`): `product_id` (PK, FK → `products.id`), `reception_id`, `sealed_claim_code` (the claim code sealed with AES-256-GCM, `crypto/secretbox.ts`, HKDF info `orbes/card-claim-codes/v1` over `KEY_ENCRYPTION_KEY`, or `COOKIE_SECRET` without one, its AAD `card:<product id>`), `printed_count` and `last_printed_at` (together: `card_prints_printed`), `erased_at` and `erased_reason` (`CARD_ERASED_REASONS`: ATTACHED, the cards put with their pieces, or one piece's at its packing scan; REPLACED by a new claim code; REGISTERED; UNREADABLE, a key that no longer opens it; together: `card_prints_erased`). `card_prints_sealed`: the code sealed exactly until erased. `card_prints_reception_idx`. `card_prints_immutable_identity` guards `product_id` and `reception_id`.

- **Privacy and secrets:** a claim code is never in clear here, and the sealed copy only bridges the confirmation and the printing; no code, sealed or clear, reaches an audit entry, an event, the journal or a log.

### 5.83 `supplier_returns`

Rejected pieces of a reception, sent back to their supplier (migration `0036`): `id`, `supplier_order_id`, `reception_id`, `sku_id` (a use of the size), `quantity` (1–10 000), `status` (`SUPPLIER_RETURN_STATUSES`: TO_RETURN, then RETURNED by the agent with `returned_at`/`_by`, and an optional `carrier_id` (FK → `carriers.id`) and `tracking_number`, only then: `supplier_returns_returned`), the supplier's answer noted by ORBES, `settlement` (`SUPPLIER_RETURN_SETTLEMENTS`: REPLACEMENT, the pieces stay expected; CREDIT, with its `credit_minor` only) with `settled_at`/`_by` (`supplier_returns_settled`), `note` (1–500), `created_at`. An index leading each foreign key. `supplier_returns_immutable_identity` guards `id`, `supplier_order_id`, `reception_id`, `sku_id`, `quantity`, `created_at`.

### 5.84 `stock_corrections`

A count the agent proposes, applied once ORBES approves it (migration `0036`): `id`, `sku_id` (a use of the size), `location_id`, `delta` (±1–10 000, never 0), `reason` (1–500), `status` (`STOCK_CORRECTION_STATUSES`: TO_APPROVE, APPROVED, DECLINED), `proposed_by`, `proposed_at`, `decided_by`, `decided_at` (exactly once decided: `stock_corrections_decided`), `decision_note` (1–500; required when DECLINED: `stock_corrections_declined`), `movement_id` (FK → `stock_movements.id`, unique: the ledger's ADJUSTED movement, exactly when APPROVED: `stock_corrections_movement`). `stock_corrections_location_idx (location_id, status)`; an index leading each foreign key. `stock_corrections_immutable_identity` guards `id`, `sku_id`, `location_id`, `delta`, `reason`, `proposed_by`, `proposed_at`; `stock_corrections_no_delete` (`'stock corrections are kept'`).

### 5.85 `shipments`

Migration `0037_fulfilment` (plan NEXT LOT §3.5.5.3): one parcel, keyed by its first order (`order_id`, FK → `orders.id`, `shipments_order_idx`; a parcel is that order and the orders travelling with it, `with_order_id`, minus the cancelled ones), at a location (`location_id`, `shipments_location_idx`; `shipments_status_idx (status, location_id)`). `status` (`SHIPMENT_STATUSES`): PACKING (Start packing: `packing_started_at`, `packing_started_by`) → PACKED (`packed_at`, `packed_by`) → SHIPPED (`shipped_at`, `shipped_by`, `carrier_id`, `tracking_number`) → DELIVERED (`delivered_at`); or, once shipped, the kind of the parcel problem its order case reports (BACK_TO_SENDER, LOST, DAMAGED); or CANCELLED (`cancelled_at`: an order of the parcel cancelled while packing). Each status with its times (`shipments_packed`, `_shipped`, `_delivered`, `_cancelled`). `checklist` (a JSON array of the lines ticked, by key and label), the packing photo (`photo` `bytea`, 1 byte to 1 MiB, `photo_mime` JPEG or WebP, `photo_sha256`, all three or none: `shipments_photo`; `photo_erased_at`, when the housekeeping erased it, 14 days after delivery, §10). One open shipment (PACKING, PACKED, SHIPPED) per order: `shipments_one_open`. Its identity (id, order, location, the start of packing) never changes. The photo is internal: never served by `/api/v1/media`, never shown to the collector, never in the audit log nor the journal (its SHA-256 and size only).

### 5.86 `shipment_items`

Each order of a parcel and the piece its packing scan bound (migration `0037_fulfilment`): primary key `(shipment_id, order_id)`, `order_id` (FK, `shipment_items_order_idx`), `product_id` (NULL until the scan; FK → `products.id`, `shipment_items_product_idx`), `scan_event_id` (no foreign key: the scans' retention clears them), `scanned_at` (with a piece always: `shipment_items_scanned`).

### 5.87 `order_cases`

The one table for every order case (migration `0037_fulfilment`, plan NEXT LOT §1.1 (b)): a RETURN or a size EXCHANGE (`reason` SIZE, NOT_AS_EXPECTED, DAMAGED or OTHER; an exchange's `exchange_sku_id`, a use of the size, and `exchange_size_label`), or a parcel problem BACK_TO_SENDER, LOST or DAMAGED (`shipment_id` naming its parcel, exactly for those: `order_cases_shipment`). Opened by the collector (a return or a size exchange asked from YOUR ORDERS, `OrderCaseService.request`, plan NEXT LOT §3.6.D: its order DELIVERED, within 14 days, its request written into MESSAGES in the same transaction) or by staff (`opened_by_type` account or admin, `opened_by_id`, `opened_at`), with a `note` (1–1 000 characters: the client's or the staff member's words, personal data, never in the audit log, the events nor the journal) and the collector's message in MESSAGES (`message_id`, FK → `client_messages.id`). `status` (`ORDER_CASE_STATUSES`): OPEN → RECEIVED (`received_at`, `received_by`, `piece_state` OK or DAMAGED, `receive_note`: the agent records the parcel back; never a LOST case) → CLOSED (`outcome` REFUND, EXCHANGE or RESHIP as its kind allows, `order_cases_outcome`: a return is refunded, an exchange refunded or exchanged, a parcel problem reshipped or refunded; `piece_to` RESTOCKED, ARCHIVED or REVOKED; `exchange_order_id`, the EXCHANGE order, unique; `decision_note`; `closed_at`, `closed_by`), or CANCELLED (`cancelled_at`, `cancelled_by`, `cancel_note`: ended with no decision). One case not ended per order: `order_cases_one_open`. Its identity and the opener's words never change; never deleted nor truncated. Indexes: every foreign key, and `order_cases_status_idx (status, opened_at)`.

### 5.88 `account_addresses`

Migration `0039_order_delivery` (plan NEXT LOT §3.6.B; [API §10.21](API.md#1021-your-addresses-and-an-orders-delivery-address-extension-of-the-contract)): **YOUR ADDRESSES**, the delivery addresses a collector saves, at most 5 (`ADDRESS_LIMIT`, kept by the service), one of them the default, put on each new order.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` (`account_addresses_account_idx (account_id, created_at)`). |
| `name` | `text` | NOT NULL | — | 1–200 characters, trimmed. |
| `address` | `text` | NOT NULL | — | 1–1000 characters, trimmed, the lines as typed (line breaks kept). |
| `country` | `text` | NOT NULL | — | `^[A-Z]{2}$`: ISO 3166-1 alpha-2 (`src/shared/countries.ts`, which the service checks). |
| `phone` | `text` | NOT NULL | — | `^\+[0-9][0-9 ().-]{5,24}$`: with its country code. |
| `is_default` | `boolean` | NOT NULL | `false` | `account_addresses_one_default`, unique `(account_id) WHERE is_default`: one default per account. |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Trigger:** `account_addresses_immutable_identity` guards `id`, `account_id`, `created_at`.
- **Written by:** `AddressService` (`services/addresses.ts`): create, update, remove, make default, each under the account's lock; `OrderService.setAddress` when the collector saves an order's new address to YOUR ADDRESSES. The first address becomes the default; removing the default makes the oldest left the default. A removed address is a deleted row: the collector's own data, as `account_sizes` (§5.71); an order keeps its own copy.
- **Read by:** YOUR ADDRESSES and the address sheet of an order (`GET /api/v1/account/addresses`), `createOrder` (the default copied onto each new order), the account's export. Never the console: the client sheet shows no saved address.
- **Retention:** until the collector removes it, or the account ends (§10). **Privacy:** personal data: never in the audit log (an address's id and country only), the events nor the journal.

### 5.89 `engraving_prices`

Migration `0039_order_delivery` (plan NEXT LOT §3.6.C; [API §16.24](API.md#1624-orders-logistics-locations-and-carriers-extension-of-the-contract)): **Engraving**, Orders → Settings, the engraving's price per currency for an order whose release did not sell the engraving as an add-on. None inserted: a currency without a price offers no engraving.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `currency` | `text` | NOT NULL | — | PK. `CHECK IN ('EUR','GBP','USD','CHF')` (`HOUSE_CURRENCIES`). |
| `price_minor` | `integer` | NOT NULL | — | `CHECK (price_minor BETWEEN 0 AND 100000000)`; 0: a free engraving. |
| `updated_by` | `uuid` | NULL | — | FK → `admin_users.id` (`engraving_prices_updated_by_idx`). |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Written by:** `ClubProgramService.setEngravingPrices` (ADMIN), whole, in one transaction; audited `order.engraving_prices.update`, before and after.
- **Read by:** the engraving of an order (`OrderService.setEngraving`, the collector's and Client Services'), its offer in YOUR ORDERS, the console's Settings. An order keeps the price it took (`orders.engraving_minor`) when the setting changes later.
- **Privacy:** no personal data.

### 5.90 `admin_user_locations`

Migration `0035_logistics_access` (plan NEXT LOT §3.5.6.1; numbered last so that the supply chain's tables keep their numbers): the locations a LOGISTICS login works at. Primary key `(admin_user_id, stock_location_id)`; `admin_user_id` (FK → `admin_users.id`), `stock_location_id` (FK → `stock_locations.id`, led by `admin_user_locations_location_idx`), `created_at`, `created_by` (NULL, FK → `admin_users.id`, led by `admin_user_locations_created_by_idx`: the ADMIN who tied it; NULL for the shell), every foreign key ON DELETE RESTRICT.

- **Its rule, kept by the service:** rows exist only for LOGISTICS logins, at least one each. `AuthService.createStaff`, `createAdmin` and `setAdminRole` (the Team page, `POST /api/admin/admins` and `PATCH /api/admin/admins/:id/role` with `stockLocationIds`, ADMIN) write them in the transaction that gives the role (`400 'Choose at least one location.'` without one, `404 STOCK_LOCATION_NOT_FOUND` for an unknown one), replace them when a LOGISTICS login's locations change, and delete them when the role changes away; audited in the existing `admin.create` (`{ role, stockLocationIds }`) and `admin.role_change` (`{ from, to, stockLocationIds }`). A rule across two tables, tested with the service rather than written as a CHECK.
- **Read by:** the guard of the Logistics routes (`logisticsScope`, `routes/admin/logistics.ts`): a LOGISTICS login reads and acts on the rows of its own locations only, any other answering 404; the Team page (each login's locations).
- **Privacy:** no personal data (two ids).

### 5.91 `heard_options`

Migration `0040_account_profiles` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.3.2; [API §16.38](API.md#1638-the-sign-up-pages-answers-extension-of-the-contract)): the answers to « How did you hear about ORBES? », asked at sign-up and in YOUR PROFILE, a list an ADMIN edits on the console's Sign-up page.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `label` | `text` | NOT NULL | — | `heard_options_label_check`: 1–40 characters, trimmed, no control character nor `<` `>`. `heard_options_label_key`, unique `(lower(label))`: one answer per wording, whatever the case. |
| `is_other` | `boolean` | NOT NULL | `false` | Other, with its text field IN A FEW WORDS. `heard_options_one_other`, unique `(is_other) WHERE is_other`: exactly one. |
| `position` | `smallint` | NOT NULL | — | `CHECK (position BETWEEN 1 AND 100)`, not unique: a reorder rewrites them all in one transaction; Other last. |
| `active` | `boolean` | NOT NULL | `true` | Offered at sign-up and in YOUR PROFILE; false once **set aside**. Never deleted, so a given answer keeps its meaning. |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Triggers:** `heard_options_touch_updated_at`; `heard_options_immutable_identity` guards `id`, `is_other`, `created_at`.
- **Written by:** `ProfileService.prepare` at the first boot (`src/server/context.ts`): Instagram, TikTok, A friend, The press, A shop, A web search, An influencer, Other, only while the table is empty (a renamed answer is never created again), audited `heard_option.setup`; `createHeard`, `updateHeard` and `orderHeard` (ADMIN: added last before Other, renamed, set aside or offered again, reordered), each under a lock of the whole list, audited `heard_option.create`, `.update` and `.order`. At most 12 offered at once, Other counted (`HEARD_OFFERED_MAX`, kept by the service); Other is never set aside.
- **Read by:** CREATE ACCOUNT (`GET /api/v1/account/sign-up`), YOUR PROFILE, the console's Sign-up page with each answer's count of counted collectors (`countedCollector`: test entrants and the team's own accounts left out), the account's export (the label at export time).
- **Size:** a dozen rows. **Privacy:** house words, no personal data.

### 5.92 `account_profiles`

Migration `0040_account_profiles` (plan CUSTOMER INTELLIGENCE §3.1 P.3.2; [API §10.25](API.md#1025-your-profile-get-and-put-apiv1accountprofile-extension-of-the-contract)): **YOUR PROFILE**, what a collector tells ORBES about themselves, one row per account that has given anything, beside `accounts` (read whole on every signed-in request, so not widened). The country stays on `accounts.country` (§5.9); the address is the default of YOUR ADDRESSES (§5.88): one address book.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | PK; FK → `accounts.id` (the primary key leads it). |
| `first_name`, `last_name` | `text` | NULL | — | `account_profiles_first_name_check`, `_last_name_check`: 1–50 characters, trimmed, no control character nor `<` `>`, any script. Changed, never cleared once given (the service). |
| `phone` | `text` | NULL | — | `CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')`: E.164, typed after its country code (`src/shared/profile-rules.ts` `toE164`), **not checked by text message**. |
| `phone_country` | `text` | NULL | — | `^[A-Z]{2}$`: the country picked for the code (+1 and +44 are shared by several). `account_profiles_phone_pair`: both or neither. |
| `birth_date` | `date` | NULL | — | `CHECK (birth_date >= DATE '1900-01-01')`; the service also wants 13 years at least (`birthDateProblem`, the Paris day). |
| `birth_date_by` | `text` | NULL | — | `CHECK IN ('COLLECTOR','STAFF')` (`PROFILE_SOURCES`, mirrored in `db/schema.ts` and `web/admin/types.ts`): who set it. |
| `birth_date_at` | `timestamptz` | NULL | — | When. `account_profiles_birth_pair`: the date, who and when, all three or none. |
| `birth_date_collector_at` | `timestamptz` | NULL | — | The collector's one entry, never cleared: once set, only Client Services sets a date (`409 BIRTH_DATE_SET`, `BIRTH_DATE_ENTERED`). |
| `city` | `text` | NULL | — | 1–80 characters, trimmed, no control character nor `<` `>`. |
| `instagram` | `text` | NULL | — | `CHECK (instagram ~ '^[a-z0-9._]{1,30}$')`: the username, lower case, without `@` (`toInstagram` cleans a pasted link). |
| `heard_option_id` | `uuid` | NULL | — | FK → `heard_options.id` (`account_profiles_heard_option_idx`). |
| `heard_other` | `text` | NULL | — | Other's words, 1–100 characters. `account_profiles_heard_other_option`: only with an answer (the service keeps them only with Other). |
| `heard_at` | `timestamptz` | NULL | — | When the answer was first given. `account_profiles_heard_at`: set with an answer. |
| `version` | `integer` | NOT NULL | `1` | `CHECK (version >= 1)`; +1 on every save. A save sends the version it read (0 while there is no row): another meanwhile, `409 PROFILE_CHANGED`. |
| `updated_by` | `text` | NOT NULL | `'COLLECTOR'` | `CHECK IN ('COLLECTOR','STAFF')`: who saved last. |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Triggers:** `account_profiles_touch_updated_at`; `account_profiles_immutable_identity` guards `account_id`, `created_at`.
- **Written by:** `AuthService.registerAccount` when a sign-up gives the names (`insertSignUpProfile`, in the account's own transaction: the names and the answer); `ProfileService.save` (YOUR PROFILE, `PUT /api/v1/account/profile`) and `saveByStaff` (Client Services, a LOCKED account included, a DELETED one refused), each taking the account FOR NO KEY UPDATE, then the profile FOR UPDATE, then the tastes (§5.93), the same order everywhere, so two saves never deadlock; `accounts.display_name` and `accounts.country` follow in the same transaction. Audited `account.profile.update` with the fields' names, never a value; nothing changed, nothing written. The accounts made before the lot have no row until they save one.
- **Read by:** YOUR PROFILE (`GET /api/v1/account/profile`, with its completion line), the right-of-access export (`profile`, §16.13 of API), the console's Sign-up page's counts.
- **Size:** about 0.25 KB a row; one row per sign-up, then updated in place (plan §3.1 P.3.3: about 26 MB a year in the database at 100 sign-ups a day). The test entrants' pool gets no row.
- **Privacy:** personal data (names, phone, date of birth, city, Instagram), never written to `audit_logs`; the collector reads and changes all of it, the export gives it back.

### 5.93 `account_tastes`

Migration `0040_account_profiles` (plan CUSTOMER INTELLIGENCE §3.1, §3.2 W.3): **YOUR TASTES**, an account's favourite pieces (`PIECE`, a model's type) and finishes (`FINISH`, a variant's label), chosen in YOUR PROFILE from what THE COLLECTION shows (`services/tastes.ts`). Kept by their words, never by model id. Primary key `(account_id, kind, value_key)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` (the primary key leads it). |
| `kind` | `text` | NOT NULL | — | `CHECK IN ('PIECE','FINISH')` (`TASTE_KINDS`, mirrored in `db/schema.ts`). |
| `value_key` | `text` | NOT NULL | — | `account_tastes_key`: 1–60 characters, trimmed, single spaces, in capitals (`tasteKey`). |
| `label` | `text` | NOT NULL | — | The words as they read when chosen; `account_tastes_label`: normalises to `value_key`. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Index:** `account_tastes_key_idx (kind, value_key)`, for the counts and Segments of later steps.
- **Written by:** `TasteService.write`, inside the profile's save: the whole set replaced, at most 30 of each kind (`400 TASTES_TOO_MANY`), a new choice only among those offered now (`400 TASTE_UNKNOWN`); an unticked choice is a deleted row (the collector's own data, as `account_sizes`). A choice the collection no longer shows is **retired**: kept, read NO LONGER IN THE COLLECTION, never added anew. No audit of its own: the profile's `account.profile.update` counts the change.
- **Read by:** YOUR PROFILE, the right-of-access export (`tastes`, a retired one marked « (no longer in the collection) »).
- **Size:** about 0.11 KB a row, a few per profile. **Privacy:** the collector's tastes, personal data, never audited by their words.

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
| `RESERVED` | An identity reserved for a piece to make (migration `0022`, L6): serial, genome and warranty taken, never registered nor claimable; a code signed for its work sheet only | `reserveIdentity` (an order's or the stock's piece to make, §5.53), until plan NEXT LOT step 5.13: no identity is reserved any more, those reserved before stay so; never written in `product_status_history` | Unknown code (`PRODUCT_NOT_REGISTERED`), naming no piece |
| `ISSUED` | Code signed, not yet sold | Issuance (`IssuanceService.issueProduct`, the Generator, ADMIN), a reception's pieces (`issueStockIdentity`, §5.80), or, until plan NEXT LOT step 5.13, the atelier issuing a RESERVED identity (`confirmReservedIdentity`) | `AUTHENTIC` |
| `ACTIVATED` | Sold; warranty started | Warranty activation (from ISSUED), admin transition | Unowned: `AUTHENTIC_FIRST_REGISTRATION` |
| `REGISTERED` | Registered to an owner without proof (no claim code) | First registration without a claim code, admin transition | Owned: `AUTHENTIC_REGISTERED` / `AUTHENTIC_OWNERSHIP_VERIFIED` |
| `OWNED` | Registered with proof (claim code, or confirmed by client services) | First registration with claim code, ownership confirmation, admin transition | as above |
| `TRANSFERRED` | Changed hands through an accepted transfer | Transfer acceptance, admin transition | as above |
| `SERVICED` | In service: after-sales, or a pre-sale inspection / quality control (entered from ISSUED) | Opening a service record, admin transition | Unowned after sale: `AUTHENTIC_FIRST_REGISTRATION`; owned: as above. A pre-sale service is not open for first registration. |
| `RESOLD` | Resold through a channel | Admin transition only | Unowned: `AUTHENTIC_FIRST_REGISTRATION`; owned: as above |
| `RETIRED` | Out of circulation (terminal) | Admin transition; a RESERVED identity whose piece would not be made (`retireReservedIdentity`, until plan NEXT LOT step 5.13); a return to the archive | `REVOKED` |
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
| `RESERVED` | None through `transition`: its history started when the atelier issued it (null → ISSUED) or its piece was cancelled (null → RETIRED); since plan NEXT LOT step 5.13 neither happens, and the identities still reserved stay so. |

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

`OwnershipService` maintains it, and a return sets it back to UNREGISTERED when ORBES takes the ownership back (`OrderService.returnOrder`, §5.54). Admin status transitions through `POST /api/admin/products/:productId/transitions` change `status` only.

A return also moves the piece through the lifecycle (`LifecycleService`, audited `product.transition`): back to stock, RESOLD, ready to be sold again (ISSUED if it was never sold: it stays); to the archive, RETIRED. A piece whose record says it is in service, lost, stolen or flagged cannot go back to stock (`409 ORDER_RETURN_NOT_RESTOCKABLE`), only to the archive.

### 7.4 Order steps

An order (§5.51) moves through `ORDER_TRANSITIONS` (`services/orders.ts`) only: RESERVED → PAID | CANCELLED; PAID → SHIPPED | CANCELLED; SHIPPED → DELIVERED | RETURNED; DELIVERED → RETURNED; CANCELLED and RETURNED are final (`409 ORDER_TRANSITION_NOT_ALLOWED`). PAID needs its price (`409 ORDER_PRICE_MISSING`) and issues its invoice; SHIPPED needs an active carrier, a tracking number and its piece linked and in stock at its location (`409 ORDER_PIECE_NOT_LINKED`, `ORDER_NOT_READY`), and takes it out of the ledger (SHIPPED −1); DELIVERED comes from the console, or from the registration of its piece by its own account while SHIPPED; CANCELLED, with a note, releases the piece held or cancels the piece to make (its identity retired) and credits a paid invoice; RETURNED (§5.54) restocks the piece (RETURNED +1, a new claim code) or archives it, takes an ownership back, and credits the invoice. Each step writes its event (§5.52), its audit entry and its journal entry (§5.56) in its transaction.

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
| `accounts … FOR SHARE` | Transfer initiation, a LOST / STOLEN declaration and the creation of a certificate link (§5.27), before the product: a request made while a recovery or a lock commits waits for it, then sees the pause or the lock (`403 ACCOUNT_LOCKED`). |
| `sessions … FOR SHARE` | The creation of a certificate link (§5.27), after the account's share lock and before the product: the request's own session, read again. A recovery or a password change deletes the account's sessions under the account's row lock, so a creation that waited for one finds its session gone (`401 UNAUTHORIZED`) and writes nothing. |
| `models` and `categories … FOR SHARE` | Issuance, in its transaction: the model's and the category's `active` are read again, so a deactivation that committed while the piece was prepared refuses it (`409 MODEL_INACTIVE`, `409 CATEGORY_INACTIVE`). |
| `models … FOR UPDATE`, `categories … FOR NO KEY UPDATE` | A model's edit (its lookbook included, P-R02), a category's activation or deactivation (A-10): waits for an issuance under way (its share lock above), and an issuance waits for it. A change of a model's gallery (§5.28) locks the model's row first too, so two changes of one gallery run one after the other. |
| `collections … FOR UPDATE` | A collection's rename (A-10): two renames run one after the other. |
| `drops … FOR SHARE` | An entry and a withdrawal (§5.30), after the account's share lock, and the withdrawal of an account's entries by a lock: a draw or a console action under way finishes first. |
| `drops … FOR UPDATE` | The draw and every console action on a release or its entries (§5.29): they run one after the other, and an entry waits for them. A direct reservation of the early access (P-X02, §5.30), after the account's share lock: the places are counted one request after the other, within `quantity`. |
| `circle_posts … FOR UPDATE` | Every console change of a post and of its photographs (§5.31, §5.32), and an answer to an invitation (§5.33), after the account's share lock: the YES are counted under it, so they never pass the capacity. |
| `circle_posts … FOR SHARE` | A vote in a poll (§5.34), after the account's share lock: a change of the poll's options waits for it, then is refused. |
| `club_tiers … FOR UPDATE` | A change of a tier's words (§5.36). |
| `accounts … FOR SHARE` (the private salon) | A request of THE PRIVATE SALON (§5.37), before its insert: a lock under way finishes first, closes the account's open requests and refuses this one; one that starts after it waits for the request, then closes it. |
| `shop_requests … FOR UPDATE` | The console's closing of a request (§5.37): two closings run one after the other, and the second is refused (`409 SHOP_REQUEST_CLOSED`). |
| `models … FOR UPDATE` (DISCONTINUED) | A model discontinued or reinstated (P-R06, §5.3), like its edit: an issuance under way finishes first, and then reads it inactive. |
| `models … FOR UPDATE` (ADD A VARIANT), `models … FOR SHARE` (`models_variant_rules`) | ADD A VARIANT (plan NOCTURNE, §5.3) locks the main model while it gives it its own label and inserts the variant; the trigger reads a variant's main model `FOR SHARE`, so a variant added while its main model is being made a variant waits, then is refused by the rules read again (never a chain). |
| `drops … FOR UPDATE` (a LIVE RELEASE) | The engine's pass on a release (one transaction: the line at T0, the turns and holds that ran out, the end, the turns), and every action that changes a count: ENTER, CHANGE SIZE, LEAVE, PAY, RELEASE, and every console control (pause, resume, extend, add pieces, free, let in, message, end, remove, the board's link, the settings, the reservations' outcome). They run one after the other. |
| `drops … FOR SHARE` (a LIVE RELEASE) | The actions that change no count: I'LL BE THERE and its withdrawal, PRESS, SECURE, the add-ons; after the account's share lock. |
| `live_entries … FOR UPDATE` | The account's own entry in each of its actions, after the release's row; the entry a console control acts on; a lock's removal of an account's open entries (after the releases' rows, by id). |
| `drop_sizes … FOR UPDATE` | ADD PIECES, after the release's row. |
| `orders … FOR UPDATE` | Every change of an order (§5.51): a step, a return, its location, terms, buyer or piece; after the source's rows when the sale creates it (the release, then the entry; the request). The registration that delivers an order takes the piece's row first, then the order. |
| `skus … FOR UPDATE` (`lockSku`) | Every change of a SKU's stock or of its reservations (§5.48): an order holding or releasing a piece, a movement, a transfer, a count corrected, a reception's pieces issued (the atelier's piece finished, until plan NEXT LOT step 5.13); after the order's row, by SKU id when several. Two orders never take the same last piece. |
| `bench_items … FOR UPDATE` | A piece to make started, finished, cancelled or moved with its order (§5.53), after its order's and its SKU's rows; nothing takes it since the atelier's removal (plan NEXT LOT step 5.13). |
| `accounts … FOR SHARE`, then `drops … FOR UPDATE`, then the entry, then `house_guarantees` | A house's guarantee granted (§5.69, IN-01): the account, the release it is set aside for (each candidate in the order of the openings for the next release of a model or collection), the client's waiting entry there (bound in the same transaction), then the insert. ENTER, RESERVE and a LIVE entry take the release, then the entry, then the holder's guarantee `FOR UPDATE`. A change or a revocation **reads** the guarantee, locks its release `FOR UPDATE`, then locks the guarantee and checks it is still set aside there. |
| `accounts … FOR UPDATE`, then `care_requests` | A yearly care asked for or cancelled by the collector (§5.68, BP-19 T6): the account first, then the year's requests counted (two requests at once by a PLATINE account: one wins). |
| `care_requests … FOR UPDATE`, then `products` | A step of the yearly care in the console (§5.68): the request, then the piece through `WarrantyService` (its service record), in one transaction. |
| `tier_grants … FOR UPDATE` (the credit) | APPLY CREDIT (§5.67, plan NEXT-NINE, BP-19 T5), after the order's row: the account's CREDIT grants, so two applications at once never take more than a grant's balance. |
| `tier_grants … FOR UPDATE` (the welcome gift) | A sale's welcome gift (`attachGifts`, §5.66), after the sale's rows and its order's: the account's GIFT grants, then their open GIFT orders read again, so two sales at once never give one grant two gifts. |
| `segments … FOR KEY SHARE` | A release's or a post's segment chosen (§5.58): a deletion under way finishes first, then refuses the release or the post, or waits for it and is refused (`409 SEGMENT_IN_USE`). |

Lock order is **product before code**, **product before service record** and **account before product** (a recovery or a lock locks the account, then its open certificate links, then the products of its pending transfers, in product order), everywhere, so concurrent operations cannot deadlock on these pairs (a certificate link's row is otherwise locked only by its owner's withdrawal, which takes no other row lock). The audit chain's advisory lock (§8.3) comes **last**: a transaction locks its rows, then records its audit entries (`cancelPendingTransfersFrom` locks and updates every product first, then audits each cancellation; `OwnerService.lock` revokes the recovery code, withdraws the certificate links and the entries in releases, §5.30, and closes the requests of the private salon, §5.37, before it cancels the transfers, and audits the links, the entries and the requests after them; a recovery does the same for the links). **Account before release**: an entry, a withdrawal, a reservation and a lock take the account's row, then the release's. **Account before post**: an answer and a vote take the account's row, then the post's. **Account before request**: a request of the private salon takes the account's row (`FOR SHARE`) before it inserts; a lock takes the account's row, then updates its open requests. **Account, release, entry** for the LIVE RELEASES: each customer action takes the account's row (`FOR SHARE`), then the release's, then its entry's, and reads the clock once it holds them; a lock takes the account, then the releases of its open entries (by id), then the entries; every transaction writes its audit entries last. **Source, order, SKU, piece** for the orders (LIVE RELEASE+): the sale's rows (the release, then the entry; the request), then the order, then its SKUs (by id), then the piece to make and its identity (the serial's advisory lock), then the invoice numbers' advisory lock, the journal, and the audit chain last; a return takes the piece returned before the order (as a registration does), then the SKU, the piece's ownership and its transfer. **Order, then grants** for the tiers' benefits (plan NEXT-NINE, BP-19 T5): APPLY CREDIT takes the order's row, then the account's CREDIT grants; a sale takes its source's rows and its order's, then the account's GIFT grants, before it creates the gift's order.

### 8.3 Advisory locks

Transaction-scoped advisory locks (`pg_advisory_xact_lock`, released at COMMIT or ROLLBACK) through `advisoryXactLock(trx, key, subKey?)`, which refuses to run outside a transaction; one session-level lock, `LIVE_ENGINE`, below. The keys share one `"OR"` namespace (`0x4F52…`) so services never collide.

| Name | Key | Serialises |
|---|---|---|
| `AUDIT_CHAIN` | `0x4F520001` | Audit appends: id allocation, predecessor lookup and insert, so `prev_hash` links follow commit order even across instances. Held until the commit: a transaction records its audit entries after taking its row locks (§8.2). |
| `CATEGORY_ALLOCATION` | `0x4F520002` | Category creation (lowest free index 1–31). |
| `SERIAL_ALLOCATION` | `0x4F520003`, sub-key `(year − 2000) × 32 + category index` | Serial allocation per (year, category) at issuance. Two-part (int4, int4) form. |
| `KEY_ROTATION` | `0x4F520004` | Key rotation, first-key creation, retirement and revocation. |
| `ANOMALY_UNREGISTERED` | `0x4F520101` | Recording of findings without a product id (`VALID_SIGNATURE_UNREGISTERED`), which the partial unique index cannot deduplicate. `services/anomaly.ts` keeps `ANOMALY_UNREGISTERED_LOCK` as an alias. |
| `ADMIN_ROSTER` | `0x4F520201` | Role changes and (de)activation of console users (`AuthService.setAdminRole`, `setAdminDisabled`): the last-active-ADMIN check sees every concurrent change, so two ADMINs disabling each other at once cannot leave none. |
| `LIVE_ENGINE` | `0x4F520301` | **Session-level**, not transaction-scoped: the engine of the LIVE RELEASES (`services/live-engine.ts`) takes it with `pg_try_advisory_lock` on a connection it keeps from its pool while it leads, so one process ticks, even when two overlap during a deployment; the others try again every second and take over within one when the leader stops (its connection closed, the lock released). |
| `INVOICE_NUMBER` | `0x4F520401`, sub-key `year × 2 + kind` | The numbers of the invoices and credit notes (§5.55), per kind and UTC year: taken after the order's row and its SKU, before the audit chain's; two orders paid at once never share a number. |
| `SHOPIFY_PRODUCT` | `0x4F520501`, sub-key a hash of the Shopify product id | The Shopify ids pasted back for a model (§5.47): two links of one product run one after the other. |

In PostgreSQL, single-key (bigint) and two-key (int4, int4) advisory locks occupy separate key spaces. Kysely's migrator uses its own session-level advisory lock (§9.2).

---

## 9. Migrations

### 9.1 Layout

- Migrations are listed statically in `MIGRATIONS` in `db/migrate.ts` (imports, not a directory scan, so they still work when the server is bundled): `0001_initial` (the schema), `0002_platform_guards` (append-only `product_status_history`, no deletion of `genomes` and `cryptographic_keys`, the customer login throttle columns of `accounts`), `0003_authentication_events_default` (`authentication_events.authenticators` defaults to `'{}'`), `0004_scan_reports` (customers' reports on scans and the Cases queue, §5.22; its down step drops the table and nothing else), `0005_account_recovery` (the recovery codes of §5.23 and `accounts.transfers_frozen_until`; its down step drops the column and the table, which restores the schema of `0004` exactly), `0006_admin_password_change_required` (`admin_users.password_change_required`, boolean NOT NULL DEFAULT false: the temporary password of a staff account created from the console; its down step drops the column, which restores the schema of `0005` exactly, after ending the sessions of the accounts that still hold their temporary password and disabling them (`disabled_at` set, an earlier date kept): without the flag, such an account would sign in with a password an ADMIN was shown and use its full role for good. Re-enabling one after a rollback would let that password in; create a new account for the member instead), `0007_print_batch_indexes` (indexes `products_production_batch_idx` and `codes_created_at_idx`, for printing by production batch; indexes only, so the previous application version runs on it unchanged), `0008_retail_mode` (A-08, the sale mode: the RETAIL role in the `admin_users.role` CHECK, the `retailers` register (§5.25), `warranties.retailer_id`, `scan_events.admin_id` with its ADMIN_TEST-only CHECK, and the `SALE_ACTIVATION` purpose of `scan_tokens`; every new column nullable, so the previous image runs on it. Its down step restores the 0006 schema exactly: it first copies each warranty's point-of-sale name into an empty free-text `retailer`, deletes the outstanding SALE_ACTIVATION tokens and the sessions of the RETAIL accounts, and keeps those accounts but stops them working: each becomes AUDITOR, the lowest role the previous schema knows, and disabled (`disabled_at` set, an earlier date kept), so it cannot sign in. They are not deleted because other tables point to a console user with ON DELETE RESTRICT (0004 `scan_reports.handled_by`, 0005 `account_recovery_codes.created_by`): a member of the team who handled a case or issued a recovery code, then was stepped down to RETAIL on the Team page, would make the delete, and with it the whole rollback, fail; the audit log keeps their history by id either way. Trade-off: an ADMIN who re-enables such an account after a rollback gives it AUDITOR rights, so check its role first), `0009_scan_daily_stats` (the table `scan_daily_stats`, §5.24, which the previous version ignores; its down step drops it), `0010_models_active` (A-10: `models.active`, true for every existing model, and the trigger `models_immutable_identity` on a model's category and SKU prefix, §5.3; additions an older image ignores; its down step drops the trigger and the column and nothing else), `0011_scan_token_transfer_accept` (F-03: the `TRANSFER_ACCEPT` purpose of `scan_tokens`, §5.17; the CHECK is dropped and re-created with the three purposes, those of 0008 kept; the previous image never writes the new purpose. Its down step deletes the outstanding `TRANSFER_ACCEPT` tokens, 15-minute proofs nothing refers to, and restores the CHECK of 0008 exactly, `SALE_ACTIVATION` included), `0012_media` (F-04: the table `media_objects`, §5.26, and the nullable foreign keys `models.image_sha256` and `products.photo_sha256`, each at the head of its own index; additions an older image ignores, showing no photograph; its down step drops the two columns with their indexes, then the table and every photograph in it, which restores the schema of the previous migration exactly), `0013_ownership_certificates` (F-06: the table `ownership_certificates`, §5.27, which the previous image ignores; its down step drops it and nothing else, the certificates with it: their links then answer 404 once the newer image is back), `0014_model_lookbook` (P-R02: the lookbook columns of `models`, §5.3, `slug` unique and lower-case, `lookbook` HIDDEN by default so every existing model stays out of the lookbook, `story`, `specs`, `published_at`, each nullable or with a constant default so the previous image runs on it; and the table `model_images`, §5.28, which it ignores; its down step drops the table, then the columns with their constraints and unique index, which restores the schema of `0013` exactly, the galleries and the sheets' words with them), `0015_drops` (P-R03: the tables `drops` and `drop_entries`, §5.29 and §5.30, which the previous image ignores; its down step drops both, the releases and their entries with them, which restores the schema of `0014` exactly), `0016_circle` (P-X01: the five tables of the owners' circle, `circle_posts`, `circle_post_images`, `circle_rsvps`, `circle_poll_votes` and `circle_daily_visits`, §5.31 to §5.35; nothing in an older image reads or writes them; its down step drops the five tables, the posts, their photographs' rows, the answers, the votes and the visits with them, which restores the schema of `0015` exactly), `0017_drop_early_access` (P-X02: `drops.early_access_hours`, smallint NOT NULL DEFAULT 48 with its CHECK 0–336, §5.29; a column with a constant default the image of `0015` never names, so it runs on it; a direct reservation is a row of `drop_entries` with no new column; its down step drops the column, its CHECK with it, which restores the schema of `0016` exactly), `0018_club_tiers` (P-X04: the table `club_tiers`, §5.36, with no row; nothing in an older image reads it; its down step drops it, the console's words with it, which restores the schema of `0017` exactly), `0019_model_discontinued` (P-R06: `models.discontinued_at` and `discontinued_by`, both nullable, the CHECKs `models_discontinued_inactive` and `models_discontinued_by_when` and the index `models_discontinued_by_idx`, §5.3; compatible with the previous image, which never names the two columns and inserts models without them, and no row has a date until the new image discontinues one; its down step drops the index, the two CHECKs and the columns, the foreign key with its column, which restores the schema of `0018` exactly), `0020_private_salon` (P-X08: `models.price_label`, nullable, and `models.private_min_tier`, smallint NOT NULL DEFAULT 1, each with its CHECK, §5.3, and the table `shop_requests`, §5.37, with its indexes and trigger and no row; compatible with the previous image, which never names the two columns, inserts models without them (the constant default fills `private_min_tier`) and never reads the table; its down step drops the table, then the two CHECKs and the columns, which restores the schema of `0019` exactly, the requests and the prices with them), `0021_live_release` (the LIVE RELEASE, plan of 2026-10-04: `drops.mode`, DRAW by default, and the LIVE columns of `drops`, §5.29, each nullable or with a constant default, which the previous image never names; the eight tables of §5.38 to §5.45, which it ignores; no row inserted. Its down step first withdraws the posts of the circle linked to a LIVE drop and still to come (`published_at` to NULL: the previous image would show them at their time), then cancels every LIVE drop, which the previous image would read as a draw, then drops the eight tables, and the constraints, indexes and columns of `drops`: the schema of `0020` exactly), `0022_orders_stock` (LIVE RELEASE+, plan of 2026-10-04: the twelve tables of §5.46 to §5.57, `products.sku_id` and the RESERVED status, `drop_sizes.sku_id`, `drops.stock_location_id`, `shop_requests.outcome`, `models.base_price_minor`, `base_currency` and `care_guide`, `accounts.shopify_customer_id`; new nullable columns and tables the image of `0021` never names, no row inserted (the first boot of the new image creates the locations and carriers, §9.4). Its down step revokes the codes of the identities still RESERVED and retires them (the previous image has no such status; their serials stay taken), drops the twelve tables, then the columns and constraints it added: the schema of `0021` exactly), `0023_releases_collectors` (LIVE RELEASE+: the LIVE+ columns of `drops`, §5.29, every one NULL for a DRAW, `circle_posts.segment_id`, and the four tables of §5.58 to §5.61, which the previous image ignores; no row inserted. Its down step cancels the after-rooms that have not ended (the previous image would show them as releases of their own), drops the four tables, then the columns and constraints: the schema of `0022` exactly), `0024_model_variants` (plan NOCTURNE: the variants of a model, `models.variant_of`, `variant_label` and `variant_swatch` with their CHECKs, the index that leads the new foreign key, the unique label per model and the trigger `models_variant_rules`, §5.3; and a draw's price, `drops.price_minor` and `currency` now allowed on a DRAW, both or neither, `drops_draw_price`, with `drops_draw_fields` re-created without them, §5.29. Three nullable columns the previous image never names, and a draw's price it never reads; no row inserted. Its down step clears the draws' prices (the previous `drops_draw_fields` refuses them), restores that CHECK as `0021` wrote it, then drops the trigger, its function, the indexes, the constraints and the columns: the schema of `0023` exactly, each variant then a model of its own, as it was), `0024_z_test_entrants` (TEST ENTRANTS, 2026-10-07: the tables `test_entrants`, `test_runs` and `test_run_entrants`, §5.73 to §5.75, which the previous image ignores; no row inserted. Named so that it sorts after `0024_model_variants` and before the next lot's `0025` both by code unit (Kysely, which refuses migrations out of order) and in a locale's collation, which passes over the `_` (psql's `ORDER BY`, as deploy.sh lists them). Its down step drops the three tables, the pool's accounts staying plain accounts: the schema of `0024` exactly), `0025_client_messages` (plan NEXT-NINE, CS-01: the tables `client_conversations` and `client_messages`, §5.62 and §5.63, which the previous image never reads; no row inserted; its down step drops the two tables: the schema of `0024_z` exactly), `0026_club_program` (plan NEXT-NINE, BP-19 T2, T3 and T7: the tables `club_program_settings` and `shipping_rates`, §5.64 and §5.65, `drops.early_access_platine_hours` with `drops_platine_window` and `drops_live_platine`, §5.29, and `circle_posts.experience` with `circle_posts_experience`, §5.31; two tables the previous image never reads and nullable columns it never names; no row inserted; its down step drops the constraints, the columns and the two tables: the schema of `0025` exactly), `0027_tier_grants` (plan NEXT-NINE, BP-19 T4 and T5: the tables `tier_grants` and `credit_uses`, §5.66 and §5.67, the orders' `with_order_id`, `gift_grant_id` and shipping columns with their CHECKs and indexes, the channel GIFT, `orders_source` and the identity guard re-created, §5.51; two tables and nullable columns the previous image never reads, and no GIFT order until this image adds one; no row inserted. Its down step refuses, naming the counts, while any GIFT order or credit use exists; otherwise it restores 0022's channel CHECK, `orders_source` and guard, drops the columns and the two tables: the schema of `0026` exactly), `0028_yearly_care` (plan NEXT-NINE, BP-19 T6: the table `care_requests`, §5.68, and YEARLY_CARE in the service records' type CHECK, §5.15; a table the previous image never reads and a CHECK that only widens; no row inserted. Its down step refuses, naming the counts, while any care request or YEARLY_CARE record exists; otherwise it drops the table and restores 0001's CHECK: the schema of `0027` exactly), `0029_house_guarantee` (plan NEXT-NINE, IN-01: the tables `house_guarantees` and `guarantee_settings`, §5.69 and §5.70, `drop_entries.guarantee_id` and `pieces` with `drop_entries_guaranteed`, `drop_entries_pieces` and `drop_entries_guarantee_key`, §5.30, `live_entries.guarantee_id` with `live_entries_guarantee_key`, §5.39, `orders_drop_entry_key` on `(drop_entry_id, piece)` and `orders_source` rebuilt from `0027`'s, its piece clause `channel IN ('LIVE','DRAW') OR piece = 1`, §5.51; tables the previous image never reads, columns nullable or with a constant default it never names; no row inserted. If the previous image runs a draw during the deployment, `drop_entries_guaranteed` refuses its update of a guaranteed entry and the draw fails closed: draws wait for the new image. Its down step refuses, naming the count, while any DRAW order has a piece above 1; otherwise it restores `0027`'s `orders_source` and `orders_drop_entry_key`, drops the entries' columns and constraints, then the two tables: the schema of `0028` exactly), `0030_account_sizes` (plan NEXT-NINE, AC-01: the table `account_sizes`, §5.71, `models.size_kind`, §5.3, `skus.fit_min_mm` and `fit_max_mm` with `skus_fit`, §5.47, and `shop_requests.size_label`, §5.37, with `shop_requests_immutable_identity` created again to guard it; a table the previous image never reads and nullable columns it never names; no row inserted; its down step drops them and creates 0020's trigger again: the schema of `0029` exactly), `0031_model_pairs` (plan NEXT-NINE, BP-34: the table `model_pairs`, §5.72, which the previous image never reads; no row inserted; its down step drops it: the schema of `0030` exactly), `0032_growth_indexes` (plan NEXT-NINE, BP-29 GROWTH: three indexes, `accounts_created_at_idx (created_at)` §5.9, `ownership_account_started_idx (account_id, started_at)` §5.12 and `orders_paid_idx (account_id, paid_at) WHERE paid_at IS NOT NULL` §5.51, that GROWTH reads on; no table, column, constraint or trigger, no snapshot table; the previous image never names them; its down step drops the three: the schema of `0031` exactly), `0033_model_sizes` (plan NEXT LOT of 2026-10-07, §3.3, deployment H1: `models.size_type` with `models_size_type_check` and `models_size_type_kind` §5.3, `skus.set_aside_at` and `set_aside_by` with `skus_set_aside`, `skus_set_aside_by_idx` and `skus_model_offered_idx` §5.47; nullable columns the previous image never reads, no row written: every SKU stays an offered size, every model's type NULL; its down step drops them: the schema of `0032` exactly), `0034_claim_code_renewals` (plan NEXT LOT, §3.4, deployment H1: the table `claim_code_renewals` §5.76; a new table the previous image never reads, no row inserted: every piece keeps its hash; its down step drops it: the schema of `0033` exactly), `0035_logistics_access` (plan NEXT LOT, §3.5.5.1, deployment H2: LOGISTICS in `admin_users_role_check` §5.10, the tables `suppliers` §5.77 and `admin_user_locations` §5.90, `stock_locations.address` §5.46, `models.supplier_id` §5.3 and `skus.supplier_id` §5.47, each foreign key led by its index; tables and nullable columns the previous image never reads, a role it ranks 0; no row written. Its down step refuses, naming the count, while a LOGISTICS login exists; otherwise it drops them and restores 0008's role CHECK: the schema of `0034` exactly), `0036_supplier_orders` (plan NEXT LOT, §3.5.5.2, deployment H2: the tables `supplier_orders`, `supplier_order_lines`, `receptions`, `reception_lines`, `card_prints`, `supplier_returns` and `stock_corrections` §5.78 to §5.84, the ledger's RECEIVED with `stock_movements.reception_line_id` and `stock_movements_received`, `stock_movements_reason_check`, `_sign` and `_order` rebuilt §5.48, `products.reception_line_id` and `stock_entered_at` §5.4, backfilled from each piece's earliest PRODUCED movement; tables the previous image never reads, a reason it never writes, nullable columns it never names. Its down step refuses, naming the counts, while any supplier order, reception or stock correction exists; otherwise it drops them in reverse and restores 0022's three CHECKs: the schema of `0035` exactly), `0037_fulfilment` (plan NEXT LOT, §3.5.5.3, deployment H2: `orders.reservation` AWAITING in place of BENCH (its rows moved), `queue_first` and `orders_awaiting_idx`, the channel EXCHANGE with `exchange_of_order_id` and `orders_source` rebuilt, `packing_started_at` and `orders_packing`, the identity guard with `exchange_of_order_id` §5.51; the tables `shipments`, `shipment_items` and `order_cases` §5.85 to §5.87; `order_alert_settings.ready_days` 5, a stored 3 made 5 §5.57; the open pieces to make cancelled, their reserved identities left as they are §5.53. Not compatible with the previous image, which reads BENCH: H2 ships as one deployment. Its down step refuses, naming the counts, while an AWAITING or EXCHANGE order, a shipment or an order case exists; otherwise it restores 0022's reservation CHECK, 0029's channel CHECK and `orders_source`, 0027's identity guard and the default 3: the schema of `0036` exactly), `0038_draw_sizes` (plan NEXT LOT, §3.6.F, deployment H2: `drop_entries.size_id`, the size an entry chose, with the composite foreign key `drop_entries_size_fkey` to a size of its own release and the index `drop_entries_size_idx`; `drop_sizes` serves a draw too §5.38. Compatible with the previous image: a nullable column it never names. Its down step refuses, naming the count, while a published draw has sizes; otherwise it drops the index, the foreign key and the column: the schema of `0037` exactly), `0039_order_delivery` (plan NEXT LOT, §3.6.B and §3.6.C, deployment H2: YOUR ADDRESSES, `account_addresses` §5.88; the order's `buyer_country`, `buyer_phone`, `address_by`, `address_at` and `address_changed_at`, none on an order travelling with another, `address_by` set STAFF on the orders of before with an address that do not travel; `engraving_prices` §5.89, the order's `engraving_minor` and `engraving_by`, STAFF on the engravings of before; the invoices' `supplements_invoice_id` and `credit_scope`, FULL on the credit notes of before, `invoices_one_per_order` rebuilt without the supplementary invoices and `invoices_credits_key` replaced by `invoices_full_credit_key` with `invoices_credits_idx` leading its foreign key, §5.55. Compatible with the previous image: a table it never reads and nullable columns it never names. Its down step refuses, naming the counts, while a supplementary invoice or a credit note for single lines exists; otherwise it drops the rest and restores 0022's invoice keys: the schema of `0038` exactly), `0040_account_profiles` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1, deployment I1: the tables `heard_options`, `account_profiles` and `account_tastes` §5.91 to §5.93, each foreign key led by an index; tables the previous image never reads, no `ALTER TABLE accounts`, no row inserted (the first boot of the new image creates the answers, §5.91); its down step drops the three tables: the schema of `0039` exactly), and any later entry of `MIGRATIONS`. The application now runs on `0001` to `0040`. Numbers follow the planned deployment order of the 2026-10-02 recommendations (0004 to 0013) and of the « Potentiel » plan of 2026-10-03 (0014 to 0018 in its deployment A, 0019 and 0020 in its deployment B+C, stages B and C combined by the owner on 2026-10-04: [the runbook](launch/DEPLOY-POTENTIEL-2026-10.md)) and of the LIVE RELEASE plan of 2026-10-04 (0021, deployment D: [its runbook](launch/DEPLOY-LIVE-RELEASE.md)) and the LIVE RELEASE+ plan of the same day (0022 and 0023, deployment E: [its runbook](launch/DEPLOY-LIVE-RELEASE-PLUS.md)) and of the NOCTURNE plan of 2026-10-05 (0024, its own deployment, after E) and of TEST ENTRANTS of 2026-10-07 (0024_z, its own lot, after F) and of the plan of the next nine of 2026-10-06 (0025 to 0032, deployment G, after F) and of the next lot of 2026-10-07 (0033 to 0039, deployments H1 and H2, after G) and of the customer intelligence plan of 2026-10-08 (0040 on, deployments I1 and I2, after H2), each migration keeping its number whatever the order of development.
- A migration is a list of SQL strings executed one by one: PGlite runs queries through the extended protocol, which refuses multi-statement strings.
- Value lists for `CHECK` constraints are literal in the migration, so a migration never changes when application constants evolve; a test asserts they still match `schema.ts`.
- Rules: append new migrations to `MIGRATIONS`; never edit an applied migration.
- **Numbers follow the order of deployment, and a database applies them in that order only.** Kysely's migrator refuses a migration numbered below one already applied (unordered migrations are not allowed). The numbers `0004`–`0013` are reserved, lot by lot, by the plan of the 2026-10-02 recommendations, and a branch may carry a higher number before the lower ones exist, as `0010_models_active` once did before `0006`–`0009` were merged, and as `0013_ownership_certificates` (F-06) did before the `0012` of F-04 (`media_objects`) was merged. Such a tip must not reach a database that will later need the lower numbers: deploy the lots in their order, each with all of its migrations.
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
- in development and test, creates a signing key when none is ACTIVE; in production, runs a signing self-test instead and logs an error (issuance unavailable, verification unaffected) when there is no usable ACTIVE key. An ADMIN then creates one with `POST /api/admin/keys/rotate`, or an operator with `npm run keys:generate`;
- prepares the stock and the orders (`OrderService.prepare`, LIVE RELEASE+): the locations FRANCE WAREHOUSE (the default) and LOGISTICS WAREHOUSE and the carriers Colissimo, Chronopost, DHL Express and UPS, inserted only while their tables are empty (`stock.setup`, once); the pieces and the sizes on sale linked to their SKUs (`linkSkus`); and the orders of the sales confirmed without one (a LIVE entry CONFIRMED, its resolution CONCLUDED mapped to PAID and CANCELLED to CANCELLED; a draw's entry CONFIRMED). Idempotent: `stock and orders ready` in the log when it did anything.
- makes the tiers' grants (`TierGrantService.prepare`, plan NEXT-NINE, BP-19 T5): the welcome gift and the credit of every ACTIVE account already at PLATINE or PALLADIUM, each account in its own transaction, once per tier and per account (§5.66). Idempotent: `tier grants ready` in the log when it made any; a failure is logged and left to the next boot or the account's next status read.

---

## 10. Housekeeping and retention

`startHousekeeping()` runs every 10 minutes in the server process (never overlapping runs):

| Job | Effect |
|---|---|
| Sessions | Deletes sessions whose `expires_at` has passed. |
| Transfers | Marks overdue PENDING transfers EXPIRED and recomputes the product's `ownership_state`. |
| Scan tokens | Deletes scan tokens that expired more than 24 hours ago. |
| Scan statistics | Counts the scans of every complete UTC day not counted yet into `scan_daily_stats` (§5.24) by country, state and event type, `ADMIN_TEST` left out (`src/server/services/scan-stats.ts`). Idempotent; always runs before the scan history job. |
| Activity by hour | LIVE RELEASE+ (G3): counts the sign-ins (`account.login`, `account.register`) and the public scans of every complete UTC hour not counted yet (10 minutes after its end) into `activity_hourly` (§5.61) by country and tier, never an account, all the hours of a pass in one transaction (`aggregateActivity`, `services/activity.ts`); the console's best time to open runs it again before reading. After the scan statistics, before the scan history job: no scan leaves the history uncounted. |
| Packing photos | Plan NEXT LOT §3.5.6.8: erases `shipments.photo` (§5.85; `photo_erased_at` set, journaled `shipment.photo.erase`, never the photo) 14 days after its parcel was delivered (`RETURN_WINDOW_DAYS`, `purgePackingPhotos`, `services/parcels.ts`), unless a return or an exchange of its orders is open (erased once it is closed or cancelled); for a parcel never delivered, 14 days after its parcel problem was decided or cancelled (never while one is open), or 14 days after its shipment was cancelled while packing (Default (mine)). The photo is internal: seen by ORBES and the agent only. |
| Yearly care labels | Erases `care_requests.label_pdf` (§5.68) 30 days after its request ended, DONE or CANCELLED (`CARE_LABEL_RETENTION_MS`, `eraseCareLabels`, `services/care.ts`): the prepaid label is kept while it may be printed, and for its aftermath only. |
| LIVE networks | Erases `live_entries.network_hash` (§5.39) for every release ended or cancelled 30 days ago or more (`LIVE_NETWORK_RETENTION_DAYS`, `eraseLiveNetworkHashes`, `services/live.ts`): the bot radar's keyed hash of an entry's network is kept for the release and its aftermath only. |
| Scan history | Only when `SCAN_RETENTION_DAYS` is set, and only when the scan statistics of the same pass succeeded (a scan never leaves the history before it is counted): deletes `scan_events` whose `occurred_at` is older than the period, together with the `scan_reports` (a customer's report, open or closed), `scan_tokens` and `authentication_events` that reference them (deleted first: the foreign keys are `ON DELETE RESTRICT`); in the same transaction, a message to ORBES Client Services written about one of them (`client_messages.scan_event_id`, no foreign key, §5.63) loses the scan's id and keeps its REF. Batches of 1 000 scan events, one short transaction each, at most 50 batches per pass, oldest first (`src/server/services/scan-retention.ts`). |

Rows deleted by the application: `sessions`, `scan_tokens`, and, with a retention period, old `scan_events` with their `authentication_events` and `scan_reports`; and, outside housekeeping, a photograph of `media_objects` as soon as no model, no gallery, no circle post, no LIVE RELEASE's silhouette and no piece uses it (§5.26), a gallery's row when the console removes its photograph (§5.28), a circle photograph's row likewise (§5.32), and a tier's row when the console restores its words by default (§5.36). Every other table grows monotonically: `drops` and `drop_entries` (§5.29, §5.30) keep every release and every entry, withdrawn, reserved or concluded, as long as the account exists; `shop_requests` (§5.37) keeps every request of the private salon, open or closed, with the account's note and the console's closing note, as long as the account exists (exported with it, API §16.13; a lock closes the open ones, it deletes none); `circle_posts` keeps every post, withdrawn or not; `circle_rsvps` and `circle_poll_votes` keep the answers and votes as long as the account exists (exported with it, API §16.13); `circle_daily_visits` keeps a count per day, which names nobody; the LIVE RELEASES (§5.38 to §5.45) keep every release, size, entry and its add-ons as long as the account exists (exported with it), but `live_interest` loses a row when its account withdraws it, `live_entry_addons` when a piece is given back or a hold ends, and `live_entries.network_hash` is erased 30 days after the release's end (above); `live_messages` keeps every line. LIVE RELEASE+ (§5.46 to §5.61): the stock ledger, the orders' history, the returns, the invoices and credit notes and the event journal are never changed nor deleted; `orders`, `bench_items` and `after_room_guests` keep every order, piece to make and guest; `release_answers` keeps each account's answer, changed in place, as long as the account exists (exported with it); `segments` keep their rules until the console deletes one (never a member); `activity_hourly` keeps its counts, which name nobody; `sku_thresholds` loses a row when its minimum is cleared. MESSAGES (§5.62, §5.63): `client_conversations` and `client_messages` keep every conversation and message as long as the account exists (exported with it, API §16.13; the database refuses a message's deletion); only a message's `scan_event_id` is cleared, with its scan. The yearly care (§5.68): `care_requests` keeps every request, cancelled or done, with its return address, as long as the account exists (exported with it; the database refuses its deletion); only its `label_pdf` is erased, 30 days after it ends (above). YOUR SIZES (§5.71): `account_sizes` keeps a saved size until its account clears it, which deletes its row (exported with the account, API §16.13). PAIRS WELL WITH (§5.72): `model_pairs` loses a model's rows when the console changes its pairs; it names nobody. `claim_code_renewals` (§5.76) keeps every new claim code made, forever (never deleted, like the orders it names); a buyer's code is held there only sealed, and only while it waits for its one reading.

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
