/**
 * The deploy/vps scripts on the shared production server (OPS-D2, owner decisions of
 * 2026-10-03: repair forward, never restore.sh there, watch the photographs' disk), run for
 * real (bash) against a fake Docker host: genome/test/ops/fake-host/ holds `docker`, `curl`,
 * `age`, `rclone` and `sleep` stand-ins that emulate what the scripts rely on, Kysely's refusal
 * of an unknown applied migration and the app's refusal of a pending one included (no Docker
 * here; the stack itself is exercised as docs/DEPLOYMENT.md §15.13 says):
 *
 *  - deploy.sh, a release that migrates: a failure after its migrations committed (health,
 *    Caddy, signing key, smoke tests, the grants) keeps the new image, started, with the way
 *    to repair forward, and never attempts the doomed rollback, nor when the applied migrations
 *    cannot be read after the migration step, nor, before or after that step, when the
 *    previous image does not know them all or cannot list them; a release without migration,
 *    or whose migration failed (one transaction: nothing applied), still rolls back; the
 *    success message names the migrations and no longer offers a rollback, nor when the schema
 *    cannot be read afterwards, nor when the previous image cannot run on the schema; the
 *    rollback hint (.state/previous-tag) is written only when it can be followed, and removed
 *    by a kept release, its retry and a first deployment;
 *  - deploy.sh --image: an image that does not know every applied migration is refused before
 *    the pre-deploy backup and before anything is stopped (and an unreadable schema stops it,
 *    saying whether PostgreSQL was started for the check);
 *  - lib.sh: deploy.sh, backup.sh and restore.sh stop on an exported COMPOSE_PROJECT_NAME that
 *    is not the stack's, or on any exported ORBES_IMAGE_TAG;
 *  - restore.sh refuses everything, --dry-run included, when .env says RESTORE_ALLOWED=false,
 *    the stack's own .env as well as a file an exported ORBES_STACK_ENV_FILE names;
 *  - backup.sh copies off-site only archives younger than the remote retention age, keeps no
 *    event archive past BACKUP_KEEP_WEEKLY × 7 + 7 days (the privacy policy's "about two
 *    months"), and logs "photos: N, X MB" on every run (0 before migration 0012), even with
 *    --quiet;
 *  - the SQL of those scripts and of the runbook runs on the real, migrated schema, and (opt-in,
 *    CI) lib.sh's psql lines run in a real psql against PostgreSQL.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest, MIGRATIONS } from '../../src/server/db/migrate.js';
import { createTestDb, type TestDb } from '../support/db.js';

const GENOME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = join(GENOME, '..');
const STACK = join(REPO, 'deploy', 'vps');
const FAKES = join(GENOME, 'test', 'ops', 'fake-host');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

/** Every migration of this code, and those of deployment 1 (lot 1: no migration of its own). */
const ALL = Object.keys(MIGRATIONS);
const LOT1 = ALL.slice(0, 3);
const ADDED = ALL.slice(3);
const words = (names: string[]) => names.join(', ');
const DAY = 86_400_000;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** A sandboxed copy of deploy/vps on a fake Docker host. */
class FakeHost {
  readonly dir = mkdtempSync(join(tmpdir(), 'orbes-host-'));
  readonly stack = join(this.dir, 'repo', 'deploy', 'vps');
  readonly state = join(this.dir, 'fake');
  readonly bin = join(this.dir, 'bin');
  readonly backups = join(this.dir, 'backups');
  readonly envFile = join(this.stack, '.env');

  constructor(opts: { env?: Record<string, string>; stubBackup?: boolean } = {}) {
    mkdirSync(join(this.stack, 'scripts'), { recursive: true });
    mkdirSync(join(this.stack, 'caddy.d'), { recursive: true });
    for (const f of ['lib.sh', 'deploy.sh', 'backup.sh', 'restore.sh']) this.install(join(STACK, 'scripts', f), join(this.stack, 'scripts', f));
    copyFileSync(join(STACK, 'Caddyfile'), join(this.stack, 'Caddyfile'));
    for (const f of readdirSync(join(STACK, 'caddy.d'))) copyFileSync(join(STACK, 'caddy.d', f), join(this.stack, 'caddy.d', f));
    chmodSync(join(this.stack, 'Caddyfile'), 0o644);
    if (opts.stubBackup !== false) {
      // deploy.sh's pre-deploy backup is recorded, not run (backup.sh has its own tests below).
      writeFileSync(join(this.stack, 'scripts', 'backup.sh'), '#!/usr/bin/env bash\nprintf \'backup.sh %s\\n\' "$*" >>"$FAKE_STATE/backup.log"\n', { mode: 0o755 });
    }
    mkdirSync(this.bin);
    const fakes = readdirSync(FAKES).filter((f) => statSync(join(FAKES, f)).isFile());
    for (const f of fakes) this.install(join(FAKES, f), join(this.bin, f));
    // The scripts target Ubuntu (GNU stat -c, find -printf); macOS gets thin translations.
    if (process.platform === 'darwin') for (const f of readdirSync(join(FAKES, 'darwin'))) this.install(join(FAKES, 'darwin', f), join(this.bin, f));
    for (const d of ['images', 'db', 'running', 'fail']) mkdirSync(join(this.state, d), { recursive: true });
    mkdirSync(join(this.dir, 'tmp'));
    writeFileSync(join(this.dir, 'recipients.txt'), `age1${'q'.repeat(58)}\n`);
    const env: Record<string, string> = {
      APP_DOMAIN: 'verify.orbes.test',
      ACME_EMAIL: 'ops@orbes.test',
      TLS_MODE: 'internal',
      EDGE_MODE: 'direct',
      POSTGRES_DB: 'orbes',
      POSTGRES_USER: 'orbes',
      POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
      POSTGRES_APP_USER: 'orbes_app',
      POSTGRES_APP_PASSWORD: randomBytes(24).toString('hex'),
      ORBES_IMAGE_TAG: 'latest',
      BACKUP_DIR: this.backups,
      BACKUP_AGE_RECIPIENTS_FILE: join(this.dir, 'recipients.txt'),
      BACKUP_KEEP_DAILY: '14',
      BACKUP_KEEP_WEEKLY: '8',
      ...opts.env,
    };
    writeFileSync(this.envFile, Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
    chmodSync(this.envFile, 0o600);
  }

  private install(from: string, to: string): void {
    copyFileSync(from, to);
    chmodSync(to, 0o755);
  }

  /** Runs a script of the sandboxed stack, with nothing of this process's environment but PATH. */
  run(script: string, args: string[] = [], extraEnv: Record<string, string> = {}): RunResult {
    const r = spawnSync('bash', [join(this.stack, 'scripts', script), ...args], {
      encoding: 'utf8',
      input: '',
      timeout: 60_000,
      env: { PATH: `${this.bin}:${process.env.PATH}`, HOME: this.dir, TMPDIR: join(this.dir, 'tmp'), LC_ALL: 'C', FAKE_STATE: this.state, ...extraEnv },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  image(tag: string, migrations: string[]): this {
    writeFileSync(join(this.state, 'images', tag), migrations.map((m) => `${m}\n`).join(''));
    return this;
  }

  applied(migrations?: string[]): string[] {
    const file = join(this.state, 'db', 'migrations');
    if (migrations) writeFileSync(file, migrations.map((m) => `${m}\n`).join(''));
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  }

  /** Starts the stack as `compose up -d` would have, the app on orbes-genome:<tag>. */
  running(appTag: string | null): this {
    rmSync(join(this.state, 'running'), { recursive: true, force: true });
    mkdirSync(join(this.state, 'running'));
    if (appTag !== null) {
      writeFileSync(join(this.state, 'running', 'postgres'), 'postgres:17\n');
      writeFileSync(join(this.state, 'running', 'app'), `orbes-genome:${appTag}\n`);
      writeFileSync(join(this.state, 'running', 'caddy'), 'caddy:2\n');
    }
    return this;
  }

  runningImage(service: string): string | null {
    const f = join(this.state, 'running', service);
    return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
  }

  fail(what: string): this {
    writeFileSync(join(this.state, 'fail', what), '');
    return this;
  }

  setEnv(key: string, value: string): void {
    const lines = readFileSync(this.envFile, 'utf8').split('\n').filter((l) => l && !l.startsWith(`${key}=`));
    writeFileSync(this.envFile, [...lines, `${key}=${value}`, ''].join('\n'), { mode: 0o600 });
  }

  envValue(key: string): string | undefined {
    const line = readFileSync(this.envFile, 'utf8').split('\n').filter((l) => l.startsWith(`${key}=`)).pop();
    return line?.slice(key.length + 1);
  }

  /** A log of the fake host (docker.log, curl.log, rclone.log, backup.log), or ''. */
  log(name: string): string {
    const f = join(this.state, name);
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  }

  /** A file of the sandboxed stack's .state directory, or null. */
  stateFile(name: string): string | null {
    const f = join(this.stack, '.state', name);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const hosts: FakeHost[] = [];
function host(opts: ConstructorParameters<typeof FakeHost>[0] = {}): FakeHost {
  const h = new FakeHost(opts);
  hosts.push(h);
  return h;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

/** Production before deployment 2: lot 1 live on orbes-genome:lot1, its schema at 0003; deployment 2's image built. */
function productionBeforeDeployment2(): FakeHost {
  const h = host({ env: { ORBES_IMAGE_TAG: 'lot1' } }).image('lot1', LOT1).image('new', ALL).running('lot1');
  h.applied(LOT1);
  return h;
}

const migrateCalls = (h: FakeHost) => h.log('docker.log').split('\n').filter((l) => l.includes('scripts/db.ts migrate'));

describe('deploy.sh: a release that migrates is repaired forward, never rolled back (OPS-D2)', () => {
  const failures: [string, (h: FakeHost) => void][] = [
    ['the app never becomes healthy', (h) => h.fail('unhealthy-app-new')],
    ['Caddy never becomes healthy', (h) => h.fail('unhealthy-caddy')],
    ['the signing key cannot be checked or created', (h) => h.fail('keys')],
    ['the smoke tests fail', (h) => h.fail('smoke')],
    ['granting the app role fails, after the migrations committed', (h) => h.fail('grant')],
  ];

  it.each(failures)('%s: the new image stays, started, with the way to repair forward', (_name, arrange) => {
    const h = productionBeforeDeployment2();
    arrange(h);
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(1);
    // The migrations committed, so the schema is the new one…
    expect(h.applied()).toEqual(ALL);
    // …and the release stays: ORBES_IMAGE_TAG on the new image, the stack started on it.
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('new');
    expect(h.runningImage('app')).toBe('orbes-genome:new');
    expect(h.runningImage('postgres')).toBe('postgres:17');
    // No attempt to run the previous image on that schema (it would fail its migration step
    // and leave the site down): one migration step only, the new image's.
    expect(migrateCalls(h)).toHaveLength(1);
    expect(r.stderr).not.toMatch(/rollback to orbes-genome:lot1/);
    expect(r.stderr).toMatch(new RegExp(`new applied the migration\\(s\\) ${words(ADDED)}: orbes-genome:lot1 cannot run on this schema, so no rollback is attempted`));
    expect(r.stderr).toMatch(/no rollback: repair forward/);
    expect(r.stderr).toMatch(/deployment of new failed \(.+\) and is KEPT: ORBES_IMAGE_TAG=new in \.env, the stack started on orbes-genome:new/);
    expect(r.stderr).toMatch(/after a transient incident .*\n\s+scripts\/deploy\.sh --image new\n/);
    expect(r.stderr).toMatch(/otherwise: a corrective commit, deployed normally \(git pull && scripts\/deploy\.sh\)/);
    expect(r.stderr).toMatch(/restore\.sh is not used on the shared server \(RESTORE_ALLOWED=false/);
    expect(h.stateFile('deploys.log')).toMatch(/ deploy new FAILED \(.+\): kept, no rollback, repair forward\n$/);
    // The pre-deploy backup was taken before anything changed, once.
    expect(h.log('backup.log')).toBe('backup.sh --reason pre-deploy-new\n');
  });

  it('a failed migration applies nothing (one transaction): the previous image comes back automatically', () => {
    const h = productionBeforeDeployment2().fail('migrate');
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(1);
    expect(h.applied()).toEqual(LOT1);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('lot1');
    expect(h.runningImage('app')).toBe('orbes-genome:lot1');
    expect(r.stderr).toMatch(/rolled back to lot1; the stack is healthy/);
    expect(r.stderr).not.toMatch(/KEPT/);
    expect(h.stateFile('deploys.log')).toMatch(/ deploy new FAILED, rolled back to lot1\n$/);
  });

  it('a release without migration keeps the automatic rollback', () => {
    const h = productionBeforeDeployment2().image('lot1b', LOT1).fail('unhealthy-app-lot1b');
    const r = h.run('deploy.sh', ['--image', 'lot1b']);
    expect(r.status, r.stderr).toBe(1);
    expect(h.applied()).toEqual(LOT1);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('lot1');
    expect(h.runningImage('app')).toBe('orbes-genome:lot1');
    expect(r.stderr).toMatch(/rollback to orbes-genome:lot1/);
    expect(r.stderr).toMatch(/rolled back to lot1; the stack is healthy/);
    expect(h.stateFile('deploys.log')).toMatch(/ deploy lot1b FAILED, rolled back to lot1\n$/);
  });

  it('a failure after the migration step, when the applied migrations cannot be read, is kept too (it may have migrated)', () => {
    // PostgreSQL unreadable right after the migrations committed: without this branch, the
    // rollback would run the previous image's migration step on the new schema.
    const h = productionBeforeDeployment2().fail('unhealthy-app-new').fail('read-applied-after-migrate');
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(1);
    expect(h.applied()).toEqual(ALL);
    expect(r.stderr).toMatch(/the migrations applied in the database cannot be read \(is PostgreSQL down\?\): this release may have migrated, so no rollback is attempted/);
    expect(r.stderr).toMatch(/deployment of new failed \(the stack did not become healthy\) and is KEPT: ORBES_IMAGE_TAG=new in \.env/);
    expect(r.stderr).not.toMatch(/rollback to orbes-genome:lot1/);
    expect(migrateCalls(h)).toHaveLength(1);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('new');
    expect(h.runningImage('app')).toBe('orbes-genome:new');
    expect(h.stateFile('deploys.log')).toMatch(/ deploy new FAILED \(the stack did not become healthy\): kept, no rollback, repair forward\n$/);
  });

  it('a failure without new migration is kept when the previous image does not know the applied ones (the stack was down, .env on an older tag)', () => {
    // Schema at 0013, nothing running, .env still names lot1: lot1 is the "previous" tag but
    // cannot run on this schema, so the failing fix image is not rolled back to it.
    const h = host({ env: { ORBES_IMAGE_TAG: 'lot1' } }).image('lot1', LOT1).image('fix', ALL).running(null).fail('unhealthy-app-fix');
    h.applied(ALL);
    const r = h.run('deploy.sh', ['--image', 'fix']);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/previous image tag: lot1/);
    expect(r.stderr).toMatch(new RegExp(`orbes-genome:lot1 does not know the migration\\(s\\) ${words(ADDED)} of this database: it cannot run on this schema, so no rollback is attempted`));
    expect(r.stderr).toMatch(/deployment of fix failed \(the stack did not become healthy\) and is KEPT: ORBES_IMAGE_TAG=fix in \.env, the stack started on orbes-genome:fix/);
    expect(r.stderr).not.toMatch(/rollback to orbes-genome:lot1/);
    expect(migrateCalls(h)).toHaveLength(1);
    expect(h.applied()).toEqual(ALL);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('fix');
    expect(h.runningImage('app')).toBe('orbes-genome:fix');
    // PostgreSQL was down: no pre-deploy backup.
    expect(h.log('backup.log')).toBe('');
  });

  it('a failure before the migration step is kept too when the previous image does not know the applied migrations', () => {
    // Schema at 0013, nothing running, .env still on lot1 (what a failed rollback of before OPS-D2 left): PostgreSQL,
    // healthy for the schema check, then fails its health check in the rollout, before any migration step. Rolling
    // back to lot1 would write its tag into .env and fail at its migration step, then suggest --image lot1.
    const h = host({ env: { ORBES_IMAGE_TAG: 'lot1' } }).image('lot1', LOT1).image('fix', ALL).running(null).fail('unhealthy-postgres-after-schema');
    h.applied(ALL);
    mkdirSync(join(h.stack, '.state'), { mode: 0o700 });
    writeFileSync(join(h.stack, '.state', 'previous-tag'), 'lot1\n');
    const r = h.run('deploy.sh', ['--image', 'fix']);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/deployment of fix failed: the stack did not become healthy/);
    expect(r.stderr).toMatch(new RegExp(`orbes-genome:lot1 does not know the migration\\(s\\) ${words(ADDED)} of this database: it cannot run on this schema, so no rollback is attempted`));
    expect(r.stderr).toMatch(/deployment of fix failed \(the stack did not become healthy\) and is KEPT: ORBES_IMAGE_TAG=fix in \.env/);
    expect(r.stderr).not.toMatch(/rollback to orbes-genome:lot1/);
    expect(r.stderr).not.toMatch(/--image lot1/);
    expect(r.stderr).toMatch(/scripts\/deploy\.sh --image fix\n/);
    // Nothing migrated, nothing of lot1 started.
    expect(migrateCalls(h)).toHaveLength(0);
    expect(h.applied()).toEqual(ALL);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('fix');
    expect(h.runningImage('app')).toBe('orbes-genome:fix');
    expect(h.stateFile('previous-tag')).toBeNull();
    expect(h.stateFile('deploys.log')).toMatch(/ deploy fix FAILED \(the stack did not become healthy\): kept, no rollback, repair forward\n$/);
  });

  it('a failure without new migration is kept when the migrations of the previous image cannot be listed', () => {
    const h = productionBeforeDeployment2().image('lot1b', LOT1).fail('unhealthy-app-lot1b').fail('probe-lot1');
    const r = h.run('deploy.sh', ['--image', 'lot1b']);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/the migrations orbes-genome:lot1 knows cannot be listed: it may not run on this schema, so no rollback is attempted/);
    expect(r.stderr).toMatch(/deployment of lot1b failed \(the stack did not become healthy\) and is KEPT: ORBES_IMAGE_TAG=lot1b in \.env/);
    expect(r.stderr).not.toMatch(/rollback to orbes-genome:lot1/);
    expect(migrateCalls(h)).toHaveLength(1);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('lot1b');
  });

  it('a kept release removes the rollback hint of an earlier deployment, and so does its successful retry', () => {
    const h = productionBeforeDeployment2().fail('unhealthy-app-new');
    mkdirSync(join(h.stack, '.state'), { mode: 0o700 });
    const hint = join(h.stack, '.state', 'previous-tag');
    writeFileSync(hint, '1bd551d91832\n');
    const kept = h.run('deploy.sh', ['--image', 'new']);
    expect(kept.status, kept.stderr).toBe(1);
    expect(kept.stderr).toMatch(/and is KEPT/);
    expect(h.stateFile('previous-tag')).toBeNull();
    // The incident fixed, the same image again (the way forward printed): a redeployment of the running image.
    rmSync(join(h.state, 'fail', 'unhealthy-app-new'));
    writeFileSync(hint, '1bd551d91832\n');
    const retry = h.run('deploy.sh', ['--image', 'new']);
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stderr).toMatch(/redeployed orbes-genome:new \(same image as before\)\n/);
    expect(retry.stderr).not.toMatch(/Manual rollback/);
    expect(h.stateFile('previous-tag')).toBeNull();
  });

  it('a retry of the kept release that fails again does not roll back either', () => {
    const h = host({ env: { ORBES_IMAGE_TAG: 'new' } }).image('lot1', LOT1).image('new', ALL).running('new').fail('unhealthy-app-new');
    h.applied(ALL);
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(1);
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('new');
    expect(r.stderr).toMatch(/no previous image to roll back to \(orbes-genome:new\)/);
    expect(r.stderr).toMatch(/scripts\/deploy\.sh --image new\n/);
    expect(migrateCalls(h)).toHaveLength(1);
  });

  it('on success, names the migrations it applied and no longer offers a rollback', () => {
    const h = productionBeforeDeployment2();
    // A rollback hint left by an earlier deployment must not survive this one.
    mkdirSync(join(h.stack, '.state'), { mode: 0o700 });
    writeFileSync(join(h.stack, '.state', 'previous-tag'), '1bd551d91832\n');
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(0);
    expect(h.applied()).toEqual(ALL);
    expect(h.runningImage('app')).toBe('orbes-genome:new');
    expect(r.stderr).toMatch(new RegExp(`deployed orbes-genome:new \\(previous: lot1\\)\\. This release applied the migration\\(s\\) ${words(ADDED)}:`));
    expect(r.stderr).toMatch(/orbes-genome:lot1 cannot run on this schema any more \(scripts\/deploy\.sh --image lot1 refuses it\)\. If anything goes wrong, repair forward: scripts\/deploy\.sh --image new after a transient incident, otherwise a corrective commit/);
    expect(r.stderr).not.toMatch(/Manual rollback/);
    expect(h.stateFile('previous-tag')).toBeNull();
    expect(h.stateFile('deploys.log')).toMatch(new RegExp(` deploy new OK \\(previous lot1; migrations ${words(ADDED)}\\)\\n$`));
  });

  it('on success without migration, keeps the rollback hint', () => {
    const h = productionBeforeDeployment2().image('lot1b', LOT1);
    const r = h.run('deploy.sh', ['--image', 'lot1b']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/deployed orbes-genome:lot1b \(previous: lot1\)\. Manual rollback: scripts\/deploy\.sh --image lot1\n/);
    expect(h.stateFile('previous-tag')).toBe('lot1\n');
    expect(h.stateFile('deploys.log')).toMatch(/ deploy lot1b OK \(previous lot1\)\n$/);
  });

  it('on success without migration, suggests no rollback to a previous image that cannot run on the schema (the stack was down, .env on an older tag)', () => {
    const h = host({ env: { ORBES_IMAGE_TAG: 'lot1' } }).image('lot1', LOT1).image('fix', ALL).running(null);
    h.applied(ALL);
    mkdirSync(join(h.stack, '.state'), { mode: 0o700 });
    writeFileSync(join(h.stack, '.state', 'previous-tag'), 'lot1\n');
    const r = h.run('deploy.sh', ['--image', 'fix']);
    expect(r.status, r.stderr).toBe(0);
    expect(h.runningImage('app')).toBe('orbes-genome:fix');
    expect(r.stderr).toMatch(/deployed orbes-genome:fix \(previous: lot1\)\.\n/);
    expect(r.stderr).toMatch(new RegExp(`orbes-genome:lot1 does not know the migration\\(s\\) ${words(ADDED)} of this database: it cannot run on this schema, so no rollback is suggested\\. If anything goes wrong, repair forward: scripts/deploy\\.sh --image fix after a transient incident`));
    expect(r.stderr).not.toMatch(/Manual rollback/);
    expect(h.stateFile('previous-tag')).toBeNull();
    expect(h.stateFile('deploys.log')).toMatch(/ deploy fix OK \(previous lot1\)\n$/);
    // Nor when the migrations of the previous image cannot be listed.
    const p = productionBeforeDeployment2().image('lot1b', LOT1).fail('probe-lot1');
    const listed = p.run('deploy.sh', ['--image', 'lot1b']);
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stderr).toMatch(/the migrations orbes-genome:lot1 knows cannot be listed, so no rollback is suggested\. If anything goes wrong, repair forward/);
    expect(listed.stderr).not.toMatch(/Manual rollback/);
    expect(p.stateFile('previous-tag')).toBeNull();
  });

  it('on success, when the schema cannot be read afterwards, suggests no rollback and says so', () => {
    const h = productionBeforeDeployment2().fail('read-applied-after-migrate');
    mkdirSync(join(h.stack, '.state'), { mode: 0o700 });
    writeFileSync(join(h.stack, '.state', 'previous-tag'), '1bd551d91832\n');
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(0);
    expect(h.runningImage('app')).toBe('orbes-genome:new');
    expect(r.stderr).toMatch(/deployed orbes-genome:new \(previous: lot1\)\.\n/);
    expect(r.stderr).toMatch(/WARNING: the schema could not be read after the rollout \(kysely_migration\): whether this release applied migrations is unknown, so no rollback is suggested\. .*repair forward: scripts\/deploy\.sh --image new after a transient incident, otherwise a corrective commit/);
    expect(r.stderr).not.toMatch(/Manual rollback/);
    expect(h.stateFile('previous-tag')).toBeNull();
    expect(h.stateFile('deploys.log')).toMatch(/ deploy new OK \(previous lot1; schema not read\)\n$/);
  });

  it('a first deployment migrates an empty database without a pre-deploy backup (PostgreSQL was not running)', () => {
    const h = host().image('new', ALL).running(null);
    // A stale rollback hint (a host rebuilt from a copy of .state) never survives a release that migrated.
    mkdirSync(join(h.stack, '.state'), { mode: 0o700 });
    writeFileSync(join(h.stack, '.state', 'previous-tag'), '1bd551d91832\n');
    const r = h.run('deploy.sh', ['--image', 'new']);
    expect(r.status, r.stderr).toBe(0);
    expect(h.applied()).toEqual(ALL);
    expect(h.log('backup.log')).toBe('');
    expect(r.stderr).toMatch(/starting PostgreSQL to read the schema/);
    expect(r.stderr).toMatch(new RegExp(`deployed orbes-genome:new \\(no previous image on this host to roll back to\\); it applied the migration\\(s\\) ${words(ALL)}`));
    expect(h.stateFile('previous-tag')).toBeNull();
  });
});

describe('deploy.sh --image: an image that cannot run on the schema is refused before anything happens', () => {
  /** Production after deployment 2: the schema holds 0004–0013, orbes-genome:new runs. */
  function afterDeployment2(): FakeHost {
    const h = host({ env: { ORBES_IMAGE_TAG: 'new' } }).image('lot1', LOT1).image('new', ALL).image('fix', ALL).running('new');
    h.applied(ALL);
    return h;
  }

  it('refuses an older image: no backup, nothing stopped, .env untouched, the way forward printed', () => {
    const h = afterDeployment2();
    const envBefore = readFileSync(h.envFile, 'utf8');
    const r = h.run('deploy.sh', ['--image', 'lot1']);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`this image cannot run on this schema: repair forward\\. The database holds migration\\(s\\) that orbes-genome:lot1 does not know: ${words(ADDED)}\\.`));
    expect(r.stderr).toMatch(/nothing was stopped and no backup was written; the stack stays on orbes-genome:new/);
    expect(r.stderr).toMatch(/scripts\/deploy\.sh --image new\n/);
    expect(r.stderr).toMatch(/restore\.sh is not used on the shared server/);
    // No pre-deploy backup (it would carry the new schema under the old image's name)…
    expect(h.log('backup.log')).toBe('');
    // …nothing stopped, started or migrated, .env as it was.
    const calls = h.log('docker.log');
    expect(calls).not.toMatch(/ (stop|up|rm|run --rm --no-deps) /);
    expect(calls).not.toMatch(/db\.ts migrate/);
    expect(readFileSync(h.envFile, 'utf8')).toBe(envBefore);
    expect(h.runningImage('app')).toBe('orbes-genome:new');
    expect(h.stateFile('deploys.log')).toBeNull();
  });

  it('refuses it as well when the stack is down: PostgreSQL is started to read the schema, the app is not', () => {
    const h = afterDeployment2().running(null);
    const r = h.run('deploy.sh', ['--image', 'lot1']);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/this image cannot run on this schema: repair forward/);
    expect(h.runningImage('postgres')).toBe('postgres:17');
    expect(h.runningImage('app')).toBeNull();
    expect(h.log('backup.log')).toBe('');
    expect(h.envValue('ORBES_IMAGE_TAG')).toBe('new');
  });

  it('stops when the applied migrations cannot be read, saying what it changed: nothing, or only PostgreSQL started', () => {
    const up = afterDeployment2().fail('read-applied');
    const r = up.run('deploy.sh', ['--image', 'fix']);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/ERROR: cannot read the applied migrations \(kysely_migration\): nothing was changed\n/);
    expect(up.log('backup.log')).toBe('');
    expect(up.runningImage('app')).toBe('orbes-genome:new');
    const down = afterDeployment2().running(null).fail('read-applied');
    const d = down.run('deploy.sh', ['--image', 'fix']);
    expect(d.status, d.stderr).toBe(1);
    expect(d.stderr).toMatch(/ERROR: cannot read the applied migrations \(kysely_migration\): nothing else was changed \(PostgreSQL was started to read the schema\)\n/);
    expect(down.runningImage('postgres')).toBe('postgres:17');
    expect(down.runningImage('app')).toBeNull();
    expect(down.envValue('ORBES_IMAGE_TAG')).toBe('new');
    // The refusal of an older image says the same about PostgreSQL.
    const refused = afterDeployment2().running(null).run('deploy.sh', ['--image', 'lot1']);
    expect(refused.stderr).toMatch(/the stack stays on orbes-genome:new \(PostgreSQL was started to read the schema\)\.\n/);
  });

  it('refuses it in --dry-run too, and accepts an image that knows every applied migration', () => {
    const h = afterDeployment2();
    const dry = h.run('deploy.sh', ['--image', 'lot1', '--dry-run']);
    expect(dry.status, dry.stderr).toBe(1);
    expect(dry.stderr).toMatch(/this image cannot run on this schema: repair forward/);
    const fix = h.run('deploy.sh', ['--image', 'fix']);
    expect(fix.status, fix.stderr).toBe(0);
    expect(fix.stderr).toMatch(new RegExp(`schema: ${ALL.length} migration\\(s\\) applied, all known to orbes-genome:fix`));
    expect(h.log('backup.log')).toBe('backup.sh --reason pre-deploy-fix\n');
    expect(h.runningImage('app')).toBe('orbes-genome:fix');
  });
});

describe('lib.sh: no stray exported setting on the shared host', () => {
  function guard(env: Record<string, string>, dotEnv = ''): RunResult {
    const dir = mkdtempSync(join(tmpdir(), 'orbes-guard-'));
    try {
      writeFileSync(join(dir, '.env'), dotEnv, { mode: 0o600 });
      const r = spawnSync('bash', ['-c', 'set -Eeuo pipefail; source "$1"; guard_shared_host_env; echo passed', 'bash', join(STACK, 'scripts', 'lib.sh')], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ORBES_STACK_ENV_FILE: join(dir, '.env'), ...env },
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('accepts nothing exported, or the compose project of the stack itself', () => {
    expect(guard({}).stdout).toBe('passed\n');
    expect(guard({ COMPOSE_PROJECT_NAME: 'orbes' }).stdout).toBe('passed\n');
    expect(guard({ COMPOSE_PROJECT_NAME: 'orbes2' }, 'COMPOSE_PROJECT_NAME=orbes2\n').stdout).toBe('passed\n');
  });

  it('stops on another compose project, or on any ORBES_IMAGE_TAG, saying what to unset', () => {
    for (const [env, dotEnv] of [
      [{ COMPOSE_PROJECT_NAME: 'another-stack' }, ''],
      [{ COMPOSE_PROJECT_NAME: '' }, ''],
      [{ COMPOSE_PROJECT_NAME: 'orbes' }, 'COMPOSE_PROJECT_NAME=orbes2\n'],
    ] as const) {
      const r = guard(env, dotEnv);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/ERROR: COMPOSE_PROJECT_NAME is exported in this shell .* docker compose would act on another project's containers and volumes\. Run: unset COMPOSE_PROJECT_NAME/);
    }
    for (const tag of ['1bd551d91832', '']) {
      const r = guard({ ORBES_IMAGE_TAG: tag });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/ERROR: ORBES_IMAGE_TAG is exported in this shell .* docker compose would prefer it to .* Run: unset ORBES_IMAGE_TAG/);
    }
  });

  it.each([
    ['deploy.sh', ['--image', 'new']],
    ['backup.sh', []],
    ['restore.sh', ['--identity', '/dev/null', '--latest', '--dry-run']],
  ])('%s refuses to start with either one exported, before any compose command', (script, args) => {
    for (const env of [{ COMPOSE_PROJECT_NAME: 'another-stack' }, { ORBES_IMAGE_TAG: 'new' }] as Record<string, string>[]) {
      const h = host({ stubBackup: false, env: { ORBES_IMAGE_TAG: 'lot1' } }).image('lot1', LOT1).image('new', ALL).running('lot1');
      h.applied(LOT1);
      const r = h.run(script, args, env);
      expect(r.status, `${script} ${JSON.stringify(env)}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(/is exported in this shell/);
      // At most deploy.sh's `docker compose version` probe ran.
      expect(h.log('docker.log').replace(/^compose version\n/, '')).toBe('');
      expect(h.envValue('ORBES_IMAGE_TAG')).toBe('lot1');
    }
  });
});

describe('restore.sh: never on the shared server (RESTORE_ALLOWED=false)', () => {
  it('refuses before doing anything, --dry-run and a missing --identity included, citing the decision and the way forward', () => {
    const h = host({ env: { RESTORE_ALLOWED: 'false' } }).running('new');
    mkdirSync(join(h.backups, 'daily'), { recursive: true });
    for (const args of [['--identity', '/dev/null', '--latest', '--yes'], ['--identity', '/dev/null', '--latest', '--dry-run'], []]) {
      const r = h.run('restore.sh', args, { RESTORE_ALLOWED: 'true' /* the shell cannot override .env */ });
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/ERROR: restore\.sh is disabled on this server \(RESTORE_ALLOWED=false in .*\.env\)\. Decision of 2026-10-03: this shared server is never restored from a backup; it is repaired forward\./);
      expect(r.stderr).toMatch(/scripts\/deploy\.sh --image <current tag>/);
      expect(r.stderr).toMatch(/a corrective commit, deployed normally \(git pull && scripts\/deploy\.sh\)/);
      expect(r.stderr).toMatch(/Restores and restore drills run only on a separate, disposable server \(docs\/DEPLOYMENT\.md §15\.9\)/);
    }
    expect(h.log('docker.log')).toBe('');
    expect(readdirSync(h.backups)).toEqual(['daily']);
    // --help still answers.
    const help = h.run('restore.sh', ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/NEVER on the shared production server/);
  });

  it('reads it from the stack\'s own .env too: an exported ORBES_STACK_ENV_FILE naming a copy that allows it changes nothing', () => {
    const h = host({ env: { RESTORE_ALLOWED: 'false' } }).running('new');
    mkdirSync(join(h.backups, 'daily'), { recursive: true });
    const copy = join(h.dir, 'copy.env');
    writeFileSync(copy, readFileSync(h.envFile, 'utf8').replace('RESTORE_ALLOWED=false', 'RESTORE_ALLOWED=true'), { mode: 0o600 });
    chmodSync(copy, 0o600);
    expect(readFileSync(copy, 'utf8')).toMatch(/^RESTORE_ALLOWED=true$/m);
    const r = h.run('restore.sh', ['--identity', '/dev/null', '--latest', '--yes'], { ORBES_STACK_ENV_FILE: copy });
    expect(r.status, r.stderr).toBe(1);
    // The stack's own .env (its path resolved, as lib.sh resolves STACK_DIR).
    expect(r.stderr).toMatch(/ERROR: restore\.sh is disabled on this server \(RESTORE_ALLOWED=false in \S*\/repo\/deploy\/vps\/\.env\)\./);
    expect(h.log('docker.log')).toBe('');
    expect(readdirSync(h.backups)).toEqual(['daily']);
    // And the other way round: the file named says false, whatever the stack's .env says.
    h.setEnv('RESTORE_ALLOWED', 'true');
    writeFileSync(copy, readFileSync(h.envFile, 'utf8').replace('RESTORE_ALLOWED=true', 'RESTORE_ALLOWED=false'), { mode: 0o600 });
    const named = h.run('restore.sh', ['--identity', '/dev/null', '--latest', '--yes'], { ORBES_STACK_ENV_FILE: copy });
    expect(named.status, named.stderr).toBe(1);
    expect(named.stderr).toContain(`ERROR: restore.sh is disabled on this server (RESTORE_ALLOWED=false in ${copy}).`);
    expect(h.log('docker.log')).toBe('');
  });

  it('refuses a value other than true or false', () => {
    const h = host({ env: { RESTORE_ALLOWED: 'no' } });
    const r = h.run('restore.sh', ['--identity', '/dev/null', '--latest']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/RESTORE_ALLOWED in .* must be true or false, not "no": nothing was done/);
  });

  it('goes on where it is allowed: unset (a dedicated or test server) or true', () => {
    for (const env of [{}, { RESTORE_ALLOWED: 'true' }] as Record<string, string>[]) {
      const h = host({ env });
      const r = h.run('restore.sh', ['--identity', '/dev/null', '--archive', join(h.dir, 'missing.tar.age')]);
      expect(r.status).toBe(1);
      expect(r.stderr).not.toMatch(/RESTORE_ALLOWED/);
      expect(r.stderr).toMatch(/cannot read .*missing\.tar\.age/);
    }
  });
});

describe('backup.sh: the photographs on the disk, and the off-site copy', () => {
  function backupHost(env: Record<string, string> = {}): FakeHost {
    const h = host({ stubBackup: false, env: { ORBES_IMAGE_TAG: 'new', ...env } }).image('new', ALL).running('new');
    h.applied(ALL);
    return h;
  }

  it('logs "photos: N, X MB" on every run, 0 without an error before migration 0012, even with --quiet', () => {
    const h = backupHost();
    const before = h.run('backup.sh', ['--reason', 'nightly', '--no-upload']);
    expect(before.status, before.stderr).toBe(0);
    expect(before.stderr).toMatch(/\[backup\.sh\] photos: 0, 0\.0 MB\n/);
    expect(before.stderr).not.toMatch(/ERROR|WARNING/);
    writeFileSync(join(h.state, 'db', 'media'), `3 ${3.5 * 1048576}\n`);
    const quiet = h.run('backup.sh', ['--reason', 'nightly', '--no-upload', '--quiet']);
    expect(quiet.status, quiet.stderr).toBe(0);
    // --quiet silences everything else, never this line.
    expect(quiet.stderr.trim().split('\n')).toEqual([expect.stringMatching(/ \[backup\.sh\] photos: 3, 3\.5 MB$/)]);
    const dry = h.run('backup.sh', ['--dry-run']);
    expect(dry.stderr).toMatch(/photos: 3, 3\.5 MB/);
    // The backup itself is unchanged: the archive recorded as the last one, with its checksum.
    const last = /^\S+ (\S+\.tar\.age) [0-9a-f]{64}\n$/.exec(h.stateFile('last-backup') ?? '')?.[1];
    expect(last).toBeDefined();
    expect(existsSync(last!) && existsSync(`${last}.sha256`)).toBe(true);
  });

  it('copies off-site only the archives younger than the remote retention age, which it also prunes', () => {
    const h = backupHost({ BACKUP_RCLONE_DEST: 'ovh-s3:orbes-backups/verify' });
    const daily = join(h.backups, 'daily');
    const weekly = join(h.backups, 'weekly');
    mkdirSync(daily, { recursive: true });
    mkdirSync(weekly, { recursive: true });
    const now = Date.now();
    const archive = (dir: string, name: string, ageDays: number) => {
      for (const f of [name, `${name}.sha256`]) {
        writeFileSync(join(dir, f), `${f}\n`);
        const t = new Date(now - ageDays * DAY);
        utimesSync(join(dir, f), t, t);
      }
    };
    // Event archives are pruned locally by count, not by age: the first is 20 days old.
    archive(daily, 'orbes-20200901T120000Z-pre-deploy-1bd551d91832.tar.age', 20);
    archive(daily, 'orbes-20200919T120000Z-pre-deploy-db4ffd0c0fd4.tar.age', 2);
    archive(weekly, 'orbes-2020-W01-20200101T031700Z-nightly.tar.age', 70);
    archive(weekly, 'orbes-2020-W02-20200108T031700Z-nightly.tar.age', 30);
    // Already off-site and past the remote retention.
    const remote = join(h.state, 'remote', 'orbes-backups', 'verify');
    mkdirSync(join(remote, 'daily'), { recursive: true });
    archive(join(remote, 'daily'), 'orbes-20200801T031700Z-nightly.tar.age', 16);

    const r = h.run('backup.sh', ['--reason', 'nightly']);
    expect(r.status, r.stderr).toBe(0);
    const newest = readdirSync(daily).find((f) => /^orbes-\d{8}T\d{6}Z-nightly\.tar\.age$/.test(f))!;
    expect(newest).toBeDefined();
    expect(readdirSync(join(remote, 'daily')).sort()).toEqual(
      [newest, `${newest}.sha256`, 'orbes-20200919T120000Z-pre-deploy-db4ffd0c0fd4.tar.age', 'orbes-20200919T120000Z-pre-deploy-db4ffd0c0fd4.tar.age.sha256'].sort(),
    );
    const weeklyNow = readdirSync(weekly).filter((f) => f.endsWith('.tar.age') && !f.startsWith('orbes-2020-'));
    expect(weeklyNow).toHaveLength(1);
    expect(readdirSync(join(remote, 'weekly')).sort()).toEqual(
      [weeklyNow[0], `${weeklyNow[0]}.sha256`, 'orbes-2020-W02-20200108T031700Z-nightly.tar.age', 'orbes-2020-W02-20200108T031700Z-nightly.tar.age.sha256'].sort(),
    );
    // The same ages bound the copy and the remote pruning: BACKUP_KEEP_DAILY + 1 days, BACKUP_KEEP_WEEKLY × 7 + 7 days.
    const calls = h.log('rclone.log');
    expect(calls).toMatch(/^copy -q --max-age 15d \S+\/daily ovh-s3:orbes-backups\/verify\/daily /m);
    expect(calls).toMatch(/^copy -q --max-age 63d \S+\/weekly ovh-s3:orbes-backups\/verify\/weekly /m);
    expect(calls).toMatch(/^delete -q --min-age 15d ovh-s3:orbes-backups\/verify\/daily$/m);
    expect(calls).toMatch(/^delete -q --min-age 63d ovh-s3:orbes-backups\/verify\/weekly$/m);
    // A second night sends nothing old again.
    const again = h.run('backup.sh', ['--reason', 'nightly']);
    expect(again.status, again.stderr).toBe(0);
    expect(readdirSync(join(remote, 'daily'))).not.toContain('orbes-20200901T120000Z-pre-deploy-1bd551d91832.tar.age');
    expect(readdirSync(join(remote, 'weekly'))).not.toContain('orbes-2020-W01-20200101T031700Z-nightly.tar.age');
  });

  it('derives both ages from the configured retention', () => {
    const h = backupHost({ BACKUP_RCLONE_DEST: 'ovh-s3:orbes-backups/verify', BACKUP_KEEP_DAILY: '3', BACKUP_KEEP_WEEKLY: '2' });
    const r = h.run('backup.sh', ['--reason', 'nightly']);
    expect(r.status, r.stderr).toBe(0);
    const calls = h.log('rclone.log');
    expect(calls).toMatch(/^copy -q --max-age 4d /m);
    expect(calls).toMatch(/^copy -q --max-age 21d /m);
    expect(calls).toMatch(/^delete -q --min-age 4d /m);
    expect(calls).toMatch(/^delete -q --min-age 21d /m);
  });

  it('keeps no event archive locally beyond the weekly age, BACKUP_KEEP_WEEKLY × 7 + 7 days (63): the "about two months" of the privacy policy', () => {
    const h = backupHost();
    const daily = join(h.backups, 'daily');
    const weekly = join(h.backups, 'weekly');
    mkdirSync(daily, { recursive: true });
    mkdirSync(weekly, { recursive: true });
    const now = Date.now();
    const archive = (dir: string, name: string, ageDays: number) => {
      for (const f of [name, `${name}.sha256`]) {
        writeFileSync(join(dir, f), `${f}\n`);
        const t = new Date(now - ageDays * DAY);
        utimesSync(join(dir, f), t, t);
      }
    };
    // Fewer than BACKUP_KEEP_DAILY (14) of each kind: the count prunes nothing, the age does.
    archive(daily, 'orbes-20200101T120000Z-pre-deploy-1bd551d91832.tar.age', 70);
    archive(daily, 'orbes-20200203T120000Z-post-rotation.tar.age', 64);
    archive(daily, 'orbes-20200206T120000Z-pre-restore.tar.age', 62);
    archive(daily, 'orbes-20200310T120000Z-pre-deploy-db4ffd0c0fd4.tar.age', 20);
    // A weekly copy whose first archive of the week was an event archive is one too.
    archive(weekly, 'orbes-2020-W01-20200101T120000Z-pre-deploy-1bd551d91832.tar.age', 70);
    // Scheduled weekly copies are kept by count (8), and come every week.
    archive(weekly, 'orbes-2020-W06-20200203T031700Z-nightly.tar.age', 62);
    const r = h.run('backup.sh', ['--reason', 'nightly', '--no-upload']);
    expect(r.status, r.stderr).toBe(0);
    const left = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.tar.age') && f.startsWith('orbes-2020'));
    expect(left(daily).sort()).toEqual(['orbes-20200206T120000Z-pre-restore.tar.age', 'orbes-20200310T120000Z-pre-deploy-db4ffd0c0fd4.tar.age']);
    expect(left(weekly)).toEqual(['orbes-2020-W06-20200203T031700Z-nightly.tar.age']);
    // Their checksums go with them.
    for (const gone of ['orbes-20200101T120000Z-pre-deploy-1bd551d91832.tar.age', 'orbes-20200203T120000Z-post-rotation.tar.age']) {
      expect(existsSync(join(daily, `${gone}.sha256`)), gone).toBe(false);
      expect(r.stderr).toContain(`pruned ${gone} (an event archive older than 63 days)`);
    }
    expect(existsSync(join(weekly, 'orbes-2020-W01-20200101T120000Z-pre-deploy-1bd551d91832.tar.age.sha256'))).toBe(false);
    expect(existsSync(join(daily, 'orbes-20200206T120000Z-pre-restore.tar.age.sha256'))).toBe(true);
    // The bound follows BACKUP_KEEP_WEEKLY: with 2 weeks, 21 days.
    const short = backupHost({ BACKUP_KEEP_WEEKLY: '2' });
    mkdirSync(join(short.backups, 'daily'), { recursive: true });
    const old = join(short.backups, 'daily', 'orbes-20200310T120000Z-pre-deploy-db4ffd0c0fd4.tar.age');
    writeFileSync(old, 'x');
    utimesSync(old, new Date(now - 22 * DAY), new Date(now - 22 * DAY));
    const s = short.run('backup.sh', ['--reason', 'nightly', '--no-upload']);
    expect(s.status, s.stderr).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(s.stderr).toContain('(an event archive older than 21 days)');
  });
});

describe('the SQL of the scripts and of the runbook, on the migrated schema', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  const lib = read(STACK, 'scripts', 'lib.sh');
  const constant = (name: string) => {
    const m = new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)")$`, 'm').exec(lib);
    expect(m, name).not.toBeNull();
    return m![1] ?? m![2];
  };
  const values = async (sql: string) => (await t.pglite.query<Record<string, unknown>>(sql)).rows.map((row) => Object.values(row).join(' '));

  it('lists the applied migrations and measures the photographs as deploy.sh and backup.sh read them', async () => {
    expect(await values(constant('APPLIED_MIGRATIONS_SQL'))).toEqual(ALL);
    const usage = constant('PHOTO_USAGE_SQL');
    expect(await values(usage)).toEqual(['0 0']);
    await t.pglite.query(
      `INSERT INTO media_objects (sha256, mime, bytes, width, height) VALUES
         (encode(sha256('\\x0102'::bytea), 'hex'), 'image/jpeg', '\\x0102'::bytea, 1, 1),
         (encode(sha256('\\x030405'::bytea), 'hex'), 'image/webp', '\\x030405'::bytea, 1, 1)`,
    );
    expect(await values(usage)).toEqual(['2 5']);
  });

  it("lists the migrations an image knows as deploy.sh reads them (lib.sh's probe, also run by CI in the built image)", () => {
    const probe = constant('IMAGE_MIGRATIONS_JS');
    // As `docker run --entrypoint node <image> --import tsx -e "$IMAGE_MIGRATIONS_JS"`, from the app's directory.
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', probe], { cwd: GENOME, encoding: 'utf8', timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(ALL.map((m) => `${m}\n`).join(''));
    // The CI image job extracts the probe with this sed expression and runs it in orbes-genome:ci.
    const ci = read(REPO, '.github', 'workflows', 'genome-ci.yml');
    expect(ci).toContain(`sed -n "s/^IMAGE_MIGRATIONS_JS='\\(.*\\)'$/\\1/p" ../deploy/vps/scripts/lib.sh`);
    expect(ci).toMatch(/docker run --rm --network none --entrypoint node orbes-genome:ci --import tsx -e "\$probe"/);
  });

  it('runs the photograph queries of docs/DEPLOYMENT.md §15.12 as written', async () => {
    const deployment = read(REPO, 'docs', 'DEPLOYMENT.md');
    const block = /<<'SQL'\n([\s\S]*?)\nSQL\n/.exec(deployment.slice(deployment.indexOf('#### Disk used by the photographs')));
    expect(block, 'the SQL block of the photographs section').not.toBeNull();
    const statements = block![1].split(';').map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThanOrEqual(2);
    for (const sql of statements) await expect(t.pglite.query(sql), sql).resolves.toBeDefined();
  });
});

/**
 * lib.sh's psql wrappers as a real psql runs them (opt-in: ORBES_TEST_POSTGRES_URL and psql on the PATH; CI has both,
 * its runner installs postgresql-client): the exact lines db_applied_migrations and db_photo_usage pipe into psql
 * (\gset, \if, \else, \endif), with db_query_owner's flags, on an empty database, one at deployment 1's schema
 * (before migration 0012: no media_objects) and one fully migrated. The fake Docker host only pattern-matches them.
 */
const PG_URL = process.env.ORBES_TEST_POSTGRES_URL;
const PSQL = spawnSync('sh', ['-c', 'command -v psql'], { encoding: 'utf8' }).stdout.trim();

describe.skipIf(!PG_URL || (!PSQL && !process.env.CI))("lib.sh's psql wrappers on PostgreSQL (opt-in)", () => {
  const dbName = `orbes_libsh_${randomBytes(6).toString('hex')}`;
  let admin: Db;
  let db: Db;
  let url: string;

  beforeAll(async () => {
    admin = createDb(PG_URL!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(PG_URL!);
    u.pathname = `/${dbName}`;
    url = u.toString();
    db = createDb(url);
  });

  afterAll(async () => {
    if (db) await closeDb(db);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });

  /** A function of lib.sh, its db_query_owner pointed at the throwaway database with the same psql flags. */
  function libsh(fn: 'db_applied_migrations' | 'db_photo_usage'): string {
    const script = `set -Eeuo pipefail; source "$1"; db_query_owner() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$ORBES_PSQL_URL"; }; ${fn}`;
    const r = spawnSync('bash', ['-c', script, 'bash', join(STACK, 'scripts', 'lib.sh')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ORBES_PSQL_URL: url, ORBES_STACK_ENV_FILE: join(tmpdir(), 'orbes-no-such.env') },
    });
    expect(r.status, `${fn}: ${r.stderr}`).toBe(0);
    expect(r.stderr, fn).toBe('');
    return r.stdout;
  }

  it('reads nothing, then deployment 1, then every migration; and the photographs as 0 0 until media_objects exists', async () => {
    expect(PSQL, 'psql on the PATH (CI installs postgresql-client)').not.toBe('');
    // Empty: no kysely_migration, no media_objects.
    expect(libsh('db_applied_migrations')).toBe('');
    expect(libsh('db_photo_usage')).toBe('0 0\n');
    // Deployment 1's schema (0001–0003): the \else branch of the photographs.
    const lot1 = await createMigrator(db).migrateTo(LOT1.at(-1)!);
    expect(lot1.error).toBeUndefined();
    expect(libsh('db_applied_migrations')).toBe(LOT1.map((m) => `${m}\n`).join(''));
    expect(libsh('db_photo_usage')).toBe('0 0\n');
    // Fully migrated: the table, empty, then two photographs.
    await migrateToLatest(db);
    expect(libsh('db_applied_migrations')).toBe(ALL.map((m) => `${m}\n`).join(''));
    expect(libsh('db_photo_usage')).toBe('0 0\n');
    await sql`INSERT INTO media_objects (sha256, mime, bytes, width, height) VALUES
      (encode(sha256('\\x0102'::bytea), 'hex'), 'image/jpeg', '\\x0102'::bytea, 1, 1),
      (encode(sha256('\\x030405'::bytea), 'hex'), 'image/webp', '\\x030405'::bytea, 1, 1)`.execute(db);
    expect(libsh('db_photo_usage')).toBe('2 5\n');
  }, 60_000);
});

describe('the decisions in the scripts and the runbook', () => {
  it('no scripted path leads to restore.sh on the shared server', () => {
    for (const f of ['deploy.sh', 'backup.sh', 'lib.sh']) {
      for (const line of read(STACK, 'scripts', f).split('\n').filter((l) => /restore\.sh/.test(l) && !/^\s*#/.test(l))) {
        expect(line, `${f}: ${line}`).toMatch(/restore\.sh is not used on the shared server|restores\b|"pre-restore"|--reason pre-restore/);
      }
    }
    expect(read(STACK, 'scripts', 'restore.sh')).toMatch(/RESTORE_ALLOWED="\$\(ENV_FILE="\$allowed_file" env_get RESTORE_ALLOWED true\)"/);
    expect(read(STACK, 'scripts', 'restore.sh')).toContain('[[ "$STACK_DIR/.env" -ef "$ENV_FILE" ]] || ALLOWED_FILES+=("$STACK_DIR/.env")');
    expect(read(STACK, '.env.example')).toMatch(/\nRESTORE_ALLOWED=true\n/);
  });

  it('DEPLOYMENT.md never suggests a bare docker image prune, and removes old images by exact tag', () => {
    const deployment = read(REPO, 'docs', 'DEPLOYMENT.md');
    for (const line of deployment.split('\n').filter((l) => /docker (image|system|volume) prune/.test(l))) {
      expect(line, line).toMatch(/\b(never|not|no)\b/i);
    }
    expect(deployment).toMatch(/docker image rm orbes-genome:<tag>/);
    expect(read(REPO, 'docs', 'COMPLIANCE.md')).toMatch(/RESTORE_ALLOWED=false/);
  });
});
