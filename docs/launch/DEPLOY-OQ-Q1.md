# Mise en production du lot ONE QUEUE (Q1)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot Q1 de tes décisions sur la file d'une LIVE RELEASE (ONE QUEUE : une seule file, des tours donnés par lots au rythme de la sortie, une attente après l'ouverture, le rythme caché aux téléphones, les écrans et les sons de la maquette) part en production en **un seul déploiement**, après celui de MACRO M3 ([son runbook](DEPLOY-MACRO-M3.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| ONE QUEUE (lot Q1) | La file unique d'une LIVE RELEASE : des lots de X tours toutes les Y minutes, seulement là où une pièce de la taille est libre, une attente après l'ouverture, les pièces rendues, libérées ou ajoutées offertes au lot suivant (D1 à D7) ; le rythme caché aux téléphones, chacun ne lisant que sa place dans sa taille et son temps estimé (D8, D9) ; la console d'une LIVE RELEASE (rythme et attente demandés à la création, SHORTEN THE HOLD et END THE HOLD NOW, les chiffres ajoutés, D10 à D12) ; chaque écran, passage et son de la maquette, sur téléphone et ordinateur, en mode sombre et en mode clair ; HOW RELEASES WORK et l'article 13 des conditions | `0058_one_queue` | aucun | **À faire** (§1) |

Le point de départ : la production tourne MACRO M3, son commit `33e843081148caf6c0d42ff98047a678a27e7708` (image `orbes-genome:33e843081148`, déployée le 23 octobre 2026 à 07:01 à Paris (05:01 UTC)), avec les 58 migrations de `0001_initial` à `0057_sets`. **Q1 ne part qu'après M3** : sa migration s'appuie sur `0057_sets`. Avant le jour, Claude remplace dans ce document `<SHA_Q1>` et `<TAG_Q1>` par le commit final de Q1 (40 caractères) et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `33e843081148` (un correctif après M3, ou le lot M4 déployé avant), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur le tableau de revue d'abord.** Avant la fusion, tu regardes le tableau de revue que te donne le rapport de Claude (§1.1) : les captures de chaque écran, et les noms de la console (OP-12). Tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.** Le redémarrage couperait la salle, la file et les tours en cours. Tu déploies quand aucune LIVE RELEASE n'a sa salle ouverte, ni ne l'ouvre dans l'heure (le pré-contrôle du §1.1 le lit), et quand aucun test de TEST ENTRANTS ne tourne.
4. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures des règles 2 et 3, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
5. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. Les sons sont des fichiers de l'application, servis sous `/assets/` comme ses images et ses polices. Ton `.env` ne gagne aucune ligne.
6. **Une migration, puis plus de retour en arrière** : après `0058_one_queue`, l'image `33e843081148` ne tourne plus sur le schéma (`deploy.sh --image 33e843081148` la refuse). En cas de souci, on **répare en avant** (§1.5).
7. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
8. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
9. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-one-queue` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
10. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
11. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
12. **Les pages légales changent** : les conditions, article 13, deux phrases seulement (*The pace* et *A piece that returns*), en anglais et en français, dans une seule nouvelle version, `2026-10-24`. La politique de confidentialité ne change pas. Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La relecture par un avocat ne retient jamais le déploiement.
13. **Les tests de 5 000 entrants d'essai suivent les conditions de l'hôte** (§1.7) : de jour, annoncés au responsable de l'hôte la veille, une ligne au début et une à la fin, par paliers de 1 000, un test à la fois, arrêtés à ses seuils.

---

## 1. Le déploiement

### 1.0 Ce qui change

**Pour les collectionneurs (/verify, sur un téléphone et sur un ordinateur, en mode sombre et en mode clair ; la salle reste sombre en mode clair)**

- **La salle** : la porte est une ligne d'horizon avec un point qui respire ; au-dessus, le compte à rebours, UNTIL THE OPENING et le nombre de personnes dans la salle ; READY CHECK sur des filets. Les dix dernières secondes sonnent.
- **Le tirage et l'ouverture, sur place** : à 00:00, DRAWING THE PLACES prend la place du compte à rebours, le point parcourt la ligne ; puis la ligne s'ouvre sur la file, avec le son de l'ouverture et, une fois par entrée, la voix d'accueil.
- **La file unique**, la même à chaque étape : LIVE NOW, le nom et sa variante, la taille et le nombre de pièces, YOUR PLACE (la place dans sa taille, un seul chiffre), ESTIMATED 17 MINUTES LEFT (ou ESTIMATED 1 H 12 MIN LEFT, ou ESTIMATED LESS THAN A MINUTE LEFT), la bande Horizon du stock (LAST PIECES à 10 % ou moins), la note, FROM ORBES et LEAVE THE LINE. Jamais le rythme, la longueur de la file, une pièce tenue ni une raison d'attendre. PAUSED et THE QUEUE IS PAUSED gardent le temps figé.
- **Le tour, la tenue, SECURED** : le sceau C dans ses anneaux, PRESS AND HOLD THE SEAL, l'anneau fin de HOLD, puis SECURED et PAY, où le temps pour payer est dans la lumière du bouton, avec le total.
- **CONFIRMED** dans le monde sombre, la grande photographie et le monogramme seul sur son horizon. **SOLD OUT** dans sa taille : le titre seul, une phrase, LEAVE THE LINE. **L'after-room** : sa porte, l'horizon ouvert, et sa file sans temps.
- **Les sons dessinés** : onze fichiers (le tic de la salle, le tirage, l'ouverture, la voix d'accueil, la place, le tour, la tenue, SECURED, CONFIRMED, SOLD OUT, l'after-room), qui suivent le réglage SOUND du pied de page.
- **HOW RELEASES WORK** gagne THE PACE ; les pages légales, la nouvelle version, `2026-10-24` (règle 12).

**Pour le personnel (la console)**

- **`New live release`** et la partie `Times (UTC)` d'une sortie demandent `People per batch`, `Every (minutes)` et `Hold after the opening (minutes, 0 = none)`. Avant l'annonce, l'attente se règle comme tout réglage ; après, seulement `Shorten the hold` ou `End the hold now`.
- **Le bloc `Pace` du tableau en direct** garde `In the queue`, `Admitted`, `Batches` et `Next batch`, et gagne `Turns given`, `Beyond the pieces` et, pendant l'attente, `Hold ends`, à l'heure de Paris. `Next batch now` dit son refus quand aucune pièce n'est libre. L'avertissement `AT THIS PACE, … AT THE CLOSE`, un conseil seulement, propose `Extend`, `Set pace` et `Next batch now`.
- **La ligne** : le filtre `Waiting in the queue` et le filtre `Beyond the pieces` ; pour chaque entrée, `Queue place` et `Estimated turn` ; la colonne `Admitted` dit le lot qui a donné le tour, et quand. **Le rapport** gagne l'attente la plus longue, les tours donnés par le rythme et les personnes parties de la file. Le rapport de TEST ENTRANTS lit `The pace` de ONE QUEUE.

**Pour le serveur**

- **Les lots donnent les tours** : jamais plus de X par lot, dans l'ordre de la file, seulement là où une pièce de la taille est libre, au plus un lot par instant. Seuls les téléphones qu'un lot peut atteindre gardent leur flux en direct ; les autres relisent leur page toutes les 10 secondes à une minute. Deux routes nouvelles de la console, sous `/api` que Caddy sert déjà, pour raccourcir ou finir l'attente ([API](../API.md)).

**La migration**, appliquée dans **une seule transaction** : si elle échoue, rien n'est appliqué et le site revient tout seul sur `33e843081148`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0058_one_queue` | D1, D4, D6 | l'attente après l'ouverture d'une LIVE RELEASE (`pace_hold_minutes`, 0 à 120, 0 partout), les lots donnés par NEXT BATCH NOW (`pace_extra_batches`, 0 partout), et la règle qu'une LIVE RELEASE ouverte a un rythme ; elle refuse de s'appliquer tant qu'une LIVE RELEASE ouverte n'en a pas |

  L'application est arrêtée pendant la migration. Une fois appliquée, on ne revient plus en arrière (ci-dessous).

- **Les variables** : aucune nouvelle. Ton `.env` ne change pas.
- **Une coupure courte** : l'application est arrêtée pendant la migration, puis redémarrée. Caddy n'est pas recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois la migration faite, l'image `33e843081148` ne peut plus tourner sur ce schéma. `deploy.sh --image 33e843081148` la refuse.

### 1.1 Avant : le tableau de revue, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Le tableau de revue d'abord** (règle 1). Les captures, au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair : la salle, le tirage, l'ouverture, la file dans chacun de ses états, SOLD OUT dans sa taille, le tour, HOLD, SECURED et PAY, CONFIRMED, la porte et la file de l'after-room, HOW RELEASES WORK et les pages légales nouvelles. Dans la console, les noms gardés (OP-12) :

- le filtre `Waiting in the queue` de la ligne (le statut `Waiting` garde son nom) ;
- `Shorten the hold` et `End the hold now` ;
- les chiffres gardés, avec leur sens : `In line` en haut du tableau, `Admitted` dans le bloc `Pace` (« GIVEN A TURN, ALL WAYS ») ;
- la prévision de rupture, qui dit `No sales rate yet` tant qu'aucune vente ne donne de rythme ;
- et cette ligne : « L'attente après l'ouverture (Hold after the opening) se règle jusqu'à l'annonce, comme tout réglage ; après l'annonce, seulement SHORTEN THE HOLD ou END THE HOLD NOW, jamais plus longue ».

Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** :

- **MACRO M3 est en production**, au commit `33e843081148caf6c0d42ff98047a678a27e7708` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** entre l'ouverture de sa salle et sa fin, ni dont la salle ouvre dans l'heure (règle 3 ; le point 9 le lit), et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §2 « Une LIVE RELEASE à son rythme : la file d'attente ». Le temps estimé peut bouger ; une pièce libre attend le lot suivant ; on ne donne jamais de chiffre du rythme ni de raison.

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-one-queue>. Le dernier passage de `genome-ci` sur `<SHA_Q1>` doit avoir une coche verte (ses quatre parties). Sinon, n'avance pas.

**4. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 9) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_Q1>` exactement, comme pour M3. Claude te donne la commande dans son rapport ; il ne la lance pas.

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

**9. Les LIVE RELEASES, en lecture seule.** D'abord, aucune LIVE RELEASE ouverte sans rythme (la migration refuserait de s'appliquer) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and parent_drop_id is null and pace_batch is null and ended_at is null and cancelled_at is null"'
```

Sortie attendue : `0`. Un autre nombre : une LIVE RELEASE (un brouillon compris) a été créée sans rythme. Ne déploie pas et dis-le à Claude : c'est à toi de dire ce qu'elle devient (lui donner un rythme sur sa page, ou l'annuler).

Puis, aucune LIVE RELEASE dont la salle est ouverte, ou ouvre dans l'heure (règle 3) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

Sortie attendue : `0`. Un autre nombre : une sortie est en cours ou va ouvrir sa salle ; attends sa fin (ou déploie plus tôt un autre jour).

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

Sortie attendue : `33e843081148caf6c0d42ff98047a678a27e7708` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=33e843081148`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 33e843081148 OK (previous 946cc1706039; migrations 0054_boxes_weights, 0055_location_countries, 0056_addons, 0057_sets)` : MACRO M3 est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_Q1>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 33e8430..<7 caractères de SHA_Q1>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_Q1>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 5), contre le commit de M3 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status 33e843081148caf6c0d42ff98047a678a27e7708 HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**La migration, et elle seule** (règle 6) :

```bash
git -C /opt/orbes/orbes-index diff --name-status 33e843081148caf6c0d42ff98047a678a27e7708 HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement cette ligne (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0058_one_queue.ts
```

**La version des pages légales** (règle 12) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-24';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 58 lignes, de `0001_initial` à `0057_sets` ; les deux dernières :

```text
0056_addons
0057_sets
```

Une liste qui s'arrête avant `0057_sets` : M3 n'est pas en production, arrête-toi.

### 1.4 Déployer

Hors des heures des règles 2 et 3. **Juste avant**, relance la seconde requête du §1.1, point 9 (aucune salle ouverte, aucune qui ouvre dans l'heure) : `0`, sinon attends.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement ONE QUEUE lancé à <heure> Paris (<heure> UTC), une migration, rien ne change sur l'hôte. » Ajoute-y l'image, `orbes-genome:<TAG_Q1>`, et les six résultats du pré-contrôle (§1.1, point 7).

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_Q1> (tag <TAG_Q1>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la même configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_Q1>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 33e843081148
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : le site tourne toujours sur `33e843081148`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 58 migration(s) applied, all known to orbes-genome:<TAG_Q1>
   ```

   **Il faut lire `58 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `33e843081148`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_Q1>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_Q1>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **La migration et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_Q1>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_Q1>
   Applied 1 migration(s): 0058_one_queue
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 1 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) ; Caddy garde son conteneur, sa configuration n'ayant pas changé.

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
   … [deploy.sh] deployed orbes-genome:<TAG_Q1> (previous: 33e843081148). This release applied the migration(s) 0058_one_queue:
   … [deploy.sh] orbes-genome:33e843081148 cannot run on this schema any more (scripts/deploy.sh --image 33e843081148 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_Q1> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`. Le retour en arrière n'existe qu'**avant** la migration ; après, on répare en avant. La migration elle-même ne se défait pas : son `down` refuse dès qu'une sortie a une attente après l'ouverture.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `33e843081148`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| `migration 0058_one_queue cannot be applied: <n> open LIVE releases have no pace`, puis `── rollback to orbes-genome:33e843081148` et `rolled back to 33e843081148; the stack is healthy` | Une LIVE RELEASE ouverte n'a pas de rythme (le §1.1, point 9, l'aurait lue) : la migration n'a rien appliqué, et le site est revenu tout seul sur `33e843081148`. | Rien d'autre. Dis-le à Claude : c'est à toi de dire ce que devient cette sortie, puis on relance. |
| Une autre erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:33e843081148` et `rolled back to 33e843081148; the stack is healthy` | La migration n'a pas été appliquée (une seule transaction), et le site est revenu tout seul sur `33e843081148`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 33e843081148 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_Q1> failed (…) and is KEPT` et `Repair forward:` | La migration est faite, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `33e843081148`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_Q1>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, ne publie aucune vraie LIVE RELEASE. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 33e843081148`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_Q1> OK (previous 33e843081148; migrations 0058_one_queue)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 59 lignes `applied`, de `0001_initial` à `0058_one_queue`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que la migration a écrit**, en lecture seule : aucune attente, aucun lot de NEXT BATCH NOW, aucune LIVE RELEASE ouverte sans rythme.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from drops where pace_hold_minutes <> 0), (select count(*) from drops where pace_extra_batches <> 0), (select count(*) from drops where room_opens_minutes is not null and parent_drop_id is null and pace_batch is null and ended_at is null and cancelled_at is null)"'
```

Sortie attendue : `0|0|0`.

**La console** (sur ton ordinateur, en ADMIN) : `Club`, section `Drops` → `New live release`. Le dialogue demande `People per batch`, `Every (minutes)` et `Hold after the opening (minutes, 0 = none)` (« Up to 120: everyone waits it before the first batch. »). Ferme-le sans rien créer.

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

**Les sons, servis en `/assets/*.mp3`** : la commande lit l'application publiée, y trouve chaque son, puis le télécharge.

```bash
for u in $(curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/verify | grep -o '/assets/verify-[A-Z0-9]*\.js' | head -1)" | grep -o '/assets/[a-z-]*-[A-Z0-9]\{8\}\.mp3' | sort -u); do curl -s -o /dev/null -w "%{http_code} $u\n" "https://verify.theorbes.com$u"; done
```

Sortie attendue : exactement onze lignes, chacune `200`, une par son, dans cet ordre (les 8 caractères après le nom changent à chaque version) :

```text
200 /assets/after-room-<8 caractères>.mp3
200 /assets/confirmed-<8 caractères>.mp3
200 /assets/draw-<8 caractères>.mp3
200 /assets/hold-<8 caractères>.mp3
200 /assets/opening-<8 caractères>.mp3
200 /assets/place-<8 caractères>.mp3
200 /assets/room-tick-<8 caractères>.mp3
200 /assets/secured-<8 caractères>.mp3
200 /assets/sold-out-<8 caractères>.mp3
200 /assets/turn-<8 caractères>.mp3
200 /assets/welcome-<8 caractères>.mp3
```

Moins de onze lignes, une autre ligne, ou un autre code que `200` : colle la sortie à Claude.

**La version des pages légales**, dans l'application publiée :

```bash
curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\.js' | head -1)" | grep -o '2026-10-24' | head -n 1
```

Sortie attendue : `2026-10-24`. Rien : colle la sortie à Claude.

**Préviens le responsable de l'hôte** : « ONE QUEUE fait à <heure> Paris (<heure> UTC), une migration, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN ; dans l'application, avec deux comptes de collectionneur qui détiennent chacun une pièce du même modèle d'essai (le compte d'essai de la maison et celui de tes essais précédents conviennent), **A** sur ton téléphone (Safari), **B** sur ton ordinateur, dans une fenêtre de navigation privée (la console reste dans la fenêtre normale). SOUND reste ON au pied de la page (le réglage par défaut).

#### 1. Une sortie d'essai, du tirage à l'after-room

La sortie d'essai est **visible de tous** dans THE RELEASES et la bannière pendant une heure environ, puis pour toujours dans PAST et sur la fiche du modèle d'essai, avec son titre, le nom et la photographie du modèle d'essai et « 2 PIECES » : fais-la à une heure creuse. Seuls les propriétaires du modèle d'essai peuvent y entrer.

**La préparation, dans la console :**

1. `Club`, section `Drops` → `New live release` : `Model` le modèle d'essai, `Title` `TEST ONE QUEUE`, `Opening (UTC)` dans 30 minutes environ, `End of the sales (UTC)` une heure après, `People per batch` `1`, `Every (minutes)` `2`, `Hold after the opening (minutes, 0 = none)` `10`, `Price of a piece` `1`, `Currency` `EUR`, `Sizes` deux lignes, `52 = 1` et `54 = 1`.
2. Sur sa page : `Access` → `Edit` : `Owners of <le modèle d'essai>` coché, rien d'autre. `Times (UTC)` → `Edit` : `Room opens (minutes before)` `15`. La partie lit `Hold after the opening` : 10 minutes, avec « Everyone waits it, guarantees included ». `After-room` → `Edit` : `An after-room after a sell-out`, le modèle d'essai, `Price of a piece` `1`, `Sizes` `52 = 1`, `Opens (minutes after the sell-out)` `1`, `Open (minutes)` `5`. Puis `Publish`. Une fois publiée, la partie `Times (UTC)` dit sous l'attente « Once announced: only shortened or ended, on the live board » (la ligne N14 du tableau de revue).

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| La salle | A, puis B | La sortie : ENTER THE ROOM, la taille `52`, READY CHECK | La ligne d'horizon et son point qui respire ; au-dessus, le compte à rebours, UNTIL THE OPENING et « 2 IN THE ROOM » ; READY CHECK sur des filets, puis YOU’RE READY. Sur B, active LIGHT MODE (YOUR ACCOUNT, sous SOUND) : la salle reste sombre |
| Le tirage et l'ouverture | A et B | Attendre T0, la page ouverte | Les dix dernières secondes sonnent ; à 00:00, DRAWING THE PLACES et sa phrase à la place du compte à rebours, le son du tirage, le point qui parcourt la ligne ; puis la ligne s'ouvre sur la file, le son de l'ouverture, et la voix d'accueil, une fois |
| La file | A et B | Regarder | LIVE NOW ; SIZE 52 · 1 PIECE ; YOUR PLACE 1 sur l'un, 2 sur l'autre ; ESTIMATED 10 MINUTES LEFT environ sur le premier, 12 sur le second (l'attente est comptée, jamais nommée) ; la bande Horizon ; la note ; LEAVE THE LINE. Jamais un lot, un rythme ni la longueur de la file |
| Le tableau en direct | Console | La page de la sortie, son tableau en direct | Le bloc `Pace` : `In the queue` 2, `Turns given` 0, `Batches` 0, `Hold ends` à T0 + 10 minutes, à l'heure de Paris ; la ligne : `Queue place` et `Estimated turn` de chacun |
| PAUSE | Console, puis A et B | `Pause`, puis `Resume` une minute plus tard | « PAUSED » et sa phrase au-dessus du temps, figé ; il repart à `Resume` |
| PAUSE PACE | Console, puis A et B | `Pause pace`, puis `Resume pace` | « PACE PAUSED », `Next batch` lit `—` ; sur les téléphones, THE QUEUE IS PAUSED et « It resumes from where it stopped. », le temps figé ; il repart à `Resume pace` |
| SHORTEN THE HOLD | Console, puis A et B | `Shorten the hold`, `New length (minutes)` `8`, `Shorten the hold` | « Hold shortened. » ; `Hold ends` deux minutes plus tôt ; sur les téléphones, le temps estimé baisse à la lecture suivante, sans message |
| END THE HOLD NOW | Console, puis le premier de la file | `End the hold now`, `End the hold` | « Hold ended. » ; `Batches` 1, `Turns given` 1. Sur le premier, sur place, sans écran de passage : le sceau dans ses anneaux, YOUR TURN, PRESS AND HOLD THE SEAL, le son du tour |
| HOLD, SECURED, PAY | Le premier | Tenir le sceau | HOLD, l'anneau fin qui se remplit, le son de la tenue ; puis SECURED, YOUR PIECE sur son horizon, et PAY avec le total et le temps dans sa lumière (« PAY € 1 · 04:52 » par exemple) |
| Une taille tenue n'est pas SOLD OUT | Le second | Regarder | Toujours la file, la bande lit « 0 IN SIZE 52 » ; jamais SOLD OUT tant que la pièce n'est pas payée |
| NEXT BATCH NOW refusé | Console | `Next batch now`, `Give the batch` | Le dialogue reste ouvert et dit « No piece is free for anyone waiting. » ; rien n'est donné |
| CONFIRMED | Le premier | PAY | Le moment de CONFIRMED et son son ; la page sombre, même en mode clair : la grande photographie, CONFIRMED, LIVE RELEASE au-dessus du nom, le monogramme seul sur son horizon, le reçu |
| SOLD OUT dans sa taille | Le second | Regarder | Le passage plus calme et son son ; SOLD OUT seul en titre, « Every piece in your size is reserved. You keep your place should ORBES add more, or you may leave. », LEAVE THE LINE juste dessous. Ne quitte pas la file |
| Une pièce rendue part au lot suivant | Console | `Test entrants` : `Send test entrants`, `Test entrants · TITANE` `1` (les autres paliers à `0`), `Arrival` `All at once`, `Choices · size` `54`, `Behaviour · RELEASE MY PLACE (%)` `100` (les trois autres à `0`), la phrase demandée, `TEST <les 8 premiers caractères de la sortie>` ; puis `Add more`, `1`, `54`, `Behaviour · PAY (%)` `100` (les trois autres à `0`) | Dans la ligne, le premier entrant d'essai a son tour au lot suivant (`Admitted` : `Batch …` et l'heure de Paris), le tient puis rend sa pièce ; le second ne l'a **pas aussitôt** : son `Admitted` lit le lot d'après, deux minutes plus tard. Il paie : la sortie est vendue en entier |
| La fin et l'after-room | Le second | Attendre | SOLD OUT, « Every piece of this release is reserved. » ; une minute après, la porte de l'after-room : l'horizon ouvert, deux points, la lumière, son son ; THE AFTER-ROOM, A SECOND DOOR, ENTER THE AFTER-ROOM, la taille `52` : THE AFTER-ROOM, sa place et la bande, sans temps ; seul dans sa file, le tour tout de suite (sans lot) ; tiens le sceau, puis RELEASE MY PLACE et TAP AGAIN TO RELEASE (ou CLICK AGAIN TO RELEASE sur l'ordinateur) : YOUR PLACE IS RELEASED |
| Le rapport | Console | Après la fermeture de l'after-room, la page de la sortie | Le rapport gagne `Longest wait`, `Turns given` (« BY THE PACE ») et `Left the queue` |

**Le nettoyage** : `Test entrants` → `End test`, avec la phrase `END TEST <les mêmes 8 caractères>` (les comptes d'essai sont nettoyés : ils comptent pour les 5 000 des tests qui suivent). La commande du premier, de 1 € : dans `Orders`, sa page, `Cancel`, la boîte « Cancel the order », `Note` `Test`, puis `Cancel the order` : « Order cancelled. ». La sortie d'essai reste dans la base et dans PAST.

**Ailleurs, sur ton téléphone** : HOW RELEASES WORK, sous HOW THE ORDER IS SET, le paragraphe THE PACE (« In a LIVE RELEASE, turns are given at the release’s pace, in the order of the line. Your screen shows your place and an estimated time. ») ; PRIVACY et TERMS au pied de page, « Version of 24 October 2026 » sous le titre, et dans les conditions, article 13, les paragraphes « The pace. » et « A piece that returns. ».

#### 2. Les deux tests de 5 000 entrants d'essai : A, puis B

La preuve de tes deux contrôles (« Proof: 5,000 entrants, both checks »), sur le vrai serveur, par deux sorties d'essai, **un test à la fois** : A d'abord, son END TEST, puis B (un autre jour si tu préfères). L'ancienne recette de M1 (25 pièces, `Admitted Batch N`, THE QUEUE · ESTIMATED ENTRY) ne vaut plus : avec 25 pièces, un lot ne donne au plus que les pièces libres, et ces écrans n'existent plus.

**Les conditions de l'hôte** (le responsable de l'hôte, après M1) :

- **De jour seulement**, jamais dans 01:30–04:10 à Paris (23:30–02:10 UTC), fenêtre sans test de charge de l'hôte, en vigueur jusqu'au 25 octobre 2026, ni dans les heures de la règle 2.
- **La veille**, préviens le responsable de l'hôte d'une ligne : « ORBES : demain, de <heure> à <heure> Paris (<heure> à <heure> UTC), deux tests de 5 000 entrants d'essai, l'un après l'autre, par paliers de 1 000, arrêtés à tes seuils. » Il prépare ses sondes.
- **Une ligne au début** de chaque test (« ORBES : test A de 5 000 entrants d'essai lancé à <heure> Paris (<heure> UTC). ») **et une à la fin** (« ORBES : test A fini à <heure> Paris (<heure> UTC) ; avant / après : <les chiffres>. »).
- **Par paliers de 1 000**, un test à la fois.
- **STOP immédiat** au premier de ces signes : la mémoire disponible de la machine sous 800 MiB ; le swap qui monte ; la charge sur une minute (`load1`) au-dessus de 1,8 pendant plus d'une minute ; une sonde d'ENTITY qui tombe, ou plus de 3 fois plus lente que d'habitude (c'est le responsable de l'hôte qui la mesure : s'il te dit STOP, tu arrêtes). STOP, c'est : `Stop` (dans `Test entrants`, ou dans le panneau `Server`), puis `End test`, et tu le dis à Claude.
- **Après le test**, la taille de la base et de la dernière sauvegarde, au responsable de l'hôte si elles ont bougé (une sauvegarde au-dessus de 20 MB).

**Pendant chaque test**, garde un œil sur le panneau `Server` à droite de la page : si `THE SERVER IS STRAINED` s'affiche, STOP. Et sur le serveur, avant chaque palier puis toutes les quelques minutes :

```bash
free -m
```

À lire : la colonne `available` de la ligne `Mem:` (sous 800 : STOP) et la colonne `used` de la ligne `Swap:` (qui monte d'une lecture à l'autre : STOP).

```bash
uptime
```

À lire : le premier des trois chiffres de `load average` (au-dessus de 1,8 deux fois de suite, à une minute d'écart : STOP).

**Le test A : plus de pièces que d'entrants** (il prouve « exactly X turns every Y, hold respected ») :

1. **La sortie d'essai.** `Club` → `Drops` → `New live release` : `Model` le modèle d'essai, `Title` `TEST PACE A`, `Opening (UTC)` dans 40 minutes environ, `End of the sales (UTC)` T0 + 30 minutes, `People per batch` `250`, `Every (minutes)` `1`, `Hold after the opening (minutes, 0 = none)` `2`, `Price of a piece` `1`, `Currency` `EUR`, `Sizes` `ONE SIZE = 5250` (les 5 000 entrants et une marge : chacun peut avoir une pièce, donc chaque lot donne exactement 250 tours). Sur sa page, `Access` → `Edit` : `Owners of <le modèle d'essai>` seul ; `Times (UTC)` → `Edit` : `Room opens (minutes before)` `30`. Puis `Publish`. **Visible de tous**, pour toujours (§2, point 1).
2. **La ligne de début** au responsable de l'hôte (ci-dessus).
3. **Une fois la salle ouverte** (T0 − 30 minutes), la partie `Test entrants` : `Send test entrants`, avec `Test entrants · TITANE` `1000` (les autres paliers à `0`), `Arrival` `All at once`, `Behaviour · PAY (%)` `0`, `Behaviour · RELEASE MY PLACE (%)` `100`, `Behaviour · miss the turn (%)` `0`, `Behaviour · LEAVE (%)` `0` ; la phrase demandée, `TEST <les 8 premiers caractères de la sortie>`. Personne ne paie : chacun rend sa place à son tour, aucune pièce n'est prise. Lis `free -m` et `uptime`, puis `Add more`, `1000` (la même phrase) ; et ainsi quatre fois : **5 000 entrants d'essai** en cinq paliers de 1 000, tous avant T0.
4. **À T0, sur le tableau en direct**, le bloc `Pace` : aucun tour pendant l'attente ; `Hold ends` et `Next batch` lisent T0 + 2 minutes, à l'heure de Paris. Puis, chaque minute : `Turns given` monte de 250, `Batches` de 1, `In the queue` baisse de 250 ; vingt lots, le dernier à T0 + 21 minutes. Dans la ligne, la colonne `Admitted` lit `Batch 1`, `Batch 2`… dans l'ordre de la ligne, chacun avec son heure de Paris. L'avertissement `AT THIS PACE, … AT THE CLOSE` peut s'afficher : c'est un conseil, personne ne paie dans ce test ; n'y touche pas.
5. **Sur ton téléphone**, une minute après T0 : la sortie avec le compte d'essai de la maison, la taille, ENTER THE LINE. Tu arrives après T0, derrière les 5 000 : LIVE NOW, YOUR PLACE (ta place dans ONE SIZE, un peu plus de 5 000), ESTIMATED 21 MINUTES LEFT environ, qui décompte, et la bande. Jamais un lot, un rythme ni la longueur de la file. Puis, avant ton tour, LEAVE THE LINE et TAP AGAIN TO LEAVE.
6. **Après la fin** (`End of the sales`), `End test`, avec la phrase `END TEST <les mêmes 8 caractères>`. Dans `Past tests`, `Report` : chaque contrôle `PASSED`, dont **`The pace`**, qui lit « 20 batches gave 5000 turns at 250 every 1 min, the first on the pace at <T0 + 2 min> PARIS, each on its time and in the line’s order; none gave more than the pace, and none left anyone waiting while a piece of their size was free. ». Un contrôle `FAILED` : copie sa ligne et donne-la à Claude.
7. **La ligne de fin** au responsable de l'hôte, avec `free -h` (sa ligne swap) et `docker stats --no-stream` lus pendant le test.

**Le test B : moins de pièces que d'entrants** (il prouve « at most X per batch, in order, nobody eligible left waiting while a piece of their size was free ») :

1. **La sortie d'essai**, comme A : `Title` `TEST PACE B`, le même rythme (`People per batch` `250`, `Every (minutes)` `1`) et la même attente (`Hold after the opening (minutes, 0 = none)` `2`), `End of the sales (UTC)` T0 + 30 minutes, `Sizes` `ONE SIZE = 25`, `Access` et `Room opens (minutes before)` comme A, puis `Publish`.
2. **La ligne de début**, puis les mêmes cinq paliers de 1 000, avec `Behaviour · PAY (%)` `0`, `Behaviour · RELEASE MY PLACE (%)` `70`, `Behaviour · miss the turn (%)` `30`, `Behaviour · LEAVE (%)` `0` : les pièces reviennent et attendent le lot suivant.
3. **Sur le tableau en direct** : aucun tour avant T0 + 2 minutes ; puis chaque lot ne donne que les pièces libres, au plus 25, jamais plus de 250 ; `Beyond the pieces` lit près de 4 975 ; dans la ligne, chaque `Admitted` tombe à l'heure d'un lot, jamais entre deux : une pièce rendue part au lot suivant. Une trentaine de lots jusqu'à la fermeture ; les autres restent dans la file, c'est attendu.
4. **Après la fin**, `End test` et son rapport : `The pace` `PASSED`, avec « … each on its time and in the line’s order; none gave more than the pace, and none left anyone waiting while a piece of their size was free. ». Puis la ligne de fin au responsable de l'hôte.

**Après les deux tests**, sur le serveur, la taille de la base :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_size_pretty(pg_database_size(current_database()))"'
```

Et, le lendemain matin, la sauvegarde de la nuit :

```bash
ls -lt /var/backups/orbes/daily/ | head -n 4
```

Sortie attendue : l'archive de la nuit, `orbes-<date>T03…Z.tar.age`, avec sa taille en octets. Au-dessus de 20 MB, ou la base nettement plus grosse qu'avant les tests : dis-le au responsable de l'hôte, avec les chiffres.

Les entrants d'essai lisent leur place par la page. Un vrai téléphone fait de même tant qu'aucun lot ne peut l'atteindre : il relit sa page toutes les 10 secondes à une minute, et ne garde son flux en direct qu'une fois le prochain lot à sa portée. Mesuré sur un Mac ([le rapport de charge, §8](../reports/live-load.md)), la file de 5 000 était exacte, mais les gestes des 250 personnes d'un même lot attendaient jusqu'à 2,6 s : ces deux tests donnent les chiffres du vrai serveur. Garde-les pour Claude (§2).

### 1.8 Ensuite

1. **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1).
2. **Ta première vraie LIVE RELEASE** : son rythme (`People per batch`, `Every (minutes)`) et son attente (`Hold after the opening (minutes, 0 = none)`) se choisissent à la création ; l'attente se change jusqu'à l'annonce, puis seulement `Shorten the hold` ou `End the hold now`.
3. **Les anciennes images (facultatif).** Une fois ONE QUEUE stable, `33e843081148` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_Q1>`), la liste d'abord :

   ```bash
   docker images orbes-genome
   ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **La sortie du test A est publique pour toujours** : dans THE RELEASES pendant le test, puis dans PAST et sur la fiche du modèle d'essai, avec son titre, le nom et la photographie du modèle d'essai et « 5 250 PIECES ». Tu choisis : le faire comme écrit ; avec un stock plus petit qui dépasse encore ses entrants (moins d'entrants, ce n'est alors plus la preuve des 5 000) ; ou ne pas le faire. La sortie du test B montre « 25 PIECES », comme celle de M1 l'aurait fait.
2. **Les questions laissées ouvertes par le lot**, chacune sans bloquer : le son du résultat d'un scan (le seul son encore synthétisé : le garder, ou le remplacer plus tard) ; la plaque à coins de l'écran JOIN d'un retardataire (la garder telle quelle, ou la redessiner comme YOUR PIECE) ; le halo de PAY (seulement dans les derniers 10 %, ou toujours) ; sur un ordinateur, le titre CONFIRMED d'un set posé sur les photos de ses pièces ; la boîte REMOVE de la console, qui dit encore que la place va au suivant ; la voix d'accueil dans l'after-room (non, aujourd'hui) ; et deux phrases de la politique de confidentialité (le lot qui a donné le tour, la mémoire de la voix d'accueil sur l'appareil).
3. **L'avocat** : les deux phrases de l'article 13 partent avec la version `2026-10-24` (la note au juriste, point 29). Sa réponse ne retient pas le déploiement.
