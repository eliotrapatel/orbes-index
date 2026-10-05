# Mise en production de la LIVE RELEASE (déploiement D)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

La LIVE RELEASE (plan du 2026-10-04) part en production en **un seul déploiement**, D, après les déploiements du lot « Potentiel » ([leur runbook](DEPLOY-POTENTIEL-2026-10.md)).

| Déploiement | Élément | Migration | Changement de l'hôte | État |
|---|---|---|---|---|
| D | La LIVE RELEASE : la salle, la file, le tour, PAY, la console et son intelligence | `0021` | le Caddyfile d'ORBES, convenu d'abord avec le responsable de l'hôte (§1.1) | **À faire** |

Le point de départ : la production tourne le commit `78959e8516cc146a297cab46ddec68e157fe2847` (image `orbes-genome:78959e8516cc`) depuis le 2026-10-04, le déploiement B+C, avec les vingt migrations `0001` à `0020` ([le runbook précédent](DEPLOY-POTENTIEL-2026-10.md), §2). Si un autre déploiement a eu lieu depuis, ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Jamais entre 03:00 et 05:30 UTC** : c'est l'heure des sauvegardes de nuit du serveur partagé (05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite).
2. **Le changement de Caddy est convenu d'abord** avec le responsable de l'hôte partagé (ta session de coordination du serveur, « AI Stack Atlas planning »), avant de fixer le jour : c'est le premier pas du §1.1. Puis, le jour venu, le pré-contrôle et son accord pour l'heure.
3. **Jamais `restore.sh` sur ce serveur** (ta décision du 2026-10-03 ; `.env` dit `RESTORE_ALLOWED=false`). Après la migration, on ne revient pas en arrière : on **répare en avant** (§1.5).
4. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
5. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-live` fusionnée dans `claude/orbes-genome-code-system-o8bmnk`, sa CI verte. Cette fusion ne se fait pas d'un simple mélange des textes : B+C a déjà pris les numéros que la LIVE RELEASE emploie dans les textes légaux et la documentation, et ceux de la LIVE RELEASE passent après les siens ([COMPLIANCE §10.2](../COMPLIANCE.md#102-écarts-déclarés-et-ce-qui-attend), la liste exacte). Cette fusion est faite dans `orbes-live` le 2026-10-05, sa suite complète passée ; restent le push et sa CI verte.
6. **Les pages légales** portent une seule version pour le déploiement D, datée **du jour du déploiement** (`LEGAL_VERSION`), et une version publiée ne change plus : A a publié `2026-10-04`, B+C `2026-10-05`. Sur la branche de la LIVE RELEASE, `LEGAL_VERSION` vaut provisoirement **`2026-10-06`**, la première date que la règle permet, parce que le jour du déploiement n'était pas connu. **Dès que le jour est fixé**, demande à Claude le commit qui pose ce jour dans `LEGAL_VERSION`, dans sa ligne `PUBLISHED` (`genome/test/web/legal.content.test.ts`) et dans la ligne « Version » des brouillons (`docs/legal/terms.*.md`) ; le §1.3 vérifie ensuite que le commit déployé porte la date du jour.
7. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche. Le lien du tableau de la boutique (§1.7) est un secret : il ne se colle nulle part, et celui de l'essai est retiré à la fin.
8. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
9. **La première vraie LIVE RELEASE** attend les vérifications du §1.7. Le serveur tient **1 000 personnes dans la salle**, mesurées le 2026-10-04 sur le profil du serveur ([le rapport de charge](../reports/live-load.md)) : la prévision d'audience de la console le signale au-delà. Avant une sortie qui pourrait en attirer davantage, parles-en à Claude.

---

## 1. Déploiement D

### 1.0 Ce qui change

- **La LIVE RELEASE**, une seconde sorte de sortie, vécue en direct et sans tirage : annoncée dans THE RELEASES avec ses étapes (la silhouette, le nom, la photographie), I'LL BE THERE et son compte public, le fichier .ics et la bannière ; la salle derrière une porte de coffre, qui s'ouvre pour tous à la même seconde ; la file par palier puis dans l'ordre d'une graine scellée ; le tour (maintenir le sceau à l'écran) ; la pièce tenue, ses options et PAY (provisoire : une réservation qu'ORBES Client Services conclut) ; la seconde chance ; le tableau de la boutique par son lien secret. Côté console (Club → Drops) : la création, les réglages, le tableau en direct et ses gestes, la liste d'ORBES Client Services et l'intelligence (planificateur, prévisions, radars, rapport).
- **La migration**, appliquée dans **une seule transaction** : si elle échoue, rien n'est appliqué et le site revient tout seul sur `78959e8516cc`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0021_live_release` | La LIVE RELEASE | le mode d'une sortie (`drops.mode`, `DRAW` par défaut : toutes les sorties existantes) et les réglages d'une LIVE RELEASE ; huit tables : les tailles (`drop_sizes`), les entrées (`live_entries`), les modèles d'accès, les options et celles d'une entrée, l'intérêt (I'LL BE THERE), les messages de la salle et les délais par palier |

  Elle ne casse pas l'image `78959e8516cc` pendant le déploiement (une colonne avec une valeur par défaut constante, des colonnes nullables et des tables qu'elle ignore), mais une fois appliquée on ne revient plus en arrière (ci-dessous).

- **Caddy**, le seul changement de l'hôte, dans le seul bloc de `verify.theorbes.com` : l'exception de 1 200 Ko des envois de photos de la console gagne une route, la silhouette d'une LIVE RELEASE (`POST /api/admin/live/<id>/silhouette`), et les trois flux en direct (la salle d'un téléphone, le tableau de la boutique, le tableau de la console) ne sont plus compressés et passent chaque événement aussitôt. `deploy.sh` valide la configuration avant tout changement, puis recrée Caddy tout seul (son empreinte change) : quelques secondes sans HTTPS.
- **Le moteur** des LIVE RELEASES tourne dans l'application, une passe toutes les 250 ms ; un verrou de la base garantit qu'un seul processus le fait tourner, même pendant le recouvrement d'un déploiement. Rien à faire.
- **Les variables** : aucune à poser. Les limites de requêtes des LIVE RELEASES suivent `RATE_LIMIT_API_PER_MINUTE`, qui ne change pas.
- **Les pages légales** : une seule nouvelle version, datée du jour du déploiement (règle 6) : les conditions d'utilisation (un nouvel article 13, les LIVE RELEASES ; le cercle devient l'article 14 et les suivants avancent d'un rang ; les articles 1, 2, 3, 15 et 16) et la politique de confidentialité (la section « Your LIVE RELEASES » et sa conservation).
- **Une coupure courte** : l'application est arrêtée pendant la migration, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois la migration faite, l'image `78959e8516cc` ne peut plus tourner sur ce schéma. `deploy.sh --image 78959e8516cc` la refuse.

Dans la suite, `<SHA_D>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_D>` ses 12 premiers caractères (le tag de la nouvelle image), et `<AAAA-MM-JJ>` le jour du déploiement.

### 1.1 Avant : le changement de Caddy, le commit, l'heure, le pré-contrôle, l'accord

**1. Le changement de Caddy, convenu d'abord** (quelques jours avant, sans rien lancer). Envoie au responsable de l'hôte, par exemple :

> Proposition pour le déploiement D d'ORBES (la LIVE RELEASE) : un changement du Caddyfile d'ORBES (`deploy/vps/Caddyfile`), dans le seul bloc de verify.theorbes.com. 1) L'exception de 1 200 Ko des envois de photos de la console gagne une route, la silhouette d'une LIVE RELEASE (`POST /api/admin/live/<id>/silhouette`) ; tout le reste garde 64 Ko. 2) Les trois flux en direct des LIVE RELEASES (`/api/v1/live/<id>/stream`, `/api/v1/live/<id>/board/stream`, `/api/admin/live/<id>/stream`, des Server-Sent Events) ne sont plus compressés et passent chaque événement aussitôt (`flush_interval -1`), par un second `reverse_proxy` vers la même application ; tout le reste est servi comme avant. Aucun port, aucun certificat, aucun autre site ne change. `deploy.sh` valide la configuration avant tout changement, puis recrée le conteneur Caddy d'ORBES : quelques secondes sans HTTPS pour verify.theorbes.com. Pendant une sortie en direct, jusqu'à 1 000 connexions longues (un flux par téléphone, un battement toutes les 20 s ; mesuré : 370 Mo au plus pour l'application, sous sa limite de 768 Mo). Avec une migration en une transaction et une coupure courte d'ORBES, hors 03:00–05:30 UTC. D'accord sur le principe ?

Attends son accord sur le changement **avant** de fixer le jour. Puis le jour fixé, demande à Claude le commit de la règle 6.

**2. Le commit et sa CI (sur ton Mac).** Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_D>`, avec une coche verte. Sinon, n'avance pas.

**3. Connecte-toi au serveur** en SSH, comme d'habitude, puis :

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

**4. L'heure.**

```bash
date -u
```

Sortie attendue : le jour prévu, `<AAAA-MM-JJ>`, celui de `LEGAL_VERSION` (règle 6), à une heure **hors** de 03:00–05:30 UTC.

**5. Le pré-contrôle.** Note les quatre résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

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

**6. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

```bash
pgrep -a pg_dump
```

Sortie attendue : **rien**. Une ligne `<numéro> pg_dump …` : une sauvegarde tourne, attends qu'elle finisse et relance la commande.

**7. L'accord pour l'heure.** Envoie au responsable de l'hôte, par exemple : « Déploiement D d'ORBES à <heure> UTC : une migration en une transaction, le changement du Caddyfile convenu (Caddy d'ORBES recréé), une coupure courte d'ORBES. Pré-contrôle : <les quatre résultats>. » Attends son accord.

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

Sortie attendue : `78959e8516cc146a297cab46ddec68e157fe2847 P-BC: the context test expects the salon service among createContext's services` (le commit du déploiement B+C).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=78959e8516cc`.

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

Sortie attendue : **exactement `<SHA_D>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude (règle 5).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 78959e8..<7 caractères>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_D>`.

**Le Caddyfile est celui qui a été convenu** : depuis le déploiement B+C, seul lui a changé dans la pile du serveur.

```bash
git -C /opt/orbes/orbes-index diff --stat 78959e8516cc146a297cab46ddec68e157fe2847 HEAD -- deploy/vps
```

Sortie attendue : une ligne ` deploy/vps/Caddyfile | …`, puis ` 1 file changed, …`. Un autre fichier de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales est celle du jour** (règle 6) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '<AAAA-MM-JJ>';`, le jour de `date -u` (§1.1). Une autre date (par exemple `2026-10-06` un autre jour) : arrête-toi, demande à Claude le commit de la règle 6.

**Deux lectures sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue, exactement ces vingt lignes :

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
   … [deploy.sh] ref HEAD = commit <SHA_D> (tag <TAG_D>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_D>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 78959e8516cc
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : la nouvelle configuration est refusée avant tout changement, le site tourne toujours sur `78959e8516cc`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 20 migration(s) applied, all known to orbes-genome:<TAG_D>
   ```

   **Il faut lire `20 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `78959e8516cc`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_D>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_D>.tar.age
   ```

   **Note le nom de l'archive** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur.

5. **La migration et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_D>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_D>
   Applied 1 migration(s): 0021_live_release
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) et, cette fois, `Container orbes-caddy-1 Recreate` : Caddy est recréé avec la nouvelle configuration, c'est attendu.

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
   … [deploy.sh] deployed orbes-genome:<TAG_D> (previous: 78959e8516cc). This release applied the migration(s) 0021_live_release:
   … [deploy.sh] orbes-genome:78959e8516cc cannot run on this schema any more (scripts/deploy.sh --image 78959e8516cc refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_D> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   **La migration du tableau du §1.0 doit y être nommée.** Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` (par exemple un Caddyfile refusé) | Le déploiement s'est arrêté seul. Le site tourne toujours sur `78959e8516cc`, le schéma et Caddy n'ont pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:78959e8516cc` et `rolled back to 78959e8516cc; the stack is healthy` | La migration n'a pas été appliquée, et le site est revenu tout seul sur `78959e8516cc`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 78959e8516cc is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app` et `docker compose logs --tail 50 caddy`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_D> failed (…) and is KEPT` et `Repair forward:` | La migration est faite, puis quelque chose a échoué (santé, Caddy, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `78959e8516cc`. | `docker compose ps`, puis `docker compose logs --tail 100 app` et `docker compose logs --tail 50 caddy`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_D>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| `caddy is healthy` n'arrive pas, ou HTTPS ne répond plus après la ligne `Recreate` | Caddy n'a pas redémarré avec la nouvelle configuration (elle avait pourtant été validée). | `docker compose logs --tail 50 caddy`, colle la sortie à Claude et préviens le responsable de l'hôte : le site d'ORBES est sans HTTPS tant que Caddy n'est pas reparti. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 78959e8516cc`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_D> OK (previous 78959e8516cc; migrations 0021_live_release)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 21 lignes `applied`, de `0001_initial` à `0021_live_release`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a démarré et tient son verrou. `0` : colle à Claude la sortie de `docker compose logs --tail 200 app`. Le déploiement recrée le conteneur `app` : ses journaux ne portent que sur cette version, quelle que soit l'heure de la commande.

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
head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify
```

Sortie attendue : `413` (un corps de 100 Ko reste refusé par Caddy hors des envois de photos de la console, après sa recréation).

```bash
curl -s https://verify.theorbes.com/api/v1/live
```

Sortie attendue : `{"releases":[]}` tant qu'aucune LIVE RELEASE n'est annoncée.

```bash
curl -s https://verify.theorbes.com/api/v1/live/next
```

Sortie attendue : `{"release":null}` (la bannière ne montre rien).

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/api/v1/live/00000000-0000-4000-8000-000000000000
```

Sortie attendue : `404` (une sortie inconnue, comme une sortie pas encore annoncée).

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/api/v1/live/00000000-0000-4000-8000-000000000000/stream
```

Sortie attendue : `401` : sans compte connecté, aucune vue de la salle (le mode spectateur a été écarté).

**Préviens le responsable de l'hôte** : « Déploiement D d'ORBES fait à <heure> UTC, Caddy recréé avec le changement convenu, tout est healthy. Avant / après : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Une **LIVE RELEASE d'essai**, du début à la fin, avant toute vraie sortie. Il te faut : l'ordinateur pour la console ; deux téléphones, A et B, dont le navigateur **n'est pas connecté à la console** (une fenêtre de navigation privée suffit), chacun connecté à un compte ORBES qui détient une pièce d'un même modèle d'essai ; et un troisième compte ORBES, sans pièce de ce modèle. L'essai est visible dans THE RELEASES pendant une heure et demie environ, réservé aux propriétaires du modèle d'essai : fais-le avant d'annoncer le service, ou à une heure creuse.

**La préparation, dans la console** (`Club` → onglet `Drops` → `New live release`) : le modèle d'essai (avec sa photographie de référence), le titre `TEST LIVE`, `Opening (UTC)` dans 30 minutes, `End of the sales (UTC)` une heure après, `Price of a piece` `1`, `Currency` `EUR`, `Sizes` sur deux lignes, `52 = 1` et `54 = 1`. Sur la page de la sortie : `Access` → les propriétaires du modèle d'essai ; `Add-ons` → une ligne `Engraving | 1` ; `Times (UTC)` → `Edit` : les trois étapes à quelques minutes d'écart, toutes avant l'ouverture de la salle, `Silhouette revealed` dans 10 minutes, `Name revealed` dans 15, `Photograph revealed` dans 20 ; `Silhouette` → `Add` → `Choose a photograph`, une photo de quelques Mo (le dialogue la prépare et affiche `To be sent: …`, bien au-delà de 64 Ko), puis `Save photograph` : `Silhouette saved.`, sans `413` (l'exception de Caddy, §1.0) ; `Publish the release`, sans publication dans le cercle, avant l'heure de la silhouette ; puis `Boutique board` → `Issue the link`, et `Copy the link` (un secret : il ne se colle nulle part, règle 7).

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| L'annonce (choix 9, 12, 30, 37) | Téléphone A | `THE RELEASES` | La carte LIVE RELEASE en tête : `OPENS IN`, le prix `€ 1`, `2 PIECES`, `ONE PER COLLECTOR`, la règle (les propriétaires du modèle) ; `THE REVEALS` si des étapes restent à venir |
| Les étapes et la silhouette (choix 30) | Téléphone A | La page de la sortie, avant puis à chaque heure d'étape, sans la recharger | Avant la première : le sceau sur la plaque, `TO BE REVEALED` à la place du nom, et `THE REVEALS` avec chaque étape et son heure ; à son heure, la silhouette envoyée paraît, puis le nom, puis la photographie du modèle (et, si le modèle est `PUBLIC` dans le lookbook, `SEE THE MODEL` sous le prix, qui ouvre sa fiche) ; chaque étape passée quitte `THE REVEALS` |
| I'LL BE THERE (choix 30) | Téléphone A | Sur la page de la sortie : la taille `52`, puis `I’LL BE THERE` ; puis une autre taille, puis `WITHDRAW`, puis de nouveau `I’LL BE THERE` en `52` | `1 COLLECTOR WILL BE THERE` après le premier geste ; le nombre suit le retrait et le retour |
| ADD TO CALENDAR (choix 9) | Téléphone A | `ADD TO CALENDAR` | Un événement à l'ouverture de la salle, avec un rappel 10 minutes avant |
| La bannière (choix 9) | Téléphone A | L'accueil de `/verify`, puis `MY PIECES` | La bande d'encre : `LIVE RELEASE · … · OPENS IN hh:mm:ss`, qui mène à la sortie |
| Le tableau de la boutique (choix 31) | Ordinateur | Ouvrir le lien copié dans un navigateur, puis `FULL SCREEN` | En paysage : le compte à rebours, la porte fermée, les pièces restantes ; ni personne, ni la salle |
| Le flux, à travers Caddy | Ordinateur (Terminal) | `read -rs ORBES_BOARD` puis coller la partie du lien après `#` et Entrée (rien ne s'affiche) ; puis la commande ci-dessous ; Ctrl-C après quelques secondes ; enfin `unset ORBES_BOARD` | `HTTP/2 200`, `content-type: text/event-stream; charset=utf-8`, **aucune** ligne `content-encoding`, puis aussitôt `retry: 2000` et une ligne `event: board` suivie de sa ligne `data:` |
| Pas éligible (choix 1, 35) | Le troisième compte | La page de la sortie, connecté | La règle et pourquoi : *Your ORBES account does not meet the rule of this release.*, aucun bouton pour entrer |
| Pas de spectateur | Une fenêtre privée, déconnectée | La page de la sortie, salle ouverte | `SIGN IN TO ENTER` et la connexion ; aucun nombre de la salle |
| La salle (choix 7, 16, 21) | Téléphones A et B | À l'ouverture de la salle (5 minutes avant), sur la page : la porte du coffre fermée ; `READY CHECK` ; la taille `52` (déjà choisie sur A) ; `ENTER THE ROOM` | Les cinq coches du `READY CHECK` (signed in, access, size, connection, clock `SYNCED TO ORBES`) ; `2 IN THE ROOM` sur les deux téléphones |
| La dernière minute (choix 22, 23) | Téléphone A, son allumé (`SOUND ON` au pied) | Regarder la dernière minute | Les anneaux du sceau tournent comme une serrure ; un tic doux à chacune des dix dernières secondes |
| T0 (choix 2, 21, 22) | Téléphones A et B | À l'heure | La serrure s'aligne et la porte s'ouvre à la même seconde sur les deux téléphones ; la pièce sous un balayage de lumière ; `DRAWING THE PLACES`, puis `YOUR PLACE` |
| Le tour (choix 5, 8) | Le téléphone dont c'est le tour (le premier de la file en `52`) | `PRESS AND HOLD THE SEAL` : lâcher avant que l'anneau soit plein, puis tenir environ 1,5 s | Lâcher trop tôt remet l'anneau à zéro ; tenu, la révélation : les signes du GENOME, la lueur, l'accord, une vibration sur Android ; puis la pièce tenue, ses options et `PAY` avec son délai |
| Le tableau en direct (choix 3, 29) | Console, la page de la sortie, pendant que la pièce est tenue | `Pause`, puis `Resume` ; `Message` : `Test` ; `Add pieces` : `1` en `54` | Les compteurs suivent les gestes des téléphones ; pendant la pause, `PAUSED` sur les téléphones et le délai de la pièce tenue arrêté ; `Test` sous l'en-tête des téléphones ; le stock de `54` passe à `2`, l'ajout est inscrit au journal (`Audit` : `drop.live.stock`) |
| Prolonger (choix 3) | Console, la page de la sortie, la pièce toujours tenue | `Extend`, `Minutes` : `5`, puis `Extend` | `Release extended.` ; la fin des ventes recule de 5 minutes, dans la note de `Live board` (`end …`) et dans `Times (UTC)` (`End of the sales`) ; inscrit au journal (`Audit` : `drop.live.extend`) ; les téléphones n'affichent pas l'heure de fin, rien n'y change |
| La seconde chance (choix 3, 5) | Les deux téléphones, puis la console | Sur celui qui tient la pièce, avant la fin de son délai, un seul appui sur `RELEASE MY PLACE` ; puis, dans la console, `Free` sur son entrée et `Free the hold` | Le premier appui affiche `TAP AGAIN TO RELEASE` et, sans second appui, le bouton revient à `RELEASE MY PLACE` ; après `Free the hold` : `Hold freed.` dans la console, le premier téléphone lit `YOUR HOLD HAS ENDED`, l'autre `A PIECE HAS RETURNED` et son tour ; inscrit au journal (`Audit` : `drop.live.free`) |
| Les options et PAY (choix 4, 33, 34) | L'autre téléphone, après son tour tenu | Cocher `Engraving`, puis `PAY · € 2` | La page passe à l'ivoire : *Your piece is reserved in size 52…*, la référence `LR-…` et le contact d'ORBES Client Services ; l'entrée dans `MY PIECES` ; sur le premier téléphone, rien ne revient en `52` |
| La fin (choix 10, 26, 32) | Console, un ADMIN | `End now`, taper la phrase demandée (`END <8 caractères>`) | Les téléphones disent la fin (`THE RELEASE HAS ENDED` ou `THIS RELEASE IS OVER`) ; `THE RELEASES` ne liste plus la sortie ; `MY PIECES` garde les entrées ; `curl -s https://verify.theorbes.com/api/v1/live` redonne `{"releases":[]}` |
| ORBES Client Services (choix 4, 26) | Console | `Client Services` : la réservation d'essai → `Cancel the reservation`, avec la note `Test`, puis `Download CSV` | La réservation `CANCELLED` avec ta note ; le fichier CSV ; aucune pièce ne revient à la file |
| L'intelligence (choix 29) | Console | Les panneaux de la page de la sortie terminée, puis le CSV du rapport | Le rapport (le temps de vente, les tours manqués, l'entonnoir, l'ajout de pièces), chaque panneau avec `How it is read` |
| Le lien du tableau | Console, puis l'ordinateur | `Revoke the board’s link`, puis recharger le tableau | `THIS BOARD IS NOT AVAILABLE` |

Trois gestes de la console restent hors de l'essai : `Let in` demande une troisième entrée dans la même taille, l'essai n'en a que deux ; `Remove` est réservé à un ADMIN et retire une entrée pour de bon ; la publication dans le cercle atteindrait de vrais membres. Le second appui de `RELEASE MY PLACE` (`YOUR PLACE IS RELEASED`) n'y est pas non plus : il rend la pièce par le même chemin du serveur que `Free the hold`, et chacune des deux entrées ne finit qu'une fois, l'une par `Free the hold`, l'autre par `PAY`. Les tests les couvrent : `genome/test/api/live-admin.test.ts` (`Let in`, `Remove`, la publication avec le cercle, chaque geste au journal), `genome/test/api/live.test.ts` (`RELEASE MY PLACE` et la seconde chance), `genome/test/api/admin-roles.test.ts` (le rôle exigé par chaque route de la console), `genome/test/web/admin.live.e2e.test.ts` et `genome/test/web/verify.live.e2e.test.ts` (les mêmes gestes, à l'écran).

La commande du flux (sur ton Mac, après `read -rs ORBES_BOARD` ; remplace `<ID>` par l'identifiant de la sortie, dans l'adresse de sa page) :

```bash
curl -sN -D - -H 'accept-encoding: gzip, zstd' -H 'origin: https://verify.theorbes.com' -H 'content-type: application/json' --data "{\"token\":\"$ORBES_BOARD\"}" https://verify.theorbes.com/api/v1/live/<ID>/board/stream
```

La sortie d'essai reste dans la base, terminée (rien ne s'efface) : elle ne paraît plus nulle part en public. Les réservations d'essai se closent `CANCELLED` avec une note ; le lien du tableau est retiré.

### 1.8 Ensuite

- **Pendant une vraie sortie**, la console suit la salle en direct ; le serveur tient 1 000 personnes dans la salle (règle 9). Un œil sur `docker stats --no-stream` pendant la première, pour la mémoire de l'application (370 Mo au plus mesurés à 1 000).
- **Les anciennes images (facultatif).** Une fois le déploiement D stable, les images antérieures à `78959e8516cc` ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_D>` ni `78959e8516cc`) ; la liste d'abord :

  ```bash
  docker images orbes-genome
  ```
