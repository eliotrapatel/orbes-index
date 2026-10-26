/**
 * docs/launch/DEPLOY-OQ-Q3.md, the owner's runbook for lot Q3, THE VAULT (plan Q3 §9, step Q3.16), against the scripts,
 * the migrations, the server, the console and the app it quotes:
 *
 *  - it starts from production as lot Q2 left it (5e0518f, image 5e0518fe53cd, deployed on 25 October 2026, 0001 to
 *    0060) and applies exactly 0061_the_vault and 0062_vault_rewards, as the scripts print them, each count and name
 *    derived from MIGRATIONS; Q2's image no longer runs on the schema after them, so a failure after them is repaired
 *    forward, and the downs refuse once vault data exists;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts, the migrations and the app is still
 *    one they print;
 *  - the owner's rules (memory deploy-wait-for-host-ok, times-in-paris): the review board first, every time in Paris
 *    first with UTC in brackets (winter time since 25 October), no LIVE release between its room's opening and its end,
 *    no TEST ENTRANTS test running, no slot booked and the one-line heads-up at launch, the box's figures before and
 *    after with the swap line, the guarded launch, nothing on the host changes (deploy/vps untouched since Q2, no .env
 *    line: the credits to give's key derives from COOKIE_SECRET), the legal pages' new version (D59), restore.sh only
 *    ever run to watch it refuse, no prune;
 *  - the post-check: 63 `applied` lines, what 0061 wrote read only (the seven sources at OP-29's defaults, the floor
 *    alone, the tiers held before), the sixteen sounds served as hashed /assets/*.mp3, the legal version in the
 *    published bundle, the Documents' THE VAULT CARD and its two PDFs, the host told with the swap;
 *  - one real check per element, in the console's and the app's words as the code has them: the table and the sources
 *    read, GIVE A VAULT to his own account, NOW's line, the quiet number, the FROM ORBES arrival, THE VAULT page, a € 1
 *    credit at 1 IN 1 opened on the phone (sound, vibration) then deactivated, an opening on the computer in light
 *    mode, a test LIVE release with its switch on and a size sold out, a piece registered, the checklist's THE VAULT
 *    CARD, the A4 sheet printed, the legal pages, the ENGRAVING's ADMIN-only prices (the 25 Oct amendment);
 *  - his data after (the real table, the sources' limits with the LIVE cap above one only once the terms change, N22,
 *    the switch per LIVE release), the open questions (N4, N7, N9, N36, D70, N8, the tier, the export, the VAULT
 *    EDITION's line, counsel), M4 after Q3 (D61); one command per shell block, French, links that resolve, and the
 *    runbook linked from DEPLOYMENT and COMPLIANCE.
 *
 * <SHA_Q3> and <TAG_Q3> stay placeholders until the main session hands the commit over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { VAULT_CAP, VAULT_PER_OCCASION, VAULT_SOURCES, VAULT_WAIT_DAYS } from '../../src/server/db/schema.js';
import { HASHED_ASSET_RE } from '../../src/server/http/static.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { DOCUMENT_ASSETS, STAFF_DOCUMENTS } from '../../src/server/routes/admin/documents.js';
import { VAULT_ARRIVED_TITLE, VAULT_REVEAL, VAULT_SOURCE_LABELS, vaultArrivedWords, vaultMoney, vaultOpenedWords } from '../../src/shared/house-words.js';
import { ENGRAVING_ADMIN_ONLY } from '../../src/web/admin/model/addons.js';
import type { VaultGiven } from '../../src/web/admin/types.js';
import { CLUB_TABS } from '../../src/web/admin/model/club.js';
import { LIVE_HOLD_LABEL } from '../../src/web/admin/model/live.js';
import {
  capText,
  givenText,
  LIVE_VAULT,
  liveVaultReportFigures,
  NEW_REWARD_KINDS,
  oddsSumLine,
  reachLines,
  rewardWhat,
  sourceDefaultText,
  VAULT_COPY,
  VAULT_KIND_LABELS,
  VAULT_ONLY,
  VAULT_SOURCE_NAMES,
  VAULT_STATE_LABELS,
} from '../../src/web/admin/model/vault.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { PRIVACY } from '../../src/web/legal/content/privacy.js';
import { TERMS } from '../../src/web/legal/content/terms.js';
import { ACCOUNT, MODE, SOUND, TIER, VAULT } from '../../src/web/verify/copy.js';
import { ALL_SOUNDS, LIVE_SOUNDS, VAULT_SOUNDS } from '../../src/web/verify/live-sound.js';
import { HOLD_MS, RARE_K, VIBRATION } from '../../src/web/verify/vault/vault-opening.js';
import { VAULT_PAGE_PATH } from '../../src/web/verify/vault-model.js';
import { formatMoney } from '../../src/web/verify/view-model.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-OQ-Q3.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Production before lot Q3: ADD-ONS ONE SYSTEM (lot Q2), deployed on 2026-10-25, its image, and the one before it, Q1's. */
const Q2_SHA = '5e0518fe53cdedd6b2512538e78f70f519d16afa';
const Q2_TAG = '5e0518fe53cd';
const Q1_TAG = '7098341f83f2';
/** The legal version of lot Q3 (step Q3.14), and the ORBES CARE conditions', unchanged since ORBES CARE. */
const Q3_LEGAL_VERSION = '2026-10-26';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
/** Lot Q2's migrations, and lot Q3's two (plan Q3 §1.1, §1.2). */
const Q2_NAMES = ['0059_addons_one_system', '0060_release_addons_converted'];
const Q2_LAST = Q2_NAMES.at(-1)!;
const Q3_NAMES = ['0061_the_vault', '0062_vault_rewards'];
const DEPLOY = NAMES.slice(NAMES.indexOf(Q2_LAST) + 1).filter((n) => Q3_NAMES.includes(n));
const BEFORE = NAMES.slice(0, NAMES.indexOf(Q2_LAST) + 1);
const AFTER = [...BEFORE, ...DEPLOY];

/** What the runbook expects from the scripts and the migrations, each printed word for word by its source. */
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

/** A LIVE release whose room is open or opens within the hour (DEPLOY-OQ-Q1's and Q2's own read, word for word). */
const ROOM_SOON = 'room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()';

/** What 0061 wrote, read after the deploy (§1.6), in the runbook's order. */
const POST_CHECK = [
  'select source, enabled, per_occasion, cap from vault_sources order by source',
  'select kind, odds_in, quantity, given, active from vault_rewards order by position',
  'select occasion_key, count(*) from vault_occasions_before group by 1 order by 1',
  'select (select count(*) from drops where vault_on), (select count(*) from models where vault_only)',
  'select source, count(*) from vaults group by 1 order by 1',
];

/** The floor's settings as the console reads them (VaultSettings['floor']), and a GIVE A VAULT to one collector. */
const floorOf = (oddsIn: number | null, parts: number) => ({ id: 'floor', parts, oddsIn, oddsText: oddsIn === null ? null : `1 IN ${oddsIn}` });
const GIVE_ONE: VaultGiven = { giftId: null, dryRun: false, reach: 1, accounts: 1, vaults: 1, leftOut: { testEntrants: 0, inactive: 0 } };

/** The text block of the runbook whose first line starts with `first`, as lines. */
function block(first: string): string[] {
  const found = outputs.find((o) => o.startsWith(first));
  if (!found) throw new Error(`no text block starting with "${first}"`);
  return found.split('\n');
}

/** git in the repository, or null where its history does not hold Q2's commit (genome-ci's shallow checkout). */
function git(args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${Q2_SHA}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    return null;
  }
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

const said = (s: string) => `« ${s} »`;
/** The app's money keeps a no-break space between the sign and the figure; the runbook a plain one. */
const plain = (s: string) => s.replace(/ /g, ' ');
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

describe('the runbook of lot THE VAULT (docs/launch/DEPLOY-OQ-Q3.md)', () => {
  it('starts from lot Q2 in production and applies exactly 0061 and 0062, as the scripts print them, every count from MIGRATIONS', () => {
    expect(DEPLOY).toEqual(Q3_NAMES);
    // Q3's migrations follow Q2's at once; a later lot's (M4, renumbered: D61) only ever comes after them.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(BEFORE.slice(-2)).toEqual(Q2_NAMES);
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_Q3>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration, and what each adds, as the migrations write it.
    const changes = section(runbook, '### 1.0');
    expect([...changes.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1])).toEqual(DEPLOY);
    const m0061 = migration('0061_the_vault');
    for (const t of ['vault_sources', 'vault_rewards', 'vaults', 'vault_occasions_before', 'invitations']) {
      expect(m0061, t).toContain(`CREATE TABLE ${t} (`);
      expect(changes, t).toContain(`\`${t}\``);
    }
    expect(m0061).toContain('ALTER TABLE drops ADD COLUMN vault_on boolean NOT NULL DEFAULT false');
    expect(m0061).toContain('ALTER TABLE models ADD COLUMN vault_only boolean NOT NULL DEFAULT false');
    expect(m0061).toContain('ALTER TABLE accounts ADD COLUMN invited_by uuid NULL');
    for (const c of ['`drops.vault_on`, éteint partout', '`models.vault_only`, nulle part', '`accounts.invited_by`']) expect(changes, c).toContain(c);
    expect(migration('0062_vault_rewards')).toContain('CREATE TABLE vault_gifts (');
    expect(changes).toContain('(`vault_gifts`)');
    expect(runbook).toContain('| THE VAULT (lot Q3) |');
    expect(changes).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    // The files the commit adds under migrations since Q2, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${Q2_SHA} HEAD -- genome/src/server/db/migrations`);
    const added = git(['diff', '--name-status', Q2_SHA, '--', 'genome/src/server/db/migrations']);
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
    expect(runbook).toContain(`previous image tag: ${Q2_TAG}`);
    expect(runbook).toContain(`(previous: ${Q2_TAG}). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      `orbes-genome:${Q2_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${Q2_TAG} refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_Q3> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).`,
    );
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_Q3> OK (previous ${Q2_TAG}; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // Q2 as the last deployment: its log line exactly as Q2's runbook expects it, with Q2's and Q1's images.
    const q2Line = `deploy ${Q2_TAG} OK (previous ${Q1_TAG}; migrations ${Q2_NAMES.join(', ')})`;
    expect(runbook).toContain(`\`… ${q2Line}\``);
    expect(readDoc('docs/launch/DEPLOY-OQ-Q2.md')).toContain(`deploy <TAG_Q2> OK (previous ${Q1_TAG}; migrations ${Q2_NAMES.join(', ')})`);
    expect(Q2_SHA.slice(0, 12)).toBe(Q2_TAG);
    expect(runbook).toContain(`Sortie attendue : \`${Q2_SHA}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${Q2_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${Q2_SHA.slice(0, 7)}..<7 caractères de SHA_Q3>\``);
    expect(runbook).toContain("**Q3 ne part qu'après Q2**");
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain(`Si la dernière ligne OK de \`.state/deploys.log\` nomme une autre image que \`${Q2_TAG}\``);
    // D61: M4 (paused) deploys after this lot, renumbers after its last migration, its margin reads the vault's cost.
    expect(runbook).toContain(`Le lot M4 (en pause) part après Q3 : il renumérote ses migrations après \`${DEPLOY.at(-1)}\`, et la marge de GROWTH y comptera le coût des coffres (D61).`);
    // Q2's deployed commit is the base of this lot: the build branch holds it (a full clone only).
    const base = git(['merge-base', '--is-ancestor', Q2_SHA, 'HEAD']);
    if (base !== null) expect(base).toBe('');
  });

  it('expects from the scripts, the migrations and the app only messages they print, and a rollback only before the migrations', () => {
    for (const [message, src] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(src), `${message}: not in ${src}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(section(runbook, '### 1.4')).toContain("Caddy garde son conteneur, sa configuration n'ayant pas changé.");
    const trouble = section(runbook, '### 1.5');
    expect(trouble).toContain("Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant.");
    expect(trouble).toContain(`\`── rollback to orbes-genome:${Q2_TAG}\` et \`rolled back to ${Q2_TAG}; the stack is healthy\``);
    expect(trouble).toContain('`WARNING: deployment of <TAG_Q3> failed (…) and is KEPT`');
    expect(trouble).toContain(`**jamais \`scripts/deploy.sh --image ${Q2_TAG}\`**`);
    // The downs refuse once vault data exists, as each migration counts it.
    expect(migration('0062_vault_rewards')).toContain(
      "RAISE EXCEPTION 'migration 0062_vault_rewards cannot be rolled back: % vault credits, % vault orders, % LIVE guarantees, % vault add-on units, % credits to give and % vault offers exist'",
    );
    expect(trouble).toContain("le `down` de `0062_vault_rewards` refuse dès qu'un crédit, une commande, une place garantie, un complément, un crédit à offrir ou une offre venus d'un coffre existent");
    expect(migration('0061_the_vault')).toContain(
      "RAISE EXCEPTION 'migration 0061_the_vault cannot be rolled back: % vaults, % invitations, % invited accounts, % vault messages, % vault rewards, % vault source settings, % releases with their vault on and % vault-only models exist'",
    );
    expect(trouble).toContain(
      "celui de `0061_the_vault` dès qu'un coffre, une invitation, un compte invité, un message de coffre, une ligne de la table autre que I WAS THERE, une occasion qui n'a plus ses réglages par défaut, une sortie avec THE VAULT allumé ou un modèle VAULT ONLY existent",
    );
    // Neither migration refuses to apply: no up refusal to read before.
    for (const n of DEPLOY) expect(migration(n), n).not.toMatch(/cannot be applied/);
    // While a fix comes: an occasion switched off, a row deactivated, the release switch left off; never the database.
    expect(trouble).toContain(`une occasion qui pose problème s'éteint dans \`Club\` → \`${VAULT_COPY.tab}\` → \`${VAULT_COPY.sources}\`, une ligne de la table se désactive (\`${VAULT_COPY.deactivate}\`)`);
  });

  it('holds the owner’s rules: the review board first, every time in Paris first, no LIVE release running, the pre-check, nothing on the host changes, the legal version', () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur le tableau de revue d'abord.**");
    // Paris first, UTC in brackets: Paris at winter time since 25 October (Q1's and Q2's "04:00 et 06:30 ensuite").
    expect(rules).toContain('**Jamais entre 04:00 et 06:30 à Paris** (03:00–05:30 UTC)');
    expect(rules).toContain('03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC)');
    expect(section(readDoc('docs/launch/DEPLOY-OQ-Q2.md'), '## 0.')).toContain("04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(section(readDoc('docs/launch/DEPLOY-OQ-Q2.md'), '## 0.')).toContain('puis 02:00–02:10 et 02:45–02:55 UTC');
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche)");
    // Every UTC time sits in brackets after its Paris time; every clock time outside brackets is a Paris one.
    const bare = outsideBrackets(runbook);
    expect(bare).not.toMatch(/\d{2}:\d{2}[^\n]{0,12}UTC/);
    expect(bare).not.toMatch(/UTC[^\n]{0,4}\d{2}:\d{2}/);
    const paired = [...runbook.matchAll(/<heure>[^\n(]{0,30}\(<heure>[^)]*UTC\)/g)];
    expect(paired.length).toBeGreaterThanOrEqual(2);
    for (const m of paired) expect(m[0]).toMatch(/Paris/);
    expect(runbook).toContain('déployée le 25 octobre 2026 à 15:26 à Paris (14:26 UTC)');
    // Rule 3: no LIVE release between its room's opening and its end, read before the launch and again just before it;
    // no TEST ENTRANTS test running.
    expect(rules).toContain("**Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.**");
    const before = section(runbook, '### 1.1');
    const reads = fenced(before, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([psql(`select count(*) from drops where ${ROOM_SOON}`), psql('select count(*) from test_runs where ended_at is null')]);
    expect(fenced(readDoc('docs/launch/DEPLOY-OQ-Q2.md'), 'bash')).toContain(psql(`select count(*) from drops where ${ROOM_SOON}`));
    expect(fenced(section(runbook, '### 1.4'), 'bash')[0]).toBe(psql(`select count(*) from drops where ${ROOM_SOON}`));
    expect(readDoc('genome/src/server/db/migrations/0024_z_test_entrants.ts')).toContain("CONSTRAINT test_runs_ended CHECK ((status = 'ENDED') = (ended_at IS NOT NULL)");
    for (const q of commands.filter((c) => c.includes('psql'))) {
      expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop table|truncate|create)\b/i);
      // A string literal would end the shell's single quotes.
      expect(q.slice(q.indexOf('-Atc "'), q.lastIndexOf('"')), q).not.toContain("'");
    }
    // The review board, phone and computer, dark and light, the vault staying dark; his table prepared (OP-27).
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768', 'le coffre et sa page restent sombres en mode clair', 'les mots qu\'aucune maquette n\'avait']) {
      expect(before, what).toContain(what);
    }
    expect(before).toContain('**2. Ta table, à préparer** (OP-27).');
    expect(before).toContain('ne sont que des exemples');
    // Client Services told before: the playbook's two vault sections, in both copies.
    expect(before).toContain('§0 « THE VAULT : les coffres des collectionneurs » et §2 « THE VAULT CARD dans le colis »');
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      expect(section(readDoc(copy), '## 0.'), copy).toContain('### THE VAULT : les coffres des collectionneurs');
      expect(section(readDoc(copy), '## 2.'), copy).toContain('### THE VAULT CARD dans le colis');
    }
    // No slot booked: the three conditions, the heads-up at launch in Paris then UTC.
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("le diff de `deploy/vps` vide après l'avance rapide");
    expect(section(runbook, '### 1.4')).toContain(
      "**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement THE VAULT lancé à <heure> Paris (<heure> UTC), deux migrations, rien ne change sur l'hôte. »",
    );
    // Nothing on the host changes: the deploy/vps diff against Q2 in production is empty, no .env line; the credits to
    // give's key derives from COOKIE_SECRET (services/vault.ts).
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(rules).toContain('Ton `.env` ne gagne aucune ligne : la clé des crédits à offrir dérive de `COOKIE_SECRET`, déjà là.');
    expect(source('server/services/vault.ts')).toContain("return deriveSubkey(utf8(config.cookieSecret), VAULT_GIFT_KEY_INFO, { salt: 'ORBES' });");
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${Q2_SHA} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('-- deploy/vps\n```\n\nSortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.');
    const diff = git(['diff', '--name-status', Q2_SHA, '--', 'deploy/vps']);
    const log = git(['log', '--no-merges', '--format=%H %s', `${Q2_SHA}..HEAD`, '--', 'deploy/vps']);
    if (diff !== null && log !== null) {
      expect(log.trim().split('\n').filter((l) => / OQ-Q3\./.test(l))).toEqual([]);
      if (!log.trim()) expect(diff.trim()).toBe('');
    }
    expect(section(runbook, '### 1.2')).toContain("Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n'y touches pas.");
    // No secret: .env is only ever read for two lines, and never shown whole; COOKIE_SECRET is never read.
    for (const c of commands.filter((x) => x.includes('.env'))) expect(["grep '^ORBES_IMAGE_TAG=' .env", "grep -n '^RESTORE_ALLOWED=' .env"]).toContain(c);
    expect(commands.filter((c) => c.includes('COOKIE_SECRET'))).toEqual([]);
    expect(commands.filter((c) => /\bcat\b|printenv|(?:^|\s)env(?! \|)/.test(c))).toEqual([]);
    expect(rules).toContain('**Les secrets ne se collent jamais dans une conversation.**');
    // The guarded launch, umask 022, restore.sh only to watch it refuse, no prune.
    expect(commands).toContain('umask 022');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(commands.filter((c) => /docker image rm/.test(c))).toEqual([]);
    expect(rules).toContain('la branche `orbes-one-queue` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The legal pages: one new version, the code's; the ORBES CARE conditions keep theirs; counsel never holds the deploy.
    // A later lot (M4) may move LEGAL_VERSION past it; Q3's head publishes Q3's.
    expect(LEGAL_VERSION >= Q3_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${Q3_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement (D59)');
    expect(rules).toContain('les conditions, article 13, un seul paragraphe (*THE VAULT*), et la politique de confidentialité, une seule phrase (le lien d\'invitation, dans *Your ORBES account*)');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${Q3_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(source('web/legal/content/index.ts')).toContain(`${Q3_LEGAL_VERSION} is the version of lot Q3, THE VAULT`);
  });

  it('checks the box after the migrations, what 0061 wrote read only, the sixteen sounds, the legal version, the card in Documents, and tells the host with the swap', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual(POST_CHECK.map(psql));
    // The seven sources at OP-29's defaults, as 0061 inserts them, in the read's order.
    const m0061 = migration('0061_the_vault');
    expect(m0061).toContain("const defaults = SOURCES.map((s) => `('${s}', true, 1, ${s === 'HOUSE' ? 'NULL' : '1'})`).join(', ');");
    expect(block('FRIEND|')).toEqual([...VAULT_SOURCES].sort().map((s) => `${s}|t|1|${s === 'HOUSE' ? '' : '1'}`));
    expect(block('FRIEND|')).toHaveLength(7);
    // The floor alone, as 0061 inserts it; the tiers held before, keyed as 0061 writes them; nothing switched on.
    expect(m0061).toContain("`INSERT INTO vault_rewards (kind, active, position) VALUES ('I_WAS_THERE', true, 0)`");
    expect(after).toContain('Sortie attendue : une seule ligne, `I_WAS_THERE|||0|t`.');
    expect(m0061).toContain("SELECT h.account_id, 'TIER:' || t.tier");
    expect(m0061).toContain('AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = o.account_id)');
    expect(after).toContain('`TIER:1|<comptes>`, `TIER:2|<comptes>`, `TIER:3|<comptes>` (TITANE, PLATINE, PALLADIUM), les comptes de test jamais comptés');
    expect(after).toContain('Sortie attendue : `0|0`.');
    expect(after).toContain('Jamais `LIVE` ni `HOUSE` à ce stade.');
    // The console after: the table's line under it, the sources' caps, Documents' third document and its two PDFs.
    const floorOnly = oddsSumLine({ partsGiven: 0, floor: floorOf(1, 1_000_000) });
    expect(after).toContain(said(floorOnly));
    expect(after).toContain(`${said(capText('LIVE', 1))}, … ; THE HOUSE ${said(capText('HOUSE', null))}`);
    expect(CLUB_TABS.find((t) => t.id === 'vault')?.label).toBe(VAULT_COPY.tab);
    expect(after).toContain(`\`Club\`, onglet \`${VAULT_COPY.tab}\``);
    expect(STAFF_DOCUMENTS).toHaveLength(3);
    expect(STAFF_DOCUMENTS[2]).toMatchObject({ file: 'VAULT-CARD.md', title: 'THE VAULT CARD' });
    for (const pdf of ['vault-card-sheet.pdf', 'vault-card-single.pdf']) {
      expect(DOCUMENT_ASSETS[pdf], pdf).toBe('application/pdf');
      expect(after, pdf).toContain(`\`${pdf}\``);
      expect(readDoc('docs/launch/VAULT-CARD.md'), pdf).toContain(`(../assets/${pdf})`);
    }
    expect(after).toContain('`Documents` : trois documents, le troisième **THE VAULT CARD**.');
    // The box's figures before and after, the swap line read; the host told at launch and after, swap included.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(after).toContain("**Préviens le responsable de l'hôte** : « THE VAULT fait à <heure> Paris (<heure> UTC), deux migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »");
    // From the Mac: health, the app, the sixteen sounds (Q1's command, word for word) and the legal version.
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/health');
    expect(after).toContain('Sortie attendue : `{"ok":true,"version":"0.1.0"}`.');
    const sounds = commands.find((c) => c.includes('.mp3'));
    expect(sounds).toBe(
      'for u in $(curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/verify | grep -o \'/assets/verify-[A-Z0-9]*\\.js\' | head -1)" | grep -o \'/assets/[a-z-]*-[A-Z0-9]\\{8\\}\\.mp3\' | sort -u); do curl -s -o /dev/null -w "%{http_code} $u\\n" "https://verify.theorbes.com$u"; done',
    );
    expect(fenced(readDoc('docs/launch/DEPLOY-OQ-Q1.md'), 'bash')).toContain(sounds);
    const lines = block('200 /assets/');
    expect(lines).toEqual([...ALL_SOUNDS].sort().map((n) => `200 /assets/${n}-<8 caractères>.mp3`));
    expect(lines).toHaveLength(16);
    expect(ALL_SOUNDS).toHaveLength(LIVE_SOUNDS.length + VAULT_SOUNDS.length);
    expect(VAULT_SOUNDS).toHaveLength(5);
    expect(after).toContain('exactement seize lignes');
    expect(after).toContain('Moins de seize lignes');
    // The names the build publishes: <name>-<8 capitals or digits>.mp3, a hashed asset, which the grep reads.
    expect(HASHED_ASSET_RE.test('/assets/vault-unlock-W2FRIVUJ.mp3')).toBe(true);
    expect(readDoc('genome/scripts/build-web.ts')).toContain("'.mp3': 'file'");
    expect(readDoc('genome/src/server/http/static.ts')).toContain("app.get('/legal', legal);");
    expect(commands).toContain(
      `curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\\.js' | head -1)" | grep -o '${Q3_LEGAL_VERSION}' | head -n 1`,
    );
    expect(after).toContain(`Sortie attendue : \`${Q3_LEGAL_VERSION}\`.`);
  });

  it('checks each element for real, phone and computer, dark and light, in the console’s and the app’s words', () => {
    const real = section(runbook, '### 1.7');
    expect(real).toContain('**A**, ton propre compte, sur ton téléphone (Safari), **B** sur ton ordinateur, dans une fenêtre de navigation privée');
    expect(real).toContain('jamais des comptes de test (un compte de test ne reçoit jamais de coffre)');
    expect(real).toContain(`\`${SOUND.label}\` sur \`${SOUND.on}\` (${ACCOUNT.title})`);
    // 1. The table and the sources, read: the floor always there, the seven sources in their order with their defaults.
    const read1 = section(runbook, '#### 1.');
    expect(read1).toContain('`1 IN 1`, `ALWAYS`');
    expect(read1).toContain(VAULT_SOURCES.map((s) => `\`${VAULT_SOURCE_NAMES[s]}\``).join(', '));
    expect(read1).toContain(said(sourceDefaultText('LIVE')));
    expect(read1).toContain(`THE HOUSE : ${said(sourceDefaultText('HOUSE'))}`);
    // 2. GIVE A VAULT to his own account: the reach first, then Give, in the dialog's words; the client sheet's block.
    const give = section(runbook, '#### 2.');
    const views = source('web/admin/views/vault.ts');
    for (const w of ["label: 'To'", "label: 'Collector’s email'", "label: 'Note for Client Services'", "confirmLabel: 'Show the reach'", "confirmLabel: 'Give'"]) expect(views, w).toContain(w);
    expect(give).toContain(`\`${VAULT_COPY.give}\` : la boîte \`${VAULT_COPY.giveTitle}\``);
    const reach = reachLines({ ...GIVE_ONE, dryRun: true, vaults: 0, accounts: 0 }, 1);
    expect(give).toContain(`puis \`Show the reach\` : ${said(reach[0]!)} et ${said(reach[1]!)}`);
    expect(give).toContain(`\`Give\` : ${said(givenText(GIVE_ONE))}`);
    expect(give).toContain(`\`${VAULT_STATE_LABELS.WAITING}\` et « Until <jour> » (${VAULT_WAIT_DAYS} jours)`);
    expect(give).toContain('« 1 waiting · 1 given »');
    expect(give).toContain('aucun bouton pour reprendre le coffre');
    const owner = source('web/admin/views/owner.ts');
    const vaultsPanel = owner.slice(owner.indexOf('function vaultsPanel('), owner.indexOf('\n}\n', owner.indexOf('function vaultsPanel(')));
    expect(vaultsPanel).toContain("section(\n    'THE VAULT',");
    expect(vaultsPanel).toContain('button(VAULT_COPY.give');
    expect(vaultsPanel).not.toMatch(/revoke|take back/i);
    // 3. What A sees: NOW's line, the quiet number, the FROM ORBES arrival, THE VAULT page, dark in light mode.
    const sees = section(runbook, '#### 3.');
    expect(VAULT.now.label(1)).toBe(VAULT_ARRIVED_TITLE.one);
    expect(sees).toContain(`La ligne ${said(VAULT.now.label(1))}, avec ${VAULT.now.open}`);
    expect(sees).toContain(`La ligne ${VAULT.row}, après YOUR WISHLIST, avec son petit nombre : \`1\``);
    const arrived = vaultArrivedWords({ source: 'HOUSE', detail: null, count: 1, until: '2026-11-27' });
    expect(sees).toContain(`NEW ; ${said(arrived.title)} ; ${said(arrived.body.replace('27 November 2026', '<jour>'))} ; le lien THE VAULT`);
    const p = VAULT.page;
    expect(sees).toContain(`${p.overline}, ${p.title}, ${said(p.lead)} ; ${p.waiting(1)} ; la porte qui flotte, ${p.press} dessous, puis ${VAULT_SOURCE_LABELS.HOUSE} et ${p.until('<JOUR>')}`);
    expect(sees).toContain(`plus bas ${p.how} (les sept occasions, chacune où tu en es) et ${p.hold} (les huit, ${p.rare} sur trois), aucune chance nulle part`);
    expect(Object.keys(VAULT.ledger).filter((k) => (VAULT_SOURCES as readonly string[]).includes(k))).toHaveLength(7);
    expect(Object.keys(VAULT.grid)).toHaveLength(8);
    expect(source('server/services/vault.ts')).toContain("export const VAULT_RARE_KINDS: readonly VaultRewardKind[] = Object.freeze(['GUARANTEED', 'VAULT_EDITION', 'THE_PIECE'] as const);");
    expect(VAULT_PAGE_PATH).toBe('/verify/vault');
    expect(section(runbook, '### 1.0')).toContain('(sur un téléphone `/verify/vault`, sur un ordinateur sa propre page dans YOUR ACCOUNT), toujours sombre, même en mode clair');
    // 4. The € 1 credit at 1 IN 1, added just before and deactivated at once; the opening on the phone; its receipt.
    const open = section(runbook, '#### 4.');
    for (const w of ["label: 'Kind'", "label: 'Amount'", "label: 'Currency'", "label: 'Odds'", "label: 'Quantity'", "confirmLabel: r ? 'Save reward' : 'Add reward'", "title: 'Deactivate the reward'"]) expect(views, w).toContain(w);
    expect(NEW_REWARD_KINDS[0]).toBe('CREDIT');
    expect(open).toContain(`\`${VAULT_COPY.newReward}\` : \`Kind\` \`${VAULT_KIND_LABELS.CREDIT}\`, \`Amount\` \`1\`, \`Currency\` \`EUR\`, \`Odds\` \`1\`, \`Quantity\` \`1\`, puis \`Add reward\` : ${said(VAULT_COPY.added)}`);
    const credit = rewardWhat({ kind: 'CREDIT', amountMinor: 100, currency: 'EUR', modelName: null, addonName: null, mode: null, line: null });
    expect(open).toContain(`La ligne lit ${said(plain(credit))}, \`1 IN 1\`, \`ACTIVE\``);
    expect(open).toContain(`I WAS THERE lit « None left », et dessous : ${said(oddsSumLine({ partsGiven: 1_000_000, floor: floorOf(null, 0) }))}`);
    expect(open).toContain('ajoute-la juste avant d\'ouvrir, et désactive-la aussitôt après');
    // The gesture and the opening, as vault-opening.ts times them; the vibration only where supported (OP-19).
    expect(HOLD_MS).toBe(1500);
    expect(RARE_K).toBe(1.4);
    expect(VIBRATION.length).toBeGreaterThan(0);
    expect(open).toContain('Maintenir la porte une seconde et demie (ou la tirer vers le bas)');
    expect(open).toContain('une courte vibration sur un téléphone qui la permet (Android ; Safari sur iPhone ne vibre pas, c\'est normal)');
    expect(section(runbook, '### 1.0')).toContain('plus lente de 1,4 fois');
    const prize = vaultMoney(100, 'EUR');
    expect(prize).toBe('€1');
    expect(open).toContain(`${VAULT_REVEAL.from}, ${said(prize)}, ${said(VAULT_REVEAL.credit)}, « 1 IN 1 »`);
    expect(open).toContain(`${p.press} disparaît ; sur cette page, ni ${VAULT.reveal.again} ni assombrissement`);
    expect(open).toContain(`${p.waiting(0)} : ${said(p.none)} ; sous ${p.opened}, le jour, ${VAULT_SOURCE_LABELS.HOUSE} et « €1 · HOUSE CREDIT »`);
    expect(TIER.vaultCredit).toBe('HOUSE CREDIT');
    expect(open).toContain(`Sous ${TIER.inUse}, la ligne ${TIER.vaultCredit}, ${said(plain(TIER.creditValue(formatMoney(100, 'EUR'), '<date>')))}`);
    const receipt = vaultOpenedWords({ prize, line: VAULT_REVEAL.credit, where: 'ACCOUNT' });
    expect(open).toContain(`${said(receipt.title)} : ${said(receipt.body)}`);
    expect(open).toContain(`\`${VAULT_STATE_LABELS.OPENED}\`, « Opened <jour> »`);
    expect(open).toContain(`\`${VAULT_COPY.deactivate}\`, la boîte « Deactivate the reward », puis \`${VAULT_COPY.deactivate}\` : ${said(VAULT_COPY.deactivated)}`);
    expect(open).toContain(`de nouveau ${said(oddsSumLine({ partsGiven: 0, floor: floorOf(1, 1_000_000) }))}`);
    expect(open).toContain('ne l\'applique à aucune commande');
    // 5. The computer, in light mode: the seventh card, the page dark, the card and its image.
    const computer = section(runbook, '#### 5.');
    expect(computer).toContain(`YOUR ACCOUNT, ${MODE.label} (sous ${SOUND.label}) allumé`);
    expect(computer).toContain(`la septième carte ${VAULT.row} avec \`1\``);
    expect(computer).toContain(`${VAULT_REVEAL.card.prize}, ${said(VAULT_REVEAL.card.other)}, « 1 IN 1 »`);
    expect(computer).toContain(`${p.save} : l'image \`${VAULT.image.filename}\`, 1080 × 1350`);
    // 6. A test LIVE release with its switch on and a size sold out, in the console's and the room's words.
    const live = section(runbook, '#### 6.');
    expect(source('web/admin/views/club.ts')).toContain("button('New live release'");
    expect(live).toContain(`\`People per batch\` \`1\`, \`Every (minutes)\` \`1\`, \`${LIVE_HOLD_LABEL}\` \`0\`, \`Price of a piece\` \`1\`, \`Currency\` \`EUR\`, \`Sizes\` sur deux lignes, \`52 = 1\` puis \`54 = 1\``);
    expect(source('web/admin/views/live.ts')).toContain("hint: `One size per line, its label then its stock: 52 = 3.");
    expect(live).toContain(`la section \`${LIVE_VAULT.label}\` lit \`${LIVE_VAULT.off}\` et ${said(LIVE_VAULT.offNote)}`);
    expect(live).toContain(`\`${LIVE_VAULT.turnOn}\` : la boîte ${said(LIVE_VAULT.turnOnTitle)}, puis \`${LIVE_VAULT.turnOn}\` : ${said(LIVE_VAULT.onDone)}`);
    expect(live).toContain(`La section lit \`${LIVE_VAULT.on}\` et ${said(LIVE_VAULT.onNote)}`);
    expect(live).toContain(`${said(VAULT.door.lead)} et ${said(VAULT.door.hint)}, avant LEAVE THE LINE`);
    expect(source('web/verify/copy.ts')).toContain("leave: 'LEAVE THE LINE'");
    expect(live).toContain(`${VAULT_REVEAL.card.prize}, ${said(VAULT_REVEAL.card.release)}, « 1 IN 1 »`);
    expect(live).toContain(`puis ${VAULT.reveal.again}`);
    expect(live).toContain(`sous ${p.opened}, ${VAULT_SOURCE_LABELS.LIVE} et la carte`);
    const [given, opened] = liveVaultReportFigures({ on: true, given: 1, opened: 1 });
    expect(live).toContain(`\`${given![0]}\` \`1\` (${said(given![2])}) et \`${opened![0]}\` \`1\` (${said(opened![2])})`);
    expect(source('web/admin/views/live-intelligence.ts')).toContain("section(\n        'Release report',");
    expect(live).toContain('une sortie qui ferme avec des pièces restantes n\'en donne pas');
    const order = source('web/admin/views/order.ts');
    for (const w of ["button('Cancel'", "title: 'Cancel the order'", "confirmLabel: 'Cancel the order'", "done('Order cancelled.')"]) expect(order, w).toContain(w);
    expect(live).toContain('`Cancel`, la boîte « Cancel the order », `Note` `Test`, puis `Cancel the order` : « Order cancelled. »');
    // 7. A piece registered: its FROM ORBES arrival, A NEW PIECE, the client sheet's Piece bought.
    const piece = section(runbook, '#### 7.');
    const pieceWords = vaultArrivedWords({ source: 'PIECE', detail: '<LA PIÈCE>', count: 1, until: '2026-11-27' });
    expect(piece).toContain(`${said(pieceWords.title)}, ${said(pieceWords.body.replace('27 November 2026', '<jour>'))}`);
    expect(piece).toContain(`une porte avec ${VAULT_SOURCE_LABELS.PIECE}`);
    expect(piece).toContain(`une ligne \`${VAULT_SOURCE_NAMES.PIECE}\``);
    expect(piece).toContain(`(${VAULT_SOURCE_LABELS.TIER})`);
    // 8. The packing checklist's line and the slip's row, as parcels.ts and slip.ts write them.
    const pack = section(runbook, '#### 8.');
    expect(source('server/services/parcels.ts')).toContain("'THE VAULT CARD'");
    expect(pack).toContain('la ligne `THE VAULT CARD`, juste après celle de la carte certificat');
    expect(source('web/admin/views/slip.ts')).toContain('Vault card');
    expect(pack).toContain('`Vault card` · `THE VAULT CARD`');
    // 9. The A4 sheet: duplex long edge, 100 %, cut to 95 × 62 mm (VAULT-CARD.md's own steps).
    const print = section(runbook, '#### 9.');
    expect(print).toContain('`Documents` → THE VAULT CARD → `vault-card-sheet.pdf`');
    for (const w of ['retournement **bord long**', 'à **taille réelle** (100 %', 'huit cartes de 95 × 62 mm']) {
      expect(print, w).toContain(w);
      expect(readDoc('docs/launch/VAULT-CARD.md'), w).toContain(w.replace(/huit cartes/, 'huit cartes'));
    }
    // 10. The legal pages: the version line, the terms' paragraph, the privacy policy's sentence.
    const legal = section(runbook, '#### 10.');
    expect(legal).toContain(said(WORDS.en.version(Q3_LEGAL_VERSION)));
    expect(JSON.stringify(TERMS.en)).toContain('**THE VAULT.**');
    expect(legal).toContain(said('THE VAULT.'));
    const sentence = "If you create your account with a collector's personal invitation link,";
    expect(JSON.stringify(PRIVACY.en)).toContain(sentence);
    expect(legal).toContain(`(« ${sentence} … »)`);
    // 11. The ENGRAVING's prices and YOUR ORDERS switch, an ADMIN's (the owner's amendment of 25 Oct).
    const engraving = section(runbook, '#### 11.');
    expect(engraving).toContain(said(ENGRAVING_ADMIN_ONLY.note));
    expect(section(runbook, '### 1.0')).toContain('les prix de l\'add-on ENGRAVING et son interrupteur YOUR ORDERS se règlent par un **ADMIN seul**');
    expect(section(readDoc('docs/launch/DEPLOY-OQ-Q2.md'), '## 2.')).toContain('6. **Qui règle le prix de la gravure**');
    // §1.0's staff lines name what the console has.
    const staff = section(runbook, '### 1.0');
    expect(staff).toContain(`\`${VAULT_ONLY.label}\` sur la fiche d'un modèle`);
    expect(staff).toContain(`Au plus ${10} ouvertures par minute et par compte.`);
    expect(source('server/http/rate-limit.ts')).toContain('export const VAULT_OPEN_PER_MINUTE = 10;');
  });

  it('leaves the owner’s data and open points, gives one command per shell block, in French, links only to what exists, linked from DEPLOYMENT and COMPLIANCE', () => {
    // His data after, in the console's words; the LIVE cap and vaults per occasion above one only once the terms change (N22).
    const data = section(runbook, '### 1.8');
    for (const k of NEW_REWARD_KINDS) expect(data, k).toContain(`\`${VAULT_KIND_LABELS[k]}\``);
    expect(data).toContain(`\`Vaults per occasion\`, de ${VAULT_PER_OCCASION.min} à ${VAULT_PER_OCCASION.max}`);
    expect(data).toContain(`son plafond (de ${VAULT_CAP.min} à ${VAULT_CAP.max})`);
    expect(source('web/admin/views/vault.ts')).toContain("label: 'Vaults per occasion'");
    expect(data).toContain('**Pour une LIVE RELEASE, rien au-dessus de 1** (ni plafond, ni coffres par occasion) tant que la phrase des conditions');
    expect(JSON.stringify(TERMS.en)).toContain('a LIVE RELEASE gives at most one per account');
    expect(data).toContain(`section \`${LIVE_VAULT.label}\`, \`${LIVE_VAULT.turnOn}\`, jusqu'à sa fin ; éteint par défaut, jamais sur une after-room`);
    expect(data).toContain(`\`${VAULT_ONLY.label}\``);
    // The open points, none blocking.
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const n of ['(N4)', '(N7)', '(N9)', '(N36)', '(D70)', '(N8)']) expect(open, n).toContain(n);
    expect(open).toContain(said(VAULT_REVEAL.card.other));
    expect(open).toContain(said(VAULT_REVEAL.vaultEdition.line));
    expect(open).toContain('(la note au juriste, points 38 et 39)');
    expect(readDoc('docs/legal/counsel-note.fr.md')).toMatch(/^38\. /m);
    expect(readDoc('docs/legal/counsel-note.fr.md')).toMatch(/^39\. /m);
    // One command per shell block; the house's runbook shape, in French, for the owner.
    expect(commands.length).toBeGreaterThan(40);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(commands).toContain('docker compose exec app node --import tsx scripts/db.ts status');
    expect(runbook.startsWith('# Mise en production du lot THE VAULT (Q3)\n\nCe document est pour toi, le propriétaire.')).toBe(true);
    expect(runbook.match(/Sortie attendue/g)!.length).toBeGreaterThan(30);
    for (const h of [
      '## 0. Les règles',
      '## 1. Le déploiement',
      '### 1.0 Ce qui change',
      '### 1.2 Préparer le serveur',
      '### 1.3 Récupérer le commit final',
      '### 1.4 Déployer',
      '### 1.5 Si quelque chose ne va pas',
      '### 1.6 Juste après : contrôles de base',
      '### 1.7 Une vérification réelle par élément',
      '### 1.8 Ensuite : tes données',
      '## 2. Ce qui reste à ta décision (sans bloquer)',
    ]) {
      expect(runbook.split('\n'), h).toContain(h);
    }
    const changes = section(runbook, '### 1.0');
    for (const w of ['**Un seul coffre, une seule table.**', '**Sept occasions**', "**L'ouverture**", '**SOLD OUT pour ta taille**', '**La page THE VAULT**', '**Les récompenses, livrées là où elles vont**', '**Une pièce retournée**', '**THE VAULT CARD**', '**Ce qui ne change pas**']) {
      expect(changes, w).toContain(w);
    }
    expect(changes).toContain("**Les comptes de test n'en reçoivent jamais.**");
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(runbook).toContain('[son runbook](DEPLOY-OQ-Q2.md)');
    const deployment = readDoc('docs/DEPLOYMENT.md');
    expect(deployment).toContain('[DEPLOY-OQ-Q3](launch/DEPLOY-OQ-Q3.md)');
    expect(deployment).toContain('and lot Q3, THE VAULT (one vault and one house table for seven occasions');
    expect(deployment).toContain('one deployment after Q2 with migrations `0061_the_vault` and `0062_vault_rewards`, no `.env` line (the key of the credits to give derives from `COOKIE_SECRET`), no change of the host');
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 13.');
    expect(compliance).toContain('(launch/DEPLOY-OQ-Q3.md)');
    expect(compliance).toContain('(la note au juriste, points 38 et 39)');
    // Never the words the brand keeps out of what it says; no odds table, no piece named.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
    expect(runbook).not.toMatch(/MONOLITHE/);
  });
});
