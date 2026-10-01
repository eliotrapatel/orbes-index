# ORBES GENOME CODE™ — Master specification compliance audit

Status: audit of 2026-10-01, against commit `c28230a` (plus a clean working tree) · Scope: every section 0–38 of the master specification, the nine required documents and DEPLOYMENT · Method: code reading, the test suite, and running the system.

**Verdict.** Every section of the master specification is implemented. 33 sections are **MET**, 6 are **PARTIAL**, and none is **MISSING**. The PARTIAL sections are:

- §8: a latency target for code-free frames;
- §26: the code-version dispatch;
- §28: real-device evidence;
- §29: a low-light test gate;
- §37: data retention;
- §38: website hygiene.

Two MET sections carry open items: KMS custody (§12) and physical print validation (§30). 23 document inaccuracies were found. None of them affects security or decoding. All of them are listed under [Open items](#4-open-items) with a fix.

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
| 8 | Robust ECC (RS, documented); measurable targets | **PARTIAL** | RS decision record ORBES-CODE-SPEC §6.2; targets §10; `test/decoder/robustness-*.test.ts`; [scan-matrix](reports/scan-matrix.md). Gap: the "< 100 ms per frame" target is not met for code-free frames (p50 155–185 ms, p95 306–370 ms; [performance](reports/performance.md) §2). Open items 3 and 26. |
| 9 | Separate data, finder, genome, decor, ECC and security elements; mark which are machine-critical | MET | ORBES-CODE-SPEC §3 table ("Critical?") and §4.7 |
| 10 | Universal seal; orientation; recognisable when partly obscured | MET | Seal 1:1:4:1:1 finder (§4.1); `test/decoder/robustness-damage.test.ts` "2 u wide strip … even across the seal" |
| 11 | Compact canonical payload; Ed25519; no personal data; not JSON | MET | 13-byte fixed layout (CRYPTOGRAPHY §3, CBOR decision §3.1). `genome_id` = product id, bound through the signed identity. `test/core/payload.test.ts` |
| 12 | Key abstraction, key id, rotation, revocation, historical verification, KMS/HSM-compatible | MET (open item 4) | `KeyProvider` / `KeyService` (`src/server/keys/`); 1-byte `keyId` in every code; revoked-key cut-off; `test/keys/key-service.test.ts`, `test/api/admin-keys.test.ts`, `test/simulation/high-risk-keys.test.ts`. No concrete KMS provider exists yet. |
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
| 24 | Threats A–J, each with attack, protection, residual risk and future mitigation | MET | THREAT-MODEL §4 (plus K–R in §5) |
| 25 | `PhysicalAuthenticator`, `PrintedCodeAuthenticator`, hardware kinds as future work; no fake hardware | MET | `src/server/authenticators/index.ts` (hardware kinds → `UNSUPPORTED`, `CODE_ONLY` assurance); `test/verification/authenticators.test.ts` |
| 26 | Versioning GENOME-01 / CODE-01; future versions without breaking old products | **PARTIAL** | Genome: version registry (`SUPPORTED_GENOME_VERSIONS`, `computeGenome` by version), signed version, `UNSUPPORTED_GENOME_VERSION` → UNKNOWN. Code: version in the format word and the signed payload, and the format/seal/moons are invariant (ORBES-CODE-SPEC §12). But `CODE_VERSION = 1` is hard-wired in `payload.ts` and `decoder/decode.ts`: there is no code-profile registry or dispatch. Open item 6. |
| 27 | Counterfeit simulation suite covering the nine listed cases | MET | [counterfeit-simulation](reports/counterfeit-simulation.md): 113 checks, 107 PASS, 0 GAP, 6 LIMIT (documented detection limits), 0 FAIL; `test/simulation/*.test.ts` |
| 28 | Recognition < 1 s; API < 300 ms; iOS Safari and Android Chrome | **PARTIAL** | API: p95 14.1 ms on PostgreSQL 16 (this audit), 28.6–32.0 ms on PGlite. Recognition: median 468–529 ms in headless Chromium with a fake camera (performance §1). Not measured on any real phone, iOS Safari / WebKit, or Android Chrome. Open item 2. |
| 29 | Automated tests for every listed area, plus visual regression | **PARTIAL** | Covered: genome (`test/genome`), payload (`test/core/payload`), signatures (`test/crypto`), rotation (`test/keys`), encode/decode/ECC (`test/code`, `test/decoder`, `test/ecc`), distortion/rotation/perspective/occlusion (`test/decoder/robustness-*`), invalid signatures, revocation, duplicates, anomalies, transfer, warranty (`test/simulation`, `test/anomaly`, `test/services`), visual regression (`test/visual/renderer.test.ts`). Gap: **low-light** is gated only by the scan-matrix script's `lowLight` preset, not by a Vitest test. Open item 7. |
| 30 | Test sheets at 10–50 mm on 7 renditions; smallest reliable size | MET (open item 1) | `scripts/test-sheets.ts` (`SHEET_SIZES_MM = [10,15,20,25,30,40,50]`), `docs/assets/test-sheets/` (8 pages); [print-size-matrix](reports/print-size-matrix.md): simulated minimum 25 mm, recommended 30 mm. Physical confirmation on real phones is still pending. |
| 31 | Must not look like QR, barcode, crypto or similar; architectural and luxurious | MET | BRAND §1–2 (and §1.2 "never look like"); orbital geometry; specimens in `docs/assets/` |
| 32 | Deliverables 1–20 | MET | Architecture, DB, API, crypto and genome specs (docs); encoder and decoder (`src/core`); scanner and admin (`src/web`); backend (`src/server`); demo dataset (`db/seed/demo.ts`); tests; DEPLOYMENT + `deploy/vps` |
| 33 | Nine required docs, readable without the code | MET (inaccuracies: §3) | All nine exist, plus DEPLOYMENT; see §3 |
| 34 | Phases 1–13; encoding and crypto proven before the UI | MET | ARCHITECTURE E; commit history; `npm run poc` |
| 35 | POC: issue → render → scan → decode → verify → AUTHENTIC; tampering → INVALID | MET | `scripts/poc.ts` run above. Deliberate, documented difference: replaced *printed glyphs* give SUSPICIOUS ACTIVITY (`GENOME_MISMATCH`), because the signed data is intact. Tampered identity, signature and genome version all give INVALID SIGNATURE. |
| 36 | Customer experience: the identity is the hero and the technology is invisible | MET | Verify app result view; `docs/assets/ui/*.png` (BRAND §9) |
| 37 | Absolute rules | **PARTIAL** | All DO NOT rules hold (§1 greps, bundle scan). "Expose unnecessary personal info": responses are minimal, but no retention limit exists for scan data (DATABASE §10), so pseudonymous scan history grows without bound. Open item 5. |
| 38 | First action A–E; existing site untouched; clean integration | **PARTIAL** | ARCHITECTURE A–E; `index.html` unchanged. Gap: `.vercelignore` does not exclude `deploy/`, and a stray tracked file `node_modules/.vite/vitest/…/results.json` sits at the repository root. Both are published with the static theorbes.com site. Open item 8. |

The tally is 33 MET and 6 PARTIAL (§8, 26, 28, 29, 37, 38). §12 and §30 meet the letter of the specification and carry open items 4 and 1.

---

## 3. Required documents: consistency with the code

At least 10 concrete claims per document were checked against the code, a running server or a script. ✓ = correct, ✗ = inaccurate (numbered as in §4).

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

### 4.1 Specification gaps (PARTIAL)

1. **Physical print validation (§30).** The minimum sizes (30 mm, or 25 mm light-on-dark) rest on simulation. Print `docs/assets/test-sheets/orbes-code-test-sheets.pdf` and its leather and metal SVGs on the real substrates. Scan with an Android phone, an iPhone and an iPhone Pro, record the results in the sheet's table, and update `docs/reports/print-size-matrix.md` and BRAND §2.6 with the physical minimum.
2. **Real-device performance (§28).** Measure on at least one recent iPhone (Safari) and one mid-range Android (Chrome), using remote debugging and the instrumentation in `test/e2e/support.ts`:
   - camera start → decode, median of ≥ 5 scans;
   - worker decode time per frame.

   Add a results table to `docs/reports/performance.md`. Optionally add a WebKit run of `test/e2e/camera-scan.test.ts` through `playwright-core` `webkit` where it is available.
3. **Code-free frame latency (§8).** ORBES-CODE-SPEC §10 promises "< 100 ms per 1280 × 720 frame". Frames without a code take p50 155–185 ms and p95 306–370 ms (performance §2). Either:
   - make `decodeOrbesCode` stop early on `NO_SEAL`, with a cap on seal candidates and ray casts when no 1:1:4:1:1 cluster passes the cross-check, and add a bench assertion; or
   - restate the target as "p50 < 100 ms on frames containing a code; code-free frames < 400 ms, at most one in flight".
4. **KMS/HSM key custody (§12).** Only `LocalKeyProvider` (and `MemoryKeyProvider`) exist. Before high-value production, implement a `KeyProvider` for the chosen KMS (`generate` → non-exportable Ed25519 key, `sign` → API call) in `genome/src/server/keys/`, register it in `config.ts` (`KEY_PROVIDER=<vendor>`), and test it against the existing provider contract tests (`test/keys/*`). Document it in CRYPTOGRAPHY §5.4 and DEPLOYMENT §7.6.
5. **Scan-data retention (§37, §16 "if legally appropriate").** No purge exists for `scan_events`, `authentication_events` or `anomalies` (DATABASE §10). Agree a retention period with counsel, then:
   - add `SCAN_RETENTION_DAYS` to `config.ts`;
   - add a housekeeping job in `context.ts` (`startHousekeeping`) that deletes dependent `scan_tokens` and `authentication_events` before `scan_events` older than the period (it must stay ≥ the anomaly windows: 30 days by default);
   - write tests in `test/api/context.test.ts`;
   - update DATABASE §10, SECURITY-MODEL §3.6 and THREAT-MODEL O.
6. **Code-version dispatch (§26).** `CODE_VERSION = 1` is hard-coded in `src/core/payload.ts` and `src/core/decoder/decode.ts`. Introduce a `CODE_PROFILES: Record<number, { profile; decodePayload; signingDomain }>` registry:
   - the decoder selects the profile from the format word's version;
   - `unframeCodeData` / `decodePayload` dispatch on the payload's high nibble;
   - `verification.ts` step 1 answers a well-formed but unsupported code version like step 5 (`UNKNOWN`, `UNSUPPORTED_CODE_VERSION`, server warning) rather than `MALFORMED_CODE`.

   Add a test with a synthetic version-2 profile. Alternatively, correct ARCHITECTURE B.5 (D14) and record the refactor as required before CODE-02.
7. **Low-light test gate (§29).** Add a case to `genome/test/decoder/robustness-damage.test.ts` that renders the code at 4 px/u through `test/support/camera-sim.ts` with the `lowLight` preset and asserts ≥ 95 % success over a seeded batch. The scan matrix measures 100 % at 3.5 px/u.
8. **Website hygiene (§38).** Make these changes, and extend the `.vercelignore` assertion in `genome/test/ops/vps-stack.test.ts` to cover `deploy/`:
   - add `deploy/` and `node_modules/` to the repository-root `.vercelignore`. Today the VPS scripts, Caddyfile and `.env.example` are published with the static theorbes.com site;
   - remove the tracked `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json` (`git rm --cached`) and add `node_modules/` to a root `.gitignore`.
9. **Brand deviations still open** (BRAND §8, recorded by the document itself):
   - 1: one vector wordmark for the specimen, print label and site;
   - 2: on-screen GENOME on ivory plates drawn in `#0A0A0A` while the ivory colourway prints `#111111`. Pass `ORBES_CODE_STYLES.ivory.ink` in `src/web/admin/ui/figures.ts` and `src/web/verify/genome-view.ts`;
   - 8: off-scale font sizes without tokens;
   - 11: zero-padded console dates. Document or unify the format in `src/web/admin/format.ts`;
   - 18: no web font.

### 4.2 Document inaccuracies

| # | Document | Inaccuracy | Fix |
|---|---|---|---|
| D1 | ORBES-GENOME-SPEC §2 | "on average 7.3 of 8 glyphs differ between consecutive serials". The measured value is **7.51** over serials 1–20 000, close to the 7.5 expected for unrelated values; `test/genome/genome.test.ts:95` only asserts > 7.3. | Write "≈ 7.5 of 8 (the random expectation; the test asserts > 7.3)". |
| D2 | ORBES-CODE-SPEC §10 | Latency "< 100 ms per 1280 × 720 frame on a laptop". Measured p95 94–102 ms with a code, and p50 155–185 / p95 306–370 ms without one. | Qualify the target (open item 3), or fix the decoder. |
| D3 | CRYPTOGRAPHY §6 | Registration tokens "stored hashed (SHA-256 with domain separation)". `hashScanToken` in `genome/src/server/services/scan-tokens.ts` is plain `sha256(raw 32 bytes)`. | Change the doc to "SHA-256 of the 32 random bytes", or add a domain label in code. That also changes stored hashes, so outstanding tokens (15 min) become invalid at deploy. |
| D4 | CRYPTOGRAPHY §3.1 | The CBOR / JSON size table (25 / 32 / 64 / 140 bytes) cannot be reproduced: no script or test computes it. | Add `scripts/payload-encodings.ts` (deterministic CBOR per RFC 8949 §4.2.1 over the same fields) and cite it, or label the figures as hand-computed. |
| D5 | SECURITY-MODEL §3.6 | "lat/lon rounded to 0.1° when the trusted edge provides it". `GEO_MODE=mmdb` derives country and coordinates on the server from the client IP (`src/server/geo/mmdb.ts`). | Add: "or, in `mmdb` mode, from a local GeoIP lookup of the client IP (in memory, never stored)". |
| D6 | SECURITY-MODEL §4 | The refusal list names only `cloudflare` / `headers` without `TRUST_PROXY`. `config.ts:384` also refuses `mmdb` without `TRUST_PROXY`, and every environment requires an absolute `GEO_MMDB_PATH` in `mmdb` mode. | Add both rules. |
| D7 | THREAT-MODEL §5 O | "Coordinates … only from trusted CDN headers". | Add the `mmdb` local lookup. |
| D8 | THREAT-MODEL §5 | Rows are ordered K, L, R, M, N, O, Q, P. | Reorder alphabetically. |
| D9 | API §4 | Location is said to come only from `GEO_MODE=cloudflare` or `headers`. | Add `GEO_MODE=mmdb` (local DB-IP/MaxMind lookup of `request.ip`, `TRUST_PROXY` required in production; no `region`). |
| D10 | DATABASE §5.16 (Privacy, coordinates) | Same omission of `mmdb`. | Same fix. Also say that `region` is filled only in `cloudflare` mode. |
| D11 | FUTURE-HARDWARE §2 | The table names classes `SecureNFCAuthenticator`, `SecureElementAuthenticator` and `TamperEvidentAuthenticator`, which do not exist. The registry uses `UnimplementedAuthenticator('SECURE_NFC' \| 'SECURE_ELEMENT' \| 'TAMPER_EVIDENT')` (`genome/src/server/authenticators/index.ts:69,118–120`). | Say "placeholder `UnimplementedAuthenticator(kind)`; a `SecureNFCAuthenticator` class replaces it when implemented". |
| D12 | DEPLOYMENT §13 (smoke test 2) | The example key JSON ends at `"revokedAt":null}` and lacks `"compromisedAt":null`, which every key carries (verified live; API §8.2). | Add the field. |
| D13 | DEPLOYMENT §13.1 | "`package.json` has no `npm run demo` alias". It has `"demo": "tsx src/server/index.ts --demo"`. | Replace with "`npm run demo` (or `npm start -- --demo`)". |
| D14 | ARCHITECTURE B.5 | "Decoders and genome generators are looked up through version registries". Only genomes have a registry. | Fix the code (open item 6), or say "genome generators are looked up by version; CODE-01 is the only code profile, and its version is checked in the format word and payload". |
| D15 | ARCHITECTURE B.3 | Lists `src/server/security/` (it does not exist; the code is in `src/server/http/`) and puts authenticators under `services/` (they are in `src/server/authenticators/`). It omits `crypto/`, `geo/`, `render/` and `demo.ts`. | Copy the layout from `genome/README.md` "Directory layout". |
| D16 | ARCHITECTURE C (row I) | "Owner-account notifications" is listed as a current protection, but no notification channel exists (no email; SECURITY-MODEL §3.3). | Move it to future mitigation, matching THREAT-MODEL I. |
| D17 | ARCHITECTURE B.2 | "KeyProvider: local \| KMS/HSM" suggests a KMS provider exists. | Write "local (KMS/HSM-ready interface)". |
| D18 | PLATFORM-CONTRACTS §0 | `AppConfig.geo.mode` lacks `'mmdb'` and `mmdbPath`. The refusal sentence lacks `mmdb` without `TRUST_PROXY`. | Copy the type from `config.ts:45` and add the rule. |
| D19 | PLATFORM-CONTRACTS §2.12 and §1 | The GeoResolver section describes three modes, not four (`mmdb`: `resolve` reads `request.ip`). The `accounts` table row lacks `failed_logins` and `failed_logins_since` (migration 0002). | Add the fourth mode and the two columns. |
| D20 | PLATFORM-CONTRACTS §3 (Static web) | "`/verify` (and `/`) → `dist/web/verify/index.html`". `/` answers 302 → `/verify` (API §18, verified live). | Split the rows. |
| D21 | `genome/README.md` | "Most skip when it is missing, but `test/web/admin.e2e.test.ts` does not". It now has `describe.skipIf(!HAS_CHROMIUM)` (line 107). The README also does not list `npm run demo`. | Fix the sentence and add `npm run demo` to "Run the service". |
| D22 | `docs/reports/performance.md` | "Verify API on PostgreSQL 16: not measured". | Add this audit's run: PostgreSQL 16, pool 10, localhost, 1 000 requests. Sequential p50 9.9 / p95 14.1 / p99 17.3 ms; 8 in flight p95 38.6 ms, 302 req/s; 0 non-200. |
| D23 | `genome/src/core/code/profile.ts` header comment | "r 23.0 ─ 25.75 quiet band". ORBES-CODE-SPEC §4.7 defines it from r 22.86 to 24.70 (NW) / 25.75. | Align the comment. |

### 4.3 Accepted limitations (documented, no action required now)

- A static code can be copied (THREAT-MODEL A, B, J). Detection is statistical; the counterfeit simulation records 6 LIMIT checks, all documented.
- `409 EMAIL_TAKEN` on registration reveals that an account exists (SECURITY-MODEL §3.3) until an email channel exists.
- The admin lockout can be abused to keep a known admin out, and first TOTP enrolment in the console is trust-on-first-use (SECURITY-MODEL §3.3).
- Only `VERIFY` scan events are written. Registrations and transfers are recorded in `audit_logs` (DATABASE §5.16).
