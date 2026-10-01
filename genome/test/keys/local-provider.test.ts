import { chmod, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url, utf8 } from '../../src/core/bytes.js';
import { verifyEd25519 } from '../../src/core/verify/ed25519.js';
import { verifyEd25519Node } from '../../src/server/crypto/ed25519-node.js';
import { KeyProviderError } from '../../src/server/keys/key-provider.js';
import { LocalKeyProvider } from '../../src/server/keys/local-provider.js';

const KEK = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff));
const OTHER_KEK = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => (i * 53 + 7) & 0xff));
const MSG = utf8('ORBES-CODE/v1\u0000test message');

async function expectProviderError(p: Promise<unknown>, code: string): Promise<KeyProviderError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(KeyProviderError);
  expect((e as KeyProviderError).code).toBe(code);
  return e as KeyProviderError;
}

describe('LocalKeyProvider', () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orbes-keys-'));
    dir = join(root, 'keys');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('configuration', () => {
    it('refuses to start without a 32-byte encryption key', () => {
      for (const encryptionKey of [undefined, '', 'not base64!', toBase64Url(new Uint8Array(16)), toBase64Url(new Uint8Array(33)), `${KEK}=`]) {
        expect(() => new LocalKeyProvider({ dir, encryptionKey })).toThrow(KeyProviderError);
      }
      try {
        new LocalKeyProvider({ dir, encryptionKey: undefined });
      } catch (e) {
        expect((e as KeyProviderError).code).toBe('CONFIG');
      }
    });

    it('refuses a degenerate key (all bytes identical) and a relative directory', () => {
      expect(() => new LocalKeyProvider({ dir, encryptionKey: toBase64Url(new Uint8Array(32)) })).toThrow(/degenerate/);
      expect(() => new LocalKeyProvider({ dir, encryptionKey: new Uint8Array(32).fill(7) })).toThrow(/degenerate/);
      expect(() => new LocalKeyProvider({ dir: 'relative/keys', encryptionKey: KEK })).toThrow(/absolute/);
    });

    it('accepts raw key bytes and does not keep a reference to the caller buffer', async () => {
      const raw = fromBase64Url(KEK);
      const p = new LocalKeyProvider({ dir, encryptionKey: raw });
      raw.fill(0); // caller wipes its copy
      const { publicKey, providerRef } = await p.generate('k-raw');
      expect(verifyEd25519Node(publicKey, MSG, await p.sign(providerRef, MSG))).toBe(true);
    });

    it('creates the key directory with mode 0700 and tightens an existing loose one', async () => {
      await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      expect((await stat(dir)).mode & 0o777).toBe(0o700);

      const loose = join(root, 'loose');
      await LocalKeyProvider.open({ dir: loose, encryptionKey: KEK });
      await chmod(loose, 0o755);
      const warnings: unknown[] = [];
      const log = { info: () => {}, warn: (o: unknown) => warnings.push(o), error: () => {} };
      await LocalKeyProvider.open({ dir: loose, encryptionKey: KEK, log });
      expect((await stat(loose)).mode & 0o777).toBe(0o700);
      expect(warnings).toHaveLength(1);
    });

    it('refuses a key directory path that is a file', async () => {
      const file = join(root, 'file');
      await writeFile(file, 'x');
      await expectProviderError(LocalKeyProvider.open({ dir: file, encryptionKey: KEK }), 'CONFIG');
    });
  });

  describe('round trip', () => {
    it('generates, encrypts at rest and signs strict RFC 8032 signatures', async () => {
      const p = await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      expect(p.name).toBe('local');
      const { publicKey, providerRef } = await p.generate('orbes-k001-test');
      expect(publicKey).toBeInstanceOf(Uint8Array);
      expect(publicKey.length).toBe(32);
      expect(providerRef).toBe('orbes-k001-test.key.json');

      const sig = await p.sign(providerRef, MSG);
      expect(sig.length).toBe(64);
      expect(verifyEd25519Node(publicKey, MSG, sig)).toBe(true);
      expect(verifyEd25519(publicKey, MSG, sig)).toBe(true); // independent implementation agrees
      // Deterministic Ed25519: same key, same message, same signature.
      expect(await p.sign(providerRef, MSG)).toEqual(sig);
      // A second provider instance with the same KEK reads the same file.
      const again = new LocalKeyProvider({ dir, encryptionKey: KEK });
      expect(await again.sign(providerRef, MSG)).toEqual(sig);
    });

    it('writes exactly {v, kid, alg, iv, ct, tag} in base64url, mode 0600, no plaintext seed', async () => {
      const p = await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      const { publicKey, providerRef } = await p.generate('k1');
      const path = join(dir, providerRef);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      const text = await readFile(path, 'utf8');
      const file = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(file).sort()).toEqual(['alg', 'ct', 'iv', 'kid', 'tag', 'v']);
      expect(file).toMatchObject({ v: 1, kid: 'k1', alg: 'Ed25519' });
      expect(fromBase64Url(file.iv as string).length).toBe(12);
      expect(fromBase64Url(file.tag as string).length).toBe(16);
      expect(fromBase64Url(file.ct as string).length).toBe(32);
      // The public key is not stored, and nothing in the directory but the key file remains (temp file removed).
      expect(text).not.toContain(toBase64Url(publicKey));
      expect(await readdir(dir)).toEqual(['k1.key.json']);
    });

    it('uses a fresh random IV per key file', async () => {
      const p = await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      const ivs = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const { providerRef } = await p.generate(`k${i}`);
        ivs.add(JSON.parse(await readFile(join(dir, providerRef), 'utf8')).iv);
      }
      expect(ivs.size).toBe(8);
    });

    it('never overwrites an existing key', async () => {
      const p = await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      const first = await p.generate('dup');
      const before = await readFile(join(dir, first.providerRef), 'utf8');
      await expectProviderError(p.generate('dup'), 'KEY_EXISTS');
      expect(await readFile(join(dir, first.providerRef), 'utf8')).toBe(before);
      expect(await readdir(dir)).toEqual(['dup.key.json']);
    });

    it('validates kids and references (no path traversal)', async () => {
      const p = await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      for (const kid of ['', '../evil', 'a/b', '.hidden', 'x'.repeat(65), 'a..b', 'sp ace']) {
        await expectProviderError(p.generate(kid), 'INVALID_INPUT');
      }
      for (const ref of ['../k.key.json', '/etc/passwd', 'k1', 'k1.key.json/..', '..key.json']) {
        await expectProviderError(p.sign(ref, MSG), 'INVALID_INPUT');
      }
      await expectProviderError(p.sign('missing.key.json', MSG), 'KEY_NOT_FOUND');
      await expectProviderError(p.sign('k.key.json', 'text' as unknown as Uint8Array), 'INVALID_INPUT');
    });
  });

  describe('tamper resistance', () => {
    let p: LocalKeyProvider;
    let ref: string;
    let path: string;
    let file: Record<string, unknown>;

    beforeEach(async () => {
      p = await LocalKeyProvider.open({ dir, encryptionKey: KEK });
      ref = (await p.generate('victim')).providerRef;
      path = join(dir, ref);
      file = JSON.parse(await readFile(path, 'utf8'));
    });

    async function rewrite(next: Record<string, unknown> | string) {
      await writeFile(path, typeof next === 'string' ? next : JSON.stringify(next), { mode: 0o600 });
      await chmod(path, 0o600);
    }

    function flip(b64: string, index = 0): string {
      const bytes = fromBase64Url(b64);
      bytes[index] ^= 0x01;
      return toBase64Url(bytes);
    }

    it.each(['ct', 'iv', 'tag'] as const)('refuses a key file whose %s was modified', async (field) => {
      await rewrite({ ...file, [field]: flip(file[field] as string, 3) });
      const e = await expectProviderError(p.sign(ref, MSG), 'KEY_INTEGRITY');
      expect(e.message).toMatch(/integrity check failed/);
    });

    it('refuses the file under the wrong encryption key', async () => {
      const wrong = new LocalKeyProvider({ dir, encryptionKey: OTHER_KEK });
      await expectProviderError(wrong.sign(ref, MSG), 'KEY_INTEGRITY');
    });

    it('binds the ciphertext to its kid: a file renamed or relabelled to another kid is refused', async () => {
      // Renamed file, kid field left alone → the kid no longer matches the reference.
      await rename(path, join(dir, 'other.key.json'));
      await expectProviderError(p.sign('other.key.json', MSG), 'KEY_INTEGRITY');
      // Kid field rewritten as well → the AAD check fails.
      await writeFile(join(dir, 'other.key.json'), JSON.stringify({ ...file, kid: 'other' }), { mode: 0o600 });
      await expectProviderError(p.sign('other.key.json', MSG), 'KEY_INTEGRITY');
    });

    it('refuses malformed files', async () => {
      for (const bad of [
        'not json',
        JSON.stringify({ ...file, v: 2 }),
        JSON.stringify({ ...file, alg: 'RSA' }),
        JSON.stringify({ ...file, extra: true }),
        JSON.stringify({ ...file, ct: toBase64Url(randomBytes(48)) }),
        JSON.stringify({ ...file, iv: 'a+b/' }),
        'x'.repeat(5000),
      ]) {
        await rewrite(bad);
        await expectProviderError(p.sign(ref, MSG), 'KEY_INTEGRITY');
      }
    });

    it('refuses a group/world readable key file and a symlinked one', async () => {
      await chmod(path, 0o644);
      const e = await expectProviderError(p.sign(ref, MSG), 'KEY_INTEGRITY');
      expect(e.message).toMatch(/0600/);
      await chmod(path, 0o600);
      expect((await p.sign(ref, MSG)).length).toBe(64);

      await symlink(path, join(dir, 'link.key.json'));
      await expectProviderError(p.sign('link.key.json', MSG), 'KEY_INTEGRITY');
    });

    it('never puts key material in error messages', async () => {
      await rewrite({ ...file, tag: flip(file.tag as string) });
      const e = await expectProviderError(p.sign(ref, MSG), 'KEY_INTEGRITY');
      for (const secret of [KEK, file.ct as string, file.iv as string]) expect(e.message).not.toContain(secret);
    });
  });
});
