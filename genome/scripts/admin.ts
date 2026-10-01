/**
 * Console users from the shell, through AuthService (audited as
 * `system:cli:admin:<os user>`), against DATABASE_URL:
 *
 *   ADMIN_PASSWORD=… tsx scripts/admin.ts create --email <email> --role <ADMIN|OPERATOR|AUDITOR>
 *   tsx scripts/admin.ts list [--json]
 *   tsx scripts/admin.ts totp-setup --email <email>              new TOTP secret + otpauth:// URI (nothing stored yet)
 *   tsx scripts/admin.ts totp-enable --email <email> --secret <base32> --code <6 digits>
 *   tsx scripts/admin.ts reset-totp --email <email> --yes        lost device: remove the enrolment, end the sessions
 *
 * Passwords are read from ADMIN_PASSWORD, never from argv (shell history,
 * process lists). `totp-setup` + `totp-enable` is the recommended first
 * enrolment of a new admin (SECURITY-MODEL §3): the secret is handed over in
 * person or over a trusted channel instead of being set up by whoever holds
 * the password first (trust on first use in the console).
 *
 * Exit codes: 0 success, 1 failure, 2 usage error, 78 configuration error.
 */
import { closeDb, createDb, type Db } from '../src/server/db/connection.js';
import { migrationStatus } from '../src/server/db/migrate.js';
import { ADMIN_ROLES, type AdminRole } from '../src/server/db/schema.js';
import type { AppConfig } from '../src/server/config.js';
import { AuditService } from '../src/server/services/audit.js';
import { AuthService, deriveTotpEncryptionKey } from '../src/server/services/auth.js';
import { SessionService } from '../src/server/services/sessions.js';
import type { Logger } from '../src/server/types.js';
import { cliActor, cliLogger, consoleIO, errorMessage, EXIT, isMainModule, loadCliConfig, parseCli, type CliDeps, type CliIO } from './db.js';

export const ADMIN_USAGE = `Usage: tsx scripts/admin.ts <command> [options]

Commands
  create --email <email> --role <ADMIN|OPERATOR|AUDITOR>
                                    Create a console user; the password is read from ADMIN_PASSWORD
  list                              List console users (role, second factor, lock state)
  totp-setup --email <email>        Generate a TOTP secret and its otpauth:// URI (nothing is stored)
  totp-enable --email <email> --secret <base32> --code <digits>
                                    Enrol the secret after checking a current code from the app
  reset-totp --email <email> --yes  Remove a lost second factor; that admin's sessions end

Options
  --json      Machine-readable output
  --verbose   Service logs on stderr
  --help      This text

Environment: the server's (see .env.example); ADMIN_PASSWORD for create.`;

const ADMIN_OPTIONS = {
  email: { type: 'string' },
  role: { type: 'string' },
  secret: { type: 'string' },
  code: { type: 'string' },
  yes: { type: 'boolean' },
  json: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

const COMMANDS = ['create', 'list', 'totp-setup', 'totp-enable', 'reset-totp'] as const;
type Command = (typeof COMMANDS)[number];

export async function runAdminCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? consoleIO;
  const parsed = parseCli(argv, ADMIN_OPTIONS, io, ADMIN_USAGE);
  if (typeof parsed === 'number') return parsed;
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(ADMIN_USAGE);
    return EXIT.OK;
  }
  const [command, ...rest] = positionals;
  if (!COMMANDS.includes(command as Command) || rest.length > 0) {
    io.err(command ? `Unknown or malformed command: ${positionals.join(' ')}\n\n${ADMIN_USAGE}` : ADMIN_USAGE);
    return EXIT.USAGE;
  }
  const cmd = command as Command;
  const usage = (message: string) => {
    io.err(`admin ${cmd}: ${message}\n\n${ADMIN_USAGE}`);
    return EXIT.USAGE;
  };
  const env = deps.env ?? process.env;

  // Argument checks before any database work.
  const email = typeof values.email === 'string' ? values.email.trim() : '';
  if (cmd !== 'list' && email === '') return usage('--email is required');
  let role: AdminRole | undefined;
  let password: string | undefined;
  if (cmd === 'create') {
    if (!ADMIN_ROLES.includes(values.role as AdminRole)) return usage(`--role must be one of ${ADMIN_ROLES.join(', ')}`);
    role = values.role as AdminRole;
    password = env.ADMIN_PASSWORD;
    if (!password) return usage('set the password in ADMIN_PASSWORD (it is never taken from the command line)');
  } else if (values.role !== undefined) {
    return usage('--role only applies to create');
  }
  if (cmd === 'totp-enable' && (typeof values.secret !== 'string' || typeof values.code !== 'string')) return usage('--secret and --code are required');
  if (cmd === 'reset-totp' && values.yes !== true) {
    io.err('admin reset-totp: the second factor is removed and every session of that admin ends; re-run with --yes to confirm.');
    return EXIT.USAGE;
  }

  const config = loadCliConfig(env, io);
  if (typeof config === 'number') return config;
  const log = cliLogger(io, values.verbose === true);
  const json = values.json === true;
  const actor = cliActor('admin');

  try {
    return await withAuth(config, deps, log, io, cmd, async (auth) => {
      if (cmd === 'list') {
        const admins = await auth.listAdmins();
        if (json) io.out(JSON.stringify({ admins }));
        else if (admins.length === 0) io.out('No console users.');
        else {
          for (const a of admins) {
            const state = a.disabled ? 'disabled' : a.locked ? 'locked' : 'active';
            io.out(`${a.email.padEnd(36)} ${a.role.padEnd(8)} ${a.totpEnabled ? '2FA on ' : '2FA off'}  ${state}  ${a.id}`);
          }
        }
        return EXIT.OK;
      }
      if (cmd === 'create') {
        const admin = await auth.createAdmin({ email, password: password!, role: role! }, actor);
        if (json) io.out(JSON.stringify({ admin }));
        else io.out(`Created ${admin.role} ${admin.email} (${admin.id}). Enrol a second factor: tsx scripts/admin.ts totp-setup --email ${admin.email}`);
        return EXIT.OK;
      }
      const admin = await auth.findAdminByEmail(email);
      if (!admin) {
        io.err(`admin ${cmd}: no console user with this email.`);
        return EXIT.FAILURE;
      }
      if (cmd === 'totp-setup') {
        const e = await auth.createTotpEnrollment(admin.id);
        if (json) io.out(JSON.stringify(e));
        else {
          io.out(`Secret (shown once, add it to the authenticator app): ${e.secret}`);
          io.out(`otpauth URI: ${e.otpauthUri}`);
          io.out(`Then: tsx scripts/admin.ts totp-enable --email ${admin.email} --secret <secret> --code <current code>`);
        }
        return EXIT.OK;
      }
      if (cmd === 'totp-enable') {
        const secret = (values.secret as string).replace(/[\s=]/g, '').toUpperCase();
        await auth.enableTotp(admin.id, { secret, code: (values.code as string).replace(/\s/g, '') }, actor);
        io.out(json ? JSON.stringify({ enabled: true, adminId: admin.id }) : `Two-factor authentication enabled for ${admin.email}.`);
        return EXIT.OK;
      }
      // reset-totp
      await auth.disableTotp(admin.id, actor);
      io.out(json ? JSON.stringify({ reset: true, adminId: admin.id }) : `Two-factor authentication removed for ${admin.email}; their sessions have ended.`);
      return EXIT.OK;
    });
  } catch (e) {
    io.err(`admin ${cmd}: ${errorMessage(e)}`);
    return EXIT.FAILURE;
  }
}

async function withAuth(
  config: AppConfig,
  deps: CliDeps,
  log: Logger,
  io: CliIO,
  cmd: Command,
  fn: (auth: AuthService) => Promise<number>,
): Promise<number> {
  const db: Db = deps.db ?? createDb(config.databaseUrl, { log });
  try {
    const pending = (await migrationStatus(db)).filter((m) => m.executedAt === undefined);
    if (pending.length > 0) {
      io.err(`admin ${cmd}: the database schema is not up to date (pending: ${pending.map((m) => m.name).join(', ')}); run \`npm run db:migrate\` first.`);
      return EXIT.FAILURE;
    }
    const audit = new AuditService({ db });
    const sessions = new SessionService({ db, ttlHours: config.sessionTtlHours });
    return await fn(new AuthService({ db, audit, sessions, totpKey: deriveTotpEncryptionKey(config) }));
  } finally {
    if (!deps.db) await closeDb(db);
  }
}

if (isMainModule(import.meta.url)) {
  runAdminCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`admin: ${errorMessage(e)}\n`);
      process.exitCode = EXIT.FAILURE;
    },
  );
}
