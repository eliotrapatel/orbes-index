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
| theorbes.com/verify opens verify.theorbes.com/verify | `vercel.json` (redirect, live once LAUNCH §9 is done) |

`genome/test/docs/packaging-kit.test.ts` checks this file: no forbidden term, English or French, outside the marked lexicon of §4; no exclamation mark; the official address on the packaging, the card and the announcement, and no other; the card's steps word for word as the renderer draws them; the second-hand sentence in both languages; the H1/H2 hold on the announcement, and in each of its drafts the sentence on what a printed code does not prove and ORBES Client Services (BRAND §4.6).

---

## 1. Packaging text · Texte d'emballage

On the box, sleeve or pouch, or on the insert placed with the piece. The same three steps as the certificate card, in the same order.

Sur la boîte, le fourreau ou la pochette, ou sur la notice glissée avec la pièce. Les trois mêmes étapes que la carte certificat, dans le même ordre.

### EN

Printed, in the house voice (uppercase, tracked), word for word the card's lines:

```
1  OPEN THEORBES.COM/VERIFY
2  SCAN THE ORBES CODE
3  REGISTER WITH THE CLAIM CODE

VERIFY ONLY AT THEORBES.COM/VERIFY
```

Long form (insert, website, e-mail):

> 1. Open theorbes.com/verify: type the address into your phone's browser.
> 2. Scan the ORBES CODE of your piece.
> 3. Register the piece in your name with the claim code from its certificate card.
>
> Verify only at theorbes.com/verify.

### FR

Imprimé, dans la voix de la maison (capitales espacées) :

```
1  OUVREZ THEORBES.COM/VERIFY
2  SCANNEZ L'ORBES CODE
3  ENREGISTREZ AVEC LE CLAIM CODE

VÉRIFIEZ UNIQUEMENT SUR THEORBES.COM/VERIFY
```

Forme longue (encart, site, e-mail) :

> 1. Ouvrez theorbes.com/verify : tapez l'adresse dans le navigateur de votre téléphone.
> 2. Scannez l'ORBES CODE de votre pièce.
> 3. Enregistrez la pièce à votre nom avec le claim code de sa carte certificat.
>
> Vérifiez uniquement sur theorbes.com/verify.

### Rules · Règles

| EN | FR |
|---|---|
| **The address is typed.** Nothing on the packaging opens a website: no other code, beside the ORBES CODE or anywhere else, and no frame or arrow inviting a scan (BRAND §1.2 and §2.10; the words to avoid are in §4). | **L'adresse se tape.** Rien sur l'emballage n'ouvre de site : aucun autre code, ni à côté de l'ORBES CODE ni ailleurs, et aucun cadre ni flèche qui appelle au scan (BRAND §1.2 et §2.10 ; les mots à éviter sont au §4). |
| **One address.** theorbes.com/verify opens the scanner at verify.theorbes.com/verify; the customer may read either in the address bar. No short link, no campaign address, no other domain. | **Une seule adresse.** theorbes.com/verify ouvre le scanner sur verify.theorbes.com/verify ; le client peut lire l'une ou l'autre dans la barre d'adresse. Pas de lien raccourci, pas d'adresse de campagne, aucun autre domaine. |
| **English words on screen.** `/verify` is in English. The French copy keeps the names the customer will read there: ORBES CODE, CLAIM CODE, SCAN ORBES CODE. | **Les mots de l'écran restent en anglais.** `/verify` est en anglais. Le texte français garde les noms que le client y lira : ORBES CODE, CLAIM CODE, SCAN ORBES CODE. |
| **Step 2 names the ORBES CODE**, what the customer scans, not the ORBES SEAL, which is only its centre (BRAND §2.1). The brief said "scan the seal"; the card and this kit say ORBES CODE. | **L'étape 2 nomme l'ORBES CODE**, ce que le client scanne, et non l'ORBES SEAL, qui n'en est que le centre (BRAND §2.1). Le brief disait « scanner le sceau » ; la carte et ce kit disent ORBES CODE. |
| **Step 3 needs an ORBES account.** After the scan, `/verify` offers to sign in or to create one; registration follows that scan. | **L'étape 3 demande un compte ORBES.** Après le scan, `/verify` propose de se connecter ou d'en créer un ; l'enregistrement suit ce scan. |
| **Capitals.** The printed lines set the address in capitals. Before printing, type THEORBES.COM/VERIFY in capitals on a phone and check that it reaches the scanner (§6). If it does not, the packaging sets the address in lower case, and no card is printed until the redirect accepts capitals or the card's lettering can draw lower case: its stroked capitals (`genome/src/server/render/label-font.ts`) have none, so the card cannot simply switch. | **Capitales.** Les lignes imprimées composent l'adresse en capitales. Avant impression, tapez THEORBES.COM/VERIFY en capitales sur un téléphone et vérifiez que le scanner s'ouvre (§6). Sinon, l'emballage passe l'adresse en minuscules, et aucune carte n'est imprimée tant que la redirection n'accepte pas les capitales ou que le lettrage de la carte ne sait pas tracer de minuscules : ses capitales gravées (`genome/src/server/render/label-font.ts`) n'en ont pas, la carte ne peut donc pas simplement changer. |

---

## 2. Certificate card · Carte certificat

### Recto: the card the console draws · Recto : la carte que dessine la console

The recto is the card of BRAND §7, not a second template: the console offers DOWNLOAD CERTIFICATE CARD while the claim code is shown, and `POST /api/admin/certificates` returns A4 sheets of ten and the print shop's CSV ([API §15.7](../API.md#157-post-apiadmincertificates-extension-of-the-contract), LAUNCH §7). The server checks each claim code against its stored hash before drawing it. This kit fixes the card's words only.

Le recto est la carte de BRAND §7, pas un second gabarit : la console propose DOWNLOAD CERTIFICATE CARD tant que le claim code est affiché, et `POST /api/admin/certificates` donne les planches A4 de dix cartes et le CSV de l'imprimeur. Le serveur vérifie chaque claim code contre son empreinte avant de le dessiner. Ce kit ne fixe que les mots de la carte.

![Certificate card specimen: ORBES and CERTIFICATE with the PROOF mention, the monogram, identity, GENOME row, model, material, three steps, claim code under the scratch-off panel](../assets/certificate-card-specimen.svg)

Its copy, in English like `/verify`, word for word as `CERTIFICATE_COPY` draws it:

| Line | Copy |
|---|---|
| Title | CERTIFICATE |
| Identity | the piece's identity (e.g. O26-J-00184), its GENOME row and fingerprint |
| Facts | MODEL · MATERIAL |
| Steps | 1 OPEN THEORBES.COM/VERIFY · 2 SCAN THE ORBES CODE · 3 REGISTER WITH THE CLAIM CODE |
| Panel | CLAIM CODE, and the code `XXXX-XXXX-XXXX` under the scratch-off panel |
| Foot | VERIFY ONLY AT THEORBES.COM/VERIFY |
| Until the brand's sign-off | PROOF · LAYOUT NOT VALIDATED |

En français, pour relecture (la carte reste imprimée en anglais) : CERTIFICAT · MODÈLE · MATIÈRE · 1 OUVREZ THEORBES.COM/VERIFY · 2 SCANNEZ L'ORBES CODE · 3 ENREGISTREZ AVEC LE CLAIM CODE · CLAIM CODE · VÉRIFIEZ UNIQUEMENT SUR THEORBES.COM/VERIFY.

**Declared deviation · Écart assumé.** The brief opened the card in the console only after the brand's validation. It ships now, and every card, sheet and file name says PROOF until `CERTIFICATE_LAYOUT_STATUS` becomes `VALIDATED` on the brand's sign-off (`genome/src/server/render/certificate.ts`, BRAND §8 item 20). No card is printed for customers before that.
Le brief n'ouvrait la carte dans la console qu'après validation par la marque. Elle est livrée dès maintenant, et chaque carte, planche et nom de fichier porte PROOF tant que `CERTIFICATE_LAYOUT_STATUS` n'est pas passé à `VALIDATED`, sur validation de la marque. Aucune carte n'est imprimée pour un client avant.

### The claim code · Le claim code

| EN | FR |
|---|---|
| Under the scratch-off panel (spot colour ORBES SCRATCH-OFF), on the card only. **Never on the piece**, its tag or the outside of the packaging; never in a photograph, an e-mail or a message (BRAND §2.10). | Sous la zone à gratter (ton direct ORBES SCRATCH-OFF), sur la carte seulement. **Jamais sur la pièce**, son étiquette ou l'extérieur de l'emballage ; jamais dans une photo, un e-mail ou un message (BRAND §2.10). |
| The card goes inside the packaging, with the piece. Staff never scratch the panel: the console shows the code once and keeps only its hash. | La carte va dans l'emballage, avec la pièce. Le personnel ne gratte jamais la zone : la console montre le code une fois et n'en garde que l'empreinte. |
| It registers the piece once, at its first registration. Afterwards the piece changes hands with a transfer code (valid 7 days), never with the card; the console refuses to draw a card for a registered piece. | Il enregistre la pièce une seule fois, à sa première inscription. Ensuite la pièce change de mains par un code de transfert (valable 7 jours), jamais par la carte ; la console refuse de dessiner la carte d'une pièce enregistrée. |
| After 5 wrong attempts within an hour, registration of that piece is paused for up to an hour. | Après 5 essais manqués en une heure, l'enregistrement de cette pièce est suspendu pendant une heure au plus. |
| A card lost before registration: the customer writes to ORBES Client Services. | Carte perdue avant l'enregistrement : le client écrit à ORBES Client Services. |

### Verso: fixed text (proposal) · Verso : texte fixe (proposition)

The console draws the recto only. The verso is the same on every card and is printed by the print shop from one fixed plate, or becomes an insert if the brand prefers. Proposed copy, house voice (uppercase titles, one sentence-case paragraph each):

Le recto seul est dessiné par la console. Le verso, identique sur toutes les cartes, est imprimé par l'imprimeur à partir d'une plaque fixe, ou devient un encart si la marque le préfère. Proposition :

**EN**

> **YOUR CLAIM CODE**
> Scratch the panel only when you register your piece at theorbes.com/verify. The claim code registers it once, in your name. Keep this card with your piece; never photograph or share the code.
>
> **CHANGE OF OWNER**
> Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one. If the panel is intact and the piece is not yet registered, register it with this claim code.
>
> VERIFY ONLY AT THEORBES.COM/VERIFY

**FR**

> **VOTRE CLAIM CODE**
> Ne grattez la zone qu'au moment d'enregistrer votre pièce sur theorbes.com/verify. Le claim code l'enregistre une seule fois, à votre nom. Gardez cette carte avec votre pièce ; ne photographiez et ne partagez jamais le code.
>
> **CHANGEMENT DE PROPRIÉTAIRE**
> Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un. Si la zone est intacte et la pièce pas encore enregistrée, enregistrez-la avec ce claim code.
>
> VÉRIFIEZ UNIQUEMENT SUR THEORBES.COM/VERIFY

---

## 3. Second-hand purchase · Achat d'occasion

One sentence, word for word on the card's verso, in the FAQ and under the AUTHENTIC — REGISTERED result of `/verify` (planned, J-02). Changing it here means changing it everywhere. The announcement only adapts its first words (§5). The verso adds one line for a piece resold before anyone registered it: it has no owner yet, so no transfer code can exist, and the buyer registers it with the claim code (§2). `/verify` needs no such line: J-02 shows the sentence for a registered piece only.

Une seule phrase, mot pour mot au verso de la carte, dans la FAQ et sous le résultat AUTHENTIC — REGISTERED de `/verify` (prévu, J-02). La changer ici, c'est la changer partout. L'annonce n'en adapte que les premiers mots (§5). Le verso ajoute une ligne pour une pièce revendue avant tout enregistrement : elle n'a pas encore de propriétaire, donc aucun code de transfert ne peut exister, et l'acheteur l'enregistre avec le claim code (§2). `/verify` n'a pas besoin de cette ligne : J-02 n'y montre la phrase que pour une pièce enregistrée.

| EN | FR |
|---|---|
| Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one. | Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un. |

**Why.** A perfect copy of a code verifies like the original (BRAND §4.6): once the original piece is registered, every copy reads AUTHENTIC — REGISTERED. Only the registered owner can create a transfer code, and the transfer completes when the buyer enters it in their own ORBES account. A transfer code is therefore what shows that the seller holds the registration; a scratched card shows nothing, since its claim code has already been used.

**Pourquoi.** Une copie parfaite d'un code vérifie comme l'original (BRAND §4.6) : dès que la pièce d'origine est enregistrée, chaque copie affiche AUTHENTIC — REGISTERED. Seul le propriétaire enregistré peut créer un code de transfert, et le transfert s'achève quand l'acheteur le saisit dans son propre compte ORBES. C'est donc le code de transfert qui montre que le vendeur détient l'enregistrement ; une carte grattée ne montre rien, puisque son claim code a déjà servi.

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
| Card recto: the specimen of BRAND §7 and a physical print proof from the chosen press (the monogram's 0.077 mm hairlines, BRAND §3.9), then `CERTIFICATE_LAYOUT_STATUS` set to `VALIDATED` and the specimens regenerated (BRAND §8 item 20) · Recto de la carte : le spécimen de BRAND §7 et une épreuve imprimée par l'imprimeur choisi (les filets de 0,077 mm du monogramme, BRAND §3.9), puis `CERTIFICATE_LAYOUT_STATUS` passé à `VALIDATED` et les spécimens régénérés (BRAND §8 point 20) | Brand · Marque | printing cards · impression des cartes | Open · Ouvert |
| Card verso, or insert (§2), with its line for a piece resold before its first registration (§3) · Verso de la carte, ou notice (§2), avec sa ligne pour une pièce revendue avant son premier enregistrement (§3) | Brand · Marque | printing cards · impression des cartes | Open · Ouvert |
| Second-hand sentence (§3) · Phrase sur l'achat d'occasion (§3) | Legal · Juridique | printing or publishing it · son impression ou sa publication | Open · Ouvert |
| French lexicon (§4) · Lexique FR (§4) | Brand and legal · Marque et juridique | any French copy · tout texte en français | Open · Ouvert |
| Announcement (§5): brand, legal review (LAUNCH §10), privacy policy online, H1/H2 review of COMPLIANCE §7 · Annonce (§5) : marque, relecture juridique (LAUNCH §10), politique de confidentialité en ligne, revue H1/H2 de COMPLIANCE §7 | Brand, legal, owner · Marque, juridique, propriétaire | publishing · publication | Open · Ouvert |
