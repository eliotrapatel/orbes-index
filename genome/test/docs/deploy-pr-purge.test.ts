/**
 * docs/launch/DEPLOY-PR-PURGE.md, the owner's runbook for lot PURGE (plan PURGE, step PURGE.15: TEST PURGE, PLATFORM
 * RESET and LOCK RESET), against the scripts, the migrations, the database, the server and the console it quotes:
 *
 *  - it starts from production as lot M4 left it (0001 to 0065, image ecbb448cb2ee) and applies exactly 0066_test_purge
 *    and 0067_platform_reset, as the scripts print them, each count and name derived from MIGRATIONS; M4's image no
 *    longer runs on the schema after them, so a failure after them is repaired forward, and the downs refuse once a
 *    purge or a reset happened;
 *  - the owner's rules (memory deploy-wait-for-host-ok, times-in-paris; ANSWERS Claude 7, 9; plan §W, G2): 04:00–06:30
 *    Paris all year (in summer until 07:30 Paris), the hub backups 03:00–03:10 / 03:45–03:55 Paris all year, as
 *    maintenance-window.ts reads them; Paris first, UTC in brackets; no LIVE release between its room's opening and its
 *    end, no test running; the heads-up; the guarded launch; deploy/vps untouched and no .env line; restore.sh only run
 *    to watch it refuse; the legal pages unchanged (plan §L);
 *  - the post-check §1.6 (D12, M11, M16, B7.recount, H7): 67 `applied` lines; every read-only query RUN on a database
 *    migrated to 0067 inside a READ ONLY transaction, and the outputs the runbook expects for the new tables, the plan
 *    by class, the table/trigger/foreign-key counts, the gate and the seven definer functions' pg_proc lines equal to
 *    what that database answers; the holder printed read-only, described and never written; the PostgreSQL 17
 *    catalogue-only sentence; the dropped `current_setting` line absent;
 *  - one real check per feature in the console's words (PURGE, PURGE ALL, the PLATFORM RESET page read, LOCK RESET not
 *    pressed), the per-table sizes before the first purge and the dump size to the host after (D20, A8);
 *  - §2, PLATFORM RESET before the launch (F18, H8): the windows, no LIVE room, no test, no deploy.sh from the press
 *    until signed in again, the heads-up line, the page's count of accounts neither test nor team; after: sign in again,
 *    the last-reset line, the post-check lines and the checklist as the service and the page have them, the host's
 *    backup after a key rotation; a refusal and exit 1 (platform.reset.failed, nothing changed); the 3-minute row with
 *    its read-only SELECT; LOCK RESET; §3 the restore check (F33, M9);
 *  - one command per shell block, French, links that resolve, linked from DEPLOYMENT; no file the lot adds or changes
 *    holds the owner's email domain (R10, F1, F5; the pattern built from parts).
 *
 * <SHA_PURGE> and <TAG_PURGE> stay placeholders until the main session hands the commit over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigrator, MIGRATIONS } from '../../src/server/db/migrate.js';
import { PURGE_DELETE_TABLES } from '../../src/server/db/purge-plan.js';
import { RESET_CLASSES, RESET_PLAN } from '../../src/server/db/reset-plan.js';
import { MAINTENANCE_MARGIN_MS, maintenanceWindow, parisWhen, windowWords } from '../../src/server/services/maintenance-window.js';
import { PLATFORM_RESET_TEXT, LOCK_PHRASE, postCheckVerdict, RESET_CHECKLIST, RESET_PHRASE, resetDialogText, lockedLine } from '../../src/web/admin/model/platform-reset.js';
import { chainPurgedLine, chainVerdict } from '../../src/web/admin/model/registry.js';
import { PURGE_ALL_PHRASE, PURGE_WHAT, purgeAllDialogText, purgeDialogText, purgedLine, purgePhrase } from '../../src/web/admin/model/test-purge.js';
import { CODE_HINT } from '../../src/web/admin/ui/dialog.js';
import { LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-PR-PURGE.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Production before lot PURGE: lot M4 (deployed 27 Oct 2026, 13:01 Paris), after lot Q3's image. */
const M4_SHA = 'ecbb448cb2ee2492530db0908aa7b6d26f4e89b5';
const M4_TAG = 'ecbb448cb2ee';
const Q3_TAG = '4f8ef7b44613';
/** M4's legal version, which lot PURGE keeps (plan §L). */
const M4_LEGAL_VERSION = '2026-10-27';

const NAMES = Object.keys(MIGRATIONS);
const M4_NAMES = ['0063_margin', '0064_partners', '0065_ad_conversions'];
const M4_LAST = M4_NAMES.at(-1)!;
const PURGE_NAMES = ['0066_test_purge', '0067_platform_reset'];
const DEPLOY = NAMES.slice(NAMES.indexOf(M4_LAST) + 1).filter((n) => PURGE_NAMES.includes(n));
const BEFORE = NAMES.slice(0, NAMES.indexOf(M4_LAST) + 1);
const AFTER = [...BEFORE, ...DEPLOY];

/** What the runbook expects from the scripts and the app, each printed word for word by its source. */
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
  // The reset's own shutdown path (§2.4, the 3-minute row).
  ['platform reset done: entry 1 of the new audit chain written; restarting', 'genome/src/server/platform-reset-shutdown.ts'],
  ['platform reset refused or failed: nothing changed; restarting', 'genome/src/server/platform-reset-shutdown.ts'],
];

/** A read-only query of the box, as the runbook writes it. */
const psql = (query: string) => `docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "${query}"'`;
/** The query of a psql command of the runbook. */
const queryOf = (command: string) => command.slice(command.indexOf('-Atc "') + '-Atc "'.length, command.lastIndexOf('"'));

/** A LIVE release whose room is open or opens within the hour (DEPLOY-OQ-Q1's to M4's own read, word for word). */
const ROOM_SOON = 'room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()';

/** The post-check's reads (§1.6) whose answer is fixed by the schema at 0067, as the runbook writes them. */
const Q = {
  newTables:
    'select (select count(*) from audit_purge_gaps), (select count(*) from purge_delete_tables), (select count(*) from platform_reset_gate), (select count(*) from platform_reset_plan), (select count(*) from test_runs where purge_state is not null)',
  planByClass: 'select kind, count(*) from platform_reset_plan group by 1 order by 1',
  counts:
    'select (select count(*) from pg_tables where schemaname = current_schema()), (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = to_regnamespace(current_schema()) and not t.tgisinternal), (select count(*) from pg_constraint where connamespace = to_regnamespace(current_schema()) and confrelid <> 0)',
  outsidePlan: 'select count(*) from pg_tables where schemaname = current_schema() and tablename not in (select tbl from platform_reset_plan)',
  gate: 'select resets, launched_at is null, last_reset_at is null, authorized_by is null from platform_reset_gate',
  holder: 'select a.email, a.role, a.disabled_at is null, a.totp_secret_enc is not null from platform_reset_gate g join admin_users a on a.id = g.holder_admin_id',
  logins: 'select role, email, disabled_at is null, totp_secret_enc is not null from admin_users order by role, created_at, id',
  definers:
    'select p.proname, p.prosecdef, r.rolsuper, p.proconfig::text from pg_proc p join pg_roles r on r.oid = p.proowner where p.pronamespace = to_regnamespace(current_schema()) and p.prosecdef order by 1',
  version: 'show server_version',
  resets: 'select resets, last_reset_at from platform_reset_gate',
  launchedAt: 'select launched_at from platform_reset_gate',
  locked: 'select launched_at is not null from platform_reset_gate',
} as const;

/** The seven SECURITY DEFINER functions of lots 0066 and 0067 and their exact proconfig (PURGE.2 and PURGE.8's PostgreSQL cases). */
const PATH = '"search_path=pg_catalog, public, pg_temp"';
const DEFINER_LINES = [
  `orbes_platform_reset|t|t|{${PATH},lock_timeout=5s,orbes.guard_bypass=reset}`,
  `orbes_platform_reset_authorize|t|t|{${PATH},lock_timeout=5s}`,
  `orbes_platform_reset_lock|t|t|{${PATH},lock_timeout=5s}`,
  `orbes_platform_reset_precheck|t|t|{${PATH}}`,
  `orbes_platform_reset_unauthorize|t|t|{${PATH},lock_timeout=5s}`,
  `orbes_purge_test_pool_batch|t|t|{${PATH},lock_timeout=2s,orbes.guard_bypass=purge}`,
  `orbes_purge_test_run_batch|t|t|{${PATH},lock_timeout=2s,orbes.guard_bypass=purge}`,
];

/** The plain sentence of §1.6 on PostgreSQL 17 (M16, H7). */
const PG17_SENTENCE =
  'Sur PostgreSQL 17, ceci se vérifie dans le catalogue seulement : le comportement (le contournement actif à l\'intérieur, jamais au-dehors) est prouvé par PURGE.13 dans la CI, sur PostgreSQL 16 (`genome/test/db/postgres-purge-reset.test.ts`).';

/** A query's rows as `psql -At` prints them: columns joined by `|`, booleans t/f, NULL empty. */
function psqlAt(rows: unknown[][]): string {
  const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 't' : 'f') : String(v));
  return rows.map((r) => r.map(cell).join('|')).join('\n');
}

/** The text block of the runbook whose first line starts with `first`, as lines. */
function block(first: string): string[] {
  const found = outputs.find((o) => o.startsWith(first));
  if (!found) throw new Error(`no text block starting with "${first}"`);
  return found.split('\n');
}

/** git in the repository, or null where its history does not hold `sha` (genome-ci's shallow checkout). */
function git(sha: string, args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    return null;
  }
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

const said = (s: string) => `« ${s} »`;
const source = (rel: string) => readDoc(`genome/src/${rel}`);
const migration = (name: string) => readDoc(`genome/src/server/db/migrations/${name}.ts`);

/** The runbook's text with every bracketed aside taken out, innermost first. */
function outsideBrackets(md: string): string {
  let out = md;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, '');
  }
  return out;
}

describe('the runbook of lot PURGE (docs/launch/DEPLOY-PR-PURGE.md)', () => {
  let t: TestDb;
  /** Each read of the runbook, run on a database migrated to 0067 in a READ ONLY transaction: its rows as psql prints them. */
  const answers = new Map<string, string>();

  beforeAll(async () => {
    t = await createTestDb();
    // A later lot's migrations only come after 0067: this runbook reads the schema as 0067 leaves it.
    if (NAMES.at(-1) !== '0067_platform_reset') {
      const rs = await createMigrator(t.db).migrateTo('0067_platform_reset');
      if (rs.error) throw rs.error;
    }
    for (const c of commands.filter((x) => x.includes('psql'))) {
      const q = queryOf(c);
      if (answers.has(q)) continue;
      await t.pglite.exec('BEGIN TRANSACTION READ ONLY');
      try {
        const r = await t.pglite.query<unknown[]>(q, [], { rowMode: 'array' });
        answers.set(q, psqlAt(r.rows));
      } finally {
        await t.pglite.exec('ROLLBACK');
      }
    }
  }, 300_000);
  afterAll(() => t?.close());

  it('starts from lot M4 in production and applies exactly 0066 and 0067, as the scripts print them, every count from MIGRATIONS', () => {
    expect(DEPLOY).toEqual(PURGE_NAMES);
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(BEFORE.slice(-3)).toEqual(M4_NAMES);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`Une liste qui s'arrête avant \`${M4_LAST}\` : M4 n'est pas en production, arrête-toi.`);
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_PURGE>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration.
    const changes = section(runbook, '### 1.0');
    expect([...changes.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1])).toEqual(DEPLOY);
    for (const table of ['audit_purge_gaps', 'purge_delete_tables']) {
      expect(migration('0066_test_purge'), table).toContain(`CREATE TABLE ${table} (`);
      expect(changes, table).toContain(`\`${table}\``);
    }
    for (const table of ['platform_reset_plan', 'platform_reset_gate']) {
      expect(migration('0067_platform_reset'), table).toContain(`CREATE TABLE ${table} (`);
      expect(changes, table).toContain(`\`${table}\``);
    }
    // The holder as the migration records it (D12): the oldest active ADMIN with two-factor authentication.
    expect(migration('0067_platform_reset')).toContain('oldest active ADMIN with two-factor');
    expect(changes).toContain("l'ADMIN actif avec double authentification le plus ancien");
    expect(changes).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    // The files the commit adds under migrations since M4, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${M4_SHA} HEAD -- genome/src/server/db/migrations`);
    const added = git(M4_SHA, ['diff', '--name-status', M4_SHA, '--', 'genome/src/server/db/migrations']);
    if (added !== null) {
      const prefix = 'A\tgenome/src/server/db/migrations/';
      const lines = added.trim().split('\n');
      expect(lines.slice(0, DEPLOY.length)).toEqual(DEPLOY.map((n) => `${prefix}${n}.ts`));
      expect(lines.slice(DEPLOY.length).every((l) => l.startsWith(prefix) && l.slice(prefix.length) > `${DEPLOY.at(-1)}.ts`)).toBe(true);
    }
    // db.ts migrate, then deploy.sh's end and its log line, naming M4's image.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`**Il faut lire \`Applied ${DEPLOY.length} migration(s)\`.**`);
    expect(runbook).toContain(`previous image tag: ${M4_TAG}`);
    expect(runbook).toContain(`(previous: ${M4_TAG}). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      `orbes-genome:${M4_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${M4_TAG} refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_PURGE> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).`,
    );
    expect(runbook).toContain(`deploy <TAG_PURGE> OK (previous ${M4_TAG}; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // M4 as the last deployment: its log line exactly as M4's runbook expects it, filled with Q3's and M4's images.
    const m4Line = `deploy ${M4_TAG} OK (previous ${Q3_TAG}; migrations ${M4_NAMES.join(', ')})`;
    expect(runbook).toContain(`\`… ${m4Line}\``);
    expect(readDoc('docs/launch/DEPLOY-M4B-M4.md')).toContain(`deploy <TAG_M4> OK (previous <TAG_Q3>; migrations ${M4_NAMES.join(', ')})`);
    expect(M4_SHA.startsWith(M4_TAG)).toBe(true);
    expect(runbook).toContain(`Sortie attendue : \`${M4_SHA}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${M4_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${M4_SHA.slice(0, 7)}..<7 caractères de SHA_PURGE>\``);
    expect(runbook).toContain("**PURGE ne part qu'après M4**");
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain(`Si la dernière ligne OK de \`.state/deploys.log\` nomme une autre image que \`${M4_TAG}\``);
    for (const mark of ['<SHA_PURGE>', '<TAG_PURGE>']) expect(runbook, mark).toContain(`\`${mark}\``);
    // M4's head is the base of this lot (a full clone only).
    const base = git(M4_SHA, ['merge-base', '--is-ancestor', M4_SHA, 'HEAD']);
    if (base !== null) expect(base).toBe('');
  });

  it('expects from the scripts and the app only messages they print, a rollback only before the migrations, and downs that refuse once a purge or a reset happened', () => {
    for (const [message, src] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(src), `${message}: not in ${src}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    const trouble = section(runbook, '### 1.5');
    expect(trouble).toContain("Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant.");
    expect(trouble).toContain(`\`── rollback to orbes-genome:${M4_TAG}\` et \`rolled back to ${M4_TAG}; the stack is healthy\``);
    expect(trouble).toContain('`WARNING: deployment of <TAG_PURGE> failed (…) and is KEPT`');
    expect(trouble).toContain(`**jamais \`scripts/deploy.sh --image ${M4_TAG}\`**`);
    expect(migration('0066_test_purge')).toContain("RAISE EXCEPTION 'migration 0066_test_purge cannot be rolled back: % audit tombstones and % test purges exist'");
    expect(migration('0067_platform_reset')).toContain("RAISE EXCEPTION 'migration 0067_platform_reset cannot be rolled back: % platform resets done and LOCK RESET %'");
    expect(trouble).toContain(
      "le `down` de `0067_platform_reset` refuse dès qu'une remise a été faite ou que LOCK RESET a été pressé, celui de `0066_test_purge` dès qu'une trace d'audit ou une purge existe",
    );
    for (const n of DEPLOY) expect(migration(n), n).not.toMatch(/cannot be applied/);
    expect(trouble).toContain("tu n'appuies pas sur `Reset the platform`, et jamais rien par la base");
  });

  it('holds the owner’s rules: the hours as maintenance-window.ts reads them, Paris first, no LIVE release or test running, nothing on the host changes, the legal pages unchanged', () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord d'abord.**");
    // The hours (D16, R3, G2): 04:00–06:30 Paris all year, in summer until 07:30 Paris; the hub backups fixed in Paris.
    expect(rules).toContain(
      "jamais entre 04:00 et 06:30 à Paris, toute l'année (03:00–05:30 UTC en hiver ; en été, le gel couvre aussi 03:00–05:30 UTC, c'est-à-dire jusqu'à 07:30 à Paris), ni pendant les minutes de sauvegarde du hub : 03:00–03:10 et 03:45–03:55 à Paris, toute l'année (02:00–02:10 et 02:45–02:55 UTC en hiver)",
    );
    expect(rules).toContain("Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026.");
    expect(rules).toContain('la base elle-même refuse la purge et la remise dans ces plages, et la console le dit à l\'heure de Paris');
    // The same hours as the database's rule and the console's words, on a winter and a summer day.
    const winterNight = windowWords(new Date('2026-11-10T03:30:00Z'));
    expect(winterNight).toContain('from 04:00 to 06:30 Paris (03:00–05:30 UTC)');
    const summerNight = windowWords(new Date('2027-06-10T05:15:00Z'));
    expect(summerNight).toContain('from 04:00 to 07:30 Paris (02:00–05:30 UTC)');
    expect(maintenanceWindow(new Date('2027-06-10T02:30:00Z'))?.kind).toBe('NIGHT');
    expect(windowWords(new Date('2026-11-10T02:05:00Z'))).toContain('from 03:00 to 03:10 Paris (02:00–02:10 UTC)');
    expect(windowWords(new Date('2026-11-10T02:50:00Z'))).toContain('from 03:45 to 03:55 Paris (02:45–02:55 UTC)');
    expect(windowWords(new Date('2027-06-10T01:05:00Z'))).toContain('from 03:00 to 03:10 Paris (01:00–01:10 UTC)');
    // The reset's five minutes of margin (§2.1).
    expect(MAINTENANCE_MARGIN_MS.reset).toBe(5 * 60_000);
    expect(windowWords(new Date('2026-11-10T01:58:00Z'), MAINTENANCE_MARGIN_MS.reset)).toBe('The hub backup starts at 03:00 Paris; try again at 03:10.');
    expect(section(runbook, '### 2.1')).toContain("(04:00–06:30 à Paris toute l'année, jusqu'à 07:30 en été ; 03:00–03:10 et 03:45–03:55 à Paris), avec cinq minutes de marge");
    const before = section(runbook, '### 1.1');
    expect(before).toContain("une heure hors de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche)");
    expect(commands).toContain('date -u');
    expect(runbook).not.toContain('05:00–07:30');
    expect(runbook).not.toContain('UTC+2');
    // Every UTC time sits in brackets after its Paris time; every clock time outside brackets is a Paris one.
    const bare = outsideBrackets(runbook);
    expect(bare).not.toMatch(/\d{2}:\d{2}[^\n]{0,12}UTC/);
    expect(bare).not.toMatch(/UTC[^\n]{0,4}\d{2}:\d{2}/);
    const paired = [...runbook.matchAll(/<heure>[^\n(]{0,30}\(<heure>[^)]*UTC\)/g)];
    expect(paired.length).toBeGreaterThanOrEqual(4);
    for (const m of paired) expect(m[0]).toMatch(/Paris/);
    // Rule 3: no LIVE release between its room's opening and its end, read before the launch and again just before it;
    // no TEST ENTRANTS test running.
    expect(rules).toContain("**Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.**");
    expect(rules).toContain('**quand aucun test de TEST ENTRANTS ne tourne**');
    const reads = fenced(before, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([psql(`select count(*) from drops where ${ROOM_SOON}`), psql('select count(*) from test_runs where ended_at is null'), psql(Q.logins)]);
    expect(fenced(readDoc('docs/launch/DEPLOY-M4B-M4.md'), 'bash')).toContain(psql(`select count(*) from drops where ${ROOM_SOON}`));
    expect(fenced(section(runbook, '### 1.4'), 'bash')[0]).toBe(psql(`select count(*) from drops where ${ROOM_SOON}`));
    // Every query is a read, and no string literal ends the shell's single quotes.
    const queries = commands.filter((c) => c.includes('psql'));
    expect(queries.length).toBeGreaterThanOrEqual(18);
    for (const q of queries) {
      expect(q.startsWith('docker compose exec -T postgres sh -c \'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "'), q).toBe(true);
      expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop table|truncate|create|grant|revoke|set|call|perform)\b/i);
      expect(queryOf(q), q).not.toContain("'");
      expect(queryOf(q), q).not.toMatch(/orbes_(platform_reset|purge_test)\w*\(/);
    }
    // CI green on the exact commit (its four shards, the PostgreSQL suite with them).
    expect(before).toContain('actions?query=branch%3Aorbes-purge');
    expect(before).toContain('(ses quatre parties, dont la suite PostgreSQL)');
    const ci = readDoc('.github/workflows/genome-ci.yml');
    expect(ci).toContain('shard: [1, 2, 3, 4]');
    expect(ci).toContain('timeout-minutes: 45');
    // No slot booked; the heads-up at launch in Paris then UTC.
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("le diff de `deploy/vps` vide après l'avance rapide");
    expect(section(runbook, '### 1.4')).toContain(
      "**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement PURGE lancé à <heure> Paris (<heure> UTC), deux migrations, rien ne change sur l'hôte. »",
    );
    // Nothing on the host changes (D18, R4): the deploy/vps diff since M4 is empty, no .env line.
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(rules).toContain('Ton `.env` ne gagne aucune ligne');
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${M4_SHA} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('-- deploy/vps\n```\n\nSortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.');
    const vps = git(M4_SHA, ['diff', '--name-status', M4_SHA, '--', 'deploy/vps']);
    const vpsLog = git(M4_SHA, ['log', '--no-merges', '--format=%H %s', `${M4_SHA}..HEAD`, '--', 'deploy/vps']);
    if (vps !== null && vpsLog !== null) {
      expect(vpsLog.trim().split('\n').filter((l) => / PR-PURGE\./.test(l))).toEqual([]);
      if (!vpsLog.trim()) expect(vps.trim()).toBe('');
    }
    expect(section(runbook, '### 1.2')).toContain("Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n'y touches pas.");
    for (const c of commands.filter((x) => x.includes('.env'))) expect(["grep '^ORBES_IMAGE_TAG=' .env", "grep -n '^RESTORE_ALLOWED=' .env"]).toContain(c);
    expect(commands.filter((c) => /COOKIE_SECRET|KEY_ENCRYPTION_KEY|DATABASE_URL/.test(c))).toEqual([]);
    expect(commands.filter((c) => /\bcat\b|printenv|(?:^|\s)env(?! \|)/.test(c))).toEqual([]);
    expect(rules).toContain('**Les secrets ne se collent jamais dans une conversation.**');
    // The guarded launch, umask 022, restore.sh only to watch it refuse, no prune.
    expect(commands).toContain('umask 022');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    expect(rules).toContain('tu ne le lances que pour le voir refuser (§1.6)');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toBe('scripts/restore.sh --identity /dev/null --latest --dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(commands.filter((c) => /docker image rm/.test(c))).toEqual([]);
    expect(rules).toContain('la branche `orbes-purge` (sa propre branche distante, jamais `main`, jamais une pull request)');
    // The legal pages unchanged (plan §L): M4's version kept; the diff of the legal folders read on the server.
    expect(LEGAL_VERSION >= M4_LEGAL_VERSION).toBe(true);
    expect(rules).toContain(`\`LEGAL_VERSION\` reste \`${M4_LEGAL_VERSION}\`, celle de M4`);
    expect(readDoc('docs/launch/DEPLOY-M4B-M4.md')).toContain(`une seule nouvelle version, \`${M4_LEGAL_VERSION}\``);
    const fetch = section(runbook, '### 1.3');
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${M4_SHA} HEAD -- genome/src/web/legal docs/legal`);
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${M4_LEGAL_VERSION}';\`, inchangée.`);
  });

  it('checks the box after the migrations: every read run on 0067 answers what the runbook expects, the holder read-only, the definer functions in PostgreSQL 17’s catalogue', () => {
    const after = section(runbook, '### 1.6');
    const answer = (q: string) => {
      expect(commands, q).toContain(psql(q));
      const a = answers.get(q);
      if (a === undefined) throw new Error(`not run: ${q}`);
      return a;
    };
    // The new tables: no tombstone, step 10's list, the gate's row, the plan's tables; no purge yet.
    expect(answer(Q.newTables)).toBe(`0|${PURGE_DELETE_TABLES.length}|1|${Object.keys(RESET_PLAN).length}|0`);
    expect(after).toContain(`Sortie attendue : \`${answer(Q.newTables)}\`.`);
    expect(after).toContain(`les ${PURGE_DELETE_TABLES.length} tables de l'étape des comptes, la ligne de la porte, les ${Object.keys(RESET_PLAN).length} tables du plan`);
    // The plan by class, as reset-plan.ts classes it.
    const byClass = RESET_CLASSES.map((k) => `${k}|${Object.values(RESET_PLAN).filter((v) => v === k).length}`).join('\n');
    expect(answer(Q.planByClass)).toBe(byClass);
    expect(outputs).toContain(byClass);
    // B7.recount: tables, triggers and foreign keys counted read-only; every table in the plan.
    const counts = answer(Q.counts);
    expect(counts.split('|')[0]).toBe(String(Object.keys(RESET_PLAN).length));
    expect(after).toContain(`Sortie attendue : \`${counts}\`.`);
    expect(answer(Q.outsidePlan)).toBe('0');
    // The gate: no reset, not locked, no authorization.
    expect(answer(Q.gate)).toBe('0|t|t|t');
    expect(after).toContain('Sortie attendue : `0|t|t|t`.');
    // D12, F30, M11: the holder printed read-only, described, the address never written; the ADMIN list; a wrong holder
    // disabled in Team at once (the reset then refuses), fixed forward.
    expect(answers.has(Q.holder)).toBe(true);
    expect(after).toContain(psql(Q.holder));
    expect(after).toContain('Sortie attendue : une seule ligne, `<ton adresse>|ADMIN|t|t`. **Ce doit être ta propre connexion à la console, l\'ADMIN avec double authentification avec lequel tu te connectes.**');
    expect(after).toContain('Sinon, **désactive cette connexion dans `Team` tout de suite** (`Disable`) : la remise et LOCK RESET exigent un détenteur actif, ils refusent alors ; puis dis-le à Claude, qui répare en avant par une migration.');
    expect(after).toContain('Ton adresse ne s\'écrit nulle part dans le dépôt.');
    expect(after).toContain(psql(Q.logins));
    expect(section(runbook, '### 1.1')).toContain("**La première ligne `ADMIN|…|t|t` est le détenteur que la migration enregistrera : ce doit être ta propre adresse de connexion à la console.**");
    expect(migration('0067_platform_reset')).toContain("WHERE a.role = 'ADMIN' AND a.disabled_at IS NULL AND a.totp_secret_enc IS NOT NULL\n                 ORDER BY a.created_at, a.id LIMIT 1");
    // M16, F14, H7: the seven definer functions, prosecdef, a superuser owner and the exact proconfig, from the catalogue.
    expect(answer(Q.definers)).toBe(DEFINER_LINES.join('\n'));
    expect(block('orbes_platform_reset|')).toEqual(DEFINER_LINES);
    expect(after).toContain('Sortie attendue, exactement ces sept lignes :');
    expect(commands).toContain(psql(Q.version));
    expect(after).toContain('Sortie attendue : une ligne qui commence par `17.`.');
    expect(readDoc('deploy/vps/compose.yaml')).toContain('image: postgres:17');
    expect(readDoc('.github/workflows/genome-ci.yml')).toContain('image: postgres:16');
    expect(after).toContain(PG17_SENTENCE);
    expect(existsSync(join(REPO, 'genome/test/db/postgres-purge-reset.test.ts'))).toBe(true);
    // The former "current_setting after a precheck call" line is dropped as vacuous (H7): no function is called.
    expect(runbook).not.toMatch(/current_setting/i);
    expect(runbook).not.toMatch(/guard_bypass[^\n]*après/);
    // Every other read of the runbook runs on 0067 as written (it parses and reads).
    for (const c of commands.filter((x) => x.includes('psql'))) expect(answers.has(queryOf(c)), c).toBe(true);
    // The console after, in its words; the app; the box's figures before and after; the host told.
    expect(source('web/admin/views/settings.ts')).toContain("linkButton('Ended tests', href('endedTests'), 'ghost')");
    expect(source('web/admin/views/settings.ts')).toContain("resetHolder ? linkButton('Platform reset', href('platformReset'), 'ghost') : null");
    expect(after).toContain('`Audit` → `Verify chain` : « Chain intact », comme avant');
    expect(chainVerdict({ ok: true, checked: 3 } as never).title).toBe('Chain intact');
    expect(source('web/admin/views/audit.ts')).toContain("button('Verify chain'");
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(after).toContain("**Préviens le responsable de l'hôte** : « PURGE fait à <heure> Paris (<heure> UTC), deux migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »");
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/health');
    expect(commands).toContain('scripts/restore.sh --identity /dev/null --latest --dry-run');
  });

  it('checks each feature for real in the console’s words, the sizes read before the first purge and the dump size told to the host after', () => {
    const real = section(runbook, '### 1.7');
    expect(real).toContain(`(${said('This code was just used. Wait for the next code.')})`);
    expect(source('server/services/auth.ts')).toContain("'This code was just used. Wait for the next code.'");
    expect(CODE_HINT).toContain('Just signed in? Wait for the next code.');
    // 1. Before the first purge (D20, A8): the database's size and the largest tables, read only.
    const sizes = section(runbook, '#### 1.');
    expect(fenced(sizes, 'bash')).toEqual([
      psql('select pg_size_pretty(pg_database_size(current_database()))'),
      psql('select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 15'),
    ]);
    expect(runbook.indexOf('#### 1. Avant la première purge')).toBeLessThan(runbook.indexOf('#### 2. La purge'));
    // 2. PURGE of an ended test: the phrase, the dialog's words, the toast, PURGING and PURGED, the report kept, the chain.
    const one = section(runbook, '#### 2.');
    const runId = '1a2b3c4d-0000-4000-8000-000000000000';
    expect(purgePhrase(runId)).toBe('PURGE TEST 1A2B3C4D');
    expect(one).toContain('tape `PURGE TEST <les 8 premiers caractères du test>`');
    const dialog = purgeDialogText({ drawn: false, blockingOrders: 0, hold: null }, null);
    expect(dialog.title).toBe('Purge the test');
    expect(dialog.confirm).toBe('Purge test');
    expect(one).toContain(`La boîte ${said(dialog.title)}`);
    expect(one).toContain(`puis \`${dialog.confirm}\` : ${said('Purge under way: the test’s rows are deleted in small steps.')}`);
    expect(source('web/admin/views/test-entrants.ts')).toContain("'Purge under way: the test’s rows are deleted in small steps.'");
    expect(PURGE_WHAT.startsWith('Deletes this test’s entries, its cancelled orders with their events, its sessions and its audit entries')).toBe(true);
    expect(one).toContain('(« Deletes this test’s entries, its cancelled orders with their events, its sessions and its audit entries … »)');
    expect(source('web/admin/model/test-purge.ts')).toContain('rows deleted so far.');
    expect(one).toContain('« Asked … Paris by <ton adresse> … rows deleted so far. »');
    const purged = purgedLine({ purgedAt: '2026-11-02T13:05:00.000Z', requestedBy: 'x' });
    expect(purged).toMatch(/^Purged \d{2} [A-Z]{3} \d{4} · \d{2}:\d{2} Paris by x$/);
    expect(one).toContain('« Purged <jour> · <heure> Paris by <ton adresse> »');
    expect(source('web/admin/views/test-entrants.ts')).toContain("h('p', { class: 'tests__subtitle' }, 'Past tests')");
    expect(one).toContain('section `Test entrants`, `Past tests` : sur le test, `Purge`.');
    expect(chainPurgedLine(37)).toBe("37 entries purged with their tests (each one's link kept)");
    expect(one).toContain("« <nombre> entries purged with their tests (each one's link kept) »");
    expect(one).toContain('Un refus s\'affiche dans la boîte, et tu restes connecté');
    // 3. PURGE ALL ENDED TESTS.
    const all = section(runbook, '#### 3.');
    expect(source('web/admin/views/ended-tests.ts')).toContain("button('Purge all ended tests', { kind: 'danger', testId: 'test-purge-all' })");
    expect(source('web/admin/views/ended-tests.ts')).toContain("confirmLabel: 'Purge all',");
    expect(PURGE_ALL_PHRASE).toBe('PURGE ALL TESTS');
    expect(all).toContain(`\`Settings\` → \`Ended tests\` → \`Purge all ended tests\``);
    expect(all).toContain(`tape \`${PURGE_ALL_PHRASE}\`, puis \`Purge all\` : ${said('Purge under way: <nombre> tests.')}`);
    expect(source('web/admin/views/ended-tests.ts')).toContain('`Purge under way: ${formatCount(n)} tests.`');
    const allText = purgeAllDialogText({ runs: ['a', 'b'], resumed: [], skipped: [], drawn: 1, accounts: 3, hold: null } as never, []);
    expect(allText.lines[0]).toBe('2 ended tests are purged.');
    expect(all).toContain('elle passe à `PAUSED` avec l\'heure de reprise à Paris, et reprend seule');
    // 4. The PLATFORM RESET page, read without pressing.
    const page = section(runbook, '#### 4.');
    expect(page).toContain('**N\'appuie sur rien.**');
    expect(page).toContain(`\`State\` : \`READY\` (${said(PLATFORM_RESET_TEXT.ready)})`);
    const view = source('web/admin/views/platform-reset.ts');
    for (const w of ["label: 'Holder'", "label: 'State'", "section(\n      'What goes',", "section('What stays',", "section('What stays that a test may have made',", "section('Segments that go',", "section('Signing keys',"]) expect(view, w).toContain(w);
    expect(source('web/admin/model/platform-reset.ts')).toContain('neither test nor team`, strong: true');
    expect(page).toContain('`What goes` : `Collector accounts`, avec en gras « <nombre> neither test nor team »');
    // 5. LOCK RESET, not pressed.
    const lock = section(runbook, '#### 5.');
    expect(view).toContain("button('Lock reset', { kind: 'secondary', testId: 'reset-lock'");
    expect(lock).toContain('le bouton `Lock reset` est là. **Ne l\'ouvre pas**');
    // §1.8: the dump size told to the host; the 1,000-entrant rule holds until then (D20).
    const next = section(runbook, '### 1.8');
    expect(next).toContain('**Jusqu\'à ce message, la règle des 1 000 entrants tient**');
    expect(fenced(next, 'bash')).toEqual(['du -sh /var/backups/orbes', 'ls -l /var/backups/orbes/daily', 'docker images orbes-genome']);
    expect(next).toContain("**Préviens le responsable de l'hôte** : « ORBES : purge des tests faite le <jour> ; base <taille avant> → <taille après>, sauvegarde de nuit <taille avant> → <taille après>. »");
    // The one behaviour change outside the two features (plan §N): the staff's draw actions refused while a test of the release is purged.
    expect(source('server/services/drops.ts')).toContain("'A test of this release is being purged. Try again once it is done.'");
    expect(section(runbook, '### 1.0')).toContain('sont refusées jusqu\'à la fin de la purge : « A test of this release is being purged. Try again once it is done. »');
    // The console-only residual risk in one plain line (D3, M8, F12).
    expect(section(runbook, '### 1.0')).toContain(
      "**Le risque que tu as accepté** (27 octobre, la console seule) : un code qui tournerait comme l'application (`orbes_app`) pourrait lancer la remise avec ton identifiant ; LOCK RESET, dès le lancement, le ferme.",
    );
  });

  it('describes PLATFORM RESET before the launch: no deploy.sh until signed in again, the heads-up, the page’s counts, after it the post-check and the checklist, a refusal, exit 1 and the 3-minute row', () => {
    const use = section(runbook, '## 2.');
    expect(runbook.split('\n')).toContain('## 2. Utiliser PLATFORM RESET (avant le lancement)');
    // Before (H8: the 9 Oct rule 3).
    const before = section(runbook, '### 2.1');
    expect(before).toContain('**Aucun `deploy.sh` depuis l\'appui jusqu\'à ce que tu sois reconnecté** (la règle 3 du 9 octobre)');
    expect(before).toContain('**Aucune salle de LIVE RELEASE ouverte** (entre l\'ouverture de sa salle et sa fin), **aucun test en cours**');
    expect(source('server/services/platform-reset.ts')).toContain("RESET_TEST_RUNNING: 'A test is running. Reset once it has ended.'");
    expect(source('server/services/platform-reset.ts')).toContain('`A LIVE room is open until ${parisWhen(until)}.`');
    expect(before).toContain(
      "**La ligne au responsable de l'hôte, à envoyer juste avant d'appuyer** : « ORBES : remise à zéro de la plateforme lancée à <heure> Paris (<heure> UTC) depuis la console ; l'application est coupée environ 30 à 60 secondes, puis redémarre seule ; rien ne change sur l'hôte. »",
    );
    expect(before).toContain('le nombre de comptes **« neither test nor team »** sous `What goes`');
    expect(source('server/services/platform-reset.ts')).toContain('signed up since you opened this page. Reload it and check them.');
    expect(fenced(before, 'bash')).toEqual([psql(Q.resets)]);
    expect(before).toContain('une autre connexion à la base fait refuser la remise (rien ne change)');
    // The press: the dialog's fields and phrase, the restart notice.
    const press = section(runbook, '### 2.2');
    expect(RESET_PHRASE).toBe('RESET PLATFORM');
    expect(press).toContain(`tape \`${RESET_PHRASE}\`, puis \`Reset the platform\``);
    expect(view()).toContain("confirmLabel: 'Reset the platform',");
    expect(source('web/admin/model/platform-reset.ts')).toContain("label: 'Current password'");
    expect(press).toContain(`${said(PLATFORM_RESET_TEXT.restartTitle)} ${said(PLATFORM_RESET_TEXT.restartText)}`);
    const text = resetDialogText({ numbers: { pieceReferences: [], invoice: 'INV-2026-000001' }, collectors: { count: 0, signUps: [] } } as never, null);
    expect(text.lines[0]).toContain('Piece serials restart at 00001');
    expect(text.lines[0]).toContain('and invoice numbers at INV-2026-000001. The signing key stays.');
    // After: sign in again, the last reset line, the post-check lines as the service names them, the checklist, the host.
    const after = section(runbook, '### 2.3');
    expect(after).toContain('**Reconnecte-toi**');
    for (const w of ['Last reset ', 'Audit log restarted: entry ', 'Previous log ended at entry ']) expect(source('web/admin/model/platform-reset.ts'), w).toContain(w);
    expect(after).toContain('« Last reset <jour> · <heure> Paris by <ton adresse>: <nombre> rows deleted. Audit log restarted: entry 1, hash …. Previous log ended at entry …, hash …. »');
    expect(after).toContain(said(postCheckVerdict([])));
    const service = source('server/services/platform-reset.ts');
    const labels = [...service.matchAll(/^\s+label: '([^']+)',$/gm), ...service.matchAll(/lines\.push\(\{ key: '\w+', label: '([^']+)'/g)].map((m) => m[1]!);
    expect(labels).toEqual(expect.arrayContaining(['Audit log: entry 1 links to the start, chain OK', 'One active signing key', 'No pieces, no invoices, no partner invoices', 'Next piece references', 'Next numbers', 'Next test']));
    for (const l of ['Audit log: entry 1 links to the start, chain OK', 'One active signing key', 'No pieces, no invoices, no partner invoices', 'Next piece references', 'Next numbers', 'Next test']) {
      expect(after, l).toContain(`   - \`${l}\``);
    }
    expect(after).toContain('Une ligne `FAILING`, en rouge');
    // The checklist: its seven items in the page's order, the key rotation and the host's backup after it (M18).
    expect(RESET_CHECKLIST.map((i) => i.key)).toEqual(['key', 'cards', 'documents', 'account', 'logins', 'tidy', 'anchor']);
    const from = after.indexOf('4. **La liste à faire**');
    const items = after
      .slice(from, after.indexOf('\n5. ', from))
      .split('\n')
      .filter((l) => l.startsWith('   - '));
    expect(items).toHaveLength(RESET_CHECKLIST.length);
    expect(items[0]).toContain('**demande au responsable de l\'hôte une sauvegarde juste après la rotation**');
    expect(items[0]).toContain('(`Keys`)');
    expect(items[4]).toContain('`Team`');
    expect(RESET_CHECKLIST[0]!.after).toContain('ask the host for a backup right after');
    expect(after).toContain('`resets` a pris un de plus, `last_reset_at` est l\'heure de ton appui (en UTC)');
    // A refusal, exit 1, and the 3-minute row (H8).
    const trouble = section(runbook, '### 2.4');
    const failure = 'message: `The reset of ${parisWhen(row.occurred_at)} was refused: ${failureWords(reason)}. Nothing changed.` }';
    expect(service).toContain(failure);
    expect(parisWhen(new Date('2026-11-02T13:05:00Z'))).toMatch(/^\d{1,2} [A-Z][a-z]+ at \d{2}:\d{2} Paris$/);
    expect(trouble).toContain('« The reset of <jour> at <heure> Paris was refused: <raison>. Nothing changed. »');
    expect(trouble).toContain('(le processus est sorti en code 1, `platform.reset.failed` est dans le journal d\'audit) : **rien n\'a changé**');
    expect(service).toContain("action: 'platform.reset.failed'");
    expect(service).toContain('`a check before the commit failed (${reason})`');
    expect(readDoc('genome/src/server/platform-reset-shutdown.ts')).toContain('exit');
    const row = trouble.split('\n').find((l) => l.startsWith('| **La console ne revient pas dans les 3 minutes** |'));
    expect(row).toBeDefined();
    for (const w of ['`docker compose ps`', '`docker compose logs --tail 100 app`', '`select resets, last_reset_at from platform_reset_gate`', '(la commande du §2.1)', 'la remise est **validée**', 'Inchangés : **rien n\'a changé**', "préviens le responsable de l'hôte si le site reste coupé", 'On répare en avant', '**jamais `restore.sh`**']) {
      expect(row, w).toContain(w);
    }
    expect(Q.resets).toBe('select resets, last_reset_at from platform_reset_gate');
    // LOCK RESET on launch day (D13).
    const lockDay = section(runbook, '### 2.5');
    expect(LOCK_PHRASE).toBe('LOCK RESET');
    expect(lockDay).toContain(`tape \`${LOCK_PHRASE}\`, puis \`Lock reset\``);
    expect(lockDay).toContain(said(PLATFORM_RESET_TEXT.lockBody));
    expect(lockedLine({ at: '2026-11-02T13:05:00.000Z', by: 'x' })).toMatch(/^Locked \d{2} [A-Z]{3} \d{4} · \d{2}:\d{2} Paris by x\. The reset is refused for good\.$/);
    expect(lockDay).toContain('« Locked <jour> · <heure> Paris by <ton adresse>. The reset is refused for good. »');
    expect(fenced(lockDay, 'bash')).toEqual([psql(Q.locked)]);
    expect(use).not.toMatch(/restore\.sh[^\n]*--image|scripts\/deploy\.sh --image/);
  });

  it('keeps the restore rule: launched_at read before the app serves, the first lot after the launch sets it and removes the reset', () => {
    const restore = section(runbook, '## 3.');
    expect(fenced(restore, 'bash')).toEqual([psql(Q.launchedAt)]);
    expect(restore).toContain('**Avant que l\'application serve à quiconque**');
    expect(restore).toContain('Une ligne vide : la remise est ouverte ; `docker compose stop app` tout de suite, ou toi seul, le détenteur, appuies `Lock reset` avant toute autre chose');
    expect(restore).toContain('Le premier lot après le lancement règle lui-même `launched_at` quand il est vide, et retire la remise.');
    const deployment = readDoc('docs/DEPLOYMENT.md');
    expect(deployment).toContain(`-Atc "${Q.launchedAt}"`);
    expect(section(runbook, '## 0.')).toContain('la règle du §3 s\'applique avant que l\'application serve');
  });

  it('gives one command per shell block, in French, links only to what exists, linked from DEPLOYMENT, and no file of the lot holds the owner’s email domain', () => {
    expect(commands.length).toBeGreaterThan(50);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    for (const c of commands) expect(c.startsWith('#'), c).toBe(false);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(commands).toContain('docker compose exec app node --import tsx scripts/db.ts status');
    expect(runbook.startsWith('# Mise en production du lot PURGE (TEST PURGE, PLATFORM RESET, LOCK RESET)\n\nCe document est pour toi, le propriétaire.')).toBe(true);
    expect(runbook.match(/Sortie attendue/g)!.length).toBeGreaterThan(35);
    for (const h of [
      '## 0. Les règles',
      '## 1. Le déploiement',
      '### 1.0 Ce qui change',
      "### 1.1 Avant : ton accord, la CI, l'heure, le pré-contrôle",
      '### 1.2 Préparer le serveur',
      '### 1.3 Récupérer le commit final',
      '### 1.4 Déployer',
      '### 1.5 Si quelque chose ne va pas',
      '### 1.6 Juste après : contrôles de base',
      '### 1.7 Une vérification réelle par élément',
      "### 1.8 Ensuite : la taille de la sauvegarde au responsable de l'hôte",
      '## 2. Utiliser PLATFORM RESET (avant le lancement)',
      '### 2.1 Avant',
      '### 2.2 Appuyer',
      '### 2.3 Après',
      '### 2.4 Si la remise est refusée, ou si elle échoue',
      '### 2.5 Le jour du lancement : LOCK RESET',
      '## 3. Si une sauvegarde est un jour restaurée',
    ]) {
      expect(runbook.split('\n'), h).toContain(h);
    }
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(runbook).toContain('[son runbook](DEPLOY-M4B-M4.md)');
    const deployment = readDoc('docs/DEPLOYMENT.md');
    expect(deployment).toContain('[DEPLOY-PR-PURGE](launch/DEPLOY-PR-PURGE.md)');
    expect(deployment).toContain('[DEPLOY-M4B-M4](launch/DEPLOY-M4B-M4.md); and lot PURGE of 2026-10-26 and 2026-10-27');
    expect(deployment).toContain('one deployment after M4 with migrations `0066_test_purge` and `0067_platform_reset`, no `.env` line, no change of the host, the legal pages unchanged');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('`launch/DEPLOY-PR-PURGE.md`');
    // The brand's words; no address written anywhere in the runbook (D12, R10).
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
    expect(runbook).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    // No file the lot adds or changes holds the owner's email domain; the pattern built from parts (R10, F1, F5).
    const domain = ['@', 'es', 'sec'].join('');
    const lot = new Set([
      RUNBOOK,
      'docs/DEPLOYMENT.md',
      'genome/test/docs/deploy-pr-purge.test.ts',
      'genome/src/server/db/migrations/0066_test_purge.ts',
      'genome/src/server/db/migrations/0067_platform_reset.ts',
      'genome/src/server/services/platform-reset.ts',
      'genome/src/server/services/test-purge.ts',
      'genome/src/web/admin/model/platform-reset.ts',
      'genome/src/web/admin/views/platform-reset.ts',
    ]);
    const changed = git(M4_SHA, ['diff', '--name-only', M4_SHA, '--']);
    if (changed !== null) for (const f of changed.trim().split('\n').filter(Boolean)) lot.add(f);
    expect(lot.size).toBeGreaterThan(8);
    const holding = [...lot].filter((f) => existsSync(join(REPO, f)) && readFileSync(join(REPO, f)).toString('latin1').toLowerCase().includes(domain));
    expect(holding).toEqual([]);
  });
});

/** The Platform reset page's view source. */
function view(): string {
  return source('web/admin/views/platform-reset.ts');
}
