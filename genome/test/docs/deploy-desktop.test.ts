/**
 * docs/launch/DEPLOY-DESKTOP.md, the owner's runbook for the desktop (the desktop plan of 2026-10-16, §4 and step 16),
 * against the scripts, the server and the app it quotes:
 *
 *  - it starts from production as it runs when the desktop starts (ORBES CARE, c3d25c2, 0001 to 0048) and applies no
 *    migration, as the scripts print it: the lines `db_applied_migrations` and deploy.sh print before, the line
 *    `db.ts migrate` prints when nothing is pending, the success line of a release without migration (its manual
 *    rollback to ORBES CARE's image), the deployment log and the count `db.ts status` shows; the rollback stays possible;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts and the app is still one they print;
 *  - the owner's rules: his look at the screens first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the hub's backup
 *    minutes (Paris first, UTC in brackets), no slot booked and a heads-up at launch, nothing changed on the host (the
 *    deploy/vps diff against c3d25c2, empty) and no migration (the server's db diff, empty), the box's figures before
 *    and after, the guarded launch, restore.sh only ever run to watch it refuse, no prune; the legal pages unchanged at
 *    LEGAL_VERSION (the owner's answer Q3); the public branch orbes-desktop, never main nor a pull request (Q5);
 *    theorbes.com untouched;
 *  - the post-check from the Mac: the new route answers 401 signed out (it is the server's, behind the account
 *    session), and the app's page links its two desktop stylesheets under their media, as the build names them;
 *  - one real check per element, on the phone (unchanged) and on a computer, in the app's words as they show them;
 *    Client Services told (the playbook's computer lines, both copies); one command per shell block, relative links
 *    that resolve, and the runbook linked from DEPLOYMENT.
 *
 * <SHA_DESK> and <TAG_DESK> stay placeholders until the main session hands the commit over.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryOutName } from '../../scripts/build-web.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { DESKTOP_QUERY, POINTER_QUERY } from '../../src/web/shared/desktop.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { DESKTOP, ORBES_CARE, ORDERS, PIECES } from '../../src/web/verify/copy.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-DESKTOP.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** What production runs when the desktop starts: ORBES CARE (the plan's base), deployed after I2. */
const PROD_COMMIT = 'c3d25c207a9429aa927ef1b9ba39404e208c2f2e';
const PROD_TAG = PROD_COMMIT.slice(0, 12);
/** I2's image, ORBES CARE's previous one, as ORBES CARE's deployment log line names it (DEPLOY-ORBES-CARE §1.6). */
const I2_TAG = '90d9d3007e20';

const NAMES = Object.keys(MIGRATIONS);

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
  ['Schema is up to date.', 'genome/scripts/db.ts'],
  ['database ready: migrations applied, app role ', 'deploy/vps/scripts/lib.sh'],
  ['an ACTIVE signing key exists', 'deploy/vps/scripts/deploy.sh'],
  ['smoke tests via https://', 'deploy/vps/scripts/deploy.sh'],
  ['/.well-known/orbes-keys.json lists an ACTIVE key', 'deploy/vps/scripts/deploy.sh'],
  ['/verify: 200', 'deploy/vps/scripts/deploy.sh'],
  ['. Manual rollback: scripts/deploy.sh --image ', 'deploy/vps/scripts/deploy.sh'],
  [' OK (previous ', 'deploy/vps/scripts/deploy.sh'],
  ['rollback to orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['rolled back to ', 'deploy/vps/scripts/deploy.sh'],
  ['; the stack is healthy', 'deploy/vps/scripts/deploy.sh'],
  [' is NOT healthy either', 'deploy/vps/scripts/deploy.sh'],
  ['photos: ', 'deploy/vps/scripts/backup.sh'],
  ['db.dump: ', 'deploy/vps/scripts/backup.sh'],
  ['backup complete: ', 'deploy/vps/scripts/backup.sh'],
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', 'deploy/vps/scripts/restore.sh'],
  ['Nothing was done.', 'deploy/vps/scripts/restore.sh'],
  ['live engine: leading', 'genome/src/server/services/live-engine.ts'],
];

describe('the runbook of the desktop (docs/launch/DEPLOY-DESKTOP.md)', () => {
  it('starts from ORBES CARE in production, 0001 to 0048, and applies no migration, as the scripts print it', () => {
    // No migration since ORBES CARE: the last one is still 0048_orbes_care.
    expect(NAMES).toHaveLength(49);
    expect(NAMES.at(-1)).toBe('0048_orbes_care');
    expect(runbook).toContain(`le commit \`${PROD_COMMIT}\` (image \`orbes-genome:${PROD_TAG}\`), avec les quarante-neuf migrations de \`${NAMES[0]}\` à \`${NAMES.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : quarante-neuf lignes, de \`${NAMES[0]}\` à \`${NAMES.at(-1)}\``);
    expect(outputs.join('\n')).toContain(NAMES.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${NAMES.length} migration(s) applied, all known to orbes-genome:<TAG_DESK>`);
    expect(runbook).toContain(`**Il faut lire \`${NAMES.length} migration(s)\`.**`);
    // db.ts migrate with nothing pending, and a table of migrations nowhere.
    expect(readDoc('genome/scripts/db.ts')).toContain("'Schema is up to date.'");
    expect(outputs.join('\n')).toContain('Schema is up to date.');
    expect(runbook).toContain('**Il faut lire `Schema is up to date.`**');
    expect(runbook).not.toMatch(/Applied \d+ migration\(s\)/);
    expect(section(runbook, '### 1.0')).not.toMatch(/\| `\d{4}_[a-z0-9_]+` \|/);
    // The success line of a release without migration whose previous image knows every migration: its manual rollback.
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('log "deployed $IMAGE (previous: $PREV_TAG). Manual rollback: scripts/deploy.sh --image $PREV_TAG"');
    expect(runbook).toContain(`deployed orbes-genome:<TAG_DESK> (previous: ${PROD_TAG}). Manual rollback: scripts/deploy.sh --image ${PROD_TAG}`);
    expect(runbook).not.toContain('cannot run on this schema any more');
    expect(runbook).toContain(`previous image tag: ${PROD_TAG}`);
    // The deployment log: no migrations note.
    expect(runbook).toContain(`\`… deploy <TAG_DESK> OK (previous ${PROD_TAG})\`, sans migration`);
    expect(runbook).toContain(`les ${NAMES.length} lignes \`applied\`, de \`${NAMES[0]}\` à \`${NAMES.at(-1)}\``);
    // ORBES CARE as the last deployment: its log line exactly as DEPLOY-ORBES-CARE §1.6 expects it.
    expect(runbook).toContain(`\`… deploy ${PROD_TAG} OK (previous ${I2_TAG}; migrations 0048_orbes_care)\``);
    expect(readDoc('docs/launch/DEPLOY-ORBES-CARE.md')).toContain(`deploy <TAG_CARE> OK (previous ${I2_TAG}; migrations 0048_orbes_care)`);
    expect(runbook).toContain(`Sortie attendue : \`${PROD_COMMIT}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${PROD_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${PROD_COMMIT.slice(0, 7)}..<7 caractères de SHA_DESK>\``);
    // <SHA_DESK> and <TAG_DESK> stay placeholders until the main session hands the commit over.
    expect(runbook).toContain('`<SHA_DESK>` est le commit final (40 caractères)');
    // The plan §4: a runbook re-based first when production runs another image.
    expect(runbook).toContain('Si la dernière ligne OK de `.state/deploys.log` nomme une autre image');
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
  });

  it("holds the owner's rules: nothing changes on the host, no migration, the legal pages unchanged, theorbes.com untouched", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les écrans d'abord.**");
    // Paris first, UTC in brackets.
    expect(rules).toContain("**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(rules).toContain("03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)");
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC");
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé");
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(rules).toContain('**Aucune migration**');
    expect(rules).toContain('**Jamais `restore.sh` sur ce serveur**');
    expect(rules).toContain('**Le site theorbes.com ne change pas.**');
    // The public branch (Q5): its own remote branch, never main, never a pull request; the deploy branch pushed on his OK.
    expect(rules).toContain('la branche `orbes-desktop` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The heads-up at launch and after.
    expect(section(runbook, '### 1.4')).toContain("« Version ordinateur : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_DESK>, aucune migration, rien ne change sur l'hôte.");
    expect(section(runbook, '### 1.6')).toContain("**Préviens le responsable de l'hôte**");
    // The deploy/vps diff and the server's db diff against production's commit, nothing expected; no Caddy recreated.
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${PROD_COMMIT} HEAD -- deploy/vps`);
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${PROD_COMMIT} HEAD -- genome/src/server/db`);
    expect(section(runbook, '### 1.3')).toContain('Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi');
    expect(section(runbook, '### 1.4')).not.toContain('Recreate`');
    // The box's figures before and after, the swap line read.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c), c).toHaveLength(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(commands.filter((c) => /docker image rm/.test(c))).toEqual([]);
    expect(section(runbook, '### 1.4')).toContain("**Note le nom de l'archive et sa taille en octets**");
    // The rollback: ORBES CARE's image, guarded, never removed; no data changed.
    const wrong = section(runbook, '### 1.5');
    expect(wrong).toContain(`\`pgrep -a pg_dump \\|\\| scripts/deploy.sh --image ${PROD_TAG}\``);
    expect(wrong).toContain(`**ne retire jamais l'image \`${PROD_TAG}\`**`);
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('rolling out the existing image $IMAGE (no build)');
    // The legal pages (Q3): no new version, the conditions' PDF with them.
    expect(LEGAL_VERSION).toBe('2026-10-15');
    expect(CARE_CONDITIONS_VERSION).toBe(LEGAL_VERSION);
    expect(rules).toContain(`la version reste \`${LEGAL_VERSION}\` (ta réponse Q3)`);
    expect(section(runbook, '### 1.3')).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${LEGAL_VERSION}';\`, la version d'aujourd'hui, inchangée.`);
  });

  it('checks from the Mac the new route, signed out, and the two desktop stylesheets the page links', () => {
    const after = section(runbook, '### 1.6');
    // The route is the server's own, behind the account session: signed out, 401.
    const route = '/api/v1/account/messages/unread-count';
    const routes = readDoc('genome/src/server/routes/messages.ts');
    expect(routes).toContain(`app.get('${route}'`);
    expect(routes.slice(routes.indexOf(`app.get('${route}'`))).toMatch(/^[^]*?requireAccount\(request\)/);
    expect(fenced(after, 'bash')).toContain(`curl -s -o /dev/null -w '%{http_code}\\n' https://verify.theorbes.com${route}`);
    expect(after).toContain('Sortie attendue : `401`');
    // The page links its hover sheet and its layout sheet, each under its query, as the build names them: two lines.
    const shell = readDoc('genome/src/web/verify/index.html');
    expect(shell).toContain(`<link rel="stylesheet" href="./desktop-pointer.css" media="${POINTER_QUERY}">`);
    expect(shell).toContain(`<link rel="stylesheet" href="./desktop.css" media="${DESKTOP_QUERY}">`);
    expect(entryOutName('verify', 'desktop-pointer.css')).toBe('verify-desktop-pointer');
    expect(entryOutName('verify', 'desktop.css')).toBe('verify-desktop');
    expect(shell.split('\n').filter((l) => /href="\.\/desktop/.test(l))).toHaveLength(2);
    expect(fenced(after, 'bash')).toContain("curl -s https://verify.theorbes.com/verify | grep -c 'verify-desktop-'");
    expect(after).toContain('Sortie attendue : `2`');
  });

  it('tells ORBES Client Services before (the playbook\'s computer lines, both copies) and lists what stays open', () => {
    const before = section(runbook, '### 1.1');
    for (const what of ["**1. Tes écrans d'abord**", '**ORBES CARE est en production**', '**Aucune LIVE RELEASE**', '**aucun test de TEST ENTRANTS**', '**Préviens ORBES Client Services**']) expect(before, what).toContain(what);
    for (const what of ['en mode sombre et en mode clair', '1024 × 768 et 1920 × 1080', 'la liste des choix par défaut (D1 à D21)']) expect(before, what).toContain(what);
    for (const s of ["§2 « Sur un ordinateur : la page d'une commande »", '§3 « Sur un ordinateur, MESSAGES par sujet »', '§3 UNREADABLE CODE']) expect(before, s).toContain(s);
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const playbook = readDoc(copy);
      expect(playbook, copy).toContain("### Sur un ordinateur : la page d'une commande");
      expect(playbook, copy).toContain('**Sur un ordinateur, MESSAGES par sujet.**');
      expect(playbook, copy).toContain('### UNREADABLE CODE');
    }
    const next = section(runbook, '### 1.8');
    for (const what of ['**Préviens ORBES Client Services**', '**Les deux défauts de la production vus en passant**', "**Garde l'image `c3d25c207a94`**"]) expect(next, what).toContain(what);
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4]);
    expect(open).toContain(`\`${DESKTOP.scanPage.url}\``);
  });

  it("checks each element for real, on the phone and on a computer, in the app's words as they show them", () => {
    const checks = section(runbook, '### 1.7');
    for (const what of ['Le téléphone', 'NOW', 'THE RELEASES', 'Un modèle', "L'onglet ORBES CARE", 'SCAN', 'La connexion', 'YOUR ACCOUNT et MESSAGES', 'Une commande', 'Les pages légales', 'Le mode clair', 'La console du navigateur']) {
      expect(checks, what).toContain(`| ${what} |`);
    }
    expect(checks).toContain('Exactement comme hier : rien ne change sur un téléphone');
    // The app's words.
    expect(checks).toContain(`La page ${DESKTOP.scanPage.title}`);
    expect(checks).toContain(DESKTOP.scanPage.upload);
    expect(checks).toContain(`ouvre ${DESKTOP.scanPage.address} sur le téléphone`);
    expect(checks).toContain([DESKTOP.viewer.previous, DESKTOP.viewer.next].join(', ') + ` et ${DESKTOP.viewer.close}`);
    expect(checks).toContain(`${DESKTOP.signIn.signIn} et ${DESKTOP.signIn.create}`);
    expect([PIECES.tabs.ownership, PIECES.tabs.care, PIECES.tabs.service].join(' · ')).toBe('OWNERSHIP · ORBES CARE · SERVICE');
    expect(checks).toContain(`${ORBES_CARE.warranty.label} à gauche`);
    expect(checks).toContain(ORBES_CARE.careLabel);
    expect(checks).toContain(`${ORDERS.documents.title} avec ${ORDERS.documents.careConditions} · PDF`);
    expect(checks).toContain(`« ${WORDS.en.version(LEGAL_VERSION)} »`);
    expect(checks).toContain('SOUND OFF');
    for (const words of ['NOW · RELEASES · COLLECTION · CIRCLE · PIECES', 'WRITE TO ORBES CLIENT SERVICES', 'LIGHT MODE', 'PRIVATE CARE']) expect(checks, words).toContain(words);
    // His real photographs, first seen here (D17).
    expect(checks).toContain('Tes vraies photographies dans leurs cadres');
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT', () => {
    expect(commands.length).toBeGreaterThan(30);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-DESKTOP.md)');
    // Never the words the brand keeps out of what it says, in the runbook's quotes of the app.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\bQR\b/);
  });
});
