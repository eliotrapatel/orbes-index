import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBase64Url, utf8 } from '../../src/core/bytes.js';
import { verifyEd25519Node } from '../../src/server/crypto/ed25519-node.js';
import { createKeyProvider, KeyProviderError, LocalKeyProvider, MemoryKeyProvider } from '../../src/server/keys/index.js';
import { testConfig } from '../../src/server/config.js';

const MSG = utf8('hello');

describe('MemoryKeyProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('generates and signs; distinct kids get distinct keys', async () => {
    const p = new MemoryKeyProvider({ env: 'test' });
    expect(p.name).toBe('memory');
    const a = await p.generate('a');
    const b = await p.generate('b');
    expect(a.providerRef).toBe('memory:a');
    expect(a.publicKey).not.toEqual(b.publicKey);
    expect(verifyEd25519Node(a.publicKey, MSG, await p.sign(a.providerRef, MSG))).toBe(true);
    expect(verifyEd25519Node(b.publicKey, MSG, await p.sign(a.providerRef, MSG))).toBe(false);
  });

  it('rejects duplicate kids, unknown references and invalid input', async () => {
    const p = new MemoryKeyProvider({ env: 'test' });
    await p.generate('a');
    await expect(p.generate('a')).rejects.toMatchObject({ code: 'KEY_EXISTS' });
    await expect(p.sign('memory:nope', MSG)).rejects.toMatchObject({ code: 'KEY_NOT_FOUND' });
    await expect(p.generate('../x')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(p.sign('memory:a', 'x' as unknown as Uint8Array)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('wipe() forgets every key', async () => {
    const p = new MemoryKeyProvider({ env: 'test' });
    const a = await p.generate('a');
    p.wipe();
    await expect(p.sign(a.providerRef, MSG)).rejects.toBeInstanceOf(KeyProviderError);
  });

  it('is refused in production (explicit env, ORBES_ENV, or NODE_ENV fallback)', () => {
    expect(() => new MemoryKeyProvider({ env: 'production' })).toThrow(/refused in production/);
    vi.stubEnv('ORBES_ENV', 'production');
    expect(() => new MemoryKeyProvider()).toThrow(KeyProviderError);
    vi.unstubAllEnvs();
    vi.stubEnv('ORBES_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new MemoryKeyProvider()).toThrow(KeyProviderError);
    // An explicit non-production env wins over the process environment (tests, tools).
    expect(() => new MemoryKeyProvider({ env: 'test' })).not.toThrow();
  });
});

describe('createKeyProvider', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('builds the configured provider', async () => {
    const mem = await createKeyProvider(testConfig());
    expect(mem).toBeInstanceOf(MemoryKeyProvider);

    root = await mkdtemp(join(tmpdir(), 'orbes-keys-'));
    const encryptionKey = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    const local = await createKeyProvider(testConfig({ keys: { provider: 'local', dir: join(root, 'k'), encryptionKey } }));
    expect(local).toBeInstanceOf(LocalKeyProvider);
  });

  it('refuses memory keys in production and local keys without dir or encryption key', async () => {
    await expect(createKeyProvider({ env: 'production', keys: { provider: 'memory' } })).rejects.toMatchObject({ code: 'CONFIG' });
    await expect(createKeyProvider({ env: 'test', keys: { provider: 'local' } })).rejects.toMatchObject({ code: 'CONFIG' });
    await expect(createKeyProvider({ env: 'test', keys: { provider: 'local', dir: '/tmp/orbes-never-created' } })).rejects.toMatchObject({
      code: 'CONFIG',
    });
  });
});
