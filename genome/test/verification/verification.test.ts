/**
 * End-to-end (in-process) tests of the verification decision procedure,
 * contract §2.4 steps 1–12, against a real migrated PGlite database and the
 * real issuance / key / lifecycle / ownership / warranty services.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData, signingMessage, unframeCodeData } from '../../src/core/payload.js';
import { DomainError } from '../../src/server/errors.js';
import { hashScanToken } from '../../src/server/services/scan-tokens.js';
import { genomeCheck, VerificationService } from '../../src/server/services/verification.js';
import {
  admin,
  anomalies,
  authEvent,
  createAccount,
  createWorld,
  issue,
  issueActivated,
  reframe,
  registerOwner,
  scanEvent,
  verify,
  type World,
} from './world.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Sign an arbitrary payload with the ACTIVE key (simulates a code ORBES never registered, or key misuse). */
async function signedCode(w: World, fields: { serial?: number; issue?: number; nonce?: Uint8Array; genomeVersion?: number } = {}): Promise<string> {
  const signer = await w.keys.activeSigner();
  const payload = encodePayload({
    codeVersion: 1,
    genomeVersion: fields.genomeVersion ?? 1,
    keyId: signer.keyId,
    identity: { year: 2026, categoryIndex: 1, serial: fields.serial ?? 90_001 },
    issue: fields.issue ?? 1,
    issuedDay: 880,
    nonce: fields.nonce ?? Uint8Array.from(randomBytes(4)),
  });
  const sig = await signer.sign(signingMessage(payload));
  return toBase64Url(frameCodeData(payload, sig));
}

describe('the nine states', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it('AUTHENTIC: a freshly issued product (not yet sold)', async () => {
    const r = await issue(w);
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('AUTHENTIC');
    expect(out.title).toBe('AUTHENTIC');
    expect(out.message).toBe('This ORBES identity was issued and signed by ORBES and is registered to an active piece.');
    expect(out.verification).toEqual({
      signature: 'VALID',
      keyId: r.code.keyId,
      codeVersion: 'CODE-01',
      genomeVersion: 'GENOME-01',
      issuedAt: '2026-06-01',
      issue: 1,
      assurance: 'CODE',
    });
    expect(out.product).toEqual({
      productId: r.product.productId,
      category: { code: 'J', name: 'Jewelry' },
      collection: 'ORBIT',
      model: 'MONOLITHE',
      type: 'RING',
      material: '925 STERLING SILVER',
      createdYear: 2026,
      care: 'Polish with a soft dry cloth.',
    });
    const g = computeGenome(r.product.packedIdentity, 1);
    expect(out.genome).toEqual({ id: r.product.productId, version: 'GENOME-01', fingerprint: g.fingerprint, glyphs: g.glyphs, ids: g.ids });
    expect(out.warranty).toEqual({ status: 'NOT_STARTED' });
    expect(out.ownership).toEqual({ registered: false, you: false });
    expect(out.registration).toBeUndefined();
    expect(out.verifiedAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('AUTHENTIC_FIRST_REGISTRATION: an activated product without owner gets a single-use token', async () => {
    const r = await issueActivated(w, { variant: 'Size 52', productionDate: '2026-05-02' });
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect(out.title).toBe('AUTHENTIC — FIRST REGISTRATION');
    expect(out.registration).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: '2026-06-01T10:15:00.000Z', claimCodeRequired: false });
    expect(out.product).toMatchObject({ variant: 'Size 52', productionDate: '2026-05-02' });
    expect(out.warranty).toEqual({ status: 'ACTIVE', startDate: '2026-06-01', endDate: '2028-06-01' });
    // Only the hash is stored, bound to the product and this scan.
    const tok = await w.t.db.selectFrom('scan_tokens').selectAll().where('id_hash', '=', hashScanToken(out.registration!.token)!).executeTakeFirstOrThrow();
    expect(tok.product_id).toBe(r.product.id);
    expect(tok.scan_event_id).toBe(out.scanId);
    expect(tok.used_at).toBeNull();
  });

  it('AUTHENTIC_FIRST_REGISTRATION: claimCodeRequired follows the claim secret; the token registers the owner once', async () => {
    const r = await issueActivated(w, { withClaimSecret: true });
    const out = await verify(w, r.code.data);
    expect(out.registration?.claimCodeRequired).toBe(true);
    const acc = await createAccount(w);
    const actor = { type: 'account' as const, id: acc };
    const reg = await w.ownership.registerFirst(acc, { registrationToken: out.registration!.token, claimCode: r.claimCode }, actor);
    expect(reg.verified).toBe(true);
    await expect(w.ownership.registerFirst(acc, { registrationToken: out.registration!.token, claimCode: r.claimCode }, actor)).rejects.toBeInstanceOf(DomainError);
  });

  it('AUTHENTIC_FIRST_REGISTRATION also for RESOLD and SERVICED products without owner', async () => {
    const a = await issueActivated(w);
    await w.lifecycle.transition(a.product.productId, 'RESOLD', { reason: 'resale' }, admin);
    expect((await verify(w, a.code.data)).state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    const b = await issueActivated(w);
    await w.warranty.openService(b.product.productId, { type: 'CLEANING' }, admin);
    expect((await verify(w, b.code.data)).state).toBe('AUTHENTIC_FIRST_REGISTRATION');
  });

  it('AUTHENTIC_REGISTERED and AUTHENTIC_OWNERSHIP_VERIFIED', async () => {
    const r = await issueActivated(w);
    const owner = await createAccount(w);
    const other = await createAccount(w);
    await registerOwner(w, r, owner);

    const anon = await verify(w, r.code.data);
    expect(anon.state).toBe('AUTHENTIC_REGISTERED');
    expect(anon.title).toBe('AUTHENTIC — REGISTERED');
    expect(anon.ownership).toEqual({ registered: true, you: false });
    expect(anon.registration).toBeUndefined();

    expect((await verify(w, r.code.data, { accountId: other })).state).toBe('AUTHENTIC_REGISTERED');

    const mine = await verify(w, r.code.data, { accountId: owner });
    expect(mine.state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');
    expect(mine.title).toBe('AUTHENTIC — OWNERSHIP VERIFIED');
    expect(mine.ownership).toEqual({ registered: true, you: true });
    expect(mine.notice).toBeUndefined();

    // Pending transfer is shown.
    await w.ownership.initiateTransfer(owner, r.product.productId, { type: 'account', id: owner });
    expect((await verify(w, r.code.data)).ownership).toEqual({ registered: true, you: false, transferPending: true });
  });

  it('SUSPICIOUS_ACTIVITY: France 10:00 → Japan 10:02 → USA 10:03', async () => {
    const r = await issueActivated(w);
    const start = w.clock.now().getTime();
    const s1 = await verify(w, r.code.data, { deviceHash: 'fr', geo: { country: 'FR' } });
    w.clock.set(start + 2 * MIN);
    const s2 = await verify(w, r.code.data, { deviceHash: 'jp', geo: { country: 'JP' } });
    w.clock.set(start + 3 * MIN);
    const s3 = await verify(w, r.code.data, { deviceHash: 'us', geo: { country: 'US' } });
    w.clock.set(start);
    expect(s1.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect(s2.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(s3.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(s3.title).toBe('UNUSUAL ACTIVITY DETECTED');
    expect(s3.registration).toBeUndefined();
    expect(s3.product).toBeUndefined();
    expect(s3.genome?.id).toBe(r.product.productId);
    const ev = await authEvent(w, s3.scanId);
    expect(ev.reasons).toEqual(['ANOMALY:IMPOSSIBLE_TRAVEL', 'RISK_THRESHOLD']);
    expect(ev.risk_score).toBeGreaterThanOrEqual(60);
    const a = (await anomalies(w)).filter((x) => x.product_id === r.product.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'IMPOSSIBLE_TRAVEL', severity: 'HIGH', status: 'OPEN', occurrences: 2, code_id: r.code.id });
  });

  it('REVOKED: revoked product', async () => {
    const r = await issueActivated(w);
    await w.lifecycle.transition(r.product.productId, 'REVOKED', { reason: 'test' }, admin);
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('REVOKED');
    expect(out.title).toBe('REVOKED');
    expect(out.product).toBeUndefined();
    expect(out.warranty).toBeUndefined();
    expect(out.ownership).toBeUndefined();
    expect(out.genome?.id).toBe(r.product.productId);
    expect((await authEvent(w, out.scanId)).reasons).toContain('PRODUCT_REVOKED');
  });

  it('UNKNOWN: a valid signature on an identity ORBES never registered (CRITICAL anomaly)', async () => {
    const code = await signedCode(w, { serial: 77_001 });
    const out = await verify(w, code);
    expect(out.state).toBe('UNKNOWN');
    expect(out.title).toBe('UNKNOWN ORBES CODE');
    expect(Object.keys(out).sort()).toEqual(['message', 'scanId', 'state', 'title', 'verifiedAt']);
    await verify(w, code);
    const packed = packIdentity({ year: 2026, categoryIndex: 1, serial: 77_001 });
    const a = (await anomalies(w)).filter((x) => x.type === 'VALID_SIGNATURE_UNREGISTERED' && x.details.packedIdentity === packed);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ severity: 'CRITICAL', product_id: null, occurrences: 2, risk_score: 100 });
    const ev = await authEvent(w, out.scanId);
    expect(ev).toMatchObject({ signature_valid: true, state: 'UNKNOWN', reasons: ['PRODUCT_NOT_REGISTERED'], product_id: null, code_id: null });
  });

  it('INVALID_SIGNATURE: a flipped signature bit', async () => {
    const r = await issue(w);
    const code = reframe(r.code.data, { signature: (s) => void (s[10] ^= 0x01) });
    const out = await verify(w, code);
    expect(out.state).toBe('INVALID_SIGNATURE');
    expect(out.title).toBe('INVALID SIGNATURE');
    expect(Object.keys(out).sort()).toEqual(['message', 'scanId', 'state', 'title', 'verifiedAt']);
    expect(await authEvent(w, out.scanId)).toMatchObject({ signature_valid: false, reasons: ['BAD_SIGNATURE'], key_id: r.code.keyId });
  });

  it('MALFORMED_CODE: unreadable input', async () => {
    const out = await verify(w, 'not*base64');
    expect(out.state).toBe('MALFORMED_CODE');
    expect(out.title).toBe('UNREADABLE CODE');
    expect(Object.keys(out).sort()).toEqual(['message', 'scanId', 'state', 'title', 'verifiedAt']);
    const ev = await authEvent(w, out.scanId);
    expect(ev).toMatchObject({ state: 'MALFORMED_CODE', signature_valid: false, key_id: null, genome_check: 'NOT_PROVIDED', risk_score: 0 });
  });
});

describe('step 1–2: decoding and versions', () => {
  let w: World;
  let data: string;
  beforeAll(async () => {
    w = await createWorld();
    data = (await issue(w)).code.data;
  });
  afterAll(() => w.close());

  const reasonOf = async (code: unknown) => {
    const out = await w.verification.verify({ code } as never, {});
    expect(out.state).toBe('MALFORMED_CODE');
    return (await authEvent(w, out.scanId)).reasons;
  };

  it('rejects non-strings, empty and over-long input without reading it', async () => {
    expect(await reasonOf(undefined)).toEqual(['MALFORMED:INPUT']);
    expect(await reasonOf(42)).toEqual(['MALFORMED:INPUT']);
    expect(await reasonOf('')).toEqual(['MALFORMED:INPUT']);
    expect(await reasonOf('A'.repeat(201))).toEqual(['MALFORMED:INPUT']);
  });

  it('rejects bad base64url, wrong length and CRC errors', async () => {
    expect(await reasonOf(data + '+')).toEqual(['MALFORMED:ENCODING']);
    expect(await reasonOf(data.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toEqual(expect.arrayContaining([expect.stringMatching(/^MALFORMED:(CRC|ENCODING)$/)]));
    expect(await reasonOf(data.slice(0, 100))).toEqual(['MALFORMED:LENGTH']);
    const raw = fromBase64Url(data);
    raw[20] ^= 0xff;
    expect(await reasonOf(toBase64Url(raw))).toEqual(['MALFORMED:CRC']);
  });

  it('rejects code versions outside the format word range and reserved values (CRC-valid frames)', async () => {
    expect(await reasonOf(reframe(data, { payload: (p) => void (p[0] = (0 << 4) | 1) }))).toEqual(['MALFORMED:VERSION']);
    expect(await reasonOf(reframe(data, { payload: (p) => void (p[0] = (9 << 4) | 1) }))).toEqual(['MALFORMED:VERSION']);
    expect(await reasonOf(reframe(data, { payload: (p) => void (p[1] = 0) }))).toEqual(['MALFORMED:RESERVED']);
  });

  it('a well-formed code of a code version this server has no profile for → UNKNOWN (UNSUPPORTED_CODE_VERSION), logged as a server warning', async () => {
    const warnings: unknown[] = [];
    const log = { info: () => {}, error: () => {}, warn: (o: unknown) => void warnings.push(o) };
    const svc = new VerificationService({ db: w.t.db, keys: w.keys, anomaly: w.anomaly, config: w.config, clock: w.clock.now, log });
    for (const v of [2, 8]) {
      const out = await svc.verify({ code: reframe(data, { payload: (p) => void (p[0] = (v << 4) | 1) }) }, {});
      expect(out.state).toBe('UNKNOWN');
      expect(Object.keys(out).sort()).toEqual(['message', 'scanId', 'state', 'title', 'verifiedAt']);
      // Nothing about the code can be checked: no key, no signature, no product.
      expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['UNSUPPORTED_CODE_VERSION'], signature_valid: false, key_id: null, product_id: null, code_id: null });
      expect(warnings.at(-1)).toEqual(expect.objectContaining({ scanId: out.scanId, codeVersion: v }));
    }
    expect(warnings).toHaveLength(2);
    // A damaged frame of an unknown version stays MALFORMED_CODE.
    const raw = fromBase64Url(reframe(data, { payload: (p) => void (p[0] = (2 << 4) | 1) }));
    raw[78] ^= 1;
    expect(await reasonOf(toBase64Url(raw))).toEqual(['MALFORMED:VERSION']);
  });

  it('a reserved genome version (0) is a structural failure', async () => {
    expect(await reasonOf(reframe(data, { payload: (p) => void (p[0] = (1 << 4) | 0) }))).toEqual(['MALFORMED:RESERVED']);
  });

  it('a tampered genome version fails the signature: the signature is checked before version support', async () => {
    for (const v of [2, 7, 15]) {
      const out = await verify(w, reframe(data, { payload: (p) => void (p[0] = (1 << 4) | v) }));
      expect(out.state).toBe('INVALID_SIGNATURE');
      expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['BAD_SIGNATURE'], signature_valid: false });
    }
  });

  it('records the scan even when the code is unreadable', async () => {
    const out = await verify(w, '!!!', { deviceHash: 'dev', ipHash: 'iph', geo: { country: 'FR', lat: 48.8566, lon: 2.3522 } });
    const s = await scanEvent(w, out.scanId);
    expect(s).toMatchObject({ result_state: 'MALFORMED_CODE', code_id: null, product_id: null, packed_identity: null, device_hash: 'dev', ip_hash: 'iph', country: 'FR', event_type: 'VERIFY' });
    expect(s.lat).toBeCloseTo(48.9, 5);
    expect(s.lon).toBeCloseTo(2.4, 5);
    expect(s.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('steps 3–6: keys and signatures', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it('unknown key id → INVALID_SIGNATURE (UNKNOWN_KEY)', async () => {
    const r = await issue(w);
    const out = await verify(w, reframe(r.code.data, { payload: (p) => void (p[1] = 200) }));
    expect(out.state).toBe('INVALID_SIGNATURE');
    expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['UNKNOWN_KEY'], key_id: 200, signature_valid: false });
  });

  it('a tampered product id (serial) fails the signature', async () => {
    const r = await issue(w);
    const out = await verify(w, reframe(r.code.data, { payload: (p) => void (p[5] ^= 0x01) }));
    expect(out.state).toBe('INVALID_SIGNATURE');
  });

  it('a small-order public key in the registry never verifies (R = identity, S = 0 forgery)', async () => {
    const r = await issue(w);
    const identity = new Uint8Array(32);
    identity[0] = 1; // canonical encoding of the identity point
    await w.t.db
      .insertInto('cryptographic_keys')
      .values({ key_id: 99, kid: 'weak', public_key: identity, status: 'RETIRED', provider: 'memory', provider_ref: 'weak' })
      .execute();
    const sig = new Uint8Array(64);
    sig[0] = 1; // R = identity, S = 0
    const out = await verify(w, reframe(r.code.data, { payload: (p) => void (p[1] = 99), signature: (s) => s.set(sig) }));
    expect(out.state).toBe('INVALID_SIGNATURE');
    expect((await authEvent(w, out.scanId)).reasons).toEqual(['BAD_SIGNATURE']);
  });

  it('a valid signature over a payload that differs from the registered code → SUSPICIOUS (CODE_MISMATCH, CRITICAL)', async () => {
    const r = await issue(w);
    const payload = unframeCodeData(fromBase64Url(r.code.data)).payloadBytes;
    const nonce = payload.slice(9, 13);
    nonce[0] ^= 0xff;
    const code = await signedCode(w, { serial: r.product.serial, issue: 1, nonce });
    const out = await verify(w, code);
    expect(out.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(out.verification).toBeUndefined();
    expect(out.product).toBeUndefined();
    const ev = await authEvent(w, out.scanId);
    expect(ev).toMatchObject({ reasons: ['CODE_MISMATCH'], signature_valid: true, code_id: null, product_id: r.product.id, risk_score: 100 });
    const a = (await anomalies(w)).find((x) => x.product_id === r.product.id && x.type === 'CODE_MISMATCH');
    expect(a).toMatchObject({ severity: 'CRITICAL', code_id: r.code.id });
  });

  it('a registered product with an unregistered issue → UNKNOWN (CODE_NOT_REGISTERED)', async () => {
    const r = await issue(w);
    const out = await verify(w, await signedCode(w, { serial: r.product.serial, issue: 7 }));
    expect(out.state).toBe('UNKNOWN');
    expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['CODE_NOT_REGISTERED'], product_id: r.product.id });
    const a = (await anomalies(w)).find((x) => x.product_id === r.product.id);
    expect(a).toMatchObject({ type: 'VALID_SIGNATURE_UNREGISTERED', severity: 'CRITICAL' });
  });

  it('RETIRED key: codes it signed stay AUTHENTIC; new codes use the new key', async () => {
    const old = await issue(w);
    await w.keys.rotate(admin, 'orbes-test-k2');
    const fresh = await issue(w);
    expect(fresh.code.keyId).not.toBe(old.code.keyId);
    const a = await verify(w, old.code.data);
    expect(a.state).toBe('AUTHENTIC');
    expect(a.verification?.keyId).toBe(old.code.keyId);
    expect((await verify(w, fresh.code.data)).verification?.keyId).toBe(fresh.code.keyId);
  });

  it('REVOKED key: codes recorded before compromised_at stay trusted, later ones fail (KEY_REVOKED)', async () => {
    await w.keys.rotate(admin, 'orbes-test-k3');
    const before = await issue(w);
    w.clock.advance(DAY);
    const after = await issue(w);
    const compromisedAt = new Date(before.code.createdAt.getTime() + HOUR);
    const keyId = after.code.keyId;
    await w.keys.revoke(keyId, { reason: 'test compromise', compromisedAt }, admin);

    expect((await verify(w, before.code.data)).state).toBe('AUTHENTIC');
    const out = await verify(w, after.code.data);
    expect(out.state).toBe('INVALID_SIGNATURE');
    expect(out.title).toBe('INVALID SIGNATURE');
    expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['KEY_REVOKED'], signature_valid: true, code_id: null });

    // Step 6 precedes step 8: a revoked code under a distrusted key is INVALID_SIGNATURE, not REVOKED.
    await w.t.db.updateTable('codes').set({ status: 'REVOKED' }).where('id', '=', after.code.id).execute();
    expect((await verify(w, after.code.data)).state).toBe('INVALID_SIGNATURE');
    await w.keys.rotate(admin, 'orbes-test-k4');
  });

  it('REVOKED key without a compromise time: cut-off is the revocation time', async () => {
    const r = await issue(w);
    w.clock.advance(MIN);
    await w.keys.revoke(r.code.keyId, { reason: 'routine revocation' }, admin);
    expect((await verify(w, r.code.data)).state).toBe('AUTHENTIC');
    // A code row stamped at/after revoked_at is not trusted (simulated: the clock cannot issue under a revoked key).
    const k = await w.keys.publicKey(r.code.keyId);
    await w.t.pglite.query(`ALTER TABLE codes DISABLE TRIGGER codes_immutable_identity`);
    await w.t.db.updateTable('codes').set({ created_at: k!.revokedAt! }).where('id', '=', r.code.id).execute();
    await w.t.pglite.query(`ALTER TABLE codes ENABLE TRIGGER codes_immutable_identity`);
    expect((await verify(w, r.code.data)).state).toBe('INVALID_SIGNATURE');
    await w.keys.rotate(admin, 'orbes-test-k5');
  });

  it('a validly signed but unsupported genome version → UNKNOWN (UNSUPPORTED_GENOME_VERSION), logged as a server warning', async () => {
    const warnings: unknown[] = [];
    const log = { info: () => {}, error: () => {}, warn: (o: unknown) => void warnings.push(o) };
    const svc = new VerificationService({ db: w.t.db, keys: w.keys, anomaly: w.anomaly, config: w.config, clock: w.clock.now, log });
    const r = await issue(w);
    const code = await signedCode(w, { serial: r.product.serial, genomeVersion: 2 });
    const out = await svc.verify({ code }, {});
    expect(out.state).toBe('UNKNOWN');
    expect(Object.keys(out).sort()).toEqual(['message', 'scanId', 'state', 'title', 'verifiedAt']);
    expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['UNSUPPORTED_GENOME_VERSION'], signature_valid: true, code_id: null });
    expect(warnings).toEqual([expect.objectContaining({ scanId: out.scanId, genomeVersion: 2 })]);
    // Not a compromise alarm: the server is outdated, the code may be genuine.
    expect((await anomalies(w)).filter((a) => a.product_id === r.product.id)).toEqual([]);
  });

  it('revoked key before the registry: a new identity signed by a revoked key → INVALID_SIGNATURE (KEY_REVOKED), no anomaly', async () => {
    const code = await signedCode(w, { serial: 66_001 });
    const unsupported = await signedCode(w, { serial: 66_002, genomeVersion: 3 });
    const signer = await w.keys.activeSigner();
    w.clock.advance(MIN);
    await w.keys.revoke(signer.keyId, { reason: 'compromise', compromisedAt: new Date(w.clock.now().getTime() - 2 * DAY) }, admin);
    const out = await verify(w, code);
    expect(out.state).toBe('INVALID_SIGNATURE');
    expect(Object.keys(out).sort()).toEqual(['message', 'scanId', 'state', 'title', 'verifiedAt']);
    expect(await authEvent(w, out.scanId)).toMatchObject({ reasons: ['KEY_REVOKED'], signature_valid: true, product_id: null, code_id: null });
    // The revoked-key rule also precedes the genome-version support check.
    const u = await verify(w, unsupported);
    expect(u.state).toBe('INVALID_SIGNATURE');
    expect((await authEvent(w, u.scanId)).reasons).toEqual(['KEY_REVOKED']);
    const packed = packIdentity({ year: 2026, categoryIndex: 1, serial: 66_001 });
    expect((await anomalies(w)).filter((a) => a.details.packedIdentity === packed)).toEqual([]);
    await w.keys.rotate(admin, 'orbes-test-k6');
  });

  it('revoked key, product whose code was recorded before the cut-off, forged nonce → SUSPICIOUS (CODE_MISMATCH)', async () => {
    const r = await issue(w);
    const nonce = unframeCodeData(fromBase64Url(r.code.data)).payloadBytes.slice(9, 13);
    nonce[0] ^= 0xff;
    const forged = await signedCode(w, { serial: r.product.serial, issue: 1, nonce });
    w.clock.advance(HOUR);
    await w.keys.revoke(r.code.keyId, { reason: 'compromise' }, admin);
    expect((await verify(w, r.code.data)).state).toBe('AUTHENTIC');
    const out = await verify(w, forged);
    expect(out.state).toBe('SUSPICIOUS_ACTIVITY');
    expect((await authEvent(w, out.scanId)).reasons).toEqual(['CODE_MISMATCH']);
    await w.keys.rotate(admin, 'orbes-test-k7');
  });
});

describe('step 7: genome cross-check', () => {
  let w: World;
  let r: Awaited<ReturnType<typeof issue>>;
  let glyphs: number[];
  beforeAll(async () => {
    w = await createWorld();
    r = await issue(w);
    glyphs = r.genome.glyphs;
  });
  afterAll(() => w.close());

  const wrong = (g: number) => (g + 1) % 16;
  const check = async (reading: { glyphs: (number | null)[]; confidence?: number[] }) => {
    const out = await verify(w, { code: r.code.data, genome: reading });
    return { out, ev: await authEvent(w, out.scanId) };
  };

  it('not provided', async () => {
    const { out, ev } = await check(undefined as never);
    expect(out.state).toBe('AUTHENTIC');
    expect(ev.genome_check).toBe('NOT_PROVIDED');
  });

  it('all 8 glyphs match', async () => {
    const { out, ev } = await check({ glyphs, confidence: glyphs.map(() => 0.9) });
    expect(out.state).toBe('AUTHENTIC');
    expect(ev.genome_check).toBe('MATCH');
  });

  it('one misread glyph is tolerated', async () => {
    const g = [...glyphs];
    g[3] = wrong(g[3]);
    const { out, ev } = await check({ glyphs: g });
    expect(out.state).toBe('AUTHENTIC');
    expect(ev.genome_check).toBe('MATCH');
  });

  it('two mismatches among ≥ 6 confident glyphs → SUSPICIOUS (GENOME_MISMATCH, HIGH)', async () => {
    const g = [...glyphs];
    g[0] = wrong(g[0]);
    g[5] = wrong(g[5]);
    const { out, ev } = await check({ glyphs: g, confidence: g.map(() => 0.8) });
    expect(out.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(ev.genome_check).toBe('MISMATCH');
    expect(ev.reasons[0]).toBe('GENOME_MISMATCH');
    const a = (await anomalies(w)).find((x) => x.type === 'GENOME_MISMATCH');
    expect(a).toMatchObject({ severity: 'HIGH', product_id: r.product.id, code_id: r.code.id });
    expect(a!.details).toMatchObject({ provided: 8, mismatches: 2 });
  });

  it('exactly 6 confident glyphs with 2 mismatches is enough', async () => {
    const g: (number | null)[] = [...glyphs];
    g[0] = null;
    g[1] = null;
    g[2] = wrong(glyphs[2]);
    g[3] = wrong(glyphs[3]);
    expect((await check({ glyphs: g })).ev.genome_check).toBe('MISMATCH');
  });

  it('fewer than 6 confident glyphs is INCONCLUSIVE, whatever they say', async () => {
    const g: (number | null)[] = glyphs.map(wrong);
    g[0] = g[1] = g[2] = null;
    const { out, ev } = await check({ glyphs: g });
    expect(out.state).toBe('AUTHENTIC');
    expect(ev.genome_check).toBe('INCONCLUSIVE');
  });

  it('low-confidence glyphs (< 0.5) do not count; 0.5 does', async () => {
    const g = [...glyphs];
    g[0] = wrong(g[0]);
    g[1] = wrong(g[1]);
    const low = g.map((_, i) => (i < 2 ? 0.49 : 0.95));
    expect((await check({ glyphs: g, confidence: low })).ev.genome_check).toBe('MATCH');
    const edge = g.map((_, i) => (i < 2 ? 0.5 : 0.95));
    expect((await check({ glyphs: g, confidence: edge })).ev.genome_check).toBe('MISMATCH');
    const tooFew = g.map((_, i) => (i < 3 ? 0.9 : 0.1));
    expect((await check({ glyphs: g, confidence: tooFew })).ev.genome_check).toBe('INCONCLUSIVE');
  });

  it('all-null reading counts as not provided', async () => {
    expect((await check({ glyphs: Array(8).fill(null) })).ev.genome_check).toBe('NOT_PROVIDED');
  });

  it('structurally invalid readings are refused (400)', async () => {
    for (const bad of [{ glyphs: [1, 2, 3] }, { glyphs: Array(8).fill(16) }, { glyphs: Array(8).fill(1.5) }, { glyphs: glyphs, confidence: [1] }, { glyphs, confidence: Array(8).fill(2) }, 'x']) {
      await expect(verify(w, { code: r.code.data, genome: bad as never })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
    }
  });

  it('step 7 precedes step 8: a revoked product with a mismatching genome is SUSPICIOUS', async () => {
    const x = await issue(w);
    await w.lifecycle.transition(x.product.productId, 'REVOKED', { reason: 'test' }, admin);
    const g = x.genome.glyphs.map(wrong);
    const out = await verify(w, { code: x.code.data, genome: { glyphs: g } });
    expect(out.state).toBe('SUSPICIOUS_ACTIVITY');
    expect((await verify(w, x.code.data)).state).toBe('REVOKED');
  });

  it('genomeCheck helper', () => {
    expect(genomeCheck([0, 1, 2, 3, 4, 5, 6, 7], undefined).check).toBe('NOT_PROVIDED');
    expect(genomeCheck([0, 1, 2, 3, 4, 5, 6, 7], { glyphs: [0, 1, 2, 3, 4, 5, 9, 9] })).toEqual({ check: 'MISMATCH', provided: 8, mismatches: 2 });
  });
});

describe('step 8: code and product status', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it('a superseded code (after re-issue) → REVOKED; the new code is authentic', async () => {
    const r = await issueActivated(w);
    const fresh = await w.issuance.reissueCode(r.product.productId, 'damaged label', admin);
    const old = await verify(w, r.code.data);
    expect(old.state).toBe('REVOKED');
    expect((await authEvent(w, old.scanId)).reasons).toEqual(['CODE_SUPERSEDED', 'ANOMALY:POST_REVOCATION_SCAN']);
    expect((await verify(w, fresh.data)).state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    const a = (await anomalies(w)).find((x) => x.product_id === r.product.id);
    expect(a).toMatchObject({ type: 'POST_REVOCATION_SCAN', severity: 'MEDIUM' });
  });

  it('a revoked code → REVOKED', async () => {
    const r = await issue(w);
    await w.t.db.updateTable('codes').set({ status: 'REVOKED', revoked_at: w.clock.now(), revocation_reason: 'test' }).where('id', '=', r.code.id).execute();
    expect((await verify(w, r.code.data)).state).toBe('REVOKED');
  });

  it.each(['COUNTERFEIT_FLAGGED', 'RETIRED'] as const)('product %s → REVOKED', async (status) => {
    const r = await issue(w);
    await w.lifecycle.transition(r.product.productId, status, { reason: 'test' }, admin);
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('REVOKED');
    expect((await authEvent(w, out.scanId)).reasons[0]).toBe(`PRODUCT_${status}`);
  });

  it.each(['LOST', 'STOLEN'] as const)('product %s → SUSPICIOUS_ACTIVITY with LOST_STOLEN_SCAN', async (status) => {
    const r = await issueActivated(w);
    const owner = await createAccount(w);
    await registerOwner(w, r, owner);
    await w.ownership.reportIncident(owner, r.product.productId, status, { type: 'account', id: owner });
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(out.message).not.toMatch(/lost|stolen/i);
    const ev = await authEvent(w, out.scanId);
    expect(ev.reasons).toEqual([`PRODUCT_${status}`, 'ANOMALY:LOST_STOLEN_SCAN']);
    expect(ev.risk_score).toBe(50);
    // The owner scanning their reported product still sees the decided state.
    expect((await verify(w, r.code.data, { accountId: owner })).state).toBe('SUSPICIOUS_ACTIVITY');
    const a = (await anomalies(w)).find((x) => x.product_id === r.product.id && x.type === 'LOST_STOLEN_SCAN');
    expect(a).toMatchObject({ severity: 'HIGH', occurrences: 2 });
  });
});

describe('step 9: anomaly scoring and the owner notice', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  async function travel(code: string, base: number) {
    w.clock.set(base);
    await verify(w, code, { deviceHash: 'x-fr', geo: { country: 'FR' } });
    w.clock.set(base + 2 * MIN);
    await verify(w, code, { deviceHash: 'x-jp', geo: { country: 'JP' } });
    w.clock.set(base + 3 * MIN);
    await verify(w, code, { deviceHash: 'x-us', geo: { country: 'US' } });
  }

  it('the logged-in owner gets AUTHENTIC_OWNERSHIP_VERIFIED with notice UNUSUAL_ACTIVITY; others get SUSPICIOUS', async () => {
    const base = Date.parse('2026-06-01T10:00:00.000Z');
    const r = await issueActivated(w);
    const owner = await createAccount(w);
    await registerOwner(w, r, owner);
    await travel(r.code.data, base);

    const mine = await verify(w, r.code.data, { accountId: owner, deviceHash: 'owner-phone', geo: { country: 'US' } });
    expect(mine.state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');
    expect(mine.notice).toBe('UNUSUAL_ACTIVITY');
    expect(mine.title).toBe('AUTHENTIC — OWNERSHIP VERIFIED');
    expect(mine.message).toMatch(/unusual activity/i);
    expect(mine.product?.productId).toBe(r.product.productId);
    expect((await authEvent(w, mine.scanId)).reasons).toContain('RISK_THRESHOLD_OWNER');

    const theirs = await verify(w, r.code.data, { deviceHash: 'someone', geo: { country: 'US' } });
    expect(theirs.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(theirs.notice).toBeUndefined();
  });

  it('the finding decays: a day later the same code is authentic again', async () => {
    const base = Date.parse('2026-07-01T10:00:00.000Z');
    const r = await issueActivated(w);
    await travel(r.code.data, base);
    w.clock.set(base + DAY);
    const out = await verify(w, r.code.data, { deviceHash: 'x-us', geo: { country: 'US' } });
    expect(out.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect((await authEvent(w, out.scanId)).risk_score).toBe(58);
  });

  it('an owner scanning many times from many devices never triggers velocity / device rules on their own', async () => {
    const base = Date.parse('2026-08-01T10:00:00.000Z');
    const r = await issueActivated(w);
    const owner = await createAccount(w);
    await registerOwner(w, r, owner);
    for (let i = 0; i < 25; i++) {
      w.clock.set(base + i * MIN);
      const out = await verify(w, r.code.data, { accountId: owner, deviceHash: `owner-device-${i % 14}`, geo: { country: 'FR' } });
      expect(out.state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');
      expect(out.notice).toBeUndefined();
    }
    expect((await anomalies(w)).filter((a) => a.product_id === r.product.id)).toEqual([]);
  });

  it('a mass-copied code scanned by strangers in one place becomes SUSPICIOUS (velocity 45 ⊕ diversity 30 = 62)', async () => {
    const base = Date.parse('2026-09-01T10:00:00.000Z');
    const r = await issueActivated(w);
    const states: string[] = [];
    for (let i = 0; i < 25; i++) {
      w.clock.set(base + i * MIN);
      states.push((await verify(w, r.code.data, { deviceHash: `stranger-${i}`, ipHash: `ip-${i}`, geo: { country: 'FR' } })).state);
    }
    // Diversity alone (from the 13th source, 30) stays below 60; with velocity (from the 21st scan) the burst is shown.
    expect(states.slice(0, 20).every((s) => s === 'AUTHENTIC_FIRST_REGISTRATION')).toBe(true);
    expect(states.slice(20).every((s) => s === 'SUSPICIOUS_ACTIVITY')).toBe(true);
    const types = (await anomalies(w)).filter((a) => a.product_id === r.product.id).map((a) => a.type).sort();
    expect(types).toEqual(['DEVICE_DIVERSITY', 'SCAN_VELOCITY']);
  });

  it('cookie-less inflation from one IP is one source: no velocity / diversity finding', async () => {
    const base = Date.parse('2026-09-10T10:00:00.000Z');
    const r = await issueActivated(w);
    for (let i = 0; i < 40; i++) {
      w.clock.set(base + i * 30_000);
      const out = await verify(w, r.code.data, { deviceHash: `fresh-cookie-${i}`, ipHash: 'one-ip', geo: { country: 'FR' } });
      expect(out.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    }
    expect((await anomalies(w)).filter((a) => a.product_id === r.product.id)).toEqual([]);
  });

  describe('registration despite anomaly poisoning', () => {
    async function poisoned(extra: Parameters<typeof issueActivated>[1], base: number) {
      const r = await issueActivated(w, extra);
      let last;
      for (let i = 0; i < 22; i++) {
        w.clock.set(base + i * MIN);
        last = await verify(w, r.code.data, { deviceHash: `poison-${i}`, ipHash: `poison-ip-${i}`, geo: { country: 'FR' } });
      }
      return { r, last: last! };
    }

    it('SUSPICIOUS from the risk score alone, unregistered, with a claim secret → a registration token (claim code required)', async () => {
      const { r, last } = await poisoned({ withClaimSecret: true }, Date.parse('2026-10-01T10:00:00.000Z'));
      expect(last.state).toBe('SUSPICIOUS_ACTIVITY');
      expect(last.registration).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: expect.any(String), claimCodeRequired: true });
      expect(last.product).toBeUndefined();
      expect(last.ownership).toBeUndefined();
      expect((await authEvent(w, last.scanId)).reasons).toEqual(expect.arrayContaining(['RISK_THRESHOLD', 'REGISTRATION_WITH_CLAIM_CODE']));
      // The legitimate buyer holding the certificate claim code registers.
      const buyer = await createAccount(w);
      const reg = await w.ownership.registerFirst(buyer, { registrationToken: last.registration!.token, claimCode: r.claimCode }, { type: 'account', id: buyer });
      expect(reg.verified).toBe(true);
      // Without the claim code the token is useless.
      const again = await poisoned({ withClaimSecret: true }, Date.parse('2026-10-02T10:00:00.000Z'));
      await expect(
        w.ownership.registerFirst(buyer, { registrationToken: again.last.registration!.token }, { type: 'account', id: buyer }),
      ).rejects.toMatchObject({ code: 'CLAIM_CODE_REQUIRED' });
    });

    it('no token without a claim secret', async () => {
      const { last } = await poisoned({}, Date.parse('2026-10-03T10:00:00.000Z'));
      expect(last.state).toBe('SUSPICIOUS_ACTIVITY');
      expect(last.registration).toBeUndefined();
    });

    it('no token when the product is LOST, or the genome mismatches', async () => {
      const r = await issueActivated(w, { withClaimSecret: true });
      const owner = await createAccount(w);
      await registerOwner(w, r, owner, r.claimCode);
      await w.ownership.reportIncident(owner, r.product.productId, 'LOST', { type: 'account', id: owner });
      const lost = await verify(w, r.code.data);
      expect(lost.state).toBe('SUSPICIOUS_ACTIVITY');
      expect(lost.registration).toBeUndefined();

      const g = await issueActivated(w, { withClaimSecret: true });
      const wrong = g.genome.glyphs.map((x) => (x + 1) % 16);
      const out = await verify(w, { code: g.code.data, genome: { glyphs: wrong } });
      expect(out.state).toBe('SUSPICIOUS_ACTIVITY');
      expect(out.registration).toBeUndefined();
    });
  });
});

describe('S-07: public scans of a piece ORBES has not sold yet, and staff scans', () => {
  let w: World;
  let seller: string;
  beforeAll(async () => {
    w = await createWorld();
    // A console user (the sale mode's seller); the request's console session is the route's business (test/api/unsold-scan.test.ts).
    seller = (
      await w.t.db
        .insertInto('admin_users')
        .values({ email: 'seller@orbes.test', email_normalized: 'seller@orbes.test', password_hash: 'scrypt$x', role: 'RETAIL' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(() => w.close());

  const unsoldOf = async (r: { product: { id: string } }) => (await anomalies(w)).filter((a) => a.product_id === r.product.id && a.type === 'UNSOLD_PIECE_SCAN');
  const findingsOf = async (r: { product: { id: string } }) => (await anomalies(w)).filter((a) => a.product_id === r.product.id);

  it('an ISSUED piece scanned by the public: UNSOLD_PIECE_SCAN (MEDIUM, weight 0, with the country), and the customer sees AUTHENTIC as before', async () => {
    const r = await issue(w);
    const out = await verify(w, r.code.data, { deviceHash: 'stranger', ipHash: 'ip-stranger', geo: { country: 'IT' } });
    expect(out.state).toBe('AUTHENTIC');
    expect(out.title).toBe('AUTHENTIC');
    expect(out.message).toBe('This ORBES identity was issued and signed by ORBES and is registered to an active piece.');
    expect(out.notice).toBeUndefined();
    expect(out.registration).toBeUndefined();
    expect(out.warranty).toEqual({ status: 'NOT_STARTED' });
    expect(out.ownership).toEqual({ registered: false, you: false });
    expect(Object.keys(out).sort()).toEqual(['genome', 'message', 'ownership', 'product', 'scanId', 'state', 'title', 'verification', 'verifiedAt', 'warranty']);
    expect(JSON.stringify(out)).not.toMatch(/UNSOLD|ANOMAL|[Aa]nomal|[Rr]isk|ISSUED/);

    const [a, ...more] = await unsoldOf(r);
    expect(more).toEqual([]);
    expect(a).toMatchObject({
      severity: 'MEDIUM',
      risk_score: 0,
      status: 'OPEN',
      occurrences: 1,
      code_id: r.code.id,
      details: { country: 'IT', productStatus: 'ISSUED', scanEventId: out.scanId },
    });
    const ev = await authEvent(w, out.scanId);
    expect(ev).toMatchObject({ state: 'AUTHENTIC', risk_score: 0, reasons: ['ANOMALY:UNSOLD_PIECE_SCAN'] });
    expect(await scanEvent(w, out.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null, device_hash: 'stranger', country: 'IT' });

    // No country known: recorded all the same, the country null.
    const b = await issue(w);
    await verify(w, b.code.data, { deviceHash: 'somewhere' });
    expect((await unsoldOf(b))[0].details).toMatchObject({ country: null, productStatus: 'ISSUED' });
  });

  it('a piece in a pre-sale service (ISSUED → SERVICED) is unsold too; an after-sale service is not', async () => {
    const pre = await issue(w);
    await w.warranty.openService(pre.product.productId, { type: 'CLEANING' }, admin);
    const out = await verify(w, pre.code.data, { deviceHash: 'd', geo: { country: 'FR' } });
    expect(out.state).toBe('AUTHENTIC');
    expect((await unsoldOf(pre))[0]).toMatchObject({ details: { country: 'FR', productStatus: 'SERVICED', preSaleService: true } });

    const after = await issueActivated(w);
    await w.warranty.openService(after.product.productId, { type: 'CLEANING' }, admin);
    expect((await verify(w, after.code.data, { deviceHash: 'd', geo: { country: 'FR' } })).state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect(await findingsOf(after)).toEqual([]);
  });

  it('a sold piece records none: ACTIVATED, then registered to its owner', async () => {
    const r = await issueActivated(w);
    const first = await verify(w, r.code.data, { deviceHash: 'buyer', geo: { country: 'FR' } });
    expect(first.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect((await authEvent(w, first.scanId)).reasons).toEqual([]);
    const owner = await createAccount(w);
    await registerOwner(w, r, owner);
    expect((await verify(w, r.code.data, { deviceHash: 'friend', geo: { country: 'FR' } })).state).toBe('AUTHENTIC_REGISTERED');
    expect(await findingsOf(r)).toEqual([]);
  });

  it('once per piece and per UTC day: later scans that day add nothing, the next day counts once more', async () => {
    const base = Date.parse('2026-06-10T08:00:00.000Z');
    const r = await issue(w);
    const reasons: string[][] = [];
    for (const [i, at] of [base, base + 5 * HOUR, base + 15 * HOUR + 59 * MIN].entries()) {
      w.clock.set(at);
      const out = await verify(w, r.code.data, { deviceHash: `phone-${i}`, ipHash: `ip-${i}`, geo: { country: i === 0 ? 'FR' : 'BE' } });
      expect(out.state).toBe('AUTHENTIC');
      reasons.push((await authEvent(w, out.scanId)).reasons);
    }
    // Every such scan says so in its reasons; one finding, one occurrence, the first scan's details.
    expect(reasons).toEqual([['ANOMALY:UNSOLD_PIECE_SCAN'], ['ANOMALY:UNSOLD_PIECE_SCAN'], ['ANOMALY:UNSOLD_PIECE_SCAN']]);
    let [a, ...more] = await unsoldOf(r);
    expect(more).toEqual([]);
    expect(a).toMatchObject({ occurrences: 1, details: { country: 'FR' } });
    expect(a.last_seen_at.getTime()).toBe(base);

    w.clock.set(base + 16 * HOUR); // 00:00 UTC the next day
    await verify(w, r.code.data, { deviceHash: 'phone-next-day', geo: { country: 'DE' } });
    [a, ...more] = await unsoldOf(r);
    expect(more).toEqual([]);
    expect(a).toMatchObject({ occurrences: 2, details: { country: 'DE' } });
    w.clock.set(Date.parse('2026-06-01T10:00:00.000Z'));
  });

  it('a staff scan (console session) records none and is ADMIN_TEST under its console user, without device, session or account', async () => {
    const r = await issue(w);
    const viewer = await createAccount(w);
    const out = await verify(w, r.code.data, {
      adminId: seller,
      deviceHash: 'counter-tablet',
      sessionHash: 'counter-session',
      accountId: viewer,
      ipHash: 'ip-boutique',
      geo: { country: 'FR' },
      userAgentFamily: 'Safari/iOS',
    });
    expect(out.state).toBe('AUTHENTIC');
    expect(await scanEvent(w, out.scanId)).toMatchObject({
      event_type: 'ADMIN_TEST',
      admin_id: seller,
      device_hash: null,
      session_hash: null,
      account_id: null,
      ip_hash: 'ip-boutique',
      country: 'FR',
      user_agent_family: 'Safari/iOS',
      result_state: 'AUTHENTIC',
    });
    expect((await authEvent(w, out.scanId)).reasons).toEqual([]);
    expect(await findingsOf(r)).toEqual([]);

    // The staff scan did not use up the day: the first public scan still records the finding.
    await verify(w, r.code.data, { deviceHash: 'stranger', geo: { country: 'FR' } });
    expect(await unsoldOf(r)).toHaveLength(1);

    // An id that is not a uuid is no console user: a public scan.
    const other = await issue(w);
    const pub = await verify(w, other.code.data, { adminId: 'seller', deviceHash: 'x' });
    expect(await scanEvent(w, pub.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null, device_hash: 'x' });
  });

  it('a staff scan earns no registration token and leaves no finding, even on an altered genome', async () => {
    const r = await issueActivated(w, { withClaimSecret: true });
    const out = await verify(w, r.code.data, { adminId: seller, geo: { country: 'FR' } });
    // The state a buyer would see, without the token that would let the console user register the piece.
    expect(out.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect(out.registration).toBeUndefined();
    expect(await w.t.db.selectFrom('scan_tokens').select('id_hash').where('product_id', '=', r.product.id).execute()).toEqual([]);

    const glyphs = [...r.genome.glyphs].map((g, i) => (i < 3 ? (g + 1) % 16 : g));
    const altered = await verify(w, { code: r.code.data, genome: { glyphs } }, { adminId: seller });
    expect(altered.state).toBe('SUSPICIOUS_ACTIVITY');
    expect((await authEvent(w, altered.scanId)).reasons).toEqual(['GENOME_MISMATCH']);
    expect(await findingsOf(r)).toEqual([]);
  });

  it('a staff scan reads the public history: a customer’s state, without adding to the findings', async () => {
    const base = Date.parse('2026-06-20T10:00:00.000Z');
    const r = await issueActivated(w);
    for (let i = 0; i < 21; i++) {
      w.clock.set(base + i * MIN);
      await verify(w, r.code.data, { deviceHash: `copy-${i}`, ipHash: `copy-ip-${i}`, geo: { country: 'FR' } });
    }
    const before = await findingsOf(r);
    expect(before.map((a) => a.type).sort()).toEqual(['DEVICE_DIVERSITY', 'SCAN_VELOCITY']);
    w.clock.set(base + 21 * MIN);
    const staff = await verify(w, r.code.data, { adminId: seller, geo: { country: 'FR' } });
    expect(staff.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(staff.registration).toBeUndefined();
    expect(await findingsOf(r)).toEqual(before);
    // Staff scans never count: a burst of them on a quiet piece stays quiet.
    const quiet = await issueActivated(w);
    for (let i = 0; i < 25; i++) {
      w.clock.set(base + HOUR + i * MIN);
      expect((await verify(w, quiet.code.data, { adminId: seller, ipHash: `staff-ip-${i}`, geo: { country: 'FR' } })).state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    }
    expect(await findingsOf(quiet)).toEqual([]);
    w.clock.set(Date.parse('2026-06-01T10:00:00.000Z'));
  });
});

describe('step 11: authenticator policy', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it('a policy requiring unimplemented hardware degrades to CODE_ONLY without changing the state', async () => {
    const r = await issue(w, { authPolicy: 'PRINTED_CODE+SECURE_NFC' });
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('AUTHENTIC');
    expect(out.verification).toMatchObject({ assurance: 'CODE_ONLY', hardwareProofRequired: true });
    const ev = await authEvent(w, out.scanId);
    expect(ev.authenticators).toEqual({
      policy: 'PRINTED_CODE+SECURE_NFC',
      assurance: 'CODE_ONLY',
      results: [{ kind: 'PRINTED_CODE', status: 'PASS' }, { kind: 'SECURE_NFC', status: 'UNSUPPORTED', detail: 'not implemented' }],
    });
  });

  it('the default policy is CODE assurance without hardwareProofRequired', async () => {
    const r = await issue(w);
    const out = await verify(w, r.code.data);
    expect(out.verification?.assurance).toBe('CODE');
    expect(out.verification).not.toHaveProperty('hardwareProofRequired');
  });
});

describe('step 12: persistence', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it('writes one scan event and one authentication event per verification, with the final state', async () => {
    const r = await issueActivated(w);
    const acc = await createAccount(w);
    const out = await verify(
      w,
      { code: r.code.data, client: { rsErrors: 3, rsErasures: 1, moduleSizePx: 4.5, decodeMs: 38, source: 'camera' } },
      { deviceHash: 'dh', sessionHash: 'sh', ipHash: 'ih', accountId: acc, userAgentFamily: 'Mobile Safari', geo: { country: 'fr', region: 'Île-de-France', lat: 48.85661, lon: 2.35222 } },
    );
    const s = await scanEvent(w, out.scanId);
    expect(s).toMatchObject({
      code_id: r.code.id,
      product_id: r.product.id,
      packed_identity: r.product.packedIdentity,
      event_type: 'VERIFY',
      device_hash: 'dh',
      session_hash: 'sh',
      ip_hash: 'ih',
      account_id: acc,
      country: 'FR',
      region: 'Île-de-France',
      user_agent_family: 'Mobile Safari',
      client_metrics: { rsErrors: 3, rsErasures: 1, moduleSizePx: 4.5, decodeMs: 38, source: 'camera' },
      result_state: 'AUTHENTIC_FIRST_REGISTRATION',
    });
    expect(s.lat).toBeCloseTo(48.9, 5);
    expect(s.lon).toBeCloseTo(2.4, 5);
    expect(s.occurred_at.toISOString()).toBe(out.verifiedAt);
    expect(typeof s.latency_ms).toBe('number');
    const events = await w.t.db.selectFrom('authentication_events').selectAll().where('scan_event_id', '=', out.scanId).execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code_id: r.code.id,
      product_id: r.product.id,
      key_id: r.code.keyId,
      signature_valid: true,
      genome_check: 'NOT_PROVIDED',
      state: 'AUTHENTIC_FIRST_REGISTRATION',
      risk_score: 0,
    });
  });

  it('drops invalid metadata instead of storing it', async () => {
    const r = await issue(w);
    const out = await verify(w, { code: r.code.data, client: { rsErrors: -1, decodeMs: Number.NaN, source: 'fax' } as never }, {
      deviceHash: 'x'.repeat(500),
      accountId: 'not-a-uuid',
      geo: { country: 'ZZ', lat: 200, lon: 0 },
      userAgentFamily: 'bad\u0000agent',
    });
    const s = await scanEvent(w, out.scanId);
    expect(s).toMatchObject({ client_metrics: null, device_hash: null, account_id: null, country: null, lat: null, lon: null, user_agent_family: null });
  });

  it('refuses a misconfigured threshold at construction', () => {
    expect(() => new VerificationService({ db: w.t.db, keys: w.keys, anomaly: w.anomaly, config: { anomaly: { ...w.config.anomaly, suspiciousThreshold: 0 } } })).toThrow(TypeError);
  });
});
