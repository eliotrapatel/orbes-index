/**
 * docs/launch/DEPLOY-CUSTOMER-INTELLIGENCE.md, the owner's runbook for deployments I1 and I2, the customer intelligence
 * (plan of 2026-10-08, §9 and Finish I1), against the scripts, the migrations and the app it quotes. Part I1:
 *
 *  - it starts from the production of H2 (0001 to 0039, H2 as deployed, e7f72e1: the lot's base 074fce1 with H2's two fixes merged) and applies exactly
 *    0040 to 0044, as the scripts print them: the table of §1.0, the lines `db_applied_migrations` and deploy.sh print
 *    before, the line `db.ts migrate` prints, those deploy.sh prints after it, the deployment log and the count
 *    `db.ts status` shows; H2's image no longer runs on the schema after it;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, geoip-update and the app is still one they
 *    print;
 *  - the plan's §9 and the owner's rules: the captures reviewed first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the
 *    hub's backup minutes (Paris first, UTC in brackets), no slot booked since 2026-10-07 and a heads-up at launch,
 *    nothing changed on the host (the deploy/vps diff against H2's commit, empty; the city database the DB-IP file
 *    already installed and its weekly timer), the box's figures with the swap line before and after, the guarded
 *    launch, restore.sh only ever run to watch it refuse, no prune, the legal version unmoved;
 *  - Before I1's launch (the playbook's procedure told to ORBES Client Services, both copies), one real check per
 *    feature with its read-only query, the next morning's sizes, and the questions still open;
 *  - the console's and the app's words as they show them; one command per shell block, relative links that resolve,
 *    and the runbook linked from DEPLOYMENT and COMPLIANCE.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { VIEW_PAGES } from '../../src/server/db/schema.js';
import { LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-CUSTOMER-INTELLIGENCE.md';
const runbook = readDoc(RUNBOOK);
const i1 = section(runbook, '## 1.');
const commands = fenced(i1, 'bash');
const outputs = fenced(i1, 'text');

/** The production I1 starts from: H2, its final commit (the lot's base, plan §4 step 0); the main session confirms it against deploys.log. */
const H2_COMMIT = 'e7f72e1fff7e14ba461d59b8fbc88daa12eca62f';
const H2_TAG = H2_COMMIT.slice(0, 12);
/** H1's image, as H2's deployment log line names it (DEPLOY-NEXT-LOT §2.6). */
const H1_TAG = '1651df1dd669';
/** The legal version H2 published; this lot moves none (plan §0.12). */
const H2_LEGAL_VERSION = '2026-10-10';

const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
const BEFORE_I1 = NAMES.filter((n) => numberOf(n) <= 39);
const H2_MIGRATIONS = NAMES.filter((n) => numberOf(n) >= 35 && numberOf(n) <= 39);
const DEPLOY_I1 = NAMES.filter((n) => numberOf(n) >= 40 && numberOf(n) <= 44);
const AFTER_I1 = [...BEFORE_I1, ...DEPLOY_I1];

/** What the runbook expects from the scripts, each printed word for word by its source. */
const MESSAGES: ReadonlyArray<readonly [message: string, source: string]> = [
  ['= commit ', 'deploy/vps/scripts/deploy.sh'],
  ['build orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['Caddy configuration valid (TLS_MODE=', 'deploy/vps/scripts/lib.sh'],
  ['previous image tag: ', 'deploy/vps/scripts/deploy.sh'],
  [' migration(s) applied, all known to ', 'deploy/vps/scripts/deploy.sh'],
  ['nothing else was changed', 'deploy/vps/scripts/deploy.sh'],
  ['pre-deploy backup', 'deploy/vps/scripts/deploy.sh'],
  ['roll out ', 'deploy/vps/scripts/deploy.sh'],
  [' is healthy', 'deploy/vps/scripts/lib.sh'],
  ['stopping the running app before migrating to ', 'deploy/vps/scripts/deploy.sh'],
  ['database ready: migrations applied, app role ', 'deploy/vps/scripts/lib.sh'],
  ['an ACTIVE signing key exists', 'deploy/vps/scripts/deploy.sh'],
  ['smoke tests via https://', 'deploy/vps/scripts/deploy.sh'],
  ['/.well-known/orbes-keys.json lists an ACTIVE key', 'deploy/vps/scripts/deploy.sh'],
  ['/verify: 200', 'deploy/vps/scripts/deploy.sh'],
  ['. This release applied the migration(s) ', 'deploy/vps/scripts/deploy.sh'],
  [' cannot run on this schema any more (scripts/deploy.sh --image ', 'deploy/vps/scripts/deploy.sh'],
  [' OK (previous ', 'deploy/vps/scripts/deploy.sh'],
  ['no rollback: repair forward', 'deploy/vps/scripts/deploy.sh'],
  [' and is KEPT', 'deploy/vps/scripts/deploy.sh'],
  ['rolled back to ', 'deploy/vps/scripts/deploy.sh'],
  [' is NOT healthy either', 'deploy/vps/scripts/deploy.sh'],
  ['this image cannot run on this schema: repair forward', 'deploy/vps/scripts/deploy.sh'],
  ['photos: ', 'deploy/vps/scripts/backup.sh'],
  ['db.dump: ', 'deploy/vps/scripts/backup.sh'],
  ['backup complete: ', 'deploy/vps/scripts/backup.sh'],
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', 'deploy/vps/scripts/restore.sh'],
  ['Nothing was done.', 'deploy/vps/scripts/restore.sh'],
  ['live engine: leading', 'genome/src/server/services/live-engine.ts'],
  ["'intelligence sizes'", 'genome/src/server/context.ts'],
];

describe('the runbook of the customer intelligence, part I1 (docs/launch/DEPLOY-CUSTOMER-INTELLIGENCE.md)', () => {
  it('starts from H2, 0001 to 0039, and applies exactly 0040 to 0044, as the scripts print them', () => {
    expect(DEPLOY_I1).toEqual(['0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes']);
    expect(BEFORE_I1).toHaveLength(40);
    expect(BEFORE_I1.slice(-2)).toEqual(['0038_draw_sizes', '0039_order_delivery']);
    // I2's migrations (0045 on) come after I1's, in build order.
    expect(NAMES.slice(0, AFTER_I1.length)).toEqual(AFTER_I1);
    expect(NAMES.filter((n) => numberOf(n) > 44).every((n) => n > DEPLOY_I1.at(-1)!)).toBe(true);
    expect(runbook).toContain('[son runbook](DEPLOY-NEXT-LOT.md)');
    expect(runbook).toContain(`le commit \`${H2_COMMIT}\` (image \`orbes-genome:${H2_TAG}\`), avec les quarante migrations de \`${BEFORE_I1[0]}\` à \`${BEFORE_I1.at(-1)}\``);
    expect(i1).toContain(`Sortie attendue : quarante lignes, de \`${BEFORE_I1[0]}\` à \`${BEFORE_I1.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE_I1.slice(-2).join('\n'));
    expect(i1).toContain(`schema: ${BEFORE_I1.length} migration(s) applied, all known to orbes-genome:<TAG_I1>`);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_I1);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(i1).toContain(`Applied ${DEPLOY_I1.length} migration(s): ${DEPLOY_I1.join(', ')}`);
    expect(i1).toContain(`(previous: ${H2_TAG}). This release applied the migration(s) ${DEPLOY_I1.join(', ')}:`);
    expect(i1).toContain(`orbes-genome:${H2_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${H2_TAG} refuses it).`);
    expect(i1).toContain(`deploy <TAG_I1> OK (previous ${H2_TAG}; migrations ${DEPLOY_I1.join(', ')})`);
    expect(i1).toContain(`les ${AFTER_I1.length} lignes \`applied\`, de \`${AFTER_I1[0]}\` à \`${AFTER_I1.at(-1)}\``);
    // H2 as the last deployment: its log line exactly as DEPLOY-NEXT-LOT §2.6 expects it after H2.
    expect(H2_MIGRATIONS).toHaveLength(5);
    expect(i1).toContain(`\`… deploy ${H2_TAG} OK (previous ${H1_TAG}; migrations ${H2_MIGRATIONS.join(', ')})\``);
    expect(readDoc('docs/launch/DEPLOY-NEXT-LOT.md')).toContain(`deploy <TAG_H2> OK (previous ${H1_TAG}; migrations ${H2_MIGRATIONS.join(', ')})`);
    expect(i1).toContain(`Sortie attendue : \`${H2_COMMIT}\` au début de la ligne`);
    expect(i1).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${H2_TAG}\`.`);
    expect(i1).toContain(`\`Updating ${H2_COMMIT.slice(0, 7)}..<7 caractères de SHA_I1>\``);
    // <SHA_I1> and <TAG_I1> stay placeholders until the main session hands the commit over.
    expect(runbook).toContain('`<SHA_I1>` est le commit final (40 caractères)');
    expect(runbook).toContain('la branche `orbes-customer-intelligence-i1`');
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message.replace(/^'|'$/g, ''));
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(commands).toContain("docker compose logs app --since 12h | grep 'intelligence sizes'");
  });

  it("holds the plan's §9 and the owner's rules: nothing changes on the host", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les captures d'abord.**");
    // Paris first, UTC in brackets (owner rule §0.10).
    expect(rules).toContain("**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(rules).toContain("03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)");
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC");
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé");
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(rules).toContain('**Jamais `restore.sh` sur ce serveur**');
    // The heads-up at launch (plan §9's line) and after.
    expect(section(runbook, '### 1.4')).toContain("« ORBES I1 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_I1>, 5 migrations, rien ne change sur l'hôte (le fichier GeoIP ville est celui déjà installé).");
    expect(section(runbook, '### 1.6')).toContain("**Préviens le responsable de l'hôte**");
    // The deploy/vps diff against H2's commit, nothing expected; no Caddy recreated.
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${H2_COMMIT} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi');
    expect(section(runbook, '### 1.4')).not.toContain('Recreate`');
    // The box's figures before and after (AI Stack Atlas's rule since 2026-10-07), the swap line read.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c), c).toHaveLength(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(section(runbook, '### 1.5')).toContain(`**jamais \`scripts/deploy.sh --image ${H2_TAG}\`**`);
    // The pre-deploy backup's name and size: §8's « before » figure.
    expect(section(runbook, '### 1.4')).toContain("**Note le nom de l'archive et sa taille en octets**");
  });

  it('checks the city database already installed and its weekly timer, read only', () => {
    const before = section(runbook, '### 1.1');
    expect(commands).toContain('systemctl list-timers orbes-geoip.timer');
    expect(commands).toContain('scripts/geoip-update.sh --check');
    expect(readDoc('deploy/vps/systemd/orbes-geoip.timer')).toContain('OnCalendar=Mon *-*-* 04:41:00');
    expect(before).toContain('vers 04:41 UTC, jusqu\'à une heure plus tard');
    expect(readDoc('deploy/vps/systemd/orbes-geoip.timer')).toContain('RandomizedDelaySec=1h');
    expect(readDoc('deploy/vps/scripts/geoip-update.sh')).toContain('--check)');
    expect(readDoc('genome/scripts/geoip-update.ts')).toContain('`geoip-update: ${r.path}: OK, ${r.databaseType');
    expect(before).toContain('`geoip-update: /var/lib/orbes/geoip/dbip-city-lite.mmdb: OK, DBIP-City-Lite built …`');
    expect(readDoc('deploy/vps/.env.example')).toContain('GEOIP_FILE=dbip-city-lite.mmdb');
    expect(section(runbook, '## 0.')).toContain('`orbes-geoip.timer`');
  });

  it("tells ORBES Client Services before, keeps the legal version, one real check per feature, the next morning and what stays open", () => {
    // No legal page moves in this lot (plan §0.12).
    expect(LEGAL_VERSION).toBe(H2_LEGAL_VERSION);
    expect(i1).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${H2_LEGAL_VERSION}';\`, celle de H2, inchangée.`);
    expect(section(runbook, '## 0.')).toContain('ne retient jamais le déploiement');
    const before = section(runbook, '### 1.1');
    for (const what of ['**H2 est en production**', '**Aucune LIVE RELEASE**', '**Aucun test de TEST ENTRANTS en cours**', '**Préviens ORBES Client Services**', '**Les comptes de collectionneur de l\'équipe**']) expect(before, what).toContain(what);
    // The playbook's procedure, as both copies name it, with the tags and notes and the AUDITOR's lines.
    expect(before).toContain("« Corriger la date de naissance ou le profil d'un client »");
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const playbook = readDoc(copy);
      expect(playbook, copy).toContain("### Corriger la date de naissance ou le profil d'un client");
      expect(playbook, copy).toContain('**Les tags et les notes privées**');
      expect(playbook, copy).toContain('**Le rôle AUDITOR**');
    }
    const checks = section(runbook, '### 1.7');
    for (const what of ['§3.1', '§3.2', '§3.3', '§3.4', '§3.6', '§3.7']) expect(checks, what).toContain(`| ${what} |`);
    expect(checks).toContain("**qui n'est pas connecté à la console**");
    // The read-only query of §3.3, against the table and page codes as they are.
    const views = fenced(checks, 'bash');
    expect(views).toEqual(['docker compose exec -T postgres sh -c \'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select page, count(*) from collector_views group by 1 order by 1"\'']);
    expect(VIEW_PAGES[2]).toBe('NOW');
    expect(VIEW_PAGES[4]).toBe('MY_PIECES');
    expect(VIEW_PAGES[9]).toBe('COLLECTION');
    expect(VIEW_PAGES[10]).toBe('MODEL');
    const morning = section(runbook, '### 1.8');
    expect(morning).toContain('Après 09:30 à Paris (07:30 UTC ; 08:30 à Paris après le 25 octobre)');
    expect(fenced(morning, 'bash')).toEqual([
      "docker compose logs app --since 12h | grep 'intelligence sizes'",
      'docker compose exec -T postgres sh -c \'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select max(day) from view_daily_stats where page = 0"\'',
      'ls -lt /var/backups/orbes/daily/ | head -n 4',
    ]);
    expect(morning).toContain('plus de 20 %');
    expect(readDoc('genome/src/server/db/migrations/0042_collector_views.ts')).toMatch(/view_daily_stats[\s\S]*page\s+smallint/);
    const next = section(runbook, '### 1.9');
    for (const what of ['**Les premiers vrais liens**', '**La règle des 50 Mo**', '`VISITOR DATA`']) expect(next, what).toContain(what);
    const open = section(runbook, '## 3.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3]);
    expect(section(runbook, '## 2.')).toContain('jamais contre H2');
  });

  it('names the console and the app as they show themselves', () => {
    const admin = (file: string): string => readDoc(`genome/src/web/admin/${file}`);
    const labels: ReadonlyArray<readonly [label: string, file: string]> = [
      ['Profile', 'model/client-profile.ts'],
      ['Edit the profile', 'model/client-profile.ts'],
      ['Change the date of birth', 'model/client-profile.ts'],
      ['Edit the address', 'model/client-profile.ts'],
      ['Withheld', 'model/client-profile.ts'],
      ['Tags and private notes', 'model/client-notes.ts'],
      ['Add a tag', 'model/client-notes.ts'],
      ['Add a private note', 'model/client-notes.ts'],
      ['Intelligence', 'model/owner-intelligence.ts'],
      ['Origin', 'model/owner-intelligence.ts'],
      ['Wishlist', 'model/owner-intelligence.ts'],
      ['Devices', 'model/owner-intelligence.ts'],
      ['Places', 'model/owner-intelligence.ts'],
      ['Links', 'main.ts'],
      ['New link', 'model/links.ts'],
      ['Channels', 'model/links.ts'],
      ['Sign-up', 'views/owners.ts'],
      ['Owners', 'views/owners.ts'],
      ['VISITOR DATA', 'model/system-status.ts'],
      ['Documents', 'main.ts'],
    ];
    for (const [label, file] of labels) {
      expect(runbook, label).toContain(`\`${label}\``);
      expect(admin(file), `${label}: not in ${file}`).toMatch(new RegExp(`['\`]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\`]`));
    }
    const copy = readDoc('genome/src/web/verify/copy.ts');
    for (const words of ['FIRST NAME', 'LAST NAME', 'COUNTRY', 'HOW DID YOU HEAR ABOUT ORBES?', 'YOUR PROFILE', 'CONFIRM YOUR DATE OF BIRTH', 'YOUR TASTES', 'WISHLIST', 'YOUR WISHLIST', 'SEE THE MODEL', 'REMOVE', 'EXCHANGE THE SIZE', 'YOUR ADDRESSES', 'YOUR SIZES']) {
      expect(runbook, words).toContain(words);
      expect(copy, words).toContain(`'${words}'`);
    }
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(30);
    for (const c of fenced(runbook, 'bash')) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-CUSTOMER-INTELLIGENCE.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-CUSTOMER-INTELLIGENCE.md)');
  });
});
