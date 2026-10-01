/**
 * Export the demo dataset's codes as print artifacts: SVG, PNG and PDF per
 * code, a labeled multi-up PDF print sheet, and manifest.json, into
 * genome/out/demo-codes/ (git-ignored).
 *
 *   tsx scripts/export-demo-codes.ts [--out <dir>] [--formats svg,png,pdf] [--products O26-J-00184,…]
 *                                    [--width-mm 30] [--dpi 600] [--theme black|inverted|ivory]
 *                                    [--label] [--no-sheet] [--json]
 *
 * Where the codes come from
 *  - DATABASE_URL names a persistent database that holds the demo (after
 *    `npm run db:seed`): the exported codes verify against a server running on
 *    that same database. Recommended.
 *  - DATABASE_URL unset or pglite:memory: the demo is first seeded into a
 *    throw-away in-memory database. Those codes decode, but their signing key
 *    dies with this process, so any server answers INVALID SIGNATURE: print
 *    and decoder samples only. The manifest records `"ephemeral": true`.
 *
 * Every code is re-checked before it is drawn (payload ↔ row, payload hash,
 * Ed25519 signature under the registered key, genome), so a tampered row is
 * never exported as a valid-looking code. No private key is needed or used.
 *
 * Superseded and revoked codes, and codes of revoked, stolen or lost
 * products, are exported on purpose: they are how a demo shows the REVOKED
 * and SUSPICIOUS ACTIVITY states. The admin API never renders those; this tool
 * is therefore refused in production. The print sheet only holds printable
 * codes.
 *
 * Exit codes: 0 success, 1 failure, 2 usage error, 78 configuration error.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equalBytes, toBase64Url } from '../src/core/bytes.js';
import { computeGenome } from '../src/core/genome/genome.js';
import { packIdentity } from '../src/core/identity.js';
import { decodePayload, frameCodeData, signingMessage } from '../src/core/payload.js';
import type { AppConfig } from '../src/server/config.js';
import { createContext } from '../src/server/context.js';
import { verifyEd25519Node } from '../src/server/crypto/ed25519-node.js';
import { closeDb, createDb, type Db } from '../src/server/db/connection.js';
import { migrationStatus } from '../src/server/db/migrate.js';
import {
  DEMO_TIMELINE_START,
  demoSeedStatus,
  listDemoProducts,
  seedDemo,
  type DemoProductInfo,
} from '../src/server/db/seed/demo.js';
import type { CodeStatus, ProductStatus, VerificationState } from '../src/server/db/schema.js';
import { redactDatabaseUrl } from '../src/server/db/url.js';
import { isKeyTrustedAt, KeyService, MemoryKeyProvider, type KeyProvider } from '../src/server/keys/index.js';
import {
  ARTIFACT_FORMATS,
  ArtifactOptionsError,
  renderArtifact,
  renderPrintSheet,
  resolveArtifactOptions,
  type ArtifactFormat,
  type ArtifactOptions,
  type PrintSheetItem,
} from '../src/server/render/artifact.js';
import { ARTIFACT_THEME_NAMES, type ArtifactTheme } from '../src/server/render/scene.js';
import { AuditService } from '../src/server/services/audit.js';
import { createManualClock, noopLogger } from '../src/server/types.js';
import {
  cliLogger,
  consoleIO,
  errorMessage,
  EXIT,
  isEphemeralDatabase,
  isMainModule,
  loadCliConfig,
  parseCli,
  type CliDeps,
  type CliIO,
} from './db.js';

export const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../out/demo-codes');

/** Product statuses whose codes are never printed again (same rule as IssuanceService.renderCode). */
const NOT_PRINTABLE: ReadonlySet<ProductStatus> = new Set(['RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN']);

export const EXPORT_USAGE = `Usage: tsx scripts/export-demo-codes.ts [options]

Writes SVG/PNG/PDF artifacts of the demo codes, a PDF print sheet and manifest.json.
Source: the demo in DATABASE_URL (run \`npm run db:seed\` first), or a throw-away
in-memory seed when DATABASE_URL is unset or pglite:memory (codes then do not verify).

Options
  --out <dir>             Output directory (default genome/out/demo-codes)
  --formats <list>        Comma-separated subset of svg,png,pdf (default all)
  --products <ids>        Comma-separated product ids (default every demo product)
  --width-mm <n>          Code width in mm (default 30)
  --dpi <n>               PNG resolution (default 600)
  --theme <name>          black | inverted | ivory (default black)
  --label                 Print the product id under each code
  --no-sheet              Skip the multi-up PDF print sheet
  --json                  Print the manifest instead of a summary
  --verbose               Service logs on stderr
  --help                  This text`;

const EXPORT_OPTIONS = {
  out: { type: 'string' },
  formats: { type: 'string' },
  products: { type: 'string' },
  'width-mm': { type: 'string' },
  dpi: { type: 'string' },
  theme: { type: 'string' },
  label: { type: 'boolean' },
  'no-sheet': { type: 'boolean' },
  json: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export interface ExportedCode {
  productId: string;
  issue: number;
  codeStatus: CodeStatus;
  productStatus: ProductStatus;
  /** State of an anonymous scan right after seeding (later demo activity can change it). */
  expectedStateAfterSeed: VerificationState;
  scenario: string;
  /** base64url of the 79-byte framed data: what a scanner reads and POSTs to /api/v1/verify. */
  data: string;
  genomeFingerprint: string;
  files: Partial<Record<ArtifactFormat, string>>;
}

export interface ExportManifest {
  generatedAt: string;
  source: string;
  ephemeral: boolean;
  warning?: string;
  options: Required<Pick<ArtifactOptions, 'widthMm' | 'theme' | 'label' | 'dpi'>> & { formats: ArtifactFormat[] };
  codes: ExportedCode[];
  sheet: string | null;
}

export async function runExportCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? consoleIO;
  const parsed = parseCli(argv, EXPORT_OPTIONS, io, EXPORT_USAGE);
  if (typeof parsed === 'number') return parsed;
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(EXPORT_USAGE);
    return EXIT.OK;
  }
  const usage = (message: string) => {
    io.err(`export-demo-codes: ${message}\n\n${EXPORT_USAGE}`);
    return EXIT.USAGE;
  };
  if (positionals.length > 0) return usage(`unexpected argument: ${positionals.join(' ')}`);

  // ── Options ────────────────────────────────────────────────────────────
  const formats = (typeof values.formats === 'string' ? values.formats.split(',') : [...ARTIFACT_FORMATS]).map((f) => f.trim().toLowerCase());
  if (formats.length === 0 || formats.some((f) => !(ARTIFACT_FORMATS as readonly string[]).includes(f))) {
    return usage('--formats must list svg, png and/or pdf');
  }
  const theme = (values.theme ?? 'black') as string;
  if (!(ARTIFACT_THEME_NAMES as readonly string[]).includes(theme)) return usage('--theme must be black, inverted or ivory');
  const num = (name: 'width-mm' | 'dpi', fallback: number): number | undefined => {
    const v = values[name];
    if (v === undefined) return fallback;
    const n = Number(v);
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };
  const widthMm = num('width-mm', 30);
  const dpi = num('dpi', 600);
  if (widthMm === undefined || dpi === undefined) return usage('--width-mm and --dpi must be numbers');
  const artifactOptions: ArtifactOptions = { widthMm, dpi, theme: theme as ArtifactTheme, label: values.label === true, decor: true };
  try {
    for (const f of formats) resolveArtifactOptions(f as ArtifactFormat, artifactOptions);
  } catch (e) {
    if (e instanceof ArtifactOptionsError) return usage(e.message);
    throw e;
  }
  const catalogue = listDemoProducts();
  let selected = catalogue;
  if (typeof values.products === 'string') {
    const ids = values.products.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const unknown = ids.filter((id) => !catalogue.some((p) => p.productId === id));
    if (ids.length === 0 || unknown.length > 0) return usage(`not demo products: ${unknown.join(', ') || '(none given)'}`);
    selected = catalogue.filter((p) => ids.includes(p.productId));
  }
  const outDir = resolve(typeof values.out === 'string' ? values.out : DEFAULT_OUT_DIR);

  // ── Source ─────────────────────────────────────────────────────────────
  const config = loadCliConfig(deps.env ?? process.env, io);
  if (typeof config === 'number') return config;
  if (config.env === 'production') {
    io.err('export-demo-codes: refused in production (it renders revoked and restricted codes for demonstrations).');
    return EXIT.FAILURE;
  }
  const log = cliLogger(io, values.verbose === true);
  const now = deps.now?.() ?? new Date();
  const ephemeral = !deps.db && isEphemeralDatabase(config.databaseUrl);

  let db: Db | undefined;
  let closeSource = async () => {};
  try {
    let keys: KeyService;
    if (ephemeral) {
      const seeded = await seedEphemeral(config, deps, now);
      db = seeded.db;
      keys = seeded.keys;
      closeSource = seeded.close;
    } else {
      const source = deps.db ?? createDb(config.databaseUrl, { log });
      db = source;
      if (!deps.db) closeSource = () => closeDb(source);
      const pending = (await migrationStatus(source)).filter((m) => m.executedAt === undefined);
      if (pending.length > 0 || (await demoSeedStatus(source)) !== 'SEEDED') {
        io.err(`export-demo-codes: ${redactDatabaseUrl(config.databaseUrl)} does not hold the demo dataset; run \`npm run db:seed\` first.`);
        return EXIT.FAILURE;
      }
      // Public keys only: a provider that cannot sign proves no private key is touched here.
      keys = new KeyService({ db: source, provider: deps.keyProvider ?? READ_ONLY_PROVIDER, audit: new AuditService({ db: source }), cacheTtlMs: 0 });
    }

    const manifest = await exportCodes(db, keys, selected, {
      outDir,
      formats: formats as ArtifactFormat[],
      artifactOptions,
      sheet: values['no-sheet'] !== true,
      now,
      source: ephemeral ? 'ephemeral in-memory seed' : redactDatabaseUrl(config.databaseUrl),
      ephemeral,
    });
    if (values.json === true) io.out(JSON.stringify(manifest, null, 2));
    else printSummary(io, manifest, outDir);
    return EXIT.OK;
  } catch (e) {
    io.err(`export-demo-codes: ${errorMessage(e)}`);
    return EXIT.FAILURE;
  } finally {
    await closeSource();
  }
}

const READ_ONLY_PROVIDER: KeyProvider = Object.freeze({
  name: 'read-only',
  generate: async () => {
    throw new Error('export-demo-codes never creates keys');
  },
  sign: async () => {
    throw new Error('export-demo-codes never signs');
  },
});

/** Seed the demo into a private in-memory database (memory keys: nothing touches KEY_DIR). */
async function seedEphemeral(config: AppConfig, deps: CliDeps, now: Date): Promise<{ db: Db; keys: KeyService; close(): Promise<void> }> {
  const db = createDb('pglite:memory');
  const clock = createManualClock(DEMO_TIMELINE_START);
  try {
    const ctx = await createContext(
      { ...config, databaseUrl: 'pglite:memory', bootstrapAdmin: undefined },
      { db, clock: clock.now, log: noopLogger, keyProvider: deps.keyProvider ?? new MemoryKeyProvider({ env: config.env }), migrate: true },
    );
    await seedDemo(ctx, { clock, now, log: noopLogger });
    return { db, keys: ctx.keys, close: () => closeDb(db) };
  } catch (e) {
    await closeDb(db).catch(() => {});
    throw e;
  }
}

interface ExportOptions {
  outDir: string;
  formats: ArtifactFormat[];
  artifactOptions: ArtifactOptions;
  sheet: boolean;
  now: Date;
  source: string;
  ephemeral: boolean;
}

export async function exportCodes(db: Db, keys: KeyService, products: readonly DemoProductInfo[], o: ExportOptions): Promise<ExportManifest> {
  mkdirSync(o.outDir, { recursive: true });
  const codes: ExportedCode[] = [];
  const sheetItems: PrintSheetItem[] = [];

  for (const info of products) {
    const rows = await db
      .selectFrom('codes as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .innerJoin('genomes as g', 'g.id', 'c.genome_id')
      .select([
        'c.id',
        'c.key_id',
        'c.code_version',
        'c.issue',
        'c.issued_day',
        'c.nonce',
        'c.payload',
        'c.signature',
        'c.payload_hash',
        'c.status',
        'c.created_at',
        'p.packed_identity',
        'p.status as product_status',
        'g.genome_version',
        'g.glyphs',
        'g.fingerprint',
      ])
      .where('p.product_id', '=', info.productId)
      .orderBy('c.issue')
      .execute();
    if (rows.length === 0) throw new Error(`${info.productId} has no code in this database`);
    const latest = rows[rows.length - 1].issue;

    for (const row of rows) {
      const packed = Number(row.packed_identity);
      // Same end-to-end check as IssuanceService.renderCode: never draw a code that would not verify.
      let payload: ReturnType<typeof decodePayload>;
      try {
        payload = decodePayload(row.payload);
      } catch {
        throw new Error(`${info.productId} issue ${row.issue} failed its integrity check (payload does not decode)`);
      }
      const key = await keys.publicKey(row.key_id);
      const problems = [
        payload.issue !== row.issue && 'issue',
        payload.keyId !== row.key_id && 'key id',
        payload.issuedDay !== row.issued_day && 'issued day',
        payload.codeVersion !== row.code_version && 'code version',
        payload.genomeVersion !== row.genome_version && 'genome version',
        !equalBytes(payload.nonce, row.nonce) && 'nonce',
        packIdentity(payload.identity) !== packed && 'identity',
        !equalBytes(new Uint8Array(createHash('sha256').update(row.payload).digest()), row.payload_hash) && 'payload hash',
        !key && 'unknown key',
        key && !verifyEd25519Node(key.publicKey, signingMessage(row.payload), row.signature) && 'signature',
        computeGenome(packed, row.genome_version).glyphs.join() !== row.glyphs.join() && 'genome',
      ].filter(Boolean);
      if (problems.length > 0) throw new Error(`${info.productId} issue ${row.issue} failed its integrity check (${problems.join(', ')})`);

      const data = frameCodeData(row.payload, row.signature);
      const expected: VerificationState = !isKeyTrustedAt(key!, row.created_at)
        ? 'INVALID_SIGNATURE'
        : row.issue === latest
          ? info.expectedState
          : (info.previousIssues.find((p) => p.issue === row.issue)?.expectedState ?? 'REVOKED');

      const files: ExportedCode['files'] = {};
      for (const format of o.formats) {
        const artifact = await renderArtifact({ data, genomeGlyphs: row.glyphs }, format, o.artifactOptions, {
          productId: info.productId,
          issue: row.issue,
          createdAt: row.created_at,
        });
        const name = `${info.productId}-I${row.issue}.${format}`;
        writeFileSync(join(o.outDir, name), typeof artifact.body === 'string' ? artifact.body : Buffer.from(artifact.body));
        files[format] = name;
      }
      codes.push({
        productId: info.productId,
        issue: row.issue,
        codeStatus: row.status,
        productStatus: row.product_status,
        expectedStateAfterSeed: expected,
        scenario: info.scenario,
        data: toBase64Url(data),
        genomeFingerprint: row.fingerprint,
        files,
      });
      if (row.status === 'ACTIVE' && !NOT_PRINTABLE.has(row.product_status)) {
        sheetItems.push({ data, genomeGlyphs: row.glyphs, productId: info.productId });
      }
    }
  }

  let sheet: string | null = null;
  if (o.sheet && sheetItems.length > 0) {
    const day = o.now.toISOString().slice(0, 10);
    const rendered = await renderPrintSheet(
      sheetItems,
      { widthMm: Math.min(o.artifactOptions.widthMm ?? 30, 40), theme: o.artifactOptions.theme ?? 'black', label: true },
      { createdAt: o.now, caption: `ORBES DEMO CODES · ${day} · ${sheetItems.length} CODES` },
    );
    sheet = 'demo-codes-sheet.pdf';
    writeFileSync(join(o.outDir, sheet), Buffer.from(rendered.body as Uint8Array));
  }

  const resolved = resolveArtifactOptions('png', o.artifactOptions);
  const manifest: ExportManifest = {
    generatedAt: o.now.toISOString(),
    source: o.source,
    ephemeral: o.ephemeral,
    ...(o.ephemeral
      ? { warning: 'Seeded into a throw-away database: the signing key no longer exists, so these codes verify as INVALID SIGNATURE on any server. Print and decoder samples only.' }
      : {}),
    options: { widthMm: resolved.widthMm, theme: resolved.theme, label: resolved.label, dpi: resolved.dpi, formats: o.formats },
    codes,
    sheet,
  };
  writeFileSync(join(o.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function printSummary(io: CliIO, m: ExportManifest, outDir: string): void {
  const where = relative(process.cwd(), outDir) || '.';
  io.out(`Exported ${m.codes.length} demo codes (${m.options.formats.join(', ')}) to ${where}/ from ${m.source}.`);
  for (const c of m.codes) {
    io.out(`  ${`${c.productId} I${c.issue}`.padEnd(17)} ${c.expectedStateAfterSeed.padEnd(29)} ${Object.values(c.files).join(' ')}`);
  }
  if (m.sheet) io.out(`  Print sheet: ${m.sheet}`);
  io.out('  Manifest: manifest.json');
  if (m.warning) io.out(`  Warning: ${m.warning}`);
  else {
    const first = m.codes.find((c) => c.productId === 'O26-J-00184' && c.files.png);
    if (first) io.out(`  Try it: open /verify, choose UPLOAD A PHOTO and pick ${first.files.png}.`);
  }
}

if (isMainModule(import.meta.url)) {
  runExportCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`export-demo-codes: ${errorMessage(e)}\n`);
      process.exitCode = EXIT.FAILURE;
    },
  );
}
