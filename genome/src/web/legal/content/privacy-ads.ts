/**
 * The privacy policy's Advertising measurement section (lot M4, K27 A4; plan §6, step M4.14), shown by /legal/privacy only
 * while the console's conversions are switched on (the banner's PRIVACY link leads to its `#ads`): off, the default and
 * the state at deployment, the page is exactly DOCUMENTS.privacy, today's text; on (GET /api/v1/consent answers
 * `ads.on`), legal/main.ts reads `privacyWithAds`: the section after WORN, and the two sentences the switch makes untrue
 * replaced by their 'on' versions (ADS_SENTENCES: the cookies' «no advertising cookie», the recipients' «shares none
 * for advertising»), with, under the version line, «Advertising measurement: since <the Paris day it was switched on>»
 * (ADS_SINCE). Its words are the code's (test/web/legal.content.test.ts holds them to it):
 *
 *  - the purpose: measuring ORBES's ads on Meta, TikTok and Google, from the server only (server/ads/http.ts, the one
 *    client out, to the four ADS_HOSTS; no pixel, no platform script, no platform cookie: the CSP loads nothing from
 *    another site);
 *  - the basis: consent, given in the banner (ACCEPT, views/consent-banner.ts), refused there (DECLINE), withdrawn at any
 *    time in YOUR PROFILE (ADVERTISING MEASUREMENT, views/account.ts), without effect on what was sent before; a
 *    withdrawal cancels what is queued and erases the click ids (services/ads.ts choose);
 *  - which platform hears: only one the collector came from, its last link's channel mapped to it or its click id
 *    clicked within AD_CLICK_WINDOW_DAYS (90) before the act; Google with a Google click id only; nothing done before
 *    the first switch on (`events_from`);
 *  - what is sent at most (server/ads/event.ts AdEvent) and what never is (§3.1: no name, phone, address, IP address,
 *    piece, model, size or release; no test entrant, no account of the team, no account not ACTIVE, no welcome gift, no
 *    size exchange, no piece won free in THE VAULT, no order of an online store, no act past 7 days for Meta and
 *    TikTok, 90 for Google: services/ads.ts enqueue, adsSendsFor, AD_MAX_AGE_DAYS);
 *  - the click ids (`fbclid`, `ttclid`, `gclid`, `gbraid`, `wbraid`) held in the page's memory until a choice
 *    (verify/arrival.ts), kept with GRANTED only, AD_CLICK_RETENTION_DAYS (90) after the click;
 *  - the consent's record (`ad_consents`: the choice, BANNER or ACCOUNT, its time, ADS_TEXT_VERSION, the user agent with
 *    GRANTED; never changed), on the device's pseudonym signed out, with the account once signed in, in the copy of the
 *    data (AccountExport.advertising);
 *  - each platform an independent controller under its own policy, linked; transfers outside the EU under their terms;
 *  - how long each is kept (AD_RETENTION_WORDS: an account's choices with the account, a device's 13 months, click ids
 *    and events AD_CLICK_RETENTION_DAYS and AD_EVENT_RETENTION_DAYS).
 *
 * Not validated by counsel: it goes to counsel before the switch is turned on (docs/legal/counsel-note.fr.md).
 *
 * ADS_TEXT_VERSION: the section's own version, the Paris date of its final commit (`YYYY-MM-DD`), recorded with each
 * advertising choice (`ad_consents.text_version`) and answered by GET /api/v1/consent. The server cannot read the web's
 * files (Dockerfile): services/ads.ts holds the same date, and test/services/ads.test.ts holds the two equal. Its words
 * are pinned to it by their own fingerprint (test/web/legal.content.test.ts): a word changed without a new version fails.
 */
import { dateInWords } from './index.js';
import type { Lang, LegalDocument, LegalSection } from './types.js';

export const ADS_TEXT_VERSION = '2026-10-26';

/** The section's anchor (the banner's `/legal/privacy#ads`), the same in both languages. */
export const ADS_SECTION_ID = 'ads';

/** The section it follows on the page: WORN, the last of what the service records, before the cookies. */
export const ADS_AFTER = 'worn';

export const ADS_SECTION: Readonly<Record<Lang, LegalSection>> = Object.freeze({
  en: {
    id: ADS_SECTION_ID,
    title: 'Advertising measurement',
    blocks: [
      "To measure its ads on Meta, TikTok and Google, and only with your consent, ORBES tells these platforms, from its own server, when you create your account, enter a release or a LIVE RELEASE, or pay an order after coming from one of their ads. No pixel, script or cookie of these platforms is placed in your browser: nothing is sent to them from your device.",
      "ORBES processes these data on your consent, given in the banner the app shows (ACCEPT), or refused there (DECLINE). You may withdraw it at any time in YOUR PROFILE, with ADVERTISING MEASUREMENT: nothing more is sent for your account, and what was waiting to be sent is cancelled. Withdrawing it has no effect on what was sent before.",
      "An act is told only to a platform you came from: the one whose ad led you to the link you followed, or the one whose click identifier the address of your visit carried in the 90 days before the act; Google only when you came with one of its click identifiers. Nothing you did before ORBES switched this measurement on is ever sent.",
      'For each act, ORBES sends that platform, at most:',
      [
        '- what the act is (an account created, an entry in a release, an entry in a LIVE RELEASE, an order paid), its time and an identifier of the event;',
        '- a hash (SHA-256) of the email address of your account, and a hash of a pseudonymous identifier of your account, never the identifier itself;',
        '- the country of your account;',
        "- the platform's click identifier, when the address of your visit carried one;",
        '- the identification string of your browser (its user agent), recorded with your consent;',
        '- for an order paid, its amount and its currency.',
      ].join('\n'),
      "ORBES never sends your name, your phone, your address, your IP address, a piece, a model, a size or a release. Nothing is sent for the accounts of test entrants or of the ORBES team, for an account that is locked, for a welcome gift, a size exchange, a piece won free in THE VAULT or an order paid on an online store of ORBES, nor for an act older than 7 days for Meta and TikTok, or 90 days for Google.",
      "When the address of your visit carries a click identifier of one of these platforms (fbclid, ttclid, gclid, gbraid or wbraid), the app keeps it only in the page's memory until you choose: it is recorded with your consent, and dropped otherwise. DECLINE, or withdrawing your consent, erases those already recorded.",
      "ORBES records each choice, ACCEPT or DECLINE, with its time, where you made it (the banner or YOUR PROFILE), the version of this section and, with ACCEPT, the identification string of your browser: with the pseudonym of your device while you are signed out, and with your account once you sign in. A choice is never changed: a new choice is a new record. The copy of your data includes your choices, your click identifiers and the events sent for your account (see [Your rights](#rights)).",
      'Meta, TikTok and Google each process what they receive as independent controllers, under their own privacy policies: [Meta](https://www.facebook.com/privacy/policy/), [TikTok](https://www.tiktok.com/legal/page/eea/privacy-policy/en) and [Google](https://policies.google.com/privacy). They may process these data outside the European Union, under the safeguards their own terms provide.',
      'Each event is kept 90 days after it is sent, fails, is skipped or is cancelled; each click identifier, 90 days after the click; a choice made on a device while signed out, 13 months; a choice made with your account, as long as the account exists, as the proof of your consent.',
    ],
  },
  fr: {
    id: ADS_SECTION_ID,
    title: 'Mesure publicitaire',
    blocks: [
      "Pour mesurer ses publicités sur Meta, TikTok et Google, et seulement avec votre consentement, ORBES informe ces plateformes, depuis son propre serveur, quand vous créez votre compte, vous inscrivez à une sortie ou entrez dans une LIVE RELEASE, ou payez une commande après être venu de l'une de leurs publicités. Aucun pixel, script ni cookie de ces plateformes n'est déposé dans votre navigateur : rien ne leur est envoyé depuis votre appareil.",
      "ORBES traite ces données sur votre consentement, donné dans le bandeau que montre l'application (ACCEPT), ou refusé là (DECLINE). Vous pouvez le retirer à tout moment dans YOUR PROFILE, avec ADVERTISING MEASUREMENT : plus rien n'est envoyé pour votre compte, et ce qui attendait d'être envoyé est annulé. Le retrait est sans effet sur ce qui a été envoyé avant.",
      "Un acte n'est signalé qu'à une plateforme d'où vous êtes venu : celle dont la publicité vous a mené au lien que vous avez suivi, ou celle dont l'adresse de votre visite portait l'identifiant de clic dans les 90 jours avant l'acte ; Google seulement quand vous êtes venu avec l'un de ses identifiants de clic. Rien de ce que vous avez fait avant qu'ORBES active cette mesure n'est jamais envoyé.",
      'Pour chaque acte, ORBES envoie à cette plateforme, au plus :',
      [
        "- ce qu'est l'acte (un compte créé, une inscription à une sortie, une entrée dans une LIVE RELEASE, une commande payée), son heure et un identifiant de l'événement ;",
        "- une empreinte (SHA-256) de l'adresse e-mail de votre compte, et une empreinte d'un identifiant pseudonyme de votre compte, jamais l'identifiant lui-même ;",
        '- le pays de votre compte ;',
        "- l'identifiant de clic de la plateforme, quand l'adresse de votre visite en portait un ;",
        "- la chaîne d'identification de votre navigateur (son user agent), enregistrée avec votre consentement ;",
        '- pour une commande payée, son montant et sa devise.',
      ].join('\n'),
      "ORBES n'envoie jamais votre nom, votre téléphone, votre adresse, votre adresse IP, une pièce, un modèle, une taille ni une sortie. Rien n'est envoyé pour les comptes des participants de test ou de l'équipe ORBES, pour un compte verrouillé, pour un cadeau de bienvenue, un échange de taille, une pièce gagnée gratuitement dans THE VAULT ou une commande payée sur une boutique en ligne d'ORBES, ni pour un acte de plus de 7 jours pour Meta et TikTok, ou de 90 jours pour Google.",
      "Quand l'adresse de votre visite porte un identifiant de clic de l'une de ces plateformes (fbclid, ttclid, gclid, gbraid ou wbraid), l'application ne le garde que dans la mémoire de la page jusqu'à votre choix : il est enregistré avec votre consentement, et abandonné sinon. DECLINE, ou le retrait de votre consentement, efface ceux déjà enregistrés.",
      "ORBES enregistre chaque choix, ACCEPT ou DECLINE, avec son heure, l'endroit où vous l'avez fait (le bandeau ou YOUR PROFILE), la version de cette section et, avec ACCEPT, la chaîne d'identification de votre navigateur : avec le pseudonyme de votre appareil tant que vous n'êtes pas connecté, et avec votre compte une fois connecté. Un choix n'est jamais modifié : un nouveau choix est un nouvel enregistrement. La copie de vos données comprend vos choix, vos identifiants de clic et les événements envoyés pour votre compte (voir [Vos droits](#rights)).",
      "Meta, TikTok et Google traitent chacun ce qu'ils reçoivent en responsables de traitement indépendants, selon leurs propres politiques de confidentialité : [Meta](https://www.facebook.com/privacy/policy/), [TikTok](https://www.tiktok.com/legal/page/eea/privacy-policy/en) et [Google](https://policies.google.com/privacy). Ils peuvent traiter ces données hors de l'Union européenne, avec les garanties que prévoient leurs propres conditions.",
      "Chaque événement est conservé 90 jours après son envoi, son échec, son abandon ou son annulation ; chaque identifiant de clic, 90 jours après le clic ; un choix fait sur un appareil sans être connecté, 13 mois ; un choix fait avec votre compte, tant que le compte existe, comme preuve de votre consentement.",
    ],
  },
});

/**
 * The two sentences of today's privacy policy that the switch makes untrue, and their words while it is on (plan §6):
 * in each, `off` is the block as DOCUMENTS.privacy holds it (word for word: legal.content.test.ts), `on` its 'on'
 * version. The cookies' sentence keeps its first half; the recipients' block keeps its DB-IP sentence word for word.
 */
export interface AdsSentence {
  /** The section that holds it. */
  readonly section: string;
  readonly off: string;
  readonly on: string;
}

export const ADS_SENTENCES: Readonly<Record<Lang, readonly AdsSentence[]>> = Object.freeze({
  en: [
    {
      section: 'cookies',
      off: 'The verification service sets only the cookies below, its own. It sets no advertising or audience-measurement cookie and loads no script from another site.',
      on: 'The verification service sets only the cookies below, its own. It sets no advertising or audience-measurement cookie, loads no script from another site; with your consent, it tells ad platforms about some of your acts from its server (see [Advertising measurement](#ads)).',
    },
    {
      section: 'recipients',
      off: 'DB-IP supplies the location database, which ORBES installs on its own server: nothing is sent to DB-IP. ORBES sells no data and shares none for advertising.',
      on: 'DB-IP supplies the location database, which ORBES installs on its own server: nothing is sent to DB-IP. ORBES sells no data; it shares data for advertising only with your consent, as [Advertising measurement](#ads) says.',
    },
  ],
  fr: [
    {
      section: 'cookies',
      off: "Le service de vérification ne dépose que les cookies ci-dessous, les siens. Il ne dépose aucun cookie publicitaire ni de mesure d'audience et ne charge aucun script d'un autre site.",
      on: "Le service de vérification ne dépose que les cookies ci-dessous, les siens. Il ne dépose aucun cookie publicitaire ni de mesure d'audience, ne charge aucun script d'un autre site ; avec votre consentement, il informe des plateformes publicitaires de certains de vos actes depuis son serveur (voir [Mesure publicitaire](#ads)).",
    },
    {
      section: 'recipients',
      off: "DB-IP fournit la base de localisation, qu'ORBES installe sur son propre serveur : rien n'est envoyé à DB-IP. ORBES ne vend aucune donnée et n'en partage aucune à des fins publicitaires.",
      on: "DB-IP fournit la base de localisation, qu'ORBES installe sur son propre serveur : rien n'est envoyé à DB-IP. ORBES ne vend aucune donnée ; il ne partage des données à des fins publicitaires qu'avec votre consentement, comme le dit [Mesure publicitaire](#ads).",
    },
  ],
});

/** The line under the version line while the switch is on: since the Paris day it was switched on. */
export const ADS_SINCE: Readonly<Record<Lang, (isoDate: string) => string>> = Object.freeze({
  en: (d: string) => `Advertising measurement: since ${dateInWords(d, 'en')}`,
  fr: (d: string) => `Mesure publicitaire : depuis le ${dateInWords(d, 'fr')}`,
});

/**
 * The privacy policy while conversions are switched on: `doc` (DOCUMENTS.privacy in `lang`) with the section after WORN
 * and the two sentences in their 'on' words. Throws when a sentence is not found as written: the two texts move together.
 */
export function privacyWithAds(doc: LegalDocument, lang: Lang): LegalDocument {
  const sentences = ADS_SENTENCES[lang];
  const sections = doc.sections.map((sec) => {
    const mine = sentences.filter((x) => x.section === sec.id);
    if (mine.length === 0) return sec;
    const blocks = sec.blocks.map((b) => mine.find((x) => x.off === b)?.on ?? b);
    for (const x of mine) if (!blocks.includes(x.on)) throw new Error(`legal: the ${lang} ${sec.id} sentence is not as written`);
    return { ...sec, blocks };
  });
  const at = sections.findIndex((sec) => sec.id === ADS_AFTER);
  if (at < 0 || sections.some((sec) => sec.id === ADS_SECTION_ID)) throw new Error('legal: no place for Advertising measurement');
  return { ...doc, sections: [...sections.slice(0, at + 1), ADS_SECTION[lang], ...sections.slice(at + 1)] };
}
