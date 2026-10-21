# Mise en production du lot MACRO M1

Ce document est pour toi, le propriétaire. Tu lances toi-même chaque commande sur le serveur : en SSH, puis `sudo -iu orbes`, une commande à la fois. Après chaque commande, compare ce qui s'affiche avec la « sortie attendue ». Si ce n'est pas pareil, arrête-toi, ne lance rien d'autre et colle la sortie à Claude (jamais un secret, jamais le contenu de `.env`).

Le lot M1 de tes décisions du 2026-10-20 (la salle d'attente des LIVE RELEASES, l'onglet CAMPAIGN, la liste fondatrice, les e-mails préparés et coupés) part en production en **un seul déploiement**, comme la version ordinateur ([son runbook](DEPLOY-DESKTOP.md)) :

| Déploiement | Éléments | Migrations | Changement de l'hôte | État |
|---|---|---|---|---|
| MACRO M1 | La file d'attente d'une LIVE RELEASE à son rythme, X acheteurs toutes les Y minutes (W1 à W6) ; l'onglet CAMPAIGN d'une sortie et ADD TO CALENDAR d'un tirage (C1 à C3) ; la liste fondatrice de theorbes.com dans la plateforme, son segment, un tirage ouvert à un segment (F1 à F6) ; les e-mails, chacun son interrupteur, tous coupés (E0 à E6) | `0049_live_pace`, `0050_founding_list`, `0051_emails` | `compose.yaml` : huit variables des e-mails, vides | **À faire** (§1) |

Le point de départ : la production tourne la version ordinateur, le commit `00317bcc0b4aeec5906ec417c1d9688c3bda55e6` (image `orbes-genome:00317bcc0b4a`, en service depuis le 2026-10-18 à 13:06 à Paris, 11:06 UTC), avec les quarante-neuf migrations de `0001_initial` à `0048_orbes_care`. La branche du lot, `orbes-macro`, part de ce commit. Si la dernière ligne OK de `.state/deploys.log` nomme une autre image (un correctif après la version ordinateur), ce document ne s'applique pas tel quel : demande à Claude de le recaler avant de commencer (le commit de la production est alors fusionné dans le travail du lot, les preuves repassent et la CI repasse). Le détail technique de `deploy.sh` est dans [DEPLOYMENT §15.7](../DEPLOYMENT.md#157-updates-and-rollback-deploysh).

## 0. Les règles

1. **Ton accord sur les écrans d'abord.** Avant la fusion, tu regardes les captures que te donne le rapport de Claude (§1.1) et tu donnes ton accord dans la conversation. Sans lui, rien n'est fusionné ni déployé.
2. **Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC) : ce sont les sauvegardes de nuit du serveur partagé. **Ni pendant les minutes de sauvegarde du hub** : 03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC).
3. **Aucune heure n'est réservée** (ta règle du 2026-10-07). Une fois les conditions réunies, la CI verte sur le commit exact, le diff de `deploy/vps` limité aux deux fichiers du §1.3 et vu avec le responsable de l'hôte (règle 4), le lancement gardé, tu lances quand tu veux hors des heures de la règle 2, et tu préviens le responsable de l'hôte (ta session de coordination du serveur, « AI Stack Atlas planning ») d'une ligne au lancement, puis des contrôles d'après.
4. **Un seul changement de l'hôte, sans effet sur ce qu'un déploiement lance** : `deploy/vps/compose.yaml` passe à l'application les huit variables des e-mails, `EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER` et `SMTP_PASSWORD`, chacune vide par défaut ; `deploy/vps/.env.example` les documente en commentaire. Ton `.env` n'en a aucune : l'application les reçoit vides, et les e-mails restent coupés. Ni Caddyfile, ni port, ni réseau, ni certificat, ni limite, ni minuterie, ni volume ne change. Comme tout ce qui touche la pile du serveur partagé, **ce changement passe d'abord par le responsable de l'hôte** : tu lui envoies la proposition du §1.1 et tu attends son accord avant de lancer. S'il préfère attendre, Claude retire ce commit du lot (les huit lignes partiront avec le déploiement qui allumera les e-mails), puis recale ce document.
5. **Trois migrations, puis plus de retour en arrière** : après `0049_live_pace`, `0050_founding_list` et `0051_emails`, l'image `00317bcc0b4a` ne tourne plus sur le schéma (`deploy.sh --image 00317bcc0b4a` la refuse). En cas de souci, on **répare en avant** (§1.5).
6. **Jamais `restore.sh` sur ce serveur** (`.env` dit `RESTORE_ALLOWED=false`).
7. **Jamais de `docker image prune`, `docker system prune` ni `docker volume prune`** : ces commandes touchent aussi les autres projets de l'hôte.
8. **Aucun autre commit que le commit final**, que te donne le rapport de Claude : la branche `orbes-macro` (sa propre branche distante, jamais `main`, jamais une pull request), sa CI verte, fusionnée dans `claude/orbes-genome-code-system-o8bmnk` en avance rapide jusqu'à ce commit exact. Tu pousses toi-même la branche de déploiement, sur ton accord.
9. **Les secrets ne se collent jamais dans une conversation.** Ce déploiement n'en crée ni n'en affiche. Les clés d'un prestataire d'e-mails ne s'écrivent pas maintenant (§1.8).
10. **Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh` ne démarre `deploy.sh` que si aucune sauvegarde (`pg_dump`, de n'importe quel projet de l'hôte) ne tourne.
11. **Les pages légales changent** : la politique de confidentialité (la liste fondatrice, les e-mails) et les conditions (article 6, le lien de réinitialisation ; article 12, une sortie pour des collectionneurs sélectionnés ; article 13, le rythme), dans une seule nouvelle version, `2026-10-21`. Les conditions ORBES CARE (l'article 11 et son PDF) gardent leur version, `2026-10-15`. La relecture du texte français par un avocat ne retient jamais le déploiement.
12. **Aucun e-mail ne part** après ce déploiement : le canal est coupé (aucun prestataire), et chaque e-mail a son interrupteur, coupé lui aussi.
13. **Le site theorbes.com ne change pas** avec ce déploiement. Sa nouvelle fenêtre de la liste fondatrice se publie après, sur ton accord explicite, parce qu'elle change `main` (§1.8).

---

## 1. Le déploiement

### 1.0 Ce qui change

**Pour les collectionneurs (/verify, sur un téléphone et sur un ordinateur, en mode sombre et en mode clair)**

- **La file d'attente d'une LIVE RELEASE à son rythme.** Une sortie peut admettre sa ligne par lots : X acheteurs toutes les Y minutes, comptés sur toute la sortie. À l'ouverture (T0), la ligne se forme comme aujourd'hui (les garanties, puis le palier, puis le tirage au sort parmi les présents) ; celui qui attend son lot lit THE QUEUE, sa place, son heure d'entrée estimée (ESTIMATED ENTRY … PARIS) et dans combien de temps, ou THE QUEUE IS PAUSED, et LEAVE THE LINE. Jamais le rythme lui-même. Une fois son lot venu, il entre dans la salle, où les tours par taille, les pièces tenues et le temps pour payer restent ceux d'aujourd'hui. Absent à son tour, son tour passe au suivant ; sa place reste la sienne. Une sortie sans rythme se passe exactement comme aujourd'hui.
- **ADD TO CALENDAR sur un tirage**, le mot de la LIVE RELEASE : tant que les inscriptions sont à venir ou ouvertes, le fichier du tirage s'ajoute au calendrier du téléphone ou de l'ordinateur.
- **Un tirage ouvert à un segment** dit FOR SELECTED COLLECTORS ; un collectionneur qui n'en est pas lit le refus de la LIVE RELEASE à la place de ENTER THE DRAW. Le nom du segment ne s'affiche jamais.
- **Les e-mails ne se voient pas** tant qu'ils sont coupés : FORGOTTEN PASSWORD? reste exactement comme aujourd'hui (ORBES Client Services), YOUR PROFILE n'a pas de groupe EMAILS. Les pages /verify/reset et /verify/unsubscribe existent, sans lien qui y mène.
- **Les pages légales** : la nouvelle version, `2026-10-21` (règle 11).

**Pour le personnel (la console)**

- **Le rythme d'une LIVE RELEASE** : `Pace · buyers per batch` et `Pace · every (minutes)` dans `Times (UTC)` de sa page (vides : pas de rythme) ; sur le tableau en direct, le bloc `Pace`, ses chiffres (`In the queue`, `Admitted`, `Batches`, `Next batch` à l'heure de Paris) et ses commandes, `Set pace`, `Pause pace`, `Resume pace`, `Next batch now` ; la colonne `Admitted` de la ligne. Au-delà de 500 personnes dans la salle, la prévision d'audience propose un rythme.
- **TEST ENTRANTS** attend son lot comme un collectionneur, et le rapport d'un test sur une sortie à son rythme a un sixième contrôle, `The pace`.
- **L'onglet `Campaign`** d'un tirage et d'une LIVE RELEASE, à côté de `Release` : `Make the links` (un lien suivi par canal, en un clic), l'image du compte à rebours de 1080 × 1920 (`Teaser` par défaut, `Full` une fois le nom et la photographie publics) avec `Download`, et le relevé par lien (`Readout` : `Entries`, `Buyers`, `Revenue`, le coût et `Return` quand le lien a un coût).
- **`Founding list`** (groupe Clients) : les personnes que la fenêtre de theorbes.com ajoutera, leur pays et leur provenance, le compte ORBES de chacune une fois inscrite avec le même e-mail, `Download (CSV)` aux colonnes d'un import de clients Shopify, `Make the segment`, et `Remove` sur demande (ADMIN). Un tirage gagne le champ `Access` (`Everyone` ou un segment) jusqu'à sa publication ; un lien peut mener à « theorbes.com (founding list) ».
- **`Emails`** (depuis `Settings` et depuis `Founding list`) : le canal, OFF ; chacun des onze e-mails, son interrupteur (OFF), ses mots et leur aperçu ; la boîte d'envoi, vide ; et sur `Founding list`, l'annonce fondatrice, prête pour le jour où les e-mails seront allumés.

**Pour le serveur**

- **Les routes nouvelles**, toutes sous `/api/v1` que Caddy sert déjà : `POST /api/v1/founding` (le formulaire de theorbes.com, autorisé depuis `https://theorbes.com` seul) et sa vérification préalable `OPTIONS` ; le fichier calendrier d'un tirage ; la réinitialisation par e-mail et les préférences d'e-mails, qui répondent « coupé » tant que le canal l'est ; le désabonnement ; le monogramme des e-mails ([API](../API.md)).

**Les migrations**, appliquées dans **une seule transaction** : si l'une échoue, rien n'est appliqué et le site revient tout seul sur `00317bcc0b4a`.

  | Migration | Élément | Contenu |
  |---|---|---|
  | `0049_live_pace` | W4 | le rythme d'une LIVE RELEASE (`drops.pace_batch`, `pace_minutes`, `pace_paused_at`, `pace_next_at`, `pace_batches`) et l'admission de ses inscriptions (`live_entries.admitted_at`, `admitted_batch`) ; aucune sortie existante n'a de rythme |
  | `0050_founding_list` | F2 à F4 | la table de la liste fondatrice, `preregistrations`, vide ; la destination LANDING des liens ; un segment possible sur un tirage |
  | `0051_emails` | E0 | les tables `email_templates`, `email_outbox`, `email_preferences` et `email_state`, vides : chaque e-mail coupé ; un code de récupération qui peut partir par e-mail (`issued_via`), chaque code existant restant celui de l'équipe (`STAFF`) |

  L'application est arrêtée pendant les migrations. Une fois appliquées, on ne revient plus en arrière (ci-dessous).

- **Caddy** : rien ne change.
- **Les variables** : `compose.yaml` passe les huit variables des e-mails, vides (règle 4). Ton `.env` ne change pas.
- **Une coupure courte** : l'application est arrêtée pendant les migrations, puis redémarrée. En général, moins d'une minute.
- **Pas de retour en arrière** : une fois les migrations faites, l'image `00317bcc0b4a` ne peut plus tourner sur ce schéma. `deploy.sh --image 00317bcc0b4a` la refuse.

Dans la suite, `<SHA_M1>` est le commit final (40 caractères) que donne le rapport de Claude, `<TAG_M1>` ses 12 premiers caractères (le tag de la nouvelle image).

### 1.1 Avant : tes écrans, le responsable de l'hôte, ORBES Client Services, la CI, l'heure, le pré-contrôle

**1. Tes écrans d'abord** (règle 1), au format téléphone et au format ordinateur (1440 × 900, et 1024 × 768), en mode sombre et en mode clair : la file d'attente dans chacun de ses états, un tirage avec ADD TO CALENDAR, un tirage FOR SELECTED COLLECTORS et son refus, les pages légales nouvelles ; et, pour le jour où les e-mails seront allumés, RESET BY EMAIL, SET A NEW PASSWORD, EMAILS dans YOUR PROFILE, STOP THESE EMAILS et chaque e-mail ; dans la console, le bloc `Pace`, l'onglet `Campaign` et ses deux images, `Founding list`, `Emails` ; la nouvelle fenêtre de theorbes.com. Sans ton accord, rien n'est fusionné ni déployé.

**2. Ce qui doit être réglé avant le jour** :

- **La version ordinateur est en production**, au commit `00317bcc0b4aeec5906ec417c1d9688c3bda55e6` (§1.2 le vérifie).
- **Aucune LIVE RELEASE** ouverte ni prévue pendant la fenêtre, et **aucun test de TEST ENTRANTS** en cours : le redémarrage arrêterait un test. Un test fini se nettoie avec END TEST avant, comme d'habitude.
- **Préviens ORBES Client Services** ([le playbook](SALES-PLAYBOOK.md), aussi dans `Documents`) : §0 « La liste fondatrice (theorbes.com) », §2 « Une LIVE RELEASE à son rythme : la file d'attente » et §6 « Un lien par e-mail (une fois les e-mails allumés) ». La place d'un collectionneur dans la file est gardée ; absent à son tour, le tour passe ; un retrait de la liste fondatrice se fait sur demande ; aucun e-mail ne part encore.

**3. Le responsable de l'hôte d'abord** (règle 4). Envoie-lui, avant le jour :

> Proposition pour le déploiement MACRO M1 d'ORBES : un seul changement de la pile d'ORBES (`deploy/vps`), sans effet sur ce qu'elle lance. `compose.yaml` passe à l'application huit variables nouvelles, `EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER` et `SMTP_PASSWORD`, chacune `${NOM:-}`, vide par défaut ; le `.env` d'ORBES n'en contient aucune, donc l'application les reçoit vides et ses e-mails restent coupés ; `.env.example` les documente en commentaire. Aucun réseau, port, limite, volume, certificat ni Caddyfile ne change ; l'application reste sur ses réseaux internes, sans sortie. Le jour où ORBES choisira un prestataire d'e-mails, une autre proposition viendra : une sortie de l'application vers son seul serveur SMTP (port 465 ou 587). Avec trois migrations en une transaction et une coupure courte d'ORBES, hors 03:00–05:30 UTC. Ensuite, un test de 5 000 entrants d'essai sur une LIVE RELEASE d'essai, une demi-heure environ, le panneau Server suivi, arrêté s'il rougit. D'accord ?

Attends son accord. Sans lui, n'avance pas.

**4. Le commit et sa CI (sur ton Mac)** (première condition). Ouvre <https://github.com/eliotrapatel/orbes-index/actions?query=branch%3Aorbes-macro>. Le dernier passage de `genome-ci` doit être celui de `<SHA_M1>`, avec une coche verte. Sinon, n'avance pas.

**5. La branche de déploiement (sur ton Mac)**, sur ton accord seulement (règle 8) : tu pousses `claude/orbes-genome-code-system-o8bmnk` jusqu'à `<SHA_M1>` exactement, comme pour la version ordinateur. Claude te donne la commande dans son rapport ; il ne la lance pas.

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

Sortie attendue : `00317bcc0b4aeec5906ec417c1d9688c3bda55e6` au début de la ligne (le commit en production).

```bash
git -C /opt/orbes/orbes-index status --short
```

Sortie attendue : **rien**. Si des fichiers s'affichent, arrête-toi.

**3. Ce qui tourne.**

```bash
grep '^ORBES_IMAGE_TAG=' .env
```

Sortie attendue : `ORBES_IMAGE_TAG=00317bcc0b4a`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app` et `postgres`, chacun `Up … (healthy)`.

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy 00317bcc0b4a OK (previous c3d25c207a94)` : la version ordinateur est le dernier déploiement réussi. Une autre ligne : arrête-toi et demande à Claude.

**4. `RESTORE_ALLOWED=false`** :

```bash
grep -n '^RESTORE_ALLOWED=' .env
```

Sortie attendue : une seule ligne, `<numéro>:RESTORE_ALLOWED=false`.

**5. Les lignes des e-mails restent vides.** `compose.yaml` passe les huit variables à l'application, vides tant que `.env` n'en a aucune : tu n'ajoutes rien à `.env`, et surtout tu ne les remplis pas maintenant. Elles se remplissent le jour où tu choisis un prestataire, sur le serveur, jamais dans une conversation (§1.8). Vérifie qu'aucune n'y est déjà :

```bash
grep -cE '^(EMAIL_|SMTP_)' .env
```

Sortie attendue : `0`. Un autre nombre : arrête-toi et dis-le à Claude, sans coller les lignes.

### 1.3 Récupérer le commit final

```bash
git -C /opt/orbes/orbes-index fetch origin
```

Sortie attendue : une ligne qui se termine par `-> origin/claude/orbes-genome-code-system-o8bmnk`, ou rien.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : **exactement `<SHA_M1>`** au début de la ligne. Un autre commit : arrête-toi et demande à Claude.

```bash
git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk
```

Sortie attendue : `Updating 00317bc..<7 caractères de SHA_M1>`, puis `Fast-forward` et la liste des fichiers. Si tu lis `Not possible to fast-forward, aborting.`, rien n'a changé : arrête-toi.

```bash
git -C /opt/orbes/orbes-index log -1 --format='%H'
```

Sortie attendue : `<SHA_M1>`.

**Ce qui change dans la pile du serveur** (deuxième condition ; règle 4), contre le commit de la version ordinateur en production, et rien d'autre :

```bash
git -C /opt/orbes/orbes-index diff --name-status 00317bcc0b4aeec5906ec417c1d9688c3bda55e6 HEAD -- deploy/vps
```

Sortie attendue : **exactement ces deux lignes** (`M` : modifié) :

```text
M	deploy/vps/.env.example
M	deploy/vps/compose.yaml
```

Une autre ligne de `deploy/vps` : arrête-toi et demande à Claude.

Ce que `compose.yaml` gagne, et rien d'autre :

```bash
git -C /opt/orbes/orbes-index diff 00317bcc0b4aeec5906ec417c1d9688c3bda55e6 HEAD -- deploy/vps/compose.yaml | grep -E '^[-+][^-+]'
```

Sortie attendue : exactement ces onze lignes, chacune ajoutée (`+`), aucune retirée (`-`) :

```text
+      # Emails (macro scope E0): empty = off, nothing queued or sent. The keys go in .env on the server,
+      # never in chat (genome/.env.example). The app's networks have no route out: the deployment that
+      # turns emails on also gives the app a way to the SMTP host.
+      EMAIL_TRANSPORT: ${EMAIL_TRANSPORT:-}
+      EMAIL_FROM: ${EMAIL_FROM:-}
+      EMAIL_REPLY_TO: ${EMAIL_REPLY_TO:-}
+      SMTP_HOST: ${SMTP_HOST:-}
+      SMTP_PORT: ${SMTP_PORT:-}
+      SMTP_SECURITY: ${SMTP_SECURITY:-}
+      SMTP_USER: ${SMTP_USER:-}
+      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
```

**Les trois migrations, et elles seules** (règle 5) :

```bash
git -C /opt/orbes/orbes-index diff --name-status 00317bcc0b4aeec5906ec417c1d9688c3bda55e6 HEAD -- genome/src/server/db/migrations
```

Sortie attendue : exactement ces trois lignes (`A` : ajouté) :

```text
A	genome/src/server/db/migrations/0049_live_pace.ts
A	genome/src/server/db/migrations/0050_founding_list.ts
A	genome/src/server/db/migrations/0051_emails.ts
```

**La version des pages légales** (règle 11) :

```bash
git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts
```

Sortie attendue : `export const LEGAL_VERSION = '2026-10-21';`, la nouvelle version.

```bash
git -C /opt/orbes/orbes-index grep -h '^export const CARE_CONDITIONS_VERSION' HEAD -- genome/src/server/render/care-conditions.ts
```

Sortie attendue : `export const CARE_CONDITIONS_VERSION = '2026-10-15';`, inchangée.

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

Hors des heures de la règle 2, et une fois l'accord du responsable de l'hôte reçu (§1.1, point 3). Envoie-lui une ligne au lancement, par exemple : « MACRO M1 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_M1>, 3 migrations ; compose.yaml : les huit variables des e-mails, vides, comme convenu ; rien d'autre ne change sur l'hôte. Pré-contrôle : <les six résultats>. »

Le lancement est gardé (troisième condition) : `pgrep -a pg_dump` ne trouve rien, **puis seulement** `scripts/deploy.sh` démarre. Si une sauvegarde a commencé entre-temps, la commande affiche sa ligne `<numéro> pg_dump …` et ne déploie rien : attends qu'elle finisse, puis relance.

```bash
pgrep -a pg_dump || scripts/deploy.sh
```

Compte quelques minutes, surtout pour construire l'image. **Ne ferme pas la session et n'appuie sur rien**, sauf au point 1.

Sortie attendue, dans l'ordre (les heures sont remplacées par `…`) :

1. **La source.** Lis-la tout de suite :

   ```text
   … [deploy.sh] ── source
   … [deploy.sh] ref HEAD = commit <SHA_M1> (tag <TAG_M1>)
   ```

   Un autre commit : Ctrl-C immédiatement. Pendant la construction, rien n'est encore changé.

2. **La construction**, puis Caddy (validé, inchangé) et l'image en service :

   ```text
   … [deploy.sh] ── build orbes-genome:<TAG_M1>
   … [deploy.sh] ── Caddy configuration
   … [deploy.sh] Caddy configuration valid (TLS_MODE=acme, EDGE_MODE=direct)
   … [deploy.sh] previous image tag: 00317bcc0b4a
   ```

3. **Le schéma** :

   ```text
   … [deploy.sh] ── schema
   … [deploy.sh] schema: 49 migration(s) applied, all known to orbes-genome:<TAG_M1>
   ```

   **Il faut lire `49 migration(s)`.** Un `ERROR: … nothing was changed` à la place : le site tourne toujours sur `00317bcc0b4a`, colle la sortie à Claude et ne relance pas.

4. **La sauvegarde pré-déploiement** :

   ```text
   … [deploy.sh] ── pre-deploy backup
   … [backup.sh] photos: <nombre>, <taille> MB
   … [backup.sh] ── database dump
   … [backup.sh] db.dump: <octets> bytes, <nombre> tables
   … [backup.sh] ── keys volume
   … [backup.sh] keys.tar: 1 key file(s)
   … [backup.sh] ── encrypt to <n> recipient(s)
   … [backup.sh] wrote /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M1>.tar.age (<octets> bytes, sha256 <…>)
   … [backup.sh] backup complete: /var/backups/orbes/daily/orbes-<date>T<heure>Z-pre-deploy-<TAG_M1>.tar.age
   ```

   **Note le nom de l'archive et sa taille en octets** : c'est la sauvegarde de l'état d'avant, à garder pour mémoire (elle ne sera jamais restaurée sur ce serveur).

5. **Les migrations et le redémarrage** (la coupure courte commence ici) :

   ```text
   … [deploy.sh] ── roll out orbes-genome:<TAG_M1>
   … [deploy.sh] postgres is healthy
   … [deploy.sh] stopping the running app before migrating to <TAG_M1>
   Applied 3 migration(s): 0049_live_pace, 0050_founding_list, 0051_emails
   … [deploy.sh] database ready: migrations applied, app role orbes_app has DML rights only
   … [deploy.sh] app is healthy
   … [deploy.sh] caddy is healthy
   ```

   **Il faut lire `Applied 3 migration(s)`.** `docker compose` affiche aussi ses lignes (`Container orbes-app-1 …`) : l'application est recréée sur la nouvelle image, avec ses huit variables vides. Caddy n'est pas recréé : sa configuration ne change pas.

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
   … [deploy.sh] deployed orbes-genome:<TAG_M1> (previous: 00317bcc0b4a). This release applied the migration(s) 0049_live_pace, 0050_founding_list, 0051_emails:
   … [deploy.sh] orbes-genome:00317bcc0b4a cannot run on this schema any more (scripts/deploy.sh --image 00317bcc0b4a refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M1> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).
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
| Un `ERROR: …` **avant** la ligne `── roll out`, avec `nothing was changed` ou `nothing else was changed` | Le déploiement s'est arrêté seul. Le site tourne toujours sur `00317bcc0b4a`, le schéma n'a pas bougé. | Rien. Colle la sortie, attends la réponse. |
| Une erreur (par exemple de `db migrate`), puis `── rollback to orbes-genome:00317bcc0b4a` et `rolled back to 00317bcc0b4a; the stack is healthy` | Aucune migration n'a été appliquée (une seule transaction), et le site est revenu tout seul sur `00317bcc0b4a`. | Rien. Colle la sortie, attends un commit correctif. |
| `rollback to 00317bcc0b4a is NOT healthy either` | Le retour en arrière n'a pas pris : le site est en panne. | Tout de suite : `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties à Claude. Préviens le responsable de l'hôte. |
| `── no rollback: repair forward`, puis `WARNING: deployment of <TAG_M1> failed (…) and is KEPT` et `Repair forward:` | Les migrations sont faites, puis quelque chose a échoué (santé, clé, tests de fumée). La nouvelle version reste : on ne peut plus revenir à `00317bcc0b4a`. | `docker compose ps`, puis `docker compose logs --tail 100 app`, et colle les sorties. Cause passagère (réseau, disque plein, un service tombé un instant) : corrige-la, puis `scripts/deploy.sh --image <TAG_M1>`. Sinon, Claude prépare un commit correctif ; CI verte, tu refais le §1.3 avec ce commit, puis la commande gardée du §1.4. |
| Le déploiement a réussi, puis quelque chose ne va pas à l'usage (§1.6, §1.7) | La nouvelle version tourne sur le nouveau schéma. | On répare en avant : un commit correctif de Claude, sa CI verte, le §1.3 avec ce commit, puis la commande gardée du §1.4. En attendant, ne lance pas de LIVE RELEASE à son rythme. |

Dans tous les cas : **jamais `restore.sh`**, **jamais `scripts/deploy.sh --image 00317bcc0b4a`** (refusé : `this image cannot run on this schema: repair forward`), jamais de `prune`.

### 1.6 Juste après : contrôles de base

Sur le serveur, toujours en `orbes` dans `deploy/vps` :

```bash
tail -n 1 .state/deploys.log
```

Sortie attendue : `… deploy <TAG_M1> OK (previous 00317bcc0b4a; migrations 0049_live_pace, 0050_founding_list, 0051_emails)`.

```bash
docker compose ps
```

Sortie attendue : `caddy`, `app`, `postgres`, chacun `Up … (healthy)`.

```bash
docker compose exec app node --import tsx scripts/db.ts status
```

Sortie attendue : `Database: postgres://orbes_app:***@postgres:5432/orbes`, puis les 52 lignes `applied`, de `0001_initial` à `0051_emails`, aucune `PENDING`.

```bash
docker compose logs app | grep -c 'live engine: leading'
```

Sortie attendue : `1` : le moteur des LIVE RELEASES a redémarré et tient son verrou.

```bash
scripts/restore.sh --identity /dev/null --latest --dry-run
```

Sortie attendue : `… ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in …)`, qui se termine par `Nothing was done.`

**Ce que les migrations ont écrit**, en lecture seule. Aucune sortie n'a de rythme :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from drops where pace_batch is not null"'
```

Sortie attendue : `0`.

La liste fondatrice est vide :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from preregistrations"'
```

Sortie attendue : `0`.

Aucun e-mail allumé, aucun écrit :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (select count(*) from email_templates where enabled), (select count(*) from email_outbox)"'
```

Sortie attendue : `0|0`.

Chaque code de récupération existant reste celui de l'équipe, donné par un membre nommé :

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from account_recovery_codes where created_by is null"'
```

Sortie attendue : `0`.

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

**Le formulaire de theorbes.com est accepté depuis theorbes.com**, et depuis là seulement. La vérification préalable d'un navigateur sur theorbes.com :

```bash
curl -s -i -X OPTIONS https://verify.theorbes.com/api/v1/founding -H 'Origin: https://theorbes.com' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' | grep -iE '^(HTTP|access-control|vary)'
```

Sortie attendue : `HTTP/2 204` en première ligne, puis ces lignes, dans n'importe quel ordre :

```text
access-control-allow-origin: https://theorbes.com
access-control-allow-methods: POST
access-control-allow-headers: content-type
access-control-max-age: 600
vary: Origin
```

La même depuis un autre site :

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS https://verify.theorbes.com/api/v1/founding -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST'
```

Sortie attendue : `403` : le serveur refuse lui-même tout autre site.

**Les e-mails sont coupés** : l'application n'offre pas la réinitialisation par e-mail.

```bash
curl -s https://verify.theorbes.com/api/v1/account/reset
```

Sortie attendue : `{"email":false}`. `{"email":true}` : arrête-toi et dis-le à Claude.

Le monogramme des futurs e-mails est servi :

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://verify.theorbes.com/api/v1/email/monogram.png
```

Sortie attendue : `200 image/png`.

**Préviens le responsable de l'hôte** : « MACRO M1 fait à <heure> Paris (<heure> UTC), 3 migrations, compose.yaml avec ses huit variables vides, rien d'autre n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. Le test de 5 000 entrants d'essai suit, à <heure> Paris. »

### 1.7 Une vérification réelle par élément

Dans la console, sur ton ordinateur, en ADMIN, puis sur ton téléphone (Safari) avec le compte d'essai de la maison.

**1. Le rythme, avec 5 000 entrants d'essai** (la vraie mesure du lot : la file tient, les lots arrivent à exactement X toutes les Y minutes, l'ordre publié est gardé). Une demi-heure environ, hors des heures de la règle 2. Pendant tout le test, garde un œil sur le panneau `Server` à droite de la page : si `THE SERVER IS STRAINED` s'affiche, `Stop`, puis END TEST, et dis-le à Claude.

1. **La sortie d'essai.** `Club` → `Drops` → `New live release`, comme tes sorties d'essai précédentes : `Model` le modèle d'essai dont le compte d'essai de la maison détient une pièce (jamais une vraie pièce), `Title` `TEST PACE`, `Price of a piece` `1`, `Currency` `EUR`, une taille, `ONE SIZE = 25`. Sur sa page, `Access` → `Edit` : `Owners of <le modèle d'essai>` coché, rien d'autre ; les entrants d'essai comptent comme propriétaires des modèles de la sortie, ton compte d'essai détient sa pièce, et aucun vrai collectionneur n'entre dans la ligne. Puis la partie `Times (UTC)` → `Edit` : `Room opens (minutes before)` `30` ; `The opening` (T0) dans 40 minutes environ ; `End of the sales` T0 + 30 minutes ; `Pace · buyers per batch` `250` ; `Pace · every (minutes)` `1`. Puis `Publish`. La partie `Times (UTC)` lit `Pace` : 250 toutes les minutes ; pour 5 000, vingt lots, le premier à T0, le dernier à T0 + 19 minutes. **Visible de tous** : elle paraît dans THE RELEASES et la bannière de sa publication à sa fin, puis pour toujours dans PAST et sur la fiche du modèle d'essai, avec son titre, le nom et la photographie du modèle d'essai et « 25 PIECES » (la console refuse le nom ou la photographie après l'ouverture de la salle) : fais-la à une heure creuse.
2. **Préviens le responsable de l'hôte** d'une ligne : « ORBES : test de 5 000 entrants d'essai de <heure> à <heure> Paris (<heure> UTC), arrêté si le serveur rougit. »
3. **Une fois la salle ouverte** (T0 − 30 minutes), la partie `Test entrants` : `Send test entrants`, avec `Test entrants · TITANE` `1000` (les autres paliers à `0`), `Arrival` `All at once`, `Behaviour · PAY (%)` `0`, `Behaviour · RELEASE MY PLACE (%)` `100`, `Behaviour · miss the turn (%)` `0`, `Behaviour · LEAVE (%)` `0` ; tape la phrase demandée, `TEST <les 8 premiers caractères de la sortie>`. Personne ne paie : chacun rend sa place à son tour, la sortie ne se vend pas avant ses vingt lots, et le test ne prend aucune pièce. Puis `Add more`, quatre fois, `1000` chaque fois (la même phrase) : **5 000 entrants d'essai** en cinq envois de 1 000, tous avant T0.
4. **À T0, sur le tableau en direct**, le bloc `Pace` : `In the queue` part de 5 000 environ et baisse de 250 chaque minute ; `Batches` monte de 1 chaque minute ; `Next batch` donne l'heure du lot suivant, à l'heure de Paris, une minute plus tard chaque fois ; dans la ligne, la colonne `Admitted` lit `Batch 1`, `Batch 2`… dans l'ordre de la ligne.
5. **Sur ton téléphone**, une ou deux minutes après T0 : ouvre la sortie avec le compte d'essai de la maison, choisis la taille et ENTER THE LINE. Tu arrives après T0, donc derrière les 5 000 : THE QUEUE, ta place, ESTIMATED ENTRY <heure> PARIS, une vingtaine de minutes plus tard, et dans combien de temps. Puis LEAVE THE LINE, deux fois : tu rends ta place.
6. **Pause et reprise, une fois** (vers T0 + 5 minutes) : `Pause pace`. Le bloc lit `PACE PAUSED`, `Next batch` lit `—` et aucun lot n'entre ; sur ton téléphone, si tu es encore dans la file, THE QUEUE IS PAUSED. Une minute plus tard, `Resume pace` : les lots reprennent, chacun décalé du temps de la pause. Puis, une fois, `Next batch now` : un lot entre aussitôt, sans déplacer l'heure du suivant.
7. **Le serveur pendant le test**, sur le serveur, vers T0 + 10 minutes :

   ```bash
   docker stats --no-stream
   ```

   ```bash
   free -h
   ```

   Note la mémoire de l'application et la ligne `Swap` pour le responsable de l'hôte.

8. **Après la fin** (`End of the sales`), `End test`, avec la phrase `END TEST <les mêmes 8 caractères>` : le rapport se calcule, puis les comptes d'essai sont nettoyés. Dans `Past tests`, `Report` : chaque contrôle `PASSED`, dont **`The pace`**. Un contrôle `FAILED` : copie sa ligne et donne-la à Claude.
9. **Préviens le responsable de l'hôte** : la fin du test, les chiffres du point 7, et l'état du panneau `Server` pendant le test.

Les entrants d'essai lisent leur place par la page, sans flux en direct : ce test mesure le rythme sur PostgreSQL, pas la mémoire de 5 000 téléphones gardant chacun la page ouverte ([le rapport de charge, §7](../reports/live-load.md)). Avant d'annoncer à des milliers une sortie à son rythme, parles-en à Claude (§2).

**2. Les autres éléments.** Pour `Campaign`, sers-toi de la même sortie d'essai, une fois le test fini.

| Élément | Où | Geste | Ce que tu dois voir |
|---|---|---|---|
| L'onglet CAMPAIGN | Console | La page de la sortie d'essai, l'onglet `Campaign` | `Links` : une ligne par canal, « No link yet » ; `Make the links` : un lien par canal, chacun son adresse et `Copy` ; puis, sur la page de chaque lien, `Archive` (ces liens d'essai ne serviront pas) |
| L'image du compte à rebours | Console | `Campaign`, `Countdown image` : `Teaser`, puis `Download` | Le PNG de 1080 × 1920 : le monogramme, la date et l'heure à Paris, « A RELEASE », ni photographie ni nom ; `Full` choisi seulement une fois le nom et la photographie publics |
| Le relevé par lien | Console | `Campaign`, `Readout` | `OTHER SOURCES` et `TOTAL` ; les entrants d'essai n'y comptent pas (des collectionneurs comptés seulement) |
| ADD TO CALENDAR | Téléphone | Un tirage à venir ou ouvert (s'il n'y en a aucun, à ta prochaine publication) | ADD TO CALENDAR sous son état ; le calendrier du téléphone propose l'événement du tirage, de l'ouverture des inscriptions à leur fermeture, avec un rappel 10 minutes avant |
| L'accès d'un tirage | Console | `Club` → `Drops` → `New release`, choisis un modèle, `Next`, puis ferme sans enregistrer | Le champ `Access` : `Everyone` et tes segments |
| La liste fondatrice | Mac, puis console | La commande ci-dessous, puis `Founding list` | 1 personne : `founding-check@theorbes.com`, `Test`, FR, source `Direct` ; `Make the segment` : le segment `Founding list` est fait ; puis `Remove` sur sa ligne, avec la phrase `REMOVE <les 8 premiers caractères>` : « Nobody yet. The theorbes.com form adds people here. » |
| Les e-mails | Console | `Settings` → `Emails` | `Channel` : OFF, « No email provider in the server’s .env: nothing is sent. » ; les onze e-mails OFF ; `The outbox` vide. N'allume rien. |
| Le mot de passe oublié | Téléphone | SIGN OUT, puis SIGN IN, FORGOTTEN PASSWORD? | Exactement comme hier : ORBES Client Services et I HAVE A RECOVERY CODE, pas de RESET BY EMAIL |
| YOUR PROFILE | Téléphone | YOUR ACCOUNT, YOUR PROFILE | Comme hier, sans groupe EMAILS |
| Les pages légales | Téléphone | PRIVACY et TERMS au pied de page | « Version of 21 October 2026 » sous le titre ; la politique de confidentialité a « The founding list » et « Emails » |

La personne d'essai de la liste fondatrice, depuis ton Mac (une adresse de la maison qui ne reçoit rien : les e-mails sont coupés) :

```bash
curl -s -w '\n%{http_code}\n' -X POST https://verify.theorbes.com/api/v1/founding -H 'Origin: https://theorbes.com' -H 'Content-Type: application/json' --data '{"email":"founding-check@theorbes.com","firstName":"Test","country":"FR","consent":true,"website":""}'
```

Sortie attendue : `{"ok":true}`, puis `202`.

### 1.8 Ensuite

- **Préviens ORBES Client Services** que c'est en place, si ce n'est pas déjà fait (§1.1) : la file d'attente (§2 du playbook), la liste fondatrice et son retrait sur demande (§0), aucun e-mail encore (§6).
- **La nouvelle fenêtre de theorbes.com**, sur ton accord explicite seulement, une fois ce déploiement en place : elle change `main` (le commit local de la branche `orbes-landing` que te donne le rapport de Claude). Le formulaire n'est accepté que depuis `https://theorbes.com`, sans `www` : avant de publier, vérifie depuis ton Mac que le site ne renvoie pas vers `www`.

  ```bash
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://theorbes.com
  ```

  Sortie attendue : `200`, seul. `301` ou `308` vers `https://www.theorbes.com/` : ne publie pas, dis-le à Claude.

- **Allumer les e-mails, plus tard**, dans cet ordre : choisir un prestataire ; une nouvelle version des pages légales qui le nomme, avec son pays ; une proposition au responsable de l'hôte pour la sortie de l'application vers son seul serveur SMTP ; ses clés dans `.env`, sur le serveur, jamais dans une conversation ; les enregistrements SPF, DKIM et DMARC du domaine chez Amen ; un déploiement ; `Send a test to me` depuis `Emails` ; puis chaque e-mail allumé, un par un.
- **Le test de 5 000** a laissé ses comptes d'essai et leurs inscriptions annulées, jamais effacées : si une sauvegarde de la nuit passe 20 Mo, dis-le au responsable de l'hôte.
- **Les anciennes images (facultatif).** Une fois MACRO M1 stable, `00317bcc0b4a` et les images d'avant ne peuvent plus servir. Retire-les une par une, par leur tag exact (jamais `<TAG_M1>`), la liste d'abord :

  ```bash
  docker images orbes-genome
  ```

## 2. Ce qui reste à ta décision (sans bloquer)

1. **Les choix par défaut** de tes décisions et du plan, que tu peux changer : la place et l'heure estimée sur la file (W5) ; un lien par canal en un clic (C2) ; une personne absente garde sa place, son tour passe au suivant (W6) ; « étendre » le rythme, c'est `Set pace` ou `Next batch now`, et aucune commande n'enlève un rythme pendant une sortie ; le relevé crédite chaque inscription et chaque commande au dernier lien ; la liste des e-mails (commande payée, expédiée, livrée, annulée ; une place de tirage ; une place proposée ; les étiquettes de garantie et de PRIVATE CARE) ; un désabonné garde sa place sur la liste et ne reçoit plus rien.
2. **Le prestataire d'e-mails** : rien ne part avant ton choix (§1.8).
3. **La nouvelle fenêtre de theorbes.com** : « This offer will not appear again. » y reste ; dis-le si tu préfères qu'il parte avant de publier.
4. **La mémoire de 5 000 téléphones en direct** : mesurée sur un Mac, l'application dépassait sa limite de 768 Mo avec 5 000 flux ouverts ([le rapport de charge, §7](../reports/live-load.md)). Le test du §1.7 ne la mesure pas. Avant une sortie à son rythme annoncée à des milliers, parles-en à Claude.
5. **Une phrase d'un tirage** : sa page dit encore qu'ORBES Client Services n'envoie pas d'e-mail ; elle changera le jour où les e-mails d'un tirage seront allumés.
6. **La page `Emails` n'a pas de lien dans le menu** (le menu d'un ADMIN est plein à 1440 × 900) : elle s'ouvre depuis `Settings` et depuis `Founding list`.
