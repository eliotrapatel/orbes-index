# Mise en production de la connaissance client (déploiements I1 et I2)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

La connaissance client (plan du 2026-10-08) part en production en **deux déploiements**, après le lot suivant (le déploiement H2, [son runbook](DEPLOY-NEXT-LOT.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| I1, « recueillir » | L'inscription et YOUR PROFILE, YOUR WISHLIST, ce que les collectionneurs regardent (l'appareil, la ville), d'où ils viennent (`Links`), la fiche client (`Profile`, `Tags and private notes`, `Intelligence`), la taille présélectionnée (plan §3.1 à §3.4, §3.6 pour la fiche, §3.7) | `0040` à `0044` | aucun | **Fait** le 2026-10-10 (image `f360b24aaa37`) |
| I2, « utiliser » | Le crédit d'anniversaire, le score d'engagement, les nouveaux critères des segments, la page `Collectors`, l'historique mensuel et l'export (plan §3.5, §3.6) | `0045` à `0047` | aucun | **À faire** (§2) |

Le point de départ de I1 : la production tourne H2, le commit `e7f72e1fff7e14ba461d59b8fbc88daa12eca62f` (image `orbes-genome:e7f72e1fff7e`), avec les quarante migrations de `0001_initial` à `0039_order_delivery`. La branche du lot est partie de `074fce1`, le dernier commit du build de H2, et contient les deux correctifs déployés ensuite avec H2 le 2026-10-09 (`2a2ca08` : les six étapes sur deux lignes sous 420 px ; `e7f72e1` : l'image copie `src/shared`). La remise à zéro des données du 2026-10-09 n'a pas changé le schéma ni le code. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image (un correctif après H2), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer (la branche de déploiement est alors fusionnée dans celle du lot, et la CI repasse). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les captures d'abord.** Avant la fusion, tu regardes les captures que liste le rapport de Claude : CREATE ACCOUNT avec FIRST NAME, LAST NAME, COUNTRY et HOW DID YOU HEAR ABOUT ORBES?, YOUR PROFILE et YOUR TASTES, le cœur WISHLIST sur la fiche d'un modèle et son dessin, YOUR WISHLIST (pleine et vide), EXCHANGE THE SIZE avec la taille de YOUR SIZES, au format téléphone et au format bureau ; dans la console, la fiche client (`Profile`, `Tags and private notes`, `Intelligence`) en OPERATOR et en AUDITOR, `Links` et la page d'un lien, la page `Sign-up`. Sans ton accord, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. La base des villes est le fichier DB-IP « IP to City Lite » déjà installé et rafraîchi chaque semaine par `orbes-geoip.timer` : aucun fichier nouveau (§1.1). Si cela devait changer, le responsable de l'hôte serait consulté d'abord.
5. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`). Après les migrations, on ne revient pas en arrière : on **répare en avant** (§1.5).
6. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
7. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-customer-intelligence-i1`, sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Si la branche de déploiement a bougé depuis H2, Claude la fusionne d'abord dans celle du lot (sans rien changer d'autre), et la CI repasse sur ce nouveau commit.
8. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
9. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
10. **Les pages légales ne changent pas** dans ce lot (ton choix) : la version reste `2026-10-10`, celle de H2. La seule ligne légale du plan (§0.12) attend le lancement public (§3) et ne retient jamais le déploiement.

---

## 1. Déploiement I1

### 1.0 Ce qui change

**Pour les collectionneurs (/verify)**

- **L'inscription (§3.1).** CREATE ACCOUNT demande FIRST NAME et LAST NAME (obligatoires), l'e-mail, le mot de passe, et COUNTRY (obligatoire, déjà choisi d'après la connexion, modifiable), puis une question facultative, HOW DID YOU HEAR ABOUT ORBES?. Le champ NAME (OPTIONAL) disparaît. Les comptes existants restent tels quels, sans écran imposé.
- **YOUR PROFILE (§3.1).** Une ligne de la feuille du compte, après MESSAGES, qui lit son pourcentage (`60% COMPLETE`, ou COMPLETE). Le client y voit et change tout son profil : nom, date de naissance (saisie une fois, avec CONFIRM YOUR DATE OF BIRTH ; ensuite, seul ORBES Client Services la change), pays, ville, l'adresse par défaut de YOUR ADDRESSES, téléphone, Instagram, YOUR TASTES (ses pièces et finitions préférées, prises dans THE COLLECTION) et comment il a connu ORBES. Rien n'est bloquant.
- **YOUR WISHLIST (§3.2).** Un cœur, WISHLIST, sur la fiche de chaque modèle ; la ligne YOUR WISHLIST après YOUR ADDRESSES ouvre une page construite comme THE COLLECTION, avec SEE THE MODEL et REMOVE. Personne d'autre ne la voit, aucun compte n'est affiché.
- **La taille présélectionnée (§3.7).** EXCHANGE THE SIZE s'ouvre sur la taille de YOUR SIZES quand elle est proposée et en stock.
- **Enregistré sans rien montrer (§3.3, §3.4).** Les écrans regardés et leur durée, l'appareil (téléphone, tablette ou ordinateur ; iPhone ou Android ; un navigateur, l'intérieur d'Instagram ou de TikTok, ou l'écran d'accueil), la ville et le pays de la connexion, et d'où vient la visite (un lien de la console, les balises `utm_`, un site). Une visite sans compte, scans de l'ORBES CODE compris, est gardée sur l'appareil et rattachée au compte à l'inscription ou à la connexion. Aucun bandeau, aucun mot nouveau, rien n'est envoyé à un tiers. Un navigateur connecté à la console n'est jamais enregistré.

**Pour le personnel (la console)**

- **La fiche client (§3.6)**, juste après le compte : `Profile` (avec `Edit the profile`, `Change the date of birth` et `Edit the address`, en OPERATOR et ADMIN), `Tags and private notes` (`Add a tag`, `Add a private note`, jamais montrés au client) et `Intelligence` (`Origin`, `Wishlist`, ce qu'il regarde, `Devices`, `Places`). Un AUDITOR lit le téléphone, l'adresse, l'Instagram, la ville et la date de naissance retenus (`Withheld`, la tranche d'âge seulement).
- **`Links`** (§3.4), sous `Clients` après `Segments` : `New link` donne une adresse courte comme `verify.theorbes.com/go/instagram-bio` ; chaque lien, regroupé par `Channels`, montre ses visites, puis les inscriptions, les entrées, les achats, le chiffre d'affaires et son retour, en premier lien (découverte) et en dernier lien (conversion), côte à côte.
- **La page `Sign-up`**, depuis `Owners` : les réponses à « How did you hear about ORBES? », avec combien de collectionneurs ont donné chacune ; un ADMIN les ajoute, les renomme, les range et les met de côté.
- **L'état du serveur** gagne la ligne `VISITOR DATA` : la taille des données enregistrées, pour la règle des 50 Mo de la sauvegarde.
- Les entrants de test et les comptes de l'équipe sont hors de chaque chiffre et de chaque liste.

**Les migrations**, appliquées dans **une seule transaction** : si elles échouent, rien n'est appliqué et le site revient tout seul sur `e7f72e1fff7e`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0040_account_profiles` | §3.1 | le profil, ses goûts, les réponses à « How did you hear about ORBES? » |
  | `0041_account_wishes` | §3.2 | YOUR WISHLIST et son résumé mensuel |
  | `0042_collector_views` | §3.3 | les appareils, les vues, les lieux, leurs totaux du jour et les résumés par collectionneur |
  | `0043_acquisition` | §3.4 | les liens et leurs canaux, les sources, les visites, la première source de chaque collectionneur, le dernier lien de chaque acte |
  | `0044_client_notes` | §3.6 | les notes privées et les tags de la fiche client, deux index |

  Elles ne cassent pas l'image `e7f72e1fff7e` pendant le déploiement (des tables qu'elle ignore, une colonne nullable et des index qu'elle ne nomme pas). Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Aucune ligne n'est écrite** par les migrations. Au premier démarrage, l'application crée les huit réponses d'origine (Instagram, TikTok, A friend, The press, A shop, A web search, An influencer, Other), les sept canaux des liens et le point de départ de l'enregistrement ; puis, en arrière-plan, par petits lots, elle reprend les scans des 13 derniers mois comme appareils et lignes de scan. Les index sur `audit_logs`, `drop_entries`, `live_entries` et `orders` prennent quelques secondes à la taille de la maison.
- **Caddy** : rien ne change.
- **Les variables** : rien ne change.
- **La base des villes** : le fichier DB-IP déjà installé (règle 4) ; l'application en lit un champ de plus, la ville.
- **Les pages légales** : rien ne change (règle 10).
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `e7f72e1fff7e` ne peut plus tourner sur ce schéma. `deploy.sh --image e7f72e1fff7e` la refuse.

Dans la suite, `<SHA_I1>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_I1>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : ORBES Client Services, la base des villes, la CI, l'heure, le pré-contrôle

**1. Ce qui doit être réglé avant le jour** (dans la console, sur ton ordinateur) :

- **H2 est en production**, au commit `e7f72e1fff7e14ba461d59b8fbc88daa12eca62f` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, de préférence pas dans l'heure qui précède l'ouverture d'une sortie (les premières visites après un déploiement écrivent de nouveaux appareils), et aucun tirage tiré pendant elle.
- **Aucun test de TEST ENTRANTS en cours** : le redémarrage l'arrêterait. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** des nouvelles procédures ([le playbook](SALES-PLAYBOOK.md), §6, aussi dans `Documents`) : « Corriger la date de naissance ou le profil d'un client » (après avoir vérifié que c'est bien le client ; la raison de `Change the date of birth` devient une note privée ; une date mal saisie se corrige directement, car retirée, le client ne peut plus la saisir), les tags et les notes privées (jamais montrés au client), et ce que lit le rôle AUDITOR.
- **Les comptes de collectionneur de l'équipe** (une adresse e-mail qui est aussi une connexion de la console) sont hors des chiffres (question 5) : rien à faire.

**2. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_I1>`, avec une coche verte. Sinon, n'avance pas.

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

**4. La base des villes** (deux contrôles qui ne changent rien sur l'hôte) :

```bash
systemctl list-timers orbes-geoip.timer
```

Sortie attendue : une ligne `… orbes-geoip.timer orbes-geoip.service`, avec dans `NEXT` le lundi qui vient (vers 04:41 UTC, jusqu'à une heure plus tard), puis `1 timers listed.`.

```bash
scripts/geoip-update.sh --check
```

Sortie attendue : une ligne `geoip-update: /var/lib/orbes/geoip/dbip-city-lite.mmdb: OK, DBIP-City-Lite built …`, puis les sondes (`geoip-update: probe … OK`). Il faut lire `City` : c'est le fichier des villes, celui que le lot lit. Une erreur, ou une autre édition : arrête-toi et demande à Claude (un autre fichier serait un changement de l'hôte, à voir d'abord avec son responsable).

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

Sortie attendue : `e7f72e1fff7e14ba461d59b8fbc88daa12eca62f` au début de la ligne (le commit de H2).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=e7f72e1fff7e`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy e7f72e1fff7e OK (previous 1651df1dd669; migrations 0035_logistics_access, 0036_supplier_orders, 0037_fulfilment, 0038_draw_sizes, 0039_order_delivery)` : H2 est bien le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_I1>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude (règle 7).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating e7f72e1..<7 caractères de SHA_I1>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_I1>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 4), contre le commit de H2 alors en production, celui que nomme la dernière ligne OK de `.state/deploys.log` :

```bash
git -C /opt/orbes/orbes-index diff --stat e7f72e1fff7e14ba461d59b8fbc88daa12eca62f HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales** (règle 10) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-10';`, celle de H2, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : quarante lignes, de `0001_initial` à `0039_order_delivery` ; les deux dernières :

```text
0038_draw_sizes
0039_order_delivery
```

### 1.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « ORBES I1 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_I1>, 5 migrations, rien ne change sur l'hôte (le fichier GeoIP ville est celui déjà installé). Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_I1> (tag <TAG_I1>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_I1>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: e7f72e1fff7e
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 40 migration(s) applied, all known to orbes-genome:<TAG_I1>
   ```

   **Il faut lire `40 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `e7f72e1fff7e`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_I1>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_I1>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur), et sa taille est le chiffre « avant » de la règle des 50 Mo (plan §8).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_I1>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_I1>
   Applied 5 migration(s): 0040_account_profiles, 0041_account_wishes, 0042_collector_views, 0043_acquisition, 0044_client_notes
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
   … [deploy.sh] deployed orbes-genome:<TAG_I1> (previous: e7f72e1fff7e). This release applied the migration(s) 0040_account_profiles, 0041_account_wishes, 0042_collector_views, 0043_acquisition, 0044_client_notes:
   … [deploy.sh] orbes-genome:e7f72e1fff7e cannot run on this schema any more (scripts/deploy.sh --image e7f72e1fff7e refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_I1> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
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
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `e7f72e1fff7e`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:e7f72e1fff7e` et `rolled back to e7f72e1fff7e; the stack is healthy` | Les migrations n'ont pas été appliquées (une seule transaction), et le site est revenu tout seul sur `e7f72e1fff7e`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to e7f72e1fff7e is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_I1> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `e7f72e1fff7e`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_I1>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image e7f72e1fff7e`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_I1> OK (previous e7f72e1fff7e; migrations 0040_account_profiles, 0041_account_wishes, 0042_collector_views, 0043_acquisition, 0044_client_notes)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 45 lignes `applied`, de `0001_initial` à `0044_client_notes`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

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

**Préviens le responsable de l'hôte** : « ORBES I1 fait à <heure> Paris (<heure> UTC), 5 migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Sur ton téléphone (Safari), avec le compte d'essai de la maison, sur un navigateur **qui n'est pas connecté à la console** (une session de la console n'est jamais enregistrée) ; puis l'ordinateur pour la console.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| §3.1 | Téléphone | CREATE ACCOUNT, un nouveau compte de test ; puis YOUR PROFILE : une date de naissance ; l'adresse | FIRST NAME, LAST NAME, COUNTRY déjà sur FR depuis une connexion française, la question facultative ; le pourcentage de YOUR PROFILE ; CONFIRM YOUR DATE OF BIRTH, puis la date en lecture seule ; l'adresse ouvre YOUR ADDRESSES, et le retour revient au profil |
| §3.2 | Téléphone | Le cœur WISHLIST sur la fiche d'un modèle ; YOUR WISHLIST ; REMOVE | Le cœur plein ; le modèle dans YOUR WISHLIST ; il en sort |
| §3.3 | Téléphone, puis serveur | Quelques écrans sur le téléphone ; quelques secondes après, la commande ci-dessous | Des lignes par page ; aucune de ton navigateur de console |
| §3.4 | Console, puis téléphone | Un lien de test dans `Links` (`New link`) ; ouvre son adresse `/go/…` sur le téléphone | Une visite sur la page `Links` en moins d'une minute ; la barre d'adresse ne montre plus `?o=` |
| §3.6 | Console | La fiche du compte de test ; puis la même avec une connexion AUDITOR | `Profile`, `Tags and private notes` et `Intelligence` (l'origine, la liste d'envies, les vues, les appareils, les lieux) ; en AUDITOR, le téléphone, l'adresse, l'Instagram, la ville et la date de naissance `Withheld` |
| §3.7 | Téléphone | Une commande de test livrée : EXCHANGE THE SIZE | La taille de YOUR SIZES présélectionnée, quand elle est proposée et en stock |

La commande du §3.3, sur le serveur, en `orbes` dans `deploy/vps` (elle ne fait que lire) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select page, count(*) from collector_views group by 1 order by 1"'
```

Sortie attendue : quelques lignes `<page>|<nombre>` (les pages sont des numéros : 2 est NOW, 4 MY PIECES, 9 THE COLLECTION, 10 la fiche d'un modèle…). Rien : attends dix secondes et relance ; toujours rien, colle la sortie à Claude.

### 1.8 Le lendemain matin

Après 09:30 à Paris (07:30 UTC ; 08:30 à Paris après le 25 octobre), sur le serveur, en `orbes` dans `deploy/vps` :

```bash
docker compose logs app --since 12h | grep 'intelligence sizes'
```

Sortie attendue : une ligne qui finit par `"msg":"intelligence sizes"`, avec les octets de chaque table du lot (`tables`) et leur `total` : les premières tailles réelles.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select max(day) from view_daily_stats where page = 0"'
```

Sortie attendue : la date d'hier (le jour de Paris), `<AAAA-MM-JJ>` : la journée d'hier est comptée.

```bash
ls -lt /var/backups/orbes/daily/ | head -n 4
```

Sortie attendue : l'archive de la nuit, `orbes-<date>T03…Z.tar.age` (sans `-pre-deploy`), avec sa taille en octets, et son `.sha256` à côté. Colle les trois sorties à Claude : il compare chaque table à son estimation (plan §8) et la sauvegarde à celle d'avant (§1.4) ; une table à plus de 20 % au-dessus de son estimation t'est signalée avec ses chiffres.

### 1.9 Ensuite

- **Les premiers vrais liens** dans `Links` : la bio d'Instagram, chaque influenceur, avec leur coût si tu veux voir leur retour.
- **La règle des 50 Mo** : la ligne `VISITOR DATA` de l'état du serveur et la ligne `intelligence sizes` du matin montrent la croissance. Une sauvegarde de nuit au-dessus de 50 Mo te revient avec les chiffres par table (ta réponse à la question 4 : décider à ce moment-là).
- **Les anciennes images (facultatif).** Une fois I1 stable, `e7f72e1fff7e` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_I1>`), la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 2. Déploiement I2

Les règles du §0 valent ici aussi, avec ces deux différences : les captures à regarder d'abord sont celles du §2.1, et la branche est `orbes-customer-intelligence` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'au commit exact.

Le point de départ de I2 : la production tourne le commit `427546ea62a1d7a0cd9013033ffc50449735c064` (image `orbes-genome:427546ea62a1`, déployée le 2026-10-14), avec les quarante-cinq migrations de `0001_initial` à `0044_client_notes`. C'est I1 (image `f360b24aaa37`, le 2026-10-10), plus le mode clair et deux petits correctifs de la console, sans migration ni changement de `deploy/vps`. Avant la CI de I2, Claude fusionne la branche de déploiement dans celle du lot (sans rien changer d'autre, plan §9), pour que le commit de I2 suive celui de la production. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image, ce chapitre ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer.

Le diff de `deploy/vps` se fait contre le commit final de I1, `10688354808d874bc123c0e6729ffce5b733339d`, jamais contre H2 : son dossier `deploy/vps` est le même, octet pour octet, que celui du commit en production (le mode clair n'y a rien changé).

### 2.0 Ce qui change

**Pour les collectionneurs (/verify)**

- **Le crédit d'anniversaire (§3.5).** Le jour de son anniversaire (heure de Paris), chaque compte qui a une date de naissance, pièce ou non, reçoit un crédit de 20 €, valable 30 jours, une fois par 12 mois au plus, si la date était sur le compte avant minuit (Paris) ce jour-là. Il s'affiche dans la feuille du compte, sous YOUR TIER, en première ligne de IN USE : BIRTHDAY CREDIT, son montant et sa date de fin (aussi pour un compte sans palier). Dans YOUR PROFILE, sous DATE OF BIRTH, une ligne l'annonce : « On your birthday, ORBES gives you a credit of € 20, valid 30 days. » (cachée quand le crédit est coupé). Rien n'est envoyé : ni e-mail, ni notification.
- **Rien d'autre ne change** dans l'application. Le score, les tags et les notes privées ne sont jamais montrés au collectionneur.

**Pour le personnel (la console)**

- **`THE PROGRAM`** (`Club` → `Tiers`) gagne la ligne `Birthday credit`, « € 20 · valid 30 days » ; un ADMIN la change ou la coupe avec `Edit program` (`Birthday credit given`, `Birthday credit`, `Birthday credit valid (days)`).
- **La page d'une commande** : le crédit d'anniversaire parmi les crédits disponibles, pris en premier par `Apply credit`, avant ceux des paliers ; la facture porte la ligne CREDIT · BIRTHDAY. **La fiche client**, bloc `Club` : les lignes `Birthday credit`, ou quand vient le prochain.
- **Le score d'engagement** (§3.5), de 0 à 100, calculé chaque matin : en tête de la section `Intelligence` de la fiche client (`Engagement score`, ses cinq parties et comment il se calcule). Réservé au personnel.
- **`Segments`** : cinq nouveaux groupes de critères, `City, age, how they heard and tags`, `Wishlist and favourite pieces and finishes`, `What they look at, devices and places`, `Where they come from` et `Engagement score`. Un segment qui lit le score peut servir de règle d'accès à une LIVE RELEASE (question 15).
- **La page `Collectors`**, sous `Clients` après `Owners` : `At a glance`, `Who they are`, `Where they come from`, `What they like`, `Devices`, `Engagement` et `Over time`, sur 7, 30 ou 90 jours, 12 mois ou des dates choisies, comparés à la période d'avant, avec cinq filtres. Chaque chiffre ouvre la liste de ses collectionneurs (`Back to the figures`), et chaque ligne sa fiche client. Un AUDITOR lit les chiffres, les adresses e-mail masquées et sans les villes.
- **L'export** : `Export (CSV)`, pour un ADMIN seulement, un fichier de 76 colonnes, inscrit au journal d'audit (`collectors.export`, des comptes seulement) avant de partir, jamais gardé sur le serveur.
- Les entrants de test et les comptes de l'équipe sont hors de chaque chiffre, de chaque liste et de l'export.

**Les migrations**, appliquées dans **une seule transaction** : si elles échouent, rien n'est appliqué et le site revient tout seul sur `427546ea62a1`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0045_birthday_credit` | §3.5 | les trois réglages du crédit d'anniversaire dans `THE PROGRAM` (donné, 20 €, 30 jours), et le crédit d'anniversaire parmi les crédits des clients |
  | `0046_engagement_scores` | §3.5 | le score de chaque compte et ses cinq parties, et une ligne par jour de calcul |
  | `0047_collector_history` | §3.6 | l'historique mensuel de chaque collectionneur (son score, son palier, s'il était actif) |

  Elles ne cassent pas l'image `427546ea62a1` pendant le déploiement (des colonnes avec une valeur par défaut, des tables qu'elle ignore). Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Aucune ligne n'est écrite** par les migrations. Après le démarrage, au premier passage de l'entretien (toutes les 10 minutes) :
  - le crédit d'anniversaire est donné aux comptes dont c'est l'anniversaire, et aussi, avec les jours qui restent, à ceux dont l'anniversaire des jours précédents serait encore valable, si leur date de naissance était sur le compte avant ce jour-là (au plus tôt depuis I1, le 10 octobre) ;
  - à partir de 09:30 à Paris (08:30 après le 25 octobre ; 07:30 UTC), une fois par jour de Paris : le calcul du score, par lots de 500, puis l'historique mensuel, qui écrit une seule fois les 12 mois passés de chaque collectionneur. Si tu déploies après cette heure-là, ils tournent dans les vingt minutes qui suivent. Jamais pendant qu'une salle de LIVE RELEASE est ouverte, ni pendant un test de TEST ENTRANTS : ils attendent le passage suivant.
- **Caddy** : rien ne change.
- **Les variables** : rien ne change.
- **Les pages légales** : rien ne change (règle 10).
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `427546ea62a1` ne peut plus tourner sur ce schéma. `deploy.sh --image 427546ea62a1` la refuse.

Dans la suite, `<SHA_I2>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_I2>` ses 12 premiers caractères (le tag de la nouvelle image).

### 2.1 Avant : tes captures, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Tes captures d'abord** (règle 1) : la page `Collectors` au format bureau et à 375 px, la liste des collectionneurs derrière un chiffre, un segment avec les nouveaux critères, `THE PROGRAM` avec `Birthday credit`, la page d'une commande avec un crédit d'anniversaire, et IN USE avec BIRTHDAY CREDIT dans l'application. Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** (dans la console, sur ton ordinateur) :

- **I1 est en production**, avec le mode clair, au commit `427546ea62a1d7a0cd9013033ffc50449735c064` (§2.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, et **aucun test de TEST ENTRANTS** prévu ce matin-là : le premier calcul du score et l'historique tournent dans la fenêtre du matin, et le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Le crédit d'anniversaire part allumé** : 20 €, 30 jours, dans la devise des crédits de `THE PROGRAM` (ton choix). Si tu veux le commencer plus tard, coupe-le dans `Club` → `Tiers` → `THE PROGRAM` juste après le déploiement.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), §6, aussi dans `Documents`) : « Le crédit d'anniversaire » (où il s'affiche, `Apply credit`, l'anniversaire d'abord puis les paliers, pourquoi il n'est parfois pas donné), et que le score d'engagement est réservé au personnel : on ne le dit jamais au client (§3 du playbook).

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_I2>`, avec une coche verte. Sinon, n'avance pas.

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

Sortie attendue : `427546ea62a1d7a0cd9013033ffc50449735c064` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=427546ea62a1`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 427546ea62a1 OK (previous f360b24aaa37)` : le mode clair, sans migration, est le dernier déploiement réussi, après I1. Une autre ligne : arrête-toi et demande à Claude.

**4. `RESTORE_ALLOWED=false`** :

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`.

### 2.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_I2>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 427546e..<7 caractères de SHA_I2>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_I2>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 4), contre le commit final de I1, jamais contre H2 :

```bash
git -C /opt/orbes/orbes-index diff --stat 10688354808d874bc123c0e6729ffce5b733339d HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales** (règle 10) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-10';`, toujours celle de H2, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : quarante-cinq lignes, de `0001_initial` à `0044_client_notes` ; les deux dernières :

```text
0043_acquisition
0044_client_notes
```

### 2.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « ORBES I2 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_I2>, 3 migrations, rien ne change sur l'hôte. Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_I2> (tag <TAG_I2>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_I2>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 427546ea62a1
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 45 migration(s) applied, all known to orbes-genome:<TAG_I2>
   ```

   **Il faut lire `45 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `427546ea62a1`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_I2>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_I2>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur), et sa taille est le chiffre « avant » de la règle des 50 Mo (plan §8).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_I2>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_I2>
   Applied 3 migration(s): 0045_birthday_credit, 0046_engagement_scores, 0047_collector_history
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
   … [deploy.sh] deployed orbes-genome:<TAG_I2> (previous: 427546ea62a1). This release applied the migration(s) 0045_birthday_credit, 0046_engagement_scores, 0047_collector_history:
   … [deploy.sh] orbes-genome:427546ea62a1 cannot run on this schema any more (scripts/deploy.sh --image 427546ea62a1 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_I2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 2.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §2.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `427546ea62a1`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:427546ea62a1` et `rolled back to 427546ea62a1; the stack is healthy` | Les migrations n'ont pas été appliquées (une seule transaction), et le site est revenu tout seul sur `427546ea62a1`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 427546ea62a1 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_I2> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `427546ea62a1`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_I2>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §2.3 avec ce commit, puis la commande gardée du §2.4. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 427546ea62a1`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`. Un crédit d'anniversaire donné n'est jamais retiré.

### 2.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_I2> OK (previous 427546ea62a1; migrations 0045_birthday_credit, 0046_engagement_scores, 0047_collector_history)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 48 lignes `applied`, de `0001_initial` à `0047_collector_history`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Le serveur, après** (les six mêmes qu'au §2.1, à comparer) :

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

**Préviens le responsable de l'hôte** : « ORBES I2 fait à <heure> Paris (<heure> UTC), 3 migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. Le calcul du score et l'historique tournent dans la fenêtre du matin ; leurs chiffres suivent. »

### 2.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, puis sur ton téléphone (Safari) avec le compte d'essai de la maison.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| §3.5 | Console | `Club` → `Tiers`, `THE PROGRAM` | La ligne `Birthday credit` : « € 20 · valid 30 days » |
| §3.5 | Téléphone | YOUR PROFILE, sous DATE OF BIRTH | « On your birthday, ORBES gives you a credit of € 20, valid 30 days. » |
| §3.6 | Console | `Segments`, un nouveau segment ; puis une LIVE RELEASE en brouillon, son `Segment` | Les cinq nouveaux groupes, dont `Engagement score` ; un segment qui lit le score se choisit dans `Segment` (question 15). Ne le publie pas. |
| §3.6 | Console | `Collectors` ; un chiffre ; une ligne de la liste ; dans `What they like`, une ligne des modèles les plus désirés | Les sept panneaux ; la liste de ses collectionneurs, puis `Back to the figures` ; la fiche client ; la liste de ceux qui désirent ce modèle (question 16) |
| §3.6 | Console | Une connexion OPERATOR, la page `Collectors` | Pas de bouton `Export (CSV)` |
| §3.6 | Console | En ADMIN : `Export (CSV)`, puis `Export` ; ensuite `Audit log` | Un fichier `orbes-collectors-<jour>.csv` téléchargé ; au journal, `collectors.export`, avec des comptes seulement, jamais une adresse e-mail |

Le fichier contient des données personnelles : garde-le en lieu sûr et supprime-le quand tu as fini (il n'est jamais gardé sur le serveur). Pour compter ses colonnes, sur ton Mac (il ne fait que lire le dernier export de `Téléchargements`) :

```bash
python3 -c 'import csv, glob, os; f = sorted(glob.glob(os.path.expanduser("~/Downloads/orbes-collectors-*.csv")))[-1]; print(f, len(next(csv.reader(open(f, encoding="utf-8-sig")))))'
```

Sortie attendue : le chemin du fichier, puis `76`.

### 2.8 Après la première fenêtre du matin

Après 09:30 à Paris (07:30 UTC ; 08:30 à Paris après le 25 octobre) le jour du déploiement, ou vingt minutes après le déploiement s'il est plus tard, sur le serveur, en `orbes` dans `deploy/vps` :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select day, accounts, changed, duration_ms from engagement_runs order by day desc limit 1"'
```

Sortie attendue : une ligne `<AAAA-MM-JJ>|<comptes>|<lignes changées>|<millisecondes>`, le jour de Paris : le premier calcul du score est fini. Rien, ou des cases vides : une salle de LIVE RELEASE ou un test de TEST ENTRANTS le fait attendre ; relance dans vingt minutes.

```bash
docker compose logs app --since 24h | grep -E 'engagement scores calculated|collector history'
```

Sortie attendue : une ligne qui finit par `"msg":"engagement scores calculated"` (les comptes, les lignes changées et les millisecondes), et une ligne `collector history back-filled: 12 months, <N> collectors`.

```bash
docker compose logs app --since 24h | grep 'intelligence sizes'
```

Sortie attendue : la ligne du jour, qui finit par `"msg":"intelligence sizes"`, avec les octets de chaque table du lot (`tables`) et leur `total`.

**Dans la console** : la fiche client du compte d'essai montre son score et ses cinq parties en tête de `Intelligence`, et, dans son bloc `Club`, la date du prochain crédit d'anniversaire (`Next on …`) s'il a une date de naissance.

**Le lendemain**, avec les mêmes commandes qu'au §1.8 : la ligne `intelligence sizes` du matin et la taille de la sauvegarde de nuit. Colle les sorties à Claude : il compare le temps du calcul, les tailles et la sauvegarde avec leurs estimations (plan §8) et te signale, avec ses chiffres, ce qui dépasse de plus de 20 %. Il les envoie au responsable de l'hôte avec les contrôles d'après.

```bash
free -h
```

Sortie attendue : la ligne `Swap` proche de celle d'avant le déploiement (§2.1).

### 2.9 Ensuite

- **Les premiers vrais liens** dans `Links`, si ce n'est pas encore fait : la bio d'Instagram, chaque influenceur.
- **La règle des 50 Mo** : la ligne `VISITOR DATA` de l'état du serveur et la ligne `intelligence sizes` du matin, comme après I1.
- **Dans trois mois** (vers le 15 janvier 2027) : Claude t'apporte la vraie répartition de la dépense sur 12 mois des collectionneurs, et de nouveaux paliers de dépense pour le score (question 13). Une fois d'accord, ils partent comme formule 2.
- **Les anciennes images (facultatif).** Une fois I2 stable, `427546ea62a1` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_I2>`), la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 3. Ce qui reste à ta décision (sans bloquer)

1. **La ligne légale du plan (§0.12)**, avant le lancement public, sans retenir aucun déploiement : la politique de confidentialité réécrite et le consentement demandé pour le profil, les vues, l'appareil et la ville, l'origine des visites, le score et l'export.
2. **À 50 Mo de sauvegarde** (question 4) : tout reste 13 mois jusque-là ; les chiffres te reviennent à la ligne.
3. **Les captures du plan §5.3** : le dessin du cœur, ce que lit l'AUDITOR (les villes retenues, un peu plus qu'aujourd'hui) et les tailles du premier matin (§1.8).
