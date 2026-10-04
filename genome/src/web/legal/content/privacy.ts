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
      ],
    },
    {
      id: 'releases',
      title: 'Your entries in releases',
      blocks: [
        'When you enter a release with your ORBES account, ORBES records your entry: the account, the release, the time, and what becomes of the entry (entered, withdrawn, place held, waiting list, sale concluded, place lapsed), with the note ORBES Client Services may add when it records the sale concluded or the place lapsed. ORBES processes these data to run the release you enter, under the [terms of use](/legal/terms).',
        'At the draw, ORBES records with each entry the tier and the seniority of its account, read from the pieces registered to it, and its rank. The page of the release then publishes, for each entry, its identifier, its tier, its seniority and its rank, so that anyone can check the order of the draw: never the account, its email address or its name. MY PIECES shows you the identifier of your entry.',
        'ORBES Client Services reads the entries of a release with the email address of their account, to conclude each sale with the accounts selected; a staff member with read-only access sees it masked. The service sends no email.',
        'During the early access of a release, a PLATINE or PALLADIUM account may reserve a place directly. ORBES then records an entry, as for the draw: the account, the release, the time, the tier and seniority of the account at the moment of the request, and until when the place is held. It is kept like the other entries, and is in the copy of your data.',
      ],
    },
    {
      id: 'circle',
      title: 'Your answers and votes in the circle',
      blocks: [
        "The owners' circle is read signed in to your ORBES account, by the owners of a piece. ORBES processes the data below to run the circle you take part in, under the [terms of use](/legal/terms).",
        "When you answer an invitation, ORBES records your answer: the account, the post, YES or NO, and the times of your first answer and of its latest change. ORBES staff read the answers to an invitation with the email address of their account, to welcome the guests; a staff member with read-only access sees it masked. Your answer is also written to the service's audit log, which names your account by its identifier only.",
        'When you vote in a poll, ORBES records your vote: the account, the post, the option chosen and the time. Members see the results only as totals by option, after their own vote. A vote is never written to the audit log.',
        'The visits of the circle are counted per day, as a number only: without any account, address or device.',
        'Your tier (TITANE, PLATINE or PALLADIUM) is computed at each request from the pieces registered to your account. It is not stored, except with an entry in a release (above).',
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
          "- **Answers to the circle's invitations and votes in its polls**: as long as the account exists. The daily count of the circle's visits names no one, and is kept.",
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
      ],
    },
    {
      id: 'releases',
      title: 'Vos inscriptions aux sorties',
      blocks: [
        "Quand vous vous inscrivez à une sortie avec votre compte ORBES, ORBES enregistre votre inscription : le compte, la sortie, l'heure, et ce que devient l'inscription (inscrite, retirée, place réservée, liste d'attente, vente conclue, place expirée), avec la note qu'ORBES Client Services peut y ajouter quand il enregistre la vente conclue ou la place expirée. ORBES traite ces données pour organiser la sortie à laquelle vous vous inscrivez, selon les [conditions générales d'utilisation](/legal/terms).",
        "Au tirage, ORBES enregistre avec chaque inscription le palier et l'ancienneté de son compte, lus sur les pièces qui y sont enregistrées, et son rang. La page de la sortie publie alors, pour chaque inscription, son identifiant, son palier, son ancienneté et son rang, pour que chacun puisse vérifier l'ordre du tirage : jamais le compte, son adresse e-mail ni son nom. MY PIECES vous montre l'identifiant de votre inscription.",
        "ORBES Client Services lit les inscriptions d'une sortie avec l'adresse e-mail de leur compte, pour conclure chaque vente avec les comptes sélectionnés ; un membre du personnel en lecture seule la voit masquée. Le service n'envoie aucun e-mail.",
        "Pendant l'accès anticipé d'une sortie, un compte PLATINE ou PALLADIUM peut réserver directement une place. ORBES enregistre alors une inscription, comme pour le tirage : le compte, la sortie, l'heure, le palier et l'ancienneté du compte au moment de la demande, et l'heure jusqu'à laquelle la place est tenue. Elle est conservée comme les autres inscriptions, et figure dans la copie de vos données.",
      ],
    },
    {
      id: 'circle',
      title: 'Vos réponses et vos votes dans le cercle',
      blocks: [
        "Le cercle des propriétaires se lit connecté à votre compte ORBES, par les propriétaires d'une pièce. ORBES traite les données ci-dessous pour faire vivre le cercle auquel vous participez, selon les [conditions générales d'utilisation](/legal/terms).",
        "Quand vous répondez à une invitation, ORBES enregistre votre réponse : le compte, la publication, YES ou NO, et les heures de votre première réponse et de sa dernière modification. Le personnel d'ORBES lit les réponses à une invitation avec l'adresse e-mail de leur compte, pour accueillir les invités ; un membre du personnel en lecture seule la voit masquée. Votre réponse est aussi inscrite au journal d'audit du service, qui ne désigne votre compte que par son identifiant.",
        "Quand vous votez à un sondage, ORBES enregistre votre vote : le compte, la publication, l'option choisie et l'heure. Les membres ne voient les résultats qu'en totaux par option, après leur propre vote. Un vote n'est jamais inscrit au journal d'audit.",
        'Les visites du cercle sont comptées par jour, comme un simple nombre : sans aucun compte, adresse ni appareil.',
        "Votre palier (TITANE, PLATINE ou PALLADIUM) est calculé à chaque requête à partir des pièces enregistrées à votre compte. Il n'est pas conservé, sauf avec une inscription à une sortie (ci-dessus).",
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
          '- **Réponses aux invitations du cercle et votes de ses sondages** : tant que le compte existe. Le compte quotidien des visites du cercle ne désigne personne, et il est conservé.',
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
