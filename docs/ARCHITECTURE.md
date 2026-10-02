# ORBES GENOME CODE™ — Architecture

Status: v0.1 (first production-grade prototype) · Owner: ORBES Digital Identity

This document is the "first action" deliverable of the master specification:

- **A.** Current architecture audit
- **B.** Proposed ORBES GENOME architecture
- **C.** Threat model (summary — full model in [THREAT-MODEL.md](THREAT-MODEL.md))
- **D.** Technology choices
- **E.** Implementation plan

The detailed specifications live next to this file:
[ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md) ·
[ORBES-CODE-SPEC](ORBES-CODE-SPEC.md) ·
[CRYPTOGRAPHY](CRYPTOGRAPHY.md) ·
[SECURITY-MODEL](SECURITY-MODEL.md) ·
[THREAT-MODEL](THREAT-MODEL.md) ·
[API](API.md) ·
[DATABASE](DATABASE.md) ·
[BRAND-DESIGN-SYSTEM](BRAND-DESIGN-SYSTEM.md) ·
[FUTURE-HARDWARE](FUTURE-HARDWARE.md) ·
[DEPLOYMENT](DEPLOYMENT.md)

---

## A. Current architecture audit

| Dimension | Finding |
|---|---|
| Repository | `eliotrapatel/orbes-index`. Before this work it held a single file, `index.html` (≈1.9 MB, ≈6 500 lines, 44 commits). |
| Framework | None. Plain HTML + inline CSS + inline JavaScript. There is no build step, `package.json`, linter or test suite. |
| Language | Browser JavaScript (ES2015+). |
| Database | None in the repository. The promo/referral easter egg calls a Google Apps Script web app (`script.google.com/macros/s/…/exec`), which is most likely backed by a Google Sheet. |
| Authentication | None. |
| Hosting | Static. Referral links point to `https://theorbes.com`. The repository has no CNAME or CI configuration, so which static host serves it is not visible from the repo. |
| Branding assets | Embedded as base64 inside `index.html`: (1) the wide-tracked geometric sans wordmark **O R B E S**, black on white, PNG 2000×450; (2) a brushed-metal "ORBES STOCK EXCHANGE" wordmark; (3) a monochrome metallic gradient background (JPEG). |
| Visual language | Pure white (`#ffffff`) and black. "Helvetica Neue", HelveticaNeue, Helvetica, Arial. Uppercase micro-typography at 0.22–0.40 em tracking. Drifting circles ("orbs") on canvas, film grain, hairline corner brackets, 1 px rules, slow cubic-bezier(0.22,1,0.36,1) motion, "PARIS, 2026". |
| Other features | Splash/ENTER screen, ambient audio (Dropbox), easter eggs (Snake, Pac-Man, a BTC prediction game using public price APIs), promo/referral code flow, chromatic mode. |
| Deployment | Manual commits of `index.html` to `main`. |

**Conclusions**

1. None of the infrastructure the GENOME system needs exists yet: no server, database, key management or accounts. The system is therefore built as a new, self-contained subsystem under `genome/`, plus specifications under `docs/`. `index.html` is not modified, so the existing site keeps working unchanged.
2. A static host cannot run server-side signature verification or keep private keys. The verification service is packaged as a portable Node.js container (Docker) backed by PostgreSQL, so it can run on any container platform. `theorbes.com/verify` can point at it through a reverse-proxy route or a subdomain such as `verify.theorbes.com`.
3. The visual identity in `index.html` (black/white, tracked uppercase Helvetica Neue, orbit geometry, hairline frames) is the brand reference for the scanner, the admin console and the ORBES CODE itself.

---

## B. Proposed ORBES GENOME architecture

### B.1 Three concepts, never conflated

| Concept | What it is | Where it lives |
|---|---|---|
| **ORBES SEAL** | The universal, identical-on-every-product authentication mark. A concentric orb + orbit that also acts as the machine finder. | Centre of every ORBES CODE; brand assets. |
| **ORBES GENOME** | The unique, deterministic visual identity of one product: 8 glyphs from a 16-glyph orbital vocabulary (GENOME-01), derived through a public bijective permutation of the canonical product identity. | Inner orbit of the CODE; product pages; verification result. |
| **ORBES CODE** | The machine-readable, Ed25519-signed carrier of identity + genome version: concentric data orbits drawn as arcs, protected by Reed-Solomon. | Printed/engraved artifact. |

The Genome is the identity. The Code is the authentication carrier. The signature proves that ORBES issued the data. The physical product is bound to the code only by the manufacturing process, and future secure hardware is meant to strengthen that binding (see [FUTURE-HARDWARE](FUTURE-HARDWARE.md)).

### B.2 Data flow

```
ISSUANCE (server, admin-only)
  admin form ─► product identity O26-J-00184 ─► GENOME-01 (8 glyphs)
            ─► canonical payload (13 bytes, fixed binary layout)
            ─► Ed25519 signature by active key (KeyProvider: local; KMS/HSM-ready interface)
            ─► data = payload ‖ signature ‖ CRC-16      (79 bytes)
            ─► Reed-Solomon RS(164,79) over GF(256)    (85 parity bytes)
            ─► mask + BCH format word ─► orbital cell layout (CODE-01)
            ─► vector model ─► SVG / PDF / PNG

VERIFICATION
  camera (mobile web) ─► Web Worker decoder: seal finder ─► moons ─► homography
            ─► cell sampling ─► format/orientation ─► RS decode ─► CRC
            ─► POST /api/v1/verify { code, genome read, session }
  server  ─► strict parse ─► key lookup (key id) ─► Ed25519 verify
            ─► product / code registry ─► revocation ─► lifecycle
            ─► anomaly scoring (scan history) ─► authenticator policy
            ─► public verification state (9 states) + scan/auth events
```

### B.3 Components

The layout of `genome/` (same as [genome/README.md](../genome/README.md) "Directory layout"):

```
genome/
  src/core/            isomorphic library (browser + Node; no node:* imports, no Buffer)
    bytes.ts identity.ts payload.ts geometry.ts
    code-profiles.ts     code-version registry (CODE_PROFILES): profile per version, dispatch
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
    demo.ts              demo mode (npm run demo): in-memory database with the demo dataset
    db/                  Kysely schema, migrations, connection (pg | PGlite), demo seed
    keys/                KeyProvider (local AES-GCM files | memory; KMS/HSM-ready interface), KeyService
    crypto/              strict Ed25519 (node:crypto), scrypt, TOTP, secretbox
    services/            issuance, verification, anomaly, lifecycle, ownership, warranty, auth, audit,
                         certificate cards, scan tokens, scan reports (Cases), scan-history retention,
                         daily scan statistics, account recovery and the owner's sheet (Client Services),
                         points of sale and the sale mode
    authenticators/      PhysicalAuthenticator registry (printed code today; hardware later)
    http/                sessions, CSRF, rate limiting, security headers, validation, static files
    routes/              public, account, ownership, admin
    geo/                 location resolver (none | cloudflare | headers | mmdb), haversine
    render/              artifacts: SVG, PNG (resvg), vector PDF (pdfkit), print sheets, certificate cards
  src/web/             browser apps (vanilla TypeScript, bundled by esbuild)
    verify/              mobile scanner: camera capture, decoder worker, result views
    admin/               admin console: catalogue, generator, keys, anomalies, analytics, audit; the sale mode (decoder worker of verify/)
    shared/              brand CSS, display font, monogram and DOM helpers
  scripts/             CLIs and studies (db, keys, admin, POC, benchmarks, scan matrix, test sheets, …)
  test/                Vitest suites by area (core, ecc, decoder, api, db, services, e2e, web, …)
docs/                  specifications (this folder)
```

### B.4 Verification states (public contract)

`AUTHENTIC`, `AUTHENTIC_FIRST_REGISTRATION`, `AUTHENTIC_REGISTERED`, `AUTHENTIC_OWNERSHIP_VERIFIED`, `SUSPICIOUS_ACTIVITY`, `REVOKED`, `UNKNOWN`, `INVALID_SIGNATURE`, `MALFORMED_CODE`.

Each state describes what was actually proven: an authentic signature, a registered identity, a valid status and a consistent lifecycle. None of them claims that the physical object is genuine.

### B.5 Extensibility hooks

- **Categories** come from a registry table. Each category has an immutable 5-bit index. Nothing in the code base hardcodes them.
- **Versions.** `code_version` (CODE-01…08) is carried in both the format word and the signed payload, and `genome_version` (GENOME-01…15) is in the signed payload. Code versions are looked up in the `CODE_PROFILES` registry (`src/core/code-profiles.ts`): the decoder picks the profile the format word names, payload decoding dispatches on the high nibble of byte 0, and the server answers a well-formed code of a version it has no profile for with UNKNOWN (`UNSUPPORTED_CODE_VERSION`) and a warning. Genome generators are looked up by version (`SUPPORTED_GENOME_VERSIONS`, `computeGenome`). CODE-01 is today the only code profile; the decoder's sampling tables are those of the CODE-01 geometry, so a CODE-02 with a different layout also needs them generalised. Historical products stay verifiable.
- **Keys.** A 1-byte `key_id` is carried in every code. Keys can be ACTIVE, RETIRED or REVOKED. Historical verification always uses the key named by the code.
- **Hardware.** A `PhysicalAuthenticator` interface with `PrintedCodeAuthenticator` today. A per-product authentication policy can later require secure NFC or secure-element evidence.

---

## C. Threat model (summary)

Full analysis: [THREAT-MODEL.md](THREAT-MODEL.md).

| Threat | Core protection | Residual risk |
|---|---|---|
| A Screenshot of a legitimate code | Signature still valid by design. Scan-pattern anomaly detection. First registration gated by a claim secret and a fresh scan token. | A static code can be copied. It cannot prove that the physical object is genuine. |
| B Copying a printed code onto counterfeits | Duplicate/velocity/geography anomaly scoring. Ownership state. Revocation. | Low-volume copies of one identity may go unnoticed until registration conflicts arise. |
| C Altering the product ID | Ed25519 signature over the canonical payload, plus the genome cross-check. | None known (requires breaking Ed25519). |
| D Random fake codes | Signature verification. Key-id registry. | None known. |
| E Replay | Scans are idempotent reads. Single-use, short-lived registration tokens. Rate limiting. Anomaly poisoning is down-weighted. | Attackers can inflate scan counts. Mitigated, never auto-revoked. |
| F Database compromise | No private keys in the DB. Hashed IP data. Hash-chained audit log. Codes remain self-verifying. | Integrity of lifecycle data depends on DB controls. |
| G Private key compromise | KMS/HSM-ready providers. Key revocation with a compromise timestamp. The DB nonce match defeats forged codes for existing products. | Forged codes for unregistered identities until revocation. |
| H Malicious frontend | All verification is server-side. CSP. No secrets in the frontend. | The user can be shown a fake UI on a compromised device. |
| I Fake verification website | Canonical domain education. Public key endpoint. | Phishing remains possible. Future mitigation: owner-account notifications (no notification channel exists yet; see THREAT-MODEL I). |
| J Mass-produced counterfeits using one identity | Geography/velocity anomalies. Ownership conflicts. Code revocation and re-issue. | Detection, not prevention, until hardware binding exists. |

---

## D. Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict), ESM | One language for encoder, decoder, server and browser. The decoder is shared byte-for-byte between Node tests and the browser worker. |
| Runtime | Node.js ≥ 22 | LTS. Native Ed25519 in `node:crypto`. |
| Signatures | **Ed25519** (RFC 8032) via `node:crypto` (server) and `@noble/curves` (isomorphic verification, tooling) | A modern, deterministic standard with 64-byte signatures. The spec's preferred algorithm. |
| Hashing | SHA-256 (`@noble/hashes`, `node:crypto`) | Standard. |
| Payload encoding | Fixed-layout canonical binary (13 bytes) | Every bit in the code costs print area. Deterministic CBOR (RFC 8949 §4.2.1) was evaluated: with integer keys the same fields take 25–32 bytes because of map keys and type headers (+7–12 % data cells), and with field names 117 bytes (two Reed-Solomon blocks); figures from `genome/scripts/payload-encodings.ts`. A fixed, versioned binary layout has exactly one encoding per value, so it is canonical by construction. See [CRYPTOGRAPHY](CRYPTOGRAPHY.md). |
| Error correction | Reed-Solomon over GF(256), errors + erasures (Berlekamp-Massey, Forney); BCH(15,5) for the format word; CRC-16/CCITT for miscorrection detection | Established, well-understood codes that are also used by QR and Data Matrix. Erasure decoding doubles the tolerance to known-bad regions such as glare and occlusion. |
| Server | Fastify 5, zod 4 validation | Fast, schema-first, with mature plugins for security headers, rate limiting and cookies. |
| Database | PostgreSQL via Kysely (type-safe query builder). PGlite (Postgres compiled to WASM) for dev, tests and the demo | One SQL dialect from laptop to production. Real Postgres semantics in tests. |
| Rendering | Shared primitive model → SVG (native), PDF (pdfkit, pure vector), PNG (resvg) | Every output is identical and crisp at any scale. |
| Web | Vanilla TypeScript bundled by esbuild, Web Worker decoder, `getUserMedia` | No framework weight on mobile. Fast first paint. No app required. |
| Tests | Vitest. Synthetic camera simulator (perspective, blur, noise, glare, occlusion, texture, JPEG). Playwright (Chromium) with a fake camera for E2E. | Repeatable robustness metrics. |
| Deployment | Dockerfile + docker-compose (app + Postgres). Secrets via env or a KMS. | Portable to any container host. |

---

## E. Implementation plan

The phases follow the master specification. Phases 1–5 must prove the core before any UI is built.

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 1 | GENOME-01: symbol study, vocabulary, bijective permutation | Determinism, uniqueness (bijection) and inverse round-trip tests |
| 2 | CODE-01 visual language: profile, primitives, SVG renderer | Visual regression snapshots. Machine-critical layers documented. |
| 3 | Encoder: payload framing, RS, mask selection, format word | Round-trip at the cell level |
| 4 | Decoder: finder, moons, homography, sampler, RS errors+erasures | Synthetic camera test matrix meets the targets |
| 5 | Ed25519 signing/verification, key IDs, rotation | Tamper tests return INVALID |
| **POC** | `npm run poc`: issue → render → simulated capture → decode → verify → AUTHENTIC, then tamper product ID / signature → INVALID SIGNATURE, reprinted genome → SUSPICIOUS ACTIVITY (`GENOME_MISMATCH`) | Passing |
| 6 | Verification API | < 300 ms p95 (excluding network) |
| 7 | Mobile scanner (`/verify`) | Fake-camera E2E passes in Chromium |
| 8 | Product database + migrations + demo dataset | Migrations apply to empty DB |
| 9 | Admin dashboard + code generator (SVG/PNG/PDF) | E2E admin flow |
| 10 | Lifecycle, ownership (register/transfer), warranty | State-machine tests |
| 11 | Anomaly detection | Counterfeit simulation suite |
| 12 | Security hardening | Review findings closed |
| 13 | Production deployment | Docker image builds. Runbook. |
