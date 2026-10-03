# Mise en production des recommandations du 2026-10-02

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Les 26 recommandations partent en production en **deux déploiements** :

| Déploiement | Contenu | Commit | État |
|---|---|---|---|
| 1 | Le lot 1 : D-01 à D-06, C-01, C-02 phase 1. Aucune migration. | `db4ffd0c0fd4752c55886d538fdb3c1e6c646d4d` | **Fait** le 2026-10-03 à 01:49 UTC (§1) |
| 2 | Tout le reste : les migrations `0004` à `0013`, l'exception Caddy des photos, les nouvelles variables facultatives, les scripts de déploiement de OPS-D2 | le commit final que te donne le rapport final de Claude | **À faire** (§2) |

Le statut de chaque recommandation est dans [COMPLIANCE §8](../COMPLIANCE.md#8-recommandations-du-2026-10-02). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles, pour les deux déploiements

1. **Jamais entre 03:00 et 05:30 UTC** : c'est l'heure des sauvegardes de nuit du serveur partagé (05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite).
2. **Préviens d'abord le responsable de l'hôte partagé** (ta session de coordination du serveur), avec le pré-contrôle du §2.1, et attends son accord.
3. **Jamais `restore.sh` sur ce serveur** (ta décision du 2026-10-03). Après une migration, on ne revient pas en arrière : on **répare en avant** (§2.5). Une restauration ne se fait que sur un serveur de test séparé.
4. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** sur ce serveur : ces commandes touchent aussi les autres projets de l'hôte, et avec `-a` ou `--volumes` elles peuvent effacer la base et les clés de signature. Une ancienne image se retire par son tag exact (§2.8).
5. **Aucun autre commit que celui indiqué.** Les commits intermédiaires de la branche ne sont pas dans l'ordre des migrations (les recommandations ont été construites en parallèle) : en déployer un ferait appliquer, par exemple, `0008` sans `0007`, et la migration suivante serait refusée.
6. **Les secrets ne se collent jamais dans une conversation.** Chaque étape qui en affiche un dit quoi ranger dans ton gestionnaire de mots de passe. Le déploiement 2 n'en affiche aucun et n'en crée aucun.

---

## 1. Déploiement 1 (lot 1) : fait

Rien à refaire. Pour mémoire :

| | |
|---|---|
| Date | 2026-10-03, 01:49 UTC, après l'accord du responsable de l'hôte et un pré-contrôle frais (`free -h`, `docker stats --no-stream`, `df -h /`) |
| Contenu | D-01 à D-06, C-01, C-02 phase 1 : la carte certificat (mention PROOF), le kit d'emballage, le GENOME en orbite, la police Gravesend, les planchers 10 px / 44 px, le monogramme, l'enregistrement par claim code sur un résultat UNUSUAL ACTIVITY, le contact ORBES Client Services (caché tant que `CLIENT_SERVICES_*` est vide) |
| Commit | `db4ffd0c0fd4752c55886d538fdb3c1e6c646d4d` |
| Ce qui a été lancé | en `orbes`, dans `/opt/orbes/orbes-index/deploy/vps` : le checkout avancé jusqu'à `db4ffd0` (avance rapide), puis `scripts/deploy.sh` |
| Image | `orbes-genome:db4ffd0c0fd4` (la précédente : `orbes-genome:1bd551d91832`) |
| Sauvegarde pré-déploiement | `/var/backups/orbes/daily/orbes-20261003T014918Z-pre-deploy-db4ffd0c0fd4.tar.age` |
| Migrations | aucune : le schéma est resté à `0001`–`0003` |
| Contrôles passés | les tests de fumée de `deploy.sh` ; `/api/v1/health` → `"ok":true` ; une clé ACTIVE dans `/.well-known/orbes-keys.json` ; la police hachée et l'icône d'onglet au monogramme servies ; `GET /api/v1/client-services` → `{}` |

Depuis, le checkout du serveur est resté sur `db4ffd0c0fd4752c55886d538fdb3c1e6c646d4d`, et l'hôte garde trois images `orbes-genome` : `db4ffd0c0fd4` (en service), `1bd551d91832` et `e5a3490d9e47`.

---

## 2. Déploiement 2 : à faire

### 2.0 Ce qui change

- **Dix migrations**, appliquées ensemble dans **une seule transaction** : si l'une échoue, aucune n'est appliquée et le site revient tout seul sur le lot 1.

  | Migration | Recommandation | Contenu |
  |---|---|---|
  | `0004_scan_reports` | C-02 | les réponses des clients à WHERE DID YOU SEE OR BUY THIS PIECE? et la file Cases |
  | `0005_account_recovery` | C-04 | les codes de récupération et le gel des transferts de 72 h |
  | `0006_admin_password_change_required` | A-02 | le mot de passe provisoire du staff, à changer à la première connexion |
  | `0007_print_batch_indexes` | A-03 | les index des planches par lot de production |
  | `0008_retail_mode` | A-08 | le rôle RETAIL, les points de vente, le scan staff |
  | `0009_scan_daily_stats` | A-09 | les statistiques par jour |
  | `0010_models_active` | A-10 | un modèle actif ou retiré du catalogue |
  | `0011_scan_token_transfer_accept` | F-03 | le transfert lié au scan de la pièce |
  | `0012_media` | F-04 | les photos des modèles et des pièces |
  | `0013_ownership_certificates` | F-06 | les certificats de propriété partageables |

- **Caddy** : les deux envois de photo de la console (F-04) acceptent 1 200 Ko ; tout le reste garde la limite de 64 Ko. Caddy est recréé : quelques secondes sans HTTPS.
- **Les scripts** (OPS-D2) : `deploy.sh` répare en avant après une migration, `restore.sh` refuse de tourner quand `.env` dit `RESTORE_ALLOWED=false`, les trois scripts refusent un `ORBES_IMAGE_TAG` ou un `COMPOSE_PROJECT_NAME` égaré dans le shell, et chaque sauvegarde écrit une ligne `photos:`.
- **Les variables** : une seule à poser, `RESTORE_ALLOWED=false` (§2.2). `TRANSFER_ACCEPT_REQUIRE_PRODUCT` reste absente. `CLIENT_SERVICES_*` existe depuis le lot 1 et reste facultative (§3.1). Aucun nouveau secret.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image du lot 1 (`db4ffd0c0fd4`) ne peut plus tourner sur ce schéma. `deploy.sh --image db4ffd0c0fd4` la refuse.

Dans la suite, `<SHA_FINAL>` est le commit final que donne le rapport final de Claude (40 caractères), et `<TAG2>` ses 12 premiers caractères : c'est le tag de la nouvelle image.

### 2.1 Avant : le commit, l'heure, le pré-contrôle, l'accord

**1. Le commit et sa CI (sur ton Mac).** Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_FINAL>`, avec une coche verte. Sinon, n'avance pas.

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

À regarder : la colonne `Use%` de `df -h /` doit être **sous 75 %**. Au-dessus, ne déploie pas : préviens le responsable de l'hôte, et choisissez ensemble un levier ([DEPLOYMENT §15.12](../DEPLOYMENT.md#1512-monitoring-and-routine-checks)). `free -h` doit montrer de la mémoire disponible (`available`), et `docker stats` aucun conteneur qui tourne en continu à plein CPU.

**5. L'accord.** Envoie au responsable de l'hôte, par exemple : « Déploiement 2 d'ORBES à <heure> UTC : dix migrations en une transaction, Caddy recréé (exception de 1 200 Ko sur deux routes d'envoi de photo), une coupure courte d'ORBES. Pré-contrôle : <les quatre résultats>. » Attends son accord.

### 2.2 Préparer le serveur

**1. Rien d'égaré dans le shell.**

```bash
env | grep -E '^(ORBES_IMAGE_TAG|COMPOSE_PROJECT_NAME)='
```

Sortie attendue : **rien**. Si une ligne s'affiche : `unset ORBES_IMAGE_TAG COMPOSE_PROJECT_NAME`, puis relance la commande.

**2. Où en est le checkout.**

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s'
```

Sortie attendue : `db4ffd0c0fd4752c55886d538fdb3c1e6c646d4d Docs: the certificates row of PLATFORM-CONTRACTS §3 says which files say PROOF and how a request's cost is bounded`.

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien** (`.env` et `.state/` sont ignorés par git). Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=db4ffd0c0fd4`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

**4. `RESTORE_ALLOWED=false`** (ta décision : jamais de restauration sur ce serveur). D'abord, vérifie que la ligne n'existe pas encore :

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : **rien**. Dans ce cas, ajoute-la :

```bash
printf '\nRESTORE_ALLOWED=false\n' >> .env
```

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`. (Si la première commande avait affiché `RESTORE_ALLOWED=true`, ouvre `nano .env`, remplace `true` par `false`, enregistre avec Ctrl-O puis Entrée, quitte avec Ctrl-X.) Ce n'est pas un secret : rien à ranger.

### 2.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien si le serveur avait déjà récupéré ce commit.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_FINAL>`** au début de la ligne. Un autre commit (poussé depuis le rapport final) : arrête-toi et demande à Claude. Ne déploie jamais un commit intermédiaire (règle 5).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating db4ffd0..<7 caractères>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_FINAL>`.

**Deux lectures sans risque** avec les nouveaux scripts : elles lisent la base, comme `deploy.sh` le fera, et ne changent rien. Elles vérifient que le `psql` 17 du conteneur PostgreSQL lit bien ces requêtes, ce qui n'a été essayé qu'en CI (avec le `psql` 16).

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue, exactement ces trois lignes :

```text
0001_initial
0002_platform_guards
0003_authentication_events_default
```

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_photo_usage'
```

Sortie attendue : `0 0` (pas encore de table des photos). Une autre sortie, ou un message `ERROR` : arrête-toi et colle-la à Claude. Rien n'a changé.

### 2.4 Déployer

```bash
scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien** pendant que ça tourne, sauf dans le cas du point 1 ci-dessous.

Sortie attendue, dans l'ordre (les heures du début de chaque ligne sont remplacées par `…`). Quatre moments demandent ton attention : la source (point 1), le schéma (point 3), la ligne des photos (point 4) et la fin (point 7).

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_FINAL> (tag <TAG2>)
   ```

   Un autre commit : appuie sur Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction** (les lignes de `docker build`, plusieurs minutes), puis la configuration de Caddy et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG2>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: db4ffd0c0fd4
   ```

3. **Le schéma** (premier contrôle : `deploy.sh` lit les migrations de la base avec `psql` 17, et celles que connaît la nouvelle image avec Node dans `node:22-slim`) :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 3 migration(s) applied, all known to orbes-genome:<TAG2>
   ```

   **Il faut lire `3 migration(s)`.** Si tu lis à la place `ERROR: cannot read the applied migrations (kysely_migration): nothing was changed` ou `ERROR: cannot list the migrations orbes-genome:<TAG2> knows: nothing was changed`, le déploiement s'est arrêté tout seul et le site tourne toujours sur le lot 1 : colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** (deuxième contrôle : la ligne des photos, lue avec `psql` 17 avant que leur table existe) :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: 0, 0.0 MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG2>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG2>.tar.age
   ```

   `keys.tar` compte un fichier par clé de signature : 1, sauf si une clé a tourné depuis le lancement. **Note le nom de l'archive** (`orbes-…-pre-deploy-<TAG2>.tar.age`) : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur. Si tu lis `WARNING: photos: unknown (…)` au lieu de `photos: 0, 0.0 MB`, la sauvegarde continue normalement : laisse finir, et signale-le à Claude après.

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG2>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG2>
   Applied 10 migration(s): 0004_scan_reports, 0005_account_recovery, 0006_admin_password_change_required, 0007_print_batch_indexes, 0008_retail_mode, 0009_scan_daily_stats, 0010_models_active, 0011_scan_token_transfer_accept, 0012_media, 0013_ownership_certificates
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   Entre ces lignes, `docker compose` affiche aussi ses propres lignes (`Container orbes-app-1 …`, `Container orbes-caddy-1 Recreate`…) : c'est normal.

6. **La clé de signature et les tests de fumée** :

   ```text
   … [deploy.sh] ── signing key
   … [deploy.sh] an ACTIVE signing key exists
   … [deploy.sh] ── smoke tests via https://verify.theorbes.com
   … [deploy.sh] health: {"ok":true,"version":"0.1.0"}
   … [deploy.sh] /.well-known/orbes-keys.json lists an ACTIVE key
   … [deploy.sh] /verify: 200
   ```

7. **La fin** (troisième contrôle) :

   ```text
   … [deploy.sh] deployed orbes-genome:<TAG2> (previous: db4ffd0c0fd4). This release applied the migration(s) 0004_scan_reports, 0005_account_recovery, …, 0013_ownership_certificates:
   … [deploy.sh] orbes-genome:db4ffd0c0fd4 cannot run on this schema any more (scripts/deploy.sh --image db4ffd0c0fd4 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   **Les dix migrations doivent y être nommées.** Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`.

### 2.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur le lot 1 (`db4ffd0c0fd4`), le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:db4ffd0c0fd4` et `rolled back to db4ffd0c0fd4; the stack is healthy` | Aucune migration n'a été appliquée (une migration qui échoue n'applique rien, les autres non plus) et le site est revenu tout seul sur le lot 1. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to db4ffd0c0fd4 is NOT healthy either` | Le retour au lot 1 n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG2> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, Caddy, clé, tests de fumée). La nouvelle version reste en place : on ne peut plus revenir au lot 1. | Lance `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les deux sorties. Si la cause est passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG2>`. Sinon, Claude prépare un commit correctif ; quand sa CI est verte, tu refais §2.3 avec ce commit, puis `scripts/deploy.sh`. |

Dans tous les cas : **jamais `restore.sh`** (il refuse de toute façon : `RESTORE_ALLOWED=false`), **jamais `scripts/deploy.sh --image db4ffd0c0fd4`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 2.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

**1. Le journal des déploiements.**

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG2> OK (previous db4ffd0c0fd4; migrations 0004_scan_reports, …, 0013_ownership_certificates)`.

**2. Les trois services.**

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

**3. Les treize migrations, vues par l'application.**

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis treize lignes `applied`, de `0001_initial` à `0013_ownership_certificates`, aucune `PENDING`.

**4. La ligne des photos, sur le nouveau schéma** (`--dry-run` : rien n'est écrit).

```bash
scripts/backup.sh --dry-run
```

Sortie attendue : `… [backup.sh] photos: 0, 0.0 MB`, puis deux lignes `[dry-run] would …`.

**5. `restore.sh` est bien bloqué.** Cette commande ne peut rien changer : il refuse avant toute action, et même sans ce refus, `--dry-run` avec une identité vide ne restaure rien.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… [restore.sh] ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in /opt/orbes/orbes-index/deploy/vps/.env). Decision of 2026-10-03: …`, qui se termine par `Nothing was done.`

**6. Le disque, après.**

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

Compare avec le §2.1 : `/var/backups/orbes` a grossi d'à peu près une archive, et la nouvelle image prend un peu de place (ses couches sont en grande partie partagées avec les précédentes).

**7. Depuis ton Mac** (dans le Terminal, pas sur le serveur) :

```bash
curl -s https://verify.theorbes.com/api/v1/health
```

Sortie attendue : `{"ok":true,"version":"0.1.0"}`.

```bash
head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify
```

Sortie attendue : `413` (un corps de 100 Ko reste refusé par Caddy hors des deux routes de photo).

**8. Préviens le responsable de l'hôte** : « Déploiement 2 d'ORBES fait à <heure> UTC, tout est healthy. Avant / après : <les chiffres>. »

### 2.7 Une vérification réelle par fonctionnalité

Sur un téléphone dont le navigateur **n'est pas connecté à la console** (une fenêtre de navigation privée suffit), et sur l'ordinateur pour la console. Un scan depuis un navigateur connecté à la console est un scan staff : il ne propose ni enregistrement ni signalement.

La plupart de ces vérifications se font d'un coup avec la **checklist de 30 minutes** du [playbook de vente](SALES-PLAYBOOK.md) (§9), sur une pièce test : fais-la après le déploiement, en suivant sa préparation. Ses deux comptes clients de test (A et B) sont les tiens : range l'e-mail et le mot de passe de chacun dans ton gestionnaire de mots de passe (« ORBES /verify — compte test A », « … B »).

| Reco | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| S-07 | Téléphone | Checklist étape 2 : scanner la pièce test avant sa vente | `AUTHENTIC`, onglet OWNERSHIP `NOT YET DELIVERED` ; dans la console, `Anomalies` montre `UNSOLD PIECE SCANNED` |
| A-08 (registre) | Console | `Points of sale` → `New point of sale` (§3.2), puis la checklist étape 3 | La garantie s'active avec un point de vente choisi dans la liste |
| C-01, J-02, F-03 | Téléphone | Checklist étapes 4 et 5 | `REGISTERED TO YOU` ; puis, déconnecté, `AUTHENTIC — REGISTERED` avec la consigne d'achat d'occasion et `I HAVE A TRANSFER CODE` ; le transfert reçu par le compte B après `VERIFY AGAIN` |
| C-02 (phase 2) | Téléphone, puis console | Checklist étape 6 (planche d'essai, page 2) : cette fois, réponds une fois à `WHERE DID YOU SEE OR BUY THIS PIECE?`, avec la note « test déploiement 2 » | Dans `Cases`, le dossier `OPEN` ; ferme-le avec une note (« test ») |
| A-06 | Console | Checklist étape 7 : `Owners` → `Email or REF` → la REF notée | La section `Reference` montre le scan, `Scanned by` le compte B |
| F-01 | Téléphone, compte B | `MY PIECES` | La pièce test dans son écrin ivoire, sa garantie, `CHANGE PASSWORD` |
| F-06 | Téléphone, compte B | `MY PIECES` → `OWNERSHIP CERTIFICATE` → 7 jours → `CREATE LINK` → `COPY LINK` ; ouvre le lien dans une autre fenêtre privée, `DOWNLOAD PDF` ; puis `WITHDRAW` | Le certificat `VALID`, sans e-mail ni nom ; le PDF ; après `WITHDRAW`, le lien ne mène plus à rien. Le lien n'est montré qu'une fois et donne accès au certificat : pour ce test, ne le garde pas |
| F-04 | Console | `Catalogue` → `Photo` sur la ligne du modèle de la pièce test → une vraie photo de référence (les clients la verront) | La vignette dans la colonne `Photo` ; un nouveau scan de la pièce test montre la photo au-dessus du GENOME ; `scripts/backup.sh --dry-run` affiche `photos: 1, <taille> MB` |
| A-04 | Console | `Anomalies` : les filtres `Type` et `Sort`, puis le détail du `UNSOLD PIECE SCANNED` | La chronologie des scans dans le détail ; le badge du lien `Anomalies` compte les signaux OPEN HIGH et CRITICAL |
| A-09 | Console | `Analytics` | La page se charge. Les chiffres comptent les jours complets (UTC) : les scans d'aujourd'hui apparaissent demain |
| A-10 | Console | `Catalogue` → `Edit` sur un modèle | Le dialogue dit combien de pièces émises il touche et montre le bloc d'entretien ; ferme sans enregistrer |
| A-03 | Console | `Codes` → filtre `Production batch` : TEST | `Select the <n> codes of this batch` (`code` au singulier pour une seule pièce), puis l'aperçu des pages A4, sans imprimer |
| A-07 | Console | `Generator` → onglet `Batch` | L'onglet s'ouvre ; ne signe rien (chaque pièce signée reste dans le registre) |
| A-02 | Console | `Team` ; `Change password` au pied de la barre latérale | La liste des comptes ; le dialogue s'ouvre (ferme-le) |
| C-04 | Téléphone, déconnecté | Sous la connexion, `FORGOTTEN PASSWORD?` | L'écran du code de récupération, et le contact ORBES Client Services quand `CLIENT_SERVICES_*` est rempli (§3.1). N'émets un code de récupération (`Owners` → `Recovery code`) que pour un compte test réservé à cet essai : il ferme ses sessions et bloque ses transferts sortants pendant 72 h |
| J-04, J-06 | Téléphone | Le pied de la page d'accueil de /verify : `PRIVACY · TERMS · LEGAL · HELP` ; puis `https://verify.theorbes.com/legal/faq?lang=fr` | Les quatre pages, en français et en anglais (`?lang=en`), sans champ vide visible |

Fais les vérifications de F-01, F-04 et F-06 **avant** l'« Après la séance » du playbook (§9) : il retire la pièce test (elle se lit ensuite REVOKED) et classe le signal `UNSOLD PIECE SCANNED`.

### 2.8 Ensuite : surveiller le disque

Ta décision du 2026-10-03 : les photos restent à 2 000 px et 1 Mo au plus, et on surveille le disque. Elles sont dans la base, donc dans chaque sauvegarde.

- **Chaque semaine** (ou après un ajout de photos) :

  ```bash
  journalctl -u orbes-backup --since yesterday | grep 'photos:'
  ```

  Sortie attendue : `… [backup.sh] photos: <nombre>, <taille> MB`, la ligne de la sauvegarde de la nuit.

  ```bash
  df -h /
  ```

  ```bash
  du -sh /var/backups/orbes
  ```

- **Les seuils** ([DEPLOYMENT §15.12](../DEPLOYMENT.md#1512-monitoring-and-routine-checks)) : `/` au-delà de **75 %**, ou des photos au-delà de **300 Mo** : préviens le responsable de l'hôte **avant** d'agir, et choisissez ensemble un levier (moins d'archives de nuit, les photos sorties de la sauvegarde fréquente, la copie hors site puis moins de copies locales, ou des photos plus petites). À **80 %** : seuil d'alarme (le responsable de l'hôte en a une de son côté).

**Les anciennes images (facultatif).** Une fois le déploiement 2 stable (par exemple le lendemain), les images `orbes-genome:e5a3490d9e47` et `orbes-genome:1bd551d91832` ne peuvent plus servir : elles ne connaissent pas le nouveau schéma. Si tu veux récupérer leur place, retire-les une par une, par leur tag exact, et garde `db4ffd0c0fd4` (la précédente) et `<TAG2>` (la courante) :

```bash
docker images orbes-genome
```

```bash
docker image rm orbes-genome:e5a3490d9e47
```

```bash
docker image rm orbes-genome:1bd551d91832
```

---

## 3. Réglages facultatifs, après le déploiement 2

Chacun se fait quand tu as la donnée, hors 03:00–05:30 UTC, en `orbes` dans `/opt/orbes/orbes-index/deploy/vps`.

### 3.1 Le contact ORBES Client Services (C-02, C-04)

Tant que ces valeurs sont vides, les résultats qui renvoient vers ORBES Client Services n'affichent ni lien, ni téléphone, ni horaires, et `FORGOTTEN PASSWORD?` non plus. Ce sont des coordonnées publiques, pas des secrets : rien à ranger dans le gestionnaire de mots de passe.

Les formats ([DEPLOYMENT §3.1](../DEPLOYMENT.md#31-variables)) : l'e-mail en lettres, chiffres et `. _ + -` ; le téléphone au format international (`+33 1 23 45 67 89`) ; les horaires sur une ligne de 120 caractères au plus, seulement avec l'e-mail ou le téléphone.

**1. Les lignes existent-elles déjà ?**

```bash
grep -n '^CLIENT_SERVICES_' .env
```

Si la commande n'affiche **rien**, ajoute les trois lignes, une commande à la fois, avec tes valeurs entre les apostrophes (une valeur qui contient elle-même une apostrophe se tape plutôt dans `nano .env`, comme ci-dessous) :

```bash
printf '%s\n' 'CLIENT_SERVICES_EMAIL=<e-mail>' >> .env
```

```bash
printf '%s\n' 'CLIENT_SERVICES_PHONE=<téléphone>' >> .env
```

```bash
printf '%s\n' 'CLIENT_SERVICES_HOURS=<horaires>' >> .env
```

Si elle affiche des lignes (même vides), ouvre `nano .env`, complète-les, puis Ctrl-O, Entrée, Ctrl-X.

**2. Vérifie les valeurs avant de redémarrer** : cette commande lance une copie jetable de l'application avec le nouveau `.env`, lit l'état des migrations et ne change rien.

```bash
docker compose run --rm --no-deps -T app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les treize lignes `applied`. Si une valeur est mal formée, tu lis à la place `Invalid configuration:` et le nom de la variable (par exemple `CLIENT_SERVICES_PHONE: must be an international number such as +33 1 23 45 67 89`) : corrige la ligne dans `.env` et relance cette commande. Ne passe pas à l'étape 3 avant d'avoir la sortie attendue.

**3. Applique** (préviens le responsable de l'hôte : même image, aucune migration, l'application redémarre) :

```bash
scripts/deploy.sh
```

Sortie attendue : `orbes-genome:<TAG2> already exists: reusing it`, une sauvegarde `pre-deploy-<TAG2>`, les tests de fumée, puis `redeployed orbes-genome:<TAG2> (same image as before)`.

**4. Vérifie** depuis ton Mac (le contact est en cache 5 minutes) :

```bash
curl -s https://verify.theorbes.com/api/v1/client-services
```

Sortie attendue : `{"email":"…","phone":"…","hours":"…"}` avec tes valeurs. Puis, sur un téléphone, scanne la planche d'essai (page 2) : sous INVALID SIGNATURE, `CONTACT ORBES CLIENT SERVICES` ouvre un e-mail qui cite la REF du résultat.

### 3.2 Les premiers points de vente (A-08)

Dans la console, en ADMIN : `Points of sale` (groupe Clients) → `New point of sale` → `Name` (comme le client le connaît), `City`, `Country` (deux lettres, `FR`) → `Add point of sale`. Ajoute chaque boutique, chaque grand magasin et la boutique en ligne (sans pays). Une boutique fermée se désactive (`Deactivate`), elle ne se supprime jamais. Rien de secret.

### 3.3 Le premier compte vendeur RETAIL (A-08)

Un compte par vendeur, à son nom, jamais partagé. Le vendeur n'aura que `Sale mode`.

**1. Le compte**, dans la console (ADMIN) : `Team` (groupe Security) → `New staff account` → `Email` du vendeur, `Role` : `RETAIL` → `Create account`.

- Le mot de passe provisoire s'affiche **une seule fois** (`Temporary password · shown once`). **Remets-le au vendeur en main propre** (jamais par e-mail, SMS ou conversation), puis clique `I have handed it over — hide`. Tu ne le ranges pas : il ne sert qu'une fois.
- Variante en ligne de commande : le §10 du [playbook](SALES-PLAYBOOK.md), avec `--role RETAIL` ; le vendeur tape lui-même son mot de passe dans `read -rs ADMIN_PASSWORD`.

**2. Son second facteur**, depuis le shell, **en présence du vendeur**, avant sa première connexion :

```bash
docker compose exec app node --import tsx scripts/admin.ts totp-setup --email <e-mail du vendeur>
```

Le secret et son lien `otpauth://` s'affichent une fois : **le vendeur les ajoute lui-même** à l'application d'authentification de son téléphone. Puis :

```bash
read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET
```

Colle le secret affiché (rien ne s'affiche), Entrée, puis :

```bash
clear
```

```bash
docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email <e-mail du vendeur> --code <les 6 chiffres de son application>
```

```bash
unset ADMIN_TOTP_SECRET
```

Le secret TOTP n'est ni rangé, ni photographié, ni collé ailleurs : il vit dans l'application du vendeur. Copie autre chose pour vider ton presse-papiers.

**3. Sa première connexion**, sur le téléphone du comptoir : `https://verify.theorbes.com/admin` → `Email`, le mot de passe provisoire, le code de son application → l'écran `New password` : **le vendeur choisit son propre mot de passe et le range dans son propre gestionnaire de mots de passe**. Toi, tu ne gardes rien. Sur `Team`, sa ligne ne dit plus `TEMPORARY PASSWORD`, et `Two-factor` dit `ENABLED`.

Si tu crées un compte RETAIL **de test pour toi** : son e-mail et son mot de passe vont dans **ton** gestionnaire (« ORBES console — RETAIL test »), et son second facteur dans ton application d'authentification.

**4. L'acceptation d'A-08** : sur le téléphone du comptoir, `Sale mode` → le point de vente (le téléphone s'en souvient) → `SCAN THE PIECE` sur une pièce test → `READY TO SELL` → `ACTIVATE WARRANTY` → `WARRANTY ACTIVE`. Chronomètre : **moins de 20 secondes** de `SCAN THE PIECE` à `WARRANTY ACTIVE`. Note le temps et le téléphone utilisé.

Si `ADMIN_ALLOWED_IPS` restreint un jour la console, le réseau de chaque boutique doit y figurer, sinon le mode Boutique répond 403 au comptoir ([LAUNCH §4](../LAUNCH.md#4-secure-the-admin-account)).

### 3.4 Les codes de récupération des clients (C-04, A-06)

Après la vérification d'identité (playbook §6, à finaliser avec ton juriste) : `Owners` → la ligne du client → `Recovery code` (ADMIN). Le code s'affiche une fois : **lis-le au client**, qui le tape sous `FORGOTTEN PASSWORD?` dans les 30 minutes. Il appartient au client : ne l'écris nulle part, ne l'envoie pas, ne le range pas.

---

## 4. Ce qui reste après ces déploiements

Ce qui attend une donnée, une décision ou une validation de ta part est listé dans [COMPLIANCE §8.2](../COMPLIANCE.md#82-ce-qui-attend-le-propriétaire) : l'identité légale, la durée de conservation des scans, la validation de marque de la carte et du kit (mention PROOF), la revue juridique, les essais sur de vrais téléphones et l'impression physique. La pull request vers `main` ([LAUNCH §9](../LAUNCH.md#9-switch-on-theorbescomverify)) reste une décision à part, avec ton accord explicite.
