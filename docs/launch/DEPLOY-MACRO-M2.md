# Mise en production du lot MACRO M2

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot M2 de tes décisions du 2026-10-20 (les messages de la maison dans MESSAGES, WORN, la galerie des propriétaires) part en production en **un seul déploiement**, après celui de MACRO M1 ([son runbook](DEPLOY-MACRO-M1.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| MACRO M2 | Les messages de la maison, FROM ORBES dans MESSAGES, en lecture seule : six moments, chacun son interrupteur et ses mots, tous coupés ; les messages écrits par l'équipe à un segment ou à un palier, envoyés tout de suite ou programmés (M1 à M4) ; WORN, la photo d'une pièce portée, envoyée depuis la pièce, lue par l'équipe, montrée à tous au pied de la fiche du modèle, retirable à tout moment (G1 à G5) | `0052_house_messages`, `0053_worn` | `Caddyfile` : le chemin d'envoi de WORN passe à 1200KB | **À faire** (§1) |

Le point de départ : la production tourne MACRO M1, son commit `<SHA_M1>` (image `orbes-genome:<TAG_M1>`), avec les 52 migrations de `0001_initial` à `0051_emails`. La branche du lot, `orbes-macro`, contient ce commit. Avant le jour, Claude remplace dans ce document `<SHA_M1>` et `<TAG_M1>` par le commit de M1 en production, et `<SHA_M2>` et `<TAG_M2>` par le commit final de M2 (40 caractères) et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `<TAG_M1>` (un correctif après M1), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les écrans d'abord.** Avant la fusion, tu regardes les captures que te donne le rapport de Claude (§1.1) et tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` limité au Caddyfile du §1.3 et vu avec le responsable de l'hôte (règle 4), le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Un seul changement de l'hôte : le Caddyfile d'ORBES**, dans le seul bloc de `verify.theorbes.com`. Le chemin d'envoi de la photo de WORN (`POST /api/v1/account/products/<pièce>/worn`, l'image elle-même, 1 Mo au plus dans l'application) rejoint les envois de photos de la console, à 1200KB ; tout le reste garde ses 64KB. Ni port, ni variable, ni certificat, ni `compose.yaml`, ni réseau, ni autre site ne change ; ton `.env` non plus. `deploy.sh` valide la configuration avant tout changement, puis recrée Caddy : quelques secondes sans HTTPS pour `verify.theorbes.com`. Comme tout ce qui touche la pile du serveur partagé, **ce changement passe d'abord par le responsable de l'hôte** : tu lui envoies la proposition du §1.1 et tu attends son accord avant de lancer. S'il préfère attendre, Claude retire ce commit du lot et recale ce document : WORN marche sans lui, sauf l'envoi d'une photo de plus de 64 Ko, que Caddy refuserait.
5. **Deux migrations, puis plus de retour en arrière** : après `0052_house_messages` et `0053_worn`, l'image `<TAG_M1>` ne tourne plus sur le schéma (`deploy.sh --image <TAG_M1>` la refuse). En cas de souci, on **répare en avant** (§1.5).
6. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
7. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
8. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-macro` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
9. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
10. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
11. **Les pages légales changent** : la politique de confidentialité (*House messages*, *WORN*) et les conditions (article 15, la licence de WORN, sa revue et son retrait ; aucune phrase sur MESSAGES), dans une seule nouvelle version, `2026-10-22`. Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La relecture par un avocat ne retient jamais le déploiement.
12. **Aucun message de la maison ne part** après ce déploiement : les six moments sont coupés, et aucun message écrit n'existe. Rien ne part jamais par e-mail ni par notification. **WORN ne montre rien** tant que l'équipe n'a rien publié.

---

## 1. Le déploiement

### 1.0 Ce qui change

**Pour les collectionneurs (/verify, sur un téléphone et sur un ordinateur, en mode sombre et en mode clair)**

- **FROM ORBES dans MESSAGES.** Les messages qu'ORBES écrit arrivent dans MESSAGES, en lecture seule : sur un téléphone, deux onglets, ORBES CLIENT SERVICES (la conversation de toujours) et FROM ORBES, chacun avec NEW tant qu'il a du non-lu ; sur un ordinateur, FROM ORBES est un sujet de la page des messages, avec WRITE TO ORBES CLIENT SERVICES à la place de la réponse. Sous la liste : « Messages from ORBES cannot be answered. » NOW dit « A new message from ORBES. » tant qu'un message est non lu et qu'aucune réponse ne l'est. Les onglets n'apparaissent qu'au premier message : jusque-là, MESSAGES reste exactement comme aujourd'hui.
- **WORN depuis la pièce.** Dans MY PIECES, onglet OWNERSHIP d'une pièce, après OWNERSHIP CERTIFICATE, le bloc WORN : CHOOSE A PHOTOGRAPH (sur un ordinateur, la photo peut aussi se déposer dans le cadre), l'aperçu avec la signature, prénom et pays (« CAMILLE · FRANCE »), SHOW MY INSTAGRAM, I AGREE, SEND ; puis IN REVIEW, PUBLISHED avec SEE IT ON THE SHEET, ou NOT PUBLISHED avec sa raison ; WITHDRAW à tout moment. Pas de bloc sans fiche publiée du modèle, sur une pièce qui n'est plus détenue, ni pour un compte de test.
- **WORN sur la fiche du modèle**, pour tout le monde, connecté ou non : après PAIRS WELL WITH, les photos publiées de toutes les variantes du modèle, chacune signée du prénom et du pays (et du nom Instagram s'il est choisi), jamais d'une variante ; deux colonnes sur un téléphone (6, puis SHOW MORE), quatre sur un ordinateur (8). La section n'existe pas tant qu'aucune photo n'est publiée.
- **Les pages légales** : la nouvelle version, `2026-10-22` (règle 11).

**Pour le personnel (la console)**

- **`House messages`** (groupe Clients, sous `Messages`) : l'onglet `Moments`, les six moments, chacun `OFF`, ses mots, son aperçu et ses chiffres, `Switch on` pour un ADMIN, `Edit the words` pour un OPERATOR ; l'onglet `Messages`, `New message` (un titre, les mots, une audience : `A segment` ou `A tier`, ce palier et ceux au-dessus, la portée lue en direct, l'aperçu tel que le collectionneur le lit, en sombre et en clair, au format téléphone et ordinateur), puis `Send…` : `Send now` ou `Schedule` à l'heure de Paris, en tapant SEND (ADMIN). Chaque message envoyé dit combien de personnes il a atteintes (`Reached`) et combien l'ont lu (`Read`), jamais qui. La page `Segments` dit quels messages utilisent un segment.
- **`WORN`** (groupe Clients, sous `House messages`), son lien portant le nombre de photos à lire : `To review` (la plus ancienne d'abord : la photo, la signature telle qu'elle se lira, la pièce, le modèle, le propriétaire, l'envoi et le consentement à l'heure de Paris, `Publish` ou `Refuse…` avec une des trois raisons) ; `Published` par modèle, avec `Take down…` ; `Ended`, sans photo. La page d'un modèle gagne sa ligne `WORN`.

**Pour le serveur**

- **Les routes nouvelles**, toutes sous `/api` que Caddy sert déjà : les messages de la maison d'un compte et leur lecture ; le WORN d'une pièce, son envoi, son retrait et sa photo pour son propriétaire ; le WORN d'une fiche et la photo publiée, publics ; celui d'une fiche réservée, pour ses propriétaires ; les pages de la console ([API](../API.md)).
- **Deux tâches** : l'envoi des messages programmés, toutes les 30 secondes ; et, au ménage du matin, les moments allumés (`houseMoments`, rien tant qu'ils sont coupés) et la fin des photos dont la pièce a changé de mains (`wornEnded`).

**Les migrations**, appliquées dans **une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `<TAG_M1>`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0052_house_messages` | M1 à M4 | les tables `house_moment_settings` (un moment touché par la console : sans ligne, il est coupé, avec ses mots par défaut), `house_messages` (les messages écrits, figés une fois partis) et `house_deliveries` (un message reçu par un compte, une seule fois, jamais effacé), toutes vides |
  | `0053_worn` | G1 à G3 | la table `worn_photos` (une photo envoyée, avec sa signature et son consentement, ses octets seulement tant qu'elle est en revue ou publiée, une seule vivante par pièce), vide |

  L'application est arrêtée pendant les migrations. Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Caddy** : le seul changement de l'hôte (règle 4). `deploy.sh` le valide, puis le recrée.
- **Les variables** : aucune nouvelle. Ton `.env` ne change pas.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée, et Caddy recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `<TAG_M1>` ne peut plus tourner sur ce schéma. `deploy.sh --image <TAG_M1>` la refuse.

### 1.1 Avant : tes écrans, le responsable de l'hôte, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Tes écrans d'abord** (règle 1), au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair : MESSAGES avec FROM ORBES et la ligne de NOW ; le bloc WORN d'une pièce dans chacun de ses états ; WORN au pied d'une fiche, et une photo ouverte en grand ; les pages légales nouvelles ; dans la console, `House messages` (ses deux onglets, l'éditeur et son aperçu) et `WORN` (ses trois onglets). Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** :

- **MACRO M1 est en production**, au commit `<SHA_M1>` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §0 « Les messages d'ORBES (FROM ORBES) » et « WORN : la photo d'une pièce portée ». Les messages d'ORBES ne se répondent pas ; une photo de WORN se lit dans la console avant d'apparaître ; WORN n'est pas encore annoncé.

**3. Le responsable de l'hôte d'abord** (règle 4). Envoie-lui, avant le jour :

> Proposition pour le déploiement MACRO M2 d'ORBES : un changement du Caddyfile d'ORBES (`deploy/vps/Caddyfile`), dans le seul bloc de verify.theorbes.com. Une route de plus rejoint les envois de photos : `POST /api/v1/account/products/<pièce>/worn`, la photo qu'un propriétaire envoie depuis sa pièce, 1 Mo au plus dans l'application, passe dans `@photo_upload` (1200KB) et sort de `@not_upload` (64KB). Tout le reste garde sa limite. Aucun port, aucun certificat, aucune variable, aucun autre site ne change ; `compose.yaml` non plus. `deploy.sh` valide la configuration avant tout changement, puis recrée le conteneur Caddy d'ORBES : quelques secondes sans HTTPS pour verify.theorbes.com. Avec deux migrations en une transaction et une coupure courte d'ORBES, hors 03:00–05:30 UTC et hors de tes minutes de sauvegarde. D'accord ?

Attends son accord. Sans lui, n'avance pas.

**4. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-macro>. Le dernier passage de `genome-ci` doit être celui de `<SHA_M2>`, avec une coche verte. Sinon, n'avance pas.

**5. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 8) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_M2>` exactement, comme pour M1. Claude te donne la commande dans son rapport ; il ne la lance pas.

**6. Connecte-toi au serveur** en SSH, comme d'habitude, puis :

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

**7. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**8. Le pré-contrôle.** Note les six résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

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

**9. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

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

Sortie attendue : `<SHA_M1>` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=<TAG_M1>`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_M1> OK (previous 00317bcc0b4a; migrations 0049_live_pace, 0050_founding_list, 0051_emails)` : MACRO M1 est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_M2>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating <7 caractères de SHA_M1>..<7 caractères de SHA_M2>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_M2>`.

**Le Caddyfile est le seul changement de la pile du serveur** (deuxième condition ; règle 4), contre le commit de M1 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status <SHA_M1> HEAD -- deploy/vps
```

Sortie attendue : **exactement cette ligne** (`M` : modifié) :

```text
M	deploy/vps/Caddyfile
```

Une autre ligne de `deploy/vps` : arrête-toi et demande à Claude.

Ce qui change dans ses règles, et rien d'autre (les autres lignes du diff sont son commentaire) :

```bash
git -C /opt/orbes/orbes-index diff <SHA_M1> HEAD -- deploy/vps/Caddyfile | grep -E '^[-+][[:space:]]+path_regexp'
```

Sortie attendue : exactement ces quatre lignes, chaque règle retirée (`-`) puis remise (`+`) avec le chemin de WORN en plus :

```text
-		path_regexp ^/api/admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette)/?$
+		path_regexp ^/api/(admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette)|v1/account/products/[^/]+/worn)/?$
-			path_regexp ^/api/admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette|care/[^/]+/label)/?$
+			path_regexp ^/api/(admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette|care/[^/]+/label)|v1/account/products/[^/]+/worn)/?$
```

**Les deux migrations, et elles seules** (règle 5) :

```bash
git -C /opt/orbes/orbes-index diff --name-status <SHA_M1> HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces deux lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0052_house_messages.ts
A	genome/src/server/db/migrations/0053_worn.ts
```

**La version des pages légales** (règle 11) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-22';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 52 lignes, de `0001_initial` à `0051_emails` ; les deux dernières :

```text
0050_founding_list
0051_emails
```

### 1.4 Déployer

Hors des heures de la règle 2, et une fois l'accord du responsable de l'hôte reçu (§1.1, point 3). Envoie-lui une ligne au lancement, par exemple : « MACRO M2 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_M2>, 2 migrations ; le Caddyfile convenu (le chemin d'envoi de WORN à 1200KB), Caddy d'ORBES recréé ; rien d'autre ne change sur l'hôte. Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_M2> (tag <TAG_M2>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la nouvelle configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_M2>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: <TAG_M1>
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : la nouvelle configuration est refusée avant tout changement, le site tourne toujours sur `<TAG_M1>`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 52 migration(s) applied, all known to orbes-genome:<TAG_M2>
   ```

   **Il faut lire `52 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `<TAG_M1>`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M2>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M2>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_M2>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_M2>
   Applied 2 migration(s): 0052_house_messages, 0053_worn
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 2 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) et, cette fois, `Container orbes-caddy-1 Recreate` : Caddy est recréé avec la nouvelle configuration, c'est attendu.

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
   … [deploy.sh] deployed orbes-genome:<TAG_M2> (previous: <TAG_M1>). This release applied the migration(s) 0052_house_messages, 0053_worn:
   … [deploy.sh] orbes-genome:<TAG_M1> cannot run on this schema any more (scripts/deploy.sh --image <TAG_M1> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` (par exemple un Caddyfile refusé) | Le déploiement s'est arrêté seul. Le site tourne toujours sur `<TAG_M1>`, le schéma et Caddy n'ont pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:<TAG_M1>` et `rolled back to <TAG_M1>; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `<TAG_M1>`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to <TAG_M1> is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app` et `docker compose logs --tail 50 caddy`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_M2> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, Caddy, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `<TAG_M1>`. | `docker compose ps`, puis `docker compose logs --tail 100 app` et `docker compose logs --tail 50 caddy`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_M2>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| `caddy is healthy` n'arrive pas, ou HTTPS ne répond plus après la ligne `Recreate` | Caddy n'a pas redémarré avec la nouvelle configuration (elle avait pourtant été validée). | `docker compose logs --tail 50 caddy`, colle la sortie à Claude et préviens le responsable de l'hôte : le site d'ORBES est sans HTTPS tant que Caddy n'est pas reparti. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, n'allume aucun moment, n'envoie aucun message et ne publie aucune photo. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image <TAG_M1>`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_M2> OK (previous <TAG_M1>; migrations 0052_house_messages, 0053_worn)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 54 lignes `applied`, de `0001_initial` à `0053_worn`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que les migrations ont écrit**, en lecture seule. Aucun moment allumé, aucun message, aucune réception, aucune photo :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from house_moment_settings where enabled), (select count(*) from house_messages), (select count(*) from house_deliveries), (select count(*) from worn_photos)"'
```

Sortie attendue : `0|0|0|0`.

**Caddy lit sa nouvelle configuration** : le Caddyfile que voit le conteneur recréé porte le chemin de WORN dans ses deux règles.

```bash
docker compose exec -T caddy grep -cF 'v1/account/products/[^/]+/worn' /etc/caddy/Caddyfile
```

Sortie attendue : `2`. `0` : Caddy lit encore l'ancienne configuration, arrête-toi et dis-le à Claude.

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

**WORN ne montre rien** : une photo qui n'est pas dans WORN répond 404.

```bash
curl -s -w '\n%{http_code}\n' https://verify.theorbes.com/api/v1/worn/00000000-0000-4000-8000-000000000000/photo
```

Sortie attendue : `{"error":{"code":"WORN_NOT_FOUND","message":"This photograph is not in WORN."}}`, puis `404`.

**Les 64KB tiennent ailleurs** : un corps de 100 Ko reste refusé par Caddy hors des envois de photos, après sa recréation.

```bash
head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify
```

Sortie attendue : `413`.

La limite de 1200KB du chemin de WORN ne se mesure pas avec `curl` : sans session, l'application répond `401` avant de lire le corps, quelle que soit sa taille. Elle se vérifie pour de vrai au §1.7 (point 3), avec une photo de plus de 64 Ko envoyée depuis ton téléphone.

**Préviens le responsable de l'hôte** : « MACRO M2 fait à <heure> Paris (<heure> UTC), 2 migrations, Caddy recréé avec le changement convenu, rien d'autre n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN ; dans l'application, avec ton compte de collectionneur (le compte d'essai de la maison), sur ton téléphone (Safari) puis sur ton ordinateur. Ton compte doit avoir un prénom et un pays dans YOUR PROFILE.

**1. Un message programmé à ton propre segment**, lu sur le téléphone et sur l'ordinateur.

1. **Ton segment.** Dans la console, la fiche client de ton compte : `Add a tag`, `HOUSE CHECK`, `Add`. Puis `Segments` → `New segment` : `Name` `House check`, `Add a rule`, `Tagged`, `Tags` `HOUSE CHECK`, puis `Create segment`. Son compte : 1 personne, toi.
2. **Le message.** `House messages` → l'onglet `Messages` → `New message` : `Title` `A word from ORBES`, `Words` `{firstName}, this message checks FROM ORBES. Nothing to do.`, `Audience` : sous `A segment`, `House check`. La portée lit « Reaches 1 collector now. » Regarde l'aperçu, puis `Save` : « Draft saved. »
3. **Programmé.** `Send…` : `Schedule`, `Date and time, Paris` dans 3 minutes, tape `SEND`, puis `Send`. Le message lit `Scheduled`. Dans les 30 secondes qui suivent l'heure choisie : `Sent`, `Reached` 1.
4. **Sur ton téléphone** : NOW dit « A new message from ORBES. » ; MESSAGES a deux onglets, ORBES CLIENT SERVICES et FROM ORBES, NEW sur FROM ORBES. Ouvre-le : le titre, les mots avec ton prénom, et sous la liste « Messages from ORBES cannot be answered. » ; aucun champ de réponse.
5. **Sur ton ordinateur**, connecté au même compte : MESSAGES, le sujet FROM ORBES, le même message, et WRITE TO ORBES CLIENT SERVICES à la place de la réponse.
6. **Dans la console** : la colonne `Read · share` du message lit `1 · 100 %`. Le segment `House check` peut rester pour tes prochains essais.

**2. Un moment allumé, puis coupé.** `House messages` → l'onglet `Moments` : les six lisent `OFF`, « Not sent. ». Sur `90 days away`, `Switch on` : la boîte dit « From now on: nothing is sent for what happened before. » ; confirme `Switch on`. Le moment lit `ON`, « Since <date et heure à Paris> ». Puis `Switch off` : `OFF` à nouveau, « Switched off. ». Rien n'est parti : un moment n'envoie que ce qui arrive après son allumage, au ménage du matin. Sur le serveur, en lecture seule :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from house_deliveries where moment is not null"'
```

Sortie attendue : `0`.

**3. Une photo de WORN envoyée, publiée, vue sans compte, retirée.** Choisis une pièce de ton compte dont le modèle a une fiche **publique** (une fiche réservée ne se voit pas sans compte). Sans fiche, la pièce n'a pas de bloc WORN : prends-en une autre, ou garde ce contrôle pour le jour où une fiche est publiée. La photo sera visible de tous pendant quelques minutes : une vraie photo de la pièce portée, sans personne d'autre que toi.

1. **Sur ton téléphone**, MY PIECES, la pièce, l'onglet OWNERSHIP : le bloc WORN sous OWNERSHIP CERTIFICATE. CHOOSE A PHOTOGRAPH, une vraie photo (pas une capture d'écran) ; l'aperçu porte ta signature, `<PRÉNOM> · <PAYS>`. I AGREE, puis SEND : IN REVIEW, « ORBES is looking at your photograph. »
2. **La photo a passé la nouvelle limite de Caddy.** Sur le serveur, en lecture seule, sa taille en octets :

   ```bash
   docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select octet_length(photo) from worn_photos where photo is not null order by created_at desc limit 1"'
   ```

   Sortie attendue : un nombre **au-dessus de 64000** : la photo a traversé Caddy au-delà des 64KB d'avant. Un nombre plus petit : la photo était trop simple pour le mesurer ; retire-la (WITHDRAW) et envoie-en une plus détaillée. Si SEND finit sur « This photograph stays over 1 MB once prepared. Choose another one. », Caddy a refusé la photo : arrête-toi et dis-le à Claude.

3. **Dans la console**, le lien `WORN` porte 1 : `To review`, ta photo, `The credit, as it will read` avec ta signature, la pièce, le modèle, ton compte, l'envoi et le consentement à l'heure de Paris. `Publish` : « Published: it is on the model’s sheet. »
4. **Sur ton téléphone** : PUBLISHED, « In WORN since <date>. », SEE IT ON THE SHEET.
5. **Sans compte, sur ton ordinateur** : une fenêtre de navigation privée, la fiche du modèle (la même adresse que SEE IT ON THE SHEET, `https://verify.theorbes.com/verify/lookbook/…`). Au pied de la fiche, après PAIRS WELL WITH : WORN, ta photo et ta signature ; un clic l'ouvre en grand.
6. **Retirée.** Sur ton téléphone, WITHDRAW : « Remove it from WORN? », puis WITHDRAW encore : « Your photograph is withdrawn and erased. » Dans la console, `WORN` → `Ended` : ta photo lit `Withdrawn`, sans image. Sur ton ordinateur, une **nouvelle** fenêtre privée, la même fiche : plus de section WORN (une fenêtre déjà ouverte peut la garder 5 minutes au plus).

**4. Les pages légales.** Sur ton téléphone, PRIVACY et TERMS au pied de page : « Version of 22 October 2026 » sous le titre ; la politique de confidentialité a « House messages » et « WORN ».

### 1.8 Ensuite

- **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1) : les messages d'ORBES ne se répondent pas ; une photo de WORN se lit dans `WORN` avant d'apparaître.
- **WORN, la file de chaque jour** : une fois WORN annoncé, quelqu'un d'ORBES lit `To review` chaque jour (le lien de la barre porte le nombre).
- **Les anciennes images (facultatif).** Une fois MACRO M2 stable, `<TAG_M1>` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_M2>`), la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **Les moments, un par un** : tous sont coupés au déploiement. Tu allumes chacun quand tu le veux, dans `House messages` ; il n'envoie rien pour le passé. Leurs mots par défaut sont dans le playbook (§0 « Les messages d'ORBES (FROM ORBES) ») ; un OPERATOR peut les changer avant.
2. **Les choix par défaut** de tes décisions et du plan, que tu peux changer : aucune copie par e-mail des messages de la maison (M4, E6) ; une photo à la fois par pièce (G1) ; un palier choisi comme audience atteint aussi les paliers au-dessus ; « 90 jours sans visite » se lit sans connexion, sans session et sans scan ; la signature d'une photo est celle de l'envoi, sans variante ; une pièce qui change de mains retire la photo de son ancien propriétaire ; un modèle sans fiche publiée n'a pas de WORN ; les comptes de test n'envoient ni ne reçoivent rien.
3. **Quand annoncer WORN** : rien ne s'y voit tant que l'équipe n'a rien publié. Avant l'annonce, décide qui lit la file chaque jour.
4. **L'avocat** : la licence et le consentement de WORN, et la base des messages de la maison (l'intérêt légitime), partent avec la version `2026-10-22` (la note au juriste, points 33 et 34). Sa réponse ne retient pas le déploiement.
5. **WORN sur la future boutique Shopify** : la licence que donne le propriétaire nomme la fiche du modèle sur ce service seulement ; montrer WORN sur Shopify demandera une phrase de plus dans les conditions, ce jour-là.
6. **Une limite connue** : sur un téléphone, une photo de WORN ouverte en grand se montre seule (on ne glisse pas à la suivante).
