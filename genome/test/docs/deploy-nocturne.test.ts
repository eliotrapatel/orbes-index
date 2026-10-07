/**
 * docs/launch/DEPLOY-NOCTURNE.md, the owner's runbook for deployment F, NOCTURNE (plan of 2026-10-05), against the
 * scripts, the migrations and the app it quotes:
 *
 *  - it starts from the production of deployment E (migrations 0001 to 0023) and applies exactly 0024, as the scripts
 *    print it: the table of §1.0, the line `db.ts migrate` prints, those deploy.sh prints after it, the deployment log
 *    and the count `db.ts status` shows;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app is still one they print;
 *  - the plan's Method: the owner's OK on the board of the 43 screens first, never 03:00–05:30 UTC, the host owner's OK
 *    for one precise time, the pre-check before and after, the launch guarded by `pgrep -a pg_dump`, restore.sh only
 *    ever run to watch it refuse, no prune, nothing of the host changed;
 *  - the post-checks NOCTURNE needs: Safari's bars in ink on /verify and /legal (the pages' own theme-color), the shared
 *    certificate kept light, the console unchanged but for its variants, a draw's price;
 *  - one command per shell block, relative links that resolve, and the runbook linked from DEPLOYMENT and COMPLIANCE.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-NOCTURNE.md';
const runbook = readDoc(RUNBOOK);
const stackFile = (name: string): string => readDoc(`deploy/vps/${name}`);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Safari's bars in ink (addition 13): the colour the app sets (views/shell.ts THEME_COLOURS) and the pages carry. */
const INK = '#0a0a0a';

const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
/** The schema deployment E leaves, F's starting point. */
const AFTER_E = NAMES.filter((n) => numberOf(n) <= 23);
/** Deployment F: the one migration of NOCTURNE (0024a, TEST ENTRANTS, is its own lot's, after F). */
const DEPLOY_F = NAMES.filter((n) => numberOf(n) > 23 && n <= '0024_model_variants');
const AFTER_F = NAMES.filter((n) => n <= '0024_model_variants');

/** What the runbook expects from the scripts, each printed word for word by its source. */
const MESSAGES: ReadonlyArray<readonly [message: string, source: string]> = [
  ['= commit ', 'deploy/vps/scripts/deploy.sh'],
  ['build orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['Caddy configuration valid (TLS_MODE=', 'deploy/vps/scripts/lib.sh'],
  ['(or the Caddyfile) first: nothing was changed', 'deploy/vps/scripts/deploy.sh'],
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
];

describe('the NOCTURNE runbook (docs/launch/DEPLOY-NOCTURNE.md)', () => {
  it('starts from deployment E, 0001 to 0023, and applies exactly 0024, as the scripts print it', () => {
    expect(AFTER_E.at(-1)).toBe('0023_releases_collectors');
    expect(DEPLOY_F).toEqual(['0024_model_variants']);
    // A later name has its own lot and runbook: 0024a is TEST ENTRANTS' (2026-10-07), on the code F deployed.
    expect(NAMES.filter((n) => n > '0024_model_variants')).toEqual(['0024a_test_entrants']);
    expect(runbook).toContain('[le runbook précédent](DEPLOY-LIVE-RELEASE-PLUS.md)');
    expect(outputs.join('\n')).toContain(AFTER_E.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${AFTER_E.length} migration(s) applied, all known to orbes-genome:<TAG_F>`);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_F);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY_F.length} migration(s): ${DEPLOY_F.join(', ')}`);
    expect(runbook).toContain(`(previous: <TAG_E>). This release applied the migration(s) ${DEPLOY_F.join(', ')}:`);
    expect(runbook).toContain(`deploy <TAG_F> OK (previous <TAG_E>; migrations ${DEPLOY_F.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER_F.length} lignes \`applied\`, de \`${AFTER_F[0]}\` à \`${AFTER_F.at(-1)}\``);
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
  });

  it('holds the plan\'s Method and the shared host\'s rules', () => {
    const rules = section(runbook, '## 0.');
    // The owner's OK on the board of every real screen beside its reference, before anything.
    expect(rules).toContain('**Ton accord sur le tableau d\'abord.**');
    expect(rules).toContain('`parity.ts --board`');
    expect(existsSync(join(REPO, 'genome/scripts/parity.ts'))).toBe(true);
    expect(readDoc('genome/scripts/parity.ts')).toContain('--board');
    // Never during the host's backups; the host owner's OK for one precise time, never "now, around …".
    expect(rules).toContain('**Jamais entre 03:00 et 05:30 UTC**');
    expect(rules).toContain('confirme **une** heure précise');
    expect(rules).toContain('jamais « maintenant, vers … »');
    // Nothing of the host changes: no file of deploy/vps since E, no variable, Caddy not recreated.
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --stat <SHA_E> HEAD -- deploy/vps');
    expect(section(runbook, '### 1.0')).toContain('**Caddy, les variables** : rien ne change.');
    // The pre-check before and after (DEPLOYMENT §15.7), the guarded launch, the fast-forward to the checked commit.
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c), c).toHaveLength(2);
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    // restore.sh is only ever run to watch it refuse; nothing is pruned.
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(stackFile('scripts/restore.sh')).toMatch(/--identity\)/);
  });

  it('checks what NOCTURNE changes after the deployment, and what it keeps', () => {
    // Safari's bars in ink (addition 13): the pages' own theme-color, read from production.
    expect(readDoc('genome/src/web/verify/views/shell.ts')).toContain(`nocturne: '${INK}'`);
    for (const [path, page] of [['/verify', 'genome/src/web/verify/index.html'], ['/legal', 'genome/src/web/legal/index.html']] as const) {
      expect(readDoc(page), page).toContain(`<meta name="theme-color" content="${INK}">`);
      expect(commands).toContain(`curl -s https://verify.theorbes.com${path} | grep -o '<meta name="theme-color"[^>]*>'`);
    }
    expect(runbook).toContain(`\`<meta name="theme-color" content="${INK}">\``);
    const checks = section(runbook, '### 1.7');
    for (const what of ['NOW', 'Le certificat partagé', 'Les pages légales', 'La console', 'Le prix d\'une sortie tirée']) expect(checks, what).toContain(what);
    // The console's words, as it shows them.
    const lookbook = readDoc('genome/src/web/admin/views/lookbook.ts');
    expect(lookbook).toContain("'Variants'");
    expect(lookbook).toContain("'Add a variant'");
    const club = readDoc('genome/src/web/admin/views/club.ts');
    expect(club).toContain("label: 'Price'");
    expect(club).toContain("label: 'Currency'");
    for (const label of ['Variants', 'Add a variant', 'Price', 'Currency', 'Lookbook', 'Catalogue']) expect(runbook, label).toContain(`\`${label}\``);
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(20);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(stackFile('scripts/lib.sh')).toContain('db_applied_migrations() {');
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-NOCTURNE.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-NOCTURNE.md)');
  });
});
