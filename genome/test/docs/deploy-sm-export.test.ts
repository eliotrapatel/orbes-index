/**
 * The runbook of lot EXPORT SMART MODEL (docs/launch/DEPLOY-SM-EXPORT.md): the lines of compose.yaml it shows are the
 * ones the lot adds, no migration, the legal version kept, and no command shows a secret or sends the token anywhere but
 * the export's own address.
 */
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { SMART_MODEL_EXPORT_ROUTE } from '../../src/server/routes/export.js';
import { LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { readDoc, section } from './lexicon.js';
import { fenced } from './runbook.js';

const RUNBOOK = 'docs/launch/DEPLOY-SM-EXPORT.md';
const runbook = readDoc(RUNBOOK);
const commands = fenced(runbook, 'bash');
const outputs = fenced(runbook, 'text');

/** Production before the lot: lot PURGE (deployed 31 Oct 2026, 18:28 Paris). */
const PURGE_SHA = 'b7c2bfdd4f4b0f7e76713ed43b8132b6d3de6cfb';

describe('the runbook of lot EXPORT SMART MODEL (docs/launch/DEPLOY-SM-EXPORT.md)', () => {
  it('shows exactly the lines compose.yaml gains, and nothing else on the host', () => {
    const compose = readDoc('deploy/vps/compose.yaml');
    const shown = outputs.find((o) => o.includes('SMART_MODEL_EXPORT_TOKEN_SHA256: '))!;
    const lines = shown.trim().split('\n').map((l) => l.replace(/^\+/, ''));
    expect(lines).toHaveLength(4);
    expect(compose).toContain(`${lines.join('\n')}\n`);
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${PURGE_SHA} HEAD -- deploy/vps`);
    expect(outputs).toContain('M\tdeploy/vps/.env.example\nM\tdeploy/vps/compose.yaml');
  });

  it('starts from PURGE, 68 migrations, adds none, keeps the legal version', () => {
    expect(Object.keys(MIGRATIONS)).toHaveLength(68);
    expect(Object.keys(MIGRATIONS).at(-1)).toBe('0067_platform_reset');
    expect(runbook).toContain('68 migration(s) applied');
    expect(commands).toContain(`git -C /opt/orbes/orbes-index diff --name-status ${PURGE_SHA} HEAD -- genome/src/server/db/migrations`);
    expect(LEGAL_VERSION).toBe('2026-10-27');
    expect(section(runbook, '## 0. Les règles')).toContain('`LEGAL_VERSION` reste `2026-10-27`');
  });

  it('never shows a secret: the token stays on the Mac and in Cloudflare, the key is made on the server unseen', () => {
    expect(commands.filter((c) => /\bcat\b|printenv|(?:^|\s)env(?! \|)|\bless\b|\bmore\b/.test(c))).toEqual([]);
    for (const c of commands.filter((x) => x.includes('.env'))) {
      expect([
        "grep '^ORBES_IMAGE_TAG=' .env",
        "grep -c '^SMART_MODEL_EXPORT_' .env",
        'cp -p .env .env.before-smart-model',
        "printf 'SMART_MODEL_EXPORT_TOKEN_SHA256=%s\\n' 'COLLE_L_EMPREINTE_ICI' >> .env",
        "printf 'SMART_MODEL_EXPORT_KEY=%s\\n' \"$(openssl rand -hex 32)\" >> .env",
        "grep -cE '^SMART_MODEL_EXPORT_TOKEN_SHA256=[0-9a-f]{64}$' .env; grep -cE '^SMART_MODEL_EXPORT_KEY=[0-9a-f]{64}$' .env; grep -c '^SMART_MODEL_EXPORT_' .env",
        'rm .env.before-smart-model',
      ]).toContain(c);
    }
    // The token is only ever hashed, copied to the clipboard, or sent to the export's own address.
    for (const c of commands.filter((x) => x.includes('$TOKEN'))) {
      expect(/^printf %s "\$TOKEN" \| (shasum -a 256 \| cut -c1-64|pbcopy)$/.test(c) || c.includes(`https://verify.theorbes.com${SMART_MODEL_EXPORT_ROUTE}?`), c).toBe(true);
    }
    expect(runbook).not.toMatch(/[0-9a-f]{64}/);
  });

  it('holds the owner’s rules: Paris first, no LIVE release or test running, the guarded launch, the host told', () => {
    const rules = section(runbook, '## 0. Les règles');
    expect(rules).toContain('jamais entre 04:00 et 06:30 à Paris (03:00–05:30 UTC en hiver)');
    expect(rules).toContain('03:00–03:10 et 03:45–03:55 à Paris');
    expect(commands).toContain('pgrep -a pg_dump || scripts/deploy.sh');
    expect(commands.filter((c) => c.includes('select count(*) from drops where room_opens_minutes'))).toHaveLength(1);
    expect(commands).toContain('docker compose up -d app');
    expect(runbook).toContain("**Au lancement, une ligne au responsable de l'hôte (AI Stack Atlas)**");
    expect(rules).toContain('**Jamais `restore.sh`**');
    expect(commands.filter((c) => /restore\.sh/.test(c))).toEqual([]);
    expect(commands.filter((c) => /prune/.test(c))).toEqual([]);
  });
});
