# ORBES GENOME CODE — developer guide

ORBES GENOME CODE is the product identity and authentication system for ORBES products. It has three parts:

- **ORBES GENOME** gives each product a unique, deterministic visual identity: 8 glyphs from a 16-glyph orbital vocabulary, derived from the canonical product id (`O26-J-00184`).
- **ORBES CODE** carries that identity: a printed or engraved, Ed25519-signed, Reed-Solomon-protected orbital code around the **ORBES SEAL**.
- **The verification service** (Fastify + PostgreSQL) answers a scan with one of nine honest states (`AUTHENTIC`, `REVOKED`, `INVALID_SIGNATURE`, …). It also keeps the product registry, the lifecycle, ownership, warranty and anomaly detection, a mobile scanner at `/verify` that needs no app, and an admin console at `/admin`.

A valid signature proves that ORBES issued the code. It does not prove that the object carrying it is the original; see [THREAT-MODEL](../docs/THREAT-MODEL.md).

Architecture overview: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). Production runbook: [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

---

## Directory layout

```
genome/
  src/core/            isomorphic library (browser + Node; no node:* imports, no Buffer)
    bytes.ts identity.ts payload.ts geometry.ts
    code-profiles.ts     code-version registry (CODE_PROFILES): profile per version, payload dispatch
    ecc/                 GF(256) Reed-Solomon (errors + erasures), BCH(15,5), CRC-16
    genome/              GENOME-01 vocabulary, bijective permutation, renderer
    code/                CODE-01 profile (single source of truth), encoder, colourways, SVG renderer
    decoder/             camera image → decoded payload (runs in a Web Worker in the browser)
    verify/              isomorphic Ed25519 verification (@noble, strict RFC 8032)
    render/              shared vector primitives → SVG paths; the brand monogram's outlines; print-sheet grid; workshop CSV
  src/server/          Fastify service (Node only)
    config.ts            environment → AppConfig (zod; fail fast; production hardening)
    context.ts           wiring: database, migrations, services, bootstrap admin, key self-test, housekeeping
    index.ts             entry point (npm start), graceful shutdown
    app.ts               HTTP app: plugins, security headers, rate limits, routes, static web
    db/                  Kysely schema, migrations, connection (pg | PGlite), demo seed
    keys/                KeyProvider (local AES-GCM files | memory), KeyService (rotation, revocation)
    crypto/              strict Ed25519 (node:crypto), scrypt, TOTP, secretbox
    services/            issuance, verification, anomaly, lifecycle, ownership, warranty, auth, audit,
                         scan tokens, scan reports (Cases), scan-history retention, daily scan statistics,
                         account recovery and the owner's sheet (Client Services), points of sale and
                         the sale mode, photographs of models and pieces (media), ownership
                         certificates (shared links), the lookbook of the models and the owners' club
    media/               uploaded photographs: type by magic bytes, EXIF/XMP stripped by hand, dimensions
    authenticators/      PhysicalAuthenticator registry (printed code today; hardware later)
    demo.ts              demo mode (npm run demo)
    routes/ http/ geo/ render/
  src/web/             browser apps (vanilla TypeScript, bundled by esbuild)
    verify/              mobile scanner: camera capture, decoder worker, result views; MY PIECES
                         (/verify/pieces), an ownership certificate's page (/verify/c#token) and
                         THE COLLECTION, the lookbook of the models (/verify/lookbook)
    admin/               admin console: catalogue, generator, keys, anomalies, analytics, audit; the sale mode (decoder worker of verify/)
    legal/               the legal pages (J-06): privacy policy, terms of use, legal notice and FAQ, in French and English, at /legal/*
    shared/              brand CSS, display font, monogram, DOM helpers; what verify/ and legal/ share
  scripts/             CLIs and studies (db, keys, POC, benchmarks, scan matrix, test sheets, …)
  test/                Vitest suites by area (core, ecc, decoder, api, db, services, e2e, web, …)
    support/             camera simulator, PRNG, raster/PNG/JPEG/Y4M helpers, test database
  dist/web/            web build output (git-ignored)
  out/                 POC, benchmark, E2E and export artifacts (git-ignored)
  Dockerfile  docker-compose.yml  .env.example
```

The rest of the repository: `../index.html` is the ORBES website (static, not part of this system), and `../docs/` holds the specifications.

---

## Prerequisites

- **Node.js 22 or later** and npm (`engines.node`). Nothing else is needed for development: the database defaults to **PGlite** (PostgreSQL compiled to WebAssembly, in memory), and signing keys to an in-memory provider.
- **Optional:**
  - PostgreSQL 16+ for the opt-in PostgreSQL suites and production-like runs;
  - Chromium for the browser E2E suites;
  - `pdftoppm` (poppler-utils) for the independent PDF rasterisation test;
  - Docker for the image.

```sh
cd genome
npm ci
```

---

## Commands

### Run the service

| Command | What it does |
|---|---|
| `npm run dev` | Development server with reload (`tsx watch`). Listens on `127.0.0.1:8080`. In-memory PGlite and keys, migrated and keyed automatically. Everything is lost on restart. |
| `npm start` | Same server without reload (`node --import tsx src/server/index.ts`), which is how the container runs it. In production add `-- --migrate` or `MIGRATE_ON_START=true` to apply migrations. |
| `npm run demo` | The server in demo mode (`tsx src/server/index.ts --demo`, the same as `npm start -- --demo`): in-memory PGlite loaded with the demo dataset through the real services; a demo console sign-in is printed once. Development and test only. Serves the web apps when `dist/web/` has been built. |
| `npm run build:web` | Builds `src/web/*` into `dist/web/` (esbuild, minified, content-hashed, CSP-checked; the shells' font preload points at the very file the CSS loads). The server serves `/verify`, `/admin`, `/legal` (the legal pages, J-06) and `/assets/*` from there when it exists. `npx tsx scripts/build-web.ts --dev` gives unminified output with sourcemaps. |

For a persistent local setup, point `DATABASE_URL` at a directory or a PostgreSQL database, and keep keys on disk:

```sh
export DATABASE_URL=pglite:$PWD/.data/pg            # or postgres://user:pass@127.0.0.1:5432/orbes_dev
export KEY_PROVIDER=local KEY_DIR=$PWD/.secrets/keys
export KEY_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
export BOOTSTRAP_ADMIN_EMAIL=admin@orbes.test BOOTSTRAP_ADMIN_PASSWORD='a long local passphrase'
npm run build:web && npm run dev                     # then http://localhost:8080/verify and /admin
npm run build:web && npm start -- --demo              # same, with the demo dataset loaded (pglite:memory; sign-in printed once)
```

`.data/` and `.secrets/` are git-ignored. Configuration is the same as in production; every variable is listed in [.env.example](.env.example) and [DEPLOYMENT §3](../docs/DEPLOYMENT.md#3-configuration-reference). Outside production, admins do not need TOTP and a signing key is created on demand.

### Demo dataset

| Command | What it does |
|---|---|
| `npm run db:seed` | Loads the demo dataset into an empty database: products in every lifecycle state, 8 demo accounts (`…@example.com`), scan history with anomalies, and claim codes printed once. Refused in production. `DEMO_ACCOUNT_PASSWORD` sets the accounts' password; otherwise a random one is printed. |
| `npm run db:reset-demo -- --yes` | Drops every ORBES table, migrates and reseeds. Add `--force` if the database holds non-demo products. Refused in production. |
| `npm run demo:export` | Exports the demo codes as SVG/PNG/PDF plus a labelled print sheet and `manifest.json` into `out/demo-codes/`. Options: `--formats`, `--products`, `--width-mm`, `--dpi`, `--theme`, `--label`, `--no-sheet`. With a persistent `DATABASE_URL`, the exported codes verify against a server on the same database. With `pglite:memory` they are decode-only samples. |

Seed into a persistent database (`DATABASE_URL` + `KEY_PROVIDER=local`), not into `pglite:memory`. An in-memory seed disappears when the command exits.

### Database and keys CLIs

All of them read the server's configuration and exit with `0` success, `1` failure, `2` usage error or `78` configuration error. Add `--json` for machine-readable output and `--help` for usage.

| Command | Equivalent |
|---|---|
| `npm run db:migrate` | `tsx scripts/db.ts migrate`: apply pending migrations (safe in production) |
| `npm run db:status` | `tsx scripts/db.ts status`: applied / PENDING per migration |
| `npm run keys:generate` | `tsx scripts/keys.ts generate`: first signing key when none is ACTIVE (idempotent) |
| `npm run keys:rotate` | `tsx scripts/keys.ts rotate [--kid <label>]`: new ACTIVE key, the previous one RETIRED |
| `npm run keys:list` | `tsx scripts/keys.ts list`: every key with status, dates and fingerprint |
| (no npm alias) | `tsx scripts/keys.ts retire <keyId> --yes` and `tsx scripts/keys.ts revoke <keyId> --reason <text> [--compromised-at <ISO 8601>] --yes` |
| (no npm alias) | `ADMIN_PASSWORD=… tsx scripts/admin.ts create --email <e> --role ADMIN\|OPERATOR\|AUDITOR`, `list`, `totp-setup --email <e>`, `ADMIN_TOTP_SECRET=… tsx scripts/admin.ts totp-enable --email <e> --code <c>` (or `--secret <s>`), `reset-totp --email <e> --yes`, `role --email <e> --role <r>`, `disable --email <e> --yes`, `enable --email <e>`: console users, the fallback of the console's Team page and the only way to grant ADMIN ([DEPLOYMENT §8](../docs/DEPLOYMENT.md#8-admin-accounts)) |

`keys:generate` and `keys:rotate` refuse `KEY_PROVIDER=memory`, because the key would vanish when the command exits. Runbooks: [DEPLOYMENT §7](../docs/DEPLOYMENT.md#7-signing-keys).

### Proof of concept

```sh
npm run poc                       # fresh random keys and nonce each run
npm run poc -- --seed 7           # reproducible run
```

This runs the core end to end without a server or database: key pair → identity → GENOME-01 → signed payload → CODE-01 → SVG/PNG → simulated phone capture → decode → verify → `AUTHENTIC`. It then runs a series of attacks, each of which must be refused with the public state the production server answers: product id rewritten, genome version changed, signature byte modified, forged code re-printed and random fake code give `INVALID_SIGNATURE`; printed glyphs replaced gives `SUSPICIOUS_ACTIVITY` (reason `GENOME_MISMATCH`); an image corrupted beyond ECC gives `MALFORMED_CODE`. Artifacts go to `out/poc/`. The exit code is 0 only if every outcome matches its expectation.

### Tests

| Command | Scope |
|---|---|
| `npm test` | The whole Vitest suite (`vitest run`). The PostgreSQL and Chromium suites skip themselves when not configured (see below). |
| `npx vitest run test/<area>` | One area, e.g. `test/decoder`, `test/api`, `test/services`. |
| `npm run test:watch` | Watch mode. |
| `npm run typecheck` | `tsc -p tsconfig.json` (strict, no emit) over `src`, `scripts` and `test`. |
| `ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npm run test:pg` | **Opt-in PostgreSQL suites** only (`test/*/postgres.test.ts` and the PostgreSQL part of `test/services/issuance.test.ts`). The role needs `CREATEDB`: each suite creates and drops a throwaway database. The command fails with a message if the variable is unset. Setting the variable for `npm test` runs them as part of the whole suite. |

**Browser E2E suites** (`test/e2e/*.test.ts`, `test/web/*.e2e.test.ts`) drive a real Chromium through `playwright-core`:

- Chromium uses a fake camera fed with simulated phone video (Y4M) of real issued codes, against the real server and web build.
- They look for Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, or at `ORBES_CHROMIUM`.
- Every one of them skips cleanly when it is missing (`describe.skipIf`). Install a matching browser and export its path:
  ```sh
  npx playwright-core install chromium
  export ORBES_CHROMIUM=$(node -p "require('playwright-core').chromium.executablePath()")
  ```
- Results and screenshots go to `out/e2e/`.
- `ORBES_SCREENSHOTS=1` writes admin console screenshots.
- `ORBES_E2E_STRICT=1` asserts the < 1 s recognition target on the median instead of the best run.

**Other test switches:**

- `UPDATE_BASELINES=1 npx vitest run test/visual/renderer.test.ts` regenerates the visual baselines after an intended rendering change. Review the diff.
- `test/render/artifact.test.ts` rasterises the PDF artifacts with `pdftoppm` when it is installed.

CI (`.github/workflows/genome-ci.yml`) runs typecheck, the full suite with a `postgres:16` service and Chromium, the web build, a production `npm audit` report, and a Docker image build on every change under `genome/` or `docs/`.

### Studies, benchmarks and print material

| Command | Output |
|---|---|
| `npm run scan-matrix` | Scan test matrix: real CODE-01 artifacts through the camera simulator under one varied condition at a time. Success rate and decode time per condition, smallest reliable printed size. Writes `docs/reports/scan-matrix.md` (`-- --no-write`, `--only a,b`, `--trials N`, `--dump DIR`). |
| `npm run bench` | Performance benchmarks: decoder (Node and the production Web Worker in Chromium), verify API, issuance, bundle sizes. Markdown tables plus `out/bench/results.json`. Exits 1 when the Chromium decoder run exceeds the ORBES-CODE-SPEC §10 latency budget (`scripts/decoder-budget.ts`). `-- --quick`, `--only decoder,api,issuance,bundles`, `--no-chromium`. With `ORBES_TEST_POSTGRES_URL` it adds PostgreSQL runs. Summary: `docs/reports/performance.md`. |
| `npm run sheets` | Physical A4 print test kit (PDF + one SVG per page) in `docs/assets/test-sheets/`. `-- --check` exits 1 when the committed files are stale, and `--out DIR` writes elsewhere. The codes are real CODE-01 artifacts signed by the public **sample** key and labelled "SAMPLE - NOT VALID". |
| `npx tsx scripts/print-size-matrix.ts` | Print size × substrate × distance × phone model → `docs/reports/print-size-matrix.md`. |
| `npx tsx scripts/counterfeit-simulation.ts` | Counterfeit scenarios → `docs/reports/counterfeit-simulation.md`. |
| `npx tsx scripts/genome-symbol-study.ts` | GENOME-01 vocabulary selection → `docs/reports/genome-symbol-study.md` and `docs/assets/genome-01-vocabulary.svg`. |
| `npx tsx scripts/payload-encodings.ts` | Payload size in the fixed layout vs deterministic CBOR and JSON → the table of CRYPTOGRAPHY §3.1 (`--json` for raw figures). |
| `npx tsx scripts/spec-vectors.ts` / `npx tsx scripts/render-samples.ts` | Normative test vectors (`docs/vectors/code01-sample.json`) and reference samples (`docs/assets/orbes-code-sample*.svg`). |
| `npx tsx scripts/certificate-specimen.ts` | Certificate card specimen of BRAND §7 (`docs/assets/certificate-card-specimen*.svg` and the production PDF). Re-run after any change to the card; `test/render/certificate.test.ts` fails on stale files. |
| `npx tsx scripts/favicons.ts` | The tab icons of the apps (`src/web/verify/favicon.svg`, the same for the legal pages, `src/web/legal/favicon.svg`, and `src/web/admin/favicon.svg`), drawn from the brand monogram (BRAND §3.9). Re-run after any change to them; `test/web/monogram.test.ts` fails on stale files. |

All of them are deterministic for the same arguments (seeded PRNGs, fixed sample key). Only timings vary from machine to machine.

### Docker

```sh
docker build -t orbes-genome .                         # behind a TLS-inspecting proxy: --secret id=extra_ca,src=proxy-ca.pem
cp .env.example .env                                   # fill in every secret first
docker compose up -d && docker compose exec app npm run keys:generate
```

The full procedure (TLS edge, secrets, first admin with TOTP, backups, rotation and compromise runbooks) is in [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

---

## Conventions

- **TypeScript strict, ESM.** Relative imports carry the `.js` extension (`import { x } from './foo.js'`).
- **`src/core/**` is isomorphic.**
  - It has no `node:*` imports, no `Buffer` and no DOM globals at module top level. Use `Uint8Array`.
  - Hashing uses `@noble/hashes`. Verification uses `@noble/curves` in strict mode.
  - The same decoder runs in Node tests and in the browser worker.
- **Server cryptography** goes through `src/server/crypto/`. Never call `crypto.verify` directly: `verifyEd25519Node` rejects small-order and non-canonical keys first ([CRYPTOGRAPHY §4.4](../docs/CRYPTOGRAPHY.md)).
- **Services** take an `actor` for every mutation and write an audit entry. They throw `DomainError(code, status, publicMessage)`. Public responses never carry risk scores, thresholds, internal statuses or stack traces.
- **Configuration** is environment-only and validated in `src/server/config.ts`. A new variable must be added to `.env.example`; `test/ops/deployment-files.test.ts` enforces it.
- **Migrations** are appended to `MIGRATIONS` in `src/server/db/migrate.ts`. Never edit an applied migration.
- **Web apps** follow the CSP: no inline scripts, styles or event handlers. All CSS lives in external files. The build fails otherwise.
- **Tests** live in `test/<area>/*.test.ts` and run with Vitest. Deterministic inputs come from `test/support/prng.ts`. Real PostgreSQL and Chromium suites are opt-in and skip cleanly.
- **Dependencies.** Runtime packages go in `dependencies`; toolchain, types and test-only packages go in `devDependencies`. The image installs with `--omit=dev`. `tsx` and `esbuild` are runtime dependencies: the server starts with `node --import tsx` and the image builds the web apps.
- **Never committed:** generated output (`dist/`, `out/`), local state and secrets (`.data/`, `.secrets/`, `.env*`, key files), and scratch files (`scripts/.dev-*`, `test/support/.prof*`, `src/core/decoder/zz-*`). See `.gitignore`.

---

## Specifications

| Document | Contents |
|---|---|
| [ARCHITECTURE](../docs/ARCHITECTURE.md) | Audit, architecture, threat summary, technology choices, implementation plan |
| [ORBES-GENOME-SPEC](../docs/ORBES-GENOME-SPEC.md) | GENOME-01: vocabulary, permutation, rendering |
| [ORBES-CODE-SPEC](../docs/ORBES-CODE-SPEC.md) | CODE-01: layout, error correction, masking, decoding, test vectors |
| [CRYPTOGRAPHY](../docs/CRYPTOGRAPHY.md) | Payload, Ed25519 signing, key management |
| [SECURITY-MODEL](../docs/SECURITY-MODEL.md) | Controls catalogue, configuration hardening |
| [THREAT-MODEL](../docs/THREAT-MODEL.md) | Threats, protections, residual risks |
| [API](../docs/API.md) | HTTP API reference |
| [DATABASE](../docs/DATABASE.md) | Schema, migrations, retention, backups |
| [BRAND-DESIGN-SYSTEM](../docs/BRAND-DESIGN-SYSTEM.md) | Visual language of the scanner, console and code |
| [FUTURE-HARDWARE](../docs/FUTURE-HARDWARE.md) | Secure NFC / secure element roadmap |
| [DEPLOYMENT](../docs/DEPLOYMENT.md) | Production deployment and operations runbook |

Internal module contracts: [CONTRACTS.md](CONTRACTS.md) (core) and [PLATFORM-CONTRACTS.md](PLATFORM-CONTRACTS.md) (server, database, web). Reports from the studies are in `../docs/reports/`.
