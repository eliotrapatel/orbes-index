# Mise en production du lot M4 (la marge, les expériences partenaires, les conversions)

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot M4 de tes décisions du 20 octobre (macro scope : K43, la marge sur GROWTH ; K49, les expériences payées par un partenaire ; K27, les conversions publicitaires vers Meta, TikTok et Google, construites et éteintes), reconstruit sur ONE QUEUE, ses compléments et THE VAULT (le coût des coffres compté dans la marge, D61), part en production en **un seul déploiement**, après celui de THE VAULT ([son runbook](DEPLOY-OQ-Q3.md)). Allumer les conversions est un autre jour, plus tard, sur ta décision (§2) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| M4 (la marge, les partenaires, les conversions éteintes) | La marge de GROWTH en euros, par modèle, par canal et par palier, jamais par sortie, avec le coût de THE VAULT (N1 à N3, D61) ; ses réglages, que tu remplis (Margin settings) ; les partenaires, leurs expériences et leurs factures dans leur propre série, P- et PC- (P1, P4) ; WITH <BRAND> sur l'invitation d'un partenaire et la case SHARE MY NAME d'un invité, sur téléphone et ordinateur, en mode sombre et en mode clair (P2, P3) ; les conversions vers Meta, TikTok et Google, **construites et éteintes** (A1 à A5) ; un paragraphe de la politique de confidentialité (P3, L2) | `0063_margin`, `0064_partners`, `0065_ad_conversions` | aucun | **À faire** (§1) |
| Les conversions allumées | Les clés des plateformes, le bandeau de consentement, ADVERTISING MEASUREMENT, la section *Advertising measurement* de la politique de confidentialité (A4, A5) | aucune | les dix lignes `ADS_*` de `compose.yaml` et la route de l'application vers quatre hôtes, convenues d'abord avec le responsable de l'hôte | **Plus tard, sur ta décision** (§2) |

Le point de départ : la production tourne THE VAULT (lot Q3), son commit `<SHA_Q3>` (image `orbes-genome:<TAG_Q3>`, déployée le <jour> à <heure> à Paris (<heure> UTC)), avec les 63 migrations de `0001_initial` à `0062_vault_rewards`. **M4 ne part qu'après Q3** : ses migrations s'appuient sur `0062_vault_rewards`, et la marge compte ce que THE VAULT coûte. Avant le jour, Claude remplace dans ce document `<SHA_Q3>` et `<TAG_Q3>` par le commit de Q3 en production (40 caractères) et ses 12 premiers caractères (le tag de son image), et `<SHA_M4>` et `<TAG_M4>` par le commit final de M4 et ses 12 premiers caractères (le tag de la nouvelle image) : **une commande qui contient encore une de ces marques ne se lance pas**. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `<TAG_Q3>` (un correctif après Q3, ou un autre lot déployé avant), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer. Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les écrans d'abord.** Avant la fusion, tu regardes les captures que te donne le rapport de Claude (§1.1) : chaque écran nouveau du collectionneur, sur téléphone et sur ordinateur, et les pages nouvelles de la console. Tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Les heures** : jamais entre 04:00 et 06:30 à Paris (03:00–05:30 UTC), ni pendant les minutes de sauvegarde du hub : 03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC); Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026. La première plage est celle des sauvegardes de nuit du serveur partagé. Chaque heure de ce document est d'abord celle de Paris, l'heure UTC entre parenthèses.
3. **Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.** Le redémarrage couperait la salle, la file et les tours en cours. Tu déploies quand aucune LIVE RELEASE n'a sa salle ouverte, ni ne l'ouvre dans l'heure (le pré-contrôle du §1.1 le lit), et quand aucun test de TEST ENTRANTS ne tourne.
4. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les trois conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé, tu lances quand tu veux hors des heures des règles 2 et 3, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
5. **Rien ne change sur l'hôte** : ni Caddyfile, ni port, ni variable, ni certificat, ni `compose.yaml`, ni limite, ni minuterie, ni volume, ni réseau. Ton `.env` ne gagne aucune ligne : les clés de Meta, TikTok et Google attendent le jour où tu allumes les conversions (§2), et l'application n'a toujours aucune route vers ces plateformes.
6. **Trois migrations, puis plus de retour en arrière** : après `0063_margin`, `0064_partners` et `0065_ad_conversions`, l'image `<TAG_Q3>` ne tourne plus sur le schéma (`deploy.sh --image <TAG_Q3>` la refuse). En cas de souci, on **répare en avant** (§1.5).
7. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
8. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
9. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-m4` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
10. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche. Le jour de l'activation, les clés des plateformes sont entrées par toi dans le `.env` du serveur, jamais dans le chat (§2).
11. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
12. **Les conversions restent éteintes** : rien n'est capté, mis en file, envoyé ni montré. Aucun bandeau, aucune ligne ADVERTISING MEASUREMENT, aucun identifiant de clic lu dans une adresse. Les allumer est une décision à part (§2).
13. **Les pages légales changent** : la politique de confidentialité, un seul paragraphe (le nom qu'un invité partage avec un partenaire, dans *Your answers and votes in the circle*), en anglais et en français, dans une seule nouvelle version, `2026-10-27` ; le texte des conditions ne change pas (leur ligne de version suit). Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La section *Advertising measurement* est préparée et cachée : elle n'apparaît qu'avec l'interrupteur (§2). La relecture par un avocat ne retient jamais le déploiement.

---

## 1. Le déploiement

### 1.0 Ce qui change

**En mots simples**

- **La marge, sur GROWTH** (N1 à N3). Ce que chaque vente payée de la période rapporte et ce qu'elle coûte, **en euros**, par modèle, par canal (LIVE, DRAW, SALON, VAULT, ELSEWHERE) et par palier au moment du paiement, **jamais par sortie**. Le revenu est compté avant les crédits ; les coûts sont le prix fournisseur de la pièce, son expédition entrante, la boîte, la pochette et la carte, l'expédition sortante (une grille par pays et par poids que tu règles), une provision par catégorie pour les retours et les garanties, les avantages des paliers, PRIVATE CARE et la garantie. Une commande retournée ou annulée n'est pas comptée. Une pièce pas encore emballée est estimée, et la marge le dit.
- **Ses réglages** (Margin settings) : un taux en euros par devise, les tranches d'expédition, les coûts de la pochette (POUCH), de la carte (CARD) et de THE VAULT CARD, la provision de chaque catégorie, le coût d'un service PRIVATE CARE et de chaque issue d'une garantie. **Rien n'est prérempli** : ce qui manque compte pour 0 et est nommé dans *What is missing*.
- **THE VAULT dans la marge** (D61). Sa colonne en cinq parts : les crédits gagnés utilisés, les crédits à offrir utilisés, les compléments offerts, les produits gagnés (une commande `Vault` à 0 : sa pièce, son expédition entrante, sa boîte, sa pochette, sa carte et son expédition) et THE VAULT CARD. Une commande à 0 est une ligne du canal VAULT sans revenu ; un droit d'achat est une vente. La ligne THE VAULT montre aussi le coût des récompenses gagnées selon le rapport de THE VAULT, qui reste tel qu'il est.
- **Les expériences partenaires** (P1, P2, P4). Une marque paie ORBES pour une expérience offerte au cercle : son partenaire, son expérience, l'invitation du cercle qui la porte (ouverte comme THE PROGRAM le dit, PALLADIUM par défaut), sa facture émise par ORBES dans sa propre série (`P-2026-0001`, son avoir `PC-2026-0001`), jamais modifiée, payée par virement, hors de la plateforme. Ce que les partenaires paient apparaît sur GROWTH, à côté du revenu, jamais dedans.
- **Le nom d'un invité** (P3). Sur l'invitation d'un partenaire, le collectionneur lit WITH <BRAND> ; une fois son YES donné, la case SHARE MY NAME, <NAME>, WITH <BRAND>, décochée par défaut, qu'il peut décocher jusqu'au début de l'événement. Sans elle, le partenaire ne reçoit que le nombre d'invités. ORBES télécharge la liste et l'envoie : la plateforme n'envoie rien à un partenaire.
- **Les conversions publicitaires, construites et éteintes** (A1 à A5). Le jour où tu les allumes (§2), la création d'un compte, l'inscription à un tirage, l'entrée dans une LIVE RELEASE et une commande payée partent du serveur vers la seule plateforme d'où le collectionneur est venu, et seulement après son accord dans un bandeau. Aujourd'hui : rien.
- **Ce qui ne change pas** : la file, les tours et les sons de ONE QUEUE ; les compléments de Q2 ; THE VAULT de Q3 et son rapport ; les écrans d'aujourd'hui (un collectionneur ne voit rien de nouveau tant qu'aucune invitation n'est liée à une expérience et que les conversions sont éteintes) ; l'hôte.

**Pour le personnel (la console)**

- **`Growth`, la section `Margin`** : Revenue, Costs, Margin et Margin %, puis `By model` · `By channel` · `By tier` avec les parts des avantages (PERKS) et de THE VAULT, la ligne THE VAULT et son lien `THE VAULT’s report`, `What is missing`, `Download CSV` et `Margin settings`. Tout le monde qui lit Growth la lit.
- **`Margin settings`** : Currencies, Outbound shipping, Packaging (POUCH, CARD, THE VAULT CARD), Returns and claims allowance, PRIVATE CARE and warranty. Un **ADMIN seul** les change.
- **`Club`, onglet `Circle`, `Partners`** : les partenaires, chacun sa page et ses expériences ; une expérience avec ses invitations, `Issue the invoice`, `Record payment`, `Cancel the experience` et `Guests for the partner`. Un OPERATOR enregistre les partenaires et les expériences et lit les noms des invités ; un **ADMIN** émet la facture, note le paiement et annule une expérience facturée (son avoir émis avec). Les onglets du Club ne changent pas.
- **La boîte d'une invitation du cercle** : le champ `Partner experience`, quand l'expérience est `Partner experience` ; la page de l'invitation gagne sa ligne `Partner experience` et, dans ses réponses, SHARES NAME.
- **`Invoices`** : `Issued to`, `Collectors` par défaut, ou `Partners` (les P- et PC- du mois, leurs PDF et leur CSV). **`Growth`** gagne aussi `Partner experiences`.
- **`Links` → `Ad platforms`** : l'interrupteur (`CONVERSIONS: OFF`), chaque plateforme avec `KEYS PRESENT` ou `KEYS MISSING` (jamais une clé), les canaux associés, les actions de conversion de Google, les choix du mois, les événements. `SWITCH ON` est un **ADMIN seul**, la phrase tapée.

**Pour le serveur**

- **La marge se lit, elle n'écrit rien** : elle compte à partir des commandes, des factures, des commandes fournisseur, des colis et de tes réglages.
- **Une facture de partenaire** prend le numéro suivant de sa série sous un verrou, n'est jamais modifiée ni effacée ; une expérience annulée après sa facture reçoit son avoir dans la même opération.
- **Les conversions** ont un seul client sortant, vers quatre hôtes fixes (`graph.facebook.com`, `business-api.tiktok.com`, `googleads.googleapis.com`, `oauth2.googleapis.com`), en https seulement. Sans clés, aucun envoi ne démarre ; éteintes, rien n'est mis en file.
- **Shopify, plus tard** (S1 à S7) : la marge, une facture de partenaire et un événement de conversion se lisent un pour un avec une boutique de la plateforme ; une commande venue de Shopify ne part jamais comme conversion.

**Les migrations**, appliquées dans **une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `<TAG_Q3>`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0063_margin` | N1, N2, D61 | les taux en euros (`currency_rates`, l'euro refusé), les tranches d'expédition sortante (`shipping_cost_rates`, par pays ou ALL OTHER COUNTRIES), les coûts unitaires (`margin_unit_costs` : POUCH, CARD, THE VAULT CARD, un service PRIVATE CARE, chaque issue d'une garantie), les provisions par catégorie (`category_allowances`) ; toutes vides |
  | `0064_partners` | P1 à P4 | les partenaires (`partners`), leurs expériences (`partner_experiences`), leurs factures et leurs avoirs dans leur propre série (`partner_invoices`), le lien d'une invitation à une expérience (`circle_posts.partner_experience_id`, nulle part), le nom partagé d'un invité (`circle_rsvps.share_name`, décoché partout, et `share_name_at`) ; toutes vides |
  | `0065_ad_conversions` | A1, A3, A4 | l'interrupteur (`ads_settings`, sans ligne : éteint), les canaux associés à une plateforme (`ads_channel_platforms`), les choix des collectionneurs (`ad_consents`), les identifiants de clic (`ad_clicks`), les événements à envoyer (`ad_events`) ; toutes vides |

  L'application est arrêtée pendant les migrations. Une fois appliquées, on ne revient plus en arrière (ci-dessous). Elles n'ajoutent que des tables et des colonnes : aucune donnée d'aujourd'hui ne change.

- **Les variables** : aucune nouvelle. Ton `.env` ne change pas. Les dix variables `ADS_*` des plateformes attendent le jour de l'activation (§2).
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. Caddy n'est pas recréé. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `<TAG_Q3>` ne peut plus tourner sur ce schéma. `deploy.sh --image <TAG_Q3>` la refuse.

### 1.1 Avant : tes écrans, tes chiffres, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Tes écrans d'abord** (règle 1). Aucune maquette n'existait pour M4 : chaque écran suit ceux de l'application et de la console. Les captures, au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair : l'invitation d'un partenaire avec WITH <BRAND> (sa page, sa carte dans NOW et dans le fil du cercle), la case SHARE MY NAME et chacun de ses états (décochée, cochée, sans nom au compte, réponses closes, l'envoi, l'erreur) ; le bandeau de consentement et la ligne ADVERTISING MEASUREMENT, vus conversions allumées sur des données d'essai (au déploiement, ils restent cachés) ; la politique de confidentialité avec le paragraphe partenaire, et sa section préparée. Dans la console : `Growth` (Margin, Partner experiences), `Margin settings`, `Partners`, la page d'un partenaire et celle d'une expérience, `Invoices` → `Partners`, `Links` → `Ad platforms`. Le rapport de Claude te liste aussi tous les mots nouveaux, puisqu'aucune maquette ne les avait, et ses lectures (§3).

Sans ton accord, rien n'est fusionné ni déployé.

**2. Tes chiffres, à préparer.** Après le déploiement, les réglages de la marge sont vides (§1.8) : prépare le taux en euros de chaque devise où tu vends (GBP, USD, CHF…), ce que le transporteur te coûte pour un colis par pays et par poids (au moins ton pays principal et le reste du monde), le coût d'une pochette, d'une carte et d'une THE VAULT CARD, la provision de chaque catégorie (en %), le coût d'un service PRIVATE CARE et de chaque issue d'une garantie.

**3. Ce qui doit être réglé avant le jour** :

- **THE VAULT est en production**, au commit `<SHA_Q3>` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** entre l'ouverture de sa salle et sa fin, ni dont la salle ouvre dans l'heure (règle 3 ; le point 10 le lit), et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §0 « Les expériences partenaires » (qui est invité, ce que le partenaire reçoit : le nombre d'invités, et les noms de ceux qui ont coché seulement ; ORBES envoie la liste). La partie « Meta, TikTok et Google » ne vaut qu'à partir du jour de l'activation (§2).

**4. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-m4>. Le dernier passage de `genome-ci` sur `<SHA_M4>` doit avoir une coche verte (ses quatre parties). Sinon, n'avance pas. Si l'une des quatre parties a pris plus de 42 de ses 45 minutes, dis-le à Claude : la session principale décide de sa limite, ce lot ne change pas la CI.

**5. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 9) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_M4>` exactement, comme pour Q3. Claude te donne la commande dans son rapport ; il ne la lance pas.

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

Sortie attendue : une heure hors de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche), et hors des minutes de sauvegarde du hub (règle 2).

**8. Le pré-contrôle.** Note les six résultats : tu les compareras avec ceux d'après, et tu les envoies au responsable de l'hôte. Le diff de `deploy/vps` et les migrations déjà appliquées se lisent au §1.3, une fois le commit récupéré.

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

Sortie attendue : `<SHA_Q3>` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=<TAG_Q3>`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_Q3> OK (previous 5e0518fe53cd; migrations 0061_the_vault, 0062_vault_rewards)` : THE VAULT est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

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

Sortie attendue : **exactement `<SHA_M4>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating <7 caractères de SHA_Q3>..<7 caractères de SHA_M4>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_M4>`.

**Rien ne change dans la pile du serveur** (deuxième condition ; règle 5), contre le commit de Q3 en production :

```bash
git -C /opt/orbes/orbes-index diff --name-status <SHA_Q3> HEAD -- deploy/vps
```

Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.

**Les migrations, et elles seules** (règle 6) :

```bash
git -C /opt/orbes/orbes-index diff --name-status <SHA_Q3> HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces trois lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0063_margin.ts
A	genome/src/server/db/migrations/0064_partners.ts
A	genome/src/server/db/migrations/0065_ad_conversions.ts
```

**La version des pages légales** (règle 13) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-27';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

**Une lecture sans risque** :

```bash
bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'
```

Sortie attendue : 63 lignes, de `0001_initial` à `0062_vault_rewards` ; les deux dernières :

```text
0061_the_vault
0062_vault_rewards
```

Une liste qui s'arrête avant `0062_vault_rewards` : Q3 n'est pas en production, arrête-toi.

### 1.4 Déployer

Hors des heures des règles 2 et 3. **Juste avant**, relance la première requête du §1.1, point 10 (aucune salle ouverte, aucune qui ouvre dans l'heure) : `0`, sinon attends.

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()"'
```

**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement M4 lancé à <heure> Paris (<heure> UTC), trois migrations, rien ne change sur l'hôte. » Ajoute-y l'image, `orbes-genome:<TAG_M4>`, et les six résultats du pré-contrôle (§1.1, point 8).

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_M4> (tag <TAG_M4>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (la même configuration, validée) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_M4>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: <TAG_Q3>
   ```

   Un `ERROR: … fix … (or the Caddyfile) first: nothing was changed` à la place de `Caddy configuration valid` : le site tourne toujours sur `<TAG_Q3>`. Colle la sortie à Claude.

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 63 migration(s) applied, all known to orbes-genome:<TAG_M4>
   ```

   **Il faut lire `63 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `<TAG_Q3>`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M4>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M4>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_M4>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_M4>
   Applied 3 migration(s): 0063_margin, 0064_partners, 0065_ad_conversions
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 3 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) ; Caddy garde son conteneur, sa configuration n'ayant pas changé.

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
   … [deploy.sh] deployed orbes-genome:<TAG_M4> (previous: <TAG_Q3>). This release applied the migration(s) 0063_margin, 0064_partners, 0065_ad_conversions:
   … [deploy.sh] orbes-genome:<TAG_Q3> cannot run on this schema any more (scripts/deploy.sh --image <TAG_Q3> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M4> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
   ```

   Puis :

   ```bash
   echo $?
   ```

   Sortie attendue : `0`. Si `pgrep` a trouvé une sauvegarde, tu as lu sa ligne `<numéro> pg_dump …` et rien d'autre : rien n'a été déployé, relance plus tard.

### 1.5 Si quelque chose ne va pas

Ne lance rien d'autre que les commandes de ce paragraphe, et colle à Claude la sortie complète de `deploy.sh`. Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant. Les migrations elles-mêmes ne se défont pas : le `down` de `0065_ad_conversions` refuse dès que l'interrupteur est allumé ou qu'un choix, un identifiant de clic ou un événement existe, celui de `0064_partners` dès qu'un partenaire, une expérience, une facture de partenaire, une invitation liée à une expérience ou un nom partagé existe, et celui de `0063_margin` dès qu'un taux, une tranche d'expédition, un coût unitaire ou une provision existe.

| Ce que tu lis | Ce que ça veut dire | Ce que tu fais |
|---|---|---|
| Une ligne `<numéro> pg_dump …`, et rien de `deploy.sh` | Une sauvegarde tournait : rien n'a démarré. | Attends sa fin (`pgrep -a pg_dump` ne répond plus rien), puis relance la commande gardée du §1.4. |
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `<TAG_Q3>`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur de `db migrate`, puis `── rollback to orbes-genome:<TAG_Q3>` et `rolled back to <TAG_Q3>; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `<TAG_Q3>`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to <TAG_Q3> is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_M4> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `<TAG_Q3>`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_M4>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, les conversions restent `OFF`, un réglage de la marge se corrige ou s'efface dans `Margin settings` (`Edit`, `Clear`, `Remove`), une expérience encore en brouillon s'annule (`Cancel the experience`) et son invitation reste un brouillon ; jamais rien par la base. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image <TAG_Q3>`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_M4> OK (previous <TAG_Q3>; migrations 0063_margin, 0064_partners, 0065_ad_conversions)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 66 lignes `applied`, de `0001_initial` à `0065_ad_conversions`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que les migrations ont écrit**, en lecture seule : rien. Les réglages de la marge (taux, tranches, coûts unitaires, provisions) :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from currency_rates), (select count(*) from shipping_cost_rates), (select count(*) from margin_unit_costs), (select count(*) from category_allowances)"'
```

Sortie attendue : `0|0|0|0`.

Les partenaires, leurs expériences, leurs factures, les invitations liées et les noms partagés :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from partners), (select count(*) from partner_experiences), (select count(*) from partner_invoices), (select count(*) from circle_posts where partner_experience_id is not null), (select count(*) from circle_rsvps where share_name)"'
```

Sortie attendue : `0|0|0|0|0`.

Les conversions : l'interrupteur sans ligne (éteint), aucun canal associé, aucun choix, aucun identifiant de clic, aucun événement :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from ads_settings), (select count(*) from ads_channel_platforms), (select count(*) from ad_consents), (select count(*) from ad_clicks), (select count(*) from ad_events)"'
```

Sortie attendue : `0|0|0|0|0`.

**La console** (sur ton ordinateur, en ADMIN) :

- `Growth` : la section `Margin`, avec Revenue, Costs, Margin et Margin %, et `By model` · `By channel` · `By tier` ; ses montants ne sont pas encore justes, puisque rien n'est réglé : `What is missing` le dit, « Counted as 0 until it is entered. », puis chaque manque et où le régler. La ligne THE VAULT est là (sauf si la période n'a ni commande payée ni coffre), avec `THE VAULT’s report`. Plus haut, `Partner experiences` : « No partner invoice in this window. »
- `Margin settings` (le lien de la section) s'ouvre : `Outbound shipping` lit « No band yet. Add one for your main country and one for ALL OTHER COUNTRIES. » ; sous `Packaging`, POUCH, CARD et THE VAULT CARD, chacun `Not set`.
- `Club`, onglet `Circle`, `Partners` : « No partner yet. »
- `Links` → `Ad platforms` : `CONVERSIONS: OFF`, « Conversions are off. Nothing is captured or sent, and collectors see no banner. », et Meta, TikTok et Google, chacun `KEYS MISSING`.
- **Ce qui ne change pas** : `Club`, onglet `THE VAULT`, comme avant le déploiement (la table, `Sources`, le rapport) ; la page d'une LIVE RELEASE et sa section `THE VAULT` ; `Catalogue` → `Add-ons`.

**L'application** : `/verify` s'ouvre sans aucun bandeau, sur téléphone et sur ordinateur. `/legal/privacy` montre la nouvelle date, « Version of 27 October 2026 », et le paragraphe partenaire (§1.7, point 5), sans section *Advertising measurement*.

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

**Les conversions, éteintes**, comme l'application les lit (rien n'est écrit, aucun cookie posé) :

```bash
curl -s https://verify.theorbes.com/api/v1/consent
```

Sortie attendue : `{"ads":{"on":false,"choice":null,"textVersion":"2026-10-26","since":null}}`. `"on":true` : arrête-toi et colle la sortie à Claude.

**Les sons, toujours servis en `/assets/*.mp3`** (ONE QUEUE et THE VAULT inchangés) : la commande lit l'application publiée, y trouve chaque son, puis le télécharge.

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
curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\.js' | head -1)" | grep -o '2026-10-27' | head -n 1
```

Sortie attendue : `2026-10-27`. Rien : colle la sortie à Claude.

**Préviens le responsable de l'hôte** : « M4 fait à <heure> Paris (<heure> UTC), trois migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN ; dans l'application, **A**, ton propre compte, sur ton téléphone (Safari), et **B**, un compte de collectionneur actif, sur ton ordinateur, dans une fenêtre de navigation privée (la console reste dans la fenêtre normale). Chaque contrôle laisse soit une vraie donnée que tu gardes, soit rien.

#### 1. La marge : tes vrais réglages

Dans `Growth` → `Margin settings`, avec les chiffres préparés (§1.1, point 2). Chacun est une vraie donnée, que tu gardes.

1. `Currencies` → `Set a rate` : `Currency` `GBP`, `One unit in euros` ton taux, puis `Save` : « Rate saved. » La ligne lit « 1 GBP = <ton taux> EUR ». De même pour `USD` et `CHF`.
2. `Outbound shipping` → `Add a band` : `Country` `France`, `Up to, in grams` (par exemple `500`), `Cost`, `Currency` `EUR`, puis `Save` : « Band added. » Puis une tranche pour `ALL OTHER COUNTRIES`, de la même façon.
3. `Packaging` : sur POUCH, `Set` : `Cost`, `Currency`, puis `Save` : « Cost saved. » De même pour CARD et THE VAULT CARD.
4. `Returns and claims allowance` : sur une catégorie, `Set` : `Allowance (%)`, puis `Save` : « Allowance saved. »

#### 2. La marge d'une vraie commande

1. `Growth`, la section `Margin`, `By model` : choisis un modèle qui n'a qu'une commande payée dans la période. Vérifie sa ligne à la main : le revenu, celui de sa facture avant les crédits ; ses coûts, le prix fournisseur de sa pièce (sa commande fournisseur), sa part de l'expédition entrante, sa boîte, POUCH et CARD, la tranche de son pays et de son poids, la provision de sa catégorie. Une différence : note-la et dis-la à Claude.
2. `By channel` : la commande dans la ligne de son canal.
3. La ligne THE VAULT : « Products won, claimed (VAULT orders at 0) », « Vault credits used », « Credits to give used », « Free add-ons given », « THE VAULT CARDs packed », « Guaranteed pieces: each is bought at its price, so it costs nothing here. », puis « The report’s cost of the rewards won » ; `THE VAULT’s report` ouvre `Club`, onglet `THE VAULT`.

#### 3. Les partenaires, au premier vrai accord

Un partenaire ne s'efface jamais (on le met de côté), une expérience non plus : fais ce point avec ton premier vrai partenaire. Sans accord le jour même, garde ce point pour le premier.

1. `Club`, onglet `Circle`, `Partners` → `New partner` : `Brand`, `Contact`, `Email`, `Phone`, `Billing name`, `Billing address`, `Billing country`, `Company number`, `Note`, puis `Create partner` : « Partner created. » Sa page s'ouvre.
2. `New experience` : `Title`, `Event (Paris)`, `Amount`, `Currency`, `Note`, puis `Create experience` : « Experience created. » Son état : `Draft`. Rien n'est facturé.
3. `Club`, onglet `Circle`, `New invitation` : `Experience` `Partner experience`, puis le champ `Partner experience` : l'expérience, « <BRAND> · <TITRE> · <JOUR> », puis `Create invitation`. L'invitation reste un **brouillon** : ne la publie pas maintenant. Sa page lit la ligne `Partner experience`.
4. La page de l'expérience : sous `Invitations`, l'invitation ; sous `Guests for the partner`, « 0 guests · 0 names shared ».
5. **Aucune facture émise pour un essai** : `Issue the invoice` attend le vrai jour, puisqu'un numéro P- ne se réutilise jamais. Le PDF d'une facture de partenaire est prouvé par la CI.

#### 4. Les conversions, éteintes

1. `Links` → `Ad platforms` : `CONVERSIONS: OFF` ; Meta, TikTok et Google `KEYS MISSING`, avec leurs versions d'API `v24.0`, `v1.3` et `v22`.
2. `SWITCH ON` : la boîte « SWITCH CONVERSIONS ON » ; tape `SWITCH ON`, puis `Switch on` : refusé, « No platform has its keys in the server’s .env: conversions cannot be switched on. » Ferme la boîte avec `Cancel` : rien n'a changé, `CONVERSIONS: OFF`.
3. `Events` : « No event yet. »
4. Sur A et sur B : ouvre l'application, puis YOUR ACCOUNT et YOUR PROFILE. Sur téléphone et sur ordinateur, aucun bandeau ni ligne ADVERTISING MEASUREMENT.

#### 5. Les pages légales

Sur ton téléphone, TERMS et PRIVACY au pied de page : « Version of 27 October 2026 » sous le titre ; dans la politique de confidentialité, partie « Your answers and votes in the circle », le paragraphe « When an invitation is an experience offered with a partner, you may tick, with your YES, to share your first and last name with that partner; … » ; aucune partie « Advertising measurement ». Le texte des conditions ne change pas.

### 1.8 Ensuite : tes données

Dans cet ordre, quand tu veux :

1. **Tous les réglages de la marge**, `Growth` → `Margin settings` : un taux pour chaque devise où tu vends, les tranches d'expédition de chaque pays où tu envoies (et ALL OTHER COUNTRIES), POUCH, CARD et THE VAULT CARD, la provision de chaque catégorie, `PRIVATE CARE and warranty` (le service et chaque issue d'une garantie), jusqu'à ce que `What is missing` lise « Nothing is missing for this window. » Le coût de chaque boîte reste dans `Orders` → `Settings` → `Boxes`.
2. **Les partenaires**, quand un accord existe : le partenaire, son expérience, son invitation publiée quand elle est prête ; `Issue the invoice` quand l'accord est ferme (la boîte « ISSUE THE INVOICE » nomme le numéro P- suivant, jamais réutilisé, le partenaire et le montant), puis `Record payment` le jour où le virement arrive ; avant l'événement, `Guests for the partner` → `Download the list`, que tu envoies au partenaire.
3. **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1).
4. **Les anciennes images (facultatif).** Une fois M4 stable, `<TAG_Q3>` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_M4>`), la liste d'abord :

   ```bash
   docker images orbes-genome
   ```

## 2. Le jour où les conversions sont activées (plus tard, sur ta décision)

Rien de cette partie ne se fait au déploiement de M4. Le jour où tu lances des publicités payantes et décides d'allumer les conversions, dans cet ordre :

1. **La section préparée passe d'abord au juriste** : *Advertising measurement* de la politique de confidentialité (la note au juriste, point 41).
2. **Tes comptes et leurs clés**, seulement pour les plateformes où tu fais de la publicité : Meta, le numéro du jeu de données (l'ancien pixel) et un jeton d'accès de son API Conversions ; TikTok, le code du pixel et un jeton d'accès de son API Events ; Google Ads, le numéro du client (123-456-7890), celui du compte administrateur s'il y en a un, le jeton développeur, le client OAuth (son identifiant et son secret) et son jeton de rafraîchissement.
3. **Les clés, dans le `.env` du serveur**, entrées par toi dans le `.env` du serveur, jamais dans le chat : `/opt/orbes/orbes-index/deploy/vps/.env`, une ligne par clé, sous ces noms :

   ```text
   ADS_META_DATASET_ID=<…>
   ADS_META_ACCESS_TOKEN=<…>
   ADS_TIKTOK_PIXEL_CODE=<…>
   ADS_TIKTOK_ACCESS_TOKEN=<…>
   ADS_GOOGLE_CUSTOMER_ID=<…>
   ADS_GOOGLE_LOGIN_CUSTOMER_ID=<…>
   ADS_GOOGLE_DEVELOPER_TOKEN=<…>
   ADS_GOOGLE_CLIENT_ID=<…>
   ADS_GOOGLE_CLIENT_SECRET=<…>
   ADS_GOOGLE_REFRESH_TOKEN=<…>
   ```

   Les clés d'une plateforme vont ensemble : une plateforme avec une partie seulement de ses clés empêche l'application de démarrer, la variable manquante nommée. `ADS_GOOGLE_LOGIN_CUSTOMER_ID` est la seule facultative (un compte administrateur seulement). Le journal de l'application dit quelles plateformes ont leurs clés, jamais leurs valeurs.
4. **Un déploiement préparé alors**, par Claude, convenu d'abord avec le responsable de l'hôte, avec son propre runbook : il passe les dix `ADS_*` à l'application dans `deploy/vps/compose.yaml` et lui ouvre la route vers les quatre hôtes des plateformes, et eux seuls (`graph.facebook.com`, `business-api.tiktok.com`, `googleads.googleapis.com`, `oauth2.googleapis.com`) ; aujourd'hui, elle n'en a aucune.
5. **Les versions d'API vérifiées** avant d'allumer : `v24.0` pour Meta, `v1.3` pour TikTok, `v22` pour Google, et ce que chaque plateforme attend de ses envois ce jour-là ; une version retirée se corrige d'abord par un commit.
6. **Dans la console**, `Links` → `Ad platforms` : chaque plateforme utilisée `KEYS PRESENT` ; sous `Channels`, chaque canal de lien coché pour sa plateforme, puis `Save` ; `Google conversion actions` → `Edit`, les quatre actions de Google Ads (`customers/<id>/conversionActions/<id>`) ; `Test codes`, ceux de Meta et de TikTok, lus dans leur outil de test.
7. **`SWITCH ON`** : tape `SWITCH ON`, puis `Switch on` : « Conversions switched on. » Rien de ce qui a eu lieu avant ne part.
8. **Ce que tu vérifies** : le bandeau sur ton téléphone et sur ton ordinateur, ACCEPT et DECLINE de même poids, et PRIVACY ; ACCEPT ; dans YOUR PROFILE, ADVERTISING MEASUREMENT allumé ; `SEND A TEST EVENT` sur chaque plateforme, `TAKEN`, puis l'événement lu dans l'outil de test de la plateforme ; `/legal/privacy` montre la section *Advertising measurement*, et sous la ligne de version « Advertising measurement: since <jour> ».
9. **`SWITCH OFF`** rend tout comme aujourd'hui : le bandeau, la ligne et la section disparaissent ensemble, et chaque événement en attente est annulé.
10. **Préviens ORBES Client Services** : la partie « Meta, TikTok et Google » du playbook vaut à partir de ce jour.

## 3. Ce qui reste à ta décision (sans bloquer)

Chaque lecture est construite comme elle est écrite ; tu dis si tu la changes.

1. **Ce qui compte, et où** (N1). Une commande payée dans la période, ni annulée ni retournée ; le revenu avant crédits, un crédit compté comme un avantage (ou par THE VAULT quand il vient d'un coffre) ; le cadeau de bienvenue et l'expédition offerte dans les avantages (PERKS) ; les coûts d'un échange ou d'un renvoi sur la commande qu'il remplace ; les retours couverts par la provision. La boîte et l'expédition d'un colis partagées à parts égales entre ses commandes payées ; une pièce pas encore emballée estimée au prix fournisseur moyen de sa taille, un colis pas encore emballé à son poids calculé. On garde ?
2. **Un taux par devise** (N2), appliqué à tout l'historique ; un montant sans taux laissé de côté et nommé. On garde ?
3. **Le canal et le palier** (N3). Le canal est celui de la commande (LIVE, DRAW, SALON, VAULT ; SHOPIFY plus tard ; ELSEWHERE pour un soin sur une pièce qu'aucune commande n'a vendue) ; le palier, celui de l'acheteur au paiement. La marge suit la période de GROWTH. Les anciens compléments d'une sortie, la gravure et chaque complément SERVICE comptent comme revenu sans coût. On garde ?
4. **L'avoir d'une facture de partenaire** (P4) : sa propre série, `PC-2026-0001`. On garde ?
5. **Qui fait quoi pour les partenaires** (P1) : un OPERATOR enregistre les partenaires et les expériences et lie les invitations ; un ADMIN émet la facture, note le paiement et annule une expérience facturée. On garde ?
6. **Les noms des événements** (A2, A3) : la création du compte, l'inscription à un tirage, l'entrée dans une LIVE RELEASE, la commande payée ; un événement Google seulement avec un identifiant de clic Google. On garde ?
7. **Quelle plateforme l'apprend** (A3) : seulement celle d'où le collectionneur est venu (le canal de son lien, ou un clic sur une de ses publicités dans les 90 jours) ; rien de ce qui a eu lieu avant que tu allumes, ni pendant qu'elles sont éteintes. On garde ?
8. **Le consentement** (A4) : un bandeau, ACCEPT et DECLINE de même poids, jamais bloquant ; le retrait dans YOUR ACCOUNT ; la section et le bandeau apparaissent et disparaissent avec l'interrupteur ; les identifiants de clic gardés en mémoire seulement jusqu'à l'accord. On garde ?
9. **L'hôte** (A5) : M4 ne change pas `deploy/vps` ; le déploiement de l'activation change le réseau et passe les clés (§2). On garde ?
10. **La version légale** (L2) : le jour à Paris du dernier commit légal de M4, `2026-10-27`, après celui de Q3, `2026-10-26`, jamais retenue pour une date ; les versions de consentement de la liste fondatrice et de WORN la suivent. Le paragraphe partenaire va au juriste avec elle (la note au juriste, point 40), la section *Advertising measurement* avant l'activation (point 41). Sa réponse ne retient pas le déploiement.
11. **Le nom partagé** (P3) : le prénom et le nom du compte, seulement quand il a les deux ; décochable jusqu'à l'événement ; ORBES télécharge la liste, la plateforme n'envoie rien à un partenaire. Si une invitation passe à l'expérience d'un autre partenaire, les noms déjà partagés sont effacés : l'accord était donné à une marque. On garde ?
12. **Le coût de THE VAULT dans la marge** (D61) : ses cinq parts comptées quand elles sont dépensées ; une commande `Vault` à 0, une ligne du canal VAULT sans revenu ; un droit d'achat, une vente ; une pièce garantie comptée, jamais coûtée (elle est achetée à son prix), et toujours dite « piece », jamais « place » ; la table ne montre jamais une sortie ; le rapport de THE VAULT reste tel qu'il est, et la ligne THE VAULT montre aussi son coût des récompenses gagnées (le rapport compte ce qui est gagné, la marge ce qui est dépensé et expédié : les deux peuvent différer), avec le nombre de récompenses sans prix fournisseur. On garde ?
13. **Les sortes de compléments** (Q2) : un complément PRODUCT coûte son prix fournisseur (la moyenne de son SKU) ; un SERVICE ne coûte rien et ne manque jamais. On garde ?
14. **Les conversions et THE VAULT** (K27) : une commande `Vault` à 0 ne part jamais comme achat ; un droit d'achat, si. On garde ?
15. **La place du bandeau** : en plus de la salle d'une LIVE RELEASE, du scanner, d'un certificat, du mot de passe oublié et des pages légales, il ne couvre jamais la page THE VAULT ni l'ouverture d'un coffre (des écrans sombres de cérémonie) ; il attend l'écran suivant. On garde ?
