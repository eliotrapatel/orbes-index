/**
 * docs/launch/DEPLOY-POTENTIEL-2026-10.md, the owner's runbook for the three deployments of the « Potentiel » lot
 * (plan of 2026-10-03: A, B, C), against the scripts and the migrations it quotes:
 *
 *  - its starting point is the production of 2026-10-03 (commit 3660154, image 3660154006b5, migrations 0001 to
 *    0013), the end of the previous runbook (DEPLOY-RECOMMANDATIONS-2026-10.md, deploy-runbook.test.ts);
 *  - every migration after 0013 belongs to one deployment of the plan's table (A: 0014 to 0018, B: 0019 and 0020,
 *    C: none), or to deployment D of the LIVE RELEASE (plan of 2026-10-04: 0021, with its own runbook), and
 *    deployment A applies exactly A's migrations that exist, in order: the table of §1.0, the line `db.ts migrate`
 *    prints, those deploy.sh prints after it, and the count `db.ts status` shows;
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
const DEPLOY_B = NAMES.filter((n) => numberOf(n) >= 19 && numberOf(n) <= 20);
/** Deployment D, the LIVE RELEASE (plan of 2026-10-04): 0021, deployed after this runbook's three, with its own runbook. */
const DEPLOY_D = NAMES.filter((n) => numberOf(n) === 21);

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
    // The plan's table: A 0014–0018, B 0019–0020, C none; then the LIVE RELEASE's D, 0021. A later number needs a plan
    // (and a runbook) first.
    expect(NAMES.filter((n) => numberOf(n) > 13)).toEqual([...DEPLOY_A, ...DEPLOY_B, ...DEPLOY_D]);
    expect(DEPLOY_D).toEqual(['0021_live_release']);
    expect(DEPLOY_A[0]).toBe('0014_model_lookbook');
    // The tables of §1.0 and §2: the existing migrations of each deployment, nothing else.
    expect(tableRows(section(runbook, '### 1.0'))).toEqual(DEPLOY_A);
    expect(tableRows(section(runbook, '## 2.'))).toEqual(DEPLOY_B);
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
