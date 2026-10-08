# ORBES — Procédure de vente et d'expédition

Statut : **brouillon écrit à partir du code** (recommandation J-09). La vérification d'identité du §6 est à finaliser avec le juriste. La checklist du §9 est validée quand une personne qui n'a jamais vu la console l'a réalisée seule en moins de 30 minutes (§11).

Liens : [LAUNCH](../LAUNCH.md) §4, §7 et §11 · [API](../API.md) §9.3, §11.3, §11.5 à §11.7, §14.4, §14.6 et §16.18 · [BRAND-DESIGN-SYSTEM](../BRAND-DESIGN-SYSTEM.md) §4 · [SECURITY-MODEL](../SECURITY-MODEL.md) §3.3 · [kit emballage](PACKAGING-KIT.md).

**Pourquoi ce guide.** Un client ne peut enregistrer sa pièce que si sa vente a été inscrite chez ORBES : la garantie activée, en mode Boutique ou dans la console. Sinon, chez lui, l'onglet `OWNERSHIP` du résultat dit `NOT YET DELIVERED` et ne propose aucun enregistrement : une pièce en règle devient un problème dès le premier scan. Ce guide donne, pour chaque situation, le geste dans la console et la phrase à dire. Il évite aussi de promettre ce que le système ne prouve pas (§8).

**Comment le lire.**

- Les mots entre accents graves, comme `Activate warranty`, sont ceux de l'écran, en anglais, tels que la console ou theorbes.com/verify les affichent : un bouton, un champ, un statut, un fichier. Ce sont des mots internes : on ne les lit pas au client (BRAND §4.1).
- Les phrases en retrait sont à dire au client, telles quelles. Les mots de l'écran y restent en anglais et en capitales, comme le client les lit sur son téléphone.
- Les rôles de la console (SECURITY-MODEL §3.3) : **RETAIL**, un vendeur, n'a que le mode Boutique ; **LOGISTICS**, une personne chez le prestataire logistique, n'a que `Logistics`, pour ses entrepôts ; **AUDITOR** lit ; **OPERATOR** active les garanties, déclare une perte ou un vol, ouvre les entretiens, confirme les réceptions et passe les commandes fournisseur ; **ADMIN** gère l'équipe, les points de vente, le `Generator` (les pièces uniques : échantillons, presse, remplacements) et les gestes sensibles sur un compte client (code de récupération, verrouillage, export).
- La console : `https://verify.theorbes.com/admin`. Le client : theorbes.com/verify, qu'il tape lui-même.

Ce guide ne décrit que ce que fait le logiciel. Ses sources :

| Sujet | Source |
|---|---|
| Mode Boutique, ses refus et la phrase de fin de vente | `genome/src/web/admin/views/sale.ts`, `CLIENT_REGISTRATION` dans `genome/src/web/admin/model/sale.ts`, API §16.18 |
| Activation de la garantie depuis la fiche d'une pièce | `genome/src/web/admin/views/product.ts`, API §14.6 |
| Titre et phrase de chaque résultat | `VERIFICATION_COPY` dans `genome/src/server/services/copy.ts`, API §9.3 et §9.4 |
| Onglet `OWNERSHIP` : enregistrement, transfert, réception d'une pièce (`RECEIVING THIS PIECE`), `NOT YET DELIVERED`, `STAFF SCAN` | `genome/src/web/verify/views/ownership.ts`, BRAND §4.4, API §11.3 |
| `MY PIECES` : les pièces du client, sa déclaration de perte ou de vol, `PIECE FOUND`, `CHANGE PASSWORD` | `genome/src/web/verify/views/pieces.ts`, API §10.5, §11.5 et §11.6 |
| Le certificat de propriété (`OWNERSHIP CERTIFICATE`) | `genome/src/web/verify/views/pieces.ts`, `genome/src/web/verify/views/certificate.ts`, API §8.7 et §11.7 |
| Transitions `LOST` et `STOLEN` | `genome/src/server/services/lifecycle.ts`, API §14.4 et §11.5 |
| Code de récupération, verrouillage d'un compte client | `genome/src/web/admin/views/owners.ts`, `genome/src/web/admin/views/owner.ts`, API §10.8, §16.10 et §16.12 |
| Comptes de la console | `genome/scripts/admin.ts`, `genome/src/web/admin/views/team.ts`, SECURITY-MODEL §3.3 |
| Les chiffres du §0 | les constantes nommées dans leur tableau |

`genome/test/docs/sales-playbook.test.ts` vérifie ce fichier : chaque mot entre accents graves est un texte entier du logiciel (un libellé, un statut, une constante, un fichier du dépôt), sauf l'identité `O26-…`, les adresses et les commandes du shell ; aucun mot interdit (BRAND §4.5 et le lexique français du kit, §4) hors du bloc lexique du §8, sauf dans un libellé ou un statut de l'écran cité ainsi, ou une constante ; aucune exception dans les phrases à dire ; un résultat de l'API §9.3 par section du §3, avec sa phrase en anglais mot pour mot ; les chiffres du §0 égaux aux constantes du code ; la phrase de fin de vente, la phrase sur l'achat d'occasion et les commandes du §10 telles que le logiciel les connaît ; une checklist de 30 minutes au plus.

---

## 0. Avant la première pièce

- **Les points de vente.** Un ADMIN les crée dans `Points of sale` (groupe `Clients` de la barre latérale) : chaque boutique, chaque grand magasin et la boutique en ligne, sans pays pour celle-ci. Une boutique fermée est désactivée, jamais supprimée.
- **Un compte par personne** (§10) : RETAIL pour chaque vendeur, OPERATOR pour ORBES Client Services, LOGISTICS pour chaque personne du prestataire logistique, rattaché aux entrepôts où elle travaille (`Team`, `Locations`). Jamais de compte partagé, même sur le téléphone d'un comptoir.
- **Les coordonnées d'ORBES Client Services** sont configurées (`CLIENT_SERVICES_EMAIL`, `CLIENT_SERVICES_PHONE`, `CLIENT_SERVICES_HOURS`, LAUNCH §10). L'application des collectionneurs ne les montre plus : partout où elle renvoie vers ORBES Client Services, elle montre `WRITE TO ORBES CLIENT SERVICES`, dont les messages arrivent dans `Messages` (§3). Seul `FORGOTTEN PASSWORD` garde l'adresse e-mail, pour un client qui a aussi perdu son code de récupération ; les pages légales gardent l'adresse, le téléphone et les horaires.
- **La carte certificat.** Fait : le propriétaire a validé la carte 79t, MINT CERTIFICATE, le 2026-10-07, et aucune carte ne porte plus la mention PROOF (kit, §2).
- **Le claim code.** Toute pièce destinée à la vente est émise avec son claim code : dans `Generator`, la case `Issue a one-time claim code (shown once, stored as a hash)` (pour un lot : `Issue a one-time claim code for each piece (shown once, stored as a hash)`) reste cochée, comme par défaut. C'est lui qui prouve, à l'enregistrement, que le client tient la carte. Une pièce émise sans claim code s'enregistre sans preuve : une fois sa garantie activée, le premier compte connecté qui la scanne peut l'enregistrer à son nom. Si une telle pièce est vendue, le client l'enregistre au comptoir, aussitôt la garantie activée ; puis un OPERATOR, la facture vue, confirme la propriété sur la fiche de la pièce (`Actions`, groupe `Ownership` → `Confirm ownership`, API §14.10).
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

1. Ouvrez `https://verify.theorbes.com/admin` et connectez-vous : `Email`, `Password`, `Sign in`, puis `Authenticator code`, les six chiffres de votre application d'authentification, et de nouveau `Sign in`. Un compte RETAIL arrive directement sur `Sale mode` ; un OPERATOR l'ouvre dans la barre latérale (groupe `Clients`).
2. `Point of sale` : choisissez votre boutique, une fois. Le téléphone s'en souvient pour la vente suivante.
3. `Scan the piece`, et visez l'ORBES CODE de la pièce vendue (ou `Upload a photo`). Chaque scan est inscrit à votre nom (`Each scan here is recorded under your name.`).
4. Lisez l'écran (tableau ci-dessous). Avec `READY TO SELL`, vérifiez que l'identité affichée (`O26-…`) est celle imprimée sur la carte certificat rangée avec la pièce.
5. `Activate warranty`, dans les 10 minutes qui suivent le scan (`This scan stays valid for … minutes.`). Passé ce délai, scannez de nouveau.
6. L'écran affiche `WARRANTY ACTIVE`, les dates de la garantie et votre point de vente, puis `Tell the client` : `Register your piece with its card at theorbes.com/verify.`
7. Remettez la carte certificat, **son claim code imprimé en clair** : le personnel ne le saisit ni ne le recopie jamais. Puis `Next sale`.

Le mode Boutique inscrit la vente **aujourd'hui**, avec le pays du point de vente. Pour une vente d'un autre jour (téléphone indisponible, vente oubliée), un OPERATOR l'inscrit dans la console, ci-dessous.

| L'écran affiche | Ce que cela veut dire | Ce que vous faites |
|---|---|---|
| `READY TO SELL` | Un code signé par ORBES, d'une pièce de son registre, dont la garantie n'a pas commencé | Le point de vente choisi, `Activate warranty` |
| `ALREADY SOLD` | La garantie a déjà commencé, ou un compte client détient la pièce | Ne vendez pas. Mettez la pièce de côté et prévenez ORBES Client Services avec son identité |
| `WARRANTY VOID` | La garantie a été annulée | Ne vendez pas. ORBES Client Services |
| `NOT FOR SALE` | Le statut de la pièce ne permet pas la vente, ou elle est en entretien | Ne vendez pas. L'atelier clôt d'abord l'entretien |
| `SUSPICIOUS ACTIVITY`, `REVOKED`, `UNKNOWN`, `INVALID SIGNATURE` | Le code n'a pas été reconnu comme celui d'une pièce qu'ORBES peut vendre | Ne vendez pas. Mettez la pièce de côté, notez son identité et prévenez un OPERATOR : le scan est inscrit à votre nom, il le retrouvera |
| `MALFORMED CODE` | Le code n'a pas été lu | `Scan another` sous une lumière égale ; sinon, `Upload a photo` sous l'image de la caméra |

### Sans le mode Boutique : la console

Un OPERATOR, sur un ordinateur : `Products` → `Search` : l'identité de la pièce → `Apply` → la ligne de la pièce. Sur sa fiche, section `Actions`, groupe `Warranty` → `Activate warranty`. Dans `Activate the warranty` :

- `Purchase date` : le jour de la vente ;
- `Point of sale` : la boutique, dans la liste des points de vente ;
- `Country` : deux lettres (FR) ; vide, c'est le pays du point de vente.

Puis `Activate`. La console répond `Warranty activated.` ; en tête de fiche, `Lifecycle` passe à `ACTIVATED` et `Warranty` à `ACTIVE` ([capture de la fiche](../assets/ui/admin-02-product.png)).

### Ce que vous dites

> Votre pièce est inscrite chez ORBES et sa garantie commence aujourd'hui. Enregistrez-la à votre nom avec sa carte sur theorbes.com/verify : tapez l'adresse, scannez l'ORBES CODE, puis saisissez le claim code imprimé sur la carte. Il l'enregistre une seule fois, à votre nom.

> Gardez la carte avec la pièce, et ne photographiez ni ne partagez jamais ce code.

Si le client demande ce que prouve le résultat, la phrase est au §3. Ne promettez jamais davantage (§8).

### Si la vente n'a pas été inscrite

Le client voit `AUTHENTIC` et, dans l'onglet `OWNERSHIP`, `NOT YET DELIVERED` : l'enregistrement ne s'ouvre qu'après l'activation de la garantie, et son scan a ouvert `UNSOLD PIECE SCANNED` dans `Anomalies` (§3).

- **La boutique retrouve la vente dans ses propres ventes** (sa date, l'identité `O26-…` de la pièce) : un OPERATOR l'inscrit dans la console (ci-dessus, jamais en mode Boutique, qui inscrirait la vente aujourd'hui) avec **la date de cette vente** et ce point de vente, classe le `UNSOLD PIECE SCANNED` avec une note qui cite la vente, puis le client scanne de nouveau la pièce : il lit `AUTHENTIC — FIRST REGISTRATION` et peut l'enregistrer.
- **La demande vient du client, et rien n'en garde trace de votre côté** : n'activez rien sur sa seule parole. C'est la vérification du §3 (`AUTHENTIC`) : la facture, puis la vente confirmée par le point de vente qu'elle nomme.

---

## 2. Expédition en ligne

Une commande (une sortie LIVE, un tirage, le salon privé) s'expédie par `Logistics`. ORBES Client Services la marque payée (`Mark paid`) ; elle tient alors une pièce de son modèle et de sa taille en stock, ou attend la prochaine livraison d'un fournisseur, les plus anciennes servies d'abord. Le prestataire logistique la prépare et l'expédie ; ORBES Client Services peut faire chaque étape depuis la page de la commande (section `Shipping`). L'expédition (`Ship`) démarre la garantie de chaque pièce : plus rien à activer à la main avant l'envoi.

1. `Logistics` → `To ship` : les colis dont toutes les commandes sont payées et ont leur pièce, le plus ancien d'abord. Ouvrez le colis, puis `Start packing` : dès lors, le client ne change plus ni l'adresse ni la gravure ; seul ORBES Client Services le peut.
2. Prenez sur l'étagère une pièce du bon modèle, de la bonne variante et de la bonne taille, et `Scan the card` : l'ORBES CODE de sa carte certificat lie la pièce à la commande. Une carte d'un autre modèle, d'une autre taille ou d'une pièce hors stock est refusée : mettez-la de côté et prévenez ORBES.
3. La carte certificat va **dans le colis, dans l'emballage, avec la pièce**, son claim code imprimé en clair. Le claim code n'apparaît jamais à l'extérieur du colis, sur la facture, dans l'e-mail de confirmation ni dans aucun message. Le texte d'emballage en trois étapes est celui du [kit](PACKAGING-KIT.md), §1.
4. Cochez chaque ligne de la liste, `Add the photo` (vue par ORBES seul, jamais par le client, effacée 14 jours après la livraison), puis `Packed`.
5. `Ship` : le transporteur et le numéro de suivi ; l'étiquette et les papiers de douane se font avec les outils du transporteur. Le client voit le transporteur et le lien de suivi dans YOUR ORDERS. La valeur déclarée pour l'assurance est saisie par ORBES seul, depuis la page de la commande.
6. À l'arrivée, `Mark delivered` ; la commande passe aussi d'elle-même à DELIVERED quand le client enregistre la pièce.

Dans l'e-mail d'expédition, ou sur la notice glissée dans le colis :

> Votre pièce voyage avec sa carte certificat. À réception, ouvrez theorbes.com/verify, scannez l'ORBES CODE de la pièce, puis enregistrez-la à votre nom avec le claim code de la carte. Vérifiez uniquement sur theorbes.com/verify.

### Recevoir une livraison et la confirmer

- **Le prestataire.** `Logistics` → `Receptions` → `Receive a delivery` : la référence de la commande fournisseur (SO-…) lue sur le bon de livraison, puis `Open`. Quand le bon ne la porte pas, demandez-la à ORBES : le prestataire ne voit jamais la liste des commandes fournisseur ni leurs prix. Comptez chaque pièce : une pièce défectueuse va en `Rejected`, une pièce en trop ou hors commande s'accepte avec une note. Puis `Record the reception`.
- **ORBES** (OPERATOR) : `Logistics` → `Receptions` → `To confirm`, `Confirm the reception` (chaque pièce reçoit alors son identité ORBES, son ORBES CODE et son claim code, puis sert les commandes qui l'attendent) ou `Send back` avec une note, et le prestataire compte de nouveau (`Count again`).
- **Les cartes.** Une fois les identités émises : `Cards to print`, `Print A4 sheets` ou `Print one per page`, chaque carte avec sa pièce, puis `Cards attached` : les cartes ne s'impriment plus ensuite, et une carte perdue demande un nouveau claim code d'ORBES (§5).
- **Les pièces rejetées** : `Back to the supplier`, `Sent back` quand elles partent ; ORBES note la réponse du fournisseur (un remplacement ou un avoir) sur la commande fournisseur.

### Compter des pièces : NO PIECE

Le stock compté avant ces écrans, ou une pièce sortie du `Generator`, n'a pas d'identité ORBES derrière son compte : `Logistics` → `Stock` le marque NO PIECE pour ORBES, et une commande qui le tient ne peut pas être préparée. Un OPERATOR nomme les pièces qui sont sur l'étagère (`Count pieces in`, une identité `O26-…` par ligne) ou corrige le compte à la baisse (`Correct`). Le prestataire propose ses corrections (`Propose a correction`) ; un OPERATOR les accepte (`Approve`) ou les refuse (`Decline`) dans `Corrections`.

### Un problème de colis

Le colis revient à l'expéditeur, se perd ou arrive abîmé : le prestataire ou ORBES Client Services le signale (`Report a parcel problem`). Le prestataire enregistre le colis revenu (`Logistics` → `Returns` → `Received`). ORBES décide depuis la page de la commande (`Decide`) : `Ship another piece`, avant les commandes qui attendent, ou `Refund`. Un colis perdu se décide par un ADMIN, et l'identité de la pièce perdue est révoquée. Un colis abîmé qui ne revient jamais au prestataire : annulez son cas (`Cancel the order case`), puis signalez-le perdu.

### Retours et échanges

Le client demande un retour ou un échange de taille dans les 14 jours qui suivent la livraison, ou écrit dans `Messages`. ORBES Client Services peut aussi l'ouvrir depuis la page de la commande (`Open a return`), même après les 14 jours, par geste commercial. Le client renvoie la pièce à ses frais ; le prestataire l'enregistre à l'arrivée (`Received`, la pièce intacte ou abîmée) ; ORBES décide (`Decide`) : remboursement, ou l'autre taille, et la pièce retourne au stock ou à l'archive (un ADMIN). Rien n'annule une garantie commencée : une pièce remise en stock repart avec un nouveau claim code, montré une fois, pour sa nouvelle carte.

### Commandes fournisseur

`Supplier orders` (ORBES seul) → `To order` : la console additionne ce qui manque (les commandes en attente et le stock sous son minimum) par fournisseur et par entrepôt. `Add to the draft`, ajustez quantités, prix, devise, frais de port et date attendue, puis `Mark sent` et envoyez vous-même le `PDF` au fournisseur : la console n'envoie aucun e-mail. Ensuite : `Confirmed by the supplier`, les réceptions, `Cancel the rest` quand le fournisseur ne livrera pas la suite, `Enter the invoice` et `Mark the invoice paid`. Les fournisseurs se créent dans `Suppliers` (`Add a supplier`) ; le fournisseur d'un modèle, ou d'une taille, se règle sur la page du modèle (`Edit supplier`).

---

## 3. Client inquiet

Un client vous montre un résultat, au comptoir ou au téléphone.

1. Demandez-lui la **référence** en bas de l'écran : `REF` suivi de huit caractères. Et, s'il le veut bien, où il a vu ou acheté la pièce.
2. Console (AUDITOR et au-dessus) : `Owners` → `Email or REF` : `REF` et les huit caractères → `Search`. La section `Reference` donne le scan, la pièce, le compte connecté au moment du scan et le propriétaire de la pièce ; chaque ligne mène à sa fiche.
3. Ne dites jamais la raison interne d'un résultat (un statut, un signal, un score), ni qui est le propriétaire d'une pièce (BRAND §4.1). Un vendeur RETAIL ne voit pas ces pages : il note la REF et passe la main à ORBES Client Services.
4. Sur un résultat qui n'est pas AUTHENTIC, la réponse du client à `WHERE DID YOU SEE OR BUY THIS PIECE?` arrive dans `Cases` (LAUNCH §11).
5. Le client peut aussi vous écrire depuis l'application : `WRITE TO ORBES CLIENT SERVICES`, sous la phrase d'aide d'un résultat, sur une pièce, une commande, une sortie ou une demande du salon privé. Son message arrive dans `Messages`, avec ce qu'il concerne (la pièce, la commande, la sortie, le scan et sa REF, le modèle).

**Répondre aux `MESSAGES`** (OPERATOR et au-dessus ; un AUDITOR lit, les adresses masquées). Console : `Messages`, le premier lien du groupe `Clients` ; son nombre compte les conversations `To answer`, les PALLADIUM puis les PLATINE d'abord, puis la plus ancienne. Ouvrez la conversation, `Take it` : elle est à vous. Lisez ce que concerne chaque message (son lien mène à la pièce, à la commande, à la sortie ou au scan), écrivez la réponse, `Send answer` : le client la lit dans son compte, sous `MESSAGES`, signée ORBES Client Services, jamais à votre nom. Quand tout est dit, `Close conversation` ; si le client écrit de nouveau, elle revient d'elle-même dans `To answer`. Aucun e-mail n'est envoyé, et aucun délai de réponse n'est promis, ni dans l'application ni par vous. Vous ne commencez jamais une conversation : vous répondez à celle qu'un client a ouverte. Un ADMIN peut confier une conversation à un autre membre de l'équipe (`Assign to`).

Ce que prouve un résultat AUTHENTIC, si le client le demande :

> Le résultat AUTHENTIC confirme une identité émise et signée par ORBES, et ce que le registre ORBES en sait : enregistrement, garantie, entretien. Un code imprimé peut être copié : à lui seul, il ne prouve pas que l'objet que vous tenez est celui qu'ORBES a fabriqué. ORBES Client Services peut examiner une pièce sur demande.

### AUTHENTIC — FIRST REGISTRATION

Le client lit : *This ORBES identity was issued and signed by ORBES and has not yet been registered. You may register it to your ORBES account.*

**Ce que cela veut dire.** La vente est inscrite, la pièce n'a pas encore de propriétaire. L'onglet `OWNERSHIP` propose l'enregistrement pendant 15 minutes après le scan (`REGISTRATION OPEN UNTIL …`, suivi de l'heure).

**Ce que vous faites.** Guidez le client : `OWNERSHIP` → `SIGN IN` ou `CREATE ACCOUNT` → `CLAIM CODE` → `REGISTER THIS PIECE`. Délai passé : il scanne de nouveau. Après 5 claim codes manqués en une heure, l'enregistrement de la pièce attend jusqu'à une heure.

> Votre pièce est prête à être enregistrée. Dans l'onglet OWNERSHIP, connectez-vous ou créez votre compte ORBES, puis saisissez le claim code imprimé sur votre carte. Si le délai affiché est passé, scannez de nouveau la pièce.

### AUTHENTIC — REGISTERED

Le client lit : *This ORBES identity was issued and signed by ORBES and is registered to its owner.*

**Ce que cela veut dire.** La pièce est enregistrée à un compte ORBES qui n'est pas celui du lecteur, ou le lecteur n'est pas connecté. Sous la phrase, l'écran ajoute la consigne d'achat d'occasion et `I HAVE A TRANSFER CODE` (§4).

**Ce que vous faites.** Si c'est le propriétaire : il se connecte dans l'onglet `OWNERSHIP`, puis touche `VERIFY AGAIN`, qui vérifie de nouveau le même code avec sa session. S'il achète la pièce : le code de transfert (§4).

> Cette pièce est enregistrée à un compte ORBES. Si c'est le vôtre, connectez-vous dans l'onglet OWNERSHIP, puis touchez VERIFY AGAIN. Si vous l'achetez, demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.

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

**Ce que vous faites.** Le scan du client vient d'ouvrir `UNSOLD PIECE SCANNED` dans `Anomalies` (S-07) : une pièce qu'ORBES n'a jamais vendue, scannée hors de la console, est le premier signe d'une pièce sortie du stock sans vente. Ne démarrez jamais sa garantie sur la seule parole du client : une garantie activée ouvre l'enregistrement, et ferait d'une pièce détournée une pièce vendue.

1. **Le client dit l'avoir achetée chez ORBES ou chez un détaillant agréé.** Demandez la facture ou le ticket de caisse : la pièce, la date, le point de vente. Notez la REF et passez la main à un OPERATOR, qui seul décide :
   1. il confirme auprès du point de vente nommé que la vente (sa date, l'identité `O26-…` de la pièce) figure dans ses ventes ;
   2. sur la fiche de la pièce, section `Anomalies` → `Triage`, la ligne `UNSOLD PIECE SCANNED` → `Details` : des scans avant la date de la facture, ou dans un autre pays que celui du point de vente, contredisent la vente ;
   3. seulement si la facture, le point de vente et ces scans concordent : il vérifie `Warranty` `NOT STARTED` et active la garantie dans la console (§1, « Sans le mode Boutique » ; jamais en mode Boutique, qui inscrit la vente aujourd'hui, au point de vente du comptoir), avec **la date de la facture** et ce point de vente ;
   4. il classe le signal : `Triage` → `Decision` : `Dismiss` → `Note` : la facture (son numéro, sa date, le point de vente) → `Record decision` ;
   5. il demande au client de scanner de nouveau la pièce.

   Sans facture, si le point de vente n'a aucune trace de la vente, ou si les scans la contredisent : aucune activation. La pièce est traitée comme un achat hors réseau (2.) et l'OPERATOR passe le cas à un ADMIN.
2. **Il l'a achetée ailleurs**, à un particulier par exemple : n'activez rien. Notez la REF et le lieu d'achat, et prévenez un OPERATOR.

Pour le cas 1 seulement, facture en main :

> Le résultat AUTHENTIC confirme que cette identité a été émise et signée par ORBES. L'enregistrement s'ouvre une fois la vente de la pièce inscrite chez ORBES. Pouvez-vous me montrer la facture ou le ticket de caisse de votre achat ? ORBES vérifie la vente auprès de ce point de vente ; une fois la vente inscrite, vous scannerez de nouveau la pièce pour l'enregistrer à votre nom avec le claim code de votre carte.

Pour le cas 2, ou sans facture :

> Le résultat AUTHENTIC confirme que cette identité a été émise et signée par ORBES. Cette pièce n'a pas encore été remise par ORBES ou un détaillant agréé : ORBES Client Services va examiner sa situation. Pouvez-vous me donner la référence REF en bas de l'écran, et me dire où vous l'avez achetée ?

### UNUSUAL ACTIVITY DETECTED

Le client lit : *The activity recorded for this ORBES identity requires review. Please contact ORBES Client Services before relying on it.*

**Ce que cela veut dire.** Un examen est demandé avant de se fier à la pièce. Les causes sont internes et ne se disent pas : une perte ou un vol déclarés, un code ou un GENOME qui ne correspondent pas au registre, un historique de scans inhabituel.

**Ce que vous faites.** La REF, puis la fiche de la pièce : `Lifecycle`, `Anomalies`. Un OPERATOR décide. Seulement quand l'examen vient de l'historique des scans, sur une pièce vendue, pas encore enregistrée, dont le statut n'est ni `LOST` ni `STOLEN`, et émise avec un claim code : le résultat propose `DO YOU HOLD THE CERTIFICATE CARD?`, et le client qui a sa carte intacte peut l'enregistrer avec le claim code. Sinon, un OPERATOR traite d'abord la fiche (le retour depuis `LOST`, le `Triage` du signal).

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

**L'acheteur.** Il scanne la pièce : `AUTHENTIC — REGISTERED`, avec sous la phrase la consigne d'achat d'occasion (`RESALE_GUIDANCE`, `genome/src/web/verify/copy.ts`, J-02) et `I HAVE A TRANSFER CODE`, qui ouvre l'onglet `OWNERSHIP` sur `RECEIVING THIS PIECE`. Le code n'est accepté que pour la pièce que l'acheteur a scannée, connecté à son compte ORBES, dans les 15 minutes qui suivent ce scan (F-03). Connecté avant son scan, il trouve aussitôt `TRANSFER CODE` et l'heure limite (`RECEIVING OPEN UNTIL …`). Connecté seulement sur le résultat, il lit `To receive this piece, verify it again now that you are signed in.` et touche `VERIFY AGAIN` : le même code, vérifié de nouveau avec sa session, rouvre l'onglet `OWNERSHIP` avec `TRANSFER CODE`. Puis `RECEIVE THIS PIECE` : `REGISTERED TO YOU`, et le transfert est définitif.

**Dans la console.** La fiche de la pièce, section `Ownership` : `Transfer` `PENDING` pendant l'attente, puis le nouveau propriétaire et la ligne du transfert dans l'historique.

**Cas particuliers.**

- Une pièce revendue avant tout enregistrement n'a pas de propriétaire : aucun code de transfert ne peut exister. Si le vendeur lui remet la carte certificat, l'acheteur l'enregistre avec le claim code imprimé dessus (kit, §2).
- Le vendeur a donné le code d'une autre pièce : l'acheteur lit *This transfer code is not for this piece. Check the code with the owner of this piece.* Il demande au vendeur le code de cette pièce-ci, avant de payer.
- L'acheteur s'est connecté après son scan : `VERIFY AGAIN`, comme ci-dessus. Si plus de 15 minutes ont passé depuis le scan, l'écran le dit (`The window to receive this piece from this scan has closed. Scan the code again to receive it.`) et n'envoie rien ; `SCAN AGAIN`, connecté, puis le code. Un téléphone sans caméra lit le code d'une photo (`UPLOAD A PHOTO`, sur l'accueil de theorbes.com/verify).
- Un autre compte se connecte sur le même résultat : la fenêtre de 15 minutes reste celle du compte qui a scanné, et l'écran demande `VERIFY AGAIN`.
- Le résultat de l'acheteur dit UNUSUAL ACTIVITY DETECTED parce que le code de la pièce, montré dans une annonce, a été scanné par beaucoup de monde : connecté à son compte avant son scan, il trouve sous la ligne d'aide `DO YOU HOLD A TRANSFER CODE?` et le même formulaire, puis `RECEIVE THIS PIECE` ; le code du vendeur suffit. Si rien n'est proposé (une pièce déclarée, un code révoqué), notez la REF et prévenez un OPERATOR.
- L'écran dit `STAFF SCAN` : le navigateur est connecté à la console (§7). L'acheteur, ou le membre de l'équipe qui achète pour lui-même, scanne depuis un navigateur qui ne l'est pas ; `VERIFY AGAIN` n'y changerait rien.
- Après la récupération d'un mot de passe (§6), les transferts depuis ce compte sont suspendus 72 heures (`TRANSFERS_PAUSED`).

Ce que vous dites à l'acheteur, mot pour mot comme l'écran (*Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.*) :

> Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.

Au vendeur :

> Connecté à votre compte, scannez votre pièce, puis dans l'onglet OWNERSHIP touchez CREATE TRANSFER CODE et donnez ce code au seul acheteur. Il reste valable 7 jours, et vous pouvez l'annuler tant qu'il n'a pas servi.

À l'acheteur, ensuite :

> Connecté à votre compte ORBES, scannez la pièce, touchez I HAVE A TRANSFER CODE, puis saisissez le code dans les 15 minutes qui suivent le scan. Si vous vous êtes connecté après le scan, touchez d'abord VERIFY AGAIN. La pièce passe alors à votre nom.

Si le code est refusé parce qu'il n'est pas celui de cette pièce :

> Ce code de transfert n'est pas celui de cette pièce. Avant de payer, demandez au vendeur le code de transfert de cette pièce-ci, puis saisissez-le après un nouveau scan, connecté à votre compte ORBES.

### Le certificat de propriété (vente à distance)

Un acheteur à distance, une plateforme de revente ou un assureur peut demander, avant la vente, ce que le registre ORBES dit de la pièce. Le propriétaire enregistré crée lui-même un lien (F-06) : `MY PIECES` → la pièce → onglet `OWNERSHIP` → `OWNERSHIP CERTIFICATE` → `CREATE CERTIFICATE` → la durée (`7 DAYS`, `30 DAYS` ou `90 DAYS`) → `CREATE LINK`, puis `COPY LINK`. Le lien ne s'affiche qu'une fois (`This link is shown once: copy it now. ORBES cannot show it again.`) ; `WITHDRAW` le retire à tout moment.

- **Ce que lit celui qui ouvre le lien**, sans compte : `OWNERSHIP CERTIFICATE`, `VALID`, la pièce et son GENOME, la propriété (vérifiée ou non) et le jour où elle a commencé, la garantie, aucune perte ni aucun vol déclarés (`NONE REPORTED`), puis `DOWNLOAD PDF`. Jamais le nom ni l'e-mail du propriétaire.
- **Quand il cesse de valoir** : la pièce change de mains, une perte ou un vol est déclaré (§5), ou le lien expire ; il se lit alors `NO LONGER VALID`. Un lien retiré par son propriétaire, ou par la récupération d'un mot de passe ou le verrouillage du compte (§6), se lit `NOT FOUND`. Une pièce dont la perte ou le vol est déclaré, ou qui est révoquée ou retirée, ne propose pas `OWNERSHIP CERTIFICATE`.
- **Ce qu'il ne prouve pas.** Il atteste un enregistrement, jamais l'objet qu'on montre avec lui : il ne dit pas AUTHENTIC. L'acheteur scanne toujours la pièce elle-même à la remise, et la reçoit avec le code de transfert. Le personnel ne crée ni ne retire jamais un certificat à la place du client.

Au vendeur qui demande comment rassurer un acheteur à distance :

> Dans MY PIECES, ouvrez la pièce, puis OWNERSHIP CERTIFICATE et CREATE CERTIFICATE : vous choisissez sa durée et vous partagez le lien. Il montre ce que le registre ORBES dit de la pièce, sans votre nom ni votre e-mail, et cesse de valoir si la pièce change de mains ou si une perte ou un vol est déclaré. Vous pouvez le retirer à tout moment.

À l'acheteur qui a reçu un certificat :

> Ce certificat montre ce que le registre ORBES dit de cette pièce au moment où vous l'ouvrez ; il ne prouve pas que l'objet qu'on vous remet est cette pièce. À la remise, scannez l'ORBES CODE de la pièce, puis recevez-la avec le code de transfert du vendeur.

---

## 5. Perte ou vol

### Le client déclare lui-même : MY PIECES

Sur theorbes.com/verify, connecté, le client ouvre `MY PIECES` (sur l'accueil, ou dans la ligne de son compte de l'onglet `OWNERSHIP`), puis, sous la pièce, `REPORT LOST / STOLEN` → `LOST` ou `STOLEN` → `CONFIRM REPORT` (F-01). Il n'a pas besoin de la pièce pour cela : il ne la scanne pas. Aussitôt :

- un transfert en attente est annulé ;
- ses certificats de propriété se lisent `NO LONGER VALID` (§4), pour toujours : une pièce retrouvée en demande un nouveau ;
- chaque scan de la pièce affiche UNUSUAL ACTIVITY DETECTED, et ses codes ne peuvent plus être imprimés ;
- le premier scan qui suit ouvre dans `Anomalies` un signal `LOST STOLEN SCAN`, et les scans suivants s'y ajoutent ; son panneau `Details` liste ces scans, leurs jours et leurs pays (`Scans in the window`, `Countries`).

Une perte que le client a déclarée lui-même, il la lève lui-même : `PIECE FOUND`, puis le mot de passe de son compte (`PASSWORD`), puis `CONFIRM` dans `MY PIECES` rend à la pièce son statut d'avant (une pièce perdue pendant un entretien redevient `IN SERVICE`). Le mot de passe est redemandé exprès : une session restée ouverte ailleurs ne suffit pas à lever la déclaration. Un vol, ou une perte inscrite par ORBES Client Services, n'est levé que par ORBES Client Services : `MY PIECES` montre alors leurs coordonnées, sans bouton. Un client qui craint qu'on ait pris son compte, ou qu'on lui ait pris la pièce, déclare donc `STOLEN` plutôt que `LOST`.

Une pièce que ORBES a révoquée ou retirée, ou qu'ORBES a écartée après examen, ne propose pas `REPORT LOST / STOLEN` : la console refuserait la déclaration, et `MY PIECES` dit au client de s'adresser à ORBES Client Services, avec leurs coordonnées (*A loss or a theft of this piece cannot be reported here: tell ORBES Client Services.*). Chaque scan d'une telle pièce n'affiche déjà plus AUTHENTIC. Notez ce que dit le client (quand, où, ce qui s'est passé) avec la référence de la pièce, et prévenez un OPERATOR.

> Vous pouvez déclarer la perte ou le vol vous-même : sur theorbes.com/verify, connectez-vous, ouvrez MY PIECES, choisissez la pièce et confirmez la déclaration. Si vous retrouvez une pièce que vous aviez déclarée perdue, PIECE FOUND la rétablit, avec le mot de passe de votre compte ; après un vol, ORBES Client Services s'en charge avec vous.

### ORBES Client Services déclare : la console

Un OPERATOR, après la vérification d'identité du §6 quand la demande vient du client (une déclaration change ce que lit chaque personne qui scanne la pièce) :

1. `Products` → la pièce → section `Actions`, groupe `Lifecycle` → `Change status`.
2. `New status` : `LOST` (perte) ou `STOLEN` (vol). `Reason` : qui l'a demandé, quand, et la référence d'un éventuel échange. `Continue`, puis `Apply`.
3. Pièce retrouvée : `Change status` → le statut d'avant, marqué `(return)` → `Apply`. Seul le retour au statut d'avant est possible. Lever un `STOLEN` à la demande du client demande la vérification renforcée du §6 : en boutique, avec la pièce, jamais par téléphone.

Une pièce perdue en stock ou pendant un transport se déclare de la même façon. Si quelqu'un la scanne ensuite, le signal `LOST STOLEN SCAN` s'ouvre dans `Anomalies` (avant la déclaration, c'était `UNSOLD PIECE SCANNED`, une fois par jour) : son panneau `Details` liste les scans, leurs jours et leurs pays.

### Quand quelqu'un présente une pièce déclarée

Le résultat dit UNUSUAL ACTIVITY DETECTED. Ne dites jamais que la pièce a été déclarée perdue ou que son vol a été déclaré : la phrase est celle du §3. Notez la REF et le lieu d'achat, et prévenez un OPERATOR.

### La carte perdue avant l'enregistrement

Le claim code n'est gardé que sous forme d'empreinte : personne ne peut le relire, ni le client, ni ORBES. Quand une carte certificat est perdue ou abîmée avant que la pièce soit enregistrée (chez le client ou en stock), un OPERATOR fait un nouveau claim code. L'ancien cesse aussitôt d'enregistrer la pièce.

1. `Products` → la pièce : vérifiez qu'elle n'est enregistrée par personne. Une pièce enregistrée ne reçoit pas de nouveau claim code : c'est une question de propriété, traitée avec les outils de §4 et §6.
2. Section `Actions`, groupe `Claim code` → `New claim code`, avec une raison (`Reason`) : qui l'a demandé, quand, ce qui est arrivé à la carte. La section `New claim codes` en garde l'historique, jamais les codes.
3. **Une pièce vendue** (sa commande est ouverte) : `Make it for the buyer`. Le code ne s'affiche jamais dans la console : il attend l'acheteur sur sa commande, dans MY PIECES → ORDERS, et ne s'y affiche qu'une fois. Une fois la commande expédiée, le client peut y enregistrer la pièce directement, sans scan. Répondez-lui dans `Messages` :

> Votre nouveau claim code vous attend sur votre commande ORDER OR-…, dans MY PIECES → ORDERS. Il ne s'affiche qu'une fois : enregistrez au même moment votre nouvelle carte (SAVE YOUR NEW CARD).

4. **Une pièce en stock** (sans acheteur) : `Make a new claim code`. Le code s'affiche une seule fois, à vous : `Download certificate card`, imprimez la carte et remplacez celle de la boîte de la pièce.

Une pièce vendue en boutique, sans commande, ne reçoit pas de nouveau claim code : la console le refuse, car son acheteur n'a pas de commande où le recevoir et le personnel ne voit jamais un code dû à un acheteur. Prévenez un ADMIN. Une pièce dont l'ORBES CODE a été révoqué reçoit d'abord un nouvel ORBES CODE (`Re-issue code`), puis son nouveau claim code.

---

## 6. Mot de passe oublié

Il n'y a pas d'e-mail de réinitialisation : un client qui a oublié son mot de passe passe par ORBES Client Services (C-04, A-06). Après la vérification de son identité, un ADMIN lui donne un **code de récupération** : à usage unique, valable 30 minutes.

### Vérification d'identité (ébauche, à finaliser avec le juriste)

SECURITY-MODEL §3.6 : un code de récupération, un verrouillage à la demande du client et un export de ses données ne se donnent qu'après cette vérification. Ébauche pour le personnel :

1. C'est le client qui donne les informations ; vous les comparez à la console, sans jamais les lui lire d'abord.
2. L'adresse e-mail exacte du compte : `Owners` → `Email or REF` → l'adresse entière → `Search` (il n'y a pas de recherche partielle). La fiche du client montre ses pièces, ses transferts et ses derniers scans.
3. **Ce qui ne prouve pas l'identité.** Tout ce qu'un scan montre : l'identité de la pièce (`O26-…`) et son modèle, la date de début de sa garantie, et la REF d'un scan. N'importe qui les obtient en scannant le code de la pièce, ou une copie de ce code : la section `Reference` nomme le propriétaire dans `Owner of the piece`, quelle que soit la personne qui scanne. Ces faits prouvent au mieux l'accès à la pièce ou à une photo de son code ; ils ne suffisent jamais, seuls ou ensemble. Un scan fait pendant l'échange (le client vous lit sa REF) reste un contrôle en plus, qui montre que la pièce est à portée de main, jamais la preuve.
4. **Ce qui la prouve : des faits qu'aucun scan ne montre**, comparés à la fiche du client. Il faut les deux :
   - la facture d'une pièce que ce compte a enregistrée lui-même (`FIRST REGISTRATION` dans la colonne `Acquired` de `Pieces`) **et qu'il détient encore** (`CURRENT` dans la colonne `Until`) : son point de vente et sa date, ensemble, comparés à `Purchase` dans la section `Warranty` de la fiche de la pièce. Pour une pièce reçue par transfert (`TRANSFER`), la facture d'origine ne prouve rien : c'est celle d'un ancien propriétaire. Pour une pièce que ce compte a cédée depuis (une date dans `Until`), elle ne prouve rien non plus : un vendeur remet souvent la facture à l'acheteur, qui connaîtrait alors la facture et, pour un compte sans autre pièce, tout le reste ;
   - ce que le client dit de son compte : ses autres pièces et à peu près depuis quand il les a (ou qu'il n'en a pas d'autre), ses transferts récents, envoyés ou reçus, comparés à `Pieces` (colonnes `Acquired`, `From` et `Until`) et à `Transfers in progress`.
5. En boutique : en plus, une pièce d'identité au nom de la facture.
6. Une pièce du compte déclarée `LOST` ou `STOLEN` : la facture dans tous les cas, car celui qui tient la pièce, et peut-être sa boîte, est le premier à pouvoir se faire passer pour le client. Lever un `STOLEN` (§5) : en boutique, avec la pièce, la facture et une pièce d'identité à son nom ; jamais par téléphone.
7. Sans ces faits (un compte dont les pièces ont toutes été reçues par transfert, une facture perdue), ou au moindre doute : aucun code. Proposez au client de venir en boutique avec une pièce d'identité au nom du compte (`Name` sur sa fiche) ou de la facture, la pièce et ce qu'il a de son achat ; le cas va au juriste (§11).
8. Jamais : demander le mot de passe, envoyer le code par e-mail, SMS ou message, l'écrire, le donner à quelqu'un d'autre que la personne vérifiée.

### Dans la console (ADMIN)

`Owners` → l'adresse exacte → `Search` → la ligne du client → `Recovery code` → `Issue a recovery code` → `Issue code`. Le code s'affiche une fois (`Recovery code · shown once`) : lisez-le au client, au téléphone ou en face à face, puis `Given to the client — hide`. Un nouveau code annule le précédent.

- `Recovery attempts throttled until …` sur la ligne du client : 5 essais manqués en une heure ont usé ce code. Donnez-en un nouveau, après la même vérification.
- Un compte dont on soupçonne la prise de contrôle : `Lock account` sur sa fiche (ADMIN). Ses sessions se ferment, ses transferts en attente sont annulés, ses liens de certificat de propriété sont retirés (§4) et le code ouvert ne sert plus. `Unlock account` le rouvre ; ce que le verrouillage a annulé ou retiré le reste.
- Après une récupération, la ligne du client montre `Transfers paused until …`.

### Ce que vous dites

> Nous n'envoyons jamais de lien par e-mail pour changer un mot de passe. Après avoir vérifié votre identité, je vous lis un code de récupération : il ne sert qu'une fois et reste valable 30 minutes. Sur theorbes.com/verify, touchez MY PIECES (ou, après un scan, l'onglet OWNERSHIP), puis FORGOTTEN PASSWORD? sous le formulaire de connexion, puis I HAVE A RECOVERY CODE, et saisissez l'adresse e-mail de votre compte, ce code et un nouveau mot de passe de 12 caractères au moins.

> Pour votre sécurité, toutes vos sessions se ferment, vos transferts en attente sont annulés, les liens de certificat de propriété que vous aviez partagés sont retirés, et aucun nouveau transfert n'est possible depuis votre compte pendant 72 heures.

Un client connecté qui veut seulement changer son mot de passe le fait lui-même : `CHANGE PASSWORD`, dans `MY PIECES`, à côté de `SIGN OUT` (sur l'accueil de theorbes.com/verify, ou par `MY PIECES` dans la ligne de son compte de l'onglet `OWNERSHIP`).

---

## 7. Scans personnels du personnel

Un navigateur connecté à la console scanne **en tant que staff** (S-07, API §9.7) : le scan est inscrit en `ADMIN_TEST` à votre nom, n'ouvre pas `UNSOLD PIECE SCANNED`, et l'onglet `OWNERSHIP` ne propose jamais d'enregistrement. Sur une pièce vendue et pas encore enregistrée, il dit `STAFF SCAN` ; sur une pièce non vendue, `NOT YET DELIVERED`, comme pour tout scan.

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

Chaque personne qui vendra ou répondra aux clients la réalise une fois, seule, avant sa première vente, avec son compte OPERATOR nominatif (§10). Un vendeur RETAIL fait l'étape 3 en mode Boutique et laisse l'étape 7 à un OPERATOR. Il ouvre le mode Boutique sur un autre appareil ou un autre navigateur que le téléphone de test : l'ordinateur (`Upload a photo` s'il n'a pas de caméra) ou le téléphone du comptoir. Le téléphone de test n'est jamais connecté à la console : chacun de ses scans deviendrait un scan staff, sans enregistrement (§7), et l'étape 4 échouerait.

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
2. Une pièce test : `Generator` → `Single piece` → une catégorie et un modèle existants, `Production batch` : TEST, la case `Issue a one-time claim code (shown once, stored as a hash)` cochée → `Issue & sign`. Notez son identité (`O26-…`) et le claim code affiché une fois (`Claim code · shown once`). Pour cette pièce test seulement, il est remis à la personne sur papier : le claim code d'une pièce vendue ne quitte jamais sa carte.
3. Son ORBES CODE imprimé : sur l'écran du résultat de `Generator`, section `Code & print files`, `Width (mm)` 30, `Download` `PDF`, imprimé à 100 %.
4. La planche d'essai `docs/assets/test-sheets/orbes-code-test-sheets.pdf`, page 2, imprimée à 100 %. Ses codes sont signés par la clé d'exemple publique : ils donnent INVALID SIGNATURE. Ils n'ouvrent aucun signal dans `Anomalies`, mais chacun de leurs scans compte une fois dans `Analytics`, sous `Counterfeit signals by country` (INVALID SIGNATURE, le pays de la séance).
5. Un point de vente dans `Points of sale`.
6. Deux adresses e-mail de test, réservées à cet usage (comptes test A et B), un ordinateur pour la console, et un téléphone dont le navigateur n'est pas connecté à la console (une fenêtre de navigation privée suffit).

### Étape 1 — Se connecter à la console (3 min)

Sur l'ordinateur, ouvrez `https://verify.theorbes.com/admin` : `Email`, `Password`, `Sign in`, puis `Authenticator code` (les six chiffres de votre application), qui n'apparaît qu'à ce moment, et de nouveau `Sign in`. À la première connexion avec un mot de passe provisoire, l'écran `New password` demande `Temporary password` (tapé exactement comme remis, capitales et tirets compris), `New password`, `New password again`, puis `Save password`. Vous arrivez sur `Dashboard` ; la barre latérale mène au reste.

### Étape 2 — Scanner la pièce test avant sa vente (3 min)

Sur le téléphone, ouvrez theorbes.com/verify, `SCAN ORBES CODE`, visez le code imprimé de la pièce test. Attendu : `AUTHENTIC`. Touchez l'onglet `OWNERSHIP` : `NOT YET DELIVERED`. C'est ce que voit un client dont la vente n'a pas été inscrite. Ce scan ouvre aussi `UNSOLD PIECE SCANNED` dans `Anomalies` : c'est attendu (§7), l'ADMIN le classera après la séance.

### Étape 3 — Activer sa garantie (4 min)

Console : `Products` → `Search` : l'identité de la pièce test → `Apply` → sa ligne. Sur la fiche, section `Actions`, groupe `Warranty` → `Activate warranty` → `Purchase date` (aujourd'hui), `Point of sale`, `Country` (FR) → `Activate`. Attendu : `Warranty activated.`, puis `Lifecycle` `ACTIVATED` et `Warranty` `ACTIVE` en tête de fiche.

### Étape 4 — Enregistrer la pièce avec le compte test A (6 min)

Sur le téléphone, `SCAN ANOTHER` en bas du résultat, puis scannez de nouveau la pièce. Attendu : `AUTHENTIC — FIRST REGISTRATION`. Onglet `OWNERSHIP` : `REGISTRATION OPEN UNTIL …`, suivi de l'heure. `CREATE ACCOUNT` : `EMAIL` (adresse test A), `PASSWORD` (12 caractères au moins), puis `CREATE ACCOUNT`. Ensuite `CLAIM CODE` (celui de la préparation) → `REGISTER THIS PIECE`. Attendu : `REGISTERED TO YOU`. Touchez `VIEW AS OWNER` : `AUTHENTIC — OWNERSHIP VERIFIED`.

### Étape 5 — Transférer la pièce au compte test B (7 min)

Toujours connecté en A, onglet `OWNERSHIP`, `TRANSFER OF OWNERSHIP` → `CREATE TRANSFER CODE`. Notez le `TRANSFER CODE`, puis `SIGN OUT`. `SCAN ANOTHER` et scannez la pièce : `AUTHENTIC — REGISTERED`, avec sous la phrase la consigne d'achat d'occasion et `I HAVE A TRANSFER CODE`. Touchez-le : l'onglet `OWNERSHIP` s'ouvre sur `RECEIVING THIS PIECE`. `CREATE ACCOUNT` avec l'adresse test B. Connecté en B après le scan, l'écran demande `VERIFY AGAIN` : touchez-le. Le résultat se rouvre sur l'onglet `OWNERSHIP`, avec `RECEIVING OPEN UNTIL …` et l'heure. `TRANSFER CODE` → `RECEIVE THIS PIECE`, dans les 15 minutes qui suivent cette vérification. Attendu : `REGISTERED TO YOU`. Dans la console, la fiche de la pièce, section `Ownership`, nomme le nouveau propriétaire et montre le transfert dans l'historique.

### Étape 6 — Lire un résultat UNKNOWN ORBES CODE (ici INVALID SIGNATURE) (2 min)

Sur le téléphone, `SCAN ANOTHER`, visez une étiquette de 30 mm de la planche d'essai. Attendu : `INVALID SIGNATURE`. Lisez l'écran de haut en bas : le titre et sa phrase ; *ORBES Client Services can help with any question about this piece. The reference below is attached to your message.* ; `WRITE TO ORBES CLIENT SERVICES` (le message arrive dans `Messages`) ; `WHERE DID YOU SEE OR BUY THIS PIECE?` (n'y répondez pas : la question est pour les clients) ; en bas, `REF` et huit caractères. Notez cette REF.

Un `UNKNOWN ORBES CODE` se lit exactement de la même façon : seuls le titre et la phrase changent, et les gestes sont ceux du §3. **Écart assumé** : la checklist ne fabrique pas d'UNKNOWN ORBES CODE. En production, le seul qu'on puisse produire à la demande vient d'un code signé par une clé ORBES et absent du registre, qui ouvre un signal CRITICAL `VALID SIGNATURE UNREGISTERED`, celui d'une clé compromise (API §9.4, étape 6) ; l'autre cause, un serveur qui ne connaît pas encore la version du code, ne s'imprime pas pour un exercice. La planche d'essai donne le même écran sans ouvrir de signal dans `Anomalies` ; son scan compte seulement une fois dans `Analytics` (préparation, point 4).

### Étape 7 — Retrouver le scan dans la console (3 min)

Console : `Owners` → `Email or REF` : `REF` et les huit caractères notés → `Search`. La section `Reference` liste ce scan : `Result` `INVALID SIGNATURE`, `Piece` `Not in the registry`, `Scanned by` le compte B. Puis `Verification events` → `Product` : l'identité de la pièce test → `Apply` : tous les scans de la séance, du plus récent au plus ancien, chacun avec son résultat. Enfin `Anomalies` : le `UNSOLD PIECE SCANNED` de l'étape 2.

Arrivé ici seul en moins de 30 minutes : la checklist est réussie.

### Après la séance (un ADMIN)

- La pièce test : sur sa fiche, `Change status` → `New status` `RETIRED` → `Continue` → `Apply`. Elle se lit désormais `REVOKED`, et ses codes ne peuvent plus être imprimés.
- Le signal de l'étape 2 : `Anomalies` → `Triage` → `Decision` : `Dismiss` → `Note` : « pièce test, checklist J-09 » → `Record decision`.
- Dans `Analytics`, `Counterfeit signals by country` compte le scan de l'étape 6 (INVALID SIGNATURE, le pays de la séance) : c'est attendu. Sa REF et son heure, notées à l'étape 6, l'identifient ; rien n'est à classer.
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
read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET   # l'ADMIN colle le secret affiché par totp-setup : rien ne s'affiche
clear   # le secret quitte l'écran
docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email <e-mail de la personne> --code <code à 6 chiffres>
unset ADMIN_TOTP_SECRET
docker compose exec app node --import tsx scripts/admin.ts list
```

Dans le conteneur, la première commande est exactement `ADMIN_PASSWORD=… node --import tsx scripts/admin.ts create --email … --role OPERATOR` : `docker compose exec -e ADMIN_PASSWORD` lui passe le mot de passe sans l'écrire dans l'historique du shell ni sur la ligne de commande.

1. `create` lit le mot de passe dans `ADMIN_PASSWORD`, jamais sur la ligne de commande.
2. `totp-setup` affiche une fois le secret et son lien otpauth. La personne l'ajoute elle-même à son application d'authentification, sur son téléphone, devant l'ADMIN. L'ADMIN colle ensuite le secret dans `read -rs ADMIN_TOTP_SECRET`, copie autre chose pour vider son presse-papiers, et `clear` efface le secret de l'écran (ou fermez la fenêtre du terminal après la séance). Le secret n'est ni photographié, ni envoyé, ni gardé par l'ADMIN.
3. `totp-enable` lit le secret dans `ADMIN_TOTP_SECRET`, comme `create` lit le mot de passe : il n'est écrit ni dans l'historique du shell, ni sur une ligne de commande que la liste des processus du serveur montrerait (ce que ferait `--secret`). Il reçoit le code que l'application affiche à cet instant : ce code prouve que l'application détient le secret.
4. `list` montre la personne avec `2FA on` et `active`.
5. La personne range son mot de passe dans son propre gestionnaire de mots de passe ; l'ADMIN ne garde rien. Elle peut le changer à tout moment : `Change password`, au pied de la barre latérale.

### Depuis la page Team (A-02), le TOTP enrôlé hors de la console

1. Un ADMIN : `Team` (groupe `Security`) → `New staff account` → `Email`, `Role` : `OPERATOR` → `Create account`.
2. Le mot de passe provisoire s'affiche une fois (`Temporary password · shown once`) : remettez-le en main propre, puis `I have handed it over — hide`.
3. Avant sa première connexion, enrôlez son TOTP depuis le shell, en sa présence : `totp-setup` puis `totp-enable`, le secret lu dans `ADMIN_TOTP_SECRET`, comme ci-dessus.
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
| Vérification d'identité (§6), dont la règle de la facture : seulement celle d'une pièce que le compte détient encore (`CURRENT`), jamais celle d'une pièce cédée depuis, que le vendeur a pu remettre à l'acheteur | Juriste | le premier code de récupération, verrouillage ou export à la demande d'un client | Ouvert |
| Phrases à dire (§1 à §6) | Marque et juridique | la formation des vendeurs | Ouvert |
| Carte certificat sans la mention PROOF (kit, §6) | Marque | la première carte remise à un client | Fait : 79t validée le 2026-10-07 |
| Retour d'une commande expédiée (§2) : la suite d'une pièce dont la garantie a commencé | Propriétaire | la première vente en ligne | Ouvert |

**Écart assumé.** Le brief demande de « lire un résultat UNKNOWN » pendant la checklist. Elle fait lire INVALID SIGNATURE, qui a le même écran : en production, le seul UNKNOWN ORBES CODE qu'on puisse produire à la demande ouvre un signal CRITICAL de clé compromise, et l'autre cause (un serveur en retard sur la version du code) ne s'imprime pas (§9, étape 6). Le scan de la planche n'ouvre aucun signal dans `Anomalies`, mais compte une fois dans `Analytics` (`Counterfeit signals by country`) : c'est attendu.
