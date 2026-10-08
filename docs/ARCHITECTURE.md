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
                         the tiers' benefits, THE PRIVATE SALON (salon.ts: the reserved models by tier, their requests),
                         a model discontinued and reinstated (catalog.ts), the LIVE RELEASES (live: the rules and actions;
                         live-engine: the ticker; live-room: what the public and a viewer read; live-console: the console;
                         live-insights: the intelligence); LIVE RELEASE+ (orders, fulfilment, stock,
                         invoices, journal: the orders of every channel, the stock and its ledger, the
                         invoices, the event journal; after-room, participation, segments, past-releases, question,
                         activity, release-stock: the releases' and collectors' settings; shopify: the exports);
                         growth (GROWTH, plan NEXT-NINE BP-29: lifetime value, repeat buying, the funnel, the revenue; reads only);
                         the supply chain (plan NEXT LOT §3.5, B.11: suppliers, supplier-orders, receptions, logistics,
                         parcels, order-cases; the atelier and its pieces to make removed)
    media/               uploaded photographs: type by magic bytes, EXIF/XMP stripped by hand, dimensions
    authenticators/      PhysicalAuthenticator registry (printed code today; hardware later)
    http/                sessions, CSRF, rate limiting, security headers, validation, static files; the LIVE
                         RELEASES' streams (live-stream.ts: LiveHub, Server-Sent Events fanned out once a second)
    routes/              public, account, ownership, club, live (the LIVE RELEASES), admin
    geo/                 location resolver (none | cloudflare | headers | mmdb), haversine
    render/              artifacts: SVG, PNG (resvg), vector PDF (pdfkit), print sheets, certificate cards,
                         the ownership certificate's PDF, the invoices' and credit notes' PDFs (invoice.ts), CSV
  src/web/             browser apps (vanilla TypeScript, bundled by esbuild)
    verify/              mobile scanner: camera capture, decoder worker, result views; NOW (/verify, B.10); MY PIECES (/verify/pieces,
                         its tabs PIECES · ORDERS · RELEASES, and each piece's page /verify/pieces/<id>; YOUR TIER is in the
                         account sheet since NOCTURNE, B.10); THE COLLECTION (/verify/lookbook, THE PRIVATE SALON
                         for an owner); THE RELEASES (/verify/releases); THE CIRCLE (/verify/circle); an ownership certificate
                         (/verify/c#token); the ceremony of a first registration and its share image (share-image.ts); SHARE
                         TO STORIES' story card and its preview (story-card.ts, views/story.ts, BP-10: drawn on the phone); the sound
                         signature (sound.ts); the scan as a ritual (the seal signal of capture.ts and scanner.ts); a LIVE
                         RELEASE's vault (/verify/releases/<id>, views/live.ts) and its boutique board (/verify/releases/<id>/board#secret);
                         THE RELEASES' LIVE and PAST tabs, the after-room (/verify/releases/<id>/after-room), the question
                         after (views/question.ts), YOUR ORDERS and their documents in MY PIECES (orders-model.ts)
    admin/               admin console: catalogue (Discontinue and Reinstate), generator, keys, anomalies, analytics, audit, the Club
                         (Drops, Circle, Tiers, Requests; a LIVE RELEASE's page, #/club/live/:dropId); the sale mode (decoder worker of verify/);
                         Orders (#/orders, an order's page, the packing slip), Logistics (#/logistics, B.11; #/atelier leads
                         there), Supplier orders (#/supplier-orders), Invoices,
                         Segments, Settings (locations, carriers, alerts), the client sheet, the Catalogue's base price, care
                         guide and Shopify exports; Growth (#/growth, under Overview, plan NEXT-NINE BP-29)
    legal/               the legal pages (J-06), the third app: privacy policy, terms of use, legal notice and FAQ, in French
                         and English (/legal, /legal/privacy, /legal/terms, /legal/notice, /legal/faq); content/*.ts with LEGAL_VERSION
    shared/              brand CSS, display font, monogram, DOM helpers; what verify/ and legal/ share (the legal pages' paths,
                         the second-hand sentence, the contact of ORBES Client Services and where SUBSCRIBE of ORBES Care leads);
                         the preferences kept on the device (prefs.ts: the sound)
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

What a signed-in account holds now decides what it reads in the club. One function counts it: `tierOf` (`services/club.ts`), from the open ownerships of pieces neither REVOKED, COUNTERFEIT_FLAGGED nor RETIRED (`ownership` is only read), the tiers TITANE, PLATINE and PALLADIUM at 1, 5 and 10 pieces (`CLUB_TIER_THRESHOLDS`, a constant of the code; plan NEXT-NINE, BP-19 T1, for every account at once), and the seniority in full years since the first ownership. Every customer route of the club is in `routes/club.ts`: an account session, CSRF and same origin for its POSTs, `no-store`, rate group `api` ([API §10.9–§10.11](API.md#109-the-club-and-the-private-salon-get-apiv1clublookbook-get-apiv1clublookbookslug-and-post-apiv1clublookbookslugrequest-extension-of-the-contract)).

- **The lookbook** (P-R02, `services/lookbook.ts`): the public sheets of the models, and the RESERVED ones for the owners. A sheet says *DISCONTINUED · <year>* once an ADMIN discontinued its model (P-R06, `discontinuedYear`).
- **THE PRIVATE SALON** (P-X08, `services/salon.ts`, `SalonService`; `routes/club.ts` for the owners, `routes/admin/club.ts` for the console's Requests tab): the lookbook's RESERVED models, each shown from its tier (`models.private_min_tier`) with its price (`models.price_label`), read through `LookbookService.listReserved(tier)` and `sheetOf(slug, { tier })`; REQUEST THIS PIECE writes a `shop_requests` row (one OPEN per account and model), the console closes it with a note, and a lock closes the account's open ones (`closeAccountShopRequests`, in `OwnerService.lock`). `SalonService` depends on `LookbookService` and on `ClubService` (its `tierOf`); `ClubService` no longer holds the lookbook (its lookbook dependency was removed with `reservedLookbook` and `lookbookSheet`). No payment, no email.
- **MESSAGES** (plan NEXT-NINE, CS-01; `services/messages.ts`, `MessageService`, `ctx.services.messages`; `routes/messages.ts` for the collector, `routes/admin/messages.ts` for the console's Messages board): one conversation per collector (`client_conversations`) and its messages (`client_messages`, DATABASE §5.62 and §5.63). The collector writes from WRITE TO ORBES CLIENT SERVICES (`web/verify/views/write.ts`, its context built by `web/verify/messages-model.ts`) or from the account sheet's MESSAGES; the service checks and labels the context (a piece owned now, an order of the account, a published release, a scan of the last 24 hours, a model the lookbook reaches through `LookbookService.sheetOf`), rates the collector (10 an hour) and audits `message.write`; the console answers, takes, assigns (ADMIN) and closes (`message.answer`, `.take`, `.assign`, `.close`), the board ordered by the tier read now (`clubStandings`, PALLADIUM then PLATINE, the longest waiting first). It depends on the database, the audit log, the clock and `LookbookService`. Only people write: no automatic message, no notification, no email, no file. `OwnerService` reads it for the client sheet's link and the export (`accountConversation`, `accountMessages`), and the scan retention clears a message's scan id (`clearMessageScans`).
- **THE PROGRAM** (plan NEXT-NINE, BP-19 T2; `services/club-program.ts`, `ClubProgramService`, `ctx.services.clubProgram`; `routes/admin/club.ts` and `routes/admin/orders.ts`): the figures of the tiers' benefits the owner called configurable (`club_program_settings`, DATABASE §5.64: the early access by default of PALLADIUM and PLATINE, the free shipping, the yearly care, the Messages priority, the welcome gift of each tier, the credit, the experiences' tiers), one row or the columns' defaults (`DEFAULT_PROGRAM`), changed whole by an ADMIN in Club → Tiers (`club.program.update`); the optional shipping rates of Orders → Settings (`shipping_rates`, §5.65; `order.shipping_rates.update`); and each tier's program lines as /verify and the console say them (`programLines`). The thresholds stay a constant of `services/club.ts`. It depends on the database, the audit log and the clock.
- **The tiers' grants** (plan NEXT-NINE, BP-19 T5; `services/tier-grants.ts`, `TierGrantService`, `ctx.services.tierGrants`): on reaching PLATINE or PALLADIUM an account receives that tier's welcome gift and credit, once per tier and per account, ever (`tier_grants`, DATABASE §5.66, `club.grant`). `ensureGrants` runs in the transaction of each write that may raise the tier (a first registration and a transfer accepted, `services/ownership.ts`; a piece reinstated, `services/lifecycle.ts`; each order's creation, `services/orders.ts`), at each status read (`ClubService.status`) and at boot (`prepare`, after `OrderService.prepare`). The gift becomes a GIFT order travelling with the account's next order (`attachGifts`, `services/orders.ts`: paid and cancelled with it, its line on its invoice); the credit is taken off an order's invoice by Client Services (`OrderService.applyCredit`, `credit_uses`, §5.67), given back on a cancellation or a return. It depends on the database, the audit log, THE PROGRAM, the clock and the logger.
- **The yearly care** (plan NEXT-NINE, BP-19 T6; `services/care.ts`, `CareService`, `ctx.services.care`; `routes/account.ts` and `routes/admin/care.ts`): PLATINE 1 piece a year, PALLADIUM every piece (THE PROGRAM), asked for from the piece with the address it returns to (`care_requests`, DATABASE §5.68), the tier read at the request. Client Services sends the prepaid label (a PDF uploaded as itself, the route's own parser as the photographs'), receives the piece, ships it back and completes it; each step opens or closes the piece's YEARLY_CARE service record through `WarrantyService` in the step's own transaction (its `trx`). No step writes in MESSAGES; the Messages board shows an open request as a link (`openCareOf`). The label's PDF is erased 30 days after the request ends (the housekeeping, `eraseCareLabels`). It depends on the database, the audit log, the warranty service and the clock.
- **The releases** (P-R03 and P-X02, `services/drops.ts`, `DropService`; `routes/public.ts`, `routes/club.ts`, `routes/admin/drops.ts`). A release goes DRAFT → published; then, when it has one, its **early access** from `max(opens_at − early_access_hours, published_at)` to `opens_at`, when an account PLATINE or PALLADIUM at the moment of its request reserves a place directly (`DropService.reserve`: the release's row `FOR UPDATE`, first come, first served, within `quantity`; the entry SELECTED at once, with its `respond_by`, its tier and seniority of that moment and no rank); then the **entries**, from `opens_at` to `closes_at` (`enter`, `withdraw`, any account); then the **draw** (ADMIN, `draw`), which opens the sealed seed, checks it against its commitment, reads every ENTERED entry's tier and seniority at that moment, ranks them and selects as many as there are places left (`quantity` less the places held or sold, the direct reservations among them); then ORBES Client Services concludes each place (`confirm`, `lapse`, `offerNext`).
- **The circle** (P-X01, `services/circle.ts`, `CircleService`; `routes/club.ts` for the members, `routes/admin/circle.ts` for the console, its photographs in `routes/admin/media.ts` through `MediaService`, its Analytics panel in `routes/admin/analytics.ts`): posts (NOTE, INVITATION, POLL) published from a tier up, read with `tierOf` at each request; answers to invitations under the post's `FOR UPDATE` within its capacity (audited), final votes in polls (not audited), a count of visits per day. `clubMembersByTier` (`services/club.ts`) counts the ACTIVE accounts at each tier for the Analytics panel, counts only.
- **The tiers' benefits** (P-X04, `services/club.ts`, `ClubService.tiers`, `updateTier`, `normalizeBenefits`; `routes/admin/club.ts`): the words of each tier's benefits, by default code constants (`CLUB_TIER_DEFAULT_BENEFITS`), changed from the console (`club_tiers`, at most `CLUB_TIER_BENEFITS_MAX` = 600 characters in `CLUB_TIER_BENEFIT_LINES` = 8 lines), audited through `AuditService` (`club.tier.update`). `ClubService.status` (`GET /api/v1/club/status`) gives the account its tier, the benefits of its tier and those below it, the next tier, and its entries.

**DISCONTINUED** (P-R06, `services/catalog.ts`, `CatalogService.discontinueModel` and `reinstateModel`; `routes/admin/catalog.ts`, `POST /api/admin/models/:id/discontinue` and `/reinstate`, ADMIN; migration `0019_model_discontinued`). One refusal mechanism: discontinuing sets `discontinued_at`, its author and `active = false` in one transaction, so the existing `409 MODEL_INACTIVE` of the issuance and the generator's filter apply as they are (a declared deviation: no new `EDITION_CLOSED`); reinstating clears both and sets `active = true` (the plan's choice 11: reversible by an ADMIN). The year is read live by `VerificationService` (`product.discontinuedYear`), `LookbookService` (`discontinuedYear`) and `OwnershipCertificateService` (`piece.discontinuedYear`, and the PDF's DISCONTINUED row in `render/certificate.ts`).

**ORBES Care** (P-M02): no table and no service of its own. `OwnedProduct.care` (`services/ownership.ts`) carries the model's care instructions to MY PIECES, and `CARE_SUBSCRIBE_URL` (`config.ts`, `careSubscribeUrl`) is served by `GET /api/v1/client-services` (`routes/public.ts`). Whop, which will hold the subscription, is not integrated.

The web side: in `web/verify/`, `releases-model.ts` and `views/releases.ts` (THE RELEASES, the early access line and RESERVE A PLACE), `circle-model.ts` and `views/circle.ts` (THE CIRCLE: the routes `/verify/circle` and `/verify/circle/<id>` in `main.ts`'s `routeOf`, like `/verify/pieces`), `tier-model.ts` and `views/pieces.ts` (YOUR TIER at the head of MY PIECES, read from the club's status, until NOCTURNE moved it to the account sheet, `views/account.ts`, B.10; THE CIRCLE at its foot for an owner, now a chapter of the rail; the CARE tab, P-M02, now on a piece's page, `views/piece.ts`: the model's care, else `DEFAULT_CARE`, then ORBES CARE and SUBSCRIBE, a `.textlink` in a new tab with `rel="noopener noreferrer"`, or *Subscriptions open soon.*; the browser checks `careSubscribeUrl` again, `shared/client-services.ts` `careSubscribeHref`), `lookbook-model.ts` and `views/lookbook.ts` (THE PRIVATE SALON, P-X08: the cards' prices, a reserved sheet's PRICE, OFFERED FROM and REQUEST THIS PIECE). In `web/admin/`, the Club page (`views/club.ts`, `#/club`, its tabs `drops`, `circle`, `tiers`), a release's page (`views/drop.ts`, `#/club/drops/:dropId`), a post's page (`views/circle.ts`, route `circlePost`, `#/club/circle/:postId`, its view-model `model/circle.ts`), the Tiers tab (`views/tiers.ts`, its rules in `model/club.ts`), the Analytics panel *The Circle* (`views/analytics.ts`), the Requests tab (`views/requests.ts`, `#/club?tab=requests`, P-X08), a model's Lookbook page and its *Private salon* section (`views/lookbook.ts`, `model/lookbook.ts`), the Catalogue's Discontinue and Reinstate (`views/catalogue.ts`, `model/catalogue.ts`, P-R06), and the capabilities `manageDrops`, `drawDrop` (ADMIN), `manageCircle`, `manageClubTiers`, `closeShopRequest` (OPERATOR) and `discontinueModel` (ADMIN) in `model/permissions.ts`.

**GROWTH** (plan NEXT-NINE, §3.9 BP-29; `services/growth.ts`, `GrowthService`, `ctx.services.growth`; `routes/admin/growth.ts`; migration `0032_growth_indexes`; API §16.31). It only reads, in one REPEATABLE READ, READ ONLY transaction, and keeps no snapshot table and no cache: `report` (the window of 12 or 24 UTC months, lifetime value per collector and by tier, country, first model and channel, repeat buying and its cohorts, the funnel from a scan to PALLADIUM, the revenue by month, channel, country and model; names no account), `collectors` (COLLECTORS BY VALUE, 25 a page; emails masked for an AUDITOR by the route), `releases` (the 6 latest releases past their opening, a LIVE RELEASE measured by `LiveInsightsService.summaries`, i.e. live-insights `summarize`), and `collectorValue` (the client sheet's `lifetimeValue`, read by `OwnerService.sheet`). Its pure functions (`median`, `percentile`, `ltvStats`, `secondPieceBuckets`, `cohortTable`, `funnelMonths`, `tierReachDates`, `maskSmallGroups`, `monthsOfWindow`) carry the rules the SQL feeds: a purchase is a paid order not cancelled or returned and never a GIFT order, at its invoiced price, or a FIRST_REGISTRATION of a piece no order names, at its model's price; the tiers reached follow `CLUB_TIER_THRESHOLDS` over all history; groups under 3 collectors give no amount. `scan-stats.ts` `scanMonths` gives the funnel's scans per month. The console: `web/admin/model/growth.ts` (pure) and `views/growth.ts` (`#/growth`, capability `readGrowth`, AUDITOR and up), the client sheet's *Lifetime value* line (`views/owner.ts`). The Shopify store's channel joins `PIECE_SOURCES` after the sync; only that seam is left.

### B.7 The verify app after stage BC (P-D01, P-D07, P-D10)

Client side only: no route, no table, no setting.

- **The ceremony of a first registration** (P-D01). The flow: result → REGISTER → VIEW AS OWNER → VERIFYING… → the result with the ceremony. The flag travels `OwnershipDeps.onRefresh({ ceremony })` (`views/ownership.ts`: `ceremony` is true for a first registration, `via === 'register'`, with or without the claim code, the certificate-card registration from an UNUSUAL ACTIVITY result included, and never for a piece received with a transfer code) → `App.retryVerify(input, ceremony)` → `verify` → `resultViewModel(..., { ceremony })` → `ResultViewModel.ceremony` `{ name, collection? }`; TRY AGAIN after a connection problem keeps it (`lastCeremony`). The ceremony shows only on an authentic result of a piece that is the reader's (ownership `yours`), with its GENOME and its model. `ResultView` gains `shown()`, called once the result is on screen: the vibration (`CEREMONY_VIBRATION`, `[18, 90, 18]`, as the names rise). The module `verify/share-image.ts`, imported statically into the single bundle: `drawShareImage` (the canvas, 1080 × 1350 on ivory), `prepareShareImage` (the PNG drawn when the result is built, before any gesture, because Safari loses the gesture during an awaited `toBlob`) and `shareGenomeImage` (`navigator.share({ files })` when `navigator.canShare` accepts the file, else `saveDownload`).
- **SHARE TO STORIES** (plan NEXT-NINE, §3.8 BP-10). `verify/story-card.ts`: `storyCardModel` (the card's words for its place: CONFIRMED under a LIVE RELEASE's CONFIRMED, `live-model.ts liveStoryModel`; SELECTED for a draw's place, `releases-model.ts drawStoryModel`; REGISTERED under the ceremony, from the result's `story`), `drawStoryCard` (a 1080 × 1920 canvas, design A NOCTURNE, `STORY_CARD`), `prepareStoryCard` and `StoryCards` (the PNG drawn once per entry when its place is built, before any tap: Safari forgets a tap while a `toBlob` is awaited), `shareStoryCard` (`navigator.share` with the file alone, else `saveDownload`); `views/story.ts`: the button and the full-screen preview. The card is drawn on the device, not by the server: the server's renderer (resvg) loads no fonts and composites no photographs, and a card made on the phone is neither stored nor sent to ORBES. No route, no table, no setting; the CSP is unchanged (`img-src 'self' data: blob:` covers the photograph and the preview).
- **The sound signature** (P-D07). `verify/sound.ts`, `SoundSignature`: `prime()` during the tap SCAN ORBES CODE, UPLOAD A PHOTO, SCAN AGAIN or TRY AGAIN creates or resumes the `AudioContext` (`navigator.audioSession.type = 'ambient'` first, where it exists); `resultShown(state)` plays the chord (four sine voices, a D major ninth, about 0.9 s) for the `AUTHENTIC_*` states only, never in the background; the context is suspended between chords. `shared/prefs.ts`: the preferences kept on the device (`orbes.sound`), every access in a try/catch that falls back to the defaults. SOUND ON / OFF in the footer of every screen that carries NOCTURNE's chrome (`views/shell.ts`), repeated in the account sheet as SOUND (`views/account.ts`); NOW replaced the landing and `views/landing.ts` (B.10).
- **The scan as a ritual** (P-D10). `ScanCallbacks` gains the optional `onSeal(confidence)` (`scanner.ts`), raised from the decoder replies that carry a seal, at most 4 times a second, computed on the reply only and never in the worker: `capture.ts` `SealSignal`, `sealConfidence` (NO_MOONS with its evidence; FORMAT with a code located, `FORMAT_SEAL_CONFIDENCE` 0.75; ECC, CRC or PAYLOAD with a code located, 1), `sealScale` and the constants `SEAL_SIGNAL_INTERVAL_MS` 250, `SEAL_HOLD_MS` 900, `SEAL_SCALE` `{ loose: 0.95, tight: 0.88 }`. The replies hold no position for the seal, so the ring tightens around the centre, and only from `SEAL_CONFIDENT` (0.5). `views/scanning.ts` `setSeal` sets `.is-sealed` and `--seal-scale` (CSSOM); `.is-locked` replaces it. VERIFYING… draws the same reticle (`views/verifying.ts`, `orbitReticle('reticle--verifying')`), and the result's GENOME plate opens from its centre (`genome-open`). The console's sale scanner does not use `onSeal`.

### B.8 The LIVE RELEASE (plan of 2026-10-04)

A second kind of release beside the draw: `drops.mode` LIVE (migration `0021`), lived live and without a draw. Its rules hold in one service, its time in one engine, its audience in one hub.

- **`LiveService`** (`services/live.ts`): access (`accessOf`: the tier now through `tierOf`, and a piece of the models or the collection the release names), the staged reveals (`liveStages`), the phases (`livePhase`), the customer's actions (interest, enter, change size, leave, press, secure, add-ons, confirm, release) and the console's controls (pause, resume, extend, add pieces, free, let in, message, end, remove, the board's link). Each runs in one short transaction: the account's row `FOR SHARE`, the release's row, then the entry's, the clock read once they are held, the audit entries written last (`drop.live.*`).
- **`LiveEngine`** (`services/live-engine.ts`, started and stopped by `index.ts`): every 250 ms, `LiveService.advance` for each release in its live window, one transaction each with the release's row `FOR UPDATE`: the line at T0 (`formLine`: the tier read at T0, then `lineOrder`, `sha256(seed ‖ entry id)` from the release's sealed seed, `drops.ts` `drawKey` and `openDropSeed`), the turns and holds run out (not while paused), the end (`SOLD_OUT`, `CLOSED`), then the turns (`giveTurnsNow`: per size, the first `QUEUED` entry whose quantity fits the free pieces). One process ticks, the one holding the session advisory lock `LIVE_ENGINE` on a connection it keeps; nothing is kept in memory, the logical times are written (a turn MISSED at its deadline), so a restart or an overlap changes nothing.
- **`LiveRoomService`** (`services/live-room.ts`): what the public reads (the list, a page, the banner, the `.ics`, the board), each stage at its time, and the room as its viewers read it (`frame`: counts, never a person; the board's share of it); who may read a room (`viewer`: an account the rule lets in, or holding an entry).
- **`LiveHub`** (`http/live-stream.ts`, `app.liveHub`): the streams of the process (a viewer's room and own entry, the boutique board, the console's live board). Once a second, for each release with a stream open, the frame is built once and every viewer's entry read in one query, then each event is serialised once and fanned out from memory; database work grows with the releases, never with the audience. Sessions, roles and board links are read again at every pulse. Measured: 1 000 in the room on the VPS profile ([reports/live-load.md](reports/live-load.md), `scripts/live-load.ts`).
- **`LiveConsoleService`** (`services/live-console.ts`): the settings until the announcement, the publication with its optional post of the circle (through `CircleService`'s table), the cancellation, the live board, the entries (the LIVE plan's Client Services list, retired by LIVE RELEASE+ into the orders, B.9). **`LiveInsightsService`** (`services/live-insights.ts`): nine readings from ORBES's own data by written rules (`LIVE_INSIGHT_RULES`), each with its reasoning; the live alerts and the sell-out forecast ride on the live board. **`MediaService`**: the silhouette.
- **Elsewhere**: `DropService` leaves a LIVE release out of the draw's routes (`409 DROP_LIVE`); `OwnerService.lock` removes an account's open entries and withdraws its interest (`removeAccountLiveEntries`), its export adds `liveEntries` and `liveInterest`; housekeeping erases the entries' network hashes 30 days after the end; the rate group `live` counts networks and accounts.

The web side: in `web/verify/`, `views/live.ts` (a LIVE RELEASE's page: the announcement, I'LL BE THERE, the room behind the vault door, the line, the turn and its hold ring, the reveal, the add-ons and PAY, CONFIRMED in ivory, every edge page), its pure logic `live-model.ts` (screens, the clock sync, countdowns, the lock's angles, money), `live-seal.ts` (the specimen seal, drawn by the core renderer from a fixed payload that is no piece's code), `views/live-banner.ts` (the banner of /verify and MY PIECES), `views/board.ts` and `board-model.ts` (the boutique board), the LIVE cards of `views/releases.ts`, MY PIECES' entries in `views/pieces.ts`, the ticks of `sound.ts`; its look is the vault ([BRAND-DESIGN-SYSTEM](BRAND-DESIGN-SYSTEM.md), THE LIVE RELEASE). In `web/admin/`, the Drops tab's `Live releases` (`views/club.ts`), a release's page `views/live.ts` (`#/club/live/:dropId`: the live board on its stream, the controls by role, the entries, the settings; since LIVE RELEASE+, a link to the release's orders on the board, B.9) with `model/live.ts`, and the intelligence's panels (`views/live-intelligence.ts`, `model/live-intelligence.ts`); the capabilities `endLiveRelease` and `removeLiveEntry` (ADMIN) in `model/permissions.ts`.

### B.9 LIVE RELEASE+ (plan of 2026-10-04)

The orders of every sales channel, the stock and the atelier behind them, and the releases' and collectors' settings (migrations `0022` and `0023`, DATABASE §5.46 to §5.61). "Smart and interconnected", in the owner's words: a sale writes its order, the order holds its piece, the atelier's piece fulfils it, a registration delivers it, and every change is journaled once for the connections to come.

- **`OrderService`** (`services/orders.ts`): the orders, created in the transaction that commits each sale (`ordersForLiveEntry` in PAY, `orderForDrawEntry` when Client Services confirms a draw's entry, `orderForShopRequest` when it closes a salon request ACCEPTED), and at boot for the sales made before (`prepare`); the steps (`ORDER_TRANSITIONS`), the return (ownership taken back, the piece restocked with a new claim code or archived), the location, the terms, the buyer, the link to its piece; MY PIECES' reading (`forAccount`) and its documents. Each change writes the order's event, its audit entry and its journal entry in one transaction, the lock order source, order, SKU, piece to make, invoice numbers, journal, audit.
- **`StockService`** and the ledger (`services/stock.ts`): the locations and carriers (created at the first boot), the SKUs (`ensureSku`, `deriveSku`), the movements (`recordMovement`) and the balances (on hand, reserved, available), each change under the SKU's row lock. The atelier of this plan (`AtelierService`: the pieces to make, their work sheets and reserved identities) is removed by plan NEXT LOT (step 5.13): Logistics replaces it (B.11). **`FulfilmentService`** (`services/fulfilment.ts`): the Orders board, its late marks (M3), an order's page, the packing slip and the CSV, and the client sheet's orders.
- **`InvoiceService`** (`services/invoices.ts`, `render/invoice.ts`): an invoice at PAID, a credit note when a paid order is cancelled or returned, CONGLOMERAT LLC without VAT, numbered under `INVOICE_NUMBER`; the month's list, PDFs and CSV. **The event journal** (`services/journal.ts`): `writeJournal` in every change's transaction, `readJournal`, `acknowledgeJournal` and the pure `replayJournal`; nothing reads it yet. **`ShopifyService`** (`services/shopify.ts`): the product and order exports in Shopify's formats and the ids pasted back; it calls nothing.
- **The releases and the collectors**: the after-room (`services/after-room.ts`: settled in the engine's transaction of the parent's end, its guests remembered, seen by them only), taking part (`services/participation.ts`: computed, the access rule's count and PAST's), the access rules (`accessOf` in `services/live.ts`: tier, models, participation, segment, combined by AND or OR), the segments (`services/segments.ts`: a rule tree compiled to SQL and read live), THE RELEASES' PAST (`services/past-releases.ts`), the question after (`services/question.ts`), the best time to open (`services/activity.ts`, its hourly counts in housekeeping), the feasibility check and the size mix (`services/release-stock.ts`).
- **The web side**: in `web/verify/`, THE RELEASES' tabs (`views/releases.ts`, `views/tabs.ts`), the past release's final page and the after-room's door (`views/live.ts`, `live-model.ts`), the question (`views/question.ts`), YOUR ORDERS and their documents (`views/pieces.ts`, `orders-model.ts`); in `web/admin/`, `views/orders.ts`, `order.ts`, `slip.ts`, `invoices.ts`, `segments.ts`, `settings.ts`, `best-time.ts`, the release page's After-room, Access, Surprise and Question after parts, the client sheet (`views/owner.ts`) and the Catalogue's Shopify dialogs, with their models in `model/`.

### B.10 NOCTURNE (plan of 2026-10-05)

The customer app and the legal pages in the vault's look, with a real navigation; the console, the PDF documents, the shared certificate page (/verify/c#…) and the boutique board keep theirs. One migration, `0024_model_variants` (DATABASE §5.3), no host or Caddy change.

- **The variants** (migration `0024`): a variant is a model (its pieces, SKUs, stock, releases and orders point at it as at any model), linked to its main model by `models.variant_of`, never chained, named by `variant_label` and drawn by `variant_swatch` (#RRGGBB), the CHECKs and the row trigger `models_variant_rules` holding the rules. The console's VARIANTS section on a model's page and ADD A VARIANT: `CatalogService.createVariant` (`services/catalog.ts`, audited `model.variant.create`), `POST /api/admin/models/:id/variants` (`routes/admin/catalog.ts`, the roles of editing a model). The lookbook groups a model and its variants (one entry, its dots), You own N counts every variant, and the Shopify product export makes a model and its variants one product (option 1 Variant, option 2 Size). The piece's free-text field set at issuance is labelled Size.
- **A draw's price** (migration `0024`): `drops.price_minor` and `currency` may be set on a DRAW too (both or neither), entered in the console, shown on the draw's card and page, and taken by an order created from the draw (`OrderService.orderForDrawEntry`) instead of « to be confirmed ».
- **The model's photographs only** (decision 9): no answer a collector receives carries a piece's own photograph (the verification result's and the account's pieces' `photoUrl` are gone); the console keeps them and no longer offers one at issuance. A result, NOW, MY PIECES and a piece's page show the model's (or its variant's) photograph.
- **The feed's invitation block** (addition 6): each invitation of THE CIRCLE's feed carries the reader's answer, its places, its capacity and whether answers are open (`services/circle.ts`), so YES / NO is answered from the feed and from NOW by the post's own route and rules (closed, full); NOW reads the feed with `visit=0`, which counts no visit.
- **The GENOME's centre** (decision 12): the core renderer (`core/genome/render.ts`) takes `centre: 'monogram'`, which gives the SEAL's core disc and ring way to the monogram's master paths (`core/render/monogram.ts`), 8 u wide, in the glyphs' ink; a collector's screens and SHARE THE GENOME's image use it. The SEAL stays the default everywhere else (every printed code, labels, print files, the PDF certificate, the console, the shared certificate page): the scanner finds a code by its seal's rings.
- **The web side**: in `web/verify/`, `views/shell.ts` (the chrome round each screen: the header and its account button, the rail of chapters NOW · RELEASES · COLLECTION · CIRCLE · PIECES with `aria-current`, the footer, the SCAN ring; hidden inside a LIVE RELEASE's room), `views/account.ts` (the account sheet: YOUR TIER, SOUND, the email, CHANGE PASSWORD, MY PIECES, the legal pages, SIGN OUT), `views/now.ts` and `now-model.ts` (NOW: what leads, a LIVE RELEASE, a draw or the newest model, then YOUR PIECES, THE CIRCLE, THE COLLECTION and the scan), `views/piece.ts` (a piece's page), `views/invitation.ts` (an invitation's card, in the feed and on NOW), `views/nocturne.ts` (the shared pieces: buttons, rows, tabs, fields, dots, plate cards, the loading monogram), `nocturne-model.ts` (the rail's chapter and dot, the account button, a variant's dot) and `next-release-model.ts` (a model's next release on its sheet); in `web/shared/`, `nocturne.css` (the rulebook's tokens and pieces, shared by /verify and /legal) and `chapters.ts` (the rail's addresses); `web/verify/house.css` keeps the look before NOCTURNE where it still shows (the shared certificate, the room and the after-room, the boutique board). The look and its rules: [BRAND-DESIGN-SYSTEM](BRAND-DESIGN-SYSTEM.md).

### B.11 The supply chain: LOGISTICS and supplier orders (plan NEXT LOT of 2026-10-07, §3.5)

ORBES does not make its pieces: suppliers do, an agent's warehouse keeps and ships them, ORBES confirms what arrives and gives each piece its identity. The Atelier is gone (its pieces to make, work sheets, reserved identities and Link a piece, step 5.13); Logistics takes its place. Three migrations: `0035_logistics_access`, `0036_supplier_orders`, `0037_fulfilment` (DATABASE §5.77 to §5.90). No host or Caddy change.

- **The LOGISTICS role** (`http/sessions.ts`, `routes/admin/logistics.ts`): one login per person at the agent, its locations in `admin_user_locations`; `logisticsScope` narrows every logistics read and write to them (any other row answers 404); it reaches only `#/logistics`, never a price, an email, an account, a release or the supplier orders.
- **`SupplierService`** (`services/suppliers.ts`): the suppliers, and each model's (or size's) supplier. **`SupplierOrderService`** (`services/supplier-orders.ts`, `render/supplier-order.ts`): the console's proposal (what waiting orders and minimums lack, less what is expected or in a draft), drafts per supplier and location, sent, confirmed, partly received, received, the rest cancelled; the supplier's invoice and the pieces sent back; the PDF ORBES sends itself.
- **`ReceptionService`** (`services/receptions.ts`): the agent counts a delivery against its supplier order, found by its reference only; ORBES confirms; a restart-safe worker (`issuePending`, started by `context.ts`, chunks of 50 under an advisory lock) issues each piece's identity (`IssuanceService.inSigningTransaction`, `issueStockIdentity`), writes its RECEIVED movement and serves the orders waiting, the oldest first; the claim codes wait sealed (`card_prints`, AES-256-GCM under `orbes/card-claim-codes/v1`) until the agent prints the cards (CertificateService, the 79t card, in fixed runs) and presses Cards attached.
- **`LogisticsService`** (`services/logistics.ts`, the parcels read in `services/parcels.ts`): the stock of every size at each location, corrections (proposed by the agent, approved by ORBES), transfers, minimums, pieces counted in; the parcels to ship and on their way; Start packing, the card's scan (`VerificationService.staffScan` binds the piece), the packing photo (in the database, erased 14 days after delivery by housekeeping), Packed, Ship (every order of the parcel at once; the only way an order ships since step 5.12; each piece's warranty started), delivered. **`OrderCaseService`** (`services/order-cases.ts`): returns, size exchanges and parcel problems, received by the agent, decided by ORBES.
- **Orders** (`services/orders.ts`): an order holds a piece in stock or waits for supplier stock (AWAITING, `serveWaiting`, `queue_first` for a reshipment); no piece is made for an order any more.
- **The web side**: in `web/admin/`, `views/logistics.ts` (its tabs), `shipping.ts` (a parcel's page), `reception.ts`, `supplier-orders.ts`, `supplier-order.ts`, with their models in `model/`; the order page's Shipping and Order case sections; Team's LOGISTICS role and its locations.

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
