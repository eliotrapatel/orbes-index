/**
 * The legal notice (J-06), published from its drafts,
 * docs/legal/legal-notice.en.md and legal-notice.fr.md (J-04), section by
 * section and in their words (test/web/legal.content.test.ts holds it to
 * them). Until ORBES gives its legal identity (company name, legal form and
 * share capital, RCS, registered office, VAT number, publication director:
 * the plan's "Ce dont j'aurai besoin de toi", item 3), the page reads ORBES
 * where the company is named and leaves the other fields out, so no empty
 * field shows; the hosts' phone numbers and OVHcloud's entity wait the same
 * way. The contact of ORBES Client Services is shown under the publisher
 * when the server publishes one (GET /api/v1/client-services).
 *
 * When the identity comes: fill the drafts' [À COMPLÉTER] fields, then copy
 * them here (LEGAL_IDENTITY names what the page shows meanwhile).
 */
import type { LegalDocument } from './types.js';

/** What the page shows for the fields of the legal identity that ORBES has not given yet. */
export const LEGAL_IDENTITY = Object.freeze({
  /** The drafts' [À COMPLÉTER: company name] / [À COMPLÉTER : raison sociale]. */
  companyName: 'ORBES',
  /** The drafts' [À COMPLÉTER: name of the publication director] / [À COMPLÉTER : nom du directeur de la publication]. */
  publicationDirector: 'ORBES',
});

const EN: LegalDocument = {
  title: 'Legal notice',
  summary: 'Who publishes theorbes.com and verify.theorbes.com, who hosts them, and the credits.',
  intro: [
    'This notice covers theorbes.com and verify.theorbes.com.',
    'This notice is published under French law no. 2004-575 of 21 June 2004 on confidence in the digital economy.',
  ],
  sections: [
    {
      id: 'publisher',
      title: 'Publisher',
      blocks: [`- Company name: ${LEGAL_IDENTITY.companyName}\n- Contact: ORBES Client Services`, { contact: true }],
    },
    {
      id: 'publication-director',
      title: 'Publication director',
      blocks: [LEGAL_IDENTITY.publicationDirector],
    },
    {
      id: 'hosting',
      title: 'Hosting',
      blocks: [
        '- **theorbes.com**: Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, United States.\n- **verify.theorbes.com** (verification of pieces, ORBES accounts): OVHcloud. The server is located in Canada.',
      ],
    },
    {
      id: 'intellectual-property',
      title: 'Intellectual property',
      blocks: [
        'The ORBES, ORBES CODE and ORBES GENOME marks, the ORBES monogram, and the texts, images and graphic elements of the sites belong to ORBES or its partners. Any reproduction or representation, in whole or in part, without the written permission of ORBES is prohibited (French Intellectual Property Code).',
      ],
    },
    {
      id: 'credits',
      title: 'Credits',
      blocks: [
        '- Approximate location of scans: [IP Geolocation by DB-IP](https://db-ip.com) (db-ip.com), under the [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) licence.\n- Display typeface: Gravesend Sans, Rian Hughes / Device.',
      ],
    },
    {
      id: 'personal-data',
      title: 'Personal data and terms',
      blocks: [
        'The processing of personal data is described in the ORBES [privacy policy](/legal/privacy). The use of the verification service and of the ORBES account is governed by the [terms of use](/legal/terms).',
      ],
    },
  ],
};

const FR: LegalDocument = {
  title: 'Mentions légales',
  summary: "Qui édite theorbes.com et verify.theorbes.com, qui les héberge, et les crédits.",
  intro: [
    'Ces mentions valent pour theorbes.com et verify.theorbes.com.',
    "Ces mentions sont publiées en application de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique.",
  ],
  sections: [
    {
      id: 'publisher',
      title: 'Éditeur',
      blocks: [`- Raison sociale : ${LEGAL_IDENTITY.companyName}\n- Contact : ORBES Client Services`, { contact: true }],
    },
    {
      id: 'publication-director',
      title: 'Directeur de la publication',
      blocks: [LEGAL_IDENTITY.publicationDirector],
    },
    {
      id: 'hosting',
      title: 'Hébergement',
      blocks: [
        '- **theorbes.com** : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.\n- **verify.theorbes.com** (vérification des pièces, comptes ORBES) : OVHcloud. Le serveur est situé au Canada.',
      ],
    },
    {
      id: 'intellectual-property',
      title: 'Propriété intellectuelle',
      blocks: [
        "Les marques ORBES, ORBES CODE et ORBES GENOME, le monogramme ORBES, les textes, images et éléments graphiques des sites sont la propriété d'ORBES ou de ses partenaires. Toute reproduction ou représentation, totale ou partielle, sans autorisation écrite d'ORBES est interdite (Code de la propriété intellectuelle).",
      ],
    },
    {
      id: 'credits',
      title: 'Crédits',
      blocks: [
        '- Géolocalisation approximative des scans : [IP Geolocation by DB-IP](https://db-ip.com) (db-ip.com), sous licence [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/deed.fr).\n- Police de titres : Gravesend Sans, Rian Hughes / Device.',
      ],
    },
    {
      id: 'personal-data',
      title: 'Données personnelles et conditions',
      blocks: [
        "Le traitement des données personnelles est décrit dans la [politique de confidentialité](/legal/privacy) d'ORBES. L'utilisation du service de vérification et du compte ORBES est régie par les [conditions générales d'utilisation](/legal/terms).",
      ],
    },
  ],
};

export const NOTICE = { en: EN, fr: FR } as const;
