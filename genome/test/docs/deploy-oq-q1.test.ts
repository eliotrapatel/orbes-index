/**
 * docs/launch/DEPLOY-OQ-Q1.md, the owner's runbook for lot Q1, ONE QUEUE (plan Q1 §8, step Q1.14), against the scripts,
 * the migration, the server, the console and the app it quotes:
 *
 *  - it starts from production as lot M3 left it (33e8430, image 33e843081148, 0001 to 0057) and applies exactly
 *    0058_one_queue, as the scripts print it, each count and name derived from MIGRATIONS; M3's image no longer runs on
 *    the schema after it, so a failure after it is repaired forward;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts, the migration and the app is still
 *    one they print;
 *  - the owner's rules: the review board first (OP-12's console names, N14's hold line), every time in Paris first with
 *    UTC in brackets (DEPLOY-MACRO-M3's rule 2, the host's no-load-test window), no LIVE release between its room's
 *    opening and its end, the read-only pre-check for an open LIVE release without a pace (0058's own condition, D56),
 *    no slot booked and the one-line heads-up at launch, the box's figures before and after with the swap line, the
 *    guarded launch, nothing on the host changes (deploy/vps untouched since M3, no .env line), the legal pages' new
 *    version, restore.sh only ever run to watch it refuse, no prune;
 *  - the post-check: 59 `applied` lines, the box read only, the eleven sounds served as hashed /assets/*.mp3, the legal
 *    version in the published bundle, the host told with the swap;
 *  - one real check per element, in the console's and the app's words as the code has them; then TEST ENTRANTS' runs A
 *    (5 250 pieces) and B (25 pieces) of 5,000, their pace, hold and behaviour, which PACE check each proves, the host's
 *    conditions (the day before, a line at the start and at the end, steps of 1,000, one test at a time, the four STOP
 *    thresholds, the sizes after); run A public forever as the owner's choice; one command per shell block, links that
 *    resolve, and the runbook linked from DEPLOYMENT and COMPLIANCE.
 *
 * <SHA_Q1> and <TAG_Q1> stay placeholders until the main session hands the commit over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { LIVE_HOLD_MINUTES } from '../../src/server/db/schema.js';
import { HASHED_ASSET_RE } from '../../src/server/http/static.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { closeGuardLine, LIVE_HOLD_LABEL } from '../../src/web/admin/model/live.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { TERMS } from '../../src/web/legal/content/terms.js';
import { ACCOUNT, HOW, LIVE, MODE, SOUND } from '../../src/web/verify/copy.js';
import { LIVE_SOUNDS } from '../../src/web/verify/live-sound.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-OQ-Q1.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Production before lot Q1: MACRO M3, deployed on 2026-10-23 (its image, and the one before it, M2's). */
const M3_SHA = '33e843081148caf6c0d42ff98047a678a27e7708';
const M3_TAG = '33e843081148';
const M2_TAG = '946cc1706039';
/** The legal version of lot Q1 (step Q1.12), and the ORBES CARE conditions', unchanged since ORBES CARE. */
const Q1_LEGAL_VERSION = '2026-10-24';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
/** Lot M3's newest migration, and lot Q1's one (plan Q1 §1.1). */
const M3_LAST = '0057_sets';
const Q1_NAMES = ['0058_one_queue'];
const DEPLOY = NAMES.slice(NAMES.indexOf(M3_LAST) + 1).filter((n) => Q1_NAMES.includes(n));
const BEFORE = NAMES.slice(0, NAMES.indexOf(M3_LAST) + 1);
const AFTER = [...BEFORE, ...DEPLOY];
/** M3's own migrations, as M3's runbook and its deployment log name them. */
const M3_DEPLOY = NAMES.filter((n) => ['0054', '0055', '0056', '0057'].includes(n.slice(0, 4)));

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
  ['migration 0058_one_queue cannot be applied: ', 'genome/src/server/db/migrations/0058_one_queue.ts'],
  [' open LIVE releases have no pace', 'genome/src/server/db/migrations/0058_one_queue.ts'],
];

/** A read-only query of the box, as the runbook writes it. */
const psql = (query: string) => `docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "${query}"'`;

/** 0058's own refusal, read without a string literal: a LIVE release is the one with its room's minutes (0021). */
const UNPACED = 'room_opens_minutes is not null and parent_drop_id is null and pace_batch is null and ended_at is null and cancelled_at is null';
const ROOM_SOON = 'room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()';

/** The text block of the runbook whose first line starts with `first`, as lines. */
function block(first: string): string[] {
  const found = outputs.find((o) => o.startsWith(first));
  if (!found) throw new Error(`no text block starting with "${first}"`);
  return found.split('\n');
}

/** git in the repository, or null where its history does not hold M3's commit (genome-ci's shallow checkout). */
function git(args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${M3_SHA}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    return null;
  }
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

/** A string quoted as the runbook writes a word of the console (`…`) or a sentence (« … »). */
const word = (w: string) => `\`${w}\``;
const said = (s: string) => `« ${s} »`;
const source = (rel: string) => readDoc(`genome/src/${rel}`);

/** The runbook's text with every bracketed aside taken out, innermost first. */
function outsideBrackets(md: string): string {
  let out = md;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, '');
  }
  return out;
}

describe('the runbook of lot ONE QUEUE (docs/launch/DEPLOY-OQ-Q1.md)', () => {
  it('starts from lot M3 in production and applies exactly 0058_one_queue, as the scripts print it, every count from MIGRATIONS', () => {
    expect(DEPLOY).toEqual(Q1_NAMES);
    // Q1's migration follows M3's at once; a later lot's (Q2, Q3, then M4 renumbered) only ever comes after it.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_Q1>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row for the migration, and the columns it names, as the migration adds them.
    const changes = section(runbook, '### 1.0');
    expect([...changes.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1])).toEqual(DEPLOY);
    const migration = readDoc('genome/src/server/db/migrations/0058_one_queue.ts');
    for (const c of ['pace_hold_minutes', 'pace_extra_batches']) {
      expect(migration, c).toContain(`ALTER TABLE drops ADD COLUMN ${c}`);
      expect(changes, c).toContain(`\`${c}\``);
    }
    expect(changes).toContain(`(\`pace_hold_minutes\`, ${LIVE_HOLD_MINUTES.min} à ${LIVE_HOLD_MINUTES.max}, 0 partout)`);
    expect(migration).not.toMatch(/\bINSERT INTO\b/);
    expect(runbook).toContain('| ONE QUEUE (lot Q1) |');
    expect(section(runbook, '### 1.0')).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    // The file the commit adds under migrations since M3, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${M3_SHA} HEAD -- genome/src/server/db/migrations`);
    const added = git(['diff', '--name-status', M3_SHA, '--', 'genome/src/server/db/migrations']);
    if (added !== null) {
      const prefix = 'A\tgenome/src/server/db/migrations/';
      const lines = added.trim().split('\n');
      expect(lines.slice(0, DEPLOY.length)).toEqual(DEPLOY.map((n) => `${prefix}${n}.ts`));
      expect(lines.slice(DEPLOY.length).every((l) => l.startsWith(prefix) && l.slice(prefix.length) > `${DEPLOY.at(-1)}.ts`)).toBe(true);
    }
    // db.ts migrate, then deploy.sh's end and its log line.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`**Il faut lire \`Applied ${DEPLOY.length} migration(s)\`.**`);
    expect(runbook).toContain(`previous image tag: ${M3_TAG}`);
    expect(runbook).toContain(`(previous: ${M3_TAG}). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      `orbes-genome:${M3_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${M3_TAG} refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_Q1> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).`,
    );
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_Q1> OK (previous ${M3_TAG}; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // M3 as the last deployment: its log line exactly as M3's runbook expects it, with M3's and M2's images.
    const m3Line = `deploy ${M3_TAG} OK (previous ${M2_TAG}; migrations ${M3_DEPLOY.join(', ')})`;
    expect(runbook).toContain(`\`… ${m3Line}\``);
    expect(readDoc('docs/launch/DEPLOY-MACRO-M3.md')).toContain(`deploy <TAG_M3> OK (previous <TAG_M2>; migrations ${M3_DEPLOY.join(', ')})`);
    expect(M3_SHA.slice(0, 12)).toBe(M3_TAG);
    expect(runbook).toContain(`Sortie attendue : \`${M3_SHA}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${M3_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${M3_SHA.slice(0, 7)}..<7 caractères de SHA_Q1>\``);
    expect(runbook).toContain("**Q1 ne part qu'après M3**");
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain(`Si la dernière ligne OK de \`.state/deploys.log\` nomme une autre image que \`${M3_TAG}\``);
    // M3's commit is the base of this lot: the build branch starts from it (a full clone only).
    const base = git(['merge-base', '--is-ancestor', M3_SHA, 'HEAD']);
    if (base !== null) expect(base).toBe('');
  });

  it('expects from the scripts, the migration and the app only messages they print, and a rollback only before the migration', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('FORWARD="If anything goes wrong, repair forward: scripts/deploy.sh --image $TAG after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7)."');
    expect(readDoc('deploy/vps/scripts/deploy.sh')).toContain('CADDY_CONFIG_HASH="$(cat "$STACK_DIR/Caddyfile"');
    expect(section(runbook, '### 1.4')).toContain("Caddy garde son conteneur, sa configuration n'ayant pas changé.");
    const trouble = section(runbook, '### 1.5');
    expect(trouble).toContain("Le retour en arrière n'existe qu'**avant** la migration ; après, on répare en avant.");
    expect(trouble).toContain(`\`── rollback to orbes-genome:${M3_TAG}\` et \`rolled back to ${M3_TAG}; the stack is healthy\``);
    expect(trouble).toContain('`WARNING: deployment of <TAG_Q1> failed (…) and is KEPT`');
    expect(trouble).toContain(`**jamais \`scripts/deploy.sh --image ${M3_TAG}\`**`);
    // 0058's refusals: up while an open LIVE release has no pace (D56), down while a hold exists.
    expect(trouble).toContain('`migration 0058_one_queue cannot be applied: <n> open LIVE releases have no pace`');
    const migration = readDoc('genome/src/server/db/migrations/0058_one_queue.ts');
    expect(migration).toContain("RAISE EXCEPTION 'migration 0058_one_queue cannot be rolled back: % releases with a hold after the opening exist'");
    expect(trouble).toContain("son `down` refuse dès qu'une sortie a une attente après l'ouverture");
  });

  it('holds the owner’s rules: the review board, every time in Paris first, no LIVE release running, the pre-checks, nothing on the host changes, the legal version', () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur le tableau de revue d'abord.**");
    // Paris first, UTC in brackets: DEPLOY-MACRO-M3's rule 2 word for word, and the expected output of `date -u`.
    const night = "**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)";
    const hub = "03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)";
    for (const line of [night, hub]) {
      expect(rules, line).toContain(line);
      expect(section(readDoc('docs/launch/DEPLOY-MACRO-M3.md'), '## 0.'), line).toContain(line);
    }
    expect(runbook.replace(/\*\*/g, '')).toContain("05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite (03:00–05:30 UTC)");
    expect(runbook).toContain('03:00–03:10 et 03:45–03:55 à Paris');
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche)");
    // Every UTC time sits in brackets after its Paris time; every clock time outside brackets is a Paris one.
    const bare = outsideBrackets(runbook);
    expect(bare).not.toMatch(/\d{2}:\d{2}[^\n]{0,12}UTC/);
    expect(bare).not.toMatch(/UTC[^\n]{0,4}\d{2}:\d{2}/);
    for (const m of runbook.matchAll(/<heure>[^\n(]{0,30}\(<heure>[^)]*UTC\)/g)) expect(m[0]).toMatch(/Paris/);
    // Rule 3: no LIVE release between its room's opening and its end, read before the launch and again just before it.
    expect(rules).toContain("**Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.**");
    const before = section(runbook, '### 1.1');
    expect(fenced(before, 'bash')).toEqual(expect.arrayContaining([psql(`select count(*) from drops where ${UNPACED}`), psql(`select count(*) from drops where ${ROOM_SOON}`)]));
    expect(fenced(section(runbook, '### 1.4'), 'bash')[0]).toBe(psql(`select count(*) from drops where ${ROOM_SOON}`));
    // The pre-check reads 0058's own condition (D56), a LIVE release told by its room's minutes, which 0021 sets on a
    // LIVE release only (drops_live_fields) and on a draw never (drops_draw_fields, kept so by 0024).
    const up = readDoc('genome/src/server/db/migrations/0058_one_queue.ts');
    expect(up).toContain("WHERE mode = 'LIVE' AND parent_drop_id IS NULL AND pace_batch IS NULL AND ended_at IS NULL AND cancelled_at IS NULL;");
    const m0021 = readDoc('genome/src/server/db/migrations/0021_live_release.ts');
    expect(m0021).toContain("const LIVE_SETTINGS = ['live_min_tier', 'tier_priority', 'room_opens_minutes',");
    expect(m0021).toContain("ADD CONSTRAINT drops_live_fields CHECK (mode = 'DRAW' OR (${LIVE_SETTINGS.map((c) => `${c} IS NOT NULL`)");
    expect(m0021).toContain("const MODES = `'DRAW','LIVE'`;");
    expect(readDoc('genome/src/server/db/migrations/0024_model_variants.ts')).toContain('const DRAW_FIELDS_0024 = drawFields([...LIVE_SETTINGS_0021, ...LIVE_ONLY_0021].filter((c) => !DRAW_PRICE.includes(c)));');
    expect(readDoc('genome/src/server/db/migrations/0024_model_variants.ts')).toMatch(/const DRAW_PRICE = \['price_minor', 'currency'\]/);
    expect(before).toContain('Sortie attendue : `0`. Un autre nombre : une LIVE RELEASE (un brouillon compris) a été créée sans rythme.');
    for (const q of commands.filter((c) => c.includes('psql'))) {
      expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop table|truncate)\b/i);
      // A string literal would end the shell's single quotes.
      expect(q.slice(q.indexOf('-Atc "'), q.lastIndexOf('"')), q).not.toContain("'");
    }
    // The review board (OP-12, D12): the console's names kept, as the console writes them, and N14's line.
    const board = section(runbook, '### 1.1');
    const views = source('web/admin/views/live.ts');
    const model = source('web/admin/model/live.ts');
    expect(views).toContain("label: s === 'QUEUED' ? 'Waiting in the queue' : humanize(s)");
    expect(board).toContain('le filtre `Waiting in the queue` de la ligne (le statut `Waiting` garde son nom)');
    for (const b of ["button('Shorten the hold'", "button('End the hold now'"]) expect(views, b).toContain(b);
    expect(board).toContain('`Shorten the hold` et `End the hold now`');
    expect(model).toContain("{ label: 'In line', value: formatCount(t.line)");
    expect(model).toContain("{ label: 'Admitted', value: formatCount(p.admitted), note: 'GIVEN A TURN, ALL WAYS'");
    expect(board).toContain('`In line` en haut du tableau, `Admitted` dans le bloc `Pace` (« GIVEN A TURN, ALL WAYS »)');
    expect(source('web/admin/model/live-intelligence.ts')).toContain("return 'No sales rate yet';");
    expect(board).toContain('`No sales rate yet`');
    expect(board).toContain(
      "« L'attente après l'ouverture (Hold after the opening) se règle jusqu'à l'annonce, comme tout réglage ; après l'annonce, seulement SHORTEN THE HOLD ou END THE HOLD NOW, jamais plus longue »",
    );
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768']) expect(board, what).toContain(what);
    // Client Services told before: the playbook's queue section, in both copies.
    expect(board).toContain('§2 « Une LIVE RELEASE à son rythme : la file d\'attente »');
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      expect(section(readDoc(copy), '## 2.'), copy).toContain("### Une LIVE RELEASE à son rythme : la file d'attente");
    }
    // No slot booked: the three conditions, the heads-up at launch in Paris then UTC.
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("le diff de `deploy/vps` vide après l'avance rapide");
    expect(section(runbook, '### 1.4')).toContain(
      "**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement ONE QUEUE lancé à <heure> Paris (<heure> UTC), une migration, rien ne change sur l'hôte. »",
    );
    // Nothing on the host changes: the deploy/vps diff against M3 in production is empty, no .env line.
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${M3_SHA} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('-- deploy/vps\n```\n\nSortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.');
    const diff = git(['diff', '--name-status', M3_SHA, '--', 'deploy/vps']);
    const log = git(['log', '--no-merges', '--format=%H %s', `${M3_SHA}..HEAD`, '--', 'deploy/vps']);
    if (diff !== null && log !== null) {
      expect(log.trim().split('\n').filter((l) => / OQ-Q1\./.test(l))).toEqual([]);
      if (!log.trim()) expect(diff.trim()).toBe('');
    }
    expect(section(runbook, '### 1.2')).toContain("Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n'y touches pas.");
    // No secret: .env is only ever read for two lines, and never shown whole.
    for (const c of commands.filter((x) => x.includes('.env'))) expect(["grep '^ORBES_IMAGE_TAG=' .env", "grep -n '^RESTORE_ALLOWED=' .env"]).toContain(c);
    expect(commands.filter((c) => /\bcat\b|printenv|(?:^|\s)env(?! \|)/.test(c))).toEqual([]);
    expect(rules).toContain('**Les secrets ne se collent jamais dans une conversation.**');
    // The guarded launch, restore.sh only to watch it refuse, no prune.
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(commands.filter((c) => /docker image rm/.test(c))).toEqual([]);
    expect(rules).toContain('la branche `orbes-one-queue` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The legal pages: one new version, the code's; the ORBES CARE conditions keep theirs; counsel never holds the deploy.
    // A later lot (Q2, Q3, M4) may move LEGAL_VERSION past it; Q1's head publishes Q1's.
    expect(LEGAL_VERSION >= Q1_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${Q1_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${Q1_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(source('web/legal/content/index.ts')).toContain(`${Q1_LEGAL_VERSION} is the version of lot Q1, ONE QUEUE`);
  });

  it('checks the box after the migration, read only, the eleven sounds served as hashed /assets/*.mp3, the legal version, and tells the host with the swap', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([psql(`select (select count(*) from drops where pace_hold_minutes <> 0), (select count(*) from drops where pace_extra_batches <> 0), (select count(*) from drops where ${UNPACED})`)]);
    expect(after).toContain('Sortie attendue : `0|0|0`.');
    // The box's figures before and after, the swap line read; the host told at launch and after, swap included.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(after).toContain("**Préviens le responsable de l'hôte** : « ONE QUEUE fait à <heure> Paris (<heure> UTC), une migration, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »");
    // The console: New live release asks the pace and the hold, in the code's words.
    const views = source('web/admin/views/live.ts');
    for (const l of ["label: 'People per batch'", "label: 'Every (minutes)'", "label: figureLabel(LIVE_HOLD_LABEL)"]) expect(views, l).toContain(l);
    expect(LIVE_HOLD_LABEL).toBe('Hold after the opening (minutes, 0 = none)');
    expect(views).toContain('hint: `Up to ${LIVE_LIMITS.hold.max}: everyone waits it before the first batch.`');
    expect(after).toContain(`\`People per batch\`, \`Every (minutes)\` et \`${LIVE_HOLD_LABEL}\` (« Up to ${LIVE_HOLD_MINUTES.max}: everyone waits it before the first batch. »)`);
    // From the Mac: health, the app, the eleven sounds and the legal version.
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/health');
    expect(after).toContain('Sortie attendue : `{"ok":true,"version":"0.1.0"}`.');
    const sounds = commands.find((c) => c.includes('.mp3'));
    expect(sounds).toBe(
      'for u in $(curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/verify | grep -o \'/assets/verify-[A-Z0-9]*\\.js\' | head -1)" | grep -o \'/assets/[a-z-]*-[A-Z0-9]\\{8\\}\\.mp3\' | sort -u); do curl -s -o /dev/null -w "%{http_code} $u\\n" "https://verify.theorbes.com$u"; done',
    );
    const lines = block('200 /assets/');
    expect(lines).toEqual([...LIVE_SOUNDS].sort().map((n) => `200 /assets/${n}-<8 caractères>.mp3`));
    expect(lines).toHaveLength(11);
    expect(after).toContain('exactement onze lignes');
    // The names the build publishes: <name>-<8 capitals or digits>.mp3, a hashed asset, which the grep reads.
    expect(HASHED_ASSET_RE.test('/assets/welcome-6IFZAJY7.mp3')).toBe(true);
    expect(readDoc('genome/scripts/build-web.ts')).toContain("'.mp3': 'file'");
    expect(readDoc('genome/src/server/http/static.ts')).toContain("app.get('/legal', legal);");
    expect(commands).toContain(
      `curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\\.js' | head -1)" | grep -o '${Q1_LEGAL_VERSION}' | head -n 1`,
    );
    expect(after).toContain(`Sortie attendue : \`${Q1_LEGAL_VERSION}\`.`);
  });

  it('checks each element for real, phone and computer, dark and light, in the console’s and the app’s words', () => {
    const checks = section(runbook, '#### 1.');
    const views = source('web/admin/views/live.ts');
    const model = source('web/admin/model/live.ts');
    // Two collectors, A on the phone and B on a computer; SOUND on.
    expect(section(runbook, '### 1.7')).toContain('**A** sur ton téléphone (Safari), **B** sur ton ordinateur, dans une fenêtre de navigation privée');
    expect(section(runbook, '### 1.7')).toContain(`${SOUND.label} reste ${SOUND.on} au pied de la page`);
    // The test release: pace and hold, two sizes of one piece, the after-room, Access to the test model's owners.
    expect(checks).toContain(`\`People per batch\` \`1\`, \`Every (minutes)\` \`2\`, \`${LIVE_HOLD_LABEL}\` \`10\``);
    expect(checks).toContain('`Sizes` deux lignes, `52 = 1` et `54 = 1`');
    for (const l of ["'An after-room after a sell-out'", "'Opens (minutes after the sell-out)'", "'Open (minutes)'", "'Room opens (minutes before)'", "'Times (UTC)'", "label: `Owners of ${humanize(m.name)}`"]) {
      expect(views, l).toContain(l);
    }
    expect(views).toContain("note: r.editable ? 'Everyone waits it, guarantees included' : 'Once announced: only shortened or ended, on the live board'");
    expect(checks).toContain('« Once announced: only shortened or ended, on the live board » (la ligne N14 du tableau de revue)');
    // The room, the draw and the opening, in the app's words.
    expect(checks).toContain(`${LIVE.enter}, la taille \`52\`, ${LIVE.ready.title}`);
    expect(checks).toContain(`${LIVE.untilOpening} et ${said(LIVE.inRoom(2))}`);
    expect(checks).toContain(`puis ${LIVE.youreReady}`);
    expect(checks).toContain(`active ${MODE.label} (${ACCOUNT.title}, sous ${SOUND.label}) : la salle reste sombre`);
    expect(checks).toContain(`à 00:00, ${LIVE.drawing} et sa phrase`);
    // The queue: its words, never the pace.
    expect(checks).toContain(`${LIVE.phase.LIVE} ; ${LIVE.choice('52', 1)} ; ${LIVE.yourPlace} 1 sur l'un, 2 sur l'autre ; ${LIVE.queue.timeLeft(10 * 60_000)} environ`);
    expect(checks).toContain(`la bande Horizon ; la note ; ${LIVE.queue.leave}`);
    // The board's figures, the pauses, the hold shortened and ended, in the console's words.
    for (const f of ["label: 'In the queue'", "label: 'Turns given'", "label: 'Batches'", "label: 'Hold ends'", "label: 'Next batch'"]) expect(model, f).toContain(f);
    expect(checks).toContain('`In the queue` 2, `Turns given` 0, `Batches` 0, `Hold ends` à T0 + 10 minutes, à l\'heure de Paris');
    expect(checks).toContain(`${said(LIVE.paused)} et sa phrase au-dessus du temps, figé`);
    expect(views).toContain("statusMark('PACE PAUSED', 'alert')");
    expect(checks).toContain(`« PACE PAUSED », \`Next batch\` lit \`—\` ; sur les téléphones, ${LIVE.queue.paused} et ${said(LIVE.queue.pausedLine)}`);
    for (const w of ["button('Pause'", "button('Resume'", "button('Pause pace'", "button('Resume pace'", "label: 'New length (minutes)'", "done('Hold shortened.')", "confirmLabel: 'End the hold'", "done('Hold ended.')"]) {
      expect(views, w).toContain(w);
    }
    expect(checks).toContain('`Shorten the hold`, `New length (minutes)` `8`, `Shorten the hold` | « Hold shortened. »');
    // Too late to shorten: the server's refusal, and END THE HOLD NOW instead.
    expect(source('server/services/live.ts')).toContain("validationError('A shortened hold ends later than now: END THE HOLD NOW starts the turns at once.')");
    expect(checks).toContain('Fais-le avant T0 + 8 minutes : si le dialogue le refuse (« A shortened hold ends later than now: END THE HOLD NOW starts the turns at once. »), passe directement à END THE HOLD NOW |');
    expect(checks).toContain('`End the hold now`, `End the hold` | « Hold ended. »');
    // The turn, HOLD, SECURED and PAY; a held piece is not SOLD OUT (D26); NEXT BATCH NOW refused in the server's words.
    expect(checks).toContain(`${LIVE.yourTurn}, ${LIVE.pressHold}`);
    expect(checks).toContain(`${LIVE.holding}, l'anneau fin qui se remplit`);
    expect(checks).toContain(`puis ${LIVE.secured}, ${LIVE.yourPiece} sur son horizon`);
    expect(LIVE.pay('€ 1', '04:52')).toBe('PAY € 1 · 04:52');
    expect(checks).toContain(`(${said(LIVE.pay('€ 1', '04:52'))} par exemple)`);
    expect(checks).toContain(`la bande lit ${said(LIVE.inSize(0, '52'))} ; jamais SOLD OUT tant que la pièce n'est pas payée`);
    expect(source('server/services/live.ts')).toContain("conflict('LIVE_NOTHING_FREE', 'No piece is free for anyone waiting.')");
    expect(views).toContain("confirmLabel: 'Give the batch'");
    expect(checks).toContain('`Next batch now`, `Give the batch` | Le dialogue reste ouvert et dit « No piece is free for anyone waiting. »');
    // CONFIRMED, then SOLD OUT for the second's size, in its one sentence.
    expect(checks).toContain(`${LIVE.confirmed}, LIVE RELEASE au-dessus du nom, le monogramme seul sur son horizon`);
    expect(checks).toContain(`${LIVE.edge.soldOut.title} seul en titre, ${said(LIVE.edge.soldOut.text)}, ${LIVE.edge.soldOut.leave} juste dessous`);
    // A returned piece waits for the next batch: two test entrants in 54, the first gives its piece back.
    const tests = source('web/admin/views/test-entrants.ts');
    for (const w of ["'Behaviour · RELEASE MY PLACE (%)'", "'Behaviour · PAY (%)'", "label: 'Choices · size'", "label: 'Arrival'", "{ value: 'all', label: 'All at once' }", "button('Send test entrants'", "button('Add more'"]) {
      expect(tests + source('web/admin/model/test-entrants.ts'), w).toContain(w);
    }
    expect(checks).toContain('`Choices · size` `54`, `Behaviour · RELEASE MY PLACE (%)` `100`');
    expect(checks).toContain('le second ne l\'a **pas aussitôt** : son `Admitted` lit le lot d\'après');
    expect(model).toContain("text: e.batch ? `Batch ${formatCount(e.batch)}` : 'At once'");
    // The sell-out, the after-room door and its line, without a time; RELEASE MY PLACE.
    expect(checks).toContain(`${LIVE.edge.ended.SOLD_OUT.title}, ${said(LIVE.edge.ended.SOLD_OUT.text)}`);
    expect(checks).toContain(`${LIVE.afterRoom.kind}, ${LIVE.afterRoom.title}, ${LIVE.afterRoom.enter}`);
    expect(checks).toContain(`${LIVE.release} et TAP AGAIN TO RELEASE (ou CLICK AGAIN TO RELEASE sur l'ordinateur) : ${LIVE.edge.released.title}`);
    expect(source('web/verify/copy.ts')).toContain("return forDevice('TAP AGAIN TO RELEASE', 'CLICK AGAIN TO RELEASE');");
    // The report's added rows.
    const intelligence = source('web/admin/model/live-intelligence.ts');
    for (const r of ["['Longest wait'", "['Turns given', formatCount(q.turnsByPace), 'BY THE PACE'", "['Left the queue'"]) expect(intelligence, r).toContain(r);
    expect(checks).toContain('Le rapport gagne `Longest wait`, `Turns given` (« BY THE PACE ») et `Left the queue`');
    // The clean-up: END TEST, the 1 € order cancelled.
    const order = source('web/admin/views/order.ts');
    for (const w of ["button('Cancel'", "title: 'Cancel the order'", "confirmLabel: 'Cancel the order'", "done('Order cancelled.')"]) expect(order, w).toContain(w);
    expect(checks).toContain('`Cancel`, la boîte « Cancel the order », `Note` `Test`, puis `Cancel the order` : « Order cancelled. »');
    // HOW RELEASES WORK's THE PACE, and the legal pages: the version line and article 13's two paragraphs.
    expect(checks).toContain(`${HOW.title}, sous ${HOW.order.title}, le paragraphe ${HOW.order.pace.term} (${said(HOW.order.pace.text)})`);
    expect(checks).toContain(said(WORDS.en.version(Q1_LEGAL_VERSION)));
    const terms = JSON.stringify(TERMS.en);
    for (const p of ['The pace.', 'A piece that returns.']) {
      expect(terms, p).toContain(`**${p}**`);
      expect(checks, p).toContain(said(p));
    }
  });

  it('runs TEST ENTRANTS A (5 250 pieces) and B (25 pieces) of 5,000 within the host’s conditions, each proving its PACE check', () => {
    const runs = section(runbook, '#### 2.');
    // Both checks of D14, one run each, one test at a time; M1's recipe no longer applies.
    expect(runs).toContain('**un test à la fois**');
    expect(runs).toContain('**Le test A : plus de pièces que d\'entrants** (il prouve « exactly X turns every Y, hold respected »)');
    expect(runs).toContain("**Le test B : moins de pièces que d'entrants** (il prouve « at most X per batch, in order, nobody eligible left waiting while a piece of their size was free »)");
    // The stocks, the pace, the hold, the close, the behaviour.
    expect(runs).toContain('`Sizes` `ONE SIZE = 5250`');
    expect(runs).toContain('`Sizes` `ONE SIZE = 25`');
    expect(runs).toContain(`\`People per batch\` \`250\`, \`Every (minutes)\` \`1\`, \`${LIVE_HOLD_LABEL}\` \`2\``);
    expect(runs.match(/`End of the sales \(UTC\)` T0 \+ 30 minutes/g)).toHaveLength(2);
    expect(runs).toContain('`Behaviour · PAY (%)` `0`, `Behaviour · RELEASE MY PLACE (%)` `100`, `Behaviour · miss the turn (%)` `0`, `Behaviour · LEAVE (%)` `0`');
    expect(runs).toContain('`Behaviour · PAY (%)` `0`, `Behaviour · RELEASE MY PLACE (%)` `70`, `Behaviour · miss the turn (%)` `30`, `Behaviour · LEAVE (%)` `0`');
    const tests = source('web/admin/views/test-entrants.ts');
    for (const l of ["'Behaviour · PAY (%)'", "'Behaviour · RELEASE MY PLACE (%)'", "'Behaviour · miss the turn (%)'", "'Behaviour · LEAVE (%)'", 'label: `Test entrants · ${x.label}`', "button('End test'", "'Past tests'", "button('Report'", "button('Stop'"]) {
      expect(tests, l).toContain(l);
    }
    // Five steps of 1,000, all before T0; the pool of 5,000 freed by END TEST between the tests.
    expect(runs).toContain('**5 000 entrants d\'essai** en cinq paliers de 1 000, tous avant T0');
    expect(source('server/services/test-entrants.ts')).toContain('export const TEST_POOL_MAX = 5000;');
    expect(section(runbook, '#### 1.')).toContain('ils comptent pour les 5 000 des tests qui suivent');
    // What the board and the phone show now.
    expect(runs).toContain('`Turns given` monte de 250, `Batches` de 1, `In the queue` baisse de 250 ; vingt lots');
    expect(runs).toContain('`Hold ends` et `Next batch` lisent T0 + 2 minutes, à l\'heure de Paris');
    expect(runs).toContain('la colonne `Admitted` lit `Batch 1`, `Batch 2`…');
    expect(runs).toContain('`Beyond the pieces` lit près de 4 975');
    expect(closeGuardLine(120, false)).toBe('AT THIS PACE, 120 PIECES REMAIN AT THE CLOSE');
    expect(runs).toContain('`AT THIS PACE, … AT THE CLOSE`');
    expect(runs).toContain(`${LIVE.phase.LIVE}, ${LIVE.yourPlace} (ta place dans ONE SIZE, un peu plus de 5 000), ${LIVE.queue.timeLeft(21 * 60_000)} environ`);
    expect(runs).toContain(`${LIVE.queue.leave} et TAP AGAIN TO LEAVE`);
    expect(runs).toContain('Jamais un lot, un rythme ni la longueur de la file.');
    // The PACE line of run A, as the report writes it.
    const report = source('server/services/test-entrants.ts');
    expect(report).toContain("const paceWords = (p: PaceOf): string => `${p.batch} every ${p.minutes} min`;");
    expect(report).toContain("`${count(recorded, 'batch', 'batches')} gave ${count(turns, 'turn')} at ${set}${from}, each on its time and in the line’s order; none gave more than the pace, ` +");
    expect(report).toContain("`and none left anyone waiting while a piece of their size was free");
    expect(report).toContain("{ id: 'PACE', label: 'The pace', pass: false, line }");
    expect(runs).toContain(
      '« 20 batches gave 5000 turns at 250 every 1 min, the first on the pace at <T0 + 2 min> PARIS, each on its time and in the line’s order; none gave more than the pace, and none left anyone waiting while a piece of their size was free. »',
    );
    // The host's conditions: daytime, the day before, a line at the start and at the end, steps of 1,000, the window.
    expect(runs).toContain('**De jour seulement**, jamais dans 01:30–04:10 à Paris (23:30–02:10 UTC), fenêtre sans test de charge de l\'hôte, en vigueur jusqu\'au 25 octobre 2026');
    expect(runs).toContain('**La veille**, préviens le responsable de l\'hôte');
    expect(runs).toContain('**Une ligne au début**');
    expect(runs).toContain('**et une à la fin**');
    expect(runs).toContain('**Par paliers de 1 000**, un test à la fois.');
    // The four STOP thresholds, and STOP itself.
    for (const t of ['la mémoire disponible de la machine sous 800 MiB', 'le swap qui monte', 'au-dessus de 1,8 pendant plus d\'une minute', 'une sonde d\'ENTITY qui tombe, ou plus de 3 fois plus lente que d\'habitude']) {
      expect(runs, t).toContain(t);
    }
    expect(runs).toContain('STOP, c\'est : `Stop` (dans `Test entrants`, ou dans le panneau `Server`), puis `End test`, et tu le dis à Claude.');
    expect(source('web/admin/views/server-status.ts')).toContain('THE SERVER IS STRAINED');
    expect(fenced(runs, 'bash')).toEqual(expect.arrayContaining(['free -m', 'uptime']));
    // The sizes after: the database and the night's dump (20 MB).
    expect(fenced(runs, 'bash')).toEqual(expect.arrayContaining([psql('select pg_size_pretty(pg_database_size(current_database()))'), 'ls -lt /var/backups/orbes/daily/ | head -n 4']));
    expect(runs).toContain('une sauvegarde au-dessus de 20 MB');
    // Run A's release is public forever: the owner's choice (§2).
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3]);
    expect(open).toContain('**La sortie du test A est publique pour toujours**');
    expect(open).toContain('« 5 250 PIECES »');
    expect(open).toContain('« 25 PIECES »');
    expect(open).toContain('(la note au juriste, point 29)');
    // The console's REMOVE says the next-batch rule (D5): no longer a question for the owner.
    expect(open).not.toContain('REMOVE');
    expect(source('web/admin/views/live.ts')).toContain('the piece it holds returns and is offered at the next batch. Its screen says it was removed.');
    expect(readDoc('docs/legal/counsel-note.fr.md')).toContain('29. **Le rythme d\'une LIVE RELEASE** (CGU article 13 ; R165, R106 ; lot M1, version 2026-10-21 ; lot Q1, ONE QUEUE, version 2026-10-24)');
  });

  it('gives one command per shell block, in French, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(35);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(commands).toContain('docker compose exec app node --import tsx scripts/db.ts status');
    // In French, for the owner, as the house's runbooks.
    expect(runbook.startsWith('# Mise en production du lot ONE QUEUE (Q1)\n\nCe document est pour toi, le propriétaire.')).toBe(true);
    expect(runbook.match(/Sortie attendue/g)!.length).toBeGreaterThan(25);
    for (const h of ['## 0. Les règles', '## 1. Le déploiement', '### 1.0 Ce qui change', '### 1.4 Déployer', '### 1.5 Si quelque chose ne va pas', '### 1.6 Juste après : contrôles de base', '### 1.7 Une vérification réelle par élément', '### 1.8 Ensuite', '## 2. Ce qui reste à ta décision (sans bloquer)']) {
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
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('[DEPLOY-OQ-Q1](launch/DEPLOY-OQ-Q1.md)');
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 13.');
    expect(compliance).toContain('(launch/DEPLOY-OQ-Q1.md)');
    expect(compliance).toContain('(la note au juriste, point 29)');
    // Never the words the brand keeps out of what it says, nor a piece's name, material or price in public.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
  });
});
