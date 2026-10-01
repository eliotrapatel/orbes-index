/** GEO_MODE=mmdb / GEO_MMDB_PATH validation (src/server/config.ts). */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, redactConfig } from '../../src/server/config.js';

const RANDOMISH_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff)).toString('base64url');
const PROD = {
  ORBES_ENV: 'production',
  PUBLIC_ORIGIN: 'https://verify.theorbes.com',
  DATABASE_URL: 'postgres://orbes:pw@db:5432/orbes',
  COOKIE_SECRET: 'c00kie-Secret-with-Plenty-of-Entropy-0123456789',
  IP_HASH_PEPPER: 'pepper-Secret-with-Plenty-of-Entropy-9876543210',
  KEY_PROVIDER: 'local',
  KEY_DIR: '/var/lib/orbes/keys',
  KEY_ENCRYPTION_KEY: RANDOMISH_KEY,
};
const MMDB = '/var/lib/orbes/geoip/dbip-city-lite.mmdb';

function issues(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).issues;
  }
  return [];
}

describe('GEO_MODE=mmdb configuration', () => {
  it('accepts an absolute GEO_MMDB_PATH (the file itself may be missing: that only degrades geo)', () => {
    const c = loadConfig({ GEO_MODE: 'mmdb', GEO_MMDB_PATH: '/nonexistent/dir/db.mmdb' });
    expect(c.geo).toEqual({ mode: 'mmdb', mmdbPath: '/nonexistent/dir/db.mmdb' });
    expect(Object.isFrozen(c.geo)).toBe(true);
  });

  it('requires GEO_MMDB_PATH, absolute', () => {
    expect(issues({ GEO_MODE: 'mmdb' })).toEqual(['GEO_MMDB_PATH: required when GEO_MODE=mmdb']);
    expect(issues({ GEO_MODE: 'mmdb', GEO_MMDB_PATH: '   ' })).toEqual(['GEO_MMDB_PATH: required when GEO_MODE=mmdb']);
    expect(issues({ GEO_MODE: 'mmdb', GEO_MMDB_PATH: '.data/geoip/dbip-city-lite.mmdb' })).toEqual(['GEO_MMDB_PATH: must be an absolute path']);
    expect(issues({ GEO_MODE: 'mmdb', GEO_MMDB_PATH: `/${'a'.repeat(5000)}` })).toEqual(['GEO_MMDB_PATH: must be an absolute path']);
  });

  it('ignores GEO_MMDB_PATH in the other modes, and rejects unknown modes', () => {
    expect(loadConfig({ GEO_MODE: 'none', GEO_MMDB_PATH: MMDB }).geo).toEqual({ mode: 'none' });
    expect(loadConfig({ GEO_MMDB_PATH: 'relative-is-not-checked-when-unused' }).geo).toEqual({ mode: 'none' });
    expect(issues({ GEO_MODE: 'maxmind' })[0]).toMatch(/^GEO_MODE:/);
  });

  it('production: mmdb requires TRUST_PROXY (behind the TLS proxy, the socket address is the proxy itself)', () => {
    expect(issues({ ...PROD, GEO_MODE: 'mmdb', GEO_MMDB_PATH: MMDB })).toEqual(['GEO_MODE: mmdb mode requires TRUST_PROXY in production']);
    expect(issues({ ...PROD, GEO_MODE: 'mmdb', GEO_MMDB_PATH: MMDB, TRUST_PROXY: 'true' })).toEqual([
      'TRUST_PROXY: "true" trusts every X-Forwarded-For hop (client-forgeable); list the proxy addresses or ranges instead',
    ]);
    const c = loadConfig({ ...PROD, GEO_MODE: 'mmdb', GEO_MMDB_PATH: MMDB, TRUST_PROXY: 'uniquelocal' });
    expect(c.geo).toEqual({ mode: 'mmdb', mmdbPath: MMDB });
    expect(redactConfig(c).geo).toEqual({ mode: 'mmdb', mmdbPath: MMDB });
  });
});
