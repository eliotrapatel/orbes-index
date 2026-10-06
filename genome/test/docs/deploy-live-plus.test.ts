/**
 * docs/launch/DEPLOY-LIVE-RELEASE-PLUS.md, the owner's runbook for deployment E, LIVE RELEASE+ (plan of 2026-10-04),
 * against the scripts, the migrations, the app and the screens it quotes:
 *
 *  - its starting point is the production of deployment D (commit 86bd579, image 86bd579e4aa9, migrations 0001 to
 *    0021), and deployment E applies exactly the migrations after 0021 of its plan, 0022 and 0023 (0024 is NOCTURNE's,
 *    its own deployment): the table of §1.0,
 *    the line `db.ts migrate` prints, those deploy.sh prints after it, the deployment log and the count `db.ts status`
 *    shows;
 *  - every message it expects from deploy.sh, backup.sh, restore.sh, lib.sh and the app is still one they print, the
 *    first boot's line of the stock and the orders included;
 *  - the rules of the shared host: never 03:00–05:30 UTC, the pre-check of DEPLOYMENT §15.7 before and after, the
 *    launch guarded by `pgrep -a pg_dump`, restore.sh only ever run to watch it refuse, no prune, the fast-forward to
 *    the final commit after its check, and nothing of the host changed (no file of deploy/vps since D, no variable);
 *  - the legal pages' one version, the one the code publishes, after D's;
 *  - the capacity measured again with LIVE RELEASE+ (docs/reports/live-load.md) is the console's (LIVE_ROOM_CAPACITY);
 *  - the first boot it describes is the code's: the two locations and the four carriers, and the orders of the sales
 *    made before E, each as prepare() maps it (a concluded reservation PAID with its invoice issued at boot, without a
 *    buyer), with what the owner does before (the open reservations) and after (the `orders` figure, the Orders page);
 *  - one real check per feature of the plan, each quoting only labels the verification app, the console or the server
 *    shows, and what the trial leaves out naming the tests that cover it;
 *  - one command per shell block, the console's shell commands as scripts/db.ts knows them, relative links that resolve.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB_USAGE } from '../../scripts/db.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES } from '../../src/server/services/after-room.js';
import { LIVE_ROOM_CAPACITY } from '../../src/server/services/live-insights.js';
import { dateInWords, LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { REPO, readDoc, section } from './lexicon.js';
import { anchors, fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-LIVE-RELEASE-PLUS.md';
const runbook = readDoc(RUNBOOK);
const stackFile = (name: string): string => readDoc(`deploy/vps/${name}`);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** The production deployment E starts from: deployment D of DEPLOY-LIVE-RELEASE.md, live since 2026-10-05, 02:13 UTC. */
const START_COMMIT = '86bd579e4aa96b74b86f74c0b892da51026cdf12';
const START_TAG = START_COMMIT.slice(0, 12);
const START_SUBJECT = 'LIVE: a turn the engine has already marked MISSED answers LIVE_TURN_PASSED to a late PRESS or SECURE, never LIVE_NOT_YOUR_TURN';
const NAMES = Object.keys(MIGRATIONS);
const numberOf = (name: string): number => Number(name.slice(0, 4));
const START_MIGRATIONS = NAMES.filter((n) => numberOf(n) <= 21);
/** Deployment E: every migration after D's, 0022 and 0023 (a later number needs its own plan and runbook). */
const DEPLOY_E = NAMES.filter((n) => numberOf(n) > 21 && numberOf(n) <= 23);
/** The schema deployment E leaves: every migration up to 0023. */
const AFTER_E = NAMES.filter((n) => numberOf(n) <= 23);
/** The version the legal pages published with deployment D: E's comes after it. */
const D_LEGAL_VERSION = '2026-10-06';

/** What the runbook expects from the scripts and the app, each printed word for word by its source. */
const MESSAGES: ReadonlyArray<readonly [message: string, source: string]> = [
  ['= commit ', 'deploy/vps/scripts/deploy.sh'],
  ['build orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['Caddy configuration valid (TLS_MODE=', 'deploy/vps/scripts/lib.sh'],
  ['(or the Caddyfile) first: nothing was changed', 'deploy/vps/scripts/deploy.sh'],
  ['previous image tag: ', 'deploy/vps/scripts/deploy.sh'],
  [' migration(s) applied, all known to ', 'deploy/vps/scripts/deploy.sh'],
  ['nothing was changed', 'deploy/vps/scripts/deploy.sh'],
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
  [' after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7).', 'deploy/vps/scripts/deploy.sh'],
  [' OK (previous ', 'deploy/vps/scripts/deploy.sh'],
  ['; migrations ', 'deploy/vps/scripts/deploy.sh'],
  ['no rollback: repair forward', 'deploy/vps/scripts/deploy.sh'],
  [' and is KEPT', 'deploy/vps/scripts/deploy.sh'],
  ['Repair forward:', 'deploy/vps/scripts/deploy.sh'],
  ['rollback to orbes-genome:', 'deploy/vps/scripts/deploy.sh'],
  ['rolled back to ', 'deploy/vps/scripts/deploy.sh'],
  ['; the stack is healthy', 'deploy/vps/scripts/deploy.sh'],
  [' is NOT healthy either', 'deploy/vps/scripts/deploy.sh'],
  ['this image cannot run on this schema: repair forward', 'deploy/vps/scripts/deploy.sh'],
  ['photos: ', 'deploy/vps/scripts/backup.sh'],
  ['db.dump: ', 'deploy/vps/scripts/backup.sh'],
  ['keys.tar: ', 'deploy/vps/scripts/backup.sh'],
  ['encrypt to ', 'deploy/vps/scripts/backup.sh'],
  ['backup complete: ', 'deploy/vps/scripts/backup.sh'],
  ['[dry-run] would ', 'deploy/vps/scripts/backup.sh'],
  ['restore.sh is disabled on this server (RESTORE_ALLOWED=false in ', 'deploy/vps/scripts/restore.sh'],
  ['Nothing was done.', 'deploy/vps/scripts/restore.sh'],
  ['live engine: leading', 'genome/src/server/services/live-engine.ts'],
  ['stock and orders ready', 'genome/src/server/context.ts'],
];

/** The labels §1.7 quotes, as the verification app (`web/verify`) shows them. */
const VERIFY_LABELS = [
  'THE RELEASES', 'PAST', 'YOU SECURED A PIECE', 'THIS RELEASE IS OVER', 'A SURPRISE IN EVERY BOX', 'ENTER THE ROOM', 'PAY · ', 'MY PIECES',
  'YOUR ORDERS', 'SIZE', 'PRICE', 'TOTAL', 'SOLD OUT', 'THE AFTER-ROOM', 'A SECOND DOOR', 'ENTER THE AFTER-ROOM', 'THE AFTER-ROOM IS CLOSED',
  'ONE QUESTION', 'PAID', 'DOCUMENTS', 'INVOICE', 'CARE GUIDE', 'SHIPPED', 'CARRIER', 'TRACKING NUMBER', 'TRACK THE SHIPMENT', 'DELIVERED',
  'RETURNED', 'CREDIT NOTE', 'AFTER THE RELEASES',
] as const;
/** The words §1.7 quotes that the server writes (the public rule, the refusal, the default question and its answers). */
const SERVER_LABELS = ['selected collectors', 'This release is for selected collectors.', 'WHAT WOULD YOU HAVE WANTED?', 'ANOTHER SIZE', 'ANOTHER FINISH', 'You have taken part in '] as const;
/** The labels §1.7 quotes, as the console (`web/admin`) shows them. */
const CONSOLE_LABELS = [
  'Orders', 'Settings', 'DEFAULT', 'OFFERED', 'Tracking link', 'Late orders', 'Catalogue', 'Edit', 'Base price', 'Care guide', 'Price · Shopify',
  'NOT LINKED', 'Shopify export', 'Segments', 'New segment', 'Models', 'Create segment', 'Collectors now', 'Club', 'Drops', 'New live release',
  'Opening (UTC)', 'End of the sales (UTC)', 'Price of a piece', 'Currency', 'Stock location', 'Sizes', 'Access', 'Segment', 'Surprise',
  'A surprise in every box', 'What it is (internal)', 'After-room', 'An after-room after a sell-out', 'Opens (minutes after the sell-out)',
  'Open (minutes)', 'Publish the release', 'Best time to open', 'Analytics', 'Stock', 'Question after', 'Every release', 'Atelier',
  'Print work sheets', 'The buyer', 'Name', 'Address', 'Buyer saved.', 'Mark paid', 'Order paid.', 'Documents', 'PDF', 'Start', 'Done', 'Material',
  'Production batch', 'Production date', 'Issue the piece', 'Piece issued.', 'Its claim code', 'Packing slip', 'Print', 'Ship', 'Carrier',
  'Tracking number', 'Declared value', 'Order shipped.', 'Mark delivered', 'Order delivered.', 'Open a return', 'The piece goes', 'Note', 'ARCHIVE',
  'Open the return', 'Order returned.', 'Invoices', 'Totals of the month', 'Download the month (CSV)', 'Owners', 'First day', 'Last day',
  'Set a minimum', 'Minimum', 'Suggested', 'Warranties',
] as const;

function sources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? [sources(join(dir, e.name))] : /\.ts$/.test(e.name) ? [readFileSync(join(dir, e.name), 'utf8')] : []))
    .join('\n');
}

describe('the LIVE RELEASE+ runbook (docs/launch/DEPLOY-LIVE-RELEASE-PLUS.md)', () => {
  it('starts from the production of deployment D: commit 86bd579, its image, the migrations 0001 to 0021', () => {
    expect(START_MIGRATIONS).toHaveLength(21);
    expect(START_MIGRATIONS.at(-1)).toBe('0021_live_release');
    expect(runbook).toContain(`la production tourne le commit \`${START_COMMIT}\` (image \`orbes-genome:${START_TAG}\`)`);
    expect(commands).toContain("git -C /opt/orbes/orbes-index log -1 --format='%H %s'");
    expect(runbook).toContain(`Sortie attendue : \`${START_COMMIT} ${START_SUBJECT}\``);
    expect(runbook).toContain(`ORBES_IMAGE_TAG=${START_TAG}`);
    // What db_applied_migrations reads before deployment E, line for line.
    expect(outputs).toContain(START_MIGRATIONS.join('\n'));
    expect(runbook).toContain(`schema: ${START_MIGRATIONS.length} migration(s) applied, all known to orbes-genome:<TAG_E>`);
    // Deployment D's runbook records it done and hands the next one to this runbook.
    const d = readDoc('docs/launch/DEPLOY-LIVE-RELEASE.md');
    expect(d).toContain(`**Fait** le 2026-10-05 à 02:13 UTC (image \`orbes-genome:${START_TAG}\`)`);
    expect(d).toContain('[son propre runbook](DEPLOY-LIVE-RELEASE-PLUS.md)');
  });

  it('applies exactly the migrations after 0021, 0022 and 0023, as the scripts print them', () => {
    expect(DEPLOY_E).toEqual(['0022_orders_stock', '0023_releases_collectors']);
    // A later number has its own plan and runbook: 0024 is NOCTURNE's (plan of 2026-10-05: a model's variants and a
    // draw's price), which ships as its own deployment after E.
    expect(NAMES.filter((n) => numberOf(n) > 23)).toEqual(['0024_model_variants']);
    const rows = [...section(runbook, '### 1.0').matchAll(/^ *\| `(\d{4}_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(rows).toEqual(DEPLOY_E);
    expect(readDoc('genome/scripts/db.ts')).toContain("`Applied ${applied.length} migration(s): ${applied.join(', ')}`");
    expect(runbook).toContain(`Applied ${DEPLOY_E.length} migration(s): ${DEPLOY_E.join(', ')}`);
    expect(runbook).toContain(`(previous: ${START_TAG}). This release applied the migration(s) ${DEPLOY_E.join(', ')}:`);
    expect(runbook).toContain(`deploy <TAG_E> OK (previous ${START_TAG}; migrations ${DEPLOY_E.join(', ')})`);
    expect(runbook).toContain(`orbes-genome:${START_TAG} cannot run on this schema any more`);
    expect(runbook).toContain(`les ${AFTER_E.length} lignes \`applied\`, de \`${AFTER_E[0]}\` à \`${AFTER_E.at(-1)}\``);
  });

  it('expects from the scripts and the app only messages they print', () => {
    for (const [message, source] of MESSAGES) {
      expect(runbook, message).toContain(message);
      expect(readDoc(source), `${message}: not in ${source}`).toContain(message);
    }
    // The first boot's line and the engine's are read from the whole log of the app's container, which this deployment
    // recreates: a window (--since) would miss them when the post-checks run late. The first boot's line is read whole,
    // for the number of orders it carries.
    expect(commands).toContain("docker compose logs app | grep 'stock and orders ready'");
    expect(commands).toContain("docker compose logs app | grep -c 'live engine: leading'");
    expect(commands.filter((c) => c.includes('docker compose logs') && c.includes('--since'))).toEqual([]);
  });

  it('describes the first boot as the code does it: the two locations and the four carriers, created once', () => {
    const stock = readDoc('genome/src/server/services/stock.ts');
    for (const name of ['FRANCE WAREHOUSE', 'LOGISTICS WAREHOUSE', 'Colissimo', 'Chronopost', 'DHL Express', 'UPS']) {
      expect(stock, name).toContain(`'${name}'`);
      expect(section(runbook, '### 1.0'), name).toContain(name);
    }
    expect(readDoc('genome/src/server/context.ts')).toContain('const prepared = await services.orders.prepare();');
    // The alerts' delays the trial reads are the migration's defaults.
    const migration = readDoc('genome/src/server/db/migrations/0022_orders_stock.ts');
    for (const [column, days] of [['reserved_days', 2], ['ready_days', 3], ['shipped_days', 10], ['unregistered_days', 30]] as const) {
      expect(migration).toMatch(new RegExp(`${column} +smallint +NOT NULL DEFAULT ${days} `));
    }
    expect(section(runbook, '### 1.7')).toContain('`Late orders` : 2, 3, 10 et 30 jours');
  });

  it('says what each sale made before E becomes at the first boot, and what the owner does before and after', () => {
    const orders = readDoc('genome/src/server/services/orders.ts');
    const prepare = orders.slice(orders.indexOf('async prepare()'), orders.indexOf('// ── internals'));
    // A LIVE reservation concluded becomes PAID, which issues its invoice there and then, with the buyer the order has: none.
    expect(prepare).toContain("if (entry.resolution === 'CONCLUDED') await step(tx, o, { to: 'PAID'");
    expect(prepare).toContain("if (entry.resolution === 'CANCELLED') await step(tx, o, { to: 'CANCELLED'");
    expect(orders).toContain("const document = s.to === 'PAID' ? await issueInvoice(tx, after, actor, now)");
    expect(readDoc('genome/src/server/services/invoices.ts')).toContain('const buyer: InvoiceBuyer = { name: o.buyer_name, address: o.buyer_address, email: facts.email };');
    expect(readDoc('genome/src/server/db/migrations/0022_orders_stock.ts')).toContain('CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices');
    // An open one holds a piece (the locations empty: one to make, its identity reserved); a cancelled one holds nothing;
    // a draw's place has no SKU, so holds nothing until its terms are entered; each dated by its sale.
    expect(prepare).toContain("{ hold: entry.resolution !== 'CANCELLED', reservedAt: e.confirmed_at ?? now }");
    expect(prepare).toContain('orderForDrawEntry(tx, e.id, SYSTEM_ACTOR, now, { reservedAt: e.handled_at ?? now })');
    expect(orders).toContain('if (o.sku_id === null || o.reservation !== null || !ORDER_HOLDING_STATUSES.includes(o.status)) return o;');
    const first = section(runbook, '### 1.0');
    for (const words of [
      'une réservation d\'une LIVE RELEASE **conclue** (`Concluded` dans `Client Services`) devient PAID : sa facture `INV-…` est émise au démarrage, sans le nom ni l\'adresse de l\'acheteur',
      'une réservation **annulée** devient CANCELLED et ne tient rien',
      'une réservation **encore ouverte** devient RESERVED ; comme une conclue, elle tient une pièce du stock ou, les lieux étant vides au premier démarrage, une pièce à fabriquer dans `Atelier`, qui réserve son numéro de série',
      'une place d\'une sortie tirée **confirmée** (depuis le déploiement A) devient RESERVED, sans taille ni prix (dans MY PIECES, les deux se lisent `TO BE CONFIRMED`)',
      '`LATE · NOT PAID`',
      '**Avant de déployer** (§1.1, étape 7)',
      '**Après** (§1.6), ouvre `Orders`',
    ]) {
      expect(first, words).toContain(words);
    }
    expect(first).not.toContain('Rien à faire');
    expect(readDoc('genome/src/web/verify/copy.ts')).toContain("toConfirm: 'TO BE CONFIRMED'");
    expect(readDoc('genome/src/web/admin/model/orders.ts')).toContain("RESERVED: 'LATE · NOT PAID'");
    expect(readDoc('genome/src/server/services/fulfilment.ts')).toContain('reservedDays: 2,');
    expect(readDoc('genome/src/server/services/invoices.ts')).toContain("INVOICE: 'INV'");
    // Before: D's console, its Client Services section, as the production image shows it.
    expect(section(runbook, '### 1.1')).toContain('**7. Les réservations encore ouvertes.** Dans la console de D : `Club` → onglet `Drops` → chaque LIVE RELEASE, sa section `Client Services`.');
    for (const label of ['TO CONCLUDE', 'Cancel', 'Cancel the reservation', 'Concluded', 'Pieces']) expect(section(runbook, '### 1.1'), label).toContain(`\`${label}\``);
    // After: the figure the first boot's line carries, as context.ts logs it.
    expect(readDoc('genome/src/server/context.ts')).toContain("log.info(prepared, 'stock and orders ready');");
    expect(prepare).toContain('return { ...setup, linked, orders };');
    expect(section(runbook, '### 1.6')).toContain('"orders":<nombre>,"msg":"stock and orders ready"}');
    expect(section(runbook, '### 1.6')).toContain('Lis `"orders"`');
  });

  it('keeps the rules of the shared host: the window, nothing of the host changed, the guarded launch, no restore, no prune', () => {
    expect(runbook).toContain('**Jamais entre 03:00 et 05:30 UTC**');
    expect(runbook).toContain('**Jamais `restore.sh` sur ce serveur**');
    expect(runbook).toContain('**Rien ne change sur l\'hôte**');
    for (const c of commands.filter((c) => /restore\.sh/.test(c))) expect(c).toMatch(/--dry-run/);
    for (const c of commands) expect(c).not.toMatch(/\bprune\b/);
    // The launch is guarded, every time: never a bare deploy.sh.
    const launches = commands.filter((c) => /scripts\/deploy\.sh/.test(c));
    expect(launches).toEqual(['pgrep -a pg_dump || scripts/deploy.sh']);
    expect(commands).toContain('pgrep -a pg_dump');
    // The pre-check, before and after.
    const deployment = readDoc('docs/DEPLOYMENT.md');
    for (const c of ['free -h', 'docker stats --no-stream', 'df -h /', 'du -sh /var/backups/orbes']) {
      expect(deployment).toContain(c);
      expect(commands.filter((x) => x === c).length, c).toBeGreaterThanOrEqual(2);
    }
    // umask, then the commit checked, then merged, then the stack and the version checked, then the guarded launch.
    const at = (c: string) => commands.indexOf(c);
    const check = at("git -C /opt/orbes/orbes-index log -1 --format='%H %s' origin/claude/orbes-genome-code-system-o8bmnk");
    const merge = at('git -C /opt/orbes/orbes-index merge --ff-only origin/claude/orbes-genome-code-system-o8bmnk');
    const stack = at(`git -C /opt/orbes/orbes-index diff --stat ${START_COMMIT} HEAD -- deploy/vps`);
    const version = at("git -C /opt/orbes/orbes-index grep -h '^export const LEGAL_VERSION' HEAD -- genome/src/web/legal/content/index.ts");
    const deploy = at('pgrep -a pg_dump || scripts/deploy.sh');
    expect(at('umask 022')).toBeGreaterThan(-1);
    expect(at('umask 022')).toBeLessThan(check);
    expect(check).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(check);
    expect(stack).toBeGreaterThan(merge);
    expect(version).toBeGreaterThan(stack);
    expect(deploy).toBeGreaterThan(version);
    expect(commands).toContain("grep -n '^RESTORE_ALLOWED=' .env");
    expect(runbook).toContain('`<numéro>:RESTORE_ALLOWED=false`');
    for (const c of commands.filter((c) => c.startsWith('docker image rm '))) expect(c).not.toContain(START_TAG);
    // Nothing of the stack changed since D: the server checks it, and no command writes a variable.
    expect(section(runbook, '### 1.3')).toContain('Rien de la pile du serveur n\'a changé');
    expect(commands.filter((c) => />> \.env$/.test(c))).toEqual([]);
    expect(section(runbook, '### 1.0')).toContain('**Caddy, les variables** : rien ne change.');
  });

  it('states the capacity the load test measured again with LIVE RELEASE+, the one the console warns against', () => {
    const capacity = String(LIVE_ROOM_CAPACITY.inRoom).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    expect(section(runbook, '### 1.0')).toContain(`**${capacity} personnes dans la salle**`);
    expect(section(runbook, '### 1.0')).toContain('[le rapport de charge](../reports/live-load.md)');
    const report = readDoc('docs/reports/live-load.md');
    expect(report).toContain(`**Measured capacity: ${capacity} people in the room.**`);
    expect(report).toContain('Owner: LIVE RELEASE+');
  });

  it('gives the legal pages the one version the code publishes, after D’s', () => {
    expect(LEGAL_VERSION > D_LEGAL_VERSION).toBe(true);
    expect(section(runbook, '## 0.')).toContain(`une seule nouvelle version pour le déploiement E, \`${LEGAL_VERSION}\`, la date qui suit celle de D`);
    expect(section(runbook, '### 1.3')).toContain(`Sortie attendue : \`export const LEGAL_VERSION = '${LEGAL_VERSION}';\`.`);
    expect(readDoc('genome/test/web/legal.content.test.ts')).toContain(`'${LEGAL_VERSION}': '`);
    // The drafts carry the same day as the pages.
    expect(readDoc('docs/legal/terms.en.md')).toContain(`Version: ${dateInWords(LEGAL_VERSION, 'en')}.`);
    expect(readDoc('docs/legal/terms.fr.md')).toContain(`Version : ${dateInWords(LEGAL_VERSION, 'fr')}.`);
  });

  it('checks every feature once, live, with only labels the apps and the server show', () => {
    const checks = section(runbook, '### 1.7');
    const features = [...checks.matchAll(/^\| ([^|]+) \| [^|]+ \| [^|]+ \| [^|]+ \|$/gm)].map((m) => m[1].trim()).filter((f) => f !== 'Élément' && !/^-+$/.test(f));
    for (const f of [
      'Les lieux, les transporteurs, les retards', 'Le prix de base', 'Les segments', 'La proposition des tailles', 'Le meilleur moment pour ouvrir',
      'La vérification du stock', 'L\'accès par segment', 'La surprise', 'La vente et la commande', 'La salle d\'après', 'Personne d\'autre ne la voit',
      'La question d\'après', 'PAST', 'Le tableau des commandes', 'La pièce à fabriquer et sa fiche', 'L\'acheteur', 'PAID et la facture',
      'L\'atelier émet la pièce', 'Le bordereau', 'L\'expédition et le suivi', 'La livraison', 'Le retour et l\'avoir', 'Les factures', 'La fiche client',
      'L\'export des commandes', 'Le seuil et sa suggestion',
    ]) {
      expect(features.some((x) => x.startsWith(f)), f).toBe(true);
    }
    // Each check names the plan's choices it covers; together they cover choices 2 to 27 and decisions 28, 31 and 32.
    const cited = new Set(features.flatMap((f) => [...(/\(([^)]*)\)$/.exec(f)?.[1] ?? '').matchAll(/\d+/g)].map((m) => Number(m[0]))));
    for (const n of [2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 31, 32]) expect(cited.has(n), `choice ${n}`).toBe(true);
    const verify = sources(join(REPO, 'genome/src/web/verify'));
    const admin = sources(join(REPO, 'genome/src/web/admin'));
    const server = sources(join(REPO, 'genome/src/server/services'));
    for (const label of VERIFY_LABELS) {
      expect(verify, label).toContain(label);
      expect(checks, label).toContain(label);
    }
    for (const label of SERVER_LABELS) {
      expect(server, label).toContain(label);
      expect(checks.toLowerCase(), label).toContain(label.toLowerCase());
    }
    for (const label of CONSOLE_LABELS) {
      expect(admin, label).toContain(label);
      expect(runbook, label).toContain(`\`${label}\``);
    }
    // GET /api/v1/live lists every release announced, whatever its access rule: the trial is seen by all, entered only by its segment.
    expect(checks).toContain('visible **de tous** dans THE RELEASES et la bannière');
    expect(checks).toContain('seuls les membres du segment d\'essai peuvent y entrer');
    expect(checks).not.toMatch(/visible[^.]*pour les seuls membres/);
    // The trial's after-room: a minute after the sell-out, open 5 minutes, both within the bounds the console takes.
    expect(1).toBeGreaterThanOrEqual(AFTER_ROOM_DELAY_MINUTES.min);
    expect(5).toBeGreaterThanOrEqual(AFTER_ROOM_LENGTH_MINUTES.min);
    expect(checks).toContain('`Opens (minutes after the sell-out)` `1`, `Open (minutes)` `5`');
    // The feasibility check as the console words it for the trial's two pieces to make.
    expect(admin).toContain('on sale would be made to order once sold (${where}).');
    // What the trial leaves out says why, and names the tests that cover it.
    const left = checks.split('\n').find((l) => l.startsWith('Restent hors de l\'essai'));
    expect(left).toBeDefined();
    for (const why of ['l\'annulation d\'une commande', 'le retour au stock', 'la livraison posée par l\'enregistrement', 'l\'accès par la participation', 'elle atteindrait de vrais membres', 'il faut des jours']) expect(left, why).toContain(why);
    const tests = [...left!.matchAll(/`(genome\/test\/[^`]+\.test\.ts)`/g)].map((m) => m[1]);
    expect(tests.length).toBeGreaterThanOrEqual(6);
    for (const t of tests) expect(existsSync(join(REPO, t)), t).toBe(true);
    // The trial shows in PAST for good: rule 9 says so before anything is published.
    expect(section(runbook, '## 0.')).toContain('Une sortie finie paraît ensuite pour toujours dans l\'onglet PAST, publiquement');
    expect(readDoc('genome/src/server/services/past-releases.ts')).toContain(".where('d.cancelled_at', 'is', null)");
  });

  it('gives one command per shell block, and runs the tools as they are', () => {
    expect(commands.length).toBeGreaterThan(30);
    for (const c of commands) expect(c.split('\n'), c).toHaveLength(1);
    for (const c of commands.filter((c) => c.includes('scripts/db.ts'))) {
      const [, sub] = c.match(/scripts\/db\.ts ([a-z-]+)/)!;
      expect(DB_USAGE, sub).toMatch(new RegExp(`^\\s+${sub}\\b`, 'm'));
    }
    for (const fn of ['db_applied_migrations', 'db_photo_usage']) {
      expect(commands).toContain(`bash -c 'set -Eeuo pipefail; source scripts/lib.sh; ${fn}'`);
      expect(stackFile('scripts/lib.sh')).toContain(`${fn}() {`);
    }
    expect(stackFile('scripts/restore.sh')).toMatch(/--identity\)/);
    expect(stackFile('scripts/backup.sh')).toMatch(/--dry-run\)/);
    // The public reads after the deployment: PAST answers everyone, the orders a signed-in account, the console its staff.
    for (const path of ['/api/v1/releases/past', '/api/v1/account/orders', '/api/admin/orders']) {
      expect(commands).toContain(`curl -s -o /dev/null -w '%{http_code}\\n' https://verify.theorbes.com${path}`);
    }
  });

  it('links only to files and headings that exist, and is linked from DEPLOYMENT and COMPLIANCE', () => {
    const dir = dirname(join(REPO, RUNBOOK));
    for (const [, target] of runbook.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      const [path, anchor] = target!.split('#');
      const file = path ? resolve(dir, path) : join(REPO, RUNBOOK);
      expect(existsSync(file), target).toBe(true);
      if (anchor) expect(anchors(readDoc(file.slice(REPO.length + 1))).has(decodeURIComponent(anchor)), target).toBe(true);
    }
    expect(readDoc('docs/DEPLOYMENT.md')).toContain('(launch/DEPLOY-LIVE-RELEASE-PLUS.md)');
    expect(readDoc('docs/COMPLIANCE.md')).toContain('(launch/DEPLOY-LIVE-RELEASE-PLUS.md)');
  });
});
