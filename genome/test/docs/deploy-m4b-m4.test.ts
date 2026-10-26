/**
 * docs/launch/DEPLOY-M4B-M4.md, the owner's runbook for lot M4 of the macro scope rebuilt on ONE QUEUE (plan M4 §9,
 * step M4.16: K43 the margin, K49 partner experiences, K27 the conversions built and switched off), against the
 * scripts, the migrations, the server, the console and the app it quotes:
 *
 *  - it starts from production as lot Q3 left it (0001 to 0062, its image <TAG_Q3>) and applies exactly 0063_margin,
 *    0064_partners and 0065_ad_conversions, as the scripts print them, each count and name derived from MIGRATIONS
 *    (never a written number); Q3's image no longer runs on the schema after them, so a failure after them is repaired
 *    forward, and the downs refuse once margin, partner or advertising data exists;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh, db.ts and the app is still one they print;
 *  - the owner's rules (memory deploy-wait-for-host-ok, times-in-paris): the screens first, the host's hours at winter
 *    time (Paris UTC+1 since 25 October 2026) pinned in §0 and §1.1 as deploy-oq-q3.test.ts pins Q3's, never the summer
 *    window 05:00–07:30, every time in Paris first with UTC in brackets, no LIVE release between its room's opening and
 *    its end, no TEST ENTRANTS test running, no slot booked and the one-line heads-up, the guarded launch, nothing on the
 *    host changes (deploy/vps untouched, no .env line: the ADS_* keys wait for the activation day), restore.sh only ever
 *    run to watch it refuse, no prune, the legal version (L2);
 *  - the post-check: 66 `applied` lines, the twelve new tables empty, the conversions read off from the Mac, the
 *    sixteen sounds and the legal version in the published bundles, the console's new pages in their empty states;
 *  - one real check per element in the console's and the app's words as the code has them: the margin's settings
 *    (GBP, USD, CHF, a FRANCE band and ALL OTHER COUNTRIES, POUCH, CARD, THE VAULT CARD, an allowance), a real order's
 *    margin by hand and THE VAULT line, a partner with a DRAFT experience and a DRAFT invitation and no invoice issued
 *    for a check, the conversions OFF with SWITCH ON refused and, on the phone and on a computer, no banner and no
 *    ADVERTISING MEASUREMENT row, the legal pages;
 *  - §2, the activation day: counsel first, the ADS_* names as config.ts reads them, the keys entered by the owner in
 *    the server's .env and never in chat (A5), the deployment agreed with the host that opens the four fixed hosts, the
 *    pinned API versions, the console's switch and the banner; §3, the owner's decisions (plan §13);
 *  - one command per shell block, French, links that resolve, linked from DEPLOYMENT and COMPLIANCE.
 *
 * <SHA_Q3>, <TAG_Q3>, <SHA_M4> and <TAG_M4> stay placeholders until the main session hands the commits over.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countryName } from '../../src/shared/countries.js';
import { ADS_HOSTS } from '../../src/server/ads/http.js';
import { GOOGLE_ADS_API_VERSION } from '../../src/server/ads/google.js';
import { META_GRAPH_VERSION } from '../../src/server/ads/meta.js';
import { TIKTOK_API_VERSION } from '../../src/server/ads/tiktok.js';
import { ADS_ENV } from '../../src/server/config.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { HASHED_ASSET_RE } from '../../src/server/http/static.js';
import { CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { ADS_SWITCH_PHRASES, ADS_TEXT_VERSION } from '../../src/server/services/ads.js';
import { AD_PLATFORMS_TEXT, PLATFORM_LABELS } from '../../src/web/admin/model/ad-platforms.js';
import { CIRCLE_EXPERIENCE_LABELS, CIRCLE_KIND_LABELS } from '../../src/web/admin/model/circle.js';
import { CLUB_TABS } from '../../src/web/admin/model/club.js';
import { MARGIN_TAB_LABELS } from '../../src/web/admin/model/growth.js';
import { LINKS_COPY } from '../../src/web/admin/model/links.js';
import { MARGIN_SETTINGS_TEXT, rateLine } from '../../src/web/admin/model/margin-settings.js';
import { MARGIN_TEXT, MARGIN_VAULT_WORDS, unitCostLabel } from '../../src/web/admin/model/margin.js';
import { EXPERIENCE_STATE_LABELS, experienceOptionLabel, guestsLine, ISSUED_TO_LABELS, PARTNER_INCOME_EMPTY, PARTNERS_TEXT } from '../../src/web/admin/model/partners.js';
import { VAULT_COPY } from '../../src/web/admin/model/vault.js';
import { LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { ADS_SECTION, ADS_SINCE } from '../../src/web/legal/content/privacy-ads.js';
import { PRIVACY } from '../../src/web/legal/content/privacy.js';
import { CIRCLE, CONSENT } from '../../src/web/verify/copy.js';
import { ALL_SOUNDS } from '../../src/web/verify/live-sound.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-M4B-M4.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Production before lot Q3 (lot Q2, ADD-ONS ONE SYSTEM, image 5e0518fe53cd) and lot Q3 as proven and CI-green, the base of lot M4. */
const Q2_SHA = '5e0518fe53cdedd6b2512538e78f70f519d16afa';
const Q2_TAG = '5e0518fe53cd';
const Q3_BASE = '76fcfb562bae1a8ebe4c223f5aacd4e4d5e7a0cb';
/** The legal version of lot M4 (step M4.14), Q3's before it, and the ORBES CARE conditions', unchanged since ORBES CARE. */
const M4_LEGAL_VERSION = '2026-10-27';
const Q3_LEGAL_VERSION = '2026-10-26';
const CARE_VERSION = '2026-10-15';

const NAMES = Object.keys(MIGRATIONS);
/** Lot Q3's migrations, and lot M4's three (plan M4 §1.1, §2.1, §3.1), renumbered after Q3's (D61). */
const Q3_NAMES = ['0061_the_vault', '0062_vault_rewards'];
const Q3_LAST = Q3_NAMES.at(-1)!;
const M4_NAMES = ['0063_margin', '0064_partners', '0065_ad_conversions'];
const DEPLOY = NAMES.slice(NAMES.indexOf(Q3_LAST) + 1).filter((n) => M4_NAMES.includes(n));
const BEFORE = NAMES.slice(0, NAMES.indexOf(Q3_LAST) + 1);
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
];

/** A read-only query of the box, as the runbook writes it. */
const psql = (query: string) => `docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "${query}"'`;

/** A LIVE release whose room is open or opens within the hour (DEPLOY-OQ-Q1's, Q2's and Q3's own read, word for word). */
const ROOM_SOON = 'room_opens_minutes is not null and published_at is not null and ended_at is null and cancelled_at is null and opens_at - make_interval(mins => room_opens_minutes + 60) < now()';

/** The twelve new tables and columns, read after the deploy (§1.6), one read per migration, each counting what it holds. */
const POST_CHECK: ReadonlyArray<readonly [migration: string, counted: readonly string[]]> = [
  ['0063_margin', ['currency_rates', 'shipping_cost_rates', 'margin_unit_costs', 'category_allowances']],
  ['0064_partners', ['partners', 'partner_experiences', 'partner_invoices', 'circle_posts where partner_experience_id is not null', 'circle_rsvps where share_name']],
  ['0065_ad_conversions', ['ads_settings', 'ads_channel_platforms', 'ad_consents', 'ad_clicks', 'ad_events']],
];
const countsOf = (counted: readonly string[]) => `select ${counted.map((c) => `(select count(*) from ${c})`).join(', ')}`;

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

describe('the runbook of lot M4 (docs/launch/DEPLOY-M4B-M4.md)', () => {
  it('starts from lot Q3 in production and applies exactly 0063, 0064 and 0065, as the scripts print them, every count from MIGRATIONS', () => {
    expect(DEPLOY).toEqual(M4_NAMES);
    // M4's migrations follow Q3's at once; a later lot's only ever comes after them.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => n > DEPLOY.at(-1)!)).toBe(true);
    expect(BEFORE.slice(-2)).toEqual(Q3_NAMES);
    expect(runbook).toContain(`avec les ${BEFORE.length} migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : ${BEFORE.length} lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`Une liste qui s'arrête avant \`${Q3_LAST}\` : Q3 n'est pas en production, arrête-toi.`);
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_M4>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    // §1.0's table, one row per migration, and what each adds, as the migrations write it; none inserts a row.
    const changes = section(runbook, '### 1.0');
    expect([...changes.matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1])).toEqual(DEPLOY);
    for (const [name, counted] of POST_CHECK) {
      const m = migration(name);
      for (const c of counted) {
        const table = c.split(' ')[0]!;
        if (c.includes(' where ')) continue;
        expect(m, `${name}: ${table}`).toContain(`CREATE TABLE ${table} (`);
        expect(changes, table).toContain(`\`${table}\``);
      }
      expect(m, name).not.toMatch(/INSERT INTO/i);
    }
    expect(migration('0064_partners')).toContain('ALTER TABLE circle_posts ADD COLUMN partner_experience_id uuid NULL');
    expect(migration('0064_partners')).toContain('ALTER TABLE circle_rsvps ADD COLUMN share_name boolean NOT NULL DEFAULT false');
    expect(migration('0064_partners')).toContain('ALTER TABLE circle_rsvps ADD COLUMN share_name_at timestamptz NULL');
    for (const c of ['`circle_posts.partner_experience_id`, nulle part', '`circle_rsvps.share_name`, décoché partout, et `share_name_at`', '(`ads_settings`, sans ligne : éteint)']) expect(changes, c).toContain(c);
    // THE VAULT CARD among the unit costs 0063 holds (D61), as schema.ts keys it.
    expect(source('server/db/schema.ts')).toContain("'VAULT_CARD'");
    expect(changes).toContain('les coûts unitaires (`margin_unit_costs` : POUCH, CARD, THE VAULT CARD, un service PRIVATE CARE, chaque issue d\'une garantie)');
    expect(changes).toContain('**Les variables** : aucune nouvelle. Ton `.env` ne change pas.');
    expect(runbook).toContain('| M4 (la marge, les partenaires, les conversions éteintes) |');
    // The files the commit adds under migrations since Q3, and nothing else there (a later lot's only after them).
    expect(block('A\tgenome/src/server/db/migrations/')).toEqual(DEPLOY.map((n) => `A\tgenome/src/server/db/migrations/${n}.ts`));
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --name-status <SHA_Q3> HEAD -- genome/src/server/db/migrations');
    const added = git(Q3_BASE, ['diff', '--name-status', Q3_BASE, '--', 'genome/src/server/db/migrations']);
    if (added !== null) {
      const prefix = 'A\tgenome/src/server/db/migrations/';
      const lines = added.trim().split('\n');
      expect(lines.slice(0, DEPLOY.length)).toEqual(DEPLOY.map((n) => `${prefix}${n}.ts`));
      expect(lines.slice(DEPLOY.length).every((l) => l.startsWith(prefix) && l.slice(prefix.length) > `${DEPLOY.at(-1)}.ts`)).toBe(true);
    }
    // db.ts migrate, then deploy.sh's end and its log line, naming Q3's image.
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`**Il faut lire \`Applied ${DEPLOY.length} migration(s)\`.**`);
    expect(runbook).toContain('previous image tag: <TAG_Q3>');
    expect(runbook).toContain(`(previous: <TAG_Q3>). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(
      'orbes-genome:<TAG_Q3> cannot run on this schema any more (scripts/deploy.sh --image <TAG_Q3> refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image <TAG_M4> after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).',
    );
    expect(runbook).not.toContain('Manual rollback:');
    expect(runbook).toContain(`deploy <TAG_M4> OK (previous <TAG_Q3>; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\`, aucune \`PENDING\``);
    // Q3 as the last deployment: its log line exactly as Q3's runbook expects it, with Q2's image.
    const q3Line = `deploy <TAG_Q3> OK (previous ${Q2_TAG}; migrations ${Q3_NAMES.join(', ')})`;
    expect(runbook).toContain(`\`… ${q3Line}\``);
    expect(readDoc('docs/launch/DEPLOY-OQ-Q3.md')).toContain(q3Line);
    expect(runbook).toContain('Sortie attendue : `<SHA_Q3>` au début de la ligne');
    expect(runbook).toContain('Sortie attendue : `ORBES_IMAGE_TAG=<TAG_Q3>`.');
    expect(runbook).toContain('`Updating <7 caractères de SHA_Q3>..<7 caractères de SHA_M4>`');
    expect(runbook).toContain("**M4 ne part qu'après Q3**");
    expect(runbook).toContain('**une commande qui contient encore une de ces marques ne se lance pas**');
    expect(runbook).toContain('Si la dernière ligne OK de `.state/deploys.log` nomme une autre image que `<TAG_Q3>`');
    for (const mark of ['<SHA_Q3>', '<TAG_Q3>', '<SHA_M4>', '<TAG_M4>']) expect(runbook, mark).toContain(`\`${mark}\``);
    // Q3's runbook announced this lot after it, renumbered after its last migration (D61).
    expect(readDoc('docs/launch/DEPLOY-OQ-Q3.md')).toContain(`il renumérote ses migrations après \`${Q3_LAST}\``);
    // Q3's proven head is the base of this lot (a full clone only).
    const base = git(Q3_BASE, ['merge-base', '--is-ancestor', Q3_BASE, 'HEAD']);
    if (base !== null) expect(base).toBe('');
  });

  it('expects from the scripts and the app only messages they print, a rollback only before the migrations, and downs that refuse once data exists', () => {
    for (const [message, src] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(src), `${message}: not in ${src}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(section(runbook, '### 1.4')).toContain("Caddy garde son conteneur, sa configuration n'ayant pas changé.");
    const trouble = section(runbook, '### 1.5');
    expect(trouble).toContain("Le retour en arrière n'existe qu'**avant** les migrations ; après, on répare en avant.");
    expect(trouble).toContain('`── rollback to orbes-genome:<TAG_Q3>` et `rolled back to <TAG_Q3>; the stack is healthy`');
    expect(trouble).toContain('`WARNING: deployment of <TAG_M4> failed (…) and is KEPT`');
    expect(trouble).toContain('**jamais `scripts/deploy.sh --image <TAG_Q3>`**');
    // The downs refuse once data exists, as each migration counts it.
    expect(migration('0063_margin')).toContain(
      "RAISE EXCEPTION 'migration 0063_margin cannot be rolled back: % currency rates, % shipping cost bands, % unit costs and % category allowances exist'",
    );
    expect(migration('0064_partners')).toContain(
      "RAISE EXCEPTION 'migration 0064_partners cannot be rolled back: % partners, % partner experiences, % partner invoices, % invitations linked to an experience and % names shared exist'",
    );
    expect(migration('0065_ad_conversions')).toContain(
      "RAISE EXCEPTION 'migration 0065_ad_conversions cannot be rolled back: % switches on, % advertising choices, % click ids and % ad events exist'",
    );
    expect(trouble).toContain(
      "le `down` de `0065_ad_conversions` refuse dès que l'interrupteur est allumé ou qu'un choix, un identifiant de clic ou un événement existe, celui de `0064_partners` dès qu'un partenaire, une expérience, une facture de partenaire, une invitation liée à une expérience ou un nom partagé existe, et celui de `0063_margin` dès qu'un taux, une tranche d'expédition, un coût unitaire ou une provision existe",
    );
    for (const n of DEPLOY) expect(migration(n), n).not.toMatch(/cannot be applied/);
    // While a fix comes: the conversions left OFF, a setting corrected in the console, a draft experience cancelled.
    expect(trouble).toContain('les conversions restent `OFF`, un réglage de la marge se corrige ou s\'efface dans `Margin settings` (`Edit`, `Clear`, `Remove`), une expérience encore en brouillon s\'annule (`Cancel the experience`)');
    expect([MARGIN_SETTINGS_TEXT.edit, MARGIN_SETTINGS_TEXT.clear, MARGIN_SETTINGS_TEXT.remove]).toEqual(['Edit', 'Clear', 'Remove']);
    expect(PARTNERS_TEXT.cancel).toBe('Cancel the experience');
    expect(trouble).toContain('jamais rien par la base');
  });

  it('holds the owner’s rules: the screens first, the host’s hours at winter time, Paris first, no LIVE release running, nothing on the host changes, the legal version', () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les écrans d'abord.**");
    // The host's hours at Paris winter time (UTC+1 since 25 October 2026), in DEPLOY-OQ-Q3's French words.
    expect(rules).toContain(
      "jamais entre 04:00 et 06:30 à Paris (03:00–05:30 UTC), ni pendant les minutes de sauvegarde du hub : 03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC); Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026",
    );
    expect(rules).toContain('jamais entre 04:00 et 06:30 à Paris');
    expect(rules).toContain('(03:00–05:30 UTC)');
    expect(rules).toContain('03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC)');
    expect(rules).toContain("Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026");
    const q3Rules = section(readDoc('docs/launch/DEPLOY-OQ-Q3.md'), '## 0.');
    expect(q3Rules).toContain('**Jamais entre 04:00 et 06:30 à Paris** (03:00–05:30 UTC)');
    expect(q3Rules).toContain('03:00–03:10 et 03:45–03:55 à Paris (02:00–02:10 et 02:45–02:55 UTC)');
    expect(q3Rules).toContain("Paris est à l'heure d'hiver (UTC+1) depuis le 25 octobre 2026.");
    const before = section(runbook, '### 1.1');
    expect(before).toContain("une heure hors de 04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche)");
    expect(section(readDoc('docs/launch/DEPLOY-OQ-Q3.md'), '### 1.1')).toContain("04:00–06:30 à Paris (03:00–05:30 UTC, l'heure que `date -u` affiche)");
    expect(commands).toContain('date -u');
    // The first plan's window was summer time: never here.
    expect(runbook).not.toContain('05:00–07:30');
    expect(runbook).not.toContain('05:00 et 07:30');
    expect(runbook).not.toContain('UTC+2');
    // Every UTC time sits in brackets after its Paris time; every clock time outside brackets is a Paris one.
    const bare = outsideBrackets(runbook);
    expect(bare).not.toMatch(/\d{2}:\d{2}[^\n]{0,12}UTC/);
    expect(bare).not.toMatch(/UTC[^\n]{0,4}\d{2}:\d{2}/);
    const paired = [...runbook.matchAll(/<heure>[^\n(]{0,30}\(<heure>[^)]*UTC\)/g)];
    expect(paired.length).toBeGreaterThanOrEqual(3);
    for (const m of paired) expect(m[0]).toMatch(/Paris/);
    // Rule 3: no LIVE release between its room's opening and its end, read before the launch and again just before it;
    // no TEST ENTRANTS test running.
    expect(rules).toContain("**Aucune LIVE RELEASE entre l'ouverture de sa salle et sa fin.**");
    const reads = fenced(before, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([psql(`select count(*) from drops where ${ROOM_SOON}`), psql('select count(*) from test_runs where ended_at is null')]);
    expect(fenced(readDoc('docs/launch/DEPLOY-OQ-Q3.md'), 'bash')).toContain(psql(`select count(*) from drops where ${ROOM_SOON}`));
    expect(fenced(section(runbook, '### 1.4'), 'bash')[0]).toBe(psql(`select count(*) from drops where ${ROOM_SOON}`));
    for (const q of commands.filter((c) => c.includes('psql'))) {
      expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop table|truncate|create)\b/i);
      // A string literal would end the shell's single quotes.
      expect(q.slice(q.indexOf('-Atc "'), q.lastIndexOf('"')), q).not.toContain("'");
    }
    // The screens: phone and computer, dark and light; no mockup, so every word listed; his figures prepared.
    for (const what of ['en mode sombre et en mode clair', '1440 × 900, et 1024 × 768', 'Aucune maquette n\'existait pour M4', '**2. Tes chiffres, à préparer.**']) {
      expect(before, what).toContain(what);
    }
    // Client Services told before: the playbook's partner section, in both copies; its ads section for the activation day.
    expect(before).toContain('§0 « Les expériences partenaires »');
    expect(before).toContain('La partie « Meta, TikTok et Google » ne vaut qu\'à partir du jour de l\'activation (§2).');
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      expect(section(readDoc(copy), '## 0.'), copy).toContain('### Les expériences partenaires');
      expect(section(readDoc(copy), '## 0.'), copy).toContain('### Meta, TikTok et Google (à partir du jour où les conversions sont allumées)');
    }
    // CI green on the exact commit, its four shards; a shard above 42 of its 45 minutes goes to the main session.
    expect(before).toContain('actions?query=branch%3Aorbes-m4');
    expect(before).toContain('(ses quatre parties)');
    expect(before).toContain('Si l\'une des quatre parties a pris plus de 42 de ses 45 minutes, dis-le à Claude : la session principale décide de sa limite, ce lot ne change pas la CI.');
    const ci = readDoc('.github/workflows/genome-ci.yml');
    expect(ci).toContain('shard: [1, 2, 3, 4]');
    expect(ci).toContain('timeout-minutes: 45');
    // No slot booked: the three conditions, the heads-up at launch in Paris then UTC.
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("le diff de `deploy/vps` vide après l'avance rapide");
    expect(section(runbook, '### 1.4')).toContain(
      "**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)** : « ORBES : déploiement M4 lancé à <heure> Paris (<heure> UTC), trois migrations, rien ne change sur l'hôte. »",
    );
    // Nothing on the host changes: the deploy/vps diff since Q2 in production (and so since Q3) is empty, no .env line.
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    expect(rules).toContain('Ton `.env` ne gagne aucune ligne : les clés de Meta, TikTok et Google attendent le jour où tu allumes les conversions (§2)');
    expect(commands).toContain('git -C /opt/orbes/orbes-index diff --name-status <SHA_Q3> HEAD -- deploy/vps');
    expect(section(runbook, '### 1.3')).toContain('-- deploy/vps\n```\n\nSortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi et demande à Claude.');
    for (const sha of [Q2_SHA, Q3_BASE]) {
      const diff = git(sha, ['diff', '--name-status', sha, '--', 'deploy/vps']);
      const log = git(sha, ['log', '--no-merges', '--format=%H %s', `${sha}..HEAD`, '--', 'deploy/vps']);
      if (diff !== null && log !== null) {
        expect(log.trim().split('\n').filter((l) => / M4B-M4\./.test(l))).toEqual([]);
        if (!log.trim()) expect(diff.trim()).toBe('');
      }
    }
    // The app is not given the ADS_* keys today (vps-stack's own check), so a key in .env would reach nothing.
    const compose = readDoc('deploy/vps/compose.yaml');
    for (const n of Object.values(ADS_ENV).flat()) expect(compose, n).not.toContain(n);
    expect(section(runbook, '### 1.2')).toContain("Ton `.env` ne gagne aucune ligne avec ce déploiement : tu n'y touches pas.");
    // No secret: .env is only ever read for two lines, and never shown whole; no key is ever read.
    for (const c of commands.filter((x) => x.includes('.env'))) expect(["grep '^ORBES_IMAGE_TAG=' .env", "grep -n '^RESTORE_ALLOWED=' .env"]).toContain(c);
    expect(commands.filter((c) => /COOKIE_SECRET|ADS_/.test(c))).toEqual([]);
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
    expect(rules).toContain('la branche `orbes-m4` (sa propre branche distante, jamais `main`, jamais une pull request)');
    expect(rules).toContain('Tu pousses toi-même la branche de déploiement, sur ton accord.');
    // The conversions stay off at deployment (A1).
    expect(rules).toContain('**Les conversions restent éteintes**');
    expect(rules).toContain('Aucun bandeau, aucune ligne ADVERTISING MEASUREMENT');
    // The legal pages (L2): one new version, the code's, after Q3's; the ORBES CARE conditions keep theirs; counsel never holds it.
    // A later lot may move LEGAL_VERSION past it; M4's head publishes M4's.
    expect(LEGAL_VERSION >= M4_LEGAL_VERSION).toBe(true);
    expect(M4_LEGAL_VERSION > Q3_LEGAL_VERSION).toBe(true);
    expect(CARE_CONDITIONS_VERSION).toBe(CARE_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${M4_LEGAL_VERSION}\``);
    expect(rules).toContain(`gardent leur version, \`${CARE_VERSION}\``);
    expect(rules).toContain('La relecture par un avocat ne retient jamais le déploiement.');
    expect(rules).toContain('la politique de confidentialité, un seul paragraphe (le nom qu\'un invité partage avec un partenaire, dans *Your answers and votes in the circle*)');
    expect(PRIVACY.en.sections.find((s) => s.id === 'circle')?.title).toBe('Your answers and votes in the circle');
    const fetch = section(runbook, '### 1.3');
    expect(fetch).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${M4_LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(fetch).toContain(`Sortie attendue : \`export const CARE_CONDITIONS_VERSION = '${CARE_VERSION}';\`, inchangée.`);
    expect(source('web/legal/content/index.ts')).toContain(`${M4_LEGAL_VERSION} is the version of lot M4 of the macro scope`);
  });

  it('checks the box after the migrations, the twelve tables empty, the conversions off from the Mac, the sounds and the legal version, the console’s new pages, and tells the host with the swap', () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual(POST_CHECK.map(([, counted]) => psql(countsOf(counted))));
    for (const [, counted] of POST_CHECK) expect(after).toContain(`Sortie attendue : \`${counted.map(() => '0').join('|')}\`.`);
    // No row of ads_settings reads as off: the service writes it only at the console's first save.
    const ads = source('server/services/ads.ts');
    expect(ads).toContain("if (s?.enabled !== true) return { on: false, choice: null, textVersion: ADS_TEXT_VERSION, since: null };");
    expect(ads).toContain('/** The settings row, written at the first save (no row: off). */');
    // The console after, in its words: Growth's Margin with What is missing, THE VAULT line; Margin settings empty;
    // Partners empty; Links → Ad platforms OFF and the three platforms KEYS MISSING; THE VAULT, ONE QUEUE, add-ons unchanged.
    expect(after).toContain(`\`Growth\` : la section \`${MARGIN_TEXT.title}\``);
    expect(after).toContain(`\`${MARGIN_TAB_LABELS.model}\` · \`${MARGIN_TAB_LABELS.channel}\` · \`${MARGIN_TAB_LABELS.tier}\``);
    expect(after).toContain(`\`${MARGIN_TEXT.missing}\` le dit, ${said(MARGIN_TEXT.missingLead)}`);
    expect(after).toContain(`avec \`${MARGIN_TEXT.vaultLink}\``);
    expect(after).toContain(`\`Partner experiences\` : ${said(PARTNER_INCOME_EMPTY)}`);
    expect(source('web/admin/views/growth.ts')).toContain("'Partner experiences',");
    expect(after).toContain(`\`${MARGIN_TEXT.settings}\` (le lien de la section) s'ouvre : \`${MARGIN_SETTINGS_TEXT.shipping}\` lit ${said(MARGIN_SETTINGS_TEXT.shippingEmpty)}`);
    expect(after).toContain(`sous \`${MARGIN_SETTINGS_TEXT.packaging}\`, ${unitCostLabel('POUCH')}, ${unitCostLabel('CARD')} et ${unitCostLabel('VAULT_CARD')}, chacun \`${MARGIN_SETTINGS_TEXT.notSet}\``);
    expect(CLUB_TABS.map((t) => t.label)).toContain('Circle');
    expect(source('web/admin/views/circle.ts')).toContain("linkButton('Partners', href('clubPartners'), 'ghost')");
    expect(after).toContain(`\`Club\`, onglet \`Circle\`, \`${PARTNERS_TEXT.title}\` : ${said(PARTNERS_TEXT.empty)}`);
    expect(after).toContain(`\`Links\` → \`${LINKS_COPY.adPlatforms}\` : \`${AD_PLATFORMS_TEXT.conversionsLabel}: ${AD_PLATFORMS_TEXT.off}\`, ${said(AD_PLATFORMS_TEXT.offLine)}`);
    expect(after).toContain(`${PLATFORM_LABELS.META}, ${PLATFORM_LABELS.TIKTOK} et ${PLATFORM_LABELS.GOOGLE}, chacun \`${AD_PLATFORMS_TEXT.keysMissing}\``);
    expect(after).toContain(`\`Club\`, onglet \`${VAULT_COPY.tab}\`, comme avant le déploiement`);
    expect(after).toContain('`Catalogue` → `Add-ons`');
    // The app: no banner on the phone and on a computer; /legal/privacy the new date and the partner paragraph, no ads section.
    expect(after).toContain('`/verify` s\'ouvre sans aucun bandeau, sur téléphone et sur ordinateur.');
    expect(after).toContain(`${said(WORDS.en.version(M4_LEGAL_VERSION))}, et le paragraphe partenaire (§1.7, point 5), sans section *${ADS_SECTION.en.title}*`);
    // The box's figures before and after, the swap line read; the host told at launch and after, swap included.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(after).toContain("**Préviens le responsable de l'hôte** : « M4 fait à <heure> Paris (<heure> UTC), trois migrations, rien n'a changé sur l'hôte, tout est healthy. Avant / après, swap compris : <les chiffres>. »");
    // From the Mac: health, the app, the conversions read off as the route answers (GET writes nothing, sets no cookie).
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/health');
    expect(after).toContain('Sortie attendue : `{"ok":true,"version":"0.1.0"}`.');
    expect(commands).toContain('curl -s https://verify.theorbes.com/api/v1/consent');
    const off = JSON.stringify({ ads: { on: false, choice: null, textVersion: ADS_TEXT_VERSION, since: null } });
    expect(after).toContain(`Sortie attendue : \`${off}\`.`);
    const route = source('server/routes/consent.ts');
    expect(route).toContain("app.get('/api/v1/consent', async (request, reply) => {");
    expect(route).toContain('if (!(await ads.isOn())) return { ads: await ads.state(null, null) };');
    expect(route).toContain('Writes nothing and sets no cookie.');
    // The sixteen sounds (Q1's command, word for word), ONE QUEUE and THE VAULT unchanged; the legal version.
    const sounds = commands.find((c) => c.includes('.mp3'));
    expect(sounds).toBe(
      'for u in $(curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/verify | grep -o \'/assets/verify-[A-Z0-9]*\\.js\' | head -1)" | grep -o \'/assets/[a-z-]*-[A-Z0-9]\\{8\\}\\.mp3\' | sort -u); do curl -s -o /dev/null -w "%{http_code} $u\\n" "https://verify.theorbes.com$u"; done',
    );
    expect(fenced(readDoc('docs/launch/DEPLOY-OQ-Q3.md'), 'bash')).toContain(sounds);
    const lines = block('200 /assets/');
    expect(lines).toEqual([...ALL_SOUNDS].sort().map((n) => `200 /assets/${n}-<8 caractères>.mp3`));
    expect(lines).toHaveLength(16);
    expect(after).toContain('exactement seize lignes');
    expect(after).toContain('Moins de seize lignes');
    expect(HASHED_ASSET_RE.test('/assets/vault-unlock-W2FRIVUJ.mp3')).toBe(true);
    expect(commands).toContain(
      `curl -s "https://verify.theorbes.com$(curl -s https://verify.theorbes.com/legal | grep -o '/assets/legal-[A-Z0-9]*\\.js' | head -1)" | grep -o '${M4_LEGAL_VERSION}' | head -n 1`,
    );
    expect(after).toContain(`Sortie attendue : \`${M4_LEGAL_VERSION}\`.`);
  });

  it('checks each element for real, in the console’s and the app’s words: the margin, a real order, partners without an invoice, the conversions off, the legal pages', () => {
    const real = section(runbook, '### 1.7');
    expect(real).toContain('Chaque contrôle laisse soit une vraie donnée que tu gardes, soit rien.');
    const settingsView = source('web/admin/views/margin-settings.ts');
    // 1. The margin's settings: GBP, USD and CHF; a FRANCE band and ALL OTHER COUNTRIES; POUCH, CARD and THE VAULT CARD; an allowance.
    const settings = section(runbook, '#### 1.');
    for (const w of ["label: 'Currency'", "'One unit in euros'", "label: 'Country'", "label: 'Up to, in grams'", "label: 'Cost'", "label: 'Allowance (%)'", "confirmLabel: 'Save'"]) expect(settingsView, w).toContain(w);
    expect(settings).toContain(`\`${MARGIN_SETTINGS_TEXT.currencies}\` → \`${MARGIN_SETTINGS_TEXT.setRate}\` : \`Currency\` \`GBP\`, \`One unit in euros\` ton taux, puis \`Save\` : ${said(MARGIN_SETTINGS_TEXT.rateSaved)}`);
    expect(settings).toContain(`La ligne lit ${said(rateLine('GBP', '<ton taux>'))}. De même pour \`USD\` et \`CHF\`.`);
    expect(countryName('FR')).toBe('France');
    expect(settings).toContain(`\`${MARGIN_SETTINGS_TEXT.shipping}\` → \`${MARGIN_SETTINGS_TEXT.addBand}\` : \`Country\` \`France\`, \`Up to, in grams\``);
    expect(settings).toContain(`puis \`Save\` : ${said(MARGIN_SETTINGS_TEXT.bandAdded)} Puis une tranche pour \`${MARGIN_SETTINGS_TEXT.otherCountries}\``);
    expect(settings).toContain(`\`${MARGIN_SETTINGS_TEXT.packaging}\` : sur ${unitCostLabel('POUCH')}, \`${MARGIN_SETTINGS_TEXT.set}\` : \`Cost\`, \`Currency\`, puis \`Save\` : ${said(MARGIN_SETTINGS_TEXT.costSaved)} De même pour ${unitCostLabel('CARD')} et ${unitCostLabel('VAULT_CARD')}.`);
    expect(settings).toContain(`\`${MARGIN_SETTINGS_TEXT.allowance}\` : sur une catégorie, \`${MARGIN_SETTINGS_TEXT.set}\` : \`Allowance (%)\`, puis \`Save\` : ${said(MARGIN_SETTINGS_TEXT.allowanceSaved)}`);
    // 2. A real order's margin by hand, BY CHANNEL, THE VAULT line in the margin's words (never "place", OP-22).
    const order = section(runbook, '#### 2.');
    expect(order).toContain(`\`${MARGIN_TAB_LABELS.model}\` : choisis un modèle qui n'a qu'une commande payée dans la période`);
    expect(order).toContain('sa facture avant les crédits');
    expect(order).toContain(`\`${MARGIN_TAB_LABELS.channel}\``);
    const marginModel = source('web/admin/model/margin.ts');
    for (const w of ['Products won, claimed (VAULT orders at 0)', 'Vault credits used', 'Credits to give used', 'Free add-ons given', 'THE VAULT CARDs packed', 'The report’s cost of the rewards won']) {
      expect(marginModel, w).toContain(`'${w}'`);
      expect(order, w).toContain(said(w));
    }
    expect(order).toContain(said(MARGIN_VAULT_WORDS.guaranteed));
    expect(MARGIN_VAULT_WORDS.guaranteed).not.toMatch(/\bplace\b/i);
    expect(order).toContain(`\`${MARGIN_TEXT.vaultLink}\` ouvre \`Club\`, onglet \`${VAULT_COPY.tab}\``);
    // 3. Partners at the first real deal: a partner, a DRAFT experience, a DRAFT invitation linked, its guests (0), no invoice.
    const partners = section(runbook, '#### 3.');
    const partnersView = source('web/admin/views/partners.ts');
    const partnerFields = ['Brand', 'Contact', 'Email', 'Phone', 'Billing name', 'Billing address', 'Billing country', 'Company number', 'Note'];
    for (const f of partnerFields) expect(partnersView, f).toContain(`label: '${f}'`);
    expect(partners).toContain(`\`${PARTNERS_TEXT.newPartner}\` : ${partnerFields.map((f) => `\`${f}\``).join(', ')}, puis \`Create partner\` : ${said('Partner created.')}`);
    for (const w of ["confirmLabel: 'Create partner'", "notify('Partner created.')", "confirmLabel: 'Create experience'", "notify('Experience created.')"]) expect(partnersView, w).toContain(w);
    const experienceFields = ['Title', 'Event (Paris)', 'Amount', 'Currency', 'Note'];
    for (const f of experienceFields) expect(partnersView, f).toContain(`label: '${f}'`);
    expect(partners).toContain(`\`${PARTNERS_TEXT.newExperience}\` : ${experienceFields.map((f) => `\`${f}\``).join(', ')}, puis \`Create experience\` : ${said('Experience created.')} Son état : \`${EXPERIENCE_STATE_LABELS.DRAFT}\`.`);
    const circleView = source('web/admin/views/circle.ts');
    expect(circleView).toContain("button('New invitation'");
    expect(circleView).toContain("label: 'Partner experience',");
    expect(circleView).toContain('confirmLabel: `Create ${CIRCLE_KIND_LABELS[kind].toLowerCase()}`');
    expect(partners).toContain(
      `\`New invitation\` : \`Experience\` \`${CIRCLE_EXPERIENCE_LABELS.PARTNER_EXPERIENCE}\`, puis le champ \`Partner experience\` : l'expérience, ${said(experienceOptionLabel('<BRAND>', { title: '<TITRE>', eventOn: '<JOUR>' }))}, puis \`Create ${CIRCLE_KIND_LABELS.INVITATION.toLowerCase()}\``,
    );
    expect(partners).toContain("L'invitation reste un **brouillon** : ne la publie pas maintenant.");
    expect(partners).toContain(`sous \`${PARTNERS_TEXT.guests}\`, ${said(guestsLine({ headcount: 0, sharedCount: 0 }))}`);
    expect(partners).toContain(`**Aucune facture émise pour un essai** : \`${PARTNERS_TEXT.issue}\` attend le vrai jour, puisqu'un numéro P- ne se réutilise jamais. Le PDF d'une facture de partenaire est prouvé par la CI.`);
    // 4. The conversions off: KEYS MISSING with the pinned versions, SWITCH ON refused in the server's words, no event,
    // and, on the phone and on a computer, no banner and no ADVERTISING MEASUREMENT row.
    const conversions = section(runbook, '#### 4.');
    expect(conversions).toContain(`\`${AD_PLATFORMS_TEXT.conversionsLabel}: ${AD_PLATFORMS_TEXT.off}\` ; Meta, TikTok et Google \`${AD_PLATFORMS_TEXT.keysMissing}\`, avec leurs versions d'API \`${META_GRAPH_VERSION}\`, \`${TIKTOK_API_VERSION}\` et \`${GOOGLE_ADS_API_VERSION}\``);
    expect(ADS_SWITCH_PHRASES.on).toBe(AD_PLATFORMS_TEXT.switchOn);
    const refusal = 'No platform has its keys in the server’s .env: conversions cannot be switched on.';
    expect(ads()).toContain(`throw noPlatform('${refusal}')`);
    expect(conversions).toContain(
      `\`${AD_PLATFORMS_TEXT.switchOn}\` : la boîte ${said(AD_PLATFORMS_TEXT.switchOnTitle)} ; tape \`${ADS_SWITCH_PHRASES.on}\`, puis \`${AD_PLATFORMS_TEXT.switchOnConfirm}\` : refusé, ${said(refusal)} Ferme la boîte avec \`Cancel\``,
    );
    expect(source('web/admin/ui/dialog.ts')).toContain("button(o.cancelLabel ?? 'Cancel'");
    expect(conversions).toContain(`\`${AD_PLATFORMS_TEXT.events}\` : ${said(AD_PLATFORMS_TEXT.eventsEmpty)}`);
    expect(conversions).toContain(`Sur téléphone et sur ordinateur, aucun bandeau ni ligne ${CONSENT.label}.`);
    expect(conversions).toContain('YOUR ACCOUNT et YOUR PROFILE');
    // 5. The legal pages: the version line, the partner paragraph in its section, no Advertising measurement.
    const legal = section(runbook, '#### 5.');
    expect(legal).toContain(said(WORDS.en.version(M4_LEGAL_VERSION)));
    const partnerSentence = 'When an invitation is an experience offered with a partner, you may tick, with your YES, to share your first and last name with that partner;';
    expect(JSON.stringify(PRIVACY.en)).toContain(partnerSentence);
    expect(legal).toContain(`partie « Your answers and votes in the circle », le paragraphe « ${partnerSentence} … »`);
    expect(legal).toContain(`aucune partie ${said(ADS_SECTION.en.title)}`);
    expect(JSON.stringify(PRIVACY.en)).not.toContain(ADS_SECTION.en.title);
    // §1.0 names what the collector sees and what the console has, in their words.
    const changes = section(runbook, '### 1.0');
    expect(changes).toContain(`la case ${CIRCLE.partner.share('<NAME>', '<BRAND>')}`);
    expect(changes).toContain(`le collectionneur lit ${CIRCLE.partner.with('<BRAND>')}`);
    expect(changes).toContain(`\`${PARTNERS_TEXT.issue}\`, \`${PARTNERS_TEXT.recordPayment}\`, \`${PARTNERS_TEXT.cancel}\` et \`${PARTNERS_TEXT.guests}\``);
    expect(changes).toContain(`\`Issued to\`, \`${ISSUED_TO_LABELS.collectors}\` par défaut, ou \`${ISSUED_TO_LABELS.partners}\``);
    expect(changes).toContain(`\`${MARGIN_TEXT.missing}\`, \`${MARGIN_TEXT.csv}\` et \`${MARGIN_TEXT.settings}\``);
    expect(changes).toContain(`(\`${AD_PLATFORMS_TEXT.conversionsLabel}: ${AD_PLATFORMS_TEXT.off}\`), chaque plateforme avec \`${AD_PLATFORMS_TEXT.keysPresent}\` ou \`${AD_PLATFORMS_TEXT.keysMissing}\``);
    for (const h of ADS_HOSTS) expect(changes, h).toContain(`\`${h}\``);
    expect(ADS_HOSTS).toHaveLength(4);
    // §1.8: his data, until What is missing is empty; the ISSUE THE INVOICE dialog, RECORD PAYMENT, the guest list.
    const data = section(runbook, '### 1.8');
    expect(data).toContain(`jusqu'à ce que \`${MARGIN_TEXT.missing}\` lise ${said(MARGIN_TEXT.missingNone)}`);
    expect(data).toContain(`\`${PARTNERS_TEXT.issue}\` quand l'accord est ferme (la boîte ${said(PARTNERS_TEXT.issueTitle)} nomme le numéro P- suivant`);
    expect(data).toContain(`\`${PARTNERS_TEXT.recordPayment}\` le jour où le virement arrive`);
    expect(data).toContain(`\`${PARTNERS_TEXT.guests}\` → \`${PARTNERS_TEXT.download}\``);
    expect(data).toContain('`Orders` → `Settings` → `Boxes`');
  });

  it('describes the activation day apart: counsel first, the ADS_* keys entered by the owner in the server’s .env and never in chat, the host’s deployment, the switch and the banner', () => {
    const day = section(runbook, '## 2.');
    expect(day).toContain('Rien de cette partie ne se fait au déploiement de M4.');
    expect(day).toContain('**La section préparée passe d\'abord au juriste** : *Advertising measurement* de la politique de confidentialité (la note au juriste, point 41).');
    expect(readDoc('docs/legal/counsel-note.fr.md')).toMatch(/^41\. \*\*La mesure publicitaire préparée\*\*/m);
    // A5: where the keys go, under the names config.ts reads, never in chat (genome/.env.example's sentence).
    expect(day).toContain('**Les clés, dans le `.env` du serveur**, entrées par toi dans le `.env` du serveur, jamais dans le chat : `/opt/orbes/orbes-index/deploy/vps/.env`');
    const names = [...ADS_ENV.meta, ...ADS_ENV.tiktok, ...ADS_ENV.google];
    expect(names).toHaveLength(10);
    expect(block('ADS_META_DATASET_ID=')).toEqual(names.map((n) => `${n}=<…>`));
    const example = readDoc('genome/.env.example');
    expect(example).toContain("# Keys go in the server's .env, never in chat;");
    for (const n of names) expect(example, n).toContain(`# ${n}=`);
    expect(source('server/config.ts')).toContain("const ADS_OPTIONAL_ENV: ReadonlySet<string> = new Set(['ADS_GOOGLE_LOGIN_CUSTOMER_ID']);");
    expect(day).toContain('`ADS_GOOGLE_LOGIN_CUSTOMER_ID` est la seule facultative');
    expect(day).toContain("Les clés d'une plateforme vont ensemble : une plateforme avec une partie seulement de ses clés empêche l'application de démarrer, la variable manquante nommée.");
    // The deployment of that day: agreed with the host, compose.yaml's ten ADS_*, the route out to the four fixed hosts only.
    expect(day).toContain('**Un déploiement préparé alors**, par Claude, convenu d\'abord avec le responsable de l\'hôte, avec son propre runbook : il passe les dix `ADS_*` à l\'application dans `deploy/vps/compose.yaml`');
    expect(day).toContain(ADS_HOSTS.map((h) => `\`${h}\``).join(', '));
    expect(day).toContain(`\`${META_GRAPH_VERSION}\` pour Meta, \`${TIKTOK_API_VERSION}\` pour TikTok, \`${GOOGLE_ADS_API_VERSION}\` pour Google`);
    // The console then: KEYS PRESENT, Channels, Google conversion actions, Test codes, SWITCH ON with its phrase.
    expect(day).toContain(`chaque plateforme utilisée \`${AD_PLATFORMS_TEXT.keysPresent}\` ; sous \`${AD_PLATFORMS_TEXT.channels}\``);
    expect(day).toContain(`\`${AD_PLATFORMS_TEXT.googleActions}\` → \`${AD_PLATFORMS_TEXT.edit}\`, les quatre actions de Google Ads (\`${AD_PLATFORMS_TEXT.googleHint}\`)`);
    expect(day).toContain(`\`${AD_PLATFORMS_TEXT.testCodes}\``);
    expect(day).toContain(`**\`${AD_PLATFORMS_TEXT.switchOn}\`** : tape \`${ADS_SWITCH_PHRASES.on}\`, puis \`${AD_PLATFORMS_TEXT.switchOnConfirm}\` : ${said(AD_PLATFORMS_TEXT.switchedOnToast)}`);
    // What he sees: the banner on the phone and the computer, ACCEPT and DECLINE of equal weight, PRIVACY; the row; a
    // test event per platform; the privacy policy's section and its since line; SWITCH OFF returns today's state.
    expect(day).toContain(`le bandeau sur ton téléphone et sur ton ordinateur, ${CONSENT.accept} et ${CONSENT.decline} de même poids, et ${CONSENT.privacy}`);
    expect(day).toContain(`dans YOUR PROFILE, ${CONSENT.label} allumé`);
    expect(day).toContain(`\`${AD_PLATFORMS_TEXT.sendTest}\` sur chaque plateforme, \`${AD_PLATFORMS_TEXT.taken}\``);
    expect(day).toContain(`la section *${ADS_SECTION.en.title}*, et sous la ligne de version ${said('Advertising measurement: since <jour>')}`);
    expect(ADS_SINCE.en('2026-11-02')).toBe('Advertising measurement: since 2 November 2026');
    expect(day).toContain(`**\`${AD_PLATFORMS_TEXT.switchOff}\`** rend tout comme aujourd'hui`);
    expect(day).toContain('chaque événement en attente est annulé');
  });

  it('leaves the owner’s decisions (plan §13), gives one command per shell block, in French, links only to what exists, linked from DEPLOYMENT and COMPLIANCE', () => {
    const open = section(runbook, '## 3.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const n of ['(N1)', '(N2)', '(N3)', '(P4)', '(P1)', '(A2, A3)', '(A3)', '(A4)', '(A5)', '(L2)', '(P3)', '(D61)', '(Q2)', '(K27)']) expect(open, n).toContain(n);
    expect(open).toContain('`PC-2026-0001`');
    expect(open).toContain('(la note au juriste, point 40)');
    expect(open).toContain('(point 41)');
    expect(readDoc('docs/legal/counsel-note.fr.md')).toMatch(/^40\. /m);
    expect(open).toContain('toujours dite « piece », jamais « place »');
    // One command per shell block; the house's runbook shape, in French, for the owner.
    expect(commands.length).toBeGreaterThan(40);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    expect(commands).toContain("bash -c 'set -Eeuo pipefail; source scripts/lib.sh; db_applied_migrations'");
    expect(commands).toContain('docker compose exec app node --import tsx scripts/db.ts status');
    expect(runbook.startsWith('# Mise en production du lot M4 (la marge, les expériences partenaires, les conversions)\n\nCe document est pour toi, le propriétaire.')).toBe(true);
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
      '## 2. Le jour où les conversions sont activées (plus tard, sur ta décision)',
      '## 3. Ce qui reste à ta décision (sans bloquer)',
    ]) {
      expect(runbook.split('\n'), h).toContain(h);
    }
    const changes = section(runbook, '### 1.0');
    for (const w of ['**La marge, sur GROWTH**', '**Ses réglages**', '**THE VAULT dans la marge**', '**Les expériences partenaires**', "**Le nom d'un invité**", '**Les conversions publicitaires, construites et éteintes**', '**Ce qui ne change pas**']) {
      expect(changes, w).toContain(w);
    }
    expect(changes).toContain('**jamais par sortie**');
    expect(changes).toContain('**Rien n\'est prérempli**');
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(runbook).toContain('[son runbook](DEPLOY-OQ-Q3.md)');
    const deployment = readDoc('docs/DEPLOYMENT.md');
    expect(deployment).toContain('[DEPLOY-M4B-M4](launch/DEPLOY-M4B-M4.md)');
    expect(deployment).toContain('[DEPLOY-OQ-Q3](launch/DEPLOY-OQ-Q3.md); and lot M4 of the macro scope, rebuilt on ONE QUEUE');
    expect(deployment).toContain('one deployment after Q3 with migrations `0063_margin`, `0064_partners` and `0065_ad_conversions`, no `.env` line (the platforms\' keys wait for the day the conversions are switched on), no change of the host');
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 13.');
    expect(compliance).toContain('(launch/DEPLOY-M4B-M4.md)');
    expect(compliance).toContain('(la note au juriste, point 40)');
    // Never the words the brand keeps out of what it says; no piece named.
    expect(runbook).not.toMatch(/\bstolen\b/i);
    expect(runbook).not.toMatch(/\batelier\b/i);
    expect(runbook).not.toMatch(/\bhandmade\b/i);
    expect(runbook).not.toMatch(/MONOLITHE/);
  });
});

/** The ads service's source (its refusal words). */
function ads(): string {
  return source('server/services/ads.ts');
}
