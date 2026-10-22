/**
 * docs/launch/DEPLOY-MACRO-M2.md, the owner's runbook for lot M2 of the macro scope of 2026-10-20 (plan step M2.14),
 * against the scripts, the stack, the migrations, the server and the apps it quotes:
 *
 *  - it starts from production as lot M1 leaves it (its commit, 0001 to 0051) and applies exactly 0052_house_messages
 *    and 0053_worn, as the scripts print it: the table of §1.0, the files the commit adds under migrations, the lines
 *    `db_applied_migrations` and deploy.sh print before, the line `db.ts migrate` prints, those deploy.sh prints after
 *    it, the deployment log and the `applied` lines `db.ts status` shows, each count and its first and last names
 *    derived from MIGRATIONS, never written here; M1's image no longer runs on the schema after them, so a failure is
 *    repaired forward;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts and the app is still one they print;
 *  - the owner's rules: his look at the screens first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the hub's backup
 *    minutes, no slot booked and a heads-up at launch, the box's figures before and after, the guarded launch,
 *    restore.sh only ever run to watch it refuse, no prune; the one change of the host, the Caddyfile's WORN upload
 *    path (MACRO M2.8), agreed with the host manager first: the deploy/vps diff is that file, its two path_regexp
 *    lines exactly, and no variable; the legal pages' new version, the ORBES CARE conditions keeping theirs;
 *  - the post-check: the box read only (no moment on, no message, delivery or photograph), the recreated Caddy reading
 *    the WORN matcher, then from the Mac WORN's 404 and the 64KB limit kept elsewhere; the WORN path's 1200KB proved by
 *    a real photograph over 64 KB, never by a session-less curl the app refuses before reading its body;
 *  - one real check per element, in the console's and the app's words as the code has them: a message scheduled to the
 *    owner's own segment, read on the phone and on a computer; a moment switched on and off; a WORN photograph sent,
 *    published, seen signed out and withdrawn; the legal pages; Client Services told (the playbook's M2 lines, both
 *    copies); one command per shell block, relative links that resolve, and the runbook linked from DEPLOYMENT and
 *    COMPLIANCE.
 *
 * <SHA_M1>, <TAG_M1>, <SHA_M2> and <TAG_M2> stay placeholders until the main session hands the commits over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { errorBody } from '../../src/server/http/errors.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { WORN_UPLOAD_ROUTE } from '../../src/server/routes/ownership.js';
import { wornNotFound } from '../../src/server/services/worn.js';
import { TAGS_NOTES_COPY, tagValue } from '../../src/web/admin/model/client-notes.js';
import { HOUSE_COPY, HOUSE_MOMENT_INFO, momentSwitch, reachText, readText, statusWords } from '../../src/web/admin/model/house-messages.js';
import { SEGMENT_RULE_LABELS } from '../../src/web/admin/model/segments.js';
import { WORN_COPY, statusWords as wornStatusWords } from '../../src/web/admin/model/worn.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { PRIVACY } from '../../src/web/legal/content/privacy.js';
import { PHOTO_MAX_BYTES } from '../../src/web/shared/photo.js';
import { FROM_ORBES, LOOKBOOK, MESSAGES as APP_MESSAGES, PIECES, WORN } from '../../src/web/verify/copy.js';
import { LOOKBOOK_PATH } from '../../src/web/verify/lookbook-model.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-MACRO-M2.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** The desktop, production before lot M1 (the scope's base): reachable in a full clone only. */
const DESKTOP_COMMIT = '00317bcc0b4aeec5906ec417c1d9688c3bda55e6';
const DESKTOP_TAG = DESKTOP_COMMIT.slice(0, 12);
/** The legal version of this lot (step M2.12), and the ORBES CARE conditions', unchanged since ORBES CARE. */
const M2_LEGAL_VERSION = '2026-10-22';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
/** Lot M1's newest migration, and lot M2's two (plan §0). */
const M1_LAST = '0051_emails';
const DEPLOY = NAMES.slice(NAMES.indexOf(M1_LAST) + 1).filter((n) => n === '0052_house_messages' || n === '0053_worn');
const BEFORE = NAMES.slice(0, NAMES.indexOf(M1_LAST) + 1);
const AFTER = [...BEFORE, ...DEPLOY];
/** M1's own migrations, as M1's runbook and its deployment log name them. */
const M1_DEPLOY = NAMES.filter((n) => ['0049', '0050', '0051'].includes(n.slice(0, 4)));

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

/** git in the repository, or null where its history does not hold the desktop's commit (genome-ci's shallow checkout). */
function git(args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${DESKTOP_COMMIT}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    return null;
  }
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

/** The WORN upload path as the Caddyfile's patterns write it: the route with its parameter as one segment. */
const WORN_PATTERN = WORN_UPLOAD_ROUTE.replace(/^\/api\//, '').replace(':productId', '[^/]+');
/** The Caddyfile's path_regexp lines that carry the WORN path, as they are (tabs kept). */
const caddyWornLines = () => readDoc('deploy/vps/Caddyfile').split('\n').filter((l) => /^\s+path_regexp /.test(l) && l.includes(WORN_PATTERN));

describe('the runbook of lot MACRO M2 (docs/launch/DEPLOY-MACRO-M2.md)', () => {
  it("starts from lot M1 in production and applies exactly 0052 and 0053, as the scripts print it, every count from MIGRATIONS", () => {
    expect(DEPLOY).toEqual(['0052_house_messages', '0053_worn']);
    // M2's migrations follow M1's at once; a later lot's (M3, M4) only ever come after them.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_M2>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration, and the tables it names, as the migrations create them.
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY);
    const migration = (name: string) => readDoc(`genome/src/server/db/migrations/${name}.ts`);
    for (const t of ['house_moment_settings', 'house_messages', 'house_deliveries']) {
      expect(migration('0052_house_messages'), t).toContain(`CREATE TABLE ${t} (`);
      expect(section(runbook, '### 1.0'), t).toContain(`\`${t}\``);
    }
    expect(migration('0053_worn')).toContain('CREATE TABLE worn_photos (');
    expect(section(runbook, '### 1.0')).toContain('`worn_photos`');
    // Every moment off: no row is the default, and a row starts off.
    expect(migration('0052_house_messages')).toMatch(/enabled +boolean +NOT NULL DEFAULT false/);
    // The files the commit adds under migrations, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --name-status <SHA_M1> HEAD -- genome/src/server/db/migrations');
    const added = git(['diff', '--name-status', DESKTOP_COMMIT, '--', 'genome/src/server/db/migrations']);
    if (added !== null) {
      const prefix = 'A\tgenome/src/server/db/migrations/';
      const lines = added.trim().split('\n');
      // Since the desktop: M1's three, then M2's two, then only a later lot's.
      expect(lines.slice(0, M1_DEPLOY.length + DEPLOY.length)).toEqual([...M1_DEPLOY, ...DEPLOY].map((n) => `${prefix}${n}.ts`));
      expect(lines.slice(M1_DEPLOY.length + DEPLOY.length).every((l) => l.startsWith(prefix) && l.slice(prefix.length) > `${DEPLOY.at(-1)}.ts`)).toBe(true);
    }
    // db.ts migrate, then deploy.sh's end and its log line.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`**Il faut lire \`Applied ${DEPLOY.length} migration(s)\`.**`);
    expect(runbook).toContain('previous image tag: <TAG_M1>');
    expect(runbook).toContain(`(previous: <TAG_M1>). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      'orbes-genome:<TAG_M1> cannot run on this schema any more (scripts/deploy.sh --image <TAG_M1> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).',
    );
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_M2> OK (previous <TAG_M1>; migrations ${DEPLOY.join(', ')})`);
    // The post-check's count, with its first and last names.
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // M1 as the last deployment: its log line exactly as M1's runbook expects it.
    const m1Line = `deploy <TAG_M1> OK (previous ${DESKTOP_TAG}; migrations ${M1_DEPLOY.join(', ')})`;
    expect(runbook).toContain(`\`… ${m1Line}\``);
    expect(readDoc('docs/launch/DEPLOY-MACRO-M1.md')).toContain(m1Line);
    expect(runbook).toContain('Sortie attendue : `<SHA_M1>` au début de la ligne');
    expect(runbook).toContain('Sortie attendue : `ORBES_IMAGE_TAG=<TAG_M1>`.');
    expect(runbook).toContain('`Updating <7 caractères de SHA_M1>..<7 caractères de SHA_M2>`');
    // The placeholders, filled before the day; a runbook re-based when production runs another image.
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain('Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `<TAG_M1>`');
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('FORWARD="If anything goes wrong, repair forward: scripts/deploy.sh --image $TAG after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7)."');
    // Caddy is recreated because its configuration's hash, a label of the service, changes.
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('CADDY_CONFIG_HASH="$(cat "$STACK_DIR/Caddyfile"');
    expect(readDoc('deploy/vps/compose.yaml')).toContain('orbes.caddy-config-hash: ${CADDY_CONFIG_HASH:-unset}');
    expect(section(runbook, '### 1.4')).toContain('`Container orbes-caddy-1 Recreate` : Caddy est recréé avec la nouvelle configuration');
  });

  it("holds the owner's rules: the Caddyfile's WORN path the one change of the host, agreed first, no variable, the legal pages' new version", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les écrans d'abord.**");
    // Paris first, UTC in brackets.
    expect(rules).toContain("**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(rules).toContain("03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)");
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC");
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain('**Jamais `restore.sh` sur ce serveur**');
    expect(rules).toContain('**Aucun message de la maison ne part**');
    expect(rules).toContain('**WORN ne montre rien**');
    expect(rules).toContain('la branche `orbes-macro` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The one change of the host: the Caddyfile, agreed with the host manager before the launch.
    expect(rules).toContain("**Un seul changement de l'hôte : le Caddyfile d'ORBES**");
    expect(rules).toContain("**ce changement passe d'abord par le responsable de l'hôte**");
    const before = section(runbook, '### 1.1');
    expect(before).toContain("**3. Le responsable de l'hôte d'abord**");
    expect(before).toContain("Attends son accord. Sans lui, n'avance pas.");
    expect(before).toContain('`POST /api/v1/account/products/<pièce>/worn`');
    expect(before).toContain('passe dans `@photo_upload` (1200KB) et sort de `@not_upload` (64KB)');
    // The deploy/vps diff: the Caddyfile only, and in it the two rules gaining the WORN path, nothing else of its rules.
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --name-status <SHA_M1> HEAD -- deploy/vps');
    expect(block('M\tdeploy/vps/')).toEqual(['M\tdeploy/vps/Caddyfile']);
    expect(commands).toContain("git -C /opt/orbes/orbes-index diff <SHA_M1> HEAD -- deploy/vps/Caddyfile | grep -E '^[-+][[:space:]]+path_regexp'");
    const gained = caddyWornLines();
    expect(gained).toHaveLength(2);
    const lost = gained.map((l) => l.replace('^/api/(admin/(', '^/api/admin/(').replace(`)|${WORN_PATTERN})/?$`, ')/?$'));
    expect(block('-\t')).toEqual([`-${lost[0]}`, `+${gained[0]}`, `-${lost[1]}`, `+${gained[1]}`]);
    const caddyDiff = git(['diff', DESKTOP_COMMIT, '--', 'deploy/vps/Caddyfile']);
    if (caddyDiff !== null) expect(caddyDiff.split('\n').filter((l) => /^[-+][\t ]+path_regexp/.test(l))).toEqual(block('-\t'));
    // Each commit of lot M2 that touches deploy/vps touches the Caddyfile only (M1's touched compose.yaml and .env.example).
    const log = git(['log', '--no-merges', '--format=%H %s', `${DESKTOP_COMMIT}..HEAD`, '--', 'deploy/vps']);
    if (log !== null) {
      const m2 = log.trim().split('\n').filter((l) => / MACRO-M2\./.test(l)).map((l) => l.split(' ')[0]!);
      expect(m2.length).toBeGreaterThan(0);
      for (const c of m2) expect(execFileSync('git', ['diff', '--name-only', `${c}^`, c, '--', 'deploy/vps'], { cwd: REPO, encoding: 'utf8' }).trim(), c).toBe('deploy/vps/Caddyfile');
    }
    expect(section(runbook, '### 1.0')).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    // The heads-up at launch and after.
    expect(section(runbook, '### 1.4')).toContain("« MACRO M2 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_M2>, 2 migrations ; le Caddyfile convenu");
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
    expect(section(runbook, '### 1.5')).toContain('**jamais `scripts/deploy.sh --image <TAG_M1>`**');
    // The legal pages: one new version, the code's; the ORBES CARE conditions keep theirs; counsel never holds the deploy.
    // A later lot may move LEGAL_VERSION past it; M2's head publishes M2's.
    expect(LEGAL_VERSION >= M2_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${M2_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${M2_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(readDoc('genome/src/web/legal/content/index.ts')).toContain(`${M2_LEGAL_VERSION} is the version of lot`);
    expect(readDoc('genome/src/server/render/care-conditions.ts')).toContain(`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';`);
  });

  it('reads the box after the migrations, read only, and the recreated Caddy’s configuration', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([psql('select (select count(*) from house_moment_settings where enabled), (select count(*) from house_messages), (select count(*) from house_deliveries), (select count(*) from worn_photos)')]);
    expect(after).toContain('Sortie attendue : `0|0|0|0`.');
    for (const q of fenced(runbook, 'bash').filter((c) => c.includes('psql'))) expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop|truncate)\b/i);
    // The container's Caddyfile, mounted from the stack's: the WORN path in its two rules.
    expect(readDoc('deploy/vps/compose.yaml')).toContain('- ./Caddyfile:/etc/caddy/Caddyfile:ro');
    expect(commands).toContain(`docker compose exec -T caddy grep -cF '${WORN_PATTERN}' /etc/caddy/Caddyfile`);
    expect(readDoc('deploy/vps/Caddyfile').split('\n').filter((l) => l.includes(WORN_PATTERN))).toHaveLength(2);
    expect(after).toContain('Sortie attendue : `2`.');
  });

  it("checks from the Mac WORN's 404 and the 64KB kept elsewhere, and proves the WORN path's 1200KB with a real photograph", () => {
    const after = section(runbook, '### 1.6');
    // A photograph not in WORN: the public route answers WORN_NOT_FOUND, 404, in the server's error shape.
    expect(readDoc('genome/src/server/routes/public.ts')).toContain("app.get('/api/v1/worn/:id/photo'");
    expect(commands).toContain("curl -s -w '\\n%{http_code}\\n' https://verify.theorbes.com/api/v1/worn/00000000-0000-4000-8000-000000000000/photo");
    const e = wornNotFound();
    expect(e.httpStatus).toBe(404);
    expect(after).toContain(`Sortie attendue : \`${JSON.stringify(errorBody(e.code, e.publicMessage))}\`, puis \`404\`.`);
    // 100 KB to /api/v1/verify: Caddy's 64KB, after its recreation.
    expect(readDoc('deploy/vps/Caddyfile')).toContain('max_size 64KB');
    expect(commands).toContain("head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\\n' -X POST -H 'content-type: application/json' --data-binary @- https://verify.theorbes.com/api/v1/verify");
    expect(after).toContain('Sortie attendue : `413`.');
    // No curl on the WORN path: the account guard answers 401 at onRequest, before the body is read.
    expect(commands.filter((c) => c.includes('/worn') && c.includes('-X POST'))).toEqual([]);
    expect(readDoc('genome/src/server/routes/ownership.ts')).toContain("app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));");
    expect(after).toContain("sans session, l'application répond `401` avant de lire le corps");
    // The real photograph's stored size, read only: over 64 000 bytes, so it crossed Caddy past the old limit (the
    // sanitizer only strips, so the body sent was at least as large); the device's encoder stays under 1 MiB.
    const checks = section(runbook, '### 1.7');
    expect(fenced(checks, 'bash')).toContain(psql('select octet_length(photo) from worn_photos where photo is not null order by created_at desc limit 1'));
    expect(checks).toContain('un nombre **au-dessus de 64000**');
    expect(PHOTO_MAX_BYTES).toBeLessThan(1_200_000);
    expect(readDoc('genome/src/server/db/migrations/0053_worn.ts')).toContain('worn_photos_photo');
    expect(checks).toContain(`« ${WORN.tooLarge} »`);
  });

  it('sends a scheduled message to the owner’s own segment and reads it on the phone and on a computer, in the code’s words', () => {
    const checks = section(runbook, '### 1.7');
    // The segment: a tag on his own client sheet, then a Tagged rule.
    expect(TAGS_NOTES_COPY.addTag).toBe('Add a tag');
    expect(TAGS_NOTES_COPY.add).toBe('Add');
    expect(tagValue('house check')).toBe('HOUSE CHECK');
    expect(checks).toContain('`Add a tag`, `HOUSE CHECK`, `Add`');
    expect(SEGMENT_RULE_LABELS.TAGGED).toBe('Tagged');
    const segments = readDoc('genome/src/web/admin/views/segments.ts');
    for (const w of ["'New segment'", "field('Name'", "'Add a rule'", "'Tags'", "'Create segment'"]) expect(segments, w).toContain(w);
    expect(checks).toContain('`Segments` → `New segment` : `Name` `House check`, `Add a rule`, `Tagged`, `Tags` `HOUSE CHECK`, puis `Create segment`');
    // The message, its audience under A segment, its reach, the draft, then Send… with Schedule in Paris and SEND typed.
    expect(readDoc('genome/src/web/admin/main.ts')).toContain("{ route: 'houseMessages', label: 'House messages' }");
    for (const w of [HOUSE_COPY.messages, HOUSE_COPY.newMessage, HOUSE_COPY.title, HOUSE_COPY.body, HOUSE_COPY.audience, HOUSE_COPY.aSegment, HOUSE_COPY.saveDraft, HOUSE_COPY.send, HOUSE_COPY.schedule, HOUSE_COPY.at]) {
      expect(checks, w).toContain(`\`${w}\``);
    }
    expect(reachText(1)).toBe('Reaches 1 collector now.');
    expect(checks).toContain(`« ${reachText(1)} »`);
    expect(checks).toContain(`« ${HOUSE_COPY.created} »`);
    const view = readDoc('genome/src/web/admin/views/house-messages.ts');
    expect(view).toContain("phrase: 'SEND',");
    expect(view).toContain("confirmLabel: kind === 'SEND' ? 'Send'");
    expect(checks).toContain('tape `SEND`, puis `Send`');
    expect(checks).toContain(`\`${statusWords('SCHEDULED')}\``);
    expect(checks).toContain(`\`${statusWords('SENT')}\`, \`Reached\` 1`);
    expect(view).toContain("{ label: 'Reached',");
    expect(view).toContain("{ label: 'Read · share',");
    expect(readText({ status: 'SENT', reach: 1, read: 1, shareRead: 1 })).toBe('1 · 100 %');
    expect(checks).toContain(`\`Read · share\` du message lit \`${readText({ status: 'SENT', reach: 1, read: 1, shareRead: 1 })}\``);
    expect(checks).toContain("Dans les 30 secondes qui suivent l'heure choisie");
    expect(HOUSE_COPY.atHint).toContain('within 30 seconds');
    // The phone: NOW's line, the two tabs with NEW, no reply; the computer: the subject and the button.
    expect(checks).toContain(`NOW dit « ${FROM_ORBES.now.sentence} »`);
    expect(checks).toContain(`deux onglets, ${FROM_ORBES.conversation} et ${FROM_ORBES.title}, ${APP_MESSAGES.new} sur ${FROM_ORBES.title}`);
    expect(checks).toContain(`« ${FROM_ORBES.noReply} »`);
    expect(checks).toContain(`le sujet ${FROM_ORBES.title}, le même message, et ${APP_MESSAGES.write} à la place de la réponse`);
  });

  it('switches a moment on and off, and sends, publishes, shows signed out and withdraws a WORN photograph, in the code’s words', () => {
    const checks = section(runbook, '### 1.7');
    // A moment: OFF at first, Switch on asked with the no-back-fill sentence, ON since a Paris time, then Switch off.
    expect(momentSwitch({ enabled: false, enabledAt: null })).toMatchObject({ text: 'OFF', note: HOUSE_COPY.off });
    expect(momentSwitch({ enabled: true, enabledAt: '2026-10-22T12:00:00.000Z' }).note).toMatch(/^Since /);
    expect(HOUSE_MOMENT_INFO.NINETY_DAYS.name).toBe('90 days away');
    expect(checks).toContain(`\`${HOUSE_COPY.moments}\` : les six lisent \`OFF\`, « ${HOUSE_COPY.off} »`);
    expect(checks).toContain(`Sur \`${HOUSE_MOMENT_INFO.NINETY_DAYS.name}\`, \`${HOUSE_COPY.switchOn}\` : la boîte dit « ${HOUSE_COPY.noBackFill} »`);
    expect(checks).toContain('`ON`, « Since <date et heure à Paris> »');
    expect(checks).toContain(`\`${HOUSE_COPY.switchOff}\` : \`OFF\` à nouveau, « ${HOUSE_COPY.switchedOff} »`);
    expect(fenced(checks, 'bash')).toContain(psql('select count(*) from house_deliveries where moment is not null'));
    // WORN from the piece: MY PIECES, OWNERSHIP, the block after the certificate.
    expect(checks).toContain(`${PIECES.link}, la pièce, l'onglet ${PIECES.tabs.ownership} : le bloc ${WORN.title} sous ${PIECES.certificateTitle}`);
    expect(checks).toContain(`${WORN.choose}, une vraie photo`);
    expect(checks).toContain(`${WORN.consentLabel}, puis ${WORN.send} : ${WORN.review}, « ${WORN.reviewText} »`);
    // The console's WORN: its link, To review, the credit as it will read, Publish.
    expect(readDoc('genome/src/web/admin/main.ts')).toContain("{ route: 'worn', label: 'WORN' }");
    expect(checks).toContain(`\`${WORN_COPY.review}\`, ta photo, \`${WORN_COPY.credit}\``);
    expect(checks).toContain(`\`${WORN_COPY.publish}\` : « ${WORN_COPY.published_} »`);
    // PUBLISHED, then the sheet signed out, after PAIRS WELL WITH.
    expect(WORN.publishedSince('<date>')).toBe('In WORN since <date>.');
    expect(checks).toContain(`${WORN.published}, « ${WORN.publishedSince('<date>')} », ${WORN.seeOnSheet}`);
    expect(checks).toContain(`\`https://verify.theorbes.com${LOOKBOOK_PATH}/…\``);
    expect(checks).toContain(`après ${LOOKBOOK.pairs.title} : ${WORN.sheet.title}`);
    // Withdrawn: confirmed in place, Ended reads Withdrawn, a new private window no longer shows WORN (5 minutes' cache).
    expect(checks).toContain(`${WORN.withdraw} : « ${WORN.withdrawAsk} », puis ${WORN.withdraw} encore : « ${WORN.withdrawn} »`);
    expect(checks).toContain(`\`${WORN_COPY.title}\` → \`${WORN_COPY.ended}\` : ta photo lit \`${wornStatusWords('WITHDRAWN').text}\``);
    expect(readDoc('genome/src/server/routes/public.ts')).toContain("export const LOOKBOOK_CACHE_CONTROL = 'public, max-age=300';");
    expect(checks).toContain('5 minutes au plus');
    // The legal pages: the version line and the two new sections.
    expect(checks).toContain(`« ${WORDS.en.version(M2_LEGAL_VERSION)} »`);
    const titles = PRIVACY.en.sections.map((s) => s.title);
    for (const t of ['House messages', 'WORN']) {
      expect(titles, t).toContain(t);
      expect(checks, t).toContain(`« ${t} »`);
    }
  });

  it('tells ORBES Client Services before (the playbook’s M2 lines, both copies) and lists what follows and what stays open', () => {
    const before = section(runbook, '### 1.1');
    for (const what of ["**1. Tes écrans d'abord**", '**MACRO M1 est en production**', '**Aucune LIVE RELEASE**', '**aucun test de TEST ENTRANTS**', '**Préviens ORBES Client Services**']) expect(before, what).toContain(what);
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768']) expect(before, what).toContain(what);
    for (const s of ["§0 « Les messages d'ORBES (FROM ORBES) »", '« WORN : la photo d\'une pièce portée »']) expect(before, s).toContain(s);
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const zero = section(readDoc(copy), '## 0.');
      for (const h of ["### Les messages d'ORBES (FROM ORBES)", "### WORN : la photo d'une pièce portée"]) expect(zero, `${copy}: ${h}`).toContain(h);
    }
    const next = section(runbook, '### 1.8');
    for (const what of ['**Préviens ORBES Client Services**', '**WORN, la file de chaque jour**', '**Les anciennes images (facultatif).**']) expect(next, what).toContain(what);
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(open).toContain('la note au juriste, points 33 et 34');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(la note au juriste, points 33 et 34)');
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(40);
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
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-MACRO-M2.md)');
    expect(section(readDoc('docs/COMPLIANCE.md'), '## 13.')).toContain('(launch/DEPLOY-MACRO-M2.md)');
    // Never the words the brand keeps out of what it says.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
  });
});
