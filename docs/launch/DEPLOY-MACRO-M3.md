# Mise en production du lot MACRO M3

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot M3 de tes décisions du 2026-10-20 (les boîtes et les poids, le rapport des retours, les commandes fournisseur par taille, les compléments, THE SET) part en production en **un seul déploiement**, après celui de MACRO M2 ([son runbook](DEPLOY-MACRO-M2.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| MACRO M3 | Les boîtes de la maison, la boîte et le poids emballé de chaque modèle, la boîte et le poids du colis à l'emballage (B1, B2) ; le rapport des retours et des échanges de taille, RUNS SMALL / RUNS LARGE (R1 ; aucune confirmation de taille, R2) ; une commande fournisseur d'un modèle répartie par taille et par entrepôt, et les pays que sert chaque entrepôt (Z1, Z2) ; les compléments du catalogue, avec leur stock, choisis à l'achat et dans YOUR ORDERS jusqu'à l'emballage (D1, D2) ; THE SET, 2 à 4 modèles à un seul prix, vendus par une sortie à eux (T1 à T4) | `0054_boxes_weights`, `0055_location_countries`, `0056_addons`, `0057_sets` | aucun | **À faire** (§1) |

Le point de départ : la production tourne MACRO M2, son commit `<SHA_M2>` (image `orbes-genome:<TAG_M2>`), avec les 54 migrations de `0001_initial` à `0053_worn`. **M3 ne part qu'après M2** : ses migrations s'appuient sur `0053_worn`. La branche du lot, `orbes-macro`, contient ce commit. Avant le jour, Claude remplace dans ce document `<SHA_M2>` et `<TAG_M2>` par le commit de M2 en production, et `<SHA_M3>` et `<TAG_M3>` par le commit final de M3 (40 caractères) et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `<TAG_M2>` (un correctif après M2), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les écrans d'abord.** Avant la fusion, tu regardes les captures que te donne le rapport de Claude (§1.1) et tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. Aucun nouveau chemin d'envoi de fichier (un set n'a pas de photo à lui : ses pièces montrent les leurs). Ton `.env` ne gagne aucune ligne.
5. **Quatre migrations, puis plus de retour en arrière** : après `0054_boxes_weights`, `0055_location_countries`, `0056_addons` et `0057_sets`, l'image `<TAG_M2>` ne tourne plus sur le schéma (`deploy.sh --image <TAG_M2>` la refuse). En cas de souci, on **répare en avant** (§1.5).
6. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
7. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
8. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-macro` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
9. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
10. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
11. **Les pages légales changent** : la politique de confidentialité (la phrase de YOUR SIZES : les tailles enregistrées sont aussi comptées, sans nommer personne, avec le pays du compte) et les conditions (article 14 : *Add-ons* et *THE SET* ; un set se retourne en entier), dans une seule nouvelle version, `2026-10-23`. Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La relecture par un avocat ne retient jamais le déploiement.
12. **Rien n'est prérempli** : aucune boîte, aucun poids, aucun pays d'entrepôt, aucun complément, aucun set n'existe après le déploiement. Tant que tu n'en as pas créé, les collectionneurs ne voient aucun complément ni aucun set, et l'emballage dit seulement qu'aucune boîte n'est réglée. Tes données s'entrent après (§1.8).

---

## 1. Le déploiement

### 1.0 Ce qui change

**Pour les collectionneurs (/verify, sur un téléphone et sur un ordinateur, en mode sombre et en mode clair)**

- **Les compléments (add-ons).** Sur la réservation d'une LIVE RELEASE avant PAY, sur la place tenue d'un tirage avec un prix et dans une demande du salon privé : le groupe ADD TO YOUR ORDER, chaque complément avec son prix et un sélecteur de 0 à 3. Dans YOUR ORDERS, la section ADD-ONS d'une commande, REMOVE sur chacun, et ADD AN ADD-ON (une feuille sur un téléphone, une partie de la page de la commande sur un ordinateur), **jusqu'au début de l'emballage**. Un complément épuisé au moment de la commande est laissé de côté et dit sur CONFIRMED ; la vente se fait sans lui.
- **THE SET.** Une sortie d'un set se lit THE SET · 3 PIECES, avec les photos de ses pièces côte à côte et un seul prix, ONE PRICE FOR THE SET : dans THE RELEASES, NOW et PAST, sur la page d'un tirage (une taille par pièce, préremplie par YOUR SIZES) et dans la salle d'une LIVE RELEASE (1 SET PER PERSON, la file et le tour comptés en sets, YOUR SET IS RESERVED). Dans YOUR ORDERS, les pièces d'un set sont groupées sous son nom, avec RETURN THE SET à la place de REQUEST A RETURN ; l'échange d'une taille reste par pièce.
- **Les pages légales** : la nouvelle version, `2026-10-23` (règle 11).
- Nulle part on ne demande au collectionneur de confirmer sa taille (R2).

**Pour le personnel (la console)**

- **`Orders` → `Settings` → `Boxes`** (un ADMIN écrit, les autres lisent) : les boîtes de la maison, leurs dimensions intérieures, leur poids à vide, leur coût ; une boîte qui ne prend pas à plat la carte de 95 × 62 mm est refusée. La page d'un modèle gagne `Packing` (sa boîte et son poids emballé, un OPERATOR) et le tableau des modèles la colonne `Box`. Pendant l'emballage, la page du colis dit la boîte à prendre et le poids du colis (`Change box` tant qu'il n'est pas emballé) ; à `Packed`, les deux sont inscrits et imprimés sur le bordereau, sans jamais le coût.
- **`Orders` → `Returns`** : les retours et les échanges de taille par raison, par modèle et par taille, filtrés par modèle et par période, RUNS SMALL / RUNS LARGE, et leur CSV. Des nombres seulement.
- **`Orders` → `Settings` → `Locations`** : la colonne `Serves` et `Edit countries` (un ADMIN), les pays que sert chaque entrepôt. **`Supplier orders` → `Order a model`** (un OPERATOR) : la répartition proposée par taille et par entrepôt, chaque ligne modifiable, puis `Add to drafts`.
- **`Catalogue` → `Add-ons`** (un OPERATOR) : les compléments, leur SKU, leur fournisseur, leur poids, un prix par devise. `Logistics` → `Stock` gagne la section `Add-ons` ; une réception les compte sans ORBES CODE ni carte ; l'emballage a une ligne par complément. La page d'une commande gagne `Add-ons` (`Add an add-on`, `Remove`, jusqu'à l'expédition).
- **`Catalogue` → `Sets`** (un OPERATOR) : 2 à 4 modèles, un prix. `New release` et `New live release` demandent `What it sells` : `A model` ou `A set`, avec les tailles par pièce. La page d'une commande d'un set dit `The set` ; son retour se décide en une fois (`Decide the set`).

**Pour le serveur**

- **Les routes nouvelles**, toutes sous `/api` que Caddy sert déjà : celles de la console, et pour les collectionneurs les compléments d'une commande et les tailles par pièce d'un set ([API](../API.md)). Aucune nouvelle route d'envoi de fichier.

**Les migrations**, appliquées dans **une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `<TAG_M2>`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0054_boxes_weights` | B1, B2 | la table `boxes` (vide), la boîte et le poids emballé d'un modèle, la boîte, le poids et ce qui manque d'un colis, tous vides |
  | `0055_location_countries` | Z1 | la table `stock_location_countries` (un pays servi par un entrepôt au plus), vide : chaque collectionneur compte à l'entrepôt par défaut tant que tu n'as rien réglé |
  | `0056_addons` | D1, D2 | les tables `addon_items`, `addon_item_prices`, `order_addon_items` et `addon_choices`, toutes vides ; un SKU peut appartenir à un complément ; la vue `stock_holds`, d'où se lit désormais tout le stock réservé |
  | `0057_sets` | T1 à T4 | les tables `sets`, `set_models`, `set_sales`, `drop_entry_sizes`, `live_entry_sizes` et `live_interest_sizes`, toutes vides ; une sortie vend un modèle ou un set ; les tailles d'une sortie par pièce |

  L'application est arrêtée pendant les migrations. Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Les variables** : aucune nouvelle. Ton `.env` ne change pas.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. Caddy n'est pas recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `<TAG_M2>` ne peut plus tourner sur ce schéma. `deploy.sh --image <TAG_M2>` la refuse.

### 1.1 Avant : tes écrans, ORBES Client Services et LOGISTICS, la CI, l'heure, le pré-contrôle

**1. Tes écrans d'abord** (règle 1), au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair : les compléments sur la réservation d'une LIVE RELEASE, sur la place tenue d'un tirage et dans le salon, ADD-ONS et ADD AN ADD-ON dans YOUR ORDERS, la ligne de CONFIRMED pour un complément laissé de côté ; un set dans THE RELEASES, NOW et PAST, la page d'un tirage d'un set et chacun de ses états, la salle d'une LIVE RELEASE d'un set, le groupe d'un set dans YOUR ORDERS avec RETURN THE SET ; les pages légales nouvelles ; dans la console, `Boxes`, `Packing`, la page d'un colis et son bordereau, `Returns`, `Serves` et `Order a model`, `Add-ons` (le catalogue, le stock, la page d'une commande), `Sets` et une sortie d'un set. Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** :

- **MACRO M2 est en production**, au commit `<SHA_M2>` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §2 « Les compléments (add-ons) », « THE SET » et « Retours et échanges ». Un complément s'ajoute et se retire dans YOUR ORDERS jusqu'au début de l'emballage ; un set est annulé en entier et retourné en entier, l'échange d'une taille reste par pièce ; « est-ce que ce modèle taille petit ? » se lit dans `Orders` → `Returns`.
- **Préviens ton prestataire logistique** (le rôle LOGISTICS) : §2 « La boîte et le poids du colis ». La page du colis dit la boîte à prendre et le poids ; chaque complément a sa ligne dans la liste d'emballage, cochée à la main ; une réception de compléments se compte sans ORBES CODE ni carte.

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-macro>. Le dernier passage de `genome-ci` doit être celui de `<SHA_M3>`, avec une coche verte. Sinon, n'avance pas.

**4. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 8) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_M3>` exactement, comme pour M2. Claude te donne la commande dans son rapport ; il ne la lance pas.

**5. Connecte-toi au serveur** en SSH, comme d'habitude, puis :

```bash
sudo -iu orbes
```

```bash
cd /opt/orbes/orbes-index/deploy/vps
```

```bash
umask 022
```

Il ne s'affiche rien.

**6. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**7. Le pré-contrôle.** Note les six résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

```bash
free -h
```

```bash
docker stats --no-stream
```

```bash
uptime
```

```bash
nproc
```

```bash
df -h /
```

```bash
du -sh /var/backups/orbes
```

À regarder : la ligne `Swap` de `free -h`, `Use%` de `df -h /` **sous 75 %** (au-dessus, ne déploie pas : préviens le responsable de l'hôte), de la mémoire disponible, aucun conteneur à plein CPU en continu, la charge d'`uptime` sous le nombre de `nproc`.

**8. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

```bash
pgrep -a pg_dump
```

Sortie attendue : **rien**. Une ligne `<numéro> pg_dump …` : une sauvegarde tourne, attends qu'elle finisse et relance la commande.

### 1.2 Préparer le serveur

**1. Rien d'égaré dans le shell.**

```bash
env | grep -E '^(ORBES_IMAGE_TAG|COMPOSE_PROJECT_NAME)='
```

Sortie attendue : **rien**. Si une ligne s'affiche : `unset ORBES_IMAGE_TAG COMPOSE_PROJECT_NAME`, puis relance la commande.

**2. Où en est le checkout.**

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s'
```

Sortie attendue : `<SHA_M2>` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=<TAG_M2>`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_M2> OK (previous <TAG_M1>; migrations 0052_house_messages, 0053_worn)` : MACRO M2 est le dernier déploiement réussi (`<TAG_M1>`, l'image de M1, que tu lis telle quelle). Une autre ligne : arrête-toi et demande à Claude.

**4. `RESTORE_ALLOWED=false`** :

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`.

Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n'y touches pas.

### 1.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_M3>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating <7 caractères de SHA_M2>..<7 caractères de SHA_M3>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_M3>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 4), contre le commit de M2 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status <SHA_M2> HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**Les quatre migrations, et elles seules** (règle 5) :

```bash
git -C /opt/orbes/orbes-index diff --name-status <SHA_M2> HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces quatre lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0054_boxes_weights.ts
A	genome/src/server/db/migrations/0055_location_countries.ts
A	genome/src/server/db/migrations/0056_addons.ts
A	genome/src/server/db/migrations/0057_sets.ts
```

**La version des pages légales** (règle 11) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-23';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 54 lignes, de `0001_initial` à `0053_worn` ; les deux dernières :

```text
0052_house_messages
0053_worn
```

Une liste qui s'arrête avant `0053_worn` : M2 n'est pas en production, arrête-toi.

### 1.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « MACRO M3 : déploiement lancé à 14:05 Paris (13:05 UTC), image orbes-genome:<TAG_M3>, 4 migrations ; rien ne change sur l'hôte (ni Caddy, ni port, ni variable). Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_M3> (tag <TAG_M3>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la même configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_M3>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: <TAG_M2>
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : le site tourne toujours sur `<TAG_M2>`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 54 migration(s) applied, all known to orbes-genome:<TAG_M3>
   ```

   **Il faut lire `54 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `<TAG_M2>`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M3>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M3>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_M3>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_M3>
   Applied 4 migration(s): 0054_boxes_weights, 0055_location_countries, 0056_addons, 0057_sets
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 4 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) ; Caddy garde son conteneur, sa configuration n'ayant pas changé.

6. **La clé de signature et les tests de fumée** :

   ```text
   … [deploy.sh] ── signing key
   … [deploy.sh] an ACTIVE signing key exists
   … [deploy.sh] ── smoke tests via https://verify.theorbes.com
   … [deploy.sh] health: {"ok":true,"version":"0.1.0"}
   … [deploy.sh] /.well-known/orbes-keys.json lists an ACTIVE key
   … [deploy.sh] /verify: 200
   ```

7. **La fin** :

   ```text
   … [deploy.sh] deployed orbes-genome:<TAG_M3> (previous: <TAG_M2>). This release applied the migration(s) 0054_boxes_weights, 0055_location_countries, 0056_addons, 0057_sets:
   … [deploy.sh] orbes-genome:<TAG_M2> cannot run on this schema any more (scripts/deploy.sh --image <TAG_M2> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M3> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`. Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `<TAG_M2>`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:<TAG_M2>` et `rolled back to <TAG_M2>; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `<TAG_M2>`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to <TAG_M2> is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_M3> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `<TAG_M2>`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_M3>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, ne crée ni complément ni set. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image <TAG_M2>`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_M3> OK (previous <TAG_M2>; migrations 0054_boxes_weights, 0055_location_countries, 0056_addons, 0057_sets)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 58 lignes `applied`, de `0001_initial` à `0057_sets`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que les migrations ont écrit**, en lecture seule : aucune boîte, aucun poids de modèle, aucun pays d'entrepôt, aucun complément ni aucune unité sur une commande, aucun set ni aucune sortie d'un set.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from boxes), (select count(*) from models where box_id is not null or packed_weight_g is not null), (select count(*) from stock_location_countries), (select count(*) from addon_items), (select count(*) from order_addon_items), (select count(*) from sets), (select count(*) from drops where set_id is not null)"'
```

Sortie attendue : `0|0|0|0|0|0|0`.

**Les pages nouvelles de la console, vides** (sur ton ordinateur, en ADMIN) :

- `Orders` → `Settings`, section `Boxes` : « No box yet. Add your boxes: each model is then given its box. » ; section `Locations`, la colonne `Serves` lit `—` sur chaque entrepôt.
- `Catalogue`, section `Add-ons` : « No add-on yet. » ; section `Sets` : « No set yet: group 2 to 4 models sold at one price. »
- `Logistics` → `Stock`, section `Add-ons` : « No add-on yet: list one in Catalogue → Add-ons. » ; les tailles de tes modèles gardent leurs chiffres d'avant (`On hand`, `Reserved`), lus désormais par la vue `stock_holds`.
- `Orders` → `Returns` s'ouvre sur `Last 12 months`.

**Le serveur, après** (les six mêmes qu'au §1.1, à comparer) :

```bash
free -h
```

```bash
docker stats --no-stream
```

```bash
uptime
```

```bash
nproc
```

```bash
df -h /
```

```bash
du -sh /var/backups/orbes
```

**Depuis ton Mac** (dans le Terminal, pas sur le serveur) :

```bash
curl -s https://verify.theorbes.com/api/v1/health
```

Sortie attendue : `{"ok":true,"version":"0.1.0"}`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/verify/pieces
```

Sortie attendue : `200`.

**Préviens le responsable de l'hôte** : « MACRO M3 fait à <heure> Paris (<heure> UTC), 4 migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN ; dans l'application, avec ton compte de collectionneur (le compte d'essai de la maison), sur ton téléphone (Safari) puis sur ton ordinateur. Chaque contrôle laisse soit une vraie donnée que tu gardes (une boîte, un poids, un pays, un complément, un set), soit rien.

**1. Une vraie boîte, et une trop petite refusée.**

1. `Orders` → `Settings` → `Boxes` → `New box` : une de tes vraies boîtes, `Name` tel que l'équipe le dit, `Inside length (mm)`, `Inside width (mm)`, `Inside height (mm)` mesurés à l'intérieur, `Empty weight (g)` (la boîte avec son couvercle et son calage), `Cost` et `Currency` si tu veux. Sous les côtés : « Inside, it must take the 95 × 62 mm certificate card flat. » `Save` : « Box added. »
2. **Une boîte trop petite** : `New box` encore, `Name` `TEST`, intérieur 90 × 60 × 30 mm, `Empty weight (g)` 20, puis `Save` : la boîte reste ouverte et dit « This box cannot take the 95 × 62 mm certificate card flat. » Rien n'est enregistré : ferme-la.
3. **La boîte d'un modèle.** `Catalogue`, un de tes modèles, sa page : section `Packing`, `Edit` : `Box` ta boîte, `Packed weight (g)` le poids de la pièce emballée avec sa pochette et sa carte, sans la boîte. `Save packing` : « Packing saved. » Dans `Catalogue`, le tableau des modèles lit ta boîte dans la colonne `Box`.
4. **Sur le prochain vrai colis** de ce modèle, dans `Logistics` → `To ship`, la page du colis, `Packing` : `Box` lit ta boîte et « The piece’s box. » ; « The parcel’s weight » lit le poids à vide de la boîte plus le poids emballé. Une fois `Packed`, le bordereau imprime « The parcel », avec `Box` et `Weight`, sans le coût. Sans colis à faire le jour même, garde ce point pour le prochain.

**2. Le rapport des retours.** `Orders` → `Returns` : `Last 12 months`, puis `Model` un de tes modèles et `Show`. Les trois tableaux (`By reason`, `By model`, `By size`) lisent ses retours et ses échanges, sans aucun nom de client ; sans retour ni échange : « No return or exchange in this period. » Quand il y a des chiffres, `Download CSV` enregistre `orbes-returns-<premier jour>-to-<dernier jour>.csv`.

**3. Les pays d'un entrepôt, puis une commande fournisseur par taille, jetée ensuite.**

1. **Les pays.** `Orders` → `Settings` → `Locations`, sur ton entrepôt principal : `Edit countries`, `Add a country` : France (et les autres pays qu'il sert), `Save` : « Countries saved. » La colonne `Serves` les lit. Ces pays restent : ce sont tes vraies données.
2. **Avant la commande** : `Supplier orders`, aucune commande ne lit `DRAFT`. S'il y a un brouillon, fais ce point plus tard : `Add to drafts` ajouterait les lignes à ce brouillon, et `Discard the draft` l'effacerait tout entier.
3. **Proposée.** `Supplier orders` → `Order a model` : `Model` un vrai modèle dont chaque taille a son fournisseur, `Pieces` 10, `Locations` toutes cochées, `Propose`. Le tableau lit chaque taille et chaque entrepôt, `Orders`, `Saved sizes`, `Proposed` et `To order` (sans données, la console le dit et répartit également). Aucun nom de client.
4. **Une ligne changée.** Change un `To order` (par exemple +1) : le total lit « 11 of 10 pieces » et « 1 more than the 10 asked. », un avertissement seulement.
5. **Ajoutée.** `Add to drafts` : le panneau « Added to the drafts » nomme chaque brouillon, avec son fournisseur et son entrepôt. Ouvre-en un : ses lignes sont celles de la répartition.
6. **Jetée.** Sur chaque brouillon créé : `Discard the draft`, la boîte dit « The draft is deleted: it never left ORBES. », confirme `Discard the draft` : « Draft discarded. » Rien n'est parti chez un fournisseur.

**4. Un vrai complément, compté, ajouté et retiré sur ta propre commande.** Il te faut une commande de ton compte dans YOUR ORDERS, de préférence RESERVED (pas encore payée), qui n'est ni un cadeau de bienvenue ni un échange de taille, et dont l'emballage n'a pas commencé ; note son entrepôt (`Location` sur sa page dans la console) et sa devise. Sur une commande payée, l'ajout fait une facture et le retrait un avoir, qui restent. Sans commande qui convienne, crée le complément (points 1 et 2) et garde la suite pour ta prochaine commande.

1. **Créé.** `Catalogue` → `Add-ons` → `New add-on` : un de tes vrais compléments, `Name` tel que le client le lit (par exemple POLISHING CLOTH), `Line`, `SKU code` (il ne change plus), `Supplier`, `Weight`, `Price in EUR` (et les autres devises où tu le vends). `Add` : « Add-on added. »
2. **Compté.** `Logistics` → `Stock`, section `Add-ons`, sa ligne à l'entrepôt de ta commande : `Correct`, « Correct the count », `Pieces` 1, `Why` le compte réel, `Correct` : « Count corrected. » Une seule unité, posée sur ton étagère.
3. **Ajouté sur ton téléphone.** MY PIECES → ORDERS, ta commande : ADD AN ADD-ON ouvre la feuille, ton complément avec son prix, `+` jusqu'à 1, TOTAL, puis ADD. La commande lit ADD-ONS avec ton complément, REMOVE à côté, et son TOTAL le compte.
4. **Dans la console**, la page de la commande, section `Add-ons` : ton complément, `HELD`, ajouté par « The collector, in YOUR ORDERS », à l'heure de Paris.
5. **Sur ton ordinateur**, connecté au même compte : MY PIECES → ORDERS, la page de ta commande, ADD-ONS avec le même complément. **En mode clair, une fois** : YOUR ACCOUNT, LIGHT MODE (sous SOUND), allumé ; la même page se lit sur le fond clair (éteins LIGHT MODE ensuite si tu préfères le sombre).
6. **Retiré sur ton ordinateur** : REMOVE, puis CLICK AGAIN TO REMOVE. Le complément disparaît de la commande et du TOTAL. Dans la console, la section `Add-ons` de la commande lit `REMOVED`, et `Logistics` → `Stock` rend l'unité disponible. Le complément et son unité restent : ce sont tes vraies données.

**5. Un set, et un tirage de ce set en brouillon, annulé, jamais publié.**

1. **Le set.** `Catalogue` → `Sets` → `New set` : `Name`, `Code`, `Piece 1` et `Piece 2` deux de tes vrais modèles (chacun avec ses tailles déclarées), `Price` et `Currency` si tu veux. `Add` : « Set added. » Ce set reste : ses pièces ne changent plus dès qu'une sortie le nomme (son nom, son code et son prix, si). Tant qu'aucune vraie sortie ne le vend, personne ne le voit.
2. **Le tirage, en brouillon.** `Club`, section `Drops` → `New release` : `What it sells` `A set`, `Set` ton set, `Next`. Dans la seconde boîte, `Title` `HOUSE CHECK`, et une pièce dans une taille pour chaque pièce : la boîte lit « Sets on sale: 1 ». `Create release` : « Release created as a draft. »
3. **Lu dans la console** : la page du brouillon, `DRAFT`, le set et ses pièces, `Sets` 1, chaque taille nommée par sa pièce (« <PIÈCE> · <TAILLE> »). **N'appuie jamais sur `Publish`** : le brouillon ne se voit nulle part dans l'application.
4. **Annulé.** `Cancel` : la boîte « Cancel the release » dit « The draft never shows. No entry is taken any more, and no draw can be run. » ; tape la phrase qu'elle demande (`CANCEL` et les 8 premiers caractères de la sortie), puis `Cancel release` : « Release cancelled. » Sur le serveur, en lecture seule :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where set_id is not null and (published_at is not null or cancelled_at is null)"'
```

Sortie attendue : `0` : la sortie du set n'a jamais été publiée, et elle est annulée.

Les écrans d'un set côté collectionneur (THE RELEASES, la page d'un tirage, la salle, YOUR ORDERS avec RETURN THE SET, 1 SET PER PERSON) sont ceux des captures du §1.1, vérifiés par la CI : aucun test n'apparaît dans THE RELEASES ni dans PAST.

**6. Les pages légales.** Sur ton téléphone, PRIVACY et TERMS au pied de page : « Version of 23 October 2026 » sous le titre ; dans les conditions, article 14, les paragraphes « Add-ons. » et « THE SET. ».

### 1.8 Ensuite : tes données

Rien n'est prérempli (règle 12). Dans cet ordre, quand tu veux :

1. **Tes boîtes** : `Orders` → `Settings` → `Boxes`, chacune de tes vraies boîtes (un ADMIN).
2. **Chaque modèle, sa boîte et son poids emballé** : sa page, `Packing` (un OPERATOR). Une variante prend ceux de son modèle principal tant qu'elle n'a pas les siens. Un modèle sans boîte ni poids ne bloque jamais l'emballage : la page du colis dit ce qui manque.
3. **Les pays de chaque entrepôt** : `Orders` → `Settings` → `Locations`, `Edit countries` (un ADMIN). Un pays qu'aucun entrepôt ne sert compte à l'entrepôt par défaut.
4. **Tes compléments** : `Catalogue` → `Add-ons`, chacun avec son prix dans chaque devise où tu le vends, son fournisseur et son poids ; son minimum par entrepôt dans `Logistics` → `Stock`, section `Add-ons` ; son stock par une réception ou une correction. Un complément n'est proposé aux collectionneurs que s'il a un prix dans la devise de la commande et une unité en stock à son entrepôt.
5. **Les identifiants Shopify** des compléments et des sets, plus tard, le jour de la boutique (`Shopify` sur leur ligne).
6. **La première sortie d'un set** : quand tu le choisis, par `New release` ou `New live release`, `A set`.
7. **Préviens ORBES Client Services et ton prestataire logistique** que c'est en place, si ce n'est pas déjà fait (§1.1).
8. **Les anciennes images (facultatif).** Une fois MACRO M3 stable, `<TAG_M2>` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_M3>`), la liste d'abord :

   ```bash
   docker images orbes-genome
   ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **Les choix par défaut** de tes décisions et du plan, que tu peux changer : les boîtes dans `Orders` → `Settings`, écrites par un ADMIN ; une boîte qui ne prend pas la carte à plat est refusée ; le poids emballé est la pièce avec sa pochette et sa carte, sans la boîte, et un colis de plusieurs pièces propose la plus grande de leurs boîtes ; le pays d'un collectionneur est celui de son adresse par défaut, sinon celui de son profil ; « ce genre de pièce » est le même type de taille (une bague pour une bague), chaque collectionneur compté une fois, les commandes et les tailles enregistrées pesant autant, les collectionneurs de test comptés ; RUNS SMALL / RUNS LARGE à partir de 3 échanges dans la période, dont deux tiers dans un sens, sur les 12 derniers mois, les commandes de test à part ; un complément n'est proposé qu'en stock réel, au plus 3 de chaque, et un complément épuisé est laissé de côté sans retenir la vente ; il se retire jusqu'au début de l'emballage, par un avoir après le paiement ; sur une place tenue d'un tirage et dans le salon, il est ajouté quand ORBES Client Services confirme ou accepte ; le prix d'un set est partagé sur les factures de ses pièces selon leurs prix de base, sinon également ; un set est annulé en entier, et son retour se décide une fois toutes les pièces reçues ; un set n'a pas de photo à lui ; compléments et sets pourront se vendre aussi sur la future boutique Shopify, chacun un produit (S2).
2. **L'avocat** : les conditions des compléments et de THE SET, et la nouvelle finalité des tailles enregistrées, partent avec la version `2026-10-23` (la note au juriste, points 35 à 37). Sa réponse ne retient pas le déploiement.
3. **Les limites connues** : sur un ordinateur de 1024 × 768, la salle d'un set de trois pièces, ou une réservation avec quatre compléments, dépasse la fenêtre, et la page défile jusqu'au bouton ; le tableau de la boutique d'une LIVE RELEASE d'un set montre le sceau, pas les photos de ses pièces ; les phrases du radar de la demande et de la prévision de rupture nomment une taille d'un set par son libellé seul (les tableaux de la console la nomment par sa pièce) ; dans la console, l'acceptation d'une demande du salon liste les compléments choisis sans leur prix.
