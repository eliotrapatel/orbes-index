# Mise en production du lot suivant (déploiements H1 et H2)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot suivant (plan du 2026-10-07) part en production en **deux déploiements**, après les neuf suivants (le déploiement G, [son runbook](DEPLOY-NEXT-NINE.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| H1 | La ligne de la variante, la carte 79t, les tailles par modèle, NEW CLAIM CODE (plan §3.1 à §3.4) | `0033` et `0034` | aucun | **À faire** |
| H2 | LOGISTICS, les commandes aux fournisseurs, les réceptions, l'agent, et le côté du collectionneur (plan §3.5 et §3.6) | `0035` à `0039` | aucun | **À faire, après H1** (§2) |

Le point de départ de H1 : la production tourne G, le commit `52c1c8c65e0dd482480030197ec6e250887ab251` (image `orbes-genome:52c1c8c65e0d`, mise en service le 2026-10-07 à 23:26 à Paris, 21:26 UTC), avec les trente-trois migrations de `0001_initial` à `0032_growth_indexes`. La branche du lot est partie du dernier commit des neuf suivants remis avant G (`a68a9af`) ; le commit de G (`52c1c8c`, les trois défauts de la fusion et les deux échecs de la CI) y est fusionné avant la remise de H1, sans autre changement. Si un autre déploiement a eu lieu depuis, ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les captures d'abord.** Avant la fusion, tu regardes les captures que liste le rapport de Claude : la ligne de la variante (le résultat, l'onglet PRODUCT, la pièce, MY PIECES, la page du certificat partagé), la carte 79t à côté de son `front.png` et une planche A4 de huit, les tailles dans la console (le type, les tailles cochées, une taille mise de côté, le stock à 0), NEW CLAIM CODE dans la console (ses deux fenêtres, la section `New claim codes`) et YOUR NEW CLAIM CODE dans YOUR ORDERS (avant et après SHOW THE CODE, au format téléphone et au format bureau). Sans ton accord, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite. Si cela devait changer, le responsable de l'hôte serait consulté d'abord.
5. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`). Après les migrations, on ne revient pas en arrière : on **répare en avant** (§1.5).
6. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
7. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-next-lot-h1`, sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact.
8. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche. Le nouveau claim code d'un acheteur est scellé avec une clé dérivée de `KEY_ENCRYPTION_KEY` (ou de `COOKIE_SECRET` sans elle), déjà en place : aucune variable nouvelle.
9. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
10. **Les pages légales** : une seule nouvelle version, `2026-10-09` (le lendemain de `2026-10-08`, celle de G) : l'article 2 des conditions (la carte certificat et son ORBES CODE), l'article du claim code, trois réponses de la FAQ (EN et FR). Le contact des pages légales, la politique de confidentialité et les mentions légales ne changent pas. Sa date ne retient jamais le déploiement.

---

## 1. Déploiement H1

### 1.0 Ce qui change

**Pour les collectionneurs (/verify)**

- **La ligne de la variante (§3.1).** Partout où une pièce est montrée, sa variante est sur sa propre ligne, sous le nom du modèle : MONOLITHE, puis BLUE. Sur le résultat d'un scan (et une ligne VARIANT sous MODEL dans son onglet PRODUCT), la page de la pièce, MY PIECES, la page du certificat partagé et le certificat de propriété en PDF. Un modèle sans variante ne montre aucune ligne.
- **La carte dans la boîte (§3.2).** La carte certificat devient 79t, celle que tu as validée : 95 × 62 mm, un seul côté, MINT CERTIFICATE, l'ORBES CODE à scanner et le claim code en clair, sans zone à gratter.
- **Les tailles viennent du modèle (§3.3).** La ligne SIZES de la fiche d'un modèle, le choix de taille du salon et la taille d'un cadeau de bienvenue ne montrent que les tailles proposées du modèle ; une taille mise de côté n'y est plus.
- **YOUR NEW CLAIM CODE (§3.4).** Quand ORBES Client Services fait un nouveau claim code pour une pièce vendue et pas encore enregistrée, il attend l'acheteur sur sa commande, dans MY PIECES → ORDERS. SHOW THE CODE l'affiche une seule fois ; avec lui, REGISTER THIS PIECE (une commande expédiée), COPY CODE et SAVE YOUR NEW CARD. Aucun e-mail, aucune pastille.

**Pour le personnel (la console)**

- La variante sur la page d'une pièce, dans la liste `Products` et dans le résultat du `Generator`.
- La carte 79t partout où une carte s'imprime (le `Generator`, une commande revenue au stock) : une par page, ou huit par planche A4 (`Sheets of eight cards`). La mention PROOF disparaît. Une pièce sans ORBES CODE actif n'a pas de carte (`Re-issue code` d'abord).
- `Catalogue` : chaque modèle reçoit son type de taille (`Ring size`, `Bracelet size`, `Necklace length`, `Watch`, `One size`) et ses tailles cochées, chacune son SKU et sa ligne de stock, à 0. Une taille utilisée est mise de côté, et peut être reprise (`Reinstate`). Une variante nouvelle copie les tailles du modèle principal.
- La page d'une pièce : le groupe `Claim code` → `New claim code` (OPERATOR et ADMIN), et la section `New claim codes`. Pour une pièce vendue, le personnel ne voit jamais le code. La page d'une commande : sa ligne `Claim code`.

**Les migrations**, appliquées dans **une seule transaction** : si elles échouent, rien n'est appliqué et le site revient tout seul sur `52c1c8c65e0d`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0033_model_sizes` | §3.3 | le type de taille d'un modèle, la mise de côté d'une taille, un index des tailles proposées |
  | `0034_claim_code_renewals` | §3.4 | les nouveaux claim codes : une ligne par code, gardée pour toujours, le code d'un acheteur scellé tant qu'il attend |

  Elles ne cassent pas l'image `52c1c8c65e0d` pendant le déploiement (une table qu'elle ignore, des colonnes nullables qu'elle ne nomme pas). Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Aucune ligne n'est écrite** par les migrations : chaque modèle reste « type à donner » (`To give`) jusqu'à ce que tu le lui donnes dans `Catalogue` (§1.8), et chaque pièce garde son claim code.
- **Caddy** : rien ne change.
- **Les variables** : rien ne change.
- **Les pages légales** : la version `2026-10-09` (règle 10).
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `52c1c8c65e0d` ne peut plus tourner sur ce schéma. `deploy.sh --image 52c1c8c65e0d` la refuse.

Dans la suite, `<SHA_H1>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_H1>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Ce qui doit être réglé avant le jour** (dans la console, sur ton ordinateur) :

- **Aucune LIVE RELEASE** prévue pendant la fenêtre, et aucun tirage tiré pendant elle.
- **Aucun test de TEST ENTRANTS en cours** : le redémarrage l'arrêterait. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** de la procédure de la carte perdue ([le playbook](SALES-PLAYBOOK.md), §5, « La carte perdue avant l'enregistrement », aussi dans `Documents`) : le nouveau claim code d'une pièce vendue va sur la commande de l'acheteur et ne leur est jamais montré ; ils répondent à l'acheteur dans `Messages`.
- **Aucune carte de client n'existe au format 85 × 55 mm** (le kit l'interdisait avant la validation) : rien à rappeler.

**2. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_H1>`, avec une coche verte. Sinon, n'avance pas.

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

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

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

Sortie attendue : `52c1c8c65e0dd482480030197ec6e250887ab251` au début de la ligne (le commit de G).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=52c1c8c65e0d`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : une ligne `… deploy 52c1c8c65e0d OK (previous …)` : G est bien le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_H1>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude (règle 7).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 52c1c8c..<7 caractères de SHA_H1>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_H1>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 4) :

```bash
git -C /opt/orbes/orbes-index diff --stat 52c1c8c65e0dd482480030197ec6e250887ab251 HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales** (règle 10) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-09';`.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : trente-trois lignes, de `0001_initial` à `0032_growth_indexes` ; les deux dernières :

```text
0031_model_pairs
0032_growth_indexes
```

### 1.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « ORBES H1 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_H1>, 2 migrations, rien ne change sur l'hôte. Pré-contrôle : <les quatre résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_H1> (tag <TAG_H1>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_H1>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 52c1c8c65e0d
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 33 migration(s) applied, all known to orbes-genome:<TAG_H1>
   ```

   **Il faut lire `33 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `52c1c8c65e0d`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_H1>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_H1>.tar.age
   ```

   **Note le nom de l'archive** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur.

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_H1>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_H1>
   Applied 2 migration(s): 0033_model_sizes, 0034_claim_code_renewals
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`). Caddy n'est pas recréé cette fois : sa configuration ne change pas.

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
   … [deploy.sh] deployed orbes-genome:<TAG_H1> (previous: 52c1c8c65e0d). This release applied the migration(s) 0033_model_sizes, 0034_claim_code_renewals:
   … [deploy.sh] orbes-genome:52c1c8c65e0d cannot run on this schema any more (scripts/deploy.sh --image 52c1c8c65e0d refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_H1> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
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
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `52c1c8c65e0d`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:52c1c8c65e0d` et `rolled back to 52c1c8c65e0d; the stack is healthy` | Les migrations n'ont pas été appliquées (une seule transaction), et le site est revenu tout seul sur `52c1c8c65e0d`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 52c1c8c65e0d is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_H1> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `52c1c8c65e0d`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_H1>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 52c1c8c65e0d`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_H1> OK (previous 52c1c8c65e0d; migrations 0033_model_sizes, 0034_claim_code_renewals)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 35 lignes `applied`, de `0001_initial` à `0034_claim_code_renewals`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

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
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/verify/pieces
```

Sortie attendue : `200`.

**Préviens le responsable de l'hôte** : « ORBES H1 fait à <heure> Paris (<heure> UTC), 2 migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Sur ton téléphone (Safari), avec le compte d'essai de la maison, puis l'ordinateur pour la console.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| §3.1 | Téléphone, puis console | Scanne une pièce d'une variante ; MY PIECES ; la page du certificat partagé ; le certificat de propriété en PDF ; dans la console, la page de la pièce, la liste `Products` et un résultat du `Generator` | MONOLITHE, puis BLUE sur sa propre ligne, et VARIANT dans l'onglet PRODUCT ; la même ligne partout ailleurs |
| §3.2 | Console | Le `Generator` sur une pièce de test, puis `Download certificate card` ; scanne son ORBES CODE à l'écran | Un PDF de 95 × 62 mm, MINT CERTIFICATE, sans PROOF ; le scan vérifie |
| §3.3 | Console | `Catalogue` : un modèle « Size type to give » ; donne-lui son type, coche ses tailles ; la page du stock ; mets une taille de côté, puis `Reinstate` | Les tailles à 0 sur la page du stock ; la taille mise de côté (`Set aside`), puis de nouveau proposée |
| §3.4, en stock | Console | `New claim code` sur une pièce de test en stock, non enregistrée, avec une raison | Le code affiché une fois, avec sa carte (`Download certificate card`) |
| §3.4, vendue | Console, puis téléphone | `New claim code` sur la pièce d'une commande de test du compte d'essai, puis MY PIECES → ORDERS ; SHOW THE CODE ; recharge la page | Aucun code dans la console (le message `New claim code made. …`) ; YOUR NEW CLAIM CODE une fois sur la commande ; plus rien après le rechargement |

### 1.8 Ensuite

- **Juste après** : donne à chaque modèle son type de taille et ses tailles dans `Catalogue` (la liste montre ceux qui l'attendent). H2 lira ces tailles pour son stock et les commandes aux fournisseurs.
- **Avant la première carte remise à un client** (après H1, avant qu'une carte entre dans une boîte) :
  - la boîte prend une carte de 95 × 62 mm (79t a grandi depuis 85 × 55) ;
  - l'imprimante de l'agent prend le carton choisi (le coton de 600 g des notes de 79t ne passe pas dans une imprimante de bureau) ;
  - une planche A4 de huit imprimée depuis le `Generator` (des pièces de test), découpée, et un ORBES CODE imprimé scanné au téléphone sur verify.theorbes.com : AUTHENTIC ;
  - les licences des polices couvrent l'impression (Gravesend Sans et Helvetica Neue ; question 3 du plan).
- **Les anciennes images (facultatif).** Une fois H1 stable, les images antérieures à `52c1c8c65e0d` ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_H1>` ni `52c1c8c65e0d`) ; la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 2. Déploiement H2

H2 part **après H1**, jamais avant : sa branche contient H1. Son point de départ : la production tourne H1, le commit `1651df1dd669381395cfa464bf0d59264c677f5a` (image `orbes-genome:1651df1dd669`), avec les trente-cinq migrations de `0001_initial` à `0034_claim_code_renewals`. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image, ce paragraphe ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer.

Les règles du §0 valent pour H2, avec ces trois différences :

- **Les captures d'abord** (règle 1) : celles de H2, que liste le rapport de Claude : `Logistics` (ses cinq onglets, la page d'un colis au format téléphone, la page d'une réception), `Supplier orders` (la proposition, une commande fournisseur et son PDF), le bloc de stock d'une sortie, la page d'une commande (`Shipping`, `Order case`, `Buyer`), `Team` avec LOGISTICS ; côté collectionneur, les cinq étapes de YOUR ORDERS, DELIVERY ADDRESS, YOUR ADDRESSES, ENGRAVING, RETURNS AND EXCHANGES et YOUR SIZE d'un tirage, au format téléphone et au format bureau.
- **Le commit final** (règle 7) : la branche `orbes-next-lot`, sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact.
- **Les pages légales** (règle 10) : une seule nouvelle version, `2026-10-10` (le lendemain de `2026-10-09`, celle de H1) : dans les conditions, le paragraphe « Its piece » (une commande attend le stock du fournisseur, la plus ancienne servie d'abord), l'article 12 (une taille choisie à l'inscription d'un tirage) et l'article 14 (l'adresse et la gravure sur la commande, les 14 jours pour demander un retour ou un échange) ; dans la politique de confidentialité, la gravure (aucune pièce n'est plus fabriquée pour une commande), la photo d'emballage, l'adresse de livraison saisie par le client, son téléphone donné au transporteur et au prestataire logistique, et la durée de YOUR ADDRESSES (EN et FR). Sa date ne retient jamais le déploiement.

### 2.0 Ce qui change

**Pour les collectionneurs (/verify)**

- **Une commande attend le stock du fournisseur** (§3.5). Plus aucune pièce n'est fabriquée pour une commande : une commande sans pièce en stock attend la prochaine livraison, les plus anciennes servies d'abord.
- **YOUR ORDERS en cinq étapes** (§3.6.A) : RESERVED · PAID · IN PREPARATION · SHIPPED · DELIVERED. IN PREPARATION dès que la commande payée tient sa pièce.
- **DELIVERY ADDRESS et YOUR ADDRESSES** (§3.6.B). Le client saisit l'adresse de livraison sur sa commande (le nom, les lignes, le pays, le téléphone) et la change jusqu'au début de l'emballage. Il garde jusqu'à cinq adresses dans YOUR ADDRESSES, dont une par défaut, mise sur chaque nouvelle commande.
- **ENGRAVING sur la commande** (§3.6.C), jusqu'au début de l'emballage. Une sortie qui vend la gravure en option : ses mots seulement, sans second prix. Sinon, le prix réglé dans `Settings` → `Engraving` ; sans prix pour la devise, aucune gravure n'est offerte. Après le paiement, une facture complémentaire ou un avoir pour sa ligne.
- **RETURNS AND EXCHANGES** (§3.6.D) : REQUEST A RETURN et EXCHANGE THE SIZE, dans les 14 jours qui suivent la livraison. La demande arrive aussi dans `Messages`.
- **Les tailles dans un tirage** (§3.6.F) : YOUR SIZE avant ENTER THE DRAW ; chaque taille est remplie dans l'ordre du tirage. Un tirage publié avant H2 garde un seul lot de pièces.

**Pour le personnel (la console)**

- `Logistics` prend la place de l'Atelier (`#/atelier` y mène) : `To ship` (puis `On its way`), `Receptions`, `Stock`, `Returns`, `Corrections`. Le stock montre chaque taille proposée, à 0 compris, et la marque NO PIECE (un compte sans identité ORBES derrière).
- Le rôle LOGISTICS dans `Team` : une connexion par personne de l'agent logistique, liée à ses entrepôts (`Locations`). Elle ne voit que `Logistics`, sans aucun prix ni la liste des commandes fournisseur.
- `Supplier orders` (ORBES seul) : `To order`, la proposition, les commandes fournisseur et leur `PDF`, les `Suppliers` ; le fournisseur d'un modèle ou d'une taille sur la page du modèle (`Edit supplier`).
- La page d'une commande : les sections `Shipping` et `Order case` (`Open a return`, `Decide`) ; `Buyer` avec le pays, le téléphone et ADDRESS CHANGED ; la gravure avec son prix. `Link a piece` disparaît.
- **L'expédition (`Ship`) démarre la garantie de chaque pièce** (question 14), avec le pays de l'adresse de livraison : plus rien à activer à la main avant l'envoi.
- `Settings` : l'adresse de chaque entrepôt (`Address`) ; `Orders` → `Settings` : LATE après 5 jours, et `Engraving` (un prix par devise).
- Le `Generator` est réservé à ADMIN. Une sortie montre son bloc de stock, avec `Add to supplier order`. Un tirage a ses `Sizes and pieces` et `Offer next` par taille.

**Les migrations**, appliquées dans **une seule transaction** : si elles échouent, rien n'est appliqué et le site revient tout seul sur `1651df1dd669`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0035_logistics_access` | §3.5 | le rôle LOGISTICS et ses entrepôts, l'adresse d'un entrepôt, les fournisseurs |
  | `0036_supplier_orders` | §3.5 | les commandes fournisseur, les réceptions, les cartes à imprimer, les retours au fournisseur, les corrections de stock |
  | `0037_fulfilment` | §3.5 | les commandes qui attendent le stock, l'échange de taille, les colis, les cas de commande |
  | `0038_draw_sizes` | §3.6.F | la taille d'une inscription à un tirage |
  | `0039_order_delivery` | §3.6.B, §3.6.C | YOUR ADDRESSES, le pays et le téléphone de la livraison, le prix de la gravure, la facture complémentaire et l'avoir d'une ligne |

- **Ce que les migrations écrivent** : la date d'entrée en stock des pièces finies par l'atelier (`0036`) ; les commandes qui attendaient une pièce à fabriquer attendent désormais le stock, et les pièces à fabriquer encore ouvertes sont annulées, leurs identités réservées laissées telles quelles (« forget those », `0037`) ; LATE passe de 3 à 5 jours (`0037`) ; une adresse déjà saisie est notée saisie par le personnel, ses pays et téléphone vides (« Not entered »), et chaque avoir existant crédite toute sa facture (`0039`).
- **Caddy** : rien ne change. La photo d'emballage passe sous sa limite de 64 Ko (§2.1).
- **Les variables** : rien ne change. Le claim code d'une carte à imprimer est scellé avec une clé dérivée de `KEY_ENCRYPTION_KEY` (ou de `COOKIE_SECRET` sans elle), déjà en place.
- **Les pages légales** : la version `2026-10-10`.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : `0037_fulfilment` et `0039_order_delivery` ne conviennent pas à l'image `1651df1dd669`, qui ne peut plus tourner sur ce schéma. `deploy.sh` arrête l'application avant de migrer, et `deploy.sh --image 1651df1dd669` la refuse ensuite.

Dans la suite, `<SHA_H2>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_H2>` ses 12 premiers caractères (le tag de la nouvelle image).

### 2.1 Avant : la photo d'emballage, ORBES Client Services, l'agent, la CI, l'heure, le pré-contrôle

**1. La photo d'emballage : rien à faire.** `Packed` exige la photo du colis. Le bord du serveur (Caddy) refuse tout corps de plus de 64 Ko sur son chemin (`PUT /api/admin/logistics/orders/:id/packing/photo`), et ce lot ne change rien sur l'hôte ([DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh)). La console envoie donc la photo en JPEG de 64 Ko au plus : elle baisse d'abord sa qualité à 1 600 px, puis sa taille, jusqu'à 1 024 px. Une photo qui dépasse encore 64 Ko n'est pas envoyée : l'agent lit « This photo stays over 64 KB, even at 1 024 px. Take it again, closer to the parcel. » et la reprend. Le premier vrai colis le vérifie : `Photo added.`, puis `Packed`.

**2. Ce qui doit être réglé avant le jour** (dans la console, sur ton ordinateur) :

- **H1 est en production**, et chaque modèle a son type de taille et ses tailles dans `Catalogue` (§1.8) : le stock et les commandes fournisseur de H2 les lisent.
- **Aucune LIVE RELEASE** prévue pendant la fenêtre, et aucun tirage tiré pendant elle.
- **Aucun test de TEST ENTRANTS en cours** : le redémarrage l'arrêterait. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Les pièces à fabriquer encore ouvertes** sont annulées par la migration, leurs identités réservées laissées telles quelles : rien à faire.
- **Préviens ORBES Client Services** des nouvelles procédures ([le playbook](SALES-PLAYBOOK.md), §2, aussi dans `Documents`) : « Recevoir une livraison et la confirmer », l'expédition par `Logistics`, « Un problème de colis », « Retours et échanges », « Commandes fournisseur », « L'adresse et la gravure du client » (une adresse après le début de l'emballage, le prix de la gravure).
- **Préviens l'agent logistique** : une connexion par personne, la vérification en deux étapes à la première connexion, et les procédures du playbook (§2).

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_H2>`, avec une coche verte. Sinon, n'avance pas.

**4. Connecte-toi au serveur**, comme au §1.1 : `sudo -iu orbes`, `cd /opt/orbes/orbes-index/deploy/vps`, `umask 022`.

**5. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**6. Le pré-contrôle**, comme au §1.1 : note les quatre résultats (`free -h`, `docker stats --no-stream`, `df -h /`, `du -sh /var/backups/orbes`). `Use%` de `df -h /` **sous 75 %**.

**7. Aucune sauvegarde en cours** : `pgrep -a pg_dump`, sortie attendue **rien**.

### 2.2 Préparer le serveur

**1. Rien d'égaré dans le shell** : `env | grep -E '^(ORBES_IMAGE_TAG|COMPOSE_PROJECT_NAME)='`, sortie attendue **rien** (sinon `unset ORBES_IMAGE_TAG COMPOSE_PROJECT_NAME`).

**2. Où en est le checkout.**

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s'
```

Sortie attendue : `1651df1dd669381395cfa464bf0d59264c677f5a` au début de la ligne (le commit de H1).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=1651df1dd669`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 1651df1dd669 OK (previous 52c1c8c65e0d; migrations 0033_model_sizes, 0034_claim_code_renewals)` : H1 est bien le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

**4. La console de l'agent n'est pas filtrée par adresse.**

```bash
grep '^ADMIN_ALLOWED_IPS=' .env
```

Sortie attendue : `ADMIN_ALLOWED_IPS=0.0.0.0/0 ::/0`, ou rien (la liste d'adresses de la console est ouverte, réglage par défaut). Une autre liste : la console ne répond qu'à ces adresses, et l'agent, depuis son entrepôt, lirait `Forbidden` ; arrête-toi et demande à Claude.

**5. `RESTORE_ALLOWED=false`** : `grep -n '^RESTORE_ALLOWED=' .env`, sortie attendue une seule ligne, `<numéro>:RESTORE_ALLOWED=false`.

### 2.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_H2>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 1651df1..<7 caractères de SHA_H2>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_H2>`.

**Rien ne change dans la pile du serveur** (deuxième condition), contre le commit de H1 alors en production, jamais contre G :

```bash
git -C /opt/orbes/orbes-index diff --stat 1651df1dd669381395cfa464bf0d59264c677f5a HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude (sauf si tu as choisi l'exception de Caddy au §2.1, et alors Claude t'a donné la ligne attendue).

**La version des pages légales** :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-10';`.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : trente-cinq lignes, de `0001_initial` à `0034_claim_code_renewals` ; les deux dernières :

```text
0033_model_sizes
0034_claim_code_renewals
```

### 2.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « ORBES H2 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_H2>, 5 migrations, rien ne change sur l'hôte. Pré-contrôle : <les quatre résultats>. »

Le lancement est gardé (troisième condition), comme au §1.4 :

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Sortie attendue, dans l'ordre, celle du §1.4 avec ces lignes-ci :

1. **La source** : `… [deploy.sh] ref HEAD = commit <SHA_H2> (tag <TAG_H2>)`. Un autre commit : Ctrl-C immédiatement.
2. **La construction** : `… [deploy.sh] previous image tag: 1651df1dd669`.
3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 35 migration(s) applied, all known to orbes-genome:<TAG_H2>
   ```

   **Il faut lire `35 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `1651df1dd669`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** : **note le nom de l'archive**, `orbes-<date>T<heure>Z-pre-deploy-<TAG_H2>.tar.age`.
5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] stopping the running app before migrating to <TAG_H2>
   Applied 5 migration(s): 0035_logistics_access, 0036_supplier_orders, 0037_fulfilment, 0038_draw_sizes, 0039_order_delivery
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

6. **La clé de signature et les tests de fumée**, comme au §1.4.
7. **La fin** :

   ```text
   … [deploy.sh] deployed orbes-genome:<TAG_H2> (previous: 1651df1dd669). This release applied the migration(s) 0035_logistics_access, 0036_supplier_orders, 0037_fulfilment, 0038_draw_sizes, 0039_order_delivery:
   … [deploy.sh] orbes-genome:1651df1dd669 cannot run on this schema any more (scripts/deploy.sh --image 1651df1dd669 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_H2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis `echo $?` : sortie attendue `0`.

### 2.5 Si quelque chose ne va pas

Le tableau du §1.5, avec `1651df1dd669` à la place de `52c1c8c65e0d` et `<TAG_H2>` à la place de `<TAG_H1>`. Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 1651df1dd669`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 2.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_H2> OK (previous 1651df1dd669; migrations 0035_logistics_access, 0036_supplier_orders, 0037_fulfilment, 0038_draw_sizes, 0039_order_delivery)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 40 lignes `applied`, de `0001_initial` à `0039_order_delivery`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1`.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Le disque, après** : les quatre mêmes commandes qu'au §1.6 (`free -h`, `docker stats --no-stream`, `df -h /`, `du -sh /var/backups/orbes`).

**Depuis ton Mac** : `curl -s https://verify.theorbes.com/api/v1/health` → `{"ok":true,"version":"0.1.0"}`, et `/verify/pieces` → `200`, comme au §1.6.

**Préviens le responsable de l'hôte** : « ORBES H2 fait à <heure> Paris (<heure> UTC), 5 migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après : <les chiffres>. »

### 2.7 Une vérification réelle par élément

Sur ton ordinateur pour la console, puis ton téléphone (Safari) avec le compte d'essai de la maison.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| §3.5, la console | Console | `Logistics` ; l'ancienne adresse `#/atelier` ; `Supplier orders` ; la page d'une commande ; `Team` ; le `Generator` en OPERATOR | `Logistics` et ses cinq onglets, son stock avec chaque taille proposée à 0 ; `#/atelier` ouvre `Logistics` ; la proposition dans `To order` ; les sections `Shipping` et `Order case` ; LOGISTICS proposé dans `Team` ; le `Generator` réservé à ADMIN |
| §3.5, l'agent | Console | Une connexion LOGISTICS de test (désactivée ensuite) ; dans `Receptions`, une référence inconnue | Seulement `Logistics` et ses entrepôts, aucun prix, aucune liste de commandes fournisseur ni colonne `Expected` ; « No supplier order … is expected here. » |
| §3.5, une commande fournisseur | Console | Un brouillon pour un modèle de test, son `PDF`, puis `Discard the draft` | Le PDF se télécharge ; le brouillon disparaît. La première vraie livraison, faite avec l'agent selon le playbook, est la vérification des réceptions (elle émet de vraies identités) |
| §3.6.A | Téléphone | MY PIECES → ORDERS, une commande | Les cinq étapes, RESERVED · PAID · IN PREPARATION · SHIPPED · DELIVERED |
| §3.6.B | Téléphone | YOUR ADDRESSES : ajoute une adresse, `MAKE DEFAULT`, retire-en une ; sur une commande, DELIVERY ADDRESS : ajoute-la, puis change-la | Chaque geste pris ; l'adresse sur la commande |
| §3.6.C | Téléphone, console | Une commande sans l'option ENGRAVING, avant et après un prix dans `Orders` → `Settings` → `Engraving` ; une commande LIVE avec l'option | ENGRAVING offert seulement une fois le prix réglé ; sur la commande LIVE, les mots se saisissent sans second prix |
| §3.6.F | Console | Un tirage de test en brouillon : `Sizes and pieces` ; le publier sans tailles | Ses tailles et leurs pièces ; la publication sans tailles refusée |

### 2.8 Ensuite

**Juste après H2, avant la première commande fournisseur :**

- **`Settings` → `Locations`, d'abord.** L'entrepôt de l'agent est le stock d'ORBES. Avant la première réception, fais de l'entrepôt de l'agent le lieu par défaut (`Make default`), ou renomme le lieu par défaut à son nom : les tirages sans lieu et chaque commande du salon vont au lieu par défaut. Chaque lieu qui tient des commandes (celui de chaque sortie, et le lieu par défaut) doit être lié aux connexions de l'agent ; un lieu qu'aucun agent ne tient ne tient aucune commande. Vérification : `Settings` → `Locations` montre l'entrepôt de l'agent en premier, marqué par défaut.
- **`Team`** : crée les connexions LOGISTICS de l'agent, une par personne, chacune avec le ou les entrepôts où elle travaille, le lieu par défaut compris. Chacune enrôle sa vérification en deux étapes à sa première connexion.
- **`Logistics` → `Stock`** : cherche la marque `NO PIECE` (un stock compté avant H2 sans identité ORBES derrière). Nomme les pièces de chaque taille par leur numéro (`Count pieces in`), ou corrige le compte à la baisse, avant que l'agent emballe une commande qui en dépend.
- **`Orders` → `Settings`** : l'adresse postale de chaque entrepôt (le PDF d'une commande fournisseur et l'adresse de retour) ; LATE lit 5 jours ; les prix de la gravure par devise, si tu veux l'offrir aux commandes sans l'option ENGRAVING d'une LIVE RELEASE (sans prix, pas de gravure sur celles-ci ; une commande avec l'option se voit offrir ses mots de toute façon).
- **`Supplier orders` → `Suppliers`** : ajoute tes fournisseurs (`Add a supplier`).
- **`Catalogue`** : le fournisseur de chaque modèle, et celui d'une taille là où il diffère (`Edit supplier`).

**Ensuite**, les premières vraies commandes suivent le playbook : ORBES Client Services marque payé ; l'agent emballe, scanne, photographie et expédie ; le client voit IN PREPARATION, puis SHIPPED avec son suivi.

**Les anciennes images (facultatif).** Une fois H2 stable, `1651df1dd669` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_H2>`), la liste d'abord : `docker images orbes-genome`.

## 3. Ce qui reste à ta décision (sans bloquer)

Le plan (§5.2) garde ces questions ouvertes pour H1 ; sans réponse, la réponse bâtie reste :

1. **La ligne VARIANT du certificat de propriété en PDF**, qui imprime la taille : elle garde son nom VARIANT (le renommer SIZE est recommandé).
2. **L'année de la carte** : l'année de l'identité ORBES de la pièce, gardée à chaque réimpression.
3. **Les licences des polices** : le build avance ; tu les confirmes avant la première carte d'un client (§1.8).
4. **Le texte de la boîte** suit la carte mot pour mot.
5. **Le fichier CSV de l'imprimeur** est gardé, avec ses colonnes `variant` et `year`.
6. **Une carte de remplacement sans claim code** pour une pièce enregistrée : pas dans ce lot.
7. **Une taille mise de côté que des commandes attendent** : elle n'est plus commandée aux fournisseurs (ta règle).
8. **Une pièce vendue en boutique, sans commande** : `New claim code` la refuse (réponse b), pour que le personnel ne voie jamais un code dû à un acheteur.
9. **NEW CLAIM CODE et l'ORBES CODE** restent séparés : `Re-issue code` reste à côté.
10. **REGISTER THIS PIECE sans scan**, une fois la commande expédiée : oui.

Et pour H2 (les numéros du plan) ; sans réponse, la réponse bâtie reste :

11. **EXPECTED** est une étape à part, facultative : `Confirmed by the supplier`, avec sa date si le fournisseur en donne une.
12. **La liste d'emballage** : une ligne par pièce pour la carte (son claim code visible), la carte 79t portant les deux codes.
13. **« ORBES atelier » ailleurs** (le soin annuel, les avantages par défaut de PALLADIUM, le paragraphe ORBES Care des conditions) : inchangé dans ce lot ; donne tes mots et c'est une petite correction directe.
14. **La garantie démarre à l'expédition** (`Ship`), avec le pays de l'adresse de livraison du colis.
15. **Les étapes de YOUR ORDERS** gardent RESERVED et PAID.
16. **NOT SURE YET** reste dans la demande du salon ; une taille choisie sur la demande est fixée sur la commande.
17. **La taille d'une inscription à un tirage** se change jusqu'à la clôture des inscriptions ; une place réservée en accès anticipé garde la sienne.
18. **Le prix de la gravure**, pour une commande sans l'option ENGRAVING : un prix par devise dans `Orders` → `Settings` → `Engraving`, le même pour chaque modèle.
19. **Une pièce gravée** se retourne ou s'échange comme une autre, avec le même bouton.
20. **ORBES Client Services ouvre un retour ou un échange même après les 14 jours** (`Open a return`), sans limite.
