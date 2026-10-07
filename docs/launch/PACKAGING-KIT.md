# ORBES — Packaging kit, certificate card and announcement · Kit emballage, carte certificat et annonce

Status: **draft. The brand validates this kit before anything is printed** (sign-off, §6). The announcement also waits for the H1/H2 review of COMPLIANCE §7 (§5).
Statut : **brouillon. La marque valide ce kit avant toute impression** (validation, §6). L'annonce attend en plus la revue H1/H2 de COMPLIANCE §7 (§5).

Related: [BRAND-DESIGN-SYSTEM](../BRAND-DESIGN-SYSTEM.md) §2.10, §4 and §7 · [LAUNCH](../LAUNCH.md) §10 · [THREAT-MODEL](../THREAT-MODEL.md), threat I · [COMPLIANCE](../COMPLIANCE.md) §7.

**Why this kit.** The ORBES CODE is not an address: it opens no website by itself. The customer types the official address, and the packaging is the one medium that teaches it. That is the main defence against sites that imitate ORBES verification (THREAT-MODEL, threat I).

**Pourquoi ce kit.** L'ORBES CODE n'est pas une adresse : il n'ouvre aucun site par lui-même. Le client tape l'adresse officielle, et l'emballage est le seul support qui la lui apprend. C'est la défense principale contre les sites qui imitent la vérification ORBES (THREAT-MODEL, menace I).

The kit says only what the software does. Its sources:

| Subject | Source |
|---|---|
| The card's copy, word for word | `CERTIFICATE_COPY`, `genome/src/server/render/certificate.ts` |
| Claim code: first registration only, 5 wrong attempts per hour and per piece | `registerFirst`, `CLAIM_ATTEMPT_LIMIT`, `genome/src/server/services/ownership.ts` |
| Transfer code: created by the registered owner only, valid 7 days | `initiateTransfer`, `TRANSFER_TTL_MS`, same file |
| The words of `/verify`, in English | `genome/src/web/verify/copy.ts`, `genome/src/server/services/copy.ts` |
| The second-hand sentence (§3) under AUTHENTIC — REGISTERED, word for word | `RESALE_GUIDANCE`, `genome/src/web/verify/copy.ts` (J-02) |
| theorbes.com/verify opens verify.theorbes.com/verify | `vercel.json` (redirect, live once LAUNCH §9 is done) |

`genome/test/docs/packaging-kit.test.ts` checks this file: no forbidden term, English or French, outside the marked lexicon of §4; no exclamation mark; the official address on the packaging, the card and the announcement, and no other; the card's steps word for word as the renderer draws them; the second-hand sentence in both languages, its English word for word the one `/verify` shows (`RESALE_GUIDANCE`); the H1/H2 hold on the announcement, and in each of its drafts the sentence on what a printed code does not prove and ORBES Client Services (BRAND §4.6).

---

## 1. Packaging text · Texte d'emballage

On the box, sleeve or pouch, or on the insert placed with the piece. The same three steps as the certificate card, in the same order.

Sur la boîte, le fourreau ou la pochette, ou sur la notice glissée avec la pièce. Les trois mêmes étapes que la carte certificat, dans le même ordre.

### EN

Printed, in the house voice (uppercase, tracked), word for word the card's lines:

```
1  SCAN THE ORBES CODE
2  ENTER THE CLAIM CODE
3  THE PIECE IS REGISTERED TO YOU

VERIFY ONLY AT VERIFY.THEORBES.COM
```

Long form (insert, website, e-mail):

> 1. Open verify.theorbes.com: type the address into your phone's browser, then scan the ORBES CODE on the certificate card.
> 2. Enter the claim code printed on the card, under CLAIM CODE · KEEP IT PRIVATE.
> 3. The piece is registered to you, in your ORBES account.
>
> Verify only at verify.theorbes.com.

### FR

Imprimé, dans la voix de la maison (capitales espacées) :

```
1  SCANNEZ L'ORBES CODE
2  SAISISSEZ LE CLAIM CODE
3  LA PIÈCE EST ENREGISTRÉE À VOTRE NOM

VÉRIFIEZ UNIQUEMENT SUR VERIFY.THEORBES.COM
```

Forme longue (encart, site, e-mail) :

> 1. Ouvrez verify.theorbes.com : tapez l'adresse dans le navigateur de votre téléphone, puis scannez l'ORBES CODE de la carte certificat.
> 2. Saisissez le claim code imprimé sur la carte, sous CLAIM CODE · KEEP IT PRIVATE.
> 3. La pièce est enregistrée à votre nom, dans votre compte ORBES.
>
> Vérifiez uniquement sur verify.theorbes.com.

### Rules · Règles

| EN | FR |
|---|---|
| **The address is typed.** Nothing on the packaging opens a website: no other code, beside the ORBES CODE or anywhere else, and no frame or arrow inviting a scan (BRAND §1.2 and §2.10; the words to avoid are in §4). | **L'adresse se tape.** Rien sur l'emballage n'ouvre de site : aucun autre code, ni à côté de l'ORBES CODE ni ailleurs, et aucun cadre ni flèche qui appelle au scan (BRAND §1.2 et §2.10 ; les mots à éviter sont au §4). |
| **One address.** verify.theorbes.com, as the card prints it, opens the scanner; theorbes.com/verify, which the announcement teaches (§5), opens the same scanner. No short link, no campaign address, no other domain. | **Une seule adresse.** verify.theorbes.com, comme l'imprime la carte, ouvre le scanner ; theorbes.com/verify, qu'apprend l'annonce (§5), ouvre le même scanner. Pas de lien raccourci, pas d'adresse de campagne, aucun autre domaine. |
| **English words on screen.** `/verify` is in English. The French copy keeps the names the customer will read there: ORBES CODE, CLAIM CODE, SCAN ORBES CODE. | **Les mots de l'écran restent en anglais.** `/verify` est en anglais. Le texte français garde les noms que le client y lira : ORBES CODE, CLAIM CODE, SCAN ORBES CODE. |
| **Step 1 names the ORBES CODE**, what the customer scans, not the ORBES SEAL, which is only its centre (BRAND §2.1). The brief said "scan the seal"; the card and this kit say ORBES CODE. | **L'étape 1 nomme l'ORBES CODE**, ce que le client scanne, et non l'ORBES SEAL, qui n'en est que le centre (BRAND §2.1). Le brief disait « scanner le sceau » ; la carte et ce kit disent ORBES CODE. |
| **Step 2 needs an ORBES account.** After the scan, `/verify` offers to sign in or to create one; registration follows that scan. | **L'étape 2 demande un compte ORBES.** Après le scan, `/verify` propose de se connecter ou d'en créer un ; l'enregistrement suit ce scan. |
| **Capitals.** The printed lines set the address in capitals, as the card does. A host name reads the same in capitals: before printing, type VERIFY.THEORBES.COM in capitals on a phone and check that it reaches the scanner (§6). | **Capitales.** Les lignes imprimées composent l'adresse en capitales, comme la carte. Un nom de domaine se lit de même en capitales : avant impression, tapez VERIFY.THEORBES.COM en capitales sur un téléphone et vérifiez que le scanner s'ouvre (§6). |

---

## 2. Certificate card · Carte certificat

### The card the console draws · La carte que dessine la console

The card is 79t, MINT CERTIFICATE, the card of BRAND §7, not a second template: 95 × 62 mm, one side. The console offers DOWNLOAD CERTIFICATE CARD while the claim code is shown, and `POST /api/admin/certificates` returns A4 sheets of eight cards and the print shop's CSV ([API §15.7](../API.md#157-post-apiadmincertificates-extension-of-the-contract), LAUNCH §7). The server checks each claim code against its stored hash before drawing it. This kit fixes the card's words only.

La carte est 79t, MINT CERTIFICATE, la carte de BRAND §7, pas un second gabarit : 95 × 62 mm, une seule face. La console propose DOWNLOAD CERTIFICATE CARD tant que le claim code est affiché, et `POST /api/admin/certificates` donne les planches A4 de huit cartes et le CSV de l'imprimeur. Le serveur vérifie chaque claim code contre son empreinte avant de le dessiner. Ce kit ne fixe que les mots de la carte.

![Certificate card specimen 79t: MINT CERTIFICATE in the top rule, the ORBES CODE, ORBES, the identity, the GENOME row, the monogram with the year, the piece's three lines, the three steps, the claim code in plain sight, VERIFY ONLY AT VERIFY.THEORBES.COM in the bottom rule](../assets/certificate-card-specimen.svg)

Its copy, in English like `/verify`, word for word as `CERTIFICATE_COPY` draws it:

| Line | Copy |
|---|---|
| Top rule | MINT CERTIFICATE |
| Code | the piece's ORBES CODE, to scan |
| Identity | ORBES, the piece's identity (e.g. O26-J-00184), its GENOME row and fingerprint, the monogram with the year of the identity |
| The piece | the model and its type · the variant and the size (e.g. BLUE  ·  SIZE 17) · the material |
| Steps | 1 SCAN THE ORBES CODE · 2 ENTER THE CLAIM CODE · 3 THE PIECE IS REGISTERED TO YOU |
| Claim code | CLAIM CODE · KEEP IT PRIVATE, then the code `XXXX-XXXX-XXXX`, in plain sight |
| Bottom rule | VERIFY ONLY AT VERIFY.THEORBES.COM |

En français, pour relecture (la carte reste imprimée en anglais, MINT CERTIFICATE compris) : 1 SCANNEZ L'ORBES CODE · 2 SAISISSEZ LE CLAIM CODE · 3 LA PIÈCE EST ENREGISTRÉE À VOTRE NOM · CLAIM CODE · GARDEZ-LE POUR VOUS · VÉRIFIEZ UNIQUEMENT SUR VERIFY.THEORBES.COM.

**Validated · Validée.** The owner validated the card 79t on 2026-10-07: `CERTIFICATE_LAYOUT_STATUS` is `VALIDATED` (`genome/src/server/render/certificate.ts`, BRAND §8 item 20), and no card, sheet or file name says PROOF.
Le propriétaire a validé la carte 79t le 2026-10-07 : `CERTIFICATE_LAYOUT_STATUS` vaut `VALIDATED`, et aucune carte, planche ni nom de fichier ne porte PROOF.

### The claim code · Le claim code

| EN | FR |
|---|---|
| Printed on the card in plain sight, under CLAIM CODE · KEEP IT PRIVATE: there is no scratch-off panel (owner, 2026-10-07). **Never on the piece**, its tag or the outside of the packaging; never in a photograph, an e-mail or a message (BRAND §2.10). | Imprimé en clair sur la carte, sous CLAIM CODE · KEEP IT PRIVATE : il n'y a pas de zone à gratter (propriétaire, 2026-10-07). **Jamais sur la pièce**, son étiquette ou l'extérieur de l'emballage ; jamais dans une photo, un e-mail ou un message (BRAND §2.10). |
| The card goes inside the packaging, with the piece: whoever holds it can register the piece at verify.theorbes.com. The console shows the code once and keeps only its hash. | La carte va dans l'emballage, avec la pièce : qui la détient peut enregistrer la pièce sur verify.theorbes.com. La console montre le code une fois et n'en garde que l'empreinte. |
| It registers the piece once, at its first registration. Afterwards the piece changes hands with a transfer code (valid 7 days), never with the card; the console refuses to draw a card for a registered piece. | Il enregistre la pièce une seule fois, à sa première inscription. Ensuite la pièce change de mains par un code de transfert (valable 7 jours), jamais par la carte ; la console refuse de dessiner la carte d'une pièce enregistrée. |
| After 5 wrong attempts within an hour, registration of that piece is paused for up to an hour. | Après 5 essais manqués en une heure, l'enregistrement de cette pièce est suspendu pendant une heure au plus. |
| A card lost before registration: the customer writes to ORBES Client Services. | Carte perdue avant l'enregistrement : le client écrit à ORBES Client Services. |

### Verso · Verso

One side only; the back is blank (owner, 2026-10-07).
Une seule face ; le dos est blanc (propriétaire, 2026-10-07).

---

## 3. Second-hand purchase · Achat d'occasion

One sentence, word for word in the FAQ and under the AUTHENTIC — REGISTERED result of `/verify`, where `RESALE_GUIDANCE` (`genome/src/web/verify/copy.ts`, J-02) shows it with a link to the field of the transfer code (BRAND §4.3). Changing it here means changing it everywhere; the test of this kit compares the English with `RESALE_GUIDANCE`. The announcement only adapts its first words (§5). The FAQ adds one line for a piece resold before anyone registered it: it has no owner yet, so no transfer code can exist, and the buyer registers it with the claim code printed on its card (§2). The card has one side and carries neither (§2). `/verify` needs no such line: J-02 shows the sentence for a registered piece only.

Une seule phrase, mot pour mot dans la FAQ et sous le résultat AUTHENTIC — REGISTERED de `/verify`, où `RESALE_GUIDANCE` (`genome/src/web/verify/copy.ts`, J-02) l'affiche avec un lien vers le champ du code de transfert (BRAND §4.3). La changer ici, c'est la changer partout ; le test de ce kit compare l'anglais à `RESALE_GUIDANCE`. L'annonce n'en adapte que les premiers mots (§5). La FAQ ajoute une ligne pour une pièce revendue avant tout enregistrement : elle n'a pas encore de propriétaire, donc aucun code de transfert ne peut exister, et l'acheteur l'enregistre avec le claim code imprimé sur sa carte (§2). La carte n'a qu'une face et ne porte ni l'une ni l'autre (§2). `/verify` n'a pas besoin de cette ligne : J-02 n'y montre la phrase que pour une pièce enregistrée.

| EN | FR |
|---|---|
| Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one. | Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un. |

**Why.** A perfect copy of a code verifies like the original (BRAND §4.6): once the original piece is registered, every copy reads AUTHENTIC — REGISTERED. Only the registered owner can create a transfer code, and the transfer completes when the buyer enters it in their own ORBES account. A transfer code is therefore what shows that the seller holds the registration; the card of a registered piece shows nothing, since its claim code has already been used.

**Pourquoi.** Une copie parfaite d'un code vérifie comme l'original (BRAND §4.6) : dès que la pièce d'origine est enregistrée, chaque copie affiche AUTHENTIC — REGISTERED. Seul le propriétaire enregistré peut créer un code de transfert, et le transfert s'achève quand l'acheteur le saisit dans son propre compte ORBES. C'est donc le code de transfert qui montre que le vendeur détient l'enregistrement ; la carte d'une pièce enregistrée ne montre rien, puisque son claim code a déjà servi.

---

## 4. French lexicon · Lexique FR (BRAND §4.5)

<!-- lexicon:begin -->

Ce lexique traduit BRAND §4.5 pour tout texte ORBES en français : emballage, carte, annonce, FAQ, réponses du Client Services. Les termes de la colonne « Jamais » sont interdits partout ailleurs dans ce kit, comme les termes anglais de BRAND §4.5 (test `genome/test/docs/packaging-kit.test.ts`). Ils ne sont cités qu'ici.

| À dire | Jamais | BRAND §4.5 (EN) |
|---|---|---|
| « AUTHENTIC » (le résultat, en anglais comme à l'écran), « identité ORBES émise et signée par ORBES », « enregistrée » | « vrai », « véritable », « pièce authentique », « 100 % authentique », « authenticité garantie », « garanti authentique », « certifié authentique », « certifié original », « original certifié » | AUTHENTIC, issued and signed by ORBES, registered · never REAL, GENUINE as a verdict, 100 % GENUINE, AUTHENTICITY GUARANTEED, CERTIFIED ORIGINAL |
| « activité inhabituelle » (UNUSUAL ACTIVITY à l'écran), « demande un examen », « n'est plus valide », « non enregistré » | « faux », « fausse », « contrefaçon », « contrefait », « fraude », « frauduleux », « frauduleuse », « volé », « alerte », « danger », « avertissement » (au public) | UNUSUAL ACTIVITY, requires review, no longer valid, not registered · never FAKE, COUNTERFEIT, FRAUD, STOLEN, ALERT, DANGER, WARNING (to the public) |
| « ORBES CODE », « ORBES GENOME », « ORBES SEAL », « orbite », « pièce » | « QR », « QR code », « code QR », « code-barres », « code-barre », « identifiant de tag », « NFT », « jeton », « blockchain », « chaîne de blocs », « registre distribué », « crypto », « cryptomonnaie », « Web3 » | ORBES CODE, ORBES GENOME, ORBES SEAL, orbit, piece · never QR, barcode, tag ID, NFT, token, blockchain, ledger, crypto, Web3 |
| « signature », « clé ORBES » (un onglet plus loin) | « infalsifiable », « impossible à contrefaire », « impossible à copier », « incopiable », « inviolable », « inclonable », « impiratable », « qualité militaire », « niveau militaire », « niveau bancaire », « sécurité bancaire », « résistant au quantique », « post-quantique », « propulsé par l'IA » | signature, ORBES key · never IMPOSSIBLE TO COUNTERFEIT, UNHACKABLE, UNCLONABLE, TAMPER-PROOF, MILITARY-GRADE, BANK-GRADE, QUANTUM-SAFE, AI-POWERED |
| « ORBES Client Services peut vous accompagner » | « contactez le support », « support technique », « erreur », « oups », « une erreur est survenue », « quelque chose s'est mal passé » | ORBES Client Services can assist you · never Contact support, Error, Oops, Something went wrong |
| « pièce » (BRAND §4.1) | « produit » | piece, never product |
| « tirage » (DRAW à l'écran), « s'inscrire au tirage », « place réservée » (les sorties, P-R03) | « loterie » | DRAW, ENTER THE DRAW, a place held · never lottery |

« AUTHENTIC » reste le seul mot fort, toujours qualifié : il dit ce qui a été signé, et la même page dit ce qu'un code imprimé ne prouve pas (BRAND §4.5 et §4.6).

**Règles de support (BRAND §1.2 et §2.10)**

- Jamais de QR code, ni d'aucun autre code, sur l'emballage, la carte, l'étiquette ou l'annonce, ni à côté de l'ORBES CODE. Un QR code mène là où son imprimeur le décide : c'est l'outil même d'un faux site de vérification (THREAT-MODEL, menace I). / Never a QR code, or any other code, on the packaging, the card, the tag or the announcement, nor beside the ORBES CODE.
- Jamais de cadre « scannez-moi » ni de flèche, jamais de sceau « 100 % authentique », d'hologramme ou d'étiquette VOID. / No "scan me" frame or arrow, no "100 % GENUINE" seal, hologram or VOID label.
- Une annonce ne parle jamais de contrefaçon, de faux ou de vol : elle dit ce qui est vérifié, ce qui ne l'est pas, et qui peut aider.

<!-- lexicon:end -->

---

## 5. Announcement draft · Brouillon d'annonce

**À publier seulement après la revue H1/H2 de COMPLIANCE §7.**
**Publish only after the H1/H2 review of COMPLIANCE §7.**

COMPLIANCE §7 asks to revisit H1 (the shared server) and H2 (processing outside the EU) before the public launch announcement. The announcement also waits for the brand's validation of this kit, the legal review of LAUNCH §10, and the privacy policy, which states where data is processed (H2).

COMPLIANCE §7 demande de revoir H1 (le serveur partagé) et H2 (le traitement hors de l'UE) avant l'annonce publique du lancement. L'annonce attend aussi la validation de ce kit par la marque, la relecture juridique de LAUNCH §10 et la politique de confidentialité, qui dit où les données sont traitées (H2).

Rules (BRAND §4.6): state what is checked, say plainly what it does not cover, offer a human. No exclamation marks, no urgency. Visuals never show a readable ORBES CODE (the code of a piece seen by thousands would be scanned by thousands, and its pattern of scans would read UNUSUAL ACTIVITY for that piece) and never a claim code. `[DATE]` is the first day pieces ship with their ORBES CODE.

Règles (BRAND §4.6) : dire ce qui est vérifié, dire clairement ce qui ne l'est pas, proposer un interlocuteur. Pas de point d'exclamation, pas d'urgence. Les visuels ne montrent jamais un ORBES CODE lisible (le code d'une pièce vu par des milliers de personnes serait scanné par des milliers, et ces scans feraient lire UNUSUAL ACTIVITY pour cette pièce), ni jamais un claim code. `[DATE]` est le premier jour où les pièces sont livrées avec leur ORBES CODE.

### Website · Site

**EN**

> **ORBES GENOME CODE**
>
> From [DATE], every ORBES piece carries an ORBES CODE: an orbital mark, issued and signed by ORBES, that holds the identity of that piece alone and its ORBES GENOME.
>
> To verify a piece, open theorbes.com/verify, scan its ORBES CODE, then register it in your name with the claim code from its certificate card. Verify only at theorbes.com/verify. ORBES never sends a verification link: type the address yourself.
>
> AUTHENTIC confirms an identity issued and signed by ORBES and what the ORBES registry records for it: registration, warranty, care. A printed code can be copied; on its own, it cannot prove that the object in your hands is the one ORBES made. Your registration, made with the claim code, and the transfer code that passes it on are what follow the piece. UNUSUAL ACTIVITY DETECTED is a request for review, never a verdict: ORBES Client Services can assist you, and can inspect a piece on request.
>
> Buying an ORBES piece second-hand? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.

**FR**

> **ORBES GENOME CODE**
>
> À partir du [DATE], chaque pièce ORBES porte un ORBES CODE : une marque orbitale, émise et signée par ORBES, qui contient l'identité de cette seule pièce et son ORBES GENOME.
>
> Pour vérifier une pièce, ouvrez theorbes.com/verify, scannez son ORBES CODE, puis enregistrez-la à votre nom avec le claim code de sa carte certificat. Vérifiez uniquement sur theorbes.com/verify. ORBES n'envoie jamais de lien de vérification : tapez l'adresse vous-même.
>
> AUTHENTIC confirme une identité émise et signée par ORBES, et ce que le registre ORBES en sait : enregistrement, garantie, entretien. Un code imprimé peut être copié ; à lui seul, il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué. Votre enregistrement, fait avec le claim code, et le code de transfert qui le transmet sont ce qui suit la pièce. UNUSUAL ACTIVITY DETECTED est une demande d'examen, jamais un verdict : ORBES Client Services peut vous accompagner, et examiner une pièce sur demande.
>
> Vous achetez une pièce ORBES d'occasion ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.

### Social · Réseaux

The address in plain text, no short link, no readable code in the visual. Each post stays under 280 characters once `[DATE]` is filled in, and keeps its sentence on what a printed code does not prove and who can help: a post is read on its own. · L'adresse en clair, pas de lien raccourci, aucun code lisible sur le visuel. Chaque message reste sous 280 caractères une fois `[DATE]` rempli, et garde sa phrase sur ce qu'un code imprimé ne prouve pas et sur qui peut aider : un message se lit seul.

**EN**

> ORBES GENOME CODE. From [DATE], every ORBES piece carries its own ORBES identity, issued and signed by ORBES. A printed code can be copied; ORBES Client Services can inspect a piece on request. Verify it at theorbes.com/verify, and only there.

**FR**

> ORBES GENOME CODE. À partir du [DATE], chaque pièce ORBES porte sa propre identité ORBES, émise et signée par ORBES. Un code imprimé peut être copié ; ORBES Client Services peut examiner une pièce sur demande. Vérifiez-la sur theorbes.com/verify, et uniquement là.

### E-mail

The address stays plain text, never a link: the message teaches the habit it asks for. Send it as plain text, with automatic link detection turned off where the e-mail tool allows it. A mail app may still make the address clickable, so the closing asks the reader to type it and never claims the message holds no link. · L'adresse reste en texte, jamais en lien : le message enseigne l'habitude qu'il demande. Envoyez-le en texte brut, détection automatique des liens désactivée si l'outil d'envoi le permet. Une messagerie peut tout de même rendre l'adresse cliquable : la conclusion demande donc de la taper, sans jamais affirmer que le message ne contient aucun lien.

**EN**

> Subject: ORBES GENOME CODE: verify your piece at theorbes.com/verify
>
> From [DATE], every ORBES piece carries an ORBES CODE, issued and signed by ORBES, with the ORBES GENOME of that piece alone.
>
> 1. Open theorbes.com/verify: type the address into your phone's browser.
> 2. Scan the ORBES CODE of your piece.
> 3. Register the piece in your name with the claim code from its certificate card.
>
> A result confirms an identity issued and signed by ORBES and its registry record. A printed code can be copied; on its own, it cannot prove that the object in your hands is the one ORBES made. ORBES Client Services can inspect a piece on request.
>
> Buying an ORBES piece second-hand? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.
>
> Verify only at theorbes.com/verify. ORBES never asks you to follow a link to verify a piece: type the address yourself.

**FR**

> Objet : ORBES GENOME CODE : vérifiez votre pièce sur theorbes.com/verify
>
> À partir du [DATE], chaque pièce ORBES porte un ORBES CODE, émis et signé par ORBES, avec l'ORBES GENOME de cette seule pièce.
>
> 1. Ouvrez theorbes.com/verify : tapez l'adresse dans le navigateur de votre téléphone.
> 2. Scannez l'ORBES CODE de votre pièce.
> 3. Enregistrez la pièce à votre nom avec le claim code de sa carte certificat.
>
> Un résultat confirme une identité émise et signée par ORBES et son inscription au registre. Un code imprimé peut être copié ; à lui seul, il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué. ORBES Client Services peut examiner une pièce sur demande.
>
> Vous achetez une pièce ORBES d'occasion ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.
>
> Vérifiez uniquement sur theorbes.com/verify. ORBES ne vous demande jamais de suivre un lien pour vérifier une pièce : tapez l'adresse vous-même.

---

## 6. Sign-off · Validation

Nothing is printed or published while a line it depends on is open. · Rien n'est imprimé ni publié tant qu'une ligne dont il dépend reste ouverte.

| Item · Élément | By · Par | Before · Avant | Status · État |
|---|---|---|---|
| Packaging text, FR and EN (§1) · Texte d'emballage, FR et EN (§1) | Brand · Marque | printing packaging · impression de l'emballage | Open · Ouvert |
| Capitals check: THEORBES.COM/VERIFY typed in capitals on a phone reaches the scanner (§1, Capitals); if it does not, the packaging switches to lower case and cards wait for capitals to work or for lower-case card lettering · Contrôle des capitales : THEORBES.COM/VERIFY tapé en capitales sur un téléphone ouvre le scanner (§1, Capitales) ; sinon, l'emballage passe en minuscules et les cartes attendent que les capitales fonctionnent ou un lettrage de carte en minuscules | Brand and operator · Marque et opérateur | printing packaging or cards · impression de l'emballage ou des cartes | Open · Ouvert |
| Card: the specimen of BRAND §7 validated as 79t, `CERTIFICATE_LAYOUT_STATUS` set to `VALIDATED` and the specimens regenerated (BRAND §8 item 20); then one A4 sheet of eight printed on the chosen printer and card stock, cut, its ORBES CODE scanned with a phone, and the box checked to take a 95 × 62 mm card · Carte : le spécimen de BRAND §7 validé comme 79t, `CERTIFICATE_LAYOUT_STATUS` passé à `VALIDATED` et les spécimens régénérés (BRAND §8 point 20) ; puis une planche A4 de huit imprimée sur l'imprimante et le papier choisis, coupée, son ORBES CODE scanné avec un téléphone, et la boîte vérifiée pour une carte de 95 × 62 mm | Brand · Marque | printing cards · impression des cartes | Layout validated 2026-10-07; print check open · Gabarit validé le 2026-10-07 ; contrôle d'impression ouvert |
| Card verso (§2): none, the card has one side, its back blank; the line for a piece resold before its first registration is in the FAQ (§3) · Verso de la carte (§2) : aucun, la carte n'a qu'une face, son dos est blanc ; la ligne pour une pièce revendue avant son premier enregistrement est dans la FAQ (§3) | Brand · Marque | printing cards · impression des cartes | Closed 2026-10-07 · Clos le 2026-10-07 |
| Second-hand sentence (§3); shown on `/verify` since J-02 ahead of this review, by the owner's decision, and reworded there and here together if the review asks · Phrase sur l'achat d'occasion (§3) ; affichée sur `/verify` depuis J-02 avant cette relecture, par décision du propriétaire, et reformulée là et ici ensemble si la relecture le demande | Legal · Juridique | printing it or publishing it elsewhere · son impression ou sa publication ailleurs | Open · Ouvert |
| French lexicon (§4) · Lexique FR (§4) | Brand and legal · Marque et juridique | any French copy · tout texte en français | Open · Ouvert |
| Announcement (§5): brand, legal review (LAUNCH §10), privacy policy online, H1/H2 review of COMPLIANCE §7 · Annonce (§5) : marque, relecture juridique (LAUNCH §10), politique de confidentialité en ligne, revue H1/H2 de COMPLIANCE §7 | Brand, legal, owner · Marque, juridique, propriétaire | publishing · publication | Open · Ouvert |
