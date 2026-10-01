/**
 * The demo tool chain as an operator runs it, on a persistent PGlite
 * directory with file-based keys (KEY_PROVIDER=local):
 *
 *   db seed → export-demo-codes → decode the exported PNG → verify it with a
 *   context opened on the same database (what the server would answer).
 *
 * Plus the throw-away path (no DATABASE_URL), whose codes must be flagged as
 * unverifiable, and the refusals.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDbCli, type CliIO } from '../../scripts/db.js';
import { runExportCli, type ExportManifest } from '../../scripts/export-demo-codes.js';
import { toBase64Url } from '../../src/core/bytes.js';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import { loadConfig } from '../../src/server/config.js';
import { createContext } from '../../src/server/context.js';
import { createManualClock } from '../../src/server/types.js';
import { rgbaToGray } from '../support/raster.js';

const NOW = new Date('2026-10-01T09:00:00.000Z');

function capture(): CliIO & { stdout: string[]; stderr: string[]; text(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l), text: () => [...stdout, ...stderr].join('\n') };
}

let dir: string;
let env: NodeJS.ProcessEnv;
let claimCode: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'orbes-export-'));
  env = {
    ORBES_ENV: 'development',
    DATABASE_URL: `pglite:${join(dir, 'db')}`,
    KEY_PROVIDER: 'local',
    KEY_DIR: join(dir, 'keys'),
    KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    DEMO_ACCOUNT_PASSWORD: 'demo-account-password-2026',
  };
  const io = capture();
  const code = await runDbCli(['seed', '--json'], { env, io, now: () => NOW });
  if (code !== 0) throw new Error(`db seed failed: ${io.text()}`);
  const result = JSON.parse(io.stdout[io.stdout.length - 1]);
  claimCode = result.claimCodes.find((c: { productId: string }) => c.productId === 'O26-J-00184').claimCode;
}, 240_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('export-demo-codes', () => {
  let manifest: ExportManifest;
  let out: string;

  it('exports SVG, PNG and PDF per code, a print sheet and a manifest from the seeded database', async () => {
    out = join(dir, 'codes');
    const io = capture();
    const code = await runExportCli(['--out', out, '--products', 'O26-J-00184,O26-J-00198,O26-J-00193', '--dpi', '300', '--json'], { env, io, now: () => NOW });
    expect(code, io.text()).toBe(0);
    manifest = JSON.parse(io.stdout.join('\n'));
    expect(manifest).toMatchObject({ ephemeral: false, sheet: 'demo-codes-sheet.pdf', options: { widthMm: 30, dpi: 300, theme: 'classic', formats: ['svg', 'png', 'pdf'] } });
    expect(manifest.warning).toBeUndefined();
    expect(manifest.codes.map((c) => [c.productId, c.issue, c.codeStatus, c.expectedStateAfterSeed])).toEqual([
      ['O26-J-00184', 1, 'ACTIVE', 'AUTHENTIC_FIRST_REGISTRATION'],
      ['O26-J-00193', 1, 'ACTIVE', 'SUSPICIOUS_ACTIVITY'],
      ['O26-J-00198', 1, 'SUPERSEDED', 'REVOKED'],
      ['O26-J-00198', 2, 'ACTIVE', 'AUTHENTIC_REGISTERED'],
    ]);
    const files = readdirSync(out).sort();
    expect(files).toEqual(
      [
        'O26-J-00184-I1.pdf', 'O26-J-00184-I1.png', 'O26-J-00184-I1.svg',
        'O26-J-00193-I1.pdf', 'O26-J-00193-I1.png', 'O26-J-00193-I1.svg',
        'O26-J-00198-I1.pdf', 'O26-J-00198-I1.png', 'O26-J-00198-I1.svg',
        'O26-J-00198-I2.pdf', 'O26-J-00198-I2.png', 'O26-J-00198-I2.svg',
        'demo-codes-sheet.pdf', 'manifest.json',
      ].sort(),
    );
    expect(readFileSync(join(out, 'O26-J-00184-I1.svg'), 'utf8')).toMatch(/<svg[\s>]/);
    expect(readFileSync(join(out, 'O26-J-00184-I1.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(readFileSync(join(out, 'demo-codes-sheet.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(manifest);
    // Nothing secret leaves the database: no claim codes, no key material.
    const text = readFileSync(join(out, 'manifest.json'), 'utf8');
    expect(text).not.toContain(claimCode);
    expect(text).not.toMatch(/"(claimCode|claimSecretHash|seed|privateKey|providerRef)"/);
  }, 120_000);

  it('the exported PNG decodes to the manifest data, and the server answers FIRST REGISTRATION for it', async () => {
    const png = PNG.sync.read(readFileSync(join(out, 'O26-J-00184-I1.png')));
    const decoded = decodeOrbesCode(rgbaToGray(png.data, png.width, png.height, 255));
    if (!decoded.ok) throw new Error(`decode failed: ${decoded.reason}`);
    const entry = manifest.codes.find((c) => c.productId === 'O26-J-00184')!;
    expect(toBase64Url(decoded.data)).toBe(entry.data);

    // What a server on this database (same configuration) answers, scan by scan.
    const config = loadConfig(env);
    const clock = createManualClock(new Date(NOW.getTime() + 60_000));
    const ctx = await createContext(config, { clock: clock.now, migrate: false, ensureActiveKey: false, bootstrapAdmin: false });
    try {
      const states: string[] = [];
      for (const c of manifest.codes) states.push((await ctx.services.verification.verify({ code: c.data }, {})).state);
      expect(states).toEqual(manifest.codes.map((c) => c.expectedStateAfterSeed));
      const first = await ctx.services.verification.verify({ code: entry.data }, {});
      expect(first.registration?.claimCodeRequired).toBe(true);
    } finally {
      await ctx.close();
    }
  }, 120_000);

  it('the throw-away path works without a database but flags its codes as unverifiable', async () => {
    const io = capture();
    const tmpOut = join(dir, 'ephemeral');
    const code = await runExportCli(['--out', tmpOut, '--products', 'O26-J-00184', '--formats', 'svg', '--no-sheet'], {
      env: { ORBES_ENV: 'development' },
      io,
      now: () => NOW,
    });
    expect(code, io.text()).toBe(0);
    expect(io.text()).toMatch(/verify as INVALID SIGNATURE on any server/);
    expect(readdirSync(tmpOut).sort()).toEqual(['O26-J-00184-I1.svg', 'manifest.json']);
    const m = JSON.parse(readFileSync(join(tmpOut, 'manifest.json'), 'utf8')) as ExportManifest;
    expect(m).toMatchObject({ ephemeral: true, sheet: null, source: 'ephemeral in-memory seed' });
    // The ephemeral seed must not leave key files behind in a configured KEY_DIR.
    expect(existsSync(join(dir, 'keys'))).toBe(true);
    expect(readdirSync(join(dir, 'keys'))).toHaveLength(1);
  }, 240_000);

  it('validates its options and refuses production and databases without the demo', async () => {
    const bad = async (argv: string[]) => {
      const io = capture();
      return { code: await runExportCli(argv, { env, io, now: () => NOW }), io };
    };
    expect((await bad(['--formats', 'gif'])).code).toBe(2);
    expect((await bad(['--theme', 'neon'])).code).toBe(2);
    expect((await bad(['--products', 'O26-J-99999'])).code).toBe(2);
    expect((await bad(['--dpi', 'many'])).code).toBe(2);
    expect((await bad(['--width-mm', '1'])).code).toBe(2);
    expect((await bad(['stray'])).code).toBe(2);

    const prodIo = capture();
    const prod = await runExportCli([], {
      env: {
        ORBES_ENV: 'production',
        DATABASE_URL: 'postgres://orbes@db.invalid:5432/orbes',
        PUBLIC_ORIGIN: 'https://verify.example.com',
        COOKIE_SECRET: randomBytes(32).toString('base64url'),
        IP_HASH_PEPPER: randomBytes(32).toString('base64url'),
        KEY_PROVIDER: 'local',
        KEY_DIR: '/var/lib/orbes/keys',
        KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      },
      io: prodIo,
    });
    expect(prod).toBe(1);
    expect(prodIo.text()).toMatch(/refused in production/);

    const emptyIo = capture();
    const empty = await runExportCli(['--out', join(dir, 'none')], {
      env: { ORBES_ENV: 'development', DATABASE_URL: `pglite:${join(dir, 'empty-db')}` },
      io: emptyIo,
    });
    expect(empty).toBe(1);
    expect(emptyIo.text()).toMatch(/run `npm run db:seed` first/);
  }, 120_000);
});
