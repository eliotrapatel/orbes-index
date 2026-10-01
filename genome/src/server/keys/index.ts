/**
 * Key management entry point: providers, the KeyService and a factory that
 * builds the configured provider (contract §0 `keys`, §2.2).
 */
import type { AppConfig } from '../config.js';
import type { Logger } from '../types.js';
import { KeyProviderError, type KeyProvider } from './key-provider.js';
import { LocalKeyProvider } from './local-provider.js';
import { MemoryKeyProvider } from './memory-provider.js';

export { KeyProviderError, KID_RE, isValidKid, type KeyProvider, type KeyProviderErrorCode } from './key-provider.js';
export { LocalKeyProvider, LOCAL_KEY_FILE_VERSION, type LocalKeyProviderOptions } from './local-provider.js';
export { MemoryKeyProvider, type MemoryKeyProviderOptions } from './memory-provider.js';
export {
  KeyService,
  KEY_ID_MAX,
  KEY_ID_MIN,
  actorLabel,
  isKeyTrustedAt,
  isStrictEd25519PublicKey,
  type ActiveSigner,
  type KeyRecord,
  type KeyServiceDeps,
  type PublicKeyInfo,
  type RevokeKeyInput,
} from './key-service.js';

/**
 * Build the provider named by `config.keys` and make sure it is usable
 * (local: directory prepared, encryption key valid). The memory provider is
 * refused in production here as well as in loadConfig().
 */
export async function createKeyProvider(config: Pick<AppConfig, 'env' | 'keys'>, log?: Logger): Promise<KeyProvider> {
  switch (config.keys.provider) {
    case 'memory':
      if (config.env === 'production') throw new KeyProviderError('CONFIG', 'the memory key provider is refused in production');
      return new MemoryKeyProvider({ env: config.env });
    case 'local':
      if (!config.keys.dir) throw new KeyProviderError('CONFIG', 'KEY_DIR is required for the local key provider');
      return LocalKeyProvider.open({ dir: config.keys.dir, encryptionKey: config.keys.encryptionKey, ...(log ? { log } : {}) });
    default: {
      const unknown: never = config.keys.provider;
      throw new KeyProviderError('CONFIG', `unknown key provider ${String(unknown)}`);
    }
  }
}
