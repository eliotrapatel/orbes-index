/**
 * The privacy policy (J-06), written from what the code does, in English
 * and French. Each fact is held to the code by test/web/legal.content.test.ts:
 *
 *  - the IP address: stored only as a keyed hash, HMAC-SHA-256 with
 *    IP_HASH_PEPPER (server/http/client.ts `pseudonymize`); the app's log
 *    holds none, Caddy's access log masks it (/24, /48: deploy/vps/Caddyfile);
 *  - the device cookie: `__Host-orbes_device`, a random id kept 2 years
 *    (server/http/device.ts), stored as its pseudonym only;
 *  - the approximate location: the country and coordinates rounded to
 *    0.1° (about 10 km, server/geo/resolver.ts `roundCoord`), from the local
 *    DB-IP database (GEO_MODE=mmdb, deploy/vps/.env.example);
 *  - the account: email, password as a scrypt hash, an optional name; sessions
 *    of 30 days at most with the IP pseudonym and the user agent;
 *  - the retention: SCAN_RETENTION_DAYS=90 in production (the owner's
 *    decision of 2026-10-03, the plan's choice 17), so verifications are kept
 *    90 days (services/scan-retention.ts purges older scans with what hangs on
 *    them; scan_daily_stats keep the daily counts); sessions end after 30 days;
 *    the backups keep 14 nightly and 8 weekly archives, and no archive taken
 *    before an update past 63 days (deploy/vps/scripts/backup.sh): about two
 *    months;
 *  - a signed-in verification: the account and a keyed pseudonym of the
 *    session (routes/public.ts `meta.sessionHash`, scan_events.session_hash);
 *  - the entries in releases (P-R03, services/drops.ts): the account, the
 *    release, the time, the status and the staff's note; the tier, the
 *    seniority and the rank written at the draw, which the release's page
 *    then publishes by entry id, never by account; the console's entries
 *    show the account's email, masked for an AUDITOR; kept with the account
 *    (no purge), and exported with it (AccountExport.dropEntries);
 *  - a direct reservation of a release's early access (P-X02): an entry
 *    like the others, with the tier and seniority of the moment of the
 *    request and the end of the place held; the same retention and export;
 *  - the circle (P-X01, services/circle.ts): an answer to an invitation (the
 *    account, the post, YES or NO, its first and latest times; read by
 *    ORBES staff with the email, masked for an AUDITOR; audited
 *    `circle.rsvp`) and a vote in a poll (the account, the post, the
 *    option, the time; shown to members only as totals after their own
 *    vote; never in the audit log); both kept with the account and
 *    exported (AccountExport.circleAnswers, circleVotes); the visits counted
 *    per UTC day (circle_daily_visits), without any account; the tier
 *    computed from ownership at each request (services/club.ts tierOf), not
 *    stored but with an entry; the tiers' words (club_tiers, P-X04) are
 *    staff text, nothing personal;
 *  - the LIVE RELEASES (plan of 2026-10-04, services/live.ts): I'LL BE THERE
 *    (live_interest: the account, the release, the size, the time; deleted
 *    when withdrawn; the page shows a count); an entry (live_entries: the
 *    account, the size and quantity, the tier at entry and at T0, the place,
 *    the time of each step, `gesture_ms`, the add-ons with their price,
 *    the status and the reservation's outcome with Client Services' note);
 *    the country (two letters, ctx.geo) and `network_hash`, HMAC-SHA-256 of
 *    the /24 or /48 with IP_HASH_PEPPER (liveNetworkHash), erased
 *    LIVE_NETWORK_RETENTION_DAYS (30) days after the end by housekeeping;
 *    the console reads the emails, masked for an AUDITOR; the audit log
 *    names ids only: the account's `drop.live.*` actions (`.interest` and its
 *    withdrawal, `.enter`, `.size`, `.leave`, `.secure` with the gesture's
 *    length, `.addons`, `.confirm`, `.release`), the staff's on an entry
 *    (`.let_in`, `.free`, `.remove`, `.resolve`, never its note), the
 *    engine's `.queue` and `.end` as counts (no press, turn, missed turn or
 *    expired hold is audited); the
 *    room's stream and the boutique board carry counts, never a person; the
 *    export holds every entry, its add-ons and the interest, never the
 *    network's hash (AccountExport.liveEntries, liveInterest);
 *  - the private salon (P-X08, services/salon.ts): a request (the account,
 *    the model, the account's optional note of at most SHOP_NOTE_MAX = 500
 *    characters, OPEN or CLOSED, its times, and ORBES Client Services'
 *    closing note); read by staff with the email, masked for an AUDITOR;
 *    audited `shop.request` and `shop.request.close` with the model only,
 *    never a note; kept with the account (no purge), exported with it
 *    (AccountExport.shopRequests), and closed when the account is locked;
 *  - ORBES Care (P-M02): SUBSCRIBE, once CARE_SUBSCRIBE_URL is set, opens a
 *    third-party page (Whop) in a new tab, rel="noopener noreferrer": the
 *    service sends it neither the account nor the piece;
 *  - the orders (plan LIVE RELEASE+ of 2026-10-04, services/orders.ts,
 *    migration 0022): one per piece reserved (PAY, a draw's entry confirmed,
 *    a salon request ACCEPTED), its source, model, size, price, add-ons,
 *    surprise, engraving text, steps with their times and notes, carrier,
 *    tracking number, declared value, location and piece; the buyer's name
 *    and address entered by Client Services only (no customer route), kept
 *    on the order and its invoices, never in audit_logs, order_events nor
 *    event_journal (`orderPayload` says `buyer: true|false`), masked for an
 *    AUDITOR by the console's routes; the invoices (services/invoices.ts)
 *    issued by INVOICE_ISSUER (CONGLOMERAT LLC, the legal notice's identity)
 *    without VAT, with the buyer and the account's email as issued, never
 *    changed nor deleted (migration 0022's trigger), their journal entries
 *    without the buyer; a return (`returns`) with its outcome, note, staff
 *    and the ownership taken back; the journal kept for good, sent nowhere
 *    (no call to Shopify, TERMS-FACTS N10); the Shopify order CSV with the
 *    buyer and the email, masked for an AUDITOR (services/shopify.ts); TRACK
 *    THE SHIPMENT opening the carrier's page (https only); kept with the
 *    account and exported (AccountExport.orders, with their invoices);
 *  - the LIVE RELEASES+ (services/after-room.ts, question.ts,
 *    participation.ts, segments.ts, activity.ts, migration 0023): an
 *    after-room's guests (`after_room_guests`: the entry and its place,
 *    exported as `afterRoomPlace`); an answer to the question after
 *    (`release_answers`: the account, the release, the answer's position,
 *    its time; audited `drop.live.answer` with positions only; exported as
 *    AccountExport.releaseAnswers); the participation computed, never
 *    stored; the segments, rules evaluated live, their members never stored,
 *    their CSV masked for an AUDITOR, never named to the public; the client
 *    sheet (routes/admin/owners.ts), never the buyer nor an engraving; the
 *    hourly counts of sign-ins and scans by country and tier
 *    (`activity_hourly`: no account column), kept;
 *  - the sound signature (P-D07, shared/prefs.ts): the one preference the
 *    verify app keeps on the device, in local storage, under SOUND_PREF_KEY
 *    `orbes.sound`: "off", written only by SOUND OFF and removed by SOUND
 *    ON; no expiry, never sent to ORBES. The ceremony's share image (P-D01)
 *    is drawn on the device and sent nowhere by ORBES: nothing to declare;
 *  - the hosting: OVHcloud in Canada (COMPLIANCE §7, H2), Vercel Inc. for
 *    theorbes.com.
 *
 * Its scope is the verification service and the ORBES account: the other
 * pages of theorbes.com (index.html, outside this system) are not described.
 * Not validated by counsel: published before that review, by the owner's
 * decision (LAUNCH §10).
 */
import type { LegalDocument } from './types.js';

const EN: LegalDocument = {
  title: 'Privacy policy',
  summary: 'What the verification service records when you verify a piece or use your ORBES account, why, for how long, and your rights.',
  intro: [
    'This policy describes the personal data processed by the ORBES GENOME CODE service: the verification of ORBES pieces at theorbes.com/verify, served by verify.theorbes.com, and the ORBES account. It does not cover the other pages of theorbes.com.',
  ],
  sections: [
    {
      id: 'controller',
      title: 'Who is responsible',
      blocks: [
        'CONGLOMERAT LLC ("ORBES") is responsible for this processing. Its identity is given in the [legal notice](/legal/notice). For any question about your data, and to exercise your rights, write to ORBES Client Services.',
        { contact: true },
      ],
    },
    {
      id: 'verification',
      title: 'When you verify a piece',
      blocks: [
        'Verifying a piece needs no account. The image of the camera, or the photo you choose, is read in your browser, on your device: only the code read from it is sent to ORBES, never the image.',
        'For each verification, ORBES records:',
        [
          '- the code read, the piece it names, the result shown and the time;',
          '- a pseudonym of your IP address: a keyed hash (HMAC-SHA-256) made with a secret that only ORBES holds. The address itself is not stored;',
          '- the pseudonym of a random device identifier, kept in a cookie on your device (see [Cookies](#cookies));',
          "- an approximate location: the country, and coordinates rounded to about 10 km, found from the IP address at the time of the verification in a database installed on ORBES's server ([IP Geolocation by DB-IP](https://db-ip.com)). The address is sent to no one for this;",
          '- the family of your browser and system (for example Safari on iOS), without its version;',
          '- measurements of the reading, sent by the page: how long it took, how much correction the code needed, camera or photo;',
          '- if you are signed in to your ORBES account, that account, and a pseudonym of your session.',
        ].join('\n'),
        'ORBES uses them to answer the verification, to detect unusual activity on a code (the same code verified in many places within minutes, as copies of it would be), and to count verifications by day, country and result. These daily counts hold no pseudonym, no code, no piece and no account. An unusual activity concerns a code, not a person: ORBES staff review it, and nothing is revoked automatically. ORBES processes these data for its legitimate interest in protecting its pieces, and those who buy them, against copies of their codes.',
        "The web server's access log keeps only a shortened form of the IP address (its last part masked), for the security of the service; the service's own log holds no IP address.",
      ],
    },
    {
      id: 'answer',
      title: 'Your answer after a result',
      blocks: [
        'After a result other than AUTHENTIC, the page asks WHERE DID YOU SEE OR BUY THIS PIECE? Your answer is optional: a channel, a place and a note, attached to that verification. Only ORBES staff read it, to follow up. Please leave out names and contact details.',
      ],
    },
    {
      id: 'account',
      title: 'Your ORBES account',
      blocks: [
        'To register, transfer or follow your pieces, you create an ORBES account with an email address, a password and, if you wish, a name. ORBES does not check the address and sends no email. ORBES processes these data to provide the account you create, under the [terms of use](/legal/terms).',
        'Your password is stored only as a hash (scrypt): ORBES cannot read it.',
        'ORBES records what is done with your account: the pieces registered to it and since when, the transfers, the reports of loss or theft, the links to ownership certificates (of each link, only a fingerprint), and the recovery codes ORBES Client Services gives you (only as a hash).',
        'Each sign-in opens a session of 30 days at most. It is kept with a pseudonym of your IP address and the identification string of your browser (its user agent), for the security of your account.',
        "The service's audit log, which records every change, names your account by its identifier and a pseudonym of the IP address, never by your email address or your name.",
        'In MY PIECES, SUBSCRIBE of ORBES Care, once ORBES publishes it, opens a third-party page (Whop) in a new tab. That page collects its own data under its own policy; the service sends it neither your account nor your piece.',
      ],
    },
    {
      id: 'releases',
      title: 'Your entries in releases',
      blocks: [
        'When you enter a release with your ORBES account, ORBES records your entry: the account, the release, the time, and what becomes of the entry (entered, withdrawn, place held, waiting list, sale concluded, place lapsed), with the note ORBES Client Services may add when it records the sale concluded or the place lapsed. A sale concluded becomes an order (see [Your orders](#orders)). ORBES processes these data to run the release you enter, under the [terms of use](/legal/terms).',
        'At the draw, ORBES records with each entry the tier and the seniority of its account, read from the pieces registered to it, and its rank. The page of the release then publishes, for each entry, its identifier, its tier, its seniority and its rank, so that anyone can check the order of the draw: never the account, its email address or its name. MY PIECES shows you the identifier of your entry.',
        'ORBES Client Services reads the entries of a release with the email address of their account, to conclude each sale with the accounts selected; a staff member with read-only access sees it masked. The service sends no email.',
        'During the early access of a release, a PLATINE or PALLADIUM account may reserve a place directly. ORBES then records an entry, as for the draw: the account, the release, the time, the tier and seniority of the account at the moment of the request, and until when the place is held. It is kept like the other entries, and is in the copy of your data.',
        "The number of releases you have taken part in, which THE RELEASES' PAST tab shows you with the releases in which you secured a piece, and which a LIVE RELEASE may require, is computed from your entries in the releases and the LIVE RELEASES each time it is needed: it is not stored.",
      ],
    },
    {
      id: 'circle',
      title: 'Your answers and votes in the circle',
      blocks: [
        "The owners' circle is read signed in to your ORBES account, by the owners of a piece. A post may be shown only to the members of a segment (see [Segments, the client sheet and activity](#segments)). ORBES processes the data below to run the circle you take part in, under the [terms of use](/legal/terms).",
        "When you answer an invitation, ORBES records your answer: the account, the post, YES or NO, and the times of your first answer and of its latest change. ORBES staff read the answers to an invitation with the email address of their account, to welcome the guests; a staff member with read-only access sees it masked. Your answer is also written to the service's audit log, which names your account by its identifier only.",
        'When you vote in a poll, ORBES records your vote: the account, the post, the option chosen and the time. Members see the results only as totals by option, after their own vote. A vote is never written to the audit log.',
        'The visits of the circle are counted per day, as a number only: without any account, address or device.',
        'Your tier (TITANE, PLATINE or PALLADIUM) is computed at each request from the pieces registered to your account. It is not stored, except with an entry in a release or a LIVE RELEASE (above and below).',
      ],
    },
    {
      id: 'live',
      title: 'Your LIVE RELEASES',
      blocks: [
        'A LIVE RELEASE is entered signed in to your ORBES account. ORBES processes the data below to run the release you enter, under the [terms of use](/legal/terms), and, for the fingerprint of your network and the length of your hold, for its legitimate interest in keeping each release fair against automated entries.',
        "When you say I'LL BE THERE, ORBES records the account, the release, the size and the time. Withdrawing it deletes it. The page of the release shows only how many accounts said so.",
        'When you enter, ORBES records your entry: the account, the release, the size and the quantity, your tier when you enter and at the opening, your place in the line, the time of each step (entering, the line, your turn, the start of your press, the piece secured, its confirmation, the end), the length of your hold on the ORBES CODE of the room, in milliseconds, the options you choose with their price, and what becomes of the entry. A reservation you confirm with PAY becomes an order, with the steps and the notes ORBES Client Services records on it (see [Your orders](#orders)).',
        "When a release sells out and an after-room follows it, ORBES records the accounts still waiting in its line at that moment, each with its place in the after-room's line: they alone are its guests, and may see it. An entry in the after-room is recorded like any other entry.",
        "Once a release has ended, if ORBES asks you its question after, it records your answer: the account, the release, the answer you chose and when; changing it replaces it. Your answer is written to the service's audit log as the position of the answer only. ORBES staff read the answers of a release as counts, and those of a collector on their client sheet (see [Segments, the client sheet and activity](#segments)).",
        'From your connection when you enter, ORBES records its country, found from the IP address in the location database installed on its server, and a keyed fingerprint of your network (HMAC-SHA-256 of the first three parts of an IPv4 address, or of the first three groups of an IPv6 one, made with a secret only ORBES holds), never the address itself. The fingerprint lets ORBES see many entries coming from one network; it is erased 30 days after the end of the release.',
        "ORBES staff read the entries of a release with the email address of their account, to follow the release and to conclude each reservation; a staff member with read-only access sees it masked. The console computes from them counts by tier and by country, and lists the accounts that came without securing a piece. Your actions in a release (I'LL BE THERE and its withdrawal, entering, changing size, leaving, securing the piece with the length of your hold, the options, PAY, giving the piece back) and those of ORBES staff on your entry (letting you in, freeing your piece, removing your entry, concluding or cancelling your reservation, never its note) are written to the service's audit log, which names your account and your entry by their identifiers only. The line formed at the opening and the end of a release are written there as counts only.",
        'In the room, the other accounts see only counts: the people in the room, the length of the line, the pieces left. Your own entry, and the secret of your turn, reach your own screen only. A screen in a boutique may show the countdown and the pieces left of a release, never a person.',
        "Your entries, their options, your places in an after-room, your answers to the questions after and your I'LL BE THERE are kept as long as the account exists, and are in the copy of your data (see [Your rights](#rights)), the fingerprint of your network excepted.",
      ],
    },
    {
      id: 'orders',
      title: 'Your orders',
      blocks: [
        'When a piece is reserved for you (PAY in a LIVE RELEASE, a place of a release whose sale ORBES Client Services confirms, a request of the private salon it accepts), ORBES records an order: the account, where it comes from, the model, the size, the price and its currency, the options as sold, the surprise of the release, the engraving text, each step (reserved, paid, shipped, delivered, cancelled, returned) with its time and the note ORBES Client Services may add, the carrier, the tracking number and the value declared for its insurance, where the piece is kept and the piece that fulfils it. ORBES processes these data to carry out the order, under the [terms of use](/legal/terms).',
        "ORBES Client Services enters the name and the address of the buyer on the order, to deliver and invoice it: the service has no form for them. They are kept on the order and its invoices only, never in the service's audit log, the order's history or the journal of changes below; a staff member with read-only access sees them masked, as the email address. The engraving text is kept the same way, on the order and on the piece made for it.",
        'When an order is paid, CONGLOMERAT LLC issues its invoice: its number, the issuer, the buyer (the name and the address entered on the order, and the email address of your account), the lines (the piece, its size and where it was sold, each option), the amounts and the currency, without VAT. A paid order cancelled or returned receives a credit note, which repeats them. Invoices and credit notes are never changed nor deleted: ORBES keeps them for its accounts, and its staff read them in the console, with a table of each month for the accountant.',
        'A return records where the piece went (back to stock or to the archive), the note of ORBES Client Services, who recorded it and when, and, when the piece was registered to an account, the registration ORBES took back.',
        'Each change of an order, of the stock, of a piece or of an invoice is also written to a journal of changes, which the service keeps for its future connections (an online store, an accounting tool): it names the order and the account by their identifiers, says whether a buyer and an engraving were entered, never what they are, and leaves out the buyer of an invoice. No such connection exists: the service sends these data to no one.',
        "ORBES staff may download the orders of a period as a file in the format of Shopify, an online store ORBES may open, with the buyer's name and address and the email address of the account, by which such a store would recognise its customers; a staff member with read-only access downloads them masked. The service itself sends nothing to Shopify.",
        "In MY PIECES, TRACK THE SHIPMENT opens the carrier's own page in a new tab, with the tracking number in its address. That page collects its own data under its own policy; the service sends it nothing else.",
        "Your orders are kept as long as the account exists, with the buyer's details; invoices and credit notes are never deleted. Your orders, with the buyer's details, their steps and their invoices, are in the copy of your data (see [Your rights](#rights)).",
      ],
    },
    {
      id: 'salon',
      title: 'Your requests in the private salon',
      blocks: [
        'In the private salon, the owner of a piece may request a model ORBES reserves for the owners. ORBES then records the request: the account, the model requested, the note you may write (at most 500 characters), whether it is open or closed, when it was made and when it was closed, whether it was accepted or declined, and the note ORBES Client Services writes when it closes it. A request accepted becomes an order (see [Your orders](#orders)). ORBES processes these data to answer the request you make, under the [terms of use](/legal/terms).',
        "ORBES Client Services reads the requests with the email address of their account, to contact you and conclude the sale, outside the service; a staff member with read-only access sees it masked. The service sends no email and takes no payment. Neither your note nor that of ORBES Client Services is written to the service's audit log, which records a request with the model, its outcome and your account's identifier only.",
        'A request is kept with your account, open or closed, and is in the copy of your data. When ORBES Client Services locks an account, its open requests are closed.',
      ],
    },
    {
      id: 'segments',
      title: 'Segments, the client sheet and activity',
      blocks: [
        "ORBES staff may group collectors in segments, from what the service already records: the releases taken part in and the pieces secured; the tier and the models and collections of the pieces held; the sizes (of the pieces held, chosen in a LIVE RELEASE or ordered) and the country (the one the account gave, or the one its latest entry in a LIVE RELEASE came from); I'LL BE THERE, the answers to the questions after, and the last activity (a sign-in, a session in use, a scan). A segment is a rule: its members are computed each time it is used, from the accounts as they are then, and are never stored with an account.",
        'A segment may decide who may enter a LIVE RELEASE, whose page then says FOR SELECTED COLLECTORS and never names the segment, and who reads a post of the circle. ORBES staff may also download the members of a segment as a list with their email addresses, masked for a staff member with read-only access. ORBES processes these data for its legitimate interest in offering its releases and its circle to the collectors they suit; a segment sends no message, and the service sends no email.',
        "ORBES Client Services reads, on the sheet of a collector in the console, its orders and their steps, the releases it took part in and the pieces it secured there, its answers to the questions after, its I'LL BE THERE, its tier, the segments it belongs to at that moment, and the notes ORBES Client Services wrote on its orders, entries and requests; a staff member with read-only access sees its email address masked. The sheet never shows the buyer's details nor the words of an engraving.",
        'To choose the hour a release opens, the service counts, for each hour, the sign-ins and the scans by country and tier: the country an account gave or the one a scan came from, and the tier its account holds when the hour is counted. These counts name no account, no address and no device, and are kept as counts.',
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies',
      blocks: [
        'The verification service sets only the cookies below, its own. It sets no advertising or audience-measurement cookie and loads no script from another site.',
        [
          '- **__Host-orbes_device**: a random identifier, set at your first verification and kept 2 years. ORBES stores only its pseudonym, to count distinct devices in the detection of unusual activity.',
          '- **__Host-orbes_session**: your session once you sign in to your ORBES account, 30 days at most; it ends when you sign out.',
          '- **__Host-orbes_admin**: the session of ORBES staff in the ORBES console.',
        ].join('\n'),
        "The verification app also keeps one preference on your device, in your browser's local storage, under the key **orbes.sound**: the value off, written only when you press SOUND OFF at the foot of the app's first page; pressing SOUND ON again removes it. It has no expiry, is never sent to ORBES, and is cleared with the site's data in your browser.",
      ],
    },
    {
      id: 'recipients',
      title: 'Who sees your data',
      blocks: [
        [
          '- ORBES staff, each within their role in the ORBES console; a staff member with read-only access sees your email address masked.',
          '- OVHcloud, which hosts the verification service and its database on a server located in Canada.',
          '- Vercel Inc., a company based in the United States, which hosts the theorbes.com website.',
        ].join('\n'),
        'DB-IP supplies the location database, which ORBES installs on its own server: nothing is sent to DB-IP. ORBES sells no data and shares none for advertising.',
      ],
    },
    {
      id: 'location',
      title: 'Where your data is processed',
      blocks: ["Your data is stored and processed on ORBES's server in Canada, outside the European Union."],
    },
    {
      id: 'retention',
      title: 'How long it is kept',
      blocks: [
        [
          '- **Verifications**: kept 90 days. Older verifications are deleted with everything attached to them, your answer included, and only the daily counts remain.',
          '- **Sessions**: deleted when they end, at sign-out or 30 days after sign-in at most.',
          '- **Your account and what it records**: as long as the account exists. The service does not yet let you delete your account: ask ORBES Client Services.',
          '- **Entries and reservations in releases**: as long as the account exists. What the draw publishes (the identifier, tier, seniority and rank of each entry) stays on the page of the release.',
          "- **Entries, options, places in an after-room, answers to the questions after and I'LL BE THERE in the LIVE RELEASES**: as long as the account exists; the fingerprint of the network, 30 days after the end of the release.",
          "- **Orders**, with the buyer's name and address and the engraving text: as long as the account exists. **Invoices and credit notes**: never deleted.",
          '- **The journal of changes** of the orders, the stock, the pieces and the invoices: permanent; it names accounts by their identifier only.',
          '- **Segments**: their rules, as long as ORBES keeps them; no member is stored. **The hourly counts** of sign-ins and scans: kept, naming no one.',
          "- **Answers to the circle's invitations and votes in its polls**: as long as the account exists. The daily count of the circle's visits names no one, and is kept.",
          '- **Requests in the private salon**, with their notes: as long as the account exists, open or closed.',
          '- **Findings of unusual activity**, which ORBES staff review: kept with the piece they concern.',
          '- **The audit log**: permanent; it names accounts by their identifier only.',
          '- **The device cookie**: 2 years on your device.',
          '- **Backups** of the database, encrypted: about two months.',
        ].join('\n'),
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      blocks: [
        'Under the General Data Protection Regulation (GDPR), you may ask for access to your data, its rectification or erasure, the restriction of its processing, and object to it. Ask ORBES Client Services: once they have checked that you hold the account, they can give you a copy of everything the ORBES registry holds about it. The service has no tool yet to delete an account: ORBES Client Services takes the request.',
        'You may also lodge a complaint with the CNIL ([cnil.fr](https://www.cnil.fr)), the French data protection authority.',
      ],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [
        'The service is reached over HTTPS only. Passwords, claim codes and recovery codes are stored only as hashes; IP addresses and device identifiers only as pseudonyms.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: ['ORBES may change this policy. The version in force and its date are shown at the top of this page.'],
    },
  ],
};

const FR: LegalDocument = {
  title: 'Politique de confidentialité',
  summary: 'Ce que le service de vérification enregistre quand vous vérifiez une pièce ou utilisez votre compte ORBES, pourquoi, combien de temps, et vos droits.',
  intro: [
    "Cette politique décrit les données personnelles traitées par le service ORBES GENOME CODE : la vérification des pièces ORBES à l'adresse theorbes.com/verify, servie par verify.theorbes.com, et le compte ORBES. Elle ne couvre pas les autres pages de theorbes.com.",
  ],
  sections: [
    {
      id: 'controller',
      title: 'Responsable du traitement',
      blocks: [
        'CONGLOMERAT LLC (« ORBES ») est responsable de ce traitement. Son identité figure dans les [mentions légales](/legal/notice). Pour toute question sur vos données, et pour exercer vos droits, écrivez à ORBES Client Services.',
        { contact: true },
      ],
    },
    {
      id: 'verification',
      title: 'Quand vous vérifiez une pièce',
      blocks: [
        "Vérifier une pièce ne demande pas de compte. L'image de la caméra, ou la photo que vous choisissez, est lue dans votre navigateur, sur votre appareil : seul le code qui en est lu est envoyé à ORBES, jamais l'image.",
        'Pour chaque vérification, ORBES enregistre :',
        [
          "- le code lu, la pièce qu'il désigne, le résultat affiché et l'heure ;",
          "- un pseudonyme de votre adresse IP : une empreinte à clé (HMAC-SHA-256) calculée avec un secret que seul ORBES détient. L'adresse elle-même n'est pas conservée ;",
          "- le pseudonyme d'un identifiant d'appareil aléatoire, gardé dans un cookie sur votre appareil (voir [Cookies](#cookies)) ;",
          "- une localisation approximative : le pays, et des coordonnées arrondies à 10 km environ, déduits de l'adresse IP au moment de la vérification dans une base installée sur le serveur d'ORBES ([IP Geolocation by DB-IP](https://db-ip.com)). L'adresse n'est transmise à personne pour cela ;",
          '- la famille de votre navigateur et de votre système (par exemple Safari sur iOS), sans sa version ;',
          '- des mesures de la lecture, envoyées par la page : sa durée, la part de correction dont le code a eu besoin, caméra ou photo ;',
          '- si vous êtes connecté à votre compte ORBES, ce compte, et un pseudonyme de votre session.',
        ].join('\n'),
        "ORBES s'en sert pour répondre à la vérification, pour détecter une activité inhabituelle sur un code (le même code vérifié en de nombreux lieux en quelques minutes, comme le seraient ses copies), et pour compter les vérifications par jour, pays et résultat. Ces comptes quotidiens ne contiennent ni pseudonyme, ni code, ni pièce, ni compte. Une activité inhabituelle concerne un code, pas une personne : le personnel d'ORBES l'examine, et rien n'est révoqué automatiquement. ORBES traite ces données pour son intérêt légitime à protéger ses pièces, et ceux qui les achètent, contre les copies de leurs codes.",
        "Le journal d'accès du serveur web ne garde qu'une forme raccourcie de l'adresse IP (sa dernière partie masquée), pour la sécurité du service ; le journal du service lui-même ne contient aucune adresse IP.",
      ],
    },
    {
      id: 'answer',
      title: 'Votre réponse après un résultat',
      blocks: [
        "Après un résultat autre qu'AUTHENTIC, la page demande WHERE DID YOU SEE OR BUY THIS PIECE? (où avez-vous vu ou acheté cette pièce ?). Votre réponse est facultative : un canal, un lieu et une note, rattachés à cette vérification. Seul le personnel d'ORBES la lit, pour y donner suite. Merci de ne pas y mettre de nom ni de coordonnées.",
      ],
    },
    {
      id: 'account',
      title: 'Votre compte ORBES',
      blocks: [
        "Pour enregistrer, transférer ou suivre vos pièces, vous créez un compte ORBES avec une adresse e-mail, un mot de passe et, si vous le souhaitez, un nom. ORBES ne vérifie pas l'adresse et n'envoie aucun e-mail. ORBES traite ces données pour fournir le compte que vous créez, selon les [conditions générales d'utilisation](/legal/terms).",
        "Votre mot de passe n'est conservé que sous forme d'empreinte (scrypt) : ORBES ne peut pas le lire.",
        "ORBES enregistre ce qui est fait avec votre compte : les pièces qui y sont enregistrées et depuis quand, les transferts, les déclarations de perte ou de vol, les liens vers des certificats de propriété (de chaque lien, une empreinte seulement), et les codes de récupération que vous remet ORBES Client Services (sous forme d'empreinte seulement).",
        "Chaque connexion ouvre une session de 30 jours au plus. Elle est gardée avec un pseudonyme de votre adresse IP et la chaîne d'identification de votre navigateur (son user agent), pour la sécurité de votre compte.",
        "Le journal d'audit du service, qui enregistre chaque modification, désigne votre compte par son identifiant et un pseudonyme de l'adresse IP, jamais par votre adresse e-mail ni par votre nom.",
        "Dans MY PIECES, SUBSCRIBE d'ORBES Care, une fois qu'ORBES le publie, ouvre une page tierce (Whop) dans un nouvel onglet. Cette page collecte ses propres données selon sa propre politique ; le service ne lui transmet ni votre compte ni votre pièce.",
      ],
    },
    {
      id: 'releases',
      title: 'Vos inscriptions aux sorties',
      blocks: [
        "Quand vous vous inscrivez à une sortie avec votre compte ORBES, ORBES enregistre votre inscription : le compte, la sortie, l'heure, et ce que devient l'inscription (inscrite, retirée, place réservée, liste d'attente, vente conclue, place expirée), avec la note qu'ORBES Client Services peut y ajouter quand il enregistre la vente conclue ou la place expirée. Une vente conclue devient une commande (voir [Vos commandes](#orders)). ORBES traite ces données pour organiser la sortie à laquelle vous vous inscrivez, selon les [conditions générales d'utilisation](/legal/terms).",
        "Au tirage, ORBES enregistre avec chaque inscription le palier et l'ancienneté de son compte, lus sur les pièces qui y sont enregistrées, et son rang. La page de la sortie publie alors, pour chaque inscription, son identifiant, son palier, son ancienneté et son rang, pour que chacun puisse vérifier l'ordre du tirage : jamais le compte, son adresse e-mail ni son nom. MY PIECES vous montre l'identifiant de votre inscription.",
        "ORBES Client Services lit les inscriptions d'une sortie avec l'adresse e-mail de leur compte, pour conclure chaque vente avec les comptes sélectionnés ; un membre du personnel en lecture seule la voit masquée. Le service n'envoie aucun e-mail.",
        "Pendant l'accès anticipé d'une sortie, un compte PLATINE ou PALLADIUM peut réserver directement une place. ORBES enregistre alors une inscription, comme pour le tirage : le compte, la sortie, l'heure, le palier et l'ancienneté du compte au moment de la demande, et l'heure jusqu'à laquelle la place est tenue. Elle est conservée comme les autres inscriptions, et figure dans la copie de vos données.",
        "Le nombre de sorties auxquelles vous avez pris part, que vous montre l'onglet PAST de THE RELEASES avec les sorties où vous avez obtenu une pièce, et qu'une LIVE RELEASE peut exiger, est calculé à partir de vos inscriptions aux sorties et de vos entrées aux LIVE RELEASES chaque fois qu'il en est besoin : il n'est pas conservé.",
      ],
    },
    {
      id: 'circle',
      title: 'Vos réponses et vos votes dans le cercle',
      blocks: [
        "Le cercle des propriétaires se lit connecté à votre compte ORBES, par les propriétaires d'une pièce. Une publication peut n'être montrée qu'aux membres d'un segment (voir [Segments, fiche client et activité](#segments)). ORBES traite les données ci-dessous pour faire vivre le cercle auquel vous participez, selon les [conditions générales d'utilisation](/legal/terms).",
        "Quand vous répondez à une invitation, ORBES enregistre votre réponse : le compte, la publication, YES ou NO, et les heures de votre première réponse et de sa dernière modification. Le personnel d'ORBES lit les réponses à une invitation avec l'adresse e-mail de leur compte, pour accueillir les invités ; un membre du personnel en lecture seule la voit masquée. Votre réponse est aussi inscrite au journal d'audit du service, qui ne désigne votre compte que par son identifiant.",
        "Quand vous votez à un sondage, ORBES enregistre votre vote : le compte, la publication, l'option choisie et l'heure. Les membres ne voient les résultats qu'en totaux par option, après leur propre vote. Un vote n'est jamais inscrit au journal d'audit.",
        'Les visites du cercle sont comptées par jour, comme un simple nombre : sans aucun compte, adresse ni appareil.',
        "Votre palier (TITANE, PLATINE ou PALLADIUM) est calculé à chaque requête à partir des pièces enregistrées à votre compte. Il n'est pas conservé, sauf avec une inscription à une sortie ou une entrée à une LIVE RELEASE (ci-dessus et ci-dessous).",
      ],
    },
    {
      id: 'live',
      title: 'Vos LIVE RELEASES',
      blocks: [
        "On entre dans une LIVE RELEASE connecté à son compte ORBES. ORBES traite les données ci-dessous pour faire vivre la sortie dans laquelle vous entrez, selon les [conditions générales d'utilisation](/legal/terms), et, pour l'empreinte de votre réseau et la durée de votre appui, pour son intérêt légitime à garder chaque sortie équitable face aux entrées automatisées.",
        "Quand vous dites I'LL BE THERE, ORBES enregistre le compte, la sortie, la taille et l'heure. Le retirer le supprime. La page de la sortie n'affiche que le nombre de comptes qui l'ont dit.",
        "Quand vous entrez, ORBES enregistre votre entrée : le compte, la sortie, la taille et la quantité, votre palier à l'entrée et à l'ouverture, votre place dans la file, l'heure de chaque étape (l'entrée, la file, votre tour, le début de votre appui, la pièce sécurisée, sa confirmation, la fin), la durée de votre appui sur l'ORBES CODE de la salle, en millisecondes, les options que vous choisissez avec leur prix, et ce que devient l'entrée. Une réservation que vous confirmez avec PAY devient une commande, avec les étapes et les notes qu'ORBES Client Services y enregistre (voir [Vos commandes](#orders)).",
        "Quand une sortie est épuisée et qu'une salle d'après la suit, ORBES enregistre les comptes qui attendaient encore dans sa file à cet instant, chacun avec sa place dans la file de la salle d'après : eux seuls en sont les invités, et peuvent la voir. Une entrée dans la salle d'après s'enregistre comme toute autre entrée.",
        "Une fois une sortie terminée, si ORBES vous pose sa question d'après, il enregistre votre réponse : le compte, la sortie, la réponse choisie et l'heure ; la changer la remplace. Votre réponse est inscrite au journal d'audit du service sous la seule position de la réponse. Le personnel d'ORBES lit les réponses d'une sortie en nombres, et celles d'un collectionneur sur sa fiche client (voir [Segments, fiche client et activité](#segments)).",
        "De votre connexion au moment où vous entrez, ORBES enregistre son pays, déduit de l'adresse IP dans la base de localisation installée sur son serveur, et une empreinte à clé de votre réseau (HMAC-SHA-256 des trois premières parties d'une adresse IPv4, ou des trois premiers groupes d'une adresse IPv6, calculée avec un secret que seul ORBES détient), jamais l'adresse elle-même. L'empreinte permet à ORBES de voir de nombreuses entrées venues d'un même réseau ; elle est effacée 30 jours après la fin de la sortie.",
        "Le personnel d'ORBES lit les entrées d'une sortie avec l'adresse e-mail de leur compte, pour suivre la sortie et conclure chaque réservation ; un membre du personnel en lecture seule la voit masquée. La console en tire des comptes par palier et par pays, et la liste des comptes venus sans sécuriser de pièce. Vos gestes dans une sortie (I'LL BE THERE et son retrait, l'entrée, le changement de taille, le départ, la pièce sécurisée avec la durée de votre appui, les options, PAY, la pièce rendue) et ceux du personnel d'ORBES sur votre entrée (vous faire entrer, libérer votre pièce, retirer votre entrée, conclure ou annuler votre réservation, jamais sa note) sont inscrits au journal d'audit du service, qui ne désigne votre compte et votre entrée que par leurs identifiants. La file formée à l'ouverture et la fin d'une sortie n'y sont inscrites qu'en nombres.",
        "Dans la salle, les autres comptes ne voient que des nombres : les personnes dans la salle, la longueur de la file, les pièces restantes. Votre propre entrée, et le secret de votre tour, n'arrivent que sur votre écran. Un écran en boutique peut montrer le compte à rebours et les pièces restantes d'une sortie, jamais une personne.",
        "Vos entrées, leurs options, vos places dans une salle d'après, vos réponses aux questions d'après et votre I'LL BE THERE sont conservés tant que le compte existe, et figurent dans la copie de vos données (voir [Vos droits](#rights)), l'empreinte de votre réseau exceptée.",
      ],
    },
    {
      id: 'orders',
      title: 'Vos commandes',
      blocks: [
        "Quand une pièce vous est réservée (PAY dans une LIVE RELEASE, une place d'une sortie dont ORBES Client Services confirme la vente, une demande du salon privé qu'il accepte), ORBES enregistre une commande : le compte, sa provenance, le modèle, la taille, le prix et sa devise, les options telles que vendues, la surprise de la sortie, le texte de la gravure, chaque étape (réservée, payée, expédiée, livrée, annulée, retournée) avec son heure et la note qu'ORBES Client Services peut y ajouter, le transporteur, le numéro de suivi et la valeur déclarée pour son assurance, le lieu où la pièce est gardée et la pièce qui lui est attribuée. ORBES traite ces données pour exécuter la commande, selon les [conditions générales d'utilisation](/legal/terms).",
        "ORBES Client Services saisit le nom et l'adresse de l'acheteur sur la commande, pour la livrer et la facturer : le service n'a pas de formulaire pour cela. Ils ne sont gardés que sur la commande et ses factures, jamais dans le journal d'audit du service, l'historique de la commande ni le journal des changements ci-dessous ; un membre du personnel en lecture seule les voit masqués, comme l'adresse e-mail. Le texte de la gravure est gardé de la même façon, sur la commande et sur la pièce fabriquée pour elle.",
        "Quand une commande est payée, CONGLOMERAT LLC émet sa facture : son numéro, l'émetteur, l'acheteur (le nom et l'adresse saisis sur la commande, et l'adresse e-mail de votre compte), les lignes (la pièce, sa taille et où elle a été vendue, chaque option), les montants et la devise, sans TVA. Une commande payée puis annulée ou retournée reçoit un avoir, qui les reprend. Factures et avoirs ne sont jamais modifiés ni supprimés : ORBES les garde pour sa comptabilité, et son personnel les lit dans la console, avec un tableau de chaque mois pour le comptable.",
        "Un retour enregistre où la pièce est allée (en stock ou aux archives), la note d'ORBES Client Services, qui l'a enregistré et quand, et, quand la pièce était enregistrée à un compte, l'enregistrement qu'ORBES a repris.",
        "Chaque changement d'une commande, du stock, d'une pièce ou d'une facture est aussi inscrit à un journal des changements, que le service garde pour ses connexions futures (une boutique en ligne, un outil comptable) : il désigne la commande et le compte par leurs identifiants, dit si un acheteur et une gravure ont été saisis, jamais ce qu'ils sont, et laisse de côté l'acheteur d'une facture. Aucune connexion de ce genre n'existe : le service ne transmet ces données à personne.",
        "Le personnel d'ORBES peut télécharger les commandes d'une période sous forme de fichier au format de Shopify, une boutique en ligne qu'ORBES pourrait ouvrir, avec le nom et l'adresse de l'acheteur et l'adresse e-mail du compte, par laquelle une telle boutique reconnaîtrait ses clients ; un membre du personnel en lecture seule les télécharge masqués. Le service lui-même n'envoie rien à Shopify.",
        "Dans MY PIECES, TRACK THE SHIPMENT ouvre la page du transporteur dans un nouvel onglet, avec le numéro de suivi dans son adresse. Cette page collecte ses propres données selon sa propre politique ; le service ne lui transmet rien d'autre.",
        "Vos commandes sont conservées tant que le compte existe, avec les données de l'acheteur ; les factures et les avoirs ne sont jamais supprimés. Vos commandes, avec les données de l'acheteur, leurs étapes et leurs factures, figurent dans la copie de vos données (voir [Vos droits](#rights)).",
      ],
    },
    {
      id: 'salon',
      title: 'Vos demandes au salon privé',
      blocks: [
        "Dans le salon privé, le propriétaire d'une pièce peut demander un modèle qu'ORBES réserve aux propriétaires. ORBES enregistre alors la demande : le compte, le modèle demandé, la note que vous pouvez écrire (500 caractères au plus), si elle est ouverte ou close, quand elle a été faite et quand elle a été close, si elle a été acceptée ou refusée, et la note qu'ORBES Client Services écrit en la clôturant. Une demande acceptée devient une commande (voir [Vos commandes](#orders)). ORBES traite ces données pour répondre à la demande que vous faites, selon les [conditions générales d'utilisation](/legal/terms).",
        "ORBES Client Services lit les demandes avec l'adresse e-mail de leur compte, pour vous contacter et conclure la vente, hors du service ; un membre du personnel en lecture seule la voit masquée. Le service n'envoie aucun e-mail et n'encaisse aucun paiement. Ni votre note ni celle d'ORBES Client Services ne sont inscrites au journal d'audit du service, qui n'enregistre d'une demande que le modèle, son issue et l'identifiant de votre compte.",
        "Une demande est conservée avec votre compte, ouverte ou close, et figure dans la copie de vos données. Quand ORBES Client Services verrouille un compte, ses demandes ouvertes sont closes.",
      ],
    },
    {
      id: 'segments',
      title: 'Segments, fiche client et activité',
      blocks: [
        "Le personnel d'ORBES peut regrouper des collectionneurs en segments, à partir de ce que le service enregistre déjà : les sorties auxquelles ils ont pris part et les pièces obtenues ; le palier et les modèles et collections des pièces détenues ; les tailles (des pièces détenues, choisies dans une LIVE RELEASE ou commandées) et le pays (celui que le compte a donné, ou celui d'où venait sa dernière entrée à une LIVE RELEASE) ; I'LL BE THERE, les réponses aux questions d'après, et la dernière activité (une connexion, une session en cours, un scan). Un segment est une règle : ses membres sont calculés à chaque usage, à partir des comptes tels qu'ils sont alors, et ne sont jamais conservés avec un compte.",
        "Un segment peut décider qui peut entrer dans une LIVE RELEASE, dont la page dit alors FOR SELECTED COLLECTORS sans jamais nommer le segment, et qui lit une publication du cercle. Le personnel d'ORBES peut aussi télécharger les membres d'un segment en une liste avec leurs adresses e-mail, masquées pour un membre du personnel en lecture seule. ORBES traite ces données pour son intérêt légitime à proposer ses sorties et son cercle aux collectionneurs à qui ils conviennent ; un segment n'envoie aucun message, et le service n'envoie aucun e-mail.",
        "ORBES Client Services lit, sur la fiche d'un collectionneur dans la console, ses commandes et leurs étapes, les sorties auxquelles il a pris part et les pièces qu'il y a obtenues, ses réponses aux questions d'après, ses I'LL BE THERE, son palier, les segments dont il est membre à ce moment, et les notes qu'ORBES Client Services a écrites sur ses commandes, ses entrées et ses demandes ; un membre du personnel en lecture seule voit son adresse e-mail masquée. La fiche ne montre jamais les données de l'acheteur ni les mots d'une gravure.",
        "Pour choisir l'heure d'ouverture d'une sortie, le service compte, pour chaque heure, les connexions et les scans par pays et par palier : le pays qu'un compte a donné ou celui d'où venait un scan, et le palier de son compte au moment où l'heure est comptée. Ces nombres ne désignent aucun compte, aucune adresse ni aucun appareil, et sont conservés comme tels.",
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies',
      blocks: [
        "Le service de vérification ne dépose que les cookies ci-dessous, les siens. Il ne dépose aucun cookie publicitaire ni de mesure d'audience et ne charge aucun script d'un autre site.",
        [
          "- **__Host-orbes_device** : un identifiant aléatoire, déposé à votre première vérification et gardé 2 ans. ORBES n'en conserve que le pseudonyme, pour compter les appareils distincts dans la détection d'une activité inhabituelle.",
          '- **__Host-orbes_session** : votre session une fois connecté à votre compte ORBES, 30 jours au plus ; elle prend fin quand vous vous déconnectez.',
          "- **__Host-orbes_admin** : la session du personnel d'ORBES dans la console ORBES.",
        ].join('\n'),
        "L'application de vérification garde aussi une préférence sur votre appareil, dans le stockage local de votre navigateur, sous la clé **orbes.sound** : la valeur off, écrite seulement quand vous appuyez sur SOUND OFF au pied de la première page de l'application ; appuyer de nouveau sur SOUND ON l'efface. Elle n'expire pas, n'est jamais envoyée à ORBES, et s'efface avec les données du site dans votre navigateur.",
      ],
    },
    {
      id: 'recipients',
      title: 'Qui voit vos données',
      blocks: [
        [
          "- Le personnel d'ORBES, chacun selon son rôle dans la console ORBES ; un membre du personnel en lecture seule voit votre adresse e-mail masquée.",
          '- OVHcloud, qui héberge le service de vérification et sa base de données sur un serveur situé au Canada.',
          '- Vercel Inc., société établie aux États-Unis, qui héberge le site theorbes.com.',
        ].join('\n'),
        "DB-IP fournit la base de localisation, qu'ORBES installe sur son propre serveur : rien n'est envoyé à DB-IP. ORBES ne vend aucune donnée et n'en partage aucune à des fins publicitaires.",
      ],
    },
    {
      id: 'location',
      title: 'Où vos données sont traitées',
      blocks: ["Vos données sont conservées et traitées sur le serveur d'ORBES au Canada, hors de l'Union européenne."],
    },
    {
      id: 'retention',
      title: 'Durée de conservation',
      blocks: [
        [
          "- **Vérifications** : conservées 90 jours. Les vérifications plus anciennes sont supprimées avec tout ce qui s'y rattache, votre réponse comprise, et seuls les comptes quotidiens restent.",
          '- **Sessions** : supprimées à leur fin, à la déconnexion ou 30 jours au plus après la connexion.',
          "- **Votre compte et ce qu'il enregistre** : tant que le compte existe. Le service ne permet pas encore de supprimer votre compte : adressez-vous à ORBES Client Services.",
          "- **Inscriptions et réservations aux sorties** : tant que le compte existe. Ce que publie le tirage (l'identifiant, le palier, l'ancienneté et le rang de chaque inscription) reste sur la page de la sortie.",
          "- **Entrées, options, places dans une salle d'après, réponses aux questions d'après et I'LL BE THERE des LIVE RELEASES** : tant que le compte existe ; l'empreinte du réseau, 30 jours après la fin de la sortie.",
          "- **Commandes**, avec le nom et l'adresse de l'acheteur et le texte de la gravure : tant que le compte existe. **Factures et avoirs** : jamais supprimés.",
          "- **Journal des changements** des commandes, du stock, des pièces et des factures : permanent ; il ne désigne les comptes que par leur identifiant.",
          '- **Segments** : leurs règles, tant qu\'ORBES les garde ; aucun membre n\'est conservé. **Les nombres par heure** des connexions et des scans : conservés, ne désignant personne.',
          '- **Réponses aux invitations du cercle et votes de ses sondages** : tant que le compte existe. Le compte quotidien des visites du cercle ne désigne personne, et il est conservé.',
          '- **Demandes au salon privé**, avec leurs notes : tant que le compte existe, ouvertes ou closes.',
          "- **Constats d'activité inhabituelle**, examinés par le personnel d'ORBES : conservés avec la pièce qu'ils concernent.",
          "- **Journal d'audit** : permanent ; il ne désigne les comptes que par leur identifiant.",
          "- **Cookie d'appareil** : 2 ans sur votre appareil.",
          '- **Sauvegardes** de la base de données, chiffrées : deux mois environ.',
        ].join('\n'),
      ],
    },
    {
      id: 'rights',
      title: 'Vos droits',
      blocks: [
        "Selon le règlement général sur la protection des données (RGPD), vous pouvez demander l'accès à vos données, leur rectification ou leur effacement, la limitation de leur traitement, et vous y opposer. Adressez-vous à ORBES Client Services : après avoir vérifié que vous êtes le titulaire du compte, il peut vous remettre une copie de tout ce que le registre ORBES garde de votre compte. Le service n'a pas encore d'outil pour supprimer un compte : ORBES Client Services prend la demande.",
        "Vous pouvez aussi introduire une réclamation auprès de la CNIL ([cnil.fr](https://www.cnil.fr)), l'autorité française de protection des données.",
      ],
    },
    {
      id: 'security',
      title: 'Sécurité',
      blocks: [
        "Le service n'est accessible qu'en HTTPS. Les mots de passe, les claim codes et les codes de récupération ne sont conservés que sous forme d'empreinte ; les adresses IP et les identifiants d'appareil, que sous forme de pseudonyme.",
      ],
    },
    {
      id: 'changes',
      title: 'Modification de cette politique',
      blocks: ['ORBES peut modifier cette politique. La version en vigueur et sa date figurent en tête de cette page.'],
    },
  ],
};

export const PRIVACY = { en: EN, fr: FR } as const;
