/**
 * docs/launch/DEPLOY-RECOMMANDATIONS-2026-10.md, the owner's runbook for the two deployments of the
 * recommendations of 2026-10-02, and the record of their status in COMPLIANCE §8, against the scripts and
 * the code they quote:
 *
 *  - deployment 1 recorded as done: lot 1's commit, image and pre-deploy backup, with the three migrations
 *    that commit knows and the database still holds;
 *  - deployment 2 applies exactly the migrations of MIGRATIONS that came after it, in order: the table of
 *    §2.0, the lines `db_applied_migrations` prints before it, the line `db.ts migrate` prints, and those
 *    deploy.sh prints after it;
 *  - every message the runbook expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app's
 *    configuration is still one they print (MESSAGES: a script that rewords one fails here until the runbook
 *    follows);
 *  - the owner's decisions of 2026-10-03 and the shared host's rules: RESTORE_ALLOWED=false written before
 *    deployment 2, restore.sh only ever run to watch it refuse (--dry-run), no prune, the pre-check of
 *    DEPLOYMENT §15.7, the 03:00–05:30 UTC window, the fast-forward to the final commit after its check;
 *  - one command per shell block (the owner runs them one at a time), only variables of the stack's
 *    .env.example, the console's shell commands as scripts/admin.ts and scripts/db.ts know them, and
 *    relative links (anchors included) that resolve;
 *  - COMPLIANCE §8: one row per recommendation of the plan, each with one of the four statuses, and a tally
 *    that counts them.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_USAGE } from '../../scripts/admin.js';
import { DB_USAGE } from '../../scripts/db.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { REPO, readDoc, section } from './lexicon.js';

const RUNBOOK = 'docs/launch/DEPLOY-RECOMMANDATIONS-2026-10.md';
const runbook = readDoc(RUNBOOK);
const compliance = readDoc('docs/COMPLIANCE.md');
const stackFile = (name: string): string => readDoc(`deploy/vps/${name}`);

/** Deployment 1: lot 1, the commit the server's checkout stays on until deployment 2, and what it left. */
const LOT1_COMMIT = 'db4ffd0c0fd4752c55886d538fdb3c1e6c646d4d';
const LOT1_TAG = LOT1_COMMIT.slice(0, 12);
const LOT1_BACKUP = `orbes-20261003T014918Z-pre-deploy-${LOT1_TAG}.tar.age`;
const LOT1_MIGRATIONS = ['0001_initial', '0002_platform_guards', '0003_authentication_events_default'];
const NAMES = Object.keys(MIGRATIONS);
const DEPLOY2 = NAMES.slice(LOT1_MIGRATIONS.length);

/** The fenced blocks of one language, their lines out of the list item's indentation. */
function fenced(md: string, lang: string): string[] {
  const out: string[] = [];
  const re = /^([ \t]*)```([\w-]*)\n([\s\S]*?)\n\1```[ \t]*$/gm;
  for (const m of md.matchAll(re)) {
    if (m[2] !== lang) continue;
    const indent = m[1]!.length;
    out.push(
      m[3]!
        .split('\n')
        .map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)))
        .join('\n'),
    );
  }
  return out;
}
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/**
 * What the runbook tells the owner to expect, each a run of text that the script (or the library it sources,
 * whose messages carry the caller's name) prints word for word.
 */
const MESSAGES: ReadonlyArray<readonly [message: string, sources: readonly string[]]> = [
  // deploy.sh and lib.sh, in the order of a deployment
  ['= commit ', ['scripts/deploy.sh']],
  ['build orbes-genome:', ['scripts/deploy.sh']],
  ['Caddy configuration valid (TLS_MODE=', ['scripts/lib.sh']],
  ['previous image tag: ', ['scripts/deploy.sh']],
  [' migration(s) applied, all known to ', ['scripts/deploy.sh']],
  ['cannot read the applied migrations (kysely_migration): ', ['scripts/deploy.sh']],
  ['cannot list the migrations ', ['scripts/deploy.sh']],
  ['nothing was changed', ['scripts/deploy.sh']],
  ['nothing else was changed', ['scripts/deploy.sh']],
  ['pre-deploy backup', ['scripts/deploy.sh']],
  ['roll out ', ['scripts/deploy.sh']],
  [' is healthy', ['scripts/lib.sh']],
  ['stopping the running app before migrating to ', ['scripts/deploy.sh']],
  ['database ready: migrations applied, app role ', ['scripts/lib.sh']],
  [' has DML rights only', ['scripts/lib.sh']],
  ['signing key', ['scripts/deploy.sh']],
  ['an ACTIVE signing key exists', ['scripts/deploy.sh']],
  ['smoke tests via https://', ['scripts/deploy.sh']],
  ['health: ', ['scripts/deploy.sh']],
  ['/.well-known/orbes-keys.json lists an ACTIVE key', ['scripts/deploy.sh']],
  ['/verify: 200', ['scripts/deploy.sh']],
  ['. This release applied the migration(s) ', ['scripts/deploy.sh']],
  [' cannot run on this schema any more (scripts/deploy.sh --image ', ['scripts/deploy.sh']],
  [' refuses it). ', ['scripts/deploy.sh']],
  ['If anything goes wrong, repair forward: scripts/deploy.sh --image ', ['scripts/deploy.sh']],
  [' after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).', ['scripts/deploy.sh']],
  [' OK (previous ', ['scripts/deploy.sh']],
  ['; migrations ', ['scripts/deploy.sh']],
  ['no rollback: repair forward', ['scripts/deploy.sh']],
  ['deployment of ', ['scripts/deploy.sh']],
  [' and is KEPT', ['scripts/deploy.sh']],
  ['Repair forward:', ['scripts/deploy.sh']],
  ['rollback to orbes-genome:', ['scripts/deploy.sh']],
  ['rolled back to ', ['scripts/deploy.sh']],
  ['; the stack is healthy', ['scripts/deploy.sh']],
  [' is NOT healthy either', ['scripts/deploy.sh']],
  ['this image cannot run on this schema: repair forward', ['scripts/deploy.sh']],
  [' already exists: reusing it', ['scripts/deploy.sh']],
  ['redeployed ', ['scripts/deploy.sh']],
  [' (same image as before)', ['scripts/deploy.sh']],
  // backup.sh
  ['photos: ', ['scripts/backup.sh']],
  ['photos: unknown (', ['scripts/backup.sh']],
  ['database dump', ['scripts/backup.sh']],
  ['db.dump: ', ['scripts/backup.sh']],
  ['keys volume', ['scripts/backup.sh']],
  ['keys.tar: ', ['scripts/backup.sh']],
  [' key file(s)', ['scripts/backup.sh']],
  ['encrypt to ', ['scripts/backup.sh']],
  [' recipient(s)', ['scripts/backup.sh']],
  ['wrote ', ['scripts/backup.sh']],
  ['backup complete: ', ['scripts/backup.sh']],
  ['[dry-run] would ', ['scripts/backup.sh']],
  // restore.sh, refusing
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', ['scripts/restore.sh']],
  ['Decision of 2026-10-03: ', ['scripts/restore.sh']],
  ['Nothing was done.', ['scripts/restore.sh']],
];

/** The literal text of a script: shell quoting aside, a message is in it as written. */
const sourceOf = (file: string): string => stackFile(file);

/** GitHub's anchor of a markdown heading. */
const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
const anchors = (md: string): Set<string> =>
  new Set(
    md
      .split('\n')
      .filter((l) => /^#{1,6} /.test(l))
      .map((l) => slug(l.replace(/^#{1,6} /, ''))),
  );

/** The recommendations of the plan approved on 2026-10-02, in its order. */
const RECOMMENDATIONS = [
  'D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06',
  'C-01', 'C-02', 'C-04',
  'A-02', 'A-03', 'A-04', 'A-06', 'A-07', 'A-08', 'A-09', 'A-10',
  'F-01', 'F-03', 'F-04', 'F-06',
  'S-07',
  'J-02', 'J-04', 'J-06', 'J-09',
] as const;
const STATUSES = ['fait', 'fait avec écart déclaré', 'en attente du propriétaire', 'ouvert'] as const;

describe('deployment runbook (docs/launch/DEPLOY-RECOMMANDATIONS-2026-10.md)', () => {
  it('records deployment 1 as done: lot 1, its commit, image and pre-deploy backup, and no migration', () => {
    const one = section(runbook, '## 1. Déploiement 1');
    expect(runbook).toContain('## 1. Déploiement 1 (lot 1) : fait');
    for (const fact of [LOT1_COMMIT, `orbes-genome:${LOT1_TAG}`, `/var/backups/orbes/daily/${LOT1_BACKUP}`, '2026-10-03, 01:49 UTC', 'aucune']) {
      expect(one).toContain(fact);
    }
    // The server's checkout stays on lot 1 until deployment 2 moves it forward.
    expect(commands).toContain("git -C /opt/orbes/orbes-index log -1 --format='%H %s'");
    expect(runbook).toContain(`Sortie attendue : \`${LOT1_COMMIT} `);
    expect(runbook).toContain(`ORBES_IMAGE_TAG=${LOT1_TAG}`);
  });

  it('applies in deployment 2 exactly the migrations that came after lot 1, in order, as the scripts print them', () => {
    expect(NAMES.slice(0, LOT1_MIGRATIONS.length)).toEqual(LOT1_MIGRATIONS);
    expect(DEPLOY2[0]).toBe('0004_scan_reports');
    // The table of §2.0, in the order of deployment.
    const table = section(runbook, '### 2.0');
    const positions = DEPLOY2.map((m) => table.indexOf(`| \`${m}\` |`));
    for (const [i, m] of DEPLOY2.entries()) expect(positions[i], m).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(table.match(/^ *\| `\d{4}_/gm)).toHaveLength(DEPLOY2.length);
    // Before: what db_applied_migrations reads on lot 1's schema, and the schema check's line.
    expect(outputs).toContain(LOT1_MIGRATIONS.join('\n'));
    expect(runbook).toContain(`schema: ${LOT1_MIGRATIONS.length} migration(s) applied, all known to orbes-genome:<TAG2>`);
    // During: db.ts migrate's own line, word for word.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY2.length} migration(s): ${DEPLOY2.join(', ')}`);
    // After: deploy.sh's success line and the deployment log.
    const shortList = `${DEPLOY2[0]}, ${DEPLOY2[1]}, …, ${DEPLOY2.at(-1)}`;
    expect(runbook).toContain(`(previous: ${LOT1_TAG}). This release applied the migration(s) ${shortList}:`);
    expect(runbook).toContain(`deploy <TAG2> OK (previous ${LOT1_TAG}; migrations ${DEPLOY2[0]}, …, ${DEPLOY2.at(-1)})`);
    expect(runbook).toContain(`orbes-genome:${LOT1_TAG} cannot run on this schema any more`);
    expect(runbook).toContain(`de \`${NAMES[0]}\` à \`${NAMES.at(-1)}\``);
    expect(runbook).toContain(`**${['Dix', 'Onze', 'Douze'][DEPLOY2.length - 10] ?? DEPLOY2.length} migrations**`);
  });

  it('expects from the scripts only messages they print', () => {
    for (const [message, sources] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(
        sources.some((s) => sourceOf(s).includes(message)),
        `${message}: not in ${sources.join(', ')}`,
      ).toBe(true);
    }
    // The app's refusal of a malformed contact (§3.1), as loadConfig words it.
    const config = readDoc('genome/src/server/config.ts');
    expect(runbook).toContain('Invalid configuration:');
    expect(config).toContain('Invalid configuration:');
    expect(runbook).toContain("CLIENT_SERVICES_PHONE: must be an international number such as +33 1 23 45 67 89");
    expect(config).toContain("'must be an international number such as +33 1 23 45 67 89'");
  });

  it('keeps the decisions of 2026-10-03 and the rules of the shared host', () => {
    // RESTORE_ALLOWED=false, a variable of the stack, written into .env before the commit moves.
    expect(stackFile('.env.example')).toMatch(/^RESTORE_ALLOWED=true$/m);
    const write = commands.indexOf("printf '\\nRESTORE_ALLOWED=false\\n' >> .env");
    const merge = commands.indexOf('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    const check = commands.indexOf("git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk");
    const deploy = commands.indexOf('scripts/deploy.sh');
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(write);
    expect(merge).toBeGreaterThan(check);
    expect(deploy).toBeGreaterThan(merge);
    expect(commands.indexOf('umask 022')).toBeLessThan(write);
    // restore.sh is only ever run to watch it refuse; never a prune.
    for (const c of commands.filter((c) => /restore\.sh/.test(c))) expect(c).toMatch(/--dry-run/);
    for (const c of commands) expect(c).not.toMatch(/\bprune\b/);
    expect(runbook).toContain('**Jamais `restore.sh` sur ce serveur**');
    // The pre-check of DEPLOYMENT §15.7, before and after, and the nightly window.
    const precheck = ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes'];
    const deployment = readDoc('docs/DEPLOYMENT.md');
    for (const c of precheck) {
      expect(deployment).toContain(c);
      expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    }
    expect(runbook).toContain('**Jamais entre 03:00 et 05:30 UTC**');
    // The disk thresholds agreed with the host owner, as DEPLOYMENT §15.12 has them.
    for (const t of ['75 %', '300 Mo', '80 %']) expect(section(runbook, '### 2.8'), t).toContain(t);
    expect(deployment).toMatch(/above \*\*75 %\*\*, or the photographs above \*\*300 MB\*\*/);
    // Old images by exact tag, never the current or the previous one.
    for (const c of commands.filter((c) => c.startsWith('docker image rm '))) {
      expect(c).toMatch(/^docker image rm orbes-genome:[0-9a-f]{12}$/);
      expect(c).not.toContain(LOT1_TAG);
    }
  });

  it('gives one command per shell block, sets only the stack’s variables, and runs the tools as they are', () => {
    expect(commands.length).toBeGreaterThan(30);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    const env = stackFile('.env.example');
    for (const c of commands.filter((c) => />> \.env$/.test(c))) {
      for (const [, name] of c.matchAll(/([A-Z][A-Z0-9_]{2,})=/g)) expect(env, name).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    }
    for (const c of commands.filter((c) => c.includes('scripts/admin.ts'))) {
      const [, sub, rest] = c.match(/scripts\/admin\.ts ([a-z-]+)(.*)$/)!;
      const usage = ADMIN_USAGE.split('\n').find((l) => l.trimStart().startsWith(`${sub} `));
      expect(usage, sub).toBeDefined();
      for (const [flag] of rest!.matchAll(/--[a-z-]+/g)) expect(usage, `${sub} ${flag}`).toContain(flag);
      expect(c, 'the TOTP secret never on a command line').not.toContain('--secret');
    }
    for (const c of commands.filter((c) => c.includes('scripts/db.ts'))) {
      const [, sub] = c.match(/scripts\/db\.ts ([a-z-]+)/)!;
      expect(DB_USAGE, sub).toMatch(new RegExp(`^\\s+${sub}\\b`, 'm'));
    }
    // The script options it uses are the scripts' own.
    expect(sourceOf('scripts/restore.sh')).toMatch(/--identity\)/);
    expect(sourceOf('scripts/restore.sh')).toMatch(/--latest\)/);
    expect(sourceOf('scripts/backup.sh')).toMatch(/--dry-run\)/);
    expect(sourceOf('scripts/deploy.sh')).toMatch(/--image\)/);
    // lib.sh's two read-only functions, run by hand before deployment 2.
    for (const fn of ['db_applied_migrations', 'db_photo_usage']) {
      expect(commands).toContain(`bash -c 'set -Eeuo pipefail; source scripts/lib.sh; ${fn}'`);
      expect(sourceOf('scripts/lib.sh')).toContain(`${fn}() {`);
    }
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
    expect(compliance).toContain('(launch/DEPLOY-RECOMMANDATIONS-2026-10.md)');
    expect(anchors(compliance).has('8-recommandations-du-2026-10-02')).toBe(true);
  });
});

describe('COMPLIANCE §8, the recommendations of 2026-10-02', () => {
  const eight = section(compliance, '## 8.');
  const rows = section(eight, '### 8.1')
    .split('\n')
    .filter((l) => /^\| [A-Z]+-[A-Z]?\d/.test(l))
    .map((l) => l.split(' | ').map((c) => c.replace(/^\| /, '').trim()));

  it('has one row per recommendation of the plan, in its order, each with one of the four statuses', () => {
    const recos = rows.filter((r) => /^[A-Z]-\d\d$/.test(r[0]!));
    expect(recos.map((r) => r[0])).toEqual([...RECOMMENDATIONS]);
    for (const r of recos) expect(STATUSES, `${r[0]}: ${r[2]}`).toContain(r[2]);
    expect(rows.some((r) => r[0]!.startsWith('OPS-D2'))).toBe(true);
  });

  it('tallies the statuses as the table has them', () => {
    const recos = rows.filter((r) => /^[A-Z]-\d\d$/.test(r[0]!));
    const count = (s: string): number => recos.filter((r) => r[2] === s).length;
    const tally = eight.match(/Bilan des 26 : \*\*(\d+) faites\*\*, \*\*(\d+) faites avec écart déclaré\*\*, \*\*(\d+) en attente du propriétaire\*\*, \*\*(\d+) ouvertes?\*\*/);
    expect(tally).not.toBeNull();
    expect(tally!.slice(1).map(Number)).toEqual(STATUSES.map(count));
    expect(STATUSES.map(count).reduce((a, b) => a + b, 0)).toBe(RECOMMENDATIONS.length);
  });

  it('names the deployments and the runbook, and keeps the decision against restores', () => {
    expect(eight).toContain(LOT1_COMMIT.slice(0, 7));
    expect(eight).toContain('RESTORE_ALLOWED=false');
    for (const m of [DEPLOY2[0]!.slice(0, 4), DEPLOY2.at(-1)!.slice(0, 4)]) expect(eight).toContain(`\`${m}\``);
  });
});
