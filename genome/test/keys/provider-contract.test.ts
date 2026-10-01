/**
 * Every KeyProvider shipped runs the shared contract (provider-contract.ts).
 * A KMS/HSM provider joins this list when it is implemented.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalKeyProvider, MemoryKeyProvider } from '../../src/server/keys/index.js';
import { describeKeyProviderContract } from './provider-contract.js';

describeKeyProviderContract('memory', async () => ({ provider: new MemoryKeyProvider({ env: 'test' }), unknownRef: 'memory:nobody' }));

describeKeyProviderContract('local', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbes-contract-'));
  const provider = await LocalKeyProvider.open({ dir: join(root, 'keys'), encryptionKey: Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff) });
  return { provider, unknownRef: 'nobody.key.json', close: () => rm(root, { recursive: true, force: true }) };
});
