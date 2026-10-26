/**
 * The content of the legal pages (J-06): the four documents in English and
 * French, the words of the pages around them, and LEGAL_VERSION, the date of
 * this version of the texts, shown under each title. Change LEGAL_VERSION
 * with any change of a text: the terms (article 19, docs/legal/TERMS-FACTS.md
 * R57) and the privacy policy tell their readers that the version in force
 * and its date are shown here. test/web/legal.content.test.ts pins the
 * fingerprint of DOCUMENTS to this version: a text changed without a new
 * version fails it.
 */
import type { LegalPage } from '../../shared/legal.js';
import { FAQ } from './faq.js';
import { NOTICE } from './notice.js';
import { PRIVACY } from './privacy.js';
import { TERMS } from './terms.js';
import type { Lang, LegalDocument } from './types.js';

export { LANGS, type Block, type Lang, type LegalDocument, type LegalSection } from './types.js';

/**
 * The date of this version of the four texts (ISO 8601): one per deployment, dated the day of that deployment, and a
 * date already published never changes. 2026-10-04 was deployment A of the plan of 2026-10-03 (the releases, their
 * early access, the circle, the tiers' benefits). 2026-10-05 was the one version of deployment B+C (stages B and C
 * combined): the terms' article 4 (a model discontinued, P-R06), article 11 (ORBES Care, P-M02), article 12 (the
 * private salon, P-X08) and articles 1, 2, 3, 14 and 15 (now 15 and 16); the privacy policy's requests of the private
 * salon, ORBES Care's page and the sound preference kept on the device (P-D07); the FAQ's sound. 2026-10-06 is the one
 * version of deployment D, the LIVE RELEASE (plan of 2026-10-04): the terms' article 13 (the LIVE RELEASES, the circle
 * becoming article 14 and those after it moving by one), articles 1, 2, 3, 15 and 16, and the privacy policy's LIVE
 * RELEASES; it went live with deployment D on 2026-10-05, a day before its date. 2026-10-07 is the one version of
 * deployment E, LIVE RELEASE+ (plan of 2026-10-04): the terms' article 14 (the orders, the circle becoming article 15
 * and those after it moving by one), articles 1, 2, 3, 7, 10, 12, 13 (the after-room, the surprise, the access by
 * participation and by segment, PAST, the question after), 15, 16 and 17, and the privacy policy's orders, segments,
 * client sheet and hourly activity; the next date the rule allows after D's published 2026-10-06, set mechanically
 * (docs/launch/DEPLOY-LIVE-RELEASE-PLUS.md §0). 2026-10-08 is the one version of deployment G, the next nine (plan of
 * 2026-10-06): the privacy policy's messages with ORBES Client Services (CS-01) and its saved sizes (AC-01); the terms'
 * article 12, its tiers at 1, 5 and 10 pieces, its early access by tier and its benefits paragraph (BP-19). The build's
 * start date, 2026-10-06, and its final commit's, 2026-10-07, are not after E's published 2026-10-07, so the version is
 * the day after it, as the plan's rule sets it. Its date never holds the deployment. 2026-10-09 is the version of
 * deployment H1 of the next lot (plan of 2026-10-07, §3.2): the terms' article 2 (the ORBES CODE printed on the
 * certificate card, the claim code printed on it) and its claim-code paragraph, and the FAQ's three answers on the
 * card, which named a scratch-off panel the card 79t no longer has; the build's date, 2026-10-07, is not after G's
 * 2026-10-08, so the version is the day after it, set mechanically. Step 4.7 moves it to the date of H1's final commit.
 * 2026-10-10 is the first version of deployment H2 (plan of 2026-10-07, §3.5.11, step 5.5): the terms' « Its piece »
 * paragraph and the privacy policy's engraving clause, which the atelier's removal made untrue (an order waits for
 * supplier stock; no piece is made for it); the build's date, 2026-10-08, is not after H1's 2026-10-09, so the version
 * is the day after it, set mechanically. Steps 5.14 and 6.12 move its fingerprint; the finish step moves it to the date
 * of H2's final commit. The customer intelligence (deployments I1 and I2) moved no text: 2026-10-10 stayed in force.
 * 2026-10-15 is the version of ORBES CARE (plan of 2026-10-15, §2(d), step 4.1): the terms' article 11 rewritten whole
 * (ORBES CARE and the two ORBES warranties, PRIVATE CARE, the legal guarantees, the written conditions given as a PDF
 * with each order), articles 1, 2 and 13 without the ORBES Care subscription, and the privacy policy's sentence on a
 * warranty claim in place of the subscription's page; the build's date, after I2's published 2026-10-10, set
 * mechanically. The server's CARE_CONDITIONS_VERSION (src/server/render/care-conditions.ts), the version the ORBES
 * CARE CONDITIONS PDF prints, moves with it (test/web/legal.content.test.ts holds the two equal); the finish step moves
 * both to the date of the build's final commit. Its date never holds the deployment. 2026-10-21 is the version of lot M1
 * of the macro scope (owner's decisions of 2026-10-20, L2; plan step M1.20): the privacy policy's founding list and
 * emails (sections founding-list and emails, the email provider among the recipients, their retention), its sentences
 * that said the service sends no email edited to the minimum, a LIVE RELEASE's admission in batches, a draw opened to a
 * segment; the terms' article 6 (a forgotten password replaced with a link sent by email, where the service offers it),
 * article 12 (a release reserved for selected collectors; no longer "sends no email") and article 13 (the pace; no
 * email about the end); the FAQ's forgotten password. The date of the lot's legal commit, after ORBES CARE's published
 * 2026-10-15. Article 11 did not change: CARE_CONDITIONS_VERSION stays 2026-10-15, the version whose article 11 the
 * ORBES CARE CONDITIONS print (test/web/legal.content.test.ts pins article 11 to it). 2026-10-22 is the version of lot
 * M2 of the macro scope (L2; plan step M2.12): the privacy policy's house messages and WORN (sections house-messages and
 * worn, their retention, everyone among the recipients of a published WORN photograph and its credit), the segments'
 * sentence that said a segment sends no message (its members may receive a house message); the terms' article 15 (WORN:
 * the licence with its credit, the review, the withdrawal); the terms gain no sentence on MESSAGES. The date of the lot's
 * final legal commit, never M1's 2026-10-21. Article 11 did not change: CARE_CONDITIONS_VERSION stays 2026-10-15. The
 * consents recorded with the version in force move with it (FOUNDING_CONSENT_VERSION, WORN_CONSENT_VERSION).
 * 2026-10-23 is the version of lot M3 of the macro scope (L2; plan step M3.20): the privacy policy's YOUR SIZES sentence
 * (saved sizes also counted, without naming anyone, with the account's country, to plan the sizes ORBES orders and
 * where: Z1); the terms' article 14, its add-ons (no ORBES CODE, no tier, offered at the purchase and in YOUR ORDERS
 * until packing, their documents after payment, returned with the order: D1, D2) and THE SET (one price, a size per
 * piece at entry, one per person in a LIVE RELEASE, each piece's identity and tier, its share on each invoice, cancelled
 * and returned whole, a piece's size still exchanged: T1 to T4), and the return paragraph's set returned whole. The date
 * of the lot's final legal commit, never M1's 2026-10-21 nor M2's 2026-10-22. Article 11 did not change:
 * CARE_CONDITIONS_VERSION stays 2026-10-15; the consents recorded with the version in force move with it.
 * 2026-10-24 is the version of lot Q1, ONE QUEUE (owner's decisions D13 and L2; plan step Q1.12): the terms' article 13,
 * its two sentences only, "The pace" (turns given at the release's pace, in the line's order, after an optional wait
 * following the opening) and "A piece that returns" (offered with the release's next turns, at its pace; at once in an
 * after-room); "What ORBES may do" and every other text unchanged. The date of the lot's final legal commit, never M3's
 * published 2026-10-23 (the day after it). Article 11 did not change: CARE_CONDITIONS_VERSION stays 2026-10-15; the
 * consents recorded with the version in force move with it.
 * 2026-10-25 is the version of lot Q2, ADD-ONS ONE SYSTEM (owner's decisions D29 and L2; plan step Q2.10): only the
 * sentences that became false, in both languages. The terms' article 13 "Your piece" (the add-ons the release offers,
 * one for each piece, or one for each set, each at the price shown, said there only: D25) and article 14 "Delivery" (an
 * engraving is an add-on, charged at the price shown; the lot's review: one chosen with the purchase keeps its place on
 * the order and only its words change, any other has its own invoice once paid) and "Add-ons" (offered where ORBES offers it, at the purchase among
 * those its release offers, in the private salon and in YOUR ORDERS: D3, N8; an add-on with stock only if one is still
 * in stock, some being services without stock: D4; in YOUR ORDERS an add-on ORBES offers there). HOW RELEASES WORK and
 * the privacy policy unchanged (N17). The date of the lot's final legal commit (N16), never Q1's 2026-10-24 (the day
 * after it). Article 11 did not change: CARE_CONDITIONS_VERSION stays 2026-10-15; the consents recorded with the version
 * in force move with it.
 * 2026-10-26 is the version of lot Q3, THE VAULT (owner's decisions D22, D23, D59 and L2; plan step Q3.14): the terms'
 * article 13 gains one paragraph, THE VAULT (given on the occasions THE VAULT shows, to eligible collectors, at ORBES's
 * discretion; kept 30 days; opening free, a vault never sold and opening one requiring no purchase; one reward drawn by
 * chance, shown with its odds, a reward run out giving its chance to the I WAS THERE card; rewards expiring as they
 * state, without cash value, not transferable until used but a credit to give; the vaults each occasion gives limited,
 * at most one per account for a LIVE RELEASE; a returned piece taking back its unopened vault), with no clause on taking
 * a vault back for error or abuse (N36), nothing on SOLD OUT and no odds table (D22, D23); the privacy policy gains one
 * sentence, the invitation link kept with the account (N22, read with D70). HOW RELEASES WORK unchanged. The date of the
 * lot's final legal commit, never Q2's published 2026-10-25 (the day after it). Article 11 did not change:
 * CARE_CONDITIONS_VERSION stays 2026-10-15; the consents recorded with the version in force move with it.
 * The review of lot Q3 (L2), the same day and still unpublished, its final legal commit: article 14's first paragraph
 * names THE VAULT's orders (a piece won free, claimed in YOUR ORDERS within 30 days, then PAID at no cost, cancelled if
 * unclaimed; one bought at its usual price within its 24-hour right to buy), and the privacy policy's invitation block
 * adds the vaults kept with the account and the vault a credit to give accepted came from, kept while the account exists
 * and in the copy of its data. The version stays 2026-10-26.
 * 2026-10-27 is the version of lot M4 of the macro scope (owner's decisions K49 P3, K27 A4 and L2; plan step M4.14): the
 * privacy policy's circle gains one paragraph, a partner's experience (with a YES, the guest may tick to share their
 * first and last name with the partner, who otherwise receives only the number of guests; untick until the event
 * begins; the choice in the copy of the data). The terms are unchanged; the margin and THE VAULT's cost need no text.
 * The advertising measurement (K27) is not in DOCUMENTS: its section and its two sentences (privacy-ads.ts, its own
 * ADS_TEXT_VERSION and fingerprint) show only while the console's conversions are switched on. The date of the lot's
 * final legal commit, never Q3's published 2026-10-26 (that commit falls on 26 October in Paris: the day after it).
 * Article 11 did not change: CARE_CONDITIONS_VERSION stays 2026-10-15; the consents recorded with the version in force
 * move with it.
 */
export const LEGAL_VERSION = '2026-10-27';

export const DOCUMENTS: Readonly<Record<LegalPage, Readonly<Record<Lang, LegalDocument>>>> = Object.freeze({
  privacy: PRIVACY,
  terms: TERMS,
  notice: NOTICE,
  faq: FAQ,
});

export interface LegalWords {
  /** The index of /legal: its title and its sentence. */
  indexTitle: string;
  indexLead: string;
  /** The navigation between the four pages: its name and its links, in the order of LEGAL_PAGES. */
  navLabel: string;
  nav: Readonly<Record<LegalPage, string>>;
  /** The language switch: its name. The languages are named in their own words (LANGUAGE_NAMES). */
  languageLabel: string;
  /** The line under a page's title. */
  version: (isoDate: string) => string;
  /** Back to the verification of a piece. */
  verify: string;
  /** The contact of ORBES Client Services, when the server publishes one: the name of its email and phone links. */
  writeTo: string;
  call: string;
}

const MONTHS: Readonly<Record<Lang, readonly string[]>> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};

/** An ISO date (2026-10-03) in words: 3 October 2026, 3 octobre 2026 (1er for the first day in French). */
export function dateInWords(isoDate: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`legal: not an ISO date: ${isoDate}`);
  const day = Number(m[3]);
  const month = MONTHS[lang][Number(m[2]) - 1];
  if (!month || day < 1 || day > 31) throw new Error(`legal: not an ISO date: ${isoDate}`);
  return `${lang === 'fr' && day === 1 ? '1er' : day} ${month} ${m[1]}`;
}

export const WORDS: Readonly<Record<Lang, LegalWords>> = Object.freeze({
  en: {
    indexTitle: 'Legal information',
    indexLead: 'The privacy policy, the terms of use, the legal notice and the answers to frequent questions of the ORBES GENOME CODE service, at theorbes.com/verify.',
    navLabel: 'Legal pages',
    nav: { privacy: 'PRIVACY', terms: 'TERMS', notice: 'LEGAL', faq: 'HELP' },
    languageLabel: 'Language',
    version: (d) => `Version of ${dateInWords(d, 'en')}`,
    verify: 'VERIFY A PIECE',
    writeTo: 'Write to ORBES Client Services',
    call: 'Call ORBES Client Services',
  },
  fr: {
    indexTitle: 'Informations légales',
    indexLead: "La politique de confidentialité, les conditions générales d'utilisation, les mentions légales et les réponses aux questions fréquentes du service ORBES GENOME CODE, sur theorbes.com/verify.",
    navLabel: 'Pages légales',
    nav: { privacy: 'CONFIDENTIALITÉ', terms: 'CONDITIONS', notice: 'MENTIONS LÉGALES', faq: 'AIDE' },
    languageLabel: 'Langue',
    version: (d) => `Version du ${dateInWords(d, 'fr')}`,
    verify: 'VÉRIFIER UNE PIÈCE',
    writeTo: 'Écrire à ORBES Client Services',
    call: 'Appeler ORBES Client Services',
  },
});

/** Each language named in its own words, for the switch: ENGLISH · FRANÇAIS. */
export const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = Object.freeze({ en: 'ENGLISH', fr: 'FRANÇAIS' });
