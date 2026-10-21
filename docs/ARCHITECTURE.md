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
            ─► after the answer (onResponse): the scan's SCAN row for its device (B.12)

WHAT COLLECTORS LOOK AT (plan CUSTOMER INTELLIGENCE §3.3, B.12)
  verify app (swap / account sheet / sign-in panel) ─► ViewClock + SeenQueue (seen-model.ts)
            ─► POST /api/v1/seen every 30 ± 10 s, at once on hide (never in a LIVE room until then)
  server  ─► device cookie ─► staff / team / test entrant / robot dropped ─► device and place
            ─► ViewBuffer (memory, one INSERT every 2 s) ─► collector_views (13 months raw)
            ─► morning window: daily totals, places, monthly summaries ─► 13-month fold, then delete
  sign-up / sign-in / signed-in view ─► link: the device's anonymous views and scans take the account

WHERE THEY COME FROM (plan CUSTOMER INTELLIGENCE §3.4, B.13)
  verify.theorbes.com/go/<code> ─► 302 to the link's page with ?o=<code> (no write)   / ─► 302 /verify?<query kept>
  verify app (App.start, arrival.ts) ─► reads o and utm_, removes them; the referrer once a tab
            ─► after the first screen: `a` in the next POST /api/v1/seen
  server  ─► the views' exclusions ─► classify: link > campaign tags > site > Direct ─► the device's first source,
             one visit per device, source and Paris day
  link (sign-up / sign-in / signed-in view) ─► attach: the visits take the account, its first source, the SIGNUP's last link
  housekeeping ─► every pass: each entry and order's conversion, judged at the act ─► morning: visits by day, 13-month purge
  console ─► Links (#/links): each link, campaign and site, first link and last link side by side, the return

THE FOUNDING LIST (lot M1 of 2026-10-21, B.16)
  theorbes.com pop-up ─► POST https://verify.theorbes.com/api/v1/founding (CORS: https://theorbes.com only,
             the server's own Origin check, rate group founding, JSON ≤ 2 KB, honeypot)
  server  ─► classify the source as an arrival (o > utm_ > site > Direct) ─► preregistrations (one row per address)
             ─► 202 for any address; the account with that address matched now or at its sign-up
  console ─► Founding list (#/founding): figures, sources, people, CSV in Shopify's columns, Make the segment

THE EMAILS (lot M1, B.16; off until EMAIL_TRANSPORT=smtp and each kind switched on)
  an act (an order's step, a draw, a label, a reset request, the founding announcement) ─► email_outbox, in its own
             transaction, rendered once (email/render.ts), once per dedupe key
  sender (every 15 s) ─► release notices' scan ─► claim due rows (FOR UPDATE SKIP LOCKED) ─► cancel what no longer
             applies ─► SMTP over TLS (email/smtp.ts) ─► SENT, retried, or FAILED
  housekeeping ─► every row settled 90 days ago erased
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
                         parcels, order-cases; the atelier and its pieces to make removed);
                         the tastes and the wishlist (plan CUSTOMER INTELLIGENCE §3.2: tastes, TasteService, the
                         favourite pieces and finishes read live from THE COLLECTION; wishlist, WishlistService, the
                         heart's wishes, their monthly counts and their 13-month purge);
                         the device and the views (plan CUSTOMER INTELLIGENCE §3.3, B.12: tracking, TrackingService,
                         the views' pipeline, the link and the scans' rows; tracking-jobs, the morning's counts and
                         purges; tracking-reads, the console's and the export's readings; places, PlaceService);
                         where they come from (plan CUSTOMER INTELLIGENCE §3.4, B.13: acquisition, AcquisitionService,
                         the arrival, the attach, the first source and the last link; acquisition-jobs, the conversions,
                         the visits by day and their purge; acquisition-report, the Links page's readings; acquisition-reads,
                         the client sheet's origin, the export's columns and the right of access's `origin`; links,
                         LinkService, the console's links and channels; referrers, the referring sites' families);
                         the birthday credit, the score, Segments and the Collectors page (plan CUSTOMER INTELLIGENCE
                         §3.5, §3.6, B.14: birthday-credits, BirthdayCreditService, the daily grant; engagement-formula,
                         the score's fixed formula, and engagement, EngagementService, its figures and its daily run;
                         acquisition-filters, the first and last source as SQL conditions; insights-scope, the page's
                         periods, filters and scope; collector-insights, CollectorInsightsService, the panels, the
                         lists and the export's reading; likes, LikesService, What they like; collector-history, the
                         monthly history; collector-export, the export's 76 columns);
                         lot M1 (B.16): calendar (the one .ics writer of a draw and a LIVE RELEASE), campaign
                         (CampaignService, a release's links in one click and its readout per link), founding and
                         founding-match (FoundingService, the founding list), email and email-triggers (EmailService,
                         the outbox, its sender and purge; EmailTriggers, when each email is written)
    email/               the emails (lot M1): smtp.ts (the SMTP client on node:net and node:tls, the only outbound
                         connection the app makes), render.ts (the house's look, text and HTML), copy.ts (their
                         default words)
    media/               uploaded photographs: type by magic bytes, EXIF/XMP stripped by hand, dimensions
    authenticators/      PhysicalAuthenticator registry (printed code today; hardware later)
    http/                sessions, CSRF, rate limiting, security headers, validation, static files; the LIVE
                         RELEASES' streams (live-stream.ts: LiveHub, Server-Sent Events fanned out once a second);
                         the device cookie (device.ts) and the device's class (device-class.ts)
    routes/              public, account, ownership, club, live (the LIVE RELEASES), seen (the views), acquisition
                         (GET /go/:code, a console link's short address), founding (theorbes.com's form, lot M1),
                         email (the monogram, STOP THESE EMAILS), admin
    geo/                 location resolver (none | cloudflare | headers | mmdb), haversine; the connection's
                         country and city (place.ts)
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
                         after (views/question.ts), YOUR ORDERS and their documents in MY PIECES (orders-model.ts);
                         the recording of what is looked at (seen.ts, seen-model.ts: no word, no screen, B.12); the page
                         load's arrival (arrival.ts, read in App.start: o and utm_ removed from the address, B.13);
                         lot M1 (B.16): a paced release's queue (views/live.ts), the reset link's page /verify/reset
                         (views/reset.ts) and STOP THESE EMAILS /verify/unsubscribe (views/unsubscribe.ts), in the
                         frame of views/mail-frame.ts on a computer
    admin/               admin console: catalogue (Discontinue and Reinstate), generator, keys, anomalies, analytics, audit, the Club
                         (Drops, Circle, Tiers, Requests; a LIVE RELEASE's page, #/club/live/:dropId); the sale mode (decoder worker of verify/);
                         Orders (#/orders, an order's page, the packing slip), Logistics (#/logistics, B.11; #/atelier leads
                         there), Supplier orders (#/supplier-orders), Invoices,
                         Segments, Settings (locations, carriers, alerts), the client sheet, the Catalogue's base price, care
                         guide and Shopify exports; Growth (#/growth, under Overview, plan NEXT-NINE BP-29); lot M1 (B.16):
                         a release's CAMPAIGN tab (views/campaign.ts, the countdown image ui/countdown-card.ts), the
                         Founding list (#/founding), the Emails page (#/settings/emails, its preview ui/email-frame.ts)
    legal/               the legal pages (J-06), the third app: privacy policy, terms of use, legal notice and FAQ, in French
                         and English (/legal, /legal/privacy, /legal/terms, /legal/notice, /legal/faq); content/*.ts with LEGAL_VERSION
    shared/              brand CSS, display font, monogram, DOM helpers; what verify/ and legal/ share (the legal pages' paths,
                         the second-hand sentence and the contact of ORBES Client Services; SUBSCRIBE is gone with plan ORBES CARE);
                         the preferences kept on the device (prefs.ts: the sound, the light mode); the light mode
                         (mode.ts, mode-early.ts before the first paint, light.css)
  scripts/             CLIs and studies (db, keys, admin, POC, benchmarks, scan matrix, test sheets, the views'
                         sizes (views-size.ts), …)
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

What a signed-in account holds now decides what it reads in the club. One function counts it: `tierOf` (`services/club.ts`), from the open ownerships of pieces neither REVOKED, COUNTERFEIT_FLAGGED nor RETIRED, a piece being replaced under its holder's warranty claim counting until its new piece is registered (`clubCounts`, the one SQL every reader of the count uses; plan ORBES CARE, CARE-C2) (`ownership` is only read), the tiers TITANE, PLATINE and PALLADIUM at 1, 5 and 10 pieces (`CLUB_TIER_THRESHOLDS`, a constant of the code; plan NEXT-NINE, BP-19 T1, for every account at once), and the seniority in full years since the first ownership. Every customer route of the club is in `routes/club.ts`: an account session, CSRF and same origin for its POSTs, `no-store`, rate group `api` ([API §10.9–§10.11](API.md#109-the-club-and-the-private-salon-get-apiv1clublookbook-get-apiv1clublookbookslug-and-post-apiv1clublookbookslugrequest-extension-of-the-contract)).

- **The lookbook** (P-R02, `services/lookbook.ts`): the public sheets of the models, and the RESERVED ones for the owners. A sheet says *DISCONTINUED · <year>* once an ADMIN discontinued its model (P-R06, `discontinuedYear`).
- **THE PRIVATE SALON** (P-X08, `services/salon.ts`, `SalonService`; `routes/club.ts` for the owners, `routes/admin/club.ts` for the console's Requests tab): the lookbook's RESERVED models, each shown from its tier (`models.private_min_tier`) with its price (`models.price_label`), read through `LookbookService.listReserved(tier)` and `sheetOf(slug, { tier })`; REQUEST THIS PIECE writes a `shop_requests` row (one OPEN per account and model), the console closes it with a note, and a lock closes the account's open ones (`closeAccountShopRequests`, in `OwnerService.lock`). `SalonService` depends on `LookbookService` and on `ClubService` (its `tierOf`); `ClubService` no longer holds the lookbook (its lookbook dependency was removed with `reservedLookbook` and `lookbookSheet`). No payment, no email.
- **MESSAGES** (plan NEXT-NINE, CS-01; `services/messages.ts`, `MessageService`, `ctx.services.messages`; `routes/messages.ts` for the collector, `routes/admin/messages.ts` for the console's Messages board): one conversation per collector (`client_conversations`) and its messages (`client_messages`, DATABASE §5.62 and §5.63). The collector writes from WRITE TO ORBES CLIENT SERVICES (`web/verify/views/write.ts`, its context built by `web/verify/messages-model.ts`) or from the account sheet's MESSAGES; the service checks and labels the context (a piece owned now, an order of the account, a published release, a scan of the last 24 hours, a model the lookbook reaches through `LookbookService.sheetOf`), rates the collector (10 an hour) and audits `message.write`; the console answers, takes, assigns (ADMIN) and closes (`message.answer`, `.take`, `.assign`, `.close`), the board ordered by the tier read now (`clubStandings`, PALLADIUM then PLATINE, the longest waiting first). It depends on the database, the audit log, the clock and `LookbookService`. Only people write: no automatic message, no notification, no email, no file. `OwnerService` reads it for the client sheet's link and the export (`accountConversation`, `accountMessages`), and the scan retention clears a message's scan id (`clearMessageScans`).
- **THE PROGRAM** (plan NEXT-NINE, BP-19 T2; `services/club-program.ts`, `ClubProgramService`, `ctx.services.clubProgram`; `routes/admin/club.ts` and `routes/admin/orders.ts`): the figures of the tiers' benefits the owner called configurable (`club_program_settings`, DATABASE §5.64: the early access by default of PALLADIUM and PLATINE, the free shipping, the yearly care, the Messages priority, the welcome gift of each tier, the credit, the experiences' tiers), one row or the columns' defaults (`DEFAULT_PROGRAM`), changed whole by an ADMIN in Club → Tiers (`club.program.update`); the optional shipping rates of Orders → Settings (`shipping_rates`, §5.65; `order.shipping_rates.update`); and each tier's program lines as /verify and the console say them (`programLines`). The thresholds stay a constant of `services/club.ts`. It depends on the database, the audit log and the clock.
- **The tiers' grants** (plan NEXT-NINE, BP-19 T5; `services/tier-grants.ts`, `TierGrantService`, `ctx.services.tierGrants`): on reaching PLATINE or PALLADIUM an account receives that tier's welcome gift and credit, once per tier and per account, ever (`tier_grants`, DATABASE §5.66, `club.grant`). `ensureGrants` runs in the transaction of each write that may raise the tier (a first registration and a transfer accepted, `services/ownership.ts`; a piece reinstated, `services/lifecycle.ts`; each order's creation, `services/orders.ts`), at each status read (`ClubService.status`) and at boot (`prepare`, after `OrderService.prepare`). The gift becomes a GIFT order travelling with the account's next order (`attachGifts`, `services/orders.ts`: paid and cancelled with it, its line on its invoice); the credit is taken off an order's invoice by Client Services (`OrderService.applyCredit`, `credit_uses`, §5.67), given back on a cancellation or a return. It depends on the database, the audit log, THE PROGRAM, the clock and the logger.
- **PRIVATE CARE, the yearly care** (plan NEXT-NINE, BP-19 T6, named PRIVATE CARE on screen by plan ORBES CARE of 2026-10-15; `services/care.ts`, `CareService`, `ctx.services.care`; `routes/account.ts` and `routes/admin/care.ts`): every piece once a year from PLATINE by default (THE PROGRAM), asked for from the piece with the address it returns to (`care_requests`, DATABASE §5.68), the tier read at the request. Client Services sends the prepaid label (a PDF uploaded as itself, the route's own parser as the photographs'), receives the piece, ships it back and completes it; each step opens or closes the piece's YEARLY_CARE service record through `WarrantyService` in the step's own transaction (its `trx`). No step writes in MESSAGES; the Messages board shows an open request as a link (`openCareOf`). The label's PDF is erased 30 days after the request ends (the housekeeping, `eraseCareLabels`, which erases the warranty claims' labels too). Its status carries the piece's warranty claim (`claim`) through an injected `claimOf`, so the two services form no module cycle, and reads UNAVAILABLE while a claim is live. It depends on the database, the audit log, the warranty service and the clock.
- **The releases** (P-R03 and P-X02, `services/drops.ts`, `DropService`; `routes/public.ts`, `routes/club.ts`, `routes/admin/drops.ts`). A release goes DRAFT → published; then, when it has one, its **early access** from `max(opens_at − early_access_hours, published_at)` to `opens_at`, when an account PLATINE or PALLADIUM at the moment of its request reserves a place directly (`DropService.reserve`: the release's row `FOR UPDATE`, first come, first served, within `quantity`; the entry SELECTED at once, with its `respond_by`, its tier and seniority of that moment and no rank); then the **entries**, from `opens_at` to `closes_at` (`enter`, `withdraw`, any account); then the **draw** (ADMIN, `draw`), which opens the sealed seed, checks it against its commitment, reads every ENTERED entry's tier and seniority at that moment, ranks them and selects as many as there are places left (`quantity` less the places held or sold, the direct reservations among them); then ORBES Client Services concludes each place (`confirm`, `lapse`, `offerNext`).
- **The circle** (P-X01, `services/circle.ts`, `CircleService`; `routes/club.ts` for the members, `routes/admin/circle.ts` for the console, its photographs in `routes/admin/media.ts` through `MediaService`, its Analytics panel in `routes/admin/analytics.ts`): posts (NOTE, INVITATION, POLL) published from a tier up, read with `tierOf` at each request; answers to invitations under the post's `FOR UPDATE` within its capacity (audited), final votes in polls (not audited), a count of visits per day. `clubMembersByTier` (`services/club.ts`) counts the ACTIVE accounts at each tier for the Analytics panel, counts only.
- **The tiers' benefits** (P-X04, `services/club.ts`, `ClubService.tiers`, `updateTier`, `normalizeBenefits`; `routes/admin/club.ts`): the words of each tier's benefits, by default code constants (`CLUB_TIER_DEFAULT_BENEFITS`), changed from the console (`club_tiers`, at most `CLUB_TIER_BENEFITS_MAX` = 600 characters in `CLUB_TIER_BENEFIT_LINES` = 8 lines), audited through `AuditService` (`club.tier.update`). `ClubService.status` (`GET /api/v1/club/status`) gives the account its tier, the benefits of its tier and those below it, the next tier, and its entries.

**DISCONTINUED** (P-R06, `services/catalog.ts`, `CatalogService.discontinueModel` and `reinstateModel`; `routes/admin/catalog.ts`, `POST /api/admin/models/:id/discontinue` and `/reinstate`, ADMIN; migration `0019_model_discontinued`). One refusal mechanism: discontinuing sets `discontinued_at`, its author and `active = false` in one transaction, so the existing `409 MODEL_INACTIVE` of the issuance and the generator's filter apply as they are (a declared deviation: no new `EDITION_CLOSED`); reinstating clears both and sets `active = true` (the plan's choice 11: reversible by an ADMIN). The year is read live by `VerificationService` (`product.discontinuedYear`), `LookbookService` (`discontinuedYear`) and `OwnershipCertificateService` (`piece.discontinuedYear`, and the PDF's DISCONTINUED row in `render/certificate.ts`).

**ORBES CARE** (plan ORBES CARE of 2026-10-15; migration `0048_orbes_care`): what ORBES gives a piece after its sale, free of charge, in one ORBES CARE tab of each piece (the warranty, PRIVATE CARE, the care guide, the contact); the paid ORBES Care subscription of P-M02 is removed, and `CARE_SUBSCRIBE_URL` stays read by `config.ts` but is no longer served (`routes/public.ts`). `OwnedProduct.care` (`services/ownership.ts`) carries the model's care instructions to MY PIECES.

- **The warranty of each model** (`services/catalog.ts` `setWarranty`, `services/warranty.ts`): `models.warranty_lifetime` (lifetime or 2 years, Lifetime by default) is copied by each piece's warranty row at issuance (`IssuanceService`, the model read under a share lock) or activation (`WarrantyService.activate`), and a change by an ADMIN rewrites the warranties of the model's pieces not VOID in one transaction (the model's row `FOR UPDATE` first). A started lifetime warranty is ACTIVE with no end date; extending one is refused.
- **`WarrantyClaimService`** (`services/warranty-claims.ts`, `ctx.services.warrantyClaims`; `routes/admin/warranty-claims.ts`, the label through `routes/admin/care.ts`, the collector's label through `routes/account.ts`): a claim opened by Client Services from the claimant's conversation, its basis read from the piece (LIFETIME, TWO_YEARS) or the legal guarantee (LEGAL); the prepaid label, the receipt (an INSPECTION record through `WarrantyService.openService`), the decision per basis (a replacement, a WARRANTY credit through `tier_grants`, a repair, a legal remedy, a refusal), the move to the legal guarantee, the shipment (the replacement's warranty started through `WarrantyService.activate`, `via: 'warranty_claim'`) and the closing. Every step an OPERATOR's; the claim's row locked for every step. It depends on the database, the audit log, the warranty service, THE PROGRAM (the credit percent) and the clock. The ownership service refuses a transfer while a claim is OPEN or LABEL_SENT, GROWTH leaves a claim's replacement out of the purchases, and the owners' export lists the account's claims.
- **The ORBES CARE CONDITIONS** (`render/care-conditions.ts`, `OrderService.careConditions`): the terms' article 11 kept in the server (its image holds no web code), held to the published terms by `legal.content.test.ts`, drawn as a PDF for every order of the account.

The web side: in `web/verify/`, `releases-model.ts` and `views/releases.ts` (THE RELEASES, the early access line and RESERVE A PLACE), `circle-model.ts` and `views/circle.ts` (THE CIRCLE: the routes `/verify/circle` and `/verify/circle/<id>` in `main.ts`'s `routeOf`, like `/verify/pieces`), `tier-model.ts` and `views/pieces.ts` (YOUR TIER at the head of MY PIECES, read from the club's status, until NOCTURNE moved it to the account sheet, `views/account.ts`, B.10; THE CIRCLE at its foot for an owner, now a chapter of the rail; the ORBES CARE tab on a piece's page, `views/piece.ts`, plan ORBES CARE of 2026-10-15 (the CARE tab of P-M02 before it): the warranty, the WARRANTY CLAIM while one is under way (`views/warranty-claim.ts`), PRIVATE CARE (`views/yearly-care.ts`), CARING FOR THIS PIECE, the model's care, else `DEFAULT_CARE`, then the contact and WRITE TO ORBES CLIENT SERVICES; SUBSCRIBE, `careSubscribeUrl` and `careSubscribeHref` were removed by that plan), `lookbook-model.ts` and `views/lookbook.ts` (THE PRIVATE SALON, P-X08: the cards' prices, a reserved sheet's PRICE, OFFERED FROM and REQUEST THIS PIECE). In `web/admin/`, the Club page (`views/club.ts`, `#/club`, its tabs `drops`, `circle`, `tiers`), a release's page (`views/drop.ts`, `#/club/drops/:dropId`), a post's page (`views/circle.ts`, route `circlePost`, `#/club/circle/:postId`, its view-model `model/circle.ts`), the Tiers tab (`views/tiers.ts`, its rules in `model/club.ts`), the Analytics panel *The Circle* (`views/analytics.ts`), the Requests tab (`views/requests.ts`, `#/club?tab=requests`, P-X08), a model's Lookbook page and its *Private salon* section (`views/lookbook.ts`, `model/lookbook.ts`), the Catalogue's Discontinue and Reinstate (`views/catalogue.ts`, `model/catalogue.ts`, P-R06), and the capabilities `manageDrops`, `drawDrop` (ADMIN), `manageCircle`, `manageClubTiers`, `closeShopRequest` (OPERATOR) and `discontinueModel` (ADMIN) in `model/permissions.ts`.

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
- **`LiveHub`** (`http/live-stream.ts`, `app.liveHub`): the streams of the process (a viewer's room and own entry, the boutique board, the console's live board). Once a second, for each release with a stream open, the frame is built once and every viewer's entry read in one query, then each event is serialised once and fanned out from memory; the number of reads grows with the releases, never with the audience, though the one read of the viewers' entries grows in rows with it (about 510 ms at p50 for 5 000 viewers on PGlite's one connection). Sessions, roles and board links are read again at every pulse. Measured: 1 000 in the room on the VPS profile, and 5 000 in a paced release's queue held exactly ([reports/live-load.md](reports/live-load.md) §3 and §7, `scripts/live-load.ts`).
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
- **The web side**: in `web/verify/`, `views/shell.ts` (the chrome round each screen: the header and its account button, the rail of chapters NOW · RELEASES · COLLECTION · CIRCLE · PIECES with `aria-current`, the footer, the SCAN ring; hidden inside a LIVE RELEASE's room), `views/account.ts` (the account sheet: YOUR TIER, SOUND, the email, CHANGE PASSWORD, MY PIECES, the legal pages, SIGN OUT), `views/now.ts` and `now-model.ts` (NOW: what leads, a LIVE RELEASE, a draw or the newest model, then YOUR PIECES, THE CIRCLE, THE COLLECTION and the scan), `views/piece.ts` (a piece's page), `views/invitation.ts` (an invitation's card, in the feed and on NOW), `views/nocturne.ts` (the shared pieces: buttons, rows, tabs, fields, dots, plate cards, the loading monogram), `nocturne-model.ts` (the rail's chapter and dot, the account button, a variant's dot) and `next-release-model.ts` (a model's next release on its sheet); in `web/shared/`, `nocturne.css` (the rulebook's tokens and pieces, shared by /verify and /legal) and `chapters.ts` (the rail's addresses); `web/verify/house.css` keeps the look before NOCTURNE where it still shows (the shared certificate, the room and the after-room, the boutique board). The look and its rules: [BRAND-DESIGN-SYSTEM](BRAND-DESIGN-SYSTEM.md). On a computer's window of 1024 px or more, the same screens take the desktop layout (B.15).

### B.11 The supply chain: LOGISTICS and supplier orders (plan NEXT LOT of 2026-10-07, §3.5)

ORBES does not make its pieces: suppliers do, an agent's warehouse keeps and ships them, ORBES confirms what arrives and gives each piece its identity. The Atelier is gone (its pieces to make, work sheets, reserved identities and Link a piece, step 5.13); Logistics takes its place. Three migrations: `0035_logistics_access`, `0036_supplier_orders`, `0037_fulfilment` (DATABASE §5.77 to §5.90). No host or Caddy change.

- **The LOGISTICS role** (`http/sessions.ts`, `routes/admin/logistics.ts`): one login per person at the agent, its locations in `admin_user_locations`; `logisticsScope` narrows every logistics read and write to them (any other row answers 404); it reaches only `#/logistics`, never a price, an email, an account, a release or the supplier orders.
- **`SupplierService`** (`services/suppliers.ts`): the suppliers, and each model's (or size's) supplier. **`SupplierOrderService`** (`services/supplier-orders.ts`, `render/supplier-order.ts`): the console's proposal (what waiting orders and minimums lack, less what is expected or in a draft), drafts per supplier and location, sent, confirmed, partly received, received, the rest cancelled; the supplier's invoice and the pieces sent back; the PDF ORBES sends itself.
- **`ReceptionService`** (`services/receptions.ts`): the agent counts a delivery against its supplier order, found by its reference only; ORBES confirms; a restart-safe worker (`issuePending`, started by `context.ts`, chunks of 50 under an advisory lock) issues each piece's identity (`IssuanceService.inSigningTransaction`, `issueStockIdentity`), writes its RECEIVED movement and serves the orders waiting, the oldest first; the claim codes wait sealed (`card_prints`, AES-256-GCM under `orbes/card-claim-codes/v1`) until the agent prints the cards (CertificateService, the 79t card, in fixed runs) and presses Cards attached.
- **`LogisticsService`** (`services/logistics.ts`, the parcels read in `services/parcels.ts`): the stock of every size at each location, corrections (proposed by the agent, approved by ORBES), transfers, minimums, pieces counted in; the parcels to ship and on their way; Start packing, the card's scan (`VerificationService.staffScan` binds the piece), the packing photo (in the database, erased 14 days after delivery by housekeeping), Packed, Ship (every order of the parcel at once; the only way an order ships since step 5.12; each piece's warranty started), delivered. **`OrderCaseService`** (`services/order-cases.ts`): returns, size exchanges and parcel problems, received by the agent, decided by ORBES.
- **Orders** (`services/orders.ts`): an order holds a piece in stock or waits for supplier stock (AWAITING, `serveWaiting`, `queue_first` for a reshipment); no piece is made for an order any more.
- **The web side**: in `web/admin/`, `views/logistics.ts` (its tabs), `shipping.ts` (a parcel's page), `reception.ts`, `supplier-orders.ts`, `supplier-order.ts`, with their models in `model/`; the order page's Shipping and Order case sections; Team's LOGISTICS role and its locations.

### B.12 What collectors look at, the device and the place (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3)

One device, one cookie, one pipeline. The device is the existing `__Host-orbes_device` cookie (`http/device.ts`), now also set by `POST /api/v1/seen` and before a sign-up or a sign-in is linked; the database only sees its pseudonym, as `scan_events` does, so the scans made before join the same device. Migration `0042_collector_views` (DATABASE §5.97 to §5.105). No host change, no new timer, no third party.

- **The app** (`web/verify/seen-model.ts`, `seen.ts`, `ApiClient.seen`): `pageOf` maps each screen to its page; `ViewClock` counts the time a view is in front (paused when hidden, and after 120 s idle except in a LIVE room and on a result; the account sheet and the sign-in panel pause the page under them); `SeenQueue` sends every 30 ± 10 s with `keepalive`, at once on hide or close, nothing during a LIVE room until then. Off in an automated browser. No word, no screen, no storage written.
- **The route** (`routes/seen.ts`): same origin, no CSRF token, its own rate group `seen`, 204 whatever happened; a signed-in batch's session kept 30 s in memory.
- **`TrackingService`** (`services/tracking.ts`): `ingest` drops a console session (and marks the device staff's, its rows deleted), the team's own accounts (`population.ts` `HouseAccounts`), test entrants (`TestEntrantAccounts`, 100.64.0.0/10), robots and prefetches (`http/device-class.ts` `isAutomated`), past 2 000 rows a device a Paris day; then the device (one upsert, an LRU of 20 000), its class (`classifyDevice`), the place (`geo/place.ts` `connectionPlace`, `PlaceService`) and each row with its subject into the `ViewBuffer` (one INSERT every 2 s, put off while the pool has requests waiting, 5 000 rows at most, written out at shutdown). `recordScan` writes each scan's row after `/api/v1/verify` has answered. `link`, at sign-up, sign-in and a signed-in view, gives the device's anonymous rows since its previous link to the account, in one transaction under the advisory lock `orbes/views-daily`; the acquisition's attach runs in it (B.13). At the first boot, `prepare` writes `tracking_state` and `backfillScans` turns the 13 months of past scans into devices and rows, by keyset batches, in the background.
- **The jobs** (`services/tracking-jobs.ts`, in `startHousekeeping`'s morning window, DATABASE §10): the daily totals, the collectors' places and the monthly summaries, one Paris day per transaction under the same lock; the 13-month purge folds each collector's rows first; unlinked old devices go; the `intelligence sizes` log line once a day.
- **The reads** (`services/tracking-reads.ts`, offered by `TrackingService`): the client sheet's browsing, the Collectors page's reports (the daily totals, or 13 months of detail with a collector filter) and click-through, activity, Segments' BROWSING criteria, the export's columns, and the right of access's `browsing`. Counted collectors only (`population.ts` `countedCollector`); never audited.

### B.13 Where they come from: links, campaign tags, first and last link (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4)

No second cookie and no route of its own: the visitor is B.12's device, and the page load's **arrival** rides in its first `POST /api/v1/seen` batch (`a`). Migration `0043_acquisition` (DATABASE §5.106 to §5.113; `tracking_devices.first_source_id`). No host change, no new timer, no third party: nothing is sent to an ad platform, no pixel.

- **The short address** (`routes/acquisition.ts`, `LinkService.resolve`): `GET /go/<code>` answers 302 to the link's page with `?o=<code>` and writes nothing (a visit is counted by the app's arrival, so link-preview robots count nothing); `GET /` keeps its query string. Those two 302s alone carry `Referrer-Policy: strict-origin-when-cross-origin`, so the referring site's origin reaches the app; every other response keeps `no-referrer`. Destinations are ORBES pages only.
- **The app** (`web/verify/arrival.ts`): `App.start` reads `o` and the `utm_` tags first and removes them from the address (`history.replaceState`, path and fragment kept); the referrer once per tab (`sessionStorage['orbes.arrived']`, the lot's only script-written storage); handed to the `SeenQueue` after the first screen. Nothing drawn, no word.
- **`AcquisitionService`** (`services/acquisition.ts`): `arrive`, called by `TrackingService.ingest` after its exclusions, classifies the arrival (`classify`: link > tags > site > Direct; `services/referrers.ts` folds the sites' families), finds or makes its source (100 new campaigns and sites a Paris day at most), sets the device's first source once and writes the visit. `attach`, inside `TrackingService.link`'s transaction, gives the device's visits to the account and writes the account's first source and its SIGNUP conversion at a sign-up (STAFF on a console device's); at a sign-in, an earlier device of this account becomes the discovery. `lastSourceAt` / `lastTouch`: the last non-direct visit within 90 days. `prepare` at boot: the channels, the fixed sources, the recording's start.
- **The jobs** (`services/acquisition-jobs.ts`, in `startHousekeeping`, DATABASE §10): every pass, each sign-up, entry and order's conversion, found by when its row was written and judged at the collector's act (an EXCHANGE order copies its original's), with a daily catch-up; in the morning window, the visits by Paris day, then their 13-month purge; `devicePurge` keeps a device a visit names.
- **The readings**: `AcquisitionReportService` (`services/acquisition-report.ts`, one REPEATABLE READ, READ ONLY transaction a reading, no cache) for the Links page and its click-through, each figure first and last link side by side, GROWTH's purchase and revenue rules, a TOTAL every view adds up to; `services/acquisition-reads.ts` for the client sheet's Origin (`originOf`), the Collectors export's columns (`exportColumns`) and the right of access's `origin`. Counted collectors only (`countedCollector`). Server status's VISITOR DATA line reads the daily `intelligence sizes` figures (`IntelligenceSizes`).
- **The console** (`web/admin/views/links.ts`, `link.ts`, `link-collectors.ts`, `model/links.ts`): Links under Clients after Segments (`readLinks` AUDITOR, `manageLinks` OPERATOR), New link and Edit, Channels, a link's page, the collectors behind a figure; `src/shared/link-code.ts`, the address's rule and suggestion, shared with the server.

### B.14 The birthday credit, the engagement score, Segments and the Collectors page (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 and §3.6, deployment I2)

They read what deployment I1 records (B.12, B.13, the profile and the wishlist). Migrations `0045_birthday_credit`, `0046_engagement_scores` and `0047_collector_history` (DATABASE §5.64, §5.66, §5.116 to §5.118). No host change, no new timer, no process: three jobs more in `startHousekeeping` (DATABASE §10).

- **The birthday credit** (`services/birthday-credits.ts`): its rules as pure functions (`birthdayIn`, `birthdayExpiry`, `nextBirthday`, `BIRTHDAY_GAP_DAYS`) and `BirthdayCreditService.grantDue`, the job `birthdayCredits` at every pass, one transaction per account under its row. The grant is a `tier_grants` row of kind BIRTHDAY, so the credit machinery takes it unchanged (`services/tier-grants.ts` `creditBalances`, `usableAt`; `services/orders.ts` Apply credit, the birthday credit first; `services/invoices.ts` *CREDIT · BIRTHDAY*; `render/invoice.ts` fourteen lines). THE PROGRAM holds its switch, amount and days (`services/club-program.ts`). The verify app shows it first under IN USE and as YOUR PROFILE's last line under DATE OF BIRTH; the console in the client sheet's Club block and on the order's page.
- **The engagement score** (`services/engagement-formula.ts`, pure: the five parts, `ENGAGEMENT_FORMULA`, `FORMULA_LINES` written from the constants; `services/engagement.ts`, `EngagementService`): `inputsFor` reads each account's acts, spend and releases on the existing indexes, `scoreBatch` writes only what changed, `runIfDue` is the morning job `engagement` (once a Paris day, after the views are counted, never beside an open LIVE room or a running test, claimed in `engagement_runs`), `account` the client sheet's Engagement block. Staff only; never audited.
- **Segments' new criteria** (`services/segments.ts`): five groups after Signals, each kind a `cleanRule`, a `ruleSql` (an `EXISTS` keyed by the account) and a `checkNames`, BROWSING through `tracking-reads.ts` `browsingCondition`, ORIGIN through `acquisition-filters.ts` (`sourceFilter`, `lastSourceFilter`, outside the services' import cycle); the builder's lists in `options`. The console's builder in `web/admin/model/segments.ts` and `views/segments.ts`.
- **The Collectors page** (`services/insights-scope.ts`: `parisPeriod`, `previousPeriod`, `periodBuckets`, `activeIn`, `ageBand`, `parseFilters`, `scopeCte`, the one CTE of the counted collectors every panel reads; `services/collector-insights.ts`, `CollectorInsightsService`: each reading one REPEATABLE READ, READ ONLY transaction with 32 MB of `work_mem` and 8 s, two at once (`ReadingGate`; the options and the export outside it, with the default `work_mem`), a cache of 50 results for 5 minutes; the panels overview, who, origin, likes (`services/likes.ts`, `LikesService`), devices (`tracking-reads.ts` `devicesDetailReport`, BY COLLECTORS and BY VISITS of a period from one reading of its rows, `devicesReport`, `mainDeviceRows`), engagement and trends; `list` and `parseSlice`, the collectors behind a figure with the rule of that figure). Routes `routes/admin/collectors.ts`; the console's `views/collectors.ts`, `collectors-panels.ts`, `collectors-parts.ts`, `collectors-list.ts`, `model/collectors.ts`, `model/likes.ts`.
- **The monthly history** (`services/collector-history.ts`): `writeMonth`, `backfill` and the job `collectorHistory` right after `engagement`, on Paris day 1 (the first deployment's 12-month back-fill once), batches of 1 000 by keyset.
- **The export** (`services/collector-export.ts`, `COLLECTOR_EXPORT_COLUMNS`, version 1): read whole in one read-only transaction (60 s) by keyset, 1 000 rows a batch, the tracking and acquisition columns from `tracking-reads.ts` and `acquisition-reads.ts` `exportColumns`; dates by `schedule.ts` `parisDateTime`, the favourites by `tastes.ts` `tastesOf`; audited, then sent.
- **The perf test** (`test/perf/collector-insights.perf.test.ts`, PostgreSQL, 20,000 collectors and 3 M views; DATABASE §11.4) holds the page and Segments to their budgets; `test/security/collector-never-sees-staff-data.test.ts` holds the collector's replies free of every staff figure.

### B.15 The desktop: CINEMA (desktop plan of 2026-10-16)

The collector app and the legal pages composed for a computer's window (BRAND-DESIGN-SYSTEM §3.14), on the phone's own screens, data and words: no migration, no host or Caddy change, no new dependency. A phone and a tablet are unchanged, text and pixels.

- **The switch** (`web/shared/desktop.ts`): the layout answers `DESKTOP_QUERY`, `(min-width: 1024px) and (hover: hover) and (pointer: fine)`, in the CSS and in `isDesktop()` / `onDesktopChange()`; `phoneOrTablet()` keeps every Android, iOS and iPadOS device and any device whose main pointer is a finger on the phone layout, and `web/shared/mode-early.ts` (a build entry run before the stylesheets) mirrors it before the first paint: `html.d-touch` for a phone or a tablet, `html.d-tap` for a computer with a touch screen. `onComputer()` (a fine pointer with hover, not a phone or a tablet, at any width) chooses a computer's words (`web/verify/copy.ts` `forDevice` and `DESKTOP`; `web/legal/content/desktop.ts` `forComputer`, display only, the legal texts and `LEGAL_VERSION` unchanged) and the sound's default (`web/verify/sound.ts`: off on a computer, `on` kept in `orbes.sound`).
- **Three stylesheets** (`scripts/build-web.ts` `ENTRY_FILES`, `entryOutName`): each app's `styles.css` (the phone's, with `web/shared/desktop-base.css`: `@property --d-ph-h` and the elements the phone's markup carries for the desktop only, hidden); `desktop-pointer.css` → `<app>-desktop-pointer-HASH.css` (`web/shared/desktop-pointer.css`, hover, pressed and cursor), linked under `(hover: hover) and (pointer: fine)`; `desktop.css` → `<app>-desktop-HASH.css` (`web/shared/desktop.css`, then for /verify `desktop-room.css`, `desktop-account.css`, `desktop-order.css`, `desktop-messages.css`, `desktop-pieces.css` and `desktop-circle.css`, for /legal `desktop-legal.css`, and last in both `desktop-tap.css`, the 44 px hit areas under `html.d-tap`), linked under `DESKTOP_QUERY`. The links are in the apps' own shells, `web/verify/index.html` and `web/legal/index.html`; a phone never waits for the two. The JS stays one bundle per app.
- **The weight** (gzip -9, KB of 1,024 bytes, raw in brackets; the desktop branch against production `c3d25c2`, both built by `scripts/build-web.ts`): the desktop's code ships inside each app's one bundle for launch (`splitting: false`), so a phone downloads it too. `verify-HASH.js` 205.1 KB (700.8 KB) against 169.1 KB (577.8 KB), +36.0 KB; `legal-HASH.js` 58.4 KB (185.2 KB) against 50.4 KB (159.8 KB), +8.0 KB; `verify-worker-HASH.js` unchanged, 28.0 KB (66.4 KB); the early mode scripts 0.5 KB against 0.2 KB. The stylesheets: /verify's phone sheet 20.8 KB (20.8 KB in production), its pointer sheet 2.4 KB and its layout sheet 30.4 KB; /legal's phone sheet 8.9 KB (8.9 KB), its pointer sheet 2.4 KB and its layout sheet 16.8 KB. `verify.build.test.ts` holds the stylesheets' limits (a phone sheet at most 22 KB, a computer's two more at most 45 KB together).
- **The behaviour**: `web/shared/desktop.ts` (the docked menu in the top bar, `watchBar`: the bar's ground over a frame, a frame's two blocks, the fit of its titles and words, a page's arrangement) and one module per chapter in `web/verify/views/`: `desktop-now.ts`, `desktop-release.ts` (THE RELEASES, a draw, THE ENTRIES as a table), `desktop-model.ts` (a model, its gallery and viewer), `desktop-pieces.ts`, `desktop-result.ts`, `desktop-room.ts` (the Cinema room), `desktop-wishlist.ts`. They take the phone's screens as drawn and move their elements into the desktop's places, each leaving a mark, and put them back on a phone.
- **The computer's own pages** (`views/shell.ts` adds SCAN to the bar; `main.ts` routes them on a computer, and on a phone to their equivalent): the SCAN page `/verify/scan` (`views/desktop-scan.ts`, the code of `web/shared/qr.ts`, a QR encoder of its own, byte mode, level M, and UPLOAD A PHOTO, the photo path); the sign-in page `/verify/sign-in` (`views/desktop-signin.ts`, the OWNERSHIP panel's own forms); YOUR ACCOUNT and its pages `/verify/account…` and `/verify/account/wishlist` (`views/desktop-account.ts`, the account sheet's own forms); MESSAGES in two parts `/verify/messages/<subject>` (`views/desktop-messages.ts`: the account's one conversation grouped in the page by what each of the collector's messages concerned, an answer under the message before it, GENERAL for none; a reply carries its subject's `concerning.ref`); an order's page `/verify/orders/OR-…` (`views/desktop-order.ts`, the order card's own forms).
- **The server** (read only, API §10.17): `concerning.ref` on each message's context, and `GET /api/v1/account/messages/unread-count` (`routes/messages.ts`, `MessageService`), behind the account session, for YOUR ACCOUNT's MESSAGES card and MESSAGES' NEW; `test/security/collector-never-sees-staff-data.test.ts` reads it.
- **What collectors look at** (B.12, the owner's answer Q4): a computer's page counts as its phone equivalent, with no page name added (`web/verify/seen-model.ts`): an order's page as MY_ORDERS; the account's pages as ACCOUNT, PROFILE, SIZES, ADDRESSES (the password page never), MESSAGES and WISHLIST; the sign-in page as SIGN_IN or SIGN_UP; the SCAN page never (a scan is written by the server). COMPUTER comes from the operating system, as before (`http/device-class.ts`).
- **Tests**: `test/web/desktop.switch.test.ts`, `copy.for-device.test.ts`, `legal.for-computer.test.ts`, `desktop.qr.test.ts` (with the test-only reader `test/support/qr-read.ts`), `verify.build.test.ts` (the stylesheets, and none of the review build's addresses, classes or state list in the public bundles and stylesheets); the desktop suites `desktop.chrome`, `desktop.pages`, `desktop.flows` and `desktop.tap` (`*.e2e.test.ts`); the content test's desktop states and shards, `desk-1` to `desk-12` (and `desk-13`, lot M1's emails' pages), with the parity of a computer's words (docs/launch/NOCTURNE-MATRIX.md).

### B.16 Lot M1: the waiting room, CAMPAIGN, the founding list and the emails (macro scope of 2026-10-20, lot M1 of 2026-10-21)

Four parts on the existing services, one deployment: migrations `0049_live_pace`, `0050_founding_list` and `0051_emails` (DATABASE §5.29, §5.39, §5.107, §5.120 to §5.124), no new dependency, no new process. The host changes by eight empty lines in `deploy/vps/compose.yaml` (the EMAIL_* passthrough, DEPLOYMENT §3.1), which change nothing a deploy runs. Every part maps one to one to a future Shopify store (scope S1 to S7): the founding list exports in Shopify's customer columns, the order emails are the platform's own orders' only (`platformSendsOrderEmails`), nothing assumes the platform is the only place people pay.

- **The waiting room's pace** (W1 to W6, `services/live.ts`): a LIVE RELEASE may admit its line at X buyers every Y minutes. The admission is one more step of the engine's `advance`, in the release's transaction under its row lock: the batches due (the first at T0, then one every Y minutes, `pace_next_at`) each admit the next X entries not admitted yet, in the order of the turns (the guarantees, then the places; the partial index `live_entries_waiting_admission`), stamped with the batch's logical time (`admitted_at`), so a restart or an overlap of two processes changes nothing. **The turns are given only to an admitted QUEUED entry** (`giveTurnsNow`): no client action can skip a batch, since the server alone gives a turn. With no pace every entry is admitted as it takes its place (batch 0), which is the room as before. The release's PAUSE holds the pace, as does its own PAUSE PACE; SET PACE, NEXT BATCH NOW and LET IN act under the same lock. An entry keeps its place whatever happens; an absent admitted entry's turn runs out (MISSED) and passes to the next in its size (W6).
- **The queue frame** (W2, W5; `services/live-room.ts` `LiveQueueFrame`, `http/live-stream.ts`, `routes/live.ts`): the hub builds, with the room, one small frame shared by every viewer still waiting for its batch (the next batch, X and Y, held or not, the batches so far, those waiting; no person) and sends it as `queue` events in place of `room` events; each viewer's own `you` event carries its place and estimated entry time (`LiveEntryView.queue`, `liveQueueEta`). `GET /state` answers `queue` with `pollMs` 10 000 (2 000 in the room). The page (`web/verify/views/live.ts`) shows the place, the time in Paris and how long until it, never X or Y. TEST ENTRANTS' bots wait in the queue and the TEST REPORT gains the PACE check; the planner suggests a pace above the room's 500 (`suggestedPace`). Measured locally at 5 000 (`scripts/live-load.ts --pace`, [reports/live-load.md](reports/live-load.md) §7): the queue exact, one container's memory above its limit with 5 000 open streams.
- **CAMPAIGN** (C1 to C3): `services/calendar.ts`, the one `.ics` writer (a LIVE RELEASE's file byte for byte, and a draw's, `GET /api/v1/drops/:id/calendar.ics`); `CampaignService` (`services/campaign.ts`): MAKE THE LINKS, one console link per channel to the release's page through `LinkService`, in one transaction under the advisory lock `RELEASE_CAMPAIGN` (DATABASE §8.3), each address from the opening's Paris day and the channel, never the title; the readout per link under the last link (entries and orders by `last_source_id`, each buyer counted once, revenue less credit notes, cost and return in the release's currency), counted collectors only, in one REPEATABLE READ, READ ONLY transaction. The console's CAMPAIGN tab (`web/admin/views/campaign.ts`) draws the 1080 × 1920 countdown image on a canvas (`ui/countdown-card.ts`), TEASER by default, FULL once the name and photograph are public; nothing is stored. ADD TO CALENDAR on a draw's page links the `.ics`.
- **The founding list** (F1 to F6): `routes/founding.ts`, `POST` and `OPTIONS /api/v1/founding`, the platform's one cross-origin route: CORS for `https://theorbes.com` only and the server's own Origin check (`403 FOUNDING_ORIGIN`), JSON of 2 KB at most, the rate group `founding`, a honeypot, the same 202 for any address. `FoundingService` (`services/founding.ts`) classifies the source with `AcquisitionService`'s rules, records the consent with `FOUNDING_CONSENT_VERSION`, matches the account with the same address (at once, or in the sign-up's transaction, `services/founding-match.ts`), and serves the console (list, summary, the CSV in Shopify's customer columns, removal on request, unsubscribe). A LANDING link answers 302 to `https://theorbes.com/?o=<code>`. The segment criterion FOUNDING_LIST reads the matched rows live; a draw may be opened to a segment (`403 DRAW_NOT_ELIGIBLE`, FOR SELECTED COLLECTORS). The pop-up is theorbes.com's own page, outside this repository's app.
- **The emails** (E0 to E6), off until `EMAIL_TRANSPORT=smtp`: `email/smtp.ts`, an SMTP client on `node:net` and `node:tls` (TLS from the first byte or STARTTLS, the certificate always checked, a server that offers no STARTTLS refused before any credential, every header value and address refused with a CR, LF or other control character, one message per connection), the app's only outbound connection; `email/render.ts` and `email/copy.ts`, the house's look and the default words. `EmailService` (`services/email.ts`): `enqueue` in the transaction of the act that causes the email (the outbox, once per dedupe key, nothing while the channel or the kind is off); the sender, a loop of its own every 15 s started by `createContext` only while the channel is on, claiming due rows `FOR UPDATE SKIP LOCKED` with a lease, cancelling at send time what no longer applies, retrying 1 min, 5 min, 30 min and 2 h, then FAILED; the purge in housekeeping (90 days); the HMAC unsubscribe tokens. `EmailTriggers` (`services/email-triggers.ts`): E1 the founding announcement (now or at a release's opening, cancellable), E2 release notices behind a watermark, E3 the reset link (`AccountRecoveryService.requestByEmail`), E4 and E5 an order's steps and cancellation (through a required `OrderMail` parameter of `orders.ts step`, so no path that moves an order forgets it), a draw's place, a warranty's and a PRIVATE CARE's label; E6, house messages, have no kind. Routes: `routes/email.ts` (the monogram, STOP THESE EMAILS), `routes/account.ts` (reset-request, email preferences), `routes/admin/email.ts`. The account's export lists its emails (kinds, statuses, dates) and preferences; a lock cancels its QUEUED emails.
- **The web side**: in `web/verify/`, the queue in `views/live.ts`, ADD TO CALENDAR and FOR SELECTED COLLECTORS in `views/releases.ts` (`releases-model.ts`), RESET BY EMAIL in the sign-in (`views/ownership.ts`, `reset-model.ts`), `views/reset.ts` (the link's address and code read from the fragment and removed from the address bar at once), `views/unsubscribe.ts`, `views/mail-frame.ts` (their computer frame), YOUR PROFILE's EMAILS group; every word in `copy.ts`. In `web/admin/`, the pace in `views/live.ts`, `views/campaign.ts`, `views/founding.ts`, `views/emails.ts` and `ui/email-frame.ts`, which draws an email's HTML element by element from its own parser in a shadow root (listed tags and attributes, styles through the CSSOM, images from the console's origin only), never as markup.

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
| I Fake verification website | Canonical domain education. Public key endpoint. | Phishing remains possible. Future mitigation: owner-account notifications (the emails of lot M1, off until a provider is added, carry none; see THREAT-MODEL I and AF). |
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
