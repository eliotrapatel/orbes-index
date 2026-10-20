/**
 * docs/launch/DEPLOY-ORBES-CARE.md, the owner's runbook for ORBES CARE (plan of 2026-10-15, §4 and step 5.2), against
 * the scripts, the migration and the app it quotes:
 *
 *  - it starts from production as it runs when ORBES CARE starts (I2, 90d9d30, 0001 to 0047) and applies exactly
 *    0048_orbes_care, as the scripts print it: the table of §1.0, the lines `db_applied_migrations` and deploy.sh print
 *    before, the line `db.ts migrate` prints, those deploy.sh prints after it, the deployment log and the count
 *    `db.ts status` shows; I2's image no longer runs on the schema after it;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app is still one they print;
 *  - the owner's rules: the captures reviewed first, never 05:00–07:30 Paris (03:00–05:30 UTC) nor the hub's backup
 *    minutes (Paris first, UTC in brackets), no slot booked and a heads-up at launch, nothing changed on the host (the
 *    deploy/vps diff against 90d9d30, empty; CARE_SUBSCRIBE_URL kept), the box's figures before and after, the guarded
 *    launch, restore.sh only ever run to watch it refuse, no prune; the legal pages' new version, LEGAL_VERSION, and the
 *    conditions' PDF with it, counsel's review never holding the deploy (D7); theorbes.com untouched (answer 8);
 *  - §4's post-check read on the box (every model Lifetime, no lifetime warranty with an end date, THE PROGRAM's PLATINE
 *    every piece and its 30 %), the owner's two minutes the same day (answer 12, answer 13: each leather model and
 *    variant switched to 2 years in Edit model, the Categories read, the staff texts read only), then every piece
 *    following its model; Client Services told (the playbook's §5b, §5c and §5d, both copies);
 *  - one real check per element, in the console's and the app's words as they show them; one command per shell block,
 *    relative links that resolve, and the runbook linked from DEPLOYMENT and COMPLIANCE.
 *
 * <SHA_CARE> and <TAG_CARE> stay placeholders until the main session hands the commit over.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { CARE_CONDITIONS_COPY, CARE_CONDITIONS_VERSION } from '../../src/server/render/care-conditions.js';
import { DEFAULT_PROGRAM } from '../../src/server/services/club-program.js';
import { categoryWarranty, modelWarrantyText, WARRANTY_OPTIONS, warrantyReach } from '../../src/web/admin/model/catalogue.js';
import { careText, warrantyCreditText } from '../../src/web/admin/model/program.js';
import { dateInWords, LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { TERMS } from '../../src/web/legal/content/terms.js';
import { ORBES_CARE, ORDERS, PIECES, TIER, YEARLY_CARE } from '../../src/web/verify/copy.js';
import { TAB_LABELS } from '../../src/web/verify/view-model.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-ORBES-CARE.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** What production runs when ORBES CARE starts: I2 (the plan's base), deployed after the light mode 427546e. */
const PROD_COMMIT = '90d9d3007e20cdc37c30bd6f0e93affdd7871e23';
const PROD_TAG = PROD_COMMIT.slice(0, 12);
/** The light mode's image, I2's previous one, as I2's deployment log line names it (DEPLOY-CUSTOMER-INTELLIGENCE §2.6). */
const LIGHT_TAG = '427546ea62a1';

const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
const BEFORE = NAMES.filter((n) => numberOf(n) <= 47);
const I2 = NAMES.filter((n) => numberOf(n) >= 45 && numberOf(n) <= 47);
const DEPLOY = NAMES.filter((n) => numberOf(n) === 48);
const AFTER = [...BEFORE, ...DEPLOY];

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

/** A read-only query of the box, as the runbook writes it. */
const psql = (query: string) => `docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "${query}"'`;

describe('the runbook of ORBES CARE (docs/launch/DEPLOY-ORBES-CARE.md)', () => {
  it('starts from I2 in production, 0001 to 0047, and applies exactly 0048_orbes_care, as the scripts print it', () => {
    expect(DEPLOY).toEqual(['0048_orbes_care']);
    expect(BEFORE).toHaveLength(48);
    // A later migration (the macro scope of 2026-10-20, lot M1, 0049 on) has its own runbook and comes after ORBES CARE's, in build order.
    expect(NAMES.slice(0, AFTER.length)).toEqual(AFTER);
    expect(NAMES.slice(AFTER.length).every((n) => numberOf(n) >= 49)).toBe(true);
    expect(runbook).toContain(`le commit \`${PROD_COMMIT}\` (image \`orbes-genome:${PROD_TAG}\`), avec les quarante-huit migrations de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(runbook).toContain(`Sortie attendue : quarante-huit lignes, de \`${BEFORE[0]}\` à \`${BEFORE.at(-1)}\``);
    expect(outputs.join('\n')).toContain(BEFORE.slice(-2).join('\n'));
    expect(runbook).toContain(`schema: ${BEFORE.length} migration(s) applied, all known to orbes-genome:<TAG_CARE>`);
    expect(runbook).toContain(`**Il faut lire \`${BEFORE.length} migration(s)\`.**`);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY.length} migration(s): ${DEPLOY.join(', ')}`);
    expect(runbook).toContain(`previous image tag: ${PROD_TAG}`);
    expect(runbook).toContain(`(previous: ${PROD_TAG}). This release applied the migration(s) ${DEPLOY.join(', ')}:`);
    expect(runbook).toContain(`orbes-genome:${PROD_TAG} cannot run on this schema any more (scripts/deploy.sh --image ${PROD_TAG} refuses it).`);
    expect(runbook).toContain(`deploy <TAG_CARE> OK (previous ${PROD_TAG}; migrations ${DEPLOY.join(', ')})`);
    expect(runbook).toContain(`les ${AFTER.length} lignes \`applied\`, de \`${AFTER[0]}\` à \`${AFTER.at(-1)}\``);
    // I2 as the last deployment: its log line exactly as DEPLOY-CUSTOMER-INTELLIGENCE §2.6 expects it.
    expect(I2).toEqual(['0045_birthday_credit', '0046_engagement_scores', '0047_collector_history']);
    expect(runbook).toContain(`\`… deploy ${PROD_TAG} OK (previous ${LIGHT_TAG}; migrations ${I2.join(', ')})\``);
    expect(readDoc('docs/launch/DEPLOY-CUSTOMER-INTELLIGENCE.md')).toContain(`deploy <TAG_I2> OK (previous ${LIGHT_TAG}; migrations ${I2.join(', ')})`);
    expect(runbook).toContain(`Sortie attendue : \`${PROD_COMMIT}\` au début de la ligne`);
    expect(runbook).toContain(`Sortie attendue : \`ORBES_IMAGE_TAG=${PROD_TAG}\`.`);
    expect(runbook).toContain(`\`Updating ${PROD_COMMIT.slice(0, 7)}..<7 caractères de SHA_CARE>\``);
    // <SHA_CARE> and <TAG_CARE> stay placeholders until the main session hands the commit over.
    expect(runbook).toContain('`<SHA_CARE>` est le commit final (40 caractères)');
    expect(runbook).toContain('la branche `orbes-care` (sa propre branche distante, jamais `main`, jamais une pull request)');
    // The plan §4: a runbook re-based first when production runs another image.
    expect(runbook).toContain('Si la dernière ligne OK de `.state/deploys.log` nomme une autre image');
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
  });

  it("holds the owner's rules: nothing changes on the host, the legal pages' new version, theorbes.com untouched", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain("**Ton accord sur les captures d'abord.**");
    // Paris first, UTC in brackets.
    expect(rules).toContain("**Jamais entre 05:00 et 07:30 à Paris jusqu'au 25 octobre 2026, 04:00 et 06:30 ensuite** (03:00–05:30 UTC)");
    expect(rules).toContain("03:00–03:10 et 03:45–03:55 à Paris (01:00–01:10 et 01:45–01:55 UTC jusqu'au 25 octobre 2026, puis 02:00–02:10 et 02:45–02:55 UTC)");
    expect(section(runbook, '### 1.1')).toContain("une heure **hors** de 05:00–07:30 à Paris jusqu'au 25 octobre 2026, 04:00–06:30 ensuite (03:00–05:30 UTC");
    expect(rules).toContain("**Aucune heure n'est réservée**");
    expect(rules).toContain("la CI verte sur le commit exact, le diff de `deploy/vps` vide après l'avance rapide, le lancement gardé");
    expect(rules).toContain("**Rien ne change sur l'hôte**");
    // D6: CARE_SUBSCRIBE_URL stays in the configuration, unused.
    expect(rules).toContain('`CARE_SUBSCRIBE_URL` reste dans la configuration');
    expect(readDoc('deploy/vps/.env.example')).toContain('CARE_SUBSCRIBE_URL');
    expect(rules).toContain('**Jamais `restore.sh` sur ce serveur**');
    expect(rules).toContain('**Le site theorbes.com ne change pas.**');
    // The heads-up at launch and after.
    expect(section(runbook, '### 1.4')).toContain("« ORBES CARE : déploiement lancé à 14:05 Paris (12:05 UTC), image orbes-genome:<TAG_CARE>, 1 migration, rien ne change sur l'hôte.");
    expect(section(runbook, '### 1.6')).toContain("**Préviens le responsable de l'hôte**");
    // The deploy/vps diff against production's commit, nothing expected; no Caddy recreated.
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --stat ${PROD_COMMIT} HEAD -- deploy/vps`);
    expect(section(runbook, '### 1.3')).toContain('Sortie attendue : **rien**. Une ligne de `deploy/vps` : arrête-toi');
    expect(section(runbook, '### 1.4')).not.toContain('Recreate`');
    // The box's figures before and after, the swap line read.
    for (const c of ['free -h', 'docker stats --no-stream', 'uptime', 'nproc', 'df -h /', 'du -sh /var/backups/orbes']) expect(commands.filter((x) => x === c), c).toHaveLength(2);
    expect(section(runbook, '### 1.1')).toContain('la ligne `Swap` de `free -h`');
    expect(commands).toContain('pgrep -a pg_dump');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands).toContain('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    for (const c of commands.filter((x) => x.includes('restore.sh'))) expect(c).toContain('--dry-run');
    expect(commands.filter((c) => /\bprune\b/.test(c))).toEqual([]);
    expect(section(runbook, '### 1.5')).toContain(`**jamais \`scripts/deploy.sh --image ${PROD_TAG}\`**`);
    expect(section(runbook, '### 1.4')).toContain("**Note le nom de l'archive et sa taille en octets**");
    // The legal pages' new version (step 4.1), the one the code publishes, and the conditions' PDF with it; counsel never holds the deploy.
    expect(CARE_CONDITIONS_VERSION).toBe(LEGAL_VERSION);
    expect(rules).toContain(`une seule nouvelle version, \`${LEGAL_VERSION}\``);
    expect(rules).toContain('ne retient jamais le déploiement');
    expect(section(runbook, '### 1.3')).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${LEGAL_VERSION}';\`, la nouvelle version.`);
    expect(section(runbook, '### 1.0')).toContain(`une nouvelle version, \`${LEGAL_VERSION}\``);
  });

  it("reads §4's post-check on the box, read only, against the migration's columns", () => {
    const after = section(runbook, '### 1.6');
    const reads = fenced(after, 'bash').filter((c) => c.includes('psql'));
    expect(reads).toEqual([
      psql('select warranty_lifetime, count(*) from models group by 1 order by 1'),
      psql('select count(*) from warranties where lifetime and end_date is not null'),
      psql('select care_pieces_platine, warranty_credit_percent from club_program_settings'),
    ]);
    for (const q of [...reads, ...fenced(section(runbook, '### 1.7'), 'bash')]) expect(q, q).not.toMatch(/\b(update|insert|delete|alter|drop|truncate)\b/i);
    expect(after).toContain('Sortie attendue : une seule ligne, `t|<le nombre de tes modèles>`.');
    // 0026 inserts no row and 0048 only changes row 1: a THE PROGRAM never saved prints nothing, its defaults apply.
    expect(after).toContain("Sortie attendue : `|30`, ou **rien** si `THE PROGRAM` n'a jamais été enregistré : ses valeurs par défaut s'appliquent alors (chaque pièce, 30 %).");
    const migration = readDoc('genome/src/server/db/migrations/0048_orbes_care.ts');
    for (const d of ['warranty_lifetime boolean NOT NULL DEFAULT false', 'UPDATE models SET warranty_lifetime = true', 'warranty_credit_percent', 'care_pieces_platine']) expect(migration, d).toContain(d);
    expect(migration).toMatch(/warranties[\s\S]*lifetime/);
    expect(migration).toContain('UPDATE club_program_settings SET care_pieces_platine = NULL WHERE id = 1');
    expect(readDoc('genome/src/server/db/migrations/0026_club_program.ts')).not.toMatch(/INSERT INTO club_program_settings/i);
    // THE PROGRAM's PLATINE: every piece (null), 30 % by default.
    expect(DEFAULT_PROGRAM.carePiecesPlatine).toBeNull();
    expect(DEFAULT_PROGRAM.warrantyCreditPercent).toBe(30);
  });

  it("gives the owner's two minutes the same day in the console's words, then checks every piece follows its model", () => {
    const rules = section(runbook, '## 0.');
    expect(rules).toContain('**Le passage des modèles de maroquinerie à 2 ans, le jour même** (§1.7)');
    const minutes = section(runbook, '### 1.7');
    const [lifetime, twoYears] = WARRANTY_OPTIONS.map((o) => o.label);
    expect([lifetime, twoYears]).toEqual(['Lifetime (jewelry)', '2 years (defects only)']);
    expect(minutes).toContain(`\`Warranty\` → \`${twoYears}\``);
    expect(minutes).toContain(`restent \`${lifetime}\``);
    expect(modelWarrantyText({ warrantyLifetime: true })).toBe('LIFETIME');
    expect(modelWarrantyText({ warrantyLifetime: false })).toBe('2 YEARS');
    expect(categoryWarranty({ warrantyMonths: 24 })).toEqual({ text: '2 YEARS', marked: false });
    expect(minutes).toContain('lit LIFETIME sur chaque ligne');
    expect(minutes).toContain('chaque catégorie lit 2 YEARS');
    expect(minutes).toContain('**chaque modèle de maroquinerie, et chacune de ses variantes**');
    // The line under the select, as the console writes it for sold pieces.
    const reach = warrantyReach({ warrantyLifetime: true, soldPieces: 3 }, { warranty: 'two-years' })!;
    expect(reach.startsWith('Its 3 pieces already sold take a 2-year warranty from their start')).toBe(true);
    expect(reach).toContain('Before the public launch only');
    expect(minutes).toContain('« Its … pieces already sold take a 2-year warranty from their start … Before the public launch only … »');
    expect(minutes).toContain('**en lecture seule**');
    expect(fenced(minutes, 'bash')).toEqual([
      psql('select count(*) from warranties w join products p on p.id = w.product_id join models m on m.id = p.model_id where w.voided_at is null and w.lifetime <> m.warranty_lifetime'),
      psql('select warranty_lifetime, count(*) from models group by 1 order by 1'),
    ]);
    const admin = (file: string): string => readDoc(`genome/src/web/admin/${file}`);
    const labels: ReadonlyArray<readonly [label: string, file: string]> = [
      ['Catalogue', 'main.ts'],
      ['Models', 'views/catalogue.ts'],
      ['Categories', 'views/catalogue.ts'],
      ['Edit model', 'views/catalogue.ts'],
      ['New model', 'views/catalogue.ts'],
      ['Warranty', 'views/catalogue.ts'],
      ['Save model', 'views/catalogue.ts'],
      ['Club', 'main.ts'],
      ['Tiers', 'model/club.ts'],
      ['THE PROGRAM', 'views/tiers.ts'],
      ['Warranty credit', 'views/tiers.ts'],
      ['Locations', 'views/settings.ts'],
      ['Performed by', 'views/product.ts'],
      ['Location', 'views/product.ts'],
      ['Warranties', 'main.ts'],
      ['Claims', 'views/warranties.ts'],
      ['PRIVATE CARE', 'main.ts'],
      ['Open a warranty claim', 'views/conversation.ts'],
      ['Send label', 'model/claims.ts'],
      ['Received', 'model/claims.ts'],
      ['Decide', 'model/claims.ts'],
      ['Ship', 'model/claims.ts'],
      ['Move to the legal guarantee', 'model/claims.ts'],
      ['Apply credit', 'views/order.ts'],
      ['Documents', 'main.ts'],
    ];
    for (const [label, file] of labels) {
      expect(runbook, label).toContain(`\`${label}\``);
      expect(admin(file), `${label}: not in ${file}`).toMatch(new RegExp(`['\`]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\`]`));
    }
  });

  it('tells ORBES Client Services before (the playbook, both copies) and lists what stays open', () => {
    const before = section(runbook, '### 1.1');
    for (const what of ["**1. Tes captures d'abord**", '**I2 est en production**', '**Aucune LIVE RELEASE**', '**aucun test de TEST ENTRANTS**', '**La liste de tes modèles de maroquinerie**', '**Préviens ORBES Client Services**']) expect(before, what).toContain(what);
    // The finish's captures (plan step 6), both looks.
    for (const what of ['en mode sombre et en mode clair', 'le certificat d\'une pièce à vie (la page et le PDF)', 'les DOCUMENTS d\'une commande avec ORBES CARE CONDITIONS et le PDF lui-même', '`New model` et `Edit model` (en ADMIN et en OPERATOR)']) expect(before, what).toContain(what);
    const sheets = ['§5b « Une demande au titre de la garantie »', '§5c « PRIVATE CARE »', "§5d « La garantie d'un modèle »"];
    for (const s of sheets) expect(before, s).toContain(s);
    for (const copy of ['docs/launch/SALES-PLAYBOOK.md', 'genome/src/server/documents/SALES-PLAYBOOK.md']) {
      const playbook = readDoc(copy);
      for (const h of ['## 5b. Une demande au titre de la garantie', '## 5c. PRIVATE CARE', "## 5d. La garantie d'un modèle"]) expect(playbook, `${copy}: ${h}`).toContain(h);
    }
    const next = section(runbook, '### 1.9');
    for (const what of ['**Préviens ORBES Client Services**', '**La relecture du texte français**', '**Le prototype de bureau**', '**Les anciennes images (facultatif).**']) expect(next, what).toContain(what);
    expect(next).toContain('rien n\'est imprimé pour la boîte');
    const open = section(runbook, '## 2.');
    expect([...open.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual([1, 2]);
  });

  it('checks each element for real, in the app\'s and the documents\' words as they show them', () => {
    const checks = section(runbook, '### 1.8');
    for (const what of ['La garantie d\'un modèle', '`THE PROGRAM`', 'Les demandes', "L'onglet ORBES CARE", 'La garantie de 2 ans', "Le résultat d'un scan", 'Les conditions', 'Les conditions en PDF']) expect(checks, what).toContain(`| ${what} |`);
    // THE PROGRAM's rows as the console writes them with the shipped defaults.
    expect(`PLATINE ${careText(DEFAULT_PROGRAM.carePiecesPlatine)} · PALLADIUM ${careText(DEFAULT_PROGRAM.carePiecesPalladium)}`).toBe('PLATINE Every piece · PALLADIUM Every piece');
    expect(checks).toContain('PRIVATE CARE : « PLATINE Every piece · PALLADIUM Every piece »');
    expect(warrantyCreditText({ warrantyCreditPercent: DEFAULT_PROGRAM.warrantyCreditPercent })).toBe('30 % of the piece’s value · valid 12 months');
    expect(checks).toContain('`Warranty credit` : « 30 % of the piece’s value · valid 12 months »');
    // The app's words.
    expect([PIECES.tabs.ownership, PIECES.tabs.care, PIECES.tabs.service].join(' · ')).toBe('OWNERSHIP · ORBES CARE · SERVICE');
    expect(checks).toContain('Les onglets OWNERSHIP · ORBES CARE · SERVICE');
    expect([TAB_LABELS.product, TAB_LABELS.care, TAB_LABELS.ownership].join(' · ')).toBe('PRODUCT · ORBES CARE · OWNERSHIP');
    expect(checks).toContain('Les onglets PRODUCT · ORBES CARE · OWNERSHIP');
    expect(checks).toContain(`${ORBES_CARE.warranty.label} ${ORBES_CARE.warranty.activeLifetime}`);
    expect(checks).toContain(ORBES_CARE.careLabel);
    expect(YEARLY_CARE.opens('PLATINE', 'ALL').startsWith('PRIVATE CARE opens from PLATINE')).toBe(true);
    expect(checks).toContain('« PRIVATE CARE opens from PLATINE »');
    for (const words of ['WRITE TO ORBES CLIENT SERVICES', 'SUBSCRIBE', 'SCAN ORBES CODE', 'MY PIECES', 'ORDERS', 'DOCUMENTS', 'INVOICE']) expect(checks, words).toContain(words);
    expect(checks).toContain(`${ORDERS.documents.careConditions} juste après INVOICE`);
    expect(section(runbook, '### 1.0')).toContain(`${TIER.warrantyCredit}, son montant et sa date de fin`);
    // The terms: article 11's title and the version line, as the legal pages write them; the PDF's head.
    expect(TERMS.en.sections.find((s) => s.title.startsWith('Article 11'))?.title).toBe('Article 11 — ORBES CARE and the warranties');
    expect(checks).toContain('« Article 11 — ORBES CARE and the warranties »');
    expect(checks).toContain(`« ${WORDS.en.version(LEGAL_VERSION)} »`);
    expect(checks).toContain(`« ${CARE_CONDITIONS_COPY.rows.version} ${dateInWords(CARE_CONDITIONS_VERSION, 'en').toUpperCase()} »`);
    expect(checks).toContain(`le PDF s'ouvre sur ${CARE_CONDITIONS_COPY.title}`);
  });

  it('gives one command per shell block, links only to what exists, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    expect(commands.length).toBeGreaterThan(30);
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
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-ORBES-CARE.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-ORBES-CARE.md)');
    // Never the word the brand keeps out of what it says, in the runbook's quotes of the app.
    expect(runbook).not.toMatch(/\bstolen\b/i);
  });
});
