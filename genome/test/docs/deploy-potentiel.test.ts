/**
 * docs/launch/DEPLOY-POTENTIEL-2026-10.md, the owner's runbook for the deployments of the « Potentiel » lot (plan of
 * 2026-10-03: A, then B and C, which the owner combined on 2026-10-04 into one stage and one deployment, B+C), against
 * the scripts and the migrations it quotes:
 *
 *  - its starting point is the production of 2026-10-03 (commit 3660154, image 3660154006b5, migrations 0001 to
 *    0013), the end of the previous runbook (DEPLOY-RECOMMANDATIONS-2026-10.md, deploy-runbook.test.ts);
 *  - every migration after 0013 belongs to one deployment of the plan's table (A: 0014 to 0018, done on 2026-10-04;
 *    B+C: 0019 and 0020), and each deployment applies exactly its migrations that exist, in order: the table of its
 *    section, the line `db.ts migrate` prints, those deploy.sh prints after it, and the count `db.ts status` shows;
 *  - deployment A is recorded as done (2026-10-04, 03:27 UTC, image ce5bf886d444, fix forward), and B+C starts from
 *    it: its commit check, its window and its date (the B+C LEGAL_VERSION), the pre-check with `pgrep -a pg_dump`,
 *    the host's OK, the fast-forward, the guarded launch `pgrep -a pg_dump || scripts/deploy.sh`, its failures and
 *    post-checks, one real check per item of B and C, and C itself merged into it;
 *  - deployment B+C is recorded as done on 2026-10-04 (the owner's launch, commit 78959e8), its version 2026-10-05
 *    published a few hours before its date, so the next legal version comes after it;
 *  - deployment D of the LIVE RELEASE (plan of 2026-10-04) holds 0021 alone, with its own runbook, after B+C;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh and lib.sh is still one they print;
 *  - the rules of the shared host: never 03:00–05:30 UTC, the pre-check of DEPLOYMENT §15.7 before and after,
 *    restore.sh only ever run to watch it refuse (--dry-run), no prune, the fast-forward to the final commit after
 *    its check, the disk thresholds;
 *  - one command per shell block, only variables of the stack's .env.example, the console's shell commands as
 *    scripts/db.ts knows them, and relative links (anchors included) that resolve.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB_USAGE } from '../../scripts/db.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-POTENTIEL-2026-10.md';
const runbook = readDoc(RUNBOOK);
const stackFile = (name: string): string => readDoc(`deploy/vps/${name}`);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** The production the lot starts from: deployment 3 of the previous runbook (§3.5), live since 2026-10-03, 19:44 UTC. */
const START_COMMIT = '3660154006b5016509856930a0255377584a6084';
const START_TAG = START_COMMIT.slice(0, 12);
const NAMES = Object.keys(MIGRATIONS);
const START_MIGRATIONS = NAMES.filter((n) => n <= '0013_ownership_certificates');
/** The migrations of the plan's table (« Déploiements »), by number. */
const numberOf = (name: string): number => Number(name.slice(0, 4));
const DEPLOY_A = NAMES.filter((n) => numberOf(n) >= 14 && numberOf(n) <= 18);
const DEPLOY_BC = NAMES.filter((n) => numberOf(n) >= 19 && numberOf(n) <= 20);
/** Deployment A, live since 2026-10-04, 03:27 UTC: the start of deployment B+C. */
const A_COMMIT = 'ce5bf886d4444c487ab65fd1c28b2c8822f8e98b';
const A_TAG = A_COMMIT.slice(0, 12);
/** The items of stage BC, in the plan's order (B then C, combined by the owner on 2026-10-04). */
const BC_ITEMS = ['P-D01', 'P-M02', 'P-R06', 'P-X08', 'P-D07', 'P-D10'] as const;
/** Deployment D, the LIVE RELEASE (plan of 2026-10-04): 0021, deployed after B+C, with its own runbook. */
const DEPLOY_D = NAMES.filter((n) => numberOf(n) === 21);
/** The one LEGAL_VERSION of deployment B+C, published: a date published never changes, and the next one comes after it. */
const BC_LEGAL_VERSION = '2026-10-05';

/** The rows `| \`0014_…\` |` of the migrations table of a section. */
const tableRows = (md: string): string[] => [...md.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]!);

/** What the runbook expects from the scripts, each printed word for word by its source. */
const MESSAGES: ReadonlyArray<readonly [message: string, source: string]> = [
  ['= commit ', 'scripts/deploy.sh'],
  ['build orbes-genome:', 'scripts/deploy.sh'],
  ['Caddy configuration valid (TLS_MODE=', 'scripts/lib.sh'],
  ['previous image tag: ', 'scripts/deploy.sh'],
  [' migration(s) applied, all known to ', 'scripts/deploy.sh'],
  ['cannot read the applied migrations (kysely_migration): ', 'scripts/deploy.sh'],
  ['cannot list the migrations ', 'scripts/deploy.sh'],
  ['nothing was changed', 'scripts/deploy.sh'],
  ['nothing else was changed', 'scripts/deploy.sh'],
  ['pre-deploy backup', 'scripts/deploy.sh'],
  ['roll out ', 'scripts/deploy.sh'],
  [' is healthy', 'scripts/lib.sh'],
  ['stopping the running app before migrating to ', 'scripts/deploy.sh'],
  ['database ready: migrations applied, app role ', 'scripts/lib.sh'],
  ['an ACTIVE signing key exists', 'scripts/deploy.sh'],
  ['smoke tests via https://', 'scripts/deploy.sh'],
  ['/.well-known/orbes-keys.json lists an ACTIVE key', 'scripts/deploy.sh'],
  ['/verify: 200', 'scripts/deploy.sh'],
  ['. This release applied the migration(s) ', 'scripts/deploy.sh'],
  [' cannot run on this schema any more (scripts/deploy.sh --image ', 'scripts/deploy.sh'],
  ['If anything goes wrong, repair forward: scripts/deploy.sh --image ', 'scripts/deploy.sh'],
  [' after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).', 'scripts/deploy.sh'],
  [' OK (previous ', 'scripts/deploy.sh'],
  ['; migrations ', 'scripts/deploy.sh'],
  ['no rollback: repair forward', 'scripts/deploy.sh'],
  [' and is KEPT', 'scripts/deploy.sh'],
  ['Repair forward:', 'scripts/deploy.sh'],
  ['rollback to orbes-genome:', 'scripts/deploy.sh'],
  ['rolled back to ', 'scripts/deploy.sh'],
  ['; the stack is healthy', 'scripts/deploy.sh'],
  [' is NOT healthy either', 'scripts/deploy.sh'],
  ['this image cannot run on this schema: repair forward', 'scripts/deploy.sh'],
  ['photos: ', 'scripts/backup.sh'],
  ['db.dump: ', 'scripts/backup.sh'],
  ['keys.tar: ', 'scripts/backup.sh'],
  [' key file(s)', 'scripts/backup.sh'],
  ['encrypt to ', 'scripts/backup.sh'],
  ['backup complete: ', 'scripts/backup.sh'],
  ['[dry-run] would ', 'scripts/backup.sh'],
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', 'scripts/restore.sh'],
  ['Decision of 2026-10-03: ', 'scripts/restore.sh'],
  ['Nothing was done.', 'scripts/restore.sh'],
];

describe('the « Potentiel » runbook (docs/launch/DEPLOY-POTENTIEL-2026-10.md)', () => {
  it('starts from the production of 2026-10-03: commit 3660154, its image, the migrations 0001 to 0013', () => {
    expect(START_MIGRATIONS).toHaveLength(13);
    expect(runbook).toContain(`la production tourne le commit \`${START_COMMIT}\` (image \`orbes-genome:${START_TAG}\`)`);
    expect(commands).toContain("git -C /opt/orbes/orbes-index log -1 --format='%H %s'");
    expect(runbook).toContain(`Sortie attendue : \`${START_COMMIT} `);
    expect(runbook).toContain(`ORBES_IMAGE_TAG=${START_TAG}`);
    // What db_applied_migrations reads before deployment A, line for line.
    expect(outputs).toContain(START_MIGRATIONS.join('\n'));
    expect(runbook).toContain(`schema: ${START_MIGRATIONS.length} migration(s) applied, all known to orbes-genome:<TAG_A>`);
  });

  it('gives every migration after 0013 to a deployment of the plan, and deployment A exactly its own, in order, as the scripts print them', () => {
    // The plan's table: A 0014–0018, B+C 0019–0020; then the LIVE RELEASE's D, 0021. A later number needs a plan
    // (and a runbook) first: 0022 and 0023 are LIVE RELEASE+'s (orders, stock and operations; releases and collectors,
    // plan of 2026-10-04); 0024 is NOCTURNE's (a model's variants and a draw's price, plan of 2026-10-05); 0024a TEST
    // ENTRANTS' (2026-10-07).
    expect(NAMES.filter((n) => numberOf(n) > 13 && numberOf(n) <= 21)).toEqual([...DEPLOY_A, ...DEPLOY_BC, ...DEPLOY_D]);
    expect(NAMES.filter((n) => numberOf(n) > 21)).toEqual(['0022_orders_stock', '0023_releases_collectors', '0024_model_variants', '0024a_test_entrants']);
    expect(DEPLOY_D).toEqual(['0021_live_release']);
    // This runbook hands 0021 to deployment D, which has its own runbook and starts from B+C's production.
    expect(runbook).toContain('Après ce lot, la migration `0021` (la LIVE RELEASE, plan du 2026-10-04) part avec le déploiement D, qui a [son propre runbook](DEPLOY-LIVE-RELEASE.md) et part de la production de B+C (le commit `78959e8`, les migrations `0001` à `0020`).');
    expect(DEPLOY_A[0]).toBe('0014_model_lookbook');
    expect(DEPLOY_BC).toEqual(['0019_model_discontinued', '0020_private_salon']);
    // The tables of §1.0 and §2: the existing migrations of each deployment, nothing else; §3 (C) has none.
    expect(tableRows(section(runbook, '### 1.0'))).toEqual(DEPLOY_A);
    expect(tableRows(section(runbook, '## 2.'))).toEqual(DEPLOY_BC);
    expect(tableRows(section(runbook, '### 2.0'))).toEqual(DEPLOY_BC);
    expect(tableRows(section(runbook, '## 3.'))).toEqual([]);
    // During: db.ts migrate's own line; after: deploy.sh's success lines, the deployment log, db.ts status.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY_A.length} migration(s): ${DEPLOY_A.join(', ')}`);
    expect(runbook).toContain(`(previous: ${START_TAG}). This release applied the migration(s) ${DEPLOY_A.join(', ')}:`);
    expect(runbook).toContain(`deploy <TAG_A> OK (previous ${START_TAG}; migrations ${DEPLOY_A.join(', ')})`);
    expect(runbook).toContain(`orbes-genome:${START_TAG} cannot run on this schema any more`);
    expect(runbook).toContain(`les ${START_MIGRATIONS.length + DEPLOY_A.length} lignes \`applied\`, de \`${NAMES[0]}\` à \`${DEPLOY_A.at(-1)}\``);
  });

  it('expects from the scripts only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(stackFile(source), `${message}: not in ${source}`).toContain(message);
    }
  });

  it('keeps the rules of the shared host: the window, the pre-check before and after, no restore, no prune, the commit checked before it is merged', () => {
    expect(runbook).toContain('**Jamais entre 03:00 et 05:30 UTC**');
    expect(runbook).toContain('**Jamais `restore.sh` sur ce serveur**');
    for (const c of commands.filter((c) => /restore\.sh/.test(c))) expect(c).toMatch(/--dry-run/);
    for (const c of commands) expect(c).not.toMatch(/\bprune\b/);
    const deployment = readDoc('docs/DEPLOYMENT.md');
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) {
      expect(deployment).toContain(c);
      expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    }
    const check = commands.indexOf("git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk");
    const merge = commands.indexOf('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    const deploy = commands.indexOf('scripts/deploy.sh');
    expect(commands.indexOf('umask 022')).toBeGreaterThan(-1);
    expect(commands.indexOf('umask 022')).toBeLessThan(check);
    expect(check).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(check);
    expect(deploy).toBeGreaterThan(merge);
    // RESTORE_ALLOWED=false stays as deployment 2 wrote it.
    expect(commands).toContain("grep -n '^RESTORE_ALLOWED=' .env");
    expect(runbook).toContain('`<numéro>:RESTORE_ALLOWED=false`');
    for (const t of ['75 %', '300 Mo', '80 %']) expect(section(runbook, '### 1.8'), t).toContain(t);
    // Old images by exact tag only, never the current one nor the one before it.
    for (const c of commands.filter((c) => c.startsWith('docker image rm '))) {
      expect(c).toMatch(/^docker image rm orbes-genome:[0-9a-f]{12}$/);
      expect(c).not.toContain(START_TAG);
    }
  });

  it('checks the edge and the photographs after deployment A: the 413 outside the uploads, the lookbook, the budget of the photographs', () => {
    expect(commands).toContain(
      "head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify",
    );
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/lookbook');
    expect(commands).toContain(`curl -s -o /dev/null -D - https://verify.theorbes.com/api/v1/media/${'0'.repeat(64)}`);
    expect(runbook).toContain('`x-ratelimit-limit: 600`');
    // The Caddy exception covers the uploads of the gallery (P-R02) and of the circle's photographs (P-X01): deploy.sh recreates Caddy itself.
    // Deployment D (the LIVE RELEASES) adds a release's silhouette to the same rule.
    expect(stackFile('Caddyfile')).toContain('path_regexp ^/api/admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette)/?$');
  });

  it('gives one command per shell block, sets only the stack’s variables, and runs the tools as they are', () => {
    expect(commands.length).toBeGreaterThan(30);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    const env = stackFile('.env.example');
    for (const c of commands.filter((c) => />> \.env$/.test(c))) {
      for (const [, name] of c.matchAll(/([A-Z][A-Z0-9_]{2,})=/g)) expect(env, name).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    }
    for (const c of commands.filter((c) => c.includes('scripts/db.ts'))) {
      const [, sub] = c.match(/scripts\/db\.ts ([a-z-]+)/)!;
      expect(DB_USAGE, sub).toMatch(new RegExp(`^\\s+${sub}\\b`, 'm'));
    }
    for (const fn of ['db_applied_migrations', 'db_photo_usage']) {
      expect(commands).toContain(`bash -c 'set -Eeuo pipefail; source scripts/lib.sh; ${fn}'`);
      expect(stackFile('scripts/lib.sh')).toContain(`${fn}() {`);
    }
    expect(stackFile('scripts/restore.sh')).toMatch(/--identity\)/);
    expect(stackFile('scripts/backup.sh')).toMatch(/--dry-run\)/);
  });

  it('records deployment A as done: 2026-10-04, 03:27 UTC, its image and commit, its migrations, fix forward', () => {
    expect(runbook).toContain('| A | P-R02, P-R03, P-X01, P-X02, P-X04 |');
    expect(runbook).toContain('**Fait** le 2026-10-04 à 03:27 UTC (§1)');
    const a = section(runbook, '## 1.');
    expect(a.split('\n')[0]).toBe('');
    expect(runbook).toContain('## 1. Déploiement A : fait le 2026-10-04');
    for (const s of ['**2026-10-04 à 03:27:10 UTC**', `\`orbes-genome:${A_TAG}\``, `\`${A_COMMIT}\``, `\`orbes-${'20261004T032650Z'}-pre-deploy-${A_TAG}.tar.age\``, '**On répare en avant**', `\`scripts/deploy.sh --image ${A_TAG}\``, 'pgrep -a pg_dump || scripts/deploy.sh']) {
      expect(a, s).toContain(s);
    }
    expect(a).toContain(`l'image précédente, \`${START_TAG}\`, ne peut plus tourner sur ce schéma`);
    // The A post-check of the reserved models names the section as it reads since B+C, never its former words.
    expect(runbook).not.toContain('RESERVED FOR OWNERS');
    expect(section(runbook, '### 1.7')).toContain('`THE PRIVATE SALON` depuis le déploiement B+C');
  });

  it('records deployment B+C as done on 2026-10-04, from its final commit, its version published before its date', () => {
    expect(runbook).toContain('## 2. Déploiement B+C : fait le 2026-10-04');
    const bc = section(runbook, '## 2.');
    for (const s of ['**Ce qui s\'est passé.**', '**2026-10-04**', '`78959e8516cc146a297cab46ddec68e157fe2847`', '`orbes-genome:78959e8516cc`', 'soit vingt en tout', `\`${BC_LEGAL_VERSION}\``, '**publiée le 2026-10-04, quelques heures avant sa date**', '**On répare en avant**', `l'image de A, \`${A_TAG}\`, ne peut plus tourner sur ce schéma`, '`deploys.log`']) {
      expect(bc, s).toContain(s);
    }
    expect(NAMES.filter((n) => numberOf(n) <= 20)).toHaveLength(20);
    // Rule 7: the next legal version comes after B+C's.
    expect(runbook).toContain('B+C a publié `2026-10-05`, mis en ligne le 2026-10-04 (§2) ; le prochain déploiement qui change les pages légales porte donc une date postérieure, le 2026-10-06 au plus tôt.');
  });

  it('combines B and C into one deployment B+C, from deployment A, with its two migrations, as the scripts print them', () => {
    expect(runbook).toContain(`| B+C | ${BC_ITEMS.join(', ')} | \`0019\` et \`0020\` | **Fait** le 2026-10-04 (§2) |`);
    expect(runbook).not.toMatch(/^\| [BC] \|/m);
    const bc = section(runbook, '## 2.');
    // The start: A's commit, its image, its eighteen migrations.
    expect(bc).toContain(`Sortie attendue : \`${A_COMMIT} P-A: address the stage review, …\``);
    expect(bc).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${A_TAG}\`.`);
    expect(fenced(bc, 'text')).toContain(NAMES.filter((n) => numberOf(n) <= 18).join('\n'));
    expect(bc).toContain(`schema: ${START_MIGRATIONS.length + DEPLOY_A.length} migration(s) applied, all known to orbes-genome:<TAG_BC>`);
    expect(bc).toContain(`previous image tag: ${A_TAG}`);
    // During and after: db.ts migrate's line, deploy.sh's lines, the deployment log, db.ts status.
    expect(bc).toContain(`Applied ${DEPLOY_BC.length} migration(s): ${DEPLOY_BC.join(', ')}`);
    expect(bc).toContain('Applied 2 migration(s): 0019_model_discontinued, 0020_private_salon');
    expect(bc).toContain(`(previous: ${A_TAG}). This release applied the migration(s) ${DEPLOY_BC.join(', ')}:`);
    expect(bc).toContain(`orbes-genome:${A_TAG} cannot run on this schema any more`);
    expect(bc).toContain(`deploy <TAG_BC> OK (previous ${A_TAG}; migrations ${DEPLOY_BC.join(', ')})`);
    expect(bc).toContain(`les ${NAMES.filter((n) => numberOf(n) <= 20).length} lignes \`applied\`, de \`${NAMES[0]}\` à \`${DEPLOY_BC.at(-1)}\``);
    // The failure table: the stop before roll out, the rollback to A's image, its failure, the repair forward.
    const failures = section(runbook, '### 2.5');
    for (const s of ['`<numéro> pg_dump …`', 'nothing was changed', `rolled back to ${A_TAG}; the stack is healthy`, `rollback to ${A_TAG} is NOT healthy either`, '`── no rollback: repair forward`', `\`scripts/deploy.sh --image <TAG_BC>\``, `**jamais \`scripts/deploy.sh --image ${A_TAG}\`**`]) {
      expect(failures, s).toContain(s);
    }
    // No change of Caddy, no variable to set: CARE_SUBSCRIBE_URL stays empty, optional, a variable of the stack.
    expect(section(runbook, '### 2.0')).toContain('**Caddy** : rien ne change');
    expect(section(runbook, '### 2.0')).toContain('`CARE_SUBSCRIBE_URL` (P-M02, l\'adresse de la page d\'abonnement d\'ORBES Care) est **facultative et reste vide**');
    expect(stackFile('.env.example')).toMatch(/^CARE_SUBSCRIBE_URL=$/m);
    expect(stackFile('compose.yaml')).toContain('CARE_SUBSCRIBE_URL: ${CARE_SUBSCRIBE_URL:-}');
  });

  it('runs B+C as A ran: the window and its day, the pre-check with pg_dump, the host\'s OK, the commit checked, the guarded launch', () => {
    const bc = section(runbook, '## 2.');
    const cmds = fenced(bc, 'bash');
    // The window, and the day of the one LEGAL_VERSION of B+C, distinct from A's published 2026-10-04.
    expect(BC_LEGAL_VERSION).not.toBe('2026-10-04');
    // From deployment D on (the LIVE RELEASE, 0021), the version in the code comes after B+C's (rule 7).
    expect(DEPLOY_D).toHaveLength(1);
    expect(LEGAL_VERSION > BC_LEGAL_VERSION).toBe(true);
    expect(section(runbook, '### 2.0')).toContain(`\`LEGAL_VERSION\` \`${BC_LEGAL_VERSION}\``);
    expect(section(runbook, '### 2.0')).toContain(`B+C devait donc se déployer **le ${BC_LEGAL_VERSION}**`);
    expect(section(runbook, '### 2.0')).toContain('Il est parti le 2026-10-04 : ses pages légales affichent la date du lendemain');
    expect(section(runbook, '### 2.1')).toContain(`Sortie attendue : le **${BC_LEGAL_VERSION}** (\`Mon Oct  5 …\`), à une heure **hors** de 03:00–05:30 UTC.`);
    expect(cmds).toContain('date -u');
    // The pre-check, a backup running, the host's OK, then the fast-forward to the checked commit.
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) expect(cmds.filter((x) => x === c).length, c).toBe(2);
    const pre = cmds.indexOf('pgrep -a pg_dump');
    const check = cmds.indexOf("git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk");
    const merge = cmds.indexOf('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    const launch = cmds.indexOf('pgrep -a pg_dump || scripts/deploy.sh');
    expect(cmds.indexOf('umask 022')).toBeGreaterThan(-1);
    expect(pre).toBeGreaterThan(cmds.indexOf('umask 022'));
    expect(check).toBeGreaterThan(pre);
    expect(merge).toBeGreaterThan(check);
    expect(launch).toBeGreaterThan(merge);
    // Never a bare deploy.sh in B+C: every launch is guarded (the later ORBES Care one too).
    expect(cmds.filter((c) => /scripts\/deploy\.sh/.test(c) && !c.startsWith('pgrep -a pg_dump || '))).toEqual([]);
    expect(section(runbook, '### 2.1')).toContain('**6. L\'accord.**');
    expect(section(runbook, '## 0.')).toContain('**Le lancement est gardé** : `pgrep -a pg_dump || scripts/deploy.sh`');
    expect(cmds).toContain("grep -n '^RESTORE_ALLOWED=' .env");
    expect(cmds).toContain("grep -n '^CARE_SUBSCRIBE_URL=' .env");
    // The post-checks: the deployment log, the services, db.ts status, the backup's photo line, restore.sh refused.
    for (const c of ['tail -n 1 .state/deploys.log', 'docker compose ps', 'docker compose exec app node --import tsx scripts/db.ts status', 'scripts/backup.sh --dry-run', 'scripts/restore.sh --identity /dev/null --latest --dry-run', 'curl -s https://verify.theorbes.com/api/v1/health', 'curl -s https://verify.theorbes.com/api/v1/client-services']) {
      expect(cmds, c).toContain(c);
    }
    // Then, in §2.6, the plan's external checks after every deployment (Vérification): the public routes, the 401
    // without a session, the 413 outside the photographs' uploads (the app is recreated with a new environment).
    const post = section(runbook, '### 2.6');
    for (const c of [
      "curl -s -o /dev/null -w '%{http_code}\\n' https://verify.theorbes.com/api/v1/club/lookbook",
      "head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify",
      'curl -s https://verify.theorbes.com/api/v1/lookbook',
    ]) {
      expect(fenced(post, 'bash'), c).toContain(c);
    }
    for (const s of ['Sortie attendue : `401`', 'Sortie attendue : `413`', 'sans aucun modèle réservé au salon privé (P-X08)']) expect(post, s).toContain(s);
  });

  it('gives each item of B and C one real check, and says C is merged into B+C', () => {
    const real = section(runbook, '### 2.7');
    const rows = real.split('\n').filter((l) => /^\| P-[A-Z]\d{2} \|/.test(l));
    expect([...new Set(rows.map((r) => r.slice(2, 7)))]).toEqual([...BC_ITEMS]);
    const of = (id: string) => rows.filter((r) => r.startsWith(`| ${id} |`)).join('\n');
    // P-D01: the ceremony, the share sheet or the file, reduced motion, no ceremony after a transfer.
    for (const s of ['`VIEW AS OWNER`', '`SHARE THE GENOME`', '1080 × 1350', '`ORBES-GENOME.png`', 'Réduire les animations', 'code de transfert']) expect(of('P-D01'), s).toContain(s);
    // P-M02: the CARE tab, its three lines, no link, no careSubscribeUrl.
    for (const s of ['`CARING FOR THIS PIECE`', '`ORBES CARE`', '*Subscriptions open soon.*', '`careSubscribeUrl`']) expect(of('P-M02'), s).toContain(s);
    // P-R06: discontinue after the phrase, the line last, the sheet, the certificate (page and PDF), the generator, reinstate.
    for (const s of ['`DISCONTINUE <préfixe SKU>`', '`DISCONTINUED · <année>`', 'le générateur ne le propose plus', '`DOWNLOAD PDF`', '`REINSTATE <préfixe SKU>`', 'a disparu']) expect(of('P-R06'), s).toContain(s);
    // P-X08: the price and tier, the salon, the request, the closing in Club → Requests.
    for (const s of ['`Private salon`', '`THE PRIVATE SALON`', '`REQUEST THIS PIECE`', '*ORBES Client Services will contact you.*', '`Requests`', '`Close`']) expect(of('P-X08'), s).toContain(s);
    // P-D07: SOUND ON, one chord on AUTHENTIC only, the silent switch, SOUND OFF kept across a reload.
    for (const s of ['`SOUND ON`', 'aucun son', 'mode silencieux', '`SOUND OFF`, recharger']) expect(of('P-D07'), s).toContain(s);
    // P-D10: the ring tightening then locking, VERIFYING… on the same ring, the plate opening, reduced motion.
    for (const s of ['se resserre autour du centre', 'se verrouille', '`VERIFYING…`', "s'ouvre depuis son centre", 'Réduire les animations']) expect(of('P-D10'), s).toContain(s);
    // ORBES Care later: one variable of the stack's .env.example, no migration.
    const later = section(runbook, '### 2.8');
    expect(later).toContain("printf '%s\\n' 'CARE_SUBSCRIBE_URL=<adresse https de la page Whop>' >> .env");
    // §3: no deployment C any more.
    const c = section(runbook, '## 3.');
    expect(runbook).toContain('## 3. Déploiement C : fusionné dans le déploiement B+C');
    expect(c).toContain('Il n\'y a plus de déploiement C.');
    expect(fenced(c, 'bash')).toEqual([]);
  });

  it('links only to files and headings that exist', () => {
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
  });
});
