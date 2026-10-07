/**
 * The FAQ (J-06), in English and French: what a result proves, UNUSUAL
 * ACTIVITY DETECTED, buying a piece second-hand, a lost claim code, the
 * transfer, a loss or a theft, a forgotten password, the data a
 * verification records, and the sound an authentic result plays (P-D07,
 * SOUND ON / OFF, verify/sound.ts). Written from the code and from the copy the
 * customer already reads (verify/copy.ts, the packaging kit), held to both
 * by test/web/legal.content.test.ts: every duration and limit equals its
 * constant, and the second-hand answer opens with the very sentence /verify
 * shows under AUTHENTIC — REGISTERED (RESALE_GUIDANCE, J-02), in French as
 * the packaging kit translates it (docs/launch/PACKAGING-KIT.md §3).
 */
import { RESALE_GUIDANCE } from '../../shared/resale.js';
import type { LegalDocument } from './types.js';

/** RESALE_GUIDANCE as the packaging kit translates it, word for word (its §3 table). */
export const RESALE_GUIDANCE_FR =
  'Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.';

const EN: LegalDocument = {
  title: 'Frequently asked questions',
  summary: 'What a result proves, unusual activity, buying a piece second-hand, the claim code, the transfer, your data.',
  intro: ['The questions asked most often about the verification of ORBES pieces. ORBES Client Services can help with any other.'],
  sections: [
    {
      id: 'result',
      title: 'What does a result prove?',
      blocks: [
        'AUTHENTIC means that the ORBES identity read from the code was issued and signed by ORBES. The result then shows what the ORBES registry records about it: the piece, its warranty, whether it is registered.',
        'It does not prove that the object in your hands is the one ORBES made: a printed code can be copied, and a perfect copy verifies like the original. Compare the piece with what the result shows, its photographs when ORBES has them, and when in doubt, ORBES Client Services can inspect the piece. Registration in the ORBES registry is not a title of ownership.',
        'Verify only at theorbes.com/verify, and type the address yourself: ORBES never sends a verification link.',
      ],
    },
    {
      id: 'unusual-activity',
      title: 'What does UNUSUAL ACTIVITY DETECTED mean?',
      blocks: [
        'It is a request for review, never a verdict. Something in the history of this code needs a look by ORBES: for example the same code verified in many places within minutes, as copies of it would be, or a piece whose loss or theft has been reported. It accuses neither the piece nor its holder.',
        'Contact ORBES Client Services before relying on the piece, and quote the reference shown under the result (REF). The result also asks where you saw or bought the piece: your answer helps ORBES follow up.',
        'If the piece was never registered and you hold its certificate card, the result may still let you register it with the claim code.',
      ],
    },
    {
      id: 'second-hand',
      title: 'Buying a piece second-hand?',
      blocks: [
        RESALE_GUIDANCE,
        'Once a piece is registered, every copy of its code reads AUTHENTIC — REGISTERED as well. Only the registered owner can create a transfer code, and the transfer completes when you enter it in your own ORBES account: the transfer code is what shows that the seller holds the registration. The certificate card of a registered piece shows nothing, since its claim code has already been used.',
        'A piece sold before anyone registered it has no owner yet, so no transfer code can exist: if you receive its certificate card, register it with the claim code printed on it.',
      ],
    },
    {
      id: 'claim-code',
      title: 'I have lost my claim code',
      blocks: [
        'The claim code is printed only on the certificate card delivered with the piece, never on the piece. ORBES keeps only a fingerprint of it and cannot read it back to you.',
        'If the card is lost before you register the piece, write to ORBES Client Services, with the proof of purchase of the piece.',
        'Once the piece is registered, the card is no longer needed: the piece then passes on with a transfer code, never with the card. After 5 wrong claim codes within an hour for one piece, its registration waits until the end of the hour.',
      ],
    },
    {
      id: 'transfer',
      title: 'How do I pass a piece on?',
      blocks: [
        'Signed in to your ORBES account, scan the piece at theorbes.com/verify, then create a transfer code in the OWNERSHIP tab of the result (CREATE TRANSFER CODE). Give it to the new owner only. The code is valid for 7 days; a piece has one pending transfer at a time, and you can cancel it until it is accepted.',
        'The new owner signs in to their own ORBES account, scans the piece, then enters the code within 15 minutes of that scan. The transfer is then final, and the warranty stays with the piece.',
      ],
    },
    {
      id: 'loss',
      title: 'Reporting a loss or a theft',
      blocks: [
        'Report the loss or the theft from MY PIECES, at theorbes.com/verify, signed in to your ORBES account. Any pending transfer is cancelled, every verification of the piece then reads UNUSUAL ACTIVITY DETECTED, and it can no longer be transferred.',
        'A loss you reported yourself, you withdraw with PIECE FOUND and the password of your account. A theft is withdrawn only by ORBES Client Services. A report in the ORBES registry does not replace a complaint to the authorities.',
      ],
    },
    {
      id: 'password',
      title: 'I forgot my password',
      blocks: [
        'The service sends no email: ask ORBES Client Services. Once they have checked that you hold the account, they give you a recovery code, valid once and for 30 minutes. Enter it at theorbes.com/verify under FORGOTTEN PASSWORD?, with your email address and a new password.',
        'Every session of the account then ends, and the creation of transfer codes pauses for 72 hours, to protect you from a takeover of your account.',
      ],
    },
    {
      id: 'data',
      title: 'What does ORBES record when I verify a piece?',
      blocks: [
        'The code read, the result and the time; an approximate location (the country, about 10 km); the family of your browser; pseudonyms of your IP address and of a device cookie, never the address itself; and, when you are signed in, your account. The image of the camera or of your photo is read on your device and never sent.',
        'The [privacy policy](/legal/privacy) says what is recorded, why, for how long, and your rights.',
      ],
    },
    {
      id: 'sound',
      title: 'Why does my phone play a sound?',
      blocks: [
        "An AUTHENTIC result plays one soft chord, about a second long; no other result does. SOUND ON / OFF, at the foot of the app's first page, turns it off on this device, which keeps the choice. On an iPhone, the silent switch silences it too.",
      ],
    },
  ],
};

const FR: LegalDocument = {
  title: 'Questions fréquentes',
  summary: "Ce que prouve un résultat, l'activité inhabituelle, l'achat d'occasion, le claim code, le transfert, vos données.",
  intro: ['Les questions les plus fréquentes sur la vérification des pièces ORBES. ORBES Client Services peut vous accompagner pour toute autre.'],
  sections: [
    {
      id: 'result',
      title: 'Que prouve un résultat ?',
      blocks: [
        "AUTHENTIC signifie que l'identité ORBES lue dans le code a été émise et signée par ORBES. Le résultat montre ensuite ce que le registre ORBES en sait : la pièce, sa garantie, si elle est enregistrée.",
        "Il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué : un code imprimé peut être copié, et une copie parfaite vérifie comme l'original. Comparez la pièce avec ce que montre le résultat, ses photographies quand ORBES en a, et en cas de doute, ORBES Client Services peut examiner la pièce. L'enregistrement dans le registre ORBES n'est pas un titre de propriété.",
        "Vérifiez uniquement sur theorbes.com/verify, en tapant l'adresse vous-même : ORBES n'envoie jamais de lien de vérification.",
      ],
    },
    {
      id: 'unusual-activity',
      title: 'Que signifie UNUSUAL ACTIVITY DETECTED ?',
      blocks: [
        "C'est une demande d'examen, jamais un verdict. Quelque chose dans l'historique de ce code demande un regard d'ORBES : par exemple le même code vérifié en de nombreux lieux en quelques minutes, comme le seraient ses copies, ou une pièce dont la perte ou le vol a été déclaré. Il n'accuse ni la pièce ni son détenteur.",
        "Contactez ORBES Client Services avant de vous fier à la pièce, en citant la référence affichée sous le résultat (REF). Le résultat demande aussi où vous avez vu ou acheté la pièce : votre réponse aide ORBES à y donner suite.",
        "Si la pièce n'a jamais été enregistrée et que vous détenez sa carte certificat, le résultat peut encore vous permettre de l'enregistrer avec le claim code.",
      ],
    },
    {
      id: 'second-hand',
      title: "Vous achetez une pièce d'occasion ?",
      blocks: [
        RESALE_GUIDANCE_FR,
        "Dès qu'une pièce est enregistrée, chaque copie de son code affiche elle aussi AUTHENTIC — REGISTERED. Seul le propriétaire enregistré peut créer un code de transfert, et le transfert s'achève quand vous le saisissez dans votre propre compte ORBES : c'est donc le code de transfert qui montre que le vendeur détient l'enregistrement. La carte certificat d'une pièce enregistrée ne montre rien, puisque son claim code a déjà servi.",
        "Une pièce vendue avant tout enregistrement n'a pas encore de propriétaire, donc aucun code de transfert ne peut exister : si vous recevez sa carte certificat, enregistrez-la avec le claim code imprimé dessus.",
      ],
    },
    {
      id: 'claim-code',
      title: "J'ai perdu mon claim code",
      blocks: [
        "Le claim code n'est imprimé que sur la carte certificat remise avec la pièce, jamais sur la pièce. ORBES n'en garde qu'une empreinte et ne peut pas vous le relire.",
        "Si la carte est perdue avant l'enregistrement de la pièce, écrivez à ORBES Client Services, avec la preuve d'achat de la pièce.",
        "Une fois la pièce enregistrée, la carte ne sert plus : la pièce se transmet ensuite par un code de transfert, jamais par la carte. Après 5 claim codes erronés en une heure pour une même pièce, son enregistrement attend la fin de l'heure.",
      ],
    },
    {
      id: 'transfer',
      title: 'Comment transmettre une pièce ?',
      blocks: [
        "Connecté à votre compte ORBES, scannez la pièce sur theorbes.com/verify, puis créez un code de transfert dans l'onglet OWNERSHIP du résultat (CREATE TRANSFER CODE). Ne le donnez qu'au nouveau propriétaire. Le code vaut 7 jours ; une pièce n'a qu'un transfert en attente à la fois, et vous pouvez l'annuler tant qu'il n'est pas accepté.",
        'Le nouveau propriétaire se connecte à son propre compte ORBES, scanne la pièce, puis saisit le code dans les 15 minutes qui suivent ce scan. Le transfert est alors définitif, et la garantie reste attachée à la pièce.',
      ],
    },
    {
      id: 'loss',
      title: 'Déclarer une perte ou un vol',
      blocks: [
        'Déclarez la perte ou le vol depuis MY PIECES, sur theorbes.com/verify, connecté à votre compte ORBES. Un transfert en attente est annulé, chaque vérification de la pièce affiche ensuite UNUSUAL ACTIVITY DETECTED, et elle ne se transfère plus.',
        'Une perte que vous avez déclarée vous-même, vous la retirez avec PIECE FOUND et le mot de passe de votre compte. Un vol ne se retire que par ORBES Client Services. La déclaration dans le registre ORBES ne remplace pas une plainte auprès des autorités.',
      ],
    },
    {
      id: 'password',
      title: "J'ai oublié mon mot de passe",
      blocks: [
        "Le service n'envoie aucun e-mail : adressez-vous à ORBES Client Services. Après avoir vérifié que vous êtes le titulaire du compte, il vous remet un code de récupération, qui sert une seule fois et vaut 30 minutes. Saisissez-le sur theorbes.com/verify sous FORGOTTEN PASSWORD?, avec votre adresse e-mail et un nouveau mot de passe.",
        "Toutes les sessions du compte prennent alors fin, et la création de codes de transfert est suspendue pendant 72 heures, pour vous protéger d'une prise de contrôle de votre compte.",
      ],
    },
    {
      id: 'data',
      title: "Qu'enregistre ORBES quand je vérifie une pièce ?",
      blocks: [
        "Le code lu, le résultat et l'heure ; une localisation approximative (le pays, à 10 km environ) ; la famille de votre navigateur ; des pseudonymes de votre adresse IP et d'un cookie d'appareil, jamais l'adresse elle-même ; et, quand vous êtes connecté, votre compte. L'image de la caméra ou de votre photo est lue sur votre appareil et n'est jamais envoyée.",
        'La [politique de confidentialité](/legal/privacy) dit ce qui est enregistré, pourquoi, combien de temps, et vos droits.',
      ],
    },
    {
      id: 'sound',
      title: 'Pourquoi mon téléphone joue-t-il un son ?',
      blocks: [
        "Un résultat AUTHENTIC joue un accord doux, d'une seconde environ ; aucun autre résultat n'en joue. SOUND ON / OFF, au pied de la première page de l'application, le coupe sur cet appareil, qui garde ce choix. Sur un iPhone, le mode silencieux le coupe aussi.",
      ],
    },
  ],
};

export const FAQ = { en: EN, fr: FR } as const;
