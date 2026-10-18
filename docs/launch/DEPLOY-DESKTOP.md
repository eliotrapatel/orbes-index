# Mise en production de la version ordinateur

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

La version ordinateur (plan du 2026-10-16 : CINEMA, la version que tu as choisie, sur la production d'aujourd'hui, I2 et ORBES CARE compris) part en production en **un seul déploiement**, comme ORBES CARE ([son runbook](DEPLOY-ORBES-CARE.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| Ordinateur | /verify et les pages légales composées pour un ordinateur (une fenêtre d'au moins 1024 px, avec une souris ou un pavé tactile) : CINEMA, en mode sombre et en mode clair ; la page SCAN ; la connexion, YOUR ACCOUNT, MESSAGES et chaque commande sur leur propre page ; la galerie d'un modèle ; le téléphone et la tablette inchangés | aucune | aucun | **À faire** (§1) |

Le point de départ : la production tourne ORBES CARE, le commit `c3d25c207a9429aa927ef1b9ba39404e208c2f2e` (image `orbes-genome:c3d25c207a94`), avec les quarante-neuf migrations de `0001_initial` à `0048_orbes_care`. La branche du lot, `orbes-desktop`, part de ce commit. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image (un correctif après ORBES CARE), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer (le commit de la production est alors fusionné dans le travail du lot, les preuves repassent, la branche du lot est refaite et la CI repasse). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les écrans d'abord.** Avant la fusion, tu regardes l'ensemble des écrans que te donne le rapport de Claude (§1.1) et tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. La seule route nouvelle, `GET /api/v1/account/messages/unread-count`, passe par le chemin `/api/v1` que Caddy sert déjà.
5. **Aucune migration** : le schéma reste à `0048_orbes_care`. L'image d'ORBES CARE peut donc revenir à tout moment (§1.5) : aucune donnée n'est changée.
6. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
7. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
8. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-desktop` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
9. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
10. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
11. **Les pages légales ne changent pas** : la version reste `2026-10-15` (ta réponse Q3). Sur un ordinateur, quelques phrases se lisent avec les mots d'un ordinateur au moment de l'affichage (la question du son de l'aide, la ligne `orbes.sound` de la politique de confidentialité, deux mots de l'article 13) ; le texte publié et sa version restent ceux d'aujourd'hui.
12. **Le site theorbes.com ne change pas.**

---

## 1. Le déploiement

### 1.0 Ce qui change

**Pour les collectionneurs, sur un ordinateur (/verify et les pages légales)**

- **CINEMA** : chaque écran composé pour la fenêtre, jamais le téléphone en plus large. Une page sur une chose (NOW, une sortie, un modèle, une pièce, un résultat) s'ouvre sur sa photographie, plein cadre, ses mots en deux blocs en bas ; une barre en haut de chaque page, collée en haut (ORBES, le menu NOW · RELEASES · COLLECTION · CIRCLE · PIECES, SCAN et le compte) ; le pied de page sur une ligne ; le survol et l'appui sur chaque bouton et chaque lien. En mode clair, CINEMA en blanc. La salle d'une LIVE RELEASE reste dans le noir.
- **SCAN** ouvre la page SCAN AN ORBES CODE : un ordinateur n'ouvre pas d'appareil photo. Elle montre un code que l'appareil photo du téléphone ouvre (`https://verify.theorbes.com/verify`), et UPLOAD A PHOTO, pour envoyer une photo du code depuis l'ordinateur.
- **Des pages, jamais des feuilles** : la connexion (sur une photographie), YOUR ACCOUNT et chacune de ses pages, MESSAGES en deux parties (les sujets à gauche, la conversation à droite), chaque commande sur sa propre page depuis MY PIECES → ORDERS (avec ses DOCUMENTS et ORBES CARE CONDITIONS · PDF).
- **La galerie d'un modèle** en grille, chaque photographie agrandie dans une visionneuse (PREVIOUS, NEXT, CLOSE).
- **ORBES CARE et I2 sur un ordinateur** : l'onglet ORBES CARE d'une pièce en deux colonnes, WARRANTY à gauche ; SERVICE en lignes ; l'onglet ORBES CARE d'un résultat ; IN USE avec BIRTHDAY CREDIT ; la ligne de DATE OF BIRTH sous son champ. Rien ne lance une demande au titre de la garantie.
- **Les mots d'un ordinateur** : *on this computer*, CLICK AGAIN…, *One choice.* ; le son est coupé au départ (SOUND OFF), et SOUND ON reste choisi.
- **Le téléphone et la tablette ne changent pas** : chaque iPhone, Android et iPad garde la version téléphone, mot pour mot et pixel pour pixel. Un ordinateur à écran tactile (un portable Windows, un Chromebook) a la version ordinateur, ses boutons touchables au doigt.

**Pour le serveur**

- **Une route en lecture seule** : `GET /api/v1/account/messages/unread-count` (le nombre de réponses non lues, la carte MESSAGES de YOUR ACCOUNT), derrière la session du compte ; et l'identifiant du sujet de chaque message dans la conversation (`concerning.ref`), pour qu'une réponse reste sur son sujet ([API §10.17](../API.md)).
- **Ce que regardent les collectionneurs** (ta réponse Q4) : une page d'ordinateur compte comme sa page de téléphone (la page d'une commande comme MY ORDERS), sans nouveau nom de page.
- **Aucune migration**, **Caddy** : rien ne change, **les variables** : rien ne change.
- **Une coupure courte** : l'application redémarre sur la nouvelle image. En général, moins d'une minute.
- **Le retour en arrière reste possible** : aucune migration, donc l'image `c3d25c207a94` peut revenir à tout moment (§1.5).

Dans la suite, `<SHA_DESK>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_DESK>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : tes écrans, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Tes écrans d'abord** (règle 1) : l'ensemble que te donne le rapport de Claude, chaque écran de l'ordinateur à 1440 × 900 en mode sombre et en mode clair, ORBES CARE, I2 et CINEMA en blanc aussi à 1024 × 768 et 1920 × 1080, une galerie de démonstration, et la liste des choix par défaut (D1 à D21) avec une capture de chacun ; et l'aperçu local sur ton Mac, `http://127.0.0.1:8093`. Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** :

- **ORBES CARE est en production**, au commit `c3d25c207a9429aa927ef1b9ba39404e208c2f2e` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §2 « Sur un ordinateur : la page d'une commande », §3 « Sur un ordinateur, MESSAGES par sujet » (une réponse se range sous le dernier message du client, GENERAL sinon) et §3 UNREADABLE CODE (la page SCAN et sa phrase sur un ordinateur).

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-desktop>. Le dernier passage de `genome-ci` doit être celui de `<SHA_DESK>`, avec une coche verte. Sinon, n'avance pas.

**4. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 8) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_DESK>` exactement, comme pour ORBES CARE. Claude te donne la commande dans son rapport ; il ne la lance pas.

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

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

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

**8. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

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

Sortie attendue : `c3d25c207a9429aa927ef1b9ba39404e208c2f2e` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=c3d25c207a94`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy c3d25c207a94 OK (previous 90d9d3007e20; migrations 0048_orbes_care)` : ORBES CARE est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_DESK>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating c3d25c2..<7 caractères de SHA_DESK>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_DESK>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 4), contre le commit d'ORBES CARE en production :

```bash
git -C /opt/orbes/orbes-index diff --stat c3d25c207a9429aa927ef1b9ba39404e208c2f2e HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**Aucune migration** (règle 5), contre le même commit :

```bash
git -C /opt/orbes/orbes-index diff --stat c3d25c207a9429aa927ef1b9ba39404e208c2f2e HEAD -- genome/src/server/db
```

Sortie attendue : **rien**. Une ligne : arrête-toi et demande à Claude.

**La version des pages légales** (règle 11) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-15';`, la version d'aujourd'hui, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : quarante-neuf lignes, de `0001_initial` à `0048_orbes_care` ; les deux dernières :

```text
0047_collector_history
0048_orbes_care
```

### 1.4 Déployer

Hors des heures de la règle 2. Envoie au responsable de l'hôte une ligne au lancement, par exemple : « Version ordinateur : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_DESK>, aucune migration, rien ne change sur l'hôte. Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_DESK> (tag <TAG_DESK>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_DESK>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: c3d25c207a94
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 49 migration(s) applied, all known to orbes-genome:<TAG_DESK>
   ```

   **Il faut lire `49 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `c3d25c207a94`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_DESK>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_DESK>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Le redémarrage** (la coupure courte commence ici), **sans migration** :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_DESK>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_DESK>
   Schema is up to date.
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Schema is up to date.`** : aucune migration n'est appliquée. `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`). Caddy n'est pas recréé : sa configuration ne change pas.

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
   … [deploy.sh] deployed orbes-genome:<TAG_DESK> (previous: c3d25c207a94). Manual rollback: scripts/deploy.sh --image c3d25c207a94
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
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `c3d25c207a94`. | Rien. Colle la sortie, attends la réponse. |
| Une erreur, puis `── rollback to orbes-genome:c3d25c207a94` et `rolled back to c3d25c207a94; the stack is healthy` | La nouvelle image n'a pas pris (santé, clé, tests de fumée), et le site est revenu tout seul sur `c3d25c207a94`. Aucune donnée n'a changé. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to c3d25c207a94 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle image tourne ; aucune migration n'a été faite. | Reviens à ORBES CARE : `pgrep -a pg_dump \|\| scripts/deploy.sh --image c3d25c207a94` (sans construction : l'image est déjà sur le serveur). Puis colle la sortie à Claude. |

Dans tous les cas : **jamais `restore.sh`**, jamais de `prune`, et **ne retire jamais l'image `c3d25c207a94`** : c'est celle du retour en arrière.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_DESK> OK (previous c3d25c207a94)`, sans migration.

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

La nouvelle route, sans session :

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/api/v1/account/messages/unread-count
```

Sortie attendue : `401` : elle existe et demande un compte connecté.

Les feuilles de style de l'ordinateur, servies avec la page :

```bash
curl -s https://verify.theorbes.com/verify | grep -c 'verify-desktop-'
```

Sortie attendue : `2` : celle du survol et celle de la mise en page, chacune sous sa condition. `0` : l'ancienne page est encore servie, dis-le à Claude.

**Préviens le responsable de l'hôte** : « Version ordinateur faite à <heure> Paris (<heure> UTC), aucune migration, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Sur ton téléphone (Safari), puis sur ton ordinateur, la fenêtre en plein écran, avec le compte d'essai de la maison. Tes vraies photographies dans leurs cadres se voient ici pour la première fois : une photographie dont le cadre coupe la pièce, note-la pour un point focal par photographie, plus tard (D17).

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| Le téléphone | Téléphone | NOW, une pièce et son onglet ORBES CARE, SCAN ORBES CODE sur une pièce, YOUR ACCOUNT | Exactement comme hier : rien ne change sur un téléphone |
| NOW | Ordinateur | verify.theorbes.com/verify | La photographie plein cadre, ses mots en bas ; la barre en haut avec ORBES, NOW · RELEASES · COLLECTION · CIRCLE · PIECES, SCAN et ton compte ; SOUND OFF au pied de page |
| THE RELEASES | Ordinateur | RELEASES | Chaque sortie dans son cadre, les onglets LIVE et PAST |
| Un modèle | Ordinateur | COLLECTION, un modèle avec une galerie | Sa photographie plein cadre, la galerie en grille ; une photographie agrandie avec PREVIOUS, NEXT et CLOSE |
| L'onglet ORBES CARE | Ordinateur | PIECES, une pièce, ORBES CARE | Deux colonnes : WARRANTY à gauche ; PRIVATE CARE et CARING FOR THIS PIECE à droite ; WRITE TO ORBES CLIENT SERVICES dessous |
| SCAN | Ordinateur, puis téléphone | SCAN dans la barre | La page SCAN AN ORBES CODE ; son code, visé avec l'appareil photo du téléphone, ouvre verify.theorbes.com/verify sur le téléphone ; UPLOAD A PHOTO d'une photo d'un ORBES CODE mène à son résultat |
| La connexion | Ordinateur | SIGN OUT, puis SIGN IN dans la barre | La page de connexion sur une photographie, SIGN IN et CREATE ACCOUNT |
| YOUR ACCOUNT et MESSAGES | Ordinateur | Ton compte dans la barre ; la carte MESSAGES | Chaque carte ouvre sa page ; MESSAGES en deux parties, les sujets à gauche |
| Une commande | Ordinateur | PIECES, ORDERS, une ligne | La page de la commande, ses DOCUMENTS avec ORBES CARE CONDITIONS · PDF |
| Les pages légales | Ordinateur | PRIVACY, TERMS, LEGAL, HELP au pied de page | Le texte avec la liste de ses sections à côté ; « Version of 15 October 2026 » sous le titre |
| Le mode clair | Ordinateur | YOUR ACCOUNT, LIGHT MODE, puis de nouveau | CINEMA en blanc, puis de nouveau dans le noir |
| La console du navigateur | Ordinateur | Les outils de développement, onglet Console, sur une page de tirage | Aucune erreur, sauf le 404 connu d'une page de tirage (signalé à part, D18) |

### 1.8 Ensuite

- **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1) : ce qu'un collectionneur voit sur un ordinateur (§2 et §3 du playbook) ; une réponse dans `Messages` se range, chez le client sur un ordinateur, sous son dernier message.
- **Les deux défauts de la production vus en passant** (D18), chacun un petit correctif à part, sur ton accord : le 404 d'une page de tirage dans la console du navigateur, et le fond sombre de l'écran de vérification d'une photo en mode clair sur un téléphone.
- **Garde l'image `c3d25c207a94`** sur le serveur : c'est celle du retour en arrière (§1.5).

## 2. Ce qui reste à ta décision (sans bloquer)

1. **Les choix par défaut du plan** (D1 à D21), que tu peux changer à tout moment : chacun devient un petit commit, sa CI, puis un déploiement comme celui-ci.
2. **Les titres de page et l'indexation** (D19) : chaque onglet lit toujours « ORBES — Authentication ». Une question pour plus tard.
3. **Le nom de la plateforme et son adresse** : le code de la page SCAN ouvre `https://verify.theorbes.com/verify`, à changer avec le nom s'il change.
4. **Les limites mesurées et gardées** (la netteté d'une photographie au plafond de 2 000 px, la pièce un peu haute dans un cadre clair, un point focal pour toutes les photographies) : à revoir sur tes vraies photographies (§1.7).
