/**
 * The content of the legal pages (J-06): the four documents in English and
 * French, the words of the pages around them, and LEGAL_VERSION, the date of
 * this version of the texts, shown under each title. Change LEGAL_VERSION
 * with any change of a text: the terms (article 17, docs/legal/TERMS-FACTS.md
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
 * The date of this version of the four texts (ISO 8601): one per deployment, dated the day of that deployment
 * (deployment A of the plan of 2026-10-03: the releases of P-R03 and their early access, P-X02, in the terms, article
 * 12; the owners' circle, P-X01, article 13; the tiers' benefits, P-X04; and the privacy policy).
 */
export const LEGAL_VERSION = '2026-10-04';

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
