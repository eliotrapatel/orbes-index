/**
 * docs/launch/DEPLOY-MACRO-M1.md, the owner's runbook for lot M1 of the macro scope of 2026-10-20 (plan §7, step M1.23),
 * against the scripts, the stack, the migrations, the server and the apps it quotes:
 *
 *  - it starts from production as it runs when M1 starts (the desktop, 00317bc, 0001 to 0048) and applies exactly
 *    0049_live_pace, 0050_founding_list and 0051_emails, as the scripts print it: the table of §1.0, the files the
 *    commit adds under migrations, the lines `db_applied_migrations` and deploy.sh print before, the line `db.ts migrate`
 *    prints, those deploy.sh prints after it, the deployment log and the count `db.ts status` shows; the desktop's image
 *    no longer runs on the schema after them, so a failure is repaired forward;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts and the app is still one they print;
 *  - the owner's rules: his look at the screens first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the hub's backup
 *    minutes (Paris first, UTC in brackets), no slot booked and a heads-up at launch, the box's figures before and after,
 *    the guarded launch, restore.sh only ever run to watch it refuse, no prune; the one change of the host (the eight
 *    EMAIL_ and SMTP_ lines of compose.yaml, empty, and .env.example's comments: the deploy/vps diff is those two files)
 *    agreed with the host manager first, the server's .env left without them; the legal pages' new version,
 *    LEGAL_VERSION, the ORBES CARE conditions keeping theirs; no email sent; theorbes.com untouched until his OK;
 *  - the post-check: the box read only (no pace, the founding list empty, no email on or written, every recovery code
 *    the staff's), then from the Mac the founding route's CORS for https://theorbes.com only (204 and its headers, 403
 *    for another site), the reset by email answering off, the emails' monogram;
 *  - one real check per element, the 5 000 TEST ENTRANTS run first (the test model at 1 EUR, open to its owners only,
 *    said public until its end and in PAST after; 5 presses of 1 000, a pace of 250 a minute, the report's PACE check),
 *    in the console's and the app's words as the code has them; Client Services told (the playbook's M1 lines, both
 *    copies); one command per shell block, relative links that resolve, and the runbook linked from DEPLOYMENT and
 *    COMPLIANCE.
 *
 * <SHA_M1> and <TAG_M1> stay placeholders until the main session hands the commit over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { EMAIL_KINDS, LIVE_PACE_BATCH, LIVE_PACE_MINUTES } from '../../src/server/db/schema.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { FOUNDING_PREFLIGHT_MAX_AGE } from '../../src/server/routes/founding.js';
import { FOUNDING_ORIGIN } from '../../src/server/services/founding.js';
import { CAMPAIGN_COPY, COUNTDOWN_WORDS } from '../../src/web/admin/model/campaign.js';
import { channelRows, EMAILS_COPY, switchState } from '../../src/web/admin/model/emails.js';
import { FOUNDING_COPY, FOUNDING_SEGMENT_NAME, removePhrase } from '../../src/web/admin/model/founding.js';
import { LINE_LABELS } from '../../src/web/admin/model/links.js';
import { liveEntryAdmission, livePaceFigures } from '../../src/web/admin/model/live.js';
import { TEST_ENTRANTS_LIMITS, testPhrase } from '../../src/web/admin/model/test-entrants.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { PRIVACY } from '../../src/web/legal/content/privacy.js';
import { ACCOUNT_PASSWORD, ACCOUNT_RESET, LIVE, RELEASE_NOTICES } from '../../src/web/verify/copy.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-MACRO-M1.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** What production runs when M1 starts: the desktop (the scope's base), deployed after ORBES CARE. */
const PROD_COMMIT = '00317bcc0b4aeec5906ec417c1d9688c3bda55e6';
const PROD_TAG = PROD_COMMIT.slice(0, 12);
/** ORBES CARE's image, the desktop's previous one, as the desktop's deployment log line names it (DEPLOY-DESKTOP §1.6). */
const CARE_TAG = 'c3d25c207a94';
/** The legal version of this lot (step M1.20), and the ORBES CARE conditions', unchanged since ORBES CARE. */
const M1_LEGAL_VERSION = '2026-10-21';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
const BEFORE = NAMES.filter((n) => numberOf(n) <= 48);
const DEPLOY = NAMES.filter((n) => numberOf(n) >= 49 && numberOf(n) <= 51);
const AFTER = [...BEFORE, ...DEPLOY];

/** The eight variables of the emails' channel that compose.yaml passes to the app (step M1.16). */
const EMAIL_VARS = ['EMAIL_TRANSPORT', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASSWORD'];

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

/** git in the repository, or null where its history does not hold production's commit (genome-ci's shallow checkout). */
function git(args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${PROD_COMMIT}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    return null;
  }
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

describe('the runbook of lot MACRO M1 (docs/launch/DEPLOY-MACRO-M1.md)', () => {
  it('starts from the desktop in production, 0001 to 0048, and applies exactly 0049 to 0051, as the scripts print it', () => {
    expect(DEPLOY).toEqual(['0049_live_pace', '0050_founding_list', '0051_emails']);
    expect(BEFORE).toHaveLength(49);
    expect(BEFORE.at(-1)).toBe('0048_orbes_care');
    // A later migration (lots M2 to M4) has its own runbook and comes after M1's, in build order.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => numberOf(n) >= 52)).toBe(true);
    expect(runbook).toContain(`le commit \`${PROD_COMMIT}\` (image \`orbes-genome:${PROD_TAG}\`, en service depuis le 2026-10-18 à 13:06 à Paris, 11:06 UTC), avec les quarante-neuf migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : quarante-neuf lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_M1>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration, and the columns and tables it names, as the migrations create them.
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY);
    const migration = (name: string) => readDoc(`genome/src/server/db/migrations/${name}.ts`);
    for (const c of ['pace_batch', 'pace_minutes', 'pace_paused_at', 'pace_next_at', 'pace_batches', 'admitted_at', 'admitted_batch']) expect(migration('0049_live_pace'), c).toContain(c);
    for (const c of ['preregistrations', 'LANDING', 'drops_draw_plus']) expect(migration('0050_founding_list'), c).toContain(c);
    for (const c of ['email_templates', 'email_outbox', 'email_preferences', 'email_state', 'issued_via', "'STAFF'"]) expect(migration('0051_emails'), c).toContain(c);
    // The files the commit adds under migrations, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${PROD_COMMIT} HEAD -- genome/src/server/db/migrations`);
    const added = git(['diff', '--name-status', PROD_COMMIT, '--', 'genome/src/server/db/migrations']);
    if (added !== null) {
      // M1's range is exactly 0049 to 0051; a later lot's migration (0052 on) is only ever added after it.
      const prefix = 'A\tgenome/src/server/db/migrations/';
      const lines = added.trim().split('\n');
      const lotNumber = (line: string) => (line.startsWith(prefix) ? Number(line.slice(prefix.length, prefix.length + 4)) : NaN);
      expect(lines.filter((l) => !(lotNumber(l) >= 52))).toEqual(DEPLOY.map((n) => `${prefix}${n}.ts`));
      expect(lines.filter((l) => lotNumber(l) >= 52).every((l) => /^A\tgenome\/src\/server\/db\/migrations\/\d{4}_[a-z0-9_]+\.ts$/.test(l))).toBe(true);
    }
    // db.ts migrate, then deploy.sh's end and its log line.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`previous image tag: ${PROD_TAG}`);
    expect(runbook).toContain(`(previous: ${PROD_TAG}). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(`orbes-genome:${PROD_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${PROD_TAG} refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M1> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).`);
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_M1> OK (previous ${PROD_TAG}; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\``);
    // The desktop as the last deployment: its log line exactly as DEPLOY-DESKTOP §1.6 expects it.
    expect(runbook).toContain(`\`… deploy ${PROD_TAG} OK (previous ${CARE_TAG})\``);
    expect(readDoc('docs/launch/DEPLOY-DESKTOP.md')).toContain(`deploy <TAG_DESK> OK (previous ${CARE_TAG})`);
    expect(runbook).toContain(`Sortie attendue : \`${PROD_COMMIT}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${PROD_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${PROD_COMMIT.slice(0, 7)}..<7 caractères de SHA_M1>\``);
    // <SHA_M1> and <TAG_M1> stay placeholders until the main session hands the commit over.
    expect(runbook).toContain('`<SHA_M1>` est le commit final (40 caractères)');
    // A runbook re-based first when production runs another image.
    expect(runbook).toContain('Si la dernière ligne OK de `.state/deploys.log` nomme une autre image');
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('FORWARD="If anything goes wrong, repair forward: scripts/deploy.sh --image $TAG after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7)."');
  });

  it("holds the owner's rules: the one change of the host agreed first, the .env left empty, the legal pages' new version, no email, theorbes.com untouched", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les écrans d'abord.**");
    // Paris first, UTC in brackets.
    expect(rules).toContain("**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(rules).toContain("03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)");
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC");
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain('**Jamais `restore.sh` sur ce serveur**');
    expect(rules).toContain('**Le site theorbes.com ne change pas** avec ce déploiement');
    expect(rules).toContain('**Aucun e-mail ne part**');
    expect(rules).toContain('la branche `orbes-macro` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The one change of the host: compose.yaml's eight empty lines, agreed with the host manager before the launch.
    expect(rules).toContain("**Un seul changement de l'hôte, sans effet sur ce qu'un déploiement lance**");
    expect(rules).toContain("**ce changement passe d'abord par le responsable de l'hôte**");
    for (const v of EMAIL_VARS) expect(rules, v).toContain(`\`${v}\``);
    const before = section(runbook, '### 1.1');
    expect(before).toContain("**3. Le responsable de l'hôte d'abord**");
    expect(before).toContain('Attends son accord. Sans lui, n\'avance pas.');
    for (const v of EMAIL_VARS) expect(before, v).toContain(`\`${v}\``);
    // The deploy/vps diff: exactly .env.example and compose.yaml; compose gains the eight lines, each `${NAME:-}`, and nothing else.
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${PROD_COMMIT} HEAD -- deploy/vps`);
    expect(block('M\tdeploy/vps/')).toEqual(['M\tdeploy/vps/.env.example', 'M\tdeploy/vps/compose.yaml']);
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff ${PROD_COMMIT} HEAD -- deploy/vps/compose.yaml | grep -E '^[-+][^-+]'`);
    const gained = block('+      # Emails');
    expect(gained.every((l) => l.startsWith('+'))).toBe(true);
    const compose = readDoc('deploy/vps/compose.yaml').split('\n');
    const at = compose.indexOf(gained[0]!.slice(1));
    expect(at, 'the emails comment of compose.yaml').toBeGreaterThan(0);
    expect(compose.slice(at, at + gained.length)).toEqual(gained.map((l) => l.slice(1)));
    const passed = gained.map((l) => /^\+ +([A-Z_]+): \$\{([A-Z_]+):-\}$/.exec(l)).filter((m) => m !== null);
    expect(passed.map((m) => m![1])).toEqual(EMAIL_VARS);
    expect(passed.every((m) => m![1] === m![2])).toBe(true);
    for (const v of EMAIL_VARS) {
      expect(readDoc('deploy/vps/.env.example'), v).toMatch(new RegExp(`^# ${v}=`, 'm'));
      expect(readDoc('deploy/vps/.env.example'), v).not.toMatch(new RegExp(`^${v}=`, 'm'));
      expect(readDoc('genome/src/server/config.ts'), v).toContain(v);
    }
    const stack = git(['diff', '--name-status', PROD_COMMIT, '--', 'deploy/vps']);
    // Lot M2 changes the Caddyfile after M1 (its WORN upload, MACRO M2.8), told by its own runbook; M1's elements are these two.
    if (stack !== null) expect(stack.trim().split('\n').filter((l) => l !== 'M\tdeploy/vps/Caddyfile')).toEqual(['M\tdeploy/vps/.env.example', 'M\tdeploy/vps/compose.yaml']);
    const composeDiff = git(['diff', PROD_COMMIT, '--', 'deploy/vps/compose.yaml']);
    if (composeDiff !== null) expect(composeDiff.split('\n').filter((l) => /^[-+][^-+]/.test(l))).toEqual(gained);
    // The server's .env keeps none of them: checked, never filled now.
    const prepare = section(runbook, '### 1.2');
    expect(fenced(prepare, 'bash')).toContain("grep -cE '^(EMAIL_|SMTP_)' .env");
    expect(prepare).toContain('tu ne les remplis pas maintenant');
    expect(prepare).toContain("Sortie attendue : `0`. Un autre nombre : arrête-toi et dis-le à Claude, sans coller les lignes.");
    // The heads-up at launch and after.
    expect(section(runbook, '### 1.4')).toContain("« MACRO M1 : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_M1>, 3 migrations ; compose.yaml : les huit variables des e-mails, vides, comme convenu ; rien d'autre ne change sur l'hôte.");
    expect(section(runbook, '### 1.6')).toContain("**Préviens le responsable de l'hôte**");
    expect(section(runbook, '### 1.4')).toContain('Caddy n\'est pas recréé');
    // The box's figures before and after (and during the 5 000 run), the swap line read.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(commands.filter((c) => /docker image rm/.test(c))).toEqual([]);
    expect(section(runbook, '### 1.4')).toContain("**Note le nom de l'archive et sa taille en octets**");
    expect(section(runbook, '### 1.5')).toContain(`**jamais \`scripts/deploy.sh --image ${PROD_TAG}\`**`);
    // The legal pages: one new version, the code's; the ORBES CARE conditions keep theirs; counsel never holds the deploy.
    // A later lot (macro M2, 2026-10-22) moves LEGAL_VERSION past it; M1's head still publishes M1's.
    expect(LEGAL_VERSION >= M1_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${M1_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${M1_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(readDoc('genome/src/web/legal/content/index.ts')).toContain(`${M1_LEGAL_VERSION} is the version of lot M1`);
    expect(readDoc('genome/src/server/render/care-conditions.ts')).toContain(`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';`);
  });

  it('reads the box after the migrations, read only, against their tables and columns', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([
      psql('select count(*) from drops where pace_batch is not null'),
      psql('select count(*) from preregistrations'),
      psql('select (select count(*) from email_templates where enabled), (select count(*) from email_outbox)'),
      psql('select count(*) from account_recovery_codes where created_by is null'),
    ]);
    for (const q of reads) expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop|truncate)\b/i);
    expect(after).toContain('Sortie attendue : `0|0`.');
    // A recovery code without a staff member is exactly one sent by email (0051's CHECK).
    expect(readDoc('genome/src/server/db/migrations/0051_emails.ts')).toContain("CHECK ((issued_via = 'STAFF') = (created_by IS NOT NULL))");
    expect(readDoc('genome/src/server/db/migrations/0051_emails.ts')).toMatch(/enabled +boolean +NOT NULL DEFAULT false/);
  });

  it('checks from the Mac the founding route’s CORS for theorbes.com only, the reset by email off and the monogram', () => {
    const after = section(runbook, '### 1.6');
    const route = '/api/v1/founding';
    expect(FOUNDING_ORIGIN).toBe('https://theorbes.com');
    expect(readDoc('genome/src/server/routes/founding.ts')).toContain(`const ROUTE = '${route}';`);
    // The preflight a browser on theorbes.com sends: 204 and its headers, as the route writes them.
    expect(commands).toContain(
      `curl -s -i -X OPTIONS https://verify.theorbes.com${route} -H 'Origin: ${FOUNDING_ORIGIN}' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' | grep -iE '^(HTTP|access-control|vary)'`,
    );
    expect(after).toContain('Sortie attendue : `HTTP/2 204` en première ligne');
    expect(block('access-control-allow-origin:')).toEqual([
      `access-control-allow-origin: ${FOUNDING_ORIGIN}`,
      'access-control-allow-methods: POST',
      'access-control-allow-headers: content-type',
      `access-control-max-age: ${FOUNDING_PREFLIGHT_MAX_AGE}`,
      'vary: Origin',
    ]);
    const routes = readDoc('genome/src/server/routes/founding.ts');
    for (const h of ["reply.header('access-control-allow-methods', 'POST')", "reply.header('access-control-allow-headers', 'content-type')", "reply.header('vary', 'Origin')", 'reply.code(204)']) expect(routes, h).toContain(h);
    // Another site: the server refuses it itself.
    expect(commands).toContain(`curl -s -o /dev/null -w '%{http_code}\\n' -X OPTIONS https://verify.theorbes.com${route} -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST'`);
    expect(after).toContain('Sortie attendue : `403`');
    expect(routes).toContain("new DomainError('FOUNDING_ORIGIN', 403,");
    // The reset by email, off while the channel is off.
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/account/reset');
    expect(after).toContain('Sortie attendue : `{"email":false}`.');
    expect(readDoc('genome/src/server/routes/account.ts')).toContain('return { email: await recovery.resetByEmail() };');
    // The emails' monogram.
    expect(commands).toContain("curl -s -o /dev/null -w '%{http_code} %{content_type}\\n' https://verify.theorbes.com/api/v1/email/monogram.png");
    expect(after).toContain('Sortie attendue : `200 image/png`.');
    expect(readDoc('genome/src/server/routes/email.ts')).toContain('/api/v1/email/monogram.png');
  });

  it('runs the 5 000 TEST ENTRANTS check of the pace in the console’s words, and its report’s PACE check', () => {
    const checks = section(runbook, '### 1.7');
    // Five presses of 1 000, the most a press and a run take.
    expect(TEST_ENTRANTS_LIMITS.perPress).toBe(1000);
    expect(TEST_ENTRANTS_LIMITS.perRun).toBe(5000);
    expect(checks).toContain('**5 000 entrants d\'essai** en cinq envois de 1 000, tous avant T0');
    // A pace of 250 every minute, within the bounds: twenty batches for 5 000.
    expect(250).toBeGreaterThanOrEqual(LIVE_PACE_BATCH.min);
    expect(250).toBeLessThanOrEqual(LIVE_PACE_BATCH.max);
    expect(1).toBeGreaterThanOrEqual(LIVE_PACE_MINUTES.min);
    expect(checks).toContain('`Pace · buyers per batch` `250` ; `Pace · every (minutes)` `1`');
    expect(checks).toContain('vingt lots, le premier à T0, le dernier à T0 + 19 minutes');
    const live = readDoc('genome/src/web/admin/views/live.ts');
    const club = readDoc('genome/src/web/admin/views/club.ts');
    const tests = readDoc('genome/src/web/admin/views/test-entrants.ts');
    // The test release: the test model at a nominal price, open to that model's owners only (test entrants count as
    // owners, the house test account holds its piece), and said public until its end and then in PAST for ever (the
    // console refuses a name or photograph stage after the room opens).
    expect(checks).toContain("`Model` le modèle d'essai dont le compte d'essai de la maison détient une pièce (jamais une vraie pièce), `Title` `TEST PACE`, `Price of a piece` `1`, `Currency` `EUR`, une taille, `ONE SIZE = 25`");
    expect(checks).toContain("`Access` → `Edit` : `Owners of <le modèle d'essai>` coché, rien d'autre");
    for (const label of ["label: 'Model'", "label: 'Title'", "label: 'Price of a piece'", "label: 'Currency'", "editPart('access', 'Access'", 'label: `Owners of ${humanize(m.name)}`']) expect(live, label).toContain(label);
    expect(readDoc('genome/src/server/services/test-entrants.ts')).toContain("it counts as owning the release's models");
    expect(checks).toContain("**Visible de tous** : elle paraît dans THE RELEASES et la bannière de sa publication à sa fin, puis pour toujours dans PAST et sur la fiche du modèle d'essai");
    expect(checks).toContain('fais-la à une heure creuse');
    expect(readDoc('genome/src/server/services/live-console.ts')).toContain('is revealed before the room opens.');
    // ONE QUEUE (lot Q1, D1) named the pace's fields anew, required at creation: the runbook, deployed, keeps M1's words,
    // the console says them so now.
    const renamed = new Map([
      ['Pace · buyers per batch', 'People per batch'],
      ['Pace · every (minutes)', 'Every (minutes)'],
    ]);
    const quoted: ReadonlyArray<readonly [label: string, text: string]> = [
      ['New live release', club],
      ['Times (UTC)', live],
      ['Room opens (minutes before)', live],
      ['The opening', live],
      ['End of the sales', live],
      ['Pace · buyers per batch', live],
      ['Pace · every (minutes)', live],
      ['Publish', live],
      ['Pause pace', live],
      ['Resume pace', live],
      ['Next batch now', live],
      ['Set pace', live],
      ['PACE PAUSED', live],
      ['Test entrants', tests],
      ['Send test entrants', tests],
      ['Add more', tests],
      ['End test', tests],
      ['Stop', tests],
      ['Report', tests],
      ['Past tests', tests],
    ];
    for (const [label, text] of quoted) {
      expect(runbook, label).toContain(label);
      const now = renamed.get(label) ?? label;
      expect(text, `${now}: not in the console`).toMatch(new RegExp(`['\`]${now.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\`]`));
    }
    // The dialog's fields, as the console labels them (TEST_TIERS' TITANE, the LIVE behaviour).
    for (const label of ['Test entrants · TITANE', 'Arrival', 'Behaviour · PAY (%)', 'Behaviour · RELEASE MY PLACE (%)', 'Behaviour · miss the turn (%)', 'Behaviour · LEAVE (%)']) {
      expect(checks, label).toContain(`\`${label}\``);
    }
    expect(tests).toContain('label: `Test entrants · ${x.label}`');
    expect(readDoc('genome/src/web/admin/model/test-entrants.ts')).toContain("label: 'TITANE'");
    for (const label of ["'Arrival'", "'Behaviour · PAY (%)'", "'Behaviour · RELEASE MY PLACE (%)'", "'Behaviour · miss the turn (%)'", "'Behaviour · LEAVE (%)'", "label: 'All at once'"]) {
      expect(tests + readDoc('genome/src/web/admin/model/test-entrants.ts'), label).toContain(label);
    }
    expect(checks).toContain('`Arrival` `All at once`');
    // The phrases typed.
    expect(testPhrase('send', '1a2b3c4d-0000')).toBe('TEST 1A2B3C4D');
    expect(testPhrase('end', '1a2b3c4d-0000')).toBe('END TEST 1A2B3C4D');
    expect(checks).toContain('`TEST <les 8 premiers caractères de la sortie>`');
    expect(checks).toContain('`END TEST <les mêmes 8 caractères>`');
    // The board's Pace block, as livePaceFigures says it, and the line's Admitted column.
    const figures = livePaceFigures({ phase: 'LIVE', paused: false, endedAt: null, pace: { batch: 250, minutes: 1, paused: false, waiting: 4750, admitted: 250, batches: 1, nextAt: '2026-10-21T12:01:00.000Z' } as never });
    // ONE QUEUE (lot Q1, D11: add only) keeps the four the runbook names, first, and adds its own after them.
    expect(figures.map((f) => f.label)).toEqual(['In the queue', 'Admitted', 'Batches', 'Next batch', 'Turns given', 'Beyond the pieces']);
    for (const f of figures.slice(0, 4)) expect(checks, f.label).toContain(`\`${f.label}\``);
    expect(liveEntryAdmission({ status: 'WAITING', admittedAt: '2026-10-21T12:01:00.000Z', batch: 2, letIn: false } as never).text).toBe('Batch 2');
    expect(checks).toContain('la colonne `Admitted` lit `Batch 1`, `Batch 2`');
    // The report's sixth check, PASSED or FAILED, and the server panel's red line.
    const service = readDoc('genome/src/server/services/test-entrants.ts');
    expect(service).toContain("id: 'PACE', label: 'The pace'");
    expect(tests).toContain("statusMark(c.pass ? 'PASSED' : 'FAILED'");
    expect(checks).toContain('chaque contrôle `PASSED`, dont **`The pace`**');
    expect(readDoc('genome/src/web/admin/model/system-status.ts')).toContain('THE SERVER IS STRAINED');
    expect(checks).toContain('`THE SERVER IS STRAINED`');
    // The collector's queue page as M1 deployed it (its runbook is history: ONE QUEUE, lot Q1 step Q1.3, replaced THE
    // QUEUE and ESTIMATED ENTRY with LIVE NOW, YOUR PLACE in its size and ESTIMATED N MINUTES LEFT; Q1.14's runbook
    // describes those).
    expect(checks).toContain('THE QUEUE, ta place, ESTIMATED ENTRY <heure> PARIS');
    expect(checks).toContain(`choisis la taille et ${LIVE.enterLine}`);
    expect(checks).toContain(LIVE.queue.paused);
    expect(checks).toContain(LIVE.queue.leave);
    // The bots open no stream: the memory of 5 000 open pages is the load report's §7, not this run's.
    expect(checks).toContain('[le rapport de charge, §7](../reports/live-load.md)');
    expect(readDoc('docs/reports/live-load.md')).toContain('### 7.4 The real check');
  });

  it("checks every other element for real, in the console's and the app's words as the code has them", () => {
    const checks = section(runbook, '### 1.7');
    for (const what of ["L'onglet CAMPAIGN", "L'image du compte à rebours", 'Le relevé par lien', 'ADD TO CALENDAR', "L'accès d'un tirage", 'La liste fondatrice', 'Les e-mails', 'Le mot de passe oublié', 'YOUR PROFILE', 'Les pages légales']) {
      expect(checks, what).toContain(`| ${what} |`);
    }
    // CAMPAIGN.
    for (const w of [CAMPAIGN_COPY.tabCampaign, CAMPAIGN_COPY.links, CAMPAIGN_COPY.makeLinks, CAMPAIGN_COPY.copy, CAMPAIGN_COPY.image, CAMPAIGN_COPY.teaser, CAMPAIGN_COPY.full, CAMPAIGN_COPY.download, CAMPAIGN_COPY.readout, CAMPAIGN_COPY.other, CAMPAIGN_COPY.total]) {
      expect(checks, w).toContain(`\`${w}\``);
    }
    expect(checks).toContain(`« ${CAMPAIGN_COPY.noLink} »`);
    expect(checks).toContain(`« ${COUNTDOWN_WORDS.teaserLabel} »`);
    expect(readDoc('genome/src/web/admin/model/links.ts')).toContain("archive: 'Archive'");
    expect(checks).toContain('`Archive`');
    // ADD TO CALENDAR, LIVE's word on a draw.
    expect(LIVE.calendar).toBe('ADD TO CALENDAR');
    expect(readDoc('genome/src/server/routes/public.ts')).toContain("app.get('/api/v1/drops/:id/calendar.ics'");
    // A draw's Access.
    expect(readDoc('genome/src/web/admin/views/drop.ts')).toContain("label: 'Access'");
    expect(checks).toContain('Le champ `Access` : `Everyone`');
    // New release is two dialogs: the model, Next, then the fields with Access.
    expect(checks).toContain('`New release`, choisis un modèle, `Next`, puis ferme sans enregistrer');
    expect(readDoc('genome/src/web/admin/views/club.ts')).toContain("confirmLabel: 'Next',");
    // The founding list: one person sent by curl with theorbes.com's Origin, the segment made, then removed.
    const add = fenced(checks, 'bash');
    expect(add).toEqual([
      'docker stats --no-stream',
      'free -h',
      `curl -s -w '\\n%{http_code}\\n' -X POST https://verify.theorbes.com/api/v1/founding -H 'Origin: ${FOUNDING_ORIGIN}' -H 'Content-Type: application/json' --data '{"email":"founding-check@theorbes.com","firstName":"Test","country":"FR","consent":true,"website":""}'`,
    ]);
    expect(checks).toContain('Sortie attendue : `{"ok":true}`, puis `202`.');
    expect(readDoc('genome/src/server/routes/founding.ts')).toContain('return reply.code(202).send({ ok: true });');
    expect(LINE_LABELS.DIRECT).toBe('Direct');
    expect(checks).toContain('source `Direct`');
    expect(FOUNDING_SEGMENT_NAME).toBe('Founding list');
    expect(checks).toContain(`\`${FOUNDING_COPY.makeSegment}\` : le segment \`${FOUNDING_SEGMENT_NAME}\` est fait`);
    expect(checks).toContain(`\`${FOUNDING_COPY.remove}\` sur sa ligne`);
    expect(removePhrase('1a2b3c4d-0000')).toBe('REMOVE 1A2B3C4D');
    expect(checks).toContain('`REMOVE <les 8 premiers caractères>`');
    expect(checks).toContain(`« ${FOUNDING_COPY.empty} »`);
    expect(readDoc('genome/src/web/admin/main.ts')).toContain("label: 'Founding list'");
    // The Emails page, OFF.
    expect(channelRows({ on: false } as never)).toEqual([{ label: 'Channel', value: 'OFF', note: EMAILS_COPY.channelOff }]);
    expect(checks).toContain(`\`Channel\` : OFF, « ${EMAILS_COPY.channelOff} »`);
    expect(switchState({ enabled: false }, false).text).toBe('OFF');
    expect(EMAIL_KINDS).toHaveLength(11);
    expect(checks).toContain('les onze e-mails OFF');
    expect(checks).toContain(`\`${EMAILS_COPY.outbox}\` vide`);
    expect(readDoc('genome/src/web/admin/views/settings.ts')).toContain("linkButton('Emails', href('emailSettings')");
    // The app with the emails off: FORGOTTEN PASSWORD? as before, no RESET BY EMAIL, no EMAILS group.
    expect(checks).toContain(`${ACCOUNT_PASSWORD.forgotten} | Exactement comme hier : ORBES Client Services et ${ACCOUNT_PASSWORD.haveCode}, pas de RESET BY EMAIL`);
    expect(ACCOUNT_RESET.send).toBe('SEND LINK');
    expect(checks).toContain(`sans groupe ${RELEASE_NOTICES.group}`);
    // The legal pages: the version line and the two new sections, as they publish them.
    expect(checks).toContain(`« ${WORDS.en.version(M1_LEGAL_VERSION)} »`);
    const titles = PRIVACY.en.sections.map((s) => s.title);
    for (const t of ['The founding list', 'Emails']) {
      expect(titles, t).toContain(t);
      expect(checks, t).toContain(`« ${t} »`);
    }
  });

  it('tells ORBES Client Services before (the playbook’s M1 lines, both copies) and lists what follows and what stays open', () => {
    const before = section(runbook, '### 1.1');
    for (const what of ["**1. Tes écrans d'abord**", '**La version ordinateur est en production**', '**Aucune LIVE RELEASE**', '**aucun test de TEST ENTRANTS**', '**Préviens ORBES Client Services**']) expect(before, what).toContain(what);
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768']) expect(before, what).toContain(what);
    for (const s of ['§0 « La liste fondatrice (theorbes.com) »', "§2 « Une LIVE RELEASE à son rythme : la file d'attente »", '§6 « Un lien par e-mail (une fois les e-mails allumés) »']) expect(before, s).toContain(s);
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const playbook = readDoc(copy);
      for (const h of ['### La liste fondatrice (theorbes.com)', "### Une LIVE RELEASE à son rythme : la file d'attente", '### Un lien par e-mail (une fois les e-mails allumés)']) expect(playbook, `${copy}: ${h}`).toContain(h);
      expect(section(playbook, '## 0.'), copy).toContain('### La liste fondatrice (theorbes.com)');
      expect(section(playbook, '## 2.'), copy).toContain("### Une LIVE RELEASE à son rythme : la file d'attente");
      expect(section(playbook, '## 6.'), copy).toContain('### Un lien par e-mail (une fois les e-mails allumés)');
    }
    // Afterwards: the pop-up on his explicit OK, from https://theorbes.com without www; the emails switched on in order.
    const next = section(runbook, '### 1.8');
    for (const what of ['**Préviens ORBES Client Services**', '**La nouvelle fenêtre de theorbes.com**', '**Allumer les e-mails, plus tard**', '**Le test de 5 000**', '**Les anciennes images (facultatif).**']) expect(next, what).toContain(what);
    expect(next).toContain('sur ton accord explicite seulement');
    expect(fenced(next, 'bash')).toContain("curl -s -o /dev/null -w '%{http_code} %{redirect_url}\\n' https://theorbes.com");
    for (const what of ['jamais dans une conversation', 'SPF, DKIM et DMARC', 'Amen', '`Send a test to me`', 'une nouvelle version des pages légales']) expect(next, what).toContain(what);
    expect(EMAILS_COPY.test).toBe('Send a test to me');
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(40);
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
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-MACRO-M1.md)');
    expect(section(readDoc('docs/COMPLIANCE.md'), '## 13.')).toContain('(launch/DEPLOY-MACRO-M1.md)');
    // Never the words the brand keeps out of what it says, in the runbook's quotes of the app.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
  });
});
