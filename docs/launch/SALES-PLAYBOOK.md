# ORBES — Procédure de vente et d'expédition

Statut : **brouillon écrit à partir du code** (recommandation J-09). La vérification d'identité du §6 est à finaliser avec le juriste. La checklist du §9 est validée quand une personne qui n'a jamais vu la console l'a réalisée seule en moins de 30 minutes (§11).

Liens : [LAUNCH](../LAUNCH.md) §4, §7 et §11 · [API](../API.md) §9.3, §14.4, §14.6 et §16.18 · [BRAND-DESIGN-SYSTEM](../BRAND-DESIGN-SYSTEM.md) §4 · [SECURITY-MODEL](../SECURITY-MODEL.md) §3.3 · [kit emballage](PACKAGING-KIT.md).

**Pourquoi ce guide.** Un client ne peut enregistrer sa pièce que si sa vente a été inscrite chez ORBES : la garantie activée, en mode Boutique ou dans la console. Sinon, chez lui, l'onglet `OWNERSHIP` du résultat dit `NOT YET DELIVERED` et ne propose aucun enregistrement : une pièce en règle devient un problème dès le premier scan. Ce guide donne, pour chaque situation, le geste dans la console et la phrase à dire. Il évite aussi de promettre ce que le système ne prouve pas (§8).

**Comment le lire.**

- Les `mots entre accents graves` sont ceux de l'écran, en anglais, tels que la console ou theorbes.com/verify les affichent : un bouton, un champ, un statut, un fichier. Ce sont des mots internes : on ne les lit pas au client (BRAND §4.1).
- Les phrases en retrait sont à dire au client, telles quelles. Les mots de l'écran y restent en anglais et en capitales, comme le client les lit sur son téléphone.
- Les rôles de la console (SECURITY-MODEL §3.3) : **RETAIL**, un vendeur, n'a que le mode Boutique ; **AUDITOR** lit ; **OPERATOR** émet les pièces, active les garanties, déclare une perte ou un vol, ouvre les entretiens ; **ADMIN** gère l'équipe, les points de vente et les gestes sensibles sur un compte client (code de récupération, verrouillage, export).
- La console : `https://verify.theorbes.com/admin`. Le client : theorbes.com/verify, qu'il tape lui-même.

Ce guide ne décrit que ce que fait le logiciel. Ses sources :

| Sujet | Source |
|---|---|
| Mode Boutique, ses refus et la phrase de fin de vente | `genome/src/web/admin/views/sale.ts`, `CLIENT_REGISTRATION` dans `genome/src/web/admin/model/sale.ts`, API §16.18 |
| Activation de la garantie depuis la fiche d'une pièce | `genome/src/web/admin/views/product.ts`, API §14.6 |
| Titre et phrase de chaque résultat | `VERIFICATION_COPY` dans `genome/src/server/services/copy.ts`, API §9.3 et §9.4 |
| Onglet `OWNERSHIP` : enregistrement, transfert, `NOT YET DELIVERED`, `STAFF SCAN` | `genome/src/web/verify/views/ownership.ts`, BRAND §4.4 |
| Transitions `LOST` et `STOLEN` | `genome/src/server/services/lifecycle.ts`, API §14.4 et §11.5 |
| Code de récupération, verrouillage d'un compte client | `genome/src/web/admin/views/owners.ts`, `genome/src/web/admin/views/owner.ts`, API §10.8, §16.10 et §16.12 |
| Comptes de la console | `genome/scripts/admin.ts`, `genome/src/web/admin/views/team.ts`, SECURITY-MODEL §3.3 |
| Les chiffres du §0 | les constantes nommées dans leur tableau |

`genome/test/docs/sales-playbook.test.ts` vérifie ce fichier : aucun mot interdit (BRAND §4.5 et le lexique français du kit, §4) hors du bloc lexique du §8, sauf dans les mots de l'écran entre accents graves, qui doivent alors se trouver tels quels dans le code ; aucune exception dans les phrases à dire ; un résultat de l'API §9.3 par section du §3, avec sa phrase en anglais mot pour mot ; les chiffres du §0 égaux aux constantes du code ; la phrase de fin de vente, la phrase sur l'achat d'occasion et les commandes du §10 telles que le logiciel les connaît ; une checklist de 30 minutes au plus.

---

## 0. Avant la première pièce

- **Les points de vente.** Un ADMIN les crée dans `Points of sale` (groupe `Clients` de la barre latérale) : chaque boutique, chaque grand magasin et la boutique en ligne, sans pays pour celle-ci. Une boutique fermée est désactivée, jamais supprimée.
- **Un compte par personne** (§10) : RETAIL pour chaque vendeur, OPERATOR pour l'atelier et ORBES Client Services. Jamais de compte partagé, même sur le téléphone d'un comptoir.
- **Les coordonnées d'ORBES Client Services** sont configurées (`CLIENT_SERVICES_EMAIL`, `CLIENT_SERVICES_PHONE`, `CLIENT_SERVICES_HOURS`, LAUNCH §10). Sans elles, un résultat qui demande de contacter ORBES Client Services n'offre ni e-mail ni téléphone.
- **La carte certificat.** Tant qu'elle porte la mention PROOF, aucune carte n'est remise à un client (kit, §6) : la première vente attend la validation de la carte par la marque.
- **La checklist du §9**, une fois, par chaque personne qui vendra ou répondra aux clients.

**Les chiffres à connaître.**

| Règle | Valeur | Source |
|---|---|---|
| Fenêtre d'enregistrement après un scan | 15 minutes | `SCAN_TOKEN_TTL_MS` |
| Validité d'un scan en mode Boutique | 10 minutes | `SALE_TOKEN_TTL_MS` |
| Essais manqués de claim code, par pièce et par heure | 5 | `CLAIM_ATTEMPT_LIMIT` |
| Validité d'un code de transfert | 7 jours | `TRANSFER_TTL_MS` |
| Validité d'un code de récupération | 30 minutes | `RECOVERY_CODE_TTL_MS` |
| Essais manqués d'un code de récupération, par heure | 5 | `RECOVERY_ATTEMPT_LIMIT` |
| Pause des transferts après une récupération | 72 heures | `TRANSFER_FREEZE_MS` |
| Longueur minimale d'un mot de passe | 12 caractères | `PASSWORD_MIN_LENGTH` |
| Échecs de connexion avant le verrouillage d'un compte de la console | 10 | `ADMIN_LOCKOUT_THRESHOLD` |
| Durée de ce verrouillage | 15 minutes | `ADMIN_LOCKOUT_MS` |

---

## 1. Vente en boutique

La vente s'inscrit **au moment où la pièce est remise**, avec la date d'achat, le point de vente et le pays. Ensuite le client enregistre lui-même la pièce à son nom, avec le claim code de sa carte.

### Au comptoir : le mode Boutique

Sur le téléphone du comptoir, avec votre compte RETAIL (ou OPERATOR) :

1. Ouvrez `https://verify.theorbes.com/admin` et connectez-vous : `Email`, `Password`, puis `Authenticator code`, les six chiffres de votre application d'authentification. Un compte RETAIL arrive directement sur `Sale mode` ; un OPERATOR l'ouvre dans la barre latérale (groupe `Clients`).
2. `Point of sale` : choisissez votre boutique, une fois. Le téléphone s'en souvient pour la vente suivante.
3. `Scan the piece`, et visez l'ORBES CODE de la pièce vendue (ou `Upload a photo`). Chaque scan est inscrit à votre nom (`Each scan here is recorded under your name.`).
4. Lisez l'écran (tableau ci-dessous). Avec `READY TO SELL`, vérifiez que l'identité affichée (`O26-…`) est celle imprimée sur la carte certificat rangée avec la pièce.
5. `Activate warranty`, dans les 10 minutes qui suivent le scan (`This scan stays valid for … minutes.`). Passé ce délai, scannez de nouveau.
6. L'écran affiche `WARRANTY ACTIVE`, les dates de la garantie et votre point de vente, puis `Tell the client` : `Register your piece with its card at theorbes.com/verify.`
7. Remettez la carte certificat, **zone à gratter intacte** : le personnel ne la gratte jamais. Puis `Next sale`.

Le mode Boutique inscrit la vente **aujourd'hui**, avec le pays du point de vente. Pour une vente d'un autre jour (téléphone indisponible, vente oubliée), un OPERATOR l'inscrit dans la console, ci-dessous.

| L'écran affiche | Ce que cela veut dire | Ce que vous faites |
|---|---|---|
| `READY TO SELL` | Un code signé par ORBES, d'une pièce de son registre, dont la garantie n'a pas commencé | Le point de vente choisi, `Activate warranty` |
| `ALREADY SOLD` | La garantie a déjà commencé, ou un compte client détient la pièce | Ne vendez pas. Mettez la pièce de côté et prévenez ORBES Client Services avec son identité |
| `WARRANTY VOID` | La garantie a été annulée | Ne vendez pas. ORBES Client Services |
| `NOT FOR SALE` | Le statut de la pièce ne permet pas la vente, ou elle est en entretien | Ne vendez pas. L'atelier clôt d'abord l'entretien |
| `SUSPICIOUS ACTIVITY`, `REVOKED`, `UNKNOWN`, `INVALID SIGNATURE` | Le code n'a pas été reconnu comme celui d'une pièce qu'ORBES peut vendre | Ne vendez pas. Mettez la pièce de côté, notez son identité et prévenez un OPERATOR : le scan est inscrit à votre nom, il le retrouvera |
| `MALFORMED CODE` | Le code n'a pas été lu | `Scan again` sous une lumière égale, ou `Upload a photo` |

### Sans le mode Boutique : la console

Un OPERATOR, sur un ordinateur : `Products` → `Search` : l'identité de la pièce → `Apply` → la ligne de la pièce. Sur sa fiche, section `Actions`, groupe `Warranty` → `Activate warranty`. Dans `Activate the warranty` :

- `Purchase date` : le jour de la vente ;
- `Point of sale` : la boutique, dans la liste des points de vente ;
- `Country` : deux lettres (FR) ; vide, c'est le pays du point de vente.

Puis `Activate`. La console répond `Warranty activated.` ; en tête de fiche, `Lifecycle` passe à `ACTIVATED` et `Warranty` à `ACTIVE` ([capture de la fiche](../assets/ui/admin-02-product.png)).

### Ce que vous dites

> Votre pièce est inscrite chez ORBES et sa garantie commence aujourd'hui. Enregistrez-la à votre nom avec sa carte sur theorbes.com/verify : tapez l'adresse, scannez l'ORBES CODE, puis grattez la zone de la carte pour lire le claim code. Il l'enregistre une seule fois, à votre nom.

> Gardez la carte avec la pièce, et ne photographiez ni ne partagez jamais ce code.

Si le client demande ce que prouve le résultat, la phrase est au §3. Ne promettez jamais davantage (§8).

### Si la vente n'a pas été inscrite

Le client voit `AUTHENTIC` et, dans l'onglet `OWNERSHIP`, `NOT YET DELIVERED` : l'enregistrement ne s'ouvre qu'après l'activation de la garantie. Activez-la dans la console avec **la date d'achat réelle** et le point de vente de la vente, puis demandez au client de scanner de nouveau la pièce : il lit `AUTHENTIC — FIRST REGISTRATION` et peut l'enregistrer.

---

## 2. Expédition en ligne

Une vente en ligne s'inscrit **dans la console, avant l'envoi**, pour que le client puisse enregistrer la pièce dès réception. Pas en mode Boutique : il prend le pays du point de vente, et la boutique en ligne n'en a pas.

1. Avant l'emballage, vérifiez que l'identité imprimée sur la carte certificat (`O26-…`) est celle de la pièce : celle de son étiquette, ou le `PRODUCT ID` de l'onglet `PRODUCT` quand vous scannez la pièce depuis le navigateur où la console est ouverte (un scan staff, sans signal, §7).
2. Console : `Products` → la pièce → `Activate warranty` :
   - `Purchase date` : la date de la commande ;
   - `Point of sale` : la boutique en ligne ;
   - `Country` : le pays de livraison, en deux lettres. Remplissez-le toujours : la boutique en ligne n'a pas de pays par défaut.

   Puis `Activate`, et vérifiez `Warranty` `ACTIVE`.
3. La carte certificat va **dans le colis, dans l'emballage, avec la pièce**, zone à gratter intacte. Le claim code n'apparaît jamais à l'extérieur du colis, sur la facture, dans l'e-mail de confirmation ni dans aucun message.
4. Le texte d'emballage en trois étapes est celui du [kit](PACKAGING-KIT.md), §1.

Dans l'e-mail d'expédition, ou sur la notice glissée dans le colis :

> Votre pièce voyage avec sa carte certificat. À réception, ouvrez theorbes.com/verify, scannez l'ORBES CODE de la pièce, puis enregistrez-la à votre nom avec le claim code de la carte. Vérifiez uniquement sur theorbes.com/verify.

**Retour d'une commande expédiée.** Rien dans la console n'annule une garantie commencée ni ne remet une pièce en stock : `Void warranty` est définitif, et le mode Boutique refuse ensuite la pièce (`ALREADY SOLD`). Gardez la pièce à part et signalez-la à un ADMIN ; sa remise en vente se décide au cas par cas (§11).

---

## 3. Client inquiet

Un client vous montre un résultat, au comptoir ou au téléphone.

1. Demandez-lui la **référence** en bas de l'écran : `REF` suivi de huit caractères. Et, s'il le veut bien, où il a vu ou acheté la pièce.
2. Console (AUDITOR et au-dessus) : `Owners` → `Email or REF` : `REF` et les huit caractères → `Search`. La section `Reference` donne le scan, la pièce, le compte connecté au moment du scan et le propriétaire de la pièce ; chaque ligne mène à sa fiche.
3. Ne dites jamais la raison interne d'un résultat (un statut, un signal, un score), ni qui est le propriétaire d'une pièce (BRAND §4.1). Un vendeur RETAIL ne voit pas ces pages : il note la REF et passe la main à ORBES Client Services.
4. Sur un résultat qui n'est pas AUTHENTIC, la réponse du client à `WHERE DID YOU SEE OR BUY THIS PIECE?` arrive dans `Cases` (LAUNCH §11).

Ce que prouve un résultat AUTHENTIC, si le client le demande :

> Le résultat AUTHENTIC confirme une identité émise et signée par ORBES, et ce que le registre ORBES en sait : enregistrement, garantie, entretien. Un code imprimé peut être copié : à lui seul, il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué. ORBES Client Services peut examiner une pièce sur demande.

### AUTHENTIC — FIRST REGISTRATION

Le client lit : *This ORBES identity was issued and signed by ORBES and has not yet been registered. You may register it to your ORBES account.*

**Ce que cela veut dire.** La vente est inscrite, la pièce n'a pas encore de propriétaire. L'onglet `OWNERSHIP` propose l'enregistrement pendant 15 minutes après le scan (`REGISTRATION OPEN UNTIL` et l'heure).

**Ce que vous faites.** Guidez le client : `OWNERSHIP` → `SIGN IN` ou `CREATE ACCOUNT` → `CLAIM CODE` → `REGISTER THIS PIECE`. Délai passé : il scanne de nouveau. Après 5 claim codes manqués en une heure, l'enregistrement de la pièce attend jusqu'à une heure.

> Votre pièce est prête à être enregistrée. Dans l'onglet OWNERSHIP, connectez-vous ou créez votre compte ORBES, puis saisissez le claim code de votre carte, sous la zone à gratter. Si le délai affiché est passé, scannez de nouveau la pièce.

### AUTHENTIC — REGISTERED

Le client lit : *This ORBES identity was issued and signed by ORBES and is registered to its owner.*

**Ce que cela veut dire.** La pièce est enregistrée à un compte ORBES qui n'est pas celui du lecteur, ou le lecteur n'est pas connecté. Sous la phrase, l'écran ajoute la consigne d'achat d'occasion et `I HAVE A TRANSFER CODE` (§4).

**Ce que vous faites.** Si c'est le propriétaire : il se connecte dans l'onglet `OWNERSHIP` et scanne de nouveau. S'il achète la pièce : le code de transfert (§4).

> Cette pièce est enregistrée à un compte ORBES. Si c'est le vôtre, connectez-vous dans l'onglet OWNERSHIP, puis scannez-la de nouveau. Si vous l'achetez, demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.

### AUTHENTIC — OWNERSHIP VERIFIED

Le client lit : *This ORBES identity was issued and signed by ORBES and is registered to your account.*

**Ce que cela veut dire.** Le lecteur, connecté, est le propriétaire enregistré.

**Ce que vous faites.** Rien de plus. La garantie est dans l'onglet `WARRANTY` ; le transfert, dans l'onglet `OWNERSHIP`.

> Cette pièce est enregistrée à votre compte ORBES. Sa garantie est dans l'onglet WARRANTY ; si elle change de mains un jour, c'est dans l'onglet OWNERSHIP que vous créerez le code de transfert.

### AUTHENTIC — OWNERSHIP VERIFIED, avec une activité inhabituelle

Le client lit : *This ORBES identity is registered to your account. Unusual activity has been recorded for it; ORBES Client Services can assist you.*

**Ce que cela veut dire.** La pièce est bien celle du compte connecté, mais l'historique des scans de son code demande un examen (par exemple, des scans du même code ailleurs).

**Ce que vous faites.** Un OPERATOR ouvre la fiche de la pièce, section `Anomalies`, puis `Triage`. Ne dites ni où ni combien de scans ont eu lieu.

> Votre pièce reste enregistrée à votre nom. Une activité inhabituelle a été enregistrée pour cette identité ORBES : c'est une demande d'examen, pas un verdict. ORBES Client Services l'examine et peut vous accompagner.

### AUTHENTIC

Le client lit : *This ORBES identity was issued and signed by ORBES and is registered to an active piece.*

**Ce que cela veut dire.** La pièce n'est pas encore inscrite comme vendue : sa garantie n'a pas commencé (en stock, ou en entretien avant la vente). L'onglet `OWNERSHIP` dit `NOT YET DELIVERED` et n'offre pas d'enregistrement.

**Ce que vous faites.**

- Le client l'a achetée chez ORBES ou chez un détaillant agréé : retrouvez la pièce (son `PRODUCT ID` dans l'onglet `PRODUCT`, ou la REF), vérifiez `Warranty` `NOT STARTED`, activez la garantie avec la date d'achat réelle et le point de vente (§1 ou §2), puis demandez-lui de scanner de nouveau.
- Il l'a achetée ailleurs, à un particulier par exemple : n'activez rien. Une pièce qu'ORBES n'a jamais vendue, scannée hors de la console, ouvre `UNSOLD PIECE SCANNED` dans `Anomalies` (S-07) : notez la REF et le lieu d'achat, et prévenez un OPERATOR.

> Le résultat AUTHENTIC confirme que cette identité a été émise et signée par ORBES. L'enregistrement s'ouvre dès que la vente de la pièce est inscrite chez ORBES : je vérifie, puis vous scannerez de nouveau la pièce pour l'enregistrer à votre nom avec le claim code de votre carte.

### UNUSUAL ACTIVITY DETECTED

Le client lit : *The activity recorded for this ORBES identity requires review. Please contact ORBES Client Services before relying on it.*

**Ce que cela veut dire.** Un examen est demandé avant de se fier à la pièce. Les causes sont internes et ne se disent pas : une perte ou un vol déclarés, un code ou un GENOME qui ne correspondent pas au registre, un historique de scans inhabituel.

**Ce que vous faites.** La REF, puis la fiche de la pièce : `Lifecycle`, `Anomalies`. Un OPERATOR décide. Si la pièce n'est pas enregistrée et que le client a sa carte intacte, le résultat lui propose `DO YOU HOLD THE CERTIFICATE CARD?` : il peut l'enregistrer avec le claim code.

> Ce résultat demande un examen ; ce n'est pas un verdict. Avant que vous vous fiiez à cette pièce, ORBES Client Services va regarder son historique : pouvez-vous me donner la référence REF en bas de l'écran, et me dire où vous avez vu ou acheté la pièce ?

### UNREADABLE CODE

Le client lit : *This code could not be read. Please scan it again in even light, holding the camera steady.*

**Ce que cela veut dire.** Le code n'a pas été lu : lumière, flou, distance, ou étiquette abîmée.

**Ce que vous faites.** Conseillez une lumière égale, 10 à 20 cm, le code entier dans l'orbite. Une étiquette abîmée : un OPERATOR signe un nouveau code depuis la fiche de la pièce (`Re-issue code`) et fait refaire l'étiquette ; l'ancien code se lit alors `REVOKED`.

> Le code n'a pas pu être lu. Scannez-le de nouveau sous une lumière égale, à 10 ou 20 cm, en tenant le téléphone immobile, le code entier dans l'orbite.

### REVOKED

Le client lit : *This ORBES identity is no longer valid. Please contact ORBES Client Services.*

**Ce que cela veut dire.** Cette identité n'est plus valide : son code a été remplacé par un nouveau (étiquette refaite), ou révoqué, ou la pièce a été retirée (`REVOKED`, `RETIRED`, `COUNTERFEIT FLAGGED` sur sa fiche).

**Ce que vous faites.** La REF, puis la fiche de la pièce : section `Codes` (`SUPERSEDED`, `REVOKED`) et `Lifecycle`. Si l'étiquette a été refaite, la pièce porte un nouveau code : c'est celui-là qu'on scanne.

> Cette identité ORBES n'est plus valide. ORBES Client Services peut vous accompagner : pouvez-vous me donner la référence REF en bas de l'écran ?

### UNKNOWN ORBES CODE

Le client lit : *This code is not registered with ORBES. Please contact ORBES Client Services.*

**Ce que cela veut dire.** Le code n'est pas dans le registre ORBES. C'est rare et sérieux : soit le code est signé par une clé ORBES pour une identité jamais inscrite, et la console ouvre un signal CRITICAL `VALID SIGNATURE UNREGISTERED`, signe possible d'une clé compromise ; soit le serveur ne connaît pas encore la version de ce code.

**Ce que vous faites.** La REF et le lieu d'achat, puis prévenez **un ADMIN immédiatement** (DEPLOYMENT §7.5, compromission d'une clé).

> Ce code n'est pas enregistré chez ORBES. ORBES Client Services peut vous accompagner : pouvez-vous me donner la référence REF en bas de l'écran, et me dire où vous avez vu ou acheté la pièce ?

### INVALID SIGNATURE

Le client lit : *The signature of this code could not be verified against a valid ORBES key.*

**Ce que cela veut dire.** Le code n'a pas été signé par une clé ORBES valide.

**Ce que vous faites.** La REF et le lieu d'achat. ORBES Client Services suit la réponse du client dans `Cases`.

> La signature de ce code n'a pas pu être vérifiée avec une clé ORBES valide. ORBES Client Services peut vous accompagner : pouvez-vous me donner la référence REF en bas de l'écran, et me dire où vous avez vu ou acheté la pièce ?

---

## 4. Revente

Une pièce enregistrée change de mains par un **code de transfert**, créé par son propriétaire enregistré dans son propre compte. Le personnel ne crée jamais ce code à sa place, et ne demande ni ne saisit jamais le mot de passe d'un client. La carte certificat ne prouve rien après l'enregistrement : son claim code a déjà servi.

**Le vendeur (le propriétaire enregistré).** Sur theorbes.com/verify, connecté, il scanne sa pièce (`AUTHENTIC — OWNERSHIP VERIFIED`), puis onglet `OWNERSHIP`, `TRANSFER OF OWNERSHIP` → `CREATE TRANSFER CODE`. Le code est valable 7 jours ; un seul transfert peut être en attente ; `CANCEL TRANSFER` l'annule tant qu'il n'a pas servi.

**L'acheteur.** Il scanne la pièce : `AUTHENTIC — REGISTERED`, avec sous la phrase la consigne d'achat d'occasion (`RESALE_GUIDANCE`, `genome/src/web/verify/copy.ts`, J-02) et `I HAVE A TRANSFER CODE`, qui ouvre l'onglet `OWNERSHIP` sur `RECEIVING THIS PIECE`. Connecté à son compte ORBES, il saisit `TRANSFER CODE` → `RECEIVE THIS PIECE`. Le code n'est accepté que pour la pièce que l'acheteur vient de scanner, connecté, dans les 15 minutes qui suivent ce scan (F-03). Le transfert est alors définitif.

**Dans la console.** La fiche de la pièce, section `Ownership` : `Transfer` `PENDING` pendant l'attente, puis le nouveau propriétaire et la ligne du transfert dans l'historique.

**Cas particuliers.**

- Une pièce revendue avant tout enregistrement n'a pas de propriétaire : aucun code de transfert ne peut exister. Si la zone de la carte est intacte, l'acheteur l'enregistre avec le claim code (kit, §2).
- Après la récupération d'un mot de passe (§6), les transferts depuis ce compte sont suspendus 72 heures (`TRANSFERS_PAUSED`).

Ce que vous dites à l'acheteur, mot pour mot comme l'écran (*Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.*) :

> Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.

Au vendeur :

> Connecté à votre compte, scannez votre pièce, puis dans l'onglet OWNERSHIP touchez CREATE TRANSFER CODE et donnez ce code au seul acheteur. Il reste valable 7 jours, et vous pouvez l'annuler tant qu'il n'a pas servi.

À l'acheteur, ensuite :

> Connecté à votre compte ORBES, scannez la pièce, touchez I HAVE A TRANSFER CODE, puis saisissez le code dans les 15 minutes qui suivent le scan. La pièce passe alors à votre nom.

---

## 5. Perte ou vol

### Le client déclare lui-même : MY PIECES

Sur theorbes.com/verify, connecté, le client ouvre `MY PIECES` (sur l'accueil, ou dans la ligne de son compte de l'onglet `OWNERSHIP`), choisit la pièce et déclare sa perte ou son vol, puis confirme (F-01). Aussitôt :

- un transfert en attente est annulé ;
- chaque scan de la pièce affiche UNUSUAL ACTIVITY DETECTED, et ses codes ne peuvent plus être imprimés ;
- chaque scan ouvre dans `Anomalies` un signal `LOST STOLEN SCAN`, avec le pays du scan.

Une perte que le client a déclarée lui-même, il la lève lui-même : `PIECE FOUND` dans `MY PIECES` rend à la pièce son statut d'avant. Un vol, lui, n'est levé que par ORBES Client Services.

> Vous pouvez déclarer la perte ou le vol vous-même : sur theorbes.com/verify, connectez-vous, ouvrez MY PIECES, choisissez la pièce et confirmez la déclaration. Si vous retrouvez une pièce que vous aviez déclarée perdue, PIECE FOUND la rétablit ; après un vol, ORBES Client Services s'en charge avec vous.

### ORBES Client Services déclare : la console

Un OPERATOR, après la vérification d'identité du §6 quand la demande vient du client (une déclaration change ce que lit chaque personne qui scanne la pièce) :

1. `Products` → la pièce → section `Actions`, groupe `Lifecycle` → `Change status`.
2. `New status` : `LOST` (perte) ou `STOLEN` (vol). `Reason` : qui l'a demandé, quand, et la référence d'un éventuel échange. `Continue`, puis `Apply`.
3. Pièce retrouvée : `Change status` → le statut d'avant, marqué `(return)` → `Apply`. Seul le retour au statut d'avant est possible.

Une pièce perdue en stock ou pendant un transport se déclare de la même façon. Si quelqu'un la scanne ensuite, `UNSOLD PIECE SCANNED` ou `LOST STOLEN SCAN` dans `Anomalies` donne le pays et le jour.

### Quand quelqu'un présente une pièce déclarée

Le résultat dit UNUSUAL ACTIVITY DETECTED. Ne dites jamais que la pièce a été déclarée perdue ou que son vol a été déclaré : la phrase est celle du §3. Notez la REF et le lieu d'achat, et prévenez un OPERATOR.

---

## 6. Mot de passe oublié

Il n'y a pas d'e-mail de réinitialisation : un client qui a oublié son mot de passe passe par ORBES Client Services (C-04, A-06). Après la vérification de son identité, un ADMIN lui donne un **code de récupération** : à usage unique, valable 30 minutes.

### Vérification d'identité (ébauche, à finaliser avec le juriste)

SECURITY-MODEL §3.6 : un code de récupération, un verrouillage à la demande du client et un export de ses données ne se donnent qu'après cette vérification. Ébauche pour le personnel :

1. C'est le client qui donne les informations ; vous les comparez à la console, sans jamais les lui lire d'abord.
2. L'adresse e-mail exacte du compte : `Owners` → `Email or REF` → l'adresse entière → `Search` (il n'y a pas de recherche partielle). La fiche du client montre ses pièces, ses transferts et ses derniers scans.
3. Au moins une preuve liée à une pièce du compte :
   - la facture : sa date et son point de vente, comparés à `Purchase` dans la section `Warranty` de la fiche de la pièce ;
   - l'identité de la pièce (`O26-…`, sur sa carte) et son modèle ;
   - un scan fait pendant l'échange : le client scanne sa pièce et vous lit la REF ; la section `Reference` doit nommer ce compte dans `Owner of the piece`.
4. En boutique : une pièce d'identité au nom de la facture.
5. Au moindre doute : aucun code. Proposez au client de venir en boutique avec la pièce et sa facture.
6. Jamais : demander le mot de passe, envoyer le code par e-mail, SMS ou message, l'écrire, le donner à quelqu'un d'autre que la personne vérifiée.

### Dans la console (ADMIN)

`Owners` → l'adresse exacte → `Search` → la ligne du client → `Recovery code` → `Issue a recovery code` → `Issue code`. Le code s'affiche une fois (`Recovery code · shown once`) : lisez-le au client, au téléphone ou en face à face, puis `Given to the client — hide`. Un nouveau code annule le précédent.

- `Recovery attempts throttled until …` sur la ligne du client : 5 essais manqués en une heure ont usé ce code. Donnez-en un nouveau, après la même vérification.
- Un compte dont on soupçonne la prise de contrôle : `Lock account` sur sa fiche (ADMIN). Ses sessions se ferment, ses transferts en attente sont annulés et le code ouvert ne sert plus. `Unlock account` le rouvre.
- Après une récupération, la ligne du client montre `Transfers paused until …`.

### Ce que vous dites

> Nous n'envoyons jamais de lien par e-mail pour changer un mot de passe. Après avoir vérifié votre identité, je vous lis un code de récupération : il ne sert qu'une fois et reste valable 30 minutes. Sur theorbes.com/verify, scannez une de vos pièces, ouvrez l'onglet OWNERSHIP, touchez FORGOTTEN PASSWORD? sous le formulaire de connexion, puis I HAVE A RECOVERY CODE, et saisissez l'adresse e-mail de votre compte, ce code et un nouveau mot de passe de 12 caractères au moins.

> Pour votre sécurité, toutes vos sessions se ferment, vos transferts en attente sont annulés et aucun nouveau transfert n'est possible depuis votre compte pendant 72 heures.

Un client connecté qui veut seulement changer son mot de passe le fait lui-même : `CHANGE PASSWORD`, à côté de `SIGN OUT`.

---

## 7. Scans personnels du personnel

Un navigateur connecté à la console scanne **en tant que staff** (S-07, API §9.7) : le scan est inscrit en `ADMIN_TEST` à votre nom, n'ouvre pas `UNSOLD PIECE SCANNED`, et l'onglet `OWNERSHIP` dit `STAFF SCAN` sans proposer d'enregistrement.

- **Un membre de l'équipe qui achète une pièce** la scanne et l'enregistre depuis un navigateur **qui n'est pas connecté à la console** : un autre navigateur, une fenêtre de navigation privée, ou après `Sign out` dans la console. Jamais avec le téléphone du comptoir.
- **L'inverse pour le stock** : un contrôle de stock se fait depuis un navigateur connecté à la console. Fait d'un téléphone personnel, il ouvre `UNSOLD PIECE SCANNED`, le signal d'une pièce sortie du stock sans vente.
- Le personnel n'enregistre jamais la pièce d'un client à sa place, ni avec son propre compte.

---

## 8. Lexique interdit

<!-- lexicon:begin -->

Le tableau complet est celui de BRAND §4.5, et sa traduction française celle du [kit](PACKAGING-KIT.md), §4. Le test de ce guide refuse leurs termes partout ailleurs que dans ce bloc. Au comptoir, les plus fréquents :

| Jamais | À dire à la place |
|---|---|
| « 100 % authentique », « authenticité garantie », « certifié original », « c'est une vraie », « pièce authentique » | « Le résultat AUTHENTIC confirme une identité émise et signée par ORBES. » |
| « faux », « contrefaçon », « fraude », « volé », « alerte », « danger » | « Ce résultat demande un examen ; ORBES Client Services peut vous accompagner. » |
| « infalsifiable », « impossible à copier », « inviolable », « niveau bancaire » | « Un code imprimé peut être copié ; ORBES Client Services peut examiner une pièce sur demande. » |
| « QR code », « code-barres », « jeton », « blockchain », « NFT », « crypto » | « ORBES CODE », « signature », « clé ORBES » |
| « produit » | « pièce » |
| « erreur », « contactez le support », « support technique » | « ORBES Client Services peut vous accompagner. » |

Les mots de la console (`Products`, `STOLEN`, `COUNTERFEIT FLAGGED`, `LOST STOLEN SCAN`, un score de risque) sont internes : on ne les lit jamais au client. Un résultat ne dit jamais qu'une pièce est fausse ou volée : il dit ce qui a été vérifié, ce qui ne l'a pas été, et qui peut aider.

<!-- lexicon:end -->

---

## 9. Checklist de 30 minutes sur une pièce test

Chaque personne qui vendra ou répondra aux clients la réalise une fois, seule, avant sa première vente, avec son compte OPERATOR nominatif (§10). Un vendeur RETAIL fait l'étape 3 en mode Boutique et laisse l'étape 7 à un OPERATOR.

| Étape | Ce que vous faites | Durée |
|---|---|---|
| 1 | Se connecter à la console | 3 min |
| 2 | Scanner la pièce test avant sa vente | 3 min |
| 3 | Activer sa garantie | 4 min |
| 4 | Enregistrer la pièce avec le compte test A | 6 min |
| 5 | Transférer la pièce au compte test B | 7 min |
| 6 | Lire un résultat UNKNOWN ORBES CODE (ici INVALID SIGNATURE) | 2 min |
| 7 | Retrouver le scan dans la console | 3 min |
| | **Total** | **28 min** |

### Préparation (un ADMIN, avant la séance, hors chrono)

1. Le compte nominatif de la personne, son application d'authentification enrôlée (§10).
2. Une pièce test : `Generator` → `Single piece` → une catégorie et un modèle existants, `Production batch` : `TEST`, la case `Issue a one-time claim code (shown once, stored as a hash)` cochée → `Issue & sign`. Notez son identité (`O26-…`) et le claim code affiché une fois (`Claim code · shown once`). Pour cette pièce test seulement, il est remis à la personne sur papier : le claim code d'une pièce vendue ne quitte jamais sa carte.
3. Son ORBES CODE imprimé : sur l'écran du résultat de `Generator`, section `Code & print files`, `Width (mm)` 30, `Download` `PDF`, imprimé à 100 %.
4. La planche d'essai `docs/assets/test-sheets/orbes-code-test-sheets.pdf`, page 2, imprimée à 100 %. Ses codes sont signés par la clé d'exemple publique : ils donnent INVALID SIGNATURE et n'ouvrent aucun signal.
5. Un point de vente dans `Points of sale`.
6. Deux adresses e-mail de test, réservées à cet usage (comptes test A et B), un ordinateur pour la console, et un téléphone dont le navigateur n'est pas connecté à la console (une fenêtre de navigation privée suffit).

### Étape 1 — Se connecter à la console (3 min)

Sur l'ordinateur, ouvrez `https://verify.theorbes.com/admin` : `Email`, `Password`, `Authenticator code` (les six chiffres de votre application), `Sign in`. À la première connexion avec un mot de passe provisoire, l'écran `New password` demande `Temporary password` (tapé exactement comme remis, capitales et tirets compris), `New password`, `New password again`, puis `Save password`. Vous arrivez sur `Dashboard` ; la barre latérale mène au reste.

### Étape 2 — Scanner la pièce test avant sa vente (3 min)

Sur le téléphone, ouvrez theorbes.com/verify, `SCAN ORBES CODE`, visez le code imprimé de la pièce test. Attendu : `AUTHENTIC`. Touchez l'onglet `OWNERSHIP` : `NOT YET DELIVERED`. C'est ce que voit un client dont la vente n'a pas été inscrite. Ce scan ouvre aussi `UNSOLD PIECE SCANNED` dans `Anomalies` : c'est attendu (§7), l'ADMIN le classera après la séance.

### Étape 3 — Activer sa garantie (4 min)

Console : `Products` → `Search` : l'identité de la pièce test → `Apply` → sa ligne. Sur la fiche, section `Actions`, groupe `Warranty` → `Activate warranty` → `Purchase date` (aujourd'hui), `Point of sale`, `Country` (FR) → `Activate`. Attendu : `Warranty activated.`, puis `Lifecycle` `ACTIVATED` et `Warranty` `ACTIVE` en tête de fiche.

### Étape 4 — Enregistrer la pièce avec le compte test A (6 min)

Sur le téléphone, `SCAN ANOTHER` en bas du résultat, puis scannez de nouveau la pièce. Attendu : `AUTHENTIC — FIRST REGISTRATION`. Onglet `OWNERSHIP` : `REGISTRATION OPEN UNTIL` et l'heure. `CREATE ACCOUNT` : `EMAIL` (adresse test A), `PASSWORD` (12 caractères au moins), puis `CREATE ACCOUNT`. Ensuite `CLAIM CODE` (celui de la préparation) → `REGISTER THIS PIECE`. Attendu : `REGISTERED TO YOU`. Touchez `VIEW AS OWNER` : `AUTHENTIC — OWNERSHIP VERIFIED`.

### Étape 5 — Transférer la pièce au compte test B (7 min)

Toujours connecté en A, onglet `OWNERSHIP`, `TRANSFER OF OWNERSHIP` → `CREATE TRANSFER CODE`. Notez le `TRANSFER CODE`, puis `SIGN OUT`. `SCAN ANOTHER` et scannez la pièce : `AUTHENTIC — REGISTERED`, avec sous la phrase la consigne d'achat d'occasion et `I HAVE A TRANSFER CODE`. Touchez-le : l'onglet `OWNERSHIP` s'ouvre sur `RECEIVING THIS PIECE`. `CREATE ACCOUNT` avec l'adresse test B. Connecté en B, scannez la pièce une dernière fois, puis sous `RECEIVING THIS PIECE` : `TRANSFER CODE` → `RECEIVE THIS PIECE`, dans les 15 minutes qui suivent ce scan. Attendu : `REGISTERED TO YOU`. Dans la console, la fiche de la pièce, section `Ownership`, nomme le nouveau propriétaire et montre le transfert dans l'historique.

### Étape 6 — Lire un résultat UNKNOWN ORBES CODE (ici INVALID SIGNATURE) (2 min)

Sur le téléphone, `SCAN ANOTHER`, visez une étiquette de 30 mm de la planche d'essai. Attendu : `INVALID SIGNATURE`. Lisez l'écran de haut en bas : le titre et sa phrase ; *ORBES Client Services can help with any question about this piece. Please quote the reference below.* ; `CONTACT ORBES CLIENT SERVICES` quand les coordonnées sont configurées ; `WHERE DID YOU SEE OR BUY THIS PIECE?` (n'y répondez pas : la question est pour les clients) ; en bas, `REF` et huit caractères. Notez cette REF.

Un `UNKNOWN ORBES CODE` se lit exactement de la même façon : seuls le titre et la phrase changent, et les gestes sont ceux du §3. **Écart assumé** : la checklist ne fabrique pas d'UNKNOWN ORBES CODE en production. Il n'en existe que pour un code signé par une clé ORBES et absent du registre, et chacun ouvre un signal CRITICAL de clé compromise (API §9.4, étape 6) : la planche d'essai donne le même écran sans rien déclencher.

### Étape 7 — Retrouver le scan dans la console (3 min)

Console : `Owners` → `Email or REF` : `REF` et les huit caractères notés → `Search`. La section `Reference` liste ce scan : `Result` `INVALID SIGNATURE`, `Piece` `Not in the registry`, `Scanned by` le compte B. Puis `Verification events` → `Product` : l'identité de la pièce test → `Apply` : tous les scans de la séance, du plus récent au plus ancien, chacun avec son résultat. Enfin `Anomalies` : le `UNSOLD PIECE SCANNED` de l'étape 2.

Arrivé ici seul en moins de 30 minutes : la checklist est réussie.

### Après la séance (un ADMIN)

- La pièce test : sur sa fiche, `Change status` → `New status` `RETIRED` → `Continue` → `Apply`. Elle se lit désormais `REVOKED`, et ses codes ne peuvent plus être imprimés.
- Le signal de l'étape 2 : `Anomalies` → `Triage` → `Decision` : `Dismiss` → `Note` : « pièce test, checklist J-09 » → `Record decision`.
- Les comptes test A et B restent : ils resservent à la séance suivante (`SIGN IN` au lieu de `CREATE ACCOUNT`).
- Le temps réalisé va dans le §11.

---

## 10. Créer un OPERATOR nominatif

Un compte par personne, à son nom, jamais partagé (SECURITY-MODEL §5). Son second facteur (TOTP) est **enrôlé hors de la console et remis en main propre** : dans la console, le premier qui se connecte avec le mot de passe enrôle son propre téléphone (SECURITY-MODEL §3.3).

### Depuis le shell (recommandé)

Un ADMIN qui a accès au serveur, en présence de la personne, comme utilisateur `orbes` dans `/opt/orbes/orbes-index/deploy/vps` :

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD   # la personne tape son mot de passe, 12 caractères au moins : rien ne s'affiche
docker compose exec -e ADMIN_PASSWORD app node --import tsx scripts/admin.ts create --email <e-mail de la personne> --role OPERATOR
unset ADMIN_PASSWORD
docker compose exec app node --import tsx scripts/admin.ts totp-setup --email <e-mail de la personne>
docker compose exec app node --import tsx scripts/admin.ts totp-enable --email <e-mail de la personne> --secret <SECRET> --code <code à 6 chiffres>
docker compose exec app node --import tsx scripts/admin.ts list
```

Dans le conteneur, la première commande est exactement `ADMIN_PASSWORD=… node --import tsx scripts/admin.ts create --email … --role OPERATOR` : `docker compose exec -e ADMIN_PASSWORD` lui passe le mot de passe sans l'écrire dans l'historique du shell ni sur la ligne de commande.

1. `create` lit le mot de passe dans `ADMIN_PASSWORD`, jamais sur la ligne de commande.
2. `totp-setup` affiche une fois le secret et son lien `otpauth://`. La personne l'ajoute elle-même à son application d'authentification, sur son téléphone, devant l'ADMIN. Le secret n'est ni photographié, ni envoyé, ni gardé par l'ADMIN.
3. `totp-enable` reçoit le code que l'application affiche à cet instant : il prouve que l'application détient le secret.
4. `list` montre la personne avec `2FA on` et `active`.
5. La personne range son mot de passe dans son propre gestionnaire de mots de passe ; l'ADMIN ne garde rien. Elle peut le changer à tout moment : `Change password`, au pied de la barre latérale.

### Depuis la page Team (A-02), le TOTP enrôlé hors de la console

1. Un ADMIN : `Team` (groupe `Security`) → `New staff account` → `Email`, `Role` : `OPERATOR` → `Create account`.
2. Le mot de passe provisoire s'affiche une fois (`Temporary password · shown once`) : remettez-le en main propre, puis `I have handed it over — hide`.
3. Avant sa première connexion, enrôlez son TOTP depuis le shell, en sa présence : `totp-setup` puis `totp-enable`, comme ci-dessus.
4. À sa première connexion (§9, étape 1), elle tape le mot de passe provisoire, son code, puis choisit son propre mot de passe sur l'écran `New password`.
5. Sur `Team`, sa ligne ne dit plus `TEMPORARY PASSWORD`, et `Two-factor` dit `ENABLED`.

Un vendeur se crée de la même façon avec le rôle RETAIL (`--role RETAIL`, ou `Role` : `RETAIL`) : il n'aura que `Sale mode`.

**Départ.** Le jour même : `Team` → sa ligne → `Disable` (ADMIN). Il ne peut plus se connecter, et toutes ses sessions se ferment. Sans ADMIN disponible dans la console : `scripts/admin.ts disable --email … --yes` depuis le shell.

---

## 11. Validation

Rien ne part en boutique tant qu'une ligne dont cela dépend reste ouverte.

| Élément | Par | Avant | État |
|---|---|---|---|
| La checklist du §9 réalisée seule, en moins de 30 minutes, par une personne qui n'a jamais vu la console (critère d'acceptation de J-09) : son temps, et ce qui l'a arrêtée | Propriétaire, avec cette personne | la première vente | Ouvert |
| Vérification d'identité (§6) | Juriste | le premier code de récupération, verrouillage ou export à la demande d'un client | Ouvert |
| Phrases à dire (§1 à §6) | Marque et juridique | la formation des vendeurs | Ouvert |
| Carte certificat sans la mention PROOF (kit, §6) | Marque | la première carte remise à un client | Ouvert |
| Retour d'une commande expédiée (§2) : la suite d'une pièce dont la garantie a commencé | Propriétaire | la première vente en ligne | Ouvert |

**Écart assumé.** Le brief demande de « lire un résultat UNKNOWN » pendant la checklist. Elle fait lire INVALID SIGNATURE, qui a le même écran, parce qu'un UNKNOWN ORBES CODE, en production, ouvre un signal CRITICAL de clé compromise (§9, étape 6).
