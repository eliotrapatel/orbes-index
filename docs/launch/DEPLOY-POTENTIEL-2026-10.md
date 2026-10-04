# Mise en production du lot « Potentiel » (2026-10)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Les douze éléments du lot « Potentiel » (choisis le 2026-10-03) partent en production en **trois déploiements**, dans l'ordre du plan :

| Déploiement | Éléments | Migrations | État |
|---|---|---|---|
| A | P-R02, P-R03, P-R04, P-X01, P-X02, P-X04 | `0014` à `0018`, et l'exception Caddy des nouveaux envois de photos | **À faire** (§1) |
| B | P-D01, P-M02, P-R06, P-X08 | `0019` et `0020` | À faire, après A (§2) |
| C | P-D07, P-D10 | aucune | À faire, après B (§3) |

Le point de départ : la production tourne le commit `3660154006b5016509856930a0255377584a6084` (image `orbes-genome:3660154006b5`) depuis le 2026-10-03 à 19:44 UTC, avec les treize migrations `0001` à `0013` ([le runbook précédent](DEPLOY-RECOMMANDATIONS-2026-10.md), §3.5). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles, pour les trois déploiements

1. **Jamais entre 03:00 et 05:30 UTC** : c'est l'heure des sauvegardes de nuit du serveur partagé (05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite).
2. **Préviens d'abord le responsable de l'hôte partagé** (ta session de coordination du serveur), avec le pré-contrôle du §1.1, et attends son accord.
3. **Jamais `restore.sh` sur ce serveur** (ta décision du 2026-10-03 ; `.env` dit `RESTORE_ALLOWED=false`). Après une migration, on ne revient pas en arrière : on **répare en avant** (§1.5). Une restauration ne se fait que sur un serveur de test séparé.
4. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** sur ce serveur : ces commandes touchent aussi les autres projets de l'hôte. Une ancienne image se retire par son tag exact (§1.8).
5. **Aucun autre commit que celui indiqué.** Chaque déploiement part du commit final de son étape, que te donne le rapport de Claude, sa CI verte : un commit intermédiaire n'a pas toutes les migrations de l'étape.
6. **Les secrets ne se collent jamais dans une conversation.** Aucun de ces trois déploiements n'en crée ni n'en affiche.
7. **Les pages légales** portent une seule version par déploiement, datée du jour du déploiement (`LEGAL_VERSION`, posée dans le commit final de l'étape) : si la date prévue glisse, demande à Claude un commit qui la recale avant de déployer.

---

## 1. Déploiement A : à faire

### 1.0 Ce qui change

- **Les migrations**, appliquées ensemble dans **une seule transaction** : si l'une échoue, aucune n'est appliquée et le site revient tout seul sur `3660154006b5`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0014_model_lookbook` | P-R02 | le lookbook des modèles : l'adresse de la fiche (`slug`), sa place (cachée, publique ou réservée aux propriétaires), le récit, les spécifications, la date de publication, et la galerie de photos (`model_images`, 8 au plus par modèle) |
  | `0015_drops` | P-R03 | les sorties (drops) et leurs inscriptions : la règle du tirage, la graine chiffrée puis révélée, les places tenues 48 h |
  | `0016_circle` | P-X01 | le cercle des propriétaires : les publications par palier (note, invitation, sondage), leurs photos (4 au plus), les réponses aux invitations, les votes et les visites par jour (sans compte) |
  | `0017_drop_early_access` | P-X02 | l'accès anticipé d'une sortie (`drops.early_access_hours`, 48 h par défaut, de 0 à 336) : PLATINE et PALLADIUM y réservent directement une place avant l'ouverture à tous, le reste part au tirage |

  Chaque migration de l'étape s'ajoute à ce tableau avec son élément (`0015` à `0018` : P-R03, P-X01, P-X02, P-X04).

- **Caddy** : l'exception de 1 200 Ko des envois de photos de la console s'étend à la galerie d'un modèle (P-R02) ; tout le reste garde la limite de 64 Ko. `deploy.sh` valide la configuration, puis recrée Caddy tout seul (son empreinte change) : aucune étape à la main, quelques secondes sans HTTPS.
- **Les photos** ont désormais leur propre budget de requêtes, cinq fois celui de l'API (600 par minute et par adresse avec le réglage par défaut), car une fiche du lookbook en montre jusqu'à neuf : aucune variable à poser.
- **Les variables** : aucune à poser. `CLIENT_SERVICES_*` et `SCAN_RETENTION_DAYS` ne changent pas.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `3660154006b5` ne peut plus tourner sur ce schéma. `deploy.sh --image 3660154006b5` la refuse.

Dans la suite, `<SHA_A>` est le commit final de l'étape A (40 caractères) que donne le rapport de Claude, et `<TAG_A>` ses 12 premiers caractères : c'est le tag de la nouvelle image.

### 1.1 Avant : le commit, l'heure, le pré-contrôle, l'accord

**1. Le commit et sa CI (sur ton Mac).** Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_A>`, avec une coche verte. Sinon, n'avance pas.

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

**5. L'accord.** Envoie au responsable de l'hôte, par exemple : « Déploiement A d'ORBES à <heure> UTC : les migrations du lot en une transaction, Caddy recréé (l'exception de 1 200 Ko s'étend aux nouveaux envois de photos de la console), une coupure courte d'ORBES. Pré-contrôle : <les quatre résultats>. » Attends son accord.

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

Sortie attendue : `3660154006b5016509856930a0255377584a6084 Console: Documents sits in Overview and the sidebar keeps SIGN OUT on a 900 px screen; code in the documents uses the console's --mono`.

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien** (`.env` et `.state/` sont ignorés par git). Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=3660154006b5`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

**4. `RESTORE_ALLOWED=false`**, posé au déploiement 2 :

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`. Une autre sortie : arrête-toi et demande à Claude.

### 1.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien si le serveur avait déjà récupéré ce commit.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_A>`** au début de la ligne. Un autre commit (poussé depuis le rapport) : arrête-toi et demande à Claude. Ne déploie jamais un commit intermédiaire (règle 5).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 3660154..<7 caractères>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_A>`.

**Deux lectures sans risque** : elles lisent la base, comme `deploy.sh` le fera, et ne changent rien.

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue, exactement ces treize lignes :

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
```

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_photo_usage'
```

Sortie attendue : deux nombres, celui des photos et leur taille en octets (par exemple `1 312456`). Note-les. Un message `ERROR` : arrête-toi et colle-le à Claude. Rien n'a changé.

### 1.4 Déployer

```bash
scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien** pendant que ça tourne, sauf dans le cas du point 1 ci-dessous.

Sortie attendue, dans l'ordre (les heures du début de chaque ligne sont remplacées par `…`). Quatre moments demandent ton attention : la source (point 1), le schéma (point 3), les migrations (point 5) et la fin (point 7).

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_A> (tag <TAG_A>)
   ```

   Un autre commit : appuie sur Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction** (les lignes de `docker build`, plusieurs minutes), puis la configuration de Caddy et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_A>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 3660154006b5
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 13 migration(s) applied, all known to orbes-genome:<TAG_A>
   ```

   **Il faut lire `13 migration(s)`.** Si tu lis à la place `ERROR: cannot read the applied migrations (kysely_migration): nothing was changed` ou `ERROR: cannot list the migrations orbes-genome:<TAG_A> knows: nothing was changed`, le déploiement s'est arrêté tout seul et le site tourne toujours sur `3660154006b5` : colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_A>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_A>.tar.age
   ```

   **Note le nom de l'archive** (`orbes-…-pre-deploy-<TAG_A>.tar.age`) : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur.

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_A>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_A>
   Applied 4 migration(s): 0014_model_lookbook, 0015_drops, 0016_circle, 0017_drop_early_access
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

7. **La fin** :

   ```text
   … [deploy.sh] deployed orbes-genome:<TAG_A> (previous: 3660154006b5). This release applied the migration(s) 0014_model_lookbook, 0015_drops, 0016_circle, 0017_drop_early_access:
   … [deploy.sh] orbes-genome:3660154006b5 cannot run on this schema any more (scripts/deploy.sh --image 3660154006b5 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_A> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   **Toutes les migrations du tableau du §1.0 doivent y être nommées.** Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `3660154006b5`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:3660154006b5` et `rolled back to 3660154006b5; the stack is healthy` | Aucune migration n'a été appliquée (une migration qui échoue n'applique rien, les autres non plus) et le site est revenu tout seul sur `3660154006b5`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 3660154006b5 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_A> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, Caddy, clé, tests de fumée). La nouvelle version reste en place : on ne peut plus revenir à `3660154006b5`. | Lance `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les deux sorties. Si la cause est passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_A>`. Sinon, Claude prépare un commit correctif ; quand sa CI est verte, tu refais §1.3 avec ce commit, puis `scripts/deploy.sh`. |

Dans tous les cas : **jamais `restore.sh`** (il refuse de toute façon : `RESTORE_ALLOWED=false`), **jamais `scripts/deploy.sh --image 3660154006b5`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

**1. Le journal des déploiements.**

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_A> OK (previous 3660154006b5; migrations 0014_model_lookbook, 0015_drops, 0016_circle, 0017_drop_early_access)`.

**2. Les trois services.**

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

**3. Les migrations, vues par l'application.**

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 17 lignes `applied`, de `0001_initial` à `0017_drop_early_access`, aucune `PENDING`.

**4. La ligne des photos, sur le nouveau schéma** (`--dry-run` : rien n'est écrit).

```bash
scripts/backup.sh --dry-run
```

Sortie attendue : `… [backup.sh] photos: <nombre>, <taille> MB`, les mêmes qu'au §1.3, puis deux lignes `[dry-run] would …`.

**5. `restore.sh` est toujours bloqué.** Cette commande ne peut rien changer : il refuse avant toute action.

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

Compare avec le §1.1 : `/var/backups/orbes` a grossi d'à peu près une archive, et la nouvelle image prend un peu de place.

**7. Depuis ton Mac** (dans le Terminal, pas sur le serveur) :

```bash
curl -s https://verify.theorbes.com/api/v1/health
```

Sortie attendue : `{"ok":true,"version":"0.1.0"}`.

```bash
head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify
```

Sortie attendue : `413` (un corps de 100 Ko reste refusé par Caddy hors des envois de photos de la console).

```bash
curl -s https://verify.theorbes.com/api/v1/lookbook
```

Sortie attendue : `{"models":[]}` tant qu'aucun modèle n'est publié (§1.7).

```bash
curl -s -o /dev/null -D - https://verify.theorbes.com/api/v1/media/0000000000000000000000000000000000000000000000000000000000000000
```

Sortie attendue : `HTTP/2 404`, et parmi les en-têtes `x-ratelimit-limit: 600` (le budget des photos, §1.0).

**8. Préviens le responsable de l'hôte** : « Déploiement A d'ORBES fait à <heure> UTC, tout est healthy. Avant / après : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Sur un téléphone dont le navigateur **n'est pas connecté à la console** (une fenêtre de navigation privée suffit), et sur l'ordinateur pour la console.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| P-R02 | Console | `Catalogue` → `Lookbook` sur la ligne d'un modèle → `Edit` sous `Publication` : `Public`, son adresse (proposée d'après le nom) ; puis `Edit story` (l'aperçu suit ce que tu tapes), `Edit specifications` (une ligne `Libellé: valeur`, sans chiffre dans le libellé), `Add a photograph` | La page du modèle dit `PUBLIC`, son adresse `/verify/lookbook/<adresse>` et sa date de publication ; la galerie montre la photo |
| P-R02 | Téléphone | Sur l'accueil, `THE COLLECTION` ; puis `SEE THE MODEL` sous la carte du modèle ; puis le bouton retour | La grille, le modèle dans sa collection ; sa fiche (photos, récit, spécifications, entretien) ; le retour ramène à la grille, puis à l'accueil |
| P-R02 | Téléphone | Scanner une pièce de ce modèle | Sous le résultat AUTHENTIC, `SEE THE MODEL` mène à sa fiche |
| P-R02 | Téléphone, compte d'un propriétaire | Un second modèle en `Reserved` dans la console, puis `THE COLLECTION` connecté | La section `RESERVED FOR OWNERS` ; déconnecté, elle n'apparaît pas et sa fiche dit `This model is not in the ORBES collection.` |

Les vérifications de P-R03, P-R04, P-X01, P-X02 et P-X04 s'ajoutent à ce tableau avec leurs éléments.

### 1.8 Ensuite : surveiller le disque

Les photos de la galerie (8 au plus par modèle) sont dans la base, donc dans chaque sauvegarde (environ 22 copies).

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

- **Les seuils** ([DEPLOYMENT §15.12](../DEPLOYMENT.md#1512-monitoring-and-routine-checks)) : `/` au-delà de **75 %**, ou des photos au-delà de **300 Mo** (environ 6 à 7 Go de sauvegardes) : préviens le responsable de l'hôte **avant** d'agir, et choisissez ensemble un levier. À **80 %** : seuil d'alarme (le responsable de l'hôte en a une de son côté).

**Les anciennes images (facultatif).** Une fois le déploiement A stable, les images antérieures à `3660154006b5` ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_A>` ni `3660154006b5`) ; la liste d'abord :

```bash
docker images orbes-genome
```

---

## 2. Déploiement B : après A

À compléter par ses éléments (P-D01, P-M02, P-R06, P-X08), sur le modèle du §1 : les migrations `0019` (P-R06) et `0020` (P-X08) en une transaction ; `CARE_SUBSCRIBE_URL` (P-M02), une variable facultative qui reste vide jusqu'au lien Whop ; la version des pages légales du jour de B (une seule si A et B tombent le même jour). Après B, on répare en avant, comme après A.

## 3. Déploiement C : après B

À compléter par ses éléments (P-D07, P-D10), sur le modèle du §1 : aucune migration ; la version des pages légales du jour de C (la préférence du son). Après C, l'image précédente reste possible (`scripts/deploy.sh --image <le tag de B>`), puisque C ne touche pas au schéma.
