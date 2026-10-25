# Mise en production du lot ADD-ONS ONE SYSTEM (Q2)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot Q2 de tes décisions du 22 octobre sur les compléments (ADD-ONS ONE SYSTEM : un seul système d'add-ons, ceux du catalogue, chacun un futur produit de la boutique Shopify ; où chacun est proposé ; les services sans stock ; la conversion des add-ons de release ; l'écran 5b) part en production en **un seul déploiement**, après celui de ONE QUEUE ([son runbook](DEPLOY-OQ-Q1.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| ADD-ONS ONE SYSTEM (lot Q2) | Un seul système : les add-ons du catalogue, chacun un produit, un article avec stock ou un service sans stock (D1, D2, D4, D7) ; quatre interrupteurs par add-on et le choix de chaque release (D3, D8) ; la gravure, un service dont le collectionneur tape les mots (D4, D12) ; les add-ons de release et le prix de gravure des Réglages convertis en add-ons du catalogue avant que leurs champs disparaissent (D5) ; l'écran 5b, SECURED avec les add-ons, sur téléphone et ordinateur, en mode sombre et en mode clair, et le reçu de CONFIRMED (D10 à D21) ; la console ; l'export Shopify (D9) ; les articles 13 et 14 des conditions | `0059_addons_one_system`, `0060_release_addons_converted` | aucun | **À faire** (§1) |

Le point de départ : la production tourne ONE QUEUE, son commit `7098341f83f223d4900f35e646b018f7830a3b83` (image `orbes-genome:7098341f83f2`, déployée le 24 octobre 2026 à 18:35 à Paris (16:35 UTC)), avec les 59 migrations de `0001_initial` à `0058_one_queue`. **Q2 ne part qu'après Q1, ou avec lui** : ses migrations s'appuient sur `0058_one_queue`. Avant le jour, Claude remplace dans ce document `<SHA_Q2>` et `<TAG_Q2>` par le commit final de Q2 (40 caractères) et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `7098341f83f2` (Q1 pas encore en production, et Q2 part alors avec lui ; un correctif après Q1 ; ou un autre lot déployé avant), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur le tableau de revue d'abord.** Avant la fusion, tu regardes le tableau de revue que te donne le rapport de Claude (§1.1) : les captures de l'écran 5b et des autres écrans touchés, la console, et ce que la conversion fera de tes add-ons de release et de ton prix de gravure, release par release. Tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.** Le redémarrage couperait la salle, la file et les tours en cours, et `0060_release_addons_converted` refuse de s'appliquer tant qu'un add-on de release est choisi sur une tenue en cours (un tour ou un SECURED). Tu déploies quand aucune LIVE RELEASE n'a sa salle ouverte, ni ne l'ouvre dans l'heure (le pré-contrôle du §1.1 le lit), et quand aucun test de TEST ENTRANTS ne tourne.
4. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures des règles 2 et 3, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
5. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume. Ton `.env` ne gagne aucune ligne.
6. **Deux migrations, puis plus de retour en arrière** : après `0059_addons_one_system` et `0060_release_addons_converted`, l'image `7098341f83f2` ne tourne plus sur le schéma (`deploy.sh --image 7098341f83f2` la refuse). En cas de souci, on **répare en avant** (§1.5).
7. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
8. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
9. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-one-queue` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
10. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche.
11. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
12. **Les pages légales changent** : les conditions, seulement les phrases des add-ons devenues fausses (article 13, *Your piece* ; article 14, *Delivery* et *Add-ons*), en anglais et en français, dans une seule nouvelle version, `2026-10-25`. La politique de confidentialité ne change pas. Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La relecture par un avocat ne retient jamais le déploiement.

---

## 1. Le déploiement

### 1.0 Ce qui change

**En mots simples**

- **Un seul système d'add-ons.** Il ne reste que les add-ons du catalogue (`Catalogue` → `Add-ons`), chacun avec son SKU, son prix par devise, et plus tard son produit Shopify. Les add-ons écrits dans une LIVE RELEASE (sa partie `Add-ons`, depuis la première LIVE) et le prix de gravure de `Orders` → `Settings` disparaissent : ils sont **convertis** en add-ons du catalogue par la migration, avant que leurs champs s'en aillent.
- **Avec stock, ou service.** Un add-on est `WITH STOCK` (compté dans `Logistics`, commandé à son fournisseur, comme ceux de M3) ou `SERVICE` (la gravure, un emballage cadeau) : un prix, aucun stock, aucun fournisseur, aucun entrepôt. Le type se choisit à la création et ne change plus.
- **Quatre interrupteurs par add-on** : proposé à l'achat d'une LIVE RELEASE, à l'achat d'une release à tirage, à l'achat du salon privé, et dans YOUR ORDERS jusqu'au début de l'emballage. Tous allumés par défaut.
- **Chaque release choisit les siens** (`Add-ons offered`) : une LIVE RELEASE (son after-room a son propre choix) et une release à tirage proposent à l'achat seulement les add-ons qu'elles ont cochés, parmi ceux dont l'interrupteur est allumé. Une nouvelle release les a tous cochés au départ (ceux dont l'interrupteur est allumé et qui ont un prix dans sa devise) : tu décoches. Le salon suit son interrupteur seul ; YOUR ORDERS aussi, sur toute commande jusqu'à l'emballage, quelle que soit sa release, même finie.
- **La gravure et ses mots.** La gravure est un add-on de service, marqué `The engraving` (une seule à la fois), avec son nombre de caractères le plus haut, `Most characters`, de 1 à 20. Sur l'écran 5b, le collectionneur la choisit et tape ses mots dans YOUR TEXT, avec le compte (« 5 / 20 ») ; sinon il les entre plus tard dans YOUR ORDERS (ENTER YOUR ENGRAVING). Achetée à l'achat, elle ne se retire pas ; ajoutée dans YOUR ORDERS, elle se retire jusqu'à l'emballage (REMOVE THE ENGRAVING).
- **La conversion** (`0060_release_addons_converted`) : chaque add-on de release, par son nom, devient **un** add-on du catalogue. S'il en existe déjà un du même nom (sans tenir compte des majuscules), il le rejoint : son type, sa ligne, ses interrupteurs et ses prix restent, seules les devises où il n'a pas de prix sont remplies. Sinon, un nouveau `SERVICE` naît, avec le nom et la ligne de la release la plus récente qui l'avait, proposé à l'achat d'une LIVE RELEASE seulement, son prix dans chaque devise de la maison celui de la release la plus récente dans cette devise, son SKU `ADD-<SON NOM>`. Le plus récent dont le nom contient ENGRAVING devient la gravure. Le prix de gravure des Réglages devient le prix de la gravure (il l'emporte dans ses devises) et allume son interrupteur YOUR ORDERS ; sans gravure, un nouveau service `ENGRAVING` (YOUR ORDERS seulement, SKU `ADD-ENGRAVING`) le porte. Chaque release qui n'est ni finie ni annulée garde ce qu'elle proposait : les add-ons du catalogue de M3, puis ses add-ons convertis. Chaque conversion est notée, et la console la dit (« Converted from… »).
- **L'écran 5b** : SECURED avec les add-ons de la release, comme la maquette le dessine : sous la pièce, ADD-ONS, puis chaque add-on une ligne entre deux filets que l'on touche pour la choisir (une par pièce, une par set), son anneau qui s'allume, « + € 15 » à droite, sa ligne dessous ; ENGRAVING choisie, YOUR TEXT sous sa ligne ; PAY lit le total. Sur un ordinateur, les lignes en bas à droite, au-dessus de PAY, et PAY d'abord seulement quand elles le pousseraient sous le premier écran. **Le reçu de CONFIRMED** lit chaque add-on et le TOTAL.
- **Ce qui ne change pas** : l'écran 5 d'une release sans add-on ; la place tenue d'un tirage, le salon et YOUR ORDERS gardent leurs lignes de M3 (de 0 à 3 de chaque) ; un add-on avec stock garde tout de M3 (stock, minimum, fournisseur, commandes fournisseur, réceptions) ; les anciennes commandes gardent leurs add-ons tels que vendus, avec leurs factures et leurs avoirs ; un add-on ne compte jamais pour le palier ; la file, le tour et les sons de ONE QUEUE ; l'hôte ; la politique de confidentialité.

**Pour le personnel (la console)**

- **`Catalogue` → `Add-ons`** gagne les colonnes `Type` (`WITH STOCK` ou `SERVICE`), `Offered` (LIVE, DRAW, SALON, YOUR ORDERS) et `Releases` (combien de releases pas encore finies le choisissent) ; la gravure porte « ENGRAVING · 20 characters at most » ; un add-on converti dit « Converted from the add-ons of <release>, … (<jour>) » ou « Converted from Orders → Settings, Engraving » ; un service lit `No stock`. `New add-on` demande `Type`, les quatre interrupteurs, `The engraving` et `Most characters`.
- **`New live release`**, la partie `Add-ons` d'une LIVE RELEASE (jusqu'à l'annonce), son after-room, et la partie `Add-ons` d'une release à tirage (tant qu'elle est un brouillon) : `Add-ons offered`, une case par add-on, celles qu'elle ne peut pas proposer grisées avec leur raison (« Not offered in a LIVE RELEASE », « No price in GBP »). Les cases de texte `Add-ons` d'une LIVE RELEASE disparaissent.
- **`Orders` → `Settings`**, section `Engraving` : une ligne, « Engraving is an add-on: its prices are in Catalogue → Add-ons, ENGRAVING. ». **La page d'une commande** : l'unité d'un service lit `Service`, jamais un entrepôt. **`Logistics` → `Stock`** et les commandes fournisseur ne listent jamais un service. **La liste de colisage** : une ligne par add-on, et la gravure sa ligne `Engraving done`. **L'export produits Shopify** : un service est un produit d'une variante, `Requires shipping` `false`, sans poids.

**Pour le serveur**

- **Une règle d'offre, vérifiée sur le serveur** : un add-on est proposé et accepté là où son interrupteur est allumé et, à l'achat d'une release, si la release l'a choisi ; jamais un add-on, un stock, un interrupteur ni le choix d'une autre release n'arrive sur un téléphone. Les mots de la gravure sont vérifiés et jamais écrits dans le journal ([API](../API.md)).

**Les migrations**, appliquées dans **une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `7098341f83f2`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0059_addons_one_system` | D3, D4, D12 | le type d'un add-on (`kind`, `PRODUCT` partout), ses quatre interrupteurs (`offer_live`, `offer_draw`, `offer_salon`, `offer_orders`, allumés partout), la gravure (`engraving`) et son nombre de caractères (`text_max`, 1 à 20, 20 partout), le choix de chaque release (`drop_addons`), les mots tapés avant la commande (`addon_choices.text`), l'unité d'un service tenue nulle part |
  | `0060_release_addons_converted` | D1, D2, D5 | la conversion des add-ons de release et du prix de gravure des Réglages en add-ons du catalogue, notée dans `addon_conversions`, le choix de chaque release pas encore finie, puis `live_entry_addons`, `live_addons` et `engraving_prices` supprimées ; elle refuse de s'appliquer tant qu'un add-on de release est choisi sur une tenue en cours |

  L'application est arrêtée pendant les migrations. Une fois appliquées, on ne revient plus en arrière (ci-dessous). Les add-ons des anciennes commandes (`orders.addons`) et leur gravure (`engraving_minor`) restent tels que vendus.

- **Les variables** : aucune nouvelle. Ton `.env` ne change pas.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. Caddy n'est pas recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `7098341f83f2` ne peut plus tourner sur ce schéma. `deploy.sh --image 7098341f83f2` la refuse.

### 1.1 Avant : le tableau de revue, la conversion, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Le tableau de revue d'abord** (règle 1). Les captures, au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair (la salle reste sombre en mode clair) : l'écran 5b (les lignes, une ligne choisie, ENGRAVING avec YOUR TEXT, des mots refusés, PAY et son total), CONFIRMED et son reçu, la place tenue d'un tirage, le salon, YOUR ORDERS (ADD-ONS, ADD AN ADD-ON, la gravure) et les pages légales nouvelles. Dans la console : `Catalogue` → `Add-ons` après la conversion (noms, prix par devise, interrupteurs, « Converted from… »), `New add-on`, `Add-ons offered` d'une LIVE RELEASE et d'un tirage, la page d'une commande avec un service, `Orders` → `Settings`.

**2. La conversion, vue avant** (D5). N'importe quel jour avant, lance les requêtes en lecture seule du point 11 et colle leurs sorties à Claude : il te rend, release par release, ce que `Catalogue` → `Add-ons` lira après la conversion (chaque add-on, son type, ses prix par devise, ses interrupteurs, « Converted from… ») et ce que chaque release ouverte proposera (son choix). Tu le regardes avec le tableau de revue. Le jour venu, les mêmes requêtes doivent donner les mêmes sorties ; sinon, montre la différence à Claude avant de déployer.

Sans ton accord, rien n'est fusionné ni déployé.

**3. Ce qui doit être réglé avant le jour** :

- **ONE QUEUE est en production**, au commit `7098341f83f223d4900f35e646b018f7830a3b83` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** entre l'ouverture de sa salle et sa fin, ni dont la salle ouvre dans l'heure (règle 3 ; le point 10 le lit), et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §2 « Les compléments (add-ons) » et « L'adresse et la gravure du client ». Un add-on n'est proposé que là où son interrupteur est allumé et, à l'achat, si la release l'a choisi ; la gravure se tape sur l'écran 5b ou dans YOUR ORDERS.

**4. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-one-queue>. Le dernier passage de `genome-ci` sur `<SHA_Q2>` doit avoir une coche verte (ses quatre parties). Sinon, n'avance pas.

**5. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 9) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_Q2>` exactement, comme pour Q1. Claude te donne la commande dans son rapport ; il ne la lance pas.

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

Sortie attendue : une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

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

**11. Ce que la conversion lira, en lecture seule** (les sorties que tu colles à Claude au point 2). D'abord, les add-ons de release, release par release (`t` : ni finie ni annulée ; `f` : finie ou annulée) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select d.title, d.ended_at is null and d.cancelled_at is null, count(*) from live_addons a join drops d on d.id = a.drop_id group by d.id order by d.opens_at"'
```

Sortie attendue : une ligne par LIVE RELEASE (une after-room comprise) qui a des add-ons, `<titre>|t|<nombre>` ou `<titre>|f|<nombre>`, ou **rien** : aucun add-on de release, rien à convertir de ce côté.

Leurs noms, tels que la conversion les regroupe (un add-on du catalogue par nom) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select upper(btrim(label)), count(*) from live_addons group by 1 order by 1"'
```

Sortie attendue : une ligne par nom, `<NOM>|<nombre de releases>` (ENGRAVING|3, par exemple), ou rien.

Les noms qui existent déjà dans ton catalogue (ceux-là rejoignent l'add-on existant, sans rien changer de lui que ses devises sans prix) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select i.name, i.active from addon_items i where lower(i.name) in (select lower(btrim(label)) from live_addons) order by i.name"'
```

Sortie attendue : **rien** le plus souvent, ou une ligne par nom déjà au catalogue, `<nom>|t`. Si ENGRAVING y figure (un add-on avec stock de M3 nommé ainsi), il reste tel quel et ne devient pas la gravure : dis-le à Claude avant de déployer.

Aucun add-on de release choisi sur une tenue en cours (la migration refuserait de s'appliquer) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from live_entry_addons x join live_entries e on e.id = x.entry_id where e.confirmed_at is null and e.ended_at is null"'
```

Sortie attendue : `0`. Un autre nombre : une LIVE RELEASE a une tenue en cours ; attends sa fin.

Le prix de gravure des Réglages (`Orders` → `Settings`, `Engraving`), en centimes :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select currency, price_minor from engraving_prices order by currency"'
```

Sortie attendue : une ligne par devise où tu l'as réglé, `EUR|3000` pour 30 € par exemple, ou rien. Ces prix deviennent ceux de la gravure du catalogue.

Enfin, les add-ons actifs du catalogue, les LIVE RELEASES pas encore finies (brouillons et after-rooms compris) et les releases à tirage pas encore finies : chacune de ces releases reçoit son choix.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from addon_items where active), (select count(*) from drops where cancelled_at is null and room_opens_minutes is not null and ended_at is null), (select count(*) from drops where cancelled_at is null and room_opens_minutes is null and (drawn_at is null or drawn_at + make_interval(hours => purchase_window_hours) > now()))"'
```

Sortie attendue : trois nombres, `<add-ons>|<LIVE>|<tirages>` (`1|0|0` par exemple).

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

Sortie attendue : `7098341f83f223d4900f35e646b018f7830a3b83` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=7098341f83f2`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 7098341f83f2 OK (previous 33e843081148; migrations 0058_one_queue)` : ONE QUEUE est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_Q2>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 7098341..<7 caractères de SHA_Q2>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_Q2>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 5), contre le commit de Q1 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status 7098341f83f223d4900f35e646b018f7830a3b83 HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**Les migrations, et elles seules** (règle 6) :

```bash
git -C /opt/orbes/orbes-index diff --name-status 7098341f83f223d4900f35e646b018f7830a3b83 HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces deux lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0059_addons_one_system.ts
A	genome/src/server/db/migrations/0060_release_addons_converted.ts
```

**La version des pages légales** (règle 12) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-25';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 59 lignes, de `0001_initial` à `0058_one_queue` ; les deux dernières :

```text
0057_sets
0058_one_queue
```

Une liste qui s'arrête avant `0058_one_queue` : Q1 n'est pas en production, arrête-toi.

### 1.4 Déployer

Hors des heures des règles 2 et 3. **Juste avant**, relance la première requête du §1.1, point 10 (aucune salle ouverte, aucune qui ouvre dans l'heure) : `0`, sinon attends.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement ADD-ONS lancé à <heure> Paris (<heure> UTC), deux migrations, rien ne change sur l'hôte. » Ajoute-y l'image, `orbes-genome:<TAG_Q2>`, et les six résultats du pré-contrôle (§1.1, point 8).

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_Q2> (tag <TAG_Q2>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la même configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_Q2>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 7098341f83f2
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : le site tourne toujours sur `7098341f83f2`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 59 migration(s) applied, all known to orbes-genome:<TAG_Q2>
   ```

   **Il faut lire `59 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `7098341f83f2`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_Q2>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_Q2>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, avec tes add-ons de release et ton prix de gravure tels qu'ils étaient, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_Q2>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_Q2>
   Applied 2 migration(s): 0059_addons_one_system, 0060_release_addons_converted
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
   … [deploy.sh] deployed orbes-genome:<TAG_Q2> (previous: 7098341f83f2). This release applied the migration(s) 0059_addons_one_system, 0060_release_addons_converted:
   … [deploy.sh] orbes-genome:7098341f83f2 cannot run on this schema any more (scripts/deploy.sh --image 7098341f83f2 refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_Q2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`. Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant. Les migrations elles-mêmes ne se défont pas : le `down` de `0060_release_addons_converted` refuse dès qu'une conversion a eu lieu, et celui de `0059_addons_one_system` dès qu'un service, une gravure ou le choix d'une release existe.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `7098341f83f2`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| `migration 0060_release_addons_converted cannot be applied: <n> release add-ons are chosen on entries in TURN or SECURED`, puis `── rollback to orbes-genome:7098341f83f2` et `rolled back to 7098341f83f2; the stack is healthy` | Une LIVE RELEASE avait une tenue en cours avec un add-on (le §1.1, point 11, l'aurait lue) : aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `7098341f83f2`. | Rien d'autre. Attends la fin de la sortie, puis relance la commande gardée du §1.4. |
| Une autre erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:7098341f83f2` et `rolled back to 7098341f83f2; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `7098341f83f2`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 7098341f83f2 is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_Q2> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `7098341f83f2`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_Q2>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma, tes add-ons convertis compris. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. Un add-on converti que tu ne veux pas se met de côté (`Set aside`), jamais par la base. En attendant, ne publie aucune vraie LIVE RELEASE. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 7098341f83f2`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_Q2> OK (previous 7098341f83f2; migrations 0059_addons_one_system, 0060_release_addons_converted)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 61 lignes `applied`, de `0001_initial` à `0060_release_addons_converted`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que la conversion a écrit**, en lecture seule. Ce qui a été converti, par source :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select source, count(*), count(price_minor) from addon_conversions group by source order by source"'
```

Sortie attendue : `ENGRAVING_PRICES|<n>|<n>`, `<n>` le nombre de lignes du prix de gravure (§1.1, point 11), et `LIVE_ADDON|<total>|<avec prix>`, `<total>` la somme des nombres de la première requête du point 11. Une ligne manque quand il n'y avait rien à convertir de ce côté ; **rien** si aucun des deux.

Les add-ons du catalogue, tels que la console les lira :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select name, kind, offer_live, offer_draw, offer_salon, offer_orders, engraving, text_max from addon_items where active order by position, name"'
```

Sortie attendue : une ligne par add-on actif, dans l'ordre du catalogue. Ceux de M3 : `<nom>|PRODUCT|t|t|t|t|f|20`. Un converti : `<NOM>|SERVICE|t|f|f|f|f|20`. La gravure convertie : `<NOM>|SERVICE|t|f|f|t|t|20` (`<NOM>|SERVICE|t|f|f|f|t|20` quand les Réglages n'avaient pas de prix), ou `ENGRAVING|SERVICE|f|f|f|t|t|20` quand elle naît des seuls Réglages. Ce sont les noms que Claude t'a annoncés au §1.1, point 2.

Le choix de chaque release pas encore finie :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select d.title, count(*) from drop_addons p join drops d on d.id = p.drop_id group by d.id order by d.opens_at"'
```

Sortie attendue : une ligne par release ouverte qui propose des add-ons, `<titre>|<nombre>`, comme annoncé au §1.1, point 2 ; rien si aucune.

**La console** (sur ton ordinateur, en ADMIN) :

- `Catalogue`, section `Add-ons` : les colonnes `Type`, `Offered` et `Releases` ; chaque add-on converti avec « Converted from the add-ons of <release>, … (<jour>) » ou « Converted from Orders → Settings, Engraving » ; la gravure avec « ENGRAVING · 20 characters at most ».
- `Orders` → `Settings`, section `Engraving` : « Engraving is an add-on: its prices are in Catalogue → Add-ons, ENGRAVING. »
- `Club`, section `Drops` → `New live release` : `Add-ons offered`, les add-ons proposés en LIVE déjà cochés. Ferme-le sans rien créer.

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

**La version des pages légales**, dans l'application publiée :

```bash
curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\.js' | head -1)" | grep -o '2026-10-25' | head -n 1
```

Sortie attendue : `2026-10-25`. Rien : colle la sortie à Claude.

**Préviens le responsable de l'hôte** : « ADD-ONS fait à <heure> Paris (<heure> UTC), deux migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN ; dans l'application, avec deux comptes de collectionneur qui détiennent chacun une pièce du même modèle d'essai (les deux comptes de la vérification de ONE QUEUE conviennent), **A** sur ton téléphone (Safari), **B** sur ton ordinateur, dans une fenêtre de navigation privée (la console reste dans la fenêtre normale). Chaque contrôle laisse soit une vraie donnée que tu gardes (un add-on, ses prix, ses interrupteurs), soit rien.

#### 1. Le catalogue : un service, la gravure, un add-on avec stock

1. **Un service.** `Catalogue` → `Add-ons` → `New add-on` : `Type` `SERVICE` (le champ `Supplier` disparaît), `Name` `GIFT WRAPPING`, `Line` ta phrase si tu veux, `SKU code` `ADD-GIFT-WRAPPING`, `Price in EUR` ton prix (15 par exemple), les quatre interrupteurs laissés cochés. `Add` : « Add-on added. » Sa ligne lit `SERVICE`, `No stock`, et LIVE, DRAW, SALON, YOUR ORDERS. Si la conversion a déjà fait un GIFT WRAPPING, prends-le tel quel.
2. **Jamais en stock.** `Logistics` → `Stock`, section `Add-ons` : GIFT WRAPPING n'y est pas, et le texte de la section le dit : « A service, such as the engraving, has no stock: it is never listed here. » Dans `Supplier orders`, aucune proposition ne le nomme, et un service n'a jamais de fournisseur : aucune commande fournisseur ne peut le porter.
3. **La gravure.** Sur la ligne ENGRAVING (« ENGRAVING · 20 characters at most ») : `Edit`, `Price in EUR` ton prix (30 par exemple), `Offered at the purchase in a LIVE RELEASE` et `In YOUR ORDERS, until packing begins` cochés, `Most characters` `20` (ou ton choix, §2), puis `Save` : « Add-on saved. » Sa marque suit le nombre. Sans ligne ENGRAVING (rien à convertir), crée-la : `New add-on`, `Type` `SERVICE`, `Name` `ENGRAVING`, `SKU code` `ADD-ENGRAVING`, `The engraving` coché, `Most characters`, son prix et ses interrupteurs, `Add`.
4. **Un add-on avec stock** : un de tes add-ons de M3 (celui de sa vérification, par exemple), avec au moins **deux** unités à l'entrepôt de la sortie d'essai (`Logistics` → `Stock`, section `Add-ons`) : sans unité, la ligne n'est pas proposée sur l'écran 5b.

#### 2. Une LIVE RELEASE d'essai qui choisit GIFT WRAPPING, ENGRAVING et un add-on avec stock

La sortie d'essai est **visible de tous** dans THE RELEASES et la bannière pendant une heure environ, puis pour toujours dans PAST et sur la fiche du modèle d'essai, avec son titre, le nom et la photographie du modèle d'essai et « 2 PIECES » : fais-la à une heure creuse. Seuls les propriétaires du modèle d'essai peuvent y entrer.

**La préparation, dans la console :**

1. `Club`, section `Drops` → `New live release` : `Model` le modèle d'essai, `Title` `TEST ADD-ONS`, `Opening (UTC)` dans 30 minutes environ, `End of the sales (UTC)` une heure après, `People per batch` `2`, `Every (minutes)` `1`, `Hold after the opening (minutes, 0 = none)` `0`, `Price of a piece` `1`, `Currency` `EUR`, `Sizes` `52 = 2`. Sous `Add-ons offered`, les add-ons proposés en LIVE avec un prix en EUR sont déjà cochés (N7) ; ceux qui ne peuvent pas l'être sont grisés avec leur raison (« Not offered in a LIVE RELEASE », « No price in EUR »). Décoche tout sauf GIFT WRAPPING, ENGRAVING et ton add-on avec stock. `Create release`.
2. Sur sa page, la partie `Add-ons` lit les trois, chacun avec son prix. `Access` → `Edit` : `Owners of <le modèle d'essai>` coché, rien d'autre. `Times (UTC)` → `Edit` : `Room opens (minutes before)` `15`. Puis `Publish`. Après l'annonce, la partie `Add-ons` ne change plus.
3. Sur B, avant d'entrer : YOUR ACCOUNT, LIGHT MODE (sous SOUND) allumé.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| Le tour | A, puis B | La sortie : ENTER THE ROOM, la taille `52` ; attendre T0 | La file, puis à T0 le tour de chacun (deux pièces, un lot de deux) : tiens le sceau |
| L'écran 5b, téléphone, sombre | A | Regarder | SECURED, YOUR PIECE, SECURED AT, le nom, SIZE 52, puis ADD-ONS : trois lignes entre des filets, chacune son anneau, son nom, « + € 15 » à droite et sa ligne dessous ; « Added to your order at PAY, while available. » sous les lignes (l'add-on avec stock) ; PAY avec le total et le temps dans sa lumière (« PAY € 1 · 04:52 » par exemple). Tu as 5 minutes |
| Choisir, YOUR TEXT | A | Toucher GIFT WRAPPING, puis ENGRAVING ; taper `M. B.` dans YOUR TEXT | L'anneau s'allume en point, le filet de la ligne s'éclaire ; sous ENGRAVING, YOUR TEXT et son compte « 5 / 20 » (le nombre de `Most characters`) ; PAY lit le nouveau total (« PAY € 46 · 04:20 » avec 15 € et 30 €) |
| Des mots refusés | A | Ajouter `#` aux mots, quitter le champ | « Up to 20 characters: letters, figures, spaces and . & ’ - » ; la ligne reste choisie. Enlève le `#` |
| L'add-on avec stock | A | Le toucher | Le total monte de son prix |
| L'écran 5b, ordinateur, clair | B | Regarder, puis toucher GIFT WRAPPING seulement | La salle reste sombre en mode clair ; en bas à droite, ADD-ONS et ses lignes au-dessus de PAY (PAY passe d'abord seulement si les lignes le pousseraient sous le premier écran) ; au survol, l'anneau s'éclaire, sans plaque ; le même total dans PAY |
| CONFIRMED et son reçu | A, puis B | PAY | CONFIRMED ; le reçu lit chaque add-on choisi avec son prix, puis TOTAL. Les deux pièces payées : la sortie est vendue en entier, puis finie |
| La console | Console | `Orders`, la commande de A, sa page | `Add-ons` : GIFT WRAPPING avec `Service`, jamais un entrepôt, et ton add-on avec stock à son entrepôt, chacun `HELD` ; `Engraving` : `M. B. · € 30` et, dessous, son unité ENGRAVING |
| YOUR ORDERS, la gravure achetée | A | MY PIECES → ORDERS, la commande | ADD-ONS : GIFT WRAPPING et ton add-on, REMOVE sur chacun ; ENGRAVING : `« M. B. »`, CHANGE THE ENGRAVING et « Your engraving was bought with your order. », jamais REMOVE THE ENGRAVING. ADD AN ADD-ON ouvre la feuille : les add-ons proposés dans YOUR ORDERS, jamais ENGRAVING |
| Une release finie, pas encore en colisage | B | MY PIECES → ORDERS, la page de la commande | La sortie est finie, et pourtant ADD AN ADD-ON propose toujours les add-ons, et ENGRAVING propose ADD AN ENGRAVING, comme aujourd'hui. ADD AN ENGRAVING, `J.M.`, SAVE : `« J.M. » · + € 30` ; puis REMOVE THE ENGRAVING : la gravure part, ajoutée dans YOUR ORDERS, elle se retire |

**Le nettoyage** : les deux commandes de 1 €, chacune dans `Orders`, sa page, `Cancel`, la boîte « Cancel the order », `Note` `Test`, puis `Cancel the order` : « Order cancelled. ». Les unités de ton add-on avec stock reviennent au stock. La sortie d'essai reste dans la base et dans PAST.

#### 3. Une release à tirage qui n'en choisit qu'un (un brouillon, jamais publié)

1. `Club`, section `Drops` → `New release` : `What it sells` `A model`, `Model` le modèle d'essai, `Next`. Dans la seconde boîte, `Title` `HOUSE CHECK`, `Price` `1`, `Currency` `EUR`, une pièce dans une taille. `Create release` : « Release created as a draft. »
2. Sa partie `Add-ons` → `Edit` : `Add-ons offered`, les add-ons proposés à un tirage cochés. Décoche tout sauf GIFT WRAPPING, puis `Save` : « Add-ons saved. » La partie ne lit que GIFT WRAPPING et son prix.
3. **N'appuie jamais sur `Publish`.** `Cancel` : tape la phrase que la boîte demande, puis `Cancel release` : « Release cancelled. »

#### 4. Le salon, par son interrupteur

Dans THE PRIVATE SALON, sur A, un modèle réservé avec un prix : ADD TO YOUR ORDER liste GIFT WRAPPING et ton add-on avec stock (ENGRAVING seulement si son interrupteur du salon est allumé). N'envoie pas de demande. Dans la console, GIFT WRAPPING, `Edit` : décoche `Offered at the purchase in the private salon`, `Save`. Recharge le salon : GIFT WRAPPING n'y est plus. Recoche-le si tu le veux au salon. Sans modèle réservé avec un prix, garde ce point pour plus tard.

#### 5. La liste de colisage

Sur le prochain vrai colis d'une commande qui porte des add-ons, dans `Logistics` → `To ship`, la page du colis, `Packing` : une ligne par add-on, « Add-on: GIFT WRAPPING × 1 » par exemple, un service compris ; la gravure a sa ligne « Engraving done: "M. B." ». Sans colis à faire le jour même, garde ce point pour le prochain.

#### 6. L'export produits Shopify

`Catalogue` → `Shopify export`, `The store’s currency` `EUR`, `Download` : le fichier `ORBES-shopify-products-EUR-<jour>.csv`. Ouvre-le : la ligne de GIFT WRAPPING, `Type` `Add-on`, `SKU` `ADD-GIFT-WRAPPING`, son prix, `Weight value (grams)` vide et `Requires shipping` `false` ; ton add-on avec stock, `Requires shipping` `true`. Rien n'est envoyé à Shopify.

#### 7. Les pages légales

Sur ton téléphone, PRIVACY et TERMS au pied de page : « Version of 25 October 2026 » sous le titre ; dans les conditions, article 13, le paragraphe « Your piece. », et article 14, les paragraphes « Delivery. » et « Add-ons. ».

### 1.8 Ensuite : tes données

Dans cet ordre, quand tu veux :

1. **Tes add-ons convertis** : `Catalogue` → `Add-ons`, chacun avec « Converted from… ». Garde-les, change leur ligne, leurs prix et leurs interrupteurs, ou mets de côté ceux que tu ne veux plus (`Set aside`) ; un add-on qui devrait avoir du stock se crée à nouveau `WITH STOCK`, son type ne changeant pas (§2).
2. **Les interrupteurs et les prix de chaque add-on** : où il est proposé (LIVE, DRAW, SALON, YOUR ORDERS), et un prix dans chaque devise où tu le vends.
3. **La gravure** : son prix, ses interrupteurs, son nombre de caractères (`Most characters`, §2).
4. **Le choix de chaque release à venir** : `Add-ons offered`, d'une LIVE RELEASE jusqu'à son annonce, d'un tirage tant qu'il est un brouillon.
5. **Les identifiants Shopify** de chaque add-on, services compris, plus tard, le jour de la boutique (`Shopify` sur sa ligne).
6. **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1).
7. **Les anciennes images (facultatif).** Une fois ADD-ONS stable, `7098341f83f2` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_Q2>`), la liste d'abord :

   ```bash
   docker images orbes-genome
   ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **Une par pièce sur l'écran 5b** (N1). Une ligne touchée prend un add-on par pièce (un par set), comme les add-ons de release étaient comptés ; deux ou trois du même add-on s'ajoutent dans YOUR ORDERS jusqu'à l'emballage. On garde, ou un sélecteur sur la ligne choisie ?
2. **Le nombre de caractères de la gravure** (N3). Il se règle sur l'add-on ENGRAVING (`Catalogue` → `Add-ons`, `Most characters`, de 1 à 20). La gravure convertie garde les 20 de la maison, comme YOUR ORDERS aujourd'hui ; la maquette montrait 12 (« 5 / 12 »), le chiffre de sa démonstration. Mets 12 sur ENGRAVING si tu veux celui de la maquette.
3. **Les add-ons convertis, à garder ou à mettre de côté** (N6). La conversion les fait `SERVICE` (ils n'avaient jamais de stock), proposés en LIVE seulement, au prix de leur release la plus récente ; la gravure aussi dans YOUR ORDERS quand les Réglages avaient un prix. Tu les vois sur le tableau de revue avant le déploiement ; après, tu les gardes, les changes ou les mets de côté (§1.8).
4. **Le choix par défaut d'une nouvelle release** (N7) : chaque add-on actif dont l'interrupteur du moment est allumé et qui a un prix dans sa devise, coché au départ ; tu décoches. Ou rien de coché au départ, si tu préfères.
5. **L'avocat** : les phrases des add-ons des articles 13 et 14 partent avec la version `2026-10-25` (la note au juriste, point 36). Sa réponse ne retient pas le déploiement.
