/**
 * docs/launch/DEPLOY-LIVE-RELEASE.md, the owner's runbook for deployment D, the LIVE RELEASE (plan of 2026-10-04),
 * against the scripts, the migrations, the edge and the apps it quotes:
 *
 *  - its starting point is the production of deployment B+C (commit 78959e8, image 78959e8516cc, migrations 0001 to
 *    0020), and deployment D applies exactly the migrations after 0020 that exist, 0021: the table of §1.0, the line
 *    `db.ts migrate` prints, those deploy.sh prints after it, the deployment log and the count `db.ts status` shows;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app is still one they print;
 *  - the rules of the shared host: never 03:00–05:30 UTC, the Caddy change agreed with the host's owner before the day
 *    is fixed, the pre-check of DEPLOYMENT §15.7 before and after, the launch guarded by `pgrep -a pg_dump`, restore.sh
 *    only ever run to watch it refuse, no prune, the fast-forward to the final commit after its check;
 *  - the edge it describes is the Caddyfile's (the stream routes kept out of compression and flushed at once, the
 *    silhouette's upload), checked on the server as the only file of deploy/vps changed since B+C;
 *  - the legal pages' one version, dated the day of the deployment, after B+C's, its placeholder named;
 *  - the measured capacity it states is the console's (LIVE_ROOM_CAPACITY);
 *  - one real check per feature, each quoting only labels the verification app or the console shows;
 *  - one command per shell block, the console's shell commands as scripts/db.ts knows them, relative links that resolve.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB_USAGE } from '../../scripts/db.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { LIVE_STREAM_ROUTES } from '../../src/server/http/live-stream.js';
import { LIVE_ROOM_CAPACITY } from '../../src/server/services/live-insights.js';
import { LIVE_PAY_MINUTES, LIVE_ROOM_OPENS_MINUTES, LIVE_TURN_SECONDS } from '../../src/server/services/live.js';
import { dateInWords, LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-LIVE-RELEASE.md';
const runbook = readDoc(RUNBOOK);
const stackFile = (name: string): string => readDoc(`deploy/vps/${name}`);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** The production deployment D starts from: deployment B+C of DEPLOY-POTENTIEL-2026-10.md, live since 2026-10-04. */
const START_COMMIT = '78959e8516cc146a297cab46ddec68e157fe2847';
const START_TAG = START_COMMIT.slice(0, 12);
const START_SUBJECT = "P-BC: the context test expects the salon service among createContext's services";
const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
const START_MIGRATIONS = NAMES.filter((n) => numberOf(n) <= 20);
/** Deployment D applied 0021 alone; 0022 on belong to the next lot (LIVE RELEASE+). */
const DEPLOY_D = NAMES.filter((n) => numberOf(n) === 21);
/** The last version the legal pages published before D: B+C's (rule 7 of DEPLOY-POTENTIEL-2026-10.md). */
const LAST_PUBLISHED_VERSION = '2026-10-05';

/** What the runbook expects from the scripts and the app, each printed word for word by its source. */
const MESSAGES: ReadonlyArray<readonly [message: string, source: string]> = [
  ['= commit ', 'deploy/vps/scripts/deploy.sh'],
  ['build orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['Caddy configuration valid (TLS_MODE=', 'deploy/vps/scripts/lib.sh'],
  ['(or the Caddyfile) first: nothing was changed', 'deploy/vps/scripts/deploy.sh'],
  ['previous image tag: ', 'deploy/vps/scripts/deploy.sh'],
  [' migration(s) applied, all known to ', 'deploy/vps/scripts/deploy.sh'],
  ['nothing was changed', 'deploy/vps/scripts/deploy.sh'],
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
  ['If anything goes wrong, repair forward: scripts/deploy.sh --image ', 'deploy/vps/scripts/deploy.sh'],
  [' after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).', 'deploy/vps/scripts/deploy.sh'],
  [' OK (previous ', 'deploy/vps/scripts/deploy.sh'],
  ['; migrations ', 'deploy/vps/scripts/deploy.sh'],
  ['no rollback: repair forward', 'deploy/vps/scripts/deploy.sh'],
  [' and is KEPT', 'deploy/vps/scripts/deploy.sh'],
  ['Repair forward:', 'deploy/vps/scripts/deploy.sh'],
  ['rollback to orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['rolled back to ', 'deploy/vps/scripts/deploy.sh'],
  ['; the stack is healthy', 'deploy/vps/scripts/deploy.sh'],
  [' is NOT healthy either', 'deploy/vps/scripts/deploy.sh'],
  ['this image cannot run on this schema: repair forward', 'deploy/vps/scripts/deploy.sh'],
  ['photos: ', 'deploy/vps/scripts/backup.sh'],
  ['db.dump: ', 'deploy/vps/scripts/backup.sh'],
  ['keys.tar: ', 'deploy/vps/scripts/backup.sh'],
  ['encrypt to ', 'deploy/vps/scripts/backup.sh'],
  ['backup complete: ', 'deploy/vps/scripts/backup.sh'],
  ['[dry-run] would ', 'deploy/vps/scripts/backup.sh'],
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', 'deploy/vps/scripts/restore.sh'],
  ['Nothing was done.', 'deploy/vps/scripts/restore.sh'],
  ['live engine: leading', 'genome/src/server/services/live-engine.ts'],
];

/** The labels §1.7 quotes, as the verification app (`web/verify`) or the console (`web/admin`) shows them. */
const VERIFY_LABELS = [
  'THE RELEASES', 'OPENS IN', 'ONE PER COLLECTOR', 'THE REVEALS', 'I’LL BE THERE', 'WITHDRAW', 'ADD TO CALENDAR', 'FULL SCREEN',
  'Your ORBES account does not meet the rule of this release.', 'SIGN IN TO ENTER', 'READY CHECK', 'SYNCED TO ORBES', 'ENTER THE ROOM',
  'IN THE ROOM', 'SOUND ON', 'DRAWING THE PLACES', 'YOUR PLACE', 'PRESS AND HOLD THE SEAL', 'PAUSED', 'RELEASE MY PLACE', 'A PIECE HAS RETURNED',
  'YOUR PLACE IS RELEASED', 'Your piece is reserved in size', 'THE RELEASE HAS ENDED', 'THIS RELEASE IS OVER', 'THIS BOARD IS NOT AVAILABLE',
  'COLLECTOR WILL BE THERE', 'MY PIECES', 'PAY · ', 'TO BE REVEALED', 'TAP AGAIN TO RELEASE', 'YOUR HOLD HAS ENDED',
] as const;
/** Labels of deployment D's checks the console no longer shows (plan LIVE RELEASE+: the Client Services list retired). */
const RETIRED_CONSOLE_LABELS = ['Cancel the reservation'] as const;

const CONSOLE_LABELS = [
  'Club', 'Drops', 'New live release', 'Opening (UTC)', 'End of the sales (UTC)', 'Price of a piece', 'Currency', 'Sizes', 'Access', 'Add-ons',
  'Publish the release', 'Boutique board', 'Issue the link', 'Copy the link', 'Pause', 'Resume', 'Message', 'Add pieces', 'End now',
  'Client Services', 'Download CSV', 'How it is read', 'Revoke the board’s link',
  'Times (UTC)', 'Silhouette revealed', 'Name revealed', 'Photograph revealed', 'Silhouette', 'Choose a photograph', 'To be sent: ', 'Save photograph',
  'Silhouette saved.', 'Extend', 'Minutes', 'Release extended.', 'Free', 'Free the hold', 'Hold freed.', 'Let in', 'Remove',
] as const;

function sources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? [sources(join(dir, e.name))] : /\.ts$/.test(e.name) ? [readFileSync(join(dir, e.name), 'utf8')] : []))
    .join('\n');
}

describe('the LIVE RELEASE runbook (docs/launch/DEPLOY-LIVE-RELEASE.md)', () => {
  it('starts from the production of deployment B+C: commit 78959e8, its image, the migrations 0001 to 0020', () => {
    expect(START_MIGRATIONS).toHaveLength(20);
    expect(START_MIGRATIONS.at(-1)).toBe('0020_private_salon');
    expect(runbook).toContain(`la production tourne le commit \`${START_COMMIT}\` (image \`orbes-genome:${START_TAG}\`)`);
    expect(commands).toContain("git -C /opt/orbes/orbes-index log -1 --format='%H %s'");
    expect(runbook).toContain(`Sortie attendue : \`${START_COMMIT} ${START_SUBJECT}\``);
    expect(runbook).toContain(`ORBES_IMAGE_TAG=${START_TAG}`);
    // What db_applied_migrations reads before deployment D, line for line.
    expect(outputs).toContain(START_MIGRATIONS.join('\n'));
    expect(runbook).toContain(`schema: ${START_MIGRATIONS.length} migration(s) applied, all known to orbes-genome:<TAG_D>`);
  });

  it('applies exactly the migrations after 0020, as the scripts print them', () => {
    expect(DEPLOY_D).toEqual(['0021_live_release']);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_D);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY_D.length} migration(s): ${DEPLOY_D.join(', ')}`);
    expect(runbook).toContain(`(previous: ${START_TAG}). This release applied the migration(s) ${DEPLOY_D.join(', ')}:`);
    expect(runbook).toContain(`deploy <TAG_D> OK (previous ${START_TAG}; migrations ${DEPLOY_D.join(', ')})`);
    expect(runbook).toContain(`orbes-genome:${START_TAG} cannot run on this schema any more`);
    const afterD = [...START_MIGRATIONS, ...DEPLOY_D];
    expect(runbook).toContain(`les ${afterD.length} lignes \`applied\`, de \`${afterD[0]}\` à \`${afterD.at(-1)}\``);
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    // The engine's line is read from the whole log of the app's container, which this deployment recreates: a window
    // (--since) would miss it when the post-checks run late.
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(commands.filter((c) => c.includes('docker compose logs') && c.includes('--since'))).toEqual([]);
  });

  it('keeps the rules of the shared host: the window, the Caddy change agreed first, the guarded launch, no restore, no prune', () => {
    expect(runbook).toContain('**Jamais entre 03:00 et 05:30 UTC**');
    expect(runbook).toContain('**Jamais `restore.sh` sur ce serveur**');
    for (const c of commands.filter((c) => /restore\.sh/.test(c))) expect(c).toMatch(/--dry-run/);
    for (const c of commands) expect(c).not.toMatch(/\bprune\b/);
    // The launch is guarded, every time: never a bare deploy.sh.
    const launches = commands.filter((c) => /scripts\/deploy\.sh/.test(c));
    expect(launches).toEqual(['pgrep -a pg_dump || scripts/deploy.sh']);
    expect(commands).toContain('pgrep -a pg_dump');
    // The Caddy change is proposed to the host's owner, and agreed, before anything else.
    const before = section(runbook, '### 1.1');
    expect(before.indexOf("**1. Le changement de Caddy, convenu d'abord**")).toBe(before.indexOf('**1.'));
    expect(before.indexOf('**1.')).toBeGreaterThan(-1);
    expect(before).toContain('Attends son accord sur le changement **avant** de fixer le jour.');
    for (const route of ['/api/v1/live/<id>/stream', '/api/v1/live/<id>/board/stream', '/api/admin/live/<id>/stream', '/api/admin/live/<id>/silhouette']) {
      expect(before, route).toContain(route);
    }
    // The pre-check, before and after.
    const deployment = readDoc('docs/DEPLOYMENT.md');
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) {
      expect(deployment).toContain(c);
      expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    }
    // umask, then the commit checked, then merged, then the version checked, then the guarded launch.
    const at = (c: string) => commands.indexOf(c);
    const check = at("git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk");
    const merge = at('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    const version = at("git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts");
    const deploy = at('pgrep -a pg_dump || scripts/deploy.sh');
    expect(at('umask 022')).toBeGreaterThan(-1);
    expect(at('umask 022')).toBeLessThan(check);
    expect(check).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(check);
    expect(version).toBeGreaterThan(merge);
    expect(deploy).toBeGreaterThan(version);
    expect(commands).toContain("grep -n '^RESTORE_ALLOWED=' .env");
    expect(runbook).toContain('`<numéro>:RESTORE_ALLOWED=false`');
    for (const c of commands.filter((c) => c.startsWith('docker image rm '))) expect(c).not.toContain(START_TAG);
  });

  it('describes the edge the Caddyfile has: the streams uncompressed and flushed, the silhouette uploaded, nothing else of deploy/vps changed', () => {
    const caddy = stackFile('Caddyfile');
    expect(caddy).toContain('encode @not_live_stream zstd gzip');
    expect(caddy).toMatch(/reverse_proxy @live_stream app:8080 \{[^}]*flush_interval -1/);
    expect(caddy).toContain('live/[^/]+/silhouette');
    expect(LIVE_STREAM_ROUTES).toEqual(['/api/v1/live/:id/stream', '/api/v1/live/:id/board/stream', '/api/admin/live/:id/stream']);
    expect(runbook).toContain('`flush_interval -1`');
    // Since B+C's commit, the Caddyfile is the stack's only change (L4, L7): the runbook checks it on the server.
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${START_COMMIT} HEAD -- deploy/vps`);
    expect(runbook).toContain('Sortie attendue : une ligne ` deploy/vps/Caddyfile | …`');
    // No variable to set: the LIVE RELEASES follow the api budget.
    expect(commands.filter((c) => />> \.env$/.test(c))).toEqual([]);
    expect(readDoc('genome/src/server/http/rate-limit.ts')).toContain('live: config.rateLimits.apiPerMinute * LIVE_NETWORK_RATE_FACTOR');
  });

  it('dates the legal pages the day of the deployment, after B+C’s version, and names the placeholder until then', () => {
    expect(LEGAL_VERSION > LAST_PUBLISHED_VERSION).toBe(true);
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const rules = section(runbook, '## 0.');
    expect(rules).toContain(`A a publié \`2026-10-04\`, B+C \`${LAST_PUBLISHED_VERSION}\``);
    expect(rules).toContain(`\`LEGAL_VERSION\` vaut provisoirement **\`${LEGAL_VERSION}\`**`);
    expect(rules).toContain('`PUBLISHED` (`genome/test/web/legal.content.test.ts`)');
    expect(readDoc('genome/test/web/legal.content.test.ts')).toContain(`'${LEGAL_VERSION}': '`);
    // The drafts carry the same day as the pages.
    expect(readDoc('docs/legal/terms.en.md')).toContain(`Version: ${dateInWords(LEGAL_VERSION, 'en')}.`);
    expect(readDoc('docs/legal/terms.fr.md')).toContain(`Version : ${dateInWords(LEGAL_VERSION, 'fr')}.`);
    expect(section(runbook, '### 1.3')).toContain("Sortie attendue : `export const LEGAL_VERSION = '<AAAA-MM-JJ>';`, le jour de `date -u`");
  });

  it('states the measured capacity and the defaults as the code has them', () => {
    expect(LIVE_ROOM_CAPACITY.inRoom).toBe(1000);
    const capacity = '1 000';
    expect(section(runbook, '## 0.')).toContain(`**${capacity} personnes dans la salle**`);
    expect(runbook).toContain('(../reports/live-load.md)');
    expect(readDoc('docs/reports/live-load.md')).toContain(`**Measured capacity: ${capacity} people in the room.**`);
    expect(LIVE_ROOM_OPENS_MINUTES.default).toBe(5);
    expect(runbook).toContain(`À l'ouverture de la salle (${LIVE_ROOM_OPENS_MINUTES.default} minutes avant)`);
    expect([LIVE_TURN_SECONDS.default, LIVE_PAY_MINUTES.default]).toEqual([30, 5]);
  });

  it('checks every feature once, live, with only labels the apps show', () => {
    const checks = section(runbook, '### 1.7');
    const features = [...checks.matchAll(/^\| ([^|]+) \| [^|]+ \| [^|]+ \| [^|]+ \|$/gm)].map((m) => m[1].trim()).filter((f) => f !== 'Élément' && !/^-+$/.test(f));
    for (const f of ['L\'annonce', 'Les étapes', 'I\'LL BE THERE', 'ADD TO CALENDAR', 'La bannière', 'Le tableau de la boutique', 'Le flux, à travers Caddy', 'Pas éligible', 'Pas de spectateur', 'La salle', 'La dernière minute', 'T0', 'Le tour', 'Le tableau en direct', 'Prolonger', 'La seconde chance', 'Les options et PAY', 'La fin', 'ORBES Client Services', 'L\'intelligence', 'Le lien du tableau']) {
      expect(features.some((x) => x.startsWith(f)), f).toBe(true);
    }
    const verify = sources(join(REPO, 'genome/src/web/verify'));
    const admin = sources(join(REPO, 'genome/src/web/admin'));
    for (const label of VERIFY_LABELS) {
      expect(verify, label).toContain(label);
      expect(checks, label).toContain(label);
    }
    for (const label of CONSOLE_LABELS) {
      expect(admin, label).toContain(label);
      expect(checks, label).toContain(label);
    }
    // Deployment D's record keeps its check of the LIVE plan's Client Services list, which LIVE RELEASE+ retires into
    // the Orders board: its label is the runbook's, no longer the console's.
    for (const label of RETIRED_CONSOLE_LABELS) {
      expect(checks, label).toContain(label);
      expect(admin, label).not.toContain(label);
    }
    // The silhouette's check through the edge: a photograph over the 64 KB default, through the console's own upload.
    expect(checks).toContain('bien au-delà de 64 Ko');
    expect(checks).toContain('sans `413` (l\'exception de Caddy, §1.0)');
    // The stream's check through the edge: the board's own route, by its secret from a variable read without echo.
    expect(commands).toContain('curl -sN -D - -H \'accept-encoding: gzip, zstd\' -H \'origin: https://verify.theorbes.com\' -H \'content-type: application/json\' --data "{\\"token\\":\\"$ORBES_BOARD\\"}" https://verify.theorbes.com/api/v1/live/<ID>/board/stream');
    expect(checks).toContain('`read -rs ORBES_BOARD`');
    expect(checks).toContain('`unset ORBES_BOARD`');
    expect(readDoc('genome/src/server/http/live-stream.ts')).toContain("'content-type': 'text/event-stream; charset=utf-8'");
    // What the trial leaves out says why, and names the tests that cover it.
    const left = checks.split('\n').find((l) => l.startsWith('Trois gestes de la console restent hors de l\'essai'));
    expect(left).toBeDefined();
    for (const why of ['`Let in` demande une troisième entrée', '`Remove` est réservé à un ADMIN', 'atteindrait de vrais membres', '`RELEASE MY PLACE` (`YOUR PLACE IS RELEASED`)']) expect(left, why).toContain(why);
    const tests = [...left!.matchAll(/`(genome\/test\/[^`]+\.test\.ts)`/g)].map((m) => m[1]);
    expect(tests).toEqual(['genome/test/api/live-admin.test.ts', 'genome/test/api/live.test.ts', 'genome/test/api/admin-roles.test.ts', 'genome/test/web/admin.live.e2e.test.ts', 'genome/test/web/verify.live.e2e.test.ts']);
    for (const t of tests) expect(existsSync(join(REPO, t)), t).toBe(true);
  });

  it('gives one command per shell block, and runs the tools as they are', () => {
    expect(commands.length).toBeGreaterThan(30);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
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

  it('links only to files and headings that exist, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-LIVE-RELEASE.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-LIVE-RELEASE.md)');
  });
});
