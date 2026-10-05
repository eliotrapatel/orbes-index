/**
 * The terms of use (J-06), published from their drafts, docs/legal/terms.en.md
 * and terms.fr.md (J-04), article by article and in their words: the review
 * lines (*Code: …*) are not published, and a field the drafts leave to
 * complete ([À COMPLÉTER: …]) never shows. The company's name reads ORBES;
 * any other field goes with the clause that holds it (the words since the
 * comma or the full stop before it), or with its whole sentence, and then
 * with the bold lead of that sentence and the sentences that refer back to
 * it: article 11 publishes no warranty conditions ("those conditions" would
 * point at nothing) and article 20 names no mediator until counsel fills
 * them; nothing else changes. The drafts' links lead to the pages here, and
 * the privacy policy they name is linked.
 * test/web/legal.content.test.ts holds this file to the drafts: a draft that
 * changes fails it until this page follows.
 *
 * Not validated by counsel: published before that review, by the owner's
 * decision (LAUNCH §10, the plan's declared deviation for J-06).
 */
import type { LegalDocument } from './types.js';

const EN: LegalDocument = {
  title: 'Terms of use',
  summary: "The rules of the verification service and of the ORBES account: what a result says, registration, transfer, loss and theft, the warranty and ORBES Care, the releases and the private salon, the LIVE RELEASES, the orders, the owners' circle.",
  intro: [],
  sections: [
    {
      id: 'article-1',
      title: 'Article 1 — Purpose',
      blocks: [
        "These terms govern the use of the ORBES GENOME CODE service, available at theorbes.com/verify (served by verify.theorbes.com), and of the ORBES account attached to it: verifying an ORBES piece, registering its ownership, transferring it, reporting its loss or theft, the ownership certificate, the releases and their early access, the LIVE RELEASES, the requests of the private salon, the orders and their documents, and the owners' circle. MY PIECES also presents ORBES Care (article 11).",
        'The service is published by CONGLOMERAT LLC ("ORBES"), whose full identity is given in the [legal notice](/legal/notice). Using the service means accepting these terms. Creating an ORBES account means accepting them, as the service says under CREATE ACCOUNT, with a link to these terms.',
      ],
    },
    {
      id: 'article-2',
      title: 'Article 2 — Definitions',
      blocks: [
        "- **Piece**: an ORBES object that carries an ORBES CODE.\n- **ORBES CODE**: the code printed, foiled or engraved on the piece, which carries its ORBES identity and the signature of ORBES; the ORBES SEAL is its centre.\n- **ORBES identity**: the identifier of a piece, issued and signed by ORBES, and its ORBES GENOME, eight glyphs derived from that identifier, which let you recognise it at a glance.\n- **ORBES registry**: what ORBES records for each piece: the account of its registered owner, its warranty, its services, reports of its loss or theft.\n- **ORBES account**: the account created on the service with an email address and a password.\n- **Certificate card** and **claim code**: the card delivered with a piece, and the code printed under its scratch-off panel, never on the piece, which allows the first registration.\n- **Transfer code**: the code the registered owner creates to pass on the registration of a piece.\n- **Ownership certificate**: the page, reached through a link the registered owner creates, that shows what the ORBES registry says about a piece.\n- **Release**: the offer of a model in a limited number of pieces, which ORBES accounts enter before a draw (article 12).\n- **Tier**: TITANE, PLATINE or PALLADIUM, the rank of an account by the number of pieces registered to it (article 12).\n- **Private salon**: the models ORBES reserves for the owners of a piece, each from a tier, shown with an indicative price, which an account may request (article 12).\n- **LIVE RELEASE**: a release that takes place live, without a draw: a room before its opening, a line at its opening, a turn for each account in its order (article 13).\n- **After-room**: a second door that may follow a LIVE RELEASE sold out, for the accounts still waiting in its line (article 13).\n- **Order**: a piece reserved for an account, from a LIVE RELEASE, a release or the private salon, followed step by step in MY PIECES (article 14).\n- **Owners' circle**: the part of the service where ORBES publishes, for the owners of a piece, notes, invitations and polls (article 15).\n- **ORBES Care**: the care subscription ORBES presents in MY PIECES (article 11).\n- **ORBES Client Services**: the client service of ORBES, reachable at support@theorbes.com, Monday to Friday, 10:00–18:00 (Paris time).",
      ],
    },
    {
      id: 'article-3',
      title: 'Article 3 — Access to the service',
      blocks: [
        "Verifying a piece is free and open to everyone, without an account or a sign-in. The ORBES account is used to register, transfer and follow one's pieces, to enter the releases and the LIVE RELEASES, to follow one's orders and, for the owners of a piece, to read the owners' circle and to request the models of the private salon.",
        'ORBES endeavours to keep the service available, without committing to it: it may be interrupted, in particular for maintenance. ORBES has its pieces verified only at theorbes.com/verify, which leads to verify.theorbes.com. Another address, or a code printed beside the piece, does not come from ORBES.',
      ],
    },
    {
      id: 'article-4',
      title: 'Article 4 — What a result says',
      blocks: [
        '**AUTHENTIC qualifies the ORBES identity, not the object.** An AUTHENTIC result (AUTHENTIC, AUTHENTIC — FIRST REGISTRATION, AUTHENTIC — REGISTERED or AUTHENTIC — OWNERSHIP VERIFIED) means that the ORBES identity read was issued and signed by ORBES, and states what the ORBES registry records about it. It does not concern the object presented. AUTHENTIC — OWNERSHIP VERIFIED is the result the registered owner reads, signed in to their ORBES account: it means that the piece is registered to that account, whether or not its ownership is verified in the sense of article 7.',
        '**A copy can verify like the original.** A printed code can be copied: on its own, it cannot prove that the object in your hands is the one ORBES made. The note under every positive result says so. ORBES Client Services can inspect a piece on request.',
        '**UNUSUAL ACTIVITY DETECTED is a request for review, never a verdict.** This result asks you to contact ORBES Client Services before relying on the piece. It accuses neither the piece nor its holder.',
        '**Hardware checks.** No hardware check (secure NFC chip, secure element, seal) is available yet. A piece designed to carry one is verified on its code alone, and the result says so.',
        '**Revocation.** ORBES may revoke an ORBES identity, for example when a code is replaced or a piece is withdrawn. A verification then reads REVOKED (UNUSUAL ACTIVITY DETECTED when the code read, or its ORBES GENOME, does not match what ORBES issued).',
        '**Discontinued model.** ORBES may discontinue a model, and reinstate it. The pieces of a discontinued model verify as before: an AUTHENTIC result, the page of the model and the ownership certificate of its pieces then say DISCONTINUED and the year. No new piece is issued with a discontinued model.',
        '**Registration is not a title of ownership.** The ORBES registry states the account to which a piece is registered. It is not a title of ownership and replaces neither an invoice nor a deed of sale. The ownership of a piece is proven under the rules of the applicable law.',
      ],
    },
    {
      id: 'article-5',
      title: 'Article 5 — The ORBES account',
      blocks: [
        '**Creation.** The account is created with an email address and a password of at least 12 characters. ORBES checks neither the address, nor age, nor identity. You undertake to give an accurate address that is your own: ORBES Client Services uses it to find your account.',
        '**Confidentiality.** Your password is personal. ORBES will never ask you for it. Any action taken from your account is deemed taken by you, unless you have told ORBES Client Services that your account is no longer under your control.',
        '**Sessions.** A sign-in stays open for 30 days at most, after which the service asks you to sign in again. You can sign out at any time.',
        '**Account protection.** After 10 attempts with a wrong password within 15 minutes, sign-ins to the account are refused until the end of those 15 minutes.',
        '**Password change.** You change your password from MY PIECES, with your current password. Your other sessions then end.',
        '**Closing the account.** The service does not yet let you delete your own account: the request is made to ORBES Client Services.',
      ],
    },
    {
      id: 'article-6',
      title: 'Article 6 — Forgotten password',
      blocks: [
        '**No reset by email.** The service sends no email and no reset link. A forgotten password is replaced with the help of ORBES Client Services.',
        '**Recovery code.** ORBES Client Services checks your identity according to its procedure, then gives you a recovery code. The code works once and is valid for 30 minutes. A new code cancels the previous one. You enter it at theorbes.com/verify with your email address and a new password.',
        '**Attempts.** One code accepts 5 attempts with a wrong value per hour. Beyond that, it is no longer checked: ask ORBES Client Services for a new code.',
        '**Effects.** The new password ends every session of the account, cancels its pending transfers and withdraws its certificate links. To protect you from a takeover of your account, the creation of new transfer codes is then paused for 72 hours.',
      ],
    },
    {
      id: 'article-7',
      title: 'Article 7 — Registering a piece',
      blocks: [
        '**A piece handed over.** A piece can be registered once it has been handed over by ORBES or by an authorised retailer, who activates its warranty. Before that, the service says that it has not yet been delivered.',
        '**After a scan.** The scan that reads AUTHENTIC — FIRST REGISTRATION opens the registration for 15 minutes, once, and for that piece only. You register the piece while signed in to your ORBES account. A scan made in a browser signed in to the ORBES console is a test by ORBES staff and does not open the registration.',
        '**Claim code.** A piece delivered with a certificate card is registered only with the claim code printed under its scratch-off panel. Keep the card, scratch the panel only when you register, and share the claim code with no one. Beyond 5 attempts with a wrong value per hour for one piece, attempts are refused until the end of the hour. When the unusual activity of a piece comes from its scans alone, its registration stays open to the holder of the claim code.',
        '**One registered owner.** A piece is registered to one account at a time. Once registered, it passes on only through a transfer (article 8), or returns to ORBES with the return of its order (article 14).',
        '**Verified ownership.** Registered with the claim code, the ownership is verified. Without a certificate card, it is only registered: ORBES Client Services may confirm it on a proof of purchase.',
        'Registration is not a title of ownership (article 4).',
      ],
    },
    {
      id: 'article-8',
      title: 'Article 8 — Transfer of ownership',
      blocks: [
        '**Creating the code.** Only the registered owner creates a transfer code, from their account. The code is valid for 7 days. A piece has one pending transfer at a time, and the owner can cancel it until it is accepted. A piece in service, revoked, set aside by ORBES after review or withdrawn, or whose loss or theft has been reported, cannot be transferred. After the recovery of a password, the creation of transfer codes is paused (article 6).',
        '**Handing it over.** The transfer code is given only to the new owner. Whoever holds it can receive the piece in their own account.',
        '**Acceptance.** The new owner signs in to their ORBES account, scans the piece, then enters the transfer code within 15 minutes of that scan. The code must be the one of the piece scanned, and the scan must be made from their own account.',
        '**Final effect.** Once accepted, the transfer is final: the registration passes to the new owner, and neither the former owner nor the service can undo it. The ownership stays verified, or not, as it was. The warranty stays with the piece: the transfer does not change it.',
        '**Sales between private persons.** ORBES is not a party to a sale between private persons. The service advises the buyer: "Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one."',
      ],
    },
    {
      id: 'article-9',
      title: 'Article 9 — Loss and theft',
      blocks: [
        '**Report.** The registered owner reports the loss or theft of their piece from MY PIECES. Any pending transfer is then cancelled. Every verification of the piece then reads UNUSUAL ACTIVITY DETECTED, and it can no longer be transferred.',
        '**Withdrawal.** A loss you reported yourself, you withdraw from MY PIECES (PIECE FOUND), confirming the password of your account. A theft, or a loss recorded by ORBES Client Services, is withdrawn only by ORBES Client Services, and a theft only after inspecting the piece.',
        'A report in the ORBES registry does not replace a complaint to the authorities.',
      ],
    },
    {
      id: 'article-10',
      title: 'Article 10 — Ownership certificate',
      blocks: [
        '**Creation.** From MY PIECES, the registered owner creates a link to a certificate of their piece, valid for 1 to 90 days (30 days by default). A piece has at most 10 links valid at a time. The link is shown once: ORBES keeps only a fingerprint of it and cannot show it again. The owner can withdraw a link at any time; a withdrawn link leads nowhere.',
        '**Content.** The certificate shows, read when it is opened, the piece and its ORBES GENOME, the ownership (verified or not) and its date, the warranty, and that no loss or theft is reported. It never shows the name or the email address of the owner.',
        '**End of validity.** The certificate stops being valid when it expires, when the piece changes hands or returns to ORBES (article 14), when its loss or theft is reported, or when it is revoked, set aside by ORBES after review, or withdrawn.',
        '**Scope.** The certificate attests a record in the ORBES registry, not the object it is shown with. To check an object, scan its ORBES CODE.',
      ],
    },
    {
      id: 'article-11',
      title: 'Article 11 — Warranty',
      blocks: [
        "**Start.** The ORBES warranty starts when ORBES, or an authorised retailer listed in the ORBES register of points of sale, activates it, on the date of purchase, for the length set for the category of the piece. In a boutique, the seller activates the warranty within 10 minutes of their scan of the piece, on the day's date and in the country of the point of sale.",
        '**Follow-up.** The service shows the status of the warranty of each piece. The warranty stays with the piece when it changes hands.',
        'The statutory guarantees remain due in every case.',
        "**ORBES Care.** MY PIECES presents ORBES Care, a care subscription for your pieces: an annual care service by the ORBES atelier, priority repair and an extended warranty. ORBES Care is not on sale until SUBSCRIBE appears in MY PIECES. Once open, the subscription is taken out on a third-party page (Whop), under that page's own terms: the service takes no payment, and sends that page nothing about your account or your pieces.",
      ],
    },
    {
      id: 'article-12',
      title: 'Article 12 — Releases and the private salon',
      blocks: [
        'ORBES may offer a model in a limited number of pieces in a release, announced on the service (THE RELEASES) with its number of pieces, the dates of its entries and the rule of its draw. ORBES may cancel a release until its draw.',
        '**Entering.** Any ORBES account may enter a release while its entries are open, whether or not pieces are registered to it. Entering is free and obliges you to nothing. An account enters a release once: it may withdraw its entry until the draw, and enter again, under the same entry, while entries are open. One entry per person: ORBES Client Services may decline to conclude the sale of a second account of the same person.',
        '**Tiers and seniority.** The tier of an account is read from the pieces registered to it: TITANE from 1 piece, PLATINE from 3, PALLADIUM from 5. A piece revoked, set aside by ORBES after review, or withdrawn does not count. The seniority of an account is the number of full years since a piece was first registered to it.',
        '**Benefits of the tiers.** MY PIECES describes, for information, the benefits of each tier. ORBES may change their terms, never the thresholds of the tiers. A benefit creates no obligation beyond what this article and article 15 say.',
        '**Early access.** Before its entries open to everyone, a release may offer an early access, 48 hours by default: its length is set for each release, and its page gives the times. During it, PLATINE and PALLADIUM owners (from 3 pieces) may reserve a place directly, without a draw, each by their tier at the time of the request: first come, first served, within the pieces of the release. Once all its pieces are reserved, the release is full. An account holds a single entry or reservation per release. A place reserved is held until the time stated, like a place drawn. It obliges you to nothing: ORBES Client Services concludes the sale with you, or lets it lapse once its time has passed. The pieces left then go to the draw.',
        '**The draw.** After its entries close, ORBES runs the draw of a release once. It ranks the entries by the tier of their account, then by its seniority, both read at the time of the draw, then by the SHA-256 of a seed of 32 bytes followed by the identifier of the entry, in increasing order. The seed is drawn when the release is created, and its fingerprint is published with the release. The seed itself is published after the draw, with the identifier, the tier, the seniority and the rank of each entry, never its account: anyone can check the order. MY PIECES shows each account the identifier of its entry.',
        '**Place held.** The first ranks, as many as there are pieces left after the direct reservations of the early access, are selected; the next are on the waiting list, in their order. When fewer accounts enter than there are pieces, every entry is selected. The place of a selected entry is held for the time its release states, 48 hours unless it states otherwise. The service sends no email: MY PIECES shows the status of each entry, and ORBES Client Services contacts the selected accounts.',
        '**No obligation.** A place held obliges you to nothing: ORBES Client Services concludes each sale with you, outside the service. Once its time has passed, a place that has not been concluded lapses, and ORBES may offer it to the next entry on the waiting list. When ORBES Client Services confirms the sale of a place, MY PIECES shows its order (article 14).',
        '**PAST.** Once drawn, a release moves to the PAST tab of THE RELEASES, with its photograph, its name, the day its entries opened and its number of pieces, never how many entries it had; its page keeps what its draw publishes. Signed in, you read there, for each release, whether you took part (an entry not withdrawn when the draw ran, or a place reserved directly) and whether you secured a piece (your entry confirmed), and how many releases you have taken part in.',
        "**The private salon.** ORBES may reserve models for the owners of a piece (THE PRIVATE SALON). Each model is shown, with an indicative price, to the signed-in accounts whose tier reaches the one ORBES sets for it (TITANE, PLATINE or PALLADIUM); below that tier, it is not shown. From the page of a model, an account may request it, with an optional note of at most 500 characters. A request obliges neither the account nor ORBES and creates no contract: ORBES Client Services contacts the account and concludes any sale with it, outside the service. Nothing is paid on the service, and it sends no email. An account holds one open request per model; once ORBES Client Services has closed it, accepted or declined, with a note of what was done, the account may request the model again. A request accepted becomes an order (article 14). Neither your note nor that of ORBES Client Services is written to the service's audit log.",
      ],
    },
    {
      id: 'article-13',
      title: 'Article 13 — LIVE RELEASES',
      blocks: [
        'A LIVE RELEASE is a release that takes place live, without a draw: ORBES announces it on the service (THE RELEASES) with the day and time it opens, its price, its quantity as ORBES words it (for example "25 PIECES"), the pieces each person may take and who may enter it. Its piece may be revealed in stages, a silhouette, then its name, then its photograph, each at the time its page gives. A release may announce a surprise in every box (A SURPRISE IN EVERY BOX): the same for every piece of the release, its page does not say what it is. ORBES may cancel a LIVE RELEASE until its room opens.',
        "**Who may enter.** ORBES sets, for each LIVE RELEASE, who may enter it: every ORBES account, the owners from a tier (article 12), the owners of a piece of a model or a collection it names, the accounts that have taken part in a number of releases it states, or selected collectors, a group of accounts ORBES composes without naming it. When a release sets several of these rules, its page says whether an account must meet them all or one of them. An account takes part in a release when it had a place in the line of a LIVE RELEASE once its opening has passed, whatever became of it, unless ORBES removed its entry, or when it held an entry in a release that was not withdrawn when the draw ran, or a place reserved directly in its early access; a release counts once, an after-room counts as the release it follows, a cancelled release never counts, and a release never counts towards its own rule. The service checks these rules when you say I'LL BE THERE, when you enter and when you secure a piece: an account that no longer meets them at that moment is refused.",
        "**I'LL BE THERE.** From the announcement until the opening, an account that meets the rule may say it will be there, with a size, change that size and withdraw it. The service shows how many accounts said so, never which. It reserves nothing and obliges you to nothing.",
        "**The room.** The room opens 5 minutes before the opening, unless the release sets another time, from 1 to 60 minutes. You enter it signed in, with a size of the release. An account enters a release once, for one piece unless the release offers more, up to 5. One entry per person: ORBES Client Services may decline to conclude the reservation of a second account of the same person. You may change your size and leave the room until the opening; from the opening, your size no longer changes. Only the accounts that may enter a release, or that hold an entry in it, see its room. The times are those of ORBES's server.",
        '**The line.** At the opening, the accounts in the room form the line. Unless the release provides otherwise, the line follows the tier first, read at the opening: PALLADIUM, PLATINE, TITANE, then the accounts without a tier. Within a tier, or for every account when the release does not follow the tiers, the order is that of the SHA-256 of a seed of the release followed by the identifier of the entry: the seed is drawn and sealed when the release is created, and is never published. An account that leaves the room before the opening may enter it again; an entry that has had its place in the line never returns to it. An account that enters after the opening chooses its size as it enters and joins the line behind, in the order of arrival.',
        "**Your turn.** When enough pieces of your size are free for the quantity you chose and you are next in the line for that size, it is your turn. You then have 30 seconds, unless the release sets another time (from 10 to 300 seconds, which may differ by tier), to press and hold, on your screen, the ORBES CODE of the room, a specimen that is no piece's code, until its ring is full. The service secures the piece only for a hold of at least 1.4 seconds, measured by its own clock. A turn not taken in time passes, and its piece goes to the next in line.",
        '**Your piece.** Once secured, the piece is held for you for 5 minutes, unless the release sets another time (from 1 to 60 minutes, which may differ by tier). Meanwhile you may choose the options the release offers, at most 6, for example an engraving, a gift box or ORBES Care, each at the price the release sets, kept as it was when you chose it; then press PAY, or give the piece back with RELEASE MY PLACE. A piece not confirmed in time is no longer held, and its options lapse with it.',
        '**PAY.** PAY confirms the reservation of the piece held, with its options and their total, and creates its order, one per piece (article 14). Nothing is paid on the service: ORBES Client Services contacts you for payment and delivery, then concludes the sale with you, outside the service, or cancels the order. MY PIECES shows your reservation, its reference and its order.',
        '**A piece that returns.** A piece whose turn passes, whose hold ends, that is given back, or whose entry ORBES removes returns to the line: the next account in the line for its size gets a turn at once.',
        '**What ORBES may do.** During a release, ORBES may pause it, no turn being given meanwhile and the turns and holds under way stopping, then resuming with the time they had left; extend its end; add pieces to a size; let a person in the line take their turn at once; remove an entry; or end the release early. The quantity announced is the quantity ORBES offers; ORBES may nevertheless add pieces during the release, and each addition is recorded.',
        "**No piece guaranteed.** Saying I'LL BE THERE, entering the room or the line, being a guest of an after-room, and even a turn, give no right to a piece until it is secured: the pieces are limited, and go to the line in its order.",
        '**The end.** A LIVE RELEASE ends once every piece is confirmed (SOLD OUT), at the end time its page gives, or when ORBES ends it. From then, no turn is given and the accounts still waiting leave the line; when ORBES ends it, a turn under way ends too. At the end time, a turn under way may still be secured until its time; in every case, a piece held may still be confirmed until its own. A reservation cancelled after the end does not return to the line: ORBES Client Services handles it. The release then moves to PAST in THE RELEASES, as it was announced; your entry and its outcome stay in MY PIECES. Its page then reads THIS RELEASE IS OVER, without any figure of its end, and, signed in, says whether you took part and whether you secured a piece. The service sends no email.',
        '**The after-room.** ORBES may follow a LIVE RELEASE with an after-room (THE AFTER-ROOM), set for that release: its own model, price, sizes, pieces and options, with the turn and hold times, the pieces per person and the surprise of the release. It opens only if the release sells out (SOLD OUT): the accounts then still waiting in its line are its guests, in the order they had there, and no one else may see it. It opens 10 minutes after the sell-out, unless the release sets another time (from 1 to 60 minutes), and stays open 15 minutes, unless it sets another length (from 5 to 120 minutes), or until its own pieces are all confirmed. A guest enters it with a size and takes the place their order gives in its line; turns, PAY and the rest of this article then apply to it as to any LIVE RELEASE. If the release ends otherwise, or nobody is waiting at its sell-out, there is no after-room. It is announced nowhere else, and asks no question after.',
        "**The question after.** Once a LIVE RELEASE has ended, its after-room's end included, ORBES may ask, for 7 days, one question with 2 to 6 answers (unless the release sets another, WHAT WOULD YOU HAVE WANTED?): on its page, to the accounts that took part without securing a piece, and in MY PIECES, to those that said I'LL BE THERE without taking a place in its line. Answering takes one tap, is optional and obliges you to nothing; you may change your answer while the question is open.",
        '**What is recorded.** For each entry, the service records the account, the size and the quantity, the tier, the place in the line, the time of each step, the length of the hold, the options chosen, the outcome of the reservation, the place of a guest in an after-room and the answer to the question after; and, from the connection, its country and a keyed fingerprint of its network, never its address. That fingerprint is erased 30 days after the end of the release. These data serve to run the release and to spot automated entries; the [privacy policy](/legal/privacy) says more (article 17).',
      ],
    },
    {
      id: 'article-14',
      title: 'Article 14 — Orders',
      blocks: [
        'Each piece reserved for an account is an order: a piece of a LIVE RELEASE confirmed with PAY (one order per piece), a place of a release whose sale ORBES Client Services confirms, or a request of the private salon it accepts (article 12). MY PIECES shows each of your orders with its reference, the model, the size, the options and the price, and its steps with their dates. The size and the price of an order from a release or the private salon read TO BE CONFIRMED until ORBES Client Services enters them.',
        '**Its steps.** An order is RESERVED, then PAID, SHIPPED and DELIVERED. It may be CANCELLED while it is RESERVED or PAID, and RETURNED once it is SHIPPED or DELIVERED; no other step is possible. ORBES Client Services records each step; nothing is paid on the service. An order is PAID only once its price is entered.',
        '**Its piece.** For each order, ORBES holds a piece of its model and size in stock when one is available, or plans to make it: the ORBES identity of a piece made for an order is reserved when it is planned, and confirmed when the piece is finished. A cancelled order frees its piece; a piece planned for it is no longer made, and its reserved ORBES identity is withdrawn, its number never used again.',
        "**Delivery.** ORBES Client Services enters on the order the name and the address of the buyer, and any engraving text: the service has no form for them. An order ships with a carrier and a tracking number, which MY PIECES then shows with TRACK THE SHIPMENT, a link to the carrier's own page. It is DELIVERED when ORBES Client Services records it, or as soon as the account that ordered it registers its piece (article 7) while it is SHIPPED.",
        '**Invoice.** When an order is PAID, CONGLOMERAT LLC issues its invoice, numbered in sequence for each year, in English and without VAT. When a paid order is cancelled or returned, a credit note cancels its invoice in full. Neither is ever changed. MY PIECES gives them as PDF documents, with the care guide of the model and, once the piece is registered to your account, its ownership certificate, a document that states what the ORBES registry records about it, never the certificate card.',
        '**Return.** Once an order is SHIPPED or DELIVERED, ORBES Client Services may record its return, with a note: its piece goes back to the stock of ORBES, or to the archive. If the piece is registered to an account, ORBES takes back that registration: it ends, with any pending transfer and every certificate link of the piece, and the piece is registered to no one. Back in stock, the piece receives a new claim code; archived, it is withdrawn. A return is recorded once and is not undone.',
        "**What is recorded.** For each order, the service records the account, where it comes from, the model, the size, the price, the options, the surprise of its release, the engraving text, the buyer's name and address, the time of each step with the note ORBES Client Services may add, the carrier, the tracking number and the value declared for its insurance, where its piece is kept, and its invoices; the [privacy policy](/legal/privacy) says more (article 17).",
      ],
    },
    {
      id: 'article-15',
      title: "Article 15 — The owners' circle",
      blocks: [
        "In the owners' circle (THE CIRCLE), ORBES publishes content of the maison for the owners of a piece: notes, invitations and polls. The circle is free and obliges you to nothing. ORBES chooses what it publishes there, and may change or withdraw a post.",
        '**Access.** The circle is reserved for signed-in ORBES accounts to which at least one piece is registered (article 12). Each post is reserved for a tier and the tiers above it, and may be reserved further for selected collectors (article 13). Access is checked at each visit: it ends with the last piece registered to the account.',
        '**Invitations.** You answer an invitation YES or NO, within its places. You may change your answer until the event begins. Answering obliges you to nothing.',
        '**Polls.** Each account votes once in a poll, and that vote is final. The results, as totals by option, show once you have voted.',
        '**Links.** A post links only to sites authorised by ORBES. The service shows the name of the site beside the link.',
        "**What is recorded.** Your answer to an invitation is written to the service's audit log; your vote never is. Visits to the circle are counted per day, without any account. Your answers and votes are in the copy of your data you may ask ORBES Client Services for (article 17).",
      ],
    },
    {
      id: 'article-16',
      title: 'Article 16 — Locking an account',
      blocks: [
        'ORBES Client Services may lock an ORBES account.',
        "The lock ends every session of the account, revokes its recovery code, withdraws its certificate links and its entries in releases not yet drawn (article 12), closes its open requests in the private salon (article 12), removes its entries under way in the LIVE RELEASES and withdraws its I'LL BE THERE in those not yet open (article 13), and cancels its pending transfers. A place already held stays held until ORBES Client Services concludes it or lets it lapse, its orders stay for ORBES Client Services to follow, and its answers to the circle's invitations stay as they are. The account can no longer sign in, even with the right password. Its pieces stay registered to it. Only ORBES Client Services lifts the lock.",
      ],
    },
    {
      id: 'article-17',
      title: 'Article 17 — Personal data',
      blocks: [
        "ORBES processes the data of the service (account, registrations, scans, entries and reservations in releases, entries, options and reservations in the LIVE RELEASES, answers to the question after, orders and their invoices, answers and votes in the circle, requests in the private salon) as its [privacy policy](/legal/privacy) describes, which also says how ORBES groups collectors and counts their activity by hour. The service sends your orders to no online store. You can ask ORBES Client Services for a copy of everything the ORBES registry holds about your account. Your requests in the private salon, with your notes, are in that copy. Your entries in the LIVE RELEASES, with their options, and your I'LL BE THERE are in that copy. Your orders, with the buyer's name and address, their steps and their invoices, and your answers to the questions after are in that copy.",
      ],
    },
    {
      id: 'article-18',
      title: 'Article 18 — Liability',
      blocks: [
        'ORBES describes faithfully what the service checks and what it does not (article 4). A result does not guarantee that an object is the one ORBES made: before buying, ask the seller for a transfer code, and when in doubt, ORBES Client Services can inspect the piece.',
      ],
    },
    {
      id: 'article-19',
      title: 'Article 19 — Changes to these terms',
      blocks: [
        'ORBES may change these terms. The version in force and its date are published on the service.',
      ],
    },
    {
      id: 'article-20',
      title: 'Article 20 — Applicable law and disputes',
      blocks: [
        'These terms are governed by the laws of the State of Wyoming, United States, without regard to its conflict-of-laws rules. Nothing in them deprives a consumer of the protection of the mandatory rules of the law of the country where they live. In a dispute, you may first turn to ORBES Client Services. Any dispute relating to these terms will be handled in the courts located in Wyoming, United States, subject to those mandatory rules.',
      ],
    },
  ],
};

const FR: LegalDocument = {
  title: "Conditions générales d'utilisation",
  summary: "Les règles du service de vérification et du compte ORBES : ce que dit un résultat, l'enregistrement, le transfert, la perte et le vol, la garantie et ORBES Care, les sorties et le salon privé, les LIVE RELEASES, les commandes, le cercle des propriétaires.",
  intro: [],
  sections: [
    {
      id: 'article-1',
      title: 'Article 1 — Objet',
      blocks: [
        "Les présentes conditions régissent l'utilisation du service ORBES GENOME CODE, accessible à l'adresse theorbes.com/verify (servie par verify.theorbes.com), et du compte ORBES qui s'y rattache : la vérification d'une pièce ORBES, l'enregistrement de sa propriété, son transfert, la déclaration de sa perte ou de son vol, le certificat de propriété, les sorties et leur accès anticipé, les LIVE RELEASES, les demandes du salon privé, les commandes et leurs documents, et le cercle des propriétaires. MY PIECES présente aussi ORBES Care (article 11).",
        "Le service est édité par CONGLOMERAT LLC (« ORBES »), dont l'identité complète figure dans les [mentions légales](/legal/notice). Utiliser le service, c'est accepter les présentes conditions. Créer un compte ORBES, c'est les accepter, comme le service l'indique sous CREATE ACCOUNT, avec un lien vers les présentes conditions.",
      ],
    },
    {
      id: 'article-2',
      title: 'Article 2 — Définitions',
      blocks: [
        "- **Pièce** : un objet ORBES qui porte un ORBES CODE.\n- **ORBES CODE** : le code imprimé, marqué à chaud ou gravé sur la pièce, qui porte son identité ORBES et la signature d'ORBES ; l'ORBES SEAL en est le centre.\n- **Identité ORBES** : l'identifiant d'une pièce, émis et signé par ORBES, et son ORBES GENOME, huit signes tirés de cet identifiant, qui permettent de la reconnaître d'un coup d'œil.\n- **Registre ORBES** : ce qu'ORBES enregistre pour chaque pièce : compte du propriétaire enregistré, garantie, entretiens, déclarations de perte ou de vol.\n- **Compte ORBES** : le compte créé sur le service avec une adresse e-mail et un mot de passe.\n- **Carte certificat** et **claim code** : la carte remise avec une pièce, et le code imprimé sous sa zone à gratter, jamais sur la pièce, qui permet le premier enregistrement.\n- **Code de transfert** : le code que le propriétaire enregistré crée pour transmettre l'enregistrement d'une pièce.\n- **Certificat de propriété** : la page, accessible par un lien que crée le propriétaire enregistré, qui montre ce que le registre ORBES dit d'une pièce.\n- **Sortie** : l'offre d'un modèle en un nombre limité de pièces, à laquelle les comptes ORBES s'inscrivent avant un tirage (article 12).\n- **Palier** : TITANE, PLATINE ou PALLADIUM, le rang d'un compte selon le nombre de pièces qui y sont enregistrées (article 12).\n- **Salon privé** : les modèles qu'ORBES réserve aux propriétaires d'une pièce, chacun à partir d'un palier, présentés avec un prix indicatif, qu'un compte peut demander (article 12).\n- **LIVE RELEASE** : une sortie qui se vit en direct, sans tirage : une salle avant son ouverture, une file à son ouverture, un tour pour chaque compte dans son ordre (article 13).\n- **Salle d'après** : une seconde porte qui peut suivre une LIVE RELEASE épuisée, pour les comptes qui attendaient encore dans sa file (article 13).\n- **Commande** : une pièce réservée à un compte, d'une LIVE RELEASE, d'une sortie ou du salon privé, suivie étape par étape dans MY PIECES (article 14).\n- **Cercle des propriétaires** : la partie du service où ORBES publie, pour les propriétaires d'une pièce, des notes, des invitations et des sondages (article 15).\n- **ORBES Care** : l'abonnement d'entretien qu'ORBES présente dans MY PIECES (article 11).\n- **ORBES Client Services** : le service client d'ORBES, joignable à support@theorbes.com, du lundi au vendredi, de 10 h à 18 h (heure de Paris).",
      ],
    },
    {
      id: 'article-3',
      title: 'Article 3 — Accès au service',
      blocks: [
        "La vérification d'une pièce est gratuite et ouverte à tous, sans compte ni connexion. Le compte ORBES sert à enregistrer, transférer et suivre ses pièces, à s'inscrire aux sorties, à entrer dans les LIVE RELEASES, à suivre ses commandes et, pour les propriétaires d'une pièce, à lire le cercle des propriétaires et à demander les modèles du salon privé.",
        "ORBES s'efforce de maintenir le service accessible, sans s'y engager : il peut être interrompu, notamment pour maintenance. ORBES ne fait vérifier ses pièces qu'à l'adresse theorbes.com/verify, qui mène à verify.theorbes.com. Une autre adresse, ou un code imprimé à côté de la pièce, ne vient pas d'ORBES.",
      ],
    },
    {
      id: 'article-4',
      title: 'Article 4 — Ce que dit un résultat',
      blocks: [
        "**AUTHENTIC qualifie l'identité ORBES, pas l'objet.** Un résultat AUTHENTIC (AUTHENTIC, AUTHENTIC — FIRST REGISTRATION, AUTHENTIC — REGISTERED ou AUTHENTIC — OWNERSHIP VERIFIED) signifie que l'identité ORBES lue a été émise et signée par ORBES, et indique ce que le registre ORBES en sait. Il ne porte pas sur l'objet présenté. AUTHENTIC — OWNERSHIP VERIFIED est le résultat que lit le propriétaire enregistré, connecté à son compte ORBES : la pièce est enregistrée à ce compte, que sa propriété soit vérifiée ou non au sens de l'article 7.",
        "**Une copie peut vérifier comme l'original.** Un code imprimé peut être copié : à lui seul, il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué. La mention placée sous chaque résultat positif le rappelle. ORBES Client Services peut examiner une pièce sur demande.",
        "**UNUSUAL ACTIVITY DETECTED est une demande d'examen, jamais un verdict.** Ce résultat invite à contacter ORBES Client Services avant de se fier à la pièce. Il n'accuse ni la pièce ni son détenteur.",
        "**Contrôles matériels.** Aucun contrôle matériel (puce NFC sécurisée, élément sécurisé, scellé) n'est encore disponible. Une pièce conçue pour en recevoir un est vérifiée sur son seul code, et le résultat le précise.",
        "**Révocation.** ORBES peut révoquer une identité ORBES, par exemple quand un code est remplacé ou qu'une pièce est retirée. Une vérification affiche alors REVOKED (UNUSUAL ACTIVITY DETECTED quand le code lu, ou son ORBES GENOME, ne correspond pas à ce qu'ORBES a émis).",
        "**Modèle arrêté.** ORBES peut arrêter un modèle, puis le rétablir. Les pièces d'un modèle arrêté se vérifient comme avant : un résultat AUTHENTIC, la fiche du modèle et le certificat de propriété de ses pièces indiquent alors DISCONTINUED et l'année. Aucune nouvelle pièce n'est émise avec un modèle arrêté.",
        "**L'enregistrement n'est pas un titre de propriété.** Le registre ORBES indique le compte auquel une pièce est enregistrée. Il ne vaut pas titre de propriété et ne remplace ni une facture ni un acte de vente. La propriété d'une pièce se prouve selon les règles du droit applicable.",
      ],
    },
    {
      id: 'article-5',
      title: 'Article 5 — Le compte ORBES',
      blocks: [
        "**Création.** Le compte se crée avec une adresse e-mail et un mot de passe d'au moins 12 caractères. ORBES ne vérifie ni l'adresse, ni l'âge, ni l'identité. Vous vous engagez à donner une adresse exacte, qui est la vôtre : ORBES Client Services s'en sert pour retrouver votre compte.",
        "**Confidentialité.** Votre mot de passe est personnel. ORBES ne vous le demandera jamais. Toute action faite depuis votre compte est réputée faite par vous, sauf si vous avez signalé à ORBES Client Services que votre compte n'est plus sous votre contrôle.",
        '**Sessions.** Une connexion reste ouverte 30 jours au plus, puis le service vous demande de vous connecter de nouveau. Vous pouvez vous déconnecter à tout moment.',
        "**Protection du compte.** Après 10 essais de mot de passe erronés en 15 minutes, les connexions au compte sont refusées jusqu'à la fin de ces 15 minutes.",
        '**Changement de mot de passe.** Vous changez votre mot de passe depuis MY PIECES, avec le mot de passe actuel. Vos autres sessions prennent alors fin.',
        "**Fermeture.** Le service ne permet pas encore de supprimer soi-même son compte : la demande se fait auprès d'ORBES Client Services.",
      ],
    },
    {
      id: 'article-6',
      title: 'Article 6 — Mot de passe oublié',
      blocks: [
        "**Pas de réinitialisation par e-mail.** Le service n'envoie aucun e-mail, ni lien de réinitialisation. Un mot de passe oublié se remplace avec l'aide d'ORBES Client Services.",
        '**Code de récupération.** ORBES Client Services vérifie votre identité selon sa procédure, puis vous remet un code de récupération. Ce code sert une seule fois et vaut 30 minutes. Un nouveau code annule le précédent. Vous le saisissez sur theorbes.com/verify avec votre adresse e-mail et un nouveau mot de passe.',
        "**Essais.** Un même code accepte 5 essais erronés par heure. Au-delà, il n'est plus examiné : demandez un nouveau code à ORBES Client Services.",
        "**Effets.** Le nouveau mot de passe ferme toutes les sessions du compte, annule ses transferts en attente et retire ses liens de certificat. Pour vous protéger d'une prise de contrôle de votre compte, la création de nouveaux codes de transfert est ensuite suspendue pendant 72 heures.",
      ],
    },
    {
      id: 'article-7',
      title: "Article 7 — Enregistrement d'une pièce",
      blocks: [
        "**Une pièce remise.** Une pièce s'enregistre une fois remise par ORBES ou par un détaillant agréé, qui active sa garantie. Avant cela, le service indique qu'elle n'a pas encore été remise.",
        "**Après un scan.** Le scan qui affiche AUTHENTIC — FIRST REGISTRATION ouvre l'enregistrement pour 15 minutes, une seule fois et pour cette pièce seulement. Vous enregistrez la pièce en étant connecté à votre compte ORBES. Un scan fait dans un navigateur connecté à la console ORBES est un test du personnel ORBES et n'ouvre pas l'enregistrement.",
        "**Claim code.** Une pièce livrée avec une carte certificat ne s'enregistre qu'avec le claim code imprimé sous sa zone à gratter. Conservez la carte, ne grattez la zone qu'au moment d'enregistrer, et ne communiquez le claim code à personne. Au-delà de 5 essais erronés par heure pour une même pièce, les essais sont refusés jusqu'à la fin de l'heure. Quand l'activité inhabituelle d'une pièce vient seulement de ses scans, son enregistrement reste ouvert au détenteur du claim code.",
        "**Un propriétaire enregistré.** Une pièce n'est enregistrée qu'à un seul compte à la fois. Déjà enregistrée, elle ne se transmet que par un transfert (article 8), ou revient à ORBES avec le retour de sa commande (article 14).",
        "**Propriété vérifiée.** Enregistrée avec le claim code, la propriété est vérifiée. Sans carte certificat, elle est seulement enregistrée : ORBES Client Services peut la confirmer sur présentation d'une preuve d'achat.",
        "L'enregistrement n'est pas un titre de propriété (article 4).",
      ],
    },
    {
      id: 'article-8',
      title: 'Article 8 — Transfert de propriété',
      blocks: [
        "**Création du code.** Seul le propriétaire enregistré crée un code de transfert, depuis son compte. Le code vaut 7 jours. Une pièce n'a qu'un transfert en attente à la fois, et le propriétaire peut l'annuler tant qu'il n'est pas accepté. Une pièce en entretien, révoquée, écartée par ORBES après examen ou retirée, ou dont la perte ou le vol a été déclaré, ne se transfère pas. Après la récupération d'un mot de passe, la création de codes de transfert est suspendue (article 6).",
        "**Remise.** Le code de transfert ne se donne qu'au nouveau propriétaire. Qui le détient peut recevoir la pièce dans son propre compte.",
        '**Acceptation.** Le nouveau propriétaire se connecte à son compte ORBES, scanne la pièce, puis saisit le code de transfert dans les 15 minutes qui suivent ce scan. Le code doit être celui de la pièce scannée, et le scan celui de son propre compte.',
        "**Effet définitif.** Une fois accepté, le transfert est définitif : l'enregistrement passe au nouveau propriétaire, et ni l'ancien propriétaire ni le service ne peuvent le défaire. La propriété reste vérifiée, ou non, comme elle l'était. La garantie reste attachée à la pièce : le transfert ne la modifie pas.",
        "**Vente entre particuliers.** ORBES n'est pas partie à une vente entre particuliers. Le service conseille à l'acheteur : « Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un. »",
      ],
    },
    {
      id: 'article-9',
      title: 'Article 9 — Perte et vol',
      blocks: [
        '**Déclaration.** Le propriétaire enregistré déclare la perte ou le vol de sa pièce depuis MY PIECES. Un transfert en attente est alors annulé. Chaque vérification de la pièce affiche ensuite UNUSUAL ACTIVITY DETECTED, et elle ne se transfère plus.',
        "**Retrait.** Une perte que vous avez déclarée vous-même, vous la retirez depuis MY PIECES (PIECE FOUND), en confirmant le mot de passe de votre compte. Un vol, ou une perte enregistrée par ORBES Client Services, n'est retiré que par ORBES Client Services, et un vol seulement après examen de la pièce.",
        'La déclaration dans le registre ORBES ne remplace pas une plainte auprès des autorités.',
      ],
    },
    {
      id: 'article-10',
      title: 'Article 10 — Certificat de propriété',
      blocks: [
        "**Création.** Le propriétaire enregistré crée depuis MY PIECES un lien vers un certificat de sa pièce, valable 1 à 90 jours (30 jours par défaut). Une pièce a au plus 10 liens valides à la fois. Le lien n'est montré qu'une fois : ORBES n'en garde qu'une empreinte et ne peut pas le montrer de nouveau. Le propriétaire peut retirer un lien à tout moment ; un lien retiré ne mène plus à rien.",
        "**Contenu.** Le certificat montre, lus au moment de son ouverture, la pièce et son ORBES GENOME, la propriété (vérifiée ou non) et sa date, la garantie, et l'absence de déclaration de perte ou de vol. Il ne montre jamais le nom ni l'adresse e-mail du propriétaire.",
        "**Fin de validité.** Le certificat cesse d'être valide à son expiration, quand la pièce change de propriétaire ou revient à ORBES (article 14), quand sa perte ou son vol est déclaré, ou quand elle est révoquée, écartée par ORBES après examen, ou retirée.",
        "**Portée.** Le certificat atteste un enregistrement dans le registre ORBES, pas l'objet avec lequel il est présenté. Pour vérifier un objet, il faut scanner son ORBES CODE.",
      ],
    },
    {
      id: 'article-11',
      title: 'Article 11 — Garantie',
      blocks: [
        "**Début.** La garantie ORBES commence à son activation par ORBES ou par un détaillant agréé inscrit au registre des points de vente d'ORBES, à la date d'achat, pour la durée prévue pour la catégorie de la pièce. En boutique, le vendeur active la garantie dans les 10 minutes qui suivent son scan de la pièce, à la date du jour et au pays du point de vente.",
        "**Suivi.** Le service affiche l'état de la garantie de chaque pièce. La garantie reste attachée à la pièce quand celle-ci change de propriétaire.",
        'Les garanties légales restent dues dans tous les cas.',
        "**ORBES Care.** MY PIECES présente ORBES Care, un abonnement d'entretien de vos pièces : un entretien annuel par l'atelier ORBES, une réparation prioritaire et une garantie prolongée. ORBES Care n'est pas en vente tant que SUBSCRIBE n'apparaît pas dans MY PIECES. Une fois ouvert, l'abonnement se souscrit sur une page tierce (Whop), selon les conditions propres à cette page : le service n'encaisse aucun paiement, et ne transmet à cette page rien de votre compte ni de vos pièces.",
      ],
    },
    {
      id: 'article-12',
      title: 'Article 12 — Sorties et salon privé',
      blocks: [
        "ORBES peut proposer un modèle en un nombre limité de pièces lors d'une sortie, annoncée sur le service (THE RELEASES) avec son nombre de pièces, les dates de ses inscriptions et la règle de son tirage. ORBES peut annuler une sortie tant que son tirage n'a pas eu lieu.",
        "**Inscription.** Tout compte ORBES peut s'inscrire à une sortie pendant que ses inscriptions sont ouvertes, que des pièces y soient enregistrées ou non. L'inscription est gratuite et ne vous oblige à rien. Un compte s'inscrit une fois à une sortie : il peut retirer son inscription jusqu'au tirage, et s'inscrire de nouveau, sous la même inscription, tant que les inscriptions sont ouvertes. Une inscription par personne : ORBES Client Services peut refuser de conclure la vente d'un second compte de la même personne.",
        "**Paliers et ancienneté.** Le palier d'un compte se lit sur les pièces qui y sont enregistrées : TITANE dès 1 pièce, PLATINE dès 3, PALLADIUM dès 5. Une pièce révoquée, écartée par ORBES après examen ou retirée ne compte pas. L'ancienneté d'un compte est le nombre d'années pleines depuis qu'une pièce y a été enregistrée pour la première fois.",
        "**Avantages des paliers.** MY PIECES décrit, à titre d'information, les avantages de chaque palier. ORBES peut en modifier les termes, jamais les seuils des paliers. Un avantage ne crée aucune obligation au-delà de ce que disent le présent article et l'article 15.",
        "**Accès anticipé.** Avant l'ouverture de ses inscriptions à tous, une sortie peut offrir un accès anticipé, de 48 heures par défaut : sa durée est fixée pour chaque sortie, et sa page en donne les heures. Pendant cet accès, les propriétaires PLATINE et PALLADIUM (dès 3 pièces) peuvent réserver directement une place, sans tirage, chacun selon son palier au moment de sa demande : premier arrivé, premier servi, dans la limite des pièces de la sortie. Une fois toutes ses pièces réservées, la sortie est complète. Un compte détient une seule inscription ou réservation par sortie. La place réservée est tenue jusqu'à l'heure indiquée, comme une place tirée. Elle ne vous oblige à rien : ORBES Client Services conclut la vente avec vous, ou la laisse expirer après son échéance. Les pièces qui restent passent ensuite au tirage.",
        "**Tirage.** Après la clôture de ses inscriptions, ORBES procède au tirage d'une sortie, une seule fois. Il classe les inscriptions selon le palier de leur compte, puis selon son ancienneté, tous deux lus au moment du tirage, puis selon le SHA-256 d'une graine de 32 octets suivie de l'identifiant de l'inscription, par ordre croissant. La graine est tirée à la création de la sortie, et son empreinte est publiée avec la sortie. La graine elle-même est publiée après le tirage, avec l'identifiant, le palier, l'ancienneté et le rang de chaque inscription, jamais son compte : chacun peut vérifier l'ordre. MY PIECES montre à chaque compte l'identifiant de son inscription.",
        "**Place réservée.** Les premiers rangs, autant qu'il reste de pièces après les réservations directes de l'accès anticipé, sont sélectionnés ; les suivants sont sur la liste d'attente, dans leur ordre. Quand moins de comptes s'inscrivent qu'il n'y a de pièces, toutes les inscriptions sont sélectionnées. La place d'une inscription sélectionnée est réservée pendant la durée que fixe sa sortie, 48 heures sauf mention contraire. Le service n'envoie aucun e-mail : MY PIECES montre le statut de chaque inscription, et ORBES Client Services contacte les comptes sélectionnés.",
        "**Aucune obligation.** Une place réservée ne vous oblige à rien : ORBES Client Services conclut chaque vente avec vous, hors du service. Passé son délai, une place qui n'a pas été conclue expire, et ORBES peut la proposer à l'inscription suivante de la liste d'attente. Quand ORBES Client Services confirme la vente d'une place, MY PIECES en montre la commande (article 14).",
        "**PAST.** Une fois tirée, une sortie passe dans l'onglet PAST de THE RELEASES, avec sa photographie, son nom, le jour de l'ouverture de ses inscriptions et son nombre de pièces, jamais le nombre de ses inscriptions ; sa page garde ce que publie son tirage. Connecté, vous y lisez, pour chaque sortie, si vous y avez pris part (une inscription non retirée au moment du tirage, ou une place réservée directement) et si vous y avez obtenu une pièce (votre inscription confirmée), et à combien de sorties vous avez pris part.",
        "**Le salon privé.** ORBES peut réserver des modèles aux propriétaires d'une pièce (THE PRIVATE SALON). Chaque modèle est présenté, avec un prix indicatif, aux comptes connectés dont le palier atteint celui qu'ORBES fixe pour lui (TITANE, PLATINE ou PALLADIUM) ; au-dessous de ce palier, il n'est pas présenté. Depuis la fiche d'un modèle, un compte peut le demander, avec une note facultative de 500 caractères au plus. Une demande n'engage ni le compte ni ORBES et ne forme aucun contrat : ORBES Client Services contacte le compte et conclut avec lui toute vente, hors du service. Rien n'est payé sur le service, et il n'envoie aucun e-mail. Un compte a une seule demande ouverte par modèle ; une fois qu'ORBES Client Services l'a close, acceptée ou refusée, avec une note de ce qui a été fait, le compte peut demander le modèle de nouveau. Une demande acceptée devient une commande (article 14). Ni votre note ni celle d'ORBES Client Services ne sont inscrites au journal d'audit du service.",
      ],
    },
    {
      id: 'article-13',
      title: 'Article 13 — LIVE RELEASES',
      blocks: [
        "Une LIVE RELEASE est une sortie qui se vit en direct, sans tirage : ORBES l'annonce sur le service (THE RELEASES) avec le jour et l'heure de son ouverture, son prix, sa quantité telle qu'ORBES la formule (par exemple « 25 PIECES »), les pièces que chacun peut prendre et qui peut y entrer. Sa pièce peut se révéler par étapes, une silhouette, puis son nom, puis sa photographie, chacune à l'heure que donne sa page. Une sortie peut annoncer une surprise dans chaque boîte (A SURPRISE IN EVERY BOX) : la même pour chaque pièce de la sortie, sa page ne dit pas ce qu'elle est. ORBES peut annuler une LIVE RELEASE tant que sa salle n'est pas ouverte.",
        "**Qui peut entrer.** ORBES fixe, pour chaque LIVE RELEASE, qui peut y entrer : tout compte ORBES, les propriétaires à partir d'un palier (article 12), les propriétaires d'une pièce d'un modèle ou d'une collection qu'elle nomme, les comptes qui ont pris part à un nombre de sorties qu'elle indique, ou des collectionneurs choisis, un groupe de comptes qu'ORBES compose sans le nommer. Quand une sortie fixe plusieurs de ces règles, sa page dit si un compte doit les remplir toutes ou l'une d'elles. Un compte prend part à une sortie quand il a eu une place dans la file d'une LIVE RELEASE une fois son ouverture passée, quelle qu'en soit l'issue, sauf si ORBES a retiré son entrée, ou quand il avait à une sortie une inscription non retirée au moment du tirage, ou une place réservée directement pendant son accès anticipé ; une sortie compte une fois, une salle d'après compte comme la sortie qu'elle suit, une sortie annulée ne compte jamais, et une sortie ne compte jamais pour sa propre règle. Le service vérifie ces règles quand vous dites I'LL BE THERE, quand vous entrez et quand vous sécurisez une pièce : un compte qui ne les remplit plus à ce moment est refusé.",
        "**I'LL BE THERE.** De l'annonce à l'ouverture, un compte qui remplit la règle peut dire qu'il sera là, avec une taille, changer cette taille et le retirer. Le service affiche combien de comptes l'ont dit, jamais lesquels. Cela ne réserve rien et ne vous oblige à rien.",
        "**La salle.** La salle ouvre 5 minutes avant l'ouverture, sauf si la sortie fixe un autre délai, de 1 à 60 minutes. Vous y entrez connecté, avec une taille de la sortie. Un compte entre une fois dans une sortie, pour une pièce sauf si la sortie en offre davantage, jusqu'à 5. Une entrée par personne : ORBES Client Services peut refuser de conclure la réservation d'un second compte de la même personne. Vous pouvez changer de taille et quitter la salle jusqu'à l'ouverture ; à partir de l'ouverture, votre taille ne change plus. Seuls les comptes qui peuvent entrer dans une sortie, ou qui y ont une entrée, voient sa salle. Les heures sont celles du serveur d'ORBES.",
        "**La file.** À l'ouverture, les comptes de la salle forment la file. Sauf si la sortie en dispose autrement, la file suit d'abord le palier, lu à l'ouverture : PALLADIUM, PLATINE, TITANE, puis les comptes sans palier. Dans un palier, ou pour tous les comptes quand la sortie ne suit pas les paliers, l'ordre est celui du SHA-256 d'une graine de la sortie suivie de l'identifiant de l'entrée : la graine est tirée et scellée à la création de la sortie, et n'est jamais publiée. Un compte qui quitte la salle avant l'ouverture peut y entrer de nouveau ; une entrée qui a eu sa place dans la file n'y revient jamais. Un compte qui entre après l'ouverture choisit sa taille en entrant et prend place derrière la file, dans l'ordre d'arrivée.",
        "**Votre tour.** Quand assez de pièces de votre taille sont libres pour la quantité choisie et que vous êtes le suivant de la file dans cette taille, c'est votre tour. Vous avez alors 30 secondes, sauf si la sortie fixe un autre délai (de 10 à 300 secondes, qui peut varier selon le palier), pour appuyer à l'écran sur l'ORBES CODE de la salle, un spécimen qui n'est le code d'aucune pièce, et le maintenir jusqu'à ce que son anneau soit plein. Le service ne sécurise la pièce que pour un appui d'au moins 1,4 seconde, mesuré par sa propre horloge. Un tour qui n'est pas pris à temps passe, et sa pièce va au suivant de la file.",
        "**Votre pièce.** Une fois sécurisée, la pièce vous est tenue pendant 5 minutes, sauf si la sortie fixe un autre délai (de 1 à 60 minutes, qui peut varier selon le palier). Pendant ce temps, vous pouvez choisir les options que propose la sortie, 6 au plus, par exemple une gravure, un coffret ou ORBES Care, chacune au prix que fixe la sortie, gardé tel qu'il était quand vous l'avez choisie ; puis presser PAY, ou rendre la pièce avec RELEASE MY PLACE. Une pièce qui n'est pas confirmée à temps n'est plus tenue, et ses options tombent avec elle.",
        "**PAY.** PAY confirme la réservation de la pièce tenue, avec ses options et leur total, et crée sa commande, une par pièce (article 14). Rien n'est payé sur le service : ORBES Client Services vous contacte pour le paiement et la livraison, puis conclut la vente avec vous, hors du service, ou annule la commande. MY PIECES montre votre réservation, sa référence et sa commande.",
        "**Une pièce qui revient.** Une pièce dont le tour passe, dont la tenue prend fin, qui est rendue, ou dont ORBES retire l'entrée, revient à la file : le compte suivant de la file dans sa taille reçoit aussitôt un tour.",
        "**Ce qu'ORBES peut faire.** Pendant une sortie, ORBES peut la suspendre, aucun tour n'étant alors donné et les tours et les tenues en cours s'arrêtant, puis reprenant avec le temps qui leur restait ; prolonger sa fin ; ajouter des pièces à une taille ; faire passer une personne de la file à son tour aussitôt ; retirer une entrée ; ou mettre fin à la sortie avant son terme. La quantité annoncée est celle qu'ORBES propose ; ORBES peut néanmoins ajouter des pièces pendant la sortie, et chaque ajout est enregistré.",
        "**Aucune pièce garantie.** Dire I'LL BE THERE, entrer dans la salle ou la file, être invité d'une salle d'après, et même un tour, ne donnent droit à aucune pièce tant qu'elle n'est pas sécurisée : les pièces sont limitées, et vont à la file dans son ordre.",
        "**La fin.** Une LIVE RELEASE prend fin quand toutes ses pièces sont confirmées (SOLD OUT), à l'heure de fin que donne sa page, ou quand ORBES y met fin. Dès lors, aucun tour n'est donné et les comptes qui attendent encore quittent la file ; quand ORBES y met fin, un tour en cours prend fin aussi. À l'heure de fin, un tour en cours peut encore être sécurisé jusqu'à son échéance ; dans tous les cas, une pièce tenue peut encore être confirmée jusqu'à la sienne. Une réservation annulée après la fin ne revient pas à la file : ORBES Client Services s'en occupe. La sortie passe alors dans l'onglet PAST de THE RELEASES, telle qu'elle a été annoncée ; votre entrée et son issue restent dans MY PIECES. Sa page affiche alors THIS RELEASE IS OVER, sans aucun chiffre de sa fin, et, connecté, dit si vous y avez pris part et si vous y avez obtenu une pièce. Le service n'envoie aucun e-mail.",
        "**La salle d'après.** ORBES peut faire suivre une LIVE RELEASE d'une salle d'après (THE AFTER-ROOM), réglée pour cette sortie : son propre modèle, son prix, ses tailles, ses pièces et ses options, avec les délais du tour et de la tenue, les pièces par personne et la surprise de la sortie. Elle n'ouvre que si la sortie est épuisée (SOLD OUT) : les comptes qui attendaient encore dans sa file à cet instant en sont les invités, dans l'ordre qu'ils y avaient, et personne d'autre ne peut la voir. Elle ouvre 10 minutes après l'épuisement, sauf si la sortie fixe un autre délai (de 1 à 60 minutes), et reste ouverte 15 minutes, sauf si elle fixe une autre durée (de 5 à 120 minutes), ou jusqu'à ce que ses propres pièces soient toutes confirmées. Un invité y entre avec une taille et prend dans sa file la place que lui donne son ordre ; les tours, PAY et le reste du présent article s'y appliquent alors comme à toute LIVE RELEASE. Si la sortie prend fin autrement, ou si personne n'attend à son épuisement, il n'y a pas de salle d'après. Elle n'est annoncée nulle part ailleurs, et ne pose pas de question après.",
        "**La question d'après.** Une fois une LIVE RELEASE terminée, fin de sa salle d'après comprise, ORBES peut poser, pendant 7 jours, une question à 2 à 6 réponses (sauf si la sortie en fixe une autre, WHAT WOULD YOU HAVE WANTED?) : sur sa page, aux comptes qui y ont pris part sans obtenir de pièce, et dans MY PIECES, à ceux qui ont dit I'LL BE THERE sans prendre place dans sa file. Répondre se fait d'un geste, est facultatif et ne vous oblige à rien ; vous pouvez changer votre réponse tant que la question est ouverte.",
        "**Ce qui est enregistré.** Pour chaque entrée, le service enregistre le compte, la taille et la quantité, le palier, la place dans la file, l'heure de chaque étape, la durée de l'appui, les options choisies, l'issue de la réservation, la place d'un invité dans une salle d'après et la réponse à la question d'après ; et, de la connexion, son pays et une empreinte à clé de son réseau, jamais son adresse. Cette empreinte est effacée 30 jours après la fin de la sortie. Ces données servent à faire vivre la sortie et à repérer les entrées automatisées ; la [politique de confidentialité](/legal/privacy) en dit plus (article 17).",
      ],
    },
    {
      id: 'article-14',
      title: 'Article 14 — Commandes',
      blocks: [
        "Chaque pièce réservée à un compte est une commande : une pièce d'une LIVE RELEASE confirmée avec PAY (une commande par pièce), une place d'une sortie dont ORBES Client Services confirme la vente, ou une demande du salon privé qu'il accepte (article 12). MY PIECES montre chacune de vos commandes avec sa référence, le modèle, la taille, les options et le prix, et ses étapes avec leurs dates. La taille et le prix d'une commande d'une sortie ou du salon privé se lisent TO BE CONFIRMED tant qu'ORBES Client Services ne les a pas saisis.",
        "**Ses étapes.** Une commande est RESERVED, puis PAID, SHIPPED et DELIVERED. Elle peut être CANCELLED tant qu'elle est RESERVED ou PAID, et RETURNED une fois SHIPPED ou DELIVERED ; aucune autre étape n'est possible. ORBES Client Services enregistre chaque étape ; rien n'est payé sur le service. Une commande n'est PAID qu'une fois son prix saisi.",
        "**Sa pièce.** Pour chaque commande, ORBES tient en stock une pièce de son modèle et de sa taille quand il y en a une, ou prévoit de la fabriquer : l'identité ORBES d'une pièce fabriquée pour une commande est réservée dès qu'elle est prévue, et confirmée quand la pièce est terminée. Une commande annulée libère sa pièce ; une pièce prévue pour elle n'est plus fabriquée, et son identité ORBES réservée est retirée, son numéro n'étant jamais réemployé.",
        "**Livraison.** ORBES Client Services saisit sur la commande le nom et l'adresse de l'acheteur, et le texte d'une éventuelle gravure : le service n'a pas de formulaire pour cela. Une commande est expédiée avec un transporteur et un numéro de suivi, que MY PIECES montre alors avec TRACK THE SHIPMENT, un lien vers la page du transporteur. Elle est DELIVERED quand ORBES Client Services l'enregistre, ou dès que le compte qui l'a passée enregistre sa pièce (article 7) pendant qu'elle est SHIPPED.",
        "**Facture.** Quand une commande est PAID, CONGLOMERAT LLC émet sa facture, numérotée en séquence pour chaque année, en anglais et sans TVA. Quand une commande payée est annulée ou retournée, un avoir annule sa facture en totalité. Ni l'une ni l'autre ne change jamais. MY PIECES les donne en documents PDF, avec le guide d'entretien du modèle et, une fois la pièce enregistrée à votre compte, son certificat de propriété, un document qui dit ce que le registre ORBES en sait, jamais la carte certificat.",
        "**Retour.** Une fois une commande SHIPPED ou DELIVERED, ORBES Client Services peut en enregistrer le retour, avec une note : sa pièce revient dans le stock d'ORBES, ou aux archives. Si la pièce est enregistrée à un compte, ORBES en reprend l'enregistrement : il prend fin, avec tout transfert en attente et chaque lien de certificat de la pièce, et la pièce n'est plus enregistrée à personne. Revenue en stock, la pièce reçoit un nouveau claim code ; archivée, elle est retirée. Un retour s'enregistre une fois et ne se défait pas.",
        "**Ce qui est enregistré.** Pour chaque commande, le service enregistre le compte, sa provenance, le modèle, la taille, le prix, les options, la surprise de sa sortie, le texte de la gravure, le nom et l'adresse de l'acheteur, l'heure de chaque étape avec la note qu'ORBES Client Services peut y ajouter, le transporteur, le numéro de suivi et la valeur déclarée pour son assurance, le lieu où sa pièce est gardée, et ses factures ; la [politique de confidentialité](/legal/privacy) en dit plus (article 17).",
      ],
    },
    {
      id: 'article-15',
      title: 'Article 15 — Le cercle des propriétaires',
      blocks: [
        "ORBES publie dans le cercle des propriétaires (THE CIRCLE), pour les propriétaires d'une pièce, des contenus de la maison : des notes, des invitations et des sondages. Le cercle est gratuit et ne vous oblige à rien. ORBES choisit ce qu'il y publie, et peut modifier ou retirer une publication.",
        "**Accès.** Le cercle est réservé aux comptes ORBES connectés auxquels au moins une pièce est enregistrée (article 12). Chaque publication est réservée à un palier et aux paliers supérieurs, et peut l'être en outre à des collectionneurs choisis (article 13). L'accès est vérifié à chaque consultation : il prend fin avec la dernière pièce enregistrée au compte.",
        "**Invitations.** Vous répondez à une invitation par YES ou NO, dans la limite de ses places. Vous pouvez changer votre réponse jusqu'au début de l'événement. Répondre ne vous oblige à rien.",
        "**Sondages.** Chaque compte vote une fois à un sondage, et ce vote est définitif. Les résultats, en totaux par option, s'affichent une fois votre vote fait.",
        "**Liens.** Une publication ne renvoie qu'à des sites autorisés par ORBES. Le service affiche le nom du site à côté du lien.",
        "**Ce qui est enregistré.** Votre réponse à une invitation est inscrite au journal d'audit du service ; votre vote ne l'est jamais. Les visites du cercle sont comptées par jour, sans aucun compte. Vos réponses et vos votes figurent dans la copie de vos données que vous pouvez demander à ORBES Client Services (article 17).",
      ],
    },
    {
      id: 'article-16',
      title: 'Article 16 — Verrouillage du compte',
      blocks: [
        'ORBES Client Services peut verrouiller un compte ORBES.',
        "Le verrouillage ferme toutes les sessions du compte, révoque son code de récupération, retire ses liens de certificat et ses inscriptions aux sorties pas encore tirées (article 12), clôt ses demandes ouvertes du salon privé (article 12), retire ses entrées en cours dans les LIVE RELEASES et son I'LL BE THERE pour celles qui n'ont pas encore ouvert (article 13), et annule ses transferts en attente. Une place déjà réservée reste tenue jusqu'à ce qu'ORBES Client Services la conclue ou la laisse expirer, ses commandes restent suivies par ORBES Client Services, et ses réponses aux invitations du cercle restent telles quelles. Le compte ne peut plus se connecter, même avec le bon mot de passe. Ses pièces restent enregistrées à son nom. Seul ORBES Client Services lève le verrouillage.",
      ],
    },
    {
      id: 'article-17',
      title: 'Article 17 — Données personnelles',
      blocks: [
        "ORBES traite les données du service (compte, enregistrements, scans, inscriptions et réservations aux sorties, entrées, options et réservations des LIVE RELEASES, réponses aux questions d'après, commandes et leurs factures, réponses et votes du cercle, demandes du salon privé) comme le décrit sa [politique de confidentialité](/legal/privacy), qui dit aussi comment ORBES regroupe les collectionneurs et compte leur activité par heure. Le service ne transmet vos commandes à aucune boutique en ligne. Vous pouvez demander à ORBES Client Services une copie de tout ce que le registre ORBES garde de votre compte. Vos demandes au salon privé, avec vos notes, figurent dans cette copie. Vos entrées aux LIVE RELEASES, avec leurs options, et votre I'LL BE THERE figurent dans cette copie. Vos commandes, avec le nom et l'adresse de l'acheteur, leurs étapes et leurs factures, et vos réponses aux questions d'après figurent dans cette copie.",
      ],
    },
    {
      id: 'article-18',
      title: 'Article 18 — Responsabilité',
      blocks: [
        "ORBES décrit fidèlement ce que vérifie le service et ce qu'il ne vérifie pas (article 4). Un résultat ne garantit pas qu'un objet est celui qu'ORBES a fabriqué : avant un achat, demandez un code de transfert au vendeur, et en cas de doute, ORBES Client Services peut examiner la pièce.",
      ],
    },
    {
      id: 'article-19',
      title: 'Article 19 — Modification des conditions',
      blocks: [
        'ORBES peut modifier les présentes conditions. La version en vigueur et sa date sont publiées sur le service.',
      ],
    },
    {
      id: 'article-20',
      title: 'Article 20 — Droit applicable et litiges',
      blocks: [
        "Les présentes conditions sont régies par le droit de l'État du Wyoming (États-Unis), sans égard à ses règles de conflit de lois. Rien dans ces conditions ne prive un consommateur de la protection des règles impératives de la loi du pays où il réside. En cas de litige, vous pouvez vous adresser d'abord à ORBES Client Services. Tout litige relatif aux présentes conditions relève des tribunaux situés dans le Wyoming (États-Unis), sous réserve de ces règles impératives.",
      ],
    },
  ],
};
export const TERMS = { en: EN, fr: FR } as const;
