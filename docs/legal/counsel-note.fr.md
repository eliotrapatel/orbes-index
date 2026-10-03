# Note pour l'avocat : CGU, mentions légales, loi Toubon, médiation

Cette note accompagne les brouillons de `docs/legal/` : les [conditions générales d'utilisation](terms.fr.md) ([EN](terms.en.md)), les [mentions légales](legal-notice.fr.md) ([EN](legal-notice.en.md)) et les [faits du code](TERMS-FACTS.md) dont chaque clause est tirée. Elle dit ce qui reste à compléter, les deux questions que le brief pose (loi Toubon, médiateur de la consommation) et les points où le code et le droit doivent se rejoindre.

**Statut.** Brouillons rédigés à partir du code, sans validation juridique. Par décision d'ORBES, les pages légales sont mises en ligne avant cette validation (elles seront servies sous `/legal` de verify.theorbes.com), sans champ vide visible tant que l'identité légale manque. Votre relecture reste attendue avant l'annonce publique (LAUNCH §10).

**Méthode.** Chaque article des CGU se termine par une ligne *Code : …* qui cite les règles de [TERMS-FACTS](TERMS-FACTS.md) qu'il décrit. Chaque règle y est reliée à la constante et à la ligne de code qui l'applique, et un test automatique (`genome/test/docs/terms-facts.test.ts`) échoue dès que le code s'en écarte. Une clause que vous modifiez sur un point couvert par le code demande donc soit de garder la règle, soit de changer le code : dites-le-nous.

## 1. Champs à compléter

Tous les champs portent la marque [À COMPLÉTER : …], dans les deux langues.

| Champ | Où | Remarque |
|---|---|---|
| Raison sociale, forme juridique, capital social | Mentions légales, CGU article 1 | Identité légale de l'éditeur, à fournir par ORBES. |
| RCS, siège social, numéro de TVA intracommunautaire | Mentions légales | |
| Directeur de la publication et sa qualité | Mentions légales | |
| Coordonnées d'ORBES Client Services | Mentions légales, CGU article 2 | Les mêmes que celles du serveur (`CLIENT_SERVICES_EMAIL`, `CLIENT_SERVICES_PHONE`, `CLIENT_SERVICES_HOURS`, LAUNCH §10). |
| Téléphone de Vercel Inc. | Mentions légales | Hébergeur de theorbes.com. L'adresse indiquée (440 N Barranca Ave #4133, Covina, CA 91723) est celle que publie Vercel : à vérifier au jour de la publication. |
| Entité OVHcloud, adresse, téléphone | Mentions légales | Hébergeur de verify.theorbes.com, serveur situé au Canada. L'entité dépend du site où le serveur a été commandé (par exemple OVH SAS, Roubaix, pour une commande sur le site français) : à lire sur le contrat. |
| Date d'entrée en vigueur | CGU | |
| Âge et capacité | CGU article 5 | Le code ne vérifie ni l'âge ni l'identité (N5). |
| Fermeture du compte | CGU article 5 | Voir §4, point 3. |
| Acceptation assistée d'un transfert | CGU article 8 | Le réglage existe côté serveur, aucun écran ne la propose (R40). |
| Déclaration inexacte de perte ou de vol | CGU article 9 | |
| Conditions de la garantie commerciale | CGU article 11 | Document distinct, à rédiger (§4, point 10). |
| Motifs du verrouillage | CGU article 12 | Voir §4, point 7. |
| Limites de responsabilité | CGU article 14 | |
| Information sur les modifications des CGU | CGU article 15 | Le service n'envoie pas d'e-mail (N1). |
| Médiateur de la consommation, juridiction | CGU article 16 | Voir §3. |

## 2. Loi Toubon

**Le fait.** Toute l'interface du service est en anglais : la page déclare `lang="en"` (`genome/src/web/verify/index.html`) et les textes sont écrits une seule fois, en anglais (`genome/src/web/verify/copy.ts`, `genome/src/server/services/copy.ts`), sans traduction. Cela couvre trois catégories que vise la loi n° 94-665 du 4 août 1994, article 2 :

- **la garantie** : son état et ses dates (NOT YET STARTED, ACTIVE, EXPIRED, NO LONGER VALID, et la phrase « This piece is covered by the ORBES warranty until … ») ;
- **l'entretien** : le texte d'entretien de chaque modèle, saisi dans la console (un texte par défaut, en anglais, quand le modèle n'en a pas), et l'historique des entretiens ;
- **le mode d'emploi** : la marche à suivre pour scanner une pièce, l'enregistrer, la transférer, déclarer sa perte ou son vol, et les messages qui l'accompagnent.

La carte certificat est imprimée en anglais ; l'emballage proposé est bilingue ([PACKAGING-KIT](../launch/PACKAGING-KIT.md)). Les pages légales seront publiées en français et en anglais.

**Questions.**

1. Ces écrans relèvent-ils de l'article 2 (présentation, mode d'emploi, étendue et conditions de garantie d'un bien) pour un client en France ?
2. Si oui, laquelle de ces voies suffit : traduire l'application (aucun mécanisme de traduction n'existe aujourd'hui : un chantier à part entière) ; remettre avec la pièce, en français, les conditions de garantie, les consignes d'entretien et le mode d'emploi du service, l'application restant en anglais ; saisir en français le texte d'entretien des modèles dans la console ?
3. Pour les CGU et les mentions légales publiées dans les deux langues : faut-il préciser que la version française fait foi ?

## 3. Médiateur de la consommation

Le Code de la consommation (articles L. 612-1 et L. 616-1) impose à tout professionnel de garantir au consommateur un recours effectif et gratuit à un médiateur, et de l'en informer, notamment sur son site et dans ses conditions générales. Le service de vérification est gratuit, mais il prolonge la vente des pièces (garantie, enregistrement, transfert).

**Questions.**

1. ORBES doit-il désigner un médiateur au titre de ce service, ou celui de ses ventes suffit-il ? Lequel ? (CGU article 16.)
2. Le brouillon ne renvoie pas à la plateforme européenne de règlement en ligne des litiges : elle a fermé en 2025 (règlement (UE) 2024/3228). À confirmer.
3. Droit applicable et juridiction : quelle clause pour un client hors de France, consommateur ou non ?

## 4. Points où le code et le droit doivent se rejoindre

1. **L'enregistrement n'est pas un titre de propriété** (CGU articles 4 et 7 ; R25, R28, R29). Le registre lie une pièce à un compte ; la propriété « vérifiée » signifie seulement que le claim code a été donné, ou qu'ORBES Client Services a vu une preuve d'achat. La formulation vous revient.
2. **Le transfert est définitif** (CGU article 8 ; R41, N3). Aucune route ne défait un transfert accepté, et le personnel ne peut pas réattribuer une pièce : la valeur `ADMIN` de `acquired_via` existe dans le schéma, mais aucun code ne l'écrit. En cas de litige entre vendeur et acheteur, ORBES Client Services peut verrouiller un compte (R19) ou enregistrer un vol, pas rendre la pièce. Faut-il garder « définitif » tel quel, ou prévoir une procédure (et donc un développement) ?
3. **Pas de suppression de compte** (CGU article 5 ; N4). Le client ne peut pas supprimer son compte, et aucun outil ne le fait pour lui : le statut `DELETED` existe dans le schéma, aucun code ne l'écrit. Une demande d'effacement (RGPD, article 17) n'a donc pas encore de traitement. L'export du droit d'accès existe (R21). À trancher : délai, sort des pièces enregistrées, de l'historique des scans et du journal d'audit (permanent, il ne contient que des identifiants).
4. **Âge et identité** (CGU article 5 ; N5). Aucune vérification à la création d'un compte.
5. **Adresse e-mail non vérifiée** (CGU article 5 ; R07). Une adresse mal saisie empêche ORBES Client Services de retrouver le compte, et le service n'envoie aucun message.
6. **Vérification d'identité avant un code de récupération** (CGU article 6 ; R13). C'est une procédure humaine, esquissée dans le [SALES-PLAYBOOK §6](../launch/SALES-PLAYBOOK.md), à finaliser avec vous. La suspension des transferts pendant 72 heures (R17) limite l'effet d'une vérification trompée.
7. **Verrouillage** (CGU article 12 ; R19, R20). Le code applique le verrouillage, pas ses motifs : à définir, ainsi que l'information du titulaire (le service n'envoie pas d'e-mail).
8. **Acceptation des CGU.** Les pages légales mettront un lien vers les CGU sous CREATE ACCOUNT ; l'application n'enregistre ni l'acceptation, ni la version acceptée. Un lien suffit-il, ou faut-il une case à cocher et la conservation de la version et de la date (un développement) ?
9. **Modification des CGU** (CGU article 15). Sans e-mail, l'information des titulaires de compte ne peut passer que par le service lui-même : quelle forme et quel délai ?
10. **Garantie commerciale** (CGU article 11 ; R52 à R55). Le registre n'en porte que les dates, le point de vente et l'état. Ses conditions (durée par catégorie, exclusions, cas d'annulation, rappel des garanties légales) sont à rédiger dans un document distinct, en français.
11. **Certificat de propriété** (CGU article 10 ; R46 à R51). Quiconque a le lien voit la pièce, la date de la propriété et la garantie, jamais le nom ni l'e-mail. Le propriétaire crée le lien lui-même et peut le retirer à tout moment.
12. **Durée de conservation des scans.** Elle n'est pas encore fixée (`SCAN_RETENTION_DAYS`, DATABASE §10) : décision attendue avec vous, pour la politique de confidentialité.

## 5. Mentions légales

Le brief cite l'article 6-III de la loi n° 2004-575 du 21 juin 2004 (LCEN) et ses sanctions pénales. Le brouillon vise la loi sans citer d'article : la numérotation de son article 6 a changé depuis 2024, à vérifier. Les mentions couvrent theorbes.com (Vercel Inc.) et verify.theorbes.com (OVHcloud, serveur au Canada). Le serveur hors de l'Union européenne est un écart accepté par ORBES (COMPLIANCE §7, H2) : la politique de confidentialité dira où les données sont traitées, et vous confirmerez le fondement du transfert.
