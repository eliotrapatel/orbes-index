# Mise en production de LIVE RELEASE+ (déploiement E)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

LIVE RELEASE+ (plan du 2026-10-04 : les commandes, le stock et l'atelier, les factures, la salle d'après, la surprise, l'accès par la participation et par segment, l'onglet PAST, la question d'après, le meilleur moment pour ouvrir, les exports pour Shopify) part en production en **un seul déploiement**, E, après le déploiement D de la LIVE RELEASE ([son runbook](DEPLOY-LIVE-RELEASE.md)).

| Déploiement | Élément | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| E | LIVE RELEASE+ : les commandes de chaque canal, le stock, l'atelier, les factures ; la salle d'après, la surprise, la participation, les segments, PAST, la question d'après | `0022` et `0023` | aucun | **À faire** |

Le point de départ : la production tourne le commit `86bd579e4aa96b74b86f74c0b892da51026cdf12` (image `orbes-genome:86bd579e4aa9`) depuis le 2026-10-05 à 02:13 UTC, le déploiement D, avec les vingt et une migrations `0001` à `0021` ([le runbook précédent](DEPLOY-LIVE-RELEASE.md)). Si un autre déploiement a eu lieu depuis, ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Jamais entre 03:00 et 05:30 UTC** : c'est l'heure des sauvegardes de nuit du serveur partagé (05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite).
2. **Rien ne change sur l'hôte** : ni Caddy, ni un port, ni une variable. Le responsable de l'hôte partagé (ta session de coordination du serveur, « AI Stack Atlas planning ») reçoit le pré-contrôle et donne son accord pour l'heure (§1.1).
3. **Jamais `restore.sh` sur ce serveur** (ta décision du 2026-10-03 ; `.env` dit `RESTORE_ALLOWED=false`). Après les migrations, on ne revient pas en arrière : on **répare en avant** (§1.5).
4. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
5. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche locale `orbes-plus` fusionnée dans `claude/orbes-genome-code-system-o8bmnk` (avec les correctifs faits sur la branche depuis D), sa CI verte.
6. **Les pages légales** portent une seule nouvelle version pour le déploiement E, `2026-10-07`, la date qui suit celle de D ; le jour du déploiement n'en dépend pas.
7. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche. Le claim code qu'affiche l'atelier pendant l'essai (§1.7) n'est noté nulle part : la pièce d'essai finit aux archives.
8. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
9. **Les premières vraies commandes** attendent les vérifications du §1.7. Une sortie finie paraît ensuite pour toujours dans l'onglet PAST, publiquement, avec son titre et la photographie de son modèle, y compris une sortie d'essai : la sortie d'essai de D si elle s'est tenue, et celle du §1.7.

---

## 1. Déploiement E

### 1.0 Ce qui change

- **Les commandes**, de chaque canal : une pièce confirmée avec PAY dans une LIVE RELEASE, une place d'une sortie tirée dont ORBES Client Services confirme la vente, une demande du salon privé fermée comme acceptée (`Outcome`) deviennent chacune une commande, suivie étape par étape (RESERVED, PAID, SHIPPED, DELIVERED, CANCELLED, RETURNED). Dans la console : la page `Orders` (Clients) remplace la liste `Client Services` des LIVE RELEASES ; `Atelier` (Registry) tient le stock par lieu, les pièces à fabriquer et leurs fiches de travail ; `Invoices` (Clients) les factures et les avoirs de CONGLOMERAT LLC, sans TVA ; `Settings` les lieux, les transporteurs et les retards. Côté client : `YOUR ORDERS` dans MY PIECES, avec les étapes, le suivi et les documents.
- **Les sorties et les collectionneurs** : la salle d'après d'une LIVE RELEASE épuisée, la surprise dans chaque boîte, l'accès par la participation et par segment (`Segments`, Clients), les onglets `LIVE` et `PAST` de THE RELEASES, la question d'après, le meilleur moment pour ouvrir, la vérification du stock à la publication, la fiche client, le prix de base et le guide d'entretien du Catalogue, les exports pour Shopify (des fichiers seulement : le service n'appelle pas Shopify).
- **Les migrations**, appliquées dans **une seule transaction** : si elles échouent, rien n'est appliqué et le site revient tout seul sur `86bd579e4aa9`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0022_orders_stock` | Les commandes et le stock | les lieux, les références (SKU), le registre des mouvements de stock, les seuils, les transporteurs, les commandes et leur historique, les pièces à fabriquer, les retours, les factures, le journal des changements, les délais des retards ; le statut RESERVED d'une identité réservée ; l'issue d'une demande du salon, le prix de base et le guide d'entretien d'un modèle, le lieu d'une sortie |
  | `0023_releases_collectors` | Les sorties et les collectionneurs | sur les LIVE RELEASES : la salle d'après, la surprise, la participation, le segment, ET ou OU, la question d'après ; les invités d'une salle d'après, les réponses, les segments (aussi pour une publication du cercle), l'activité par heure |

  Elles ne cassent pas l'image `86bd579e4aa9` pendant le déploiement (des colonnes nullables qu'elle ne nomme pas, des tables qu'elle ignore), mais une fois appliquées on ne revient plus en arrière (ci-dessous).

- **Au premier démarrage**, l'application crée les lieux `FRANCE WAREHOUSE` (le lieu par défaut) et `LOGISTICS WAREHOUSE`, et les transporteurs Colissimo, Chronopost, DHL Express et UPS ; elle relie les pièces et les tailles existantes à leurs références, et crée les commandes des ventes déjà confirmées (une réservation conclue devient PAID, une annulée CANCELLED). Rien à faire : une ligne du journal de l'application le dit (§1.6).
- **Caddy, les variables** : rien ne change. Aucune variable à poser ; aucun nouvel envoi de photo.
- **Les pages légales** : une seule nouvelle version, `2026-10-07` (règle 6) : les conditions d'utilisation (un nouvel article 14, les commandes ; le cercle devient l'article 15 et les suivants avancent d'un rang ; les articles 1, 2, 3, 7, 10, 12, 13, 15, 16 et 17) et la politique de confidentialité (« Your orders », « Segments, the client sheet and activity », et les sections qu'elles touchent).
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `86bd579e4aa9` ne peut plus tourner sur ce schéma. `deploy.sh --image 86bd579e4aa9` la refuse.

Dans la suite, `<SHA_E>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_E>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : le commit, l'heure, le pré-contrôle, l'accord

**1. Le commit et sa CI (sur ton Mac).** Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_E>`, avec une coche verte. Sinon, n'avance pas.

**2. Connecte-toi au serveur** en SSH, comme d'habitude, puis :

```bash
sudo -iu orbes
```

```bash
cd /opt/orbes/orbes-index/deploy/vps
```

```bash
umask 022
```

`umask 022` rend lisibles par les conteneurs les fichiers que git et les scripts vont créer. Il ne s'affiche rien.

**3. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 03:00–05:30 UTC.

**4. Le pré-contrôle.** Note les quatre résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

```bash
free -h
```

```bash
docker stats --no-stream
```

```bash
df -h /
```

```bash
du -sh /var/backups/orbes
```

À regarder : `Use%` de `df -h /` **sous 75 %** (au-dessus, ne déploie pas : préviens le responsable de l'hôte), de la mémoire disponible, aucun conteneur à plein CPU en continu.

**5. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

```bash
pgrep -a pg_dump
```

Sortie attendue : **rien**. Une ligne `<numéro> pg_dump …` : une sauvegarde tourne, attends qu'elle finisse et relance la commande.

**6. L'accord pour l'heure.** Envoie au responsable de l'hôte, par exemple : « Déploiement E d'ORBES (LIVE RELEASE+) à <heure> UTC : deux migrations en une transaction, aucun changement de l'hôte (ni Caddy, ni port, ni variable), une coupure courte d'ORBES. Pré-contrôle : <les quatre résultats>. » Attends son accord.

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

Sortie attendue : `86bd579e4aa96b74b86f74c0b892da51026cdf12 LIVE: a turn the engine has already marked MISSED answers LIVE_TURN_PASSED to a late PRESS or SECURE, never LIVE_NOT_YOUR_TURN` (le commit du déploiement D).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=86bd579e4aa9`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

**4. `RESTORE_ALLOWED=false`** :

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`.

### 1.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_E>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude (règle 5).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 86bd579..<7 caractères>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_E>`.

**Rien de la pile du serveur n'a changé** depuis le déploiement D :

```bash
git -C /opt/orbes/orbes-index diff --stat 86bd579e4aa96b74b86f74c0b892da51026cdf12 HEAD -- deploy/vps
```

Sortie attendue : **rien**. Un fichier de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales** (règle 6) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-07';`.

**Deux lectures sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue, exactement ces vingt et une lignes :

```text
0001_initial
0002_platform_guards
0003_authentication_events_default
0004_scan_reports
0005_account_recovery
0006_admin_password_change_required
0007_print_batch_indexes
0008_retail_mode
0009_scan_daily_stats
0010_models_active
0011_scan_token_transfer_accept
0012_media
0013_ownership_certificates
0014_model_lookbook
0015_drops
0016_circle
0017_drop_early_access
0018_club_tiers
0019_model_discontinued
0020_private_salon
0021_live_release
```

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_photo_usage'
```

Sortie attendue : deux nombres, celui des photos et leur taille en octets. Note-les.

### 1.4 Déployer

Le lancement est gardé : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_E> (tag <TAG_E>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_E>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 86bd579e4aa9
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : rien n'est changé, le site tourne toujours sur `86bd579e4aa9`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 21 migration(s) applied, all known to orbes-genome:<TAG_E>
   ```

   **Il faut lire `21 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `86bd579e4aa9`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_E>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_E>.tar.age
   ```

   **Note le nom de l'archive** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur.

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_E>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_E>
   Applied 2 migration(s): 0022_orders_stock, 0023_releases_collectors
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`). Caddy n'est pas recréé cette fois : sa configuration n'a pas changé.

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
   … [deploy.sh] deployed orbes-genome:<TAG_E> (previous: 86bd579e4aa9). This release applied the migration(s) 0022_orders_stock, 0023_releases_collectors:
   … [deploy.sh] orbes-genome:86bd579e4aa9 cannot run on this schema any more (scripts/deploy.sh --image 86bd579e4aa9 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_E> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   **Les deux migrations du tableau du §1.0 doivent y être nommées.** Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `86bd579e4aa9`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:86bd579e4aa9` et `rolled back to 86bd579e4aa9; the stack is healthy` | Les migrations n'ont pas été appliquées (une seule transaction), et le site est revenu tout seul sur `86bd579e4aa9`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 86bd579e4aa9 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_E> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `86bd579e4aa9`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_E>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 86bd579e4aa9`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_E> OK (previous 86bd579e4aa9; migrations 0022_orders_stock, 0023_releases_collectors)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 23 lignes `applied`, de `0001_initial` à `0023_releases_collectors`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'stock and orders ready'
```

Sortie attendue : `1` : au premier démarrage, l'application a créé les deux lieux et les quatre transporteurs, relié les références et créé les commandes des ventes déjà confirmées (§1.0). `0` : colle à Claude la sortie de `docker compose logs --tail 200 app`. Le déploiement recrée le conteneur `app` : ses journaux ne portent que sur cette version.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/backup.sh --dry-run
```

Sortie attendue : `… [backup.sh] photos: <nombre>, <taille> MB`, les mêmes qu'au §1.3, puis deux lignes `[dry-run] would …`.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Le disque, après :**

```bash
free -h
```

```bash
docker stats --no-stream
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
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/api/v1/releases/past
```

Sortie attendue : `200` (l'onglet PAST, public).

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/api/v1/account/orders
```

Sortie attendue : `401` : les commandes ne se lisent que connecté, chacun les siennes.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/api/admin/orders
```

Sortie attendue : `401` : la page `Orders` de la console demande une session du personnel.

**Préviens le responsable de l'hôte** : « Déploiement E d'ORBES fait à <heure> UTC, rien de l'hôte n'a changé, tout est healthy. Avant / après : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Un **essai complet**, avant toute vraie commande. Il te faut : l'ordinateur pour la console ; deux téléphones, A et B, dont le navigateur **n'est pas connecté à la console** (une fenêtre de navigation privée suffit), chacun connecté à un compte ORBES qui détient une pièce d'un même modèle d'essai (ceux de l'essai de D conviennent) ; et un troisième compte ORBES, sans pièce de ce modèle. La sortie d'essai est visible **de tous** dans THE RELEASES et la bannière pendant une heure et demie environ, avec `FOR SELECTED COLLECTORS` ; seuls les membres du segment d'essai peuvent y entrer ; puis **pour toujours dans PAST** (règle 9) : fais-la avant d'annoncer le service, ou à une heure creuse. Elle consomme le numéro de série d'une pièce d'essai, archivée à la fin.

**La préparation, dans la console :**

1. `Catalogue` → le modèle d'essai → `Edit` : `Base price` `1` (en `EUR`), `Care guide` `Test`.
2. `Segments` → `New segment` : le nom `TEST LIVE+`, une règle sur `Models`, le modèle d'essai ; `Create segment`.
3. `Club` → onglet `Drops` → `New live release` : le modèle d'essai, le titre `TEST LIVE+`, `Opening (UTC)` dans 30 minutes, `End of the sales (UTC)` une heure après, `Price of a piece` `1`, `Currency` `EUR`, `Stock location` `LOGISTICS WAREHOUSE` (vide au premier démarrage : la pièce sera à fabriquer) ; note les tailles que le dialogue propose dans `Sizes`, puis remplace-les par une ligne `52 = 1`.
4. Sur la page de la sortie : `Access` → `Edit` : `Segment` `TEST LIVE+`, aucun palier ni modèle ; `Surprise` → `Edit` : `A surprise in every box`, `What it is (internal)` `Test` ; `After-room` → `Edit` : `An after-room after a sell-out`, le modèle d'essai, `Price of a piece` `1`, `Sizes` `52 = 1`, `Opens (minutes after the sell-out)` `1`, `Open (minutes)` `5` ; la question d'après reste celle par défaut ; puis `Publish the release`, sans publication dans le cercle.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| Les lieux, les transporteurs, les retards (choix 16, 17, 19) | Console | `Orders` → `Settings` | `FRANCE WAREHOUSE` (`DEFAULT`) et `LOGISTICS WAREHOUSE` ; Colissimo, Chronopost, DHL Express et UPS, chacun `OFFERED` avec son `Tracking link` ; `Order alerts` : 2, 3, 10 et 30 jours |
| Le prix de base, le guide d'entretien, l'export des modèles (choix 21, 24) | Console | `Catalogue` ; puis `Shopify export`, en `EUR` | La colonne `Price · Shopify` : `€ 1` et `NOT LINKED` pour le modèle d'essai ; un fichier CSV où il est un brouillon (`draft`), ses tailles en variantes, au prix `1.00` |
| Les segments (choix 27) | Console | `Segments` → `TEST LIVE+` ; puis son CSV | `Collectors now` : les comptes qui détiennent une pièce du modèle d'essai, ceux de A et B compris ; le fichier de leurs adresses e-mail |
| La proposition des tailles (choix 13) | Console | Le dialogue `New live release` (préparation, point 3) | `Sizes` est rempli d'avance, depuis le stock, puis la demande du planificateur |
| Le meilleur moment pour ouvrir (choix 10) | Console | La page de la sortie, avant l'annonce ; puis `Analytics` | `Best time to open` : l'activité par heure (heure de Paris), l'heure suggérée et sa part, l'heure de la sortie ; le même panneau dans `Analytics`, par palier et par pays |
| La vérification du stock (choix 12) | Console | `Publish the release` (préparation, point 4) | Le dialogue montre `Stock` : *2 pieces on sale would be made to order once sold (LOGISTICS WAREHOUSE).* (la sortie et sa salle d'après), et publie quand même |
| L'accès par segment (choix 27, décision 32) | Téléphone A ; puis le troisième compte | `THE RELEASES`, puis la page de la sortie | Sur A : la carte `FOR SELECTED COLLECTORS`, jamais le nom du segment ; le troisième compte, connecté, lit *This release is for selected collectors.* et ne peut pas entrer |
| La surprise (choix 3) | Téléphone A | La page de la sortie | `A SURPRISE IN EVERY BOX`, jamais ce qu'elle est |
| La vente et la commande (choix 6) | Téléphones A et B | `ENTER THE ROOM` sur les deux, taille `52` ; à T0, le premier de la file tient le sceau puis `PAY · € 1` | Sur celui-ci, la page ivoire et sa référence `LR-…` ; puis `MY PIECES` → `YOUR ORDERS` : la commande `RESERVED`, `SIZE` 52, `PRICE`, `TOTAL` et sa référence `OR-…`. Sur l'autre : `SOLD OUT` |
| La salle d'après (choix 2) | Le téléphone resté dans la file | Attendre 1 minute ; `ENTER THE AFTER-ROOM`, la taille `52` ; à son tour, **ne pas** tenir le sceau | `THE AFTER-ROOM` et `A SECOND DOOR` ; la file de la salle d'après, sa place gardée ; le tour passe ; 5 minutes après son ouverture : `THE AFTER-ROOM IS CLOSED` |
| Personne d'autre ne la voit (décision 28) | Le troisième compte, puis le téléphone qui a payé | L'adresse de la salle d'après, `/verify/releases/<ID>/after-room` (`<ID>` dans l'adresse de la page de la sortie) | Renvoyés à la page de la sortie ; la salle d'après n'est ni dans `THE RELEASES` ni dans la bannière |
| La question d'après (choix 11) | Le téléphone de la salle d'après ; puis la console | La page de la sortie, la salle d'après fermée : `ANOTHER SIZE`, puis `ANOTHER FINISH` ; puis la page de la sortie dans la console | `ONE QUESTION` et *WHAT WOULD YOU HAVE WANTED?* ; la réponse se change d'un geste ; dans la console, `Question after` : 1 réponse, `ANOTHER FINISH` |
| PAST (choix 5, décisions 28 à 30) | Téléphone A | `THE RELEASES` → `PAST`, puis la carte | La sortie d'essai en tête, sous le nom de son modèle, avec `YOU SECURED A PIECE`, et *You have taken part in …* en haut ; aucune salle d'après ; sa page : `THIS RELEASE IS OVER`, aucun chiffre de fin |
| Le tableau des commandes (choix 7) | Console | `Orders` | La carte dans `RESERVED` : LIVE, `TEST LIVE+`, le collectionneur, le modèle et la taille 52, `Surprise` ; le filtre `Every release` → `TEST LIVE+` la garde seule |
| La pièce à fabriquer et sa fiche (choix 8, 15) | Console | `Atelier` → `Print work sheets` | La pièce `TO MAKE` pour la commande, à `LOGISTICS WAREHOUSE` ; une fiche par pièce : sa référence, son ORBES CODE, la taille 52, la surprise `Test` ; tant que la pièce n'est pas émise, ce code scanné répond comme un code inconnu |
| L'acheteur (décision 31) | Console, puis téléphone A | La page de la commande : `The buyer` → `Edit`, `Name` `Test`, `Address` `Test` | `Buyer saved.` ; l'historique dit que l'acheteur est saisi, sans ses mots ; MY PIECES ne le montre pas |
| PAID et la facture (choix 22) | Console, puis téléphone A | `Mark paid` | `Order paid.` ; dans `Documents`, `INV-2026-…` et son `PDF` : CONGLOMERAT LLC, l'acheteur `Test`, aucune TVA ; sur A, `PAID` et, sous `DOCUMENTS`, `INVOICE` et `CARE GUIDE` (`Test`) |
| L'atelier émet la pièce (choix 8, 15) | Console | `Atelier` → la pièce : `Start`, puis `Done` (`Material`, `Production batch`, `Production date`) et `Issue the piece` | `Piece issued.` et `Its claim code`, montré une fois (ne le note pas, règle 7) ; la commande tient la pièce, en stock à `LOGISTICS WAREHOUSE` |
| Le bordereau (choix 18) | Console | La page de la commande : `Packing slip` → `Print` | La pièce, la taille 52, la surprise `Test`, aucun prix ni valeur déclarée |
| L'expédition et le suivi (choix 6, 17) | Console, puis téléphone A | `Ship` : `Carrier` Colissimo, `Tracking number` `TEST 0001`, `Declared value` `1` | `Order shipped.` ; sur A : `SHIPPED`, `CARRIER`, `TRACKING NUMBER` et `TRACK THE SHIPMENT`, qui ouvre la page de Colissimo (qui ne connaît pas ce numéro : c'est attendu) |
| La livraison (choix 6) | Console, puis téléphone A | `Mark delivered` | `Order delivered.` ; sur A, `DELIVERED` et sa date |
| Le retour et l'avoir (choix 20, 22) | Console, puis téléphone A | `Open a return` : `The piece goes` aux archives, `Note` `Test`, la phrase `ARCHIVE`, puis `Open the return` | `Order returned.` ; `CN-2026-…` dans `Documents` ; la pièce archivée ; sur A, `RETURNED` et `CREDIT NOTE` |
| Les factures (choix 22) | Console | `Invoices` | Le mois : la facture et l'avoir de l'essai, `Totals of the month` (net : 0) ; `Download the month (CSV)` |
| La fiche client (choix 26) | Console | `Owners` → le compte de A | Sa commande et ses étapes, la sortie d'essai et la pièce obtenue, son palier, le segment `TEST LIVE+` |
| L'export des commandes (choix 25) | Console | `Orders` → `Shopify export`, `First day` et `Last day` : aujourd'hui | Un fichier CSV : la commande d'essai, ses étapes, l'acheteur `Test` et l'e-mail du compte |
| Le seuil et sa suggestion (choix 14) | Console | `Atelier` → `Set a minimum` : le modèle d'essai en 52, `LOGISTICS WAREHOUSE`, `Minimum` `1` ; puis le même dialogue, `Minimum` vide | `Suggested` : 1, sans rien confirmer ; le minimum vidé, la suggestion disparaît |

Restent hors de l'essai, couverts par les tests : l'annulation d'une commande (la pièce à fabriquer annulée, son identité retirée), le retour au stock (un nouveau claim code), la livraison posée par l'enregistrement de l'acheteur et le certificat de propriété qui suit, l'accès par la participation, la publication du cercle pour un segment (elle atteindrait de vrais membres), les identifiants Shopify collés en retour, la question posée dans MY PIECES (`AFTER THE RELEASES`) et le marquage des retards (il faut des jours). Les tests : `genome/test/services/orders.test.ts`, `genome/test/services/returns.test.ts`, `genome/test/services/live-access.test.ts`, `genome/test/services/question.test.ts`, `genome/test/services/shopify.test.ts`, `genome/test/services/fulfilment.test.ts`, `genome/test/web/admin.orders.e2e.test.ts` et `genome/test/web/verify.orders.e2e.test.ts`.

**Le nettoyage, dans la console** : `Catalogue` → le modèle d'essai → `Edit` : `Base price` et `Care guide` vides. Le segment `TEST LIVE+` reste (la sortie d'essai l'emploie : un segment employé ne se supprime pas). La sortie d'essai reste dans la base et dans PAST (règle 9) ; sa commande est close `RETURNED`, sa facture et son avoir restent, comme toute pièce comptable.

### 1.8 Ensuite

- **Les vraies commandes** : chaque vente confirmée paraît dans `Orders` ; ORBES Client Services saisit l'acheteur, marque PAID au paiement reçu hors du service (la facture part alors), l'atelier fabrique et émet la pièce, puis l'expédition. Avant d'expédier, active la garantie de la pièce (`Warranties`), comme pour toute vente ([SALES-PLAYBOOK](SALES-PLAYBOOK.md)) : sans elle, son acheteur ne peut pas l'enregistrer, et la commande ne passe pas DELIVERED d'elle-même. Les retards ressortent dans `Orders` selon les délais des `Settings`.
- **Les anciennes images (facultatif).** Une fois le déploiement E stable, les images antérieures à `86bd579e4aa9` ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_E>` ni `86bd579e4aa9`) ; la liste d'abord :

  ```bash
  docker images orbes-genome
  ```
