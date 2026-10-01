/**
 * LocalKeyProvider — Ed25519 seeds encrypted at rest, one file per key.
 *
 * File `<dir>/<kid>.key.json` (mode 0600, directory 0700):
 *
 *   {"v":1,"kid":"…","alg":"Ed25519","iv":"…","ct":"…","tag":"…"}   (base64url, no padding)
 *
 * `ct` is the 32-byte RFC 8032 seed under AES-256-GCM with the configured
 * 32-byte KEY_ENCRYPTION_KEY, a fresh random 96-bit IV per file and the kid as
 * additional authenticated data. GCM authenticates everything that matters:
 * a modified ciphertext, IV or tag, a file renamed to another kid, or the
 * wrong encryption key all fail the tag check and the key is refused
 * (KEY_INTEGRITY) instead of signing with garbage.
 *
 * Files are written atomically and never overwritten (temp file + link(2),
 * which fails if the target exists). A file that is group/world accessible is
 * refused, like ssh does for private keys.
 *
 * Seeds are decrypted per signature and zeroed right after use; the
 * encryption key is held as an OpenSSL KeyObject, not a JS buffer. Nothing
 * here logs or returns key material.
 *
 * Suitable for development and small single-host deployments with an
 * encrypted disk; larger deployments should use a KMS/HSM provider.
 */
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes, type KeyObject } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, mkdir, open, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { fromBase64Url, toBase64Url } from '../../core/bytes.js';
import { publicKeyFromSeed, signEd25519 } from '../crypto/ed25519-node.js';
import { noopLogger, type Logger } from '../types.js';
import { assertKid, assertMessage, isValidKid, KeyProviderError, type KeyProvider } from './key-provider.js';

export const LOCAL_KEY_FILE_VERSION = 1;
const FILE_SUFFIX = '.key.json';
const ENCRYPTION_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SEED_BYTES = 32;
// A key file is ~200 bytes; anything much larger is not ours.
const MAX_FILE_BYTES = 4096;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface LocalKeyProviderOptions {
  /** Absolute directory holding the key files (created 0700 if missing). */
  dir: string;
  /** base64url (no padding) of exactly 32 bytes, or the raw bytes (copied, caller may wipe). */
  encryptionKey: string | Uint8Array | undefined;
  /** Receives non-secret operational warnings (e.g. permissions tightened). */
  log?: Logger;
}

const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/);
const keyFileSchema = z.strictObject({
  v: z.literal(LOCAL_KEY_FILE_VERSION),
  kid: z.string(),
  alg: z.literal('Ed25519'),
  iv: b64,
  ct: b64,
  tag: b64,
});

/** AES-256-GCM additional data: the kid binds each ciphertext to its label (and file name). */
const aad = (kid: string): Buffer => Buffer.from(kid, 'utf8');

export class LocalKeyProvider implements KeyProvider {
  readonly name = 'local';
  private readonly dir: string;
  private readonly kek: KeyObject;
  private readonly log: Logger;
  private ready: Promise<void> | undefined;

  /** Throws KeyProviderError('CONFIG') without an absolute dir and a 32-byte encryption key. */
  constructor(opts: LocalKeyProviderOptions) {
    if (typeof opts?.dir !== 'string' || !isAbsolute(opts.dir)) {
      throw new KeyProviderError('CONFIG', 'LocalKeyProvider needs an absolute key directory');
    }
    this.dir = opts.dir;
    this.log = opts.log ?? noopLogger;
    const raw = decodeEncryptionKey(opts.encryptionKey);
    try {
      this.kek = createSecretKey(raw);
    } finally {
      raw.fill(0);
    }
  }

  /** Construct and prepare the directory, so misconfiguration fails at startup rather than at first issuance. */
  static async open(opts: LocalKeyProviderOptions): Promise<LocalKeyProvider> {
    const provider = new LocalKeyProvider(opts);
    await provider.init();
    return provider;
  }

  /** Ensure the key directory exists with mode 0700. Idempotent. */
  init(): Promise<void> {
    this.ready ??= this.prepareDir().catch((e: unknown) => {
      this.ready = undefined; // let a later call retry (e.g. a volume mounted late)
      throw e;
    });
    return this.ready;
  }

  async generate(kid: string): Promise<{ publicKey: Uint8Array; providerRef: string }> {
    assertKid(kid);
    await this.init();
    const providerRef = kid + FILE_SUFFIX;
    const target = join(this.dir, providerRef);

    const seed = randomBytes(SEED_BYTES);
    let publicKey: Uint8Array;
    let body: string;
    try {
      publicKey = publicKeyFromSeed(seed);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', this.kek, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(kid));
      const ct = Buffer.concat([cipher.update(seed), cipher.final()]);
      body = JSON.stringify({
        v: LOCAL_KEY_FILE_VERSION,
        kid,
        alg: 'Ed25519',
        iv: toBase64Url(iv),
        ct: toBase64Url(ct),
        tag: toBase64Url(cipher.getAuthTag()),
      });
    } finally {
      seed.fill(0);
    }

    await this.writeNew(target, body + '\n', kid);
    return { publicKey, providerRef };
  }

  async sign(providerRef: string, message: Uint8Array): Promise<Uint8Array> {
    assertMessage(message);
    const kid = kidFromRef(providerRef);
    await this.init();
    const seed = await this.loadSeed(kid, join(this.dir, providerRef));
    try {
      return signEd25519(seed, message);
    } finally {
      seed.fill(0);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async prepareDir(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true, mode: DIR_MODE });
      // stat, not lstat: an operator may point KEY_DIR at a mounted volume through a symlink.
      const st = await stat(this.dir);
      if (!st.isDirectory()) throw new KeyProviderError('CONFIG', 'key directory path is not a directory');
      if ((st.mode & 0o077) !== 0) {
        // mkdir's mode is filtered by the umask and ignored for existing directories.
        await chmod(this.dir, DIR_MODE);
        this.log.warn({ keyDir: this.dir }, 'key directory permissions tightened to 0700');
      }
    } catch (e) {
      if (e instanceof KeyProviderError) throw e;
      throw new KeyProviderError('CONFIG', `key directory unusable: ${(e as NodeJS.ErrnoException).code ?? 'error'}`, { cause: e });
    }
  }

  /** Write `body` to `target` atomically; never replaces an existing file. */
  private async writeNew(target: string, body: string, kid: string): Promise<void> {
    const tmp = join(this.dir, `.${kid}.${randomBytes(6).toString('hex')}.tmp`);
    const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE).catch(
      (e: unknown) => {
        throw new KeyProviderError('UNAVAILABLE', `cannot create key file for ${kid}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`, { cause: e });
      },
    );
    try {
      try {
        await fh.writeFile(body, 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      try {
        await link(tmp, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new KeyProviderError('KEY_EXISTS', `key ${kid} already exists`);
        throw new KeyProviderError('UNAVAILABLE', `cannot store key ${kid}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`, { cause: e });
      }
    } finally {
      await unlink(tmp).catch(() => {});
    }
    await this.syncDir();
  }

  /** Persist the directory entry (the new link) across a crash. Best effort. */
  private async syncDir(): Promise<void> {
    try {
      const dh = await open(this.dir, constants.O_RDONLY);
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
    } catch {
      // Some filesystems refuse fsync on directories; the file itself is already synced.
    }
  }

  private async loadSeed(kid: string, path: string): Promise<Buffer> {
    let text: string;
    try {
      const fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const st = await fh.stat();
        if (!st.isFile()) throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: not a regular file`);
        if ((st.mode & 0o077) !== 0) {
          throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: file is group/world accessible (expected 0600), refusing to use it`);
        }
        if (st.size > MAX_FILE_BYTES) throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: file too large`);
        text = await fh.readFile('utf8');
      } finally {
        await fh.close();
      }
    } catch (e) {
      if (e instanceof KeyProviderError) throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new KeyProviderError('KEY_NOT_FOUND', `key ${kid}: file not found`);
      if (code === 'ELOOP') throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: refusing to follow a symlink`);
      throw new KeyProviderError('UNAVAILABLE', `key ${kid}: cannot read file: ${code ?? 'error'}`, { cause: e });
    }

    let file: z.infer<typeof keyFileSchema>;
    let iv: Uint8Array;
    let ct: Uint8Array;
    let tag: Uint8Array;
    try {
      file = keyFileSchema.parse(JSON.parse(text));
      iv = fromBase64Url(file.iv);
      ct = fromBase64Url(file.ct);
      tag = fromBase64Url(file.tag);
    } catch {
      throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: malformed key file`);
    }
    if (file.kid !== kid) throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: file belongs to a different kid`);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length !== SEED_BYTES) {
      throw new KeyProviderError('KEY_INTEGRITY', `key ${kid}: malformed key file`);
    }

    const decipher = createDecipheriv('aes-256-gcm', this.kek, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(kid));
    decipher.setAuthTag(tag);
    const head = decipher.update(ct);
    try {
      const tail = decipher.final(); // throws when the tag does not authenticate
      const seed = Buffer.concat([head, tail]);
      tail.fill(0);
      return seed;
    } catch {
      throw new KeyProviderError(
        'KEY_INTEGRITY',
        `key ${kid}: integrity check failed (tampered or corrupted file, or wrong KEY_ENCRYPTION_KEY)`,
      );
    } finally {
      head.fill(0);
    }
  }
}

function decodeEncryptionKey(key: string | Uint8Array | undefined): Buffer {
  let bytes: Uint8Array;
  if (typeof key === 'string') {
    try {
      bytes = fromBase64Url(key.trim());
    } catch {
      throw new KeyProviderError('CONFIG', 'KEY_ENCRYPTION_KEY must be base64url (no padding) of exactly 32 bytes');
    }
  } else if (key instanceof Uint8Array) {
    bytes = key;
  } else {
    throw new KeyProviderError('CONFIG', 'LocalKeyProvider refuses to start without KEY_ENCRYPTION_KEY (32 bytes, base64url)');
  }
  if (bytes.length !== ENCRYPTION_KEY_BYTES) {
    throw new KeyProviderError('CONFIG', 'KEY_ENCRYPTION_KEY must be exactly 32 bytes');
  }
  const copy = Buffer.from(bytes);
  if (typeof key === 'string') bytes.fill(0);
  if (copy.every((b) => b === copy[0])) {
    copy.fill(0);
    throw new KeyProviderError('CONFIG', 'KEY_ENCRYPTION_KEY is degenerate (all bytes identical)');
  }
  return copy;
}

/** `<kid>.key.json` → kid. Rejects anything that could escape the key directory. */
function kidFromRef(providerRef: unknown): string {
  if (typeof providerRef !== 'string' || !providerRef.endsWith(FILE_SUFFIX)) {
    throw new KeyProviderError('INVALID_INPUT', 'invalid local key reference');
  }
  const kid = providerRef.slice(0, -FILE_SUFFIX.length);
  if (!isValidKid(kid)) throw new KeyProviderError('INVALID_INPUT', 'invalid local key reference');
  return kid;
}
