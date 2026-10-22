/**
 * docs/launch/DEPLOY-MACRO-M3.md, the owner's runbook for lot M3 of the macro scope of 2026-10-20 (plan step M3.22),
 * against the scripts, the stack, the migrations, the server and the apps it quotes:
 *
 *  - it starts from production as lot M2 leaves it (its commit, 0001 to 0053) and applies exactly 0054_boxes_weights,
 *    0055_location_countries, 0056_addons and 0057_sets, as the scripts print it: the table of §1.0, the files the
 *    commit adds under migrations since M2's head, the lines `db_applied_migrations` and deploy.sh print before, the
 *    line `db.ts migrate` prints, those deploy.sh prints after it, the deployment log and the `applied` lines
 *    `db.ts status` shows, each count and its first and last names derived from MIGRATIONS, never written here; M2's
 *    image no longer runs on the schema after them, so a failure after them is repaired forward, and a rollback exists
 *    only before them;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts and the app is still one they print;
 *  - the owner's rules: his look at the screens first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the hub's backup
 *    minutes, no slot booked and a heads-up at launch, the box's figures before and after, the guarded launch,
 *    restore.sh only ever run to watch it refuse, no prune; nothing on the host changes: the deploy/vps diff since M2 is
 *    empty, no commit of lot M3 touches deploy/vps, no `.env` line; the legal pages' new version, the ORBES CARE
 *    conditions keeping theirs; Client Services and LOGISTICS told before (the playbook's M3 lines, both copies);
 *  - the post-check: 58 `applied` lines from the migrations list, the box read only (nothing pre-filled), the new
 *    console pages empty in their own words;
 *  - one real check per element, in the console's and the app's words as the code has them: a real box and a too-small
 *    one refused, a model's box and packed weight read on the next parcel and its slip; the returns report; SERVES, then
 *    Order a model, a line changed, Add to drafts and the draft discarded; a real add-on counted in, added on the phone
 *    and removed on a computer on the owner's own order, once in light mode; a set and a DRAFT draw of it, cancelled,
 *    never published; the legal pages; then the owner's data to enter; one command per shell block, relative links that
 *    resolve, and the runbook linked from DEPLOYMENT and COMPLIANCE.
 *
 * <SHA_M1>/<TAG_M1> (read in M2's log line), <SHA_M2>, <TAG_M2>, <SHA_M3> and <TAG_M3> stay placeholders until the
 * main session hands the commits over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { boxTooSmall } from '../../src/server/services/boxes.js';
import { ADDON_SKU_TEXT, ADDON_STATUS_LABELS, ADDONS_TEXT, ORDER_ADDONS_TEXT } from '../../src/web/admin/model/addons.js';
import { BOXES_TEXT, boxProblem, boxSourceLine, CARD_RULE, MODEL_PACKING_TEXT, PARCEL_BOX_TEXT } from '../../src/web/admin/model/boxes.js';
import { dropPhrase } from '../../src/web/admin/model/club.js';
import { countriesSavedToast, LOCATION_COUNTRIES_TEXT } from '../../src/web/admin/model/location-countries.js';
import { STOCK_TEXT } from '../../src/web/admin/model/logistics.js';
import { RETURNS_COPY, RETURNS_PERIOD_LABELS } from '../../src/web/admin/model/order-returns.js';
import { OFFER_TEXT, SETS_TEXT, setsOnSaleLines } from '../../src/web/admin/model/sets.js';
import { SPLIT_COLUMNS, SPLIT_TEXT, splitTotalLine, splitTotalWarning } from '../../src/web/admin/model/size-split.js';
import { ORDER_TEXT, SUPPLIER_ORDER_STATUS_LABELS } from '../../src/web/admin/model/supplier-orders.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { TERMS } from '../../src/web/legal/content/terms.js';
import { ACCOUNT, MODE, ORDERS, PIECES, SETS, SOUND } from '../../src/web/verify/copy.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-MACRO-M3.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Lot M2's head on orbes-macro, on which lot M3 is built (plan M3, base): reachable in a full clone only. */
const M2_HEAD = 'd09dc519ef7897b1cb3228bbadef55ecc3b17b13';
/** The legal version of this lot (step M3.20), and the ORBES CARE conditions', unchanged since ORBES CARE. */
const M3_LEGAL_VERSION = '2026-10-23';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
/** Lot M2's newest migration, and lot M3's four (plan M3 §0). */
const M2_LAST = '0053_worn';
const M3_NAMES = ['0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets'];
const DEPLOY = NAMES.slice(NAMES.indexOf(M2_LAST) + 1).filter((n) => M3_NAMES.includes(n));
const BEFORE = NAMES.slice(0, NAMES.indexOf(M2_LAST) + 1);
const AFTER = [...BEFORE, ...DEPLOY];
/** M2's own migrations, as M2's runbook and its deployment log name them. */
const M2_DEPLOY = NAMES.filter((n) => ['0052', '0053'].includes(n.slice(0, 4)));

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
  ['If anything goes wrong, repair forward: scripts/deploy.sh --image ', 'deploy/vps/scripts/deploy.sh'],
  [' OK (previous ', 'deploy/vps/scripts/deploy.sh'],
  ['no rollback: repair forward', 'deploy/vps/scripts/deploy.sh'],
  [' and is KEPT', 'deploy/vps/scripts/deploy.sh'],
  ['rollback to orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['rolled back to ', 'deploy/vps/scripts/deploy.sh'],
  ['; the stack is healthy', 'deploy/vps/scripts/deploy.sh'],
  [' is NOT healthy either', 'deploy/vps/scripts/deploy.sh'],
  ['this image cannot run on this schema: repair forward', 'deploy/vps/scripts/deploy.sh'],
  ['photos: ', 'deploy/vps/scripts/backup.sh'],
  ['db.dump: ', 'deploy/vps/scripts/backup.sh'],
  ['backup complete: ', 'deploy/vps/scripts/backup.sh'],
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', 'deploy/vps/scripts/restore.sh'],
  ['Nothing was done.', 'deploy/vps/scripts/restore.sh'],
  ['live engine: leading', 'genome/src/server/services/live-engine.ts'],
];

/** A read-only query of the box, as the runbook writes it. */
const psql = (query: string) => `docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "${query}"'`;

/** The text block of the runbook whose first line starts with `first`, as lines. */
function block(first: string): string[] {
  const found = outputs.find((o) => o.startsWith(first));
  if (!found) throw new Error(`no text block starting with "${first}"`);
  return found.split('\n');
}

/** git in the repository, or null where its history does not hold M2's head (genome-ci's shallow checkout). */
function git(args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${M2_HEAD}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    return null;
  }
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

/** A string quoted as the runbook writes a word of the console (`…`) or a sentence (« … »). */
const word = (w: string) => `\`${w}\``;
const said = (s: string) => `« ${s} »`;

describe('the runbook of lot MACRO M3 (docs/launch/DEPLOY-MACRO-M3.md)', () => {
  it('starts from lot M2 in production and applies exactly 0054 to 0057, as the scripts print it, every count from MIGRATIONS', () => {
    expect(DEPLOY).toEqual(M3_NAMES);
    // M3's migrations follow M2's at once; a later lot's (M4) only ever come after them.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_M3>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration, and the tables it names, as the migrations create them.
    const changes = section(runbook, '### 1.0');
    const rows = [...changes.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY);
    const migration = (name: string) => readDoc(`genome/src/server/db/migrations/${name}.ts`);
    const tables: Record<string, string[]> = {
      '0054_boxes_weights': ['boxes'],
      '0055_location_countries': ['stock_location_countries'],
      '0056_addons': ['addon_items', 'addon_item_prices', 'order_addon_items', 'addon_choices'],
      '0057_sets': ['sets', 'set_models', 'set_sales', 'drop_entry_sizes', 'live_entry_sizes', 'live_interest_sizes'],
    };
    for (const [name, list] of Object.entries(tables)) {
      for (const t of list) {
        expect(migration(name), t).toContain(`CREATE TABLE ${t} (`);
        expect(changes, t).toContain(`\`${t}\``);
      }
    }
    expect(migration('0056_addons')).toContain('CREATE VIEW stock_holds');
    expect(changes).toContain('la vue `stock_holds`');
    // No migration inserts a row: nothing is pre-filled (rule 12).
    for (const name of DEPLOY) expect(migration(name), name).not.toMatch(/\bINSERT INTO\b/);
    // The files the commit adds under migrations since M2's head, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --name-status <SHA_M2> HEAD -- genome/src/server/db/migrations');
    const added = git(['diff', '--name-status', M2_HEAD, '--', 'genome/src/server/db/migrations']);
    if (added !== null) {
      const prefix = 'A\tgenome/src/server/db/migrations/';
      const lines = added.trim().split('\n');
      // Since M2's head: M3's four, then only a later lot's.
      expect(lines.slice(0, DEPLOY.length)).toEqual(DEPLOY.map((n) => `${prefix}${n}.ts`));
      expect(lines.slice(DEPLOY.length).every((l) => l.startsWith(prefix) && l.slice(prefix.length) > `${DEPLOY.at(-1)}.ts`)).toBe(true);
    }
    // db.ts migrate, then deploy.sh's end and its log line.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`**Il faut lire \`Applied ${DEPLOY.length} migration(s)\`.**`);
    expect(runbook).toContain('previous image tag: <TAG_M2>');
    expect(runbook).toContain(`(previous: <TAG_M2>). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      'orbes-genome:<TAG_M2> cannot run on this schema any more (scripts/deploy.sh --image <TAG_M2> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M3> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).',
    );
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_M3> OK (previous <TAG_M2>; migrations ${DEPLOY.join(', ')})`);
    // The post-check's count, with its first and last names: 58 lines, the two 0024 migrations counted.
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // M2 as the last deployment: its log line exactly as M2's runbook expects it.
    const m2Line = `deploy <TAG_M2> OK (previous <TAG_M1>; migrations ${M2_DEPLOY.join(', ')})`;
    expect(runbook).toContain(`\`… ${m2Line}\``);
    expect(readDoc('docs/launch/DEPLOY-MACRO-M2.md')).toContain(m2Line);
    expect(runbook).toContain('Sortie attendue : `<SHA_M2>` au début de la ligne');
    expect(runbook).toContain('Sortie attendue : `ORBES_IMAGE_TAG=<TAG_M2>`.');
    expect(runbook).toContain('`Updating <7 caractères de SHA_M2>..<7 caractères de SHA_M3>`');
    expect(runbook).toContain('**M3 ne part qu\'après M2**');
    // The placeholders, filled before the day; a runbook re-based when production runs another image.
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain('Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `<TAG_M2>`');
  });

  it('expects from the scripts and the app only messages they print, and a rollback only before the migrations', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('FORWARD="If anything goes wrong, repair forward: scripts/deploy.sh --image $TAG after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7)."');
    // Caddy is recreated only when its configuration's hash changes: here it does not, so it keeps its container.
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('CADDY_CONFIG_HASH="$(cat "$STACK_DIR/Caddyfile"');
    expect(section(runbook, '### 1.4')).toContain('Caddy garde son conteneur, sa configuration n\'ayant pas changé.');
    expect(runbook).not.toContain('Recreate');
    const trouble = section(runbook, '### 1.5');
    expect(trouble).toContain("Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant.");
    expect(trouble).toContain('`── rollback to orbes-genome:<TAG_M2>` et `rolled back to <TAG_M2>; the stack is healthy`');
    expect(trouble).toContain('`WARNING: deployment of <TAG_M3> failed (…) and is KEPT`');
    expect(trouble).toContain('**jamais `scripts/deploy.sh --image <TAG_M2>`**');
  });

  it("holds the owner's rules: nothing on the host changes (deploy/vps untouched since M2, no .env line), the legal pages' new version", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les écrans d'abord.**");
    // Paris first, UTC in brackets.
    expect(rules).toContain("**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(rules).toContain("03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)");
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC");
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain('le diff de `deploy/vps` vide après l\'avance rapide');
    expect(rules).toContain('**Jamais `restore.sh` sur ce serveur**');
    expect(rules).toContain('**Rien ne change sur l\'hôte**');
    expect(rules).toContain('**Rien n\'est prérempli**');
    expect(rules).toContain('la branche `orbes-macro` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The deploy/vps diff against M2 in production: empty.
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --name-status <SHA_M2> HEAD -- deploy/vps');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain('-- deploy/vps\n```\n\nSortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.');
    const diff = git(['diff', '--name-status', M2_HEAD, '--', 'deploy/vps']);
    const log = git(['log', '--no-merges', '--format=%H %s', `${M2_HEAD}..HEAD`, '--', 'deploy/vps']);
    if (diff !== null && log !== null) {
      // No commit of lot M3 touches deploy/vps (compose.yaml, the Caddyfile, .env.example, the scripts): a later lot's
      // change, if any, is its own runbook's.
      expect(log.trim().split('\n').filter((l) => / MACRO-M3\./.test(l))).toEqual([]);
      if (!log.trim()) expect(diff.trim()).toBe('');
    }
    expect(section(runbook, '### 1.0')).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    expect(section(runbook, '### 1.2')).toContain('Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n\'y touches pas.');
    // The heads-up at launch and after: nothing changes on the host.
    expect(section(runbook, '### 1.4')).toContain('« MACRO M3 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_M3>, 4 migrations ; rien ne change sur l\'hôte');
    expect(section(runbook, '### 1.6')).toContain("**Préviens le responsable de l'hôte**");
    // The box's figures before and after, the swap line read.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(commands.filter((c) => /docker image rm/.test(c))).toEqual([]);
    expect(section(runbook, '### 1.4')).toContain("**Note le nom de l'archive et sa taille en octets**");
    // The legal pages: one new version, the code's; the ORBES CARE conditions keep theirs; counsel never holds the deploy.
    // A later lot may move LEGAL_VERSION past it; M3's head publishes M3's.
    expect(LEGAL_VERSION >= M3_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${M3_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${M3_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(readDoc('genome/src/web/legal/content/index.ts')).toContain(`${M3_LEGAL_VERSION} is the version of lot M3`);
    expect(readDoc('genome/src/server/render/care-conditions.ts')).toContain(`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';`);
  });

  it('reads the box after the migrations, read only, nothing pre-filled, and the new console pages empty in their words', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    const counts = [
      'select count(*) from boxes',
      'select count(*) from models where box_id is not null or packed_weight_g is not null',
      'select count(*) from stock_location_countries',
      'select count(*) from addon_items',
      'select count(*) from order_addon_items',
      'select count(*) from sets',
      'select count(*) from drops where set_id is not null',
    ];
    expect(reads).toEqual([psql(`select ${counts.map((q) => `(${q})`).join(', ')}`)]);
    expect(after).toContain(`Sortie attendue : \`${counts.map(() => '0').join('|')}\`.`);
    for (const q of commands.filter((c) => c.includes('psql'))) expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop|truncate)\b/i);
    // The columns the query reads, as the migrations add them.
    expect(readDoc('genome/src/server/db/migrations/0054_boxes_weights.ts')).toContain('ALTER TABLE models ADD COLUMN box_id');
    expect(readDoc('genome/src/server/db/migrations/0054_boxes_weights.ts')).toContain('ALTER TABLE models ADD COLUMN packed_weight_g');
    expect(readDoc('genome/src/server/db/migrations/0057_sets.ts')).toContain('ALTER TABLE drops ADD COLUMN set_id');
    // The console's empty pages, each in its own words.
    expect(after).toContain(`${word('Boxes')} : ${said(BOXES_TEXT.empty)}`);
    expect(readDoc('genome/src/web/admin/views/settings.ts')).toContain("'Boxes',");
    expect(after).toContain(`la colonne ${word(LOCATION_COUNTRIES_TEXT.serves)} lit \`—\``);
    expect(after).toContain(`${word(ADDONS_TEXT.title)} : ${said(ADDONS_TEXT.empty)}`);
    expect(after).toContain(`${word(SETS_TEXT.title)} : ${said(SETS_TEXT.empty)}`);
    expect(after).toContain(`section ${word(ADDON_SKU_TEXT.group)} : ${said(ADDON_SKU_TEXT.groupEmpty)}`);
    const logistics = readDoc('genome/src/web/admin/views/logistics.ts');
    for (const l of ["label: 'On hand'", "label: 'Reserved'"]) expect(logistics, l).toContain(l);
    expect(after).toContain('(`On hand`, `Reserved`), lus désormais par la vue `stock_holds`');
    expect(readDoc('genome/src/web/admin/views/orders.ts')).toContain("linkButton('Returns', href('orderReturns'), 'ghost')");
    expect(after).toContain(`\`Orders\` → \`Returns\` s'ouvre sur ${word(RETURNS_PERIOD_LABELS['12m'])}`);
    // From the Mac: health and the app.
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/health');
    expect(after).toContain('Sortie attendue : `{"ok":true,"version":"0.1.0"}`.');
  });

  it('checks a real box, a too-small one refused, a model’s packing, the parcel, and the returns report, in the code’s words', () => {
    const checks = section(runbook, '### 1.7');
    // A real box, its six fields, the card rule under its sides, Save.
    const settings = readDoc('genome/src/web/admin/views/settings.ts');
    for (const label of ['Name', 'Inside length (mm)', 'Inside width (mm)', 'Inside height (mm)', 'Empty weight (g)', 'Cost', 'Currency']) {
      expect(settings, label).toContain(`label: '${label}'`);
      expect(checks, label).toContain(word(label));
    }
    expect(checks).toContain(`\`Orders\` → \`Settings\` → \`Boxes\` → ${word(BOXES_TEXT.add)}`);
    expect(checks).toContain(`Sous les côtés : ${said(CARD_RULE)}`);
    expect(checks).toContain(`\`Save\` : ${said(BOXES_TEXT.added)}`);
    // The too-small box: the dialog refuses it in the server's own words, before anything is sent.
    const small = { name: 'TEST', insideLengthMm: '90', insideWidthMm: '60', insideHeightMm: '30', emptyWeightG: '20', cost: '', currency: '' };
    expect(boxProblem(small)).toBe(boxTooSmall().publicMessage);
    expect(checks).toContain(`intérieur 90 × 60 × 30 mm, \`Empty weight (g)\` 20, puis \`Save\` : la boîte reste ouverte et dit ${said(boxTooSmall().publicMessage)}`);
    // A model's Packing, the Catalogue's Box column.
    const model = readDoc('genome/src/web/admin/views/lookbook.ts');
    for (const w of ["label: 'Box'", "label: 'Packed weight (g)'", "confirmLabel: 'Save packing'"]) expect(model, w).toContain(w);
    expect(checks).toContain(`section ${word(MODEL_PACKING_TEXT.title)}, \`Edit\` : \`Box\` ta boîte, \`Packed weight (g)\``);
    expect(checks).toContain(`\`Save packing\` : ${said(MODEL_PACKING_TEXT.saved)}`);
    expect(readDoc('genome/src/web/admin/views/catalogue.ts')).toContain("label: 'Box',");
    expect(checks).toContain('la colonne `Box`');
    // The next parcel: its box and source line, its weight, then the slip's block once packed.
    const box = { id: 'b', name: 'CUBE 80', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 40, emptyWeightG: 40, active: true };
    expect(boxSourceLine({ box, boxSource: 'MODEL', pieces: 1, modelsWithoutBox: [] } as unknown as Parameters<typeof boxSourceLine>[0])).toBe('The piece’s box.');
    expect(checks).toContain(`\`Box\` lit ta boîte et ${said('The piece’s box.')} ; ${said(PARCEL_BOX_TEXT.weight)}`);
    expect(readDoc('genome/src/web/admin/views/shipping.ts')).toContain("section('Packing', packingBody");
    const slip = readDoc('genome/src/web/admin/views/slip.ts');
    for (const w of ["'The parcel'", "row('Box', p.box", "row('Weight', p.weight"]) expect(slip, w).toContain(w);
    expect(checks).toContain(`le bordereau imprime ${said('The parcel')}, avec \`Box\` et \`Weight\`, sans le coût`);
    // The returns report: Last 12 months, a model and Show, its three tables, its empty sentence, its CSV's name.
    expect(checks).toContain(`\`Orders\` → \`Returns\` : ${word(RETURNS_PERIOD_LABELS['12m'])}, puis ${word(RETURNS_COPY.model)} un de tes modèles et ${word(RETURNS_COPY.apply)}`);
    expect(checks).toContain(`(${word(RETURNS_COPY.byReason)}, ${word(RETURNS_COPY.byModel)}, ${word(RETURNS_COPY.bySize)})`);
    expect(checks).toContain(said(RETURNS_COPY.empty));
    expect(checks).toContain(`${word(RETURNS_COPY.csv)} enregistre \`orbes-returns-<premier jour>-to-<dernier jour>.csv\``);
    expect(readDoc('genome/src/server/services/returns-report.ts')).toContain('`orbes-returns-${period.from}-to-${period.to}.csv`');
  });

  it('sets a location’s countries, orders a model by size, changes a line, adds it to drafts and discards the draft, in the code’s words', () => {
    const checks = section(runbook, '### 1.7');
    // SERVES and Edit countries.
    expect(checks).toContain(`${word(LOCATION_COUNTRIES_TEXT.edit)}, ${word(LOCATION_COUNTRIES_TEXT.add)} : France`);
    expect(countriesSavedToast([])).toBe(LOCATION_COUNTRIES_TEXT.saved);
    expect(checks).toContain(`\`Save\` : ${said(countriesSavedToast([]))} La colonne ${word(LOCATION_COUNTRIES_TEXT.serves)} les lit.`);
    // No draft before: Add to drafts joins a supplier's draft at a location, and Discard the draft deletes it whole.
    expect(readDoc('genome/src/server/services/supplier-orders.ts')).toContain(".where('status', '=', 'DRAFT').forUpdate().executeTakeFirst();");
    expect(checks).toContain(`aucune commande ne lit ${word(SUPPLIER_ORDER_STATUS_LABELS.DRAFT)}`);
    // Order a model: Model, Pieces, Locations, Propose; its columns; a line changed: the total and its warning.
    expect(checks).toContain(`\`Supplier orders\` → ${word(SPLIT_TEXT.open)} : ${word(SPLIT_TEXT.model)} un vrai modèle`);
    expect(checks).toContain(`${word(SPLIT_TEXT.pieces)} 10, ${word(SPLIT_TEXT.locations)} toutes cochées, ${word(SPLIT_TEXT.propose)}`);
    for (const c of ['Orders', 'Saved sizes', 'Proposed', 'To order'] as const) {
      expect(SPLIT_COLUMNS, c).toContain(c);
      expect(checks, c).toContain(word(c));
    }
    expect(checks).toContain(`le total lit ${said(splitTotalLine(11, 10))} et ${said(splitTotalWarning(11, 10)!)}, un avertissement seulement`);
    // Add to drafts, the drafts named, then each discarded.
    expect(checks).toContain(`${word(SPLIT_TEXT.add)} : le panneau ${said(SPLIT_TEXT.addedTitle)}`);
    expect(checks).toContain(`${word(ORDER_TEXT.discard)}, la boîte dit ${said(ORDER_TEXT.discardText)}, confirme ${word(ORDER_TEXT.discard)} : ${said(ORDER_TEXT.discarded)}`);
  });

  it('creates a real add-on, counts it in, adds it on the phone and removes it on a computer on the owner’s own order, in the code’s words', () => {
    const checks = section(runbook, '### 1.7');
    // Catalogue → Add-ons → New add-on, its fields, Add.
    const view = readDoc('genome/src/web/admin/views/addons.ts');
    for (const label of ['Name', 'Line', 'SKU code', 'Supplier', 'Weight']) {
      expect(view, label).toContain(`label: '${label}'`);
      expect(checks, label).toContain(word(label));
    }
    expect(view).toContain('label: `Price in ${c}`');
    expect(checks).toContain('`Price in EUR`');
    expect(view).toContain("confirmLabel: a ? 'Save' : 'Add'");
    expect(checks).toContain(`\`Catalogue\` → ${word(ADDONS_TEXT.title)} → ${word(ADDONS_TEXT.add)}`);
    expect(checks).toContain(`\`Add\` : ${said(ADDONS_TEXT.added)}`);
    // Counted in by a correction of one at the order's location.
    expect(checks).toContain(`section ${word(ADDON_SKU_TEXT.group)}, sa ligne à l'entrepôt de ta commande : ${word(STOCK_TEXT.correct)}, ${said(STOCK_TEXT.correctTitle)}, \`Pieces\` 1, \`Why\``);
    expect(readDoc('genome/src/web/admin/views/logistics.ts')).toContain("const deltaField = { name: 'delta', label: 'Pieces'");
    expect(checks).toContain(`${word(STOCK_TEXT.correct)} : ${said(STOCK_TEXT.corrected)}`);
    // The phone: MY PIECES → YOUR ORDERS, ADD AN ADD-ON, its sheet's TOTAL and ADD; the order's ADD-ONS with REMOVE.
    const addons = ORDERS.addons;
    expect(checks).toContain(`${PIECES.link} → ${ORDERS.title}, ta commande : ${addons.add} ouvre la feuille`);
    expect(checks).toContain(`${addons.total}, puis ${addons.save}. La commande lit ${addons.title} avec ton complément, ${addons.remove} à côté`);
    expect(checks).toContain(`de préférence ${ORDERS.step.RESERVED} (pas encore payée)`);
    // The console: the order's Add-ons, the unit HELD.
    expect(checks).toContain(`section ${word(ORDER_ADDONS_TEXT.title)} : ton complément, ${word(ADDON_STATUS_LABELS.HELD)}`);
    // The computer: MY PIECES → ORDERS, once in light mode, then REMOVE and CLICK AGAIN TO REMOVE; REMOVED.
    expect(checks).toContain(`${PIECES.link} → ${PIECES.pageTabs.orders}, la page de ta commande, ${addons.title}`);
    expect(checks).toContain(`${ACCOUNT.title}, ${MODE.label} (sous ${SOUND.label}), allumé`);
    expect(readDoc('genome/src/web/verify/copy.ts')).toContain("return forDevice('TAP AGAIN TO REMOVE', 'CLICK AGAIN TO REMOVE');");
    expect(checks).toContain(`${addons.remove}, puis CLICK AGAIN TO REMOVE`);
    expect(checks).toContain(`lit ${word(ADDON_STATUS_LABELS.REMOVED)}`);
  });

  it('creates a set and a DRAFT draw of it, read and cancelled, never published, then the legal pages, in the code’s words', () => {
    const checks = section(runbook, '### 1.7');
    // Catalogue → Sets → New set, its fields, Add.
    const view = readDoc('genome/src/web/admin/views/sets.ts');
    for (const w of ["label: 'Name'", "label: 'Code'", 'label: `Piece ${i + 1}`', "label: 'Price'", "label: 'Currency'", "confirmLabel: s ? 'Save' : 'Add'"]) expect(view, w).toContain(w);
    expect(checks).toContain(`\`Catalogue\` → ${word(SETS_TEXT.title)} → ${word(SETS_TEXT.add)} : \`Name\`, \`Code\`, \`Piece 1\` et \`Piece 2\``);
    expect(checks).toContain(`\`Add\` : ${said(SETS_TEXT.added)}`);
    // New release: What it sells, A set, Next; its sizes per piece, Sets on sale, Create release, a draft.
    const club = readDoc('genome/src/web/admin/views/club.ts');
    for (const w of ["button('New release'", "confirmLabel: 'Next'", "confirmLabel: 'Create release'", "notify('Release created as a draft.')", "label: 'Set'", "label: 'Title'"]) expect(club, w).toContain(w);
    expect(checks).toContain(`\`Club\`, section \`Drops\` → \`New release\` : ${word(OFFER_TEXT.label)} ${word(OFFER_TEXT.set)}, \`Set\` ton set, \`Next\``);
    expect(setsOnSaleLines([1, 1], ['A', 'B'], 'DRAW').onSale).toBe('Sets on sale: 1');
    expect(checks).toContain(`la boîte lit ${said('Sets on sale: 1')}`);
    expect(checks).toContain(`\`Create release\` : ${said('Release created as a draft.')}`);
    // Read, never published, then cancelled with its phrase.
    const drop = readDoc('genome/src/web/admin/views/drop.ts');
    for (const w of ["button('Publish'", "button('Cancel'", "title: 'Cancel the release'", "confirmLabel: 'Cancel release'", "done('Release cancelled.')", "'The draft never shows.'", ' No entry is taken any more, and no draw can be run.', "{ label: 'Sets', value:"]) {
      expect(drop, w).toContain(w);
    }
    expect(checks).toContain('`DRAFT`, le set et ses pièces, `Sets` 1');
    expect(checks).toContain("**N'appuie jamais sur `Publish`**");
    expect(dropPhrase('cancel', { id: 'abcdef12-0000-4000-8000-000000000000' })).toBe('CANCEL ABCDEF12');
    expect(checks).toContain(`\`Cancel\` : la boîte ${said('Cancel the release')} dit ${said('The draft never shows. No entry is taken any more, and no draw can be run.')}`);
    expect(checks).toContain(`(\`CANCEL\` et les 8 premiers caractères de la sortie), puis \`Cancel release\` : ${said('Release cancelled.')}`);
    expect(fenced(checks, 'bash')).toContain(psql('select count(*) from drops where set_id is not null and (published_at is not null or cancelled_at is null)'));
    const drops = readDoc('genome/src/server/db/migrations/0015_drops.ts');
    for (const c of ['published_at          timestamptz NULL', 'cancelled_at          timestamptz NULL']) expect(drops, c).toContain(c);
    // The set's collector screens, as the app names them, from the captures.
    expect(checks).toContain(`YOUR ORDERS avec ${SETS.orders.returnSet}, ${SETS.perPerson(1)}`);
    expect(section(runbook, '### 1.0')).toContain(`${SETS.line(3)}, avec les photos de ses pièces côte à côte et un seul prix, ${SETS.onePrice}`);
    expect(section(runbook, '### 1.0')).toContain(`avec ${SETS.orders.returnSet} à la place de ${ORDERS.returns.requestReturn}`);
    expect(section(runbook, '### 1.0')).toContain(SETS.live.reserved(1));
    expect(readDoc('genome/src/web/verify/copy.ts')).toContain("title: 'ADD TO YOUR ORDER',");
    expect(section(runbook, '### 1.0')).toContain('le groupe ADD TO YOUR ORDER');
    // The legal pages: the version line, and article 14's two new paragraphs.
    expect(checks).toContain(said(WORDS.en.version(M3_LEGAL_VERSION)));
    const terms = JSON.stringify(TERMS.en);
    for (const p of ['Add-ons.', 'THE SET.']) {
      expect(terms, p).toContain(`**${p}**`);
      expect(checks, p).toContain(said(p));
    }
  });

  it('tells Client Services and LOGISTICS before (the playbook’s M3 lines, both copies), then lists the owner’s data and what stays open', () => {
    const before = section(runbook, '### 1.1');
    for (const what of ["**1. Tes écrans d'abord**", '**MACRO M2 est en production**', '**Aucune LIVE RELEASE**', '**aucun test de TEST ENTRANTS**', '**Préviens ORBES Client Services**', '**Préviens ton prestataire logistique** (le rôle LOGISTICS)']) {
      expect(before, what).toContain(what);
    }
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768']) expect(before, what).toContain(what);
    for (const s of ['« Les compléments (add-ons) »', '« THE SET »', '« Retours et échanges »', '« La boîte et le poids du colis »']) expect(before, s).toContain(s);
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const two = section(readDoc(copy), '## 2.');
      for (const h of ['### Les compléments (add-ons)', '### THE SET', '### Retours et échanges', '### La boîte et le poids du colis', '### Commandes fournisseur']) expect(two, `${copy}: ${h}`).toContain(h);
    }
    // The owner's data, in order: boxes, each model's packing, the countries, the add-ons, Shopify ids later, a set's release.
    const data = section(runbook, '### 1.8');
    const items = [...data.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((m) => m[2]);
    expect(items.slice(0, 6)).toEqual([
      'Tes boîtes',
      'Chaque modèle, sa boîte et son poids emballé',
      'Les pays de chaque entrepôt',
      'Tes compléments',
      'Les identifiants Shopify',
      "La première sortie d'un set",
    ]);
    expect(data).toContain('**Les anciennes images (facultatif).**');
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3]);
    expect(open).toContain('la note au juriste, points 35 à 37');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(la note au juriste, points 35 à 37)');
    // R2: no size confirmation anywhere.
    expect(section(runbook, '### 1.0')).toContain('Nulle part on ne demande au collectionneur de confirmer sa taille (R2).');
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(35);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(commands).toContain('docker compose exec app node --import tsx scripts/db.ts status');
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-MACRO-M3.md)');
    expect(section(readDoc('docs/COMPLIANCE.md'), '## 13.')).toContain('(launch/DEPLOY-MACRO-M3.md)');
    // Never the words the brand keeps out of what it says.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
  });
});
