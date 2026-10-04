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
                         points of sale and the sale mode, photographs of models and pieces (media),
                         ownership certificates (shared links), the lookbook of the models and the owners' club,
                         the releases (drops), their early access and their draw by tier, the owners' circle,
                         the tiers' benefits, the LIVE RELEASES (live: the rules and actions; live-engine: the
                         ticker; live-room: what the public and a viewer read; live-console: the console;
                         live-insights: the intelligence)
    media/               uploaded photographs: type by magic bytes, EXIF/XMP stripped by hand, dimensions
    authenticators/      PhysicalAuthenticator registry (printed code today; hardware later)
    http/                sessions, CSRF, rate limiting, security headers, validation, static files; the LIVE
                         RELEASES' streams (live-stream.ts: LiveHub, Server-Sent Events fanned out once a second)
    routes/              public, account, ownership, club, live (the LIVE RELEASES), admin
    geo/                 location resolver (none | cloudflare | headers | mmdb), haversine
    render/              artifacts: SVG, PNG (resvg), vector PDF (pdfkit), print sheets, certificate cards,
                         the ownership certificate's PDF
  src/web/             browser apps (vanilla TypeScript, bundled by esbuild)
    verify/              mobile scanner: camera capture, decoder worker, result views; MY PIECES (/verify/pieces, YOUR TIER at its head);
                         THE COLLECTION (/verify/lookbook); THE RELEASES (/verify/releases); THE CIRCLE (/verify/circle);
                         an ownership certificate (/verify/c#token); a LIVE RELEASE's vault (/verify/releases/<id>,
                         views/live.ts) and its boutique board (/verify/releases/<id>/board#secret)
    admin/               admin console: catalogue, generator, keys, anomalies, analytics, audit, the Club (Drops, Circle, Tiers;
                         a LIVE RELEASE's page, #/club/live/:dropId);
                         the sale mode (decoder worker of verify/)
    legal/               the legal pages (J-06), the third app: privacy policy, terms of use, legal notice and FAQ, in French
                         and English (/legal, /legal/privacy, /legal/terms, /legal/notice, /legal/faq); content/*.ts with LEGAL_VERSION
    shared/              brand CSS, display font, monogram, DOM helpers; what verify/ and legal/ share (the legal pages' paths,
                         the second-hand sentence, the contact of ORBES Client Services)
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

### B.6 The owners' club (the « Potentiel » plan of 2026-10-03)

What a signed-in account holds now decides what it reads in the club. One function counts it: `tierOf` (`services/club.ts`), from the open ownerships of pieces neither REVOKED, COUNTERFEIT_FLAGGED nor RETIRED (`ownership` is only read), the tiers TITANE, PLATINE and PALLADIUM at 1, 3 and 5 pieces (`CLUB_TIER_THRESHOLDS`, a constant of the code), and the seniority in full years since the first ownership. Every customer route of the club is in `routes/club.ts`: an account session, CSRF and same origin for its POSTs, `no-store`, rate group `api` ([API §10.9–§10.11](API.md#109-the-club-get-apiv1clublookbook-and-get-apiv1clublookbookslug-extension-of-the-contract)).

- **The lookbook** (P-R02, `services/lookbook.ts`): the public sheets of the models, and the RESERVED ones for the owners.
- **The releases** (P-R03 and P-X02, `services/drops.ts`, `DropService`; `routes/public.ts`, `routes/club.ts`, `routes/admin/drops.ts`). A release goes DRAFT → published; then, when it has one, its **early access** from `max(opens_at − early_access_hours, published_at)` to `opens_at`, when an account PLATINE or PALLADIUM at the moment of its request reserves a place directly (`DropService.reserve`: the release's row `FOR UPDATE`, first come, first served, within `quantity`; the entry SELECTED at once, with its `respond_by`, its tier and seniority of that moment and no rank); then the **entries**, from `opens_at` to `closes_at` (`enter`, `withdraw`, any account); then the **draw** (ADMIN, `draw`), which opens the sealed seed, checks it against its commitment, reads every ENTERED entry's tier and seniority at that moment, ranks them and selects as many as there are places left (`quantity` less the places held or sold, the direct reservations among them); then ORBES Client Services concludes each place (`confirm`, `lapse`, `offerNext`).
- **The circle** (P-X01, `services/circle.ts`, `CircleService`; `routes/club.ts` for the members, `routes/admin/circle.ts` for the console, its photographs in `routes/admin/media.ts` through `MediaService`, its Analytics panel in `routes/admin/analytics.ts`): posts (NOTE, INVITATION, POLL) published from a tier up, read with `tierOf` at each request; answers to invitations under the post's `FOR UPDATE` within its capacity (audited), final votes in polls (not audited), a count of visits per day. `clubMembersByTier` (`services/club.ts`) counts the ACTIVE accounts at each tier for the Analytics panel, counts only.
- **The tiers' benefits** (P-X04, `services/club.ts`, `ClubService.tiers`, `updateTier`, `normalizeBenefits`; `routes/admin/club.ts`): the words of each tier's benefits, by default code constants (`CLUB_TIER_DEFAULT_BENEFITS`), changed from the console (`club_tiers`, at most `CLUB_TIER_BENEFITS_MAX` = 600 characters in `CLUB_TIER_BENEFIT_LINES` = 8 lines), audited through `AuditService` (`club.tier.update`). `ClubService.status` (`GET /api/v1/club/status`) gives the account its tier, the benefits of its tier and those below it, the next tier, and its entries.

The web side: in `web/verify/`, `releases-model.ts` and `views/releases.ts` (THE RELEASES, the early access line and RESERVE A PLACE), `circle-model.ts` and `views/circle.ts` (THE CIRCLE: the routes `/verify/circle` and `/verify/circle/<id>` in `main.ts`'s `routeOf`, like `/verify/pieces`), `tier-model.ts` and `views/pieces.ts` (YOUR TIER at the head of MY PIECES, read from the club's status; THE CIRCLE at its foot for an owner). In `web/admin/`, the Club page (`views/club.ts`, `#/club`, its tabs `drops`, `circle`, `tiers`), a release's page (`views/drop.ts`, `#/club/drops/:dropId`), a post's page (`views/circle.ts`, route `circlePost`, `#/club/circle/:postId`, its view-model `model/circle.ts`), the Tiers tab (`views/tiers.ts`, its rules in `model/club.ts`), the Analytics panel *The Circle* (`views/analytics.ts`), and the capabilities `manageDrops`, `drawDrop` (ADMIN), `manageCircle` and `manageClubTiers` (OPERATOR) in `model/permissions.ts`.

### B.7 The LIVE RELEASE (plan of 2026-10-04)

A second kind of release beside the draw: `drops.mode` LIVE (migration `0021`), lived live and without a draw. Its rules hold in one service, its time in one engine, its audience in one hub.

- **`LiveService`** (`services/live.ts`): access (`accessOf`: the tier now through `tierOf`, and a piece of the models or the collection the release names), the staged reveals (`liveStages`), the phases (`livePhase`), the customer's actions (interest, enter, change size, leave, press, secure, add-ons, confirm, release) and the console's controls (pause, resume, extend, add pieces, free, let in, message, end, remove, the board's link). Each runs in one short transaction: the account's row `FOR SHARE`, the release's row, then the entry's, the clock read once they are held, the audit entries written last (`drop.live.*`).
- **`LiveEngine`** (`services/live-engine.ts`, started and stopped by `index.ts`): every 250 ms, `LiveService.advance` for each release in its live window, one transaction each with the release's row `FOR UPDATE`: the line at T0 (`formLine`: the tier read at T0, then `lineOrder`, `sha256(seed ‖ entry id)` from the release's sealed seed, `drops.ts` `drawKey` and `openDropSeed`), the turns and holds run out (not while paused), the end (`SOLD_OUT`, `CLOSED`), then the turns (`giveTurnsNow`: per size, the first `QUEUED` entry whose quantity fits the free pieces). One process ticks, the one holding the session advisory lock `LIVE_ENGINE` on a connection it keeps; nothing is kept in memory, the logical times are written (a turn MISSED at its deadline), so a restart or an overlap changes nothing.
- **`LiveRoomService`** (`services/live-room.ts`): what the public reads (the list, a page, the banner, the `.ics`, the board), each stage at its time, and the room as its viewers read it (`frame`: counts, never a person; the board's share of it); who may read a room (`viewer`: an account the rule lets in, or holding an entry).
- **`LiveHub`** (`http/live-stream.ts`, `app.liveHub`): the streams of the process (a viewer's room and own entry, the boutique board, the console's live board). Once a second, for each release with a stream open, the frame is built once and every viewer's entry read in one query, then each event is serialised once and fanned out from memory; database work grows with the releases, never with the audience. Sessions, roles and board links are read again at every pulse. Measured: 1 000 in the room on the VPS profile ([reports/live-load.md](reports/live-load.md), `scripts/live-load.ts`).
- **`LiveConsoleService`** (`services/live-console.ts`): the settings until the announcement, the publication with its optional post of the circle (through `CircleService`'s table), the cancellation, the live board, the entries, the Client Services list and its CSV. **`LiveInsightsService`** (`services/live-insights.ts`): nine readings from ORBES's own data by written rules (`LIVE_INSIGHT_RULES`), each with its reasoning; the live alerts and the sell-out forecast ride on the live board. **`MediaService`**: the silhouette.
- **Elsewhere**: `DropService` leaves a LIVE release out of the draw's routes (`409 DROP_LIVE`); `OwnerService.lock` removes an account's open entries and withdraws its interest (`removeAccountLiveEntries`), its export adds `liveEntries` and `liveInterest`; housekeeping erases the entries' network hashes 30 days after the end; the rate group `live` counts networks and accounts.

The web side: in `web/verify/`, `views/live.ts` (a LIVE RELEASE's page: the announcement, I'LL BE THERE, the room behind the vault door, the line, the turn and its hold ring, the reveal, the add-ons and PAY, CONFIRMED in ivory, every edge page), its pure logic `live-model.ts` (screens, the clock sync, countdowns, the lock's angles, money), `live-seal.ts` (the specimen seal, drawn by the core renderer from a fixed payload that is no piece's code), `views/live-banner.ts` (the banner of /verify and MY PIECES), `views/board.ts` and `board-model.ts` (the boutique board), the LIVE cards of `views/releases.ts`, MY PIECES' entries in `views/pieces.ts`, the ticks of `sound.ts`; its look is the vault ([BRAND-DESIGN-SYSTEM](BRAND-DESIGN-SYSTEM.md), THE LIVE RELEASE). In `web/admin/`, the Drops tab's `Live releases` (`views/club.ts`), a release's page `views/live.ts` (`#/club/live/:dropId`: the live board on its stream, the controls by role, the entries, Client Services, the settings) with `model/live.ts`, and the intelligence's panels (`views/live-intelligence.ts`, `model/live-intelligence.ts`); the capabilities `endLiveRelease` and `removeLiveEntry` (ADMIN) in `model/permissions.ts`.

---

## C. Threat model (summary)

Full analysis: [THREAT-MODEL.md](THREAT-MODEL.md).

| Threat | Core protection | Residual risk |
|---|---|---|
| A Screenshot of a legitimate code | Signature still valid by design. Scan-pattern anomaly detection. First registration gated by a claim secret and a fresh scan token. | A static code can be copied. It cannot prove that the physical object is genuine. |
| B Copying a printed code onto counterfeits | Duplicate/velocity/geography anomaly scoring. Ownership state. Revocation. | Low-volume copies of one identity may go unnoticed until registration conflicts arise. |
| C Altering the product ID | Ed25519 signature over the canonical payload, plus the genome cross-check. | None known (requires breaking Ed25519). |
| D Random fake codes | Signature verification. Key-id registry. | None known. |
| E Replay | Scans are idempotent reads. Single-use, short-lived registration and transfer tokens (a transfer is received for the piece scanned only, F-03). Rate limiting. Anomaly poisoning is down-weighted. | Attackers can inflate scan counts. Mitigated, never auto-revoked. |
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
