/**
 * docs/launch/DEPLOY-NEXT-LOT.md, the owner's runbook for deployments H1 and H2, the next lot (plan of 2026-10-07, §7,
 * step 4.7 and Finish H2), against the scripts, the migrations and the app it quotes. Part H1:
 *
 *  - it starts from the production of G (2026-10-07: 0001 to 0032, the commit 52c1c8c, merged into this branch before
 *    H1) and applies exactly 0033 and 0034, as the scripts print them: the table of §1.0, the lines
 *    `db_applied_migrations` and deploy.sh print before, the line `db.ts migrate` prints, those deploy.sh prints after
 *    it, the deployment log and the count `db.ts status` shows;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app is still one they print;
 *  - the plan's §7 and the owner's rules: the captures reviewed first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the
 *    hub's backup minutes (Paris first, UTC in brackets), no slot booked since 2026-10-07 and a heads-up at launch, nothing changed on the host (the deploy/vps diff
 *    empty), the pre-check before and after, the guarded launch, restore.sh only ever run to watch it refuse, no prune;
 *  - the legal version of H1 (the day after G's), the lost-card procedure told to ORBES Client Services, the owner's
 *    checks before the first customer card, one real check per feature, and the questions still open;
 *  - the console's and the app's words as they show them; one command per shell block, relative links that resolve,
 *    and the runbook linked from DEPLOYMENT and COMPLIANCE.
 *
 * Part H2 (§2), written at H2's finish:
 *
 *  - it starts from H1 (1651df1, 0001 to 0034) and applies exactly 0035 to 0039, after which H1's image no longer runs
 *    on the schema; its deploy/vps diff is against H1's commit, never G's;
 *  - the packing photo under the edge's limit, with nothing changed on the host (the route the console uploads to,
 *    which the Caddyfile holds at 64 KB, and the console's photo at 64 KB at most), the console's allowlist checked for
 *    the agent, the procedures told
 *    to ORBES Client Services and to the agent, the plan's checks after H2 and what to set before the first supplier
 *    order, its legal version (the day after H1's), and the questions of §5.2 still open for it, with the answer built.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { PACKING_PHOTO_UPLOAD_ROUTE } from '../../src/server/routes/admin/media.js';
import { PACKING_PHOTO_EDGE_BYTES, PACKING_PHOTO_LIMITS } from '../../src/web/admin/model/logistics.js';
import { LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-NEXT-LOT.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** The production H1 starts from: G, deployed on 2026-10-07 at 21:26 UTC (its commit and its image). */
const PREV_COMMIT = '52c1c8c65e0dd482480030197ec6e250887ab251';
const PREV_TAG = PREV_COMMIT.slice(0, 12);
/** The legal version of H1: the day after G's published 2026-10-08 (the plan's rule, §4). */
const H1_LEGAL_VERSION = '2026-10-09';

const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
const BEFORE_H1 = NAMES.filter((n) => numberOf(n) <= 32);
const DEPLOY_H1 = NAMES.filter((n) => numberOf(n) === 33 || numberOf(n) === 34);
const AFTER_H1 = [...BEFORE_H1, ...DEPLOY_H1];

/** The production H2 starts from: H1, its handed-over commit (CI green, merged into the deployment branch). */
const H1_COMMIT = '1651df1dd669381395cfa464bf0d59264c677f5a';
const H1_TAG = H1_COMMIT.slice(0, 12);
/** The legal version of H2: the day after H1's 2026-10-09 (H2's final commit is dated 2026-10-09, not later). */
const H2_LEGAL_VERSION = '2026-10-10';
const DEPLOY_H2 = NAMES.filter((n) => numberOf(n) >= 35 && numberOf(n) <= 39);
const AFTER_H2 = [...AFTER_H1, ...DEPLOY_H2];

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
];

describe('the runbook of the next lot, part H1 (docs/launch/DEPLOY-NEXT-LOT.md)', () => {
  it('starts from G, 0001 to 0032, and applies exactly 0033 and 0034, as the scripts print them', () => {
    expect(DEPLOY_H1).toEqual(['0033_model_sizes', '0034_claim_code_renewals']);
    expect(BEFORE_H1).toHaveLength(33);
    expect(BEFORE_H1.slice(-2)).toEqual(['0031_model_pairs', '0032_growth_indexes']);
    // H2's migrations (0035 on) come after H1's, in build order.
    expect(NAMES.filter((n) => numberOf(n) > 34).every((n) => n > DEPLOY_H1.at(-1)!)).toBe(true);
    expect([...AFTER_H1].sort()).toEqual(AFTER_H1);
    expect(runbook).toContain('[son runbook](DEPLOY-NEXT-NINE.md)');
    expect(runbook).toContain(`le commit \`${PREV_COMMIT}\` (image \`orbes-genome:${PREV_TAG}\``);
    expect(runbook).toContain(`les trente-trois migrations de \`${BEFORE_H1[0]}\` à \`${BEFORE_H1.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE_H1.slice(-2).join('\n'));
    expect(runbook).toContain(`Sortie attendue : trente-trois lignes, de \`${BEFORE_H1[0]}\` à \`${BEFORE_H1.at(-1)}\``);
    expect(runbook).toContain(`schema: ${BEFORE_H1.length} migration(s) applied, all known to orbes-genome:<TAG_H1>`);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_H1);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY_H1.length} migration(s): ${DEPLOY_H1.join(', ')}`);
    expect(runbook).toContain(`(previous: ${PREV_TAG}). This release applied the migration(s) ${DEPLOY_H1.join(', ')}:`);
    expect(runbook).toContain(`deploy <TAG_H1> OK (previous ${PREV_TAG}; migrations ${DEPLOY_H1.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER_H1.length} lignes \`applied\`, de \`${AFTER_H1[0]}\` à \`${AFTER_H1.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : \`${PREV_COMMIT}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${PREV_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${PREV_COMMIT.slice(0, 7)}..<7 caractères de SHA_H1>\``);
    expect(runbook).toContain(`\`… deploy ${PREV_TAG} OK (previous …)\``);
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
  });

  it('holds the plan\'s §7 and the owner\'s rules: nothing changes on the host', () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain('**Ton accord sur les captures d\'abord.**');
    // Paris first, UTC in brackets (owner rule §0.12).
    expect(rules).toContain('**Jamais entre 05:00 et 07:30 à Paris jusqu\'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)');
    expect(rules).toContain('03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu\'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)');
    expect(section(runbook, '### 1.1')).toContain('une heure **hors** de 05:00–07:30 à Paris jusqu\'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC');
    expect(rules).toContain('**Aucune heure n\'est réservée**');
    expect(rules).toContain('la CI verte sur le commit exact, le diff de `deploy/vps` vide après l\'avance rapide, le lancement gardé');
    expect(rules).toContain('**Rien ne change sur l\'hôte**');
    // The heads-up at launch (plan §7's example) and after.
    expect(section(runbook, '### 1.4')).toContain('« ORBES H1 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_H1>, 2 migrations, rien ne change sur l\'hôte.');
    expect(section(runbook, '### 1.6')).toContain('**Préviens le responsable de l\'hôte**');
    // The deploy/vps diff against G's commit, nothing expected; no Caddy recreated.
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${PREV_COMMIT} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi');
    expect(section(runbook, '### 1.4')).not.toContain('Recreate`');
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c), c).toHaveLength(2);
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    const before = section(runbook, '### 1.1');
    for (const what of ['**Aucune LIVE RELEASE**', '**Aucun test de TEST ENTRANTS en cours**', '**Préviens ORBES Client Services**', '**Aucune carte de client n\'existe au format 85 × 55 mm**']) expect(before, what).toContain(what);
    // The lost-card procedure, as the playbook (both copies) names it.
    expect(before).toContain('« La carte perdue avant l\'enregistrement »');
    expect(readDoc('docs/launch/SALES-PLAYBOOK.md')).toContain('### La carte perdue avant l\'enregistrement');
  });

  it('carries H1\'s legal version, the checks before the first customer card, one real check per feature, the questions still open', () => {
    expect(LEGAL_VERSION >= H1_LEGAL_VERSION).toBe(true);
    expect(readDoc('genome/test/web/legal.content.test.ts')).toContain(`'${H1_LEGAL_VERSION}': '`);
    expect(runbook).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${H1_LEGAL_VERSION}';\`.`);
    expect(section(runbook, '## 0.')).toContain('Sa date ne retient jamais le déploiement.');
    const after = section(runbook, '### 1.8');
    for (const what of ['95 × 62 mm', 'une planche A4 de huit', 'AUTHENTIC', 'les licences des polices', 'donne à chaque modèle son type de taille']) expect(after, what).toContain(what);
    const checks = section(runbook, '### 1.7');
    for (const what of ['§3.1', '§3.2', '§3.3', '§3.4, en stock', '§3.4, vendue']) expect(checks, what).toContain(`| ${what} |`);
    const open = section(runbook, '## 3.');
    // Questions 1 to 10 open for H1, then 11 to 20 for H2 (the plan's numbers).
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(section(runbook, '## 2.')).toContain('jamais contre G');
  });

  it('names the console and the app as they show themselves', () => {
    const admin = (file: string): string => readDoc(`genome/src/web/admin/${file}`);
    const labels: ReadonlyArray<readonly [label: string, file: string]> = [
      ['Products', 'model/dashboard.ts'],
      ['Generator', 'main.ts'],
      ['Catalogue', 'main.ts'],
      ['Documents', 'main.ts'],
      ['Messages', 'main.ts'],
      ['Download certificate card', 'ui/claim-code.ts'],
      ['Sheets of eight cards', 'views/generator.ts'],
      ['Re-issue code', 'views/product.ts'],
      ['Ring size', 'model/sizes.ts'],
      ['Bracelet size', 'model/sizes.ts'],
      ['Necklace length', 'model/sizes.ts'],
      ['Watch', 'model/sizes.ts'],
      ['One size', 'model/sizes.ts'],
      ['To give', 'model/sizes.ts'],
      ['Set aside', 'model/sizes.ts'],
      ['Reinstate', 'model/sizes.ts'],
      ['Claim code', 'views/product.ts'],
      ['New claim code', 'views/product.ts'],
      ['New claim codes', 'views/product.ts'],
    ];
    for (const [label, file] of labels) {
      expect(runbook, label).toContain(`\`${label}\``);
      expect(admin(file), `${label}: not in ${file}`).toMatch(new RegExp(`['\`]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
    expect(admin('model/product.ts')).toContain('New claim code made. ');
    const copy = readDoc('genome/src/web/verify/copy.ts');
    for (const words of ['YOUR NEW CLAIM CODE', 'SHOW THE CODE', 'REGISTER THIS PIECE', 'COPY CODE', 'SAVE YOUR NEW CARD', 'VARIANT', 'MY PIECES']) {
      expect(runbook, words).toContain(words);
      expect(copy, words).toContain(`'${words}'`);
    }
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(20);
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
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-NEXT-LOT.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-NEXT-LOT.md)');
  });
});

describe('the runbook of the next lot, part H2 (docs/launch/DEPLOY-NEXT-LOT.md §2)', () => {
  const h2 = section(runbook, '## 2.');
  const h2Commands = fenced(h2, 'bash');
  const h2Outputs = fenced(h2, 'text');

  it('starts from H1, 0001 to 0034, and applies exactly 0035 to 0039, as the scripts print them', () => {
    expect(DEPLOY_H2).toEqual(['0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery']);
    expect(NAMES).toEqual(AFTER_H2);
    expect(AFTER_H1).toHaveLength(35);
    expect(h2).toContain(`le commit \`${H1_COMMIT}\` (image \`orbes-genome:${H1_TAG}\`), avec les trente-cinq migrations de \`${AFTER_H1[0]}\` à \`${AFTER_H1.at(-1)}\``);
    expect(h2).toContain(`Sortie attendue : trente-cinq lignes, de \`${AFTER_H1[0]}\` à \`${AFTER_H1.at(-1)}\``);
    expect(h2Outputs.join('\n')).toContain(AFTER_H1.slice(-2).join('\n'));
    expect(h2).toContain(`schema: ${AFTER_H1.length} migration(s) applied, all known to orbes-genome:<TAG_H2>`);
    const rows = [...section(runbook, '### 2.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_H2);
    expect(h2).toContain(`Applied ${DEPLOY_H2.length} migration(s): ${DEPLOY_H2.join(', ')}`);
    expect(h2).toContain(`(previous: ${H1_TAG}). This release applied the migration(s) ${DEPLOY_H2.join(', ')}:`);
    expect(h2).toContain(`orbes-genome:${H1_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${H1_TAG} refuses it).`);
    expect(h2).toContain(`deploy <TAG_H2> OK (previous ${H1_TAG}; migrations ${DEPLOY_H2.join(', ')})`);
    expect(h2).toContain(`les ${AFTER_H2.length} lignes \`applied\`, de \`${AFTER_H2[0]}\` à \`${AFTER_H2.at(-1)}\``);
    // H1 as the last deployment: its log line exactly as part H1 expects it after H1.
    expect(h2).toContain(`\`… deploy ${H1_TAG} OK (previous ${PREV_TAG}; migrations ${DEPLOY_H1.join(', ')})\``);
    expect(h2).toContain(`Sortie attendue : \`${H1_COMMIT}\` au début de la ligne`);
    expect(h2).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${H1_TAG}\`.`);
    expect(h2).toContain(`\`Updating ${H1_COMMIT.slice(0, 7)}..<7 caractères de SHA_H2>\``);
    expect(h2).toContain(`- **Le commit final** (règle 7) : la branche \`orbes-next-lot\``);
  });

  it('diffs deploy/vps against H1, never G, and sends the packing photo under the edge\'s 64 KB, with nothing changed on the host', () => {
    expect(h2Commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${H1_COMMIT} HEAD -- deploy/vps`);
    expect(h2Commands.join('\n')).not.toContain(PREV_COMMIT);
    expect(h2).toContain('jamais contre G');
    // The packing photo: the route the console uploads it to, which the edge holds at 64 KB (no exception, nothing
    // changed on the host), and the console's photo at that limit at most, from 1 600 px down to 1 024 px.
    const before = section(runbook, '### 2.1');
    const route = PACKING_PHOTO_UPLOAD_ROUTE;
    expect(before).toContain(`\`PUT ${route}\``);
    expect(before).toContain('**1. La photo d\'emballage : rien à faire.**');
    expect(before).toContain('La console envoie donc la photo en JPEG de 64 Ko au plus : elle baisse d\'abord sa qualité à 1 600 px, puis sa taille, jusqu\'à 1 024 px.');
    expect(before).toContain(`l'agent lit « ${PACKING_PHOTO_LIMITS.tooLarge} »`);
    expect(before).not.toContain('point bloquant');
    expect(h2).toContain('- **Caddy** : rien ne change. La photo d\'emballage passe sous sa limite de 64 Ko (§2.1).');
    const caddy = readDoc('deploy/vps/Caddyfile');
    expect(caddy).not.toContain('packing/photo');
    const edge = /request_body @not_upload \{\s*max_size (\d+)KB\s*\}/.exec(caddy);
    expect(edge?.[1]).toBe('64');
    expect(Number(edge![1]) * 1000).toBe(PACKING_PHOTO_EDGE_BYTES);
    expect(PACKING_PHOTO_LIMITS.maxBytes).toBe(PACKING_PHOTO_EDGE_BYTES);
    expect(PACKING_PHOTO_LIMITS.sides[0]).toBe(1600);
    expect(PACKING_PHOTO_LIMITS.sides.at(-1)).toBe(1024);
    expect(PACKING_PHOTO_LIMITS.tooLarge).toBe('This photo stays over 64 KB, even at 1 024 px. Take it again, closer to the parcel.');
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('**The packing photo (plan NEXT LOT §3.5.6.8, deployment H2): under the edge\'s 64 KB.**');
    expect(readDoc('genome/src/server/services/logistics.ts')).toContain('add the photo before it is packed.');
    // The console's allowlist, read for the agent's logins.
    expect(h2Commands).toContain("grep '^ADMIN_ALLOWED_IPS=' .env");
    expect(readDoc('deploy/vps/.env.example')).toContain('ADMIN_ALLOWED_IPS=0.0.0.0/0 ::/0');
    expect(h2).toContain('`ADMIN_ALLOWED_IPS=0.0.0.0/0 ::/0`');
    // The guarded launch, the heads-up at launch and after, restore.sh only to watch it refuse, no prune.
    expect(h2Commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(section(runbook, '### 2.4')).toContain('« ORBES H2 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_H2>, 5 migrations, rien ne change sur l\'hôte.');
    expect(section(runbook, '### 2.6')).toContain('**Préviens le responsable de l\'hôte**');
    expect(section(runbook, '### 2.1')).toContain('une heure **hors** de 05:00–07:30 à Paris jusqu\'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC');
    for (const c of h2Commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(h2Commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(section(runbook, '### 2.5')).toContain(`**jamais \`scripts/deploy.sh --image ${H1_TAG}\`**`);
  });

  it('carries H2\'s legal version, what to tell before, one real check per feature, what to set after, and the questions still open', () => {
    expect(LEGAL_VERSION >= H2_LEGAL_VERSION).toBe(true);
    expect(readDoc('genome/test/web/legal.content.test.ts')).toContain(`'${H2_LEGAL_VERSION}': '`);
    expect(h2).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${H2_LEGAL_VERSION}';\`.`);
    expect(h2).toContain(`une seule nouvelle version, \`${H2_LEGAL_VERSION}\` (le lendemain de \`${H1_LEGAL_VERSION}\`, celle de H1)`);
    const before = section(runbook, '### 2.1');
    for (const what of ['**H1 est en production**', '**Aucune LIVE RELEASE**', '**Aucun test de TEST ENTRANTS en cours**', '**Les pièces à fabriquer encore ouvertes**', '**Préviens ORBES Client Services**', '**Préviens l\'agent logistique**']) expect(before, what).toContain(what);
    // The playbook's procedures, as both copies name them.
    const playbook = readDoc('docs/launch/SALES-PLAYBOOK.md');
    for (const title of ['Recevoir une livraison et la confirmer', 'Un problème de colis', 'Retours et échanges', 'Commandes fournisseur', 'L\'adresse et la gravure du client']) {
      expect(before, title).toContain(`« ${title} »`);
      expect(playbook, title).toContain(`### ${title}`);
    }
    const checks = section(runbook, '### 2.7');
    for (const what of ['§3.5, la console', '§3.5, l\'agent', '§3.5, une commande fournisseur', '§3.6.A', '§3.6.B', '§3.6.C', '§3.6.F']) expect(checks, what).toContain(`| ${what} |`);
    expect(checks).toContain('« No supplier order … is expected here. »');
    expect(readDoc('genome/src/server/services/receptions.ts')).toContain('`No supplier order ${ref} is expected here.');
    const after = section(runbook, '### 2.8');
    for (const what of ['**`Settings` → `Locations`, d\'abord.**', '**`Team`**', '`NO PIECE`', '**`Orders` → `Settings`**', '**`Supplier orders` → `Suppliers`**', '**`Catalogue`**']) expect(after, what).toContain(what);
    const open = section(runbook, '## 3.');
    expect(open).toContain('Et pour H2 (les numéros du plan)');
  });

  it('names the console and the app as they show themselves', () => {
    const admin = (file: string): string => readDoc(`genome/src/web/admin/${file}`);
    const labels: ReadonlyArray<readonly [label: string, file: string]> = [
      ['Logistics', 'main.ts'],
      ['Supplier orders', 'main.ts'],
      ['To ship', 'model/logistics.ts'],
      ['On its way', 'model/logistics.ts'],
      ['Receptions', 'model/logistics.ts'],
      ['Stock', 'model/logistics.ts'],
      ['Returns', 'model/logistics.ts'],
      ['Corrections', 'model/logistics.ts'],
      ['Count pieces in', 'model/logistics.ts'],
      ['Locations', 'views/team.ts'],
      ['To order', 'views/logistics.ts'],
      ['Suppliers', 'views/supplier-orders.ts'],
      ['Add a supplier', 'model/suppliers.ts'],
      ['Edit supplier', 'views/lookbook.ts'],
      ['PDF', 'views/supplier-order.ts'],
      ['Discard the draft', 'model/supplier-orders.ts'],
      ['Confirmed by the supplier', 'model/supplier-orders.ts'],
      ['Shipping', 'views/order.ts'],
      ['Order case', 'model/order-cases.ts'],
      ['Open a return', 'model/order-cases.ts'],
      ['Ship', 'views/shipping.ts'],
      ['Link a piece', 'views/order.ts'],
      ['Address', 'views/settings.ts'],
      ['Make default', 'views/settings.ts'],
      ['Engraving', 'views/settings.ts'],
      ['Add to supplier order', 'views/stock-check.ts'],
      ['Sizes and pieces', 'views/drop.ts'],
      ['Offer next', 'views/drop.ts'],
    ];
    for (const [label, file] of labels) {
      expect(label === 'Confirmed by the supplier' ? section(runbook, '## 3.') : h2, label).toContain(`\`${label}\``);
      if (label === 'Link a piece') continue; // removed from the console by H2: named as gone, and gone
      expect(admin(file), `${label}: not in ${file}`).toMatch(new RegExp(`['\`]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
    expect(admin('views/order.ts')).not.toContain("'Link a piece'");
    const copy = readDoc('genome/src/web/verify/copy.ts');
    for (const words of ['IN PREPARATION', 'DELIVERY ADDRESS', 'YOUR ADDRESSES', 'MAKE DEFAULT', 'ENGRAVING', 'RETURNS AND EXCHANGES', 'REQUEST A RETURN', 'EXCHANGE THE SIZE', 'YOUR SIZE', 'ENTER THE DRAW']) {
      expect(h2, words).toContain(words);
      expect(copy, words).toContain(`'${words}'`);
    }
  });
});
