# Remise à zéro : garder le catalogue et les réglages

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

**Ce que ça fait.** La base repart comme si tu n'avais jamais testé : plus aucune pièce, aucun code, aucune commande, aucune facture, aucune release, aucun compte de collectionneur, aucun message, aucun scan, aucun journal. Les numéros repartent de 1 : la première pièce sera `O26-J-00001` (pour la catégorie J), la première facture `INV-2026-000001`.

| Reste tel quel | Part |
|---|---|
| **Le catalogue** : catégories, collections, modèles et variantes, photos et lookbook, PAIRS WELL WITH, tailles et SKU, le fournisseur de chaque modèle et de chaque taille | Les pièces et leurs identités : génomes, codes, garanties, certificats, cartes, claim codes, historiques |
| **Les réglages** : paliers du club, THE PROGRAM, salon privé, garantie maison, tarifs et transporteurs d'expédition, emplacements de stock et leurs adresses, prix de gravure, fournisseurs, points de vente, segments, alertes de commande, minimums par SKU | Le stock (tous les compteurs à 0) et ses mouvements, les commandes, factures, avoirs, cadeaux, crédits, retours, cas, colis |
| **Les connexions à la console** : comptes, mots de passe, TOTP (rien ne change) | Les releases (tirages, LIVE, inscriptions, after-rooms), les commandes aux fournisseurs, les réceptions |
| **La clé de signature** : rien ne change dans ce script (voir la décision 1) | Tous les comptes de collectionneur, le tien et les TEST ENTRANTS compris, et tout ce qui va avec |
| | Messages, Circle, entretiens, garanties réclamées, scans, statistiques, le journal d'audit, le journal d'événements, les sessions (tout le monde est déconnecté) |

Trois tables sont gardées en partie : les **photos** (seules celles d'un modèle ou d'un lookbook restent ; les photos de pièces, de Circle et les silhouettes de LIVE partent), les **segments** (seuls ceux dont une règle nomme une release partent, voir la décision 2), les **révocations** (celles de codes et de pièces partent, celles de clés restent).

**Ce qui ne change pas** : le code, l'image `orbes-genome:e7f72e1fff7e`, les migrations, `.env`, Caddy, les volumes, l'hôte. Rien à déployer.

**Comment c'est protégé.** Tout se passe dans **une seule transaction** : à la moindre erreur, rien n'est changé. Le script refuse de démarrer si la base n'est pas exactement celle prévue (migrations 0001 à 0039, 92 tables, 81 protections, 240 liens) ou si l'app est encore connectée. Avant de valider, il prouve que chaque table gardée est identique ligne par ligne, que chaque table vidée est vide, que les 81 protections sont rallumées et qu'aucun lien ne pointe dans le vide. Tu le lances **d'abord à blanc** (`commit=false` : il fait tout puis annule), puis pour de vrai.

**Une fois validé, on ne revient pas en arrière** : `restore.sh` est interdit sur ce serveur (`RESTORE_ALLOWED=false`). La sauvegarde du §5 garde l'état d'avant, pour mémoire seulement. La vraie sécurité, c'est le passage à blanc.

Répété sur une base de test remplie par l'app (jamais la production) : 77 contrôles sur 77 réussis avec la version finale du script (détail en fin de document).

Durée : 20 à 30 minutes. Le site est coupé pendant environ 10 minutes (§4 à §9) : avant le lancement, ça ne gêne personne.

---

## 0. Les règles

1. **Tes décisions d'abord** (§12, en fin de document). Sans ta réponse, on ne commence pas.
2. **L'heure.** Jamais entre **05:00 et 07:30 à Paris** jusqu'au 25 octobre 2026, **04:00 et 06:30** ensuite (03:00–05:30 UTC) : les sauvegardes de nuit du serveur partagé. Ni pendant les minutes de sauvegarde du hub : **03:00–03:10 et 03:45–03:55 à Paris** (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune LIVE RELEASE ouverte ou prévue** pendant la fenêtre, **aucun tirage** en cours, **aucun test TEST ENTRANTS en cours**, **aucun déploiement** en cours ni pendant toute l'opération, du §4 jusqu'à la fin du §11. Les déploiements, c'est toujours toi qui les lances : aucune session de Claude ne déploie (le chantier customer intelligence a l'interdiction de toucher au serveur). Ne lance donc aucun `deploy.sh` avant la fin du §11, sauf le recours du §9 sur l'accord de Claude.
4. **Avant le déploiement de customer intelligence** (les migrations 0040 et suivantes). Si elles sont déjà en production, le script refuse sans rien toucher : demande à Claude la version qui les connaît.
5. **Jamais `restore.sh`** sur ce serveur. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
6. **Jamais de commande SQL à la main** (`TRUNCATE`, `DELETE`…) : seulement les deux fichiers de ce document, vérifiés par leur empreinte.
7. **Les secrets ne se collent jamais dans une conversation.** Ce document n'en affiche aucun.

Dans la suite, `<SHA_RESET>` est le commit qui contient les deux fichiers SQL : Claude te le donne (40 caractères).

---

## 1. Avant, dans la console (sur ton ordinateur)

- Releases : aucune LIVE ouverte ou annoncée pour la fenêtre, aucun tirage à tirer.
- TEST ENTRANTS : aucun test en cours.
- Aucun déploiement prévu avant la fin du §11 (règle 3). Customer intelligence se déploie **après** cette remise à zéro (règle 4).
- Si ton équipe (LOGISTICS, ORBES Client Services) utilise la console : préviens-la qu'elle sera déconnectée et devra se reconnecter (mot de passe et TOTP).

## 2. Sur le serveur : où on en est

Connecte-toi en SSH, comme d'habitude, puis :

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

**L'heure :**

```bash
date -u
```

Sortie attendue : une heure UTC hors des heures de la règle 2. Ajoute 2 heures pour l'heure de Paris (1 heure à partir du 25 octobre).

**Le pré-contrôle** (pour le responsable de l'hôte ; note les quatre résultats) :

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

À regarder : `Use%` de `df -h /` sous 75 %, de la mémoire disponible, aucun conteneur à plein CPU en continu.

**Rien d'égaré dans le shell :**

```bash
env | grep -E '^(ORBES_IMAGE_TAG|COMPOSE_PROJECT_NAME)='
```

Sortie attendue : **rien**. Si une ligne s'affiche : `unset ORBES_IMAGE_TAG COMPOSE_PROJECT_NAME`, puis relance la commande.

**Ce qui tourne :**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=e7f72e1fff7e`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : une ligne `… deploy e7f72e1fff7e OK (previous …)`. Une autre image : arrête-toi et demande à Claude.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

**Les migrations** (règle 4) :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations' | tail -n 2
```

Sortie attendue, exactement :

```text
0038_draw_sizes
0039_order_delivery
```

Une ligne `0040_…` : arrête-toi (règle 4).

**`RESTORE_ALLOWED=false` :**

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`.

## 3. Récupérer les deux fichiers SQL

Ils sont dans le dépôt, sous `genome/scripts/`, sur une branche à part (`orbes-reset-to-catalogue`), jamais sur la branche de déploiement. On les lit depuis le commit `<SHA_RESET>` **sans toucher au checkout** : `deploy/vps` et le code en service ne bougent pas.

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : quelques lignes `… -> origin/…`, ou rien.

```bash
git -C /opt/orbes/orbes-index cat-file -t <SHA_RESET>
```

Sortie attendue : `commit`.

```bash
install -d -m 700 ~/reset-to-catalogue
```

Il ne s'affiche rien.

```bash
git -C /opt/orbes/orbes-index show <SHA_RESET>:genome/scripts/reset-to-catalogue.sql > ~/reset-to-catalogue/reset-to-catalogue.sql
```

Il ne s'affiche rien.

```bash
git -C /opt/orbes/orbes-index show <SHA_RESET>:genome/scripts/reset-to-catalogue.postcheck.sql > ~/reset-to-catalogue/postcheck.sql
```

Il ne s'affiche rien.

**Les empreintes** : elles prouvent que ce sont exactement les fichiers répétés.

```bash
sha256sum ~/reset-to-catalogue/reset-to-catalogue.sql ~/reset-to-catalogue/postcheck.sql
```

Sortie attendue, exactement (les chemins peuvent commencer par `/home/orbes` ou autre chose) :

```text
63ac0eadace372840c3686a4b5ec5557d43cc4383c0e7b454f992ab4f1f3966c  …/reset-to-catalogue/reset-to-catalogue.sql
a3ddf1de0d8e8170f89d0a524f3163a2968180d6002037e4ffaf2acfa60db801  …/reset-to-catalogue/postcheck.sql
```

Une autre empreinte : arrête-toi.

**Le checkout n'a pas bougé :**

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `e7f72e1fff7e14ba461d59b8fbc88daa12eca62f`.

## 4. Prévenir l'hôte, puis arrêter l'app seule

Hors des heures de la règle 2. Envoie au responsable de l'hôte (« AI Stack Atlas planning ») une ligne, par exemple :

> ORBES : remise à zéro des données de test lancée à 14:05 Paris (12:05 UTC). Base ORBES seulement : l'app ORBES est arrêtée une quinzaine de minutes, rien ne change sur l'hôte (ni compose, ni Caddy, ni port, ni volume, ni image). Une sauvegarde pre-reset en plus. Pré-contrôle : <les quatre résultats>.

Puis, sur le serveur :

```bash
docker compose stop app
```

Sortie attendue :

```text
 Container orbes-app-1  Stopping
 Container orbes-app-1  Stopped
```

Le site répond maintenant une erreur 502 : c'est normal.

```bash
docker compose ps
```

Sortie attendue : `caddy` et `postgres` seulement, chacun `Up … (healthy)`. **Plus de ligne `app`.**

## 5. Une sauvegarde fraîche

Le lancement est gardé : rien ne démarre si une sauvegarde (de n'importe quel projet de l'hôte) tourne déjà.

```bash
pgrep -a pg_dump || scripts/backup.sh --reason pre-reset
```

Sortie attendue (les heures sont remplacées par `…`) :

```text
… [backup.sh] photos: <nombre>, <taille> MB
… [backup.sh] ── database dump
… [backup.sh] db.dump: <octets> bytes, <nombre> tables
… [backup.sh] ── keys volume
… [backup.sh] keys.tar: 1 key file(s)
… [backup.sh] ── encrypt to <n> recipient(s)
… [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-reset.tar.age (<octets> bytes, sha256 <…>)
… [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-reset.tar.age
```

Il peut y avoir aussi des lignes de copie hors site. **Note le nom de l'archive** (`orbes-…-pre-reset.tar.age`) : c'est l'état d'avant, gardé pour mémoire (jusqu'à 63 jours), jamais restauré sur ce serveur.

Une ligne `<numéro> pg_dump …` à la place : une sauvegarde tourne déjà, attends qu'elle finisse et relance la commande.

## 6. Le passage à blanc (rien n'est changé)

```bash
docker compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -v commit=false -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ~/reset-to-catalogue/reset-to-catalogue.sql
```

Quelques secondes. Les lignes `NOTICE` et `ERROR` commencent par `psql:<stdin>:<numéro>:` : c'est normal. Sortie attendue, dans l'ordre :

1. `NOTICE:  reset: guards passed (superuser …, migrations 0001 to 0039, 92 tables, 81 triggers, 240 foreign keys, no other connection)`, puis `commit_requested` = `false`.
2. `== where` : la base, le rôle, `postgres` en 17.x, l'heure de Paris.
3. `== references the tests used` : pour chaque année et catégorie, le nombre de pièces de test et leurs références (de `first_reference` à `last_reference`). **Note-les** : ce sont les cartes et étiquettes de test à détruire (§11).
4. `== segments whose rules name a release` : les segments qui vont partir. **Lis la liste** : si un segment que tu veux garder y est, arrête-toi ici et dis-le à Claude (décision 2).
5. `== signing keys` : ta ou tes clés, une `ACTIVE`.
6. `== sizes (SKUs) that stay` : chaque taille qui reste, avec son modèle, son code, le nombre de pièces, commandes, releases et mouvements de stock de test qui l'utilisaient, et `how_made` : `declared` (cochée par toi dans le Catalogue), `with the model` (créée avec le modèle ou la variante), `before the type` (créée par un flux avant que tu donnes au modèle son type de taille, et gardée parmi ses tailles) ou `by a flow` (créée par une release, une commande, une pièce, une réception ou un cadeau sur un modèle sans type de taille). **Note les lignes marquées `check`** (`review`) : ce sont les tailles proposées créées par un flux sur un modèle sans type de taille. Après la remise à zéro, plus rien ne les montre (le journal d'audit est vidé) : c'est le seul moment pour les noter (§12).
7. `== console logins that stay` : chaque connexion à la console (e-mail, rôle, TOTP `yes`/`no`, `active` ou `disabled`, verrouillage, emplacements LOGISTICS). Aucun mot de passe ni secret TOTP n'est affiché. **Note celles créées pour un test** (§12).
8. `== suppliers, points of sale, carriers and stock locations that stay` : chaque fournisseur, point de vente, transporteur et emplacement, avec son état. **Note ceux créés pour un test** (§12).
9. `NOTICE:  reset: 67 tables truncated (RESTART IDENTITY, no CASCADE)`
10. `NOTICE:  reset: every check passed (22 kept tables identical, 67 wiped tables empty, 81 triggers enabled, 4 counters at 1, no orphan)`
11. `== kept tables` : 25 lignes. Pour les 22 lignes `KEEP`, `rows_before` = `rows_after` et `identical` = `yes`. Pour les 3 lignes `PARTLY` (`media_objects`, `revocations`, `segments`), `rows_after` peut être plus petit. **Note ce tableau** : le post-check du §8 doit retrouver les mêmes `rows_after`.
12. `== wiped tables that had rows` : les tables vidées, avec `rows_after` = 0, puis une ligne `67 | <lignes effacées> | 0`.
13. La dernière ligne : **`reset-to-catalogue: dry run, ROLLED BACK. Nothing was changed.`**

Colle cette sortie à Claude si tu veux qu'il la relise avant le §7. Les listes 3, 6, 7 et 8 se lisent ici, au passage à blanc : elles reparaissent au §7, mais lues avant l'effacement.

## 7. Pour de vrai

**Seulement si le §6 s'est terminé par `dry run, ROLLED BACK`** et que la liste des segments te va. La même commande, avec `commit=true` :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -v commit=true -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ~/reset-to-catalogue/reset-to-catalogue.sql
```

Sortie attendue : la même qu'au §6, avec `commit_requested` = `true`, et la dernière ligne :

```text
reset-to-catalogue: COMMITTED. Next: the post-check, then start the app.
```

Puis :

```bash
echo $?
```

Sortie attendue : `0`.

**Si la connexion SSH coupe pendant cette commande** (ou si la fenêtre se ferme), tu ne sais pas si la remise à zéro est validée. La base, elle, est cohérente dans les deux cas : tout ou rien. **Ne redémarre pas l'app.** Reconnecte-toi en SSH, puis `sudo -iu orbes`, puis `cd /opt/orbes/orbes-index/deploy/vps`, et lance le post-check du §8 :
- `NOTICE:  postcheck: ALL OK` : la remise à zéro est validée. Continue au §9.
- `ERROR:  postcheck FAILED …` avec des tables vidées qui ont encore des lignes (par exemple `products has 68 rows | accounts has 22 rows`) : elle n'a pas été validée, **rien n'a changé**. Relance la commande du §7 (pas le §6).
- Autre chose : colle la sortie à Claude et attends.

Si le post-check semble bloqué, attends : il attend que la remise à zéro en cours se termine (quelques secondes).

## 8. Le post-check (lecture seule)

Avant de redémarrer l'app (ensuite, ta connexion ajoute une session et des lignes d'audit, et « les tables vidées sont vides » ne tient plus).

```bash
docker compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ~/reset-to-catalogue/postcheck.sql
```

Sortie attendue :

- `== kept tables` : 25 lignes, **les mêmes nombres que la colonne `rows_after` du §7**.
- `== signing keys` : exactement une clé `ACTIVE`.
- `NOTICE:  postcheck: migrations 0001 to 0039, 92 tables, one ACTIVE key, 67 wiped tables checked, 81 triggers enabled, no orphan row`
- **`NOTICE:  postcheck: ALL OK`**
- `next_piece_reference` : `O26-<lettre>-00001` pour chaque catégorie active.
- `next_document_number` : `INV-2026-000001` et `CN-2026-000001`.

Un `ERROR:  postcheck FAILED …` : ne redémarre pas l'app, colle la sortie à Claude.

## 9. Redémarrer l'app

```bash
docker compose start app
```

Sortie attendue : des lignes `Container orbes-app-1  Starting`, puis `Container orbes-app-1  Started` (parfois aussi `Container orbes-postgres-1  Healthy`).

Attends une minute, puis :

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`. Si `app` dit `(health: starting)`, attends 30 secondes et relance.

```bash
docker compose logs --since 10m app | grep -c 'live engine: leading'
```

Sortie attendue : `1`.

Si l'app ne devient pas `healthy` en 3 minutes : `docker compose logs --tail 100 app`, colle la sortie à Claude. Le recours, sur son accord : `pgrep -a pg_dump || scripts/deploy.sh --image e7f72e1fff7e` (la même image, redémarrée par le chemin habituel avec ses tests de fumée).

## 10. La clé de signature (si tu choisis 1-A à la décision 1)

Tout de suite, **avant de créer la moindre pièce**. Une nouvelle clé devient ACTIVE, l'ancienne est révoquée : une vieille carte de test scannée affichera « signature invalide » au lieu de déclencher une fausse alerte sur une vraie pièce neuve (§12, décision 1).

```bash
docker compose exec app npm run --silent keys:rotate
```

Sortie attendue (les noms varient) :

```text
Created signing key #2 (orbes-k002-2026…-….), ACTIVE.
Key #1 (orbes-k001-20261001-090c) is now RETIRED: codes it signed keep verifying.
```

**Note le numéro de l'ancienne clé** (`Key #1` ici). Si ce n'est pas `1`, remplace `1` par ce numéro dans la commande suivante.

```bash
docker compose exec app node --import tsx scripts/keys.ts revoke 1 --reason "Pre-launch test key, replaced after the reset to the catalogue" --yes
```

Sortie attendue : `Key #1 is REVOKED. Codes recorded before … stay trusted; later ones verify as INVALID SIGNATURE.` (Il n'y a plus aucun code enregistré : aucune vieille carte ne reste valable.)

```bash
docker compose exec app node --import tsx scripts/keys.ts list
```

Sortie attendue : une ligne `1  REVOKED …` et une ligne `2  ACTIVE …`.

**La sauvegarde d'après rotation** (la nouvelle clé doit être sauvegardée) :

```bash
pgrep -a pg_dump || scripts/backup.sh --reason post-rotation
```

Sortie attendue : comme au §5, avec **`keys.tar: 2 key file(s)`** et une archive `orbes-…-post-rotation.tar.age`.

## 11. Les contrôles de fumée

**Depuis ton Mac** (dans le Terminal, pas sur le serveur) :

```bash
curl -s https://verify.theorbes.com/api/v1/health
```

Sortie attendue : `{"ok":true,"version":"0.1.0"}`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/verify/pieces
```

Sortie attendue : `200`.

```bash
curl -s https://verify.theorbes.com/.well-known/orbes-keys.json
```

Sortie attendue : une clé `"status":"ACTIVE"` (et, avec 1-A, la clé 1 `"status":"REVOKED"` ; la liste peut mettre jusqu'à 5 minutes à se mettre à jour).

**Dans la console** : reconnecte-toi (mot de passe, puis TOTP).

| Où | Ce que tu dois voir |
|---|---|
| Catalogue | Tes modèles et variantes, leurs photos, le lookbook, PAIRS WELL WITH, les tailles |
| Réglages (paliers, THE PROGRAM, garantie, expédition, transporteurs, emplacements, gravure, fournisseurs, points de vente, alertes, minimums) | Comme avant |
| Segments | Tous, sauf ceux de la liste du §6 |
| Products, Orders, Releases, Collectors, Messages, Anomalies | Vides |
| Stock | 0 partout ; un SKU avec un minimum apparaît sous son minimum : normal |
| Audit | Seulement ce qui s'est passé depuis : la rotation et la révocation de la clé (1-A), ta connexion |

**Préviens le responsable de l'hôte** :

> ORBES : remise à zéro faite à <heure> Paris (<heure> UTC), app healthy, rien n'a changé sur l'hôte. Avant / après : <free -h (swap compris), docker stats, df -h /, du -sh /var/backups/orbes>. Les prochaines sauvegardes de nuit d'ORBES seront plus petites (données de test effacées).

Pour les chiffres d'après, relance sur le serveur les quatre commandes du pré-contrôle (§2).

## 12. Ce qu'il reste à faire après

- **Détruis toutes les cartes et étiquettes de test imprimées** (cartes 79t, planches A4, cartes de boîte, étiquettes), au moins celles des références notées au §6. Les numéros repartent de 00001 : une vieille carte porte la même référence qu'une vraie pièce à venir.
- **Recrée ton compte de collectionneur** (sur ton téléphone, comme un nouveau client). Les TEST ENTRANTS repartent de `test-0001` au prochain test.
- **Ton équipe se reconnecte** à la console (mot de passe et TOTP inchangés).
- **Les tailles notées `check` au §6** (liste `== sizes`) : dans le Catalogue, sur la page de chaque modèle, section des tailles, retire (`Remove`) celles que tu ne veux pas. Plus rien ne les utilise, donc elles sont supprimées ; une taille qui a un minimum de stock est mise de côté à la place. La dernière taille proposée d'un modèle ne se retire pas. Les tailles `declared`, `with the model` et `before the type` sont les tiennes : rien à faire.
- **Les connexions à la console créées pour un test** (liste `== console logins` du §6) : dans **Team**, `Disable` sur chacune. Une connexion verrouillée qui reste : `Unlock`.
- **Les fournisseurs, points de vente et transporteurs créés pour un test** (liste du §6) : ils ne se suppriment jamais. Fournisseur : dans **Supplier orders**, sa fiche, décoche `Active`. Point de vente : **Points of sale**, `Deactivate`. Transporteur : dans **Settings**, `Set aside`. Un emplacement de stock ne se désactive pas : s'il en reste un de test, dis-le à Claude.
- **Relis les segments** restants si besoin.
- Les photos : **rien à faire**. Elles sont dans la base ; le script a déjà retiré celles des pièces, de Circle et des LIVE.
- Les anciennes sauvegardes (sur le serveur et hors site) contiennent encore les données de test : **ne les supprime pas**, elles partent seules en 63 jours au plus.
- Si tu avais exporté une ancre du journal d'audit : note à côté la date de la remise à zéro (la chaîne repart de zéro).

## 13. Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| `reset-to-catalogue: nothing done. Add -v commit=…` | La commande a perdu son `-v commit=…`. Rien n'a démarré. | Recopie la commande du §6 ou du §7 telle quelle. |
| `ERROR:  reset: other connection(s) to this database: …` | L'app (ou un autre psql) est encore connectée. Rien n'est changé. | `docker compose ps` : si `app` est là, `docker compose stop app`, puis relance. Sinon, colle la sortie. |
| `ERROR:  reset: written for migrations 0001_initial to 0039_order_delivery exactly …` ou `unexpected tables` | La base n'est pas celle prévue (un déploiement est passé). Rien n'est changé. | `docker compose start app`, puis demande à Claude. |
| `ERROR:  canceling statement due to lock timeout` | Quelque chose tenait la base (une sauvegarde ?). Rien n'est changé. | `pgrep -a pg_dump` : attends qu'elle finisse, puis refais le §6. |
| `ERROR:  reset: … check(s) failed, nothing is kept: …`, ou toute autre `ERROR` pendant le §6 ou le §7 | Le script s'est arrêté : la transaction est annulée, **rien n'est changé**. | `docker compose start app` (le site revient comme avant), puis colle la sortie. |
| La connexion SSH a coupé pendant le §7 | On ne sait pas si c'est validé. La base est cohérente : tout ou rien. | Ne redémarre pas l'app. Reconnecte-toi, `sudo -iu orbes`, `cd /opt/orbes/orbes-index/deploy/vps`, puis le post-check du §8. `ALL OK` : validé, continue au §9. `FAILED` avec `products has … rows` (des tables vidées encore remplies) : pas validé, rien n'a changé, relance le §7. Autre chose : colle la sortie. |
| `ERROR:  postcheck FAILED …` au §8 (après un §7 terminé par `COMMITTED`) | La remise à zéro est validée, mais un contrôle ne passe pas. | Ne redémarre pas l'app, colle la sortie, attends la réponse. |
| L'app ne devient pas `healthy` au §9 | | `docker compose logs --tail 100 app`, colle la sortie ; le recours du §9 sur accord de Claude. Préviens le responsable de l'hôte si le site reste coupé. |

## 14. Ce qu'il ne faut jamais faire

- `restore.sh` (interdit sur ce serveur), `docker … prune` (touche les autres projets).
- Lancer le script avec un autre rôle que `$POSTGRES_USER` du conteneur `postgres`, ou depuis le conteneur `app`.
- Taper du SQL à la main, ou un fichier dont l'empreinte n'est pas celle du §3.
- Lancer le script après le déploiement de customer intelligence (0040+) sans la version que Claude t'aura donnée.
- `scripts/deploy.sh` avec une autre image que `e7f72e1fff7e` pendant cette opération.
- Supprimer les anciennes sauvegardes.

---

## Tes décisions (à confirmer avant le §2)

1. **La clé de signature.**
   - **1-A, recommandé : nouvelle clé, l'ancienne révoquée (§10).** Cinq minutes de plus. Une vieille carte de test scannée affiche « signature invalide » et ne déclenche aucune alerte. Répété : `INVALID_SIGNATURE`, aucune anomalie, et la nouvelle pièce vérifie bien `AUTHENTIC`.
   - 1-B : garder la clé. Plus simple, mais une vieille carte de test scannée déclenche une alerte CRITICAL (« signature valide, pièce inconnue ») ; une fois la vraie pièce du même numéro créée, la carte la fait passer en SUSPICIOUS (`CODE_MISMATCH`, alerte CRITICAL sur la vraie pièce). Répété aussi. Avec 1-B, la destruction des cartes du §12 devient la seule protection.
2. **Les segments qui nomment une release** (TOOK_PART, SECURED_IN, ANSWER, INTEREST dans une release précise). **Recommandé : ils partent avec les releases** (le script le fait) : après la remise à zéro, ils ne trouveraient plus personne et la console refuserait de les enregistrer (`DROP_NOT_FOUND`). Les autres segments restent. Si tu préfères les garder, dis-le avant : Claude retire cette ligne du script et refait la répétition.
3. **L'ordre avec customer intelligence.** **Recommandé : la remise à zéro d'abord**, customer intelligence ensuite (ses migrations n'ont besoin d'aucune donnée existante). Dans l'autre ordre, le script refuse sans rien toucher et Claude doit l'étendre aux nouvelles tables.
4. **Ce qui part avec les tests, pour être sûr que tu es d'accord** : ton propre compte de collectionneur, tous les TEST ENTRANTS, tout le stock (à 0), toutes les commandes aux fournisseurs et réceptions, le journal d'audit. Et ce qui reste, à ranger toi-même dans la console après (§12) : les tailles et SKU créés pendant les tests, les connexions à la console, fournisseurs, points de vente et transporteurs créés pour un test. Le §6 les liste tous ; le script n'en supprime aucun.

---

## Ce qui a été répété (base de test, jamais la production)

Une base migrée de 0001 à 0039, remplie par l'app (l'histoire NOCTURNE complète, plus un fournisseur, un point de vente, cinq segments, un minimum, une photo de lookbook, deux photos de pièces, une silhouette de LIVE, un message, une révocation de clé et une de code, plus des tailles de chaque origine : une montre et sa taille unique, HALO typé bague avec une taille cochée, une variante de HALO, une taille créée par un flux), puis les deux fichiers SQL passés par un émulateur de psql. 77 contrôles sur 77 avec la version finale (empreinte du §3), dont le balayage de 63 pages de la console et de 49 routes publiques et collectionneur après la remise à zéro :

- refus sans rien changer : sans `-v commit`, avec `commit=maybe`, avec une table en plus (comme 0040), avec une migration en plus, avec une protection éteinte ;
- une connexion perdue avant la validation : rien n'a changé, et le post-check dit `FAILED` avec `products has … rows` (le signe du §7 pour relancer) ;
- le passage à blanc laisse les 92 tables identiques ;
- il liste chaque taille qui reste avec son origine (comparée à une lecture indépendante du journal d'audit : `declared`, `with the model`, `before the type`, `by a flow`, et `check` seulement sur les tailles proposées créées par un flux sur un modèle sans type de taille), chaque connexion à la console sans aucun mot de passe ni secret TOTP, chaque fournisseur, point de vente, transporteur et emplacement ;
- pour de vrai : les 22 tables gardées identiques ligne par ligne, les 67 autres vides, exactement les photos des modèles et du lookbook (une photo de pièce identique à une photo de lookbook reste, une seule fois), seuls les 2 segments qui nomment une release partis, seule la révocation de clé restée, 81 protections rallumées et qui refusent encore, les 4 compteurs à 1 ;
- le post-check dit `ALL OK`, ne change rien, et attrape une ligne laissée exprès ;
- relancer le script une deuxième fois ne fait rien de mal ;
- l'app démarre comme en production : clé vérifiée, santé 200, liste des clés, ménage de fond sans erreur ni ligne d'audit, première pièce `O26-J-00001`, chaîne d'audit qui part de l'id 1 ;
- la clé, dans les deux sens de la décision 1.

Limites : la répétition tourne sur PGlite (PostgreSQL 18.3 en WebAssembly) ; la production est en PostgreSQL 17, où `TRUNCATE`, ses contrôles de liens et `session_replication_role` se comportent de la même façon. Les lignes propres à psql (`\if`, `\echo`…) ont été jouées par un émulateur, pas par le vrai psql : le passage à blanc du §6 est le premier essai réel, et il ne change rien. Le contrôle « aucune autre connexion » ne peut pas être simulé sur PGlite (une seule connexion).
