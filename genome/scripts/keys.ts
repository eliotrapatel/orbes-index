/**
 * Signing-key operations through KeyService, against DATABASE_URL and the
 * configured custody provider (KEY_PROVIDER / KEY_DIR / KEY_ENCRYPTION_KEY).
 *
 *   npm run keys:generate                          first signing key, when none is ACTIVE (idempotent)
 *   tsx scripts/keys.ts rotate [--kid <label>]     new ACTIVE key; the previous one becomes RETIRED
 *   tsx scripts/keys.ts list [--json]              every key: status, dates, public key
 *   tsx scripts/keys.ts retire <keyId> --yes       ACTIVE → RETIRED (issuance stops until the next rotate)
 *   tsx scripts/keys.ts revoke <keyId> --reason <text> [--compromised-at <ISO 8601>] --yes
 *
 * Every change goes through KeyService, so it is audited (actor
 * `system:cli:keys:<os user>`), new keys must prove possession before they
 * are registered, and revocation follows the compromise-time rule: codes
 * recorded before `--compromised-at` (or before now) stay trusted, later ones
 * verify as INVALID_SIGNATURE.
 *
 * Private keys never pass through this script: the provider generates and
 * holds them; only public keys and opaque references are printed. The memory
 * provider is refused for generate/rotate because its key would vanish when
 * this command exits.
 *
 * Exit codes: 0 success, 1 failure, 2 usage error, 78 configuration error.
 */
import { createHash } from 'node:crypto';
import { closeDb, createDb, type Db } from '../src/server/db/connection.js';
import { migrationStatus } from '../src/server/db/migrate.js';
import { redactDatabaseUrl } from '../src/server/db/url.js';
import { createKeyProvider, KeyService, type KeyRecord } from '../src/server/keys/index.js';
import { AuditService } from '../src/server/services/audit.js';
import type { AppConfig } from '../src/server/config.js';
import type { Logger } from '../src/server/types.js';
import {
  cliActor,
  cliLogger,
  consoleIO,
  errorMessage,
  EXIT,
  isMainModule,
  loadCliConfig,
  parseCli,
  type CliDeps,
  type CliIO,
} from './db.js';

export const KEYS_USAGE = `Usage: tsx scripts/keys.ts <command> [options]

Commands
  generate [--kid <label>]          Create the first signing key when none is ACTIVE (no-op otherwise)
  rotate [--kid <label>]            Create a new ACTIVE key; the previous ACTIVE key becomes RETIRED (verify-only)
  list                              List every key with its status, dates and public key
  retire <keyId> --yes              Retire the ACTIVE key (issuance stops until the next rotate)
  revoke <keyId> --reason <text> [--compromised-at <ISO 8601>] --yes
                                    Revoke a key; codes recorded after the compromise time stop verifying

Options
  --json      Machine-readable output
  --verbose   Service logs on stderr
  --help      This text`;

const KEYS_OPTIONS = {
  kid: { type: 'string' },
  reason: { type: 'string' },
  'compromised-at': { type: 'string' },
  yes: { type: 'boolean' },
  json: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

const COMMANDS = ['generate', 'rotate', 'list', 'retire', 'revoke'] as const;
type Command = (typeof COMMANDS)[number];

export async function runKeysCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? consoleIO;
  const parsed = parseCli(argv, KEYS_OPTIONS, io, KEYS_USAGE);
  if (typeof parsed === 'number') return parsed;
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(KEYS_USAGE);
    return EXIT.OK;
  }
  const [command, ...args] = positionals;
  if (!COMMANDS.includes(command as Command)) {
    io.err(command ? `Unknown command: ${command}\n\n${KEYS_USAGE}` : KEYS_USAGE);
    return EXIT.USAGE;
  }
  const cmd = command as Command;
  const usage = (message: string) => {
    io.err(`keys ${cmd}: ${message}\n\n${KEYS_USAGE}`);
    return EXIT.USAGE;
  };

  // Argument validation first: no database connection for a typo.
  let keyId: number | undefined;
  if (cmd === 'retire' || cmd === 'revoke') {
    if (args.length !== 1 || !/^\d{1,3}$/.test(args[0]) || Number(args[0]) < 1 || Number(args[0]) > 255) {
      return usage('expected exactly one key id (1..255)');
    }
    keyId = Number(args[0]);
    if (values.yes !== true) {
      io.err(`keys ${cmd}: ${cmd === 'revoke' ? 'revocation cannot be undone' : 'issuance stops until the next rotate'}; re-run with --yes to confirm.`);
      return EXIT.USAGE;
    }
  } else if (args.length > 0) {
    return usage(`unexpected argument: ${args.join(' ')}`);
  }
  if (values.kid !== undefined && cmd !== 'generate' && cmd !== 'rotate') return usage('--kid only applies to generate and rotate');
  if ((values.reason !== undefined || values['compromised-at'] !== undefined) && cmd !== 'revoke') {
    return usage('--reason and --compromised-at only apply to revoke');
  }
  let compromisedAt: Date | undefined;
  if (cmd === 'revoke') {
    if (typeof values.reason !== 'string' || values.reason.trim() === '') return usage('--reason is required');
    const raw = values['compromised-at'];
    if (typeof raw === 'string') {
      // Explicit offset or Z only: a timezone-less time would silently be read in the operator's local zone.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw))) {
        return usage('--compromised-at must be an ISO 8601 time with a timezone, e.g. 2026-09-30T14:00:00Z');
      }
      compromisedAt = new Date(raw);
    }
  }

  const config = loadCliConfig(deps.env ?? process.env, io);
  if (typeof config === 'number') return config;
  const json = values.json === true;
  const log = cliLogger(io, values.verbose === true);

  if ((cmd === 'generate' || cmd === 'rotate') && config.keys.provider === 'memory' && !deps.keyProvider) {
    io.err(`keys ${cmd}: refused with KEY_PROVIDER=memory, the private key would vanish when this command exits. Configure KEY_PROVIDER=local (KEY_DIR, KEY_ENCRYPTION_KEY).`);
    return EXIT.FAILURE;
  }

  const db = deps.db ?? createDb(config.databaseUrl, { log });
  try {
    const pending = (await migrationStatus(db)).filter((m) => m.executedAt === undefined);
    if (pending.length > 0) {
      io.err(`keys ${cmd}: the database schema is not up to date (pending: ${pending.map((m) => m.name).join(', ')}); run \`npm run db:migrate\` first.`);
      return EXIT.FAILURE;
    }
    const keys = await openKeyService(config, db, deps, log);
    const actor = cliActor('keys');
    switch (cmd) {
      case 'list': {
        const list = await keys.list();
        if (json) io.out(JSON.stringify({ keys: list.map(keyJson) }));
        else printKeys(io, list, config);
        return EXIT.OK;
      }
      case 'generate': {
        const before = (await keys.list()).find((k) => k.status === 'ACTIVE');
        const key = await keys.ensureActiveKey(actor);
        const created = before === undefined;
        // A key we cannot sign with is not "ready": prove it before reporting success.
        const usable = key.provider === keys.providerName && (await keys.selfTest());
        if (json) io.out(JSON.stringify({ created, usable, key: keyJson(key) }));
        else {
          io.out(created ? `Created signing key #${key.keyId} (${key.kid}), ACTIVE.` : `Signing key #${key.keyId} (${key.kid}) is already ACTIVE; nothing to do.`);
          if (!usable) io.err(`warning: the ACTIVE key cannot sign with the configured provider '${keys.providerName}' (wrong KEY_DIR / KEY_ENCRYPTION_KEY, or created by another provider). Rotate to a new key: tsx scripts/keys.ts rotate`);
        }
        return usable ? EXIT.OK : EXIT.FAILURE;
      }
      case 'rotate': {
        const previous = (await keys.list()).find((k) => k.status === 'ACTIVE');
        const key = await keys.rotate(actor, typeof values.kid === 'string' ? values.kid.trim() : undefined);
        if (json) io.out(JSON.stringify({ key: keyJson(key), retiredKeyId: previous?.keyId ?? null }));
        else {
          io.out(`Created signing key #${key.keyId} (${key.kid}), ACTIVE.`);
          if (previous) io.out(`Key #${previous.keyId} (${previous.kid}) is now RETIRED: codes it signed keep verifying.`);
        }
        return EXIT.OK;
      }
      case 'retire': {
        await keys.retire(keyId!, actor);
        if (json) io.out(JSON.stringify({ retired: keyId }));
        else io.out(`Key #${keyId} is now RETIRED. No key is ACTIVE: issuance is stopped until \`tsx scripts/keys.ts rotate\`.`);
        return EXIT.OK;
      }
      case 'revoke': {
        const wasActive = (await keys.list()).some((k) => k.keyId === keyId && k.status === 'ACTIVE');
        await keys.revoke(keyId!, { reason: (values.reason as string).trim(), ...(compromisedAt ? { compromisedAt } : {}) }, actor);
        const after = (await keys.list()).find((k) => k.keyId === keyId);
        const cutoff = after?.compromisedAt ?? after?.revokedAt ?? null;
        if (json) io.out(JSON.stringify({ key: after ? keyJson(after) : null }));
        else {
          io.out(`Key #${keyId} is REVOKED. Codes recorded before ${cutoff?.toISOString() ?? 'the revocation'} stay trusted; later ones verify as INVALID SIGNATURE.`);
          if (wasActive) io.out('No key is ACTIVE: issuance is stopped until `tsx scripts/keys.ts rotate`.');
        }
        return EXIT.OK;
      }
      default: {
        const never: never = cmd;
        throw new Error(`unhandled command ${String(never)}`);
      }
    }
  } catch (e) {
    io.err(`keys ${cmd}: ${errorMessage(e)}`);
    return EXIT.FAILURE;
  } finally {
    if (!deps.db) await closeDb(db);
  }
}

async function openKeyService(config: AppConfig, db: Db, deps: CliDeps, log: Logger): Promise<KeyService> {
  const provider = deps.keyProvider ?? (await createKeyProvider(config, log));
  const audit = new AuditService({ db });
  // No cache: a CLI run is short, and it must see the registry exactly as it is now.
  return new KeyService({ db, provider, audit, log, cacheTtlMs: 0 });
}

/** Public, non-secret view of a key record. */
export function keyJson(k: KeyRecord) {
  return {
    keyId: k.keyId,
    kid: k.kid,
    alg: k.algorithm,
    status: k.status,
    provider: k.provider,
    providerRef: k.providerRef,
    publicKey: Buffer.from(k.publicKey).toString('base64url'),
    fingerprint: keyFingerprint(k.publicKey),
    createdAt: k.createdAt.toISOString(),
    activatedAt: k.activatedAt?.toISOString() ?? null,
    retiredAt: k.retiredAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    compromisedAt: k.compromisedAt?.toISOString() ?? null,
    revocationReason: k.revocationReason,
  };
}

/** SHA-256 of the raw public key, first 8 bytes, colon-separated: easy to compare by eye or over the phone. */
export function keyFingerprint(publicKey: Uint8Array): string {
  const h = createHash('sha256').update(publicKey).digest('hex').slice(0, 16).toUpperCase();
  return h.match(/../g)!.join(':');
}

function printKeys(io: CliIO, list: KeyRecord[], config: AppConfig): void {
  io.out(`Database: ${redactDatabaseUrl(config.databaseUrl)} · provider: ${config.keys.provider}`);
  if (list.length === 0) {
    io.out('No signing keys. Create one with `npm run keys:generate`.');
    return;
  }
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—');
  io.out(`${'ID'.padEnd(4)}${'STATUS'.padEnd(9)}${'KID'.padEnd(34)}${'PROVIDER'.padEnd(9)}${'ACTIVATED'.padEnd(18)}${'RETIRED'.padEnd(18)}${'REVOKED'.padEnd(18)}FINGERPRINT`);
  for (const k of list) {
    io.out(
      `${String(k.keyId).padEnd(4)}${k.status.padEnd(9)}${k.kid.padEnd(34)}${k.provider.padEnd(9)}${day(k.activatedAt).padEnd(18)}${day(k.retiredAt).padEnd(18)}${day(k.revokedAt).padEnd(18)}${keyFingerprint(k.publicKey)}`,
    );
    if (k.status === 'REVOKED') io.out(`    compromised at ${day(k.compromisedAt)} · reason: ${k.revocationReason ?? '—'}`);
  }
  if (!list.some((k) => k.status === 'ACTIVE')) io.out('No ACTIVE key: issuance is stopped. Run `tsx scripts/keys.ts rotate`.');
}

if (isMainModule(import.meta.url)) {
  runKeysCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`keys: ${errorMessage(e)}\n`);
      process.exitCode = EXIT.FAILURE;
    },
  );
}
