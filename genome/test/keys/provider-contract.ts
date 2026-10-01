/**
 * The KeyProvider contract (PLATFORM-CONTRACTS §2.2, CRYPTOGRAPHY §5.4) as a
 * reusable suite. Every provider runs it: the memory and local providers
 * today (provider-contract.test.ts), and a KMS/HSM provider when one is
 * written — `describeKeyProviderContract('aws-kms', () => …)` against the
 * vendor's test account is the acceptance gate CRYPTOGRAPHY §5.4 refers to.
 *
 * What it checks, through the interface only:
 *  - generate() returns a strict 32-byte Ed25519 public key and an opaque
 *    reference; distinct kids give distinct keys; a kid is never reused;
 *  - sign() returns 64-byte pure Ed25519 (RFC 8032) signatures that verify
 *    under the returned public key (and only under it), deterministically;
 *  - unknown references, invalid kids and non-byte messages are refused with
 *    the documented KeyProviderError codes, and no error message carries a
 *    signature or key bytes.
 */
import { describe, expect, it } from 'vitest';
import { toBase64Url, utf8 } from '../../src/core/bytes.js';
import { verifyEd25519Node } from '../../src/server/crypto/ed25519-node.js';
import { isStrictEd25519PublicKey, KeyProviderError, type KeyProvider } from '../../src/server/keys/index.js';

export interface ContractSubject {
  provider: KeyProvider;
  /** A reference in the provider's own format that names no key. */
  unknownRef: string;
  close?: () => Promise<void>;
}

export function describeKeyProviderContract(name: string, open: () => Promise<ContractSubject>): void {
  describe(`KeyProvider contract: ${name}`, () => {
    const withProvider = async (fn: (s: ContractSubject) => Promise<void>) => {
      const s = await open();
      try {
        await fn(s);
      } finally {
        await s.close?.();
      }
    };

    it('generates strict Ed25519 keys behind opaque references; distinct kids, distinct keys', () =>
      withProvider(async ({ provider }) => {
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);
        const a = await provider.generate('contract-a');
        const b = await provider.generate('contract-b');
        for (const k of [a, b]) {
          expect(k.publicKey).toBeInstanceOf(Uint8Array);
          expect(k.publicKey.length).toBe(32);
          expect(isStrictEd25519PublicKey(k.publicKey)).toBe(true);
          expect(typeof k.providerRef).toBe('string');
          expect(k.providerRef.length).toBeGreaterThan(0);
        }
        expect(a.providerRef).not.toBe(b.providerRef);
        expect(a.publicKey).not.toEqual(b.publicKey);
      }));

    it('signs pure Ed25519 (RFC 8032): 64 bytes, deterministic, valid only under its own key', () =>
      withProvider(async ({ provider }) => {
        const a = await provider.generate('contract-sign-a');
        const b = await provider.generate('contract-sign-b');
        for (const msg of [new Uint8Array(0), utf8('ORBES-CODE/v1\0payload'), Uint8Array.from({ length: 1024 }, (_, i) => i & 0xff)]) {
          const sig = await provider.sign(a.providerRef, msg);
          expect(sig).toBeInstanceOf(Uint8Array);
          expect(sig.length).toBe(64);
          expect(verifyEd25519Node(a.publicKey, msg, sig)).toBe(true);
          expect(verifyEd25519Node(b.publicKey, msg, sig)).toBe(false);
          expect(await provider.sign(a.providerRef, msg)).toEqual(sig);
        }
      }));

    it('never reuses a kid and refuses unknown references and invalid input', () =>
      withProvider(async ({ provider, unknownRef }) => {
        const a = await provider.generate('contract-dup');
        await expect(provider.generate('contract-dup')).rejects.toMatchObject({ code: 'KEY_EXISTS' });
        expect(await provider.sign(a.providerRef, utf8('still the first key'))).toHaveLength(64);
        await expect(provider.sign(unknownRef, utf8('x'))).rejects.toMatchObject({ code: 'KEY_NOT_FOUND' });
        for (const kid of ['', '../x', 'a/b', 'x'.repeat(65), '.hidden']) {
          await expect(provider.generate(kid), JSON.stringify(kid)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        }
        await expect(provider.sign(a.providerRef, 'text' as unknown as Uint8Array)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      }));

    it('fails with KeyProviderError messages that carry no key or signature bytes', () =>
      withProvider(async ({ provider, unknownRef }) => {
        const a = await provider.generate('contract-leak');
        const sig = await provider.sign(a.providerRef, utf8('m'));
        const errors: unknown[] = [];
        await provider.sign(unknownRef, utf8('m')).catch((e: unknown) => errors.push(e));
        await provider.generate('contract-leak').catch((e: unknown) => errors.push(e));
        expect(errors).toHaveLength(2);
        for (const e of errors) {
          expect(e).toBeInstanceOf(KeyProviderError);
          const text = `${(e as Error).message} ${String((e as Error).stack)}`;
          expect(text).not.toContain(toBase64Url(a.publicKey));
          expect(text).not.toContain(toBase64Url(sig));
          expect(text).not.toContain(Buffer.from(a.publicKey).toString('hex'));
        }
      }));
  });
}
