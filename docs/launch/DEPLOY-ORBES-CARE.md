# Mise en production d'ORBES CARE

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

ORBES CARE (plan du 2026-10-15) part en production en **un seul déploiement**, comme I2 ([son runbook](DEPLOY-CUSTOMER-INTELLIGENCE.md#2-déploiement-i2)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| ORBES CARE | La garantie à vie et la garantie de 2 ans, choisies modèle par modèle ; l'onglet ORBES CARE de chaque pièce ; PRIVATE CARE pour chaque pièce dès PLATINE ; les demandes au titre de la garantie, ouvertes par ORBES Client Services ; le crédit de garantie ; les conditions ORBES CARE en PDF dans chaque commande ; l'article 11 des conditions réécrit ; l'abonnement ORBES Care retiré ; « atelier » retiré des textes | `0048_orbes_care` | aucun | **À faire** (§1) |

Le point de départ : la production tourne I2, le commit `90d9d3007e20cdc37c30bd6f0e93affdd7871e23` (image `orbes-genome:90d9d3007e20`), avec les quarante-huit migrations de `0001_initial` à `0047_collector_history`. La branche du lot, `orbes-care`, est partie de ce commit. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image (un correctif après I2), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer (la branche de déploiement est alors fusionnée dans celle du lot, et la CI repasse). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les captures d'abord.** Avant la fusion, tu regardes les captures que liste le rapport de Claude (§1.1). Sans ton accord, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. L'étiquette prépayée d'une demande au titre de la garantie passe par le chemin d'envoi des étiquettes de PRIVATE CARE, déjà ouvert par Caddy. `CARE_SUBSCRIBE_URL` reste dans la configuration, s'il y est, et l'application ne le montre plus.
5. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`). Après la migration, on ne revient pas en arrière : on **répare en avant** (§1.5).
6. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
7. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-care` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Si la branche de déploiement a bougé depuis I2, Claude la fusionne d'abord dans celle du lot (sans rien changer d'autre), et la CI repasse sur ce nouveau commit.
8. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
9. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
10. **Les pages légales changent** : l'article 11 des conditions (ORBES CARE et les garanties), les articles 1, 2 et 13 et la politique de confidentialité (l'abonnement retiré, une phrase sur les demandes au titre de la garantie), dans une seule nouvelle version, `2026-10-15`. La relecture du texte français par un avocat ne retient jamais le déploiement.
11. **Le passage des modèles de maroquinerie à 2 ans, le jour même** (§1.7). Dès le déploiement, chaque modèle est à vie (ton choix : à vie par défaut), maroquinerie comprise, jusqu'à ce que tu passes chaque modèle de maroquinerie à 2 ans dans le Catalogue. Le site n'est pas encore lancé au public : personne hors d'ORBES ne le voit, et le passage rend à chaque pièce la date de fin qu'elle avait avant le déploiement.
12. **Le site theorbes.com ne change pas.**

---

## 1. Le déploiement

### 1.0 Ce qui change

**Pour les collectionneurs (/verify)**

- **Deux garanties ORBES, modèle par modèle.** La **garantie à vie** (les bijoux et les accessoires autres que la maroquinerie) : si la pièce ternit, se décolore ou casse par accident, ORBES la remplace par la même pièce, neuve ; une fois par achat d'origine ; si le modèle n'est plus fabriqué, un crédit de sa valeur ; après le remplacement offert, un crédit de 30 % de sa valeur. La **garantie de 2 ans** (la maroquinerie) : les seuls défauts de fabrication, réparés ou remplacés, sans crédit. La garantie légale de conformité ne change pas.
- **Un seul onglet ORBES CARE sur chaque pièce.** Une pièce de MY PIECES a trois onglets, OWNERSHIP · ORBES CARE · SERVICE. ORBES CARE montre la garantie (ACTIVE · LIFETIME, ou ACTIVE jusqu'à sa date, avec ce qu'elle couvre), la demande au titre de la garantie en cours, s'il y en a une (son étape, DOWNLOAD LABEL, son issue), PRIVATE CARE (le demander, ou à partir de quel palier il s'ouvre), CARING FOR THIS PIECE et WRITE TO ORBES CLIENT SERVICES. SERVICE garde SERVICE HISTORY. Le résultat d'un scan a les onglets PRODUCT · ORBES CARE · OWNERSHIP. Le certificat de propriété (la page et le PDF) lit ACTIVE · LIFETIME, sans date de fin, pour une pièce à vie.
- **Aucun bouton, aucune photo, aucun formulaire de demande** : le collectionneur écrit à ORBES Client Services dans MESSAGES, depuis la pièce.
- **PRIVATE CARE** (l'ancien YEARLY CARE) : l'inspection, le nettoyage et le polissage de chaque pièce, une fois par an chacune, gratuitement, à partir de PLATINE (PLATINE avait 1 pièce par an). La marche est la même : la demande depuis la pièce, l'étiquette prépayée dans les deux sens.
- **Le crédit de garantie** s'affiche dans la feuille du compte, sous YOUR TIER, IN USE : WARRANTY CREDIT, son montant et sa date de fin.
- **Les conditions ORBES CARE en PDF** : dans MY PIECES, les DOCUMENTS de chaque commande listent ORBES CARE CONDITIONS juste après INVOICE (en premier sans facture) ; le PDF est l'article 11 en vigueur, en anglais puis en français.
- **L'abonnement ORBES Care est retiré** : plus de SUBSCRIBE, plus de « Subscriptions open soon. ». Le mot « atelier » ne s'affiche plus nulle part dans l'application.

**Pour le personnel (la console)**

- **Le Catalogue** : `New model` et `Edit model` ont le champ `Warranty`, `Lifetime (jewelry)` (choisi d'avance) ou `2 years (defects only)` ; un ADMIN seul le change dans `Edit model`, et une ligne dit combien de pièces déjà vendues le changement touche. Le tableau `Models` a une colonne `Warranty` (LIFETIME ou 2 YEARS) ; le tableau `Categories` lit la durée d'une garantie de 2 ans (2 YEARS).
- **Les demandes au titre de la garantie** : `Open a warranty claim` sur la conversation d'un client, puis la page de la demande, chaque étape faite par un OPERATOR : `Send label`, `Received`, `Decide` (ce que la garantie de la pièce permet), `Ship` ; `Move to the legal guarantee` sur une demande de 2 ans reçue. `Warranties` a un onglet `Claims`. La page d'une pièce montre ses demandes et son remplacement offert.
- **`THE PROGRAM`** (`Club` → `Tiers`) : PRIVATE CARE, « PLATINE Every piece · PALLADIUM Every piece », et la ligne `Warranty credit`, « 30 % of the piece’s value · valid 12 months ».
- **`PRIVATE CARE`** remplace `Yearly care` dans le menu ; la fiche client et `Apply credit` montrent le crédit de garantie.

**La migration**, appliquée dans **une seule transaction** : si elle échoue, rien n'est appliqué et le site revient tout seul sur `90d9d3007e20`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0048_orbes_care` | plan §2(c) | la garantie de chaque modèle (chaque modèle existant à vie) et de chaque pièce (chaque garantie non annulée à vie, sa date de fin retirée, sa durée gardée) ; PRIVATE CARE de chaque pièce dès PLATINE ; le crédit de garantie de 30 % dans `THE PROGRAM` ; le crédit de garantie parmi les crédits des clients ; la table des demandes au titre de la garantie ; le lieu des entretiens annuels déjà faits, « ORBES » au lieu de « ORBES atelier » |

  L'application est arrêtée pendant la migration. Une fois appliquée, on ne revient plus en arrière (ci-dessous).

- **Les pages légales** : une nouvelle version, `2026-10-15` (règle 10).
- **Caddy** : rien ne change.
- **Les variables** : rien ne change.
- **Une coupure courte** : l'application est arrêtée pendant la migration, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois la migration faite, l'image `90d9d3007e20` ne peut plus tourner sur ce schéma. `deploy.sh --image 90d9d3007e20` la refuse.

Dans la suite, `<SHA_CARE>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_CARE>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : tes captures, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Tes captures d'abord** (règle 1), au format téléphone et au format bureau, en mode sombre et en mode clair : l'onglet ORBES CARE d'une pièce à vie, d'une pièce de 2 ans et d'une pièce à chaque étape d'une demande, SERVICE, l'onglet ORBES CARE d'un résultat de scan, le certificat d'une pièce à vie (la page et le PDF), YOUR TIER avec WARRANTY CREDIT et THE CLUB, les DOCUMENTS d'une commande avec ORBES CARE CONDITIONS et le PDF lui-même ; dans la console, le Catalogue avec `New model` et `Edit model` (en ADMIN et en OPERATOR), la page d'une pièce, la page d'une demande à chaque étape et `Decide` pour chaque garantie, `Warranties` et `Claims`, `THE PROGRAM`, le tableau `PRIVATE CARE`, le mode vente, la fiche client. Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** (dans la console, sur ton ordinateur) :

- **I2 est en production**, au commit `90d9d3007e20cdc37c30bd6f0e93affdd7871e23` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **La liste de tes modèles de maroquinerie**, chaque variante comprise (chacune a sa propre ligne dans `Models`) : tu les passes à 2 ans juste après le déploiement (§1.7).
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §5b « Une demande au titre de la garantie », §5c « PRIVATE CARE » et §5d « La garantie d'un modèle ». Le propriétaire enregistré seul, jamais de photo ni de formulaire, la pièce toujours envoyée d'abord avec une étiquette prépayée ; Client Services décide de chaque issue ; il n'y a plus d'abonnement à vendre.

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_CARE>`, avec une coche verte. Sinon, n'avance pas.

**4. Connecte-toi au serveur** en SSH, comme d'habitude, puis :

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

**5. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**6. Le pré-contrôle.** Note les six résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

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

**7. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

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

Sortie attendue : `90d9d3007e20cdc37c30bd6f0e93affdd7871e23` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=90d9d3007e20`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 90d9d3007e20 OK (previous 427546ea62a1; migrations 0045_birthday_credit, 0046_engagement_scores, 0047_collector_history)` : I2 est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_CARE>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 90d9d30..<7 caractères de SHA_CARE>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_CARE>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 4), contre le commit d'I2 en production :

```bash
git -C /opt/orbes/orbes-index diff --stat 90d9d3007e20cdc37c30bd6f0e93affdd7871e23 HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales** (règle 10) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-15';`, la nouvelle version.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : quarante-huit lignes, de `0001_initial` à `0047_collector_history` ; les deux dernières :

```text
0046_engagement_scores
0047_collector_history
```

### 1.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « ORBES CARE : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_CARE>, 1 migration, rien ne change sur l'hôte. Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_CARE> (tag <TAG_CARE>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_CARE>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 90d9d3007e20
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 48 migration(s) applied, all known to orbes-genome:<TAG_CARE>
   ```

   **Il faut lire `48 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `90d9d3007e20`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_CARE>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_CARE>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **La migration et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_CARE>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_CARE>
   Applied 1 migration(s): 0048_orbes_care
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`). Caddy n'est pas recréé : sa configuration ne change pas.

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
   … [deploy.sh] deployed orbes-genome:<TAG_CARE> (previous: 90d9d3007e20). This release applied the migration(s) 0048_orbes_care:
   … [deploy.sh] orbes-genome:90d9d3007e20 cannot run on this schema any more (scripts/deploy.sh --image 90d9d3007e20 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_CARE> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
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
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `90d9d3007e20`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:90d9d3007e20` et `rolled back to 90d9d3007e20; the stack is healthy` | La migration n'a pas été appliquée (une seule transaction), et le site est revenu tout seul sur `90d9d3007e20`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 90d9d3007e20 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_CARE> failed (…) and is KEPT` et `Repair forward:` | La migration est faite, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `90d9d3007e20`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_CARE>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 90d9d3007e20`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_CARE> OK (previous 90d9d3007e20; migrations 0048_orbes_care)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 49 lignes `applied`, de `0001_initial` à `0048_orbes_care`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que la migration a écrit**, en lecture seule. Chaque modèle est à vie :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select warranty_lifetime, count(*) from models group by 1 order by 1"'
```

Sortie attendue : une seule ligne, `t|<le nombre de tes modèles>`.

Aucune garantie à vie n'a de date de fin :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from warranties where lifetime and end_date is not null"'
```

Sortie attendue : `0`.

`THE PROGRAM` : PRIVATE CARE de chaque pièce pour PLATINE (une case vide), et le crédit de garantie de 30 % :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select care_pieces_platine, warranty_credit_percent from club_program_settings"'
```

Sortie attendue : `|30`, ou **rien** si `THE PROGRAM` n'a jamais été enregistré : ses valeurs par défaut s'appliquent alors (chaque pièce, 30 %).

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

**Préviens le responsable de l'hôte** : « ORBES CARE fait à <heure> Paris (<heure> UTC), 1 migration, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Tes deux minutes : la garantie de tes modèles, le jour même

Dans la console, sur ton ordinateur, en ADMIN (règle 11) :

1. `Catalogue`, tableau `Models` : la colonne `Warranty` lit LIFETIME sur chaque ligne.
2. Pour **chaque modèle de maroquinerie, et chacune de ses variantes** (chacune est sa propre ligne) : `Edit model`, `Warranty` → `2 years (defects only)`. Lis la ligne qui s'affiche dessous : combien de pièces déjà vendues le changement touche (« Its … pieces already sold take a 2-year warranty from their start … Before the public launch only … »). Puis `Save model`. La ligne du modèle lit 2 YEARS. Les bijoux et les accessoires de métal (boutons de manchette, porte-clés…) restent `Lifetime (jewelry)` : rien à faire pour eux.
3. Le tableau `Categories` : chaque catégorie lit 2 YEARS dans sa colonne `Warranty` (la durée d'une garantie de 2 ans, celle des conditions). Une catégorie qui lit un autre nombre de mois : dis-le à Claude.
4. Pendant que tu y es, **en lecture seule** (le déploiement ne réécrit aucun texte de l'équipe) : `Club` → `Tiers`, les avantages enregistrés de PALLADIUM, pour le mot « atelier » (seul un texte enregistré le garde) ; `Settings` → `Locations`, les noms ; les entretiens enregistrés des pièces, leurs `Location` et `Performed by` (du texte libre, montré au collectionneur dans SERVICE HISTORY) ; une option de LIVE RELEASE encore nommée « ORBES Care ». L'équipe corrige un « atelier » à la main : aucune migration ne réécrit un texte de l'équipe.

Désormais, un nouveau modèle se crée avec sa garantie : `Lifetime (jewelry)` est choisi d'avance, choisis `2 years (defects only)` pour la maroquinerie.

Puis, sur le serveur, en lecture seule : chaque pièce suit son modèle.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from warranties w join products p on p.id = w.product_id join models m on m.id = p.model_id where w.voided_at is null and w.lifetime <> m.warranty_lifetime"'
```

Sortie attendue : `0`.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select warranty_lifetime, count(*) from models group by 1 order by 1"'
```

Sortie attendue : `f|<le nombre de modèles de maroquinerie, variantes comprises>`, puis `t|<les autres>`.

### 1.8 Une vérification réelle par élément

Dans la console, sur ton ordinateur, puis sur ton téléphone (Safari) avec le compte d'essai de la maison.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| La garantie d'un modèle | Console | `Catalogue`, tableau `Models` | La colonne `Warranty` : 2 YEARS sur la maroquinerie, LIFETIME ailleurs (§1.7) |
| `THE PROGRAM` | Console | `Club` → `Tiers`, `THE PROGRAM` | PRIVATE CARE : « PLATINE Every piece · PALLADIUM Every piece » ; `Warranty credit` : « 30 % of the piece’s value · valid 12 months » |
| Les demandes | Console | Le menu ; `Warranties` | `PRIVATE CARE` dans le menu ; l'onglet `Claims`, vide. N'ouvre aucune demande d'essai. |
| L'onglet ORBES CARE | Téléphone | MY PIECES, une pièce de bijou | Les onglets OWNERSHIP · ORBES CARE · SERVICE ; dans ORBES CARE : WARRANTY ACTIVE · LIFETIME, PRIVATE CARE (ou « PRIVATE CARE opens from PLATINE »), CARING FOR THIS PIECE, WRITE TO ORBES CLIENT SERVICES ; aucun SUBSCRIBE |
| La garantie de 2 ans | Téléphone | MY PIECES, une pièce de maroquinerie, ORBES CARE | WARRANTY ACTIVE, FROM et UNTIL, la date d'avant le déploiement |
| Le résultat d'un scan | Téléphone | SCAN ORBES CODE sur une pièce | Les onglets PRODUCT · ORBES CARE · OWNERSHIP |
| Les conditions | Téléphone | /legal/terms | L'article 11, « Article 11 — ORBES CARE and the warranties », et « Version of 15 October 2026 » sous le titre ; la politique de confidentialité parle des demandes au titre de la garantie |
| Les conditions en PDF | Téléphone | MY PIECES, ORDERS, les DOCUMENTS d'une commande | ORBES CARE CONDITIONS juste après INVOICE ; le PDF s'ouvre sur ORBES CARE CONDITIONS, « VERSION 15 OCTOBER 2026 », l'article 11 en anglais puis en français |

### 1.9 Ensuite

- **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1) : la demande au titre de la garantie (§5b du playbook), PRIVATE CARE de chaque pièce une fois par an dès PLATINE (§5c), la garantie d'un modèle (§5d). Les conditions écrites de la garantie sont le PDF ORBES CARE CONDITIONS des DOCUMENTS de chaque commande, à côté de la facture : un client qui les demande y est renvoyé, ou aux conditions ; rien n'est imprimé pour la boîte.
- **La relecture du texte français** de l'article 11 par un avocat (règle 10), sans retenir aucun déploiement ; ses questions sont dans la note pour l'avocat.
- **Le prototype de bureau** : ses pages MY PIECES et d'une pièce sont faites sur les quatre anciens onglets ; elles prendront les trois onglets et l'onglet ORBES CARE quand les deux se rejoindront.
- **Les anciennes images (facultatif).** Une fois ORBES CARE stable, `90d9d3007e20` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_CARE>`), la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **Les choix par défaut du plan** (§0 du plan), que tu peux changer : la garantie légale à part (elle n'use jamais le remplacement offert), la garantie qui suit la pièce quand elle change de mains, les 30 % réglés dans `THE PROGRAM` et le crédit valable 12 mois, `CARE_SUBSCRIBE_URL` gardé dans la configuration, la pièce rendue ou gardée selon l'issue, le remplacement offert compté depuis l'achat d'origine, la valeur de la pièce, la garantie d'une pièce de remplacement, le territoire, l'enregistrement demandé pour la garantie ORBES seulement, le changement de garantie d'un modèle réservé à un ADMIN, les mois gardés de chaque garantie.
2. **Les textes de l'équipe** qui disent encore « atelier » (§1.7, point 4) : l'équipe les corrige à la main, à son rythme.
