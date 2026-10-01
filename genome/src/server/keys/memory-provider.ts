/**
 * MemoryKeyProvider — Ed25519 seeds held in process memory.
 *
 * For development, tests and the demo only: keys vanish on restart, so every
 * code issued with them becomes unverifiable once the database outlives the
 * process. It refuses to construct in production (config.ts refuses the
 * setting too; this is the second line of defence).
 */
import { generateEd25519KeyPair, signEd25519 } from '../crypto/ed25519-node.js';
import { assertKid, assertMessage, KeyProviderError, type KeyProvider } from './key-provider.js';

const REF_PREFIX = 'memory:';

export interface MemoryKeyProviderOptions {
  /** Runtime environment; 'production' is refused. Defaults to ORBES_ENV, else NODE_ENV=production. */
  env?: string;
}

export class MemoryKeyProvider implements KeyProvider {
  readonly name = 'memory';
  private readonly seeds = new Map<string, Uint8Array>();

  constructor(opts: MemoryKeyProviderOptions = {}) {
    // Same fallback as loadConfig(): NODE_ENV=production without ORBES_ENV means production.
    const env = opts.env ?? process.env.ORBES_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : undefined);
    if (env === 'production') {
      throw new KeyProviderError('CONFIG', 'MemoryKeyProvider is refused in production');
    }
  }

  async generate(kid: string): Promise<{ publicKey: Uint8Array; providerRef: string }> {
    assertKid(kid);
    const providerRef = REF_PREFIX + kid;
    if (this.seeds.has(providerRef)) throw new KeyProviderError('KEY_EXISTS', `key ${kid} already exists`);
    const { privateKey, publicKey } = generateEd25519KeyPair();
    this.seeds.set(providerRef, privateKey);
    return { publicKey, providerRef };
  }

  async sign(providerRef: string, message: Uint8Array): Promise<Uint8Array> {
    assertMessage(message);
    const seed = typeof providerRef === 'string' ? this.seeds.get(providerRef) : undefined;
    if (!seed) throw new KeyProviderError('KEY_NOT_FOUND', 'unknown key reference');
    return signEd25519(seed, message);
  }

  /** Zero and forget every seed (test teardown). */
  wipe(): void {
    for (const seed of this.seeds.values()) seed.fill(0);
    this.seeds.clear();
  }
}
