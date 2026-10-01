import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { fromBase64Url, toBase64Url, utf8 } from '../../src/core/bytes.js';
import { verifyEd25519Node } from '../../src/server/crypto/ed25519-node.js';
import { isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { DomainError } from '../../src/server/errors.js';
import {
  isKeyTrustedAt,
  isStrictEd25519PublicKey,
  KeyProviderError,
  KeyService,
  LocalKeyProvider,
  MemoryKeyProvider,
  type KeyProvider,
} from '../../src/server/keys/index.js';
import { AuditService } from '../../src/server/services/audit.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const admin: Actor = { type: 'admin', id: 'admin-1' };
const MSG = utf8('ORBES-CODE/v1\u0000payload');

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

interface Fixture {
  t: TestDb;
  clock: ManualClock;
  audit: AuditService;
  provider: MemoryKeyProvider;
  keys: KeyService;
}

async function fixture(): Promise<Fixture> {
  const t = await createTestDb();
  const clock = createManualClock('2026-03-01T10:00:00.000Z');
  const audit = new AuditService({ db: t.db, clock: clock.now });
  const provider = new MemoryKeyProvider({ env: 'test' });
  const keys = new KeyService({ db: t.db, provider, audit, clock: clock.now });
  return { t, clock, audit, provider, keys };
}

describe('KeyService', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });
  afterEach(async () => {
    await f.t.close();
  });

  describe('rotation', () => {
    it('creates key 1 as ACTIVE with a strict public key and an audit entry', async () => {
      const k = await f.keys.rotate(admin);
      expect(k).toMatchObject({ keyId: 1, status: 'ACTIVE', algorithm: 'Ed25519', provider: 'memory', retiredAt: null, revokedAt: null });
      expect(k.kid).toMatch(/^orbes-k001-20260301-[0-9a-f]{4}$/);
      expect(k.activatedAt?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
      expect(isStrictEd25519PublicKey(k.publicKey)).toBe(true);

      const row = await f.t.db.selectFrom('cryptographic_keys').selectAll().executeTakeFirstOrThrow();
      expect(row.public_key).toEqual(k.publicKey);
      expect(row.provider_ref).toBe(`memory:${k.kid}`);

      const audit = await f.audit.list({ action: 'key.rotate' });
      expect(audit.total).toBe(1);
      expect(audit.items[0].details).toMatchObject({ keyId: 1, kid: k.kid, publicKey: toBase64Url(k.publicKey), retiredKeyIds: [] });
      expect((await f.audit.verifyChain()).ok).toBe(true);
    });

    it('keeps old codes verifiable: sign with key 1, rotate, key 2 ACTIVE, key 1 RETIRED still verifies', async () => {
      await f.keys.rotate(admin);
      const signer1 = await f.keys.activeSigner();
      expect(signer1.keyId).toBe(1);
      const sig1 = await signer1.sign(MSG);

      f.clock.advance(86_400_000);
      const k2 = await f.keys.rotate(admin, 'orbes-second');
      expect(k2).toMatchObject({ keyId: 2, kid: 'orbes-second', status: 'ACTIVE' });

      const k1 = await f.keys.publicKey(1);
      expect(k1).toMatchObject({ status: 'RETIRED' });
      expect(k1?.retiredAt?.toISOString()).toBe('2026-03-02T10:00:00.000Z');
      expect(verifyEd25519Node(k1!.publicKey, MSG, sig1)).toBe(true);
      expect(isKeyTrustedAt(k1!, new Date('2026-03-01T12:00:00Z'))).toBe(true);
      expect(isKeyTrustedAt(k1!, new Date('2030-01-01T00:00:00Z'))).toBe(true); // retired ≠ revoked

      const signer2 = await f.keys.activeSigner();
      expect(signer2.keyId).toBe(2);
      const sig2 = await signer2.sign(MSG);
      expect(verifyEd25519Node(k2.publicKey, MSG, sig2)).toBe(true);
      expect(verifyEd25519Node(k1!.publicKey, MSG, sig2)).toBe(false);

      // The handed-out signer for key 1 still signs (its key still exists), but issuance re-checks ACTIVE.
      expect((await f.keys.listPublic()).map((k) => [k.keyId, k.status])).toEqual([
        [1, 'RETIRED'],
        [2, 'ACTIVE'],
      ]);
      const rot = await f.audit.list({ action: 'key.rotate' });
      expect(rot.items[0].details).toMatchObject({ keyId: 2, retiredKeyIds: [1] });
    });

    it('allows only one ACTIVE key (database constraint)', async () => {
      const k1 = await f.keys.rotate(admin);
      const pk = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
      const insert = f.t.db
        .insertInto('cryptographic_keys')
        .values({ key_id: 9, kid: 'rogue', public_key: pk, status: 'ACTIVE', provider: 'memory', provider_ref: 'memory:rogue' })
        .execute();
      const e = await insert.then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(isUniqueViolation(e)).toBe(true);

      await f.t.db
        .insertInto('cryptographic_keys')
        .values({ key_id: 9, kid: 'rogue', public_key: pk, status: 'RETIRED', provider: 'memory', provider_ref: 'memory:rogue' })
        .execute();
      const promote = await f.t.db
        .updateTable('cryptographic_keys')
        .set({ status: 'ACTIVE' })
        .where('key_id', '=', 9)
        .execute()
        .then(
          () => undefined,
          (err: unknown) => err,
        );
      expect(isUniqueViolation(promote)).toBe(true);
      expect((await f.keys.list()).filter((k) => k.status === 'ACTIVE').map((k) => k.keyId)).toEqual([k1.keyId]);
    });

    it('allocates the lowest unused key id and never reuses a retired or revoked id', async () => {
      // Ids 1, 2 and 4 exist (retired / revoked keys stay in the registry forever).
      for (const [id, status] of [
        [1, 'RETIRED'],
        [2, 'REVOKED'],
        [4, 'RETIRED'],
      ] as const) {
        await f.t.db
          .insertInto('cryptographic_keys')
          .values({
            key_id: id,
            kid: `seed-${id}`,
            public_key: ed25519.getPublicKey(ed25519.utils.randomSecretKey()),
            status,
            provider: 'memory',
            provider_ref: `memory:seed-${id}`,
            revoked_at: status === 'REVOKED' ? new Date('2026-01-01T00:00:00Z') : null,
          })
          .execute();
      }
      expect((await f.keys.rotate(admin)).keyId).toBe(3);
      expect((await f.keys.rotate(admin)).keyId).toBe(5);
      await f.keys.revoke(5, { reason: 'test' }, admin);
      expect((await f.keys.rotate(admin)).keyId).toBe(6);
    });

    it('reports exhaustion of the 255 key ids', async () => {
      const rows = Array.from({ length: 255 }, (_, i) => ({
        key_id: i + 1,
        kid: `k${i + 1}`,
        public_key: ed25519.getPublicKey(ed25519.utils.randomSecretKey()),
        status: 'RETIRED' as const,
        provider: 'memory',
        provider_ref: `memory:k${i + 1}`,
      }));
      await f.t.db.insertInto('cryptographic_keys').values(rows).execute();
      const e = await domainError(f.keys.rotate(admin));
      expect(e.code).toBe('KEY_IDS_EXHAUSTED');
    });

    it('validates and de-duplicates key labels', async () => {
      expect((await domainError(f.keys.rotate(admin, '../etc'))).code).toBe('VALIDATION_FAILED');
      await f.keys.rotate(admin, 'label-a');
      expect((await domainError(f.keys.rotate(admin, 'label-a'))).code).toBe('KID_TAKEN');
      // The failed attempts changed nothing.
      expect((await f.keys.list()).map((k) => [k.keyId, k.status])).toEqual([[1, 'ACTIVE']]);
    });

    it('ensureActiveKey creates a key only when none is active', async () => {
      const a = await f.keys.ensureActiveKey(admin);
      const b = await f.keys.ensureActiveKey(admin);
      expect(b.keyId).toBe(a.keyId);
      expect(await f.keys.list()).toHaveLength(1);
      await f.keys.retire(a.keyId, admin);
      expect((await f.keys.ensureActiveKey(admin)).keyId).toBe(2);
    });
  });

  describe('retire and revoke', () => {
    it('retire: only the ACTIVE key; afterwards signing stops until the next rotation', async () => {
      await f.keys.rotate(admin);
      await f.keys.retire(1, admin);
      expect((await f.keys.publicKey(1))?.status).toBe('RETIRED');
      const e = await domainError(f.keys.activeSigner());
      expect(e.code).toBe('NO_ACTIVE_KEY');
      expect(e.httpStatus).toBe(503);
      expect(e.publicMessage).not.toMatch(/key/i); // no internals in public messages
      expect((await domainError(f.keys.retire(1, admin))).code).toBe('KEY_NOT_ACTIVE');
      expect((await domainError(f.keys.retire(77, admin))).code).toBe('KEY_NOT_FOUND');
      expect((await domainError(f.keys.retire(0, admin))).code).toBe('VALIDATION_FAILED');
      expect((await f.audit.list({ action: 'key.retire' })).total).toBe(1);
      await f.keys.rotate(admin);
      expect((await f.keys.activeSigner()).keyId).toBe(2);
    });

    it('revoke records revoked_at, compromised_at, the reason, a revocations row and an audit entry', async () => {
      await f.keys.rotate(admin);
      f.clock.advance(10 * 86_400_000); // 2026-03-11T10:00Z
      const compromisedAt = new Date('2026-03-05T00:00:00.000Z');
      await f.keys.revoke(1, { compromisedAt, reason: '  HSM export detected  ' }, admin);

      const k = await f.keys.publicKey(1);
      expect(k).toMatchObject({ status: 'REVOKED', revocationReason: 'HSM export detected' });
      expect(k?.revokedAt?.toISOString()).toBe('2026-03-11T10:00:00.000Z');
      expect(k?.compromisedAt?.toISOString()).toBe('2026-03-05T00:00:00.000Z');

      // Codes recorded before the compromise stay trusted; later ones do not.
      expect(isKeyTrustedAt(k!, new Date('2026-03-04T23:59:59.999Z'))).toBe(true);
      expect(isKeyTrustedAt(k!, compromisedAt)).toBe(false);
      expect(isKeyTrustedAt(k!, new Date('2026-03-08T00:00:00Z'))).toBe(false);

      const rev = await f.t.db.selectFrom('revocations').selectAll().execute();
      expect(rev).toHaveLength(1);
      expect(rev[0]).toMatchObject({ target_type: 'KEY', target_id: '1', reason_code: 'KEY_COMPROMISED', created_by: 'admin:admin-1' });
      const audit = await f.audit.list({ action: 'key.revoke' });
      expect(audit.items[0].details).toMatchObject({ keyId: 1, previousStatus: 'ACTIVE', compromisedAt: '2026-03-05T00:00:00.000Z' });

      // The public list shows the revocation (status + time) but not the internal reason.
      const pub = (await f.keys.listPublic())[0];
      expect(pub).toMatchObject({ keyId: 1, status: 'REVOKED', revokedAt: '2026-03-11T10:00:00.000Z' });
      expect(Object.keys(pub).sort()).toEqual(['activatedAt', 'alg', 'keyId', 'kid', 'publicKey', 'retiredAt', 'revokedAt', 'status']);
      expect((await domainError(f.keys.activeSigner())).code).toBe('NO_ACTIVE_KEY');
    });

    it('without compromisedAt, trust ends at the revocation time', async () => {
      await f.keys.rotate(admin);
      await f.keys.rotate(admin); // key 1 RETIRED, key 2 ACTIVE
      f.clock.set('2026-04-01T00:00:00.000Z');
      await f.keys.revoke(1, { reason: 'routine' }, admin);
      const k = await f.keys.publicKey(1);
      expect(k?.compromisedAt).toBeNull();
      expect(isKeyTrustedAt(k!, new Date('2026-03-31T23:59:59Z'))).toBe(true);
      expect(isKeyTrustedAt(k!, new Date('2026-04-01T00:00:00Z'))).toBe(false);
      expect((await f.t.db.selectFrom('revocations').select('reason_code').executeTakeFirstOrThrow()).reason_code).toBe('KEY_REVOKED');
      // Revoking a retired key leaves the active one alone.
      expect((await f.keys.activeSigner()).keyId).toBe(2);
    });

    it('a second revocation may only move the compromise time earlier', async () => {
      await f.keys.rotate(admin);
      f.clock.set('2026-04-01T00:00:00.000Z');
      await f.keys.revoke(1, { compromisedAt: new Date('2026-03-20T00:00:00Z'), reason: 'first finding' }, admin);
      expect((await domainError(f.keys.revoke(1, { reason: 'again' }, admin))).code).toBe('KEY_ALREADY_REVOKED');
      expect((await domainError(f.keys.revoke(1, { compromisedAt: new Date('2026-03-25T00:00:00Z'), reason: 'later' }, admin))).code).toBe(
        'KEY_ALREADY_REVOKED',
      );
      await f.keys.revoke(1, { compromisedAt: new Date('2026-03-10T00:00:00Z'), reason: 'forensics: earlier' }, admin);
      const k = await f.keys.publicKey(1);
      expect(k?.compromisedAt?.toISOString()).toBe('2026-03-10T00:00:00.000Z');
      expect(k?.revokedAt?.toISOString()).toBe('2026-04-01T00:00:00.000Z'); // unchanged
      expect((await f.audit.list({ action: 'key.revoke.amend' })).total).toBe(1);
    });

    it('validates revocation input', async () => {
      await f.keys.rotate(admin);
      expect((await domainError(f.keys.revoke(1, { reason: ' ' }, admin))).code).toBe('VALIDATION_FAILED');
      expect((await domainError(f.keys.revoke(1, { reason: 'x'.repeat(501) }, admin))).code).toBe('VALIDATION_FAILED');
      const future = new Date(f.clock.now().getTime() + 1000);
      expect((await domainError(f.keys.revoke(1, { reason: 'r', compromisedAt: future }, admin))).code).toBe('VALIDATION_FAILED');
      expect((await domainError(f.keys.revoke(1, { reason: 'r', compromisedAt: new Date('nope') }, admin))).code).toBe('VALIDATION_FAILED');
      expect((await domainError(f.keys.revoke(42, { reason: 'r' }, admin))).code).toBe('KEY_NOT_FOUND');
      expect((await f.keys.publicKey(1))?.status).toBe('ACTIVE');
    });
  });

  describe('caching', () => {
    it('caches public keys, invalidates on local change, and sees remote changes after the TTL', async () => {
      await f.keys.rotate(admin);
      const other = new KeyService({ db: f.t.db, provider: f.provider, audit: f.audit, clock: f.clock.now, cacheTtlMs: 30_000 });
      expect((await other.publicKey(1))?.status).toBe('ACTIVE');

      await f.keys.revoke(1, { reason: 'test' }, admin);
      expect((await f.keys.publicKey(1))?.status).toBe('REVOKED'); // own change: immediate
      expect((await other.publicKey(1))?.status).toBe('ACTIVE'); // other instance: cached
      f.clock.advance(30_001);
      expect((await other.publicKey(1))?.status).toBe('REVOKED');
      other.invalidate();
    });

    it('caches unknown ids briefly only and rejects out-of-range ids without a query', async () => {
      const other = new KeyService({ db: f.t.db, provider: f.provider, audit: f.audit, clock: f.clock.now });
      expect(await other.publicKey(1)).toBeUndefined();
      await f.keys.rotate(admin);
      expect(await other.publicKey(1)).toBeUndefined();
      f.clock.advance(5_001);
      expect((await other.publicKey(1))?.keyId).toBe(1);
      for (const bad of [0, 256, -1, 1.5, Number.NaN]) expect(await other.publicKey(bad)).toBeUndefined();
    });

    it('hands out copies: mutating a returned public key cannot poison the cache', async () => {
      const k = await f.keys.rotate(admin);
      const a = await f.keys.publicKey(1);
      a!.publicKey.fill(0);
      expect((await f.keys.publicKey(1))?.publicKey).toEqual(k.publicKey);
      const signer = await f.keys.activeSigner();
      signer.publicKey.fill(0);
      expect(verifyEd25519Node(k.publicKey, MSG, await signer.sign(MSG))).toBe(true);
    });
  });

  describe('defences against a faulty or hostile provider', () => {
    function wrap(base: KeyProvider, overrides: Partial<KeyProvider>): KeyProvider {
      return {
        name: base.name,
        generate: overrides.generate ?? ((kid) => base.generate(kid)),
        sign: overrides.sign ?? ((ref, m) => base.sign(ref, m)),
      };
    }

    it('verify-after-sign: a signature that does not verify is never returned', async () => {
      await f.keys.rotate(admin);
      let corrupt = false;
      const faulty = wrap(f.provider, {
        sign: async (ref, m) => {
          const s = await f.provider.sign(ref, m);
          if (corrupt) s[10] ^= 0x40;
          return s;
        },
      });
      const keys = new KeyService({ db: f.t.db, provider: faulty, audit: f.audit, clock: f.clock.now });
      const signer = await keys.activeSigner();
      expect((await signer.sign(MSG)).length).toBe(64);
      corrupt = true;
      const e = await domainError(signer.sign(MSG));
      expect(e.code).toBe('SIGNING_FAILED');
      expect(e.httpStatus).toBe(503);
    });

    it('a provider that fails or returns the wrong length is reported as unavailable / failed', async () => {
      await f.keys.rotate(admin);
      const throwing = new KeyService({
        db: f.t.db,
        audit: f.audit,
        provider: wrap(f.provider, { sign: async () => Promise.reject(new KeyProviderError('UNAVAILABLE', 'kms timeout')) }),
      });
      const e1 = await domainError((await throwing.activeSigner()).sign(MSG));
      expect(e1.code).toBe('SIGNING_UNAVAILABLE');
      expect(e1.publicMessage).not.toContain('kms');

      const short = new KeyService({ db: f.t.db, audit: f.audit, provider: wrap(f.provider, { sign: async () => new Uint8Array(63) }) });
      expect((await domainError((await short.activeSigner()).sign(MSG))).code).toBe('SIGNING_FAILED');
    });

    it('refuses to register a weak (small-order) public key', async () => {
      const identity = Uint8Array.from([1, ...new Array(31).fill(0)]); // the identity point
      const weak = wrap(f.provider, {
        generate: async (kid) => {
          const g = await f.provider.generate(kid);
          return { ...g, publicKey: identity };
        },
      });
      const keys = new KeyService({ db: f.t.db, provider: weak, audit: f.audit, clock: f.clock.now });
      expect((await domainError(keys.rotate(admin))).code).toBe('KEY_REJECTED');
      expect(await keys.list()).toEqual([]);
      expect(isStrictEd25519PublicKey(identity)).toBe(false);
    });

    it('requires proof of possession: a public key the provider cannot sign for is not registered', async () => {
      const liar = wrap(f.provider, {
        generate: async (kid) => {
          const g = await f.provider.generate(kid);
          return { ...g, publicKey: ed25519.getPublicKey(ed25519.utils.randomSecretKey()) };
        },
      });
      const keys = new KeyService({ db: f.t.db, provider: liar, audit: f.audit, clock: f.clock.now });
      expect((await domainError(keys.rotate(admin))).code).toBe('SIGNING_FAILED');
      expect(await keys.list()).toEqual([]);
      expect((await f.audit.list()).total).toBe(0);
    });

    it('a generation failure surfaces as KEY_PROVIDER_UNAVAILABLE and registers nothing', async () => {
      const broken = wrap(f.provider, { generate: async () => Promise.reject(new Error('disk full')) });
      const keys = new KeyService({ db: f.t.db, provider: broken, audit: f.audit });
      const e = await domainError(keys.rotate(admin));
      expect(e.code).toBe('KEY_PROVIDER_UNAVAILABLE');
      expect(await keys.list()).toEqual([]);
    });

    it('refuses to sign with an active key held by another provider', async () => {
      await f.keys.rotate(admin);
      const otherProvider: KeyProvider = { name: 'aws-kms', generate: f.provider.generate.bind(f.provider), sign: f.provider.sign.bind(f.provider) };
      const keys = new KeyService({ db: f.t.db, provider: otherProvider, audit: f.audit });
      expect((await domainError(keys.activeSigner())).code).toBe('SIGNING_UNAVAILABLE');
      expect(await keys.selfTest()).toBe(false);
    });

    it('selfTest signs a probe with the active key', async () => {
      expect(await f.keys.selfTest()).toBe(false); // no key yet
      await f.keys.rotate(admin);
      expect(await f.keys.selfTest()).toBe(true);
      f.provider.wipe(); // e.g. process restarted with memory keys: the key is gone
      expect(await f.keys.selfTest()).toBe(false);
    });
  });
});

describe('KeyService with LocalKeyProvider (temp directory)', () => {
  let root: string;
  let t: TestDb;
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round trip: rotate, sign, verify; a tampered key file is refused', async () => {
    root = await mkdtemp(join(tmpdir(), 'orbes-keyservice-'));
    t = await createTestDb();
    try {
      const encryptionKey = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));
      const provider = await LocalKeyProvider.open({ dir: join(root, 'keys'), encryptionKey });
      const audit = new AuditService({ db: t.db });
      const keys = new KeyService({ db: t.db, provider, audit });

      const k1 = await keys.rotate(admin);
      expect(k1.provider).toBe('local');
      expect(k1.providerRef).toBe(`${k1.kid}.key.json`);
      const signer = await keys.activeSigner();
      const sig = await signer.sign(MSG);
      expect(verifyEd25519Node(k1.publicKey, MSG, sig)).toBe(true);
      expect(await keys.selfTest()).toBe(true);

      // A restarted process (new provider + service instance) signs with the same key.
      const restarted = new KeyService({
        db: t.db,
        audit,
        provider: new LocalKeyProvider({ dir: join(root, 'keys'), encryptionKey }),
      });
      expect(await (await restarted.activeSigner()).sign(MSG)).toEqual(sig);

      // The database holds the public key and a file name, never key material.
      const row = await t.db.selectFrom('cryptographic_keys').selectAll().executeTakeFirstOrThrow();
      const file = JSON.parse(await readFile(join(root, 'keys', row.provider_ref), 'utf8'));
      expect(JSON.stringify(row)).not.toContain(file.ct);

      // Tamper with the ciphertext: signing is refused, nothing is signed with garbage.
      const ct = fromBase64Url(file.ct);
      ct[0] ^= 0xff;
      await writeFile(join(root, 'keys', row.provider_ref), JSON.stringify({ ...file, ct: toBase64Url(ct) }), { mode: 0o600 });
      const e = await domainError(signer.sign(MSG));
      expect(e.code).toBe('SIGNING_UNAVAILABLE');
      expect((e.cause as KeyProviderError).code).toBe('KEY_INTEGRITY');
      expect(await keys.selfTest()).toBe(false);

      // Wrong encryption key at startup is caught by the self test.
      const wrongKek = new KeyService({
        db: t.db,
        audit,
        provider: new LocalKeyProvider({ dir: join(root, 'keys'), encryptionKey: toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i)) }),
      });
      expect(await wrongKek.selfTest()).toBe(false);
    } finally {
      await t.close();
    }
  });
});
