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
- the LIVE RELEASES (migration `0021`), releases lived live and without a draw: their sizes and stock, the entries of ORBES accounts through the room, the line, their turn, the piece held and its reservation, the add-ons, the interest (I'LL BE THERE), the host's lines, and the per-tier windows; since migration `0049` (lot M1, W4), a release's pace, X buyers admitted every Y minutes, with its own pause and its batches, and when each entry was admitted;
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
- customer accounts, staff (admin) users and their login sessions, and the one-time codes with which ORBES Client Services lets a customer recover a forgotten password, or which the customer asks for by email (migration `0051`, lot M1: off until the emails are on);
- the founding list (migration `0050`, lot M1 of 2026-10-21, F2 to F5): the people theorbes.com's form adds, their consent with its version, where they came from, and the ORBES account each one becomes; a console link that goes to theorbes.com; a draw opened to a segment;
- the emails (migration `0051`, lot M1, E0 to E6), prepared and switched off: the words and the switch of each kind as the console set them, the outbox every email goes through (kept 90 days after it is sent, fails or is cancelled), a collector's release notices, and the release notices' watermark;
- the house messages (migration `0052`, lot M2 of 2026-10-22, macro scope D24): the six moments' switches and words as the console set them, the messages staff write to a segment or a tier, and one delivery per message an account received in MESSAGES, with when it was read (kept with the account, never deleted);
- WORN, the owners' gallery (migration `0053`, lot M2, D31): each photograph an owner sends from a piece, its credit (first name, country, the Instagram name when chosen) and consent as sent, its review, and its bytes only while it is in review or published (the record kept with the account);
- the house's packing and supply by size (migrations `0054` and `0055`, lot M3 of 2026-10-23, macro scope D16 and K11): the standard boxes, each model's box and packed weight, a parcel's box and weight once packed, and the countries each stock location serves;
- the add-ons and THE SET (migrations `0056` and `0057`, lot M3, K48 and K44): the catalogue add-ons with their own SKU, prices and stock, each unit sold on an order, the choices made before an order exists; the sets of 2 to 4 models, a release of a set with its sizes per piece, each entry's size per piece, each set sold and its orders, one per piece;
- ONE QUEUE (migration `0058`, lot Q1 of 2026-10-24): a LIVE RELEASE's hold after the opening and the batches NEXT BATCH NOW gave; the batch that gave each entry its turn, and when, in the columns of lot M1;
- ADD-ONS ONE SYSTEM (migrations `0059` and `0060`, lot Q2 of 2026-10-25): every add-on a catalogue add-on, a product with stock or a service without (an engraving, a gift wrapping), offered by its four switches and each release's pick, the engraving with its most characters and the words typed on a hold; the release add-ons and Orders → Settings' engraving price converted into catalogue add-ons, the record of each conversion, and their three tables dropped;
- THE VAULT (migrations `0061` and `0062`, lot Q3 of 2026-10-26): the seven sources a vault is given on, each with its switch and limits, the one house table of rewards with its I WAS THERE floor, each vault given (its occasion, its 30 days, what it held once opened, and a returned piece taking back an unopened one), the tiers each account held at the deployment, the personal invitation links and which account invited another, a LIVE RELEASE's own switch and a vault-only model; then the links from a vault into what delivers its reward: a VAULT credit, a VAULT order (a piece won free and claimed within 30 days, or one bought under a right to buy), a guarantee at the next LIVE RELEASE, a free add-on's unit and a credit to give;
- lot M4 (migrations `0063` to `0065`, macro scope K43, K49 and K27): the margin's settings the owner enters (one euro rate per currency, the outbound shipping cost bands by country and weight, the unit costs of the pouch, the card, THE VAULT CARD, a PRIVATE CARE service and each claim outcome, each category's returns and claims allowance), never a figure of the margin itself; the partners who pay ORBES for an experience offered to the circle, their experiences, the invoices and credit notes ORBES issues them in their own series (never changed), an invitation's link to an experience and a guest's choice to share their name with its partner; and the server-side conversions to Meta, TikTok and Google, **built and switched off**: the console's switch and its settings, the link channels mapped to a platform, each advertising choice a collector makes (never changed: the proof of consent), the platforms' click ids kept only with consent, and the outbox of events per platform, none of which is written while the switch is off;
- lot PURGE (migrations `0066` and `0067`, the owner's answers of 27 October 2026): an ended test's purge, its state, its stored report and its own range of the audit chain, and the tombstone of each audit entry it deleted (so the chain still proves nothing else was removed); and the platform reset of before the launch, its plan of every table (keep, keep in part, wipe), its one row with the reset holder, LOCK RESET, the last reset's record and its single-use authorization, written only by the database's owner;
- ownership, ownership transfers, warranties (lifetime or 2 years, as each model chooses: migration `0048`, plan ORBES CARE) and service records;
- the warranty claims (migration `0048`, plan ORBES CARE of 2026-10-15): a claim under a piece's ORBES warranty or the legal guarantee, opened by ORBES Client Services from the claimant's conversation, its prepaid label, its receipt, its decision (a replacement, a credit, a repair, a legal remedy or a refusal) and its shipment;
- every verification request (scan) and its authentication decision;
- customers' reports on scans that were not authentic (where they saw or bought the piece), and the cases staff follow up;
- the scans of every complete day counted by country, result and event type, an anonymous record that outlives the scan history;
- anomaly findings and revocations;
- an append-only, hash-chained audit log of every mutation.

It never holds private signing keys, raw IP addresses, raw device identifiers, plaintext passwords, claim codes, transfer codes, recovery codes, registration tokens or session tokens, with one exception once the emails are on: a PASSWORD_RESET email kept in the outbox (§5.122) holds its link, the address and the recovery code, for 90 days, a code that works 30 minutes and once. A buyer's new claim code (§5.76) is held only sealed (AES-256-GCM under a key that never reaches the database), only while it waits for its one reading.

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
| **`OR010`** | **Custom: a refusal of the test purge** (migration `0066`: its batch functions and `test_runs_purge_guard`), the reason as the message (`PURGE_WINDOW`, `PURGE_NOT_TEST`, `PURGE_NOT_AUTHORIZED`, …; `pg-errors.ts` `purgeRefusal`) |
| **`OR011`** | **Custom: a refusal of the platform reset** (migration `0067`), the reason as the message (`RESET_NO_HOLDER`, `RESET_WINDOW`, `RESET_OTHER_CONNECTIONS`, `RESET_NOT_AUTHORIZED`, …; `resetRefusal`) |
| **`OR020`** | **Custom: a proof of the platform reset failed before its COMMIT** (`RESET_PROOF_FAILED`, every failed check in the detail): the whole transaction rolls back |
| `40001`, `40P01` | Serialisation failure, deadlock (retryable; issuance retries them) |
| `P0001` | Generic `RAISE EXCEPTION` (not used by the schema) |

`OR001` was chosen so a blocked mutation can be told apart from a constraint failure; `23001` was not usable because PostgreSQL already raises it for `ON DELETE RESTRICT`.

---

## 3. Schema conventions

- **Identifiers:** `uuid` primary keys generated by `gen_random_uuid()`, except `categories.id` (the 5-bit category index), `cryptographic_keys.key_id` (the 1-byte key id), `sessions.id_hash` and `scan_tokens.id_hash` (SHA-256 of a secret token), `audit_logs.id` (`bigserial`), `scan_daily_stats` (its four keys, §5.24), `media_objects.sha256` (the hex SHA-256 of the image's bytes, §5.26), `model_images` and `circle_post_images` (the model or the post, and the photograph, §5.28, §5.32), `circle_rsvps` and `circle_poll_votes` (the post and the account, §5.33, §5.34), `live_access_models` (the release and the model, §5.40), `live_entry_addons` (the entry and the add-on, §5.42; dropped by `0060`), `drop_addons` (the release and the add-on, §5.139), `live_interest` (the release and the account, §5.43), `live_tier_windows` (the release and the tier, §5.45), `circle_daily_visits` (its day, §5.35) and `club_tiers` (its tier's name, §5.36); `shop_requests` has a uuid (§5.37); `stock_movements`, `order_events` and `event_journal` a `bigint` identity (§5.48, §5.52, §5.56), `sku_thresholds` its SKU and location (§5.49), `order_alert_settings` the one id 1 (§5.57), `after_room_guests` its after-room and entry (§5.59), `release_answers` its release and account (§5.60), `activity_hourly` its hour, country and tier (§5.61), and `guarantee_settings` the one id 1 (§5.70).
- **Time:** every timestamp is `timestamptz`. Calendar dates (`production_date`, warranty dates) are `date` and evaluated in UTC by the services.
- **Enumerations:** `text` columns with `CHECK (… IN (…))`, which are simpler to migrate than PostgreSQL enums. Each list is mirrored in `db/schema.ts` (`test/db/schema.test.ts` holds the migration's literal list to it) and, where the console reads it, in `web/admin/types.ts`: among the latest, `LOOKBOOK_STATES`, `DROP_ENTRY_STATUSES`, `CIRCLE_POST_KINDS` and `CIRCLE_RSVP_ANSWERS` (§5.31, §5.33) `CLUB_TIER_NAMES` (§5.36) and `SHOP_REQUEST_STATUSES` (§5.37); with LIVE RELEASE+, `ORDER_CHANNELS`, `ORDER_STATUSES`, `ORDER_RESERVATIONS`, `STOCK_MOVEMENT_REASONS`, `BENCH_ITEM_STATUSES`, `RETURN_OUTCOMES`, `INVOICE_KINDS`, `SHOP_REQUEST_OUTCOMES` and `ACCESS_COMBINES` (§5.46 to §5.61); with the house's guarantee, `GUARANTEE_SCOPES` and `GUARANTEE_STATUSES` (§5.69), and `GUARANTEE_CLOSED_REASONS` in `db/schema.ts`.
- **Foreign keys:** every foreign key is `ON DELETE RESTRICT` and every foreign-key column is the leading column of an index (checked by `test/db/migrations.test.ts`).
- **Integrity guards** (defence in depth against application bugs and ad-hoc SQL), all raising SQLSTATE `OR001`:
  - `audit_logs` and `product_status_history` are append-only: `UPDATE`, `DELETE` and `TRUNCATE` are rejected;
  - `categories.id` and `categories.code` are immutable and categories are never deleted;
  - the cryptographic identity columns of `products`, `codes` and `cryptographic_keys` are immutable, as are a model's category and SKU prefix, a gallery row's model, photograph and author, a release's sealed seed and its commitment (§5.29), an entry's id, release, account and creation time (§5.30), a circle post's id, kind, author and creation (§5.31), a circle photograph's post, image and author (§5.32), an answer's post, account and creation (§5.33), a tier's name (§5.36), and a request's id, account, model, creation and note (§5.37), an order's id, channel, source, release, account, model and reservation time (§5.51), a piece to make's id, order, SKU, release and identity (§5.53), a SKU's model and size (§5.47), a house's guarantee's id, account, target and grant (§5.69), and every column of the event journal but `consumed_by` (§5.56); a vote in a poll cannot be updated at all (§5.34); `genomes` and `media_objects` rows cannot be updated at all; the stock ledger and an order's history are append-only, and a return, an invoice and an after-room's guest are never changed nor deleted (§5.48, §5.52, §5.54, §5.55, §5.59);
  - `genomes` and `cryptographic_keys` rows are never deleted (`DELETE` and `TRUNCATE` raise): a key id is a 1-byte value signed into every code and must never be reused.
  - since lot PURGE, `orbes_reject_mutation` has two ways through, and only for the database's owner inside the lot's SECURITY DEFINER functions: `orbes.guard_bypass` = `purge` lets a DELETE through on the purge's five guarded tables (`audit_logs`, `order_events`, `event_journal`, `credit_uses`, `tier_grants`), `reset` a TRUNCATE of a WIPE table or a DELETE on a WIPE or PARTLY one of the reset's plan (§5.161). Both also require `current_user` to be a superuser: the setting alone, which any session may set, opens nothing for the app's role. Never an UPDATE, never a kept table, never the replication role; every other use raises exactly as before.
- **Timestamps per table:** every row records when it came into being, named after what it records: `created_at` on most tables, `occurred_at` on `scan_events` and `audit_logs`, `started_at` on `ownership`, `opened_at` on `service_records`, `first_seen_at` on `anomalies`; `scan_daily_stats` records a day (`day`), not an instant. Lifecycle moments have their own columns (`activated_at`, `revoked_at`, `ended_at`, `used_at`, …).
- **`updated_at`:** only on the four tables with free-form mutable business data — `products`, `accounts`, `admin_users` and `warranties` — maintained by the trigger function `orbes_touch_updated_at()`. Services set `updated_at` from their injectable clock; when a statement leaves `updated_at` unchanged (including setting it to its current value), the trigger stamps `now()` (the transaction start time). **Clock mixing:** with a frozen or coarse injected clock, a second update at the same instant writes the old value again and therefore gets the database clock instead; compare `updated_at` with the injected clock only across distinct instants, and never order rows across tables by `updated_at`.
- **No business seed data.** The migration creates no categories, models, keys or users. Categories, collections and models are created through the admin API. The first admin is created at startup from `BOOTSTRAP_ADMIN_*`; the first signing key is created at startup in development and test, and through `POST /api/admin/keys/rotate` in production (§9.4).

### 3.1 Trigger functions

| Function | Behaviour |
|---|---|
| `orbes_touch_updated_at()` | `BEFORE UPDATE`, row level: if `NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at`, set `NEW.updated_at := now()`. |
| `orbes_reject_mutation(reason)` | Raises `'<OP> on <table> is not allowed (<reason>)'` with SQLSTATE `OR001`. Used row level (UPDATE/DELETE) and statement level (TRUNCATE). |
| `orbes_require_superuser(reason)` | Lot PURGE (`0066`): raises `'<OP> on <table> is not allowed (<reason>)'` with `OR001` unless the current user is a superuser: `audit_purge_gaps` (INSERT), `purge_delete_tables` and `platform_reset_plan` (every write) are written by the migrations' superuser and its definer functions only. |
| `orbes_test_runs_purge_guard()` | Lot PURGE (`0066`): `test_runs_purge_guard`, the test's purge one way and written once, NULL → PURGING only in the step-up's own transaction (§5.74); refusals `OR010`. |
| `orbes_platform_reset_gate_guard()` | Lot PURGE (`0067`): `platform_reset_gate_guard`, the gate written by a superuser only, never deleted, LOCK RESET and the holder fixed once pressed, `resets` never down (§5.160). |
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
  ACCOUNTS ||--o{ CARE_REQUESTS : "account_id (PRIVATE CARE)"
  PRODUCTS ||--o{ CARE_REQUESTS : "product_id (once a year unless cancelled)"
  SERVICE_RECORDS |o--o| CARE_REQUESTS : "service_record_id (YEARLY_CARE)"
  CARRIERS |o--o{ CARE_REQUESTS : "label_carrier_id, return_carrier_id"
  ADMIN_USERS |o--o{ CARE_REQUESTS : "handled_by"
  PRODUCTS ||--o{ WARRANTY_CLAIMS : "product_id, root_product_id, replacement_product_id"
  ACCOUNTS |o--o{ WARRANTY_CLAIMS : "account_id (the claimant)"
  CLIENT_CONVERSATIONS |o--o{ WARRANTY_CLAIMS : "conversation_id (opened from)"
  SERVICE_RECORDS |o--o| WARRANTY_CLAIMS : "service_record_id (INSPECTION)"
  TIER_GRANTS |o--o| WARRANTY_CLAIMS : "grant_id (WARRANTY credit)"
  CARRIERS |o--o{ WARRANTY_CLAIMS : "label_carrier_id, return_carrier_id"
  ADMIN_USERS |o--o{ WARRANTY_CLAIMS : "opened_by, decided_by"
  WARRANTY_CLAIMS |o--o| WARRANTY_CLAIMS : "continues_claim_id (moved to the legal guarantee)"
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
  ADMIN_USERS |o--o{ ACCOUNT_RECOVERY_CODES : "created_by (STAFF; NULL when sent by EMAIL)"

  ACCOUNTS |o..o{ SESSIONS : "subject_id (no FK)"
  ADMIN_USERS |o..o{ SESSIONS : "subject_id (no FK)"
  AUDIT_LOGS |o..o| AUDIT_LOGS : "prev_hash = predecessor hash"

  ACQUISITION_SOURCES ||--o{ PREREGISTRATIONS : "source_id (where a pre-registration came from)"
  ACCOUNTS |o--o{ PREREGISTRATIONS : "account_id (matched by its address)"
  ADMIN_USERS ||--o{ EMAIL_TEMPLATES : "updated_by"
  ACCOUNTS |o--o{ EMAIL_OUTBOX : "account_id (an email to an account)"
  PREREGISTRATIONS |o--o{ EMAIL_OUTBOX : "preregistration_id (the founding announcement)"
  ACCOUNTS ||--o| EMAIL_PREFERENCES : "account_id (release notices)"
  ADMIN_USERS ||--o{ HOUSE_MOMENT_SETTINGS : "updated_by"
  SEGMENTS |o--o{ HOUSE_MESSAGES : "audience_segment_id (or a tier)"
  ADMIN_USERS ||--o{ HOUSE_MESSAGES : "created_by, updated_by, sent_by, cancelled_by"
  ACCOUNTS ||--o{ HOUSE_DELIVERIES : "account_id"
  HOUSE_MESSAGES |o--o{ HOUSE_DELIVERIES : "house_message_id (CUSTOM)"
  PRODUCTS ||--o{ WORN_PHOTOS : "product_id"
  OWNERSHIP ||--o{ WORN_PHOTOS : "ownership_id (the period it was sent in)"
  ACCOUNTS ||--o{ WORN_PHOTOS : "account_id (the sender)"
  MODELS ||--o{ WORN_PHOTOS : "model_id (the sheet it shows on)"
  ADMIN_USERS |o--o{ WORN_PHOTOS : "reviewed_by"
  BOXES |o--o{ MODELS : "box_id (lot M3)"
  BOXES |o--o{ SHIPMENTS : "box_id (written at PACKED)"
  STOCK_LOCATIONS ||--o{ STOCK_LOCATION_COUNTRIES : "location_id (the countries it serves)"
  ADDON_ITEMS ||--o| SKUS : "addon_id (its own SKU)"
  ADDON_ITEMS ||--o{ ADDON_ITEM_PRICES : "addon_id"
  SUPPLIERS |o--o{ ADDON_ITEMS : "supplier_id"
  ORDERS ||--o{ ORDER_ADDON_ITEMS : "order_id (one row per unit)"
  SKUS ||--o{ ORDER_ADDON_ITEMS : "(addon_id, sku_id)"
  ORDER_ADDON_ITEMS |o--o{ STOCK_MOVEMENTS : "order_addon_item_id (SHIPPED, RETURNED)"
  ADDON_ITEMS ||--o{ ADDON_CHOICES : "addon_id (a LIVE entry, a draw entry or a salon request)"
  DROPS ||--o{ DROP_ADDONS : "drop_id (a release's pick, lot Q2)"
  ADDON_ITEMS ||--o{ DROP_ADDONS : "addon_id"
  ADDON_ITEMS ||--o{ ADDON_CONVERSIONS : "addon_id (what it was converted from, 0060)"
  DROPS |o--o{ ADDON_CONVERSIONS : "drop_id (the release whose add-on it was)"
  SETS ||--|{ SET_MODELS : "set_id (2 to 4 pieces)"
  MODELS ||--o{ SET_MODELS : "model_id"
  SETS |o--o{ DROPS : "set_id (a release sells a model or a set)"
  DROP_ENTRIES ||--o{ DROP_ENTRY_SIZES : "(entry_id, drop_id), a size per piece"
  LIVE_ENTRIES ||--o{ LIVE_ENTRY_SIZES : "(entry_id, drop_id)"
  LIVE_INTEREST ||--o{ LIVE_INTEREST_SIZES : "(drop_id, account_id)"
  DROP_SIZES ||--o{ DROP_ENTRY_SIZES : "(size_id, drop_id, piece)"
  SETS ||--o{ SET_SALES : "set_id"
  ACCOUNTS ||--o{ SET_SALES : "account_id"
  SET_SALES |o--o{ ORDERS : "(set_sale_id, account_id), one order per piece"
  ACCOUNTS ||--o{ VAULTS : "account_id (THE VAULT, lot Q3)"
  VAULT_SOURCES ||..o{ VAULTS : "source (a logical reference)"
  VAULT_REWARDS |o--o{ VAULTS : "reward_id (what it held, written once at the opening)"
  DROPS |o--o{ VAULTS : "drop_id (LIVE: the release)"
  LIVE_ENTRIES |o--o{ VAULTS : "entry_id (LIVE: the entry still in the line)"
  PRODUCTS |o--o{ VAULTS : "product_id (PIECE, WORN)"
  WORN_PHOTOS |o--o{ VAULTS : "worn_photo_id (WORN)"
  ADMIN_USERS |o--o{ VAULTS : "given_by (HOUSE)"
  SEGMENTS |o--o{ VAULTS : "segment_id (HOUSE, a segment's gift)"
  TIER_GRANTS |o--o| VAULTS : "grant_id / tier_grants.vault_id (a VAULT credit)"
  ORDERS |o--o| VAULTS : "order_id / orders.vault_id (a VAULT order)"
  HOUSE_GUARANTEES |o--o| VAULTS : "guarantee_id / vault_id (scope LIVE)"
  VAULT_GIFTS |o--o| VAULTS : "gift_id / vault_gifts.vault_id (a credit to give)"
  VAULTS |o--o{ ORDER_ADDON_ITEMS : "vault_id (a free add-on's unit at 0)"
  MODELS |o--o{ VAULT_REWARDS : "model_id (PRODUCT, VAULT_EDITION)"
  ADDON_ITEMS |o--o{ VAULT_REWARDS : "addon_id (ADDON, PRODUCT: kind PRODUCT only)"
  ACCOUNTS ||--o{ VAULT_OCCASIONS_BEFORE : "account_id (the tiers held at 0061)"
  ACCOUNTS ||--o| INVITATIONS : "account_id (the personal link)"
  ACCOUNTS |o--o{ ACCOUNTS : "invited_by (set once)"
  ACCOUNTS |o--o{ VAULT_GIFTS : "accepted_by (the friend)"
  CATEGORIES ||--o| CATEGORY_ALLOWANCES : "category_id (the margin's allowance, lot M4)"
  ADMIN_USERS |o--o{ CURRENCY_RATES : "updated_by (as SHIPPING_COST_RATES, MARGIN_UNIT_COSTS, CATEGORY_ALLOWANCES)"
  PARTNERS ||--o{ PARTNER_EXPERIENCES : "partner_id (a deal, lot M4)"
  PARTNER_EXPERIENCES ||--o{ PARTNER_INVOICES : "experience_id (one INVOICE, its CREDIT_NOTE)"
  PARTNER_INVOICES |o--o| PARTNER_INVOICES : "credits_invoice_id (the credit note's invoice)"
  PARTNER_EXPERIENCES |o--o{ CIRCLE_POSTS : "partner_experience_id (a PARTNER_EXPERIENCE invitation)"
  LINK_CHANNELS ||--o{ ADS_CHANNEL_PLATFORMS : "channel_id (mapped to META, TIKTOK or GOOGLE, lot M4)"
  TRACKING_DEVICES |o--o{ AD_CONSENTS : "device_id (a choice made signed out)"
  ACCOUNTS |o--o{ AD_CONSENTS : "account_id (a choice of the account)"
  TRACKING_DEVICES ||--o{ AD_CLICKS : "device_id (a click id, with consent only)"
  ACCOUNTS |o--o{ AD_CLICKS : "account_id (once known)"
  ACQUISITION_CONVERSIONS ||--o{ AD_EVENTS : "conversion_id (one event per platform and act)"
  ADMIN_USERS |o--o| ADS_SETTINGS : "switched_by, updated_by (the one row)"

  LINK_CHANNELS ||--o{ LINKS : "channel_id (a console link's channel)"
  ADMIN_USERS ||--o{ LINKS : "created_by, archived_by"
  DROPS |o--o{ LINKS : "drop_id (a release it leads to)"
  MODELS |o--o{ LINKS : "model_id (a model's sheet it leads to)"
  LINKS |o--o| ACQUISITION_SOURCES : "link_id (its LINK source)"
  ACQUISITION_SOURCES |o--o{ TRACKING_DEVICES : "first_source_id (the device's first arrival)"
  TRACKING_DEVICES ||--o{ ACQUISITION_TOUCHES : "device_id (a visit: one source, one Paris day)"
  ACQUISITION_SOURCES ||--o{ ACQUISITION_TOUCHES : "source_id"
  ACCOUNTS |o--o{ ACQUISITION_TOUCHES : "account_id (once linked)"
  ACCOUNTS ||--o| ACCOUNT_SOURCES : "account_id (the first source)"
  ACQUISITION_SOURCES ||--o{ ACCOUNT_SOURCES : "first_source_id"
  ACCOUNTS ||--o{ ACQUISITION_CONVERSIONS : "account_id"
  ACQUISITION_SOURCES ||--o{ ACQUISITION_CONVERSIONS : "last_source_id (the last link)"
  ACQUISITION_CONVERSIONS }o..|| ACCOUNTS : "ref_id (SIGNUP; no FK)"
  ACQUISITION_CONVERSIONS }o..|| DROP_ENTRIES : "ref_id (DRAW_ENTRY; no FK)"
  ACQUISITION_CONVERSIONS }o..|| LIVE_ENTRIES : "ref_id (LIVE_ENTRY; no FK)"
  ACQUISITION_CONVERSIONS }o..|| ORDERS : "ref_id (ORDER; no FK)"
  ACQUISITION_SOURCES ||--o{ ACQUISITION_DAILY : "source_id (visits by Paris day)"
  ACCOUNTS ||--o{ ACCOUNT_NOTES : "account_id (private notes, never shown to the client)"
  ADMIN_USERS |o--o{ ACCOUNT_NOTES : "created_by, removed_by"
  ACCOUNTS ||--o{ ACCOUNT_TAGS : "account_id (at most 20 tags)"
  ADMIN_USERS |o--o{ ACCOUNT_TAGS : "created_by"
  ACCOUNTS ||--o| ACCOUNT_SCORES : "account_id (the engagement score, staff only)"
  ACCOUNTS ||--o| COLLECTOR_HISTORY : "account_id (the monthly history)"
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
| `warranty_months` | `int` | NOT NULL | `24` | `CHECK (warranty_months BETWEEN 0 AND 600)`. The length of the warranty of the category's **2-year** models (plan ORBES CARE of 2026-10-15, answer 12); a lifetime model's pieces have no end date. No lifetime flag on a category: the choice is each model's (`models.warranty_lifetime`, §5.3). |
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
| `warranty_lifetime` | `boolean` | NOT NULL | `false` | Migration `0048_orbes_care` (plan ORBES CARE of 2026-10-15, answer 12): the model's warranty, `true` the lifetime warranty, `false` the 2-year warranty (its category's `warranty_months`). Every model existing at the migration backfilled `true`. The column's `false` keeps a model written by plain SQL (the previous image during the roll-out, fixtures, the demo seed) at the 2-year behaviour; the service's and the console's default for a new model is `true` (`CatalogService.createModel`), and ADD A VARIANT copies its main model's. Changed by an ADMIN only (`CatalogService.setWarranty`, `POST /api/admin/models/:id/warranty`, audited `model.warranty`), which rewrites its pieces' warranties not VOID (§5.14). |
| `supplier_id` | `uuid` | NULL | — | Migration `0035_logistics_access` (plan NEXT LOT §3.5: « each model (or each size) has its supplier »). FK → `suppliers.id` (§5.77, ON DELETE RESTRICT), led by `models_supplier_id_idx`. The supplier that makes the model's pieces; NULL: none, and on a variant its main model's. A size may name its own (`skus.supplier_id`, §5.47), which wins: `services/suppliers.ts` `supplierOf` reads the size's, else the model's, else the main model's. Set by `SupplierService.setModelSupplier` (`PUT /api/admin/models/:id/supplier`, OPERATOR, audited `model.supplier`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Indexes:** primary key; unique `sku_prefix`; unique `slug` (`models_slug_key`, migration `0014_model_lookbook`); `models_collection_id_idx (collection_id)`; `models_category_id_idx (category_id)`; `models_image_sha256_idx (image_sha256)` (migration `0012_media`); `models_discontinued_by_idx (discontinued_by)` (migration `0019_model_discontinued`), which leads with the foreign key; `models_variant_of_idx (variant_of)`, which leads the variants' foreign key, and the unique `models_variant_label_key (coalesce(variant_of, id), lower(variant_label))` (migration `0024_model_variants`).
- **Triggers:** `models_immutable_identity` (BEFORE UPDATE, guards `id`, `category_id`, `sku_prefix`, `created_at`; migration `0010_models_active`), raising `OR001`: the category is in the identity of every piece issued with the model, the SKU prefix starts every SKU issued with it. `models_variant_rules` (migration `0024_model_variants`; BEFORE INSERT or UPDATE OF `variant_of`, `variant_label`, row level, function `orbes_models_variant_rules()`) reads the rows a CHECK cannot: the main model `FOR SHARE` (a change of it waits, then is read again) and whether the model has variants; it refuses a chain (a variant of a variant, or a model with variants made a variant) and a main model without its own label as a CHECK does, SQLSTATE `23514` with the constraint names `models_variant_no_chain` and `models_variant_main_labelled`.
- **Written by:** `CatalogService.createModel` (`POST /api/admin/models`, OPERATOR), insert plus audit `model.create` in one transaction. `CatalogService.updateModel` (`PATCH /api/admin/models/:id`, OPERATOR, A-10) changes `name`, `default_material`, `care_instructions`, `collection_id` and `active`, never the category nor the SKU prefix (400, and the trigger above), under a row lock (`FOR UPDATE`), with the audit entry `model.update` (the changed fields before and after, and `issuedPieces`: the products of the model) in the same transaction; a change that changes nothing writes nothing. The name, `type`, care instructions and collection are read live by every public result of the model's pieces ([API §9.2](API.md#92-response)). `MediaService.setModelImage` and `removeModelImage` (`POST` and `DELETE /api/admin/models/:id/image`, OPERATOR, F-04) set and clear `image_sha256` under a row lock, with the audit entry `model.image.set` or `model.image.remove` (the image's hash, type, size and dimensions, the one it replaced and `issuedPieces`) in the same transaction. The lookbook (P-R02, [API §13.4](API.md#134-models)): `CatalogService.updateModel` also changes `lookbook`, `slug`, `story` and `specs`, under the same row lock and audit entry (`model.update`, a story as its length and SHA-256, never its words), and sets `published_at` the first time the model leaves HIDDEN (audited as `publishedAt`). Read by the public lookbook (`LookbookService`: the PUBLIC models and their sheets) and THE PRIVATE SALON (`SalonService`, P-X08: the RESERVED ones, for an account that holds a piece, from the tier `private_min_tier` up, with `price_label`); `product.lookbook` of an AUTHENTIC result names the `slug` of a PUBLIC model. THE PRIVATE SALON (P-X08, [API §13.4](API.md#134-models)): `CatalogService.updateModel` also changes `price_label` and `private_min_tier`, under the same row lock and audit entry (`model.update`, before and after). DISCONTINUED (P-R06): `CatalogService.discontinueModel` (`POST /api/admin/models/:id/discontinue`, **ADMIN**) sets `discontinued_at`, `discontinued_by` and `active = false` in one transaction under the row lock, audited `model.discontinue` (`{ name, skuPrefix, discontinuedAt, wasActive, issuedPieces }`); `reinstateModel` (`…/reinstate`, ADMIN) clears both and sets `active = true`, audited `model.reinstate` (`{ name, skuPrefix, discontinuedAt, issuedPieces }`, the previous date). An edit that would make a discontinued model active is refused (`409 MODEL_DISCONTINUED`), and `models_discontinued_inactive` refuses it below the service. LIVE RELEASE+ (N2, M6): `CatalogService.updateModel` also changes `base_price_minor` with `base_currency` (sent together, or both cleared) and `care_guide`, under the same row lock and audit entry (`model.update`, the care guide as `{ length, sha256 }`, never its words); a model's Shopify ids live on its SKUs (§5.47). Plan NOCTURNE (N1, migration `0024_model_variants`): `CatalogService.createVariant` (`POST /api/admin/models/:id/variants`, OPERATOR, ADD A VARIANT) locks the main model (`FOR UPDATE`), refuses a main model that is itself a variant (`409 MODEL_IS_VARIANT`), gives the main model its own label and colour when it has none yet (its first variant; audited `model.update`, before and after), then inserts the variant, a copy of its category, collection, name, type, story, specifications, care instructions and care guide with its own label, colour and SKU prefix, HIDDEN from the lookbook, active, without a material, prices or photographs yet, audited `model.variant.create` (`{ mainId, name, type, skuPrefix, category, collectionId, label, swatch, copied, sizeType?, sizes }`), in one transaction; since plan NEXT LOT §3.3 the variant also copies its main model's `size_type` and `size_kind` (or takes the `sizeType` given for a main model with none yet) and, as SKUs of its own under its prefix (`ensureSku`) with their fits, its main model's offered sizes (a watch or a model of one size its ONE SIZE), never linked to them afterwards; `CatalogService.updateModel` changes `variant_label` with `variant_swatch` (sent together; cleared together on a model alone only, `409 VARIANT_LABEL_REQUIRED`), audited `model.update`. The lookbook reads a main model and its variants as one entry, its dots (`LookbookService`), and the Shopify product export as one product, option 1 Variant and option 2 Size (§5.47). No delete path exists.
- **Pairs (PAIRS WELL WITH):** the models a main model's sheet ends with are rows of `model_pairs` (§5.72, migration `0031_model_pairs`, plan NEXT-NINE BP-34), set by `CatalogService.setPairs`; a variant's sheet reads its main model's.
- **Lot M3** (migration `0054_boxes_weights`, macro scope D16 B1 and B2): `box_id` (NULL, FK → `boxes.id`, §5.129, `models_box_id_idx`) and `packed_weight_g` (NULL, 1–30 000 g): the box its pieces are packed in and their packed weight, NULL on a variant reading its main model's (as `size_kind` and `supplier_id`). Set by `CatalogService.setModelPacking` (`PUT /api/admin/models/:id/packing`, OPERATOR, `model.packing`). A model can be a piece of a set (§5.136).
- **Lot Q3, THE VAULT** (migration `0061_the_vault`, D19 "rare VAULT EDITION (catalogue product marked vault-only, never sold)"): `vault_only` (`boolean`, NOT NULL, default `false`): a **VAULT EDITION** model, made only for the vault. Every sales path refuses it with `409 MODEL_VAULT_ONLY` (a draw's creation, model change and publication, a LIVE RELEASE's creation, change and publication, an after-room's model, a set holding it, THE PRIVATE SALON's request, YOUR WISHLIST, the Shopify product export's lines: `assertSellable`, `services/vault-orders.ts`); the lookbook still shows it as any model. Set by `VaultService.setVaultOnly` (`PUT /api/admin/models/:id/vault-only`, OPERATOR, audited `model.vault_only`), refused while an active PRODUCT row of THE VAULT's table names the model (to turn it on, `409 VAULT_ONLY_PRODUCT`) or an active VAULT EDITION row does (to turn it off, `409 VAULT_EDITION_MODEL`). `0061`'s down step refuses while a model is vault-only.

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
- **Lot Q3, THE VAULT** (migration `0061_the_vault`, A FRIEND, N10): `invited_by` (`uuid`, NULL, FK → `accounts.id` `ON DELETE RESTRICT`, `accounts_invited_by_idx`) and `invited_at` (`timestamptz`, NULL): the account whose personal invitation link (§5.145) created this one, and when. **`accounts_invited`:** `CHECK ((invited_by IS NULL) = (invited_at IS NULL) AND invited_by <> id)`, both or neither, never the account itself; the trigger `accounts_invited_once` refuses any change once set (*an account's inviter is set once*). Written only by `AuthService.registerAccount` at the account's creation, from the register body's `invite` (an unknown or malformed code is ignored, never a refusal: `inviterOf`), audited in `account.register`'s details as `invitedBy` (an account id). Accepting a credit to give (§5.146) never writes it. Read by THE VAULT's FRIEND source at the friend's first registration (`giveFirstRegistrationVaults`) and by the account's export (API §16.13 `invited`: whether and when, never by whom). The privacy policy names it (since `2026-10-26`); neither account is ever shown the other's name.

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

At most one warranty per product. The row is created at issuance with the category's duration, its model's kind (`lifetime`) and no dates; activation fills the dates.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | UNIQUE. FK → `products.id` |
| `purchase_date` | `date` | NULL | — | |
| `retailer` | `text` | NULL | — | ≤ 200 characters. Free text of the activations made before the register (and of API callers that still send it); the console sends `retailer_id` instead. |
| `retailer_id` | `uuid` | NULL | — | Migration `0008_retail_mode`. FK → `retailers.id` (§5.25): the point of sale chosen from the register. The name shown (`WarrantyRecord.retailer`) is the register's current name when set, the free text otherwise. |
| `country` | `char(2)` | NULL | — | `CHECK (country ~ '^[A-Z]{2}$')`. Defaults to the point of sale's country at activation. |
| `start_date` | `date` | NULL | — | Equals the purchase date. NULL until activation. |
| `duration_months` | `int` | NOT NULL | — | `CHECK (BETWEEN 0 AND 1200)`. Copied from `categories.warranty_months`. Kept on a lifetime warranty (with any extension), so a switch of its model to 2 years gives back `start + duration_months` (plan ORBES CARE, D17). |
| `end_date` | `date` | NULL | — | Start + duration in calendar months, clamped to the end of the month (2026-01-31 + 1 month = 2026-02-28). Coverage includes the end date. NULL on a lifetime warranty (`warranties_lifetime_open`). |
| `lifetime` | `boolean` | NOT NULL | — (no default) | Migration `0048_orbes_care` (plan ORBES CARE, answers 2, 10, 12): the piece's warranty kind, copied from its model (`models.warranty_lifetime`) when the row is created and following a later change of the model (VOID rows untouched); what a warranty claim's basis reads (§5.119). Backfilled: VOID rows `false` (their dates kept), every other `true`, its end date cleared, `duration_months` kept. `warranties_lifetime_open`: `CHECK (NOT lifetime OR end_date IS NULL)`. |
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
| `ACTIVE` | `lifetime` (a started lifetime warranty never expires; plan ORBES CARE) |
| `EXPIRED` | `duration_months = 0`, or `end_date` is before today |
| `ACTIVE` | otherwise |

- **Indexes:** primary key; unique `product_id`; `warranties_retailer_id_idx (retailer_id)`.
- **Triggers:** `warranties_touch_updated_at`; `warranties_kind` (migration `0048`, BEFORE INSERT OR UPDATE, function `orbes_warranty_kind`): a row inserted without `lifetime` takes its model's choice through the piece, and a lifetime row's end date is cleared, before the NOT NULL and CHECK constraints (so the previous image's inserts and activations pass during the roll-out); an explicit write is kept. The new code always names `lifetime` and never writes an end date on a lifetime row.
- **Written by:** `IssuanceService.issueProduct` (insert); `WarrantyService.activate` (the console's product page, and the sale mode's `SaleService.activate` inside the transaction that uses its sale token up; audit `warranty.activate` with `retailer`, `retailerId` and, from the sale mode, `saleScanId`; the point of sale is locked `FOR SHARE` so it cannot be deactivated meanwhile; an ISSUED product moves to ACTIVATED in the same transaction), `void` (audit `warranty.void`; inserts the row if none exists) and `extend` (audit `warranty.extend`; service only, no HTTP route).
- **Privacy:** `retailer` and `country` describe the point of sale, not the customer.

### 5.15 `service_records`

After-sales service operations.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id` |
| `type` | `text` | NOT NULL | — | `CHECK (type IN ('INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION','YEARLY_CARE'))` (`SERVICE_TYPES`; YEARLY_CARE since migration `0028_yearly_care`, opened by PRIVATE CARE only, §5.68; a warranty claim opens an INSPECTION record, closed by its claim only, §5.119) |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK (status IN ('OPEN','COMPLETED','CANCELLED'))` |
| `location` | `text` | NULL | — | ≤ 200 characters. Visible to the owner. PRIVATE CARE's and a warranty claim's records read *ORBES* (`CARE_LOCATION`); migration `0048_orbes_care` rewrote the YEARLY_CARE records stored at *ORBES atelier* (`location` and `performed_by`) to *ORBES* (plan ORBES CARE, answer 7). |
| `notes` | `text` | NULL | — | ≤ 4 000 characters. Internal: never shown to owners. Closing notes are appended. |
| `opened_at` | `timestamptz` | NOT NULL | `now()` | |
| `closed_at` | `timestamptz` | NULL | — | `CHECK (closed_at IS NULL OR closed_at >= opened_at)` |
| `performed_by` | `text` | NULL | — | Workshop or technician; defaults to the acting user's label (e.g. `admin:<uuid>`). Internal. |

- **Indexes:** primary key; `service_records_product_id_idx (product_id, opened_at)`.
- **Written by:** `WarrantyService.openService` (moves the product to SERVICED; audit `service.open`), `completeService` (audit `service.complete`) and `cancelService` (audit `service.cancel`; service only, no HTTP route). When the last open record of a SERVICED product closes, the product returns to its pre-service status. Each takes the caller's transaction when given one: PRIVATE CARE (§5.68) opens, completes and cancels its YEARLY_CARE record in the transaction of its own step, and a warranty claim (§5.119) its INSPECTION record. `POST /api/admin/products/:productId/services` refuses YEARLY_CARE (`422 VALIDATION_FAILED`), and `POST /api/admin/services/:id/complete` a claim's record (`422`).

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

- **Indexes:** primary key; unique `hash`; `audit_logs_prev_hash_key`: unique `(prev_hash)` (each entry can be the predecessor of only one entry, so a forked chain fails at insert time); `audit_logs_occurred_at_idx`; `audit_logs_target_idx (target_type, target_id)`; `audit_logs_account_login_idx (target_id, occurred_at) WHERE action = 'account.login'` (migration `0044_client_notes`, plan CUSTOMER INTELLIGENCE §3.6 C.8 item 4: an account's sign-ins in a period, for the Collectors page's activity and Segments' ACTIVE rule; about 60 B a sign-in, not in the dump). No index on the actor: the one read by actor, the right-of-access export of an account (API §16.13, the entries it made as well as those about it), is a rare ADMIN request and reads the whole log.
- **Triggers:** `audit_logs_append_only` (BEFORE UPDATE OR DELETE, row level) and `audit_logs_no_truncate` (BEFORE TRUNCATE, statement level), both raising `OR001` with "audit_logs is append-only".
- **Written by:** `AuditService.record` only, under the `AUDIT_CHAIN` advisory lock, normally inside the transaction of the change it describes. `verifyChain()` (`GET /api/admin/audit/verify`) recomputes every hash and link; `head()` returns the newest id and hash for external anchoring. The chain detects edits and deletions inside the log, not the removal of the newest entries; anchor the head outside the database (§11).
- **Actions recorded:** `account.register`, `account.login`, `account.login_failed`, `account.logout`, `account.password_change`, `admin.create`, `admin.login`, `admin.login_failed`, `admin.logout`, `admin.password_change`, `admin.role_change`, `admin.disable`, `admin.enable`, `admin.unlock`, `admin.sessions_revoke`, `admin.totp.enable`, `admin.totp.disable`, `category.create`, `category.activate`, `category.deactivate`, `collection.create`, `collection.update`, `model.create`, `model.update`, `model.image.set`, `model.image.remove`, `model.gallery.add`, `model.gallery.remove`, `model.gallery.update`, `model.discontinue`, `model.reinstate`, `model.variant.create`, `model.sizes.update`, `model.sizes.declare`, `model.pairs`, `product.issue`, `product.issue_batch`, `product.transition`, `product.reinstate`, `product.photo.set`, `product.photo.remove`, `code.reissue`, `code.revoke`, `code.render`, `code.render_sheet`, `code.sheet_manifest`, `certificate.render`, `certificate.render_refused`, `claim_code.renew`, `claim_code.read`, `claim_code.withdraw`, `key.rotate`, `key.retire`, `key.revoke`, `key.revoke.amend`, `warranty.activate`, `warranty.void`, `warranty.extend`, `service.open`, `service.complete`, `service.cancel`, `ownership.register`, `ownership.claim_failed`, `ownership.transfer.initiate`, `ownership.transfer.accept`, `ownership.transfer.cancel`, `ownership.transfer.expire`, `ownership.confirm`, `ownership.incident`, `ownership.incident.resolve`, `ownership.certificate.create`, `ownership.certificate.revoke`, `anomaly.update`, `retailer.create`, `retailer.update`, `scan.report`, `scan.report.close`, `account.recovery_code.issue`, `account.recover`, `account.recover_failed`, `account.recover_throttled`, `account.lock`, `account.unlock`, `account.export`, `account.sizes.update`, `account.address.create`, `account.address.update`, `account.address.remove`, `account.address.default`, `account.profile.update`, `account.note.add`, `account.note.remove`, `account.tag.add`, `account.tag.remove`, `heard_option.setup`, `heard_option.create`, `heard_option.update`, `heard_option.order`, `order.address`, `order.engraving`, `order.engraving_prices.update`, `drop.create`, `drop.update`, `drop.publish`, `drop.cancel`, `drop.draw`, `drop.enter`, `drop.withdraw`, `drop.reserve`, `drop.size`, `drop.entry.confirm`, `drop.entry.lapse`, `drop.entry.offer`, `circle.post.create`, `circle.post.update`, `circle.post.publish`, `circle.post.unpublish`, `circle.post.photo.add`, `circle.post.photo.remove`, `circle.post.photo.update`, `circle.rsvp`, `club.tier.update`, `shop.request`, `shop.request.close`, `message.write`, `message.answer`, `message.take`, `message.assign`, `message.close`, `club.program.update`, `order.shipping_rates.update`, `order.shipping`, `club.grant`, `order.gift`, `order.credit.apply`, `order.credit.remove`, `order.credit.release`, `care.request`, `care.cancel`, `care.label`, `care.receive`, `care.return`, `care.complete`, `guarantee.grant`, `guarantee.update`, `guarantee.revoke`, `guarantee.cover`, `guarantee.carry`, `guarantee.expire`, `guarantee.use`, `guarantee.settings`, `supplier.create`, `supplier.update`, `model.supplier`. Verifications themselves are recorded in `scan_events`, not in the audit log. `certificate.render` ([API §15.7](API.md#157-post-apiadmincertificates-extension-of-the-contract)) targets the product when the file holds one card and carries `{ productIds, count, format, layout, layoutStatus, codeIssues }`, `codeIssues` being the issue of the ORBES CODE printed on each card, in `productIds` order (plan NEXT LOT §3.2: the card carries the code, so the log says which code went into which box); `certificate.render_refused` carries `{ reason, productIds, refused, format, layout }`; **neither ever carries a claim code**. A buyer's new card (SAVE YOUR NEW CARD, plan NEXT LOT §3.4) adds `orderId` and `by: 'buyer'` to both, the account being the actor. NEW CLAIM CODE (§5.76) records `claim_code.renew` (the staff member; `{ renewalId, for: 'STAFF' | 'BUYER', orderId?, accountId?, reason, replacedRenewalId? }`), `claim_code.read` (the buyer's account, its one reading; `{ renewalId, orderId }`) and `claim_code.withdraw` (`{ renewalId, reason: 'renewed_again' | 'order_cancelled' | 'order_returned' | 'registered' | 'unreadable' | 'superseded', orderId, unshownRenewalId? }`), each targeting the product; **none ever carries a code, sealed or clear**. `ownership.register` from YOUR ORDERS (REGISTER THIS PIECE) carries `{ via: 'order', orderId }` in place of the scan's `scanEventId`. `scan.report` and `scan.report.close` both target the scan (§5.22) and never carry the customer's words or the resolution note. The four `account.recover*` actions target the account (§5.23) and never carry the code or the email; neither do `account.lock`, `account.unlock` and `account.export` (A-06), which carry counts only. `ownership.certificate.create` and `ownership.certificate.revoke` (F-06, §5.27) both target the product (`targetType` `product`) and carry the certificate's id (`certificateId`; plus `expiresAt` and `validDays` on create, and `reason`, `account_locked` or `account_recovery`, on a withdrawal by a lock or an assisted recovery), never the token. The four photograph actions (F-04, §5.26) carry the image's SHA-256, type, dimensions and size and the one it replaced, never its bytes. A model's lookbook (P-R02, §5.3) is audited by `model.update`, its story as `{ length, sha256 }`, never its words, and its first publication as `publishedAt`; the three gallery actions (§5.28) target the model and carry the photograph's SHA-256 and position (with the image's type, dimensions and size on an addition), or the gallery's photographs and alternative texts before and after a new order, never the image's bytes. The eleven `drop.*` actions (P-R03 and P-X02, §5.29, §5.30) target the release (`targetType` `drop`) and name an entry by its id (`entryId`), never an email: `drop.create` carries the release's fields and its seed's SHA-256 (`seedHash`), `drop.update` the values changed before and after (the description as `{ length, sha256 }`), `drop.publish` the `seedHash`, `drop.cancel` whether it was published and how many entries it had, `drop.draw` the counts and the seed it reveals, `drop.enter` and `drop.withdraw` the entry (the account as actor; `again: true` for an entry again; a withdrawal by a lock has the ADMIN as actor and `reason: "account_locked"`), `drop.reserve` (P-X02) the entry, the tier that allowed it and its `respondBy` (the account as actor), `drop.create`, `drop.update` and `drop.publish` also `earlyAccessHours` and `earlyAccessPlatineHours` (and `drop.publish` `earlyAccessOpensAt` and `earlyAccessPlatineOpensAt`), and the three console actions on an entry its rank (`drop.entry.offer` its `respondBy` too, `noted: true` when a note was written, never its words). Plan NEXT LOT §3.6.F (migration `0038`): `drop.create`, `drop.update` and `drop.publish` carry the draw's sizes (`sizes`, `[{ label, pieces }]`); `drop.enter`, `drop.reserve` and `drop.entry.offer` the size (`sizeId`); `drop.size`, the account as actor, `{ entryId, sizeId, before }` (and `guaranteeId`, `guaranteeBefore` when its guarantee was bound or unbound); `drop.draw` the counts per size (`sizes`, `[{ sizeId, label, places, selected, waitlisted }]`). No personal data. The eight `circle.*` actions (P-X01, §5.31 to §5.33) target the post (`targetType` `circle_post`): `circle.post.create` its fields, the body as `{ length, sha256 }`, `circle.post.update` the values changed before and after, `circle.post.publish` its kind and tier, `circle.post.unpublish` when it had been published, the three photograph actions as the gallery's do, and `circle.rsvp` the answer and the one it replaced (`previous`), the account as actor. **A vote in a poll is never audited** (§5.34): the log is permanent, and a vote is an opinion; nor is a visit (§5.35). `club.tier.update` (P-X04, §5.36) targets the tier (`targetType` `club_tier`) and carries `{ tier, benefits, previous }` (`benefits` null when the default words are restored), no personal data. `model.variant.create` (plan NOCTURNE, N1, §5.3) targets the new variant and carries `{ mainId, name, type, skuPrefix, category, collectionId, label, swatch, copied }`, no personal data; a variant's label and colour changed later, and the main model's given on its first variant, are audited `model.update`, before and after. `model.discontinue` and `model.reinstate` (P-R06, §5.3) target the model and carry `{ name, skuPrefix, discontinuedAt, issuedPieces }` (`wasActive` too on a discontinuation; on a reinstatement, `discontinuedAt` is the date it had been discontinued); a model's price and tier in the private salon (P-X08) are audited by `model.update`, before and after. `shop.request` and `shop.request.close` (P-X08, §5.37) target the request (`targetType` `shop_request`) and carry `{ modelId }` (plus `reason: "account_locked"` on a closing by a lock): `shop.request` the account as actor, `shop.request.close` the console user. **Neither the account's note nor the console's closing note is ever audited**: the first is the account's own words, the second may name the client. The `drop.live.*` actions (the LIVE RELEASES, §5.29 and §5.38 to §5.45) target the release (`targetType` `drop`) and name entries, sizes, add-ons and messages by id, never an email: the console's `drop.live.create`, `.update` (each setting before and after, the description as `{ length, sha256 }`), `.publish`, `.cancel`, `.silhouette.set`, `.silhouette.remove`, `.pause`, `.resume` (`pausedMs`), `.extend` (the close before and after), `.stock` (the size, the stock before and after, the new quantity and the quantity line the announcement promised), `.free`, `.let_in` (the entry and its place), `.message` (its id and its text, staff words), `.end` (the reason, the time, the entries ended), `.remove` (the entry and the status it left; `reason: "account_locked"` for a lock's), `.board.issue` (`replaced` when it replaces a link; never the secret), `.board.revoke` and `.resolve` (the outcome, `noted: true` with a note, never its words); the engine's, the system as actor, `drop.live.queue` (the entries placed at T0) and `drop.live.end` (SOLD_OUT, CLOSED); the account's, the account as actor, `drop.live.enter` (the entry, size and quantity; its place after T0), `.size` (before and after), `.leave` (the status it left), `.interest` and `.interest.withdraw` (the size), `.secure` (the entry and `gestureMs`, the length of the hold), `.addons` (their ids), `.confirm` (the quantity) and `.release`. A PRESS changes no state and is not audited. **LIVE RELEASE+** (migrations `0022`, `0023`): the orders' `order.create`, `order.pay`, `order.ship`, `order.deliver`, `order.cancel`, `order.return`, `order.location`, `order.terms`, `order.buyer` and `order.link` target the order (`targetType` `order`) and carry its step before and after, ids and facts (the carrier, a declared value, where a piece goes, `noted: true` when a note was written), **never the buyer's name or address nor an engraving's words** (`order.buyer` and `order.terms` name the fields written, `fields`, never what they say); `order.alerts` (ADMIN) the delays before and after; `ownership.reclaim` (a return taking an ownership back) targets the product with the account's id, the order and the outcome, followed by `ownership.transfer.cancel` (`reason: "order_returned"`) for a transfer it cancels; `invoice.issue` and `invoice.credit` target the document with the order's id, its number, currency and total, never the buyer; the atelier's `bench.create`, `bench.start`, `bench.done` (with `product.issue` for the identity it issues), `bench.cancel`, `bench.sheet` (the work sheets printed) and `code.sign` (a reserved identity's code signed for its sheet) target the piece to make or the code (written no more since plan NEXT LOT step 5.13 removed the atelier, as `order.link` `{ via: 'bench' | 'stock' }`: since then `order.link` comes only with the packing scan, `{ via: 'scan' }`; the entries written stay); the stock's `stock.setup` (the first boot's presets, once), `stock.transfer`, `stock.adjust` (counts, ids and the note's presence), `stock.threshold`, `stock.location.create`, `stock.location.update`, `carrier.create` and `carrier.update`; `model.shopify` (the Shopify ids before and after); `segment.create`, `segment.update` (before and after) and `segment.delete`, a segment's name and criteria, which name no account; `drop.live.after_room.open` (the after-room, its guests' count, its door's times) and `drop.live.after_room.skip` (why it never opened), the system or the console as actor; and `drop.live.answer`, the account as actor, the release's id and **the position of the answer** (and the one it replaced), nothing else. **MESSAGES** (migration `0025`, plan NEXT-NINE, CS-01, §5.62, §5.63): `message.write` (the account as actor), `message.answer`, `message.take`, `message.assign` (ADMIN) and `message.close` target the conversation (`targetType` `client_conversation`) and carry its id, the message's id, the kind of a context (`context`, never its label), whether a closed conversation reopened (`reopened`), who answered it before and after (`before`, `after`) or the status a closing left (`from`): **never a message's words**. **THE PROGRAM** (migration `0026`, plan NEXT-NINE, BP-19 T2, §5.64, §5.65): `club.program.update` (ADMIN, `targetType` `club_program_settings`) and `order.shipping_rates.update` (ADMIN, `targetType` `shipping_rates`) carry the settings before and after (`before`, `after`): figures and model ids, no personal data. `order.shipping` (migration `0027`, BP-19 T4) targets the order with its step and the shipping set (`service`, `minor`, `benefit`; `rate: true` when the rate of its currency, on its first price or when its currency changes, `withOrderId` for an order following the one it travels with, `freeBefore` when a free benefit gave way); `order.create` carries the shipping fixed at the creation and the order it travels with. **The tiers' grants** (migration `0027`, BP-19 T5, §5.66, §5.67): `club.grant` targets the account (`targetType` `account`, the system as actor) with the grant's id, tier and kind (a CREDIT's amount, currency and expiry); `order.gift` targets the order a welcome gift travels with (the gift's order, the grant, the tier, the model, `sizeToChoose`); `order.credit.apply` the order (the amount, its currency, each use's id, grant, tier and part), `order.credit.remove` and `order.credit.release` the order (the reason, the amount, the uses given back). No personal data. **The yearly care** (migration `0028`, BP-19 T6, §5.68): `care.request`, `care.cancel`, `care.label`, `care.receive`, `care.return` and `care.complete` target the request (`targetType` `care_request`) with its id, the piece's serial and the year (the tier on a request; who cancelled and from which step; a label's carrier and size); never the return name nor the address. **THE HOUSE'S GUARANTEE** (migration `0029`, IN-01, §5.69, §5.70): `guarantee.grant`, `.update`, `.revoke`, `.cover`, `.carry`, `.expire` and `.use` target the guarantee (`targetType` `house_guarantee`) with the account's id, the release, model or collection's ids, its pieces, validity and shown, and whether a note was given (`noted`), **never the note's words nor an email**; `guarantee.settings` (ADMIN, `targetType` `guarantee_settings`) the defaults before and after. `drop.enter`, `drop.reserve`, `drop.withdraw`, `drop.live.enter`, `drop.live.leave` and `drop.live.remove` name the guarantee an entry uses (`guaranteeId`); `drop.draw` counts the guaranteed places and pieces, `drop.live.queue` the guaranteed entries. **YOUR SIZES** (migration `0030`, plan NEXT-NINE, AC-01, §5.71): `account.sizes.update` targets the account (`targetType` `account`, the account as actor) and carries the kinds set and cleared (`set`, `cleared`), **never the measures**, and is not recorded when nothing changed; `model.sizes.update` (OPERATOR) targets the model (`targetType` `model`) and carries the size kind before and after (`sizeKind`, when it changed) and the SKUs whose fit was written (`skus`), and `model.sizes.declare` (OPERATOR, plan NEXT LOT §3.3) targets the model and carries its size type before and after (`sizeType`, when it changed) and the codes of the SKUs `added`, `reinstated`, `setAside` and `removed` (codes, since a removed SKU's id no longer exists; never personal data); `model.create` carries the `sizeType` given at creation, and is not recorded when the kind is unchanged and no fit was written; no personal data. `model.pairs` (plan NEXT-NINE, BP-34, §5.72) targets the main model (`targetType` `model`) and carries `{ before, after }`, the picked models' ids in their order; the same picks again are not recorded; no personal data. **LOGISTICS and the suppliers** (migration `0035`, plan NEXT LOT §3.5, §5.77, §5.90): `admin.create` and `admin.role_change` carry a LOGISTICS login's locations (`stockLocationIds`); `supplier.create` targets the supplier (`targetType` `supplier`) with its name, currency and state; `supplier.update` the names of the fields changed (`fields`), never a contact's words; `model.supplier` targets the model with the supplier ids before and after, the model's (`supplierId`) and its sizes' (`sizes`, by SKU id); no personal data. **The supplier orders** (migration `0036`, plan NEXT LOT §3.5.6.3, §5.78 to §5.83): `supplier_order.create`, `.draft` (`{ skuId, quantity, from }`), `.update` (`{ fields }`), `.discard`, `.send`, `.confirm`, `.cancel_rest` (`{ pieces, to }`), `.invoice`, `.invoice_paid` and `supplier_return.settle` target the supplier order (`targetType` `supplier_order`) with its reference, ids, counts and amounts, never a note's words nor a supplier's contact. **The receptions** (migration `0036`, plan NEXT LOT §3.5.6.5, §5.80 to §5.83): `reception.record` and `.update` (`{ supplierOrderId, lines: [{ skuId, accepted, rejected }] }`), `.send_back` (`{ supplierOrderId, noted }`), `.confirm` (`{ supplierOrderId, reference, accepted, rejected, lines, status }`), `.issued` (`{ supplierOrderId, identities }`, by the system), `card.print` (`{ receptionId, run, layout, productIds, skipped }`) and `card.attached` (`{ receptionId, cards }`) target the reception (`targetType` `reception`); `supplier_return.returned` targets the supplier order; each piece issued is a `product.issue` with its `receptionId` and `receptionLineId`, by the confirming admin. Never a note's words nor a claim code, sealed or clear. **Logistics' stock** (plan NEXT LOT §3.5.6.6, §5.84): `stock.correction.propose` (`{ correctionId, locationId, delta }`), `.approve` (with `movementId`, beside the movement's `stock.adjust`) and `.decline` target the SKU (`targetType` `sku`), never the reason's or the note's words; `stock.count_in` (`{ skuId, productIds }`) targets the SKU, never the note. **Waiting orders served** (migration `0037`, §5.51): `order.serve` targets the order, by the system, `{ reservation: 'STOCK', skuId, locationId, queueFirst? }`. **Packing and shipping** (migration `0037`, plan NEXT LOT §3.5.6.8, §5.85, §5.86): `order.pack.start` (`{ shipmentId, parcel }`), `order.pack.scan` (`{ shipmentId, productId, scanId }`, after the piece's `order.link` `{ via: 'scan' }`), `order.pack.photo` (`{ shipmentId, sha256, bytes }`, **never the photo**) and `order.pack.check` (`{ shipmentId, keys }`, the checklist's lines) target each order of the parcel, the agent or ORBES staff as actor; Ship writes each order's `order.ship`, and `warranty.activate` with `{ via: 'ship', orderId }` for each piece whose warranty starts there (question 14, no point of sale); Mark delivered each order's `order.deliver` `{ by: 'logistics' }`. No name, address, phone, claim code nor photo bytes. **Order cases** (migration `0037`, plan NEXT LOT §3.5.6.7, §5.87): `order.case.open` (`{ caseId, kind, reason?, sizeLabel?, shipmentId?, by }`; `by: 'account'`, the account as actor, for a return or an exchange the collector asks from YOUR ORDERS, §3.6.D), `order.case.receive` (`{ caseId, kind, pieceState }`), `order.case.decide` (`{ caseId, kind, outcome, pieceTo, exchangeOrderId?, shipmentId? }`) and `order.case.cancel` (`{ caseId, kind, by? }`: `by: 'registration'` when a buyer's registration ends a parcel problem) target the case's order; `order.reship` (`{ caseId, shipmentId, reservation, queueFirst? }`) each order of a parcel shipped again; `order.exchange` (`{ exchangeOrderId, skuId }`) the order exchanged, beside the EXCHANGE order's `order.create`, `order.pay` and `invoice.issue`; the pieces of a lost parcel `product.transition` to REVOKED (`via: 'order.case.decide'`). **Never the note, the agent's or ORBES's words.** **YOUR ADDRESSES and the delivery address** (migration `0039`, plan NEXT LOT §3.6.B, §5.88, §5.51): `account.address.create` (`{ addressId, country, isDefault }`), `.update` (`{ addressId, country, fields }`), `.remove` (`{ addressId, country, defaultNow? }`) and `.default` (`{ addressId, country }`) target the account, the account as actor; `order.address` (`{ by: 'collector', country, changed }`) targets the order, the account as actor; `order.buyer` (Client Services) carries `changed` (an address replaced after it was first entered) and the `country`; `order.create` the default address put on the order (`address: { by: 'collector', country }`). **Never a name, an address's lines nor a phone.** **The engraving** (migration `0039`, plan NEXT LOT §3.6.C, §5.89): `order.engraving` targets the order (`{ by: 'collector' | 'staff', priced, addon, removed?, currency? }`: who typed it, the price it took or none, whether it is the release's add-on, a removal, a currency changed), the account or the console user as actor; `order.engraving_prices.update` (ADMIN, `targetType` `engraving_prices`) the prices before and after (until lot Q2, which removed the setting: the engraving's prices are its add-on's, `addon.prices`); `invoice.issue` carries `supplements` (the order's invoice's number) on a supplementary invoice, `invoice.credit` `scope: 'LINES'` and `reason: 'engraving'` on a credit note for single lines, `scope: 'FULL'` and `remains: true` on one that credits what remains. **Never the engraving's words.** **TEST ENTRANTS** (migration `0024_z`, §5.73 to §5.75): `test_run.start`, `test_run.add`, `test_run.stop`, `test_run.confirm`, `test_run.release` and `test_run.end` target the test (`targetType` `test_run`), the ADMIN as actor: the release's id, its mode, the test entrants sent (and their tiers), the test entrant's account and entry for a confirmation or release by hand, and, for END TEST, the status it ended from, the report's checks passed and what the clean-up did (counts); the test entrants' own actions are audited by the routes as any account's (`drop.enter`, `drop.live.secure`, …); END TEST's clean-up writes `drop.withdraw`, `drop.entry.lapse` (with `from`, the status it left), `drop.live.interest.withdraw` and a CONFIRMED LIVE entry's `drop.live.remove` (`from: "CONFIRMED"`) with `reason: "test_ended"`, and `drop.live.remove`, `order.cancel` (a GIFT order's too) and `order.credit.release` as their services write them. **YOUR PROFILE** (migration `0040`, plan CUSTOMER INTELLIGENCE §3.1, §5.91 to §5.93): `account.register` carries `{ profile: true, heardOptionId }` when the sign-up gave the names (the answer's id, or null), **never the names nor the country**; `account.profile.update` targets the account (`targetType` `account`), the account or the console user as actor, with `{ by: 'collector' | 'staff', fields, tastes?, birthDate? }`: the names of the fields changed (`firstName`, `lastName`, `country`, `city`, `phone`, `birthDate`, `instagram`, `heard`, `tastes`), the tastes' counts (`{ pieces, finishes, added, removed }`) and `birthDate: 'set'` when a date is entered (`'changed'` or `'cleared'` by Client Services, with `noteId`, the private note that keeps the reason, §5.114); **never a value**, and nothing when nothing changed. **The client sheet's tags and private notes** (migration `0044_client_notes`, plan CUSTOMER INTELLIGENCE §3.6 C.4.3, §5.114 and §5.115) target the account (`targetType` `account`), the console user as actor: `account.note.add` (`{ noteId, length }`) and `account.note.remove` (`{ noteId }`), **never the note's words**; `account.tag.add` and `account.tag.remove` (`{ tag }`), a tag being a house label. None of the four reaches the account's right-of-access export (API §16.13), which leaves them out of its `activity`. `account.address.create` and `.update` carry `by: 'staff'` when Client Services wrote the default address (`AddressService.setDefaultByStaff`), never its words. `heard_option.setup` (the system, the first boot's answers, `{ labels }`), `heard_option.create` (`{ label }`), `heard_option.update` (`{ before, after }`, each `{ label, active }`) and `heard_option.order` (`{ labels }`, in their new order) target the answers (`targetType` `heard_option`), the ADMIN as actor: house words, no personal data. **Links** (migration `0043`, plan CUSTOMER INTELLIGENCE §3.4, §5.106 and §5.107): `link.create` (`{ linkId, code, name, channelId, destination, dropId, modelId, cost }`), `link.update` (`{ before, after }`, the changed fields only), `link.archive` and `link.unarchive` target the link (`targetType` `link`); `link_channel.create` (`{ name, position }`), `.update` (`{ before, after }`) and `.delete` (`{ name }`) target the channel (`targetType` `link_channel`); the console user as actor: house words. Visits, arrivals, a device linked to an account, first sources and conversions are never audited: data, not decisions. **Deployment I2** (plan CUSTOMER INTELLIGENCE §3.5, §3.6): `club.grant` with `kind: 'BIRTHDAY'` (the system as actor, targeting the account; the grant's id, amount, currency, expiry and birthday, never the date of birth) for each birthday credit inserted; `collectors.export` (`targetType` `collectors`, the ADMIN as actor, `{ filters, rows, columns }`: the five filters, the row count and the columns' version, never an email nor a value of a row), written before the file is sent. The engagement score, its daily runs and the monthly history are never audited: derived data, `engagement_runs` and the job's log line are their trace. Plan ORBES CARE of 2026-10-15: `model.warranty` (targeting the model, the ADMIN as actor, `{ before, after, pieces, sold, nowExpired }`: the warranty kinds and the counts of warranties rewritten, started and EXPIRED now); `warranty.claim.open`, `.label`, `.receive`, `.decide`, `.legal`, `.ship` and `.cancel` (`targetType` `warranty_claim`, the staff member as actor: the claim, the piece, the basis, the outcome and refusal reason, a part credit's percent, a replacement's identity, never the note nor an email); `club.grant` with `kind: 'WARRANTY'` for each warranty credit given; `warranty.activate` with `via: 'warranty_claim'` and the claim's id when a replacement ships; `model.create` carries the model's `warrantyLifetime`, and `model.variant.create`'s `copied` names `warranty`. **Lot M1** of 2026-10-21: the pace (targeting the release, counts only): `drop.live.pace` (`{ before, after, nextAt }`), `drop.live.pace.pause` (`{ batches }`), `drop.live.pace.resume` (`{ pausedMs, nextAt }`), `drop.live.pace.next` (`{ batch, entries }`), the staff member as actor, and the engine's `drop.live.admit` (`{ batch, at, entries }`, the system as actor; none for a batch with nobody waiting); `drop.live.let_in` adds `admitted: true` when it admitted an entry still waiting for its batch. `drop.campaign.links` (targeting the release, OPERATOR: `{ dropId, count, codes }`, the links made, each also its own `link.create`; none when it made none). The founding list (targeting the pre-registration, `targetType` `preregistration`, never the address): `founding.register` (`{ preregistrationId, sourceKind }`), `founding.match` (the account and when), `founding.unsubscribe` (the emails cancelled), `founding.remove` (ADMIN, whether it was matched). The emails, never an address nor a body: `email.kind.enable` and `email.kind.disable` (ADMIN, targeting the kind, `targetType` `email_kind`), `email.template.update` (OPERATOR: whether the subject and the body changed and whether each is the default now, never the words), `email.test` (ADMIN, the outbox row's id), `email.announcement.queue` (ADMIN, targeting the release: when, `notBefore`, the emails written and the reach) and `email.announcement.cancel` (the emails cancelled); `account.recovery_code.request` (a reset by email, the account as target, never the code nor the address: its entries are the 3-an-hour counter), `account.email_preferences` (`{ releaseNotices, by }`). The sender writes no audit entry: the outbox row is its record. The house messages (lot M2, D24; never a collector's name or email, the words as their length and SHA-256): `house.moment.enable` and `house.moment.disable` (ADMIN, targeting the moment, `targetType` `house_moment`), `house.moment.words` (OPERATOR), `house.moment.delivered` (`{ moment, count }`, the system, one per transaction of a pass), `house.message.create`, `.update`, `.delete` (OPERATOR, targeting the message, the audience as a segment's id or a tier), `.schedule`, `.send`, `.cancel` (ADMIN) and `house.message.delivered` (`{ id, reach }`, the system). WORN (lot M2, D31; targeting the photograph, `targetType` `worn_photo`, never the credit's name): `worn.send` (the owner: `{ id, productId, modelId, bytes, sha256, instagram }`), `worn.withdraw` (the owner), `worn.publish`, `worn.refuse` and `worn.take_down` (OPERATOR, with the reason), `worn.end` (`{ count }`, the system). Lot M3 (macro scope of 2026-10-20, lot M3 of 2026-10-23; ids, fields and figures, never anything personal): `box.create`, `box.update`, `box.set_aside`, `box.reinstate` (ADMIN), `model.packing` (OPERATOR), `shipment.box` (CHANGE BOX, the agent or staff); `stock.location.countries` (ADMIN, the countries added, removed and moved); `supplier_order.draft` gains the source `SPLIT` (ADD TO DRAFTS); `reception.confirm` gains `countedIn` (an add-on line's units); `addon.create`, `addon.update`, `addon.prices`, `addon.set_aside`, `addon.reinstate`, `addon.shopify` (OPERATOR); `order.addon.add` and `order.addon.remove` (the collector, staff, or the purchase), `drop.entry.addons` and `drop.live.addons` (the choices, by id and units); the add-ons left out at a sale in the confirmation's details (`addonsLeftOut`); `set.create`, `set.update`, `set.set_aside`, `set.reinstate`, `set.shopify` (OPERATOR) and `set.sale` (a set sold: its set, release, orders and shares). Lot Q1, ONE QUEUE (migration `0058`; targeting the release, counts and times only): the engine's `drop.live.batch` (`{ batch, at, turns }`, the system as actor, for each batch that gave a turn, `extra: true` for NEXT BATCH NOW's; it replaces lot M1's `drop.live.admit`, which is written no more), `drop.live.pace.next` (`{ batch, turns }`), `drop.live.hold.shorten` (`{ before, after, minutes }`) and `drop.live.hold.end` (`{ before, at }`), OPERATOR; `drop.live.create` and `.update` carry the hold (`holdMinutes`) with the pace; `drop.live.resume` carries the next batch's time (`nextAt`) on a paced release.
- `ownership.claim_failed` entries double as the counter for the claim-code attempt limit (5 failures per product per rolling hour) (since the piece's latest new claim code, §5.76, when it is more recent: a new code starts with five fresh attempts), so the limit holds across server instances and restarts. `account.recover_failed` entries do the same for the recovery-code limit (5 wrong guesses per code per rolling hour: the entries naming the open code, `details.recoveryCodeId`; §5.23).
- **Lot PURGE** (migrations `0066` and `0067`): the purge's actions, `admin.step_up` `{ purpose }` (targeting the admin; never the code, the password or the phrase), `test_run.purge.start`, `test_run.purge.pause`, `test_run.purge.resume`, `test_run.purge.done`, `test_run.purge_all.start`, `test_run.purge_all.done`, `test_run.purge_all.pause`, and the reset's, `platform.reset.requested`, `platform.reset` (always entry 1 of a new log, below), `platform.reset.failed` `{ reason }`, `platform.reset.lock.requested`, `platform.reset.lock`; a wrong step-up code or password is an `admin.login_failed` with `via: "step_up"` (the step-up's daily limit counts those, API §17.14). **Two deletions, both by the database's owner inside the lot's definer functions, never by the app:** the test purge deletes a test's own entries within its range of the chain (`test_runs.purge_windows`, from its `test_run.start` entry to its step-up), never the newest entry, each with its tombstone in the same statement (§5.159); the platform reset empties the log and its tombstones in its one transaction, and **entry 1** of the new log (`platform.reset`, `prev_hash` the 32 zero bytes of the genesis) records who reset, when, the counts, the old log's last entry (`details.oldHead`: its id and hash), the holder's two-factor dates, the ids of the request's and the step-up's entries (`requestId`, `stepUpId`), the 24 hours of facts the step-up still counts (`recent24h`) and what the reset captured before the wipe (`capture`); ids, names, staff emails, dates and hashes only.
- **Retention:** permanent. The application cannot delete entries (since lot PURGE, only the database's owner inside the test purge and the platform reset, above).

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

The one-time code with which a customer who forgot the password sets a new one (C-04; [API §10.8](API.md#108-post-apiv1accountrecover) and [§16.10](API.md#1610-post-apiadminownersidrecovery-code-extension-of-the-contract)). ORBES Client Services checks the customer's identity, then an ADMIN issues the code in the console and reads it to the customer; since migration `0051_emails` (lot M1, E3), once the emails are on and PASSWORD_RESET is switched on, the customer may also ask for one by email (RESET BY EMAIL), sent as a link. Migration `0005_account_recovery`, with `accounts.transfers_frozen_until` (§5.9).

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. Named in the audit entries instead of the code. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id` (`ON DELETE RESTRICT`). |
| `code_hash` | `text` | NOT NULL | — | `CHECK (code_hash LIKE 'scrypt$%')`. scrypt hash (`scrypt$15$8$1$<salt>$<hash>`, as for claim codes) of the canonical 12-character Crockford base32 code (60 bits). The code (`XXXX-XXXX-XXXX`) is in the issuing response only. |
| `created_by` | `uuid` | NULL (since 0051) | — | FK → `admin_users.id` (`ON DELETE RESTRICT`): the ADMIN who issued it; NULL exactly for a code sent by email (`account_recovery_codes_issued_by`: `CHECK ((issued_via = 'STAFF') = (created_by IS NOT NULL))`). |
| `issued_via` | `text` | NOT NULL | `'STAFF'` | Migration `0051_emails`: `CHECK (issued_via IN ('STAFF','EMAIL'))` (`RECOVERY_ISSUED_VIA`): by ORBES Client Services, or sent by email at the customer's request. The previous image's insert, which names neither, is a STAFF code by the DEFAULT. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Set from the service clock. |
| `expires_at` | `timestamptz` | NOT NULL | — | `CHECK (expires_at > created_at)`. Creation + 30 minutes (`RECOVERY_CODE_TTL_MS`). |
| `used_at` | `timestamptz` | NULL | — | `CHECK (used_at IS NULL OR used_at >= created_at)`. Set by the recovery that used it. |
| `revoked_at` | `timestamptz` | NULL | — | `CHECK (revoked_at IS NULL OR revoked_at >= created_at)`. Set when a newer code is issued for the account, or when the account is locked while the code still works (A-06, §5.9). |

- **`account_recovery_codes_used_or_revoked`:** `CHECK (used_at IS NULL OR revoked_at IS NULL)`, never both.
- **Indexes:** primary key; `account_recovery_codes_single_open`: unique `(account_id) WHERE used_at IS NULL AND revoked_at IS NULL` (one open code per account); `account_recovery_codes_account_idx (account_id, created_at)` and `account_recovery_codes_created_by_idx (created_by)`, which lead with the foreign keys (the partial index does not serve the `RESTRICT` check on every row).
- **Written by:** `AccountRecoveryService` (`services/account-recovery.ts`). `issue` (`POST /api/admin/owners/:id/recovery-code`, ADMIN; an ACTIVE account only) locks the account row, revokes the open code and inserts the new one (audit `account.recovery_code.issue` with `{ recoveryCodeId, expiresAt, replaced }`). `requestByEmail` (`POST /api/v1/account/reset-request`, lot M1, E3; while the channel and PASSWORD_RESET are on) does the same for an ACTIVE account that is no test entrant, with `issued_via` EMAIL and no `created_by`, at most 3 an hour per account (counted from its `account.recovery_code.request` entries), and writes its PASSWORD_RESET email (§5.122) in the same transaction; an unknown address writes nothing, and the answer is the same. A new code of either kind revokes the other (the one open code per account). `recover` (`POST /api/v1/account/recover`) locks the account row and reads the open code. Without one, or once it has expired, the attempt is committed as `account.recover_failed` with its reason (`NO_OPEN_CODE`, `EXPIRED`) and does not count. Otherwise it counts the `account.recover_failed` entries of the last hour that name this code (`details->>'recoveryCodeId'`, read through the `audit_logs_target_idx` index on the account; at most 5; then `account.recover_throttled`, the code is not checked), and checks the code against its hash (a wrong guess is committed as `account.recover_failed` with `{ recoveryCodeId, attempt, reason: "MISMATCH" }` before the answer); then, in one transaction, it re-locks the account, sets `used_at` only if the code is still open, writes the new password, clears the login throttle, sets `transfers_frozen_until` to now + 72 hours, deletes every session of the account, withdraws its open links to ownership certificates (§5.27) and cancels its pending transfers (§5.13), and records `account.recover` (with `certificatesRevoked`). A LOCKED account is refused and its code is not used. `OwnerService.lock` (A-06) revokes the account's open, unexpired code in the lock's transaction (counted as `recoveryCodesRevoked` in `account.lock`), so a code issued before a lock fails after the unlock.
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
| `access_segment_id` | `uuid` | NULL | — | N5: FK → `segments.id` (§5.58), `drops_access_segment_id_idx`: a segment whose members may enter, said FOR SELECTED COLLECTORS. Since migration `0050_founding_list` (lot M1, F4) on a DRAW too: `drops_draw_plus` is re-created without it, every other column of this table still NULL for a DRAW; an after-room still has none (`drops_after_room`). A draw's segment is set while it is a DRAFT (`DropService`, `accessSegmentId`, fixed once published); ENTER, RESERVE and CHANGE SIZE refuse a non-member (`403 DRAW_NOT_ELIGIBLE`). |
| `access_combine` | `text` | NULL | — | `CHECK (access_combine IN ('AND','OR'))` (`ACCESS_COMBINES`): how every access rule of the release combines; NULL reads as AND. |
| `question_enabled`, `question_text`, `question_answers` | `boolean`, `text`, `text[]` | NULL | — | G4: the question after (on by default when NULL); its text (1–120 characters) and its 2 to 6 answers, both or neither (`drops_question`; neither: the default question). |

Written by `LiveConsoleService` (the settings, the after-room's child rewritten on every save with the parent's turn and pay windows, per tier too, pieces per person and currency; `409 LIVE_AFTER_ROOM` for any action on an after-room of its own) and the engine (the after-room settled at the parent's end), under the parent's `FOR UPDATE` then the child's.

**The pace** (migration `0049_live_pace`, lot M1 of 2026-10-21, W1 to W6; [API §16.23](API.md#1623-the-live-releases-the-club-pages-live-releases-extension-of-the-contract)): a LIVE RELEASE may let its line in at a fixed pace, X buyers every Y minutes counted across the whole release; inside the room the turns per size, the holds and the pay windows do not change.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `pace_batch` | `integer` | NULL | — | `CHECK (pace_batch BETWEEN 1 AND 5000)` (`LIVE_PACE_BATCH`): X, the buyers admitted per batch. |
| `pace_minutes` | `smallint` | NULL | — | `CHECK (pace_minutes BETWEEN 1 AND 60)` (`LIVE_PACE_MINUTES`): Y, the minutes between two batches. |
| `pace_paused_at` | `timestamptz` | NULL | — | PAUSE PACE in progress: no batch is admitted until RESUME PACE. |
| `pace_next_at` | `timestamptz` | NULL | — | When the next batch is due; NULL before T0 (the first is due at T0). A pause moves it when it ends. |
| `pace_batches` | `integer` | NOT NULL | `0` | `CHECK (pace_batches >= 0)`: the batches admitted so far (a batch with nobody waiting counts). |

- **`drops_pace`:** `CHECK ((pace_batch IS NULL) = (pace_minutes IS NULL) AND (pace_batch IS NULL OR (mode = 'LIVE' AND parent_drop_id IS NULL)) AND (pace_batches = 0 OR pace_batch IS NOT NULL))`: X and Y both or neither (neither is no pace: everyone admitted at T0, as before 0049), on a LIVE RELEASE that is not an after-room only, and a pace that has admitted a batch is never taken away. **`drops_pace_state`:** `CHECK (pace_batch IS NOT NULL OR (pace_paused_at IS NULL AND pace_next_at IS NULL))`.
- **Written by:** `LiveConsoleService` (the settings' `pace` until the announcement, `drop.live.update`), `LiveService` under the release's `FOR UPDATE` (SET PACE `drop.live.pace`, PAUSE PACE `drop.live.pace.pause`, RESUME PACE `drop.live.pace.resume`, NEXT BATCH NOW `drop.live.pace.next`; the release's PAUSE and RESUME hold the pace and move its next batch), and the engine's `advance` (each batch due, at its logical time, `drop.live.admit`), so a restart changes nothing. No control takes a pace away.
- **The previous image** never names these columns: a release it writes has no pace, and it gives turns without reading the admission, as with no pace.
- **Lot M3** (migration `0057_sets`, macro scope K44 T1): **a release sells a model or a set**: `model_id` becomes NULL-able, `set_id` (NULL, FK → `sets.id`) is added, and **`drops_one_offer`** requires exactly one of them; `drops_set_no_after_room`: a set's release is never an after-room (that it never has one is `LiveConsoleService`'s, `409 AFTER_ROOM_SET`); `drops_set_key`, unique `(id, set_id)`, the target of `set_sales_drop_fkey`. A set's release counts its `quantity` in sets and its `per_account` in sets (1 to 5, T4). Every release written before keeps its model; the previous image always names one. Read through `releaseOffer` (`services/release-offer.ts`), which lists the readers that keep, leave out or adapt a set's release.
- **Lot Q1, ONE QUEUE** (migration `0058_one_queue`, 2026-10-24; [API §16.23](API.md#1623-the-live-releases-the-club-pages-live-releases-extension-of-the-contract)): **every LIVE RELEASE has a pace and a hold after the opening, and its batches give TURNS** (up to X in the order of the turns, only where the entry's size has a free piece), the first at T0 + the hold; returned, freed, missed and expired pieces and ADD PIECES wait for the next batch; an after-room has no pace and gives its turns at once. Two columns:

  | Column | Type | Null | Default | Constraints / notes |
  |---|---|---|---|---|
  | `pace_hold_minutes` | `smallint` | NOT NULL | `0` | `drops_pace_hold_minutes_check`, `CHECK (pace_hold_minutes BETWEEN 0 AND 120)` (`LIVE_HOLD_MINUTES`): how long after T0 the first batch waits, everyone included (0: no hold). Set until the announcement; then only shortened or ended: SHORTEN THE HOLD writes its new length and the first batch's earlier time (`pace_next_at`), END THE HOLD NOW 0 and the time now (at T0 before T0). |
  | `pace_extra_batches` | `integer` | NOT NULL | `0` | `drops_pace_extra_batches`, `CHECK (pace_extra_batches >= 0 AND pace_extra_batches <= pace_batches)`: the batches of `pace_batches` NEXT BATCH NOW gave. The hold lasts until the first **scheduled** batch, so no scheduled batch has come while `pace_batches` equals it. |

  **`drops_pace_hold`:** `CHECK (pace_hold_minutes = 0 OR pace_batch IS NOT NULL)`, a hold only with a pace (never on an after-room or a DRAW). **`drops_live_paced`:** `CHECK (mode <> 'LIVE' OR parent_drop_id IS NOT NULL OR pace_batch IS NOT NULL OR ended_at IS NOT NULL OR cancelled_at IS NOT NULL)`: every LIVE RELEASE that is not an after-room carries a pace, unless it has ended or was cancelled (those rows of history stay as they are). `pace_next_at` is the next scheduled batch (before the first, T0 + the hold), `pace_batches` the batches given, scheduled and extra, an empty one counted. The batches are given by the engine's `advance` (`giveDue`, `batchGrants`), at most one per frame of the queue published (`services/live-frames.ts`, in memory), each at its logical time, audited `drop.live.batch` when it gave a turn; NEXT BATCH NOW (`drop.live.pace.next`), SHORTEN THE HOLD (`drop.live.hold.shorten`) and END THE HOLD NOW (`drop.live.hold.end`) under the release's `FOR UPDATE`. `up` refuses, naming the count, while an open LIVE RELEASE (not an after-room, not ended, not cancelled) has no pace; `down` refuses while a release has a hold, otherwise the schema of `0057` exactly. The previous image never names the two columns (their default 0 applies); a release it would write without a pace is refused by `drops_live_paced`.
- **Lot Q3, THE VAULT** (migration `0061_the_vault`, D4 "staff switch per LIVE release, off by default"): `vault_on` (`boolean`, NOT NULL, default `false`). **`drops_vault_on`:** `CHECK (NOT vault_on OR (mode = 'LIVE' AND parent_drop_id IS NULL))`: only a LIVE RELEASE that is not an after-room (an after-room gives no vault of its own, N20). On, the PAY that sells a size out gives a vault to every entry of that size still WAITING or QUEUED (the whole release's line when it sells out whole), in that PAY's transaction (`giveLiveVaults`, §5.143). Set by `LiveConsoleService.setVault` (`PUT /api/admin/live/:id/vault`, OPERATOR, audited `drop.live.vault` with the value before and after) on a draft or a published release until its end (`409 LIVE_ENDED` after its end or its close, `409 LIVE_AFTER_ROOM`, `DROP_CANCELLED`). `0061`'s down step refuses while a release has it on.

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

- **Indexes:** primary key; `drop_entries_drop_account_key (drop_id, account_id)`, which leads with the release; `drop_entries_account_idx (account_id, created_at)`, the account's entries; `drop_entries_handled_by_idx (handled_by)`; `drop_entries_drop_status_idx (drop_id, status, rank)`, the draw's list, the next of the waiting list and the places taken. `drop_entries_size_idx (drop_id, size_id, status, rank)` (0038), the counts per size, each size's waiting list and the draw's fill per size. `drop_entries_created_idx (created_at)` (0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 10): the conversions job's candidates by when they were written (§10).
- **Triggers:** `drop_entries_immutable_identity` (BEFORE UPDATE, guards `id`, `drop_id`, `account_id`, `created_at`), raising `OR001`.
- **Written by:** `DropService` only. `enter` and `withdraw` (`POST /api/v1/club/drops/:id/enter`, `/withdraw`): the account's row `FOR SHARE` (`readActingAccount`: a LOCKED account is refused), then the release's `FOR SHARE`, refused once `drawn_at` is set; audit `drop.enter`, `drop.withdraw`. `reserve` (`POST /api/v1/club/drops/:id/reserve`, P-X02): the account's row `FOR SHARE`, then the release's **`FOR UPDATE`**, so two reservations count the places held one after the other; inside the early access only, for a tier of at least PLATINE read then (`tierOf`), while SELECTED and CONFIRMED stay under `quantity`; audit `drop.reserve` with `{ entryId, tier, respondBy }`. Plan NEXT LOT §3.6.F (`size_id`): in a draw with sizes, `enter` and `reserve` write the size chosen (a reservation refused once its size is full: the pieces held or sold in it and those of its guaranteed entries waiting), `changeSize` (`POST /api/v1/club/drops/:id/size`, under the same locks, the entry's row `FOR UPDATE`) changes an ENTERED entry's size while entries are open, audited `drop.size`; `withdraw` keeps it. `draw` (§5.29): every ENTERED entry, under the release's `FOR UPDATE`, gets its account's tier and seniority read then (`clubStandings`, `services/club.ts`: open ownerships of pieces neither REVOKED, COUNTERFEIT_FLAGGED nor RETIRED, and the first `started_at`; `ownership` is only read), its rank, and SELECTED with `respond_by` or WAITLISTED, in statements of 500 rows. In a draw with sizes, the draw ranks every ENTERED entry once, then selects in rank order while the entry's size has a piece left (its pieces less those held or sold in it and those of the guaranteed entries just selected in it). `confirm`, `lapse` (after `respond_by` only) and `offerNext` (the first WAITLISTED by rank, while SELECTED and CONFIRMED stay under `quantity`; in a draw with sizes, per size, within its pieces), under the release's row lock, audited `drop.entry.confirm`, `.lapse`, `.offer`. `withdrawAccountEntries`, in the transaction of `OwnerService.lock` (§5.9): the account's ENTERED entries of releases neither drawn nor cancelled become WITHDRAWN (their releases read `FOR SHARE` first, as an entry does), before the transfers are cancelled, each audited `drop.withdraw` with `reason: "account_locked"` after the row locks.
- **The house's guarantee** (IN-01): the draw selects the entries ENTERED with a guarantee first, SELECTED for their pieces without a rank or a tier, their guarantees USED, then ranks the others for the places left (`quantity` less the pieces held or sold and those just selected); a holder's reservation is SELECTED with its guarantee, no tier; a reservation never takes a piece a guarantee set aside for the release covers (DROP_FULL). CONFIRMED creates one order per piece (§5.51).
- **Read by:** the draw's public list (`GET /api/v1/drops/:id/entries`: the ranked entries' `id`, `tier`, `seniority`, `rank`, never the account nor a direct reservation; the release's page lists the guaranteed entries apart once drawn, `guaranteed`: `id` and `pieces`, never an account), the release's page (`reserved`, the count of direct reservations held or sold), the account's status (its own entries), the console (`GET /api/admin/drops/:id/entries`: the account's email, masked for an AUDITOR), and the account's export (`OwnerService.exportData`: every entry, never the note nor who concluded it).
- **Privacy:** an entry is personal data: the account, its standing at the draw (or at its direct reservation), the status of a purchase. What the draw publishes (the id, tier, seniority and rank of each entry) names no account; only the account knows its entry's id. Kept as long as the account (§10), exported with it (API §16.13).
- **Lot M3** (migration `0057_sets`): `drop_entries_entry_drop_key`, unique `(id, drop_id)`, the target of §5.137's composite foreign key; an entry of a set's draw keeps `size_id` NULL and names a size per piece in `drop_entry_sizes`. Its catalogue add-ons chosen on a place held are `addon_choices` (§5.134).

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
- **Lot M4, partner experiences** (migration `0064_partners`, macro scope K49 P2; [API §16.20, §16.52](API.md#1652-partners-their-experiences-and-their-invoices-extension-of-the-contract)): `partner_experience_id` (`uuid`, NULL, FK → `partner_experiences.id` `ON DELETE RESTRICT`, `circle_posts_partner_experience_idx`): the partner's experience an invitation is for (§5.152); **`circle_posts_partner_experience`:** `CHECK (partner_experience_id IS NULL OR experience IS NOT DISTINCT FROM 'PARTNER_EXPERIENCE')`, on an invitation of a partner experience only. Several invitations may name one experience. Written by `CircleService.create` and `update` (OPERATOR, `partnerExperienceId`; an unknown experience `404 PARTNER_EXPERIENCE_NOT_FOUND`, a cancelled one `409 PARTNER_EXPERIENCE_STATE`, read `FOR SHARE`), audited in `circle.post.update`'s before and after; a link moved to another partner's experience, or removed, clears the names shared with the first (`sharedNamesCleared`, §5.33). Read by the post and the feed (`partner`: the brand, as WITH <BRAND>), the console and the experience's guests.

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
- **Lot M4, a guest's name shared with the partner** (migration `0064_partners`, macro scope K49 P3): `share_name` (`boolean`, NOT NULL, default `false`) and `share_name_at` (`timestamptz`, NULL): the guest who answered YES chose to share their first and last name with the invitation's partner, and when; **`circle_rsvps_share_name`:** `CHECK (share_name = (share_name_at IS NOT NULL))`; **`circle_rsvps_share_name_yes`:** `CHECK (NOT share_name OR answer = 'YES')`. Written by `CircleService.rsvp` with the answer under the post's row lock (`shareName`, on a post linked to an experience only: `422 CIRCLE_SHARE_NOT_OFFERED` elsewhere, `409 CIRCLE_SHARE_NAME_MISSING` without both names); a NO clears it in the same update; an answer of the previous image takes `false`. Read by the post (the reader's own choice), the console's answers (SHARES NAME) and the experience's guests (`PartnerService.guests`: the names given only for those who ticked, to OPERATOR and ADMIN). Personal data: exported with the account (API §16.13 `circleAnswers[].shareName`, `shareNameAt`).

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
- **Lot M3** (migration `0057_sets`, K44 T1): `piece` (NULL on a model's release; 1–4, the set's position, on a set's), `position` widened to 1–96 (4 pieces × 24 sizes), `drop_sizes_label_key` now unique `(drop_id, piece, label)` `NULLS NOT DISTINCT` (a label once per release and piece; once per release on a model's), `drop_sizes_piece_key` unique `(id, drop_id, piece)`, the target of the sizes per piece (§5.137); the identity guard gains `piece`. Each size of a set's release is linked to its piece's model's SKU (`linkDropSizes`).

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
| `admitted_at`, `admitted_batch` | `timestamptz`, `integer` | NULL | — | Migration `0049_live_pace` (lot M1, W4): when the entry was admitted to take a turn (its batch's logical time; with no pace, the moment it took its place) and its batch (`CHECK (admitted_batch >= 0)`: 0 with no pace, or by LET IN before the first batch). `live_entries_admitted`: `CHECK ((admitted_at IS NULL) = (admitted_batch IS NULL) AND (admitted_at IS NULL OR position IS NOT NULL))`, both or neither, and only with a place in the line. Only an admitted QUEUED entry is given a turn. **Since `0058_one_queue`** (lot Q1, ONE QUEUE) the two columns mean **"given its turn by batch N at the batch's logical time"**: written with the turn, by the batch that gives it (`admitted_batch` its number, `admitted_at` its logical time, a slot's or a NEXT BATCH NOW's press time), 0 in an after-room (no pace: its turns at once), and by LET IN the batches given so far, with `let_in_by`; a `QUEUED` entry has neither. |
| `guarantee_id` | `uuid` | NULL | — | Migration `0029_house_guarantee` (plan NEXT-NINE, IN-01). FK → `house_guarantees.id` (§5.69); `live_entries_guarantee_key`, unique. The holder's entry: let in whatever the release's rule, up to max(`per_account`, its pieces), first in line at T0 and first among those waiting in its size afterwards (the turns, the places ahead, the console's list and the after-room's guests order by `guarantee_id IS NULL`, then `position`); its turn uses the guarantee (USED). Cleared by LEAVE, REMOVE and a lock before the turn, and at the release's end or cancellation when unused. |

The statuses hold their facts, one CHECK each: `live_entries_status_waiting` (no place, not ended), `_queued` (a place, no turn), `_turn` (a turn, not secured), `_secured` (secured, not confirmed), `_confirmed` (`status = 'CONFIRMED'` exactly when `confirmed_at` is set, never ended), `_missed` (a turn, never secured, ended), `_returned` (`EXPIRED` and `RELEASED`: secured, ended), `_left` (`LEFT` and `ENDED`: never secured, ended), `_removed` (`status = 'REMOVED'` exactly when `removed_at` is set).

- **Indexes:** primary key; the two unique keys; `live_entries_line_idx (drop_id, status, position)`, the line and its head; `live_entries_size_status_idx (drop_id, size_id, status)`, the pieces held per size and the composite foreign key; `live_entries_account_idx (account_id, joined_at)`, MY PIECES; `live_entries_let_in_by_idx`, `live_entries_removed_by_idx`, `live_entries_handled_by_idx`; `live_entries_joined_idx (joined_at)` (0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 10: the conversions job's candidates, §10); `live_entries_waiting_admission (drop_id, (guarantee_id IS NULL), position) WHERE status = 'QUEUED' AND admitted_at IS NULL` (0049, lot M1): the next batch in the line's order (the guarantees, then the places), and each waiting entry's place in the queue; since `0058` (ONE QUEUE) it is exactly the waiting queue, which the batches and the queue's snapshot (`services/live-queue.ts`) read.
- **Triggers:** `live_entries_immutable_identity` (BEFORE UPDATE, guards `id`, `drop_id`, `account_id`), raising `OR001`.
- **Written by:** `LiveService` only (`services/live.ts`): the customer's actions (§8.2: the account's row `FOR SHARE`, the release's, then the entry's), the console's controls (LET IN admits an entry still waiting for its batch), and the engine's pass (`advance`: the line at T0, the batches due on a paced release, `MISSED` and `EXPIRED` at their logical deadlines, the end, the turns); `removeAccountLiveEntries` in the transaction of `OwnerService.lock`; `LiveConsoleService.resolve` (the outcome); housekeeping (`eraseLiveNetworkHashes`).
- **Read by:** the account's own state, stream and MY PIECES (its entry only, the turn's secret while it is its turn), the room's snapshot (counts only), the console (the line with the account's email, masked for an AUDITOR; the reservations; the intelligence), the account's export (every entry with its `admittedAt`, never `network_hash`, nor who let it in, removed it or concluded it).
- **Privacy:** personal data: the account, its steps and their times, the length of its hold, its country, its network's keyed hash (30 days), the reservation and its note. Kept as long as the account (§10), but the network's hash; exported with it (API §16.13).
- **Lot M3** (migration `0057_sets`): `live_entries_entry_drop_key`, unique `(id, drop_id)`; an entry of a set's release keeps its first piece's size in `size_id` and every piece's in `live_entry_sizes` (§5.137), its `quantity` in sets. Its catalogue add-ons chosen on a hold are `addon_choices` (§5.134).

### 5.40 `live_access_models`

The models whose owners may enter a LIVE RELEASE (choice 35), with `drops.access_collection_id` for a collection. Primary key `(drop_id, model_id)`; FK `drop_id` → `drops.id`, `model_id` → `models.id`; `live_access_models_model_idx (model_id)`. Written by `LiveConsoleService` (until the announcement); read by `accessOf` (a piece of one of them held now) and the rule in words. No personal data.

### 5.41 `live_addons`

**Dropped by migration `0060_release_addons_converted` (lot Q2, ADD-ONS ONE SYSTEM, D2, D5)**: each release add-on became a catalogue add-on (§5.131, recorded in §5.140), each release not ended picks it (§5.139); an order of before keeps what it sold in `orders.addons` (§5.51). As it was until then: the add-ons a LIVE RELEASE offers with a piece held (choice 34: engraving, a gift box…): `id` (PK), `drop_id` (FK → `drops.id`), `label` (`CHECK (length(btrim(label)) BETWEEN 1 AND 40)`), `line` (NULL, 1–120 characters), `price_minor` (`CHECK (price_minor >= 0)`, per piece, in the release's currency), `position` (1–6, `live_addons_position_key` unique `(drop_id, position)`, which leads with the release). `live_addons_immutable_identity` guards `id` and `drop_id`. Written by `LiveConsoleService` (until the announcement). No personal data.

### 5.42 `live_entry_addons`

**Dropped by migration `0060_release_addons_converted` (lot Q2)**, after its last rows (only CONFIRMED entries', whose orders hold them as sold) were deleted; `0060` refuses to run while one is chosen on an entry in TURN or SECURED. A hold's add-ons are its choices (§5.134). As it was until then: the add-ons an entry chose for its piece held: primary key `(entry_id, addon_id)`; FK `entry_id` → `live_entries.id`, `addon_id` → `live_addons.id` (`live_entry_addons_addon_idx`); `price_minor` (`CHECK (price_minor >= 0)`), **the add-on's price when it was chosen**, so a reservation's total never moves. Replaced as a whole by `setAddons`; deleted with a piece given back, a hold that ends or is freed, and a removal. Personal data with its entry; exported with it.

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
- **Lot M3** (migration `0055_location_countries`): the countries each location serves are rows of `stock_location_countries` (§5.130), read with every location (`countries`).

### 5.47 `skus`

A model in one size: `id` (PK), `model_id` (FK → `models.id`), `size_label` (NULL for a model in one size, else 1–100 characters, trimmed: the label of a release's size or of a piece's `variant`), `code` (`CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._/ -]{0,63}$')`, unique: the model's SKU prefix and the size, `deriveSku`), `shopify_product_id` and `shopify_variant_id` (NULL, positive decimals; the variant unique), `created_at`. `skus_model_size_key`: a unique index on `(model_id, upper(size_label))` `NULLS NOT DISTINCT`, one row per model and size whatever the case the size is written in (`Small` and `SMALL` are one SKU); `skus_model_sku_key`, unique `(model_id, id)`, the target of the composite foreign keys `products_sku_fkey` and `orders_sku_fkey` (a piece's or an order's SKU is one of its own model). **No stock column**: the stock is the ledger's (§5.48). `skus_immutable_identity` guards `id`, `model_id`, `size_label` and `created_at`. `fit_min_mm` and `fit_max_mm` (migration `0030_account_sizes`, plan NEXT-NINE AC-01; `smallint`, NULL): the measures the size fits, in whole millimetres of its model's size kind (a French ring size, or centimetres × 10), both or neither, from 1 to 1 000, the first at most the second (`skus_fit`); NULL: the size's label itself is read as the measure (`services/sizes.ts` `labelToMm`). Set from the console's Sizes section (`PUT /api/admin/models/:id/sizes`, audited `model.sizes.update`); read to match a saved size (§5.71). `set_aside_at` (`timestamptz`, NULL) and `set_aside_by` (`uuid`, NULL, FK → `admin_users.id`, led by `skus_set_aside_by_idx`), migration `0033_model_sizes` (plan NEXT LOT, §3.3): since 0033 a model's sizes are **declared** in the Catalogue, each **offered** (`set_aside_at` NULL) or **set aside** (no longer offered for new releases, supplier orders or the private salon; its stock, pieces, orders and history keep it, and it can be reinstated); `set_aside_by` the admin who set it aside, NULL for a script, never without its time (`skus_set_aside`: `CHECK (set_aside_by IS NULL OR set_aside_at IS NOT NULL)`). A declared size is **removed** (its row deleted) only when nothing uses it (`services/sizes.ts` `SKU_USES`: a stock movement, an order, a piece, a release's size, a minimum, a bench item, from migration `0036` a supplier-order line, a reception line, a return to a supplier or a stock correction, an OPEN salon request of the model in that size, a Shopify id), otherwise set aside; the RESTRICT foreign keys stay the backstop. `skus_model_offered_idx (model_id) WHERE set_aside_at IS NULL` serves a model's offered sizes. `skus_immutable_identity` is unchanged. `supplier_id` (`uuid`, NULL, FK → `suppliers.id`, led by `skus_supplier_id_idx`), migration `0035_logistics_access`: the size's own supplier, over its model's (§5.3 `supplier_id`); NULL: its model's. Set with the model's (`SupplierService.setModelSupplier`, audited `model.supplier`).

- **Written by:** `SizeService.declare`, `removeSize` and `reinstateSize` (`services/sizes.ts`, the Catalogue's Sizes, OPERATOR, audited `model.sizes.declare`: the model's row `FOR NO KEY UPDATE`, then each SKU it removes or sets aside `FOR UPDATE` in id order), and `ensureSku` (`services/stock.ts`): by issuance (a piece's SKU), the console's sizes of a LIVE RELEASE (`drop_sizes.sku_id`), PAY (an order's), at boot (`linkSkus`: the pieces and sizes written before 0022, or by the previous image), and the Shopify ids pasted back (`ShopifyService`, `PUT /api/admin/models/:id/shopify`, OPERATOR, under the advisory lock `SHOPIFY_PRODUCT`; audited `model.shopify`, the ids before and after; `409 SHOPIFY_PRODUCT_TAKEN`, `SHOPIFY_VARIANT_TAKEN`).
- **Read by:** Logistics (stock per SKU and location; the Atelier until plan NEXT LOT step 5.13), the orders, the Catalogue's Shopify column and the product export (N2). No personal data.
- **Lot M3** (migration `0056_addons`, K48 D1): an add-on's stock is a SKU like a size's. `model_id` becomes NULL-able, `addon_id` (NULL, FK → `addon_items.id`; `skus_addon_id_key`, one SKU per add-on) is added, and **`skus_owner`** requires exactly one owner; `skus_addon_plain`: an add-on's SKU has no size and no fit. `skus_model_size_key` now covers the models' SKUs only (`WHERE model_id IS NOT NULL`), so two add-ons' SKUs never collide; `skus_addon_sku_key`, unique `(addon_id, id)`, lets a unit name its add-on's SKU (§5.133) as `skus_model_sku_key` lets an order name its model's: an order or a piece can never name an add-on's SKU. The identity guard gains `addon_id`. An add-on's SKU code is given by staff at its creation (unique among every SKU). Every reader that lists SKUs names either owner (`services/sku-owner.ts`); the readers of a model's sizes keep their inner join to `models`.

### 5.48 `stock_movements`

The ledger of the stock, **append-only**: `id` (`bigint` identity, PK), `sku_id` (FK → `skus.id`), `location_id` (FK → `stock_locations.id`), `delta` (`CHECK (delta <> 0 AND delta BETWEEN -10000 AND 10000)`), `reason` (`CHECK (reason IN ('PRODUCED','ADJUSTED','TRANSFER_OUT','TRANSFER_IN','SHIPPED','RETURNED'))`, `STOCK_MOVEMENT_REASONS`; `RECEIVED` added by migration `0036`), `order_id` (NULL, FK → `orders.id`), `product_id` (NULL, FK → `products.id`), `transfer_id` (NULL), `note` (NULL, 1–500 characters), `actor_type` and `actor_id` (as in §5.5), `created_at`.

- **Its rules, in CHECKs:** `stock_movements_sign` (PRODUCED, TRANSFER_IN and RETURNED add, TRANSFER_OUT and SHIPPED take away, ADJUSTED either way); `_transfer` (a transfer's two halves, and only they, carry a `transfer_id`; `stock_movements_transfer_key`, unique `(transfer_id, reason)`, at most one of each); `_piece` (a movement that names a piece moves one); `_order` (SHIPPED −1 and RETURNED +1 with their order, PRODUCED +1 with its piece, RECEIVED with neither order nor piece but its reception line, nothing else names an order). Migration `0036_supplier_orders` (plan NEXT LOT §3.5): `reception_line_id` (NULL, FK → `reception_lines.id`, led by `stock_movements_reception_line_idx`), present exactly for RECEIVED (`stock_movements_received`), a reception line's pieces entering the stock, positive (`stock_movements_sign`).
- **Balances:** per (SKU, location), on hand is the sum of the deltas (`stock_movements_balance_idx (sku_id, location_id)`); reserved, the orders holding one of them (`orders.reservation` STOCK, `orders_stock_reservation_idx`); available, on hand less reserved, never below 0 (`stockLevel`). An adjustment or a transfer never takes a reserved piece (`409 STOCK_NOT_AVAILABLE`).
- **Indexes:** primary key; the balance index; `stock_movements_location_idx`, `_order_idx`, `_product_idx`; the transfer key.
- **Triggers:** `stock_movements_append_only` (BEFORE UPDATE OR DELETE, `OR001`).
- **Written by:** `recordMovement` (`services/stock.ts`) only, each change under the SKU's row lock (`lockSku`, §8.2), journaled `stock.move`: a piece finished by the atelier (PRODUCED, until plan NEXT LOT step 5.13; the rows written stay), a reception's pieces issued (RECEIVED, §5.80), a count corrected (ADJUSTED, with its note, `stock.adjust`, OPERATOR), a transfer (`stock.transfer`, OPERATOR), an order shipped (SHIPPED) or returned to stock (RETURNED).
- **Privacy:** no personal data (staff ids and notes about pieces).
- **Lot M3** (migration `0056_addons`): `order_addon_item_id` (NULL), the unit a SHIPPED or RETURNED movement moves, with its order and SKU (`stock_movements_order_addon_item_fkey` → `order_addon_items (id, order_id, sku_id)`), never with a piece (`stock_movements_order_addon_item`). An add-on's reception enters as one RECEIVED movement of its units, with no piece behind it. **What is reserved** is read from the view `stock_holds` (§6.1): the orders' holds and the add-on units held.

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
| `addons` | `jsonb` | NOT NULL | `'[]'` | The release add-ons as sold, a JSON array of at most 6 (`{ label, priceMinor }`). **History since lot Q2** (migration `0060`, N15): kept on the orders of before, which their invoices (ADDON lines), credit notes, exchanges, exports and receipts read; never converted into units; every order since keeps `[]`, its add-ons being its units (§5.133). |
| `surprise` | `text` | NULL | — | 1–500 characters: the release's surprise when it has one (an after-room's: its parent's), a snapshot. |
| `engraving_text` | `text` | NULL | — | 1–120 characters, entered by Client Services; since migration `0039` also typed by the collector in YOUR ORDERS until packing starts (at most 20 characters there; since lot Q2 at most its engraving add-on's `text_max`, and carried from a LIVE hold's choice at PAY, §5.134). |
| `engraving_minor`, `engraving_by` | `int`, `text` | NULL | — | Migration `0039_order_delivery` (plan NEXT LOT §3.6.C). The price the engraving was taken at, 0 to 100 000 000 in the order's currency (Orders → Settings, Engraving, §5.89, read then and kept), only with its words and the order's currency (`orders_engraving_price`); NULL for one bought as the release's ENGRAVING add-on (its price is the add-on's) and for one entered before 0039. **History since lot Q2** (N15): an engraving since is the ENGRAVING add-on's unit (§5.133), its price on the unit, so no new order writes `engraving_minor`; the orders of before keep it, with their ENGRAVING invoice line. `CHECK (engraving_by IN ('COLLECTOR','STAFF'))` (`ADDRESS_SOURCES`): who typed the words, present exactly with them (`orders_engraving_by`; an engraving of before reads STAFF). |
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

- **Indexes:** primary key; the unique keys above; `orders_drop_idx (drop_id, status)`, `orders_account_idx (account_id, reserved_at)` (MY PIECES and the export), `orders_model_sku_idx (model_id, sku_id)`, `orders_location_idx`, `orders_carrier_idx`, `orders_product_idx`; `orders_board_idx (status, reserved_at)`, the board; `orders_stock_reservation_idx (sku_id, location_id) WHERE reservation = 'STOCK'`, the reserved stock; `orders_paid_idx (account_id, paid_at) WHERE paid_at IS NOT NULL` (migration `0032_growth_indexes`, plan NEXT-NINE BP-29): an account's paid orders in the order they were paid, for GROWTH (« Buyers », lifetime value, repeat buying). `orders_reserved_idx (reserved_at)` (migration `0043_acquisition`, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 10): the conversions job's candidates by when they were written, every channel (§10).
- **Triggers:** `orders_immutable_identity` (BEFORE UPDATE) guards `id`, `channel`, `live_entry_id`, `piece`, `drop_entry_id`, `shop_request_id`, `drop_id`, `account_id`, `model_id` and `reserved_at`, and since migration `0027` `with_order_id` and `gift_grant_id` (`OR001`). `orders_source` gains GIFT: no release (as the private salon), its grant and the order it travels with; a grant on a GIFT order only.
- **Written by:** `services/orders.ts` only: `ordersForLiveEntry` (in PAY's transaction, one per piece), `orderForDrawEntry` (a draw's entry CONFIRMED, `DropService`), `orderForShopRequest` (a salon request closed ACCEPTED, `SalonService`), and at boot `OrderService.prepare` (the sales confirmed before 0022: a LIVE resolution CONCLUDED becomes PAID, CANCELLED becomes CANCELLED); the steps (`transition`: exactly `ORDER_TRANSITIONS`, §7.4), `returnOrder`, `changeLocation`, `setTerms`, `setBuyer` (OPERATOR), `setAddress` (the collector's delivery address, plan NEXT LOT §3.6.B), `createOrder` (the account's default address put on a new order of its own) and `attachPiece` (the atelier, `order.link`); `deliverOnRegistration` (in `OwnershipService.registerFirst`); `attachGifts` (a welcome gift, GIFT, on the first order of a sale, BP-19 T5), `applyCredit` and `removeCredit` (§5.67). Each change writes one row of §5.52, one audit entry (`order.*`) and one journal entry (§5.56) in its transaction, under the lock order of §8.2.
- **Read by:** the board, an order's page, the packing slip and the CSV (`FulfilmentService`, the buyer masked for an AUDITOR by the routes), the client sheet, MY PIECES (`forAccount`: the account's own, never the location, what it holds, the surprise, the declared value, the notes or who handled it), the invoices, the Shopify order export, the account's export.
- **Retention:** kept with the account (§10). **Privacy:** personal data: the account, what it bought, the buyer's name and address and the engraving's words.
- **Lot M3** (migration `0057_sets`, K44 T1 to T4): `set_sale_id` (NULL) and `set_piece` (1–4), both or neither (`orders_set_sale`): the piece of a set sale an order is, its price its **share** of the set's (an EXCHANGE order joins the set sale in its piece's place); `orders_set_sale_fkey (set_sale_id, account_id)` → `set_sales (id, account_id)`: a set sale's orders are its buyer's. The identity guard gains both. `orders.piece` reaches 20 on a set sale's orders (a LIVE entry of up to 5 sets of up to 4 pieces), every other order keeping 1 to 5. Its catalogue add-ons are `order_addon_items` (§5.133).
- **Lot Q3, THE VAULT** (migration `0062_vault_rewards`, D20, D29, N12): `channel` gains **`VAULT`** (`orders_channel_check`): a product won free, a VAULT EDITION or THE PIECE (an order at 0), or a model bought under a vault's right to buy (at its usual price). Two columns: `vault_id` (`uuid`, NULL, FK → `vaults.id` `ON DELETE RESTRICT`, `orders_vault_idx`), on a VAULT order and only there; `claim_by` (`timestamptz`, NULL), a VAULT order at 0's end to be claimed (30 Paris days from the opening) and only on it. **`orders_source`** rebuilt (as `0027` did for GIFT): a VAULT order has no release and no shop request, travels with no other order and is piece 1. **`orders_vault`:** every VAULT order names its SKU and its price; at 0 it carries `claim_by` (after `reserved_at`), never waits for stock (never `AWAITING`) and holds its unit (`STOCK`) while RESERVED: the unit reserved for the winner at the opening (§5.143); its SKU may still change at the claim, to a size with stock (`sku_id` is not of the identity). **`orders_vault_key`**, unique `(vault_id) WHERE status <> 'CANCELLED'`: one open VAULT order per vault. The identity guard gains `vault_id`. Written by `services/vault-orders.ts` and `VaultService` (`deliver` at the opening, `buy` under a right to buy, `claim`, and the housekeeping's `vaults` job, which cancels a VAULT order at 0 unclaimed at `claim_by`, its unit back to stock, *Not claimed within 30 days.*, §10). Client Services' edits that would break `orders_vault` are refused in words first (`409 ORDER_VAULT_UNCLAIMED`, `ORDER_VAULT_NO_UNIT`, `ORDER_VAULT_PRICE`). Since lot Q3 a cancellation clears the reservation and sets CANCELLED in a single write, so a VAULT order at 0 can be cancelled while RESERVED.

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

Saved groups of collectors (N5, [API §16.26](API.md#1626-segments-extension-of-the-contract)): `id` (PK), `name` (1–60 characters, trimmed; `segments_name_key`, unique `lower(name)`), `criteria` (a JSON object: a rule tree, ALL or ANY of its rules, one nested level, each criterion negatable, `services/segments.ts`), `created_by` (NULL, FK → `admin_users.id`, `segments_created_by_idx`), `created_at`, `updated_at` (`segments_updated_after`). `segments_immutable_identity` guards `id`, `created_by` and `created_at`. **No member is stored**: its members, the ACTIVE accounts its criteria match, are read live wherever it decides (`drops.access_segment_id`, a LIVE RELEASE's and, since migration `0050` (lot M1, F4), a draw's; `circle_posts.segment_id`). Lot M1 adds the criterion FOUNDING_LIST (the ORIGIN group): the account is matched to a pre-registration (§5.120), an unsubscribed one included, a test entrant never; nothing lasting is given. Since lot M2 a custom house message's audience may be a segment (`house_messages.audience_segment_id`, §5.126), its members read when it is delivered. Written by `SegmentService` (OPERATOR: `segment.create`, `.update`, `.delete`; a segment in use, by a house message DRAFT or SCHEDULED too, is never deleted, `409 SEGMENT_IN_USE`; the messages sent or cancelled to it lose its id and keep its name, `audience_label`, in the deletion's transaction). No personal data in the row; its CSV of members, computed, masks the emails for an AUDITOR.

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
| `care_pieces_platine` | `smallint` | NULL (since 0048) | NULL (since 0048; `1` before) | `CHECK (… BETWEEN 0 AND 20)`: PRIVATE CARE's pieces a year; 0: none; NULL: every piece (plan ORBES CARE, answer 5; migration `0048_orbes_care` set the saved row's to NULL). |
| `care_pieces_palladium` | `smallint` | NULL | NULL | `CHECK (… BETWEEN 0 AND 20)`; NULL: every piece. |
| `messages_priority_min_tier` | `smallint` | NOT NULL | `2` | `CHECK IN (0, 2, 3)`: the Messages board's priority from PLATINE or PALLADIUM; 0: off. Read by `MessageService` at each board, conversation and summary (BP-19 T8): it drives the order and the mark. |
| `gift_platine_model_id`, `gift_palladium_model_id` | `uuid` | NULL | — | FK → `models.id`, each leading its index (`club_program_settings_gift_platine_model_id_idx`, `…_gift_palladium_model_id_idx`): the welcome gift of each tier; NULL: none. Active when set (a service rule; one discontinued since may stay, and gives no gift). |
| `credit_platine_minor`, `credit_palladium_minor` | `integer` | NOT NULL | `5000`, `10000` | `CHECK (… BETWEEN 0 AND 100000000)`: each tier's credit in minor units; 0: none. |
| `credit_currency` | `text` | NOT NULL | `'EUR'` | `CHECK IN ('EUR','GBP','USD','CHF')` (`HOUSE_CURRENCIES`): the one currency of the credit. |
| `credit_validity_months` | `smallint` | NOT NULL | `12` | `CHECK (… BETWEEN 1 AND 60)`. |
| `credit_channels` | `text[]` | NOT NULL | `'{DRAW,LIVE,SALON}'` | `CHECK (credit_channels <@ ARRAY['DRAW','LIVE','SALON'] AND cardinality(credit_channels) >= 1)` (`CREDIT_CHANNELS`). |
| `experience_members_evening_min_tier`, `experience_launch_preview_min_tier`, `experience_partner_min_tier` | `smallint` | NOT NULL | `2`, `3`, `3` | Each `CHECK (… BETWEEN 1 AND 3)`: the lowest tier invited to each experience of the circle (§5.31). |
| `birthday_credit_on` | `boolean` | NOT NULL | `true` | Migration `0045_birthday_credit` (plan CUSTOMER INTELLIGENCE §3.5 SB.4.2, deployment I2): the birthday credit is given (a switch of its own: off, the amount stays for when it comes back, and the credits given stay usable). |
| `birthday_credit_minor` | `integer` | NOT NULL | `2000` | `CHECK (… BETWEEN 1 AND 100000000)`: its amount in minor units of `credit_currency` (€ 20.00 by default; never 0, the switch turns it off). |
| `birthday_credit_days` | `smallint` | NOT NULL | `30` | `CHECK (… BETWEEN 1 AND 365)`: its days of validity from the birthday, the birthday being day 1. |
| `warranty_credit_percent` | `smallint` | NOT NULL | `30` | Migration `0048_orbes_care` (plan ORBES CARE, D5): `CHECK (… BETWEEN 1 AND 100)`, the credit an accepted claim under the lifetime warranty gives once the free replacement is used, in percent of the piece's value (the terms state 30 %). |
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
| `tier` | `smallint` | NULL (since 0045) | — | `CHECK (tier IN (2, 3))`: PLATINE, PALLADIUM; NULL exactly on a BIRTHDAY or a WARRANTY grant. |
| `kind` | `text` | NOT NULL | — | `CHECK (kind IN ('GIFT','CREDIT','BIRTHDAY','WARRANTY'))` (`TIER_GRANT_KINDS`; BIRTHDAY since `0045_birthday_credit`, WARRANTY since `0048_orbes_care`: a warranty claim's credit, §5.119). `tier_grants_once`, unique `(account_id, tier, kind)`: the « EVER » of a tier's grants (a NULL tier never conflicts). |
| `birthday_on` | `date` | NULL | — | Migration `0045`: the Paris day of the birthday a BIRTHDAY grant was given for. `tier_grants_birthday`: a BIRTHDAY grant has `birthday_on` and no tier, every other a tier and no `birthday_on`. `tier_grants_birthday_key`, unique `(account_id, birthday_on) WHERE kind = 'BIRTHDAY'`: one birthday credit per account and birthday, the last guard against two passes at once. |
| `granted_at` | `timestamptz` | NOT NULL | `now()` | |
| `amount_minor`, `currency`, `expires_at` | `int`, `text`, `timestamptz` | NULL | — | A CREDIT's or a BIRTHDAY grant's amount (1–100 000 000 minor units), currency (`^[A-Z]{3}$`) and expiry (`tier_grants_expiry`: after the grant); `tier_grants_credit`: exactly on a CREDIT, a BIRTHDAY or a WARRANTY grant (since 0045 and 0048), never on a GIFT. A WARRANTY grant is valid 12 months (`WARRANTY_CREDIT_VALIDITY_MONTHS`), in the currency of the piece's value. A birthday credit expires at the end (Paris) of its last day. |
| `model_id` | `uuid` | NULL | — | FK → `models.id` (`tier_grants_model_id_idx`): a GIFT's model as given, set each time it is attached to an order; `tier_grants_gift`: never on a CREDIT. |

- **Triggers:** `tier_grants_immutable` (BEFORE UPDATE: `id`, `account_id`, `tier`, `kind`, `granted_at`, `amount_minor`, `currency`, `expires_at`, and `birthday_on` since 0045), `tier_grants_no_delete` (BEFORE DELETE, *a grant is never taken back*). It waits while the account is below its tier. No personal data beyond the account it names.
- **The birthday credit** (plan CUSTOMER INTELLIGENCE §3.5 SB.4, deployment I2): `BirthdayCreditService.grantDue` (`services/birthday-credits.ts`, the housekeeping job `birthdayCredits`, §10) inserts one BIRTHDAY grant for each account with a date of birth, piece or not, on its birthday (a Paris day; 29 February on 28 February in a common year), of THE PROGRAM's amount and currency, valid its days: not DELETED, not a test entrant, its previous birthday credit 365 days or more before (birthday against birthday), its date of birth on the account before 00:00 Paris that day (`account_profiles.birth_date_at`, question 20); a day missed is given at the first pass after while the credit would still be valid, with the days left. Each account in its own transaction under its row `FOR UPDATE` (§8.2), `INSERT … ON CONFLICT DO NOTHING` on `tier_grants_birthday_key`, audited `club.grant` (`kind: 'BIRTHDAY'`) only for a row inserted. Taken off an order like a tier's credit (§5.67), **first**, whatever the tier. Never deleted, so END TEST and an account's deletion leave it as it is.
- **The warranty credit** (plan ORBES CARE of 2026-10-15, D5, D11): `WarrantyClaimService.decide` inserts one WARRANTY grant (no tier, no birthday) for a credit of the piece's value or a part credit (§5.119 `grant_id`), audited `club.grant`. It is usable whatever the tier, taken off after the birthday credit and before the tiers' (`creditBalances`), drawn *CREDIT · WARRANTY* on the invoice, shown apart in IN USE (`warrantyCredit`) and on the owner's Club block; END TEST leaves it as any credit.
- **Written by:** `ensureGrants` (`services/tier-grants.ts`), in the transaction that may raise the tier: a first registration, a transfer accepted, a piece reinstated, an order's creation, `ClubService.status`, and `TierGrantService.prepare` at boot (§9); `INSERT … ON CONFLICT ON CONSTRAINT tier_grants_once DO NOTHING`, audited `club.grant` only for a row inserted. `model_id` by `attachGifts` (`services/orders.ts`). **Read by:** the gift's order (`attachGifts`), the credit's balance (`creditBalances`), an order's page, and the account's export (`accountTierGrants`, API §16.13 `tierGrants`: every grant with its model, amount, currency, expiry and balance).
- **Lot Q3, THE VAULT** (migration `0062_vault_rewards`, D19, D29, N10, following `0045`'s BIRTHDAY and `0048`'s WARRANTY): `kind` gains **`VAULT`** (`tier_grants_kind_check`), a vault's credit; `tier_grants_birthday` gives it no tier and no birthday, `tier_grants_credit` an amount, a currency and an expiry (30 Paris days, `vaultRewardUntil`). Two columns: `vault_id` (`uuid`, NULL, FK → `vaults.id` `ON DELETE RESTRICT`) on a VAULT grant and only there (**`tier_grants_vault`**), once per vault (**`tier_grants_vault_key`**, so a delivery run twice never gives two): the vault that won it, or, on a friend's account, the vault whose credit to give the friend accepted (§5.146); `usable_while_no_piece` (`boolean`, NOT NULL, default `false`), true only on a VAULT grant: the friend's credit, usable only while the friend holds no piece ("a credit for a friend's first piece"). The guard (`tier_grants_immutable`) gains both. A VAULT credit is usable whatever the tier, taken at APPLY CREDIT right after the birthday credit, and reads CREDIT · VAULT on the invoice. `0062`'s down step refuses while a VAULT grant exists.

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

Migration `0028_yearly_care` (plan NEXT-NINE, BP-19 T6): a collector's request for the **yearly care** of a piece it holds, **PRIVATE CARE** on screen since plan ORBES CARE of 2026-10-15 (answer 5: the inspection, cleaning and polishing of a piece by ORBES, free, once a year; the table's and the statuses' names unchanged), and its steps. Every piece from PLATINE by default (THE PROGRAM, §5.64), the year in UTC; refused while a warranty claim of the piece is live (§5.119). Never deleted (`care_requests_no_delete`, *a care request is cancelled, never deleted*); `care_requests_immutable` guards `id`, `account_id`, `product_id`, `year`, `tier`, `requested_at`, `return_name` and `return_address` (to change the address, the collector cancels and asks again).

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
| `service_record_id`, `received_at` | `uuid`, `timestamptz` | NULL | — | The YEARLY_CARE record opened when the piece reached ORBES (FK → `service_records.id`, unique); `care_requests_received`: both or neither. |
| `return_carrier_id`, `return_tracking`, `return_shipped_at` | `uuid`, `text`, `timestamptz` | NULL | — | The piece shipped back (FK → `carriers.id`, `care_requests_return_carrier_idx`); `care_requests_return`: all three or none. |
| `done_at` | `timestamptz` | NULL | — | |
| `cancelled_at`, `cancelled_by` | `timestamptz`, `text` | NULL | — | `CHECK (cancelled_by IN ('account','admin'))`; `care_requests_cancelled`: both or neither. |
| `note` | `text` | NULL | — | 1–500 characters: ORBES's note on a cancellation. Staff only. |
| `handled_by` | `uuid` | NULL | — | FK → `admin_users.id` (`care_requests_handled_by_idx`): the console user of the latest step. |

- **`care_requests_steps`:** the columns each status needs, each later step keeping those of the earlier ones: REQUESTED none of the steps' times; LABEL_SENT the label's three; RECEIVED those and the record; RETURNING those and the return's three; DONE those and `done_at`; CANCELLED `cancelled_at` and `cancelled_by`, never shipped back nor done. `(status = 'CANCELLED') = (cancelled_at IS NOT NULL)`. `care_requests_times`: each step after the one before.
- **Written by:** `CareService` (`services/care.ts`): `request` (the account `FOR UPDATE`, then the year's requests; audit `care.request`), `cancelByAccount` (REQUESTED only; `care.cancel`), and the console's steps, each under the request's row lock and in one transaction with the service record it opens or closes: `sendLabel` (`care.label`), `receive` (`care.receive`, `WarrantyService.openService`), `shipBack` (`care.return`), `complete` (`care.complete`, `completeService`), `cancel` (`care.cancel`, `cancelService` of an open record). **Read by:** the piece's ORBES CARE tab (`GET /api/v1/account/products/:productId/care`), the label's download (its own account only), the PRIVATE CARE board (API §16.29), the Messages board's `care` link (an open request, §5.62), the account's export. No step writes a message.

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
- **Lot Q3, THE VAULT** (migration `0062_vault_rewards`, OP-22 "GUARANTEED · A piece at the next LIVE release", N13): `scope` gains **`LIVE`** (`house_guarantees_scope_check`), a vault's GUARANTEED: 1 piece at the next LIVE RELEASE that is not an after-room, any model, valid the guarantee settings' default days. `vault_id` (`uuid`, NULL, FK → `vaults.id` `ON DELETE RESTRICT`) on a LIVE guarantee and only there, which names no release, model or collection (**`house_guarantees_scope`** rebuilt), once per vault (**`house_guarantees_vault_key`**); the guard gains `vault_id`. Written by `grantFromVault` (`services/guarantees.ts`) at the opening; `coverNextRelease` and `coverOnPublish` set it aside for the next published LIVE RELEASE (never the vault's own release). Staff never grant this scope (`GRANTED_GUARANTEE_SCOPES`: RELEASE, MODEL, COLLECTION). `0062`'s down step refuses while a LIVE guarantee exists.

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
- **Read by:** `clubStandings` and `tierOf` (the test row wins over the pieces), `isTestEntrant` (`services/club.ts`: a test account counts as owning a LIVE RELEASE's models and collection, `services/live.ts` `accessOf`), the console's test panel (`real` and `test` entries of a release). Also read through `services/population.ts` (`notTestEntrant`, `countedCollector`, `TestEntrantAccounts`): GROWTH and the customer intelligence's figures and recording leave a test account out, and so do three readings of the console: the Orders board and its CSV unless *Show test orders* is on (`services/fulfilment.ts`), the Shopify order export (`services/shopify.ts`), and a segment's count and members' CSV (`services/segments.ts`). Elsewhere its entries, orders and participation count as any collector's.

### 5.74 `test_runs`

A test of a release (migration `0024_z_test_entrants`): `id` (PK, `gen_random_uuid()`), `drop_id` (FK → `drops.id`), `mode` (`CHECK (mode IN ('DRAW','LIVE'))`, the release's), `status` (`CHECK (status IN ('RUNNING','DONE','STOPPED','INTERRUPTED','ENDED'))`, `TEST_RUN_STATUSES`; `'RUNNING'` by default), `settings` (`jsonb`, `CHECK (jsonb_typeof(settings) = 'array')`: each press, START then each ADD MORE, with its time, its test entrants and its settings), `entrants` (`CHECK (entrants BETWEEN 0 AND 5000)`), `created_by` (FK → `admin_users.id`, the ADMIN who started it), `created_at`, `ended_at` and `ended_by` (FK → `admin_users.id`) of END TEST, `report` (`jsonb` object or NULL: the TEST REPORT, five checks with their plain lines (six on a LIVE RELEASE with a pace: PACE), and the peaks), `peaks` (`jsonb` object or NULL: the test's running maxima from the server status sampler, saved every ~10 s while it runs). `test_runs_ended`: `CHECK ((status = 'ENDED') = (ended_at IS NOT NULL) AND (ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL OR ended_at >= created_at))`.

- **Indexes:** primary key; `test_runs_drop_idx (drop_id, created_at)`, a release's tests; `test_runs_created_by_idx (created_by)`; `test_runs_ended_by_idx (ended_by)`; **`test_runs_one_running`**, unique on `(status) WHERE status = 'RUNNING'`: at most one RUNNING test in the whole database, one test at a time.
- **Written by:** `TestEntrantService`: `start` (ADMIN, audited `test_run.start`), `addMore` (the run's row `FOR UPDATE`, `test_run.add`), `stop` (`test_run.stop`), `end` (`test_run.end`: a RUNNING or DONE test is STOPPED first, so neither its bots nor the sweeper act during the clean-up, the report written before the clean-up and kept if the clean-up is cut short, then ENDED), the runner (RUNNING → DONE once every test entrant has acted; the peaks), and `boot`, at each start of the app: RUNNING → INTERRUPTED (its test entrants were in the previous process's memory). Never deleted: the history of a release's tests.

**The test's purge** (migration `0066_test_purge`, lot PURGE; API §16.54): nine columns, each value in one stated home, all NULL until a purge is asked and only on an ENDED test (`test_runs_purge_ended`). `purge_state` (`PURGING`, `PAUSED` or `DONE`, `test_runs_purge_state_check`, `TEST_RUN_PURGE_STATES`); `purge_requested_at` and `purge_requested_by` (FK → `admin_users.id`, `test_runs_purge_requested_by_idx`) and `purge_summary` (`jsonb` object: the test's figures and report as the console showed them, what the purge plans and the orders it keeps; `all` for one requested by PURGE ALL, the console's only: no function reads it), set together with the state (`test_runs_purge_requested`); **`purge_step_up_id`** (`bigint` ≥ 1): the id of the request's `admin.step_up` audit entry, set **by the trigger**, whatever the app sends, never changed after: the test's upper bound in the audit chain; **`purge_windows`** (`jsonb` object with `fromId`, `toId`, `from`, `to` and `accounts`, `test_runs_purge_windows_check`): the test's own range of the chain (from the id of its `test_run.start` entry to its step-up, the times only narrowing it) and its test accounts, written once by the purge function itself as the superuser, at its entrants' step; `purge_reason` (`^[A-Z0-9_]{1,64}$`, exactly while PAUSED, `test_runs_purge_paused`: `PURGE_WINDOW`, `PURGE_TEST_RUNNING`, `PURGE_NOT_TEST`, `PURGE_RELEASE_NOT_OVER`, `PURGE_RUNS_NOT_ENDED`, `PURGE_STUCK_<SQLSTATE>`, `SQLSTATE_<code>`); `purge_result` (`jsonb` object with `deleted` and `kept`) and `purged_at`, exactly when DONE (`test_runs_purge_done`).

- **`test_runs_purge_guard`** (BEFORE INSERT OR UPDATE, `orbes_test_runs_purge_guard`; refusals SQLSTATE `OR010`, the reason as the message): a test is created without a purge; `purge_state` goes one way, NULL → PURGING ⇄ PAUSED, PURGING → DONE, never back to NULL, nothing after DONE (`PURGE_STATE_ONE_WAY`, `PURGE_DONE`); **NULL → PURGING passes only in a transaction that itself wrote an `admin.step_up` audit entry of purpose `test_run.purge:<this test>` or `test_run.purge_all` for the ADMIN named in `purge_requested_by`, still active, and updated that admin's `admin_users` row** (both rows' `xmin` the transaction's own id): otherwise `PURGE_NOT_AUTHORIZED`, so a direct `UPDATE test_runs SET purge_state` refuses; the request's values and the summary are written once (`PURGE_WRITE_ONCE`), the step-up id by the trigger only (`PURGE_STEP_UP_LOCKED`), the windows once and by a superuser only (`PURGE_WINDOWS_LOCKED`), and a test under purge keeps its release (`PURGE_RUN_LOCKED`). PAUSED → PURGING (a resume) changes none of them.
- **Written by:** `TestPurgeService` (`request`, `requestAll`, the loop's PAUSED, resume and DONE, under the test's row lock), and `orbes_purge_test_run_batch` (`purge_windows`). Each batch call re-checks the test, its release and every rule, then deletes one bounded step (500 rows, or 50 accounts at the accounts' step, at most 1 000): the order is API §16.54's. The test's row and its report are never deleted.

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
- **Lot M3** (migration `0054_boxes_weights`, D16): `box_id` (NULL, FK → `boxes.id`), `weight_g` (NULL, 1–100 000 g) and `weight_missing` (NULL, `text[]` of 1–64 non-empty entries: model or add-on names, « box »), written at PACKED in the Packed transaction: the box chosen while packing (CHANGE BOX) or suggested, the box's empty weight plus every piece's packed weight and every add-on unit's weight, or what was missing; the weight or its missing list only once packed and never both (`shipments_weight`). A parcel packed before keeps all three NULL.

### 5.86 `shipment_items`

Each order of a parcel and the piece its packing scan bound (migration `0037_fulfilment`): primary key `(shipment_id, order_id)`, `order_id` (FK, `shipment_items_order_idx`), `product_id` (NULL until the scan; FK → `products.id`, `shipment_items_product_idx`), `scan_event_id` (no foreign key: the scans' retention clears them), `scanned_at` (with a piece always: `shipment_items_scanned`).

### 5.87 `order_cases`

The one table for every order case (migration `0037_fulfilment`, plan NEXT LOT §1.1 (b)): a RETURN or a size EXCHANGE (`reason` SIZE, NOT_AS_EXPECTED, DAMAGED or OTHER; an exchange's `exchange_sku_id`, a use of the size, and `exchange_size_label`), or a parcel problem BACK_TO_SENDER, LOST or DAMAGED (`shipment_id` naming its parcel, exactly for those: `order_cases_shipment`). Opened by the collector (a return or a size exchange asked from YOUR ORDERS, `OrderCaseService.request`, plan NEXT LOT §3.6.D: its order DELIVERED, within 14 days, its request written into MESSAGES in the same transaction) or by staff (`opened_by_type` account or admin, `opened_by_id`, `opened_at`), with a `note` (1–1 000 characters: the client's or the staff member's words, personal data, never in the audit log, the events nor the journal) and the collector's message in MESSAGES (`message_id`, FK → `client_messages.id`). `status` (`ORDER_CASE_STATUSES`): OPEN → RECEIVED (`received_at`, `received_by`, `piece_state` OK or DAMAGED, `receive_note`: the agent records the parcel back; never a LOST case) → CLOSED (`outcome` REFUND, EXCHANGE or RESHIP as its kind allows, `order_cases_outcome`: a return is refunded, an exchange refunded or exchanged, a parcel problem reshipped or refunded; `piece_to` RESTOCKED, ARCHIVED or REVOKED; `exchange_order_id`, the EXCHANGE order, unique; `decision_note`; `closed_at`, `closed_by`), or CANCELLED (`cancelled_at`, `cancelled_by`, `cancel_note`: ended with no decision). One case not ended per order: `order_cases_one_open`. Its identity and the opener's words never change; never deleted nor truncated. Indexes: every foreign key, and `order_cases_status_idx (status, opened_at)`.
- **Lot M3** (migration `0057_sets`, K44 T3): `group_id` (NULL, RETURN only, `order_cases_group`; indexed, guarded): the cases of one set's return, opened together on every piece shipped or delivered and decided together once every piece is back (`409 SET_RETURN_NOT_RECEIVED`); cancelling one cancels the group. A size exchange of one piece stays its own case.

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

**Dropped by migration `0060_release_addons_converted` (lot Q2, ADD-ONS ONE SYSTEM, D4, N4)**: its prices became the engraving add-on's (§5.131, §5.132; they win in their currencies), that add-on offered in YOUR ORDERS (`offer_orders`), a new service ENGRAVING when none was converted; one `addon_conversions` row per currency (§5.140). An order keeps the price it took (`orders.engraving_minor`). As it was until then: migration `0039_order_delivery` (plan NEXT LOT §3.6.C; [API §16.24](API.md#1624-orders-logistics-locations-and-carriers-extension-of-the-contract)): **Engraving**, Orders → Settings, the engraving's price per currency for an order whose release did not sell the engraving as an add-on. None inserted: a currency without a price offers no engraving.

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
- **Index (0044):** `account_profiles_city_fold_idx ON (orbes_fold(city)) WHERE city IS NOT NULL` (plan CUSTOMER INTELLIGENCE §3.6 C.8): the cities given, folded, for Segments' CITY and the Collectors page's city groups (deployment I2). `orbes_fold(text)` (migration `0044_client_notes`) is `translate(lower(x), …)` over the common Latin diacritics, `IMMUTABLE STRICT PARALLEL SAFE`, so an index can read it; `src/shared/fold.ts` is the same rule in JavaScript, and `test/shared/fold.test.ts` holds the two to the same answers (200 strings and every accented letter). Not the `unaccent` extension, which PGlite and the production image may lack.
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

### 5.94 `account_wishes`

Migration `0041_account_wishes` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.3; [API §10.26](API.md#1026-your-wishlist-get-apiv1accountwishlist-put-and-delete-apiv1accountwishlistslug-extension-of-the-contract)): **YOUR WISHLIST**, one row per wish, a collector's heart on one model's sheet: the dot shown, a main model or a variant (each its own `models` row). Open while `removed_at` is NULL. Primary key `(account_id, model_id, added_at)`, which leads the account's foreign key.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`, ON DELETE RESTRICT. |
| `model_id` | `uuid` | NOT NULL | — | FK → `models.id`, ON DELETE RESTRICT (no code deletes a model). |
| `added_at` | `timestamptz` | NOT NULL | `now()` | |
| `removed_at` | `timestamptz` | NULL | — | Set on removal, the row kept; cleared when the same model is wished again within 10 minutes (`WISH_READD_MS`). `account_wishes_removed`: never before `added_at`. |

- **Indexes:** `account_wishes_open UNIQUE (account_id, model_id) WHERE removed_at IS NULL` (one open wish per account and model; the account's list and Segments' later criteria); `account_wishes_model_idx (model_id, added_at)` (the model's foreign key, the most wished counts, the monthly summary); `account_wishes_removed_idx (removed_at) WHERE removed_at IS NOT NULL` (the purge).
- **Trigger:** `account_wishes_immutable` (`orbes_guard_immutable_columns('account_id', 'model_id', 'added_at')`): only `removed_at` changes.
- **Written by:** `WishlistService.add` and `remove` (`services/wishlist.ts`), each in one transaction holding the account `FOR NO KEY UPDATE`: an add returns an open wish as it is, reopens one removed less than 10 minutes ago, or inserts, at most 200 open per account (`WISHLIST_MAX`, `409 WISHLIST_FULL`), only for a model the account may open now (`404 LOOKBOOK_NOT_FOUND`); a removal sets `removed_at`, idempotent. No audit entry: the row is its own record.
- **Read by:** YOUR WISHLIST (`list`: the open wishes, latest first, `SHOWN` or `NOT_SHOWN` for the reader now), the heart on a sheet, the client sheet of later steps (`ofAccount`), the right-of-access export (`wishlist`, every row still held), the monthly summary (§5.95).
- **Retention:** open wishes as long as the account; removed ones 13 Paris months, then purged once their month of removal is counted (§10, `wishHistory`). Test entrants never wish (no bot touches the routes), and every figure leaves them and the team's own accounts out (`countedCollector`).
- **Size:** about 0.2 KB a row with its indexes; at most 200 open per account. **Privacy:** the collector's own preferences, personal data, shown to nobody else.

### 5.95 `model_wish_months`

Migration `0041_account_wishes` (plan CUSTOMER INTELLIGENCE §3.2 W.3, W.7): the summary that outlives the 13 months, one row per Paris month and model that had a wish open or moving that month. Primary key `(month, model_id)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `month` | `date` | NOT NULL | — | The Paris month's first day (`model_wish_months_month_check`: day 1). |
| `model_id` | `uuid` | NOT NULL | — | FK → `models.id`, ON DELETE RESTRICT; index `model_wish_months_model_idx`. |
| `added` | `integer` | NOT NULL | — | Wishes added that month, ≥ 0. |
| `removed` | `integer` | NOT NULL | — | Wishes removed that month, ≥ 0. |
| `wished_end` | `integer` | NOT NULL | — | Wishes open at the month's last instant, ≥ 0. |
| `counted_at` | `timestamptz` | NOT NULL | `now()` | |

- **Written by:** the housekeeping job `wishMonths` (`aggregateWishMonths`, §10), once per complete Paris month, in the month's own transaction with its row of §5.96; only ACTIVE counted collectors (no test entrant, no team account). Never changed after.
- **Read by:** the figures over time beyond 13 months (later steps); a counted month with no row for a model reads 0. **Kept for good**; it names nobody. About 70 bytes a row, at most one per model a month.

### 5.96 `wish_months_counted`

Migration `0041_account_wishes` (plan CUSTOMER INTELLIGENCE §3.2 W.3): which Paris months §5.95 holds (a month with no wish leaves no summary row). `month date PRIMARY KEY` (day 1, `wish_months_counted_month_check`), `counted_at timestamptz NOT NULL DEFAULT now()`. Written by `wishMonths` with the month's counts; the purge of §5.94 deletes only removed wishes whose month is here. About 12 rows a year, kept for good.

### 5.97 `geo_places`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.6; [API §8.14](API.md#814-post-apiv1seen-the-views-the-collector-app-records-extension-of-the-contract)): the dictionary of the places a connection comes from, a country with or without a city, read from the GeoIP database the server already loads (DB-IP City Lite, `GEO_MODE=mmdb`: `city.names.en`; `cf-ipcity` in `cloudflare` mode). Approximate: a mobile network often places a phone in its operator's city. `id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `country char(2)` (`^[A-Z]{2}$`), `city text NULL` (1–80 characters, trimmed). `geo_places_key UNIQUE NULLS NOT DISTINCT (country, city)`: a country without a city is one row too. Written by `PlaceService.idOf` (`services/places.ts`, an LRU of 5 000, `INSERT … ON CONFLICT DO NOTHING` then a read, idempotent under concurrency). Never deleted, never written into `scan_events` (anomaly scoring is unchanged). A few thousand rows in all, under 0.5 MB.

### 5.98 `tracking_devices`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, §3.0 (b)): one row per remembered device, the lot's one device. The device is the existing device cookie (API §4), known here only by its pseudonym.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `integer` | NOT NULL | identity | Primary key. |
| `device_hash` | `text` | NOT NULL | — | `HMAC(IP_HASH_PEPPER, 'device', id)`, 43 base64url characters, as `scan_events.device_hash` holds it (the scans made before the lot join the same device); unique. The cookie's id never reaches the database. |
| `kind` | `text` | NOT NULL | `'UNKNOWN'` | PHONE, TABLET, COMPUTER, UNKNOWN (`http/device-class.ts`). |
| `os` | `text` | NOT NULL | `'OTHER'` | IOS, ANDROID, MACOS, WINDOWS, CHROMEOS, LINUX, OTHER (an iPad asking for the desktop site is IOS, by its touch points). |
| `browser` | `text` | NOT NULL | `'OTHER'` | SAFARI, CHROME, FIREFOX, EDGE, SAMSUNG, OPERA, WEBVIEW, OTHER. |
| `opened_in` | `text` | NOT NULL | `'BROWSER'` | BROWSER, IN_APP (an app's own browser), HOME_SCREEN. |
| `in_app` | `text` | NULL | — | INSTAGRAM, TIKTOK, FACEBOOK, THREADS, SNAPCHAT, PINTEREST, LINKEDIN, GOOGLE, WECHAT, LINE, OTHER; set exactly when `opened_in` is IN_APP (`tracking_devices_app`). |
| `account_id`, `linked_at` | `uuid`, `timestamptz` | NULL | — | The account it was last linked to, and when (both or neither, `tracking_devices_linked`); FK → `accounts.id`, ON DELETE RESTRICT. |
| `last_place_id` | `integer` | NULL | — | FK → `geo_places.id`, ON DELETE RESTRICT. |
| `staff_at` | `timestamptz` | NULL | — | Set once when a console session is seen on it: from then on nothing is recorded for it, and its earlier rows were deleted. |
| `first_seen_at`, `last_seen_at` | `timestamptz` | NOT NULL | `now()` | `last_seen_at` written at most every 10 minutes per device (`tracking_devices_seen`: never before the first). |
| `first_source_id` | `integer` | NULL | — | Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 4): the source of the device's first arrival (§5.108), set once (`… WHERE first_source_id IS NULL`), Direct included; NULL while it made no arrival (a device seen only through a scan), read as Direct. FK → `acquisition_sources.id`, ON DELETE RESTRICT. |

- **Indexes:** `tracking_devices_account_idx (account_id)`, `tracking_devices_place_idx (last_place_id)`, `tracking_devices_seen_idx (last_seen_at)` (the purge of §10), `tracking_devices_first_source_idx (first_source_id, first_seen_at)` (0043: first visits by source and over time; it leads the foreign key).
- **Trigger:** `tracking_devices_immutable` (`id`, `device_hash`, `first_seen_at`). The class is rewritten from `POST /api/v1/seen` when it reads differently (an updated system); a sign-in or a scan sets it only on a new device.
- **Kept:** a device never linked, not staff's, unseen for 13 Paris calendar months and with no view and no visit left goes (`devicePurge`, §10); a linked one stays for the client sheet. Measured 279 B a row on disk, about 47 B in the backup (§11.1).

- **Lot M4** (migration `0065_ad_conversions`, K27 A4): a device may hold an advertising choice made signed out (`ad_consents`, §5.156) and the click ids read with a GRANTED one (`ad_clicks`, §5.157); the devices job keeps a device that still holds either (`TrackingService.purgeDevices`), their own purge erasing them first (§10).

### 5.99 `tracking_device_accounts`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, T.8.4): every account a device was linked to. Primary key `(device_id, account_id)`; `device_id` FK → `tracking_devices.id`, `account_id` FK → `accounts.id` (index `tracking_device_accounts_account_idx`), both ON DELETE RESTRICT; `first_via` SIGN_UP, SIGN_IN or SESSION (a visit already signed in); `first_linked_at`, `last_linked_at` (never before the first), `links ≥ 1`. Written by `TrackingService.link` in its transaction, never audited. Kept for good, about 1.5 rows per account.

### 5.100 `collector_views`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, T.8.3): the raw views and scans, **13 Paris calendar months**, then folded per collector (§5.104) and deleted.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `bigint` | NOT NULL | identity | Primary key. |
| `at` | `timestamptz` | NOT NULL | — | When the view began, on the server's clock (now − the app's `ago`). |
| `device_id` | `integer` | NOT NULL | — | FK → `tracking_devices.id`, ON DELETE RESTRICT. |
| `account_id` | `uuid` | NULL | — | The session's account, or the one the device was linked to later; NULL while anonymous. FK → `accounts.id`, ON DELETE RESTRICT. |
| `page` | `smallint` | NOT NULL | — | 1–60, the code of `schema.ts` `VIEW_PAGES` (permanent, never reused): 1 SCAN (written by the server at each scan), 2 NOW, 3 RESULT, 4 MY_PIECES, 5 MY_ORDERS, 6 MY_RELEASES, 7 PIECE, 8 CERTIFICATE, 9 COLLECTION, 10 MODEL, 11 CLUB, 12 RELEASES, 13 RELEASE, 14 LIVE, 15 AFTER_ROOM, 16 HOW, 17 CIRCLE, 18 POST, 19 ACCOUNT, 20 MESSAGES, 21 SIGN_IN, 22 SIGN_UP, 23 SIZES, 24 ADDRESSES, 25 PROFILE, 26 WISHLIST. |
| `subject` | `uuid` | NULL | — | A model (SCAN, PIECE, MODEL: the variant's own when its dot is chosen), a release (RELEASE, LIVE, AFTER_ROOM) or a circle post (POST); no foreign key (a log). |
| `seconds` | `smallint` | NOT NULL | — | 0–10 800; a SCAN has 0, every other view 1 or more (`collector_views_timed`); capped at 1 800 (10 800 in a LIVE room). |
| `place_id` | `integer` | NULL | — | `geo_places.id`, no foreign key (places are never deleted). |

- **Indexes:** `collector_views_at_idx (at)` (the daily count, the monthly summary, the purge, the panels: a b-tree, not BRIN, which would span the whole 13 months once the purge's freed pages are reused), `collector_views_device_idx (device_id, at)` (the link, the foreign key), `collector_views_account_idx (account_id, at)` (the client sheet, Segments, the export, the foreign key).
- **Written by:** the in-memory buffer of `TrackingService` (one INSERT of up to 1 000 rows every 2 s, put off while the pool has requests waiting, at most 5 000 rows held, written out at shutdown), `recordScan` (one INSERT … SELECT from `scan_events` after `POST /api/v1/verify` has answered), the link (an UPDATE of the device's anonymous rows since its previous link) and, once at the first boot, the backfill of the scans of the 13 months before (`tracking_state`). Never a row of a console session, a team account, a test entrant (account or 100.64.0.0/10), an automated agent or a prefetch; a device marked staff loses its rows.
- **Not recorded:** the scan screens themselves, a LIVE RELEASE's boutique board and the password screen.
- **Sizes:** measured 212 B a row on disk and about 18 B in the backup (§11.1); at 8 000 rows a day, ≈ 3.2 M rows, ≈ 670 MB of disk and ≈ 56 MB in each backup once the 13 months are full, then steady.

### 5.101 `view_daily_stats`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, T.10): the anonymous daily totals, **kept for good** (as `scan_daily_stats`, §5.24). Primary key `(day, page, subject, country)`: the Paris `day`; `page` 0–60 (0 is the day's marker row, every count 0, so a day without a view is counted too); `subject` (the nil uuid `00000000-…` for none); `country` the place's (`ZZ` unknown); `views`, `seconds`, `devices` (distinct devices that day for the row), `signed_in_views` (0 to `views`). Written by `viewStats` (§10), the test entrants' and the team's rows left out. About 300 rows a day at 1 000 visitors a day; 128 B a row on disk.

### 5.102 `device_daily_stats`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, T.10): the devices of each Paris day by country and class, anonymous, **kept for good**. Primary key `(day, country, kind, os, browser, opened_in, in_app)` (`in_app` an app or `NONE`); `devices`, `new_devices` (first seen that day) and `signed_in_devices`, each 0 to `devices`. A device's country that day is its latest row's. Written by `viewStats`. About 60 rows a day.

### 5.103 `collector_places`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6): each collector's places from the connection, **kept for good**. Primary key `(account_id, place_id)`; `account_id` FK → `accounts.id`, `place_id` FK → `geo_places.id` (index `collector_places_place_idx`), ON DELETE RESTRICT; `days ≥ 1` (Paris days with a view or a scan from there), `first_day`, `last_day`. Written by `viewStats` for each counted day, and by a link for the attached rows of days already counted, under the same advisory lock (§8.3), so a day is never counted twice. It answers « Places » and the usual place for every period without reading the detail. About 2 to 3 rows per collector.

### 5.104 `collector_view_totals`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, T.10): the summary of each collector's rows past the 13 months, per page and subject. Primary key `(account_id, page, subject)` (`subject` the nil uuid for none); `views`, `seconds` (bigint), `first_at`, `last_at`. Written by `viewPurge` in the transaction that deletes the day, so a day is folded once; anonymous rows are deleted without a fold. Kept for good: about 25 rows per collector from month 14.

### 5.105 `collector_view_months`, and `tracking_state`

Migration `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, T.10): **`collector_view_months`**, each collector's summary by Paris month, written as each month ends. Primary key `(account_id, month)` (`month` day 1); `views` (the SCAN rows apart), `seconds`, `scans`, `active_days` (0–31 Paris days). Written by `viewMonths` in the transaction of the count of the month's last day (so a month is written exactly when that day is counted), `INSERT … ON CONFLICT DO NOTHING`; a link that later attaches rows of a written month adds them. Kept for good, one row per active month. Year-long figures and the monthly history read it instead of a year of raw rows.

**`tracking_state`**, one row (`id = 1`): `started_at`, the recording's start (the first boot on this schema: « The account is older than the recording »); `scans_after_at` and `scans_after_id`, the keyset watermark of the backfill of the past scans (both or neither, `tracking_state_keyset`); `scans_backfilled_at`, set when the backfill is done (a later boot does nothing). Inserted by `TrackingService.prepare()` at boot (`INSERT … ON CONFLICT DO NOTHING`), never by the migration. The daily count waits for `scans_backfilled_at`, since the backfill writes rows of days already past.

### 5.106 `link_channels`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.6 item 1; [API §16.35](API.md#1635-links-and-channels-extension-of-the-contract)): the channels the console's links are grouped by. `id uuid PRIMARY KEY`; `name` 1–40 characters, trimmed (`link_channels_name_key` unique on `lower(name)`); `position smallint` 0–999 (default 0); `created_by uuid NULL` FK → `admin_users.id` ON DELETE RESTRICT (index `link_channels_created_by_idx`; NULL for the first boot's), `created_at`. **Written by:** `AcquisitionService.prepare` at the very first boot (Instagram 10, TikTok 20, Influencers 30, Press 40, Shops 50, Search 60, Other 70: the words of « How did you hear about ORBES? » less « A friend »), only while the table is empty and before the state row exists (§5.113), so a channel staff removed never comes back; then `LinkService` (`link_channel.create`, `.update`, `.delete`, §5.21), removed only while no link names it. Never audited at boot. A handful of rows.

- **Lot M4** (migration `0065_ad_conversions`, K27 A3): a channel may be mapped to an ad platform (`ads_channel_platforms`, §5.155); removing a channel (`LinkService.deleteChannel`) removes its mapping in the same transaction.

### 5.107 `links`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 2, A.7): the console's links, each a short ORBES address `https://verify.theorbes.com/go/<code>` ([API §8.15](API.md#815-get-gocode-a-console-links-short-address-extension-of-the-contract)).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `code` | `text` | NOT NULL | — | The address: `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` (3 to 32, lower case, no dash at either end); unique (`links_code_key`). Never changes (the trigger below), so a posted link never breaks. |
| `name` | `text` | NOT NULL | — | 1–80 characters, trimmed. |
| `channel_id` | `uuid` | NOT NULL | — | FK → `link_channels.id`, ON DELETE RESTRICT (index `links_channel_idx (channel_id, created_at)`). |
| `destination` | `text` | NOT NULL | — | NOW, RELEASES, RELEASE, COLLECTION, MODEL, CLUB, HOW, and since migration `0050_founding_list` (lot M1, F3; `links_destination_check` re-created) LANDING: theorbes.com, the founding list's page (`/go/<code>` answers 302 to `https://theorbes.com/?o=<code>`), which names neither a release nor a model. |
| `drop_id`, `model_id` | `uuid` | NULL | — | The release (RELEASE) or the model (MODEL) it leads to, exactly then (`links_destination`); FKs → `drops.id`, `models.id`, ON DELETE RESTRICT (indexes `links_drop_idx`, `links_model_idx`). A model's address is read at each request (its current slug). |
| `cost_minor`, `cost_currency` | `bigint`, `text` | NULL | — | One cost, 0 to 10¹¹ minor units, in EUR, GBP, USD or CHF; both or neither (`links_cost`). |
| `note` | `text` | NULL | — | At most 500 characters. |
| `archived_at`, `archived_by` | `timestamptz`, `uuid` | NULL | — | Both or neither (`links_archived`); `archived_by` FK → `admin_users.id` (index `links_archived_by_idx`). An archived link keeps redirecting and counting. |
| `created_by` | `uuid` | NOT NULL | — | FK → `admin_users.id` (index `links_created_by_idx`). |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **Trigger:** `links_immutable` (`id`, `code`, `created_by`, `created_at`). A link and its LINK source (§5.108) are made in one transaction; two staff taking one address at once: the unique index decides (`409 LINK_CODE_TAKEN`). Audited `link.*` (§5.21). Never deleted. A few hundred rows.

### 5.108 `acquisition_sources`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 3, A.5): each distinct source of visits once, so the visits stay small. `id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY`; `kind` LINK, CAMPAIGN, SITE, DIRECT, BEFORE (« Before tracking ») or STAFF (« Console device »); `link_id uuid NULL` FK → `links.id` (index `acquisition_sources_link_idx`); `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` (each 1–100 characters, trimmed and in lower case); `site` (a host, `^[a-z0-9][a-z0-9.:-]{0,252}$`); `key` (≤ 600, unique `acquisition_sources_key`: `L:<link id>`, `C:<source>␟<medium>␟<campaign>␟<content>␟<term>` with U+001F between them, `S:<host>`, `DIRECT`, `BEFORE`, `STAFF`); `created_at` (index `acquisition_sources_created_idx`, the day's cap). `acquisition_sources_shape`: each kind with exactly its columns (LINK its link only; CAMPAIGN `utm_source` or `utm_campaign`, no link, no site; SITE its site only; DIRECT, BEFORE and STAFF none). **Written by:** `AcquisitionService.prepare` (DIRECT, BEFORE, STAFF, `INSERT … ON CONFLICT (key) DO NOTHING`), `LinkService.create` (a link's), `AcquisitionService.arrive` (a campaign or a site, found by its key or made: at most 100 new campaigns and sites a Paris day, past it an arrival falls back to its site, then Direct). Never deleted, never changed. Measured 319 B a row on disk and about 12 B in the backup (§11.2); at most 36,500 rows a year.

### 5.109 `acquisition_touches`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 5, A.5): a **visit**, one device arriving from one source on one Paris day, **13 Paris calendar months**, then summarised (§5.112) and deleted. Never a DIRECT source (a Direct arrival writes no visit).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `bigint` | NOT NULL | identity | Primary key. |
| `device_id` | `integer` | NOT NULL | — | FK → `tracking_devices.id` (§5.98), ON DELETE RESTRICT. |
| `source_id` | `integer` | NOT NULL | — | FK → `acquisition_sources.id`, ON DELETE RESTRICT. |
| `day` | `date` | NOT NULL | — | The Paris day. |
| `first_at`, `last_at` | `timestamptz` | NOT NULL | — | The day's first and latest arrival (`last_at ≥ first_at`). |
| `arrivals` | `integer` | NOT NULL | 1 | The repeats that day (≥ 1). |
| `account_id` | `uuid` | NULL | — | Once the device is linked (or the arrival signed in); FK → `accounts.id`, ON DELETE RESTRICT. |

- **Indexes:** `acquisition_touches_visit UNIQUE (device_id, source_id, day)` (it leads the device's foreign key; the arrival's `ON CONFLICT … DO UPDATE`), `acquisition_touches_source_day (source_id, day)` (the daily summary, the source's foreign key), `acquisition_touches_account (account_id, last_at)` (the last link; a full index, as every foreign key's), `acquisition_touches_day (day)` (the purge).
- **Written by:** `AcquisitionService.arrive` (one INSERT … ON CONFLICT per arrival, after the views' exclusions: never a console session, a team account, a test entrant, an automated agent), `attach` inside the link's transaction (the device's visits without an account take it). Never audited.
- **Sizes:** measured 241 B a row on disk and about 16 B in the backup (§11.2): at 1,000 visits a day, ≈ 396,000 rows, ≈ 91 MB of disk and ≈ 6 MB in each backup once its 13 months are full.

### 5.110 `account_sources`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 6, A.4): each collector's **first source** (discovery), **kept for good**: the per-collector summary that outlives the raw 13 months. `account_id uuid PRIMARY KEY` FK → `accounts.id`; `first_source_id integer NOT NULL` FK → `acquisition_sources.id` (index `account_sources_first_idx`), both ON DELETE RESTRICT; `first_seen_at` (the first visit's time); `set_at`; `set_by` SIGN_UP (the device's first source at the sign-up, STAFF on a console device's, DIRECT when it made no arrival), SIGN_IN (a login or a signed-in view on a device first seen before the recorded first visit and before the account was made, not another account's: the earlier one is the discovery) or JOB (the conversions job's safety net, DIRECT). No row: Before tracking for an account made before the recording started, else Direct until the job writes it. Measured 126 B a row on disk and about 30 B in the backup (§11.2), one per account.

### 5.111 `acquisition_conversions`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 7, A.5, A.8): one row per sign-up, draw entry, LIVE RELEASE entry and order, with its **last link** (conversion), written once and never changed, **kept for good**. `id bigint` identity; `kind` SIGNUP, DRAW_ENTRY, LIVE_ENTRY or ORDER; `ref_id uuid` (the account, the entry or the order: no foreign key, as it names four tables whose rows are never deleted); `account_id` FK → `accounts.id` (index `acquisition_conversions_account_idx (account_id, kind)`); `at` (the act's moment: a sign-up at its creation, an entry when made, an order of a draw at its entry, of a LIVE RELEASE at its room entry, of the salon at its request, an order travelling with another at that order's, an EXCHANGE order at its original's, any other at its reservation); `last_source_id` FK → `acquisition_sources.id` (index `acquisition_conversions_last_idx (last_source_id, kind, at)`; the latest non-direct visit of the account at or before the moment within 90 days, else DIRECT; BEFORE for a moment before the recording; an EXCHANGE order copies its original's); `created_at`; `acquisition_conversions_ref UNIQUE (kind, ref_id)`. **Written by:** `attach` at a sign-up, and the conversions job (§10) for every other act and as the sign-up's safety net; never a GIFT order, never a test entrant's. Measured 296 B a row on disk and about 42 B in the backup (§11.2): ≈ 200 a day at the unit, ≈ 22 MB of disk and ≈ 3 MB of backup a year.

- **Lot M4** (migration `0065_ad_conversions`, K27 A3): each conversion is the act an ad event reports (`ad_events.conversion_id`, §5.158), once per platform and act, only while the conversions' switch is on and the collector's choice at the act's time is GRANTED; an ORDER conversion is reported once its order is paid, as PAID_ORDER. The conversions themselves are unchanged.

### 5.112 `acquisition_daily`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 8, A.8): the visits by source and Paris day, **kept for good**, once the raw visits are gone. Primary key `(source_id, day)`, `source_id` FK → `acquisition_sources.id`; `visits`, `first_visits` (devices first seen that day, by their first source, Direct included), `arrivals`, each ≥ 0; index `acquisition_daily_day_idx (day)`. Written by `acquisitionDaily` (§10), each complete Paris day once, `ON CONFLICT DO UPDATE` with the same figures. The Links page reads it for the days summarised and the raw visits for the days after, never both for one day. About 50 rows a day; measured 94 B a row on disk and about 3 B in the backup (§11.2).

### 5.113 `acquisition_state`

Migration `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 9, A.12): one row (`id smallint PRIMARY KEY DEFAULT 1`, `CHECK (id = 1)`). `tracking_started_at`, the recording's start: the first boot on this schema (before it, « Before tracking »); `conversions_until`, the conversions job's watermark on when rows were written; `catch_up_on`, the last Paris day the job's daily catch-up ran; `daily_until`, the last Paris day summarised into §5.112. Inserted by `AcquisitionService.prepare` at boot (`INSERT … ON CONFLICT (id) DO NOTHING`), never by the migration: every reader treats a missing row as « not started ». A second boot never moves the start.

### 5.114 `account_notes`

Migration `0044_client_notes` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.3, C.8 item 1, deployment I1; [API §16.36](API.md#1636-the-client-sheets-profile-tags-private-notes-and-intelligence-extension-of-the-contract)): ORBES Client Services' **private notes** on a client, dated, **never shown to the client**, beside the existing notes on dealings (API §16.11 `notes`), which they do not replace.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`, ON DELETE RESTRICT. |
| `body` | `text` | NOT NULL | — | `account_notes_body`: 1–2 000 characters, no space at either end. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`; NULL: a script (read « ORBES »). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `removed_at`, `removed_by` | `timestamptz`, `uuid` | NULL | — | `removed_by` FK → `admin_users.id`. `account_notes_removed`: both or neither, never before `created_at`. |

- **Indexes:** primary key; `account_notes_account_idx (account_id, created_at DESC) WHERE removed_at IS NULL` (the sheet's 50 newest); `account_notes_account_all_idx (account_id)`, `account_notes_created_by_idx (created_by)`, `account_notes_removed_by_idx (removed_by)`, each foreign key led by a full index.
- **Trigger:** `account_notes_immutable` (`orbes_guard_immutable_columns('id', 'account_id', 'body', 'created_by', 'created_at')`): a note is never edited; only its removal changes it, once.
- **Written by:** `ClientNoteService.addNote` (OPERATOR, ADMIN; a DELETED account refused) and `removeNote` (its writer or an ADMIN: the row kept, hidden, so the audit entry that names it still points at it); `ProfileService.setBirthDateByStaff` writes the reason of a date of birth changed or removed as a note in the date's own transaction (« Date of birth changed: … »). Audited `account.note.add` `{ noteId, length }` and `account.note.remove` `{ noteId }`, never the words (§5.21).
- **Read by:** the client sheet (API §16.11 `privateNotes`, §16.36). Never by a collector route, never in the right-of-access export, never in the Collectors page's CSV (question 19).
- **Size:** about 450 B a row with its indexes; at most about 50 a day at scale, a few today: ≤ 8 MB a year (plan §3.6 C.8). Kept for good, removed ones included.
- **Privacy:** staff's words about a client: personal data, kept out of the audit log (permanent) and out of everything the client receives.

### 5.115 `account_tags`

Migration `0044_client_notes` (plan CUSTOMER INTELLIGENCE §3.6 C.4.3, C.8 item 2, deployment I1): ORBES Client Services' **tags** on a client (VIP, PRESS, FRIEND OF THE HOUSE…), never shown to the client. Primary key `(account_id, tag)`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`, ON DELETE RESTRICT (the primary key leads it). |
| `tag` | `text` | NOT NULL | — | `account_tags_tag`: 1–32 characters, in capitals, trimmed, single spaces, letters of any script, figures and `& ' ’ . -` (`[[:alnum:]]`, under the database's locale). `cleanTag` (`services/client-notes.ts`) writes it so. |
| `created_by` | `uuid` | NULL | — | FK → `admin_users.id`; NULL: a script. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | The order the sheet lists them in. |

- **Indexes:** primary key; `account_tags_tag_idx (tag)` (the suggestions, Segments' TAGGED at I2); `account_tags_created_by_idx (created_by)`.
- **Written by:** `ClientNoteService.addTag` (the same tag twice is one row and one audit entry; at most **20 per account**, the service's bound, checked after the insert under the account's row `FOR UPDATE`, so two adds racing at 19 leave 20 and the other gets `409 TAG_LIMIT`) and `removeTag` (a deleted row: a tag is a label, not a record; the audit log keeps who added and removed it). Audited `account.tag.add` and `.remove` `{ tag }`.
- **Read by:** the client sheet (API §16.11 `tags`), `GET /api/admin/tags`'s suggestions (the most used first, or VIP, PRESS and FRIEND OF THE HOUSE while none is used). Never by a collector route nor in the right-of-access export.
- **Size:** about 170 B a row with its indexes; ≈ 5 000 rows at 20 000 collectors, ≈ 0.9 MB (plan §3.6 C.8).

### 5.116 `account_scores`

Migration `0046_engagement_scores` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.3.2, deployment I2; [API §16.36](API.md#1636-the-client-sheets-profile-tags-private-notes-and-intelligence-extension-of-the-contract)): the **engagement score** now of each scored account, **staff only**, one row per account (its primary key, which leads the foreign key's index). The score from 0 to 100 is the sum of its five parts, each kept with the figure behind it, so the client sheet explains every point.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | PK, FK → `accounts.id`, ON DELETE RESTRICT. |
| `formula` | `smallint` | NOT NULL | — | `CHECK (formula >= 1)`: the version of the code's formula that made the row (`ENGAGEMENT_FORMULA`, 1). |
| `score` | `smallint` | NOT NULL | — | `CHECK (score BETWEEN 0 AND 100)`; `account_scores_sum`: the sum of the five parts. |
| `recency_points`, `frequency_points`, `spend_points`, `speed_points`, `attendance_points` | `smallint` | NOT NULL | — | 0–25, 0–20, 0–25, 0–10 and 0–20 (`PART_MAX`, `services/engagement-formula.ts`). |
| `last_act_at`, `last_act_kind` | `timestamptz`, `text` | NULL | — | The latest act of the 12 months and its kind (`SCAN`, `DRAW`, `LIVE`, `INTEREST`, `ORDER`, `REGISTRATION`); `account_scores_last_act`: both or neither. Never a page view nor a sign-in. |
| `active_days` | `smallint` | NOT NULL | — | 0–366: the Paris days with an act. |
| `spend_eur_minor`, `purchases`, `unpriced`, `other_currencies` | `bigint`, `smallint`, `smallint`, `text[]` | NOT NULL | —, —, —, `'{}'` | The spend of the 12 months in euros (GROWTH's purchases, other currencies converted at the code's rates, `other_currencies` ⊂ GBP, USD, CHF), its purchases, those without a known price (`account_scores_priced`: not more than the purchases). |
| `speed_minutes`, `speed_releases` | `integer`, `smallint` | NULL, NOT NULL | — | The median minutes from a release's opening to the entry, over its releases (`account_scores_speed`: a median exactly when there is a release). |
| `releases_taken`, `releases_open` | `smallint` | NOT NULL | — | The releases taken part in out of those open to the account (`account_scores_releases`: not more). |
| `changed_at` | `timestamptz` | NOT NULL | — | When any value last changed. |

- **Index:** `account_scores_score_idx (score)`: the score spread and Segments' SCORE (§5.58).
- **Written by:** the daily job `engagement` only (`EngagementService.runIfDue`, `services/engagement.ts`, §10): the ACTIVE accounts that are not test entrants, in batches of 500; a row inserted, or rewritten only when a value differs (`IS DISTINCT FROM`), so an unchanged score keeps its `changed_at`; the rows of DELETED accounts and of test entrants removed; a LOCKED account's row left as it was. No trigger, **no audit**: derived data, holding no decision.
- **Read by:** the client sheet's Engagement block (API §16.36), Segments' SCORE (API §16.26, a LIVE RELEASE's access included, question 15), the Collectors page and its export (API §16.37). **Never** by a collector route nor in the right-of-access export (question 17); `test/security/collector-never-sees-staff-data.test.ts`.
- **Size:** about 150 B a row; ≈ 1.5 MB at 10 000 accounts (plan §8). One row per account, current only: no per-account history beyond `collector_history`'s monthly element (§5.118).

### 5.117 `engagement_runs`

Migration `0046_engagement_scores` (plan CUSTOMER INTELLIGENCE §3.5 SB.3.2, deployment I2): one row per Paris day the daily job ran, its claim and, once finished, the history of the score spread.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `day` | `date` | NOT NULL | — | PK: the Paris day. A second process or pass gets no row back from the claim (`INSERT … ON CONFLICT … RETURNING`) and stops; a run left unfinished is taken over 20 minutes later (`ENGAGEMENT_STALE_MINUTES`), from the start. |
| `formula` | `smallint` | NOT NULL | — | `CHECK (formula >= 1)`. |
| `started_at`, `finished_at` | `timestamptz` | NOT NULL, NULL | — | `engagement_runs_finished`: the end after the start. |
| `accounts`, `changed` | `integer` | NULL | — | The accounts scored and the rows inserted, rewritten or removed (≥ 0). |
| `bands` | `integer[]` | NULL | — | The ACTIVE counted collectors per band of ten (0–9 … 90–100): ten counts, none NULL, each ≥ 0. |
| `duration_ms` | `integer` | NULL | — | How long the run took. |

- `engagement_runs_done`: a run is finished exactly when it has its accounts and its bands.
- **Written by:** the job `engagement` only. No audit. **Read by:** the client sheet (the latest finished run's day, and *Not recalculated since …* when it is more than a day old), the Collectors page's score spread, Segments' builder notice, the monthly history (it waits for that morning's run on Paris day 1). The first deployment's check: `select day, accounts, changed, duration_ms from engagement_runs order by day desc limit 1`.
- **Size:** about 120 B a row, ≈ 44 KB a year (plan §8). Kept for good.

### 5.118 `collector_history`

Migration `0047_collector_history` (plan CUSTOMER INTELLIGENCE §3.6 C.8 item 3, C.10, deployment I2; [API §16.37](API.md#1637-the-collectors-page-and-its-export-extension-of-the-contract)): the **monthly history** of each counted collector, for « how it changes over time » and the monthly cohorts: per Paris month, the engagement score at the month's end, the tier held at its end and whether it was active in it, in one row of arrays (about 250 B a collector at 36 months, whatever the number of months).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `account_id` | `uuid` | NOT NULL | — | PK, FK → `accounts.id`, ON DELETE RESTRICT. |
| `first_month` | `date` | NOT NULL | — | The first element's month, its first day (`collector_history_month`). |
| `scores` | `smallint[]` | NOT NULL | `'{}'` | The score at each month's end, 0–100; NULL: not measured (the back-filled months, a month written without the morning's score). |
| `tiers` | `smallint[]` | NOT NULL | `'{}'` | The tier held at each month's end, 0 (none) to 3 (PALLADIUM), never NULL. |
| `active` | `boolean[]` | NOT NULL | `'{}'` | Any activity in the month (a sign-in, a scan, a view, a draw entry, a LIVE entry or an order), never NULL. |
| `last_month` | `date` | NULL | — | The latest month written. `collector_history_span`: exactly the last element's month (none without an element). |

- `collector_history_lengths`: the three arrays have the same length, at most 36 (the job drops the oldest month when it adds the 37th, and `first_month` moves on).
- **Written by:** the housekeeping job `collectorHistory` only (`services/collector-history.ts`, §10): on Paris day 1, the month just ended for every counted collector made before its end, once that morning's `engagement_runs` row is finished (from 12:00 UTC without it, the score NULL); at the first deployment, a **back-fill** of the 12 months before the current one, without scores (`collector history back-filled: 12 months, N collectors` in the log). Batches of 1 000 by keyset on the account, each its own short transaction (`UPDATE … FROM (VALUES …)` where the row still ends where it was read; `INSERT … ON CONFLICT DO NOTHING` for a new one), 200 ms between two: a batch run twice writes nothing the second time, a restart resumes. Never while a test of test entrants is RUNNING. No trigger, **no audit**.
- **Read by:** the Collectors page (API §16.37): the score spread's month kept beside it, At a glance's previous median score, MONTHLY COHORTS, Over time's median score. Test entrants and the team's own accounts never have a row. Never by a collector route nor in the right-of-access export.
- **Size:** ≈ 250 B a row at 36 months; ≈ 5 MB at 20 000 collectors (plan §8). Rewritten once a month.

### 5.119 `warranty_claims`

Migration `0048_orbes_care` (plan ORBES CARE of 2026-10-15, answers 3, 4, 9, 10, 11; D1, D9 to D14; [API §16.39](API.md#1639-warranty-claims-extension-of-the-contract)): a claim under a piece's ORBES warranty or under the legal guarantee of conformity, opened by ORBES Client Services from the claimant's conversation, and its steps. Its identity never changes (`warranty_claims_immutable`: `id`, `product_id`, `root_product_id`, `account_id`, `conversation_id`, `basis`, `opened_at`, `opened_by`, `continues_claim_id`); it is never deleted (`warranty_claims_no_delete`, *a warranty claim is cancelled, never deleted*).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `product_id` | `uuid` | NOT NULL | — | FK → `products.id`, leading `warranty_claims_product_idx (product_id, opened_at)`: the piece claimed for. |
| `root_product_id` | `uuid` | NOT NULL | — | FK → `products.id` (`warranty_claims_root_idx`): the original purchase (the root of the claim whose replacement this piece is, else the piece), which the free replacement counts on. |
| `account_id`, `conversation_id` | `uuid` | NULL | — | FK → `accounts.id` (`warranty_claims_account_idx (account_id, opened_at)`), `client_conversations.id` (`warranty_claims_conversation_idx`): the claimant and the conversation the claim was opened from; both or neither (`warranty_claims_claimant`: neither only for a LEGAL claim of a buyer without an account, whose receipt is then in `note`). |
| `basis` | `text` | NOT NULL | — | `CHECK IN ('LIFETIME','TWO_YEARS','LEGAL')` (`WARRANTY_CLAIM_BASES`): the piece's own warranty kind read at opening (its warranty row's `lifetime`), or the legal guarantee; never changed. |
| `status` | `text` | NOT NULL | `'OPEN'` | `CHECK IN ('OPEN','LABEL_SENT','RECEIVED','DECIDED','DONE','CANCELLED')` (`WARRANTY_CLAIM_STATUSES`); `warranty_claims_status_idx (status, opened_at)`, the Claims tab. |
| `opened_at`, `opened_by` | `timestamptz`, `uuid` | NOT NULL | `now()`, — | FK → `admin_users.id` (`warranty_claims_opened_by_idx`). |
| `label_pdf` | `bytea` | NULL | — | The prepaid label (1 byte to 2 MiB); erased 30 days after the claim ends (§10). |
| `label_carrier_id`, `label_tracking`, `label_at` | `uuid`, `text`, `timestamptz` | NULL | — | FK → `carriers.id` (`warranty_claims_label_carrier_idx`); an order's tracking rule; `warranty_claims_label`: all three or none, the PDF only with them. |
| `service_record_id`, `received_at` | `uuid`, `timestamptz` | NULL | — | The INSPECTION record opened at receipt (FK → `service_records.id`, unique); `warranty_claims_received`: both or neither, but on a CANCELLED claim (a 2-year claim moved to the legal guarantee keeps its receipt time and hands its record over). |
| `outcome` | `text` | NULL | — | `CHECK IN ('REPLACEMENT','VALUE_CREDIT','PART_CREDIT','REPAIR','PRICE_REDUCTION','REFUND','REFUSED')` (`WARRANTY_CLAIM_OUTCOMES`). |
| `refusal_reason` | `text` | NULL | — | `CHECK IN ('LOST','THEFT_REPORTED','SCRATCHED','DAMAGED_ON_PURPOSE','DAMAGED_BY_SOMEONE_ELSE','ALTERED_OUTSIDE_ORBES','NO_FAULT_FOUND','WARRANTY_ENDED','WARRANTY_VOID')` (`WARRANTY_CLAIM_REFUSALS`); `warranty_claims_refusal`: exactly on a REFUSED outcome. |
| `value_minor`, `currency` | `int`, `text` | NULL | — | 1–100 000 000, `EUR`/`GBP`/`USD`/`CHF`: the piece's value a credit comes from, or a price reduction's or a refund's amount; `warranty_claims_value`: exactly on VALUE_CREDIT, PART_CREDIT, PRICE_REDUCTION and REFUND, both or neither. |
| `credit_percent` | `smallint` | NULL | — | 1–100: THE PROGRAM's percent at a PART_CREDIT (only then, `warranty_claims_credit`). |
| `grant_id` | `uuid` | NULL | — | FK → `tier_grants.id` (unique): the WARRANTY grant of a VALUE_CREDIT or a PART_CREDIT (only then, `warranty_claims_credit`). |
| `replacement_product_id`, `other_size` | `uuid`, `boolean` | NULL, NOT NULL | —, `false` | FK → `products.id` (unique): the new piece of a REPLACEMENT (only then, never the piece itself, `warranty_claims_replacement`); `other_size` only with one (*Another size, as the client asked*). |
| `decided_at`, `decided_by` | `timestamptz`, `uuid` | NULL | — | FK → `admin_users.id` (`warranty_claims_decided_by_idx`); `warranty_claims_decided`: with the outcome, all or none. |
| `return_carrier_id`, `return_tracking`, `return_shipped_at` | `uuid`, `text`, `timestamptz` | NULL | — | The new piece or the piece back (FK → `carriers.id`, `warranty_claims_return_carrier_idx`); `warranty_claims_return`: all three or none. |
| `done_at`, `cancelled_at` | `timestamptz` | NULL | — | |
| `note` | `text` | NULL | — | 1–500 characters once trimmed: staff only (a boutique receipt, why a claim was closed); never shown to the collector, never in the audit log nor in the export. |
| `continues_claim_id` | `uuid` | NULL | — | FK → `warranty_claims.id` (unique): the 2-year claim this LEGAL claim continues (`warranty_claims_continues`: LEGAL only, never itself). |

- **`warranty_claims_steps`:** the columns each status needs, outcome by outcome: OPEN none; LABEL_SENT the label's three; RECEIVED those and the record; DECIDED those and the decision, its outcome one the piece goes back after (REPLACEMENT, PART_CREDIT, REPAIR, PRICE_REDUCTION, REFUSED); DONE a refusal from OPEN (no label, receipt nor return), a credit of value or a refund (received, no return: ORBES keeps the piece), or any other outcome received and returned; CANCELLED no record, no decision, no return. `(status = 'CANCELLED') = (cancelled_at IS NOT NULL)`. `warranty_claims_times`: each step after the one before.
- **`warranty_claims_basis_outcome`** and **`warranty_claims_basis_refusal`**: each basis its own outcomes and reasons (`WARRANTY_CLAIM_OUTCOMES_BY_BASIS`, `WARRANTY_CLAIM_REFUSALS_BY_BASIS`, `db/schema.ts`): LIFETIME REPLACEMENT, VALUE_CREDIT, PART_CREDIT or REFUSED, never WARRANTY_ENDED; TWO_YEARS REPLACEMENT, REPAIR or REFUSED (LOST, THEFT_REPORTED, NO_FAULT_FOUND, WARRANTY_ENDED, WARRANTY_VOID); LEGAL REPLACEMENT, REPAIR, PRICE_REDUCTION, REFUND or REFUSED (DAMAGED_ON_PURPOSE, DAMAGED_BY_SOMEONE_ELSE, NO_FAULT_FOUND). A credit exists under the lifetime warranty only.
- **Indexes:** `warranty_claims_open_once`, unique `(product_id) WHERE status IN ('OPEN','LABEL_SENT','RECEIVED','DECIDED')`: one live claim per piece; `warranty_claims_free_once`, unique `(root_product_id) WHERE basis = 'LIFETIME' AND outcome IN ('REPLACEMENT','VALUE_CREDIT')`: **one free replacement per original purchase** under the lifetime warranty (a 2-year or a legal-guarantee replacement never counts); and the FK-leading indexes above.
- **Written by:** `WarrantyClaimService` (`services/warranty-claims.ts`): `open`, `label` (through PRIVATE CARE's label path), `receive` (`WarrantyService.openService`), `decide` (a WARRANTY grant, §5.66; the old piece REVOKED `REPLACED` or `REFUNDED`; a piece REVOKED by a REPLACEMENT still counts for its claimant's tier until its new piece has an ownership, `services/club.ts` `clubCounts`, CARE-C2), `moveToLegal`, `ship` (the new piece's warranty started, `via: 'warranty_claim'`; or the record completed), `cancel`; each audited `warranty.claim.*` (never the note, never an email), every step an OPERATOR's. **Read by:** the console's claim page, Claims tab and piece page; the club's count (`clubCounts`: a REPLACEMENT's old piece until its new piece is registered) and MY PIECES (`claimOutcome` of a piece the claim closed); the collector's ORBES CARE tab (`forCollector`: no note, no `opened_by`, no `decided_by`); the account's export (`warrantyClaims`); GROWTH, which leaves a claim's replacement out of the purchases; the transfer (`409 CLAIM_OPEN` while OPEN or LABEL_SENT) and PRIVATE CARE (UNAVAILABLE while live).
- **Personal data:** the claimant (an account), the label (an address, erased after 30 days) and the staff note; kept with the account.

### 5.120 `preregistrations`

Migration `0050_founding_list` (lot M1 of 2026-10-21, F2 to F5; [API §8.16 and §16.40](API.md#816-post-apiv1founding-theorbescoms-founding-list-extension-of-the-contract)): the founding list, the people theorbes.com's form adds, one row per address, never imported (F5: the old Google Sheet is not read).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `email` | `text` | NOT NULL | — | As typed, trimmed: 3–254 characters (`preregistrations_email_check`). |
| `email_normalized` | `text` | NOT NULL | — | Its lookup key (lower case, as a sign-in normalises it), 3–254; `preregistrations_email_normalized_key`, unique: an address sent again leaves its row exactly as it was. |
| `first_name` | `text` | NOT NULL | — | 1–80 characters (`FOUNDING_FIRST_NAME_MAX`), trimmed, no control character nor `<` `>`. |
| `country` | `char(2)` | NOT NULL | — | `^[A-Z]{2}$`, a code of `shared/countries.ts`. |
| `consent_at`, `consent_version` | `timestamptz`, `text` | NOT NULL | — | The box ticked, when, and the legal version in force (`FOUNDING_CONSENT_VERSION`, held equal to `LEGAL_VERSION` by `test/web/legal.content.test.ts`; `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`). Never a row without them. |
| `source_id` | `integer` | NOT NULL | — | FK → `acquisition_sources.id` (§5.108), `preregistrations_source_idx`: where the person came from, classified as an arrival in the app is (the console link of `o`, archived ones included, then the `utm_` tags, then the referring site, then DIRECT). |
| `account_id`, `matched_at` | `uuid`, `timestamptz` | NULL | — | FK → `accounts.id`, `preregistrations_account_idx`: the ORBES account with the same address, matched at once or at its sign-up; `preregistrations_matched`: both or neither. |
| `unsubscribed_at` | `timestamptz` | NULL | — | The person asked to receive nothing more (STOP THESE EMAILS): set once, the row kept, so the address is never written to again. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- **Trigger:** `preregistrations_immutable_identity` (`id`, `email`, `email_normalized`, `consent_at`, `consent_version`, `source_id`, `created_at`), raising `OR001`; `account_id`, `matched_at` and `unsubscribed_at` may change. Every foreign key `ON DELETE RESTRICT`.
- **Written by:** `FoundingService` (`services/founding.ts`): `register` (`POST /api/v1/founding`, from `https://theorbes.com` only; a filled honeypot or an address already on the list writes nothing, with the same 202; audited `founding.register` with the row's id and the source's kind, never the address; two forms at once for one address: the unique key decides, one row), the match (`services/founding-match.ts`: at once at `register`, or in `AuthService.registerAccount`'s transaction at the sign-up, a test entrant never; `founding.match`), `unsubscribe` (`founding.unsubscribe`, its QUEUED founding announcements cancelled in the same transaction) and `remove` (ADMIN, the phrase `REMOVE <8>`: the person's emails of §5.122 deleted, then the row, in one transaction; `founding.remove`, never the address).
- **Read by:** the console's Founding list (`GET /api/admin/founding`, `/summary`, the address masked for an AUDITOR; `/founding.csv`, OPERATOR, every address, in the columns of a Shopify customers import, S1 and S6), the segments' FOUNDING_LIST criterion (§5.58), the founding announcement (E1, every row not unsubscribed), the account's export (`foundingList`: the matched row's joining date, first name, country, consent version, source and unsubscribe date).
- **Retention and privacy:** personal data (an address, a first name, a country, a consent), kept until a request to erase it (the privacy policy's *The founding list*); an unsubscribed row receives nothing. Nothing leaves this database but the console's CSV. No row is inserted by the migration.

### 5.121 `email_templates`

Migration `0051_emails` (lot M1, E0; [API §16.41](API.md#1641-the-emails-extension-of-the-contract)): one row per kind of email the console has touched; **no row is the default: off, with the default words** of `email/copy.ts`. `kind` (PK, `CHECK (kind IN (…))`, the eleven `EMAIL_KINDS`: FOUNDING_ANNOUNCEMENT, RELEASE_NOTICE, PASSWORD_RESET, ORDER_CONFIRMED, ORDER_SHIPPED, ORDER_DELIVERED, ORDER_CANCELLED, DRAW_SELECTED, DRAW_OFFERED, WARRANTY_LABEL, CARE_LABEL); `enabled` (`boolean`, DEFAULT false: every kind starts off); `subject` (one line of 1–150 characters, trimmed, no control character, so never a header break: `EMAIL_TEMPLATE_SUBJECT_MAX`) and `body` (1–5 000 characters, `EMAIL_TEMPLATE_BODY_MAX`), each NULL for the default words; `updated_by` (NOT NULL, FK → `admin_users.id`, `email_templates_updated_by_idx`), `updated_at`. **Written by** `EmailService` only: a switch (ADMIN, `email.kind.enable` / `.disable`) and the words (OPERATOR, `email.template.update`), never at boot, so that 0051's down stays possible. No personal data. Eleven rows at most.

### 5.122 `email_outbox`

Migration `0051_emails` (lot M1, E0): every email, written **in the transaction of the act that causes it** and sent later by the sender loop, so an email exists exactly when its act committed.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK; the message's `Message-ID`. |
| `kind` | `text` | NOT NULL | — | One of `EMAIL_KINDS` (§5.121). |
| `dedupe_key` | `text` | NOT NULL | — | One line of 1–200 characters (`EMAIL_DEDUPE_MAX`); `email_outbox_dedupe_key`, unique: each trigger writes its key once (`E1:<release>:<pre-registration>`, `E2:<release>:<account>`, …), so a trigger run twice sends once. |
| `account_id`, `preregistration_id` | `uuid` | NULL | — | FK → `accounts.id` (`email_outbox_account_idx`), `preregistrations.id` (`email_outbox_preregistration_idx`): who it is for; `email_outbox_subject`: at most one (neither for the console's test to itself). |
| `to_address` | `text` | NOT NULL | — | 3–254 characters, trimmed, no control character; plain ASCII (an address the envelope cannot carry is never written). |
| `subject`, `body_text`, `body_html` | `text` | NOT NULL | — | Rendered at enqueue in the house's look (`email/render.ts`), so the console shows exactly what was sent: the subject one line of 1–300 characters with no control character (`EMAIL_SUBJECT_MAX`), the bodies not empty. |
| `not_before` | `timestamptz` | NOT NULL | `now()` | When it may go: now, or a release's opening (E1 sent at the opening). |
| `status` | `text` | NOT NULL | `'QUEUED'` | `CHECK (status IN ('QUEUED','SENT','FAILED','CANCELLED'))` (`EMAIL_STATUSES`). |
| `attempts` | `smallint` | NOT NULL | `0` | ≥ 0. |
| `last_error` | `text` | NULL | — | 1–300 characters (`EMAIL_ERROR_MAX`): the SMTP step and the server's words, never the credentials. |
| `created_at`, `sent_at`, `settled_at` | `timestamptz` | NOT NULL, NULL, NULL | `now()`, —, — | `email_outbox_sent`: `sent_at` exactly when SENT; `email_outbox_settled`: `settled_at` exactly when no longer QUEUED (sent, failed or cancelled), which the purge reads. |

- **CHECKs:** the above, and `email_outbox_failed`: a FAILED row always has its `last_error`.
- **Trigger:** `email_outbox_immutable_content` (`id`, `kind`, `dedupe_key`, `account_id`, `preregistration_id`, `to_address`, `subject`, `body_text`, `body_html`, `created_at`), raising `OR001`: only the status, the attempts, the error and the times move.
- **Indexes:** primary key; the unique key; `email_outbox_due (status, not_before)`, the sender's due rows, oldest first; the two foreign-key indexes (the account's export and lock, a pre-registration's unsubscribe and removal).
- **Written by:** `EmailService.enqueue` and `enqueueMany` (`services/email.ts`), called by the triggers (`services/email-triggers.ts`: E1 to E5) and by `AccountRecoveryService.requestByEmail` (E3), in their transaction; nothing is written while the channel is off (`EMAIL_TRANSPORT` unset or `off`) or the kind is not switched on. The sender (`sendDue`, every 15 s while the channel is on) claims up to 50 due rows with `FOR UPDATE SKIP LOCKED`, counting the attempt and moving `not_before` 10 minutes ahead (its lease), so two processes never send one email at once; then SENT, or tried again 1 min, 5 min, 30 min and 2 h later, then FAILED (a 5xx refusal: FAILED at once). At send time a row is CANCELLED instead when its account is no longer ACTIVE, a release notice's account stopped them, a founding announcement's pre-registration unsubscribed, a reset's code is used, replaced or expired, or its release is cancelled, gone or over. `OwnerService.lock` cancels the account's QUEUED rows in its transaction (`emailsCancelled`), an unsubscribe the person's QUEUED rows of that kind, a release cancelled its QUEUED E1 and E2 rows, a LIVE RELEASE's new opening its QUEUED E1 rows, CANCEL SCHEDULED the founding announcement's; a pre-registration's removal deletes its rows.
- **Read by:** the console's Emails page (the counts, the last errors, the rows with the address masked for an AUDITOR and a reset's link never shown, one row as it was sent), the founding announcement's panel (its counts), and the account's export (`emails`: kind, status and dates, never the address, subject or words).
- **Retention:** housekeeping's `emailPurge` (§10) erases a row 90 days after `settled_at` (`EMAIL_RETENTION_DAYS`), its address, subject and words with it, whether the channel is on or not; a QUEUED row is never purged. A PASSWORD_RESET row's body holds the reset link (the address and the recovery code) until then, a code that works 30 minutes and once.
- **Privacy:** personal data (an address, a first name, an order's reference and tracking, a release's words); nothing about a piece's material or price.

### 5.123 `email_preferences`

Migration `0051_emails` (lot M1, E2): a collector's choice, one row per account that has made one. `account_id` (PK, FK → `accounts.id`), `release_notices` (`boolean`, DEFAULT false: release notices are opt-in), `changed_at`. **No row is off.** Written by YOUR PROFILE's EMAIL ME WHEN A RELEASE IS ANNOUNCED (`PUT /api/v1/account/email-preferences`, only while the channel is on; audited `account.email_preferences` with `{ releaseNotices, by }`) and by a release notice's STOP THESE EMAILS (set to false). Read by the release notices' scan and the account's export (`emailPreferences`). Personal data, kept with the account.

### 5.124 `email_state`

Migration `0051_emails` (lot M1, E2): one row (`id smallint PRIMARY KEY DEFAULT 1`, `CHECK (id = 1)`), `releases_until`, the release notices' watermark: each scan writes the notices of the releases announced since it, less a 10-minute overlap (`RELEASE_NOTICE_OVERLAP_MS`), then moves it to now. Inserted by the scan's first run, set 10 minutes ahead, so no scan ever looks back before that run (nothing announced before the emails were on is ever sent as a release notice); set ahead so again when the scan has not run for over an hour (`RELEASE_NOTICE_RESUME_MS`: the channel switched off, then on). Never written by the migration; its row does not hold 0051's down back. No personal data.

### 5.125 `house_moment_settings`

Migration `0052_house_messages` (lot M2 of 2026-10-22, macro scope D24 M1; [API §16.42](API.md#1642-house-messages-extension-of-the-contract)): one row per moment the console has touched; **no row is the default: off, with the default words** of `src/shared/house-words.ts` (0051's `email_templates` pattern). `moment` (PK, `CHECK (moment IN (…))`, the six `HOUSE_MOMENTS`: FIRST_REGISTRATION, BIRTHDAY_CREDIT, CREDIT_EXPIRING, PRIVATE_CARE, OWNERSHIP_YEAR, NINETY_DAYS), `enabled` (`boolean`, DEFAULT false: **every moment starts off**) and `enabled_at`, set exactly while enabled (`house_moment_settings_enabled`) and moved to now when it is switched on: a moment delivers only what falls due from then on, never the past. `title` (one line of 1–80 characters, trimmed, no control character, `HOUSE_TITLE_MAX`) and `body` (1–2 000 characters, plain paragraphs, not blank, `HOUSE_BODY_MAX`), each NULL for the default words; `updated_by` (NOT NULL, FK → `admin_users.id`, `house_moment_settings_updated_by_idx`), `updated_at`. Written by `HouseMomentService.setMoment` under the row's `FOR UPDATE` (the switch ADMIN, `house.moment.enable` / `.disable`; the words OPERATOR, `house.moment.words`, never the words themselves); read by the console and by the housekeeping's `houseMoments` (§10). No personal data.

### 5.126 `house_messages`

Migration `0052_house_messages` (lot M2, D24 M2): the custom messages staff write to a segment or a tier.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `title`, `body` | `text` | NOT NULL | — | As §5.125's: one line of 1–80 characters; plain paragraphs of at most 2 000, `{firstName}` their only placeholder, filled when the collector reads it. |
| `status` | `text` | NOT NULL | `'DRAFT'` | `CHECK (status IN ('DRAFT','SCHEDULED','SENT','CANCELLED'))` (`HOUSE_MESSAGE_STATUSES`). |
| `audience_segment_id` | `uuid` | NULL | — | FK → `segments.id` (`house_messages_audience_segment_idx`), a saved segment (§5.58). |
| `audience_min_tier` | `smallint` | NULL | — | `CHECK (audience_min_tier BETWEEN 1 AND 3)`: TITANE, PLATINE or PALLADIUM, read as « this tier and above ». |
| `audience_label` | `text` | NULL | — | The segment's or the tier's name written at sending (and at cancelling), one line of 1–80 characters, so a sent message keeps its audience's name after its segment is deleted. |
| `send_at` | `timestamptz` | NULL | — | When it goes or went: exactly while SCHEDULED or SENT (`house_messages_send_at`). |
| `sent_at`, `reach` | `timestamptz`, `integer` | NULL | — | When it was delivered and how many accounts it reached (≥ 0), exactly when SENT (`house_messages_sent`). |
| `sent_by` | `uuid` | NULL | — | FK → `admin_users.id`: the ADMIN who scheduled or sent it; none on a DRAFT, set on a SCHEDULED or SENT message (`house_messages_sent_by`). |
| `cancelled_at`, `cancelled_by` | `timestamptz`, `uuid` | NULL | — | Exactly when CANCELLED (`house_messages_cancelled`); FK → `admin_users.id`. |
| `created_by`, `updated_by` | `uuid` | NOT NULL | — | FK → `admin_users.id`. |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **CHECKs:** the above, and `house_messages_audience`: exactly one of `audience_segment_id` and `audience_min_tier` while DRAFT or SCHEDULED; `house_messages_label`: `audience_label` NOT NULL once SENT.
- **Triggers:** `house_messages_immutable_identity` (`id`, `created_by`, `created_at`); `house_messages_sent_immutable`: once SENT nothing changes (every column but the segment's id); `house_messages_sent_audience`: a SENT message's segment id may only be cleared, never set to another segment; `house_messages_no_delete`: only a DRAFT is ever deleted (a scheduled one is cancelled, a sent one kept with its deliveries); each raising `OR001`. Every foreign key `ON DELETE RESTRICT` (a segment named by a sent or cancelled message is cleared from it by `SegmentService.remove` before the segment goes).
- **Indexes:** primary key; `house_messages_due (status, send_at)`, the sender's due messages; each foreign key at the head of its own index.
- **Written by:** `HouseMessageService` (`services/house-messages.ts`): `create`, `update` and `remove` (OPERATOR), `send` and `cancel` (ADMIN), each under the row's `FOR UPDATE`; `deliverDue`, the loop `HouseSender` (every 30 s, §8.2), which claims a due message `FOR UPDATE SKIP LOCKED`, writes its deliveries (§5.127) and marks it SENT with its reach and label, in one transaction.
- **Read by:** the console's House messages page (the list, one message with its reach, read and share read; a draft's reach now); the Segments page's *Used by*; no collector reads this table but through a delivery.
- **Privacy:** staff's own words to a group; no collector is named in it.

### 5.127 `house_deliveries`

Migration `0052_house_messages` (lot M2, D24 M3 and M4; [API §10.29](API.md#1029-from-orbes-get-apiv1accounthouse-messages-and-post-apiv1accounthouse-messagesread-extension-of-the-contract)): one row per house message an account received in MESSAGES.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`. |
| `source` | `text` | NOT NULL | — | `MOMENT` or `CUSTOM` (`HOUSE_DELIVERY_SOURCES`). |
| `moment` | `text` | NULL | — | A MOMENT's kind (`HOUSE_MOMENTS`). |
| `house_message_id` | `uuid` | NULL | — | FK → `house_messages.id`: a CUSTOM's message, whose words are read from it (never copied to every account). |
| `title`, `body` | `text` | NULL | — | A MOMENT's words **rendered at delivery** and stored with it (one line of 1–400 characters; at most 8 000, `HOUSE_DELIVERED_TITLE_MAX`, `HOUSE_DELIVERED_BODY_MAX`), so an edit of the words changes the next deliveries, never these. |
| `piece_ref` | `text` | NULL | — | The piece's serial (`^O[0-9]{2}-[A-Z]-[0-9]{5,6}$`), exactly for FIRST_REGISTRATION and OWNERSHIP_YEAR (`house_deliveries_piece`), for its links. |
| `dedupe_key` | `text` | NOT NULL | — | One line of 1–200 characters; `house_deliveries_dedupe_key`, unique: `FIRST_REGISTRATION:<account>`, `BIRTHDAY_CREDIT:<grant>`, `CREDIT_EXPIRING:<grant>`, `PRIVATE_CARE:<account>`, `OWNERSHIP_YEAR:<ownership>`, `NINETY_DAYS:<account>:<the Paris day of the last activity>`, `CUSTOM:<message>:<account>`: whatever the passes, restarts or processes, each is delivered once. |
| `delivered_at` | `timestamptz` | NOT NULL | `now()` | |
| `read_at` | `timestamptz` | NULL | — | When its collector opened FROM ORBES, never before its delivery (`house_deliveries_read`). |

- **CHECKs:** the above, and `house_deliveries_source`: a MOMENT has its `moment`, `title` and `body` and no message; a CUSTOM its `house_message_id` only.
- **Triggers:** `house_deliveries_immutable` (every column but `read_at`); `house_deliveries_no_delete` and `house_deliveries_no_truncate`: house messages are kept with the account, as messages are.
- **Indexes:** primary key; the unique key; `house_deliveries_account_idx (account_id, delivered_at DESC)`, MESSAGES' list; `house_deliveries_unread_idx (account_id) WHERE read_at IS NULL`, NOW's line and the counts; `house_deliveries_message_idx (house_message_id)`, a message's reach and reads; `house_deliveries_moment_idx (moment, delivered_at)`, the console's figures.
- **Written by:** `HouseMomentService.runMoments` (the housekeeping's `houseMoments`, §10: for each moment switched on, what fell due since `enabled_at`, in transactions of at most 500, `ON CONFLICT (dedupe_key) DO NOTHING`) and `HouseMessageService.deliverDue` (one `INSERT … SELECT` of the audience at that moment); only ACTIVE accounts that are not test entrants. `read_at` by `POST /api/v1/account/house-messages/read`.
- **Read by:** the account's MESSAGES (FROM ORBES), NOW's unread line and the unread counts; the console's figures (delivered and read, counts only); the account's export (`houseMessages`, with when each was read). Measured in the morning's `intelligence sizes` (§10).
- **Privacy:** what ORBES wrote to one person, sometimes naming one of its pieces; kept with the account, as its messages are.
- **Lot Q3, THE VAULT** (migration `0061_the_vault`, D18, D21): `source` gains **`VAULT`** (`house_deliveries_source_check`; `house_deliveries_source` rebuilt: a VAULT row has its title and words, no moment, no message, no piece reference). A vault's arrival (A VAULT IS WAITING FOR YOU, `dedupe_key` `VAULT:<the first vault given>`, one message per occasion however many vaults it gives) and its receipt once opened (FROM THE VAULT, `VAULT_OPENED:<vault>`), their words rendered at delivery in the vault's "we" (`vaultArrivedWords`, `vaultOpenedWords`, `src/shared/house-words.ts`) and written in the transaction that gives or opens the vault. Not a moment: no switch, no console words. Read as any delivery (MESSAGES' FROM ORBES with its THE VAULT link, NOW's line, the export). `0061`'s down step refuses while a VAULT delivery exists.

### 5.128 `worn_photos`

Migration `0053_worn` (lot M2, macro scope D31 G1 to G3; [API §8.19, §11.8 and §16.43](API.md#118-worn-from-a-piece-get-and-post-apiv1accountproductsproductidworn-delete-apiv1accountwornid-and-get-apiv1accountwornidphoto-extension-of-the-contract)): one row per photograph an owner sends from a piece for WORN.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `product_id`, `ownership_id`, `account_id`, `model_id` | `uuid` | NOT NULL | — | FK → `products.id`, `ownership.id` (the period of ownership it was sent in: once it ends, the photograph leaves WORN), `accounts.id` (the sender), `models.id` (the piece's model at sending: the sheet it shows on). |
| `photo` | `bytea` | NULL | — | The image, 1 byte to 1 MiB (`WORN_PHOTO_MAX_BYTES`), as `media/image.ts` cleaned it. |
| `photo_mime`, `photo_sha256`, `width`, `height` | `text`, `text`, `integer`, `integer` | NULL | — | `image/jpeg` or `image/webp`; the hex SHA-256 of its bytes (`worn_photos_sha256_consistent`); 1–4 096 px. |
| `credit_first_name` | `text` | NOT NULL | — | YOUR PROFILE's first name at sending: 1–50 characters, trimmed, no control character nor `<` `>`. |
| `credit_country` | `char(2)` | NOT NULL | — | The account's country at sending, `^[A-Z]{2}$`. |
| `credit_instagram` | `text` | NULL | — | `^[a-z0-9._]{1,30}$`, only when the owner chose to show it. |
| `consent_at`, `consent_version` | `timestamptz`, `text` | NOT NULL | — | The consent ticked, when, and the legal version shown (`WORN_CONSENT_VERSION`, held equal to `LEGAL_VERSION`; `YYYY-MM-DD`). |
| `status` | `text` | NOT NULL | `'PENDING'` | `PENDING`, `PUBLISHED`, `REFUSED`, `WITHDRAWN`, `TAKEN_DOWN` or `ENDED` (`WORN_STATUSES`). |
| `refusal` | `text` | NULL | — | `PIECE_NOT_VISIBLE`, `QUALITY` or `NOT_SUITABLE` (`WORN_REFUSALS`), exactly when REFUSED or TAKEN_DOWN (`worn_photos_refusal`). |
| `reviewed_by`, `reviewed_at` | `uuid`, `timestamptz` | NULL | — | FK → `admin_users.id`: both or neither, set when published, refused or taken down, never while PENDING (`worn_photos_reviewed`). |
| `published_at` | `timestamptz` | NULL | — | Set once published and kept after (`worn_photos_published`, `worn_photos_published_kept`). |
| `ended_at` | `timestamptz` | NULL | — | Exactly when no longer PENDING or PUBLISHED (`worn_photos_ended`). |
| `created_at` | `timestamptz` | NOT NULL | `now()` | When it was sent. |

- **CHECKs:** the above, and `worn_photos_photo`: the photograph's five columns all present **exactly while PENDING or PUBLISHED**; a photograph refused, withdrawn, taken down or ended is erased, its row kept.
- **Triggers:** `worn_photos_immutable_identity` (the identity, the credit and the consent); `worn_photos_forward`: the status only moves forward, PENDING to PUBLISHED, REFUSED, WITHDRAWN or ENDED, PUBLISHED to WITHDRAWN, TAKEN_DOWN or ENDED; `worn_photos_settled_immutable`: a settled row never changes again; `worn_photos_photo_kept`: the photograph is erased, never replaced; `worn_photos_no_delete` and `worn_photos_no_truncate`. Each raising `OR001`. Every foreign key `ON DELETE RESTRICT`.
- **Indexes:** primary key; `worn_photos_live_once`, **unique** on `product_id` while PENDING or PUBLISHED (G1: one photograph at a time; two sendings at once, one fails here); `worn_photos_sheet (model_id, published_at DESC) WHERE status = 'PUBLISHED'`, a sheet's WORN; `worn_photos_queue (status, created_at)`, the console's lists; `worn_photos_account_idx (account_id, created_at)`, the rate and the export; `worn_photos_product_idx (product_id, created_at)`; and the other foreign keys' own.
- **Written by:** `WornService` (`services/worn.ts`): `send` (the owner, under the account's row and the piece's, `FOR UPDATE`: the rules of API §11.8, 5 sendings in 24 hours, a photograph the previous owner left live ended first), `withdraw` (the owner: WITHDRAWN, erased), `publish`, `refuse` and `takeDown` (OPERATOR, under the row's `FOR UPDATE`; the last two erase), and `endLeft`, the housekeeping's `wornEnded` (§10). Never in `media_objects` (§5.26), whose public route serves any stored hash and is cached for good.
- **Read by:** the model's sheet and its pages (the **shown** photographs only: PUBLISHED, the ownership still open, the piece not REVOKED, the account ACTIVE; the credit only), the public photo route while shown (kept 5 minutes), the owner's piece, the console (the owner's email masked for an AUDITOR), the account's export (`wornPhotos`, never the bytes). Measured in the morning's `intelligence sizes` (§10).
- **Retention and privacy:** a photograph of a person, with a first name, a country and perhaps an Instagram name, published to everyone on the owner's consent; its bytes are kept only while it is in review or published (and in the backups of that time, §11), erased when it is withdrawn, refused, taken down or its piece leaves its owner; the row (its dates, status and credit) stays with the account (the privacy policy's *WORN*). No row is inserted by the migration.

### 5.129 `boxes`

Migration `0054_boxes_weights` (lot M3 of 2026-10-23, macro scope D16 B1; [API §16.44](API.md#1644-boxes-a-models-packing-and-a-parcels-box-and-weight-extension-of-the-contract)): one row per box the house uses, in Orders → Settings.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `name` | `text` | NOT NULL | — | 1–60 characters, trimmed; `boxes_name_key`, unique `lower(name)`. |
| `inside_length_mm`, `inside_width_mm`, `inside_height_mm` | `integer` | NOT NULL | — | 1–2 000 mm each. |
| `empty_weight_g` | `integer` | NOT NULL | — | 1–30 000 g. |
| `cost_minor`, `currency` | `bigint`, `text` | NULL | — | 0–100 000 000 minor units and `^[A-Z]{3}$`, both or neither (`boxes_cost`). Never read on the parcel's side. |
| `active` | `boolean` | NOT NULL | `true` | False: set aside, never offered for a model nor a parcel again; never deleted by the service. |
| `created_at`, `created_by`, `updated_at` | `timestamptz`, `uuid`, `timestamptz` | `created_by` NULL | `now()` | `created_by` FK → `admin_users.id` (NULL for a script); `updated_at` stamped by `orbes_touch_updated_at`. |

- **CHECKs:** the above, and **`boxes_card_fits`**: `greatest(inside_length_mm, inside_width_mm) >= 95 AND least(inside_length_mm, inside_width_mm) >= 62`, the certificate card 79t taken flat in either orientation (`CERTIFICATE_CARD_MM`, held equal to `render/certificate.ts` `CERTIFICATE_CARD` by `schema.test`).
- **Triggers:** `boxes_immutable_identity` (`id`, `created_at`, `created_by`).
- **Columns added elsewhere by 0054:** `models.box_id` (FK → `boxes.id`, NULL: none, or on a variant its main model's) and `models.packed_weight_g` (1–30 000 g, the piece packed with its pouch and card, without the box; NULL: unknown, or a variant's main model's), §5.3; `shipments.box_id`, `weight_g` (1–100 000 g) and `weight_missing` (a `text[]` of 1–64 non-empty entries), §5.85, written at PACKED: the weight or its missing list only once packed, never both (`shipments_weight`). Every foreign key `ON DELETE RESTRICT`, at the head of an index.
- **Written by:** `BoxService` (`services/boxes.ts`, ADMIN: `box.create`, `box.update`, `box.set_aside`, `box.reinstate`); a model's by `CatalogService.setModelPacking` (OPERATOR, `model.packing`); a shipment's by `LogisticsService.chooseBox` (CHANGE BOX, `shipment.box`) and at Packed.
- **Down:** refuses, naming the counts, while a box exists, a model has a box or a packed weight, or a shipment a box, a weight or a missing list; otherwise the schema of `0053` exactly.
- **Privacy:** none: the house's boxes and costs.

### 5.130 `stock_location_countries`

Migration `0055_location_countries` (lot M3, macro scope K11 Z1; [API §16.46](API.md#1646-the-countries-each-location-serves-and-order-a-model-by-size-extension-of-the-contract)): the countries each location serves, one row per country served. `country` (`char(2)`, `^[A-Z]{2}$`, **the primary key**: a country is served by one location at most), `location_id` (FK → `stock_locations.id`, `stock_location_countries_location_idx`), `updated_by` (NULL, FK → `admin_users.id`), `updated_at` (stamped). `stock_location_countries_immutable_country`: a country moves by changing its location, never its code. No row is inserted: until staff set them, every collector counts at the default location. Written by `StockService.setLocationCountries` (ADMIN, the whole list of a location at once, a country served elsewhere moved; `stock.location.countries`); read by ORDER A MODEL's split (`services/size-split.ts`, `locationForCountry`) and Settings → Locations' SERVES. **Down** refuses while a country is served, naming the count. No personal data.

### 5.131 `addon_items`

Migration `0056_addons` (lot M3, macro scope K48 D1; [API §16.47](API.md#1647-add-ons-the-catalogue-and-their-stock-extension-of-the-contract)): the catalogue add-ons, sold with a piece; **no ORBES CODE, no identity, never a product row, never counted toward the tier**. `id` (PK), `name` (1–40 characters, trimmed, as the collector reads it; `addon_items_name_key`, unique `lower(name)`), `line` (NULL, 1–120 characters), `supplier_id` (NULL, FK → `suppliers.id`), `weight_g` (NULL, 1–30 000 g, for the parcel's weight), `position` (0–10 000, the order offered in), `active` (NOT NULL, `true`; set aside when false, never deleted), `shopify_product_id` (NULL, unique: its one Shopify product, S5), `created_at`, `created_by` (NULL, FK → `admin_users.id`), `updated_at` (stamped). Its identity, creation and author never change. Its stock is **its own SKU** (§5.47: `skus.addon_id`, one per add-on). Written by `AddonService` (OPERATOR, `addon.*`). No personal data.

Migration `0059_addons_one_system` (lot Q2, ADD-ONS ONE SYSTEM, D3, D4, D12; [API §16.47](API.md#1647-add-ons-the-catalogue-and-their-stock-extension-of-the-contract)) adds:

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `kind` | `text` | NOT NULL | `'PRODUCT'` | `addon_items_kind_check`: `PRODUCT` (real stock, every add-on of lot M3) or `SERVICE` (an engraving, a gift wrapping: no stock count, no supplier, no warehouse; `ADDON_KINDS`). `addon_items_service_plain`: `CHECK (kind = 'PRODUCT' OR supplier_id IS NULL)`. Fixed at the creation: the identity guard `addon_items_immutable_identity` gains `kind` (N13). |
| `offer_live`, `offer_draw`, `offer_salon`, `offer_orders` | `boolean` | NOT NULL | `true` | Its four switches, where it is offered: a piece held in a LIVE RELEASE (its after-room included), a place held in a release with a draw, a request of the private salon, YOUR ORDERS until packing begins (every add-on of lot M3 was offered at all four, and stays). |
| `engraving` | `boolean` | NOT NULL | `false` | The add-on whose collector types the words engraved on the piece: a service only (`addon_items_engraving_service`: `CHECK (NOT engraving OR kind = 'SERVICE')`), one offered at a time (`addon_items_engraving_key`, a unique index on `((true))` `WHERE engraving AND active`): an order carries one engraving. |
| `text_max` | `smallint` | NOT NULL | `20` | `addon_items_text_max_check` (1–20): the engraving's most characters, read on the engraving only (20 on every other add-on, the service's rule); 20, the house's ceiling, by default, so every add-on of lot M3 and the converted engraving keep it. |

Migration `0060_release_addons_converted` inserts the converted add-ons (§5.140): services offered at a LIVE purchase only (`offer_live` alone), the engraving among them, their SKUs `ADD-<LABEL>`.

### 5.132 `addon_item_prices`

Migration `0056_addons`: an add-on's price per house currency, primary key `(addon_id, currency)` (`currency` EUR, GBP, USD or CHF), `price_minor` (0–100 000 000), `updated_at`; no row: not offered in that currency. Its add-on and currency never change. Written by `AddonService.setPrices` (`addon.prices`, each currency before and after; `null` deletes the row). No personal data.

### 5.133 `order_addon_items`

Migration `0056_addons` (macro scope K48 D2; [API §10.30, §16.48](API.md#1648-add-ons-on-an-order-extension-of-the-contract)): **one row per unit** of an add-on on an order.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `order_id` | `uuid` | NOT NULL | — | FK → `orders.id`. |
| `addon_id`, `sku_id` | `uuid` | NOT NULL | — | `order_addon_items_sku_fkey` → `skus (addon_id, id)`: the SKU of that add-on, never a model's size. |
| `location_id` | `uuid` | NOT NULL; NULL since `0059` | — | FK → `stock_locations.id`: where the unit is held; it moves with its order's location. Since migration `0059` (lot Q2, D4) NULL for a **service's** unit, held nowhere: the trigger `order_addon_items_kind_guard` (BEFORE INSERT and BEFORE UPDATE OF `location_id`) raises a check violation of that name for a product's unit without a location and a service's with one, so a service's unit never holds stock (`stock_holds`, §6.1) and never moves with its order. |
| `price_minor`, `currency` | `integer`, `text` | NOT NULL | — | 0–100 000 000 in a house currency: its price when it was added, kept. |
| `status` | `text` | NOT NULL | `'HELD'` | HELD → SHIPPED → RETURNED, or HELD → REMOVED (taken off before packing) or CANCELLED (with its order) (`ORDER_ADDON_STATUSES`). |
| `added_at`, `removed_at`, `cancelled_at`, `shipped_at`, `returned_at` | `timestamptz` | `added_at` NOT NULL | `now()` | Each status with its own time only (`order_addon_items_status_times`), in order (`order_addon_items_times`). |
| `added_by_type`, `added_by` | `text`, `uuid` | `added_by` NULL | — | PURCHASE (carried from the collector's choice, no one named), COLLECTOR (their account) or STAFF (an admin; NULL for a script) (`order_addon_items_added_by`). |
| `returned_to_stock` | `boolean` | NULL | — | With RETURNED only (`order_addon_items_returned`): back in stock, or kept out when ORBES marks it not to be sold again. |
| `invoice_id` | `uuid` | NULL | — | FK → `invoices.id`: its supplementary invoice when added after PAID. |
| `shopify_line_item_id` | `text` | NULL | — | Unique: its line item on the store, S5. |

- **Indexes:** primary key; `order_addon_items_held_idx (sku_id, location_id) WHERE status = 'HELD'`, the units held (as `orders_stock_reservation_idx` reads the orders' holds); each foreign key at the head of an index.
- **Triggers:** the identity, order, add-on, SKU, price, currency, addition and author never change.
- **Written by:** `OrderAddonService` and the order flows (`services/order-addons.ts`): carried at PAY (since lot Q2 one unit on each piece's order, a set's on its first piece's order), a draw's CONFIRMED or a salon's ACCEPTED, added and removed in YOUR ORDERS until packing and by staff until the parcel is packed (its shipment PACKED), cancelled, shipped (with a SHIPPED movement naming the unit, §5.48), returned, moved; every unit taken under its SKU's lock (`lockSku`, §8.2); a service's unit with no lock, no location and no stock movement (lot Q2). Since lot Q2 an order's engraving is the ENGRAVING add-on's unit, added and removed with its words by `OrderService.setEngraving` and `setTerms` (§5.51 `engraving_text`).
- **Read by:** `stock_holds` (§6.1), the order's page, YOUR ORDERS, the invoices, the packing checklist and slips, the parcel's weight, the order and account exports. **Privacy:** what a collector bought, with their order.
- **Lot Q3, THE VAULT** (migration `0062_vault_rewards`, D19 "a free add-on", N11): `added_by_type` gains **`VAULT`** (`order_addon_items_added_by_type_check`): a vault's free add-on, with `vault_id` (`uuid`, NULL, FK → `vaults.id` `ON DELETE RESTRICT`, `order_addon_items_vault_idx`) on such a unit and only there, at price 0 (**`order_addon_items_vault`**), naming no one (`order_addon_items_added_by` rebuilt); one unit not removed nor cancelled per vault (**`order_addon_items_vault_key`**, unique `(vault_id) WHERE status IN ('HELD', 'SHIPPED', 'RETURNED')`). The identity guard gains `vault_id`. Written by `attachVaultAddons` (`services/order-addons.ts`) at the creation of the collector's next order within the vault's 30-day offer (`vaults.offer_until`), on each of the five sale paths, never on a welcome gift, a size exchange, a VAULT order or an order travelling with another; an add-on of kind PRODUCT only, so the unit holds stock; with none in stock the offer waits. `0062`'s down step refuses while a VAULT unit exists.

### 5.134 `addon_choices`

Migration `0056_addons` (D2): the add-ons a collector chose **before their order exists**, on exactly one owner (`addon_choices_owner`): `live_entry_id` (a LIVE hold), `drop_entry_id` (a draw's place held) or `shop_request_id` (a salon request), each FK `ON DELETE RESTRICT`; `addon_id` (FK → `addon_items.id`), `units` (1–3), `chosen_at`; once per owner and add-on (unique). Since migration `0059` (lot Q2, D12, N3), `text` (NULL; `addon_choices_text_check`: 1–120 characters, trimmed, as `orders.engraving_text`): the engraving's words typed on a LIVE hold (screen 5b's YOUR TEXT), on the engraving's choice only and at most its `text_max` (the service's rule); carried at PAY onto each order that takes an engraving unit, deleted with the choice when the hold lapses; never in the audit log (`text: true`) nor the journal; in the account's export (`addonChoices[].text`, the review of lot Q2). A LIVE hold's choice is one unit per piece of its entry at PAY (`units` 1 kept on the choice). Written by `setChoices` (the hold's `items`, `PUT /api/v1/club/drops/:id/addons`, a salon request's `addons`), carried onto the order then deleted by the service (`carryChoices`), deleted too where the entry's or request's chance ends (lapsed, declined, the hold's end, an account lock, END TEST). Read by the entry's and request's views, the console's draw Confirm and salon Accept, and the account's export (`addonChoices`). **Down** for 0056 refuses, naming the counts, while an add-on, an add-on's SKU, a unit or a choice exists; otherwise the schema of `0055` exactly.

### 5.135 `sets`

Migration `0057_sets` (lot M3, macro scope K44 T1; [API §16.49](API.md#1649-the-set-the-catalogue-its-releases-and-its-sales-extension-of-the-contract)): one row per set. `id` (PK), `name` (1–60 characters, trimmed; `sets_name_key`, unique `lower(name)`), `code` (`^[A-Z0-9][A-Z0-9-]{1,39}$`, unique `sets_code_key`: its reference and future Shopify handle), `base_price_minor` (0–100 000 000) and `base_currency`, both or neither (`sets_base_price`), `active` (NOT NULL, `true`; never deleted), `shopify_product_id` (NULL, unique), `created_at`, `created_by` (NULL), `updated_at` (stamped). Its identity, creation and author never change. Written by `SetService` (OPERATOR, `set.*`). No personal data.

### 5.136 `set_models`

Migration `0057_sets`: a set's pieces in order, primary key `(set_id, position)`, `position` 1–4, `model_id` (FK → `models.id`, a main model or a variant), each model once per set (`set_models_model_key`). That a set holds 2 to 4 of them at positions 1 to n, each active and sized, is `SetService`'s rule (`422 SET_MODELS`), which replaces them together and only while no release names the set (`409 SET_IN_USE`).

### 5.137 `drop_entry_sizes`, `live_entry_sizes`, `live_interest_sizes`

Migration `0057_sets` (K44 T1): the size an entry (or an interest) of a **set's release** chose for each piece, one row per piece; a model's release keeps its one `size_id`. `drop_entry_sizes (entry_id, drop_id, piece, size_id)` (the draw entry's `drop_entries.size_id` stays NULL), `live_entry_sizes (entry_id, drop_id, piece, size_id)` (`live_entries.size_id` keeps its first piece's size, NOT NULL as before), `live_interest_sizes (drop_id, account_id, piece, size_id)` (I'LL BE THERE; `live_interest.size_id` its first piece's). Primary key the entry (or interest) and `piece` (1–4). Composite foreign keys tie each row to its own entry and release (`drop_entries (id, drop_id)`, `live_entries (id, drop_id)`, `live_interest (drop_id, account_id)`) and its size to that release **and that piece** (`drop_sizes (id, drop_id, piece)`, `drop_sizes_piece_key`). The entry, release and piece never change; the size does (CHANGE SIZE). Every foreign key `ON DELETE RESTRICT`: the service deletes these rows where it deletes their interest (I'LL BE THERE withdrawn, an account lock, END TEST) or rewrites a release's sizes. Written by `DropService` and `LiveService`; read by the draw's fill, OFFER NEXT, the LIVE turns (by every size), the boards, the public pages (each drawn entry's sizes) and the account's export. **Privacy:** a collector's sizes, with their entry.

### 5.138 `set_sales`

Migration `0057_sets` (K44 T1 to T3): **one row per set sold**. `id` (PK), `set_id` (FK → `sets.id`), `drop_id` (NULL: a sale on the future Shopify store names no release, S2; `set_sales_drop_fkey (drop_id, set_id)` → `drops (id, set_id)`, a release of that very set), `account_id` (FK → `accounts.id`), `price_minor` and `currency` (both or neither: a draw without a price has none until Client Services enters each order's), `created_at`, `shopify_line_item_id` (NULL, unique, S5). `set_sales_sale_account_key (id, account_id)`, the target of `orders_set_sale_fkey`. Its id, set, release, account and creation never change. Written by `ordersForSetSale` (`services/set-sales.ts`, `set.sale`) in the transaction that confirms an entry (a draw's CONFIRMED, a LIVE PAY); read by the order's page, YOUR ORDERS (`set`), GROWTH and the CAMPAIGN tab's readout, the account's export (`setSales`). **Privacy:** a purchase, with the account. **Down** for 0057 refuses, naming the counts, while a set, a set's release, a set sale, a grouped return case or a release size given per piece (or past the 24th) exists; otherwise the schema of `0056` exactly.

### 5.139 `drop_addons`

Migration `0059_addons_one_system` (lot Q2, ADD-ONS ONE SYSTEM, D3; [API §16.19, §16.23](API.md#1623-the-live-releases-the-club-pages-live-releases-extension-of-the-contract)): **a release's pick**, the catalogue add-ons it offers at its purchase, in its order. `drop_id` (FK → `drops.id`), `addon_id` (FK → `addon_items.id`, `drop_addons_addon_idx`), `position` (`drop_addons_position_check`, 1–100: no other cap, N12); primary key `(drop_id, addon_id)` (each add-on once), `drop_addons_position_key` unique `(drop_id, position)`; both foreign keys `ON DELETE RESTRICT`; `drop_addons_immutable_identity` guards `drop_id` and `addon_id`. A LIVE RELEASE, its after-room (its own drop) and a draw each have their own rows; the salon has none. **It governs the purchase moments only** (a LIVE hold, an after-room's, a draw's place held): YOUR ORDERS never reads it, offering every add-on by its ORDERS switch alone, on every order until packing whatever its release (N8). Written by `writePick` (`services/addons.ts`) from `LiveConsoleService` and `DropService` (`addonIds`: replaced whole, positions 1 to n, each add-on active, its moment's switch on and priced in the release's currency; a new release's default, N7), until it ends (a LIVE RELEASE and its after-room: `ended_at`; after the announcement by `PUT /api/admin/live/:id/addons`) or until its place-held window closes (a draw), never locked at the announcement or the publication (the review of lot Q2); by `0060` for the releases not ended. Read by the ONE OFFER RULE (`addonOffer`), the console's release pages (`addonPick`) and Catalogue → Add-ons' `releases`. No personal data.

### 5.140 `addon_conversions`

Migration `0060_release_addons_converted` (lot Q2, D5, N4, N6; [API §16.47](API.md#1647-add-ons-the-catalogue-and-their-stock-extension-of-the-contract)): **the record of what was converted** into catalogue add-ons, one row per release add-on (`live_addons`, §5.41) and one per currency of Orders → Settings' engraving price (`engraving_prices`, §5.89). `id` (PK), `source` (`addon_conversions_source_check`: `LIVE_ADDON` or `ENGRAVING_PRICES`, `ADDON_CONVERSION_SOURCES`), `source_id` (NULL; the old `live_addons.id`, unique `addon_conversions_source_key`), `drop_id` (NULL; FK → `drops.id`, its release, `addon_conversions_drop_idx`), `addon_id` (FK → `addon_items.id`, the add-on it became, `addon_conversions_addon_idx`), `currency` (NULL; `^[A-Z]{3}$`: its release's currency, or the settings' house currency) and `price_minor` (NULL; 0–100 000 000: the price it gave its add-on in that currency, NULL when it gave none: a currency the house does not sell in, or a newer release's or the settings' price taken instead), `converted_at`. `addon_conversions_source_fields`: a `LIVE_ADDON` names its source and release, an `ENGRAVING_PRICES` neither and always its currency; `addon_conversions_price`: a price only in a house currency. Both foreign keys `ON DELETE RESTRICT`; `addon_conversions_immutable` refuses any change. Written once, by `0060`; a release's rows deleted only with the release itself (an after-room taken away while a DRAFT, `LiveConsoleService`). Read by Catalogue → Add-ons (`convertedFrom`: *Converted from the add-ons of …*, *Converted from Orders → Settings, Engraving*) and by `0060`'s down step, which refuses while a row exists. No personal data.

**The conversion** (`0060`, one transaction, in this order): (1) refused, naming the count, while a release add-on is chosen on an entry in TURN or SECURED; (2) `addon_conversions` created; (3) each distinct label (`upper(btrim(label))`) of `live_addons` becomes one catalogue add-on: the one already of that name whatever the case (its kind, line, switches and prices kept, only the currencies it lacks filled), or a new **service**, its name and line from its newest release (by `opens_at`), after the last, active, `offer_live` alone, the engraving when its label holds the word ENGRAVING and it is the newest such label, its SKU `ADD-<LABEL WORDS>` (64 characters at most, `-2`, `-3`… until free), no supplier, no weight; (4) its price in each house currency the newest release's offering it in that currency; (5) the settings' engraving prices become the engraving add-on's (winning in their currencies) with `offer_orders` true, a new service `ENGRAVING` (`ADD-ENGRAVING`, YOUR ORDERS only) when none was converted; (6) every release not ended and not cancelled gets its pick (§5.139): the active add-ons of lot M3 first, then its converted ones in their old order, only those it may hold (active, its moment's switch on, priced in its house currency); one that already has a pick keeps it and gains its converted ones after it; an ended release none (YOUR ORDERS follows its switch alone, N8); (7) the remaining `live_entry_addons` rows are deleted, then `live_entry_addons`, `live_addons` and `engraving_prices` dropped. `orders.addons` and `orders.engraving_minor` / `engraving_by` stay as history (N15).

### 5.141 `vault_sources`

Migration `0061_the_vault` (lot Q3, THE VAULT, D3, D27; OP-29 "i must be able to configure all that as i want"; [API §16.50](API.md#1650-the-vault-club--the-vault-extension-of-the-contract)): **the seven occasions a vault is given on and their limits**, one row per source, inserted by the migration. `source` (PK; `vault_sources_source_check`: `LIVE`, `PIECE`, `TIER`, `WORN`, `FRIEND`, `PROFILE`, `HOUSE`, `VAULT_SOURCES`), `enabled` (`boolean`, NOT NULL, default `true`), `per_occasion` (`smallint`, NOT NULL, default 1; `vault_sources_per_occasion_check`, 1–10, `VAULT_PER_OCCASION`: the vaults one occasion gives), `cap` (`smallint`, NULL; `vault_sources_cap_check`, 1–100, `VAULT_CAP`: the occasions an account receives per the source's scope, LIVE per release, PIECE per piece, TIER per tier, WORN per piece, FRIEND per friend, PROFILE ever; NULL no cap), `updated_by` (NULL, FK → `admin_users.id`, `vault_sources_updated_by_idx`), `updated_at`. **`vault_sources_house_cap`:** `CHECK (source <> 'HOUSE' OR cap IS NULL)`: each gift of the house is its own occasion. The defaults inserted are OP-29's: every source on, 1 vault per occasion, a cap of 1, THE HOUSE none. A LIVE RELEASE also needs its own switch (`drops.vault_on`, §5.29). Triggers: `vault_sources_touch_updated_at`, `vault_sources_immutable_identity` (`source`), `vault_sources_no_delete` (*a vault source is switched off, never deleted*). Written by `VaultService.setSource` (`PUT /api/admin/vault/sources/:source`, ADMIN, audited `vault.settings` with the values before and after). Read by `giveVault` (§5.143), THE VAULT page's ledger (a source switched off is hidden, N21), the packing checklist (THE VAULT CARD only while PIECE is on) and the console. No personal data. The terms say a LIVE RELEASE gives at most one vault per account: the LIVE row's `per_occasion` and `cap` stay 1 unless that sentence changes first.

### 5.142 `vault_rewards`

Migration `0061_the_vault` (D1 "ONE vault, ONE house table for every source", D2, D19, D25, D28, D64; API §16.50): **the one house table** every vault is drawn from.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `kind` | `text` | NOT NULL | — | `vault_rewards_kind_check`: `CREDIT`, `ADDON`, `GUARANTEED`, `PRODUCT`, `VAULT_EDITION`, `THE_PIECE`, `CREDIT_TO_GIVE`, `I_WAS_THERE` (`VAULT_REWARD_KINDS`); never an access, status or service reward (D64). Never changes. |
| `odds_in` | `integer` | NULL | — | "1 IN N", `vault_rewards_odds_in_check` 1–1 000 000 (`VAULT_ODDS_IN_MAX`); the row holds round(1 000 000 / N) of the draw's 1 000 000 parts. |
| `quantity` | `integer` | NULL | — | The limit (OP-26: "each reward's quantity is the limit"), ≥ 0. |
| `given` | `integer` | NOT NULL | `0` | How many it gave; `vault_rewards_given_limit`: never above `quantity`. |
| `amount_minor`, `currency` | `integer`, `text` | NULL | — | A CREDIT's or a CREDIT_TO_GIVE's amount (1–100 000 000) and currency (`^[A-Z]{3}$`), only on them (`vault_rewards_amount`). |
| `model_id` | `uuid` | NULL | — | FK → `models.id` (`vault_rewards_model_idx`): a VAULT_EDITION's model (marked `vault_only`), or a PRODUCT that is a piece (never a vault-only model). |
| `addon_id` | `uuid` | NULL | — | FK → `addon_items.id` (`vault_rewards_addon_idx`): an ADDON, or a PRODUCT that is an add-on; of kind PRODUCT only (the trigger `vault_rewards_addon_product`, *a service cannot be a vault's reward*, E7). A PRODUCT names exactly one of `model_id` and `addon_id` (`vault_rewards_product`). |
| `mode` | `text` | NULL | — | `FREE` or `RIGHT_TO_BUY` (`VAULT_REWARD_MODES`), on a PRODUCT and only there (`vault_rewards_mode`); VAULT_EDITION and THE_PIECE are free by rule. |
| `line` | `text` | NULL | — | Staff's words under a VAULT_EDITION's name at the reveal, 1–120 characters, trimmed, no control character; on a VAULT_EDITION only (`vault_rewards_line`). |
| `active` | `boolean` | NOT NULL | `true` | An inactive row is never drawn; the vaults it gave keep what they held. |
| `position` | `smallint` | NOT NULL | `0` | The table's order (0–10 000), the draw's too. |
| `created_by`, `updated_by` | `uuid` | NULL | — | FK → `admin_users.id`; `created_by` never changes. |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **The floor** (D2: "Never empty: the I WAS THERE card is the floor"): **`vault_rewards_floor`**, `odds_in` and `quantity` NULL exactly on I_WAS_THERE (it never runs out; its odds are the rest of the table's, `floorOddsIn`); one such row, inserted by the migration (**`vault_rewards_floor_key`**, unique on `kind` where I_WAS_THERE), never inactive (**`vault_rewards_floor_active`**). **`vault_rewards_kept`**: the floor and a row given once are never deleted, only made inactive.
- **The sum of the odds** (N15): the active rows' parts never exceed the draw's 1 000 000, checked by the service at each save under the floor row's lock (`409 VAULT_ODDS_OVER`; a CHECK cannot read other rows).
- **Written by:** `VaultService.createReward`, `updateReward`, `deactivateReward`, `orderRewards` (`POST`/`PUT /api/admin/vault/rewards…`, OPERATOR; audited `vault.reward.create`, `.update`, `.deactivate`, `.order`), each under the floor row's lock then the other rows' by id, the same order as an opening; and `given` + 1 by the opening (§5.143). **Read by** the opening, CLUB > THE VAULT and its report (`quantity`, `given`, left). **Never sent to a collector**: no reply of `/api/v1/…` carries a row, its odds or its quantity (D22 "odds table on any page" not chosen); a collector reads only the odds of the reward a vault gave. No personal data. Production starts with the floor alone; the owner fills the table after the deployment (OP-27).

### 5.143 `vaults`

Migration `0061_the_vault`, extended by `0062_vault_rewards` (D1, D3, D5, D17, D19 to D21; API §10.32): **each vault given**, one row per vault.

| Column | Type | Null | Default | Constraints / notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `account_id` | `uuid` | NOT NULL | — | FK → `accounts.id`: its collector. |
| `source` | `text` | NOT NULL | — | `vaults_source_check`, one of the seven of §5.141. |
| `drop_id`, `entry_id` | `uuid` | NULL | — | LIVE: the release (FK → `drops.id`) and the entry still in the line when its size sold out (FK → `live_entries.id`). |
| `product_id` | `uuid` | NULL | — | PIECE: the piece registered; WORN: the piece of the photograph (FK → `products.id`). |
| `tier` | `smallint` | NULL | — | TIER: the tier reached, 1 to 3 (TITANE, PLATINE, PALLADIUM; `vaults_tier_check`). |
| `worn_photo_id` | `uuid` | NULL | — | WORN: the photograph published (FK → `worn_photos.id`). |
| `friend_account_id` | `uuid` | NULL | — | FRIEND: the friend whose first piece was registered (FK → `accounts.id`), never the account itself. |
| `given_by`, `segment_id`, `note` | `uuid`, `uuid`, `text` | NULL | — | HOUSE: the staff member who gave it (FK → `admin_users.id`, required), the segment of a segment's gift (FK → `segments.id`), and the note for Client Services (1–500 characters, trimmed, `vaults_note_check`; never shown to the collector, never audited). |
| `occasion_key` | `text` | NOT NULL | — | The occasion as the caps count it: `LIVE:<drop>`, `PIECE:<product>`, `TIER:<n>`, `WORN:<product>`, `FRIEND:<account>`, `PROFILE`, `HOUSE:<the gift's uuid>`. |
| `occasion_index` | `smallint` | NOT NULL | — | 1–1 000 (`VAULT_OCCASION_INDEX_MAX`, 10 per occasion × a cap of 100): the vault's place among its occasion's. |
| `given_at`, `waits_until` | `timestamptz` | NOT NULL | `now()`, — | **`vaults_waits`:** `waits_until = given_at + interval '720 hours'`, 30 days of 24 hours (D17), so a change of summer time never moves it. |
| `opened_at` | `timestamptz` | NULL | — | When it was opened. |
| `revoked_at`, `revoked_reason` | `timestamptz`, `text` | NULL | — | Both or neither, `RETURNED` only, on a PIECE vault only (**`vaults_revoked`**), never on an opened one (**`vaults_opened_or_revoked`**): round 5's "A RETURNED PIECE TAKES ITS VAULT BACK" (D5) is the only taking-back; no manual revoke exists (N36). |
| `reward_id`, `reward_kind` | `uuid`, `text` | NULL | — | The table's row drawn (FK → `vault_rewards.id`) and its kind. |
| `prize`, `prize_line` | `text` | NULL | — | The reveal's large words (≤ 40, `€25`, `I WAS THERE`) and its line (≤ 160). |
| `odds_text` | `text` | NULL | — | Its published odds, `^1 IN [1-9][0-9]{0,6}$` (`1 IN 200`; the card's when the card was given). |
| `rare` | `boolean` | NULL | — | GUARANTEED, VAULT EDITION, THE PIECE (N14). |
| `value_minor`, `currency`, `cost_minor` | `integer`, `text`, `integer` | NULL | — | Its value and its cost to the house, for the report (N29): a credit's face value; a piece or an add-on given free at its supplier unit price when known. |
| `grant_id`, `order_id`, `guarantee_id` | `uuid` | NULL | — | What it gave, each set once: its VAULT credit (FK → `tier_grants.id`), its VAULT order (FK → `orders.id`), its LIVE guarantee (FK → `house_guarantees.id`). |
| `gift_id` | `uuid` | NULL | — | Since `0062`: its credit to give (FK → `vault_gifts.id`, `vaults_gift_idx`), set once. |
| `offer_until`, `offer_used_at` | `timestamptz` | NULL | — | Since `0062` (**`vaults_offer`**): an ADDON's or a PRODUCT's offer, written with the outcome after the opening (a RIGHT TO BUY's 24 hours, a free add-on's 30 days to be used on an order), and when it was used (within it, once). |

- **Constraints.** **`vaults_occasion`**: each source names its own occasion columns and no other, and `occasion_key` matches them. **`vaults_occasion_key`**, unique `(account_id, occasion_key, occasion_index) WHERE revoked_at IS NULL`: two passes, a retry or two processes never give one vault twice, and a vault revoked can be given again. **`vaults_outcome`** (rebuilt by `0062`): an unopened vault has no outcome, no link, no gift and no offer; an opened one its row, kind, prize, odds and rarity.
- **Immutability.** **`vaults_immutable_identity`**: its account, source, occasion, note, key, index, `given_at` and `waits_until` never change. **`vaults_segment`**: `segment_id` is only ever cleared (a segment deleted after its gift: `SegmentService` clears it first, as a sent house message's). **`orbes_vaults_guard`** (`vaults_guard`): the outcome (with `offer_until` since `0062`) is written once, at the opening (*a vault's outcome is written once, at its opening*); a vault taken back stays taken back; what it gave is linked once; its offer is used once. **`vaults_no_delete`**: *a vault is revoked, never deleted*.
- **Its states**, computed, never stored (`vaultState`): REVOKED, OPENED, WAITING before `waits_until`, EXPIRED after (N27: in no collector list, kept in the console's).
- **Indexes:** `vaults_account_idx (account_id, opened_at, waits_until)` (THE VAULT page and its quiet number), and one per foreign key.
- **Written by:** `giveVault` (`services/vault.ts`), in the transaction of the occasion, after its own writes: nothing when the source is off (a LIVE RELEASE also its `vault_on`), the account is not ACTIVE, the account is a test entrant (D9, every source, THE HOUSE's included) or the cap is reached; the account's row taken `FOR KEY SHARE` first; `per_occasion` rows inserted at the lowest free indexes, `ON CONFLICT DO NOTHING`; the arrival delivered (§5.127); audited `vault.give` (never a note). Its callers: `giveLiveVaults` (the PAY that sells a size out, LIVE), `giveFirstRegistrationVaults` (PIECE and FRIEND), `giveTierVaults` (TIER, after each `ensureGrants`), `WornService` at a publication (WORN), `giveProfileVault` (PROFILE, a save that completes the profile), `giveFromHouse` (HOUSE, GIVE A VAULT, in batches of 500). `VaultService.open` writes the outcome (its row `FOR UPDATE`, §8.2) and `revokeReturnedPieceVaults` a returned piece's taking-back (audited `vault.revoke`, the system as actor). `0061`'s down step refuses while a vault exists.
- **Read by:** THE VAULT page, its summary and the LIVE door (the account's own only), YOUR ORDERS (a VAULT order, a right to buy), the console's client sheet (read-only, every state), CLUB > THE VAULT's report and a LIVE RELEASE's report (vaults given and opened), the account's export (API §16.13 `vaults`: its occasion, dates, state and what it held). **Privacy:** what a collector was given and what it held, kept with the account and given in its copy of its data; THE HOUSE's note and who gave it are staff's, for Client Services alone, never exported.

### 5.144 `vault_occasions_before`

Migration `0061_the_vault` (D68 "Sources give from the deployment on", N7, N34): `account_id` (FK → `accounts.id`) and `occasion_key` (`TIER:1`, `TIER:2`, `TIER:3`), primary key both. **Written once by `0061`'s up step**, never after: for each account, whatever its status, a row per tier it held at the migration, its pieces counted as `clubCounts` counts them (open ownerships, without the club's excluded statuses REVOKED, COUNTERFEIT_FLAGGED and RETIRED, with the REPLACEMENT exception), against the thresholds 1 / 5 / 10 (`CLUB_TIER_THRESHOLDS`); test entrants left out. **Read by the TIER source only**: a key here is a tier reached before the deployment, which gives no vault. Never shown. Dropped by `0061`'s down step with the rest.

### 5.145 `invitations`

Migration `0061_the_vault` (A FRIEND, N10; API §10.32): **a collector's personal invitation link**. `account_id` (PK, FK → `accounts.id`: the inviter, one link each), `code` (`invitations_code_check`: 12 characters of Crockford's base32, `INVITATION_CODE_PATTERN`; unique `invitations_code_key`), `created_at`. Made at the first INVITE A FRIEND (`VaultService.invitation`, `POST /api/v1/account/vaults/invite`) and the same ever after; never changed (`invitations_immutable`) nor deleted (`invitations_no_delete`, *an invitation link is made once*). The link `/verify/join/<code>` names nobody; a sign-up that carries its code sets `accounts.invited_by` (§5.9). The account's export gives its code and creation (API §16.13 `invitation`). `0061`'s down step refuses while one exists.

### 5.146 `vault_gifts`

Migration `0062_vault_rewards` (CREDIT TO GIVE, N10; API §10.32): **a credit to give**, made when a vault gives one. `id` (PK), `vault_id` (FK → `vaults.id`, unique `vault_gifts_vault_key`: one per vault), `code_hash` (`bytea`, 32 bytes, `vault_gifts_code_hash_check`, unique `vault_gifts_code_hash_key`): the HMAC-SHA256 of the one-time code under a key derived from `COOKIE_SECRET` (`orbes/vault-gift/v1`), **the code itself never stored** (the server derives it again from the vault's id to show it to its owner); `amount_minor` (1–100 000 000) and `currency`; `created_at` and `expires_at` = `created_at` + 30 days of 24 hours (**`vault_gifts_expiry`**); `accepted_by` (FK → `accounts.id`, `vault_gifts_accepted_by_idx`), `accepted_at` and `grant_id` (FK → `tier_grants.id`, unique `vault_gifts_grant_key`: the friend's VAULT credit), all three or none and `accepted_at` not before `created_at` (**`vault_gifts_accepted`**), set once (`vault_gifts_accepted_once`). Its identity never changes (`vault_gifts_immutable_identity`); never deleted (`vault_gifts_no_delete`). Accepted only by another ACTIVE account that holds no piece, within its 30 days (`VaultService.acceptGift`, `409 VAULT_GIFT_NOT_FOR_YOU`, `VAULT_GIFT_ENDED`); accepting writes nothing else, never `accounts.invited_by`. The giver's and the friend's exports each give it (API §16.13 `vaultGifts`: amount, state, dates), never the other account. Rotating `COOKIE_SECRET` ends every credit to give not yet accepted, as it ends the transfer codes. `0062`'s down step refuses while one exists.

**The down steps.** `0062` refuses, naming the counts, while a VAULT credit, a VAULT order, a LIVE guarantee, a VAULT unit, a credit to give or a vault's offer exists; otherwise it restores `0061`'s guard and `vaults_outcome`, `0056`'s units' checks and guard, `0029`'s scopes and guard, `0037`'s channels and `orders_source`, `0057`'s order guard, `0048`'s grants' checks and `0045`'s guard: the schema of `0061` exactly. `0061` refuses, naming the counts, while a vault, an invitation, an invited account, a vault message, a reward other than the floor, a source's setting changed from its default, a release with its vault on or a vault-only model exists; otherwise it drops what it added, `vault_occasions_before` and its inserted rows included: the schema of `0060` exactly.

### 5.147 `currency_rates`

Migration `0063_margin` (lot M4, macro scope K43 N2 "euros, other currencies converted at a rate the owner sets per currency"; [API §16.51](API.md#1651-the-margin-and-its-settings-extension-of-the-contract)): **one euro rate per currency**, applied to every amount in that currency when the margin is read, the whole history included (one rate per currency, never dated). `currency` (PK, `text`, `currency_rates_currency_check` `^[A-Z]{3}$`; never `EUR`: **`currency_rates_not_eur`**, the euro is 1), `eur_rate` (`numeric(14,6)`, NOT NULL, `currency_rates_eur_rate_check` above 0 and at most 100 000, `CURRENCY_RATE_MAX`, six decimals, `CURRENCY_RATE_DECIMALS`: one unit of the currency is worth that many euros), `updated_by` (NULL, FK → `admin_users.id`, `currency_rates_updated_by_idx`), `updated_at`. Triggers: `currency_rates_immutable_key` (`currency`), `currency_rates_touch_updated_at`. A cleared rate is a deleted row: the currency's amounts are left out of the margin and named in its missing list. Written by `MarginSettingsService.setRate` and `clearRate` (`PUT` and `DELETE /api/admin/margin/rates/:currency`, ADMIN, audited `margin.rate`); read by the margin. No personal data.

### 5.148 `shipping_cost_rates`

Migration `0063_margin` (K43 N1 "outbound shipping from a rate table the owner configures per country × weight band … There is no real carrier cost entered at shipping."): **what ORBES pays the carrier for a parcel**, by its country and weight; never a price charged to a buyer (that is `shipping_rates`, §5.65). `id` (PK, `uuid`), `country` (`char(2)`, NULL, `shipping_cost_rates_country_check` `^[A-Z]{2}$`; NULL: ALL OTHER COUNTRIES), `max_weight_g` (`integer`, NOT NULL, `shipping_cost_rates_max_weight_g_check` 1–100 000 g, `SHIPMENT_WEIGHT_G_MAX`: the band's upper limit), `cost_minor` (`bigint`, 0–100 000 000, `MARGIN_COST_MINOR_MAX`) and `currency` (`^[A-Z]{3}$`), `updated_by`, `updated_at`. **`shipping_cost_rates_band_key`:** unique `((coalesce(country, '*')), max_weight_g)`: one band per country and limit, ALL OTHER COUNTRIES once per limit too (`409 SHIPPING_COST_TAKEN`). Triggers: `shipping_cost_rates_immutable_key` (`id`), `shipping_cost_rates_touch_updated_at`. A parcel takes the smallest band of its country that holds its weight, else of ALL OTHER COUNTRIES (`services/margin.ts` `rateFor`); a parcel no band holds is counted 0 and named. Written by `MarginSettingsService.addShippingCost`, `updateShippingCost` and `removeShippingCost` (ADMIN, audited `margin.shipping_cost.create`, `.update`, `.delete`); the same table costs every parcel the platform packs, a future Shopify store's included (S3). No personal data.

### 5.149 `margin_unit_costs`

Migration `0063_margin` (K43 N1 "plus pouch and card", "a cost per service and per claim outcome"; D61 for THE VAULT CARD): **the owner's unit costs**, each by its key. `key` (PK, `margin_unit_costs_key_check`: `POUCH`, `CARD`, `VAULT_CARD`, `CARE_SERVICE`, `CLAIM_REPLACEMENT`, `CLAIM_VALUE_CREDIT`, `CLAIM_PART_CREDIT`, `CLAIM_REPAIR`, `CLAIM_PRICE_REDUCTION`, `CLAIM_REFUND`, `CLAIM_REFUSED`, `MARGIN_UNIT_COST_KEYS`, one `CLAIM_` key per warranty claim outcome of `0048`, held equal by `test/db/schema.test.ts`), `cost_minor` (0–100 000 000) and `currency`, `updated_by`, `updated_at`. Triggers: `margin_unit_costs_immutable_key` (`key`), `margin_unit_costs_touch_updated_at`. The POUCH and the CARD are counted per piece, THE VAULT CARD per card packed (THE VAULT's cost), a care service per PRIVATE CARE request done, a claim outcome per claim decided. Written by `MarginSettingsService.setUnitCost` and `clearUnitCost` (ADMIN, audited `margin.unit_cost`). No personal data.

### 5.150 `category_allowances`

Migration `0063_margin` (K43 N1 "a returns and claims allowance, as a % per category set by the owner"): `category_id` (PK, FK → `categories.id` `ON DELETE RESTRICT`), `allowance_bp` (`integer`, `category_allowances_allowance_bp_check` 0–10 000, `ALLOWANCE_BP_MAX`: hundredths of a percent of an order's revenue, 12.5 % is 1250), `updated_by`, `updated_at`. Triggers: `category_allowances_immutable_key` (`category_id`), `category_allowances_touch_updated_at`. A category without one is counted 0 and named. Written by `MarginSettingsService.setAllowance` and `clearAllowance` (ADMIN, `404 CATEGORY_NOT_FOUND`, audited `margin.allowance`). No personal data.

**No row is inserted by `0063`**: nothing is pre-filled, an absent row reads as not set, and the margin lists what is missing. Each table records who changed a row last and when; its key never changes. **Nothing of the margin itself is stored**: `MarginService` reads the costs where the house holds them (`supplier_order_lines.unit_price_minor` and `supplier_orders.shipping_minor`, `boxes.cost_minor`, `shipments.box_id` and `weight_g`, the parcel's stored checklist for THE VAULT CARD, `credit_uses` and `tier_grants`, the invoices and credit notes) in one REPEATABLE READ, READ ONLY transaction, with no snapshot and no cache.

### 5.151 `partners`

Migration `0064_partners` (lot M4, macro scope K49 P1 "partner record: brand, contact, amount, paid date"; [API §16.52](API.md#1652-partners-their-experiences-and-their-invoices-extension-of-the-contract)): **a brand that pays ORBES for an experience offered to the circle.** `id` (PK, `uuid`), `brand` (1–80 characters, one line, trimmed, `partners_brand_check`, `PARTNER_BRAND_MAX`; unique whatever the case, **`partners_brand_key`** on `lower(brand)`: `409 PARTNER_BRAND_TAKEN`), as the circle's invitation shows it (WITH <BRAND>); its contact `contact_name` (≤ 120, one line), `contact_email` (3–254, trimmed), `contact_phone` (≤ 40, one line), each NULL when unknown; its billing details as its invoices print them, `billing_name` (≤ 120, one line), `billing_address` (≤ 1 000, line breaks kept), `billing_country` (`char(2)`, `^[A-Z]{2}$`), `company_number` (≤ 60, one line; printed when given); `note` (≤ 2 000, line breaks kept); `active` (`boolean`, NOT NULL, default `true`; false: SET ASIDE, offered for no new experience); `created_at`, `created_by` (NULL, FK → `admin_users.id`, `partners_created_by_idx`), `updated_at`. Triggers: `partners_immutable_identity` (`id`, `created_at`, `created_by`), `partners_touch_updated_at`, `partners_no_delete` and `partners_no_truncate` (*partners are set aside, never deleted*). Written by `PartnerService` (OPERATOR, audited `partner.create`, `.update`, `.set_aside`, `.reinstate`, whether a contact email, phone or note is written, never its content). The contact's email and phone are a business's contact, masked for an AUDITOR by the routes; no collector's data.

### 5.152 `partner_experiences`

Migration `0064_partners` (K49 P1): **one deal of a partner.** `id` (PK), `partner_id` (FK → `partners.id`, `partner_experiences_partner_idx` with `event_on`), `title` (1–120, one line), `event_on` (`date`: the event's day in Paris), `amount_minor` (`bigint`, 1–100 000 000, `PARTNER_AMOUNT_MINOR_MAX`: what the partner pays) and `currency` (`EUR`, `GBP`, `USD`, `CHF`), `note` (≤ 2 000); `status` (`partner_experiences_status_check`: `DRAFT`, `INVOICED`, `PAID`, `CANCELLED`, `PARTNER_EXPERIENCE_STATUSES`; default `DRAFT`) with `invoiced_at`, `paid_on` (`date`: the Paris day the money arrived, entered by ORBES), `paid_recorded_at`, `paid_recorded_by`, `cancelled_at`, `cancelled_by` (FKs → `admin_users.id`, each leading its index); `created_at`, `created_by`, `updated_at`. **`partner_experiences_status_times`:** each state with its own times only (a DRAFT none, an INVOICED its invoice time, a PAID its invoice time and paid day, a CANCELLED its cancellation and, when it had them, its invoice time and paid day); **`partner_experiences_paid`:** the payment recorded whole; **`partner_experiences_by`:** an author with its time; **`partner_experiences_times`:** the times in order. `partner_experiences_paid_on_idx (paid_on) WHERE paid_on IS NOT NULL` serves GROWTH's partner income. Triggers: `partner_experiences_immutable_identity` (`id`, `partner_id`, `created_at`, `created_by`), `partner_experiences_touch_updated_at`, `partner_experiences_no_delete` and `_no_truncate` (*partner experiences are cancelled, never deleted*). Its amount and currency change only while DRAFT. Written by `PartnerService` (`createExperience`, `updateExperience`: OPERATOR; `issueInvoice`, `recordPaid` with its correction: ADMIN; `cancel`: OPERATOR on a DRAFT, ADMIN on an INVOICED or PAID one), audited `partner.experience.create`, `.update`, `.invoice`, `.paid` (a correction with the previous day), `.cancel`; any other move `409 PARTNER_EXPERIENCE_STATE`. No personal data.

### 5.153 `partner_invoices`

Migration `0064_partners` (K49 P1 "An invoice issued by ORBES to the partner", P4 "partner invoices have their own numbering series (for example P-2026-0001)"): **the invoices ORBES issues to a partner and their credit notes**, apart from the collectors' (`invoices`, §5.55). `id` (PK), `kind` (`INVOICE` or `CREDIT_NOTE`, `PARTNER_INVOICE_KINDS`), `year` (2000–2099, the UTC year of issue) and `sequence` (1–999 999), **`partner_invoices_number_key`** unique `(kind, year, sequence)`: **P-2026-0001** and **PC-2026-0001**, numbered under `ADVISORY_LOCK.PARTNER_INVOICE_NUMBER` (§8.3); `experience_id` (FK → `partner_experiences.id`, `partner_invoices_experience_idx`; one INVOICE per experience, **`partner_invoices_one_per_experience`**, unique `(experience_id) WHERE kind = 'INVOICE'`); `credits_invoice_id` (NULL, FK → `partner_invoices.id`, unique `partner_invoices_credits_key`: a credit note names the invoice it cancels, once; with CREDIT_NOTE only, **`partner_invoices_credit`**); its content as issued: `issuer` (`jsonb` object: `INVOICE_ISSUER`, CONGLOMERAT LLC, at the time), `buyer` (`jsonb` object: the partner's billing details at the time), `lines` (`jsonb` array of one at least: *Partner experience · <title> · <date>*), `currency` and `total_minor` (1–100 000 000), without VAT (the house's rule); `issued_at` (`partner_invoices_issued_idx`: a month's documents, GROWTH's income), `issued_by` (the ADMIN; NULL for a script). **A partner invoice is never changed nor deleted** (`partner_invoices_immutable`, BEFORE UPDATE OR DELETE, and `partner_invoices_no_truncate`: *a partner invoice is never changed; a credit note follows it*, as `0022`'s `invoices_immutable`). Written by `PartnerService.issueInvoice` (ISSUE THE INVOICE; `409 PARTNER_BILLING_MISSING` without the billing name, address and country) and `cancel` (the PC- credit note of an invoiced or paid experience, in the same transaction); journaled `partner_invoice.issue` and `partner_invoice.credit` (the document without its buyer, as `invoice.issue`); read by Invoices → Partners, its CSV and each PDF. No collector's data.

**`0064` inserts no row**, and adds `circle_posts.partner_experience_id` (§5.31) and `circle_rsvps.share_name`, `share_name_at` (§5.33). On the previous image during the roll-out (Q3's), three tables and three columns it never reads: an answer it writes takes `share_name` false, an invitation it writes is linked to no experience.

### 5.154 `ads_settings`

Migration `0065_ad_conversions` (lot M4, macro scope K27 A1 "built and tested now, switched off until the owner starts paid ads. Switching it on is a console setting."; [API §16.53](API.md#1653-links--ad-platforms-the-server-side-conversions-extension-of-the-contract)): **the conversions' one switch and its settings**, one row (`id` 1, `ads_settings_id_check`), written at the console's first save, never by the migration: **no row reads as off**. `enabled` (`boolean`, NOT NULL, default `false`); `events_from` (`timestamptz`, NULL): set at the first switch on and **never moved after** (the trigger `ads_settings_events_from`, *conversions are sent from the first switch on, never earlier nor later*): no act before it is ever sent, no backfill; **`ads_settings_on`:** `CHECK (NOT enabled OR events_from IS NOT NULL)`; `switched_at` and `switched_by` (the ADMIN who switched it last, on or off; FK → `admin_users.id`, `ads_settings_switched_by_idx`), **`ads_settings_switched`** (an author with its time, a first switch with its time) and **`ads_settings_times`** (`switched_at >= events_from`); `meta_test_event_code` and `tiktok_test_event_code` (1–40 characters, one line, `ADS_TEST_EVENT_CODE_MAX`; NULL: none): each platform's test mode for SEND A TEST EVENT; `google_action_signup`, `google_action_draw_entry`, `google_action_live_entry`, `google_action_paid_order` (NULL, each `^customers/[0-9]{1,12}/conversionActions/[0-9]{1,20}$`, `ADS_GOOGLE_ACTION_PATTERN`): each act's Google Ads conversion action, an event without one SKIPPED as NOT_READY; `enqueued_until` (`timestamptz`, NULL): the watermark of `AdsService.enqueue`, the conversions written and the orders paid up to it judged, set to the switch's time at each switch on (nothing done while off is ever queued) and moved by each pass; `updated_by` (`ads_settings_updated_by_idx`), `updated_at` (`ads_settings_touch_updated_at`). **No key is stored here**: the platforms' keys live only in the server's `.env` (`ADS_*`). Written by `AdsService.setSwitch` (the typed phrase SWITCH ON / SWITCH OFF; `409 ADS_NO_PLATFORM` with no platform's keys; off cancels every QUEUED event), `setGoogleActions` and `setTestCodes` (ADMIN, audited `ads.switch`, `ads.google_actions`, `ads.test_codes`). No personal data.

### 5.155 `ads_channel_platforms`

Migration `0065_ad_conversions` (K27 A3; A2 "Meta (Conversions API), TikTok (Events API) and Google … Snapchat: no."): **a link channel mapped to a platform**, so an act whose last link is of that channel goes to it. `channel_id` (FK → `link_channels.id`, §5.106) and `platform` (`ads_channel_platforms_platform_check`: `META`, `TIKTOK`, `GOOGLE`, `ADS_PLATFORMS`), primary key both. No mapping by default. Written by `AdsService.setChannelPlatforms` (`PUT /api/admin/ads/channels/:channelId`, ADMIN, `404 CHANNEL_NOT_FOUND`, audited `ads.channels`); removed with its channel (`LinkService.deleteChannel`). No personal data.

### 5.156 `ad_consents`

Migration `0065_ad_conversions` (K27 A4 "sent only after the collector's consent"): **each advertising choice a collector makes, the proof of consent.** `id` (identity), `device_id` (NULL, FK → `tracking_devices.id`, `ad_consents_device_idx` with `chosen_at` descending: a choice made signed out), `account_id` (NULL, FK → `accounts.id`, `ad_consents_account_idx` with `chosen_at` descending), one at least (**`ad_consents_subject`**); `choice` (`GRANTED` or `DECLINED`, `AD_CONSENT_CHOICES`), `source` (`BANNER` or `ACCOUNT`, `AD_CONSENT_SOURCES`), `text_version` (`YYYY-MM-DD`: the advertising text's version shown, `ADS_TEXT_VERSION`), `user_agent` (1–400 characters, `AD_USER_AGENT_MAX`; **with a GRANTED choice only**, `ad_consents_user_agent`), `chosen_at`. **A choice is never changed** (`ad_consents_immutable`, *an advertising choice is never changed; a new choice is a new row*): the latest one counts; withdrawing is a new DECLINED row. Written by `AdsService.choose` (the banner's `POST /api/v1/consent`, YOUR PROFILE's `PUT /api/v1/account/ads-consent`; `409 ADS_OFF` while off; not audited: the row is the record) and `carry` (at a sign-up and a sign-in, inside `TrackingService.link`'s transaction: the device's choice made signed out becomes the account's, a new row at the time it was made, unless the account holds a newer one; on a shared device only the first account to sign in after it takes it, and a choice made signed in is never handed to the next account). Read at each act (the account's latest choice made at or before it, GRANTED only) and again at send time. **Personal data**: an account's choices are kept with the account (the proof of consent) and exported with it (API §16.13 `advertising.choices`); a device's choices made signed out are erased 13 months after they were made (§10).

### 5.157 `ad_clicks`

Migration `0065_ad_conversions` (K27 §3.3, the click ids read only with consent): **a platform's click id** read from the address the collector arrived by, **stored only with a GRANTED choice**. `id` (identity), `device_id` (NOT NULL, FK → `tracking_devices.id`), `account_id` (NULL, FK → `accounts.id`, `ad_clicks_account_idx`; it takes the account at a sign-up and a sign-in), `kind` (`FBCLID`, `TTCLID`, `GCLID`, `GBRAID`, `WBRAID`, `AD_CLICK_KINDS`), `click_id` (1–500 printable characters, no space, `AD_CLICK_ID_MAX`), `clicked_at`; **`ad_clicks_click_key`** unique `(device_id, kind, click_id)`. Trigger `ad_clicks_immutable_identity` (`id`, `device_id`, `kind`, `click_id`, `clicked_at`): only the account can change. A DECLINED choice erases the device's and the account's click ids at once. A click id counts for an act clicked at most 90 days before it (`AD_CLICK_WINDOW_DAYS`), and is erased 90 days after the click (`AD_CLICK_RETENTION_DAYS`, §10). **Personal data**: exported with the account (API §16.13 `advertising.clicks`: kind, time and the id itself).

### 5.158 `ad_events`

Migration `0065_ad_conversions` (K27 A3 "sign-up, draw entry, LIVE entry, paid order. Each is tied to its tracked link (`acquisition_conversions`), with no browser pixel."): **the outbox, one event per platform and act.** `id` (identity), `platform` (`META`, `TIKTOK`, `GOOGLE`), `conversion_id` (FK → `acquisition_conversions.id`, §5.111, `ad_events_conversion_idx`), `kind` (`SIGNUP`, `DRAW_ENTRY`, `LIVE_ENTRY`, `PAID_ORDER`, `AD_EVENT_KINDS`: an ORDER conversion once its order is paid), **`ad_events_key`** unique `(platform, conversion_id, kind)`: a pass repeated or overlapping never writes twice; `status` (`QUEUED`, `SENT`, `FAILED`, `SKIPPED`, `CANCELLED`, `AD_EVENT_STATUSES`; default `QUEUED`), `skip_reason` (`TOO_OLD`, `NO_CLICK_ID`, `NOT_READY`, `AD_SKIP_REASONS`) exactly on a SKIPPED one (**`ad_events_skipped`**), `attempts` (≥ 0), `not_before`, `last_error` (1–300 characters, `AD_EVENT_ERROR_MAX`, never a key; a FAILED one always has one: **`ad_events_failed`**), `created_at`, `sent_at` exactly when SENT (**`ad_events_sent`**), `settled_at` exactly when no longer QUEUED (**`ad_events_settled`**: the end the purge counts its 90 days from, as the emails' outbox does). **`ad_events_due`** `(status, not_before)` serves the sender. Trigger `ad_events_immutable_identity` (`id`, `platform`, `conversion_id`, `kind`, `created_at`). Written by `AdsService.enqueue` (the housekeeping's `adsEnqueue`, only while on: QUEUED, or SKIPPED with its reason), `sendDue` (the 30 s sender: SENT, retried after 1 min, 5 min, 30 min and 2 h, then FAILED; CANCELLED when the consent, the account or the switch no longer allows it at send time), `setSwitch` (off: every QUEUED one CANCELLED), `choose` (a DECLINED: the account's QUEUED ones CANCELLED) and `cancelAccountAdEvents` (a lock). Its event id at the platform is `orbes-<conversion id>`. Personal data through its conversion's account: exported with it (API §16.13 `advertising.events`: platform, kind, status, times), erased 90 days after it settled (`AD_EVENT_RETENTION_DAYS`, §10).

**`0065` inserts no row**; nothing of it is read, written or sent while the switch is off (the state at deployment). On the previous image during the roll-out (Q3's), five tables it never reads.

**The down steps of lot M4.** `0065` refuses, naming the counts, while the switch is on or an advertising choice, a click id or an ad event exists; otherwise it drops its five tables: the schema of `0064` exactly. `0064` refuses, naming the counts, while a partner, a partner experience, a partner invoice, an invitation linked to an experience or a name shared exists; otherwise it drops its three tables and three columns: the schema of `0063` exactly. `0063` refuses, naming the counts, while a currency rate, a shipping cost band, a unit cost or a category allowance exists; otherwise it drops its four tables: the schema of `0062` exactly.

### 5.159 `audit_purge_gaps`

Migration `0066_test_purge` (lot PURGE, the owner's answers of 27 October 2026, Claude's point 5: "The purge deletes a test's audit rows with tombstones (audit_purge_gaps) so the chain check still proves nothing else was removed."): **one tombstone per audit entry the test purge deleted.** `id` (`bigint` PK, `audit_purge_gaps_id_check` ≥ 1: the deleted entry's own id), `prev_hash` and `hash` (`bytea`, 32 bytes each, `audit_purge_gaps_prev_hash_check` and `audit_purge_gaps_hash_check`: the deleted entry's own), **`audit_purge_gaps_prev_hash_key`** unique `(prev_hash)` (as `audit_logs`', no fork), `run_id` (NULL, FK → `test_runs.id`, `audit_purge_gaps_run_idx`: the test whose purge deleted it; NULL for the pool's sweep), `purged_at` (`now()` by default).

- **Written by:** the purge's definer functions only (§5.74), in the same statement that deletes the entries (a data-modifying CTE: `DELETE … RETURNING id, prev_hash, hash` into the tombstones), so an entry never goes without its tombstone. `audit_purge_gaps_written_by_purge` (BEFORE INSERT, `orbes_require_superuser`, "audit_purge_gaps is written by the purge only"): the app's role can never write one; `audit_purge_gaps_append_only` (BEFORE UPDATE OR DELETE) and `audit_purge_gaps_no_truncate` (`orbes_reject_mutation`, "audit_purge_gaps is append-only"): never changed nor deleted, except by a platform reset (§5.160), which empties it with the log.
- **Read by:** `AuditService.verifyChain` (API §17.6): the chain is `audit_logs` and `audit_purge_gaps` merged in id order, each batch read in ONE statement (`… FROM audit_logs WHERE id > $cursor UNION ALL … FROM audit_purge_gaps WHERE id > $cursor ORDER BY id LIMIT $n`), so a purge committing between two batches is read consistently. A live entry is hashed again (§5.21); a tombstone's `prev_hash` must equal the running hash and its `hash` becomes the running hash, which the next entry must link to. **BROKEN**: a missing id with no tombstone (the next entry does not link), an id in both tables, a tombstone nothing links to after it (the newest entry deleted: the purge never deletes the log's newest entry). With no tombstone the walk and its verdict are those of the log alone; with some, the answer gains `purged`, their count.
- **Privacy:** none: ids and hashes only; the deleted entry's content is gone.

### 5.160 `platform_reset_gate`

Migration `0067_platform_reset` (lot PURGE, the owner's answers of 27 October 2026, answer 1 and Claude's points 3 and 4: the reset "from the console only … until LOCK RESET", "only his account can press it"): **the reset's one row, which only the database's owner writes.** `id` (`smallint` PK, `platform_reset_gate_id_check`: `id = 1`), `holder_admin_id` (NULL, FK → `admin_users.id`: **the reset holder**, the oldest active ADMIN with two-factor authentication when the migration ran at the deployment, NULL when there was none), `launched_at` and `launched_by` (FK → `admin_users.id`: **LOCK RESET**, `platform_reset_gate_launched`: both or neither), `last_reset_at`, `last_reset_by` (FK → `admin_users.id`), `resets` (`integer`, 0 by default, `platform_reset_gate_resets_check` ≥ 0) and `last_reset_details` (`jsonb` object: what the last reset captured before the wipe; `platform_reset_gate_last_reset`: the three set together exactly when `resets > 0`), `authorized_by` (FK → `admin_users.id`), `authorized_at` and `authorized_purpose` (`platform.reset` or `platform.reset.lock`, `platform_reset_gate_authorized`: all three or none): **the single-use authorization**. An index on each foreign key.

- **Written by:** the reset's SECURITY DEFINER functions only (§9.1, 0067). `platform_reset_gate_guard` (BEFORE INSERT, UPDATE or DELETE, `orbes_platform_reset_gate_guard`) refuses every write but a superuser's ("written by the reset functions only"), every DELETE ("the gate is one row, kept for good"), any change of `launched_at`, `launched_by` or `holder_admin_id` once LOCK RESET is pressed ("LOCK RESET is one way: the lock and the holder never change once it is pressed"), and `resets` going down; `platform_reset_gate_no_truncate`. The app's role reads it and writes nothing.
- **The authorization:** `orbes_platform_reset_authorize(admin, purpose)` writes it only in a transaction that itself inserted the holder's `admin.step_up` audit entry of that purpose and (for the reset) a `platform.reset.requested` entry, and updated the holder's `admin_users` row (each row's `xmin` is the transaction's own id), the holder active and the gate not locked; `orbes_platform_reset` and `orbes_platform_reset_lock` use it once, within 5 minutes and newer than the last reset (`RESET_AUTHORIZATION_MS`), and clear it (`RESET_NOT_AUTHORIZED` otherwise); `orbes_platform_reset_unauthorize()` clears it (a failed reset's own transaction calls it).
- **A wrong holder** is fixed forward: disable that login on the Team page at once (every reset function requires an ACTIVE holder: `RESET_NO_HOLDER`), then a later migration. No email is written anywhere in the repository; the deployment's check prints the holder's read only.
- **Read by:** the console's Platform reset page (API §16.55), the holder only (`PlatformResetService.state`, `isHolder`), and the step-up's 24-hour rules across a reset (entry 1 of the log, below).

### 5.161 `platform_reset_plan`

Migration `0067_platform_reset`: **every table of the schema with its class in the reset**, `tbl` (`text` PK, `platform_reset_plan_tbl_check`) and `kind` (`KEEP`, `PARTLY` or `WIPE`, `platform_reset_plan_kind_check`), written by the migration only (`platform_reset_plan_superuser`, `orbes_require_superuser`, "the reset's plan is written by the migrations only"; `platform_reset_plan_no_truncate`). It equals `db/reset-plan.ts` `RESET_PLAN` (`test/db/reset-plan.test.ts`): **KEEP 40** (the catalogue, the settings, the console logins and their locations, the signing keys, the migrations' own tables, the boxes, the add-ons and the sets, THE VAULT's sources, the margin's and the ads' settings, this table and `purge_delete_tables`), **PARTLY 8** (each by its rule, `RESET_PARTLY_RULES`: `media_objects` only what a kept model or a lookbook uses; `revocations` the KEY ones; `segments` but those naming a release or a link that goes; `vault_rewards` with `given` back to 0; `preregistrations`, the founding list, with `account_id` and `matched_at` cleared; `acquisition_sources` the ones the founding list names; `links` the ones those sources name, a link to a release now leading to the releases page; `platform_reset_gate` by the rule of §5.160), **WIPE 116** (every other table, the audit log and its tombstones included): 164 tables. **The reset reads its plan here; the app never passes one**, and a table missing from it, or a table of it missing from the schema, refuses the reset (`RESET_UNPLANNED_TABLES`). A later migration adding a table fails CI until both plans class it.

### 5.162 `purge_delete_tables`

Migration `0066_test_purge`: **the purge's accounts step, its list**: every table referencing `accounts` whose rows belong to the account itself (`tbl`, `col`, PK `(tbl, col)`; `ord` unique, children first: `account_sizes`, `account_profiles`, `email_preferences`, `account_scores`, `collector_history`, `collector_places`, `collector_view_months`, `collector_view_totals`, `tier_grants`, `test_entrants`), written by the migration only (`purge_delete_tables_superuser`, `orbes_require_superuser`; `purge_delete_tables_no_truncate`); equal to `db/purge-plan.ts` `PURGE_DELETE_TABLES` (`test/db/migrations-0066.test.ts`), and KEEP in the reset's plan. **Every other referencing column keeps the account** (BLOCK): a column is DELETE only when it is the row's own owner column, so `accounts.invited_by` (a real account invited by a test one) and `vaults.friend_account_id` are BLOCK, as are by name the founding list (`preregistrations`), the addresses, the advertising choices and the messages to ORBES Client Services. `orbes_purge_plan()` lists every foreign key the purge meets (into `accounts`, `orders`, `drop_entries`, `live_entries`, `live_interest`, `order_addon_items`, `set_sales`, `test_entrants`, `tier_grants`) with its class (`PURGE_REFERENCES`); `test/db/migrations-0066.test.ts` walks `pg_constraint` and fails on any foreign key the plan does not class.

**The down steps of lot PURGE.** `0067` refuses once a reset was done or LOCK RESET pressed ("cannot be rolled back: % platform resets done and LOCK RESET %"); otherwise it puts back 0066's `orbes_reject_mutation` exactly and drops its five functions, the gate and the plan: the schema of `0066` exactly. `0066` refuses while a tombstone or a test purge exists, naming the counts ("cannot be rolled back: % audit tombstones and % test purges exist": dropping the tombstones would leave the chain BROKEN); otherwise it puts back 0001's `orbes_reject_mutation` exactly and drops its columns, tables and functions: the schema of `0065` exactly.

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

### 6.1 The `stock_holds` view

Migration `0056_addons` (lot M3, macro scope K48 D1): what is held in stock, from one source. `(sku_id, location_id, reservation, reserved_at, kind, id)`: the orders' holds (`orders.reservation` STOCK or AWAITING, `kind` PIECE, the order's id) `UNION ALL` the add-on units HELD (§5.133, as STOCK, `kind` ADD_ON, the unit's id, since its addition). Every count of what is reserved reads it: `stockLevel` and `stockBalances` (available = on hand less what is held, never below 0), Logistics' reserved and waiting, the supplier orders' proposal, the release stock's supply and the declared sizes' awaiting count. The previous image (0055) never reads it. Re-created by migration `0059_addons_one_system` (lot Q2, D4) with `AND u.location_id IS NOT NULL` on its add-on half: a service's unit, held nowhere, never holds stock.

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
| `accounts … FOR UPDATE`, then `care_requests` | PRIVATE CARE asked for or cancelled by the collector (§5.68, BP-19 T6): the account first, then the piece `FOR UPDATE` (so a warranty claim opened at the same moment waits and sees it, plan ORBES CARE), then the year's requests counted (two requests at once by a PLATINE account: one wins). |
| `care_requests … FOR UPDATE`, then `products` | A step of PRIVATE CARE in the console (§5.68): the request, then the piece through `WarrantyService` (its service record), in one transaction. |
| `models … FOR UPDATE`, then `warranties` | A model's warranty changed (§5.3, plan ORBES CARE, `CatalogService.setWarranty`): the model, then its pieces' warranties rewritten. An issuance and an activation read the model's choice `FOR SHARE` first, then the warranty row, so a switch never leaves a piece on the old kind and never deadlocks. |
| `client_conversations … FOR SHARE`, then `products … FOR UPDATE`, then `warranty_claims` | A warranty claim opened (§5.119): the conversation, then the piece, then its live claims, care requests and transfer offers read. Every later step: the claim `FOR UPDATE`, then its piece, then the replacement; two decisions at once: the second sees DECIDED (`409 CLAIM_STEP`), one grant at most. A decision that revokes the piece (REPLACEMENT, VALUE_CREDIT, REFUND) reads its model `FOR SHARE` right after the piece and before its first audit entry, as an activation does, so a model's warranty changed at the same moment waits on the model instead of holding the piece's warranty, which the decision voids after the audit chain's lock. |
| `tier_grants … FOR UPDATE` (the credit) | APPLY CREDIT (§5.67, plan NEXT-NINE, BP-19 T5), after the order's row: the account's CREDIT grants (and its BIRTHDAY grants since plan CUSTOMER INTELLIGENCE §3.5 SB.4.3, the birthday credit's first), so two applications at once never take more than a grant's balance. |
| `accounts … FOR UPDATE`, then `tier_grants` (the birthday credit) | The daily grant of a birthday credit (§5.66, plan CUSTOMER INTELLIGENCE §3.5 SB.4.4), one account per transaction: its row first, every rule read again under it (a profile save takes the same row `FOR NO KEY UPDATE`, so a date of birth changed meanwhile is seen), then the grant inserted (`tier_grants_birthday_key` the last guard), the audit last. |
| `tier_grants … FOR UPDATE` (the welcome gift) | A sale's welcome gift (`attachGifts`, §5.66), after the sale's rows and its order's: the account's GIFT grants, then their open GIFT orders read again, so two sales at once never give one grant two gifts. |
| `segments … FOR KEY SHARE` | A release's or a post's segment chosen (§5.58): a deletion under way finishes first, then refuses the release or the post, or waits for it and is refused (`409 SEGMENT_IN_USE`). Since lot M1, a draw's too. |
| `drops … FOR UPDATE` (the pace) | SET PACE, PAUSE PACE, RESUME PACE and NEXT BATCH NOW (lot M1, §5.29), like every console control of a LIVE RELEASE, and the engine's batches in `advance`: the batches due are admitted first, at their logical times, then the change; two controls and the engine run one after the other. |
| `email_outbox … FOR UPDATE SKIP LOCKED` | The sender's claim (§5.122): up to 50 due rows, its attempt counted and `not_before` moved 10 minutes ahead in the claim's own short transaction; a second sender skips them. Every later write of a row (sent, failed, cancelled, given back) is one statement on its id. |
| `accounts … FOR UPDATE` (a reset by email) | `requestByEmail` (§5.23): the account's row, then its requests of the last hour counted from the audit, so three at once never make four codes. |
| `house_messages … FOR UPDATE SKIP LOCKED` | The house sender's claim (lot M2, §5.126): one due message at a time, its audience read, its deliveries written and the message SENT in the claim's transaction; a second process skips it, so two senders never deliver a message twice (the deliveries' unique key also holds). Every console change of a message takes its row `FOR UPDATE`. |
| `house_moment_settings … FOR UPDATE` | A moment switched or worded (§5.125): two changes at once run one after the other; the switch-on time is set once. |
| `accounts … FOR UPDATE`, then `products … FOR UPDATE`, then `worn_photos` | A WORN photograph sent (lot M2, §5.128): the account, then the piece, then its live photograph and the account's sendings of the last 24 hours counted, so two sendings at once never make two live photographs nor six in a day. A review (publish, refuse, take down) or a withdrawal takes the photograph's row `FOR UPDATE`, so a stale review answers `409 WORN_STATE`. |
| `skus … FOR UPDATE` (`lockSku`), an add-on's unit | Lot M3 (§5.133): every unit taken (a choice carried at the sale, an addition in YOUR ORDERS or by staff, a parcel problem bringing it back) is counted against `stock_holds` under its SKU's row lock, the SKUs in id order, so two orders taking the last unit at once leave one holding it and the other told none is left (`409 ADDON_OUT_OF_STOCK`, or left out at a sale). Lock order: the source's rows, the order, the units' SKUs, the invoice numbers, the journal, the audit last. |
| `orders … FOR UPDATE`, a set sale's orders in the set's order | Lot M3 (§5.138, `lockSetSale`): every path that holds several orders of one set (a cancellation, the group return's opening and decision, an exchange) locks them first in the set's piece order, so two of them never deadlock. |
| `sets … FOR SHARE` | Lot M3 (§5.135): a set's release created or changed holds its set's row, so `SetService.update` cannot change its pieces meanwhile; a set's change takes it `FOR UPDATE`. |
| `accounts … FOR KEY SHARE` (a vault given) | Lot Q3 (§5.143, `giveVault`): the account's row before its vaults are counted and inserted, in the occasion's own transaction. Never an update lock: a registration or an address save already holds the row `FOR SHARE`, and every LIVE action of a collector takes its account before the release, which a sell-out's PAY holds while it gives the line its vaults; the unique key `vaults_occasion_key` stops a second vault. |
| `vaults … FOR UPDATE`, then `vault_rewards … FOR KEY SHARE` (the floor's row first, then the active rows by id), then the drawn row's `given` + 1 | Lot Q3, an opening (§5.142, §5.143): the vault, then the table, in the same order as every save of CLUB > THE VAULT (the floor's row `FOR UPDATE`, then the others by id), so an opening and a change of the table never wait for each other in a circle; openings of different vaults share the table and never wait for each other there (only two that count the same row, from its count to their commit); a row with a quantity is counted in one guarded statement (`given < quantity`) before its delivery, the card given when it updates nothing; two openings of one vault run one after the other, and the second reads the first's outcome (one draw). A product won free then takes its SKU's lock (`lockSku`) to reserve the winner's unit. |
| `vault_gifts … FOR UPDATE`, then `accounts … FOR NO KEY UPDATE` (a credit to give accepted) | Lot Q3 (§5.146): the gift, then the friend's account (two acceptances or two first orders of one account count each other), its pieces counted, then the VAULT credit inserted; two acceptances of one gift run one after the other: the same friend's second reads its credit again, another account's is refused (`409 VAULT_GIFT_ENDED`). |
| `test_runs … FOR UPDATE`, then `drops … FOR UPDATE` (the release and its after-room) | Lot PURGE (§5.74): a purge's request, its resume and every batch lock the test, then its release and after-room, before any check; the staff's draw actions on a place (OFFER NEXT, Confirm, Lapse) lock the release and refuse `409 RELEASE_BEING_PURGED` while a test of it is being purged. A request consumes its step-up (its `admin.step_up` entry takes the audit chain's lock) only after both rows, so a request and an OFFER NEXT at the same moment never deadlock. |
| `test_entrants … FOR UPDATE` (the purge's accounts) | Lot PURGE: the lock SEND TEST ENTRANTS takes on the pool's accounts (`takePool`). The purge takes each account it deletes under it and checks again that no test holds it, then deletes all of that account's rows in the same call, so an account a new test takes meanwhile is kept whole, never half deleted. |
| `platform_reset_gate … FOR UPDATE`, then `LOCK TABLE` of every table | Lot PURGE, the reset (§5.160, §5.161): the gate's row, then, under a 5 s lock timeout and before its snapshot, every KEEP and PARTLY table `IN SHARE ROW EXCLUSIVE MODE` and every WIPE table `IN ACCESS EXCLUSIVE MODE`, so nothing is written between its snapshot and its COMMIT; before that, any other connection to the database refuses it (`RESET_OTHER_CONNECTIONS`, whatever its name and state), which is why the app closes its own pool and resets through one dedicated connection. |

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
| `PARTNER_INVOICE_NUMBER` | `0x4F520402`, sub-key `year × 2 + kind` | Lot M4 (K49 P4): the numbers of the partner invoices and their credit notes (§5.153), their own series per kind and UTC year (P-2026-0001, PC-2026-0001), apart from the collectors'; taken after the experience's row, so two invoices issued at once take consecutive numbers. |
| `SHOPIFY_PRODUCT` | `0x4F520501`, sub-key a hash of the Shopify product id | The Shopify ids pasted back for a model (§5.47): two links of one product run one after the other. |
| `RELEASE_CAMPAIGN` | `0x4F520801` | MAKE THE LINKS of a release's CAMPAIGN tab (lot M1, C2; `services/campaign.ts` `makeLinks`): every missing link made in one transaction under it, so two clicks at once make each link once, and two releases opening the same Paris day (whose codes share a base) never compute the same free code. The campaign's readout reads in one REPEATABLE READ, READ ONLY transaction and takes no lock. |
| `FOUNDING_ANNOUNCEMENT` | `0x4F520901` | Send the founding announcement (lot M1, E1; `services/email-triggers.ts` `queueAnnouncement`): two sends one after the other, so the « one release ever » check sees the other's rows. The release's row is read `FOR KEY SHARE` only: a draw's entries and a LIVE RELEASE's engine go on while the rows are written (500 an INSERT). |
| `FOUNDING_ADDRESS` | `0x4F520902`, sub-key the normalized address's SHA-256, its first 32 bits | The founding list's registration of an address (`services/founding.ts` `register`) and an account's sign-up with it (`AuthService.registerAccount`), each before its reads, so the two committing at once never both miss the match (F3). |

One more transaction-scoped lock is taken by name rather than from the `"OR"` namespace: `pg_advisory_xact_lock(hashtext('orbes/views-daily'))` (`services/tracking.ts` `lockViewsDaily`, plan CUSTOMER INTELLIGENCE §3.3 T.8.4, T.10). The daily count of the views (one Paris day per transaction), the purge of a day, and the link of a device to an account (which attaches its anonymous rows and adds those of the days already counted) each hold it, so a link and a day's count never cross and no row is counted twice in `collector_places` or `collector_view_months`. A link waits for it 2 s at most (`LINK_LOCK_WAIT_MS`, `SET LOCAL lock_timeout` for that wait only), so a sign-in never holds a pool connection behind the morning's count of a month; a link that times out is logged and caught up by the next signed-in batch's SESSION link.

In PostgreSQL, single-key (bigint) and two-key (int4, int4) advisory locks occupy separate key spaces. Kysely's migrator uses its own session-level advisory lock (§9.2).

**The platform reset's locks** (lot PURGE, migration `0067`): in its one transaction it first tries `LIVE_ENGINE` (`pg_try_advisory_xact_lock`: refused `RESET_LIVE_ENGINE` while an engine still leads), then holds until its COMMIT every chain and numbering lock **in the services' own forms**, so no audit entry, piece serial, category or invoice number can be taken between its wipe and its COMMIT: `AUDIT_CHAIN` and `CATEGORY_ALLOCATION` with one key; `INVOICE_NUMBER` and `PARTNER_INVOICE_NUMBER` with two, `year × 2 + kind` for each kind; `SERIAL_ALLOCATION` with two, `(year − 2000) × 32 + c` for each category index c from 0 to 31; each for the current and the next UTC year (`orbes_platform_reset_numbering_locks`): 74 locks, 75 with the engine's. The test purge takes no advisory lock of its own: its audit deletions keep the chain (§5.159) without appending to it.

---

## 9. Migrations

### 9.1 Layout

- Migrations are listed statically in `MIGRATIONS` in `db/migrate.ts` (imports, not a directory scan, so they still work when the server is bundled): `0001_initial` (the schema), `0002_platform_guards` (append-only `product_status_history`, no deletion of `genomes` and `cryptographic_keys`, the customer login throttle columns of `accounts`), `0003_authentication_events_default` (`authentication_events.authenticators` defaults to `'{}'`), `0004_scan_reports` (customers' reports on scans and the Cases queue, §5.22; its down step drops the table and nothing else), `0005_account_recovery` (the recovery codes of §5.23 and `accounts.transfers_frozen_until`; its down step drops the column and the table, which restores the schema of `0004` exactly), `0006_admin_password_change_required` (`admin_users.password_change_required`, boolean NOT NULL DEFAULT false: the temporary password of a staff account created from the console; its down step drops the column, which restores the schema of `0005` exactly, after ending the sessions of the accounts that still hold their temporary password and disabling them (`disabled_at` set, an earlier date kept): without the flag, such an account would sign in with a password an ADMIN was shown and use its full role for good. Re-enabling one after a rollback would let that password in; create a new account for the member instead), `0007_print_batch_indexes` (indexes `products_production_batch_idx` and `codes_created_at_idx`, for printing by production batch; indexes only, so the previous application version runs on it unchanged), `0008_retail_mode` (A-08, the sale mode: the RETAIL role in the `admin_users.role` CHECK, the `retailers` register (§5.25), `warranties.retailer_id`, `scan_events.admin_id` with its ADMIN_TEST-only CHECK, and the `SALE_ACTIVATION` purpose of `scan_tokens`; every new column nullable, so the previous image runs on it. Its down step restores the 0006 schema exactly: it first copies each warranty's point-of-sale name into an empty free-text `retailer`, deletes the outstanding SALE_ACTIVATION tokens and the sessions of the RETAIL accounts, and keeps those accounts but stops them working: each becomes AUDITOR, the lowest role the previous schema knows, and disabled (`disabled_at` set, an earlier date kept), so it cannot sign in. They are not deleted because other tables point to a console user with ON DELETE RESTRICT (0004 `scan_reports.handled_by`, 0005 `account_recovery_codes.created_by`): a member of the team who handled a case or issued a recovery code, then was stepped down to RETAIL on the Team page, would make the delete, and with it the whole rollback, fail; the audit log keeps their history by id either way. Trade-off: an ADMIN who re-enables such an account after a rollback gives it AUDITOR rights, so check its role first), `0009_scan_daily_stats` (the table `scan_daily_stats`, §5.24, which the previous version ignores; its down step drops it), `0010_models_active` (A-10: `models.active`, true for every existing model, and the trigger `models_immutable_identity` on a model's category and SKU prefix, §5.3; additions an older image ignores; its down step drops the trigger and the column and nothing else), `0011_scan_token_transfer_accept` (F-03: the `TRANSFER_ACCEPT` purpose of `scan_tokens`, §5.17; the CHECK is dropped and re-created with the three purposes, those of 0008 kept; the previous image never writes the new purpose. Its down step deletes the outstanding `TRANSFER_ACCEPT` tokens, 15-minute proofs nothing refers to, and restores the CHECK of 0008 exactly, `SALE_ACTIVATION` included), `0012_media` (F-04: the table `media_objects`, §5.26, and the nullable foreign keys `models.image_sha256` and `products.photo_sha256`, each at the head of its own index; additions an older image ignores, showing no photograph; its down step drops the two columns with their indexes, then the table and every photograph in it, which restores the schema of the previous migration exactly), `0013_ownership_certificates` (F-06: the table `ownership_certificates`, §5.27, which the previous image ignores; its down step drops it and nothing else, the certificates with it: their links then answer 404 once the newer image is back), `0014_model_lookbook` (P-R02: the lookbook columns of `models`, §5.3, `slug` unique and lower-case, `lookbook` HIDDEN by default so every existing model stays out of the lookbook, `story`, `specs`, `published_at`, each nullable or with a constant default so the previous image runs on it; and the table `model_images`, §5.28, which it ignores; its down step drops the table, then the columns with their constraints and unique index, which restores the schema of `0013` exactly, the galleries and the sheets' words with them), `0015_drops` (P-R03: the tables `drops` and `drop_entries`, §5.29 and §5.30, which the previous image ignores; its down step drops both, the releases and their entries with them, which restores the schema of `0014` exactly), `0016_circle` (P-X01: the five tables of the owners' circle, `circle_posts`, `circle_post_images`, `circle_rsvps`, `circle_poll_votes` and `circle_daily_visits`, §5.31 to §5.35; nothing in an older image reads or writes them; its down step drops the five tables, the posts, their photographs' rows, the answers, the votes and the visits with them, which restores the schema of `0015` exactly), `0017_drop_early_access` (P-X02: `drops.early_access_hours`, smallint NOT NULL DEFAULT 48 with its CHECK 0–336, §5.29; a column with a constant default the image of `0015` never names, so it runs on it; a direct reservation is a row of `drop_entries` with no new column; its down step drops the column, its CHECK with it, which restores the schema of `0016` exactly), `0018_club_tiers` (P-X04: the table `club_tiers`, §5.36, with no row; nothing in an older image reads it; its down step drops it, the console's words with it, which restores the schema of `0017` exactly), `0019_model_discontinued` (P-R06: `models.discontinued_at` and `discontinued_by`, both nullable, the CHECKs `models_discontinued_inactive` and `models_discontinued_by_when` and the index `models_discontinued_by_idx`, §5.3; compatible with the previous image, which never names the two columns and inserts models without them, and no row has a date until the new image discontinues one; its down step drops the index, the two CHECKs and the columns, the foreign key with its column, which restores the schema of `0018` exactly), `0020_private_salon` (P-X08: `models.price_label`, nullable, and `models.private_min_tier`, smallint NOT NULL DEFAULT 1, each with its CHECK, §5.3, and the table `shop_requests`, §5.37, with its indexes and trigger and no row; compatible with the previous image, which never names the two columns, inserts models without them (the constant default fills `private_min_tier`) and never reads the table; its down step drops the table, then the two CHECKs and the columns, which restores the schema of `0019` exactly, the requests and the prices with them), `0021_live_release` (the LIVE RELEASE, plan of 2026-10-04: `drops.mode`, DRAW by default, and the LIVE columns of `drops`, §5.29, each nullable or with a constant default, which the previous image never names; the eight tables of §5.38 to §5.45, which it ignores; no row inserted. Its down step first withdraws the posts of the circle linked to a LIVE drop and still to come (`published_at` to NULL: the previous image would show them at their time), then cancels every LIVE drop, which the previous image would read as a draw, then drops the eight tables, and the constraints, indexes and columns of `drops`: the schema of `0020` exactly), `0022_orders_stock` (LIVE RELEASE+, plan of 2026-10-04: the twelve tables of §5.46 to §5.57, `products.sku_id` and the RESERVED status, `drop_sizes.sku_id`, `drops.stock_location_id`, `shop_requests.outcome`, `models.base_price_minor`, `base_currency` and `care_guide`, `accounts.shopify_customer_id`; new nullable columns and tables the image of `0021` never names, no row inserted (the first boot of the new image creates the locations and carriers, §9.4). Its down step revokes the codes of the identities still RESERVED and retires them (the previous image has no such status; their serials stay taken), drops the twelve tables, then the columns and constraints it added: the schema of `0021` exactly), `0023_releases_collectors` (LIVE RELEASE+: the LIVE+ columns of `drops`, §5.29, every one NULL for a DRAW, `circle_posts.segment_id`, and the four tables of §5.58 to §5.61, which the previous image ignores; no row inserted. Its down step cancels the after-rooms that have not ended (the previous image would show them as releases of their own), drops the four tables, then the columns and constraints: the schema of `0022` exactly), `0024_model_variants` (plan NOCTURNE: the variants of a model, `models.variant_of`, `variant_label` and `variant_swatch` with their CHECKs, the index that leads the new foreign key, the unique label per model and the trigger `models_variant_rules`, §5.3; and a draw's price, `drops.price_minor` and `currency` now allowed on a DRAW, both or neither, `drops_draw_price`, with `drops_draw_fields` re-created without them, §5.29. Three nullable columns the previous image never names, and a draw's price it never reads; no row inserted. Its down step clears the draws' prices (the previous `drops_draw_fields` refuses them), restores that CHECK as `0021` wrote it, then drops the trigger, its function, the indexes, the constraints and the columns: the schema of `0023` exactly, each variant then a model of its own, as it was), `0024_z_test_entrants` (TEST ENTRANTS, 2026-10-07: the tables `test_entrants`, `test_runs` and `test_run_entrants`, §5.73 to §5.75, which the previous image ignores; no row inserted. Named so that it sorts after `0024_model_variants` and before the next lot's `0025` both by code unit (Kysely, which refuses migrations out of order) and in a locale's collation, which passes over the `_` (psql's `ORDER BY`, as deploy.sh lists them). Its down step drops the three tables, the pool's accounts staying plain accounts: the schema of `0024` exactly), `0025_client_messages` (plan NEXT-NINE, CS-01: the tables `client_conversations` and `client_messages`, §5.62 and §5.63, which the previous image never reads; no row inserted; its down step drops the two tables: the schema of `0024_z` exactly), `0026_club_program` (plan NEXT-NINE, BP-19 T2, T3 and T7: the tables `club_program_settings` and `shipping_rates`, §5.64 and §5.65, `drops.early_access_platine_hours` with `drops_platine_window` and `drops_live_platine`, §5.29, and `circle_posts.experience` with `circle_posts_experience`, §5.31; two tables the previous image never reads and nullable columns it never names; no row inserted; its down step drops the constraints, the columns and the two tables: the schema of `0025` exactly), `0027_tier_grants` (plan NEXT-NINE, BP-19 T4 and T5: the tables `tier_grants` and `credit_uses`, §5.66 and §5.67, the orders' `with_order_id`, `gift_grant_id` and shipping columns with their CHECKs and indexes, the channel GIFT, `orders_source` and the identity guard re-created, §5.51; two tables and nullable columns the previous image never reads, and no GIFT order until this image adds one; no row inserted. Its down step refuses, naming the counts, while any GIFT order or credit use exists; otherwise it restores 0022's channel CHECK, `orders_source` and guard, drops the columns and the two tables: the schema of `0026` exactly), `0028_yearly_care` (plan NEXT-NINE, BP-19 T6: the table `care_requests`, §5.68, and YEARLY_CARE in the service records' type CHECK, §5.15; a table the previous image never reads and a CHECK that only widens; no row inserted. Its down step refuses, naming the counts, while any care request or YEARLY_CARE record exists; otherwise it drops the table and restores 0001's CHECK: the schema of `0027` exactly), `0029_house_guarantee` (plan NEXT-NINE, IN-01: the tables `house_guarantees` and `guarantee_settings`, §5.69 and §5.70, `drop_entries.guarantee_id` and `pieces` with `drop_entries_guaranteed`, `drop_entries_pieces` and `drop_entries_guarantee_key`, §5.30, `live_entries.guarantee_id` with `live_entries_guarantee_key`, §5.39, `orders_drop_entry_key` on `(drop_entry_id, piece)` and `orders_source` rebuilt from `0027`'s, its piece clause `channel IN ('LIVE','DRAW') OR piece = 1`, §5.51; tables the previous image never reads, columns nullable or with a constant default it never names; no row inserted. If the previous image runs a draw during the deployment, `drop_entries_guaranteed` refuses its update of a guaranteed entry and the draw fails closed: draws wait for the new image. Its down step refuses, naming the count, while any DRAW order has a piece above 1; otherwise it restores `0027`'s `orders_source` and `orders_drop_entry_key`, drops the entries' columns and constraints, then the two tables: the schema of `0028` exactly), `0030_account_sizes` (plan NEXT-NINE, AC-01: the table `account_sizes`, §5.71, `models.size_kind`, §5.3, `skus.fit_min_mm` and `fit_max_mm` with `skus_fit`, §5.47, and `shop_requests.size_label`, §5.37, with `shop_requests_immutable_identity` created again to guard it; a table the previous image never reads and nullable columns it never names; no row inserted; its down step drops them and creates 0020's trigger again: the schema of `0029` exactly), `0031_model_pairs` (plan NEXT-NINE, BP-34: the table `model_pairs`, §5.72, which the previous image never reads; no row inserted; its down step drops it: the schema of `0030` exactly), `0032_growth_indexes` (plan NEXT-NINE, BP-29 GROWTH: three indexes, `accounts_created_at_idx (created_at)` §5.9, `ownership_account_started_idx (account_id, started_at)` §5.12 and `orders_paid_idx (account_id, paid_at) WHERE paid_at IS NOT NULL` §5.51, that GROWTH reads on; no table, column, constraint or trigger, no snapshot table; the previous image never names them; its down step drops the three: the schema of `0031` exactly), `0033_model_sizes` (plan NEXT LOT of 2026-10-07, §3.3, deployment H1: `models.size_type` with `models_size_type_check` and `models_size_type_kind` §5.3, `skus.set_aside_at` and `set_aside_by` with `skus_set_aside`, `skus_set_aside_by_idx` and `skus_model_offered_idx` §5.47; nullable columns the previous image never reads, no row written: every SKU stays an offered size, every model's type NULL; its down step drops them: the schema of `0032` exactly), `0034_claim_code_renewals` (plan NEXT LOT, §3.4, deployment H1: the table `claim_code_renewals` §5.76; a new table the previous image never reads, no row inserted: every piece keeps its hash; its down step drops it: the schema of `0033` exactly), `0035_logistics_access` (plan NEXT LOT, §3.5.5.1, deployment H2: LOGISTICS in `admin_users_role_check` §5.10, the tables `suppliers` §5.77 and `admin_user_locations` §5.90, `stock_locations.address` §5.46, `models.supplier_id` §5.3 and `skus.supplier_id` §5.47, each foreign key led by its index; tables and nullable columns the previous image never reads, a role it ranks 0; no row written. Its down step refuses, naming the count, while a LOGISTICS login exists; otherwise it drops them and restores 0008's role CHECK: the schema of `0034` exactly), `0036_supplier_orders` (plan NEXT LOT, §3.5.5.2, deployment H2: the tables `supplier_orders`, `supplier_order_lines`, `receptions`, `reception_lines`, `card_prints`, `supplier_returns` and `stock_corrections` §5.78 to §5.84, the ledger's RECEIVED with `stock_movements.reception_line_id` and `stock_movements_received`, `stock_movements_reason_check`, `_sign` and `_order` rebuilt §5.48, `products.reception_line_id` and `stock_entered_at` §5.4, backfilled from each piece's earliest PRODUCED movement; tables the previous image never reads, a reason it never writes, nullable columns it never names. Its down step refuses, naming the counts, while any supplier order, reception or stock correction exists; otherwise it drops them in reverse and restores 0022's three CHECKs: the schema of `0035` exactly), `0037_fulfilment` (plan NEXT LOT, §3.5.5.3, deployment H2: `orders.reservation` AWAITING in place of BENCH (its rows moved), `queue_first` and `orders_awaiting_idx`, the channel EXCHANGE with `exchange_of_order_id` and `orders_source` rebuilt, `packing_started_at` and `orders_packing`, the identity guard with `exchange_of_order_id` §5.51; the tables `shipments`, `shipment_items` and `order_cases` §5.85 to §5.87; `order_alert_settings.ready_days` 5, a stored 3 made 5 §5.57; the open pieces to make cancelled, their reserved identities left as they are §5.53. Not compatible with the previous image, which reads BENCH: H2 ships as one deployment. Its down step refuses, naming the counts, while an AWAITING or EXCHANGE order, a shipment or an order case exists; otherwise it restores 0022's reservation CHECK, 0029's channel CHECK and `orders_source`, 0027's identity guard and the default 3: the schema of `0036` exactly), `0038_draw_sizes` (plan NEXT LOT, §3.6.F, deployment H2: `drop_entries.size_id`, the size an entry chose, with the composite foreign key `drop_entries_size_fkey` to a size of its own release and the index `drop_entries_size_idx`; `drop_sizes` serves a draw too §5.38. Compatible with the previous image: a nullable column it never names. Its down step refuses, naming the count, while a published draw has sizes; otherwise it drops the index, the foreign key and the column: the schema of `0037` exactly), `0039_order_delivery` (plan NEXT LOT, §3.6.B and §3.6.C, deployment H2: YOUR ADDRESSES, `account_addresses` §5.88; the order's `buyer_country`, `buyer_phone`, `address_by`, `address_at` and `address_changed_at`, none on an order travelling with another, `address_by` set STAFF on the orders of before with an address that do not travel; `engraving_prices` §5.89, the order's `engraving_minor` and `engraving_by`, STAFF on the engravings of before; the invoices' `supplements_invoice_id` and `credit_scope`, FULL on the credit notes of before, `invoices_one_per_order` rebuilt without the supplementary invoices and `invoices_credits_key` replaced by `invoices_full_credit_key` with `invoices_credits_idx` leading its foreign key, §5.55. Compatible with the previous image: a table it never reads and nullable columns it never names. Its down step refuses, naming the counts, while a supplementary invoice or a credit note for single lines exists; otherwise it drops the rest and restores 0022's invoice keys: the schema of `0038` exactly), `0040_account_profiles` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1, deployment I1: the tables `heard_options`, `account_profiles` and `account_tastes` §5.91 to §5.93, each foreign key led by an index; tables the previous image never reads, no `ALTER TABLE accounts`, no row inserted (the first boot of the new image creates the answers, §5.91); its down step drops the three tables: the schema of `0039` exactly), `0041_account_wishes` (plan CUSTOMER INTELLIGENCE §3.2, deployment I1: the tables `account_wishes`, `model_wish_months` and `wish_months_counted` §5.94 to §5.96, each foreign key led by an index, `account_wishes_open`, `account_wishes_removed` and the guard `account_wishes_immutable`; tables the previous image never reads, no row inserted; its down step drops the three tables: the schema of `0040` exactly), `0042_collector_views` (plan CUSTOMER INTELLIGENCE §3.3 T.6, deployment I1: the ten tables `geo_places`, `tracking_devices`, `tracking_device_accounts`, `collector_views`, `view_daily_stats`, `device_daily_stats`, `collector_places`, `collector_view_totals`, `collector_view_months` and `tracking_state` §5.97 to §5.105, each foreign key led by a full index, the guard `tracking_devices_immutable`, a b-tree on `collector_views.at`, no partition (the application's role cannot create tables); tables the previous image never reads, no row inserted (`tracking_state`'s row is the first boot's); its down step drops the ten tables, newest first: the schema of `0041` exactly), `0043_acquisition` (plan CUSTOMER INTELLIGENCE §3.4 A.6, deployment I1: the eight tables `link_channels`, `links`, `acquisition_sources`, `acquisition_touches`, `account_sources`, `acquisition_conversions`, `acquisition_daily` and `acquisition_state` §5.106 to §5.113, each foreign key led by a full index, the guard `links_immutable`, `tracking_devices.first_source_id` with `tracking_devices_first_source_idx` (§5.98), and three small indexes on existing tables, `drop_entries_created_idx`, `live_entries_joined_idx`, `orders_reserved_idx`, built in the migration's transaction (seconds at the house's sizes); tables and a column the previous image never reads, no row inserted (the channels, the fixed sources and the state row are the first boot's); its down step drops the three indexes, the column and its index, then the eight tables newest first: the schema of `0042` exactly), `0044_client_notes` (plan CUSTOMER INTELLIGENCE §3.6 C.8 items 1, 2, 4 and 5, deployment I1, its last: the tables `account_notes` and `account_tags` §5.114 and §5.115, each foreign key led by a full index, the guard `account_notes_immutable`; the function `orbes_fold(text)`; `audit_logs_account_login_idx` on `audit_logs` (§5.21) and `account_profiles_city_fold_idx` on `account_profiles` (§5.92), built in the migration's transaction (seconds at the house's sizes); tables, a function and indexes the previous image never names, no row inserted; its down step drops the city index, the function, the sign-ins index and the two tables: the schema of `0043` exactly), `0045_birthday_credit` (plan CUSTOMER INTELLIGENCE §3.5 SB.4.2, deployment I2, its first: THE PROGRAM's three birthday columns, §5.64; `tier_grants`' kind BIRTHDAY, its nullable tier, `birthday_on`, `tier_grants_birthday`, `tier_grants_credit` widened, the key `tier_grants_birthday_key` and the guard re-created with `birthday_on`, §5.66; no row inserted; its down step refuses while any BIRTHDAY grant exists, naming the count, then restores `0044`'s schema exactly), `0046_engagement_scores` (§3.5 SB.3.2: `account_scores` and `engagement_runs`, §5.116 and §5.117; no row inserted; its down step drops both: the schema of `0045` exactly), `0047_collector_history` (§3.6 C.8 item 3, deployment I2's last: `collector_history`, §5.118; its down step drops it: the schema of `0046` exactly), `0048_orbes_care` (plan ORBES CARE of 2026-10-15, §2(c): `models.warranty_lifetime` (§5.3), `warranties.lifetime` with `warranties_lifetime_open` and the trigger `warranties_kind` (§5.14), PLATINE's PRIVATE CARE every piece and `warranty_credit_percent` (§5.64), the grant kind WARRANTY (§5.66), `warranty_claims` (§5.119), the PRIVATE CARE records' place *ORBES* (§5.15); its down step refuses, naming the counts, while any warranty claim or WARRANTY grant exists, otherwise drops the trigger, its function and the CHECK, gives back the started lifetime warranties' end dates (`start + duration_months`), then the rest: the schema of `0047` exactly), `0049_live_pace` (lot M1 of 2026-10-21, W4: a LIVE RELEASE's pace, `drops.pace_batch`, `pace_minutes`, `pace_paused_at`, `pace_next_at`, `pace_batches` with `drops_pace` and `drops_pace_state`, and its entries' admission, `live_entries.admitted_at`, `admitted_batch`, `live_entries_admitted` and the partial index `live_entries_waiting_admission`, §5.29, §5.39; its down step refuses, naming the counts, while any release has a pace or any entry was admitted by a batch, otherwise the schema of `0048` exactly), `0050_founding_list` (lot M1, F2 to F4: `preregistrations` (§5.120) and its guard, LANDING in `links_destination_check` (§5.107), `drops_draw_plus` re-created without `access_segment_id` (§5.29); its down step refuses, naming the counts, while any pre-registration, LANDING link or draw with a segment exists, otherwise the schema of `0049` exactly), `0051_emails` (lot M1, E0: `email_templates`, `email_outbox`, `email_preferences`, `email_state` (§5.121 to §5.124), and `account_recovery_codes.issued_via` with `created_by` nullable under `account_recovery_codes_issued_by` (§5.23); its down step refuses, naming the counts, while any template, email, preference or code sent by email exists, the watermark's row aside, otherwise the schema of `0050` exactly), `0052_house_messages` (lot M2 of 2026-10-22, D24: `house_moment_settings`, `house_messages`, `house_deliveries` (§5.125 to §5.127); its down step refuses, naming the counts, while any setting, message or delivery exists, otherwise the schema of `0051` exactly), `0053_worn` (lot M2, D31: `worn_photos` (§5.128); its down step refuses, naming the count, while any photograph exists, otherwise the schema of `0052` exactly), `0054_boxes_weights` (lot M3 of 2026-10-23, D16 B1 and B2: `boxes` (§5.129), a model's box and packed weight, a shipment's box, weight and missing list; its down step refuses, naming the counts, while a box, a model's box or packed weight, or a shipment's box, weight or missing list exists, otherwise the schema of `0053` exactly), `0055_location_countries` (lot M3, K11 Z1: `stock_location_countries` (§5.130); its down step refuses while a country is served, otherwise the schema of `0054` exactly), `0056_addons` (lot M3, K48 D1 and D2: `addon_items`, `addon_item_prices`, `order_addon_items`, `addon_choices` (§5.131 to §5.134), `skus.model_id` NULL-able with `skus.addon_id` and `skus_owner`, `stock_movements.order_addon_item_id`, the view `stock_holds` (§6.1); its down step refuses, naming the counts, while an add-on, an add-on's SKU, a unit or a choice exists, otherwise the schema of `0055` exactly), `0057_sets` (lot M3, K44 T1 to T4: `sets`, `set_models`, `drop_entry_sizes`, `live_entry_sizes`, `live_interest_sizes`, `set_sales` (§5.135 to §5.138), `drops.model_id` NULL-able with `drops.set_id` and `drops_one_offer`, `drop_sizes.piece`, `orders.set_sale_id` and `set_piece`, `order_cases.group_id`; its down step refuses, naming the counts, while a set, a set's release, a set sale, a grouped return case or a release size given per piece (or past the 24th) exists, otherwise the schema of `0056` exactly), `0058_one_queue` (lot Q1, ONE QUEUE: `drops.pace_hold_minutes` and `drops.pace_extra_batches` with `drops_pace_hold_minutes_check`, `drops_pace_hold`, `drops_pace_extra_batches` and `drops_live_paced` (§5.29), `live_entries.admitted_at` and `admitted_batch` read as the batch that gave the turn (§5.39); its up step refuses, naming the count, while an open LIVE RELEASE has no pace, its down step while a release has a hold, otherwise the schema of `0057` exactly), `0059_addons_one_system` (lot Q2, ADD-ONS ONE SYSTEM: `addon_items.kind`, `offer_live`, `offer_draw`, `offer_salon`, `offer_orders`, `engraving` and `text_max` with `addon_items_kind_check`, `addon_items_service_plain`, `addon_items_engraving_service`, `addon_items_engraving_key` and `addon_items_text_max_check`, the identity guard gaining `kind` (§5.131); `drop_addons` (§5.139); `addon_choices.text` (§5.134); `order_addon_items.location_id` NULL-able with the trigger `order_addon_items_kind_guard` (§5.133); the view `stock_holds` reading only units with a location (§6.1); additive, no row inserted; its down step refuses, naming the counts, while a service, an engraving add-on, a release's pick, a choice's words or a unit without a location exists, otherwise the schema of `0058` exactly), `0060_release_addons_converted` (lot Q2: `addon_conversions` (§5.140) and the conversion of every release add-on and Orders → Settings' engraving prices into catalogue add-ons, the picks of the releases not ended, then `live_entry_addons`, `live_addons` and `engraving_prices` dropped (§5.41, §5.42, §5.89); its up step refuses, naming the count, while a release add-on is chosen on an entry in TURN or SECURED; its down step refuses while a conversion is recorded, otherwise re-creates the three tables empty as `0021` and `0039` made them), `0061_the_vault` (lot Q3, THE VAULT: `vault_sources` with its seven rows (§5.141), `vault_rewards` with its I WAS THERE floor and the trigger `vault_rewards_addon_product` (§5.142), `vaults` with `vaults_occasion`, `vaults_occasion_key`, `vaults_waits`, `vaults_revoked`, `vaults_outcome` and the guard `orbes_vaults_guard` (§5.143), `vault_occasions_before` written once with the tiers held (§5.144), `invitations` (§5.145), `accounts.invited_by` and `invited_at` (§5.9), `drops.vault_on` (§5.29), `models.vault_only` (§5.3), `house_deliveries.source` VAULT (§5.127); additive; its down step refuses, naming the counts, while a vault, an invitation, an invited account, a vault message, a reward other than the floor, a source's setting changed, a release with its vault on or a vault-only model exists, otherwise the schema of `0060` exactly), `0062_vault_rewards` (lot Q3: the links into what delivers a reward, `tier_grants` kind VAULT with `vault_id` and `usable_while_no_piece` (§5.66), `orders` channel VAULT with `vault_id` and `claim_by`, `orders_source` rebuilt, `orders_vault` and `orders_vault_key` (§5.51), `house_guarantees` scope LIVE with `vault_id` (§5.69), `order_addon_items` VAULT units with `vault_id` (§5.133), `vault_gifts` (§5.146), `vaults.gift_id`, `offer_until` and `offer_used_at` with `vaults_offer` (§5.143); no row inserted; its down step refuses, naming the counts, while a VAULT credit, order, LIVE guarantee or unit, a credit to give or a vault's offer exists, otherwise the schema of `0061` exactly), `0063_margin` (lot M4, K43 N1, N2 and D61: `currency_rates` (§5.147), `shipping_cost_rates` with `shipping_cost_rates_band_key` (§5.148), `margin_unit_costs` with THE VAULT CARD's key (§5.149), `category_allowances` (§5.150); additive, no row inserted; its down step refuses, naming the counts, while a rate, a band, a unit cost or an allowance exists, otherwise the schema of `0062` exactly), `0064_partners` (lot M4, K49 P1 to P4: `partners` (§5.151), `partner_experiences` with its states and times (§5.152), `partner_invoices` in their own series, never changed (§5.153), `circle_posts.partner_experience_id` (§5.31), `circle_rsvps.share_name` and `share_name_at` (§5.33); no row inserted; its down step refuses, naming the counts, while a partner, an experience, a partner invoice, a linked invitation or a name shared exists, otherwise the schema of `0063` exactly), `0065_ad_conversions` (lot M4, K27 A1 to A4, built and switched off: `ads_settings` with `events_from` set once and the watermark `enqueued_until` (§5.154), `ads_channel_platforms` (§5.155), `ad_consents` never changed (§5.156), `ad_clicks` (§5.157), `ad_events` (§5.158); no row inserted; its down step refuses, naming the counts, while the switch is on or a choice, a click id or an event exists, otherwise the schema of `0064` exactly), `0066_test_purge` (lot PURGE, the owner's answers of 27 October 2026, answer 4: `orbes_reject_mutation`'s one way through for the purge, a DELETE only, on its five guarded tables of `public`, while `orbes.guard_bypass` is `purge` and the current user is a superuser (every other use refused exactly as before, `OR001`); the test's purge columns and their guard `test_runs_purge_guard` (§5.74); `audit_purge_gaps` (§5.159); `purge_delete_tables` and `orbes_purge_plan()` (§5.162); `orbes_require_superuser()`; the forbidden windows `orbes_maintenance_window` and `orbes_maintenance_window_within`; the two SECURITY DEFINER batch functions `orbes_purge_test_run_batch` and `orbes_purge_test_pool_batch`, owned by the migrations' superuser, `search_path` fixed, `lock_timeout` 2 s, their helpers revoked from PUBLIC; no row of a test touched, none inserted but its own fixed list; its down step refuses while a tombstone or a purge exists, otherwise the schema of `0065` exactly), `0067_platform_reset` (lot PURGE, answers 1 to 3: `platform_reset_plan` (§5.161) and `platform_reset_gate` with its holder recorded at the deployment (§5.160); `orbes_reject_mutation`'s second way through, a TRUNCATE of a WIPE table or a DELETE on a WIPE or PARTLY one, while `orbes.guard_bypass` is `reset` and the current user is a superuser, never an UPDATE nor a kept table; the definer functions `orbes_platform_reset_precheck` (read only, no bypass, no lock timeout), `orbes_platform_reset_authorize`, `orbes_platform_reset_unauthorize`, `orbes_platform_reset` and `orbes_platform_reset_lock`; its down step refuses once a reset was done or LOCK RESET pressed, otherwise the schema of `0066` exactly), 
and any later entry of `MIGRATIONS`. The application now runs on `0001` to `0067`; the previous image no longer runs on the schema after them, but each is written so that it keeps running while they are applied (none of its inserts names the new columns, whose defaults keep its rows valid). Numbers follow the planned deployment order of the 2026-10-02 recommendations (0004 to 0013) and of the « Potentiel » plan of 2026-10-03 (0014 to 0018 in its deployment A, 0019 and 0020 in its deployment B+C, stages B and C combined by the owner on 2026-10-04: [the runbook](launch/DEPLOY-POTENTIEL-2026-10.md)) and of the LIVE RELEASE plan of 2026-10-04 (0021, deployment D: [its runbook](launch/DEPLOY-LIVE-RELEASE.md)) and the LIVE RELEASE+ plan of the same day (0022 and 0023, deployment E: [its runbook](launch/DEPLOY-LIVE-RELEASE-PLUS.md)) and of the NOCTURNE plan of 2026-10-05 (0024, its own deployment, after E) and of TEST ENTRANTS of 2026-10-07 (0024_z, its own lot, after F) and of the plan of the next nine of 2026-10-06 (0025 to 0032, deployment G, after F) and of the next lot of 2026-10-07 (0033 to 0039, deployments H1 and H2, after G) and of the customer intelligence plan of 2026-10-08 (0040 to 0047, deployments I1 and I2, after H2) and of ORBES CARE of 2026-10-15 (0048, its own deployment, after I2) and of lot M1 of the macro scope of 2026-10-20 (0049 to 0051, its own deployment, after the desktop of 2026-10-16, which has none) and of its lot M2 (0052 and 0053, its own deployment, after M1; on M1's image during the roll-out, tables it never reads), and of its lot M3 (0054 to 0057, its own deployment, after M2; on M2's image during the roll-out, tables, columns and a view it never reads, and every SKU and release it writes names its model), and of ONE QUEUE's lot Q1 (0058, its own deployment, after M3; on M3's image during the roll-out, two columns it never names, their default 0, deployed while no LIVE RELEASE is between its room's opening and its end), and of lot Q2, ADD-ONS ONE SYSTEM (0059 and 0060, its own deployment, after Q1 or with it; 0059 additive, its columns' defaults keeping Q1's rows valid; 0060 drops three tables Q1's image reads for a LIVE hold's add-ons and Orders → Settings' engraving, so it is deployed while no LIVE RELEASE is between its room's opening and its end, and those reads fail only until the new image serves), and of lot Q3, THE VAULT (0061 and 0062, its own deployment, after Q2 or with it; on Q2's image during the roll-out, tables it never reads and columns it never names, their defaults keeping its rows valid, and no VAULT grant, order, guarantee or unit until the new image adds one; deployed while no LIVE RELEASE is between its room's opening and its end), and of lot M4 (0063 to 0065, its own deployment, after Q3; on Q3's image during the roll-out, twelve tables it never reads and three columns it never names, their defaults keeping its rows valid; nothing written by K27 while its switch is off), and of lot PURGE of 2026-10-27 (0066 and 0067, its own deployment, after M4; on M4's image during the roll-out, columns it never names and tables and functions it never reads, and nothing runs until a person presses PURGE or PLATFORM RESET in the new console), each migration keeping its number whatever the order of development (lot M4, first planned on M3 with `0058` to `0060`, renumbered its own after `0062`: `0063_margin`, `0064_partners`, `0065_ad_conversions`).
- A migration is a list of SQL strings executed one by one: PGlite runs queries through the extended protocol, which refuses multi-statement strings.
- Value lists for `CHECK` constraints are literal in the migration, so a migration never changes when application constants evolve; a test asserts they still match `schema.ts`.
- Rules: append new migrations to `MIGRATIONS`; never edit an applied migration.
- **Numbers follow the order of deployment, and a database applies them in that order only.** Kysely's migrator refuses a migration numbered below one already applied (unordered migrations are not allowed). The numbers `0004`–`0013` are reserved, lot by lot, by the plan of the 2026-10-02 recommendations, and a branch may carry a higher number before the lower ones exist, as `0010_models_active` once did before `0006`–`0009` were merged, and as `0013_ownership_certificates` (F-06) did before the `0012` of F-04 (`media_objects`) was merged. Such a tip must not reach a database that will later need the lower numbers: deploy the lots in their order, each with all of its migrations.
- Kysely records applied migrations in `kysely_migration` and uses `kysely_migration_lock`; both tables are created on the first run.

### 9.2 Behaviour

- `migrateToLatest(db)` applies every pending migration and returns the names applied; a failure throws `MigrationError` naming the failed migration.
- Kysely 0.29 runs **all pending migrations of one call inside one transaction** (transactional DDL), under an advisory lock on PostgreSQL. Instances that start together therefore apply each migration exactly once, and a failure rolls back every migration of that run, not only the failing one: the schema is left unchanged. Migrations must therefore be transaction-safe (no `CREATE INDEX CONCURRENTLY`, no `VACUUM`).
- `migrationStatus(db)` lists every known migration with its execution time. `migrateDown(db)` rolls back the most recent migration; it is development tooling only (`scripts/db.ts reset-demo` rolls back one migration at a time until none is applied; `0001_initial`'s down step drops every object). Before its first rollback, reset-demo clears what the down steps of `0062_vault_rewards` and `0061_the_vault` refuse (the demo seeds THE VAULT's example rewards): `src/server/db/seed/vault-reset.ts` deletes, in one transaction, each row those guards count with every row that refers to it, forgets invited accounts' inviters, and puts the sources, each release's switch and each model's VAULT ONLY back to their defaults, the tables' own guards switched off for that transaction only (their foreign keys stay checked). The migrations' guards themselves are unchanged: production keeps them (lot Q3, step Q3.A).

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
- prepares the recording of where collectors come from (`AcquisitionService.prepare`, plan CUSTOMER INTELLIGENCE §3.4 A.6, after `ProfileService.prepare` and `TrackingService.prepare`): the seven channels of the links (§5.106), only at the very first boot and while none exists; the DIRECT, BEFORE and STAFF sources (§5.108); the `acquisition_state` row (§5.113), whose `tracking_started_at` is that first boot. Each `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`: a second boot, or two processes at once, make one set; never audited;
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
| Birthday credits | Plan CUSTOMER INTELLIGENCE §3.5 SB.4.4 (`birthdayCredits`, `BirthdayCreditService.grantDue`, `services/birthday-credits.ts`), every pass, after the activity by hour: the birthday credit of each account whose birthday (a Paris day) falls within the days a credit would still be valid, granted within 10 minutes after midnight Paris (22:00 UTC until 25 October 2026, 23:00 UTC after) and caught up after a missed day while still valid (§5.66). One read of the accounts due, then one short transaction per account under its row (§8.2); one failing is logged and the others go on. THE PROGRAM's switch off: nothing given. Milliseconds of work. |
| Conversions | Plan CUSTOMER INTELLIGENCE §3.4 A.8 (`acquisitionConversions`, `recordConversions`, `services/acquisition-jobs.ts`), every pass, day and night: each sign-up, draw entry, LIVE RELEASE entry and order written since the recording started gets its one conversion (§5.111) with its last link, judged at the act's moment, never when its row was written (an order of a draw at its entry, of a LIVE RELEASE at its room entry, of the salon at its request; an EXCHANGE order copies its original's, after the other orders of the pass; a GIFT order never; a test entrant never). The candidates are found by when their row was written (`accounts.created_at`, `drop_entries.created_at`, `live_entries.joined_at`, `orders.reserved_at`, on their indexes), from an hour before the watermark (`acquisition_state.conversions_until`) to a minute before now, at most 1 000 a kind a pass, the oldest first; a sign-up only once 5 minutes old (the attach at the sign-up writes it; this is its safety net, with its first source by JOB, Direct). One INSERT … SELECT … ON CONFLICT DO NOTHING per kind and the watermark, in one transaction. Once a Paris day in the morning window, the **catch-up**: the same statements over every row written since the start with no conversion (at most 5 000 a kind), so an order made with a past reservation is never missed. Never audited. |
| Ad events | Lot M4 (`adsEnqueue`, `AdsService.enqueue`, `services/ads.ts`; K27 A3, A4), every pass, right after the conversions, **only while the conversions' switch is on** (nothing while off): the conversions written since the watermark (`ads_settings.enqueued_until`, an hour of overlap for a row that committed late) and the ORDER conversions whose order became PAID since the last pass, each acted since the latest switch on (never before `events_from`); for each, only the platforms the collector came from (its last link's channel mapped to the platform, or the account holding that platform's click id clicked within 90 days before the act), the account's choice at the act's time GRANTED, never a test entrant, a team account, an account not ACTIVE nor an order `adsSendsFor` leaves out (a GIFT, an EXCHANGE, a VAULT order at 0, an order paid on the Shopify store); one row per platform, QUEUED, or SKIPPED as NOT_READY (the platform's keys missing, or Google's action for the act not named), NO_CLICK_ID (a Google event with no Google click id) or TOO_OLD (older than 7 days for Meta and TikTok, 90 for Google). A paid order's act is its payment, with its main invoice's total. The events are sent by the sender every 30 s (`AdsService.sendDue`, started only when a platform has its keys), never by the housekeeping. |
| View statistics | Plan CUSTOMER INTELLIGENCE §3.3 T.10 (`viewStats`, `aggregateViews`, `services/tracking-jobs.ts`), after the activity by hour, in the morning window only (from 07:30 UTC until the Paris day ends, `morningWindowOpen`): each complete Paris day of `collector_views` not counted yet, up to yesterday, one day per transaction under the advisory lock `orbes/views-daily` (§8.3), at most 31 days a pass: the day's anonymous totals into `view_daily_stats` (§5.101) and `device_daily_stats` (§5.102), its days added to `collector_places` (§5.103), and its marker row. The test entrants' and the team's rows left out. Nothing is counted until the past scans' backfill is done (`tracking_state`, §5.105); meanwhile each pass logs « views not counted: past scans still being recorded » and starts again a backfill that failed (`TrackingService.resumeBackfill`, from its watermark). A day is counted once: the console's « Figures through … » is its last day (`viewsCountedThrough`). |
| View months | `viewMonths`: in the transaction of the count of a month's last Paris day (so on Paris day 1, for the month just ended), every collector with rows that month gets its row in `collector_view_months` (§5.105), written once. |
| Visits by day | Plan CUSTOMER INTELLIGENCE §3.4 A.8 (`acquisitionDaily`, `summariseDays`), after the view months, in the morning window only: each complete Paris day after `acquisition_state.daily_until` (from the recording's first day) up to yesterday, one day per transaction, at most 31 a pass: the day's visits and arrivals by source (`acquisition_touches`) and its first visits (the devices first seen that day, by their first source) into `acquisition_daily` (§5.112), `ON CONFLICT DO UPDATE` with the same figures, then `daily_until` moved. |
| Wish months | Plan CUSTOMER INTELLIGENCE §3.2 W.7 (`wishMonths`, `aggregateWishMonths`, `services/wishlist.ts`), after the activity by hour, in the morning window only (from 07:30 UTC until the Paris day ends, `services/schedule.ts` `morningWindowOpen`): counts each complete Paris month not counted yet into `model_wish_months` (§5.95) and marks it in `wish_months_counted` (§5.96), one transaction per month, ACTIVE counted collectors only (no test entrant, no team account). A month is counted once. |
| Engagement score | Plan CUSTOMER INTELLIGENCE §3.5 SB.3.3 (`engagement`, `EngagementService.runIfDue`, `services/engagement.ts`), after the wish months, in the morning window, once per Paris day, after that pass's view statistics and before any purge; never while a LIVE RELEASE's room is open or a test of test entrants is RUNNING (a later pass runs it). Claims the day in `engagement_runs` (§5.117), scores the ACTIVE accounts that are not test entrants in batches of 500 with 100 ms between two (§5.116), removes the rows of DELETED accounts and test entrants, then writes the run's end and the bands. One log line, `engagement scores calculated` (`{ job, day, accounts, changed, ms }`). Nothing audited; the score keeps no per-account history (only `collector_history`'s month). |
| Monthly history | Plan CUSTOMER INTELLIGENCE §3.6 C.10 (`collectorHistory`, `runCollectorHistory`, `services/collector-history.ts`), right after the engagement score, in the morning window, never while a test of test entrants is RUNNING: on Paris day 1, the month just ended for every counted collector, once that morning's run is finished (from 12:00 UTC without it, with no score: logged `collector history written without the morning’s score`); the table empty (the first deployment), the 12 months before the current one, without scores (`collector history back-filled: 12 months, N collectors`); any other day only the collectors a back-fill or a day 1 left behind (once a pass finds none, the rest of that Paris day skips the check: an in-process memo, as for the sizes line). Batches of 1 000, 200 ms between two (§5.118). |
| Packing photos | Plan NEXT LOT §3.5.6.8: erases `shipments.photo` (§5.85; `photo_erased_at` set, journaled `shipment.photo.erase`, never the photo) 14 days after its parcel was delivered (`RETURN_WINDOW_DAYS`, `purgePackingPhotos`, `services/parcels.ts`), unless a return or an exchange of its orders is open (erased once it is closed or cancelled); for a parcel never delivered, 14 days after its parcel problem was decided or cancelled (never while one is open), or 14 days after its shipment was cancelled while packing (Default (mine)). The photo is internal: seen by ORBES and the agent only. |
| Yearly care labels | Erases `care_requests.label_pdf` (§5.68) 30 days after its request ended, DONE or CANCELLED (`CARE_LABEL_RETENTION_MS`, `eraseCareLabels`, `services/care.ts`): the prepaid label is kept while it may be printed, and for its aftermath only. The same pass erases `warranty_claims.label_pdf` (§5.119) 30 days after its claim ended, DONE or CANCELLED (plan ORBES CARE; the privacy policy says it). |
| Emails | Lot M1 (`emailPurge`, `EmailService.purge`, `services/email.ts`), every pass, whether the emails' channel is on or not: deletes the `email_outbox` rows (§5.122) settled (sent, failed or cancelled) more than 90 days ago (`EMAIL_RETENTION_DAYS`), their address, subject and words with them; a QUEUED row is never purged. The sender itself is not housekeeping: a loop of its own every 15 s, started by `createContext` only while the channel is on, which first runs the release notices' scan (§5.124). |
| House moments | Lot M2 (`houseMoments`, `HouseMomentService.runMoments`, `services/house-moments.ts`), every pass in the morning window (from 07:30 UTC until the Paris day ends, `morningWindowOpen`), after the birthday credits: for each moment switched on (§5.125), the events due since its switch-on, delivered once each to MESSAGES (§5.127) by their key, in transactions of at most 500 (`HOUSE_DELIVERY_BATCH`), each audited by counts; one `house moments` log line a pass while a moment is on. A missed pass is caught up at the next. The custom messages are not housekeeping: `HouseSender`, a loop of its own every 30 s, always on (§5.126). |
| Vaults | Lot Q3 (`vaults`, `VaultService.expireClaims`, `services/vault.ts`), every pass, after the house moments (D20 "claimed within 30 days or back to stock"): each VAULT order at 0 still RESERVED past its `claim_by` (§5.51) is cancelled, its note *Not claimed within 30 days.*, its reserved unit back to stock, audited `order.cancel` and `vault.claim_expired`; by 100 at a time, each in its own transaction. A vault's own states (WAITING, EXPIRED) and its offers' ends are computed when read: nothing to write. |
| WORN ended | Lot M2 (`wornEnded`, `WornService.endLeft`, `services/worn.ts`), every pass: each photograph in review or published whose ownership has ended (a transfer, a return) or whose piece is REVOKED becomes ENDED and its bytes are erased (§5.128), audited `worn.end` by count. Such a photograph is no longer shown from the moment its piece left (the read-time rule): this job erases what is already hidden. |
| LIVE networks | Erases `live_entries.network_hash` (§5.39) for every release ended or cancelled 30 days ago or more (`LIVE_NETWORK_RETENTION_DAYS`, `eraseLiveNetworkHashes`, `services/live.ts`): the bot radar's keyed hash of an entry's network is kept for the release and its aftermath only. |
| Scan history | Only when `SCAN_RETENTION_DAYS` is set, and only when the scan statistics of the same pass succeeded (a scan never leaves the history before it is counted): deletes `scan_events` whose `occurred_at` is older than the period, together with the `scan_reports` (a customer's report, open or closed), `scan_tokens` and `authentication_events` that reference them (deleted first: the foreign keys are `ON DELETE RESTRICT`); in the same transaction, a message to ORBES Client Services written about one of them (`client_messages.scan_event_id`, no foreign key, §5.63) loses the scan's id and keeps its REF. Batches of 1 000 scan events, one short transaction each, at most 50 batches per pass, oldest first (`src/server/services/scan-retention.ts`). |
| View history | Plan CUSTOMER INTELLIGENCE §3.3 T.10 (`viewPurge`, `purgeViews`), after the scan history, in the morning window and only when the view statistics of the same pass succeeded: the raw rows older than 13 Paris calendar months (on 8 October 2026 the first day kept is 8 September 2025, `viewHistoryCutoff`), one whole Paris day per transaction, the oldest first, at most 7 a pass, only a day already counted whose month is written: its signed-in rows folded into `collector_view_totals` (§5.104), then the day deleted on `collector_views_at_idx`. A busy day of 100 000 rows is one transaction of about a second, once. |
| Visit history | Plan CUSTOMER INTELLIGENCE §3.4 A.8 (`acquisitionPurge`, `purgeTouches`), after the view history, in the morning window and only when the visits by day of the same pass succeeded: the visits (§5.109) older than 13 Paris calendar months (`viewHistoryCutoff`, the views' cut-off) whose day is summarised, batches of 5 000, at most 20 a pass. A device's first source lives on in `account_sources` (§5.110) when it had an account, and in `acquisition_daily` as a first visit. |
| Wish history | Plan CUSTOMER INTELLIGENCE §3.2 W.7 (`wishHistory`, `purgeWishHistory`), after the scan history, in the morning window and only when the wish months of the same pass succeeded: deletes the removed wishes of `account_wishes` (§5.94) older than 13 Paris months (`WISH_HISTORY_MONTHS`) whose month of removal is counted, batches of 1 000, at most 20 a pass, each its own short transaction. Open wishes are never purged. |
| Ad purge | Lot M4 (`adsPurge`, `AdsService.purge`), every pass, whether the switch is on or not, before the devices: the ad events 90 days after they settled (`AD_EVENT_RETENTION_DAYS`, from `settled_at`), the click ids 90 days after the click (`AD_CLICK_RETENTION_DAYS`), a device's advertising choices made signed out 13 months after they were made (the visits' months); an account's choices are kept with the account, the proof of consent. |
| Devices | Plan CUSTOMER INTELLIGENCE §3.3 T.10 (`devicePurge`, `TrackingService.purgeDevices`), after the view and wish histories, in the morning window, in a pass whose view statistics and visits by day succeeded (a failed count purges no device): deletes the `tracking_devices` (§5.98) never linked, not marked staff, unseen for 13 Paris calendar months and with no row left in `collector_views` nor a visit in `acquisition_touches` (after the visit history), nor, since lot M4, an advertising choice or a click id (`ad_consents`, `ad_clicks`, after the ad purge), at most 5 000 a pass, once the views waiting in memory are written. |
| Intelligence sizes | Plan CUSTOMER INTELLIGENCE §3.3 T.10 (`sizes`, `intelligenceSizes`), the pass's last job, once a Paris day in the morning window: one log line `intelligence sizes` with `pg_total_relation_size` of the lot's growing tables that exist (`collector_views`, `tracking_devices`, `view_daily_stats`, `account_wishes`, `account_profiles`, `account_tastes`, the acquisition's `acquisition_touches` and `acquisition_conversions` once they exist, and since lot M2 `house_deliveries` and `worn_photos`) and their total: the figures of the 50 MB backup watch (§11), read with `docker compose logs app \| grep 'intelligence sizes'`. The same figures are kept in memory (`IntelligenceSizes`, `ctx.services.intelligenceSizes`) for Server status's VISITOR DATA line (API §13.5 `visitorData`, plan §3.4 A.10.7), read once on demand while the process has measured none; its total is the sum of its parts, so the house deliveries and WORN's photographs, measured on the same line, are not counted as visitor data. |

Rows deleted by the application: `sessions`, `scan_tokens`, and, with a retention period, old `scan_events` with their `authentication_events` and `scan_reports`; the emails 90 days after they settle (§5.122), the ad events 90 days after they settle, the click ids 90 days after the click and a device's advertising choices made signed out after 13 months (§5.156 to §5.158, lot M4), and a pre-registration with its emails when ORBES Client Services erases it on request (§5.120, lot M1); never a house delivery nor a WORN photograph's row (lot M2: the database refuses it), whose bytes alone are erased at each end (§5.128); and, outside housekeeping, a photograph of `media_objects` as soon as no model, no gallery, no circle post, no LIVE RELEASE's silhouette and no piece uses it (§5.26), a gallery's row when the console removes its photograph (§5.28), a circle photograph's row likewise (§5.32), and a tier's row when the console restores its words by default (§5.36); and, outside housekeeping and only when an ADMIN asks, by the database's own definer functions of lot PURGE: an ended test's rows and its test accounts, with a tombstone for each audit entry (§5.74, §5.159), and, before the launch, every table the platform reset wipes (§5.161). Every other table grows monotonically: `drops` and `drop_entries` (§5.29, §5.30) keep every release and every entry, withdrawn, reserved or concluded, as long as the account exists; `shop_requests` (§5.37) keeps every request of the private salon, open or closed, with the account's note and the console's closing note, as long as the account exists (exported with it, API §16.13; a lock closes the open ones, it deletes none); `circle_posts` keeps every post, withdrawn or not; `circle_rsvps` and `circle_poll_votes` keep the answers and votes as long as the account exists (exported with it, API §16.13); `circle_daily_visits` keeps a count per day, which names nobody; the LIVE RELEASES (§5.38 to §5.45) keep every release, size, entry and its add-ons as long as the account exists (exported with it), but `live_interest` loses a row when its account withdraws it, `live_entry_addons` when a piece is given back or a hold ends (until `0060` dropped it; since lot Q2 a hold's `addon_choices`, its engraving's words with them, likewise), and `live_entries.network_hash` is erased 30 days after the release's end (above); `live_messages` keeps every line. LIVE RELEASE+ (§5.46 to §5.61): the stock ledger, the orders' history, the returns, the invoices and credit notes and the event journal are never changed nor deleted; `orders`, `bench_items` and `after_room_guests` keep every order, piece to make and guest; `release_answers` keeps each account's answer, changed in place, as long as the account exists (exported with it); `segments` keep their rules until the console deletes one (never a member); `activity_hourly` keeps its counts, which name nobody; `sku_thresholds` loses a row when its minimum is cleared. MESSAGES (§5.62, §5.63): `client_conversations` and `client_messages` keep every conversation and message as long as the account exists (exported with it, API §16.13; the database refuses a message's deletion); only a message's `scan_event_id` is cleared, with its scan. The yearly care (§5.68): `care_requests` keeps every request, cancelled or done, with its return address, as long as the account exists (exported with it; the database refuses its deletion); only its `label_pdf` is erased, 30 days after it ends (above). YOUR SIZES (§5.71): `account_sizes` keeps a saved size until its account clears it, which deletes its row (exported with the account, API §16.13). PAIRS WELL WITH (§5.72): `model_pairs` loses a model's rows when the console changes its pairs; it names nobody. `claim_code_renewals` (§5.76) keeps every new claim code made, forever (never deleted, like the orders it names); a buyer's code is held there only sealed, and only while it waits for its one reading. YOUR PROFILE and YOUR WISHLIST (§5.92 to §5.96): `account_profiles` and `account_tastes` keep the profile and its tastes as long as the account (an unticked taste is a deleted row); `account_wishes` keeps an open wish as long as the account and a removed one 13 Paris months, then the wish history job deletes it once its month is counted; `model_wish_months` and `wish_months_counted` keep the monthly counts for good, naming nobody. What collectors look at (§5.97 to §5.105): `collector_views` keeps its raw views and scans **13 Paris calendar months** (the owner's choice), then the view history job folds each collector's rows into `collector_view_totals` and deletes the day; a device marked staff loses its rows at once; `tracking_devices` loses a device never linked, unseen for 13 months and with no row left (the devices job); `geo_places`, `tracking_device_accounts`, `view_daily_stats`, `device_daily_stats`, `collector_places`, `collector_view_totals` and `collector_view_months` are kept for good (the daily totals name nobody; the summaries and places are exported with the account, API §16.13 `browsing`). Where they come from (§5.106 to §5.113): `acquisition_touches` keeps its visits **13 Paris calendar months**, then the visit history job deletes each day once `acquisition_daily` holds it; `link_channels`, `links`, `acquisition_sources`, `account_sources`, `acquisition_conversions`, `acquisition_daily` and `acquisition_state` are kept for good (the first source and the last links are exported with the account, API §16.13 `origin`). No erasure on request is built: it belongs to the legal work before launch.

**Retention period.** `SCAN_RETENTION_DAYS` (whole days, 30–3650) is unset by default: scan history is then kept indefinitely, and production logs a `risky configuration` warning at every start. The period itself is a legal decision, to agree with counsel. Points to consider:

- the stored scan data is pseudonymous (HMACs of IP, device and session; coarse location; browser family), but pseudonymous data is still personal data in many jurisdictions; a customer's report (§5.22) adds their own words, which may name a person or a place, and goes with its scan;
- anomaly scoring only reads the recent history of a code (the longest of the configured windows and the decay period: 30 days with the default settings), so older scans are not needed for scoring. The configuration refuses a period shorter than that look-back (`scanLookbackDays` in `config.ts`);
- `anomalies` rows are not purged: they are case records reviewed by staff, keyed to the product, and keep their own first/last-seen times; `audit_logs` cannot be purged by the application and must not be edited, since that breaks the hash chain;
- the product page's scan count and the dashboard's scan figures count only the scans still stored; the console's Analytics view reads `scan_daily_stats` (§5.24), which keeps the counts by day, country, state and event type of every purged scan: a short period loses no trend, only the pseudonymous detail of each scan;
- rotating `IP_HASH_PEPPER` makes new pseudonyms unlinkable to old ones (which also resets device and IP diversity counting).

---

## 11. Backup, restore and point-in-time recovery

These are operational recommendations; the code does not implement backups.

**What a backup contains.** Product registry, codes and signatures, public keys, accounts (email, display name), staff accounts, password, claim-code and recovery-code hashes, sealed TOTP secrets, pseudonymous scan data, the views, devices and places recorded on verify.theorbes.com (§5.97 to §5.105, pseudonymous until linked to an account), the visits and their sources, the console's links, each collector's first source and the last link of each act (§5.106 to §5.113), Client Services' private notes and tags on clients (§5.114, §5.115) and the audit log. It contains **no private signing keys** (they live in the key provider: `KEY_DIR` files encrypted under `KEY_ENCRYPTION_KEY`, or a KMS/HSM) and no usable session, registration or transfer tokens (only their hashes).

Recommendations:

1. **Continuous archiving with point-in-time recovery.** Use PostgreSQL WAL archiving plus periodic base backups (or the managed equivalent), so the registry can be restored to any moment before an incident such as a faulty bulk change or a compromised admin.
2. **Encrypt backups and restrict access** like the production database: they contain personal data and the pseudonymous scan history. Store `COOKIE_SECRET`, `IP_HASH_PEPPER` and `KEY_ENCRYPTION_KEY` in a secret manager, separately from database backups. A database backup plus `KEY_ENCRYPTION_KEY` (or `COOKIE_SECRET` when no key encryption key is set) is enough to open the stored TOTP secrets.
3. **Back up key custody separately.** Losing the private keys does not affect verification (public keys are in the database) but prevents issuing codes under those keys; rotate to a new key in that case. Never place key files in the same backup set as the database without separate encryption.
4. **Anchor the audit chain.** Export the head returned by `GET /api/admin/audit/verify` (`head.id`, `head.hash`) regularly to write-once storage. After any restore, run `GET /api/admin/audit/verify` and compare the restored head with the last exported anchor: a point-in-time restore legitimately drops the newest entries, and the anchor shows how many. Since lot PURGE an export takes the tombstones too, and a platform reset starts a new log whose entry 1 names the old one's head (below).
5. **Restore into an empty database.** `audit_logs` rejects `TRUNCATE`, `DELETE` and `UPDATE`, and categories cannot be deleted, so a restore over existing data fails by design.
6. **Use separate roles.** Let a migration role own the schema and give the application role only `SELECT`, `INSERT`, `UPDATE` and `DELETE` on the tables, `USAGE` on the sequences and `SELECT` on `kysely_migration` (the production start-up check reads it). The guard triggers stop the application role, but a table owner or superuser can disable them.
7. **Test restores** on a schedule: restore, start a server against the copy (it refuses to start if migrations are missing), verify the audit chain and verify a known code end to end.
8. **A restore must not bring the reset back** (lot PURGE). Until the first lot after the launch removes the reset, a dump from before LOCK RESET restored on a server meant to stay would bring back a working, unlocked PLATFORM RESET; a dump from before lot PURGE gets an unlocked gate from the image's migrations. On such a server, read it, read only, before the app is used: `SELECT launched_at FROM platform_reset_gate`; it must not be NULL, otherwise stop the app, or have the holder press LOCK RESET before anything else (DEPLOYMENT §10).

**The auditor's export since lot PURGE.** The chain is `audit_logs` **and** `audit_purge_gaps` (§5.159) merged in id order, so a plain export takes both:

```sql
SELECT id, 'entry' AS kind, prev_hash, hash, occurred_at, actor_type, actor_id, action, target_type, target_id, details, ip_hash
  FROM audit_logs
UNION ALL
SELECT id, 'tombstone', prev_hash, hash, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM audit_purge_gaps
 ORDER BY id;
```

Walk it from the 32 zero bytes: an entry is hashed again (§5.21) and must link to the running hash; a tombstone cannot be hashed again (its content is gone with its test), so its `prev_hash` must equal the running hash and its `hash` becomes the running hash, which the next row must link to. A missing id with no tombstone, an id twice, or a tombstone nothing links to after it is a break; `GET /api/admin/audit/verify` walks exactly this (API §17.6) and says how many tombstones it stepped over (`purged`).

**Across a platform reset: linking the old log to the new one through entry 1's old head.** A reset (§5.160) empties the log; the new one starts at **entry 1**, `platform.reset`, whose `prev_hash` is the 32 zero bytes: the two chains are not linked by a hash, but entry 1's own hash covers its `details.oldHead` `{ id, hash }`, the last entry of the old log as the reset read it in its own transaction. To link them, take **the last nightly dump from before the reset** (the host's archive, §11 above, DEPLOYMENT §15.8): restore it on a separate, disposable server, never production, walk its chain as above, and read its last entry's id and hash; then, on the live database, check that entry 1 is `platform.reset` from the genesis hash and that the new chain verifies. When the dump's last entry **is** `details.oldHead`, the two logs are one history. When the dump stops earlier (the entries written between the dump and the reset are gone with the reset: among them always the request's own `admin.step_up` and `platform.reset.requested`, whose ids entry 1 names as `stepUpId` and `requestId`), the dump's chain must still verify, its last id must be below `oldHead.id`, and `oldHead.id − ` its last id is the number of entries only entry 1 still accounts for; an exported anchor (recommendation 4) taken after the dump narrows it. Write the reset's date next to every anchor kept: the new log restarts at 1.

**The backup-size watch** (plan CUSTOMER INTELLIGENCE §8, the owner's rule of 7 October 2026). Once one nightly backup passes **50 MB**, the decision on what to keep goes back to the owner with the numbers; until then every view is kept 13 months. Today's nightly backup is about 8 MB. The figures:

- the newest archive's size: `ls -lt /var/backups/orbes/daily/ | head -n 4` on the box;
- the morning's `intelligence sizes` log line (§10): `docker compose logs app | grep 'intelligence sizes'`, the bytes of each of the lot's growing tables and their total;
- or, read only, in `psql` on the box:

```sql
SELECT relname AS table, n_live_tup AS rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS on_disk,
       pg_size_pretty(pg_relation_size(relid)) AS data
  FROM pg_stat_user_tables
 WHERE relname IN ('collector_views', 'tracking_devices', 'tracking_device_accounts', 'view_daily_stats', 'device_daily_stats',
                   'collector_places', 'collector_view_totals', 'collector_view_months', 'geo_places',
                   'account_wishes', 'account_profiles', 'account_tastes',
                   'acquisition_touches', 'acquisition_conversions', 'account_sources', 'acquisition_daily', 'acquisition_sources')
 ORDER BY pg_total_relation_size(relid) DESC;
```

A backup holds a table's data, never its indexes: `data` is the nearer figure, compressed about tenfold for `collector_views` (§11.1). At the plan's unit (1 000 visitors a day) the whole lot's backup passes 50 MB after about 5½ months and settles near 105 MB; under about 440 visitors a day it stays under the line.

### 11.1 The views' sizes, measured

Plan CUSTOMER INTELLIGENCE §3.3 T.7 and §8, step 3.7. Measured on 9 October 2026 with `genome/scripts/views-size.ts` (dev only; `npx tsx scripts/views-size.ts --dir <new directory>`, or on a throwaway PostgreSQL database with `ORBES_TEST_POSTGRES_URL`) on PGlite 0.5.8 (PostgreSQL 18.3 compiled to WASM, the same pages and tuples), its data directory on disk:

- **The fill.** 1,000,000 synthetic rows of `collector_views` spread over 13 Paris calendar months in time order (visits of 8 rows of one device, 30 % of the devices signed in, 1 row in 80 a SCAN, a model or a release as subject of 45 % of the rows), 240,000 `tracking_devices` (600 a day; their pseudonyms 43 base64url characters of a SHA-256), 72,000 `tracking_device_accounts`, 10,000 accounts and 300 places; then the daily job over every day (395 days, 13 months).
- **The cycle.** One month later, `purgeViews` folded and deleted the oldest month (75,949 rows, 30 Paris days, one day per transaction), `VACUUM` freed its pages (autovacuum's work), a month of new rows (78,398) was written and counted. The table kept its size (69.1 → 69.3 MB): the new rows went into the freed pages.
- **Disk:** `pg_relation_size` (the table), `pg_indexes_size`, `pg_total_relation_size`, after the cycle, divided by the rows.
- **Backup, an estimate:** each table's COPY text compressed with zlib level 6, which is what `pg_dump --format=custom --compress=6` writes for a table's data (indexes are not in a dump). Synthetic rows compress a little better than real ones; the real nightly `pg_dump` is the figure to trust once the recording runs (the morning's `intelligence sizes` log line, §10).

| Table | Rows measured | Table, B/row | Indexes, B/row | Disk, B/row | Backup, B/row (estimate) |
|---|---|---|---|---|---|
| `collector_views` | 1,002,449 | 72.5 | 139.2 (primary key 24.2, `at` 24.2, device 52.5, account 38.3) | **211.8** | **17.7** |
| `tracking_devices` | 240,000 | 134.3 | 144.9 (the unique pseudonym 86.9) | **279.4** | **46.6** |
| `tracking_device_accounts` | 72,000 | 84.5 | 50.4 | 135.5 | 31.4 |
| `view_daily_stats` | 44,730 | 76.7 | 50.0 | 127.5 | 6.8 |
| `device_daily_stats` | 8,520 | 87.5 | 70.2 | 162.5 | 3.4 |
| `collector_places` | 9,000 | 115.6 | 79.2 | 198.4 | 24.1 |
| `collector_view_totals` | 18,044 | 93.5 | 76.7 | 171.6 | 23.5 |
| `collector_view_months` | 39,780 | 68.4 | 52.7 | 121.9 | 24.4 |
| `geo_places` | 300 | — | — | 0.1 MB in all | — |
| `tracking_state` | 1 | — | — | 56 KB in all (its pages) | — |

**At the plan's unit** (1,000 visitors a day: 8,000 rows and 600 new devices a day), from these bytes: `collector_views` 1.7 MB of disk and 0.14 MB of backup a day, ≈ 670 MB and ≈ 56 MB once its 13 months are full (≈ 3.2 M rows); `tracking_devices` 0.17 MB and 0.03 MB a day, ≈ 67 MB and ≈ 11 MB at 240,000 unlinked devices. A nightly backup of today's ≈ 8 MB passes 50 MB after about 8 months for the views and devices alone (5½ months with the whole lot's tables, plan §8) and settles near 75 MB (105 MB for the whole lot). At today's ≈ 50 visitors a day, divide by 20.

**The day query after the cycle.** `EXPLAIN (ANALYZE, BUFFERS)` of the daily count's `SELECT` for a refilled Paris day (2,525 rows): a Bitmap Index Scan on `collector_views_at_idx` (9 index pages), then a Bitmap Heap Scan of 23 heap pages of 8,869, about 6 ms; no sequential scan of `collector_views`. The day's rows sit together in the pages the purge freed, and the b-tree on `at` finds them whatever pages they reuse (a BRIN range would have widened to the whole 13 months; plan §3.3 T.6).

To measure again on PostgreSQL: `ORBES_TEST_POSTGRES_URL=postgres://… npx tsx scripts/views-size.ts` (a throwaway database, dropped at the end; its backup estimate rebuilds COPY's text column by column, the driver having no COPY stream). The real `pg_dump -Fc -Z6` of a filled database is the hand-over's.

### 11.2 The visits' sizes, measured

Plan CUSTOMER INTELLIGENCE §3.4 A.6 and §8, step 4.12. Measured once on 9 October 2026, with a dev-only measuring script not kept in the repository (the plan names only `scripts/views-size.ts` and `scripts/bench.ts --arrivals`), on **PGlite** 0.5.8 (PostgreSQL 18.3 compiled to WASM, the same pages and tuples), its data directory on disk. These are PGlite figures; the box runs PostgreSQL 17, and its re-measure is the owner's (the hand-over).

- **The fill** (the one `scripts/bench.ts --arrivals` makes for the Links report, `fillAcquisition` in `scripts/bench-arrivals.ts`): 13 Paris calendar months (396 days) at the unit of the plan's §8, each day 600 new devices (half arriving Direct), 1,000 visits with a source (about 50 sources a day: the 30 links, 15 sites, the day's 5 campaigns), 100 sign-ups with their first source and SIGNUP conversion, 60 draw entries and 40 orders of the salon (one in twenty cancelled), each with its conversion; every day but the last summarised by the job itself (`summariseDays`). Then `VACUUM ANALYZE`.
- **Disk:** `pg_relation_size` (the table), `pg_indexes_size`, `pg_total_relation_size`, divided by the rows.
- **Backup, an estimate:** each table's COPY text compressed with zlib level 6, what `pg_dump --format=custom --compress=6` writes for a table's data (indexes are not in a dump), as §11.1.

| Table | Rows measured | Table, B/row | Indexes, B/row | Disk, B/row | Backup, B/row (estimate) |
|---|---|---|---|---|---|
| `acquisition_touches` | 395,960 | 92.1 | 148.4 | **240.6** | **16.4** |
| `acquisition_conversions` | 77,726 | 103.5 | 191.6 | **295.6** | **41.8** |
| `account_sources` | 39,600 | 76.7 | 47.8 | 125.6 | 29.7 |
| `acquisition_daily` | 20,147 | 52.5 | 39.4 | 93.5 | 2.9 |
| `acquisition_sources` | 2,313 | 124.0 | 177.1 | 318.8 | 11.7 |
| `links`, `link_channels`, `acquisition_state` | 30, 7, 1 | — | — | 0.3 MB in all (their pages) | — |
| `tracking_devices.first_source_id` | 237,600 devices | 4 (the column) | 36.7 (`tracking_devices_first_source_idx`) | ≈ 41 | 0.9 |
| `drop_entries_created_idx`, `orders_reserved_idx` | 22,286, 15,840 | — | 29.0, 29.5 | — | — (not dumped) |

**At the plan's unit** (1,000 visits with a source a day), from these bytes: `acquisition_touches` 0.24 MB of disk and 0.016 MB of backup a day, ≈ 91 MB and ≈ 6.2 MB once its 13 months are full (≈ 396,000 rows; §3.4 A.6 planned ≈ 75 MB and ≈ 14 MB: its indexes weigh more, its data compresses better); `acquisition_conversions` (≈ 200 a day) ≈ 22 MB of disk and ≈ 3.2 MB of backup a year (planned ≈ 11 and 3: its three indexes weigh more); `account_sources` ≈ 4.6 MB and ≈ 1.1 MB a year; `acquisition_daily` ≈ 1.8 MB and ≈ 0.06 MB a year; the first source's index ≈ 8 MB at 240,000 devices. With these bytes the whole lot's nightly backup at the unit settles near 97 MB instead of §8's 105 MB (the visits ≈ 6 MB instead of ≈ 14 MB); §8's figures stay the plan's until the owner's re-measure.

The real `pg_dump -Fc -Z6` of the box and the morning's `intelligence sizes` line are the figures to compare (§11): they replace these once I1 runs there.

### 11.3 The arrivals beside a LIVE room, and the Links report, timed

Plan CUSTOMER INTELLIGENCE §3.4 A.14 and A.15, step 4.13. Measured on 9 October 2026 with `npx tsx scripts/bench.ts --arrivals` (`scripts/bench-arrivals.ts`) on an Apple M2 Pro (10 cores, Node 24, the machine otherwise loaded: load average about 6), **PGlite** 0.5.8 (PostgreSQL 18.3 compiled to WASM, one connection that every transaction holds in turn, where the box's PostgreSQL 17 has a pool of ten).

- **The room.** Three processes, as `scripts/live-load.ts` runs them: the app (its own `createContext`, `buildApp` and LIVE engine, the production rate limits), PGlite alone in its own process over a socket, and the driver. A LIVE RELEASE of 60 pieces, T0 a minute in, 200 test entrants sent by `services/test-entrants.ts` (200 TITANE over 30 s; both runs sold out, DONE, no runner error). Five minutes once without arrivals, once with **1,000 arrivals a minute** (5,001 `POST /api/v1/seen` with the page load's `a` and no view over HTTP: half new devices, a third through a console link, a third with campaign tags, a third from a site or direct; every answer 204; 3,684 visits and 2,501 first sources recorded).

| Measure (5 minutes) | n | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|
| An arrival, request sent → answer read (the arrival written inside) | 5,001 | 5.9 | **12.7** | 33.0 | 74.3 |
| A LIVE engine pass, without arrivals | 1,194 | 3.1 | 26.1 | 42.0 | 60.7 |
| A LIVE engine pass, with arrivals | 1,194 | 2.3 | 9.1 | 13.5 | 82.0 |
| … from T0 (the line and the turns), without | 956 | 3.3 | 30.5 | 42.5 | 60.7 |
| … from T0, with | 956 | 2.6 | 9.5 | 14.1 | 82.0 |

The arrivals' p95 is under the 20 ms target. No percentile of the engine's passes is slower with the arrivals (the two runs' rooms differ by their test entrants' random choices: 23 places released without, 13 with); a single pass reached 82 ms against 61 ms without. The database's process used 0.083 of a core without the arrivals and 0.136 with them (+0.05 core for 1,000 arrivals a minute); the app's, 8.3 s and 17.7 s of CPU over the five minutes.

- **The Links report** (`AcquisitionReportService.report`, ALL TIME, its three views; 15 readings each after 2 to warm up), on 13 months at the unit (`fillAcquisition`, the fill of §11.2: 395,960 visits, 20,148 daily rows, 39,600 accounts, 77,749 conversions, 22,309 entries, 15,840 orders, 16,681 invoices and credit notes; today's visits raw), PGlite in memory **in the bench's own process**. Measured again on 10 October 2026 with the same command, once `returns()` read from the costed links (below):

| View | p50 ms | p95 ms | max ms |
|---|---|---|---|
| LINKS (with each costed link's RETURN, SINCE MADE) | 260.9 | **293.5** | 293.5 |
| CAMPAIGN TAGS | 234.9 | 339.7 | 339.7 |
| REFERRING SITES | 233.7 | 288.6 | 288.6 |

LINKS is under the 300 ms target. On 9 October it read 294.6 ms p50 and **307.7 ms p95**: the facts of every counted collector (about 200 ms), then the returns' pass, which built the counted collectors over every account and joined every invoice (about 70 ms). `returns()` now reads the costed links' sources first (a few rows), then by index only their buyers: the accounts whose first source they are (`account_sources_first_idx`) and the orders whose conversion names them (`acquisition_conversions_last_idx`), then those orders' invoices, the counted-collector rule checked for those buyers only (the Before tracking and Direct fallbacks are never a link, so the figures are the same: `test/services/acquisition-report.test.ts`). The pass went from about 70 ms to about 24 ms. CAMPAIGN TAGS and REFERRING SITES read no return, and their code did not change: on 9 October they read 234.8 and 239.4 ms p95; in this run one reading of CAMPAIGN TAGS of the 15 met a busy machine (its p95 here is that one reading; its p50 is unchanged). The same three views read 30 times each after the same fill, on the same day, in a process of their own: LINKS p50 258.8, p95 275.8, max 296.9 ms; CAMPAIGN TAGS 233.8, 241.0, 241.7; REFERRING SITES 231.5, 236.0, 236.7. The bench's fill now ends in the morning window of today's Paris day whatever the hour it runs (the job summarises the days in that window only; run at night, it summarised none and the report read every visit raw). On PostgreSQL: `ORBES_TEST_POSTGRES_URL=postgres://… npx tsx scripts/bench.ts --arrivals` (or the same in genome-ci) times the report on a throwaway database (dropped at the end); the room stays on PGlite in its own process.

### 11.4 The Collectors page and Segments, timed

Plan CUSTOMER INTELLIGENCE §3.6 C.5.3, C.6.8 and C.13, step 9.14. **On PostgreSQL** the test is `genome/test/perf/collector-insights.perf.test.ts` (opt-in like every PostgreSQL suite, run by genome-ci; a throwaway database, dropped at the end): it writes the house of `test/perf/collector-insights.house.ts`, then holds each panel, Over time's eight figures and six lists to the budgets below on the view the page opens on (LAST 30 DAYS, compared with the period before, every collector; the best of three cold readings, the page's cache emptied before each), EXPLAINs every statement of What they like over LAST 12 MONTHS that reads `collector_views` (never a sequential scan of it), times Segments with every new criterion in one segment (C.5.3; each rule names the values of one collector of the house, a member under ALL and under ANY, and ANY is timed for accounts that match none of the rules too, so every rule is read) and the export of 20,000 collectors (C.7: under 20 MB), and holds the same readings over LAST 12 MONTHS to the same budgets, except devices and likes (below), whose 12-month readings it prints only. Its figures are in genome-ci's log (`[collector-insights.perf]`); a reading over its budget fails its case without ending it, so every reading is still taken and printed.

- **The house** (C.6.8's stress volume): 20,000 counted collectors (one in 200 LOCKED), 5,000 test accounts, 2 team accounts and 200 DELETED ones, made over the 13 months of the recording and the year before, each with a profile (a date of birth for seven in ten, a city for six in ten), tastes and wishes on 32 models; ≈ 89,700 devices; **3,000,000 raw views** over 13 Paris months in time order, their 395 days counted and their 13 months written by the views' own job (`aggregateViews`), the visits summarised by theirs (`summariseDays`); 13,000 pieces held over the three tiers, 6,000 paid orders with their invoices, 30,000 draw entries, 40,000 scans, 150,000 sign-ins; a score for 18,000 collectors and 19,555 monthly histories; then `VACUUM ANALYZE`.
- **Measured here on PGlite** on 14 October 2026, with the fixes of genome-ci's first two runs (below) (PGlite 0.5.8, PostgreSQL 18.3 compiled to WASM, one connection, its data directory on disk; an Apple M2 Pro, Node 24, a machine shared with other builds), the same readings through `CollectorInsightsService` and `SegmentService`, the best of three cold readings (two over 12 months). PGlite runs single-threaded in WASM, without JIT nor parallel query: these are a pessimistic picture of a PostgreSQL server's reading, and say nothing of its JIT. genome-ci's log gives the figures on PostgreSQL 16 on its GitHub runner; the box runs PostgreSQL 17.

| Panel | Budget (C.6.8) | LAST 30 DAYS, ms | LAST 12 MONTHS, ms |
|---|---|---|---|
| overview | 800 | 338 | 349 |
| who | 600 | 230 | 225 |
| origin | 1,200 | 303 | 566 |
| likes | 2,000 | 665 | 2,274 |
| devices | 500 | 261 | 1,523 |
| engagement | 800 | 343 | 329 |
| trends, each figure | 2,000 | 11 to 279 | 25 to 1,079 (*Active collectors*) |
| list, six slices | 500 | 25 to 123 (*dormant*) | — |

Segments with the 15 new criteria in one segment, each naming the values of one collector of the house (the best of three): `count` 12 ms for ALL of them (1 member, that collector) and 623 ms for ANY of them (16,119 members: test accounts left out since SF-B), against 1.5 s; `isSegmentMember` 2.8 to 3.8 ms for each of 26 accounts (that collector, 20 others, and 5 that match none of the rules under ANY, each reading all 15; measured before the fixes, which do not touch it), against 20 ms. The export of the 20,000 collectors: 11.5 MB. What they like over 12 months reads `collector_views` through `collector_views_account_idx` (one probe per collector) and `collector_views_at_idx` (the previous period's *Collectors seen*), never whole, whether PostgreSQL plans parallel query or not.

**What the measure changed** (step 9.14, the same figures read with less work): the usual place from the connection is read once for every collector (who 768 → 232 ms: a lookup per collector hashed the whole of `geo_places` each time); ACTIVE AND DORMANT reads each collector's latest act once (`OFFSET 0`: inlined, its three tests read the six indexes three times; engagement 2,160 → 862 ms); Over time's active collectors keep one row per collector, kind of act and bucket (12 months 2,639 → 1,082 ms); a list reads its count and its page in one statement (*dormant* 2,257 → 428 ms). No index was added.

**What genome-ci's first run on PostgreSQL changed** (run 38581504131 on d3f7b4e, postgres:16; INT-P1 to INT-P3). Four readings were over budget, At a glance (2,103.5 ms over LAST 30 DAYS, 1,195.5 over 12 months, against 800), the *dormant* list (1,155.2, against 500) and Segments' `count` under ANY (2,349.2, against 1,500), and What they like over 12 months planned a sequential scan of `collector_views`. None of it showed on PGlite, which has no JIT and plans no parallel query:
- **JIT.** PostgreSQL costs a per-collector EXISTS or max() by its per-row form (20,000 collectors × six index probes) even where it runs it hashed, once. So statements read in a fraction of a second were costed from 0.5 to 9 M, above `jit_inline_above_cost` and `jit_optimize_above_cost` (500,000), and LLVM compiled each for about a second at every reading; every reading that passed stayed under 100,000. The page's readings (`CollectorInsightsService`, `LikesService`) and Segments' count and CSV run with `SET LOCAL jit = off` (connection.ts `jitOff`); the box's PostgreSQL 17 has JIT on by default too. The test prints the server's `jit` and `pg_jit_available()` in its log.
- **Parallel query.** With PostgreSQL's default `max_parallel_workers_per_gather` (2), a parallel sequential scan of the 3 M views cost less than the account index for MOST VIEWED, COLLECTORS. Over more than 60 Paris days (`LIKES_PROBE_AFTER_DAYS`) it now reads each collector's own views, a probe of `collector_views_account_idx` that cannot be turned into a join (`OFFSET 0`); within 60 days, the period's views by time as before.
- **ACTIVE AND DORMANT** is decided with EXISTS instead of the latest act of each kind: the acts of the window read once, hashed, and a collector's own indexes only where they do not decide (engagement 840 → 336 ms over LAST 30 DAYS, *dormant* 412 → 122 ms, on PGlite; `test/services/collector-status.test.ts` holds it to the six max() form on the rule's edges).

The figures and lists are the same, compared byte for byte on the house before and after. No index was added. In that run the test ended each case at its first reading over budget, so it never read who, origin, likes, devices and engagement over LAST 30 DAYS, the other panels and Over time's figures over 12 months, nor `isSegmentMember` under ANY; it now takes them all (INT-P5).

**What genome-ci's second run changed** (run 38600110872 on a9651c2, postgres:16; INT-P6). Every reading the first run stopped before was taken and held its budget but one: Devices over LAST 30 DAYS, 579.2 ms against 500. PGlite's planner, with genome-ci's `max_parallel_workers_per_gather` 2 and the reading's JIT off, plans no parallel plan for these statements (genome-ci's own plans are in its log, not read); the reading took each period's rows of `collector_views` twice, once for BY COLLECTORS and once for BY VISITS, each time rebuilding the counted collectors and sorting the same rows: 438 ms against 500 on PGlite. `devicesDetailReport` now reads BY COLLECTORS and BY VISITS of a period together: one sort of the period's rows by collector and device for the visits, each collector's main device chosen from the same pairs (the most time, the most rows, the latest, the lowest id: `mainDeviceOrder`, written once for `mainDevices` and the export's main device too), and the devices' class joined once per device. The same reports byte for byte on the house (18 requests of the page: 7 and 90 days, 12 months, two custom periods, without comparison, the scopes, the country, tier, score and source filters, alone and together; `test/services/tracking-reads.test.ts` holds it to `devicesReport` on the 13 months' edges, and each tie-breaker of the main device in BY COLLECTORS, the page's device slices and the export); on PGlite, measured on 14 October 2026 in interleaved rounds, best of three cold readings, 444 → 261 ms over LAST 30 DAYS (median of five rounds 446 → 263) and 2,353 → 1,523 ms over 12 months. No index was added, no budget changed.

**Over 12 months**, BY VISITS (Devices) and What they like read about a million raw rows of the 13 months: they stay within the page's 8 s timeout, beyond C.6.8's per-panel figures. The test holds every other panel and Over time's figures to their budgets over 12 months too, and prints these two only, a decision left to the owner. Should the box's figures in genome-ci's log call for it, the lever is C.6.8's own: `collector_view_months` and `collector_history.active` for the months already closed.


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
