/**
 * docs/launch/DEPLOY-NEXT-NINE.md, the owner's runbook for deployment G, the next nine (plan of 2026-10-06, §7 and
 * Phase 10), against the scripts, the migrations, the edge and the app it quotes:
 *
 *  - it starts from the production of TEST ENTRANTS (2026-10-07: 0001 to 0024 and 0024_z_test_entrants, merged into this
 *    branch before G) and applies exactly 0025 to 0032, as the scripts print them: the table of §1.0, the lines
 *    `db_applied_migrations` and deploy.sh print before, the line `db.ts migrate` prints, those deploy.sh prints after
 *    it, the deployment log and the count `db.ts status` shows;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app is still one they print;
 *  - the plan's §7 and the owner's rules: the captures reviewed first, never 03:00–05:30 UTC nor the hub's backup
 *    minutes, the change of Caddy agreed with the host owner first and no slot booked since 2026-10-07, the pre-check
 *    before and after, the guarded launch, restore.sh only ever run to watch it refuse, no prune;
 *  - the one change of the host, the Caddyfile's limit for a yearly care's label, as the edge and the app hold it;
 *  - the post-checks the lot needs (THE CLUB's thresholds, HOW RELEASES WORK's figures, the grants at boot, the legal
 *    version) read from the code that serves them, and the console's and the app's words as they show them;
 *  - one command per shell block, relative links that resolve, and the runbook linked from DEPLOYMENT and COMPLIANCE.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { CARE_LABEL_UPLOAD_ROUTE } from '../../src/server/routes/admin/care.js';
import { CLUB_TIER_THRESHOLDS } from '../../src/server/services/club.js';
import { DEFAULT_PROGRAM } from '../../src/server/services/club-program.js';
import { PURCHASE_WINDOW_HOURS } from '../../src/server/services/drops.js';
import { LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-NEXT-NINE.md';
const runbook = readDoc(RUNBOOK);
const stackFile = (name: string): string => readDoc(`deploy/vps/${name}`);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** The production G starts from: TEST ENTRANTS, deployed on 2026-10-07 (its commit, its image, its one migration). */
const PREV_COMMIT = '04ee3c39e89bc3a8921e78f0108ea37de1708528';
const PREV_TAG = PREV_COMMIT.slice(0, 12);
const TEST_ENTRANTS = '0024_z_test_entrants';
/** The one legal version of deployment G (the day after E's published 2026-10-07; the plan's rule, §4). */
const G_LEGAL_VERSION = '2026-10-08';

const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
/** The schema TEST ENTRANTS leaves, G's starting point: with its migration whether or not it is merged here yet. */
const BEFORE_G = [...new Set([...NAMES.filter((n) => numberOf(n) <= 24), TEST_ENTRANTS])].sort();
/** Deployment G: the next nine's eight migrations, in build order. */
const DEPLOY_G = NAMES.filter((n) => numberOf(n) >= 25 && numberOf(n) <= 32);
const AFTER_G = [...BEFORE_G, ...DEPLOY_G];

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
  ['tier grants ready', 'genome/src/server/context.ts'],
  ["action: 'club.grant'", 'genome/src/server/services/tier-grants.ts'],
];

describe('the runbook of the next nine (docs/launch/DEPLOY-NEXT-NINE.md)', () => {
  it('starts from TEST ENTRANTS, 0001 to 0024_z_test_entrants, and applies exactly 0025 to 0032, as the scripts print them', () => {
    expect(DEPLOY_G).toEqual([
      '0025_client_messages',
      '0026_club_program',
      '0027_tier_grants',
      '0028_yearly_care',
      '0029_house_guarantee',
      '0030_account_sizes',
      '0031_model_pairs',
      '0032_growth_indexes',
    ]);
    // A later number has its own plan and runbook: 0033 on are the next lot's (plan of 2026-10-07), deployments H1 and H2 after G.
    expect(NAMES.filter((n) => n > DEPLOY_G.at(-1)!).every((n) => numberOf(n) >= 33)).toBe(true);
    expect(NAMES.filter((n) => numberOf(n) > 32)[0]).toBe('0033_model_sizes');
    expect(BEFORE_G.slice(-2)).toEqual(['0024_model_variants', TEST_ENTRANTS]);
    // TEST ENTRANTS sorts before the next nine, as the migrator (Kysely) and psql order them.
    expect([...AFTER_G].sort()).toEqual(AFTER_G);
    expect(runbook).toContain('[son runbook](DEPLOY-NOCTURNE.md)');
    // The merge of TEST ENTRANTS extends END TEST to what the tier program gives (its TODO in services/test-entrants.ts).
    expect(runbook).toContain('À cette fusion, END TEST est étendu, avec son test : il annule aussi les commandes GIFT, les usages de crédit et les avantages de palier des comptes de test');
    expect(runbook).toContain(`le commit \`${PREV_COMMIT}\` (image \`orbes-genome:${PREV_TAG}\``);
    expect(runbook).toContain(`les vingt-cinq migrations de \`${BEFORE_G[0]}\` à \`${TEST_ENTRANTS}\``);
    expect(BEFORE_G).toHaveLength(25);
    expect(outputs.join('\n')).toContain(BEFORE_G.slice(-2).join('\n'));
    expect(runbook).toContain(`Sortie attendue : vingt-cinq lignes, de \`${BEFORE_G[0]}\` à \`${TEST_ENTRANTS}\``);
    expect(runbook).toContain(`schema: ${BEFORE_G.length} migration(s) applied, all known to orbes-genome:<TAG_G>`);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_G);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY_G.length} migration(s): ${DEPLOY_G.join(', ')}`);
    expect(runbook).toContain(`(previous: ${PREV_TAG}). This release applied the migration(s) ${DEPLOY_G.join(', ')}:`);
    expect(runbook).toContain(`deploy <TAG_G> OK (previous ${PREV_TAG}; migrations ${DEPLOY_G.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER_G.length} lignes \`applied\`, de \`${AFTER_G[0]}\` à \`${AFTER_G.at(-1)}\``);
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${PREV_COMMIT} HEAD -- deploy/vps`);
    expect(runbook).toContain(`Sortie attendue : \`${PREV_COMMIT}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${PREV_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${PREV_COMMIT.slice(0, 7)}..<7 caractères de SHA_G>\``);
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message.startsWith('action: ') ? 'club.grant' : message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(commands).toContain("docker compose logs app | grep 'tier grants ready'");
  });

  it('holds the plan\'s §7 and the owner\'s rules for the shared host', () => {
    const rules = section(runbook, '## 0.');
    // The owner's review of the captures before the merge (plan §0.2).
    expect(rules).toContain('**Ton accord sur les captures d\'abord.**');
    // Never during the host's night backups, nor the hub's backup minutes.
    expect(rules).toContain('**Jamais entre 03:00 et 05:30 UTC**');
    expect(rules).toContain('01:00–01:10 et 01:45–01:55 UTC jusqu\'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC');
    // The change of Caddy agreed with the host owner first; no slot booked since the owner's rule of 2026-10-07.
    expect(rules).toContain('**Le changement de Caddy est convenu d\'abord**');
    expect(rules).toContain('**aucune heure n\'est réservée**');
    expect(rules).toContain('la CI verte sur le commit exact, le diff de `deploy/vps` limité au Caddyfile convenu, le lancement gardé');
    expect(section(runbook, '### 1.1')).toContain('D\'accord sur le principe ?');
    // The pre-check before and after (DEPLOYMENT §15.7), the guarded launch, the fast-forward to the checked commit.
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c), c).toHaveLength(2);
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    // restore.sh is only ever run to watch it refuse; nothing is pruned.
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(stackFile('scripts/restore.sh')).toMatch(/--identity\)/);
    // Before the switch: no draw in its early access, no LIVE RELEASE, no test of TEST ENTRANTS; the members per tier.
    const before = section(runbook, '### 1.1');
    for (const what of ['**Aucun tirage dans son accès anticipé**', '**Aucune LIVE RELEASE**', '**Aucun test de TEST ENTRANTS en cours**', '**Les membres par palier, avant**', '**Les mots des paliers**']) expect(before, what).toContain(what);
  });

  it('changes the host only by the Caddyfile\'s limit for a yearly care\'s label, as the edge and the app hold it', () => {
    const caddy = stackFile('Caddyfile');
    expect(caddy).toContain('@label_upload {');
    expect(caddy).toContain('path_regexp ^/api/admin/care/[^/]+/label/?$');
    expect(caddy).toMatch(/request_body @label_upload \{\s+max_size 2200KB\s+\}/);
    expect(caddy).toContain('@not_upload {');
    expect(caddy).not.toContain('@not_photo_upload');
    expect(CARE_LABEL_UPLOAD_ROUTE).toBe('/api/admin/care/:id/label');
    const changes = section(runbook, '### 1.0');
    expect(changes).toContain('`POST /api/admin/care/<id>/label`');
    expect(changes).toContain('2 200 Ko');
    expect(changes).toContain('**Les variables** : rien ne change.');
    expect(section(runbook, '### 1.1')).toContain('`@not_photo_upload` devient `@not_upload`');
    expect(section(runbook, '### 1.4')).toContain('`Container orbes-caddy-1 Recreate`');
    // DEPLOYMENT records the deviation from the plan's 'Nothing on the host changes' and names this runbook.
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('**Deployment G changes the edge**');
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(`docs/launch/DEPLOY-NEXT-NINE.md`)');
    // The edge still refuses a large body elsewhere, read from production after Caddy is recreated.
    expect(commands).toContain("head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify");
  });

  it('checks what the lot serves after the deployment, read from the code that serves it', () => {
    expect(commands).toContain("curl -s https://verify.theorbes.com/api/v1/the-club | grep -o '\"tierThresholds\":\\[[0-9,]*\\]'");
    expect(runbook).toContain(`\`"tierThresholds":${JSON.stringify([...CLUB_TIER_THRESHOLDS])}\``);
    expect(readDoc('genome/src/server/services/club.ts')).toContain('tierThresholds: [...CLUB_TIER_THRESHOLDS],');
    const early = { PALLADIUM: DEFAULT_PROGRAM.earlyAccessPalladiumHours * 60, PLATINE: DEFAULT_PROGRAM.earlyAccessPlatineHours * 60 };
    expect(early).toEqual({ PALLADIUM: 240, PLATINE: 120 });
    expect(readDoc('genome/src/server/services/release-rules.ts')).toContain('earlyAccess: { PALLADIUM: program.earlyAccessPalladiumHours * 60, PLATINE: program.earlyAccessPlatineHours * 60 },');
    expect(runbook).toContain(`\`"earlyAccess":${JSON.stringify(early)}\``);
    expect(runbook).toContain(`\`"placeHeldHours":${PURCHASE_WINDOW_HOURS.default}\``);
    for (const path of ['/verify/club', '/verify/releases/how']) expect(commands).toContain(`curl -s -o /dev/null -w '%{http_code}\\n' https://verify.theorbes.com${path}`);
    expect(readDoc('genome/src/server/http/static.ts')).toContain("app.get('/verify/*', verify);");
    // The one legal version of G, its date never holding the deployment; a later lot moves LEGAL_VERSION on (the next
    // lot's H1, plan of 2026-10-07), never back.
    expect(LEGAL_VERSION >= G_LEGAL_VERSION).toBe(true);
    expect(readDoc('genome/test/web/legal.content.test.ts')).toContain(`'${G_LEGAL_VERSION}': '`);
    expect(runbook).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${G_LEGAL_VERSION}';\`.`);
    expect(section(runbook, '## 0.')).toContain('Sa date ne retient jamais le déploiement.');
  });

  it('names the console and the app as they show themselves', () => {
    const admin = (file: string): string => readDoc(`genome/src/web/admin/${file}`);
    const labels: ReadonlyArray<readonly [label: string, file: string]> = [
      ['Messages', 'main.ts'],
      ['Yearly care', 'main.ts'],
      ['Growth', 'main.ts'],
      ['Tiers', 'model/club.ts'],
      ['Edit program', 'views/tiers.ts'],
      ['Edit benefits', 'views/tiers.ts'],
      ['Settings', 'views/orders.ts'],
      ['Shipping', 'views/settings.ts'],
      ['House guarantee', 'views/settings.ts'],
      ['Apply credit', 'views/order.ts'],
      ['Choose size', 'views/order.ts'],
      ['Grant a guarantee', 'views/owner.ts'],
      ['Revoke', 'views/owner.ts'],
      ['Lifetime value', 'views/owner.ts'],
      ['Sizes', 'views/lookbook.ts'],
      ['Pairs well with', 'views/lookbook.ts'],
      ['Edit pairs', 'views/lookbook.ts'],
      ['Send label', 'model/care.ts'],
      ['Cancel', 'model/care.ts'],
      ['The Circle', 'views/analytics.ts'],
      ['Photo', 'views/catalogue.ts'],
    ];
    for (const [label, file] of labels) {
      expect(runbook, label).toContain(`\`${label}\``);
      expect(admin(file), `${label}: not in ${file}`).toMatch(new RegExp(`['\`]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\`]`));
    }
    // Deployment G's record keeps SHIP WITH ITS ORDER, which plan NEXT LOT (step 5.11e) retires: a travelling order ships
    // in its parent's parcel, from the Shipping section; its label is the runbook's, no longer the order page's.
    expect(runbook).toContain('`Ship with its order`');
    expect(admin('views/order.ts')).not.toContain('Ship with its order');
    const copy = readDoc('genome/src/web/verify/copy.ts');
    for (const words of ['WRITE TO ORBES CLIENT SERVICES', 'MESSAGES', 'YOUR SIZES', 'THE CLUB', 'HOW RELEASES WORK', 'SHARE TO STORIES', 'SAVE IMAGE', 'PAIRS WELL WITH', 'THE RELEASES OF THIS MODEL', 'IN USE', 'REQUEST YEARLY CARE', 'TO CONFIRM', 'NOT SET']) {
      expect(runbook, words).toContain(words);
      expect(copy, words).toContain(`'${words}'`);
    }
    expect(copy).toContain('`FREE · ${tier}`');
    expect(copy).toContain('· FROM YOUR SIZES`');
    expect(runbook).toContain('FREE · PLATINE');
    // One real check per feature (plan §7).
    const checks = section(runbook, '### 1.7');
    for (const what of ['CS-01', 'BP-19', 'IN-01', 'AC-01', 'FT-01', 'CO-01, BP-34', 'BP-10', 'BP-29']) expect(checks, what).toContain(`| ${what}`);
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(25);
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
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-NEXT-NINE.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-NEXT-NINE.md)');
  });
});
