/**
 * scripts/keys.ts against an in-memory database and a real LocalKeyProvider
 * in a temporary directory: generate (idempotent), rotate, list, retire,
 * revoke with a compromise time, and every refusal path.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyFingerprint, runKeysCli } from '../../scripts/keys.js';
import type { CliIO } from '../../scripts/db.js';
import { createTestDb, type TestDb } from '../support/db.js';

function capture(): CliIO & { stdout: string[]; stderr: string[]; text(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l), text: () => [...stdout, ...stderr].join('\n') };
}

let t: TestDb;
let dir: string;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  t = await createTestDb();
  dir = mkdtempSync(join(tmpdir(), 'orbes-keys-cli-'));
  env = {
    ORBES_ENV: 'test',
    KEY_PROVIDER: 'local',
    KEY_DIR: join(dir, 'keys'),
    KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  };
});

afterAll(async () => {
  await t?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function run(argv: string[], e: NodeJS.ProcessEnv = env, db = t.db) {
  const io = capture();
  const code = await runKeysCli(argv, { env: e, io, db });
  return { code, io };
}

describe('keys CLI', () => {
  it('lists an empty registry', async () => {
    const r = await run(['list']);
    expect(r.code).toBe(0);
    expect(r.io.text()).toMatch(/No signing keys/);
  });

  it('generates the first key once, encrypted at rest in KEY_DIR, and proves it can sign', async () => {
    const first = await run(['generate', '--json']);
    expect(first.code).toBe(0);
    const out = JSON.parse(first.io.stdout[0]);
    expect(out).toMatchObject({ created: true, usable: true, key: { keyId: 1, status: 'ACTIVE', alg: 'Ed25519', provider: 'local' } });

    const files = readdirSync(env.KEY_DIR!);
    expect(files).toEqual([`${out.key.kid}.key.json`]);
    expect(statSync(join(env.KEY_DIR!, files[0])).mode & 0o777).toBe(0o600);
    // The file holds ciphertext only; the CLI output holds the public key only.
    const file = JSON.parse(readFileSync(join(env.KEY_DIR!, files[0]), 'utf8'));
    expect(Object.keys(file).sort()).toEqual(['alg', 'ct', 'iv', 'kid', 'tag', 'v']);
    expect(first.io.text()).not.toContain(file.ct);
    expect(Object.keys(out.key)).not.toContain('seed');

    const again = await run(['generate']);
    expect(again.code).toBe(0);
    expect(again.io.text()).toMatch(/already ACTIVE; nothing to do/);
    expect(readdirSync(env.KEY_DIR!)).toHaveLength(1);
  });

  it('rotates: the new key is ACTIVE, the old one RETIRED (verify-only)', async () => {
    const r = await run(['rotate', '--kid', 'ops-test-k2', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.io.stdout[0])).toMatchObject({ key: { keyId: 2, kid: 'ops-test-k2', status: 'ACTIVE' }, retiredKeyId: 1 });

    const list = JSON.parse((await run(['list', '--json'])).io.stdout[0]);
    expect(list.keys.map((k: { keyId: number; status: string }) => [k.keyId, k.status])).toEqual([
      [1, 'RETIRED'],
      [2, 'ACTIVE'],
    ]);
    for (const k of list.keys) expect(k.fingerprint).toBe(keyFingerprint(Buffer.from(k.publicKey, 'base64url')));

    const table = (await run(['list'])).io.text();
    expect(table).toMatch(/1\s+RETIRED/);
    expect(table).toMatch(/2\s+ACTIVE\s+ops-test-k2/);
  });

  it('refuses destructive commands without --yes and malformed arguments, before touching the database', async () => {
    expect((await run(['revoke', '1', '--reason', 'test'])).code).toBe(2);
    expect((await run(['retire', '2'])).code).toBe(2);
    expect((await run(['revoke', '999', '--reason', 'x', '--yes'])).code).toBe(2);
    expect((await run(['revoke', '1', '--yes'])).code).toBe(2);
    const noZone = await run(['revoke', '1', '--reason', 'x', '--compromised-at', '2026-09-01T00:00:00', '--yes']);
    expect(noZone.code).toBe(2);
    expect(noZone.io.text()).toMatch(/timezone/);
    expect((await run(['list', '--kid', 'x'])).code).toBe(2);
    expect((await run(['explode'])).code).toBe(2);
    expect((await run(['list', '--bogus'])).code).toBe(2);
    expect((await run([])).code).toBe(2);
  });

  it('revokes with a compromise time, and audits every change as the CLI operator', async () => {
    const r = await run(['revoke', '1', '--reason', 'Laptop with the key backup was stolen', '--compromised-at', '2026-09-01T00:00:00Z', '--yes']);
    expect(r.code).toBe(0);
    expect(r.io.text()).toMatch(/Codes recorded before 2026-09-01T00:00:00.000Z stay trusted/);
    const row = await t.db.selectFrom('cryptographic_keys').selectAll().where('key_id', '=', 1).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'REVOKED', revocation_reason: 'Laptop with the key backup was stolen' });
    expect(row.compromised_at?.toISOString()).toBe('2026-09-01T00:00:00.000Z');

    // Revoking again may only move the compromise EARLIER.
    expect((await run(['revoke', '1', '--reason', 'again', '--yes'])).code).toBe(1);

    const audit = await t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'actor_id']).where('action', 'like', 'key.%').execute();
    expect(audit.map((a) => a.action)).toEqual(['key.rotate', 'key.rotate', 'key.revoke']);
    for (const a of audit) {
      expect(a.actor_type).toBe('system');
      expect(a.actor_id).toMatch(/^cli:keys:/);
    }
  });

  it('retires the ACTIVE key (issuance stops) and refuses to retire a non-active one', async () => {
    const notActive = await run(['retire', '1', '--yes']);
    expect(notActive.code).toBe(1);
    expect(notActive.io.text()).toMatch(/Only the active key can be retired/);
    const r = await run(['retire', '2', '--yes']);
    expect(r.code).toBe(0);
    expect(r.io.text()).toMatch(/No key is ACTIVE/);
    expect((await run(['list'])).io.text()).toMatch(/No ACTIVE key: issuance is stopped/);
    // generate recovers from "no ACTIVE key".
    const g = await run(['generate', '--json']);
    expect(g.code).toBe(0);
    expect(JSON.parse(g.io.stdout[0])).toMatchObject({ created: true, key: { keyId: 3, status: 'ACTIVE' } });
  });

  it('reports an ACTIVE key the configured provider cannot use (wrong KEY_ENCRYPTION_KEY)', async () => {
    const wrong = { ...env, KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url') };
    const r = await run(['generate'], wrong);
    expect(r.code).toBe(1);
    expect(r.io.text()).toMatch(/cannot sign with the configured provider/);
  });

  it('refuses to create keys with the memory provider, which would lose them on exit', async () => {
    const r = await run(['rotate'], { ORBES_ENV: 'test' });
    expect(r.code).toBe(1);
    expect(r.io.text()).toMatch(/KEY_PROVIDER=memory/);
    // Read-only commands work with any provider.
    expect((await run(['list'], { ORBES_ENV: 'test' })).code).toBe(0);
  });

  it('needs a migrated schema and a valid configuration', async () => {
    const empty = await createTestDb({ migrated: false });
    try {
      const r = await run(['list'], env, empty.db);
      expect(r.code).toBe(1);
      expect(r.io.text()).toMatch(/db:migrate/);
    } finally {
      await empty.close();
    }
    const bad = await run(['list'], { ORBES_ENV: 'production' });
    expect(bad.code).toBe(78);
    expect(bad.io.text()).toMatch(/DATABASE_URL: required in production/);
  });
});
