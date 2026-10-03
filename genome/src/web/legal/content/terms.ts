/**
 * The terms of use (J-06), published from their drafts, docs/legal/terms.en.md
 * and terms.fr.md (J-04), article by article and in their words: the review
 * lines (*Code: …*) are not published, and a field the drafts leave to
 * complete ([À COMPLÉTER: …]) never shows. The company's name reads ORBES;
 * a clause that waits for counsel's choice is left out of the sentence that
 * holds it, or the sentence goes; nothing else changes. The drafts' links
 * lead to the pages here, and the privacy policy they name is linked.
 * test/web/legal.content.test.ts holds this file to the drafts: a draft that
 * changes fails it until this page follows.
 *
 * Not validated by counsel: published before that review, by the owner's
 * decision (LAUNCH §10, the plan's declared deviation for J-06).
 */
import type { LegalDocument } from './types.js';

const EN: LegalDocument = {
  title: 'Terms of use',
  summary: 'The rules of the verification service and of the ORBES account: what a result says, registration, transfer, loss and theft, the warranty.',
  intro: [],
  sections: [
    {
      id: 'article-1',
      title: 'Article 1 — Purpose',
      blocks: [
        'These terms govern the use of the ORBES GENOME CODE service, available at theorbes.com/verify (served by verify.theorbes.com), and of the ORBES account attached to it: verifying an ORBES piece, registering its ownership, transferring it, reporting its loss or theft, and the ownership certificate.',
        'The service is published by ORBES, whose full identity is given in the [legal notice](/legal/notice). Using the service means accepting these terms. Creating an ORBES account means accepting them expressly.',
      ],
    },
    {
      id: 'article-2',
      title: 'Article 2 — Definitions',
      blocks: [
        '- **Piece**: an ORBES object that carries an ORBES CODE.\n- **ORBES CODE**: the seal printed on the piece, which carries its ORBES identity and the signature of ORBES.\n- **ORBES identity**: the identifier of a piece, issued and signed by ORBES, and its ORBES GENOME, the visual signature derived from it.\n- **ORBES registry**: what ORBES records for each piece: the account of its registered owner, its warranty, its services, reports of its loss or theft.\n- **ORBES account**: the account created on the service with an email address and a password.\n- **Certificate card** and **claim code**: the card delivered with a piece, and the code printed under its scratch-off panel, never on the piece, which allows the first registration.\n- **Transfer code**: the code the registered owner creates to pass on the registration of a piece.\n- **Ownership certificate**: the page, reached through a link the registered owner creates, that shows what the ORBES registry says about a piece.\n- **ORBES Client Services**: the client service of ORBES.',
      ],
    },
    {
      id: 'article-3',
      title: 'Article 3 — Access to the service',
      blocks: [
        "Verifying a piece is free and open to everyone, without an account or a sign-in. The ORBES account is used to register, transfer and follow one's pieces.",
        'ORBES endeavours to keep the service available, without committing to it: it may be interrupted, in particular for maintenance. ORBES has its pieces verified only at theorbes.com/verify, which leads to verify.theorbes.com. Another address, or a code printed beside the piece, does not come from ORBES.',
      ],
    },
    {
      id: 'article-4',
      title: 'Article 4 — What a result says',
      blocks: [
        '**AUTHENTIC qualifies the ORBES identity, not the object.** An AUTHENTIC result (AUTHENTIC — FIRST REGISTRATION, AUTHENTIC — REGISTERED or AUTHENTIC — OWNERSHIP VERIFIED) means that the ORBES identity read was issued and signed by ORBES, and states what the ORBES registry records about it. It does not concern the object presented.',
        '**A copy can verify like the original.** A printed code can be copied: on its own, it cannot prove that the object in your hands is the one ORBES made. The note under every positive result says so. ORBES Client Services can inspect a piece on request.',
        '**UNUSUAL ACTIVITY DETECTED is a request for review, never a verdict.** This result asks you to contact ORBES Client Services before relying on the piece. It accuses neither the piece nor its holder.',
        '**Hardware checks.** No hardware check (secure NFC chip, secure element, seal) is available yet. A piece designed to carry one is verified on its code alone, and the result says so.',
        '**Revocation.** ORBES may revoke an ORBES identity, for example when a code is replaced or a piece is withdrawn. Every verification then reads REVOKED.',
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
        '**One registered owner.** A piece is registered to one account at a time. Once registered, it passes on only through a transfer (article 8).',
        '**Verified ownership.** Registered with the claim code, the ownership is verified. Without a certificate card, it is only registered: ORBES Client Services may confirm it on a proof of purchase.',
        'Registration is not a title of ownership (article 4).',
      ],
    },
    {
      id: 'article-8',
      title: 'Article 8 — Transfer of ownership',
      blocks: [
        '**Creating the code.** Only the registered owner creates a transfer code, from their account. The code is valid for 7 days. A piece has one pending transfer at a time, and the owner can cancel it until it is accepted. A piece in service, revoked or withdrawn, or whose loss or theft has been reported, cannot be transferred. After the recovery of a password, the creation of transfer codes is paused (article 6).',
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
        '**Withdrawal.** A loss you reported yourself, you withdraw from MY PIECES (PIECE FOUND), confirming the password of your account. A theft, or a loss recorded by ORBES Client Services, is withdrawn only by ORBES Client Services, after inspecting the piece.',
        'A report in the ORBES registry does not replace a complaint to the authorities.',
      ],
    },
    {
      id: 'article-10',
      title: 'Article 10 — Ownership certificate',
      blocks: [
        '**Creation.** From MY PIECES, the registered owner creates a link to a certificate of their piece, valid for 1 to 90 days (30 days by default). A piece has at most 10 links valid at a time. The link is shown once: ORBES keeps only a fingerprint of it and cannot show it again. The owner can withdraw a link at any time; a withdrawn link leads nowhere.',
        '**Content.** The certificate shows, read when it is opened, the piece and its ORBES GENOME, the ownership (verified or not) and its date, the warranty, and that no loss or theft is reported. It never shows the name or the email address of the owner.',
        '**End of validity.** The certificate stops being valid when it expires, when the piece changes hands, when its loss or theft is reported, or when it is revoked or withdrawn.',
        '**Scope.** The certificate attests a record in the ORBES registry, not the object it is shown with. To check an object, scan its ORBES CODE.',
      ],
    },
    {
      id: 'article-11',
      title: 'Article 11 — Warranty',
      blocks: [
        "**Start.** The ORBES warranty starts when ORBES, or an authorised retailer listed in the ORBES register of points of sale, activates it, on the date of purchase, for the length set for the category of the piece. In a boutique, the seller activates the warranty within 10 minutes of their scan of the piece, on the day's date and in the country of the point of sale.",
        '**Follow-up.** The service shows the status of the warranty of each piece. The warranty stays with the piece when it changes hands.',
        '**Conditions.** ORBES may void the warranty of a piece in the cases those conditions provide for. The statutory guarantees remain due in every case.',
      ],
    },
    {
      id: 'article-12',
      title: 'Article 12 — Locking an account',
      blocks: [
        'ORBES Client Services may lock an ORBES account.',
        'The lock ends every session of the account, revokes its recovery code, withdraws its certificate links and cancels its pending transfers. The account can no longer sign in, even with the right password. Its pieces stay registered to it. Only ORBES Client Services lifts the lock.',
      ],
    },
    {
      id: 'article-13',
      title: 'Article 13 — Personal data',
      blocks: [
        'ORBES processes the data of the service (account, registrations, scans) as its [privacy policy](/legal/privacy) describes. You can ask ORBES Client Services for a copy of everything the ORBES registry holds about your account.',
      ],
    },
    {
      id: 'article-14',
      title: 'Article 14 — Liability',
      blocks: [
        'ORBES describes faithfully what the service checks and what it does not (article 4). A result does not guarantee that an object is the one ORBES made: before buying, ask the seller for a transfer code, and when in doubt, ORBES Client Services can inspect the piece.',
      ],
    },
    {
      id: 'article-15',
      title: 'Article 15 — Changes to these terms',
      blocks: [
        'ORBES may change these terms. The version in force and its date are published on the service.',
      ],
    },
    {
      id: 'article-16',
      title: 'Article 16 — Applicable law, mediation and disputes',
      blocks: [
        'These terms are governed by French law. In a dispute, you may first turn to ORBES Client Services. You may also use, free of charge, the consumer mediator.',
      ],
    },
  ],
};

const FR: LegalDocument = {
  title: "Conditions générales d'utilisation",
  summary: "Les règles du service de vérification et du compte ORBES : ce que dit un résultat, l'enregistrement, le transfert, la perte et le vol, la garantie.",
  intro: [],
  sections: [
    {
      id: 'article-1',
      title: 'Article 1 — Objet',
      blocks: [
        "Les présentes conditions régissent l'utilisation du service ORBES GENOME CODE, accessible à l'adresse theorbes.com/verify (servie par verify.theorbes.com), et du compte ORBES qui s'y rattache : la vérification d'une pièce ORBES, l'enregistrement de sa propriété, son transfert, la déclaration de sa perte ou de son vol, et le certificat de propriété.",
        "Le service est édité par ORBES, dont l'identité complète figure dans les [mentions légales](/legal/notice). Utiliser le service, c'est accepter les présentes conditions. Créer un compte ORBES, c'est les accepter expressément.",
      ],
    },
    {
      id: 'article-2',
      title: 'Article 2 — Définitions',
      blocks: [
        "- **Pièce** : un objet ORBES qui porte un ORBES CODE.\n- **ORBES CODE** : le sceau imprimé sur la pièce, qui porte son identité ORBES et la signature d'ORBES.\n- **Identité ORBES** : l'identifiant d'une pièce, émis et signé par ORBES, et son ORBES GENOME, la signature visuelle qui en découle.\n- **Registre ORBES** : ce qu'ORBES enregistre pour chaque pièce : compte du propriétaire enregistré, garantie, entretiens, déclarations de perte ou de vol.\n- **Compte ORBES** : le compte créé sur le service avec une adresse e-mail et un mot de passe.\n- **Carte certificat** et **claim code** : la carte remise avec une pièce, et le code imprimé sous sa zone à gratter, jamais sur la pièce, qui permet le premier enregistrement.\n- **Code de transfert** : le code que le propriétaire enregistré crée pour transmettre l'enregistrement d'une pièce.\n- **Certificat de propriété** : la page, accessible par un lien que crée le propriétaire enregistré, qui montre ce que le registre ORBES dit d'une pièce.\n- **ORBES Client Services** : le service client d'ORBES.",
      ],
    },
    {
      id: 'article-3',
      title: 'Article 3 — Accès au service',
      blocks: [
        "La vérification d'une pièce est gratuite et ouverte à tous, sans compte ni connexion. Le compte ORBES sert à enregistrer, transférer et suivre ses pièces.",
        "ORBES s'efforce de maintenir le service accessible, sans s'y engager : il peut être interrompu, notamment pour maintenance. ORBES ne fait vérifier ses pièces qu'à l'adresse theorbes.com/verify, qui mène à verify.theorbes.com. Une autre adresse, ou un code imprimé à côté de la pièce, ne vient pas d'ORBES.",
      ],
    },
    {
      id: 'article-4',
      title: 'Article 4 — Ce que dit un résultat',
      blocks: [
        "**AUTHENTIC qualifie l'identité ORBES, pas l'objet.** Un résultat AUTHENTIC (AUTHENTIC — FIRST REGISTRATION, AUTHENTIC — REGISTERED ou AUTHENTIC — OWNERSHIP VERIFIED) signifie que l'identité ORBES lue a été émise et signée par ORBES, et indique ce que le registre ORBES en sait. Il ne porte pas sur l'objet présenté.",
        "**Une copie peut vérifier comme l'original.** Un code imprimé peut être copié : à lui seul, il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué. La mention placée sous chaque résultat positif le rappelle. ORBES Client Services peut examiner une pièce sur demande.",
        "**UNUSUAL ACTIVITY DETECTED est une demande d'examen, jamais un verdict.** Ce résultat invite à contacter ORBES Client Services avant de se fier à la pièce. Il n'accuse ni la pièce ni son détenteur.",
        "**Contrôles matériels.** Aucun contrôle matériel (puce NFC sécurisée, élément sécurisé, scellé) n'est encore disponible. Une pièce conçue pour en recevoir un est vérifiée sur son seul code, et le résultat le précise.",
        "**Révocation.** ORBES peut révoquer une identité ORBES, par exemple quand un code est remplacé ou qu'une pièce est retirée. Chaque vérification affiche alors REVOKED.",
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
        "**Un propriétaire enregistré.** Une pièce n'est enregistrée qu'à un seul compte à la fois. Déjà enregistrée, elle ne se transmet que par un transfert (article 8).",
        "**Propriété vérifiée.** Enregistrée avec le claim code, la propriété est vérifiée. Sans carte certificat, elle est seulement enregistrée : ORBES Client Services peut la confirmer sur présentation d'une preuve d'achat.",
        "L'enregistrement n'est pas un titre de propriété (article 4).",
      ],
    },
    {
      id: 'article-8',
      title: 'Article 8 — Transfert de propriété',
      blocks: [
        "**Création du code.** Seul le propriétaire enregistré crée un code de transfert, depuis son compte. Le code vaut 7 jours. Une pièce n'a qu'un transfert en attente à la fois, et le propriétaire peut l'annuler tant qu'il n'est pas accepté. Une pièce en entretien, révoquée ou retirée, ou dont la perte ou le vol a été déclaré, ne se transfère pas. Après la récupération d'un mot de passe, la création de codes de transfert est suspendue (article 6).",
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
        "**Retrait.** Une perte que vous avez déclarée vous-même, vous la retirez depuis MY PIECES (PIECE FOUND), en confirmant le mot de passe de votre compte. Un vol, ou une perte enregistrée par ORBES Client Services, n'est retiré que par ORBES Client Services, après examen de la pièce.",
        'La déclaration dans le registre ORBES ne remplace pas une plainte auprès des autorités.',
      ],
    },
    {
      id: 'article-10',
      title: 'Article 10 — Certificat de propriété',
      blocks: [
        "**Création.** Le propriétaire enregistré crée depuis MY PIECES un lien vers un certificat de sa pièce, valable 1 à 90 jours (30 jours par défaut). Une pièce a au plus 10 liens valides à la fois. Le lien n'est montré qu'une fois : ORBES n'en garde qu'une empreinte et ne peut pas le montrer de nouveau. Le propriétaire peut retirer un lien à tout moment ; un lien retiré ne mène plus à rien.",
        "**Contenu.** Le certificat montre, lus au moment de son ouverture, la pièce et son ORBES GENOME, la propriété (vérifiée ou non) et sa date, la garantie, et l'absence de déclaration de perte ou de vol. Il ne montre jamais le nom ni l'adresse e-mail du propriétaire.",
        "**Fin de validité.** Le certificat cesse d'être valide à son expiration, quand la pièce change de propriétaire, quand sa perte ou son vol est déclaré, ou quand elle est révoquée ou retirée.",
        "**Portée.** Le certificat atteste un enregistrement dans le registre ORBES, pas l'objet avec lequel il est présenté. Pour vérifier un objet, il faut scanner son ORBES CODE.",
      ],
    },
    {
      id: 'article-11',
      title: 'Article 11 — Garantie',
      blocks: [
        "**Début.** La garantie ORBES commence à son activation par ORBES ou par un détaillant agréé inscrit au registre des points de vente d'ORBES, à la date d'achat, pour la durée prévue pour la catégorie de la pièce. En boutique, le vendeur active la garantie dans les 10 minutes qui suivent son scan de la pièce, à la date du jour et au pays du point de vente.",
        "**Suivi.** Le service affiche l'état de la garantie de chaque pièce. La garantie reste attachée à la pièce quand celle-ci change de propriétaire.",
        "**Conditions.** ORBES peut annuler la garantie d'une pièce dans les cas que ces conditions prévoient. Les garanties légales restent dues dans tous les cas.",
      ],
    },
    {
      id: 'article-12',
      title: 'Article 12 — Verrouillage du compte',
      blocks: [
        'ORBES Client Services peut verrouiller un compte ORBES.',
        'Le verrouillage ferme toutes les sessions du compte, révoque son code de récupération, retire ses liens de certificat et annule ses transferts en attente. Le compte ne peut plus se connecter, même avec le bon mot de passe. Ses pièces restent enregistrées à son nom. Seul ORBES Client Services lève le verrouillage.',
      ],
    },
    {
      id: 'article-13',
      title: 'Article 13 — Données personnelles',
      blocks: [
        'ORBES traite les données du service (compte, enregistrements, scans) comme le décrit sa [politique de confidentialité](/legal/privacy). Vous pouvez demander à ORBES Client Services une copie de tout ce que le registre ORBES garde de votre compte.',
      ],
    },
    {
      id: 'article-14',
      title: 'Article 14 — Responsabilité',
      blocks: [
        "ORBES décrit fidèlement ce que vérifie le service et ce qu'il ne vérifie pas (article 4). Un résultat ne garantit pas qu'un objet est celui qu'ORBES a fabriqué : avant un achat, demandez un code de transfert au vendeur, et en cas de doute, ORBES Client Services peut examiner la pièce.",
      ],
    },
    {
      id: 'article-15',
      title: 'Article 15 — Modification des conditions',
      blocks: [
        'ORBES peut modifier les présentes conditions. La version en vigueur et sa date sont publiées sur le service.',
      ],
    },
    {
      id: 'article-16',
      title: 'Article 16 — Droit applicable, médiation et litiges',
      blocks: [
        "Les présentes conditions sont soumises au droit français. En cas de litige, vous pouvez vous adresser d'abord à ORBES Client Services. Vous pouvez aussi recourir gratuitement au médiateur de la consommation.",
      ],
    },
  ],
};
export const TERMS = { en: EN, fr: FR } as const;
