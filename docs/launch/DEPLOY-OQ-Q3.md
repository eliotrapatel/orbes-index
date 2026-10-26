# Mise en production du lot THE VAULT (Q3)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot Q3 de tes décisions des 22 et 23 octobre sur THE VAULT (un seul coffre et une seule table de la maison pour toutes les occasions ; sept occasions ; chaque coffre gardé 30 jours sous THE VAULT ; son ouverture, la boîte à porte et ses sons ; les récompenses livrées là où elles vont ; THE VAULT CARD dans le colis) part en production en **un seul déploiement**, après celui des ADD-ONS ([son runbook](DEPLOY-OQ-Q2.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| THE VAULT (lot Q3) | Un seul coffre, une seule table de la maison, sept occasions, chacune avec son interrupteur et ses limites, jamais un compte de test (D1, D3, D9, D27) ; l'ouverture comme la référence la dessine, sur téléphone et ordinateur, en mode sombre et en mode clair (D15, D30 à D40, D58) ; SOLD OUT pour ta taille et la page de fin d'une sortie vendue en entier (D6, D50, D51) ; la page THE VAULT, la ligne de YOUR ACCOUNT, NOW et les messages FROM ORBES (D16, D18, D41 à D46) ; les récompenses livrées (D19 à D21, D29) ; la console : `Club` → `THE VAULT`, l'interrupteur de chaque LIVE RELEASE, GIVE A VAULT, le rapport (D24 à D28) ; THE VAULT CARD (D14, D47 à D49) ; un paragraphe des conditions et une phrase de la politique de confidentialité (D22, D23, D59) | `0061_the_vault`, `0062_vault_rewards` | aucun | **À faire** (§1) |

Le point de départ : la production tourne ADD-ONS ONE SYSTEM, son commit `5e0518fe53cdedd6b2512538e78f70f519d16afa` (image `orbes-genome:5e0518fe53cd`, déployée le 25 octobre 2026 à 15:26 à Paris (14:26 UTC)), avec les 61 migrations de `0001_initial` à `0060_release_addons_converted`. **Q3 ne part qu'après Q2** : ses migrations s'appuient sur `0060_release_addons_converted`. Avant le jour, Claude remplace dans ce document `<SHA_Q3>` et `<TAG_Q3>` par le commit final de Q3 (40 caractères) et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `5e0518fe53cd` (un correctif après Q2, ou un autre lot déployé avant), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le lot M4 (en pause) part après Q3 : il renumérote ses migrations après `0062_vault_rewards`, et la marge de GROWTH y comptera le coût des coffres (D61). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur le tableau de revue d'abord.** Avant la fusion, tu regardes le tableau de revue que te donne le rapport de Claude (§1.1) : les captures de chaque écran du coffre, les mots qu'aucune maquette n'avait, et la console. Tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 04:00 et 06:30 à Paris** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC). Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026.
3. **Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.** Le redémarrage couperait la salle, la file et les tours en cours. Tu déploies quand aucune LIVE RELEASE n'a sa salle ouverte, ni ne l'ouvre dans l'heure (le pré-contrôle du §1.1 le lit), et quand aucun test de TEST ENTRANTS ne tourne.
4. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures des règles 2 et 3, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
5. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. Les cinq sons du coffre sont des fichiers de l'application, servis sous `/assets/` comme les onze de la LIVE RELEASE. Ton `.env` ne gagne aucune ligne : la clé des crédits à offrir dérive de `COOKIE_SECRET`, déjà là.
6. **Deux migrations, puis plus de retour en arrière** : après `0061_the_vault` et `0062_vault_rewards`, l'image `5e0518fe53cd` ne tourne plus sur le schéma (`deploy.sh --image 5e0518fe53cd` la refuse). En cas de souci, on **répare en avant** (§1.5).
7. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
8. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
9. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-one-queue` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
10. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
11. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
12. **Les pages légales changent** : les conditions, article 13, un seul paragraphe (*THE VAULT*), et article 14, une phrase dans son premier paragraphe (les commandes de THE VAULT : une pièce gagnée, à réclamer dans les 30 jours, ou achetée sous son droit d'achat de 24 heures), et la politique de confidentialité, un seul bloc (le lien d'invitation, puis les coffres gardés avec le compte et le coffre d'un crédit à offrir accepté, dans *Your ORBES account*), en anglais et en français, dans une seule nouvelle version, `2026-10-26`. Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La relecture par un avocat ne retient jamais le déploiement (D59).

---

## 1. Le déploiement

### 1.0 Ce qui change

**En mots simples**

- **Un seul coffre, une seule table.** THE VAULT est le même partout : un coffre donné à une occasion attend **30 jours** dans YOUR ACCOUNT, sous THE VAULT, puis expire s'il n'est pas ouvert. Ouvert, il donne **une** récompense, tirée par le serveur au moment de l'ouverture dans la seule table de la maison (`Club` → `THE VAULT`). La carte I WAS THERE est le plancher : elle prend les chances que les autres lignes laissent. Ouvrir est gratuit ; un coffre ne se vend jamais. **Les comptes de test n'en reçoivent jamais.**
- **Sept occasions**, chacune allumée par défaut avec un coffre par occasion et au plus un (OP-29), toutes réglables : une LIVE RELEASE dont ta taille s'épuise pendant que tu attends encore dans sa file (seulement quand la sortie a THE VAULT allumé, éteint par défaut ; jamais à la fermeture d'une sortie avec des pièces restantes, jamais dans l'after-room) ; chaque pièce achetée, à son premier enregistrement ; un nouveau palier (TITANE dès la première pièce) ; une photo WORN publiée ; la première pièce d'un ami venu par ton lien d'invitation ; un profil complet, une fois ; un geste de la maison (GIVE A VAULT). **Rien pour ce qui a eu lieu avant le déploiement** : les paliers déjà tenus sont notés par la migration et ne donnent jamais de coffre (N7).
- **L'ouverture**, comme la référence la dessine : la boîte à porte qui flotte, ses deux moitiés brossées, le couvercle avec FOR YOU, la niche éclairée. On maintient la porte une seconde et demie, ou on la tire vers le bas (sur un ordinateur, aussi la barre d'espace) ; relâchée trop tôt, elle se referme. Cinq sons (le déverrouillage, les moitiés, le couvercle, la révélation, et une seconde note pour une récompense rare, plus lente de 1,4 fois) suivent ta préférence SOUND ; une courte vibration sur un téléphone qui la permet. La récompense se lit avec ses chances (« 1 IN 200 »).
- **SOLD OUT pour ta taille** : le coffre sous la phrase, avant LEAVE THE LINE ; la page s'assombrit pendant qu'il s'ouvre, puis OPEN ANOTHER mène à THE VAULT. **La page de fin d'une sortie vendue en entier** porte le même coffre ; sur un téléphone, elle prend l'allure sombre de la salle.
- **La page THE VAULT** (sur un téléphone `/verify/vault`, sur un ordinateur sa propre page dans YOUR ACCOUNT), toujours sombre, même en mode clair : YOUR VAULTS (chaque porte avec PRESS AND HOLD, son occasion et WAITS UNTIL), OPENED, HOW TO OBTAIN A VAULT et WHAT A VAULT CAN HOLD, sans aucune chance affichée. Autour : la ligne THE VAULT de YOUR ACCOUNT avec son petit nombre (sur un ordinateur, une septième carte), la ligne A VAULT IS WAITING FOR YOU de NOW, et deux messages FROM ORBES, l'arrivée et le reçu de ce qu'il contenait.
- **Les récompenses, livrées là où elles vont** : un crédit maison dans YOUR ACCOUNT (30 jours) ; un complément offert sur la prochaine commande ; une place garantie à la prochaine LIVE RELEASE ; une pièce offerte (une commande à 0 dans YOUR ORDERS, FROM THE VAULT, à réclamer dans les 30 jours avec CLAIM IT) ou le droit de l'acheter à son prix pendant 24 heures (YOURS TO BUY) ; une VAULT EDITION ; THE PIECE, la pièce manquée dans sa taille ; un crédit à offrir à un ami pour sa première pièce (GIVE IT, son lien) ; la carte I WAS THERE, une image à garder (SAVE THE IMAGE).
- **Une pièce retournée** reprend son coffre s'il n'a pas été ouvert. Rien d'autre ne reprend un coffre.
- **THE VAULT CARD** va dans la boîte de chaque pièce achetée, à côté de la MINT CERTIFICATE, au même format.
- **Ce qui ne change pas** : la file, les tours et les sons de ONE QUEUE ; les add-ons de Q2 ; les écrans d'aujourd'hui, sauf là où le coffre s'ajoute ; l'hôte ; la marge de GROWTH (celle de M4, plus tard).

**Pour le personnel (la console)**

- **`Club` → `THE VAULT`** (onglet nouveau) : la table (chaque ligne sa sorte, ses chances « 1 IN N », sa quantité, ce qui a été donné, ce qui reste ; I WAS THERE toujours là) ; `Sources`, les sept occasions, chacune son interrupteur, ses coffres par occasion et son plafond (un ADMIN) ; `Give a vault` (un OPERATOR à un client, un ADMIN aussi à un segment, la portée montrée avant) ; le rapport, avec son coût et `Download CSV`.
- **La page d'une LIVE RELEASE** : la section `THE VAULT`, `Off` par défaut, `Turn on` jusqu'à sa fin (un OPERATOR) ; jamais sur une after-room. Son `Release report` gagne les coffres donnés et ouverts.
- **La fiche d'un client** : le bloc `THE VAULT`, en lecture seule, avec `Give a vault` et **aucun bouton pour reprendre un coffre**.
- **`Catalogue`** : `VAULT ONLY` sur la fiche d'un modèle (jamais vendu, donné seulement comme VAULT EDITION). **`Orders`** : le canal `Vault`, et FROM THE VAULT sur la commande. **La liste de colisage** : la ligne `THE VAULT CARD`. **`Documents`** : THE VAULT CARD et ses deux fichiers d'impression.
- **La gravure, ton choix du 25 octobre** : les prix de l'add-on ENGRAVING et son interrupteur YOUR ORDERS se règlent par un **ADMIN seul** ; un OPERATOR garde tout le reste, et tous les autres add-ons.

**Pour le serveur**

- **Le tirage est fait par le serveur**, une fois par coffre : un coffre déjà ouvert redonne ce qu'il contenait. Au plus 10 ouvertures par minute et par compte. Aucune table, aucune chance ni aucune quantité n'arrive jamais sur un téléphone ([API](../API.md)). Une pièce offerte non réclamée en 30 jours est annulée par la tâche de fond et revient au stock.
- **Shopify, plus tard** (S1 à S7) : une commande `Vault` s'exporte comme une commande de la plateforme ; un modèle VAULT ONLY n'est jamais poussé comme vendable.

**Les migrations**, appliquées dans **une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `5e0518fe53cd`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0061_the_vault` | D1, D3, D4, D9, D17, D27 | les sept occasions (`vault_sources`, allumées, 1 coffre par occasion, plafond 1, THE HOUSE sans plafond), la table de la maison (`vault_rewards`, avec la seule ligne I WAS THERE), les coffres (`vaults`), les paliers déjà tenus (`vault_occasions_before`, sans les comptes de test), les liens d'invitation (`invitations`, `accounts.invited_by`), l'interrupteur de chaque LIVE RELEASE (`drops.vault_on`, éteint partout), le modèle VAULT ONLY (`models.vault_only`, nulle part) |
  | `0062_vault_rewards` | D19, D20, D29 | ce que livre un coffre : son crédit, sa commande `Vault` (offerte, la pièce mise de côté, ou achetée), sa place garantie, son complément à 0, son crédit à offrir (`vault_gifts`) |

  L'application est arrêtée pendant les migrations. Une fois appliquées, on ne revient plus en arrière (ci-dessous). Elles n'ajoutent que des tables et des colonnes : aucune donnée d'aujourd'hui ne change.

- **Les variables** : aucune nouvelle. Ton `.env` ne change pas. La clé des crédits à offrir dérive de `COOKIE_SECRET` : changer un jour `COOKIE_SECRET` mettrait fin aux crédits à offrir pas encore acceptés, comme aux codes de transfert.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. Caddy n'est pas recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `5e0518fe53cd` ne peut plus tourner sur ce schéma. `deploy.sh --image 5e0518fe53cd` la refuse.

### 1.1 Avant : le tableau de revue, ta table, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Le tableau de revue d'abord** (règle 1). Les captures, au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair (le coffre et sa page restent sombres en mode clair) : SOLD OUT pour ta taille avec le coffre, la page de fin d'une sortie vendue en entier, l'ouverture (une récompense et une rare), la page THE VAULT (vide, une porte, plusieurs, OPENED), YOUR ACCOUNT et sa ligne THE VAULT, NOW, les messages FROM ORBES, YOUR ORDERS (une pièce offerte, un droit d'achat), les pages d'invitation et du crédit à offrir, l'image I WAS THERE, THE VAULT CARD et les pages légales nouvelles. Dans la console : `Club` → `THE VAULT` (la table, `Sources`, `Give a vault`, le rapport), la section `THE VAULT` d'une LIVE RELEASE, le bloc `THE VAULT` d'une fiche client, `VAULT ONLY`, la gravure vue par un OPERATOR. Le rapport de Claude te liste aussi les mots qu'aucune maquette n'avait et ses lectures (N16, N33, N1, N3).

Sans ton accord, rien n'est fusionné ni déployé.

**2. Ta table, à préparer** (OP-27). Après le déploiement, la table de la maison n'a que la carte I WAS THERE : chaque coffre ouvert donne la carte jusqu'à ce que tu la remplisses (§1.8). Les valeurs de la maquette (25 € à 1 IN 10, GUARANTEED à 1 IN 200…) ne sont que des exemples. Prépare tes lignes : la sorte, le montant ou le produit, les chances et la quantité de chacune.

**3. Ce qui doit être réglé avant le jour** :

- **ADD-ONS ONE SYSTEM est en production**, au commit `5e0518fe53cdedd6b2512538e78f70f519d16afa` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** entre l'ouverture de sa salle et sa fin, ni dont la salle ouvre dans l'heure (règle 3 ; le point 10 le lit), et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §0 « THE VAULT : les coffres des collectionneurs » et §2 « THE VAULT CARD dans le colis ». Ils ne donnent jamais la table ni ses chances, et un coffre donné ne se reprend pas.

**4. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-one-queue>. Le dernier passage de `genome-ci` sur `<SHA_Q3>` doit avoir une coche verte (ses quatre parties). Sinon, n'avance pas.

**5. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 9) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_Q3>` exactement, comme pour Q2. Claude te donne la commande dans son rapport ; il ne la lance pas.

**6. Connecte-toi au serveur** en SSH, comme d'habitude, puis :

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

**7. L'heure.**

```bash
date -u
```

Sortie attendue : une heure **hors** de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**8. Le pré-contrôle.** Note les six résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte.

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

**9. Aucune sauvegarde en cours** (la tienne ou celle d'un autre projet de l'hôte) :

```bash
pgrep -a pg_dump
```

Sortie attendue : **rien**. Une ligne `<numéro> pg_dump …` : une sauvegarde tourne, attends qu'elle finisse et relance la commande.

**10. Les LIVE RELEASES et les tests, en lecture seule.** D'abord, aucune LIVE RELEASE dont la salle est ouverte, ou ouvre dans l'heure (règle 3) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

Sortie attendue : `0`. Un autre nombre : une sortie est en cours ou va ouvrir sa salle ; attends sa fin (ou déploie un autre jour).

Puis, aucun test de TEST ENTRANTS sans END TEST :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from test_runs where ended_at is null"'
```

Sortie attendue : `0`. Un autre nombre : un test tourne, ou un test fini attend son END TEST ; fais END TEST sur sa page avant de déployer.

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

Sortie attendue : `5e0518fe53cdedd6b2512538e78f70f519d16afa` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=5e0518fe53cd`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 5e0518fe53cd OK (previous 7098341f83f2; migrations 0059_addons_one_system, 0060_release_addons_converted)` : ADD-ONS ONE SYSTEM est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_Q3>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 5e0518f..<7 caractères de SHA_Q3>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_Q3>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 5), contre le commit de Q2 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status 5e0518fe53cdedd6b2512538e78f70f519d16afa HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**Les migrations, et elles seules** (règle 6) :

```bash
git -C /opt/orbes/orbes-index diff --name-status 5e0518fe53cdedd6b2512538e78f70f519d16afa HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces deux lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0061_the_vault.ts
A	genome/src/server/db/migrations/0062_vault_rewards.ts
```

**La version des pages légales** (règle 12) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-26';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 61 lignes, de `0001_initial` à `0060_release_addons_converted` ; les deux dernières :

```text
0059_addons_one_system
0060_release_addons_converted
```

Une liste qui s'arrête avant `0060_release_addons_converted` : Q2 n'est pas en production, arrête-toi.

### 1.4 Déployer

Hors des heures des règles 2 et 3. **Juste avant**, relance la première requête du §1.1, point 10 (aucune salle ouverte, aucune qui ouvre dans l'heure) : `0`, sinon attends.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement THE VAULT lancé à <heure> Paris (<heure> UTC), deux migrations, rien ne change sur l'hôte. » Ajoute-y l'image, `orbes-genome:<TAG_Q3>`, et les six résultats du pré-contrôle (§1.1, point 8).

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_Q3> (tag <TAG_Q3>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la même configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_Q3>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 5e0518fe53cd
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : le site tourne toujours sur `5e0518fe53cd`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 61 migration(s) applied, all known to orbes-genome:<TAG_Q3>
   ```

   **Il faut lire `61 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `5e0518fe53cd`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_Q3>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_Q3>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_Q3>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_Q3>
   Applied 2 migration(s): 0061_the_vault, 0062_vault_rewards
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 2 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) ; Caddy garde son conteneur, sa configuration n'ayant pas changé.

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
   … [deploy.sh] deployed orbes-genome:<TAG_Q3> (previous: 5e0518fe53cd). This release applied the migration(s) 0061_the_vault, 0062_vault_rewards:
   … [deploy.sh] orbes-genome:5e0518fe53cd cannot run on this schema any more (scripts/deploy.sh --image 5e0518fe53cd refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_Q3> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`. Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant. Les migrations elles-mêmes ne se défont pas : le `down` de `0062_vault_rewards` refuse dès qu'un crédit, une commande, une place garantie, un complément, un crédit à offrir ou une offre venus d'un coffre existent, et celui de `0061_the_vault` dès qu'un coffre, une invitation, un compte invité, un message de coffre, une ligne de la table autre que I WAS THERE, une occasion qui n'a plus ses réglages par défaut, une sortie avec THE VAULT allumé ou un modèle VAULT ONLY existent.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `5e0518fe53cd`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur de `db migrate`, puis `── rollback to orbes-genome:5e0518fe53cd` et `rolled back to 5e0518fe53cd; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `5e0518fe53cd`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 5e0518fe53cd is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_Q3> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `5e0518fe53cd`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_Q3>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, une occasion qui pose problème s'éteint dans `Club` → `THE VAULT` → `Sources`, une ligne de la table se désactive (`Deactivate`), et THE VAULT reste éteint sur tes vraies LIVE RELEASES ; jamais rien par la base. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 5e0518fe53cd`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_Q3> OK (previous 5e0518fe53cd; migrations 0061_the_vault, 0062_vault_rewards)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 63 lignes `applied`, de `0001_initial` à `0062_vault_rewards`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que les migrations ont écrit**, en lecture seule. Les sept occasions, avec leurs réglages par défaut (allumée, 1 coffre par occasion, plafond 1 ; THE HOUSE sans plafond) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select source, enabled, per_occasion, cap from vault_sources order by source"'
```

Sortie attendue : exactement ces sept lignes :

```text
FRIEND|t|1|1
HOUSE|t|1|
LIVE|t|1|1
PIECE|t|1|1
PROFILE|t|1|1
TIER|t|1|1
WORN|t|1|1
```

La table de la maison, avec la seule carte I WAS THERE (sans chances ni quantité : elle prend le reste, et ne s'épuise jamais) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select kind, odds_in, quantity, given, active from vault_rewards order by position"'
```

Sortie attendue : une seule ligne, `I_WAS_THERE|||0|t`.

Les paliers déjà tenus au moment de la migration (ils ne donneront jamais de coffre, N7) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select occasion_key, count(*) from vault_occasions_before group by 1 order by 1"'
```

Sortie attendue : une ligne par palier tenu par au moins un compte, `TIER:1|<comptes>`, `TIER:2|<comptes>`, `TIER:3|<comptes>` (TITANE, PLATINE, PALLADIUM), les comptes de test jamais comptés ; **rien** si aucun compte ne tient de palier.

Aucune sortie avec THE VAULT allumé, aucun modèle VAULT ONLY :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from drops where vault_on), (select count(*) from models where vault_only)"'
```

Sortie attendue : `0|0`.

Les coffres déjà donnés, par occasion :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select source, count(*) from vaults group by 1 order by 1"'
```

Sortie attendue : **rien**, ou quelques lignes `PIECE|<n>`, `TIER|<n>`, `WORN|<n>`, `PROFILE|<n>` si un collectionneur a déjà enregistré une pièce, publié une photo WORN ou complété son profil depuis le redémarrage : les occasions sont allumées dès le déploiement. Jamais `LIVE` ni `HOUSE` à ce stade.

**La console** (sur ton ordinateur, en ADMIN) :

- `Club`, onglet `THE VAULT` : sa ligne d'en-tête, la table avec la seule ligne I WAS THERE, `ALWAYS`, et dessous « The rewards hold 0.00 % of the draw. I WAS THERE holds the rest, published as 1 IN 1 (100.00 %). » ; `Sources`, les sept occasions, chacune `ON`, `1 vault` et son plafond (« At most 1 per release », … ; THE HOUSE « None: each gift is its own ») ; `Give a vault` ; le rapport.
- `Documents` : trois documents, le troisième **THE VAULT CARD**. Ouvre-le : l'image des deux faces de la carte, puis les liens `vault-card-sheet.pdf` (la planche A4 de huit) et `vault-card-single.pdf` (la carte seule) ; chacun télécharge son PDF, qui s'ouvre (deux pages).

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

Sortie attendue : exactement seize lignes, chacune `200`, une par son : les onze de la LIVE RELEASE et les cinq du coffre (`vault-…`), dans cet ordre (les 8 caractères après le nom changent à chaque version) :

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
200 /assets/vault-halves-<8 caractères>.mp3
200 /assets/vault-lid-<8 caractères>.mp3
200 /assets/vault-rare-<8 caractères>.mp3
200 /assets/vault-reveal-<8 caractères>.mp3
200 /assets/vault-unlock-<8 caractères>.mp3
200 /assets/welcome-<8 caractères>.mp3
```

Moins de seize lignes, une autre ligne, ou un autre code que `200` : colle la sortie à Claude.

**La version des pages légales**, dans l'application publiée :

```bash
curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\.js' | head -1)" | grep -o '2026-10-26' | head -n 1
```

Sortie attendue : `2026-10-26`. Rien : colle la sortie à Claude.

**Préviens le responsable de l'hôte** : « THE VAULT fait à <heure> Paris (<heure> UTC), deux migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN ; dans l'application, avec deux comptes de collectionneur actifs, jamais des comptes de test (un compte de test ne reçoit jamais de coffre), qui détiennent chacun une pièce du même modèle d'essai (les deux comptes de la vérification des ADD-ONS conviennent) : **A**, ton propre compte, sur ton téléphone (Safari), **B** sur ton ordinateur, dans une fenêtre de navigation privée (la console reste dans la fenêtre normale). Sur les deux, `SOUND` sur `ON` (YOUR ACCOUNT). Chaque contrôle laisse soit une vraie donnée que tu gardes, soit rien ; les coffres donnés pour l'essai restent dans l'historique, ouverts.

#### 1. La table et les sources, à lire

1. `Club`, onglet `THE VAULT` : la table n'a que I WAS THERE, ses chances `1 IN 1`, `ALWAYS`. Rien à changer.
2. `Sources` : les sept occasions dans l'ordre (`LIVE release`, `Piece bought`, `New tier`, `WORN photograph`, `Friend’s first piece`, `Complete profile`, `THE HOUSE`), chacune `ON`, `1 vault`, son plafond, et « Default: on · 1 vault · at most 1 per release » à côté (THE HOUSE : « Default: on · 1 vault · no cap »). N'y touche pas maintenant (§1.8).

#### 2. GIVE A VAULT à ton propre compte (A)

1. `Give a vault` : la boîte `GIVE A VAULT`. `To` `A collector`, `Collector’s email` l'e-mail de A, `Note for Client Services` `Test`, puis `Show the reach` : « Reaches 1 collector: 1 vault each. » et « Nobody left out. ». Un autre nombre, ou A laissé de côté (un compte de test ou inactif) : ferme sans donner.
2. `Give` : « 1 vault given to 1 collector. »
3. La fiche client de A, bloc `THE VAULT` : une ligne `THE HOUSE`, donnée aujourd'hui avec ton e-mail dessous, `WAITING` et « Until <jour> » (30 jours), « — » pour ce qu'il contenait, la note `Test`, et « 1 waiting · 1 given ». `Give a vault` est là ; aucun bouton pour reprendre le coffre.

#### 3. Ce que A voit, sur son téléphone

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| NOW | A | Ouvrir l'application | La ligne « A VAULT IS WAITING FOR YOU », avec OPEN |
| Le petit nombre | A | YOUR ACCOUNT | La ligne THE VAULT, après YOUR WISHLIST, avec son petit nombre : `1` |
| Le message FROM ORBES | A | MESSAGES → FROM ORBES | NEW ; « A VAULT IS WAITING FOR YOU » ; « We have added a vault to your account. It is kept until <jour>. Open it in YOUR ACCOUNT, under THE VAULT. » ; le lien THE VAULT |
| La page THE VAULT, sombre | A | OPEN, ou la ligne THE VAULT | YOUR ACCOUNT · THE VAULT, THE VAULT, « Vaults are given on specific occasions, to eligible collectors, at the ORBES team’s discretion. » ; YOUR VAULTS · 1 WAITING ; la porte qui flotte, PRESS AND HOLD dessous, puis FROM THE HOUSE et WAITS UNTIL <JOUR> ; plus bas HOW TO OBTAIN A VAULT (les sept occasions, chacune où tu en es) et WHAT A VAULT CAN HOLD (les huit, RARE sur trois), aucune chance nulle part. En mode clair aussi, la page reste sombre |

#### 4. L'ouverture sur le téléphone, avec un crédit de 1 € pour l'essai, puis retour

Pendant les quelques minutes où la ligne de 1 € est active, un collectionneur qui ouvrirait un coffre la gagnerait : ajoute-la juste avant d'ouvrir, et désactive-la aussitôt après.

1. **La ligne d'essai.** `Club` → `THE VAULT` → `New reward` : `Kind` `House credit`, `Amount` `1`, `Currency` `EUR`, `Odds` `1`, `Quantity` `1`, puis `Add reward` : « Reward added. » La ligne lit « € 1 of house credit, 30 days », `1 IN 1`, `ACTIVE` ; I WAS THERE lit « None left », et dessous : « The rewards hold 100.00 % of the draw. I WAS THERE holds the rest, published as none: the table holds the whole draw. »
2. **L'ouverture**, sur A :

| Élément | Où | Geste | Ce que tu dois voir et entendre |
|---|---|---|---|
| Relâcher trop tôt | A | Appuyer sur la porte, relâcher avant une seconde et demie | La porte se referme ; rien n'est ouvert |
| L'ouverture | A | Maintenir la porte une seconde et demie (ou la tirer vers le bas) | Le déverrouillage, les deux moitiés qui s'écartent, le couvercle avec FOR YOU qui se lève, la niche éclairée ; les sons, et une courte vibration sur un téléphone qui la permet (Android ; Safari sur iPhone ne vibre pas, c'est normal) |
| La récompense | A | Regarder | FROM THE VAULT, « €1 », « House credit, valid 30 days. », « 1 IN 1 ». La porte reste ouverte à sa place ; PRESS AND HOLD disparaît ; sur cette page, ni OPEN ANOTHER ni assombrissement |
| OPENED | A | Recharger la page | YOUR VAULTS : « No vault is waiting. » ; sous OPENED, le jour, FROM THE HOUSE et « €1 · HOUSE CREDIT ». Le coffre ne s'ouvre plus : il redonne ce qu'il contenait |
| Le crédit | A | YOUR ACCOUNT | Sous IN USE, la ligne HOUSE CREDIT, « € 1 · UNTIL <date> » ; NOW n'a plus sa ligne, et THE VAULT plus son petit nombre |
| Le reçu | A | MESSAGES → FROM ORBES | « FROM THE VAULT » : « Your vault held €1 · House credit, valid 30 days. It is in YOUR ACCOUNT. » |
| La fiche | Console | La fiche client de A, bloc `THE VAULT` | `OPENED`, « Opened <jour> », ce qu'il contenait avec ses chances (`1 IN 1`) |

3. **Le retour, tout de suite.** Sur la ligne de 1 € : `Deactivate`, la boîte « Deactivate the reward », puis `Deactivate` : « Reward deactivated. » La ligne reste (une ligne qui a donné une fois ne s'efface jamais), `INACTIVE`, `Given` `1`, `Left` `0` ; dessous, de nouveau « The rewards hold 0.00 % of the draw. I WAS THERE holds the rest, published as 1 IN 1 (100.00 %). » Le crédit de 1 € de A reste 30 jours puis expire : ne l'applique à aucune commande.

#### 5. L'ouverture sur l'ordinateur (B), en mode clair

1. Sur B, YOUR ACCOUNT, LIGHT MODE (sous SOUND) allumé.
2. Dans la console, `Give a vault` à l'e-mail de B, comme au point 2 : « 1 vault given to 1 collector. »
3. Sur B : NOW lit « A VAULT IS WAITING FOR YOU » ; YOUR ACCOUNT, la septième carte THE VAULT avec `1`. Ouvre-la : la page THE VAULT de l'ordinateur, sombre en mode clair, la porte plus grande, PRESS AND HOLD dessous.
4. Maintiens la porte avec la souris une seconde et demie (ou la barre d'espace) : la même ouverture, les mêmes sons. La récompense : I WAS THERE, « Your card. Save it. », « 1 IN 1 ».
5. Sous OPENED, sa ligne avec SAVE THE IMAGE : l'image `ORBES-I-WAS-THERE.png`, 1080 × 1350, le monogramme, I WAS THERE, l'occasion et sa date. Rien n'est envoyé à ORBES.

#### 6. Une LIVE RELEASE d'essai, THE VAULT allumé, une taille épuisée

La sortie d'essai est **visible de tous** dans THE RELEASES et la bannière pendant une heure environ, puis pour toujours dans PAST et sur la fiche du modèle d'essai, avec son titre, le nom et la photographie du modèle d'essai et « 2 PIECES » : fais-la à une heure creuse. Seuls les propriétaires du modèle d'essai peuvent y entrer.

**La préparation, dans la console :**

1. `Club`, section `Drops` → `New live release` : `Model` le modèle d'essai, `Title` `TEST VAULT`, `Opening (UTC)` dans 30 minutes environ, `End of the sales (UTC)` une heure après, `People per batch` `1`, `Every (minutes)` `1`, `Hold after the opening (minutes, 0 = none)` `0`, `Price of a piece` `1`, `Currency` `EUR`, `Sizes` sur deux lignes, `52 = 1` puis `54 = 1`. Sous `Add-ons offered`, décoche tout. `Create release`.
2. Sur sa page, la section `THE VAULT` lit `Off` et « Off by default: no vault from this release. ». `Turn on` : la boîte « THE VAULT on for this release », puis `Turn on` : « THE VAULT is on for this release. » La section lit `On` et « A size sold out gives a vault to each collector still in its line (test entrants never). »
3. `Access` → `Edit` : `Owners of <le modèle d'essai>` coché, rien d'autre. `Times (UTC)` → `Edit` : `Room opens (minutes before)` `15`. Puis `Publish`.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| La file | A, puis B | La sortie : ENTER THE ROOM, la taille `52` pour les deux ; attendre T0 | La file, puis à T0 le tour d'un seul des deux (un par lot) : appelons-le le premier ; l'autre reste dans la file |
| La taille épuisée | Le premier | Tenir le sceau, puis PAY | CONFIRMED : la taille 52 est épuisée (la 54 reste) |
| SOLD OUT pour ta taille | L'autre | Regarder | SOLD OUT, sa taille dessous ; sous la phrase, le coffre : « A vault is waiting for you. » et « DRAW IT DOWN, OR PRESS AND HOLD », avant LEAVE THE LINE. Sur un téléphone, la salle reste sombre ; sur l'ordinateur en mode clair aussi |
| L'ouverture dans la salle | L'autre | Tirer la porte vers le bas, ou la maintenir | La page s'assombrit pendant que le coffre s'ouvre ; I WAS THERE, « Your card for this release. Save it. », « 1 IN 1 » ; SAVE THE IMAGE (LIVE RELEASE, `TEST VAULT`, sa date) ; puis OPEN ANOTHER |
| OPEN ANOTHER | L'autre | Le toucher | Le coffre se referme et quitte la page ; la page THE VAULT s'ouvre, et sous OPENED, YOUR SIZE SOLD OUT et la carte |
| Le premier | Le premier | MY PIECES, YOUR ACCOUNT | Aucun coffre de cette sortie : il a eu sa pièce |
| La console | Console | La page de la sortie ; après sa fin, `Release report` | `THE VAULT` `On` ; après la fin, sous `THE VAULT` : `Vaults given` `1` (« SIZES SOLD OUT, THE LINE STILL WAITING ») et `Vaults opened` `1` (« OF 1 GIVEN ») |

**Le nettoyage** : la commande de 1 €, dans `Orders`, sa page, `Cancel`, la boîte « Cancel the order », `Note` `Test`, puis `Cancel the order` : « Order cancelled. ». La taille 54 reste ; la sortie se ferme à sa fin sans donner d'autre coffre (une sortie qui ferme avec des pièces restantes n'en donne pas), et reste dans la base et dans PAST.

#### 7. Une pièce enregistrée (PIECE)

Au prochain vrai premier enregistrement d'une pièce achetée (un client qui enregistre la sienne, ou un de tes comptes avec une pièce jamais enregistrée) : son compte reçoit un coffre. Son message FROM ORBES : « A VAULT IS WAITING FOR YOU », « With your new piece, <LA PIÈCE>, we have added a vault to your account. It is kept until <jour>. Open it in YOUR ACCOUNT, under THE VAULT. » ; sa page THE VAULT, une porte avec A NEW PIECE ; sa fiche, bloc `THE VAULT`, une ligne `Piece bought`. Un premier compte reçoit aussi celui de TITANE (A NEW TIER). Sans enregistrement le jour même, garde ce point pour le prochain.

#### 8. La liste de colisage : THE VAULT CARD

Sur le prochain vrai colis d'une commande LIVE, DRAW ou SALON, dans `Logistics` → `To ship`, la page du colis, `Packing` : la ligne `THE VAULT CARD`, juste après celle de la carte certificat. `Packed` attend qu'elle soit cochée : glisse la carte dans la boîte, coche la ligne à la main. Le bordereau la rappelle sous la pièce : `Vault card` · `THE VAULT CARD`. Jamais sur un cadeau de bienvenue, un échange ou une pièce offerte par un coffre. Sans colis le jour même, garde ce point pour le prochain.

#### 9. Imprimer la planche A4

`Documents` → THE VAULT CARD → `vault-card-sheet.pdf`. Imprime une planche sur ton papier ivoire, en recto verso, retournement **bord long**, à **taille réelle** (100 %, sans « ajuster à la page ») : la barre de 10 mm en pied de page mesure 10 mm. Coupe sur les traits : huit cartes de 95 × 62 mm, comme la MINT CERTIFICATE. Une carte : le recto noir avec THE VAULT au centre, sans bord blanc ; le verso dans le bon sens, THIS PIECE OPENS A VAULT et les trois étapes. Fais ce premier essai avant d'en imprimer plus.

#### 10. Les pages légales

Sur ton téléphone, TERMS et PRIVACY au pied de page : « Version of 26 October 2026 » sous le titre ; dans les conditions, article 13, le paragraphe « THE VAULT. », et article 14, au premier paragraphe, « or a piece from THE VAULT (article 13) » ; dans la politique de confidentialité, partie « Your ORBES account », la phrase du lien d'invitation (« If you create your account with a collector's personal invitation link, … ») suivie de celle des coffres (« ORBES also keeps with your account your vaults … »).

#### 11. La gravure, un ADMIN seul pour ses prix

Avec un compte OPERATOR, s'il y en a un (celui d'un membre de l'équipe, avec lui) : `Catalogue` → `Add-ons`, la ligne ENGRAVING, `Edit` : ses prix et son interrupteur YOUR ORDERS n'y sont pas, et la boîte le dit : « Its prices and its YOUR ORDERS switch are an ADMIN’s: an OPERATOR changes every other field. » Ferme sans rien enregistrer. En ADMIN, tout reste modifiable. Sans OPERATOR, garde ce point pour plus tard.

### 1.8 Ensuite : tes données

Dans cet ordre, quand tu veux :

1. **Ta vraie table** (§1.1, point 2), `Club` → `THE VAULT` → `New reward`, une ligne par récompense : sa sorte (`House credit`, `Free add-on`, `Product`, `GUARANTEED`, `Credit to give`, `VAULT EDITION`, `THE PIECE`), son montant ou son produit, ses chances (`Odds`) et sa quantité (`Quantity`, la limite). Les chances de toutes les lignes actives ne dépassent jamais une sur une ; I WAS THERE prend le reste. Remplis-la vite : les occasions sont allumées dès le déploiement, et un coffre ouvert avant donne la carte (un coffre qui attend sera tiré dans ta table le jour où il s'ouvre). Une VAULT EDITION demande d'abord un modèle marqué `VAULT ONLY` dans `Catalogue` (la fiche du modèle).
2. **Les limites de chaque occasion** : `Club` → `THE VAULT` → `Sources`, chacune son interrupteur, ses coffres par occasion (`Vaults per occasion`, de 1 à 10) et son plafond (de 1 à 100). **Pour une LIVE RELEASE, rien au-dessus de 1** (ni plafond, ni coffres par occasion) tant que la phrase des conditions qui dit « au plus un par compte et par LIVE RELEASE » n'a pas changé (N22) : demande-le à Claude d'abord.
3. **THE VAULT sur chaque LIVE RELEASE que tu veux** : sur sa page, section `THE VAULT`, `Turn on`, jusqu'à sa fin ; éteint par défaut, jamais sur une after-room.
4. **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1).
5. **Les anciennes images (facultatif).** Une fois THE VAULT stable, `5e0518fe53cd` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_Q3>`), la liste d'abord :

   ```bash
   docker images orbes-genome
   ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **La carte d'un coffre sans sortie** (N4). Un coffre d'une pièce, d'un palier, de WORN, d'un ami, du profil ou de la maison donne pour plancher une carte I WAS THERE qui nomme son occasion et sa date (« Your card. Save it. »). On garde ?
2. **Ce qui a eu lieu avant le déploiement** (N7). Aucun coffre pour les profils déjà complets, les paliers déjà tenus ni les pièces déjà enregistrées. Les donner une fois ?
3. **THE VAULT CARD** (N9). La carte ne va pas dans le colis d'une pièce offerte par un coffre (commande `Vault` à 0), d'un échange, ni tant que l'occasion de la pièce achetée est éteinte, puisqu'elle dit « we have added a vault » sans qu'aucun coffre ne soit ajouté. On garde ?
4. **Reprendre un coffre** (N36). Seule une pièce retournée reprend son coffre non ouvert. Un bouton pour reprendre un coffre donné par erreur (GIVE A VAULT au mauvais client) ou par abus, avec sa phrase dans les conditions : on le fait ?
5. **Les phrases de la politique de confidentialité** (D70). Le lien d'invitation garde quel compte en a invité un autre, et chaque compte garde ses coffres (leur occasion, leur ouverture, ce qu'ils contenaient) et le coffre d'un crédit à offrir qu'il a accepté, sans nommer l'autre collectionneur ; deux phrases le disent, et la copie des données d'un compte les donne. Ta ligne du 24 octobre (« pas de changement de la politique ») visait Q1 : on garde celles-ci ?
6. **Un échange** (N8). La pièce de remplacement d'un échange n'ouvre pas de coffre, même quand la première n'avait jamais été enregistrée : cet acheteur n'en a alors aucun. On garde ?
7. **Un palier atteint de nouveau.** Un palier donne un coffre une seule fois, pour toujours : un plafond au-dessus de 1 pour `New tier` ne change rien. On garde ?
8. **L'avocat** : le paragraphe THE VAULT et la phrase de l'article 14 des conditions, et les phrases du lien d'invitation et des coffres, partent avec la version `2026-10-26` (la note au juriste, points 38 et 39). Sa réponse ne retient pas le déploiement.
9. **Un ensemble (THE SET) dans la table** (D28, N12). Aujourd'hui seule une pièce (modèle) ou un add-on peut y être mis, gratuit ou au prix. Ajouter les ensembles ?
