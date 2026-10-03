/**
 * scripts/admin.ts: console users from the shell — create an admin (password
 * from ADMIN_PASSWORD, never argv), list, bootstrap TOTP enrolment
 * (totp-setup → totp-enable), reset a lost second factor, and the fallback of
 * the console's Team page (A-02): change a role (the only way to grant
 * ADMIN), disable and enable. Every change is audited with the CLI actor.
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
    expect((await run(['--help'])).io.text()).toMatch(/create --email <email> --role <ADMIN\|OPERATOR\|AUDITOR\|RETAIL>/);
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

  it('reads the TOTP secret of totp-enable from ADMIN_TOTP_SECRET, so it stays out of argv', async () => {
    const setup = await run(['totp-setup', '--email', 'ops@orbes.test', '--json']);
    const { secret } = JSON.parse(setup.io.stdout[0]) as { secret: string };
    // Neither the environment nor --secret: a usage error that names the variable, before any database work.
    const missing = await run(['totp-enable', '--email', 'ops@orbes.test', '--code', '000000']);
    expect(missing.code).toBe(2);
    expect(missing.io.text()).toMatch(/ADMIN_TOTP_SECRET/);
    // totp-setup's own hint sends the secret through the environment, not argv.
    const hint = await run(['totp-setup', '--email', 'ops@orbes.test']);
    expect(hint.io.text()).toMatch(/ADMIN_TOTP_SECRET/);
    expect(hint.io.text()).not.toMatch(/--secret/);

    const ok = await run(['totp-enable', '--email', 'ops@orbes.test', '--code', totp(base32Decode(secret), Date.now())], { ...ENV, ADMIN_TOTP_SECRET: secret.toLowerCase() });
    expect(ok.code, ok.io.text()).toBe(0);
    expect((await run(['list'])).io.text()).toMatch(/ops@orbes\.test\s+OPERATOR\s+2FA on/);
    expect((await run(['reset-totp', '--email', 'ops@orbes.test', '--yes'])).code).toBe(0);
  });

  it('changes roles, disables and enables from the shell, keeping one active ADMIN', async () => {
    expect((await run(['role', '--email', 'ops@orbes.test'])).code).toBe(2); // no role
    expect((await run(['role', '--email', 'ops@orbes.test', '--role', 'ROOT'])).code).toBe(2);
    expect((await run(['disable', '--email', 'ops@orbes.test', '--role', 'ADMIN', '--yes'])).code).toBe(2);
    const unconfirmed = await run(['disable', '--email', 'ops@orbes.test']);
    expect(unconfirmed.code).toBe(2);
    expect(unconfirmed.io.text()).toMatch(/--yes/);

    expect((await run(['create', '--email', 'boss@orbes.test', '--role', 'ADMIN'], { ...ENV, ADMIN_PASSWORD: PASSWORD })).code).toBe(0);
    // The only active ADMIN can be neither demoted nor disabled.
    const demote = await run(['role', '--email', 'boss@orbes.test', '--role', 'OPERATOR']);
    expect(demote.code).toBe(1);
    expect(demote.io.text()).toMatch(/last active ADMIN/);
    expect((await run(['disable', '--email', 'boss@orbes.test', '--yes'])).code).toBe(1);

    const disabled = await run(['disable', '--email', 'ops@orbes.test', '--yes', '--json']);
    expect(disabled.code).toBe(0);
    expect(JSON.parse(disabled.io.stdout[0])).toMatchObject({ admin: { email: 'ops@orbes.test', disabled: true }, sessionsRevoked: 0 });
    expect((await run(['list'])).io.text()).toMatch(/ops@orbes\.test\s+OPERATOR\s+2FA off\s+disabled/);
    const enabled = await run(['enable', '--email', 'ops@orbes.test']);
    expect(enabled.code).toBe(0);
    expect(enabled.io.text()).toMatch(/can sign in again/);
    expect((await run(['list'])).io.text()).toMatch(/ops@orbes\.test\s+OPERATOR\s+2FA off\s+active/);

    // The shell grants ADMIN; then the former only ADMIN may step down.
    expect((await run(['role', '--email', 'ops@orbes.test', '--role', 'ADMIN'])).io.text()).toMatch(/ops@orbes\.test is now ADMIN/);
    expect((await run(['role', '--email', 'boss@orbes.test', '--role', 'AUDITOR'])).code).toBe(0);
    expect((await run(['enable', '--email', 'ghost@orbes.test'])).code).toBe(1);
    // A seller of the sale mode (A-08), from the shell too.
    expect((await run(['create', '--email', 'seller@orbes.test', '--role', 'RETAIL'], { ...ENV, ADMIN_PASSWORD: PASSWORD })).code).toBe(0);
    expect((await run(['list'])).io.text()).toMatch(/seller@orbes\.test\s+RETAIL\s+2FA off\s+active/);
    expect((await run(['role', '--email', 'boss@orbes.test', '--role', 'RETAIL'])).io.text()).toMatch(/boss@orbes\.test is now RETAIL/);

    const audit = new AuditService({ db: t.db });
    for (const action of ['admin.role_change', 'admin.disable', 'admin.enable']) {
      expect((await audit.list({ action })).items[0], action).toMatchObject({ actorType: 'system', actorId: expect.stringMatching(/^cli:admin:/) });
    }
  });
});
