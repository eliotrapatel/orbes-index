# NOCTURNE — the matrix of every screen and state (step N0)

The inventory of plan NOCTURNE's fidelity rule 4, made before any change to the app's look, at
`5efd4c942fb4518766a55d890ce2120305f26d4b` (lot E, LIVE RELEASE+, merged). Every screen and state of /verify and /legal,
each with every piece of data it shows and its reference: a board of the canvas (C1–C43, `nocturne-ref/shots`), a capture
taken before the change (`docs/assets/ui/live-*.png`, `plus-*.png`, `verify-*.png`, and the before-captures of the LIVE
screens in `docs/assets/ui/nocturne-before/`), or "same pieces" (built with the pieces of the boards, no board of its
own).

The **state** column names the state as `genome/test/support/nocturne-states.ts` defines it: the parity tool
(`genome/scripts/parity.ts`) reaches it on the NOCTURNE demo, and its text values are recorded, state by state, in
`genome/test/fixtures/nocturne-baseline.json`, which the content test checks against the new app (one test file per
shard of states, `genome/test/web/nocturne.content-<shard>.e2e.test.ts`, run side by side; their structure in
`nocturne.content.e2e.test.ts`). A value is shown when it reads within one block of the page's words, on word and figure
boundaries (NO is not shown by *not*, 17 not by *2017* nor *17:00*); a part the server writes (a GENOME's id, a code, an
id, a reference, the seed, a link) is masked, and reads only as a text of its shape. A state written *(not reached)* is not on the stage; the reason is given, and the content
test cannot guard it: each step that touches it checks it by hand against this list.

Words are the app's own (`genome/src/web/verify/copy.ts`, the server's result copy `genome/src/server/services/copy.ts`,
`genome/src/web/shared/*`, `genome/src/web/legal/content/*`); data in *italics* is what the server or the account holds.

## The stage

- **Clock.** Monday 5 October 2026, 18:49 in Paris (16:49 UTC), fixed on the server and in the browser
  (`NOCTURNE_NOW`). Countdowns, registration windows and VERIFIED stamps are therefore the same at every run.
- **Phone.** 390 × 844 CSS px at scale 2, an iPhone's user agent, English, Paris time zone. Its camera is Chromium's
  fake camera playing a hand-held clip of the stage's piece to register; the track reports a torch and a zoom from 0.5×
  to 5×, like an iPhone's, so LIGHT and the zoom toggle show (the camera opens at 2×, the toggle offering 0.5×).
- **The demo** (`genome/test/support/nocturne-demo.ts`), in thirteen variants, each seeded on its own stage through the
  real services: `full` (the boards' story), `rules` (C27–C28), `draw-leads` (C42), `draw-soon` and `draw-early` (C42's
  other states), `collection-leads` (C43), `room` (C21), `live` (the room's screens), `afterroom` (C26), `afterroom-ends`
  (three after-rooms of the last two hours, ended with a guest still in their line: sold out, closed, ended by ORBES; and
  a guest who never entered one), `draws` (a draw in every state an entry or a page shows, and r.castel, a collector with
  an entry in each and an order PAID), `stress` (fidelity rule 5) and `empty` (every empty state; an owner of one piece
  of a model kept out of the collection sees the empty circle).
- **Where the demo differs from the boards** (live data excepted: times, ids, a countdown's digits, the GENOME's glyphs):
  - Since N1, MONOLITHE in steel is a model and gold and blue its variants (ADD A VARIANT; the dots Steel · Gold · Blue):
    the lookbook's list gives them as one entry, which THE COLLECTION shows as one model with its dots since N6.
  - Since N1 (migration 0024), the October draw has its price, € 4 200: the app shows it from N7 (addition 5).
  - Since N1 (decision 9), the boutique piece's own photograph (taken at issuance before NOCTURNE) is shown nowhere:
    THIS PIECE and the sentence for two photographs are recorded as removed in the content test's MOVED list.
  - The fourth order the plan lists (the draw in steel, RETURNED on 2 Oct) needs a draw of its own: the account took
    part in three releases, not two, and YOUR RELEASES holds three entries (the LIVE of 5 Oct, the two September draws;
    the account has not entered the October draw, whose page C19 shows with ENTER THE DRAW).
  - The poll is kept for PLATINE and PALLADIUM: the TITANE account (you) does not see it; THE CIRCLE of a PLATINE account
    does (`circle-platine`), and C34 is captured as that account.
  - The question after (C30) is shown to a collector whose turn passed on 5 Oct (the guest); you secured your piece.
  - No model has a gallery (the media store refuses a gallery photograph that is the model's cover, and the demo holds
    the owner's three photographs only): the sheet's gallery is *(not reached)*.
  - C33 (N6): ZENITH has a story and specifications in the demo (the content baseline holds them), and a SKU in size 17
    (its order from the salon): its sheet shows SIZE 17 under its line and THE STORY and SPECIFICATIONS before CARE,
    which the board draws without.
- **Where the build differs from the boards on purpose** (since N2; the final board review does not count these as
  regressions):
  - The © line takes ash, not the boards' smoke (contrast).
  - The rail's links, the footer's links, DB-IP's and a text link carry a 44 px tap zone in padding given back by a
    negative margin (the type and its place are the boards').
  - The rail clips sideways only (`overflow-x: clip`), so a link's tap zone may reach above it.
  - The banner of the LIVE RELEASES is never under the 44 px tap zone: on one line (its name not yet revealed, or a
    short one) it is 44 px high, its line centred; on two lines it is C3's 54 px.
  - C4 (N5): the contact of ORBES Client Services under REPORT LOST / STOLEN stands 28.25 px under the button, not 14:
    its email's 44 px tap zone reaches 28.25 px above its word and never lies over the button.
  - C4 (N5): CARE, the last of a piece's tabs, grows its tap zone 8 px to the right into the margin (SERVICE stands
    right beside it on a 320 px phone); the tablist's hairline stays the column's.
  - Since N5, every 16 px icon (the boards' `ic sm`: ›, + / −, ✓, ‹) is drawn in ash, as the rulebook's `.C .sm` reaches
    it on C2–C5, C16, C24 and C32; it was ivory before.
  - C24, C32 (N5): the number of an invoice or a credit note is in the reading face at the label's weight, as drawn;
    every figure of a label is in Helvetica Neue (the plan's Type rule), the board's SIZE I7 reads SIZE 17.
  - Every button's label is in Gravesend capitals, as the plan's Type rule says, where the boards' markup leaves `.btn`
    in Helvetica Neue (SIGN OUT on C2, TRY AGAIN on C40: the same width, its glyphs 1.5 px lower at scale 2).
  - The shared certificate (`/verify/c#…`, kept as it is, choice 3) opens on the black ground with Safari's bars in ink
    for the moment before the scripts run, then takes its paper and its white bars: the static page cannot know its route
    under the CSP, and its ground before the scripts is the html's (`--vault-ground`) whatever the body's class. The
    static body keeps `class="nocturne"` so the page shown without JavaScript (JAVASCRIPT REQUIRED) reads ivory on black.
  - C15, C16 (UNREADABLE CODE): the caution mark. The board's moon path (n.py's `TONE.caution`) closes on itself and
    draws nothing, so the board shows the empty ring; the build draws the plan's ring and moon as a crescent.
  - C15: SEND ANSWER is `aria-disabled` until an answer is pressed (said to a screen reader, never silent), with the
    look C15 draws for that very state.
  - C36 (3): the ceremony's GENOME is centred, as on every result. The board's 220 px image falls to the left of the
    column, a block inside `.ctr` (a board artefact).
  - C5 (N6): the rail underlines COLLECTION (C_CSS's `.rail a.on::after`, as on every chapter since N2), where the board's
    picture shows none; the figures of SIZES 16 · 17 · 18 and of 21:00 are in Helvetica Neue (the plan's Type rule).
- **Omissions of the drawings** (since N4: the app has these and keeps them, built with the same pieces; the final board
  review expects them):
  - C13: RECEIVING's lead, *If its owner has given you a transfer code, enter it…*, above the sign-in.
  - C14: *This piece is registered to your ORBES account.* under REGISTERED TO YOU.
  - C15: the certificate card's sentence, *If this piece was delivered to you with its ORBES certificate card…*.
  - C17 (3) CONNECTION INTERRUPTED: its sentence, *The ORBES verification service could not be reached…*.
  - C17 (40 s): *Hold the camera 10 to 20 cm from the code…*.
  - C36 (1): *Register this piece in your name…*, and the account line after VIEW AS OWNER.
  - C36 (3): the GENOME's label, id and fingerprint above the ceremony's name.
  - C36 (5): the NOT YET DELIVERED label above its sentence.
  - C37 (4): *If this piece is registered to you, verify it again to see it as its owner.* under the sentence that no
    transfer is pending.
  - C3: the banner's countdown is the banner's; AFTER THE RELEASES and EARLY ACCESS on PIECES when they apply (N5).
  - C4, C35: the warranty's sentence under its rows; a service's kind under its dates and place; CREATE LINK · CANCEL
    under the validity's choice; the open links' list when there are several; *A loss or a theft of this piece cannot be
    reported here…* for a piece revoked; the sentences of a transfer pending, of a piece in service and of an ownership
    not yet verified; the contact under every state (N5).
  - C24, C32: the SIZE and PRICE rows of an order cancelled whose terms were entered (ZENITH: 17, € 4 800); the care
    guide's line names the model with its variant (*The care guide of MONOLITHE in steel*, N1); the steps' dates of an
    order of one step reached keep their year (5 OCT 2026), as C24 draws them (N5); TRACK THE SHIPMENT under the
    tracking number of an order RETURNED once shipped (C32 draws CARRIER and TRACKING NUMBER only) (N5).
  - C31: the contact of ORBES Client Services under an entry CONFIRMED; the entry's id whole, in lower case, as the draw
    publishes it (the board shows eight characters in capitals) (N5).
  - C5, C6, C33 (N6): a model without a photograph (its words open where it would be); the models without a collection
    (under no heading); several collections and several models (76 px apart, as C7's articles); the sheet's gallery,
    each photograph whole across the column without the fade, 2 px apart (C22's); DISCONTINUED · *year* on a sheet's
    line; the request refused (*The request could not be sent.* and the reason, C_CSS `.err`); THE PRIVATE SALON's
    teaser for an account signed in that holds no piece shows SCAN ORBES CODE alone (SIGN IN is for a visitor signed
    out); a model's next release when it is a draw (DRAW · ENTRIES OPEN, IN STEEL, ENTRIES CLOSE *date · time* UTC), its
    room open or live (LIVE RELEASE · THE ROOM IS OPEN, · LIVE NOW), or more than six days ahead (its date with its
    weekday); a model of the salon among a public model's dots switches the sheet to its price, tier and request.

## Boards without a screen of their own today

The parity tool sets each board beside the state that holds its content today (`BOARD_STATES`):

| Board | Today | State |
|---|---|---|
| C1, C10, C42, C43 NOW | the landing and its banner | `now-*` |
| C2 the account sheet | its own screen since N2 (the header's account button): see *The chrome and the account sheet* | `account-sheet` |
| C4 a piece, C35 its tabs | its own page since N5 (`/verify/pieces/<id>`, SEE THE PIECE): see *MY PIECES* | `piece`, `pieces-warranty` and C35's sections |
| C24 ORDERS, C31 RELEASES, C32 an order returned or cancelled | the tabs ORDERS and RELEASES of MY PIECES since N5 | `pieces-orders`, `pieces-releases` |
| C21 the room, C26 the after-room | stand-in images of the room: compared with the before-captures | `room`, `after-room-door` |
| C28, C36–C40 | boards of several states: the first is captured, the others are states of this matrix (C40's are each set beside the board too, `BOARD_SECTIONS`: `<C40>.<state>.pair.png`) | see each section |

## The chrome and the account sheet (since N2)

Every screen but the scan, the room and every LIVE RELEASE page (N7 gives its pages before and after the room the
chrome), the boutique board and the shared certificate has NOCTURNE's chrome (`views/shell.ts`): the header (ORBES; the
tier's name and the monogram, the button *Your account, TITANE*, or the monogram alone without a tier; SIGN IN signed
out), the rail NOW · RELEASES · COLLECTION · CIRCLE · PIECES (the current one `aria-current`, RELEASES' dot while a LIVE
RELEASE is announced, its room open or live, or a draw open, soon open or in its early access), the footer (the
monogram, PRIVACY · TERMS · LEGAL · HELP in a new tab, SOUND ON/OFF, IP GEOLOCATION BY DB-IP, © ORBES · PARIS, GENOME
CODE in it from 560 px wide) and the SCAN ring. The landing's own foot and every screen's own legal links gave way to
the footer; the banner of the LIVE RELEASES lies under the rail. VERIFYING… and a problem of the scan are on the ground
without the chrome until N4.

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `account-sheet` | YOUR ACCOUNT, SIGNED IN AS *email*, YOUR TIER (moved from MY PIECES, decision 10): TITANE, *2 pieces held*, five dots, the benefits, NEXT: PLATINE, *1 more piece …*, what it adds; SOUND (its switch), CHANGE PASSWORD, MY PIECES, PRIVACY · TERMS · LEGAL · HELP (the index, a new tab), SIGN OUT | the account button, signed in (over NOW of the `draw-leads` demo, as C2 draws its page) | C2 |
| `account-sheet-club` | the same for an account without a piece: THE CLUB, *A piece registered … opens TITANE …*, its benefits; the header's monogram alone | newcomer | C2 |
| `account-sheet-password` | CHANGE PASSWORD, its sentence, CURRENT PASSWORD, NEW PASSWORD, *At least 12 characters.*, CHANGE PASSWORD, CANCEL | CHANGE PASSWORD in the sheet | C2, C39 (4) |
| `account-sheet-stress` | PALLADIUM, six pieces: five dots, its benefits, *PALLADIUM is the highest tier of the club.* | the stress demo | same pieces |

## NOW (today: the landing, `/verify`)

Today's landing is not yet NOW: the monogram over the wordmark ORBES and AUTHENTICATION, SCAN ORBES CODE, UPLOAD A PHOTO,
MY PIECES (once the session is known), THE COLLECTION, THE RELEASES, and at the foot SOUND ON/OFF, PRIVACY · TERMS · LEGAL
· HELP, IP GEOLOCATION BY DB-IP and © ORBES · PARIS (© ORBES · GENOME CODE · PARIS from 560 px wide); over it, the banner
of the LIVE RELEASES.

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `now-signed-out` | the landing; the banner LIVE RELEASE · *name once revealed* · OPENS IN *hh:mm:ss* (hours past 24 when a day or more ahead) | signed out, a LIVE RELEASE announced | C10 |
| `now-signed-in` | the same; MY PIECES leads to the account's pieces | signed in | C1 |
| `now-draw-leads` | the landing without banner (the draw shows only in THE RELEASES today) | no LIVE RELEASE announced, a draw open | C42 |
| `now-draw-soon`, `now-draw-early` | the same | the draw before its entries, or in its early access | C42 (state 2) |
| `now-collection-leads`, `now-collection-leads-signed-out` | the same | nothing announced | C43 |
| `now-room-open` | the banner … · THE ROOM IS OPEN | a room open | live-01 |
| `now-live` | the banner … · LIVE NOW | a LIVE RELEASE live | live-01 |
| `now-empty` | the landing, no banner | no model, no release, an account without a piece | C43, C40 |
| `now-stress` | the banner with a 24-character name (since N2: on two lines as C3, the name whole) | the stress demo | same pieces |

Since N3, NOW (views/now.ts) replaces the landing at `/verify`. What leads: a LIVE RELEASE announced, its room open or live
(its photograph, LIVE RELEASE and its state, its title, type line, OPENS IN and its countdown, its day and hour in Paris,
the quantity, per-collector and access lines, N COLLECTORS WILL BE THERE, SEE THE RELEASE), the draw open, soon open or in
its early access under it as a plate card; else that draw as the hero (its state, title, model, price, pieces and time in
UTC, then on this phone); else the newest PUBLIC model (THE COLLECTION · its collection, name, type, SIZES, variant dots,
You own N, SEE THE MODEL); else nothing. Signed in: YOUR PIECES (two, their model's photographs, the tier in one line),
THE CIRCLE (the next open invitation as a plate card, YES / NO, its places), THE COLLECTION (not when it leads), the scan.
Signed out: the scan with MY PIECES, then THE COLLECTION. The banner is MY PIECES' alone. Moved on purpose (the content
test's MOVED): AUTHENTICATION, the link THE RELEASES (the rail), the banner's countdown (the hero's), and with no model
shown the link THE COLLECTION (the rail).

## The scan (`/verify`, one address)

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `scan-preparing` | the orbit reticle, PREPARING CAMERA…, CLOSE, UPLOAD A PHOTO | before the camera's stream | C38 (1) |
| `scan-camera` | the camera full screen, the orbit and its four moons, SCANNING…, *Align the ORBES CODE within the orbit*, LIGHT, the zoom toggle *0.5×*, UPLOAD A PHOTO, CLOSE | the camera open (an iPhone's) | C11, verify-02 |
| `scan-light-zoom` | LIGHT pressed (aria-pressed), the zoom toggle reading *2×* | after LIGHT and the toggle | C38 (5) |
| `scan-verifying` | the code locked (veil, moons heavier), ORBES CODE FOUND then VERIFYING… | a code read | C12, verify-03 |
| `photo-verifying` | the ring taken up, READING PHOTO… then VERIFYING… | a photo uploaded | C12, verify-09 |
| `scan-hint` | *Hold steady — in even light* in place of the guide (the others, *Place the whole code inside the orbit*, *Hold about 20 cm away*, *Zoom in*, by the same line) | 6 s without a read: a stand-in decoder answers each frame FORMAT (N4) | C38 (2) |
| `scan-seal` | the ring tightened round the centre, heavier, its light breathing | a stand-in decoder sees a certain seal, frame after frame (N4) | C38 (3) |

**Controls shown only on some devices or states:**
- **LIGHT**: when the camera's track reports a torch (`getCapabilities().torch`, an iPhone's rear camera, most Android
  phones); pressed, aria-pressed and underlined.
- **The zoom toggle**: when the track reports a zoom range whose maximum exceeds its minimum. The camera opens at 2× (or
  the nearest step, e.g. 1.6×, `defaultZoomLevel`); the toggle then offers the widest view: *0.5×* on an iPhone (its
  ultra-wide), *1×* elsewhere; once pressed it offers the default again (*2×*).
- **UPLOAD A PHOTO** on the scanner: always; its tone halves while VERIFYING….
- **MY PIECES** on the landing: once the session is known (hidden while it is asked for, and when the account service
  cannot be reached).
- **The banner**: on the landing and MY PIECES only, while a LIVE RELEASE is announced, its room open or live.

## The results (`/verify`, after a scan)

Every result: the tone mark (authentic: ring and core; caution: ring and moon; void: the empty ring), the title (and its
subtitle), the server's sentence; SCAN ANOTHER or SCAN AGAIN; VERIFIED *date · time*, REF *scan reference*; PRIVACY ·
TERMS · LEGAL · HELP (a new tab) and IP GEOLOCATION BY DB-IP. An authentic result adds the photographs (THIS PIECE *when
the piece has one*, THE MODEL, *Photographed by ORBES. Compare it/them with the piece in your hands.*), the GENOME
(GENOME, *product id*, *the glyphs*, *fingerprint · GENOME-01*), the product lines (*model*, *type*, *category*,
*material*, CREATED *year*, DISCONTINUED · *year* when so), SEE THE MODEL (when the model is public), the tabs PRODUCT ·
WARRANTY · CARE · OWNERSHIP and the assurance note.

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `result-first-registration` | AUTHENTIC, FIRST REGISTRATION; OWNERSHIP: REGISTRATION OPEN, its sentence, REGISTRATION OPEN UNTIL *time*, *Sign in or create an ORBES account to continue.*, SIGN IN · CREATE ACCOUNT, EMAIL, PASSWORD, SIGN IN, FORGOTTEN PASSWORD? | an activated piece never registered, signed out | C9, verify-04 |
| `result-first-registration-product` | PRODUCT ID, COLLECTION, MODEL, TYPE, VARIANT *(the free-text field; SIZE since N1)*, CATEGORY, MATERIAL, CREATED, VERIFICATION, SIGNATURE (VALID · ORBES KEY *n*), CODE (CODE-01 · ISSUE *n*), ISSUED, ASSURANCE (PRINTED CODE) | the PRODUCT tab | verify-05 |
| `result-first-registration-warranty` | STATUS, FROM, UNTIL (or the sentence of Client Services) | WARRANTY | C35 (1), verify-06 |
| `result-first-registration-care` | the model's care (or the house's general care text) | CARE | C35 (3), verify-07 |
| `result-create-account` | NAME (OPTIONAL), EMAIL, PASSWORD (*At least 12 characters.*), CREATE ACCOUNT, the terms note, TERMS OF USE · PRIVACY POLICY (a new tab) | CREATE ACCOUNT | C39 (1) |
| `result-forgotten-password` | FORGOTTEN PASSWORD, its sentence, the contact of Client Services (email, phone, hours), I HAVE A RECOVERY CODE, BACK TO SIGN IN | FORGOTTEN PASSWORD? | C39 (2) |
| `result-recovery-code` | SET A NEW PASSWORD, its sentence, EMAIL, RECOVERY CODE (XXXX-XXXX-XXXX, *Given by ORBES Client Services. It works once.*), NEW PASSWORD, SET NEW PASSWORD | I HAVE A RECOVERY CODE | C39 (3) |
| `result-first-registration-signed-in` | REGISTRATION OPEN UNTIL *time*, CLAIM CODE (XXXX-XXXX-XXXX, its hint), REGISTER THIS PIECE, SIGNED IN AS *email* · MY PIECES · SIGN OUT | signed in | C36 (1) |
| `result-registered-now` | REGISTERED TO YOU, *ownership verified with its claim code*, VIEW AS OWNER | after REGISTER THIS PIECE | C36 (2) |
| `result-ceremony` | the GENOME first, its glyphs appearing, *model*, *collection*, SHARE THE GENOME | VIEW AS OWNER right after a first registration | C36 (3) |
| `result-registration-closed` | REGISTRATION CLOSED, its sentence, SCAN AGAIN | the scan's window ends as the result arrives (its answer routed, N4) | C36 (4) |
| `result-not-delivered` | AUTHENTIC (no subtitle), NOT YET DELIVERED, *This piece has not yet been delivered …* | a piece in stock, never sold | C36 (5) |
| *(not reached)* staff scan | the staff-test sentence instead of the form | a browser signed in to the console | C36 (5) |
| `result-registered-signed-out` | AUTHENTIC, REGISTERED, the resale guidance (*Buying this piece? …*), I HAVE A TRANSFER CODE; OWNERSHIP: REGISTERED TO ITS OWNER, RECEIVING THIS PIECE, the sign-in, *If this piece is already registered to you …* | a piece registered to someone, signed out | C13 |
| `result-registered-transfer-link` | the same, RECEIVING THIS PIECE brought into view | I HAVE A TRANSFER CODE | C13 |
| `result-registered-other` | AUTHENTIC, REGISTERED, the resale guidance, I HAVE A TRANSFER CODE; OWNERSHIP: REGISTERED TO ITS OWNER, *This piece is registered to an ORBES account.*, RECEIVING THIS PIECE, *No transfer of this piece is pending. Once its owner has created a transfer code …*, *If this piece is registered to you …*, VERIFY AGAIN, the account line | signed in, not the owner, no transfer pending | C37 (4) |
| `result-receiving` | REGISTERED TO ITS OWNER, *A transfer of its ownership is in progress.*, RECEIVING THIS PIECE, RECEIVING OPEN UNTIL *time*, TRANSFER CODE (XXXX-XXXX-XXXX), RECEIVE THIS PIECE, the account line | a transfer pending, signed in | C37 (2) |
| `result-received` | REGISTERED TO YOU, *The ownership of … has been transferred …*, VIEW AS OWNER | the demo keeps the owner's code of the piece passed on (N4): the new owner enters it | C37 (3) |
| `result-ownership-verified` | AUTHENTIC, OWNERSHIP VERIFIED; OWNERSHIP: REGISTERED TO YOU, TRANSFER OF OWNERSHIP, its sentence, CREATE TRANSFER CODE, the account line | the account's own piece | C14 |
| `result-ownership-verified-product` | the PRODUCT tab it opens on (the rows above) | the same | C14 |
| `result-transfer-code` | TRANSFER CODE *XXXX-XXXX-XXXX*, VALID UNTIL *date · time*, its sentence, CANCEL TRANSFER | CREATE TRANSFER CODE | C37 (1) |
| `result-unusual-card` | UNUSUAL ACTIVITY DETECTED, its sentence, the GENOME, the contact (*Please quote the reference below.*, CONTACT ORBES CLIENT SERVICES, phone, hours), DO YOU HOLD THE CERTIFICATE CARD?, its sentences, REGISTRATION OPEN UNTIL *time*, the sign-in; WHERE DID YOU SEE OR BUY THIS PIECE? | a sold piece under review (a burst of scans of copies of its code) | C15, verify-10b |
| `result-unusual-stolen` | UNUSUAL ACTIVITY DETECTED, the GENOME, the contact, WHERE DID YOU SEE OR BUY THIS PIECE? | a piece reported stolen | C15, verify-10 |
| `result-unusual-report-open` | BOUTIQUE · ONLINE · PRIVATE SALE · OTHER (one pressed), PLACE (OPTIONAL) and its hint, NOTE (OPTIONAL) and its hint, SEND ANSWER | a choice made | C15 |
| *(not reached)* answer sent | THANK YOU, *Your answer is kept with reference …* | SEND ANSWER (it opens a case: kept out of the demo) | C15 |
| *(not reached)* DO YOU HOLD A TRANSFER CODE? | its sentences and the receiving form | under review, a transfer pending, signed in | C15 |
| `result-invalid` | INVALID SIGNATURE (void), its sentence, the contact, WHERE DID YOU SEE OR BUY THIS PIECE? | a forged signature | C16, verify-11 |
| `result-unknown` | UNKNOWN ORBES CODE (void), its sentence, the contact, the question | a code ORBES signed for no piece | C16 (2) |
| `result-revoked` | REVOKED (void), its sentence, the GENOME, the contact, the question | a revoked code | C16 (3) |
| *(not reached)* UNREADABLE CODE | caution, *This code could not be read …* | a malformed payload (the decoder refuses it before the server) | C16 (4) |
| *(not reached)* claim held | *Too many claim codes have been tried …* | a 429 on a claim code | C36 |
| `result-stress` | AUTHENTIC, FIRST REGISTRATION of a piece of the 24-character model's 14-character variant (Brushed cobalt): MONOLITHE ARCHITECTURALE, its material, SIZE 17 · WIDE BAND (a Size of 14 characters); OWNERSHIP and the sign-in | the stress demo (since N4) | same pieces |
| `result-ceremony-stress` | the ceremony of that model and Size, signed in | the stress demo (since N4) | same pieces |

## The problems of the scan (`/verify`)

Each: the empty orbit, the title, one sentence, the primary action as a button and the secondary as a text link.

| State | Title — actions | Reference |
|---|---|---|
| `problem-camera-denied` | CAMERA ACCESS DECLINED — UPLOAD A PHOTO, SCAN AGAIN | C17 (1) |
| `problem-camera-missing` | NO CAMERA AVAILABLE — UPLOAD A PHOTO, RETURN | C17 |
| `problem-camera-in-use` | CAMERA UNAVAILABLE — SCAN AGAIN, UPLOAD A PHOTO | C17 |
| `problem-camera-unsupported` | CAMERA NOT SUPPORTED — UPLOAD A PHOTO, RETURN | C17 |
| `problem-network` | CONNECTION INTERRUPTED — TRY AGAIN, RETURN | C17 (3) |
| `problem-rate-limited` | A MOMENT, PLEASE — TRY AGAIN, RETURN | C17 (3) |
| `problem-server` | VERIFICATION UNAVAILABLE — TRY AGAIN, RETURN | C17 (3) |
| `problem-photo-unreadable` | NO ORBES CODE FOUND (a photo) — UPLOAD A PHOTO, SCAN AGAIN | C17 (2) |
| `problem-photo-invalid` | PHOTO NOT READABLE — UPLOAD A PHOTO, RETURN | C17 |
| `problem-scan-timeout` | NO ORBES CODE FOUND after 40 s, SCAN AGAIN, UPLOAD A PHOTO | a stand-in decoder never finds a code (N4) | C17 (2) |
| *(not reached)* | CAMERA UNAVAILABLE (failed); SECURE CONNECTION REQUIRED; SCANNER UNAVAILABLE (RETURN) — the stage is a secure context, the decoder always starts | C17 (2) |

## MY PIECES (`/verify/pieces`)

Signed in, top to bottom at 5efd4c9: the banner; ORBES, MY PIECES, *The pieces registered to your ORBES account.*; YOUR TIER
(*tier*, *n pieces held*, its benefits, NEXT: *tier*, *how many more open it, from how many*, what it adds; PALLADIUM is
the highest; without a piece THE CLUB and what a first piece opens; *A piece revoked or retired …* when it applies: in the
account sheet since N2, decision 10); each
piece (the GENOME plate, the photographs, the product lines, OWNERSHIP · WARRANTY · SERVICE · CARE with the status,
SINCE, ACQUIRED, OWNERSHIP VERIFIED / NOT YET VERIFIED, TRANSFER, the declarations, the ownership certificate); AFTER THE
RELEASES; YOUR ORDERS (each: *model*, *channel · release*, its sentence, the steps RESERVED · PAID · SHIPPED · DELIVERED
or CANCELLED or RETURNED with their dates, SIZE, PRICE, *add-ons*, TOTAL, CARRIER, TRACKING NUMBER, TRACK THE SHIPMENT,
DOCUMENTS: INVOICE *n*, CREDIT NOTE *n*, CARE GUIDE, OWNERSHIP CERTIFICATE, ORDER *OR-…*); EARLY ACCESS (an account without
a piece only); YOUR RELEASES (each: *release*, *state · status*, its sentence, YOUR ENTRY *id* or REFERENCE *LR-…*, the
contact for a place held); SIGNED IN AS *email*, CHANGE PASSWORD, SIGN OUT; SCAN ORBES CODE, THE COLLECTION, THE
RELEASES, THE CIRCLE (an owner), the legal links.

Since N5 (C3, C4, C24, C31, C32, C35), the page is split. **MY PIECES**: the banner (on PIECES only, as C3 draws it; C24
and C31 go without it), MY PIECES and, on PIECES, its sentence; the tabs PIECES · ORDERS · RELEASES with their counts (a
tab with nothing in it is left out; their place in the history keeps the one shown). PIECES: each piece on its model's
photograph, faded (never the piece's own, decision 9), *name* and *id*, *type · material · SIZE n* (addition 1), ✓
REGISTERED TO YOU · SINCE *date* (or its state alone), SEE THE PIECE; AFTER THE RELEASES; EARLY ACCESS (an account without
a piece); ADD A PIECE, *Scan a piece, then register it from the OWNERSHIP tab of its result.*, SCAN ORBES CODE. ORDERS:
each order on its model's photograph (addition 3), *channel · release* (THE PRIVATE SALON · *model*), *model*, the steps
(one reached dated in full, several by day and month: C24, C32), its sentence, SIZE, PRICE, *add-on* + *price*, TOTAL,
CARRIER, TRACKING NUMBER, TRACK THE SHIPMENT, ORDER *OR-…*, DOCUMENTS as rows (INVOICE *n* · PDF ›, CREDIT NOTE *n* · PDF ›,
CARE GUIDE · *The care guide of model* +, OWNERSHIP CERTIFICATE · PDF ›). RELEASES: each entry a row, its title a link,
*state · status*, its sentence, YOUR ENTRY *id* (in the reading face, lower case, as the draw publishes it) or REFERENCE
*LR-…*, the contact. **A piece** (`/verify/pieces/<id>`): ‹ MY PIECES; THE MODEL's photograph, captioned, its sentence; the
name, its lines with SIZE, SEE THE MODEL; its state; WHERE IT COMES FROM (addition 2: THE DRAW OF *day* or THE LIVE
RELEASE OF *day*, SEE THE RELEASE ›; ORDER *OR-…*, *STEP* ON *date* ›, which opens ORDERS with it in view; nothing for a
piece without an order); its GENOME; OWNERSHIP · WARRANTY · SERVICE · CARE: ACQUIRED, OWNERSHIP, SINCE (TRANSFER), the
sentences, CANCEL TRANSFER, OWNERSHIP CERTIFICATE, REPORT LOST / STOLEN or REPORTED LOST / STOLEN and its sentences,
PIECE FOUND, the contact. SIGNED IN AS, CHANGE PASSWORD and SIGN OUT are the account sheet's (C2, C39); THE COLLECTION,
THE RELEASES and THE CIRCLE the rail's. The content test looks for what the one page showed in all of its parts
(`SPLIT`, test/web/nocturne.content.harness.ts).

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `pieces-signed-out` | MY PIECES, *Sign in to see the pieces …*, the sign-in | signed out | C18 |
| `pieces-sign-in-refused` | the same, the refusal under the fields | a wrong password | C18 |
| `pieces` | everything above for you: TITANE, two pieces (O26-J-00184 in steel with THIS PIECE and THE MODEL; O26-J-00199 in gold), four orders (LIVE RESERVED; DRAW DELIVERED, its invoice; DRAW RETURNED, its invoice and credit note; THE PRIVATE SALON CANCELLED), three releases; since N5 the tab PIECES | signed in | C3, verify-12 |
| `pieces-orders` | (N5) the tab ORDERS: the four orders above | ORDERS | C24, C32, plus-12 |
| `pieces-releases` | (N5) the tab RELEASES: the account's entries | RELEASES | C31 |
| `piece` | (N5) O26-J-00199 in gold: THE MODEL, SIZE 17, WHERE IT COMES FROM (THE DRAW OF 14 SEPTEMBER, ORDER *OR-…* DELIVERED ON 22 SEP 2026), its GENOME, OWNERSHIP | SEE THE PIECE | C4 |
| `piece-boutique` | (N5) O26-J-00184 in steel, sold at a boutique: no WHERE IT COMES FROM | SEE THE PIECE | C4 |
| `piece-stolen`, `piece-transfer`, `piece-in-service` | (N5) the owner's pieces reported stolen (its sentence, the contact), with a transfer pending (TRANSFER PENDING UNTIL *date*, its sentence, CANCEL TRANSFER), in service | the owner (m.okafor) | C35 (7) |
| `pieces-orders-stress`, `piece-stress` | (N5) four orders (€ 125 400, USD, a 27-character tracking number); a piece of the 24-character model without a photograph, its 14-character Size | the stress demo | same pieces |
| `pieces-warranty` | STATUS, FROM, UNTIL, the warranty's note (since N5 on O26-J-00184's page, as it was its tab before) | WARRANTY | C35 (1) |
| `pieces-service` | SERVICE HISTORY, *No service has been recorded for this piece.* (or each service: *status since date · place*) | SERVICE | C35 (2) |
| `pieces-care` | CARING FOR THIS PIECE, the care; ORBES CARE, its lead, its three benefits, SUBSCRIBE (a new tab) or *Subscriptions open soon.* | CARE | C35 (3) |
| `pieces-certificate-choice` | 7 DAYS · 30 DAYS · 90 DAYS, its sentence, CREATE LINK, CANCEL | CREATE CERTIFICATE | C35 (4) |
| `pieces-certificate-link` | CERTIFICATE LINK, *the link*, VALID UNTIL *date*, *This link is shown once …*, COPY LINK, OPEN LINK, CREATED *date* · VALID UNTIL *date*, WITHDRAW | CREATE LINK | C35 (4) |
| `pieces-report-choice` | REPORT LOST / STOLEN, LOST · STOLEN (pressed), what follows each, the effect, CONFIRM REPORT, CANCEL | REPORT LOST / STOLEN | C35 (5) |
| `pieces-incidents` | an owner's pieces: REPORTED STOLEN (Client Services' sentence and contact), TRANSFER PENDING (PENDING UNTIL *date*, CANCEL TRANSFER), REPORTED LOST (PIECE FOUND), IN SERVICE (*This piece is with ORBES for a service.*); PLATINE, NEXT: PALLADIUM | the owner (m.okafor) | C35 (6, 7) |
| `pieces-piece-found` | PIECE FOUND, its sentence, PASSWORD, CONFIRM, CANCEL | PIECE FOUND | C35 (6) |
| `pieces-care-guide` | CARE GUIDE open under an order's documents (the model's care guide) | CARE GUIDE | C24, C31, plus-13 |
| `pieces-change-password` | CHANGE PASSWORD, its sentence, CURRENT PASSWORD, NEW PASSWORD, CHANGE PASSWORD, CANCEL (since N5 in the account sheet over MY PIECES) | CHANGE PASSWORD | C39 (4) |
| `pieces-question-after` | AFTER THE RELEASES, *You said you would be there …*, ONE QUESTION, *release · date*, WHAT WOULD YOU HAVE WANTED?, the three answers, *One tap. You may change your answer until …* | said I'LL BE THERE, did not come | C30, plus-14 |
| `pieces-turn-passed` | YOUR RELEASES: *release*, LIVE RELEASE · TURN PASSED, *Your turn passed before the seal was held.* | a turn passed | C31 (2) |
| `live-pieces-turn` | YOUR RELEASES: LIVE NOW · YOUR TURN, *It is your turn. Open the release to secure your piece.* | a turn now | C31 (2) |
| `pieces-empty` | THE CLUB, *A piece registered … opens TITANE …*, its benefits, *No piece is registered …*, EARLY ACCESS and its recall | an account without a piece | C40 (3) |
| `pieces-loading` | ONE MOMENT… | the pieces being read | C40 (1) |
| `pieces-failed` | *Your pieces could not be shown just now.* *the reason*, TRY AGAIN | the pieces could not be read | C40 (2) |
| `pieces-stress` | six pieces (a 14-character free-text field), four orders (€ 125 400, $ 6 400, a 27-character tracking number) | the stress demo | same pieces |
| `pieces-draws` | r.castel's MY PIECES: YOUR ORDERS with an order PAID (*Your payment is received. ORBES is preparing your piece for shipping.*); YOUR RELEASES with an entry in each state, each *state · status* and its sentence: ENTRIES OPEN · WITHDRAWN, ENTRIES CLOSED · ENTERED, CANCELLED · ENTERED, DRAWN · PLACE HELD (*held until …*, the contact), DRAWN · WAITING LIST (*rank n*), DRAWN · CONCLUDED, DRAWN · LAPSED | the `draws` demo | C24, C31 (2) |
| `pieces-certificate-withdrawn` | *The link has been withdrawn: it no longer leads to the certificate.*, the open links left | WITHDRAW on a certificate link | C35 (4) |
| *(not reached)* | SHIPPED in MY PIECES of the `full` demo (seen in `pieces-stress`); the password changed / recovered notices; a declaration confirmed (*now reported lost …*); a certificate link that could not be read; *A loss or a theft of this piece cannot be reported here* (a revoked piece) | each needs a failure the stage does not make, or a password changed (it ends every session of the demo's account) | C35, C39 |

## THE COLLECTION and a model (`/verify/lookbook`, `/verify/lookbook/<slug>`)

Since N6 (C5, C6, C33): THE COLLECTION as a title and its sentence, each collection's name, each model (a main model and
its variants, one entry) full width on its photograph, faded, its words lifted onto it, its dots switching the
photograph, the price and SEE THE MODEL; THE PRIVATE SALON for an owner, its teaser for a visitor (addition 7). A sheet:
‹ THE COLLECTION, the photograph, its collection, name, line, SIZES (addition 8), its dots (each switches the sheet and
its address, so a variant's own address opens it selected), You own N, its next release as a plate row, the salon's
facts, sentence, note and REQUEST THIS PIECE or REQUESTED with the contact, THE STORY, the gallery, SPECIFICATIONS, CARE.
The page's own SCAN ORBES CODE gave way to the SCAN ring (the content test's MOVED list); the wordmark to the header's
ORBES; the sheet's foot link THE COLLECTION to its crumb.

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `collection-signed-out` | THE COLLECTION, its lead, *collection*, each model on its photograph (*name*, *type*, its dots, SEE THE MODEL), THE PRIVATE SALON's teaser (its sentence, SIGN IN, SCAN ORBES CODE; no model) | signed out | C5 (2) |
| `collection` | the same, You own N under the dots, then THE PRIVATE SALON, its lead, *collection*, ZENITH, BRACELET, € 4 800, SEE THE MODEL | an owner signed in | C5 |
| `collection-no-piece` | as signed out, the teaser with SCAN ORBES CODE alone | signed in without a piece | C5 (2) |
| `model`, `model-blue`, `model-gold` | ‹ THE COLLECTION, the photograph, *collection*, *name*, *type*, SIZES 16 · 17 · 18, the dots (the address's selected), You own N (signed in), the next release (LIVE RELEASE, IN BLUE, THURSDAY 21:00 PARIS), THE STORY, the gallery, SPECIFICATIONS (*label · value*), CARE | a public model | C6 |
| `model-salon` | ‹ THE COLLECTION, *collection*, ZENITH, BRACELET · THE PRIVATE SALON, SIZE 17, THE PRIVATE SALON, PRICE, OFFERED FROM, its sentence, A NOTE FOR ORBES CLIENT SERVICES and its hint, REQUEST THIS PIECE, THE STORY, SPECIFICATIONS, CARE | a model of the salon, its tier reached | C33 (1) |
| `model-salon-requested` | REQUESTED, *ORBES Client Services will contact you.*, the contact | requested | C33 (2) |
| `model-salon-signed-out`, `model-not-found` | ‹ THE COLLECTION, *This model is not in the ORBES collection.* | a reserved model signed out; an address that leads nowhere | C40 (4) |
| `collection-empty` | *No model is shown in the collection yet.*, the teaser | no model | C40 (3) |
| `collection-stress`, `model-stress` | a 24-character name without a photograph, a 14-character dot, € 125 400 | the stress demo | same pieces |
| *(not reached)* | DISCONTINUED · *year* (a model discontinued); the gallery; the request refused (*The request could not be sent.*); the collection could not be shown (TRY AGAIN) | | C6, C40 (2) |

## THE RELEASES and a release's page (`/verify/releases`, `/verify/releases/<id>`)

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `releases`, `releases-signed-out` | ORBES, THE RELEASES, its lead, LIVE · PAST; each LIVE RELEASE (its picture: photograph, silhouette or the seal; LIVE RELEASE and where it stands; *name* or TO BE REVEALED; *day · time* PARIS (and ON THIS PHONE when it differs); *price · quantity · per collector*; FOR *rule*; THE REVEALS still to come; *n* COLLECTORS WILL BE THERE; SEE THE RELEASE); each draw (*photograph*, *state*, *title*, *model · type*, *pieces · ENTRIES OPEN/CLOSE date UTC*, SEE THE RELEASE); SCAN ORBES CODE, THE COLLECTION | | C7, plus-01, live-02 |
| `releases-past` | *You have taken part in n releases.*; each past release (*photograph*, LIVE RELEASE or DRAW, *name*, *model · type*, *date · quantity*, YOU SECURED A PIECE / YOU TOOK PART, SEE THE RELEASE), SHOW MORE | PAST | C25, plus-02 |
| `releases-empty` | *No release is announced yet.* | no release | C40 (3) |
| `releases-stress` | a release 42 minutes away (its room open), one 9 days and 3 hours away in USD, € 125 400 | the stress demo | same pieces |
| `draw` | ORBES, *collection*, *title*, ENTRIES OPEN, *description*; THE RELEASE (*model · type*, SEE THE MODEL, PIECES, ENTRIES OPEN and ENTRIES CLOSE in UTC then on this phone, PLACE HELD *48 HOURS*); YOUR ENTRY (*Entries are open …*, ENTER THE DRAW); THE DRAW (the rule, the obligation sentence, the commitment, SEED FINGERPRINT *hex*); SCAN ORBES CODE, THE RELEASES | a draw open, signed in | C19 |
| `draw-signed-out` | the same, YOUR ENTRY: *Enter the draw with your ORBES account …* and the sign-in | signed out | C19 |
| `draw-entered` | *You are entered in the draw …*, WITHDRAW, YOUR ENTRY *id* | ENTER THE DRAW | C31 |
| `draw-soon` | ENTRIES OPEN SOON, *Entries open on …*; the early access line (PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …), EARLY ACCESS row, RESERVED DIRECTLY | before its entries | C42 (2) |
| `draw-early` | EARLY ACCESS, the line, RESERVED DIRECTLY *0 OF 12 PIECES*, the early access paragraph, RESERVE A PLACE, *As a PLATINE owner, you may reserve a place now …* | its early access, a PLATINE account | C42 (2) |
| `draw-drawn` | THIS RELEASE IS OVER, YOU SECURED A PIECE, DRAWN *date*, YOUR ENTRY CONCLUDED, SEED *hex*, *Checked on this phone …*, THE ENTRIES (*rank · tier · years*, *id*, YOURS) | drawn | C29 |
| `draw-not-found` | *This release is not known to ORBES.* | an address that leads nowhere | C40 (4) |
| `draw-soon-platine` | *As a PLATINE owner, you may reserve a place directly from …, before entries open to everyone.* | before its early access, a PLATINE account | C42 (2) |
| `draw-early-others` | EARLY ACCESS, *PLATINE and PALLADIUM owners are reserving their places now. Entries open to everyone on ….* | its early access, any other account | C42 (2) |
| `draw-closed` | ENTRIES CLOSED, *Entries are closed. The draw follows.* | past its close, not drawn | same pieces (C19) |
| `draw-closed-entered` | ENTRIES CLOSED, ENTERED, *You are entered in the draw, which follows the close of entries.*, WITHDRAW, YOUR ENTRY *id* | past its close, entered | same pieces (C19, C31) |
| `draw-closed-withdrawn` | WITHDRAWN, *You withdrew from this draw.* | past its close, withdrawn while it was open | same pieces (C19) |
| `draw-withdrawn` | WITHDRAWN, *You withdrew from the draw. You may enter again while entries are open.*, ENTER THE DRAW | open, withdrawn | same pieces (C19) |
| `draw-cancelled`, `draw-cancelled-entered` | CANCELLED (and ENTERED), *This release has been cancelled: there will be no draw.* | cancelled | same pieces (C19) |
| `draw-place-held` | THIS RELEASE IS OVER, YOU TOOK PART, PLACE HELD, *Your place is held until … — ORBES Client Services will contact you.*, the contact, YOUR ENTRY *id* | drawn, selected | same pieces (C29, C31) |
| `draw-waiting-list`, `draw-waiting-list-no-piece` | WAITING LIST, *You are on the waiting list, rank n. …* | drawn, waitlisted (TITANE; an account without a piece) | same pieces (C29, C31) |
| `draw-lapsed` | LAPSED, *The time to conclude has passed: the place held for you has lapsed.* | drawn, the place held not taken up in time | same pieces (C29, C31) |
| `draw-full` | EARLY ACCESS · EVERY PIECE RESERVED, RESERVED DIRECTLY *1 OF 1 PIECE*, *Every piece of this release has been reserved. Entries open to everyone on …: the draw then ranks a waiting list …* | its early access, every piece reserved | C42 (2) |
| `draw-place-reserved` | PLACE RESERVED, *You reserved a place directly. It is held until … — ORBES Client Services will contact you.*, the contact | a PLATINE account's direct reservation | C42 (2) |
| `draw-open-full` | ENTRIES OPEN · EVERY PIECE RESERVED, *Every piece of this release has been reserved. You may still enter: …*, ENTER THE DRAW | open, every piece reserved | same pieces (C19) |
| `live-announced` | LIVE RELEASE, *name*, *type · collection*, *price*, SEE THE MODEL, OPENS IN *dd : hh : mm* (DAYS · HOURS · MINUTES), *day · time* PARIS, FOR *rule*, *quantity · per collector*, THE ROOM OPENS *n* MINUTES BEFORE, *n* COLLECTORS WILL BE THERE, YOUR SIZE, *sizes*, its sentence, I'LL BE THERE, *description*, ADD TO CALENDAR, the drawing rule, THE RELEASES, SOUND ON | announced, signed in | C20, live-04 |
| `live-announced-signed-out` | the same, I'LL BE THERE opening the sign-in, *Sign in to say you will be there, with your size.* | signed out | C28 (2) |
| `live-there` | YOU'LL BE THERE · SIZE 17, the sizes, *Another size changes it …*, WITHDRAW | I'LL BE THERE said | C28 (1) |
| `live-veiled` | TO BE REVEALED, the seal, THE REVEALS (THE NAME AND THE PHOTOGRAPH · *day · time*), FOR OWNERS FROM PLATINE, the rule and why (*This release is for owners from PLATINE. Your ORBES account does not meet the rule …*) | not revealed, a TITANE account | C7, C28 (3), live-03 |
| `live-veiled-platine` | the same, YOUR SIZE and I'LL BE THERE | a PLATINE account | C7 |
| `live-rules` | A SURPRISE IN EVERY BOX, FOR OWNERS FROM PLATINE OR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES OR SELECTED COLLECTORS | the rules joined by OR, eligible | C27, plus-04 |
| `live-rules-not-eligible` | the rule, *You have taken part in n releases.*, *Your ORBES account does not meet the rule …* | not eligible by participation | C28 (4), plus-05 |
| `live-selected-not-eligible` | FOR SELECTED COLLECTORS, *This release is for selected collectors.* | a selection | C28 (5), plus-06 |
| `live-past-secured` | LIVE RELEASE, *picture*, *name*, *type · collection*, SEE THE MODEL, THIS RELEASE IS OVER, *date · quantity*, YOU SECURED A PIECE, *description*, THE RELEASES, SOUND ON (see the note below on C29's receipt) | ended, you secured a piece | C29, plus-03 |
| `live-past-signed-out` | the same without a mark | signed out | C29 |
| `live-past-question` | YOU TOOK PART, ONE QUESTION, WHAT WOULD YOU HAVE WANTED?, ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND, *One tap …* | took part without a piece, within 7 days | C30, plus-11 |
| `live-past-gold` | a past LIVE RELEASE nobody of the story took part in | | C25 |

**C29's receipt is a board element, not today's past page.** C29 draws, on a past LIVE RELEASE's final page, the account's
CONFIRMED receipt in ivory (LIVE RELEASE · *name*, *Your piece is reserved in size 16 …*, RESERVED, SIZE, PIECES,
ENGRAVING, TOTAL, REFERENCE *LR-…*, MY PIECES). Today's past page (`views/live.ts` pastScreen) shows none of it: only YOU
SECURED A PIECE (or YOU TOOK PART), the question and the description. Its data exists in the room's CONFIRMED screen
(`live-confirmed`, live-12): N7 builds the receipt from the account's live entry and its order.

## The room, the line and the vault (`/verify/releases/<id>`, compared with the before-captures)

Inside the room the look is kept (fidelity rule 6): the before-captures are `docs/assets/ui/nocturne-before/live-*.png`
and `plus-07` to `plus-10` there. C21 and C26 are stand-in images: those screens are compared with these captures. They
were taken at N0 on the app of `5efd4c9` by `scripts/capture-ui.ts --only live` and `--only plus` (the room lived through
on real time: the last minute, the door opening, the turn held half way), the collector's screens kept: live-01 to
live-22, plus-01 to plus-14.
The sign-in a LIVE RELEASE's pages show (SIGN IN TO ENTER, and I'LL BE THERE signed out) keeps lot E's markup and look
too (the OWNERSHIP panel's `look: 'vault'`, since N4) until N7 draws those pages.

| State | What it shows | Reference |
|---|---|---|
| `room` | FROM ORBES *message*, THE ROOM IS OPEN, *name*, *price · quantity*, SEE THE MODEL, the door and its lock, *mm:ss*, UNTIL THE OPENING · *time*, *n* IN THE ROOM, READY CHECK (SIGNED IN, ACCESS *tier*, SIZE *17*, CONNECTION LIVE, CLOCK SYNCED TO ORBES), YOUR SIZE (preselected from I'LL BE THERE), its sentence, ENTER THE ROOM, THE RELEASES, SOUND ON | C21, live-05 |
| `room-ready` | YOU'RE READY, *Your place is drawn at … Keep this page open.*, LEAVE THE ROOM | C21, live-06 |
| `room-sign-in` | SIGN IN TO ENTER, *The room is open to …*, the sign-in | live-13 |
| `room-not-eligible` | the rule and why | live-14 |
| `live-join` | LIVE NOW, *price · quantity*, *n* IN THE ROOM, *left OF quantity* LEFT, its sentence, YOUR SIZE, ENTER THE LINE | live-09 |
| `live-line` | YOUR PLACE *n*, YOU ARE NEXT IN SIZE *s* / *n* AHEAD OF YOU, *left OF quantity LEFT · n IN SIZE s*, *n* HELD PIECES MAY RETURN, its note | live-09 |
| `live-turn` | YOUR TURN, PRESS AND HOLD THE SEAL, the turn's ring and *mm:ss*, TO SECURE YOUR PIECE, *name · size · price*, *Let go too early …* | live-10 |
| `live-secured` | SECURED, YOUR PIECE, SECURED AT *time*, *name*, *collection · size*, ADD-ONS (*label*, + *price*, *line*), PAY · *total*, *mm:ss* TO CONFIRM, its note, RELEASE MY PLACE | live-11 |
| `live-confirmed` | CONFIRMED (ivory), LIVE RELEASE · *name*, *Your piece is reserved in size …*, RESERVED, SIZE, ENGRAVING, TOTAL, REFERENCE, CLIENT SERVICES and the contact, MY PIECES, THE RELEASES | live-12 |
| `live-sold-out-size` | SOLD OUT IN SIZE 17, YOUR PLACE *n*, *Every piece in your size is reserved …*, LEAVE THE LINE | live-20 |
| `live-missed`, `live-expired`, `live-released`, `live-left`, `live-removed` | YOUR TURN HAS PASSED · YOUR HOLD HAS ENDED · YOUR PLACE IS RELEASED · YOU LEFT THE LINE · YOUR ENTRY IS REMOVED, each with its sentence and THE RELEASES (end pages: header, rail and ring from N7) | live-15 to live-19, C30 |
| `after-room-door` | THE AFTER-ROOM, A SECOND DOOR, the door, its sentence, OPEN UNTIL *time*, ENTER THE AFTER-ROOM | C26, plus-07 |
| `after-room-join` | THE AFTER-ROOM, *You keep your place from the line …*, YOUR SIZE, ENTER THE LINE | C26, plus-08 |
| `room-checks-pending` | READY CHECK not ready: SIZE TO CHOOSE (no size said before), CONNECTION RECONNECTING (the room's stream lost: the page reads the room instead), CLOCK SYNCING (the clock of ORBES not answering) | same pieces |
| `after-room-sold-out` | THE AFTER-ROOM, SOLD OUT, *Every piece of the after-room is reserved.*, THE RELEASES (an end page) | C30 |
| `after-room-closed` | THE AFTER-ROOM, THE AFTER-ROOM IS CLOSED, *Its time has run out before your turn came.* | C30 |
| `after-room-ended` | THE AFTER-ROOM, THE AFTER-ROOM HAS ENDED, *ORBES has ended the after-room before your piece was secured.* | C30 |
| `after-room-over` | THE AFTER-ROOM, THE AFTER-ROOM IS CLOSED, *Your entry, if you had one, stays in MY PIECES.* (a guest who never entered it) | C30 |
| `room-stress`, `live-far-stress` | a 140-character host message, a 24-character name, € 125 400, UP TO 3 PER COLLECTOR, a 9-day countdown in USD | same pieces |
| *(not reached)* | the last minute (the lock turning) and T0 (the door opening, DRAWING THE PLACES); PAUSED; A PIECE HAS RETURNED; TAP AGAIN TO RELEASE / TO LEAVE; the ends SOLD OUT, THE RELEASE HAS CLOSED, THE RELEASE HAS ENDED (to one in the line), THIS RELEASE IS OVER (cancelled); the after-room's turn and CONFIRMED; the release could not be shown — time does not pass on the stage; the before-captures hold them (live-06, live-08, live-21, live-22, plus-09, plus-10) | live-06 to live-22, plus-09, plus-10 |

**Controls shown only in some states:** SEE THE MODEL (from the photograph's stage, when the model's sheet is public, until
T0); THE ROOM OPENS *n* MINUTES BEFORE (before the room); ADD TO CALENDAR (announced); the add-ons (a release that has
some); RELEASE MY PLACE (a piece held); LEAVE THE ROOM (entered before T0); LEAVE THE LINE (sold out in one's size);
SOUND ON/OFF at the room's foot (always, the preference shared with the landing).

## THE CIRCLE and a post (`/verify/circle`, `/verify/circle/<id>`)

| State | What it shows | Shown when | Reference |
|---|---|---|---|
| `circle` | ORBES, THE CIRCLE, its lead, EARLY ACCESS and its recall; each post (*photograph*, *kind* (· *tiers*), *title*, *date*, an invitation's *event date · time UTC · place*, YOU ANSWERED *YES* / YOU VOTED, SEE THE INVITATION / SEE THE POLL / READ THE NOTE), SHOW MORE (more than a page), SCAN ORBES CODE, THE RELEASES · THE COLLECTION · MY PIECES | a TITANE owner | C8 |
| `circle-platine` | the same with the poll (POLL · PLATINE AND PALLADIUM) | a PLATINE owner | C8 |
| `circle-signed-out` | *The circle is reserved for the owners … Sign in …*, the sign-in | signed out | C40 |
| `circle-no-piece` | *The circle is reserved … It opens once a piece is registered …* | no piece | C40 (4) |
| `circle-empty` | ORBES, THE CIRCLE, its lead, EARLY ACCESS and its recall, *Nothing has been published in the circle yet.* | an owner, nothing published | C40 (3) |
| `post-invitation` | *photographs*, INVITATION, *title*, *date*, *text*; THE INVITATION (WHEN in UTC then on this phone, WHERE, PLACES *n LEFT OF c*); YOUR ANSWER (*You will come …*, YES · NO); TO SEE (*release* SEE THE RELEASE, *model · type* SEE THE MODEL, OPEN THE LINK *host*); SCAN ORBES CODE, THE CIRCLE | | C22 |
| `post-answered-no` | *You will not come …*, NO pressed | NO | C22 |
| `post-poll` | POLL · PLATINE AND PALLADIUM, *title*, *date*, *text*, THE POLL, its lead, the options, VOTE (once one is chosen) | not voted | C34 (1) |
| `post-poll-voted` | *Your vote is counted. The results so far:*, each option (*n VOTES · p%*, YOUR VOTE) | voted | C34 (2) |
| `post-note` | NOTE, *title*, *date*, *photograph*, *text* | | C22 |
| `post-not-found` | *This post is not in the circle.* | | C40 (4) |
| `circle-stress`, `post-stress` | eight posts, a 71-character title | | same pieces |
| `post-poll-stress` | a poll whose first option is A FINISH IN BRUSHED BLACK RHODIUM, before a vote | | same pieces |
| *(not reached)* | answers closed (*The event has begun …*, no buttons); every place taken (*Every place is taken …*, YES disabled); NONE LEFT OF *c*; SHOW MORE's failure; the feed could not be shown | | C22 (2, 3) |

## Kept as they are (out of NOCTURNE's look)

| State | What it shows | Reference |
|---|---|---|
| `certificate` | ORBES, OWNERSHIP CERTIFICATE, VALID (or NO LONGER VALID, NOT FOUND), its lead, the GENOME plate, the product lines, THE RECORD (OWNERSHIP, SINCE, WARRANTY, LOSS OR THEFT), THIS CERTIFICATE (CHECKED, ISSUED, VALID UNTIL), its note, DOWNLOAD PDF, SCAN ORBES CODE, VERIFY ONLY AT THEORBES.COM/VERIFY | choice 3, verify-13 |
| `board` | the boutique board: ORBES, LIVE, the door, LIVE RELEASE · *phase*, *name*, *quantity*, OPENS IN, *left OF quantity LEFT*, *day · time* PARIS, FULL SCREEN (THIS BOARD IS NOT AVAILABLE without its secret) | scope guard, live-07 |

## The legal pages (`/legal`, `/legal/privacy`, `/legal/terms`, `/legal/notice`, `/legal/faq`)

Each: ORBES, PRIVACY · TERMS · LEGAL · HELP (the current one marked), ENGLISH · FRANÇAIS, the title, VERSION OF *date*,
the introduction, each section's heading (an anchor, its figures in the reading face) and text (paragraphs, lists,
links, the contact of Client Services where the text names it), VERIFY A PIECE · IP GEOLOCATION BY DB-IP · © ORBES.
The index (`/legal`, and any other address under /legal, put back to /legal): its title (*Legal information*), VERSION OF
*date*, its lead, and each page's link (its title) with its summary. Every page is in English and in French (`?lang=fr`,
else the browser's language): the language is a state of each.

| State | What it shows | Reference |
|---|---|---|
| `legal-index` | the index | C23 (the same pieces) |
| `legal-privacy` | PRIVACY | C23 (the same pieces) |
| `legal-terms` | TERMS | C23 |
| `legal-notice` | LEGAL | C23 (the same pieces) |
| `legal-faq` | HELP | C41, legal-01 |
| `legal-index-fr` | the index in French (*Informations légales*) | C23 (in French) |
| `legal-privacy-fr` | CONFIDENTIALITÉ | C23 (in French) |
| `legal-terms-fr` | CONDITIONS | C23 (in French) |
| `legal-notice-fr` | MENTIONS LÉGALES | C23 (in French) |
| `legal-faq-fr` | AIDE | C41 (in French) |

## Controls shown only on some devices or states (summary)

| Control | Condition |
|---|---|
| LIGHT | the camera's track reports a torch |
| The zoom toggle | the track reports a zoom range; it reads the widest view (*0.5×* on an iPhone, *1×* elsewhere) while the default (≈ 2×) is applied, the default (*2×*, *1.6×*) once toggled |
| MY PIECES on the landing | the session known (not while asked, not when the account service is unreachable) |
| The banner | a LIVE RELEASE announced, its room open or live; on the landing and MY PIECES |
| THE CIRCLE link in MY PIECES | the account holds a piece now |
| THE PRIVATE SALON in THE COLLECTION | signed in, a piece held |
| SEE THE MODEL | the model's sheet is public (and, for a LIVE RELEASE, from its photograph's stage until T0) |
| I HAVE A TRANSFER CODE | AUTHENTIC — REGISTERED only |
| CREATE TRANSFER CODE / CANCEL TRANSFER | the owner, no incident / a transfer pending |
| OWNERSHIP CERTIFICATE | a piece not reported lost or stolen, not revoked or retired |
| PIECE FOUND | a loss the owner reported |
| SUBSCRIBE (ORBES Care) | CARE_SUBSCRIBE_URL set; otherwise *Subscriptions open soon.* |
| The contact of Client Services | configured (email, phone, hours each when set) |
| RESERVE A PLACE | a PLATINE or PALLADIUM account in a draw's early access |
| ENTER THE DRAW / WITHDRAW | entries open / entered |
| I'LL BE THERE / WITHDRAW | an account the rule lets in, before T0 / said |
| ADD TO CALENDAR | a LIVE RELEASE announced |
| VOTE | a poll option chosen, not voted |
| YES · NO | an invitation open, a place left (YES disabled when none) |
| SHOW MORE | more than a page (THE RELEASES' PAST, the circle, a draw's entries) |
| EARLY ACCESS (MY PIECES) | an account without a piece |
| AFTER THE RELEASES | a question open for the account |
| SOUND ON/OFF | the footer of every screen with the chrome (the account sheet repeats it as a switch) and the room's foot |
| GENOME CODE in the footer's © line | a screen 560 px wide or more (© ORBES · PARIS on a phone) |
| The account button | signed in: the tier's name (none without a tier) and the monogram; signed out: SIGN IN; nothing while the session is asked for |

## Using it

From `genome/`, with `ORBES_CHROMIUM` set:

- `npx tsx scripts/parity.ts [C1,C9,…]` — each board's real screen and its pair (`<out>/<C-id>.real.png`,
  `<out>/<C-id>.pair.png`); C21 and C26, stand-in images of the room, are paired with their state's before-capture.
- `npx tsx scripts/parity.ts --live [<id,…>]` — each LIVE state beside its before-capture (`<out>/live/<state>.pair.png`;
  by default every state whose reference is a live-xx or plus-xx capture).
- `npx tsx scripts/parity.ts --states <id,…|variant|all>` — any state of this matrix.
- `npx tsx scripts/parity.ts --stress` — the extreme cases and what overflows in each.
- `npx tsx scripts/parity.ts --baseline` — the content baseline (recorded once, at N0); `--baseline --states <id,…>`
  records those states only (a state added, or one whose way there changed), every other entry's values kept.
