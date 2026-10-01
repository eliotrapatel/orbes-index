/**
 * scripts/admin.ts: console users from the shell — create an admin (password
 * from ADMIN_PASSWORD, never argv), list, bootstrap TOTP enrolment
 * (totp-setup → totp-enable) and reset a lost second factor. Every change is
 * audited with the CLI actor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAdminCli } from '../../scripts/admin.js';
import type { CliIO } from '../../scripts/db.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { AuditService } from '../../src/server/services/audit.js';
import { createTestDb, type TestDb } from '../support/db.js';

function capture(): CliIO & { stdout: string[]; stderr: string[]; text(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l), text: () => [...stdout, ...stderr].join('\n') };
}

const ENV = { ORBES_ENV: 'test' };
const PASSWORD = 'a long console passphrase';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t?.close());

async function run(argv: string[], env: NodeJS.ProcessEnv = ENV) {
  const io = capture();
  const code = await runAdminCli(argv, { env, io, db: t.db });
  return { code, io };
}

describe('admin CLI', () => {
  it('prints usage and refuses malformed commands without touching the database', async () => {
    expect((await run(['--help'])).io.text()).toMatch(/create --email <email> --role <ADMIN\|OPERATOR\|AUDITOR>/);
    expect((await run([])).code).toBe(2);
    expect((await run(['explode'])).code).toBe(2);
    expect((await run(['create', '--email', 'x@orbes.test'])).code).toBe(2); // no role
    expect((await run(['create', '--email', 'x@orbes.test', '--role', 'ROOT'])).code).toBe(2);
    expect((await run(['reset-totp'])).code).toBe(2); // no email
  });

  it('creates an admin with the password from ADMIN_PASSWORD (never from argv) and lists it', async () => {
    const noPassword = await run(['create', '--email', 'ops@orbes.test', '--role', 'OPERATOR']);
    expect(noPassword.code).toBe(2);
    expect(noPassword.io.text()).toMatch(/ADMIN_PASSWORD/);
    expect((await run(['create', '--email', 'ops@orbes.test', '--role', 'OPERATOR', '--password', PASSWORD])).code).toBe(2); // unknown option

    const created = await run(['create', '--email', 'ops@orbes.test', '--role', 'OPERATOR', '--json'], { ...ENV, ADMIN_PASSWORD: PASSWORD });
    expect(created.code).toBe(0);
    expect(JSON.parse(created.io.stdout[0])).toMatchObject({ admin: { email: 'ops@orbes.test', role: 'OPERATOR', totpEnabled: false } });
    expect(created.io.text()).not.toContain(PASSWORD);
    const again = await run(['create', '--email', 'OPS@orbes.test', '--role', 'ADMIN'], { ...ENV, ADMIN_PASSWORD: PASSWORD });
    expect(again.code).toBe(1);
    expect(again.io.text()).toMatch(/already exists/);

    const list = await run(['list']);
    expect(list.code).toBe(0);
    expect(list.io.text()).toMatch(/ops@orbes\.test\s+OPERATOR\s+2FA off/);

    const audit = new AuditService({ db: t.db });
    const entry = (await audit.list({ action: 'admin.create' })).items[0];
    expect(entry).toMatchObject({ actorType: 'system', actorId: expect.stringMatching(/^cli:admin:/) });
  });

  it('enrols TOTP from the shell (setup → enable with a current code), then resets it', async () => {
    const setup = await run(['totp-setup', '--email', 'ops@orbes.test', '--json']);
    expect(setup.code).toBe(0);
    const { secret, otpauthUri } = JSON.parse(setup.io.stdout[0]) as { secret: string; otpauthUri: string };
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const bad = await run(['totp-enable', '--email', 'ops@orbes.test', '--secret', secret, '--code', '000000']);
    expect(bad.code).toBe(1);
    const ok = await run(['totp-enable', '--email', 'ops@orbes.test', '--secret', secret, '--code', totp(base32Decode(secret), Date.now())]);
    expect(ok.code, ok.io.text()).toBe(0);
    expect((await run(['list'])).io.text()).toMatch(/ops@orbes\.test\s+OPERATOR\s+2FA on/);

    const unconfirmed = await run(['reset-totp', '--email', 'ops@orbes.test']);
    expect(unconfirmed.code).toBe(2);
    expect(unconfirmed.io.text()).toMatch(/--yes/);
    const reset = await run(['reset-totp', '--email', 'ops@orbes.test', '--yes']);
    expect(reset.code).toBe(0);
    expect((await run(['list'])).io.text()).toMatch(/ops@orbes\.test\s+OPERATOR\s+2FA off/);
    expect((await run(['reset-totp', '--email', 'ops@orbes.test', '--yes'])).code).toBe(1); // not enabled
    expect((await run(['reset-totp', '--email', 'ghost@orbes.test', '--yes'])).code).toBe(1);
  });
});
