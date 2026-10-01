# ORBES GENOME CODE™ — Master specification compliance audit

Status: audit of 2026-10-01, against commit `c28230a` (plus a clean working tree), **remediated the same day** (see [§5](#5-remediation-2026-10-01)) and re-checked in a final gate ([§6](#6-final-gate-2026-10-01)) · Scope: every section 0–38 of the master specification, the nine required documents and DEPLOYMENT · Method: code reading, the test suite, and running the system.

**Verdict after remediation.** Every section of the master specification is implemented. 38 sections are **MET** and 1 is **PARTIAL**; none is **MISSING**. The remaining PARTIAL section is §28 (real-device evidence: iOS Safari and Android Chrome on physical phones), which a software prototype cannot produce; it is recorded as **out of scope here**, with the procedure, not faked. Two MET sections keep items that are equally out of scope: KMS/HSM custody (§12: needs a vendor account; the interface, switch and acceptance suite are ready) and physical print validation (§30: needs printed material and phones). All 23 document inaccuracies are corrected. The stray Vitest cache file is no longer tracked (removed from the index in commit `4e643de`) and is excluded from the website (item 8). The final gate of [§6](#6-final-gate-2026-10-01) re-ran every check on that commit.

**Verdict of the original audit** (kept for the record). 33 sections were **MET**, 6 **PARTIAL** (§8 latency target for code-free frames; §26 code-version dispatch; §28 real-device evidence; §29 low-light test gate; §37 data retention; §38 website hygiene), none **MISSING**, with open items on §12 and §30 and 23 document inaccuracies. Each is listed under [Open items](#4-open-items) with its resolution.

Status legend:

- **MET**: implemented, tested and documented.
- **PARTIAL**: implemented, but a stated target or piece of evidence is missing.
- **MISSING**: not implemented.

Paths are relative to the repository root.

---

## 1. What was run

| Check | Command | Result |
|---|---|---|
| Full test suite, PostgreSQL suites included | `cd genome && ORBES_TEST_POSTGRES_URL=postgres://…@127.0.0.1:5432/postgres npx vitest run` | **122 files, 1 899 tests passed, 0 skipped, 0 failed** (439 s; Chromium E2E included) |
| Typecheck | `npx tsc -p tsconfig.json` | clean (exit 0) |
| Proof of concept | `npm run poc` | **PASSED, 8 of 8 outcomes as expected**: genuine → AUTHENTIC; product id rewritten, genome version changed, signature byte modified, forged code re-printed, random fake code → INVALID SIGNATURE; printed glyphs replaced → SUSPICIOUS ACTIVITY (`GENOME_MISMATCH`); image beyond ECC → MALFORMED CODE |
| Web build | `npx tsx scripts/build-web.ts` | 10 files in `genome/dist/web` (verify 74.8 KB, worker 60.8 KB, admin 122.9 KB minified) |
| Frontend secrets scan | grep of `genome/dist/web` for `privateKey`, the sample seed, `KEY_ENCRYPTION_KEY`, `COOKIE_SECRET`, `IP_HASH_PEPPER`, `ed25519`, `sign(` | **no key material and no Ed25519 code.** The only `sign(` matches are `Object.assign(` and `Math.sign(`; no source maps. |
| Demo database | `DATABASE_URL=pglite:<dir> tsx scripts/db.ts migrate` → `seed` → `tsx scripts/export-demo-codes.ts` | 3 migrations applied; 41 products, 8 accounts; every demo code exported as SVG and PNG |
| Server | `node --import tsx src/server/index.ts` on that database | `GET /api/v1/health` 200 `{"ok":true,"version":"0.1.0"}`. `GET /api/v1/keys` and `/.well-known/orbes-keys.json`: 2 keys with `revokedAt` and `compromisedAt`, `cache-control: public, max-age=300`, `access-control-allow-origin: *`. `GET /api/v1/categories`: J, L, W, F, A from the registry. `/` → 302 `/verify`. `/verify` and `/admin` 200 `no-cache`. Unknown route → 404. CSP, Permissions-Policy and Referrer-Policy as documented. SIGTERM → graceful shutdown. |
| End-to-end verify | PNG of `O26-J-00184` decoded by the core decoder (identical to the manifest bytes), then `POST /api/v1/verify` | **AUTHENTIC_FIRST_REGISTRATION**, MONOLITHE / RING / Jewelry / 925 STERLING SILVER / 2026, `G1-E1DC-BE52`, registration token. Altered id, altered signature and altered genome version → INVALID_SIGNATURE. Wrong glyphs → SUSPICIOUS_ACTIVITY. Bad CRC and `AAAA` → MALFORMED_CODE. A 1 025-character code and an unknown field → 400 `VALIDATION_FAILED`. A text/plain body → 415. A 20 KB body → 413. **All 41 other demo codes returned their manifest's expected state.** |
| Verify API latency | `npx tsx scripts/bench.ts --only api` with `ORBES_TEST_POSTGRES_URL` | PGlite p95 18.9 ms (sequential). **PostgreSQL 16: p95 14.1 ms sequential and 38.6 ms with 8 in flight**, against a target of < 300 ms |
| Absolute rules (§37) | grep over `genome/src`, `genome/scripts`, `docs` | "impossible to counterfeit", "100% genuine" and "blockchain" occur only inside prohibitions (BRAND §1.2, §4.5; THREAT-MODEL P). No `REAL` state. Category literals only in the demo seed, `scripts/bench.ts`, `scripts/spec-vectors.ts` and `scripts/test-sheets.ts`. Key material only in the public sample vector (`docs/vectors`, `scripts/test-sheets.ts`), plus the dev cookie secret, which production refuses. |
| Existing site | `git log -- index.html` | last change 2026-05-29, before the GENOME work began. Unmodified. |

---

## 2. Traceability matrix

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 0 | SEAL, GENOME and CODE as three distinct concepts | MET | ARCHITECTURE B.1; ORBES-GENOME-SPEC §1; `src/core/code/profile.ts` layers `seal` / `genome` / `data`; BRAND §2.1 |
| 1 | No invented crypto; Ed25519; private key server-side only; payload → canonical → signature → code; verification chain → states | MET | CRYPTOGRAPHY §1–4; `src/server/crypto/ed25519-node.ts`, `src/core/payload.ts`; bundle scan (§1 above); `test/crypto/*.test.ts` |
| 2 | Never claim impossible to counterfeit; distinguish A–E; hardware-ready | MET | SECURITY-MODEL §2 (layers A–E); `services/copy.ts`; THREAT-MODEL rule 1; `src/server/authenticators/index.ts` |
| 3 | Identity `O26-J-00184`; category registry, not hardcoded; all 17 product fields | MET | `src/core/identity.ts` (`CategoryResolver`); `categories` table + `CategoryRegistry`; view `product_overview` (migration 0001) exposes every field (DATABASE §12); `test/core/identity.test.ts`, `test/services/categories.test.ts` |
| 4 | Deterministic, unique, public Genome; secret never derived from it | MET | 8-round Feistel bijection (`src/core/genome/genome.ts`); DB `UNIQUE(genome_version,value)`, `UNIQUE(fingerprint)`; `test/genome/genome.test.ts` (determinism, bijection, inverse) |
| 5 | Formal orbital symbol system, chosen by engineering tests | MET | 16-glyph GENOME-01 from 43 candidates and 3 066 sets ([symbol study](reports/genome-symbol-study.md)); `vocabulary.ts`; `test/genome/vocabulary.test.ts` |
| 6 | Proprietary code: orientation, grid, version, ECC, payload, signature, checksum | MET | ORBES-CODE-SPEC §3–7 (moons + polaris, fixed ring grid per version, BCH format word, RS(164,79), CRC-16) |
| 7 | Finder/seal, format, payload, signature, ECC as a new encoding layer | MET | ORBES-CODE-SPEC; `src/core/code/encoder.ts`; vectors `docs/vectors/code01-sample.json`; `test/code/*.test.ts` |
| 8 | Robust ECC (RS, documented); measurable targets | MET (was PARTIAL) | RS decision record ORBES-CODE-SPEC §6.2; targets §10; `test/decoder/robustness-*.test.ts`; [scan-matrix](reports/scan-matrix.md). The per-frame latency target is now qualified in §10 (frames with a code: median < 100 ms; code-free frames: median < 200 ms, p95 < 400 ms, with the reason stopping early would give up damaged-seal scans) and enforced by `npm run bench` (`scripts/decoder-budget.ts`, exit 1 when exceeded; doc sync `test/decoder/latency-budget.test.ts`). Run 3: code p50 37 ms, code-free p50 127 / p95 190 ms, **PASS** ([performance](reports/performance.md) §2). Item 3. |
| 9 | Separate data, finder, genome, decor, ECC and security elements; mark which are machine-critical | MET | ORBES-CODE-SPEC §3 table ("Critical?") and §4.7 |
| 10 | Universal seal; orientation; recognisable when partly obscured | MET | Seal 1:1:4:1:1 finder (§4.1); `test/decoder/robustness-damage.test.ts` "2 u wide strip … even across the seal" |
| 11 | Compact canonical payload; Ed25519; no personal data; not JSON | MET | 13-byte fixed layout (CRYPTOGRAPHY §3, CBOR decision §3.1). `genome_id` = product id, bound through the signed identity. `test/core/payload.test.ts` |
| 12 | Key abstraction, key id, rotation, revocation, historical verification, KMS/HSM-compatible | MET (item 4: KMS provider out of scope) | `KeyProvider` / `KeyService` (`src/server/keys/`); 1-byte `keyId` in every code; revoked-key cut-off; `test/keys/key-service.test.ts`, `test/api/admin-keys.test.ts`, `test/simulation/high-risk-keys.test.ts`; provider acceptance suite `test/keys/provider-contract.ts` (memory and local pass). No concrete KMS provider: needs a vendor account (CRYPTOGRAPHY §5.4, DEPLOYMENT §7.6). |
| 13 | Normalised schema with all listed tables and the chain PRODUCT→GENOME→CODE→SIGNATURE→AUTH EVENTS | MET | `src/server/db/migrations/0001_initial.ts` (21 tables + view), DATABASE §4–5; `test/db/schema.test.ts`, `test/db/migrations.test.ts` |
| 14 | Lifecycle state machine incl. REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN; internal statuses hidden | MET | `TRANSITIONS` in `services/lifecycle.ts` = PLATFORM-CONTRACTS §2.6 = DATABASE §7.2; `test/services/lifecycle.test.ts`; `test/verification/redaction.test.ts` |
| 15 | Nine verification states; never "REAL" | MET | `VerificationState`; `services/copy.ts`; API §9.3; `test/web/verify.view-model.test.ts` |
| 16 | Scan events with code, product, time, region, device/session, result, IP risk, account, type; anomaly patterns; "UNUSUAL ACTIVITY DETECTED"; hidden thresholds | MET | `scan_events` (DATABASE §5.16; only `VERIFY` is written, which is documented); `services/anomaly-rules.ts` (impossible travel, velocity, diversity, dispersion); `test/anomaly/*.test.ts`; counterfeit simulation scenario 9 (14/14 PASS) |
| 17 | Scan → verify → account → register; transfer with acceptance; history preserved; identity untouched | MET | `services/ownership.ts`; `ownership` rows with `ended_at`; `test/services/ownership.test.ts`, `test/api/ownership.test.ts`, `test/web/verify.e2e.test.ts` (registration flow) |
| 18 | Warranty start, duration, status, purchase date, retailer, country, service records | MET | `warranties`, `service_records`; `services/warranty.ts`; `test/services/warranty.test.ts` |
| 19 | Luxury flow ORBES / AUTHENTICATION / SCAN → SCANNING → VERIFYING → result with Genome, product lines and the four tabs | MET | `src/web/verify/**` (`copy.ts`, `views/result.ts`, `views/tabs.ts`); BRAND §5; `test/web/verify.e2e.test.ts`, `test/web/verify.brand.test.ts` |
| 20 | `/verify`, camera in the browser, local decode, server verification, no app | MET | Web Worker decoder (`src/web/verify/worker.ts`); `vercel.json` redirects theorbes.com/verify → verify.theorbes.com; `test/e2e/camera-scan.test.ts` |
| 21 | Generator: ids, genome, payload, signature, SVG, PNG and PDF (vector) | MET | `POST /api/admin/products`; `src/server/render/` (SVG, resvg PNG, pdfkit vector PDF, K-only option); `test/render/*.test.ts`, `test/web/admin.e2e.test.ts` |
| 22 | Admin sections ×10; product page (code status, signature valid, scan count, ownership, warranty, anomalies) | MET | `src/web/admin/main.ts` navigation (all 10 + Generator, Catalogue); `GET /api/admin/products/:id` returns `codes[].verification.valid`, `scans.count`, ownership, warranty, anomalies (checked live); `views/product.ts` |
| 23 | Validation, canonical encoding, signature checks, replay, rate limiting, CSRF, secure cookies, authn/z, audit, rotation, server-side decisions | MET | SECURITY-MODEL §3; `src/server/http/*`; `test/api/security.test.ts`, `test/security/adversarial.test.ts`, `test/services/audit.test.ts` |
| 24 | Threats A–J, each with attack, protection, residual risk and future mitigation | MET | THREAT-MODEL §4 (plus K–S in §5, now in order; S = edited code-version nibble) |
| 25 | `PhysicalAuthenticator`, `PrintedCodeAuthenticator`, hardware kinds as future work; no fake hardware | MET | `src/server/authenticators/index.ts` (hardware kinds → `UNSUPPORTED`, `CODE_ONLY` assurance); `test/verification/authenticators.test.ts` |
| 26 | Versioning GENOME-01 / CODE-01; future versions without breaking old products | MET (was PARTIAL) | Genome: version registry (`SUPPORTED_GENOME_VERSIONS`, `computeGenome` by version), `UNSUPPORTED_GENOME_VERSION` → UNKNOWN. Code: `CODE_PROFILES` registry (`src/core/code-profiles.ts`); the decoder picks the profile named by the format word (`DecodeOptions.codeProfiles`), payload decoding dispatches on the high nibble of byte 0 (`unframeAnyCodeData`), the encoder writes any registered version, and `verification.ts` answers an intact frame of an unsupported version with UNKNOWN (`UNSUPPORTED_CODE_VERSION`) plus a server warning. Tests: `test/core/code-profiles.test.ts` (synthetic version-2 profile end to end: encode → raster → decode, and refusal without the profile), `test/verification/verification.test.ts`, counterfeit scenario 6j. ORBES-CODE-SPEC §12. Limit, documented: the decoder's sampling tables are CODE-01's geometry. Item 6. |
| 27 | Counterfeit simulation suite covering the nine listed cases | MET | [counterfeit-simulation](reports/counterfeit-simulation.md): 114 checks, 108 PASS, 0 GAP, 6 LIMIT (documented detection limits), 0 FAIL (regenerated after the code-version change: 3d now expects UNKNOWN for the two version-nibble flips to 3 and 5; 6j added); `test/simulation/*.test.ts` |
| 28 | Recognition < 1 s; API < 300 ms; iOS Safari and Android Chrome | **PARTIAL — out of scope for this prototype** | API: PostgreSQL 16 p95 14.1 / 15.9 ms sequential, 38.6 / 56.9 ms with 8 in flight (two runs); PGlite 18–32 ms. Recognition: median 468–529 ms in headless Chromium with a fake camera (performance §1). **Not measurable here:** real phones, iOS Safari / WebKit and Android Chrome need the physical devices; the measurement procedure is item 2. |
| 29 | Automated tests for every listed area, plus visual regression | MET (was PARTIAL) | Covered: genome (`test/genome`), payload (`test/core/payload`), signatures (`test/crypto`), rotation (`test/keys`), encode/decode/ECC (`test/code`, `test/decoder`, `test/ecc`), distortion/rotation/perspective/occlusion (`test/decoder/robustness-*`), **low light** (`test/decoder/robustness-damage.test.ts`: `lowLight` preset at 4 px/u, ≥ 95 % of 20 seeded captures), invalid signatures, revocation, duplicates, anomalies, transfer, warranty (`test/simulation`, `test/anomaly`, `test/services`), visual regression (`test/visual/renderer.test.ts`). Item 7. |
| 30 | Test sheets at 10–50 mm on 7 renditions; smallest reliable size | MET (item 1: physical validation out of scope) | `scripts/test-sheets.ts` (`SHEET_SIZES_MM = [10,15,20,25,30,40,50]`), `docs/assets/test-sheets/` (8 pages); [print-size-matrix](reports/print-size-matrix.md): simulated minimum 25 mm, recommended 30 mm. Confirmation on printed material with real phones needs physical printing and devices. |
| 31 | Must not look like QR, barcode, crypto or similar; architectural and luxurious | MET | BRAND §1–2 (and §1.2 "never look like"); orbital geometry; specimens in `docs/assets/` |
| 32 | Deliverables 1–20 | MET | Architecture, DB, API, crypto and genome specs (docs); encoder and decoder (`src/core`); scanner and admin (`src/web`); backend (`src/server`); demo dataset (`db/seed/demo.ts`); tests; DEPLOYMENT + `deploy/vps` |
| 33 | Nine required docs, readable without the code | MET | All nine exist, plus DEPLOYMENT; the 23 inaccuracies of §3 are corrected (§4.2) |
| 34 | Phases 1–13; encoding and crypto proven before the UI | MET | ARCHITECTURE E; commit history; `npm run poc` |
| 35 | POC: issue → render → scan → decode → verify → AUTHENTIC; tampering → INVALID | MET | `scripts/poc.ts` run above. Deliberate, documented difference: replaced *printed glyphs* give SUSPICIOUS ACTIVITY (`GENOME_MISMATCH`), because the signed data is intact. Tampered identity, signature and genome version all give INVALID SIGNATURE. |
| 36 | Customer experience: the identity is the hero and the technology is invisible | MET | Verify app result view; `docs/assets/ui/*.png` (BRAND §9) |
| 37 | Absolute rules | MET (was PARTIAL) | All DO NOT rules hold (§1 greps, bundle scan). Scan-data retention: `SCAN_RETENTION_DAYS` (`config.ts`; 30–3650 days, never below the anomaly look-back) drives a housekeeping job (`startHousekeeping`, `services/scan-retention.ts`) that deletes `scan_tokens` and `authentication_events` before old `scan_events`, in short batches; production warns while it is unset. Tests: `test/api/context.test.ts`, `test/db/config.test.ts`. The period itself is a legal decision (DATABASE §10). Item 5. |
| 38 | First action A–E; existing site untouched; clean integration | MET (was PARTIAL) | ARCHITECTURE A–E; `index.html` unchanged. Root `.vercelignore` now excludes `deploy/` and `node_modules/` (asserted by `test/ops/vps-stack.test.ts`), so the VPS stack and the stray Vitest cache are no longer published; root `.gitignore` ignores `node_modules/`; the stray `node_modules/.vite/vitest/…/results.json` cache is no longer tracked (commit `4e643de`). Item 8. |

After remediation the tally is 38 MET and 1 PARTIAL (§28, out of scope for a software prototype). §12 and §30 meet the letter of the specification and keep items 4 and 1, both out of scope here. (Original audit: 33 MET, 6 PARTIAL.)

---

## 3. Required documents: consistency with the code

At least 10 concrete claims per document were checked against the code, a running server or a script. ✓ = correct, ✗ = inaccurate (numbered as in §4). **Every inaccuracy below has been corrected** (status per item in §4.2); the CBOR table (D4) is now computed by a script and checked by a test.

| Document | Exists | Claims checked | Inaccurate |
|---|---|---|---|
| ORBES-GENOME-SPEC | ✓ | 13: packed `0x341000B8`, value `0xE1DCBE52`, glyphs, ids, fingerprint (recomputed); 8 Feistel rounds and domain string; stroke 0.26 R and floor 0.22 R; radii 0.87 / 0.42 / 0.37 / 0.50; cross-check 6 / 0.5 / 2; unsupported version throws; DB uniques; study figures 43 / 3 066 / 0.282 / 99.09 %; diffusion "7.3 of 8" | 1 (D1) |
| ORBES-CODE-SPEC | ✓ | 15: ring table (13 rings, every count and offset, 1 344 cells); format cells 0–14 and 24–38; moons 27.5 / 1.75 / angles / positions; halo 2.6 / 0.4; arc 0.72; mask seeds; RS(164,79); `MAX_RS_ERASURES` 70 and the erasure schedule; brute-force 0 / 30 / 60; decor radii, widths and tones; quiet probes 4.85 / 24.6; colourways; vector payload, key, signature, CRC and format word; latency target | 1 (D2) |
| CRYPTOGRAPHY | ✓ | 12: `zip215: false`; signing domain and 13-byte guard; transfer-code HKDF salt and info; local-key AAD = kid, 0700 / 0600; scrypt 15/8/1, 16/32; TOTP replay guard; lowest-unused key ids and DELETE/TRUNCATE guard; published `revokedAt`/`compromisedAt` (live); verify-after-sign; revoked-key rule order (`verification.ts`); registration-token hashing; CBOR table | 1 (D3), 1 unverifiable (D4) |
| SECURITY-MODEL | ✓ | 12: login throttle 10 / 15 min; admin lockout; `__Host-` cookies; CSP, Permissions-Policy, Referrer-Policy and no X-Powered-By (live); 16 KB body (413 live); verify 1 024 / 200; memory provider refused; production refusals; append-only guards; audit chain; geography statements; refusal list | 2 (D5, D6) |
| THREAT-MODEL | ✓ | 11: claim attempts 5/h; 60-bit codes; 15-min tokens; fuzz test; `npm audit` in CI; revoked key → INVALID SIGNATURE; owner exception; source counting; CSP; `.well-known` keys; coordinate source | 1 (D7), 1 cosmetic (D8) |
| API | ✓ | 18: body limit, 30 s timeouts, 128-char params; rate-limit defaults and headers (live); session TTLs; 20 sessions; HSTS; key headers (live); categories bare array and max-age 60 (live); sample code = vector; `/` → 302; 400 not recorded; health body and 2 s timeout; HEAD support; 404 for unknown routes and methods; 415 / 413 (live); copy table; decision order | 1 (D9) |
| DATABASE | ✓ | 12: pool settings; OR001; guard triggers; migration list; LOCKED never set; housekeeping every 10 min; `MIGRATE_ON_START`; `VERIFY`-only scan events; first-key behaviour; lifecycle tables = code; product_overview fields; coordinates note | 1 (D10) |
| BRAND-DESIGN-SYSTEM | ✓ | 11: colourways; `ARTIFACT_LIMITS` 10–500; default 30 mm; `tryInverted` / `tryMirrored` per path; decor tones; `black` alias; brand tokens; favicon proportions; `LABEL_LAYOUT` 7.5 u; `SAMPLE - NOT VALID`; sheet sizes | 0. §8 lists 5 open deviations itself (open item 9). |
| FUTURE-HARDWARE | ✓ | 10: kinds; PrintedCode implemented; `UNSUPPORTED`; default policy; assurance values; `hardwareProofRequired`; scanner notice; no hardware table yet; no hardware field in VerifyInput; class names | 1 (D11) |
| DEPLOYMENT (extra) | ✓ | 12: HOST / PORT / KEY_PROVIDER defaults; anomaly, rate-limit and TTL defaults; geo refusal table; HSTS; `/verify` no-cache (live); malformed smoke output (live); api budget 120; demo 41 products / 8 accounts (live); key JSON; `npm run demo` statement | 2 (D12, D13) |

Other documents with inaccuracies: ARCHITECTURE (D14–D17), PLATFORM-CONTRACTS (D18–D20), `genome/README.md` (D21), `docs/reports/performance.md` (D22), and a code comment (D23).

---

## 4. Open items

### 4.1 Specification gaps (PARTIAL) — status after remediation

| # | Item | Status | What was done / why not |
|---|---|---|---|
| 1 | Physical print validation (§30) | **OUT OF SCOPE** (physical) | Needs the test sheets printed on the real substrates and scanned with real phones; a software prototype cannot produce that evidence and none is claimed. Procedure below. |
| 2 | Real-device performance (§28) | **OUT OF SCOPE** (physical) | Needs a recent iPhone (Safari) and a mid-range Android (Chrome). Not measured, not estimated. Procedure below; `docs/reports/performance.md` Limitations says so. |
| 3 | Code-free frame latency (§8) | **DONE** (target restated + enforced) | Profiling showed code-free frames cost what they do because every detection pass (coarse and fine binarisation, row and column scans, seal-less moon fallback) runs before giving up; those passes are what find damaged or glared seals, so stopping early on `NO_SEAL` would trade robustness for idle-frame speed (and the bench frames fail with `NO_MOONS`, not `NO_SEAL`). ORBES-CODE-SPEC §10 now states the qualified target with the reason; `scripts/decoder-budget.ts` + `bench.ts` enforce it on the Chromium worker run (exit 1 over budget); `test/decoder/latency-budget.test.ts` keeps the script and the spec in sync. Run 3: PASS. |
| 4 | KMS/HSM key custody (§12) | **OUT OF SCOPE** (needs a production KMS) | A vendor provider needs the vendor account, its non-exportable Ed25519 key type and client (packages cannot be added in this pass); an untested provider would be fake assurance. Done instead: a reusable provider acceptance suite `test/keys/provider-contract.ts` (memory and local pass it in `provider-contract.test.ts`), CRYPTOGRAPHY §5.4 and DEPLOYMENT §7.6 state plainly that no KMS provider ships and how to add and gate one. |
| 5 | Scan-data retention (§37) | **DONE** (mechanism); period = legal decision | `SCAN_RETENTION_DAYS` (`config.ts`: whole days 30–3650, refused below the anomaly look-back `scanLookbackDays`), housekeeping job `scanHistory` (`context.ts` → `services/scan-retention.ts`: `scan_tokens`, then `authentication_events`, then `scan_events`, batches of 1 000, ≤ 50 per pass), production warning while unset, `.env.example` / `deploy/vps` / compose wiring. Tests: `test/api/context.test.ts` (purge, order, batching, unset keeps all), `test/db/config.test.ts`. Docs: DATABASE §10, SECURITY-MODEL §3.6 and §4, THREAT-MODEL O, DEPLOYMENT §3, PLATFORM-CONTRACTS §0. Counsel must still choose the period. |
| 6 | Code-version dispatch (§26) | **DONE** | `src/core/code-profiles.ts` (`CODE_PROFILES`, `CODE01_PROFILE`, `unframeAnyCodeData`, `codeVersionOf`); decoder picks the profile from the format word and reports "unsupported code version N" without brute-forcing; encoder writes any registered version; `verification.ts` → UNKNOWN `UNSUPPORTED_CODE_VERSION` + warning; signature checked over the profile's signing message. Tests: `test/core/code-profiles.test.ts` (synthetic version-2 profile), `test/verification/verification.test.ts`, counterfeit scenario 6j (6i now covers nibble 0). Docs: ORBES-CODE-SPEC §12, ARCHITECTURE B.5, API §9.4, DATABASE, PLATFORM-CONTRACTS §2.4, CONTRACTS, THREAT-MODEL S. |
| 7 | Low-light test gate (§29) | **DONE** | `test/decoder/robustness-damage.test.ts`: `lowLight` preset at 4 px/u, random pose, ≥ 95 % of 20 seeded captures (passes). |
| 8 | Website hygiene (§38) | **DONE** | Root `.vercelignore` adds `deploy/` and `node_modules/`; root `.gitignore` (`node_modules/`); `test/ops/vps-stack.test.ts` asserts both. DEPLOYMENT §15.10 and LAUNCH updated. The stray `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json` was removed from the index in commit `4e643de` (`git ls-files node_modules` is empty). |
| 9 | Brand deviations (BRAND §8) | **3 DONE, 2 OUT OF SCOPE** | Done: item 2 (GENOME on ivory plates drawn in `ORBES_CODE_STYLES.ivory.ink` `#111111`, via `genomeFigureMarkup` / `genomeRowMarkup`; colourways moved to `src/core/code/styles.ts` so the verify bundle does not pull in the encoder), item 8 (13 component font-size tokens, no literal pixel size left; test), item 11 (two date formats documented as deliberate, reason in `format.ts`). Out of scope: item 1 (one vector wordmark needs the brand's master artwork, and `index.html` is not modified) and item 18 (a web font needs a licence decision). BRAND §3.1 and §8 updated; tests in `test/web/*.brand.test.ts`. |

Procedures for the out-of-scope physical items:

- **Item 1.** Print `docs/assets/test-sheets/orbes-code-test-sheets.pdf` and its leather and metal SVGs on the real substrates. Scan with an Android phone, an iPhone and an iPhone Pro, record the results in the sheet's table, and update `docs/reports/print-size-matrix.md` and BRAND §2.6 with the physical minimum.
- **Item 2.** On a recent iPhone (Safari) and a mid-range Android (Chrome), over remote debugging and with the instrumentation in `test/e2e/support.ts`: camera start → decode (median of ≥ 5 scans) and worker decode time per frame; add the table to `docs/reports/performance.md`. Optionally run `test/e2e/camera-scan.test.ts` through `playwright-core` `webkit` where available.
- **Item 4.** Implement `src/server/keys/<vendor>-provider.ts`, add it to `KEY_PROVIDER` in `config.ts` and `createKeyProvider`, add a `describeKeyProviderContract('<vendor>', …)` line against a vendor test account, then follow DEPLOYMENT §7.6.

### 4.2 Document inaccuracies

| # | Document | Inaccuracy | Fix | Status |
|---|---|---|---|---|
| D1 | ORBES-GENOME-SPEC §2 | "on average 7.3 of 8 glyphs differ between consecutive serials". The measured value is **7.51** over serials 1–20 000, close to the 7.5 expected for unrelated values; `test/genome/genome.test.ts:95` only asserts > 7.3. | Write "≈ 7.5 of 8 (the random expectation; the test asserts > 7.3)". | FIXED — ORBES-GENOME-SPEC §2 now says ≈ 7.5 (7.50 re-measured over the test's 20 000 serials; the test asserts > 7.3). |
| D2 | ORBES-CODE-SPEC §10 | Latency "< 100 ms per 1280 × 720 frame on a laptop". Measured p95 94–102 ms with a code, and p50 155–185 / p95 306–370 ms without one. | Qualify the target (open item 3), or fix the decoder. | FIXED — §10 qualified (item 3), enforced by `bench.ts`. |
| D3 | CRYPTOGRAPHY §6 | Registration tokens "stored hashed (SHA-256 with domain separation)". `hashScanToken` in `genome/src/server/services/scan-tokens.ts` is plain `sha256(raw 32 bytes)`. | Change the doc to "SHA-256 of the 32 random bytes", or add a domain label in code. That also changes stored hashes, so outstanding tokens (15 min) become invalid at deploy. | FIXED (doc) — CRYPTOGRAPHY §6: "SHA-256 of the 32 random bytes" (no code change, so no outstanding token is invalidated). |
| D4 | CRYPTOGRAPHY §3.1 | The CBOR / JSON size table (25 / 32 / 64 / 140 bytes) cannot be reproduced: no script or test computes it. | Add `scripts/payload-encodings.ts` (deterministic CBOR per RFC 8949 §4.2.1 over the same fields) and cite it, or label the figures as hand-computed. | FIXED — `scripts/payload-encodings.ts` computes the table (CBOR integer keys 25 / 32 bytes confirmed; the field-name rows were wrong and are replaced: 117 bytes CBOR, 146 bytes JSON, two RS blocks); `test/crypto/payload-encodings.test.ts` checks the doc against it. ARCHITECTURE D updated. |
| D5 | SECURITY-MODEL §3.6 | "lat/lon rounded to 0.1° when the trusted edge provides it". `GEO_MODE=mmdb` derives country and coordinates on the server from the client IP (`src/server/geo/mmdb.ts`). | Add: "or, in `mmdb` mode, from a local GeoIP lookup of the client IP (in memory, never stored)". | FIXED — SECURITY-MODEL §3.6 names the `mmdb` lookup (in memory, never stored, no region) and the retention setting. |
| D6 | SECURITY-MODEL §4 | The refusal list names only `cloudflare` / `headers` without `TRUST_PROXY`. `config.ts:384` also refuses `mmdb` without `TRUST_PROXY`, and every environment requires an absolute `GEO_MMDB_PATH` in `mmdb` mode. | Add both rules. | FIXED — SECURITY-MODEL §4 lists `mmdb` without `TRUST_PROXY` (production) and `mmdb` without an absolute `GEO_MMDB_PATH` (every environment). |
| D7 | THREAT-MODEL §5 O | "Coordinates … only from trusted CDN headers". | Add the `mmdb` local lookup. | FIXED — THREAT-MODEL O names the `mmdb` lookup and the retention setting. |
| D8 | THREAT-MODEL §5 | Rows are ordered K, L, R, M, N, O, Q, P. | Reorder alphabetically. | FIXED — rows K…S in order (S added for the code-version nibble). |
| D9 | API §4 | Location is said to come only from `GEO_MODE=cloudflare` or `headers`. | Add `GEO_MODE=mmdb` (local DB-IP/MaxMind lookup of `request.ip`, `TRUST_PROXY` required in production; no `region`). | FIXED — API §4 lists `GEO_MODE=mmdb` (no region, `TRUST_PROXY` in production). |
| D10 | DATABASE §5.16 (Privacy, coordinates) | Same omission of `mmdb`. | Same fix. Also say that `region` is filled only in `cloudflare` mode. | FIXED — DATABASE §5.16 adds `mmdb` and "region only in `cloudflare` mode". |
| D11 | FUTURE-HARDWARE §2 | The table names classes `SecureNFCAuthenticator`, `SecureElementAuthenticator` and `TamperEvidentAuthenticator`, which do not exist. The registry uses `UnimplementedAuthenticator('SECURE_NFC' \| 'SECURE_ELEMENT' \| 'TAMPER_EVIDENT')` (`genome/src/server/authenticators/index.ts:69,118–120`). | Say "placeholder `UnimplementedAuthenticator(kind)`; a `SecureNFCAuthenticator` class replaces it when implemented". | FIXED — FUTURE-HARDWARE §2 names the `UnimplementedAuthenticator(kind)` placeholders and the future classes as future. |
| D12 | DEPLOYMENT §13 (smoke test 2) | The example key JSON ends at `"revokedAt":null}` and lacks `"compromisedAt":null`, which every key carries (verified live; API §8.2). | Add the field. | FIXED — `"compromisedAt":null` added. |
| D13 | DEPLOYMENT §13.1 | "`package.json` has no `npm run demo` alias". It has `"demo": "tsx src/server/index.ts --demo"`. | Replace with "`npm run demo` (or `npm start -- --demo`)". | FIXED — DEPLOYMENT §13.1 cites `npm run demo`. |
| D14 | ARCHITECTURE B.5 | "Decoders and genome generators are looked up through version registries". Only genomes have a registry. | Fix the code (open item 6), or say "genome generators are looked up by version; CODE-01 is the only code profile, and its version is checked in the format word and payload". | FIXED — by code (item 6) and reworded: code profiles via `CODE_PROFILES`, genomes by version, decoder geometry limit stated. |
| D15 | ARCHITECTURE B.3 | Lists `src/server/security/` (it does not exist; the code is in `src/server/http/`) and puts authenticators under `services/` (they are in `src/server/authenticators/`). It omits `crypto/`, `geo/`, `render/` and `demo.ts`. | Copy the layout from `genome/README.md` "Directory layout". | FIXED — B.3 is the README layout (http/, authenticators/, crypto/, geo/, render/, demo.ts, code-profiles.ts). |
| D16 | ARCHITECTURE C (row I) | "Owner-account notifications" is listed as a current protection, but no notification channel exists (no email; SECURITY-MODEL §3.3). | Move it to future mitigation, matching THREAT-MODEL I. | FIXED — moved to residual risk / future mitigation. |
| D17 | ARCHITECTURE B.2 | "KeyProvider: local \| KMS/HSM" suggests a KMS provider exists. | Write "local (KMS/HSM-ready interface)". | FIXED — "KeyProvider: local; KMS/HSM-ready interface". |
| D18 | PLATFORM-CONTRACTS §0 | `AppConfig.geo.mode` lacks `'mmdb'` and `mmdbPath`. The refusal sentence lacks `mmdb` without `TRUST_PROXY`. | Copy the type from `config.ts:45` and add the rule. | FIXED — `AppConfig.geo` type with `mmdb` and `mmdbPath`, the `mmdb` refusals, and `scanRetentionDays`. |
| D19 | PLATFORM-CONTRACTS §2.12 and §1 | The GeoResolver section describes three modes, not four (`mmdb`: `resolve` reads `request.ip`). The `accounts` table row lacks `failed_logins` and `failed_logins_since` (migration 0002). | Add the fourth mode and the two columns. | FIXED — fourth geo mode (`request.ip`, no region) and `failed_logins` / `failed_logins_since`. |
| D20 | PLATFORM-CONTRACTS §3 (Static web) | "`/verify` (and `/`) → `dist/web/verify/index.html`". `/` answers 302 → `/verify` (API §18, verified live). | Split the rows. | FIXED — `/` (302 → `/verify`) and `/verify` are separate rows. |
| D21 | `genome/README.md` | "Most skip when it is missing, but `test/web/admin.e2e.test.ts` does not". It now has `describe.skipIf(!HAS_CHROMIUM)` (line 107). The README also does not list `npm run demo`. | Fix the sentence and add `npm run demo` to "Run the service". | FIXED — README: every Chromium suite skips cleanly; `npm run demo` listed; layout and script tables updated. |
| D22 | `docs/reports/performance.md` | "Verify API on PostgreSQL 16: not measured". | Add this audit's run: PostgreSQL 16, pool 10, localhost, 1 000 requests. Sequential p50 9.9 / p95 14.1 / p99 17.3 ms; 8 in flight p95 38.6 ms, 302 req/s; 0 non-200. | FIXED — performance.md records two PostgreSQL 16 runs (this audit's and a re-run: p95 14.1 / 15.9 ms sequential). |
| D23 | `genome/src/core/code/profile.ts` header comment | "r 23.0 ─ 25.75 quiet band". ORBES-CODE-SPEC §4.7 defines it from r 22.86 to 24.70 (NW) / 25.75. | Align the comment. | FIXED — `profile.ts` header gives r 22.86 – 24.70 / 25.75. |

### 4.3 Accepted limitations (documented, no action required now)

- A static code can be copied (THREAT-MODEL A, B, J). Detection is statistical; the counterfeit simulation records 6 LIMIT checks, all documented.
- `409 EMAIL_TAKEN` on registration reveals that an account exists (SECURITY-MODEL §3.3) until an email channel exists.
- The admin lockout can be abused to keep a known admin out, and first TOTP enrolment in the console is trust-on-first-use (SECURITY-MODEL §3.3).
- Only `VERIFY` scan events are written. Registrations and transfers are recorded in `audit_logs` (DATABASE §5.16).

---

## 5. Remediation (2026-10-01)

Every item of §4 was worked in a second pass the same day, test first where behaviour changed (the new or changed test was run red, then the fix made it green). `index.html` was not touched and no state-changing git command was run.

| Check | Command | Result |
|---|---|---|
| Full test suite, PostgreSQL suites included | `cd genome && ORBES_TEST_POSTGRES_URL=postgres://…@127.0.0.1:5432/postgres npx vitest run` | **126 files, 1 935 tests passed, 0 failed** (387 s; Chromium E2E included) |
| Typecheck | `npx tsc -p tsconfig.json` | clean (exit 0) |
| Proof of concept | `npm run poc` | PASSED, 8 of 8 outcomes as expected |
| Web build | `npx tsx scripts/build-web.ts --out <tmp>` | 10 files; verify 74.9 KB, worker 62.2 KB (+1.4 KB: the code-profile registry), admin 126.0 KB; no key material, no signing code |
| Decoder latency budget (item 3) | `npx tsx scripts/bench.ts --only decoder` | Chromium worker: code p50 37.4 ms; code-free p50 127.0 ms, p95 189.6 ms → **PASS** (exit 0) |
| Verify API on PostgreSQL 16.14 (D22) | `ORBES_TEST_POSTGRES_URL=… npx tsx scripts/bench.ts --only api,issuance` | sequential p50 10.8 / p95 15.9 / p99 22.9 ms; 8 in flight p95 56.9 ms at 210 req/s; 0 non-200 |
| Counterfeit simulation | `npx tsx scripts/counterfeit-simulation.ts` | 114 checks: 108 PASS, 6 LIMIT (documented), 0 GAP, 0 FAIL; report regenerated |
| Payload encodings (D4) | `npx tsx scripts/payload-encodings.ts` | table of CRYPTOGRAPHY §3.1 |

New and changed tests: `test/core/code-profiles.test.ts` (new), `test/verification/verification.test.ts` (unsupported code version → UNKNOWN + warning), `test/simulation/scenarios.ts` (3d, 6i, 6j), `test/decoder/robustness-damage.test.ts` (low light), `test/decoder/latency-budget.test.ts` (new), `test/crypto/payload-encodings.test.ts` (new), `test/keys/provider-contract.ts` + `provider-contract.test.ts` (new), `test/api/context.test.ts` (scan-history purge), `test/db/config.test.ts` (`SCAN_RETENTION_DAYS`, production warning), `test/ops/vps-stack.test.ts` (`.vercelignore` `deploy/` + `node_modules/`, root `.gitignore`), `test/web/verify.brand.test.ts` and `test/web/admin.brand.test.ts` (ivory ink, font-size tokens).

Code changed: `src/core/code-profiles.ts` (new), `src/core/payload.ts` (`UNSUPPORTED_VERSION`), `src/core/code/encoder.ts`, `src/core/code/styles.ts` (new), `src/core/decoder/decode.ts`, `src/core/code/profile.ts` (comment), `src/server/services/verification.ts`, `src/server/config.ts`, `src/server/context.ts`, `src/server/services/scan-retention.ts` (new), `src/web/verify/genome-view.ts`, `src/web/admin/ui/figures.ts`, `src/web/admin/format.ts` (comment), `src/web/shared/brand.css`, `src/web/verify/styles.css`, `src/web/admin/styles.css`, `scripts/bench.ts`, `scripts/decoder-budget.ts` (new), `scripts/payload-encodings.ts` (new), `.env.example`; repository root `.vercelignore`, `.gitignore` (new), `deploy/vps/.env.example` and `deploy/vps/compose.yaml` (one line each for `SCAN_RETENTION_DAYS`).

Out of scope for a software prototype, stated rather than faked: physical print validation (item 1), real-device measurements (item 2, the remaining PARTIAL §28), a vendor KMS/HSM provider (item 4), the brand's master vector wordmark (item 9.1) and a licensed web font (item 9.18). The retention *period* (item 5) is a legal decision; the mechanism is in place.

---

## 6. Final gate (2026-10-01)

Every check re-run on commit `4e643de` with a clean working tree, after the remediation of §5. No code change was needed; this pass only removed two ignored, untracked camera clips left at `genome/` from a debugging session (`ramp-full.y4m`, `ramp-limited.y4m`) and updated this document.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json` | clean (exit 0) |
| Full test suite, run 1 | `npx vitest run` | 126 files (121 passed, 5 skipped: the PostgreSQL suites), **1 910 tests passed, 25 skipped, 0 failed** (357 s) |
| Full test suite, run 2 (flakiness) | `npx vitest run` | identical: **1 910 passed, 25 skipped, 0 failed** (366 s) |
| Full test suite, PostgreSQL suites included | `ORBES_TEST_POSTGRES_URL=postgres://…@127.0.0.1:5432/postgres npx vitest run` | **126 files, 1 935 tests passed, 0 skipped, 0 failed** (389 s; Chromium E2E included) |
| Proof of concept | `npm run poc` | PASSED, 8 of 8 outcomes as expected |
| Web build | `npm run build:web` | 10 files; verify 74.9 KB, worker 62.2 KB, admin 126.0 KB; no source maps; grep for `privateKey`, the sample seed, `KEY_ENCRYPTION_KEY`, `COOKIE_SECRET`, `IP_HASH_PEPPER`, `ed25519`: no match |
| Demo database and server | `DATABASE_URL=pglite:<dir>`: `db.ts migrate` → `seed` → `export-demo-codes.ts`, then `npm start` | 3 migrations; `GET /api/v1/health` 200 `{"ok":true,"version":"0.1.0"}`; `/api/v1/keys` and `/.well-known/orbes-keys.json` 200 (retired seed key + new active key); `/verify` and `/admin` 200 `no-cache` with the documented CSP, Permissions-Policy and Referrer-Policy; `/` → 302; unknown route → 404; SIGTERM → clean shutdown, no error log line |
| End-to-end verify | exported PNG of `O26-J-00184` decoded by the core decoder, then `POST /api/v1/verify` | decoded bytes identical to the manifest; **AUTHENTIC_FIRST_REGISTRATION**, `G1-E1DC-BE52`, registration offered; **42 of 42** demo codes returned their manifest's expected state; altered code and `AAAA` → MALFORMED_CODE |
| Hygiene | `git status --ignored`, `git ls-files`, grep for key material | no debug or scratch files (`zz-*`, `.dev-*`, `.prof*`) in `genome/src`, `genome/scripts`, `genome/test`; nothing under `node_modules/` tracked; no `.pem`, `.env` (other than the two `.env.example`) or key store tracked. Key-like literals only in the labelled public sample vector (`docs/vectors/code01-sample.json`), the RFC 8032 test vectors (`test/crypto/ed25519.test.ts`), test-only config secrets, and the dev cookie secret that production refuses. `genome/.gitignore` covers `out/`, `dist/`, `.data/`, `/keys/`, `*.pem`, `*.key.json`, `.env*`. |

Still open, unchanged and out of scope for a software prototype: physical print validation (item 1), real-device measurements on iOS Safari and Android Chrome (item 2, the PARTIAL §28), a vendor KMS/HSM provider (item 4), the brand's master vector wordmark (item 9.1, needs `index.html`, which is off-limits) and a licensed web font (item 9.18). The scan-retention period (item 5) is a decision for counsel.

---

## 7. Production hosting: accepted deviations (2026-10-01)

The first production deployment of `verify.theorbes.com` does not follow two assumptions of [DEPLOYMENT.md §15](DEPLOYMENT.md) and [LAUNCH.md](LAUNCH.md). The owner accepted both explicitly on 2026-10-01. The code and the stack (`deploy/vps/`) are unchanged.

This repository is public, so this section deliberately names no host, address or co-hosted product. The detailed record stays with the owner.

| # | Deviation | Requirement not met | Risk accepted | Mitigations | Exit path |
|---|---|---|---|---|---|
| H1 | The stack runs on a **shared** VPS, next to other Docker workloads that are managed separately. Some of those workloads have Docker API access (`docker.sock`), which is root-equivalent. | SECURITY-MODEL §5 and the DEPLOYMENT §15 checklist: "LocalKeyProvider on a dedicated host with encrypted disk". | Any person, process or container with root or Docker API access on that host can read `KEY_ENCRYPTION_KEY` and the keys volume, and could then issue codes that verify as AUTHENTIC. Rootless Docker was considered and rejected: it gives no isolation from root-equivalent surfaces, and its default port driver hides client IPs. | In place: ORBES runs as its own compose project, user and volumes. Agreed with the host owner, still to be completed: MFA on every console with Docker access; Docker API access removed wherever it is not needed; no automated agent with Docker access acts on untrusted input. Key compromise runbook: DEPLOYMENT §7.5 (revoke with the compromise time, then rotate). | A dedicated EU VPS via `backup.sh` → `restore.sh` (DEPLOYMENT §15.9, drilled), or a non-exportable KMS/HSM provider (open item 4). Exposure during the shared period cannot be undone, only answered by revocation and rotation. |
| H2 | The VPS is outside the EU (Canada). | DEPLOYMENT §15 sizing row: "in an EU region … for data-protection simplicity". | Scan data (pseudonymised IP and device hashes, approximate location) and account data are processed outside the EU. | The privacy policy must state where data is processed (LAUNCH §10). Counsel to confirm the transfer basis. | The same move as H1. |

Host preparation on the shared VPS also differs from LAUNCH §2. `bootstrap-ubuntu.sh` was **not** run in full, because its package upgrade, `daemon.json`, ufw, unattended-upgrades, fail2ban and SSH steps would change a host the stack does not own. Only `--units-only` (the backup and GeoIP timers) was run, and the `orbes` user, `/opt/orbes`, `/var/backups/orbes` and the `age` tool were set up by hand. The host's firewall, updates, swap and SSH policy stay with its owner.

House rules for that host:

- no `docker system|image|volume prune` with `-a` or `--volumes`: with the stack stopped, they delete the database and signing-key volumes or the rollback images;
- old `orbes-genome:<tag>` images are removed by hand, keeping the current and previous tags;
- an external uptime check on `/api/v1/health`, in addition to any monitor on the host itself.

Revisit H1 and H2 before the public launch announcement (LAUNCH §10), and at least yearly.
