/**
 * docs/launch/DEPLOY-OQ-Q2.md, the owner's runbook for lot Q2, ADD-ONS ONE SYSTEM (plan Q2 §8, step Q2.12), against the
 * scripts, the migrations, the server, the console and the app it quotes:
 *
 *  - it starts from production as lot Q1 left it (7098341, image 7098341f83f2, 0001 to 0058) and applies exactly
 *    0059_addons_one_system and 0060_release_addons_converted, as the scripts print them, each count and name derived
 *    from MIGRATIONS; Q1's image no longer runs on the schema after them, so a failure after them is repaired forward,
 *    and 0060's down refuses once a conversion happened;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts, the migrations and the app is still
 *    one they print;
 *  - the owner's rules: the review board first, the conversion shown before the deploy (D5), every time in Paris first
 *    with UTC in brackets (the same rule 2 as DEPLOY-OQ-Q1), no LIVE release between its room's opening and its end,
 *    the read-only pre-check of what 0060 reads (the release add-ons per release open or ended, their names, the names
 *    already in the catalogue, the choices on holds under way, the settings' engraving prices, the catalogue's add-ons
 *    and the open releases), no slot booked and the one-line heads-up at launch, the box's figures before and after
 *    with the swap line, the guarded launch, nothing on the host changes (deploy/vps untouched since Q1, no .env line),
 *    the legal pages' new version, restore.sh only ever run to watch it refuse, no prune;
 *  - the post-check: 61 `applied` lines, what the conversion wrote read only, the legal version in the published
 *    bundle, the host told with the swap;
 *  - one real check per element, in the console's and the app's words as the code has them: a GIFT WRAPPING service
 *    never in Logistics nor a supplier order, the engraving's price, switches and most characters, a test LIVE release
 *    picking GIFT WRAPPING, ENGRAVING and an add-on with stock, 5b on the phone and the computer, dark and light, YOUR
 *    TEXT and PAY's total, CONFIRMED's receipt, YOUR ORDERS (the engraving bought, ADD AN ADD-ON without it, an ended
 *    release's order still offered the add-ons and the engraving), a draw picking one, the salon by its switch, the
 *    packing lines, the Shopify product export's service row, the legal pages;
 *  - the owner's open points (N1, N3, N6, N7, counsel); one command per shell block, French, links that resolve, and the
 *    runbook linked from DEPLOYMENT and COMPLIANCE.
 *
 * <SHA_Q2> and <TAG_Q2> stay placeholders until the main session hands the commit over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { ADDON_TEXT_MAX } from '../../src/server/db/schema.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import {
  ADDON_KIND_LABELS,
  ADDON_SKU_TEXT,
  ADDON_SWITCHES,
  ADDONS_TEXT,
  addonEngravingText,
  ADDON_STATUS_LABELS,
  ORDER_ADDONS_TEXT,
  PICK_TEXT,
  pickWhy,
} from '../../src/web/admin/model/addons.js';
import { ENGRAVING_SETTINGS_TEXT } from '../../src/web/admin/model/orders.js';
import { LIVE_HOLD_LABEL } from '../../src/web/admin/model/live.js';
import { OFFER_TEXT } from '../../src/web/admin/model/sets.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { TERMS } from '../../src/web/legal/content/terms.js';
import { ACCOUNT, LIVE, LOOKBOOK, MODE, ORDERS, SOUND } from '../../src/web/verify/copy.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-OQ-Q2.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Production before lot Q2: ONE QUEUE (lot Q1), deployed on 2026-10-24, its image, and the one before it, M3's. */
const Q1_SHA = '7098341f83f223d4900f35e646b018f7830a3b83';
const Q1_TAG = '7098341f83f2';
const M3_TAG = '33e843081148';
/** The legal version of lot Q2 (step Q2.10), and the ORBES CARE conditions', unchanged since ORBES CARE. */
const Q2_LEGAL_VERSION = '2026-10-25';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
/** Lot Q1's migration, and lot Q2's two (plan Q2 §1.1, §1.4). */
const Q1_LAST = '0058_one_queue';
const Q2_NAMES = ['0059_addons_one_system', '0060_release_addons_converted'];
const DEPLOY = NAMES.slice(NAMES.indexOf(Q1_LAST) + 1).filter((n) => Q2_NAMES.includes(n));
const BEFORE = NAMES.slice(0, NAMES.indexOf(Q1_LAST) + 1);
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
  ['migration 0060_release_addons_converted cannot be applied: ', 'genome/src/server/db/migrations/0060_release_addons_converted.ts'],
  [' release add-ons are chosen on entries in TURN or SECURED', 'genome/src/server/db/migrations/0060_release_addons_converted.ts'],
];

/** A read-only query of the box, as the runbook writes it. */
const psql = (query: string) => `docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "${query}"'`;

/** A LIVE release whose room is open or opens within the hour (DEPLOY-OQ-Q1's own read, word for word). */
const ROOM_SOON = 'room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()';

/** The pre-check of what 0060 reads, in the runbook's order (§1.1, point 11). */
const PRE_CHECK = [
  'select d.title, d.ended_at is null and d.cancelled_at is null, count(*) from live_addons a join drops d on d.id = a.drop_id group by d.id order by d.opens_at',
  'select upper(btrim(label)), count(*) from live_addons group by 1 order by 1',
  'select i.name, i.active from addon_items i where lower(i.name) in (select lower(btrim(label)) from live_addons) order by i.name',
  'select count(*) from live_entry_addons x join live_entries e on e.id = x.entry_id where e.confirmed_at is null and e.ended_at is null',
  'select currency, price_minor from engraving_prices order by currency',
  'select (select count(*) from addon_items where active), (select count(*) from drops where cancelled_at is null and room_opens_minutes is not null and ended_at is null), (select count(*) from drops where cancelled_at is null and room_opens_minutes is null and (drawn_at is null or drawn_at + make_interval(hours => purchase_window_hours) > now()))',
];

/** What the conversion wrote, read after the deploy (§1.6). */
const POST_CHECK = [
  'select source, count(*), count(price_minor) from addon_conversions group by source order by source',
  'select name, kind, offer_live, offer_draw, offer_salon, offer_orders, engraving, text_max from addon_items where active order by position, name',
  'select d.title, count(*) from drop_addons p join drops d on d.id = p.drop_id group by d.id order by d.opens_at',
];

/** The text block of the runbook whose first line starts with `first`, as lines. */
function block(first: string): string[] {
  const found = outputs.find((o) => o.startsWith(first));
  if (!found) throw new Error(`no text block starting with "${first}"`);
  return found.split('\n');
}

/** git in the repository, or null where its history does not hold Q1's commit (genome-ci's shallow checkout). */
function git(args: string[]): string | null {
  try {
    execFileSync('git', ['cat-file', '-e', `${Q1_SHA}^{commit}`], { cwd: REPO, stdio: 'ignore' });
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

describe('the runbook of lot ADD-ONS ONE SYSTEM (docs/launch/DEPLOY-OQ-Q2.md)', () => {
  it('starts from lot Q1 in production and applies exactly 0059 and 0060, as the scripts print them, every count from MIGRATIONS', () => {
    expect(DEPLOY).toEqual(Q2_NAMES);
    // Q2's migrations follow Q1's at once; a later lot's (Q3, then M4 renumbered) only ever comes after them.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_Q2>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration, and what each adds or drops, as the migrations write it.
    const changes = section(runbook, '### 1.0');
    expect([...changes.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1])).toEqual(DEPLOY);
    const m0059 = migration('0059_addons_one_system');
    for (const c of ['kind', 'offer_live', 'offer_draw', 'offer_salon', 'offer_orders', 'engraving', 'text_max']) {
      expect(m0059, c).toContain(`ALTER TABLE addon_items ADD COLUMN ${c} `);
      expect(changes, c).toContain(`\`${c}\``);
    }
    expect(m0059).toContain('CREATE TABLE drop_addons (');
    expect(m0059).toContain('ALTER TABLE addon_choices ADD COLUMN text text NULL');
    expect(m0059).toContain('ALTER TABLE order_addon_items ALTER COLUMN location_id DROP NOT NULL');
    expect(changes).toContain(`(\`text_max\`, ${ADDON_TEXT_MAX.min} à ${ADDON_TEXT_MAX.max}, ${ADDON_TEXT_MAX.max} partout)`);
    for (const t of ['`drop_addons`', '`addon_choices.text`']) expect(changes, t).toContain(t);
    const m0060 = migration('0060_release_addons_converted');
    expect(m0060).toContain('CREATE TABLE addon_conversions (');
    for (const t of ['live_entry_addons', 'live_addons', 'engraving_prices']) {
      expect(m0060, t).toContain(`\`DROP TABLE ${t}\``);
      expect(changes, t).toContain(`\`${t}\``);
    }
    expect(changes).toContain('`addon_conversions`');
    expect(runbook).toContain('| ADD-ONS ONE SYSTEM (lot Q2) |');
    expect(changes).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    // History stays as sold (N15): the orders' snapshot and the engraving's price are kept.
    expect(m0060).not.toMatch(/ALTER TABLE orders\b/);
    expect(changes).toContain('Les add-ons des anciennes commandes (`orders.addons`) et leur gravure (`engraving_minor`) restent tels que vendus.');
    // The files the commit adds under migrations since Q1, and nothing else there.
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${Q1_SHA} HEAD -- genome/src/server/db/migrations`);
    const added = git(['diff', '--name-status', Q1_SHA, '--', 'genome/src/server/db/migrations']);
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
    expect(runbook).toContain(`previous image tag: ${Q1_TAG}`);
    expect(runbook).toContain(`(previous: ${Q1_TAG}). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      `orbes-genome:${Q1_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${Q1_TAG} refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_Q2> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).`,
    );
    expect(readDoc('deploy/vps/scripts/lib.sh')).toContain("words() { local s=\"${1//$'\\n'/, }\"; printf '%s' \"${s%, }\"; }");
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_Q2> OK (previous ${Q1_TAG}; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // Q1 as the last deployment: its log line exactly as Q1's runbook expects it, with Q1's and M3's images.
    const q1Line = `deploy ${Q1_TAG} OK (previous ${M3_TAG}; migrations ${Q1_LAST})`;
    expect(runbook).toContain(`\`… ${q1Line}\``);
    expect(readDoc('docs/launch/DEPLOY-OQ-Q1.md')).toContain(`deploy <TAG_Q1> OK (previous ${M3_TAG}; migrations ${Q1_LAST})`);
    expect(Q1_SHA.slice(0, 12)).toBe(Q1_TAG);
    expect(runbook).toContain(`Sortie attendue : \`${Q1_SHA}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${Q1_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${Q1_SHA.slice(0, 7)}..<7 caractères de SHA_Q2>\``);
    expect(runbook).toContain("**Q2 ne part qu'après Q1, ou avec lui**");
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain(`Si la dernière ligne OK de \`.state/deploys.log\` nomme une autre image que \`${Q1_TAG}\` (Q1 pas encore en production, et Q2 part alors avec lui`);
    // Q1's deployed commit is the base of this lot: the build branch holds it (a full clone only).
    const base = git(['merge-base', '--is-ancestor', Q1_SHA, 'HEAD']);
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
    expect(trouble).toContain(`\`── rollback to orbes-genome:${Q1_TAG}\` et \`rolled back to ${Q1_TAG}; the stack is healthy\``);
    expect(trouble).toContain('`WARNING: deployment of <TAG_Q2> failed (…) and is KEPT`');
    expect(trouble).toContain(`**jamais \`scripts/deploy.sh --image ${Q1_TAG}\`**`);
    // 0060's refusals: up while a release add-on is chosen on a hold under way, down once a conversion happened; 0059's
    // down while a service, an engraving or a pick exists.
    expect(trouble).toContain('`migration 0060_release_addons_converted cannot be applied: <n> release add-ons are chosen on entries in TURN or SECURED`');
    expect(migration('0060_release_addons_converted')).toContain("RAISE EXCEPTION 'migration 0060_release_addons_converted cannot be rolled back: % add-on conversions exist'");
    expect(trouble).toContain("le `down` de `0060_release_addons_converted` refuse dès qu'une conversion a eu lieu");
    expect(migration('0059_addons_one_system')).toContain("RAISE EXCEPTION 'migration 0059_addons_one_system cannot be rolled back: % service add-ons, % engraving add-ons, % add-ons picked by releases");
    expect(trouble).toContain("celui de `0059_addons_one_system` dès qu'un service, une gravure ou le choix d'une release existe");
    expect(trouble).toContain('Un add-on converti que tu ne veux pas se met de côté (`Set aside`), jamais par la base.');
    expect(ADDONS_TEXT.setAside).toBe('Set aside');
  });

  it('holds the owner’s rules: the review board and the conversion shown first, every time in Paris first, no LIVE release running, the pre-check, nothing on the host changes, the legal version', () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur le tableau de revue d'abord.**");
    // Paris first, UTC in brackets: DEPLOY-OQ-Q1's rule 2 word for word, and the expected output of `date -u`.
    const night = "**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)";
    const hub = "03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)";
    for (const line of [night, hub]) {
      expect(rules, line).toContain(line);
      expect(section(readDoc('docs/launch/DEPLOY-OQ-Q1.md'), '## 0.'), line).toContain(line);
    }
    expect(runbook.replace(/\*\*/g, '')).toContain("Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite (03:00–05:30 UTC)");
    expect(runbook).toContain('03:00–03:10 et 03:45–03:55 à Paris');
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC, l'heure que `date -u` affiche)");
    // Every UTC time sits in brackets after its Paris time; every clock time outside brackets is a Paris one.
    const bare = outsideBrackets(runbook);
    expect(bare).not.toMatch(/\d{2}:\d{2}[^\n]{0,12}UTC/);
    expect(bare).not.toMatch(/UTC[^\n]{0,4}\d{2}:\d{2}/);
    const paired = [...runbook.matchAll(/<heure>[^\n(]{0,30}\(<heure>[^)]*UTC\)/g)];
    expect(paired.length).toBeGreaterThanOrEqual(2);
    for (const m of paired) expect(m[0]).toMatch(/Paris/);
    expect(runbook).toContain('déployée le 24 octobre 2026 à 18:35 à Paris (16:35 UTC)');
    // Rule 3: no LIVE release between its room's opening and its end (0060 refuses a hold under way), read before the
    // launch and again just before it; no TEST ENTRANTS test running.
    expect(rules).toContain("**Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.**");
    expect(rules).toContain('`0060_release_addons_converted` refuse de s\'appliquer tant qu\'un add-on de release est choisi sur une tenue en cours');
    const before = section(runbook, '### 1.1');
    const reads = fenced(before, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([psql(`select count(*) from drops where ${ROOM_SOON}`), psql('select count(*) from test_runs where ended_at is null'), ...PRE_CHECK.map(psql)]);
    expect(fenced(readDoc('docs/launch/DEPLOY-OQ-Q1.md'), 'bash')).toContain(psql(`select count(*) from drops where ${ROOM_SOON}`));
    expect(fenced(section(runbook, '### 1.4'), 'bash')[0]).toBe(psql(`select count(*) from drops where ${ROOM_SOON}`));
    expect(readDoc('genome/src/server/db/migrations/0024_z_test_entrants.ts')).toContain("CONSTRAINT test_runs_ended CHECK ((status = 'ENDED') = (ended_at IS NOT NULL)");
    // The pre-check reads what 0060 reads: the tables 0021 and 0039 made, its refusal (an entry in TURN or SECURED has
    // neither confirmed_at nor ended_at), its merge by name, its labels, and the releases it gives a pick (not ended).
    const m0060 = migration('0060_release_addons_converted');
    expect(migration('0021_live_release')).toMatch(/CREATE TABLE live_addons \(/);
    expect(migration('0021_live_release')).toMatch(/CREATE TABLE live_entry_addons \(/);
    expect(migration('0039_order_delivery')).toMatch(/CREATE TABLE engraving_prices \(/);
    // TURN and SECURED carry neither ended_at nor confirmed_at (0021's CHECKs), so the runbook's count holds 0060's.
    expect(migration('0021_live_release')).toContain("CONSTRAINT live_entries_status_turn CHECK (status <> 'TURN' OR (turn_at IS NOT NULL AND secured_at IS NULL AND ended_at IS NULL))");
    expect(migration('0021_live_release')).toContain("CONSTRAINT live_entries_status_secured CHECK (status <> 'SECURED' OR (secured_at IS NOT NULL AND confirmed_at IS NULL AND ended_at IS NULL))");
    expect(migration('0021_live_release')).toContain('CONSTRAINT live_entries_confirmed_after CHECK (confirmed_at IS NULL OR (secured_at IS NOT NULL AND confirmed_at >= secured_at))');
    expect(m0060).toContain("SELECT count(*) INTO held FROM live_entry_addons x JOIN live_entries e ON e.id = x.entry_id WHERE e.status IN ('TURN', 'SECURED');");
    expect(m0060).toContain('SELECT id INTO v_addon FROM addon_items WHERE lower(name) = lower(g.name);');
    expect(m0060).toContain('SELECT DISTINCT ON (upper(btrim(a.label))) upper(btrim(a.label)) AS key, btrim(a.label) AS name');
    expect(m0060).toContain("(d.drawn_at IS NULL OR d.drawn_at + make_interval(hours => d.purchase_window_hours) > now()) END");
    expect(m0060).toContain("CASE WHEN d.mode = 'LIVE' THEN d.ended_at IS NULL");
    expect(m0060).toContain('FOR c IN SELECT currency, price_minor, updated_by FROM engraving_prices ORDER BY currency LOOP');
    for (const q of commands.filter((c) => c.includes('psql'))) {
      expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop table|truncate|create)\b/i);
      // A string literal would end the shell's single quotes.
      expect(q.slice(q.indexOf('-Atc "'), q.lastIndexOf('"')), q).not.toContain("'");
    }
    // What each pre-check line means, and what to do when it is not the expected one.
    expect(before).toContain('Sortie attendue : `0`. Un autre nombre : une LIVE RELEASE a une tenue en cours ; attends sa fin.');
    expect(before).toContain('Si ENGRAVING y figure (un add-on avec stock de M3 nommé ainsi), il reste tel quel et ne devient pas la gravure : dis-le à Claude avant de déployer.');
    expect(before).toContain('`EUR|3000` pour 30 € par exemple');
    expect(before).toContain('`<add-ons>|<LIVE>|<tirages>`');
    // The conversion shown before the deploy (D5, A 16:00–16:02 line 4), on the review board with the console's names.
    expect(before).toContain('**2. La conversion, vue avant** (D5).');
    expect(before).toContain("ce que `Catalogue` → `Add-ons` lira après la conversion (chaque add-on, son type, ses prix par devise, ses interrupteurs, « Converted from… ») et ce que chaque release ouverte proposera (son choix)");
    expect(before).toContain('`Catalogue` → `Add-ons` après la conversion (noms, prix par devise, interrupteurs, « Converted from… »)');
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768', "l'écran 5b"]) expect(before, what).toContain(what);
    // Client Services told before: the playbook's add-ons and engraving sections, in both copies.
    expect(before).toContain('§2 « Les compléments (add-ons) » et « L\'adresse et la gravure du client »');
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const two = section(readDoc(copy), '## 2.');
      expect(two, copy).toContain('### Les compléments (add-ons)');
      expect(two, copy).toContain("### L'adresse et la gravure du client");
    }
    // No slot booked: the three conditions, the heads-up at launch in Paris then UTC.
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("le diff de `deploy/vps` vide après l'avance rapide");
    expect(section(runbook, '### 1.4')).toContain(
      "**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement ADD-ONS lancé à <heure> Paris (<heure> UTC), deux migrations, rien ne change sur l'hôte. »",
    );
    // Nothing on the host changes: the deploy/vps diff against Q1 in production is empty, no .env line.
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${Q1_SHA} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('-- deploy/vps\n```\n\nSortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.');
    const diff = git(['diff', '--name-status', Q1_SHA, '--', 'deploy/vps']);
    const log = git(['log', '--no-merges', '--format=%H %s', `${Q1_SHA}..HEAD`, '--', 'deploy/vps']);
    if (diff !== null && log !== null) {
      expect(log.trim().split('\n').filter((l) => / OQ-Q2\./.test(l))).toEqual([]);
      if (!log.trim()) expect(diff.trim()).toBe('');
    }
    expect(section(runbook, '### 1.2')).toContain("Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n'y touches pas.");
    // No secret: .env is only ever read for two lines, and never shown whole.
    for (const c of commands.filter((x) => x.includes('.env'))) expect(["grep '^ORBES_IMAGE_TAG=' .env", "grep -n '^RESTORE_ALLOWED=' .env"]).toContain(c);
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
    // A later lot (Q3, M4) may move LEGAL_VERSION past it; Q2's head publishes Q2's.
    expect(LEGAL_VERSION >= Q2_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${Q2_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement');
    expect(rules).toContain('La politique de confidentialité ne change pas.');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${Q2_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(source('web/legal/content/index.ts')).toContain(`${Q2_LEGAL_VERSION} is the version of lot Q2, ADD-ONS ONE SYSTEM`);
  });

  it('checks the box after the migrations, what the conversion wrote read only, the legal version, and tells the host with the swap', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual(POST_CHECK.map(psql));
    // The columns and the table it reads are 0059's and 0060's; a converted add-on as 0060 inserts it.
    const m0060 = migration('0060_release_addons_converted');
    expect(m0060).toContain("VALUES (g.name, g.line, v_position, 'SERVICE', true, false, false, false,");
    expect(m0060).toContain("VALUES (v_name, NULL, v_position, 'SERVICE', false, false, false, true, true)");
    expect(after).toContain('Ceux de M3 : `<nom>|PRODUCT|t|t|t|t|f|20`. Un converti : `<NOM>|SERVICE|t|f|f|f|f|20`');
    expect(after).toContain('`ENGRAVING_PRICES|<n>|<n>`');
    expect(after).toContain('`LIVE_ADDON|<total>|<avec prix>`');
    // The box's figures before and after, the swap line read; the host told at launch and after, swap included.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(after).toContain("**Préviens le responsable de l'hôte** : « ADD-ONS fait à <heure> Paris (<heure> UTC), deux migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »");
    // The console after the conversion, in its words.
    expect(source('web/admin/model/addons.ts')).toContain('`Converted from the add-ons of ${releases.map((c) => c.release!.title).join(\', \')}');
    expect(source('web/admin/model/addons.ts')).toContain("out.push('Converted from Orders → Settings, Engraving');");
    expect(after).toContain('« Converted from Orders → Settings, Engraving »');
    expect(addonEngravingText({ engraving: true, textMax: 20 })).toBe('ENGRAVING · 20 characters at most');
    expect(after).toContain(said(addonEngravingText({ engraving: true, textMax: 20 })!));
    const settingsLine = `${ENGRAVING_SETTINGS_TEXT.before}${ENGRAVING_SETTINGS_TEXT.link}${ENGRAVING_SETTINGS_TEXT.after}`;
    expect(after).toContain(said(settingsLine));
    expect(after).toContain(`\`${PICK_TEXT.label}\`, les add-ons proposés en LIVE déjà cochés`);
    // From the Mac: health and the legal version in the published bundle.
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/health');
    expect(after).toContain('Sortie attendue : `{"ok":true,"version":"0.1.0"}`.');
    expect(readDoc('genome/src/server/http/static.ts')).toContain("app.get('/legal', legal);");
    expect(commands).toContain(
      `curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\\.js' | head -1)" | grep -o '${Q2_LEGAL_VERSION}' | head -n 1`,
    );
    expect(after).toContain(`Sortie attendue : \`${Q2_LEGAL_VERSION}\`.`);
  });

  it('checks each element for real, phone and computer, dark and light, in the console’s and the app’s words', () => {
    const real = section(runbook, '### 1.7');
    const catalogue = section(runbook, '#### 1.');
    const live = section(runbook, '#### 2.');
    expect(real).toContain('**A** sur ton téléphone (Safari), **B** sur ton ordinateur, dans une fenêtre de navigation privée');
    // 1. A GIFT WRAPPING service: SERVICE, no supplier, no stock, never in Logistics nor a supplier order.
    const views = source('web/admin/views/addons.ts');
    for (const w of ["label: 'Type'", "label: 'SKU code'", "shown: (v) => !service(v)", "confirmLabel: a ? 'Save' : 'Add'"]) expect(views, w).toContain(w);
    expect(ADDON_KIND_LABELS.SERVICE).toBe('SERVICE');
    expect(catalogue).toContain(`\`Type\` \`${ADDON_KIND_LABELS.SERVICE}\` (le champ \`Supplier\` disparaît), \`Name\` \`GIFT WRAPPING\``);
    expect(catalogue).toContain(`\`Add\` : ${said(ADDONS_TEXT.added)} Sa ligne lit \`SERVICE\`, \`${ADDONS_TEXT.noStock}\`, et LIVE, DRAW, SALON, YOUR ORDERS.`);
    expect(ADDON_SWITCHES.map((s) => s.mark)).toEqual(['LIVE', 'DRAW', 'SALON', 'YOUR ORDERS']);
    // 0060 converts a release add-on as a SERVICE offered at a LIVE purchase only: an existing GIFT WRAPPING is opened up.
    expect(migration('0060_release_addons_converted')).toContain("VALUES (g.name, g.line, v_position, 'SERVICE', true, false, false, false,");
    expect(catalogue).toContain(`Si la conversion a déjà fait un GIFT WRAPPING (proposé en LIVE seulement), prends-le : \`Edit\`, coche les quatre interrupteurs, un \`Price in EUR\`, \`Save\` : ${said(ADDONS_TEXT.saved)}`);
    expect(catalogue).not.toContain('prends-le tel quel');
    // The settings' engraving takes the next free name (ENGRAVING 2, …) when ENGRAVING is already in the catalogue.
    expect(migration('0060_release_addons_converted')).toContain("v_name := 'ENGRAVING ' || v_n;");
    expect(runbook).toContain('`ENGRAVING|SERVICE|f|f|f|t|t|20` quand elle naît des seuls Réglages (`ENGRAVING 2|…` si ton catalogue avait déjà un add-on nommé ENGRAVING).');
    const neverListed = 'A service, such as the engraving, has no stock: it is never listed here.';
    expect(ADDON_SKU_TEXT.groupLead).toContain(neverListed);
    expect(catalogue).toContain(`\`Logistics\` → \`Stock\`, section \`${ADDON_SKU_TEXT.group}\` : GIFT WRAPPING n'y est pas, et le texte de la section le dit : ${said(neverListed)}`);
    expect(catalogue).toContain("Dans `Supplier orders`, aucune proposition ne le nomme, et un service n'a jamais de fournisseur");
    expect(source('server/services/sku-owner.ts')).toContain('ADDON_SERVICE');
    // The engraving: its price, its switches, its most characters (1 to 20), saved.
    const live0 = ADDON_SWITCHES.find((s) => s.key === 'live')!.label;
    const orders0 = ADDON_SWITCHES.find((s) => s.key === 'orders')!.label;
    const salon0 = ADDON_SWITCHES.find((s) => s.key === 'salon')!.label;
    expect(catalogue).toContain(`\`${live0}\` et \`${orders0}\` cochés, \`${ADDONS_TEXT.textMax}\` \`20\` (ou ton choix, §2), puis \`Save\` : ${said(ADDONS_TEXT.saved)}`);
    expect(catalogue).toContain(`\`${ADDONS_TEXT.engraving}\` coché, \`${ADDONS_TEXT.textMax}\``);
    expect(catalogue).toContain(said(addonEngravingText({ engraving: true, textMax: 20 })!));
    // 2. The test LIVE release picking GIFT WRAPPING, ENGRAVING and an add-on with stock, in the console's words.
    const club = source('web/admin/views/club.ts');
    expect(club).toContain("button('New live release'");
    expect(live).toContain(`\`People per batch\` \`2\`, \`Every (minutes)\` \`1\`, \`${LIVE_HOLD_LABEL}\` \`0\`, \`Price of a piece\` \`1\`, \`Currency\` \`EUR\`, \`Sizes\` \`52 = 2\``);
    expect(live).toContain(`Sous \`${PICK_TEXT.label}\`, les add-ons proposés en LIVE avec un prix en EUR sont déjà cochés (N7)`);
    expect(live).toContain(`(${said(pickWhy('SWITCH_OFF', 'LIVE', 'EUR'))}, ${said(pickWhy('NO_PRICE', 'LIVE', 'EUR'))})`);
    expect(live).toContain('Décoche tout sauf GIFT WRAPPING, ENGRAVING et ton add-on avec stock. `Create release`.');
    expect(live).toContain(`YOUR ACCOUNT, ${MODE.label} (sous ${SOUND.label}) allumé`);
    expect(ACCOUNT.title).toBe('YOUR ACCOUNT');
    // 5b on the phone: production's lines in order (D14), the rows, M3's note, PAY with its total and its time.
    expect(live).toContain(`${LIVE.secured}, ${LIVE.yourPiece}, SECURED AT, le nom, SIZE 52, puis ${LIVE.addons} : trois lignes entre des filets`);
    expect(live).toContain(`${said(LIVE.addonPrice('€ 15'))} à droite`);
    expect(live).toContain(`${said(LIVE.addonItems.note)} sous les lignes`);
    expect(live).toContain(`(${said(LIVE.pay('€ 1', '04:52'))} par exemple)`);
    // YOUR TEXT and its count against the engraving's most characters; PAY's new total; words refused, the row kept.
    expect(live).toContain(`sous ENGRAVING, ${LIVE.addonText.label} et son compte ${said(LIVE.addonText.count(5, 20))} (le nombre de \`${ADDONS_TEXT.textMax}\`)`);
    expect(live).toContain(`PAY lit le nouveau total (${said(LIVE.pay('€ 46', '04:20'))} avec 15 € et 30 €)`);
    expect(live).toContain(`${said(LIVE.addonText.invalid(20))} ; la ligne reste choisie`);
    // 5b on a computer, in light mode: the room stays dark, the rows above PAY, PAY first only when they would push it down.
    expect(live).toContain('La salle reste sombre en mode clair ; en bas à droite, ADD-ONS et ses lignes au-dessus de PAY (PAY passe d\'abord seulement si les lignes le pousseraient sous le premier écran)');
    // CONFIRMED's receipt; the console's order page: a service held nowhere.
    expect(live).toContain('le reçu lit chaque add-on choisi avec son prix, puis TOTAL');
    expect(ORDER_ADDONS_TEXT.service).toBe('Service');
    expect(ADDON_STATUS_LABELS.HELD).toBe('HELD');
    expect(live).toContain(`GIFT WRAPPING avec \`${ORDER_ADDONS_TEXT.service}\`, jamais un entrepôt`);
    // YOUR ORDERS: the engraving bought (never removed), ADD AN ADD-ON without it; an ended release's order still offered both.
    const e = ORDERS.engraving;
    expect(live).toContain(`ENGRAVING : \`${e.value('M. B.', null)}\`, ${e.change} et ${said(e.included)}, jamais ${e.remove}`);
    expect(live).toContain(`${ORDERS.addons.add} ouvre la feuille : les add-ons proposés dans YOUR ORDERS, jamais ENGRAVING`);
    expect(live).toContain(`${ORDERS.addons.title} : GIFT WRAPPING et ton add-on, ${ORDERS.addons.remove} sur chacun`);
    expect(live).toContain(`La sortie est finie, et pourtant ${ORDERS.addons.add} propose toujours les add-ons, et ENGRAVING propose ${e.add}, comme aujourd'hui.`);
    expect(live).toContain(`${e.add}, \`J.M.\`, ${e.save} : \`${e.value('J.M.', '€ 30')}\` ; puis ${e.remove}`);
    // The clean-up: the two orders cancelled, in the console's words.
    const order = source('web/admin/views/order.ts');
    for (const w of ["button('Cancel'", "title: 'Cancel the order'", "confirmLabel: 'Cancel the order'", "done('Order cancelled.')"]) expect(order, w).toContain(w);
    expect(live).toContain('`Cancel`, la boîte « Cancel the order », `Note` `Test`, puis `Cancel the order` : « Order cancelled. »');
    // 3. A draw picking one, a draft never published.
    const draw = section(runbook, '#### 3.');
    expect(club).toContain("notify('Release created as a draft.')");
    expect(draw).toContain(`\`${OFFER_TEXT.label}\` \`${OFFER_TEXT.model}\``);
    expect(draw).toContain(`\`${PICK_TEXT.label}\`, les add-ons proposés à un tirage cochés. Décoche tout sauf GIFT WRAPPING, puis \`Save\` : ${said(PICK_TEXT.saved)}`);
    expect(draw).toContain("**N'appuie jamais sur `Publish`.**");
    expect(source('web/admin/views/drop.ts')).toContain("button('Edit', { kind: 'ghost', testId: 'drop-edit-addons'");
    // 4. The salon follows its switch alone.
    const salon = section(runbook, '#### 4.');
    expect(salon).toContain(`Dans ${LOOKBOOK.reserved}, sur A, un modèle réservé avec un prix : ${LOOKBOOK.salon.addons.title} liste GIFT WRAPPING`);
    expect(salon).toContain(`décoche \`${salon0}\`, \`Save\``);
    // 5. The packing checklist, one line per add-on, the engraving's own line.
    const parcels = source('server/services/parcels.ts');
    expect(parcels).toContain('label: `Add-on: ${a.name} × ${a.units}`');
    expect(parcels).toContain('label: `Engraving done: "${o.engraving_text}"`');
    expect(section(runbook, '#### 5.')).toContain('« Add-on: GIFT WRAPPING × 1 » par exemple, un service compris ; la gravure a sa ligne « Engraving done: "M. B." »');
    // 6. The Shopify product export: a service is not shipped.
    const shopify = source('server/services/shopify.ts');
    expect(shopify).toContain("'Requires shipping': a.kind === 'SERVICE' ? 'false' : 'true',");
    expect(shopify).toContain('filename: `ORBES-shopify-products-${currency}-${day}.csv`');
    expect(source('web/admin/views/catalogue.ts')).toContain("button('Shopify export'");
    expect(source('web/admin/views/catalogue.ts')).toContain("label: 'The store’s currency'");
    expect(section(runbook, '#### 6.')).toContain('`Weight value (grams)` vide et `Requires shipping` `false` ; ton add-on avec stock, `Requires shipping` `true`');
    // 7. The legal pages: the version line and the three paragraphs Q2 changed.
    const legal = section(runbook, '#### 7.');
    expect(legal).toContain(said(WORDS.en.version(Q2_LEGAL_VERSION)));
    const terms = JSON.stringify(TERMS.en);
    for (const p of ['Your piece.', 'Delivery.', 'Add-ons.']) {
      expect(terms, p).toContain(`**${p}**`);
      expect(legal, p).toContain(said(p));
    }
  });

  it('leaves the owner’s open points and the data to enter, gives one command per shell block, in French, links only to what exists, linked from DEPLOYMENT and COMPLIANCE', () => {
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5]);
    expect(open).toContain('**Une par pièce sur l\'écran 5b** (N1).');
    expect(open).toContain('On garde, ou un sélecteur sur la ligne choisie ?');
    expect(open).toContain(`**Le nombre de caractères de la gravure** (N3). Il se règle sur l'add-on ENGRAVING (\`Catalogue\` → \`Add-ons\`, \`${ADDONS_TEXT.textMax}\`, de ${ADDON_TEXT_MAX.min} à ${ADDON_TEXT_MAX.max}).`);
    expect(open).toContain(`La gravure convertie garde les ${ADDON_TEXT_MAX.max} de la maison, comme YOUR ORDERS aujourd'hui ; la maquette montrait 12 (« 5 / 12 »)`);
    expect(open).toContain('Mets 12 sur ENGRAVING si tu veux celui de la maquette.');
    expect(open).toContain('**Les add-ons convertis, à garder ou à mettre de côté** (N6).');
    expect(open).toContain('**Le choix par défaut d\'une nouvelle release** (N7)');
    expect(open).toContain('(la note au juriste, point 36)');
    expect(readDoc('docs/legal/counsel-note.fr.md')).toContain('36. **Les articles complémentaires** (CGU articles 13 et 14 ; R104, R153, R180 à R184 ; lot M3, version 2026-10-23 ; lot Q2, version 2026-10-25)');
    // The data to enter after, in the console's words.
    const data = section(runbook, '### 1.8');
    for (const w of ['`Set aside`', '`WITH STOCK`', `\`${PICK_TEXT.label}\``, `\`${ADDONS_TEXT.textMax}\``, '`Shopify`']) expect(data, w).toContain(w);
    expect(ADDON_KIND_LABELS.PRODUCT).toBe('WITH STOCK');
    // One command per shell block; the house's runbook shape, in French, for the owner.
    expect(commands.length).toBeGreaterThan(40);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(commands).toContain('docker compose exec app node --import tsx scripts/db.ts status');
    expect(runbook.startsWith('# Mise en production du lot ADD-ONS ONE SYSTEM (Q2)\n\nCe document est pour toi, le propriétaire.')).toBe(true);
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
    // §1.0 in plain words: one system, the switches, each release's pick, services, the engraving, the conversion, 5b,
    // what does not change.
    const changes = section(runbook, '### 1.0');
    for (const w of ['**Un seul système d\'add-ons.**', '**Avec stock, ou service.**', '**Quatre interrupteurs par add-on**', '**Chaque release choisit les siens**', '**La gravure et ses mots.**', '**La conversion**', "**L'écran 5b**", '**Ce qui ne change pas**']) {
      expect(changes, w).toContain(w);
    }
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(runbook).toContain('[son runbook](DEPLOY-OQ-Q1.md)');
    const deployment = readDoc('docs/DEPLOYMENT.md');
    expect(deployment).toContain('[DEPLOY-OQ-Q2](launch/DEPLOY-OQ-Q2.md)');
    expect(deployment).toContain('and lot Q2, ADD-ONS ONE SYSTEM (only the catalogue\'s add-ons, each a product with stock or a service without stock');
    expect(deployment).toContain('one deployment after Q1 or with it with migrations `0059_addons_one_system` and `0060_release_addons_converted`');
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 13.');
    expect(compliance).toContain('(launch/DEPLOY-OQ-Q2.md)');
    expect(compliance).toContain('(la note au juriste, point 36)');
    // Never the words the brand keeps out of what it says.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
  });
});
