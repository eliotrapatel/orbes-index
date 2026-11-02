# Mise en production du lot EXPORT SMART MODEL

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`, jamais le jeton).

Le lot EXPORT SMART MODEL (ta décision du 31 octobre 2026 : la lecture devient automatique) donne à ORBES Smart Model une adresse en lecture seule, qu'il lit tout seul toutes les heures. Il part en **deux étapes** :

| Étape | Ce qui se passe | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| Le déploiement | La nouvelle version, l'adresse **fermée** (404) | aucune | deux variables passées à l'application par `compose.yaml`, vides | **À faire** (§1) |
| L'ouverture | Le jeton, les deux lignes du `.env`, l'application recréée, le secret dans Cloudflare | aucune | deux lignes dans ton `.env` | **Après le déploiement** (§2) |

Le point de départ : la production tourne PURGE, son commit `b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb` (image `orbes-genome:b7c2bfdd4f4b`, déployée le 31 octobre 2026 à 18:28 à Paris (17:28 UTC)), avec les 68 migrations de `0001_initial` à `0067_platform_reset`. Avant le jour, Claude remplace dans ce document `<SHA_EXPORT>` et `<TAG_EXPORT>` par le commit final du lot (40 caractères) et ses 12 premiers caractères : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `b7c2bfdd4f4b`, ce document ne s'applique pas tel quel : demande à Claude de le recaler.

## 0. Les règles

1. **Ton accord d'abord.** Sans lui, rien n'est fusionné ni déployé. Aucun écran ne change : ni la console, ni l'application du collectionneur.
2. **Les heures** : jamais entre 04:00 et 06:30 à Paris (03:00–05:30 UTC en hiver), ni pendant les minutes de sauvegarde du hub, 03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC en hiver). Chaque heure de ce document est d'abord celle de Paris, l'heure UTC entre parenthèses.
3. **Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin**, et **aucun test de TEST ENTRANTS** en cours : le redémarrage les couperait.
4. **Le seul changement de l'hôte** : `compose.yaml` passe deux variables de plus à l'application, `SMART_MODEL_EXPORT_TOKEN_SHA256` et `SMART_MODEL_EXPORT_KEY`, vides tant que ton `.env` ne les a pas. Rien d'autre : ni Caddyfile, ni port, ni certificat, ni limite, ni volume, ni réseau. Le responsable de l'hôte (AI Stack Atlas) est prévenu au lancement.
5. **Aucune migration** : la base ne change pas. Le retour en arrière reste possible (`scripts/deploy.sh --image b7c2bfdd4f4b`).
6. **Le jeton ne quitte jamais ton Mac et Cloudflare.** Il ne se colle jamais dans une conversation, ni sur le serveur : le serveur n'a que son empreinte. La clé des empreintes (`SMART_MODEL_EXPORT_KEY`) se fabrique sur le serveur, sans s'afficher, **une seule fois** : ne la change jamais, sinon chaque client et chaque commande changeraient d'empreinte dans Smart Model.
7. **Jamais `restore.sh`**, jamais de `docker image prune`, `docker system prune` ni `docker volume prune`.
8. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh`.
9. **Les pages légales ne changent pas** dans ce lot (ton choix du 2 novembre : la phrase sur Cloudflare viendra plus tard ; aucune vente n'est comptée avant le 1er janvier 2027). `LEGAL_VERSION` reste `2026-10-27`.

---

## 1. Le déploiement

### 1.0 Ce qui change

- **L'adresse** `https://verify.theorbes.com/api/export/v1/smart-model`, en lecture seule. Elle répond exactement ce que le script du Mac (`orbes-sync.mjs` v1.2.0) enverrait : les ventes payées depuis un jour donné, le stock, les modèles, tes taux de change. Chaque client et chaque commande y sont remplacés par une empreinte ; seul l'e-mail du compte sort. Aucun nom, adresse, téléphone, gravure, note ni numéro de suivi. Les comptes de test sont exclus.
- **Fermée tant que ton `.env` n'a pas ses deux lignes** : elle répond 404, comme une adresse qui n'existe pas.
- **Ses refus** : sans le bon jeton, 401 ; après 10 mauvais jetons en une heure depuis un même réseau, 429 pendant une heure ; pendant une LIVE RELEASE (ou dans le quart d'heure avant sa salle), entre 04:00 et 06:30 à Paris, ou pendant qu'une lecture est déjà en cours, 503, et Smart Model revient 15 minutes plus tard.
- **La base n'est jamais modifiée** : une seule transaction en lecture seule, terminée par un retour en arrière.

### 1.1 Avant : ton accord, la CI, l'heure

**1. La CI (sur ton Mac).** Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-export>. Le dernier passage de `genome-ci` sur `<SHA_EXPORT>` doit avoir une coche verte.

**2. La branche de déploiement (sur ton Mac)**, sur ton accord seulement : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_EXPORT>` exactement. Claude te donne la commande ; il ne la lance pas.

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

Il ne s'affiche rien.

**4. L'heure.**

```bash
date -u
```

Sortie attendue : une heure hors de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**5. Le pré-contrôle.** Note les six résultats pour le responsable de l'hôte.

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

À regarder : `Use%` de `df -h /` **sous 75 %**, de la mémoire disponible, la charge d'`uptime` sous le nombre de `nproc`.

**6. Aucune sauvegarde, aucune LIVE RELEASE, aucun test en cours.**

```bash
pgrep -a pg_dump
```

Sortie attendue : **rien**.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

Sortie attendue : `0`.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from test_runs where ended_at is null"'
```

Sortie attendue : `0`.

### 1.2 Préparer le serveur

```bash
env | grep -E '^(ORBES_IMAGE_TAG|COMPOSE_PROJECT_NAME)='
```

Sortie attendue : **rien**.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s'
```

Sortie attendue : `b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb` au début de la ligne.

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**.

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=b7c2bfdd4f4b`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy b7c2bfdd4f4b OK (previous ecbb448cb2ee; migrations 0066_test_purge, 0067_platform_reset)`.

```bash
grep -c '^SMART_MODEL_EXPORT_' .env
```

Sortie attendue : `0` (ton `.env` ne les a pas encore : elles viennent au §2).

### 1.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_EXPORT>`** au début de la ligne.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating b7c2bfd..<7 caractères de SHA_EXPORT>`, puis `Fast-forward`.

**Le seul changement de la pile** (règle 4) :

```bash
git -C /opt/orbes/orbes-index diff --name-status b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb HEAD -- deploy/vps
```

Sortie attendue : exactement ces deux lignes :

```text
M	deploy/vps/.env.example
M	deploy/vps/compose.yaml
```

```bash
git -C /opt/orbes/orbes-index diff b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb HEAD -- deploy/vps/compose.yaml | grep '^[-+] '
```

Sortie attendue : exactement ces quatre lignes, rien qui commence par `-` :

```text
+      # ORBES Smart Model's export (lot EXPORT SMART MODEL): empty = closed (404). The token's SHA-256 and
+      # the fingerprints' key go in .env on the server, never in chat (genome/.env.example).
+      SMART_MODEL_EXPORT_TOKEN_SHA256: ${SMART_MODEL_EXPORT_TOKEN_SHA256:-}
+      SMART_MODEL_EXPORT_KEY: ${SMART_MODEL_EXPORT_KEY:-}
```

**Aucune migration** (règle 5) :

```bash
git -C /opt/orbes/orbes-index diff --name-status b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb HEAD -- genome/src/server/db/migrations
```

Sortie attendue : **rien**.

**Les pages légales, inchangées** (règle 9) :

```bash
git -C /opt/orbes/orbes-index diff --name-status b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb HEAD -- genome/src/web/legal
```

Sortie attendue : **rien**.

### 1.4 Déployer

Hors des heures des règles 2 et 3. **Juste avant**, relance la requête des LIVE RELEASES du §1.1, point 6 : `0`, sinon attends.

**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement EXPORT SMART MODEL lancé à <heure> Paris (<heure> UTC), aucune migration ; compose.yaml passe deux variables de plus à l'application, vides pour l'instant ; ensuite deux lignes dans le .env et l'application recréée. » Ajoute-y l'image, `orbes-genome:<TAG_EXPORT>`, et les six résultats du pré-contrôle.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Sortie attendue, dans l'ordre :

1. `… [deploy.sh] ref HEAD = commit <SHA_EXPORT> (tag <TAG_EXPORT>)`. Un autre commit : Ctrl-C immédiatement.
2. `… [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)` puis `previous image tag: b7c2bfdd4f4b`.
3. `… [deploy.sh] schema: 68 migration(s) applied, all known to orbes-genome:<TAG_EXPORT>`.
4. La sauvegarde pré-déploiement (`backup complete: …`).
5. `stopping the running app before migrating to <TAG_EXPORT>`, `Schema is up to date.`, `database ready: …`, puis `app is healthy` et `caddy is healthy`.
6. `an ACTIVE signing key exists`, `health: {"ok":true,"version":"0.1.0"}`, `/verify: 200`.
7. `… [deploy.sh] deployed orbes-genome:<TAG_EXPORT> (previous: b7c2bfdd4f4b). Manual rollback: scripts/deploy.sh --image b7c2bfdd4f4b`.

Puis :

```bash
echo $?
```

Sortie attendue : `0`.

### 1.5 Si quelque chose ne va pas

Colle à Claude la sortie complète de `deploy.sh`. Un `ERROR: …` avant `── roll out`, avec `nothing was changed` : le site tourne toujours sur `b7c2bfdd4f4b`, ne fais rien d'autre. Si la nouvelle version tourne mais ne va pas à l'usage, le retour en arrière est possible (aucune migration) : `scripts/deploy.sh --image b7c2bfdd4f4b`, sur l'avis de Claude.

### 1.6 Juste après

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_EXPORT> OK (previous b7c2bfdd4f4b)`, sans migration.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

**Sur ton Mac**, l'adresse est là et fermée :

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://verify.theorbes.com/api/export/v1/smart-model?since=2027-01-01&page=0'
```

Sortie attendue : `404`.

---

## 2. L'ouverture (juste après le déploiement, ou plus tard)

### 2.1 Le jeton, sur ton Mac

Dans le **Terminal de ton Mac**, jamais dans une conversation. **Garde cette fenêtre ouverte jusqu'au §2.4.**

```bash
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
```

Il ne s'affiche rien.

```bash
printf %s "$TOKEN" | shasum -a 256 | cut -c1-64
```

Sortie attendue : **64 caractères** de `0` à `9` et de `a` à `f`. C'est l'empreinte du jeton : tu la colles au §2.2, sur le serveur.

### 2.2 Les deux lignes du `.env`, sur le serveur

Toujours en `orbes`, dans `/opt/orbes/orbes-index/deploy/vps`. D'abord une copie du `.env`, avec les mêmes droits :

```bash
cp -p .env .env.before-smart-model
```

L'empreinte du jeton : remplace `COLLE_L_EMPREINTE_ICI` par les 64 caractères du §2.1, **entre les apostrophes**.

```bash
printf 'SMART_MODEL_EXPORT_TOKEN_SHA256=%s\n' 'COLLE_L_EMPREINTE_ICI' >> .env
```

La clé des empreintes, fabriquée ici, sans s'afficher, **une seule fois** (règle 6) :

```bash
printf 'SMART_MODEL_EXPORT_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
```

La vérification, sans rien afficher des valeurs :

```bash
grep -cE '^SMART_MODEL_EXPORT_TOKEN_SHA256=[0-9a-f]{64}$' .env; grep -cE '^SMART_MODEL_EXPORT_KEY=[0-9a-f]{64}$' .env; grep -c '^SMART_MODEL_EXPORT_' .env
```

Sortie attendue : `1`, `1`, `2`. Autre chose : **ne recrée pas l'application** (elle refuserait de démarrer avec une ligne mal formée). Remets la copie (`cp -p .env.before-smart-model .env`) et demande à Claude.

### 2.3 Recréer l'application

L'application est coupée quelques secondes (rien d'autre ne redémarre). Hors des heures des règles 2 et 3, comme pour le déploiement.

```bash
docker compose up -d app
```

Sortie attendue : `Container orbes-app-1  Recreated`, puis `Started`.

```bash
docker compose ps
```

Sortie attendue : `app` `Up … (healthy)` (attends jusqu'à une minute), `caddy` et `postgres` inchangés.

Une ligne au responsable de l'hôte : « ORBES : deux lignes ajoutées au .env (SMART_MODEL_EXPORT_*), application recréée à <heure> Paris (<heure> UTC), saine. »

**Sur ton Mac**, dans la fenêtre du §2.1 :

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://verify.theorbes.com/api/export/v1/smart-model?since=2027-01-01&page=0'
```

Sortie attendue : `401` (l'adresse est ouverte, et refuse sans le jeton).

```bash
curl -s -H "Authorization: Bearer $TOKEN" 'https://verify.theorbes.com/api/export/v1/smart-model?since=2027-01-01&page=0' | head -c 120; echo
```

Sortie attendue : une ligne qui commence par `{"ok":true,"format":"orbes-console/2","snapshot":`. Ne la colle pas : dis seulement à Claude si elle commence ainsi.

Quand tout est bon, sur le serveur :

```bash
rm .env.before-smart-model
```

### 2.4 Cloudflare

Dans la fenêtre du §2.1, copie le jeton :

```bash
printf %s "$TOKEN" | pbcopy
```

Puis dans Cloudflare : **Workers & Pages** → `orbes-smart-model` → **Settings** → **Variables and Secrets** → **Add**. Type **Secret**, nom `ORBES_EXPORT_TOKEN`, valeur : colle le jeton. Puis **Deploy**. Seul ce Worker est touché.

Ensuite, ferme la fenêtre du Terminal : le jeton n'est plus que dans Cloudflare.

### 2.5 Smart Model

Ouvre **Sales → ORBES console** : la ligne **Every hour** indique la première lecture, quelques secondes plus tard. Le bouton **Read the console now** relance une lecture. Si le jeton est refusé (`token`), la page le dit et les lectures s'arrêtent : refais le §2.1 à 2.4 avec un nouveau jeton (la clé des empreintes, elle, ne change pas : ne refais pas sa ligne du §2.2, remplace seulement celle de l'empreinte).
