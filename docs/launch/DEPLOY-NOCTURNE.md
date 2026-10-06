# Mise en production de NOCTURNE (déploiement F)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

NOCTURNE (plan du 2026-10-05 : l'application des collectionneurs, /verify, et les pages légales dans le noir du coffre, avec un vrai menu ; les variantes d'un modèle ; le prix d'une sortie tirée) part en production en **un seul déploiement**, F, après le déploiement E de LIVE RELEASE+ ([son runbook](DEPLOY-LIVE-RELEASE-PLUS.md)).

| Déploiement | Élément | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| F | NOCTURNE : /verify et les pages légales dans le noir, NOW, le menu des chapitres, la feuille du compte ; les variantes d'un modèle ; le prix d'une sortie tirée | `0024` | aucun | **À faire** |

Le point de départ : la production tourne le commit du déploiement E (`<SHA_E>`, image `orbes-genome:<TAG_E>`), avec les vingt-trois migrations `0001` à `0023` ([le runbook précédent](DEPLOY-LIVE-RELEASE-PLUS.md)). Si le déploiement E n'est pas fait, ou si un autre a eu lieu depuis, ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur le tableau d'abord.** Avant tout déploiement, tu regardes le tableau de chaque vrai écran à côté de sa planche validée (les 43, C1 à C43), que produit `parity.ts --board` et que te donne le rapport de Claude, et tu donnes ton accord. Sans lui, rien ne part.
2. **Jamais entre 03:00 et 05:30 UTC** : c'est l'heure des sauvegardes de nuit du serveur partagé (05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite).
3. **L'accord du responsable de l'hôte, pour une heure précise.** Le responsable de l'hôte partagé (ta session de coordination du serveur, « AI Stack Atlas planning ») reçoit le pré-contrôle et confirme **une** heure précise (par exemple « 14:30 UTC »), jamais « maintenant, vers … ». Tu lances à cette heure-là, pas avant.
4. **Rien ne change sur l'hôte** : ni Caddy, ni un port, ni une variable. Une seule migration, `0024`.
5. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`). Après la migration, on ne revient pas en arrière : on **répare en avant** (§1.5).
6. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
7. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche locale `orbes-nocturne` fusionnée dans `claude/orbes-genome-code-system-o8bmnk`, sa CI verte.
8. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
9. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.

---

## 1. Déploiement F

### 1.0 Ce qui change

- **/verify** s'ouvre sur **NOW** (à la place de l'ancien accueil), dans le noir du coffre : ce qui mène (une LIVE RELEASE, sinon une sortie tirée, sinon le dernier modèle de la collection), tes pièces, le cercle, la collection, le scan. En haut, ORBES et le bouton du compte (ton palier et le monogramme, ou SIGN IN) ; sous lui, le menu des chapitres NOW · RELEASES · COLLECTION · CIRCLE · PIECES ; en bas, l'anneau SCAN et le pied de page. YOUR TIER passe de MY PIECES à la feuille du compte. Dans la salle d'une LIVE RELEASE, le menu et l'anneau se cachent ; la salle garde son allure.
- **Les pages légales** passent dans le même noir ; leurs textes ne changent pas.
- **Restent tels quels** : la page partagée d'un certificat (/verify/c#…), la console, les PDF (certificat, factures, bordereaux, fiches de travail) et l'écran de la boutique.
- **La console** gagne seulement : la section `Variants` de la page `Lookbook` d'un modèle et `Add a variant` ; le prix et la devise d'une sortie tirée (`Price`, `Currency`) ; à l'émission, le champ renommé `Size`, et plus de photo de la pièce proposée.
- **La migration**, appliquée dans **une seule transaction** : si elle échoue, rien n'est appliqué et le site revient tout seul sur `<TAG_E>`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0024_model_variants` | Les variantes et le prix d'une sortie tirée | sur `models` : `variant_of`, `variant_label`, `variant_swatch` (le modèle principal, le nom de la variante, la couleur de son point) ; sur une sortie tirée : `price_minor` et `currency` |

  Elle ne casse pas l'image `<TAG_E>` pendant le déploiement (trois colonnes nullables qu'elle ne nomme pas, un prix de sortie tirée qu'elle ne lit pas), mais une fois appliquée on ne revient plus en arrière (ci-dessous).
- **Caddy, les variables** : rien ne change.
- **Une coupure courte** : l'application est arrêtée pendant la migration, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois la migration faite, l'image `<TAG_E>` ne peut plus tourner sur ce schéma. `deploy.sh --image <TAG_E>` la refuse.

Dans la suite, `<SHA_F>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_F>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : le tableau, le commit, l'heure, le pré-contrôle, l'accord

**1. Le tableau des 43 écrans** (règle 1). Ouvre le tableau que te donne le rapport de Claude (`board.html`, chaque vrai écran à côté de sa planche). Ton accord d'abord ; sinon, n'avance pas.

**2. Le commit et sa CI (sur ton Mac).** Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_F>`, avec une coche verte. Sinon, n'avance pas.

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

Sortie attendue : une heure **hors** de 03:00–05:30 UTC.

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

**7. L'accord pour une heure précise** (règle 3). Envoie au responsable de l'hôte, par exemple : « Déploiement F d'ORBES (NOCTURNE) : une migration en une transaction, aucun changement de l'hôte (ni Caddy, ni port, ni variable), une coupure courte d'ORBES. Pré-contrôle : <les quatre résultats>. Quelle heure précise, hors 03:00–05:30 UTC ? » Attends sa réponse, et lance à l'heure qu'il confirme.

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

Sortie attendue : `<SHA_E>` au début de la ligne (le commit du déploiement E).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=<TAG_E>`.

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

Sortie attendue : **exactement `<SHA_F>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude (règle 7).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating <7 caractères de SHA_E>..<7 caractères de SHA_F>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_F>`.

**Rien de la pile du serveur n'a changé** depuis le déploiement E (règle 4) :

```bash
git -C /opt/orbes/orbes-index diff --stat <SHA_E> HEAD -- deploy/vps
```

Sortie attendue : **rien**. Un fichier de `deploy/vps` : arrête-toi et demande à Claude.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : vingt-trois lignes, de `0001_initial` à `0023_releases_collectors` ; les deux dernières :

```text
0022_orders_stock
0023_releases_collectors
```

### 1.4 Déployer

À l'heure confirmée (règle 3). Le lancement est gardé : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_F> (tag <TAG_F>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_F>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: <TAG_E>
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : rien n'est changé, le site tourne toujours sur `<TAG_E>`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 23 migration(s) applied, all known to orbes-genome:<TAG_F>
   ```

   **Il faut lire `23 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `<TAG_E>`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_F>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_F>.tar.age
   ```

   **Note le nom de l'archive** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur.

5. **La migration et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_F>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_F>
   Applied 1 migration(s): 0024_model_variants
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`). Caddy n'est pas recréé : sa configuration n'a pas changé.

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
   … [deploy.sh] deployed orbes-genome:<TAG_F> (previous: <TAG_E>). This release applied the migration(s) 0024_model_variants:
   … [deploy.sh] orbes-genome:<TAG_E> cannot run on this schema any more (scripts/deploy.sh --image <TAG_E> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_F> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard (à une heure de nouveau confirmée par le responsable de l'hôte).

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `<TAG_E>`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:<TAG_E>` et `rolled back to <TAG_E>; the stack is healthy` | La migration n'a pas été appliquée (une seule transaction), et le site est revenu tout seul sur `<TAG_E>`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to <TAG_E> is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_F> failed (…) and is KEPT` et `Repair forward:` | La migration est faite, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `<TAG_E>`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_F>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image <TAG_E>`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_F> OK (previous <TAG_E>; migrations 0024_model_variants)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 24 lignes `applied`, de `0001_initial` à `0024_model_variants`, aucune `PENDING`.

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
curl -s https://verify.theorbes.com/verify | grep -o '<meta name="theme-color"[^>]*>'
```

Sortie attendue : `<meta name="theme-color" content="#0a0a0a">` (les barres de Safari dans le noir de NOCTURNE).

```bash
curl -s https://verify.theorbes.com/legal | grep -o '<meta name="theme-color"[^>]*>'
```

Sortie attendue : la même ligne, `content="#0a0a0a"`.

**Préviens le responsable de l'hôte** : « Déploiement F d'ORBES fait à <heure> UTC, rien de l'hôte n'a changé, tout est healthy. Avant / après : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Sur ton téléphone (Safari), puis l'ordinateur pour la console.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| NOW (écran 1) | Téléphone, connecté | <https://verify.theorbes.com/verify> | NOW sur le noir, les barres de Safari noires aussi ; ORBES, ton palier et le monogramme ; le menu NOW · RELEASES · COLLECTION · CIRCLE · PIECES, NOW souligné ; ce qui mène, puis YOUR PIECES ; l'anneau SCAN en bas |
| Le menu | Téléphone | Chaque chapitre, puis NOW | Chaque écran sur le noir, son chapitre souligné ; NOW ramène à NOW |
| La feuille du compte (décision 10) | Téléphone | Le bouton du compte | YOUR TIER, SOUND, ton e-mail, CHANGE PASSWORD, MY PIECES, PRIVACY · TERMS · LEGAL · HELP, SIGN OUT |
| Le certificat partagé (choix 3) | Téléphone | Un lien de certificat (/verify/c#…) | La page claire, comme avant, et les barres de Safari claires |
| Les pages légales (choix 3) | Téléphone | <https://verify.theorbes.com/legal> | Les pages sur le noir, leurs textes inchangés |
| La console (hors du périmètre) | Ordinateur | `Catalogue` → un modèle → `Lookbook` | La console comme avant ; sur la page du modèle, la section `Variants` et `Add a variant` |
| Le prix d'une sortie tirée (ajout 5) | Console, puis téléphone | Une sortie tirée : `Price` et `Currency` ; puis THE RELEASES | Le prix sur la carte de la sortie et sur sa page |

### 1.8 Ensuite

- **Les variantes** : pour montrer un modèle en acier, en or, en bleu, ouvre la page `Lookbook` de son modèle principal dans la console, donne-lui son nom de variante et la couleur de son point, puis `Add a variant` pour chaque autre finition, avec ses photographies.
- **Les anciennes images (facultatif).** Une fois le déploiement F stable, les images antérieures à `<TAG_E>` ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_F>` ni `<TAG_E>`) ; la liste d'abord :

  ```bash
  docker images orbes-genome
  ```
