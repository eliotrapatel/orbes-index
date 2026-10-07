# Mise en production des neuf suivants (déploiement G)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Les neuf suivants (plan du 2026-10-06 : WRITE TO ORBES CLIENT SERVICES et MESSAGES, le programme des paliers, THE HOUSE'S GUARANTEE, YOUR SIZES, HOW RELEASES WORK, THE RELEASES OF THIS MODEL, PAIRS WELL WITH, SHARE TO STORIES, GROWTH) partent en production en **un seul déploiement**, G, après NOCTURNE (le déploiement F, [son runbook](DEPLOY-NOCTURNE.md)) et après TEST ENTRANTS, en production depuis le 2026-10-07.

| Déploiement | Élément | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| G | Les neuf suivants : CS-01, BP-19, IN-01, AC-01, FT-01, CO-01, BP-34, BP-10, BP-29 | `0025` à `0032` | le Caddyfile d'ORBES (l'étiquette de l'entretien annuel), convenu d'abord avec le responsable de l'hôte (§1.1) | **À faire** |

Le point de départ : la production tourne TEST ENTRANTS, le commit `04ee3c39e89bc3a8921e78f0108ea37de1708528` (image `orbes-genome:04ee3c39e89b`, mise en service le 2026-10-07 à 07:49 à Paris, 05:49 UTC), avec les vingt-cinq migrations de `0001_initial` à `0024_z_test_entrants`. La branche des neuf suivants est partie du dernier commit de NOCTURNE, avant TEST ENTRANTS : avant G, avec ton accord, `orbes-test-entrants` (et `orbes-nocturne` s'il a changé) est fusionné dans `orbes-next-nine`, puis le tout dans `claude/orbes-genome-code-system-o8bmnk`, la CI verte. Si un autre déploiement a eu lieu depuis, ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les captures d'abord.** Avant la fusion, tu regardes les captures que liste le rapport de Claude : chaque nouvel écran au format téléphone et au format bureau, les trois pieds de la fiche d'un modèle (C6), les trois cartes de story et leur aperçu, les écrans neufs de la console. Sans ton accord, rien n'est fusionné ni déployé.
2. **Jamais entre 03:00 et 05:30 UTC** : ce sont les sauvegardes de nuit du serveur partagé (05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite). **Ni pendant les minutes de sauvegarde du hub** : 01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC (dans les deux cas 03:00–03:10 et 03:45–03:55 à Paris).
3. **Le changement de Caddy est convenu d'abord** avec le responsable de l'hôte partagé (ta session de coordination du serveur, « AI Stack Atlas planning ») : ce qui touche le serveur partagé se coordonne d'abord avec lui (§1.1, étape 1). Ensuite, comme tu l'as décidé le 2026-10-07, **aucune heure n'est réservée** : une fois son accord sur le changement reçu et les trois conditions réunies (la CI verte sur le commit exact, le diff de `deploy/vps` limité au Caddyfile convenu, le lancement gardé), tu lances quand tu veux hors des heures de la règle 2, et tu le préviens d'une ligne au lancement. S'il demande une heure précise dans sa réponse, tu lances à cette heure-là, pas avant. (Le plan du 2026-10-06, §7 règle 2, demandait une heure confirmée et aucun changement de l'hôte : ta règle du 2026-10-07 et le Caddyfile, nécessaire à une étiquette de 2 Mo, le remplacent.)
4. **Ce qui change sur l'hôte : le seul Caddyfile d'ORBES**, dans le seul bloc de `verify.theorbes.com`. Ni port, ni variable, ni certificat, ni `compose.yaml`, ni autre site. `deploy.sh` valide la configuration avant tout changement, puis recrée Caddy : quelques secondes sans HTTPS pour `verify.theorbes.com`.
5. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`). Après les migrations, on ne revient pas en arrière : on **répare en avant** (§1.5).
6. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
7. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : `orbes-next-nine` (avec TEST ENTRANTS fusionné) fusionnée dans `claude/orbes-genome-code-system-o8bmnk`, sa CI verte.
8. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
9. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
10. **Les pages légales** : une seule nouvelle version, `2026-10-08` : l'article 12 des conditions (EN et FR : les seuils 1, 5 et 10, l'accès anticipé par palier, le paragraphe des avantages) et deux phrases de la politique de confidentialité (les messages ; les tailles enregistrées). Le contact des pages légales (e-mail, téléphone, horaires), l'article 2 et les mentions légales ne changent pas. Sa date ne retient jamais le déploiement.

---

## 1. Déploiement G

### 1.0 Ce qui change

**Pour les collectionneurs (/verify)**

- **WRITE TO ORBES CLIENT SERVICES (CS-01).** Chaque endroit de l'application qui montrait l'e-mail, le téléphone ou les horaires montre un seul bouton, qui ouvre une feuille pour écrire ; il faut un compte. Les réponses arrivent dans MESSAGES, la première ligne de la feuille du compte (NEW tant qu'une réponse n'est pas lue), et NOW montre une ligne. Aucun e-mail, aucune notification. FORGOTTEN PASSWORD garde l'e-mail, seul endroit où il reste. Les pages légales gardent leur contact tel quel.
- **Le programme des paliers (BP-19).** TITANE dès 1 pièce, PLATINE dès 5, PALLADIUM dès 10, pour tous à la fois : un compte PLATINE de 3 ou 4 pièces redevient TITANE, un PALLADIUM de 5 à 9 pièces devient PLATINE. YOUR TIER passe à 10 points, avec IN USE (le crédit et son échéance, l'entretien de l'année, le cadeau en attente). PLATINE et PALLADIUM gagnent : l'accès anticipé aux tirages (PALLADIUM 4 heures avant, PLATINE 2 heures, par défaut), la livraison offerte (PLATINE standard, PALLADIUM express), l'entretien annuel avec une étiquette prépayée aller et retour (YEARLY CARE dans l'onglet SERVICE de la pièce), la priorité dans MESSAGES, un cadeau de bienvenue avec la commande suivante, un crédit (50 € ou 100 €, 12 mois) et les invitations du cercle (la soirée des membres, les avant-premières, les expériences partenaires). Une page publique, THE CLUB, explique les paliers ; elle est dans chaque pied de page et dans la feuille du compte.
- **THE HOUSE'S GUARANTEE (IN-01).** Le personnel peut garantir une place à un collectionneur : dans un tirage il est sélectionné le premier, dans une LIVE RELEASE il est le premier de la file dans sa taille. La liste publique du tirage montre une ligne GUARANTEED BY THE HOUSE. Le collectionneur ne la voit que si le personnel choisit de la montrer.
- **YOUR SIZES (AC-01).** Une taille de bague, de bracelet, de poignet et une longueur de collier, enregistrées dans le compte. Elles présélectionnent la taille dans I'LL BE THERE, la vérification de la salle (TO CONFIRM) et une demande du salon ; le collectionneur la confirme chaque fois.
- **HOW RELEASES WORK (FT-01).** Une page, `/verify/releases/how`, qui explique chaque sortie ; ses chiffres viennent du serveur. Elle est liée de THE RELEASES et du pied des pages des sorties.
- **La fiche d'un modèle (CO-01, BP-34).** À son pied : THE RELEASES OF THIS MODEL (ses sorties passées), puis PAIRS WELL WITH, la toute dernière section.
- **SHARE TO STORIES (BP-10).** Après CONFIRMED dans une LIVE RELEASE, après une place SELECTED dans un tirage et à la fin d'un premier enregistrement : une carte de story 9:16, dessinée sur le téléphone, avec SHARE et SAVE IMAGE. Rien n'est envoyé à ORBES.

**Pour le personnel (la console)**

- `Messages`, le premier élément de Clients, avec son badge ; `Yearly care` sous Clients ; `Growth` sous Overview.
- `Club` → onglet `Tiers` : THE PROGRAM (`Edit program`, ADMIN), qui tient chaque chiffre des paliers. `Orders` → `Settings` : `Shipping` (des tarifs facultatifs, aucun par défaut) et `House guarantee` (90 jours, 1 pièce, montrée).
- La page d'une commande : la livraison, `Apply credit`, le cadeau de bienvenue (`Choose size` quand son modèle a plusieurs tailles, `Ship with its order`). La fiche client : `House guarantee` (`Grant a guarantee`), le bloc du Club, la ligne `Lifetime value`. La page `Lookbook` d'un modèle : `Sizes` et `Pairs well with` (`Edit pairs`).

**Les migrations**, appliquées dans **une seule transaction** : si elles échouent, rien n'est appliqué et le site revient tout seul sur `04ee3c39e89b`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0025_client_messages` | CS-01 | les conversations et les messages avec ORBES Client Services |
  | `0026_club_program` | BP-19 | THE PROGRAM, les tarifs de livraison, l'accès anticipé de PLATINE d'un tirage, l'expérience d'une invitation du cercle |
  | `0027_tier_grants` | BP-19 | les cadeaux et crédits accordés une fois par palier, l'usage du crédit, la livraison et le cadeau d'une commande, le canal GIFT |
  | `0028_yearly_care` | BP-19 | les demandes d'entretien annuel et leur étiquette, le type YEARLY_CARE de l'historique de service |
  | `0029_house_guarantee` | IN-01 | les garanties de la maison et leurs réglages, la garantie d'une entrée de tirage ou de LIVE, les commandes de plusieurs pièces d'un tirage |
  | `0030_account_sizes` | AC-01 | les tailles d'un compte, le type de taille d'un modèle, la plage d'une taille, la taille d'une demande du salon |
  | `0031_model_pairs` | BP-34 | les modèles choisis pour PAIRS WELL WITH |
  | `0032_growth_indexes` | BP-29 | trois index que lit GROWTH |

  Elles ne cassent pas l'image `04ee3c39e89b` pendant le déploiement (des tables qu'elle ignore, des colonnes nullables ou à valeur constante qu'elle ne nomme pas). Une exception : si l'ancienne image tire un tirage pendant le déploiement, elle échoue sans rien changer ; aucun tirage ne se tire donc pendant la fenêtre (§1.1). Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Au premier démarrage**, l'application accorde le cadeau et le crédit de chaque compte déjà PLATINE ou PALLADIUM selon 1, 5 et 10 (un PALLADIUM reçoit aussi ceux de PLATINE), une fois par palier et par compte, pour toujours. Tant qu'aucun modèle de cadeau n'est choisi dans THE PROGRAM, le cadeau attend, et YOUR TIER ne montre pas de ligne WELCOME GIFT.
- **Caddy**, le seul changement de l'hôte : l'étiquette prépayée d'un entretien annuel (`POST /api/admin/care/<id>/label`, le PDF lui-même, 2 Mo au plus dans l'application) passe jusqu'à 2 200 Ko ; les envois de photos de la console gardent leurs 1 200 Ko, tout le reste ses 64 Ko. `deploy.sh` valide la configuration, puis recrée Caddy (son empreinte change) : quelques secondes sans HTTPS.
- **Les variables** : rien ne change.
- **Les pages légales** : la version `2026-10-08` (règle 10).
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `04ee3c39e89b` ne peut plus tourner sur ce schéma. `deploy.sh --image 04ee3c39e89b` la refuse.

Dans la suite, `<SHA_G>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_G>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : le changement de Caddy, la CI, l'heure, le pré-contrôle

**1. Le changement de Caddy, convenu d'abord** (avant le jour, sans rien lancer ; règle 3). Envoie au responsable de l'hôte, par exemple :

> Proposition pour le déploiement G d'ORBES (les neuf suivants) : un changement du Caddyfile d'ORBES (`deploy/vps/Caddyfile`), dans le seul bloc de verify.theorbes.com. Une route de plus a sa propre limite de corps : l'étiquette prépayée d'un entretien annuel, `POST /api/admin/care/<id>/label`, un PDF de 2 Mo au plus, passe à 2 200 Ko (un `@label_upload` exclusif ; `@not_photo_upload` devient `@not_upload`). Les photos de la console gardent 1 200 Ko, tout le reste 64 Ko. Aucun port, aucun certificat, aucune variable, aucun autre site ne change. `deploy.sh` valide la configuration avant tout changement, puis recrée le conteneur Caddy d'ORBES : quelques secondes sans HTTPS pour verify.theorbes.com. Avec huit migrations en une transaction et une coupure courte d'ORBES, hors 03:00–05:30 UTC et hors de tes minutes de sauvegarde. D'accord sur le principe ?

Attends son accord avant d'aller plus loin.

**2. Ce qui doit être réglé avant le jour** (dans la console, sur ton ordinateur) :

- **Aucun tirage dans son accès anticipé** au moment du lancement, et aucun tirage tiré pendant la fenêtre. **Aucune LIVE RELEASE** prévue pendant la fenêtre.
- **Aucun test de TEST ENTRANTS en cours** : le redémarrage l'arrêterait. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Les membres par palier, avant** : `Analytics` → `The Circle`. Note-les : tu les compareras après (§1.6), le passage à 1, 5 et 10 les déplace.
- **Les mots des paliers** : `Club` → onglet `Tiers`, lis les avantages de chaque palier. Des mots que tu as modifiés dans la console restent tels quels (seuls ceux par défaut changent dans le code) ; s'ils parlent encore de 48 heures, ou de 3 ou 5 pièces, ils resteraient en ligne après. Tu les corriges avec `Edit benefits`, avant ou juste après le déploiement. Rien n'est réécrit tout seul.
- **Préviens ORBES Client Services** :
  - les commandes sous PLATINE n'ont pas de livraison, comme aujourd'hui, sauf un montant saisi sur la commande (ou des tarifs posés dans `Settings`) ; PLATINE et PALLADIUM voient leur livraison offerte ; `Mark paid` demande la taille choisie d'un cadeau de plusieurs tailles, et n'est jamais refusé pour la livraison ;
  - MESSAGES ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : prendre, répondre, fermer ; aucun délai de réponse n'est promis ; ils répondent, et n'ouvrent jamais une conversation ;
  - l'entretien annuel : le tableau `Yearly care`, l'adresse de retour donnée par le collectionneur, l'étiquette dans l'onglet SERVICE de sa pièce, rien d'écrit dans MESSAGES ;
  - `Apply credit`, dans la devise du crédit seulement.

**3. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aclaude%2Forbes-genome-code-system-o8bmnk>. Le dernier passage de `genome-ci` doit être celui de `<SHA_G>`, avec une coche verte. Sinon, n'avance pas.

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

`umask 022` rend lisibles par les conteneurs les fichiers que git et les scripts vont créer. Il ne s'affiche rien.

**5. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 03:00–05:30 UTC et hors des minutes de sauvegarde du hub (règle 2).

**6. Le pré-contrôle.** Note les quatre résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

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

Sortie attendue : `04ee3c39e89bc3a8921e78f0108ea37de1708528` au début de la ligne (le commit de TEST ENTRANTS).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=04ee3c39e89b`.

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

Sortie attendue : **exactement `<SHA_G>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude (règle 7).

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 04ee3c3..<7 caractères de SHA_G>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_G>`.

**Le Caddyfile est le seul changement de la pile du serveur** (deuxième condition ; règle 4) :

```bash
git -C /opt/orbes/orbes-index diff --stat 04ee3c39e89bc3a8921e78f0108ea37de1708528 HEAD -- deploy/vps
```

Sortie attendue : une ligne ` deploy/vps/Caddyfile | …`, puis ` 1 file changed, …`. Un autre fichier de `deploy/vps` : arrête-toi et demande à Claude.

**La version des pages légales** (règle 10) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-08';`.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : vingt-cinq lignes, de `0001_initial` à `0024_z_test_entrants` ; les deux dernières :

```text
0024_model_variants
0024_z_test_entrants
```

### 1.4 Déployer

Une fois l'accord du responsable de l'hôte sur le changement de Caddy reçu (règle 3), hors des heures de la règle 2. Envoie-lui une ligne au lancement, par exemple : « Déploiement G d'ORBES lancé maintenant : huit migrations en une transaction, le Caddyfile convenu (Caddy d'ORBES recréé), une coupure courte d'ORBES. Pré-contrôle : <les quatre résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_G> (tag <TAG_G>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_G>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 04ee3c39e89b
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : la nouvelle configuration est refusée avant tout changement, le site tourne toujours sur `04ee3c39e89b`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 25 migration(s) applied, all known to orbes-genome:<TAG_G>
   ```

   **Il faut lire `25 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `04ee3c39e89b`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_G>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_G>.tar.age
   ```

   **Note le nom de l'archive** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire. Elle ne sera jamais restaurée sur ce serveur.

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_G>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_G>
   Applied 8 migration(s): 0025_client_messages, 0026_club_program, 0027_tier_grants, 0028_yearly_care, 0029_house_guarantee, 0030_account_sizes, 0031_model_pairs, 0032_growth_indexes
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) et, cette fois, `Container orbes-caddy-1 Recreate` : Caddy est recréé avec la nouvelle configuration, c'est attendu.

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
   … [deploy.sh] deployed orbes-genome:<TAG_G> (previous: 04ee3c39e89b). This release applied the migration(s) 0025_client_messages, 0026_club_program, 0027_tier_grants, 0028_yearly_care, 0029_house_guarantee, 0030_account_sizes, 0031_model_pairs, 0032_growth_indexes:
   … [deploy.sh] orbes-genome:04ee3c39e89b cannot run on this schema any more (scripts/deploy.sh --image 04ee3c39e89b refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_G> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
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
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` (par exemple un Caddyfile refusé) | Le déploiement s'est arrêté seul. Le site tourne toujours sur `04ee3c39e89b`, le schéma et Caddy n'ont pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:04ee3c39e89b` et `rolled back to 04ee3c39e89b; the stack is healthy` | Les migrations n'ont pas été appliquées (une seule transaction), et le site est revenu tout seul sur `04ee3c39e89b`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 04ee3c39e89b is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app` et `docker compose logs --tail 50 caddy`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_G> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, Caddy, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `04ee3c39e89b`. | `docker compose ps`, puis `docker compose logs --tail 100 app` et `docker compose logs --tail 50 caddy`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_G>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| `caddy is healthy` n'arrive pas, ou HTTPS ne répond plus après la ligne `Recreate` | Caddy n'a pas redémarré avec la nouvelle configuration (elle avait pourtant été validée). | `docker compose logs --tail 50 caddy`, colle la sortie à Claude et préviens le responsable de l'hôte : le site d'ORBES est sans HTTPS tant que Caddy n'est pas reparti. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 04ee3c39e89b`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_G> OK (previous 04ee3c39e89b; migrations 0025_client_messages, 0026_club_program, 0027_tier_grants, 0028_yearly_care, 0029_house_guarantee, 0030_account_sizes, 0031_model_pairs, 0032_growth_indexes)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 33 lignes `applied`, de `0001_initial` à `0032_growth_indexes`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
docker compose logs app | grep 'tier grants ready'
```

Sortie attendue : une ligne avec `"grants":<nombre>`, les cadeaux et crédits accordés au démarrage ; **rien** si aucun compte ne tient encore 5 pièces. Dans la console, `Audit log`, l'action `club.grant` compte les mêmes.

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
head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify
```

Sortie attendue : `413` (un corps de 100 Ko reste refusé par Caddy hors des envois de la console, après sa recréation).

```bash
curl -s https://verify.theorbes.com/api/v1/the-club | grep -o '"tierThresholds":\[[0-9,]*\]'
```

Sortie attendue : `"tierThresholds":[1,5,10]`.

```bash
curl -s https://verify.theorbes.com/api/v1/releases/rules | grep -o '"earlyAccess":{[^}]*}'
```

Sortie attendue : `"earlyAccess":{"PALLADIUM":240,"PLATINE":120}` (4 heures et 2 heures, en minutes, tant que THE PROGRAM garde ses valeurs par défaut).

```bash
curl -s https://verify.theorbes.com/api/v1/releases/rules | grep -o '"placeHeldHours":[0-9]*'
```

Sortie attendue : `"placeHeldHours":48`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/verify/club
```

Sortie attendue : `200`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://verify.theorbes.com/verify/releases/how
```

Sortie attendue : `200`.

**Les membres par palier, après** : `Analytics` → `The Circle`, comparés à ceux d'avant (§1.1) : les PLATINE de 3 ou 4 pièces sont passés TITANE, les PALLADIUM de 5 à 9 pièces PLATINE.

**Préviens le responsable de l'hôte** : « Déploiement G d'ORBES fait à <heure> UTC, Caddy recréé avec le changement convenu, tout est healthy. Avant / après : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Sur ton téléphone (Safari), avec le compte d'essai de la maison, puis l'ordinateur pour la console.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| La console | Ordinateur | `Messages` (et son badge), `Yearly care`, `Growth`, `Club` → `Tiers` (THE PROGRAM), `Orders` → `Settings` (`Shipping`, `House guarantee`) | Chaque page s'ouvre ; `Growth` en à peu près une seconde au plus (plus lent : dis-le à Claude) |
| Les photos à travers Caddy | Console | Une photo enregistrée depuis `Catalogue` (`Photo`, ou la page `Lookbook` d'un modèle) et depuis une publication du cercle | La photo acceptée, sans `413` |
| CS-01 | Téléphone, puis console | Depuis une pièce, WRITE TO ORBES CLIENT SERVICES, un message ; dans `Messages`, la réponse ; sur le téléphone, MESSAGES ; puis une réponse du téléphone | NEW sur MESSAGES et la ligne MESSAGES sur NOW ; la conversation lue ; ta réponse dans `Messages`, à répondre |
| CS-01, ce qui reste | Téléphone | FORGOTTEN PASSWORD? ; <https://verify.theorbes.com/legal/notice> et la politique de confidentialité | L'e-mail seul sur FORGOTTEN PASSWORD ; les pages légales avec l'e-mail, le téléphone et les horaires, comme avant |
| BP-19, YOUR TIER | Téléphone | Le bouton du compte | 10 points, IN USE ; aucune ligne WELCOME GIFT tant qu'aucun modèle de cadeau n'est choisi |
| BP-19, l'accès anticipé | Téléphone | La page d'un tirage | La ligne PALLADIUM / PLATINE / EVERYONE ; sa règle se lit comme avant |
| BP-19, la livraison | Téléphone | MY PIECES, onglet ORDERS : une commande d'un compte PLATINE ; une commande d'un compte sous PLATINE | La ligne SHIPPING, FREE · PLATINE ; aucune ligne SHIPPING sous PLATINE |
| BP-19, l'entretien annuel | Téléphone, puis console | Sur une pièce d'un compte PLATINE, onglet SERVICE, REQUEST YEARLY CARE avec une adresse de retour ; dans la console, `Yearly care`, la demande, `Send label` avec un PDF de plus de 64 Ko ; puis `Cancel` | La demande sur le tableau et le lien `Yearly care · …` sur la ligne du client dans `Messages`, sans message écrit ; l'étiquette acceptée, sans `413` (le changement de Caddy) et visible dans l'onglet SERVICE ; puis la demande annulée |
| BP-19, THE CLUB | Téléphone | Le pied de page, puis la feuille du compte | THE CLUB s'ouvre des deux, et dit la devise du crédit |
| IN-01 | Console, puis téléphone | Sur la fiche du compte d'essai, `Grant a guarantee` (montrée) ; puis la feuille du compte ; puis `Revoke` | THE HOUSE'S GUARANTEE dans la feuille du compte ; plus rien après la révocation |
| AC-01 | Téléphone | YOUR SIZES : une taille enregistrée ; puis I'LL BE THERE d'une LIVE RELEASE annoncée de ce type ; puis la taille effacée | La taille présélectionnée, FROM YOUR SIZES, TO CONFIRM jusqu'à ton geste ; NOT SET après l'effacement |
| FT-01 | Téléphone | HOW RELEASES WORK depuis THE RELEASES, puis depuis le pied d'une sortie | 1, 5 et 10 pièces, 4 heures et 2 heures |
| CO-01, BP-34 | Téléphone | La fiche de MONOLITHE | THE RELEASES OF THIS MODEL avec ses sorties, puis PAIRS WELL WITH, la dernière section |
| BP-10 | iPhone (Safari), Android (Chrome), ordinateur | CONFIRMED (ou un premier enregistrement), SHARE TO STORIES, SHARE ; sur l'ordinateur, SAVE IMAGE | Dans Instagram Stories (iPhone) et TikTok (Android), la carte 9:16 entière ; sur l'ordinateur, le fichier `ORBES-STORY.png` |
| BP-29 | Console | `Growth` ; une ligne de COLLECTORS BY VALUE | Le chiffre d'affaires d'un mois égal à celui de `Invoices` ; la ligne ouvre la fiche du client |

### 1.8 Ensuite

- **Juste après, avant la première commande** :
  - `Orders` → `Settings`, `Shipping` : pose des tarifs seulement si tu en veux pour les commandes sous PLATINE (EUR, et GBP, USD, CHF si tu vends dans ces devises). Vide, ces commandes gardent le comportement d'aujourd'hui.
  - `Club` → `Tiers`, THE PROGRAM (`Edit program`) : choisis les modèles de cadeau de PLATINE et de PALLADIUM. D'ici là, les cadeaux attendent. Vérifie les autres valeurs par défaut.
  - `Club` → `Tiers` : corrige les mots notés avant le lancement (§1.1).
  - `Orders` → `Settings`, `House guarantee` : vérifie 90 jours, 1 pièce, montrée.
- **Puis** : les premières vraies commandes suivent le chemin habituel. ORBES Client Services applique les crédits sur la page de la commande (`Apply credit`), choisit la taille d'un cadeau quand elle est demandée (`Choose size`), et l'envoie avec sa commande (`Ship with its order`).
- **Les anciennes images (facultatif).** Une fois le déploiement G stable, les images antérieures à `04ee3c39e89b` ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_G>` ni `04ee3c39e89b`) ; la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 2. Ce qui reste à ta décision (sans bloquer)

Le plan (§5.3) garde ces points ouverts ; sans réponse, la valeur par défaut reste :

- **La livraison sous PLATINE** : aucune ligne, sauf un montant saisi ou des tarifs posés dans `Settings`.
- **La devise du crédit** : l'euro seulement ; THE CLUB dit « The credit applies to orders in euros. »
- **Non demandés, donc non bâtis** : les pièces jointes dans MESSAGES, et `Write to the client` (le personnel qui écrit le premier).
- **L'adresse de retour de l'entretien annuel** est gardée avec la demande et dans l'export du compte ; la politique de confidentialité ne gagne pas de phrase pour elle.
- **COLLECTORS BY VALUE** nomme des clients par valeur dans `Growth` (e-mails masqués en lecture seule) ; si tu voulais seulement des agrégats, le tableau est retiré.
- **La mesure de `Growth`** à 100 000 pièces a été faite sur PGlite (au-dessus de la cible d'une seconde, [le rapport](../reports/performance.md)) ; la mesure sur PostgreSQL se fait à la CI ou après le déploiement.
