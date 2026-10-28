# Mise en production du lot PURGE (TEST PURGE, PLATFORM RESET, LOCK RESET)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot PURGE de tes décisions des 26 et 27 octobre 2026 part en production en **un seul déploiement**, après celui de M4 ([son runbook](DEPLOY-M4B-M4.md)). Utiliser PLATFORM RESET est une autre étape, plus tard, avant le lancement, quand tu le décides (§2) :

| Étape | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| Le déploiement PURGE | TEST PURGE (la purge d'un test terminé, et PURGE ALL ENDED TESTS) ; PLATFORM RESET et LOCK RESET, dans la console, pour toi seul ; la confirmation par un code frais de ton application d'authentification | `0066_test_purge`, `0067_platform_reset` | aucun | **À faire** (§1) |
| Utiliser PLATFORM RESET | La remise à zéro de la plateforme avant le lancement, depuis la console, puis LOCK RESET le jour du lancement | aucune | aucun | **Plus tard, sur ta décision** (§2) |

Le point de départ : la production tourne M4, son commit `ecbb448cb2ee2492530db0908aa7b6d26f4e89b5` (image `orbes-genome:ecbb448cb2ee`, déployée le 27 octobre 2026 à 13:01 à Paris (12:01 UTC)), avec les 66 migrations de `0001_initial` à `0065_ad_conversions`. **PURGE ne part qu'après M4** : ses migrations s'appuient sur `0065_ad_conversions`. Avant le jour, Claude remplace dans ce document `<SHA_PURGE>` et `<TAG_PURGE>` par le commit final du lot (40 caractères) et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `ecbb448cb2ee` (un correctif après M4, ou un autre lot déployé avant), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord d'abord.** Avant la fusion, tu regardes les captures de la console que te donne le rapport de Claude (§1.1) : PAST TESTS avec `Purge`, la page `Ended tests`, la page `Platform reset` et leurs boîtes. Aucun écran du collectionneur ne change. Tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Les heures** : jamais entre 04:00 et 06:30 à Paris, toute l'année (03:00–05:30 UTC en hiver ; en été, le gel couvre aussi 03:00–05:30 UTC, c'est-à-dire jusqu'à 07:30 à Paris), ni pendant les minutes de sauvegarde du hub : 03:00–03:10 et 03:45–03:55 à Paris, toute l'année (02:00–02:10 et 02:45–02:55 UTC en hiver). Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026. Ces heures valent pour ce déploiement, pour chaque purge et pour chaque remise : la base elle-même refuse la purge et la remise dans ces plages, et la console le dit à l'heure de Paris. Chaque heure de ce document est d'abord celle de Paris, l'heure UTC entre parenthèses.
3. **Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.** Le redémarrage couperait la salle, la file et les tours en cours. Tu déploies quand aucune LIVE RELEASE n'a sa salle ouverte, ni ne l'ouvre dans l'heure (le pré-contrôle du §1.1 le lit), et **quand aucun test de TEST ENTRANTS ne tourne**.
4. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures des règles 2 et 3, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
5. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume, ni réseau. Ton `.env` ne gagne aucune ligne : la purge et la remise passent par les migrations, que `deploy.sh` applique comme propriétaire de la base.
6. **Deux migrations, puis plus de retour en arrière** : après `0066_test_purge` et `0067_platform_reset`, l'image `ecbb448cb2ee` ne tourne plus sur le schéma (`deploy.sh --image ecbb448cb2ee` la refuse). En cas de souci, on **répare en avant** (§1.5).
7. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`) : tu ne le lances que pour le voir refuser (§1.6). Si un jour une sauvegarde est restaurée ailleurs, la règle du §3 s'applique avant que l'application serve.
8. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
9. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-purge` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
10. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche. Ton mot de passe et tes codes ne s'entrent que dans la console.
11. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
12. **Ton adresse ne s'écrit jamais dans le dépôt** (il est public). Le détenteur de la remise se lit sur le serveur, en lecture seule (§1.6) : ce doit être ta propre connexion à la console, l'ADMIN avec double authentification avec lequel tu te connectes.
13. **Les pages légales ne changent pas** : la purge supprime des comptes de test, non des personnes, et la remise est une opération d'avant le lancement sur des données de test, dont la seule partie réelle, la liste fondatrice, est gardée. `LEGAL_VERSION` reste `2026-10-27`, celle de M4 (§1.3 le vérifie).

---

## 1. Le déploiement

### 1.0 Ce qui change

**En mots simples**

- **TEST PURGE.** Sur un test terminé de TEST ENTRANTS (END TEST fait), `Purge` supprime ses entrées, ses commandes annulées avec leurs événements, ses sessions, ses entrées d'audit et les comptes de test qu'aucun autre test n'utilise ; **son rapport reste**. La base le fait elle-même, par petits lots, en arrière-plan, et s'arrête seule pendant les heures de la règle 2 ou pendant un test en cours, puis reprend. Chaque entrée d'audit supprimée laisse sa trace : la vérification de la chaîne prouve toujours que rien d'autre n'a été retiré. Jamais un compte, une entrée ou une commande réels, jamais l'audit des actions réelles. Un tirage tiré ne se purge que s'il n'a que des entrées de test (sa liste classée publique ne correspond alors plus à sa graine, la boîte le dit).
- **PURGE ALL ENDED TESTS.** La même chose pour chaque test terminé, d'un coup, depuis `Settings` → `Ended tests`.
- **PLATFORM RESET** (avant le lancement, §2). Un seul bouton, comme la remise au catalogue du 9 octobre : il garde le catalogue, les réglages, les connexions à la console, **la liste fondatrice** (avec les liens et les sources dont elle a besoin) et la clé de signature, et efface tout le reste, **tous les comptes de collectionneurs compris**, les autres liens et les partenaires avec leurs factures ; les numéros repartent de 1. Toi seul, le détenteur de la remise, le vois et l'appuies, avec ton mot de passe, un code frais et la phrase `RESET PLATFORM`. L'application s'arrête, remet la base à zéro dans une seule transaction avec ses preuves, et redémarre : coupure d'environ 30 à 60 secondes.
- **LOCK RESET.** Le jour du lancement : la remise est refusée pour toujours, sans retour (§2.5).
- **La confirmation.** Chaque purge et chaque remise demandent un code frais de ton application d'authentification (le code de ta connexion ne vaut plus : attends le suivant), refusées dans les 24 heures qui suivent un changement de la double authentification ou du rôle du compte.
- **Ce qui ne change pas** : TEST ENTRANTS, END TEST, la chaîne d'audit, la connexion avec double authentification, LIVE, ONE QUEUE, THE VAULT, M1 à M4 ; les écrans du collectionneur ; l'hôte. Pendant qu'un test d'une sortie est en purge, les actions de tirage de cette sortie (OFFER NEXT, Confirm, Lapse) sont refusées jusqu'à la fin de la purge : « A test of this release is being purged. Try again once it is done. »
- **Le risque que tu as accepté** (27 octobre, la console seule) : un code qui tournerait comme l'application (`orbes_app`) pourrait lancer la remise avec ton identifiant ; LOCK RESET, dès le lancement, le ferme.

**Pour le personnel (la console)**

- **La page d'une sortie, `Test entrants`, `Past tests`** : la colonne d'état suit la purge (PURGING, PAUSED avec sa raison, PURGED avec quand et par qui) ; le bouton `Purge` (un **ADMIN** seul), ou `Resume purge` sur une purge arrêtée.
- **`Settings` → `Ended tests`** : chaque test terminé de chaque sortie, son rapport, `Purge` et `Purge all ended tests`. Tout le monde la lit ; un ADMIN purge.
- **`Settings` → `Platform reset`** : seulement pour toi, le détenteur. Ce qui part, ce qui reste, les listes du 9 octobre, `Reset the platform` et `Lock reset`.
- **`Audit`** : après une purge, la vérification de la chaîne dit combien d'entrées ont été purgées avec leurs tests.

**Pour le serveur**

- **Les migrations, appliquées dans une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `ecbb448cb2ee`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0066_test_purge` | TEST PURGE | la porte de la purge dans les protections de la base (pour le propriétaire de la base seul), ses colonnes sur `test_runs`, les traces des entrées d'audit supprimées (`audit_purge_gaps`, vide), la liste de l'étape des comptes (`purge_delete_tables`), les heures interdites, et les deux fonctions de purge |
  | `0067_platform_reset` | PLATFORM RESET, LOCK RESET | le plan de la remise, chaque table avec sa classe (`platform_reset_plan` : KEEP, PARTLY, WIPE), sa porte (`platform_reset_gate`, une ligne : le **détenteur**, enregistré par la migration, l'ADMIN actif avec double authentification le plus ancien ; LOCK RESET ; l'autorisation à usage unique), et les fonctions de la remise |

  L'application est arrêtée pendant les migrations. Elles n'effacent rien : aucune donnée d'aujourd'hui ne change.

- **Les variables** : aucune nouvelle. Ton `.env` ne change pas.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. Caddy n'est pas recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `ecbb448cb2ee` ne peut plus tourner sur ce schéma. `deploy.sh --image ecbb448cb2ee` la refuse.

### 1.1 Avant : ton accord, la CI, l'heure, le pré-contrôle

**1. Ton accord** (règle 1). Aucune maquette n'existait pour ce lot : chaque page suit celles de la console. Les captures, au format ordinateur (1440 × 900, et 1024 × 768) : PAST TESTS avec `Purge`, la boîte « Purge the test » et son erreur, PURGING, PAUSED, PURGED, `Settings` et ses deux liens, `Ended tests` et la boîte « Purge all ended tests », la page `Platform reset` (prête, refusée, après une remise, verrouillée), ses deux boîtes et l'avis de redémarrage.

Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** :

- **M4 est en production**, au commit `ecbb448cb2ee2492530db0908aa7b6d26f4e89b5` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** entre l'ouverture de sa salle et sa fin, ni dont la salle ouvre dans l'heure (règle 3 ; le point 8 le lit), et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se clôt avec END TEST avant, comme d'habitude.
- **Ta double authentification** est active sur ta connexion à la console (page `Security`) : la migration choisit le détenteur parmi les ADMIN qui l'ont (le point 8 le lit).

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-purge>. Le dernier passage de `genome-ci` sur `<SHA_PURGE>` doit avoir une coche verte (ses quatre parties, dont la suite PostgreSQL). Sinon, n'avance pas. Si l'une des quatre parties a pris plus de 42 de ses 45 minutes, dis-le à Claude : la session principale décide de sa limite, ce lot ne change pas la CI.

**4. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 9) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_PURGE>` exactement, comme pour M4. Claude te donne la commande dans son rapport ; il ne la lance pas.

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

Sortie attendue : une heure hors de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

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

**8. Aucune sauvegarde en cours, les LIVE RELEASES, les tests et les connexions à la console, en lecture seule.**

```bash
pgrep -a pg_dump
```

Sortie attendue : **rien**. Une ligne `<numéro> pg_dump …` : une sauvegarde tourne, attends qu'elle finisse et relance la commande.

Aucune LIVE RELEASE dont la salle est ouverte, ou ouvre dans l'heure (règle 3) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

Sortie attendue : `0`. Un autre nombre : une sortie est en cours ou va ouvrir sa salle ; attends sa fin (ou déploie un autre jour).

Aucun test de TEST ENTRANTS sans END TEST :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from test_runs where ended_at is null"'
```

Sortie attendue : `0`. Un autre nombre : un test tourne, ou un test fini attend son END TEST ; fais END TEST sur sa page avant de déployer.

Les connexions à la console, par rôle puis de la plus ancienne à la plus récente (le rôle, l'adresse, active, double authentification) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select role, email, disabled_at is null, totp_secret_enc is not null from admin_users order by role, created_at, id"'
```

Sortie attendue : une ligne par connexion, `<rôle>|<adresse>|<t ou f>|<t ou f>`, les lignes `ADMIN` en premier. **La première ligne `ADMIN|…|t|t` est le détenteur que la migration enregistrera : ce doit être ta propre adresse de connexion à la console.** Une autre adresse en premier, ou aucune ligne `ADMIN|…|t|t` : ne déploie pas, arrête-toi et demande à Claude.

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

Sortie attendue : `ecbb448cb2ee2492530db0908aa7b6d26f4e89b5` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=ecbb448cb2ee`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy ecbb448cb2ee OK (previous 4f8ef7b44613; migrations 0063_margin, 0064_partners, 0065_ad_conversions)` : M4 est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_PURGE>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating ecbb448..<7 caractères de SHA_PURGE>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_PURGE>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 5), contre le commit de M4 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status ecbb448cb2ee2492530db0908aa7b6d26f4e89b5 HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**Les migrations, et elles seules** (règle 6) :

```bash
git -C /opt/orbes/orbes-index diff --name-status ecbb448cb2ee2492530db0908aa7b6d26f4e89b5 HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces deux lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0066_test_purge.ts
A	genome/src/server/db/migrations/0067_platform_reset.ts
```

**Les pages légales, inchangées** (règle 13) :

```bash
git -C /opt/orbes/orbes-index diff --name-status ecbb448cb2ee2492530db0908aa7b6d26f4e89b5 HEAD -- genome/src/web/legal docs/legal
```

Sortie attendue : **rien**.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-27';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 66 lignes, de `0001_initial` à `0065_ad_conversions` ; les deux dernières :

```text
0064_partners
0065_ad_conversions
```

Une liste qui s'arrête avant `0065_ad_conversions` : M4 n'est pas en production, arrête-toi.

### 1.4 Déployer

Hors des heures des règles 2 et 3. **Juste avant**, relance la première requête des LIVE RELEASES du §1.1, point 8 (aucune salle ouverte, aucune qui ouvre dans l'heure) : `0`, sinon attends.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement PURGE lancé à <heure> Paris (<heure> UTC), deux migrations, rien ne change sur l'hôte. » Ajoute-y l'image, `orbes-genome:<TAG_PURGE>`, et les six résultats du pré-contrôle (§1.1, point 7).

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_PURGE> (tag <TAG_PURGE>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la même configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_PURGE>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: ecbb448cb2ee
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : le site tourne toujours sur `ecbb448cb2ee`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 66 migration(s) applied, all known to orbes-genome:<TAG_PURGE>
   ```

   **Il faut lire `66 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `ecbb448cb2ee`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_PURGE>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_PURGE>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets, ainsi que la ligne `db.dump`** : c'est la taille de la base avant toute purge (§1.8), à garder pour mémoire (cette archive ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_PURGE>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_PURGE>
   Applied 2 migration(s): 0066_test_purge, 0067_platform_reset
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 2 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) ; Caddy garde son conteneur, sa configuration n'ayant pas changé.

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
   … [deploy.sh] deployed orbes-genome:<TAG_PURGE> (previous: ecbb448cb2ee). This release applied the migration(s) 0066_test_purge, 0067_platform_reset:
   … [deploy.sh] orbes-genome:ecbb448cb2ee cannot run on this schema any more (scripts/deploy.sh --image ecbb448cb2ee refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_PURGE> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`. Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant. Les migrations elles-mêmes ne se défont pas : le `down` de `0067_platform_reset` refuse dès qu'une remise a été faite ou que LOCK RESET a été pressé, celui de `0066_test_purge` dès qu'une trace d'audit ou une purge existe.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `ecbb448cb2ee`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur de `db migrate`, puis `── rollback to orbes-genome:ecbb448cb2ee` et `rolled back to ecbb448cb2ee; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `ecbb448cb2ee`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to ecbb448cb2ee is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_PURGE> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `ecbb448cb2ee`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_PURGE>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, une purge en cours reste où elle est (elle reprend d'elle-même plus tard), tu n'appuies pas sur `Reset the platform`, et jamais rien par la base. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image ecbb448cb2ee`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_PURGE> OK (previous ecbb448cb2ee; migrations 0066_test_purge, 0067_platform_reset)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 68 lignes `applied`, de `0001_initial` à `0067_platform_reset`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que les migrations ont écrit**, en lecture seule. Les nouvelles tables : aucune trace d'audit, les 10 tables de l'étape des comptes, la ligne de la porte, les 164 tables du plan ; et aucune purge sur `test_runs` :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from audit_purge_gaps), (select count(*) from purge_delete_tables), (select count(*) from platform_reset_gate), (select count(*) from platform_reset_plan), (select count(*) from test_runs where purge_state is not null)"'
```

Sortie attendue : `0|10|1|164|0`.

Le plan de la remise, par classe :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select kind, count(*) from platform_reset_plan group by 1 order by 1"'
```

Sortie attendue, exactement :

```text
KEEP|40
PARTLY|8
WIPE|116
```

**Les tables, les protections et les liens de la base**, comptés en lecture seule (le 9 octobre, le script de la remise les comptait ; ici, la remise compare elle-même chaque table à son plan) : les tables, les déclencheurs, les clés étrangères, puis les tables hors du plan :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from pg_tables where schemaname = current_schema()), (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = to_regnamespace(current_schema()) and not t.tgisinternal), (select count(*) from pg_constraint where connamespace = to_regnamespace(current_schema()) and confrelid <> 0)"'
```

Sortie attendue : `164|176|400`.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_tables where schemaname = current_schema() and tablename not in (select tbl from platform_reset_plan)"'
```

Sortie attendue : `0`.

**La porte de la remise** : aucune remise, pas de LOCK RESET, aucune autorisation en cours :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select resets, launched_at is null, last_reset_at is null, authorized_by is null from platform_reset_gate"'
```

Sortie attendue : `0|t|t|t`.

**Le détenteur de la remise**, en lecture seule (son adresse, son rôle, active, double authentification) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select a.email, a.role, a.disabled_at is null, a.totp_secret_enc is not null from platform_reset_gate g join admin_users a on a.id = g.holder_admin_id"'
```

Sortie attendue : une seule ligne, `<ton adresse>|ADMIN|t|t`. **Ce doit être ta propre connexion à la console, l'ADMIN avec double authentification avec lequel tu te connectes.** Sinon, **désactive cette connexion dans `Team` tout de suite** (`Disable`) : la remise et LOCK RESET exigent un détenteur actif, ils refusent alors ; puis dis-le à Claude, qui répare en avant par une migration. **Rien** (aucune ligne) : aucun détenteur, la remise est refusée ; dis-le à Claude (réparation en avant). Ton adresse ne s'écrit nulle part dans le dépôt.

**La liste des ADMIN**, en lecture seule, la même qu'au §1.1, point 8 :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select role, email, disabled_at is null, totp_secret_enc is not null from admin_users order by role, created_at, id"'
```

Sortie attendue : les mêmes lignes qu'avant le déploiement ; la première `ADMIN|…|t|t` est le détenteur lu juste au-dessus.

**Les fonctions de la purge et de la remise, dans le catalogue de PostgreSQL 17** (la production), en lecture seule. La version d'abord :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "show server_version"'
```

Sortie attendue : une ligne qui commence par `17.`.

Puis chaque fonction qui s'exécute avec les droits de son propriétaire : son nom, `prosecdef` (elle s'exécute avec les droits de son propriétaire), si ce propriétaire est un superutilisateur, et ses réglages fixés :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select p.proname, p.prosecdef, r.rolsuper, p.proconfig::text from pg_proc p join pg_roles r on r.oid = p.proowner where p.pronamespace = to_regnamespace(current_schema()) and p.prosecdef order by 1"'
```

Sortie attendue, exactement ces sept lignes :

```text
orbes_platform_reset|t|t|{"search_path=pg_catalog, public, pg_temp",lock_timeout=5s,orbes.guard_bypass=reset}
orbes_platform_reset_authorize|t|t|{"search_path=pg_catalog, public, pg_temp",lock_timeout=5s}
orbes_platform_reset_lock|t|t|{"search_path=pg_catalog, public, pg_temp",lock_timeout=5s}
orbes_platform_reset_precheck|t|t|{"search_path=pg_catalog, public, pg_temp"}
orbes_platform_reset_unauthorize|t|t|{"search_path=pg_catalog, public, pg_temp",lock_timeout=5s}
orbes_purge_test_pool_batch|t|t|{"search_path=pg_catalog, public, pg_temp",lock_timeout=2s,orbes.guard_bypass=purge}
orbes_purge_test_run_batch|t|t|{"search_path=pg_catalog, public, pg_temp",lock_timeout=2s,orbes.guard_bypass=purge}
```

Une ligne de plus, de moins, ou différente : colle la sortie à Claude, n'utilise ni la purge ni la remise.

Sur PostgreSQL 17, ceci se vérifie dans le catalogue seulement : le comportement (le contournement actif à l'intérieur, jamais au-dehors) est prouvé par PURGE.13 dans la CI, sur PostgreSQL 16 (`genome/test/db/postgres-purge-reset.test.ts`). Aucune fonction n'est appelée ici : celles qui portent le contournement suppriment ou remettent à zéro, et la vérification préalable n'en porte aucun.

**Les tests terminés**, en lecture seule (ce que §1.7 purgera) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from test_runs where ended_at is not null"'
```

Sortie attendue : un nombre ; note-le.

**La console** (sur ton ordinateur, en ADMIN) :

- `Settings` : deux liens nouveaux, `Ended tests` et `Platform reset` (ce dernier pour toi seul).
- `Settings` → `Ended tests` : chaque test terminé, l'état `ENDED`, `Report`, `Purge`, et en haut `Purge all ended tests`.
- `Audit` → `Verify chain` : « Chain intact », comme avant (aucune purge encore).
- **Ce qui ne change pas** : la page d'une sortie et sa section `Test entrants` (SEND TEST ENTRANTS, END TEST, `Past tests`), `Team`, `Security`, `Keys`.

**L'application** : `/verify` s'ouvre comme avant, sur téléphone et sur ordinateur.

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

**Préviens le responsable de l'hôte** : « PURGE fait à <heure> Paris (<heure> UTC), deux migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN, hors des heures de la règle 2, aucun test en cours. Chaque code est **un code frais** de ton application d'authentification : celui de ta connexion ne vaut plus (« This code was just used. Wait for the next code. ») ; deux confirmations de suite demandent deux codes différents.

#### 1. Avant la première purge : les tailles, en lecture seule

Sur le serveur, la taille de la base, puis les quinze plus grandes tables :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_size_pretty(pg_database_size(current_database()))"'
```

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 15"'
```

Sortie attendue : une taille, puis quinze lignes `<table>|<taille>`. **Note-les** : tu les compareras après la purge, et le responsable de l'hôte reçoit la nouvelle taille de la sauvegarde (§1.8).

#### 2. La purge d'un test terminé

1. La page d'une sortie dont un test est terminé (de préférence un petit), section `Test entrants`, `Past tests` : sur le test, `Purge`.
2. La boîte « Purge the test » dit ce qui part et ce qui reste (« Deletes this test’s entries, its cancelled orders with their events, its sessions and its audit entries … »), un tirage tiré le dit aussi, et les commandes gardées avec leurs comptes. `Authenticator code` : un code frais ; tape `PURGE TEST <les 8 premiers caractères du test>` (la boîte te l'affiche), puis `Purge test` : « Purge under way: the test’s rows are deleted in small steps. »
3. L'état passe à `PURGING` (« Asked … Paris by <ton adresse> … rows deleted so far. »), puis à `PURGED` : « Purged <jour> · <heure> Paris by <ton adresse> ». Son rapport reste : `Report` l'ouvre.
4. `Audit` → `Verify chain` : « Chain intact », et la ligne « <nombre> entries purged with their tests (each one's link kept) ».

Un refus s'affiche dans la boîte, et tu restes connecté : la raison, à l'heure de Paris (une heure de la règle 2, un test en cours, la sortie pas finie), ou le code (attends le suivant).

#### 3. PURGE ALL ENDED TESTS

1. `Settings` → `Ended tests` → `Purge all ended tests`.
2. La boîte dit combien de tests sont purgés (et les purges en pause qui reprennent), combien sont d'un tirage tiré, jusqu'à combien de comptes de test partent, et chaque test passé avec sa raison. `Authenticator code` : un nouveau code frais ; tape `PURGE ALL TESTS`, puis `Purge all` : « Purge under way: <nombre> tests. »
3. Chaque ligne passe à `PURGING`, puis à `PURGED`. C'est long pour un test de 5 000 : la purge travaille en arrière-plan, par petits lots ; pendant les heures de la règle 2, elle passe à `PAUSED` avec l'heure de reprise à Paris, et reprend seule.
4. `Audit` → `Verify chain` : « Chain intact », avec le nombre d'entrées purgées.

#### 4. La page PLATFORM RESET, lue sans appuyer

`Settings` → `Platform reset`. **N'appuie sur rien.**

- `Holder` : ton adresse. `State` : `READY` (« Nothing holds a reset now. »), ou `REFUSED NOW` avec sa raison à l'heure de Paris.
- `What goes` : `Collector accounts`, avec en gras « <nombre> neither test nor team », puis les sorties, les entrées, les commandes, les pièces, les factures, les partenaires, les liens, le journal d'audit, les sessions et le total.
- `What stays` : le catalogue, les réglages, les connexions à la console, la liste fondatrice (en gras), ce dont elle a besoin, la clé de signature.
- `What stays that a test may have made`, `Segments that go`, `Signing keys` : les listes du 9 octobre.

#### 5. LOCK RESET, non appuyé

Sur la même page, le bouton `Lock reset` est là. **Ne l'ouvre pas** : il ferme la remise pour toujours ; il attend le jour du lancement (§2.5).

### 1.8 Ensuite : la taille de la sauvegarde au responsable de l'hôte

1. **Le lendemain de la première purge**, après la sauvegarde de nuit, sur le serveur :

   ```bash
   du -sh /var/backups/orbes
   ```

   ```bash
   ls -l /var/backups/orbes/daily
   ```

   La dernière archive de nuit (sans `pre-deploy` dans son nom) et sa taille en octets, à comparer avec l'archive du §1.4, point 4. Relance aussi les deux lectures du §1.7, point 1.
2. **Préviens le responsable de l'hôte** : « ORBES : purge des tests faite le <jour> ; base <taille avant> → <taille après>, sauvegarde de nuit <taille avant> → <taille après>. » **Jusqu'à ce message, la règle des 1 000 entrants tient** : aucun test de TEST ENTRANTS au-delà de 1 000.
3. **Les anciennes images (facultatif).** Une fois le lot stable, `ecbb448cb2ee` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_PURGE>`), la liste d'abord :

   ```bash
   docker images orbes-genome
   ```

## 2. Utiliser PLATFORM RESET (avant le lancement)

Rien de cette partie ne se fait au déploiement. Le jour où tu décides de remettre la plateforme à zéro avant le lancement, dans cet ordre. Tu peux le refaire autant de fois que tu veux, jusqu'à LOCK RESET (§2.5).

### 2.1 Avant

- **Hors des heures de la règle 2** (04:00–06:30 à Paris toute l'année, jusqu'à 07:30 en été ; 03:00–03:10 et 03:45–03:55 à Paris), avec cinq minutes de marge : sinon la console refuse, à l'heure de Paris.
- **Aucune salle de LIVE RELEASE ouverte** (entre l'ouverture de sa salle et sa fin), **aucun test en cours** : la console refuse sinon (« A LIVE room is open until … », « A test is running. Reset once it has ended. »).
- **Aucun `deploy.sh` depuis l'appui jusqu'à ce que tu sois reconnecté** (la règle 3 du 9 octobre), et aucune commande `psql` sur le serveur pendant ce temps : une autre connexion à la base fait refuser la remise (rien ne change).
- **Ton équipe** (LOGISTICS, ORBES Client Services) : préviens-la qu'elle sera déconnectée et devra se reconnecter.
- **Sur le serveur, la porte, en lecture seule** : note les deux valeurs (le nombre de remises, la dernière en UTC) :

  ```bash
  docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select resets, last_reset_at from platform_reset_gate"'
  ```

  Sortie attendue : `0|` avant la première remise ; ensuite `<nombre>|<date et heure UTC>`.
- **La ligne au responsable de l'hôte, à envoyer juste avant d'appuyer** : « ORBES : remise à zéro de la plateforme lancée à <heure> Paris (<heure> UTC) depuis la console ; l'application est coupée environ 30 à 60 secondes, puis redémarre seule ; rien ne change sur l'hôte. »
- **Lis la page** `Settings` → `Platform reset` : le nombre de comptes **« neither test nor team »** sous `What goes` (ce sont de vrais comptes : ils partent aussi), leurs inscriptions les plus récentes, les sorties ouvertes ou annoncées, et les listes (`What stays that a test may have made`, `Segments that go`, `Signing keys`). Si une inscription arrive après ta lecture, l'appui est refusé : relis la page.

### 2.2 Appuyer

1. `Reset the platform`. La boîte « Reset the platform » répète ce qui part, les numéros d'après (« Piece serials restart at 00001 … and invoice numbers at INV-<année>-000001. The signing key stays. ») et, en gras, le nombre de comptes ni de test ni de l'équipe.
2. `Current password` : ton mot de passe ; `Authenticator code` : un code frais ; tape `RESET PLATFORM`, puis `Reset the platform`.
3. La page se couvre : « The platform is restarting. » « Sign in again in a minute. » N'appuie sur rien : la console te ramène à la connexion dès que la plateforme répond.

### 2.3 Après

1. **Reconnecte-toi** : ton adresse, ton mot de passe, puis le code. Tout le monde est déconnecté, ton équipe aussi.
2. `Settings` → `Platform reset` : `Last reset`, « Last reset <jour> · <heure> Paris by <ton adresse>: <nombre> rows deleted. Audit log restarted: entry 1, hash …. Previous log ended at entry …, hash …. »
3. **Les lignes du contrôle d'après**, sous `After the reset` : « Every check after the reset is OK. », puis chacune `OK` :
   - `Audit log: entry 1 links to the start, chain OK`
   - `One active signing key`
   - `No pieces, no invoices, no partner invoices`
   - `Next piece references`
   - `Next numbers`
   - `Next test`

   Une ligne `FAILING`, en rouge : n'utilise pas la plateforme, colle à Claude ce que dit la page.
4. **La liste à faire**, sous `Checklist`, dans l'ordre de la page :
   - à la dernière remise avant la vraie impression, une nouvelle clé de signature, puis l'ancienne révoquée (`Keys`), et **demande au responsable de l'hôte une sauvegarde juste après la rotation** : la nouvelle clé n'existe que dans le volume des clés jusqu'à la sauvegarde de nuit ;
   - détruis toutes les cartes, étiquettes et cartes de boîte de test imprimées : les numéros repartent de 00001 ;
   - jette les factures, avoirs, factures de partenaire et CSV de test téléchargés : les numéros INV-, CN-, P- et PC- repartent ;
   - recrée ton compte de collectionneur dans l'application ;
   - désactive dans `Team` chaque connexion à la console faite pour un test ;
   - range dans la console ce qu'un test a pu laisser : les listes sous `What a test may have left`, notées avant l'effacement ;
   - écris la date de la remise à côté de chaque ancre d'audit gardée : le journal repart de l'entrée 1.
5. **Sur le serveur, en lecture seule**, la porte : `resets` a pris un de plus, `last_reset_at` est l'heure de ton appui (en UTC).

   ```bash
   docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select resets, last_reset_at from platform_reset_gate"'
   ```

6. **Préviens le responsable de l'hôte** : « ORBES : remise à zéro faite à <heure> Paris (<heure> UTC), app healthy, rien n'a changé sur l'hôte. Les prochaines sauvegardes de nuit d'ORBES seront plus petites. »

### 2.4 Si la remise est refusée, ou si elle échoue

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une erreur **dans la boîte**, la boîte encore ouverte | La remise est refusée avant de commencer : **rien n'a changé**, tu es toujours connecté. | Lis la raison. Une heure interdite (à l'heure de Paris) : attends l'heure dite. Une salle LIVE ouverte : attends sa fin. Un test en cours : END TEST. « … accounts signed up since you opened this page. Reload it and check them. » : ferme la boîte, recharge la page et relis-la. Le code (« This code was just used. Wait for the next code. », « The code is not valid. … ») : attends le code suivant. « Too many wrong codes today. Try again after … » ou « … changed less than 24 hours ago. Try again after … » : attends l'heure dite. |
| Après l'avis de redémarrage, la console revient **sans** te déconnecter, et la page lit `Refused reset` : « The reset of <jour> at <heure> Paris was refused: <raison>. Nothing changed. » | La remise a démarré, puis s'est arrêtée seule et a tout annulé (le processus est sorti en code 1, `platform.reset.failed` est dans le journal d'audit) : **rien n'a changé**. | Lis la raison. Une autre connexion à la base, une heure interdite, une inscription, un test : attends, relis la page, appuie de nouveau plus tard. « a check before the commit failed (…) » ou une autre raison : n'appuie plus, colle la ligne à Claude. |
| **La console ne revient pas dans les 3 minutes** | La remise a été validée ou non : la porte le dit. | Sur le serveur : `docker compose ps`, puis `docker compose logs --tail 100 app` (cherche `platform reset done: entry 1 of the new audit chain written; restarting` ou `platform reset refused or failed: nothing changed; restarting`), puis, en lecture seule, `select resets, last_reset_at from platform_reset_gate` (la commande du §2.1). `resets` a pris un de plus et `last_reset_at` est l'heure de ton appui : la remise est **validée**. Inchangés : **rien n'a changé**. Colle les sorties à Claude ; préviens le responsable de l'hôte si le site reste coupé. On répare en avant ; **jamais `restore.sh`**. |

### 2.5 Le jour du lancement : LOCK RESET

Une fois la plateforme lancée (le dernier `Reset the platform` fait, la liste de §2.3 faite) : `Settings` → `Platform reset` → `Lock reset`. La boîte « Lock reset » : « After this, PLATFORM RESET is refused for good. Do it once the platform is launched. » `Current password`, `Authenticator code` (un code frais), tape `LOCK RESET`, puis `Lock reset`. La page lit : « Locked <jour> · <heure> Paris by <ton adresse>. The reset is refused for good. » ; plus aucun bouton. Sur le serveur, en lecture seule :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select launched_at is not null from platform_reset_gate"'
```

Sortie attendue : `t`. Le premier lot après le lancement retire ensuite la remise du code et de la base.

## 3. Si une sauvegarde est un jour restaurée

Jamais sur ce serveur (règle 7). Sur un autre serveur appelé à rester (un déménagement ; jamais le serveur jetable d'un exercice), une sauvegarde d'avant LOCK RESET, ou d'avant ce lot, ramène une remise ouverte. **Avant que l'application serve à quiconque**, lis la porte, en lecture seule :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select launched_at from platform_reset_gate"'
```

Sortie attendue : une date et une heure : LOCK RESET est en place, la remise est refusée pour toujours. Une ligne vide : la remise est ouverte ; `docker compose stop app` tout de suite, ou toi seul, le détenteur, appuies `Lock reset` avant toute autre chose ([DEPLOYMENT §10](../DEPLOYMENT.md#10-backups-and-point-in-time-recovery)). Le premier lot après le lancement règle lui-même `launched_at` quand il est vide, et retire la remise.
