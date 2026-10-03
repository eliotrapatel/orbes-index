/**
 * Public response redaction: the exact JSON key set of every state, and a
 * scan of the serialised body for anything internal (risk scores,
 * thresholds, reasons, raw product statuses, row ids, anomaly types).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toBase64Url } from '../../src/core/bytes.js';
import { encodePayload, frameCodeData, signingMessage } from '../../src/core/payload.js';
import { DEFAULT_ANOMALY_CONFIG } from '../../src/server/config.js';
import { PRODUCT_STATUSES, type VerificationState } from '../../src/server/db/schema.js';
import { UNUSUAL_ACTIVITY_OWNER_COPY, VERIFICATION_COPY } from '../../src/server/services/copy.js';
import type { VerifyOutcome } from '../../src/server/services/verification.js';
import { admin, createAccount, createWorld, issue, issueActivated, reframe, registerOwner, verify, type World } from './world.js';

/** Sorted dotted key paths of a JSON value (arrays as `[]`). */
function keyPaths(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? keyPaths(v[0], `${prefix}[]`) : [];
  if (v === null || typeof v !== 'object') return [];
  const out: string[] = [];
  for (const [k, child] of Object.entries(v)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p, ...keyPaths(child, p));
  }
  return out.sort();
}

const BASE = ['message', 'scanId', 'state', 'title', 'verifiedAt'];
const VERIFICATION = ['verification', 'verification.assurance', 'verification.codeVersion', 'verification.genomeVersion', 'verification.issue', 'verification.issuedAt', 'verification.keyId', 'verification.signature'];
const GENOME = ['genome', 'genome.fingerprint', 'genome.glyphs', 'genome.id', 'genome.ids', 'genome.version'];
const PRODUCT = ['product', 'product.care', 'product.category', 'product.category.code', 'product.category.name', 'product.collection', 'product.createdYear', 'product.material', 'product.model', 'product.productId', 'product.type'];
const OWNERSHIP = ['ownership', 'ownership.registered', 'ownership.you'];
const sorted = (...groups: string[][]) => groups.flat().sort();

const EXPECTED_KEYS: Record<VerificationState, string[]> = {
  AUTHENTIC: sorted(BASE, VERIFICATION, GENOME, PRODUCT, OWNERSHIP, ['warranty', 'warranty.status']),
  AUTHENTIC_FIRST_REGISTRATION: sorted(BASE, VERIFICATION, GENOME, PRODUCT, OWNERSHIP, [
    'warranty', 'warranty.endDate', 'warranty.startDate', 'warranty.status',
    'registration', 'registration.claimCodeRequired', 'registration.expiresAt', 'registration.token',
  ]),
  AUTHENTIC_REGISTERED: sorted(BASE, VERIFICATION, GENOME, PRODUCT, OWNERSHIP, ['warranty', 'warranty.endDate', 'warranty.startDate', 'warranty.status']),
  AUTHENTIC_OWNERSHIP_VERIFIED: sorted(BASE, VERIFICATION, GENOME, PRODUCT, OWNERSHIP, ['warranty', 'warranty.endDate', 'warranty.startDate', 'warranty.status']),
  SUSPICIOUS_ACTIVITY: sorted(BASE, VERIFICATION, GENOME),
  REVOKED: sorted(BASE, VERIFICATION, GENOME),
  UNKNOWN: sorted(BASE),
  INVALID_SIGNATURE: sorted(BASE),
  MALFORMED_CODE: sorted(BASE),
};

// Checked against each key segment.
const FORBIDDEN_KEY = /risk|score|threshold|reason|internal|anomal|finding|^status$|uuid|hash|account|device|^ip|latency|policy|nonce|payload|signatureValid|weight|decay/i;
const ALLOWED_KEYS = new Set(['warranty.status']);

function assertNoLeak(out: VerifyOutcome, secrets: string[]): void {
  for (const k of keyPaths(out)) {
    if (ALLOWED_KEYS.has(k)) continue;
    for (const seg of k.replace(/\[\]/g, '').split('.')) expect(seg, `key ${k}`).not.toMatch(FORBIDDEN_KEY);
  }
  const body = JSON.stringify(out);
  // Internal vocabulary and threshold values never appear.
  for (const word of ['risk', 'score', 'threshold', 'ANOMALY', 'IMPOSSIBLE_TRAVEL', 'RISK_THRESHOLD', 'BAD_SIGNATURE', 'UNKNOWN_KEY', 'KEY_REVOKED', 'CODE_MISMATCH', 'GENOME_MISMATCH']) {
    expect(body).not.toContain(word);
  }
  // Raw product statuses (REVOKED doubles as a public state name; ACTIVE as a warranty status).
  for (const s of PRODUCT_STATUSES.filter((s) => s !== 'REVOKED')) expect(body).not.toMatch(new RegExp(`"${s}"`));
  for (const s of secrets) expect(body).not.toContain(s);
}

describe('public response redaction', () => {
  let w: World;
  const seen = new Map<VerificationState, VerifyOutcome>();
  const secrets: string[] = [];

  beforeAll(async () => {
    w = await createWorld();
    const record = (o: VerifyOutcome) => {
      seen.set(o.state, o);
      return o;
    };

    const issued = await issue(w);
    secrets.push(issued.product.id, issued.code.id, issued.code.payloadHash);
    record(await verify(w, issued.code.data));

    const fresh = await issueActivated(w);
    secrets.push(fresh.product.id);
    record(await verify(w, fresh.code.data));

    const owned = await issueActivated(w);
    const owner = await createAccount(w);
    secrets.push(owner, owned.product.id);
    await registerOwner(w, owned, owner);
    record(await verify(w, owned.code.data));
    record(await verify(w, owned.code.data, { accountId: owner }));

    const travelled = await issueActivated(w);
    const t0 = w.clock.now().getTime();
    for (const [i, c] of ['FR', 'JP', 'US'].entries()) {
      w.clock.set(t0 + i * 60_000);
      const o = await verify(w, travelled.code.data, { deviceHash: `d-${c}`, ipHash: `ip-${c}`, geo: { country: c } });
      if (i === 2) record(o);
    }
    secrets.push('d-US', 'ip-US');
    w.clock.set(t0);

    const revoked = await issue(w);
    await w.lifecycle.transition(revoked.product.productId, 'REVOKED', { reason: 'counterfeit seized' }, admin);
    secrets.push('counterfeit seized');
    record(await verify(w, revoked.code.data));

    const signer = await w.keys.activeSigner();
    const payload = encodePayload({ codeVersion: 1, genomeVersion: 1, keyId: signer.keyId, identity: { year: 2026, categoryIndex: 1, serial: 55_555 }, issue: 1, issuedDay: 900, nonce: new Uint8Array(4) });
    record(await verify(w, toBase64Url(frameCodeData(payload, await signer.sign(signingMessage(payload))))));

    record(await verify(w, reframe(issued.code.data, { signature: (s) => void (s[0] ^= 1) })));
    record(await verify(w, 'garbage!'));
  });
  afterAll(() => w.close());

  it('covers all nine states', () => {
    expect([...seen.keys()].sort()).toEqual(Object.keys(EXPECTED_KEYS).sort());
  });

  for (const state of Object.keys(EXPECTED_KEYS) as VerificationState[]) {
    it(`${state}: exact key set, brand copy, nothing internal`, () => {
      const out = seen.get(state)!;
      expect(out).toBeDefined();
      expect(keyPaths(out)).toEqual(EXPECTED_KEYS[state]);
      expect(out.title).toBe(VERIFICATION_COPY[state].title);
      expect(out.message).toBe(VERIFICATION_COPY[state].message);
      assertNoLeak(out, secrets);
    });
  }

  it('the owner notice adds only `notice` and owner copy', async () => {
    // Reuse the travelled pattern on an owned product.
    const r = await issueActivated(w);
    const owner = await createAccount(w);
    await registerOwner(w, r, owner);
    const t0 = w.clock.now().getTime();
    for (const [i, c] of ['FR', 'JP', 'US'].entries()) {
      w.clock.set(t0 + i * 60_000);
      await verify(w, r.code.data, { deviceHash: `n-${c}`, geo: { country: c } });
    }
    const out = await verify(w, r.code.data, { accountId: owner });
    w.clock.set(t0);
    expect(out.state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');
    expect(keyPaths(out)).toEqual(sorted(EXPECTED_KEYS.AUTHENTIC_OWNERSHIP_VERIFIED, ['notice']));
    expect(out.notice).toBe('UNUSUAL_ACTIVITY');
    assertNoLeak(out, [owner, r.product.id]);
  });

  it('no copy claims physical authenticity or names internal causes', () => {
    for (const { title, message } of Object.values(VERIFICATION_COPY)) {
      const text = `${title} ${message}`;
      expect(text).not.toMatch(/genuine|real product|guarantee|physical|counterfeit|stolen|lost|risk|score|anomal/i);
    }
    expect(VERIFICATION_COPY.AUTHENTIC.message).toBe(
      'This ORBES identity was issued and signed by ORBES and is registered to an active piece.',
    );
    // Customer vocabulary: the object is a "piece", never a "product".
    for (const { message } of Object.values(VERIFICATION_COPY)) expect(message).not.toMatch(/\bproducts?\b/i);
    expect(UNUSUAL_ACTIVITY_OWNER_COPY.message).not.toMatch(/\bproducts?\b/i);
  });

  it('SUSPICIOUS from the risk score alone with a claim secret adds only `registration` (claim code required)', async () => {
    const r = await issueActivated(w, { withClaimSecret: true });
    const t0 = w.clock.now().getTime();
    let out: VerifyOutcome | undefined;
    for (let i = 0; i < 22; i++) {
      w.clock.set(t0 + i * 60_000);
      out = await verify(w, r.code.data, { deviceHash: `burst-${i}`, ipHash: `burst-ip-${i}`, geo: { country: 'FR' } });
    }
    w.clock.set(t0);
    expect(out!.state).toBe('SUSPICIOUS_ACTIVITY');
    expect(keyPaths(out)).toEqual(
      sorted(EXPECTED_KEYS.SUSPICIOUS_ACTIVITY, ['registration', 'registration.claimCodeRequired', 'registration.expiresAt', 'registration.token']),
    );
    expect(out!.registration?.claimCodeRequired).toBe(true);
    assertNoLeak(out!, [r.product.id, r.claimCode!, 'burst-21', 'burst-ip-21']);
  });

  it('a signed-in reader of a piece whose transfer is pending (F-03) adds only `transfer` and `ownership.transferPending`', async () => {
    const r = await issueActivated(w);
    const owner = await createAccount(w);
    await registerOwner(w, r, owner);
    await w.ownership.initiateTransfer(owner, r.product.productId, { type: 'account', id: owner });
    const buyer = await createAccount(w);
    const out = await verify(w, r.code.data, { accountId: buyer, deviceHash: 'buyer-device', ipHash: 'buyer-ip' });
    expect(out.state).toBe('AUTHENTIC_REGISTERED');
    expect(keyPaths(out)).toEqual(sorted(EXPECTED_KEYS.AUTHENTIC_REGISTERED, ['ownership.transferPending', 'transfer', 'transfer.expiresAt', 'transfer.token']));
    // The token itself, never its hash, the scan's account or the owner's.
    const row = await w.t.db.selectFrom('scan_tokens').selectAll().where('scan_event_id', '=', out.scanId).executeTakeFirstOrThrow();
    assertNoLeak(out, [owner, buyer, r.product.id, Buffer.from(row.id_hash).toString('hex'), Buffer.from(row.id_hash).toString('base64url'), 'buyer-device', 'buyer-ip']);
    // Signed out, the same piece: no token, the same keys as any registered piece with a pending transfer.
    const anon = await verify(w, r.code.data);
    expect(keyPaths(anon)).toEqual(sorted(EXPECTED_KEYS.AUTHENTIC_REGISTERED, ['ownership.transferPending']));
  });

  it('a model PUBLIC in the lookbook (P-R02) adds only `product.lookbook`, its address; a RESERVED one adds nothing', async () => {
    const r = await issue(w);
    await w.t.db.updateTable('models').set({ slug: 'redaction-ring', lookbook: 'PUBLIC', published_at: w.clock.now() }).where('id', '=', w.modelId).execute();
    try {
      const out = await verify(w, r.code.data);
      expect(out.state).toBe('AUTHENTIC');
      expect(keyPaths(out)).toEqual(sorted(EXPECTED_KEYS.AUTHENTIC, ['product.lookbook']));
      expect(out.product?.lookbook).toBe('redaction-ring');
      assertNoLeak(out, [r.product.id, w.modelId]);
      await w.t.db.updateTable('models').set({ lookbook: 'RESERVED' }).where('id', '=', w.modelId).execute();
      expect(keyPaths(await verify(w, r.code.data))).toEqual(EXPECTED_KEYS.AUTHENTIC);
      // Never on a result that is not authentic.
      await w.lifecycle.transition(r.product.productId, 'REVOKED', { reason: 'test' }, admin);
      await w.t.db.updateTable('models').set({ lookbook: 'PUBLIC' }).where('id', '=', w.modelId).execute();
      expect(keyPaths(await verify(w, r.code.data))).toEqual(EXPECTED_KEYS.REVOKED);
    } finally {
      await w.t.db.updateTable('models').set({ lookbook: 'HIDDEN' }).where('id', '=', w.modelId).execute();
    }
  });

  it('threshold values never appear as numbers in any body', () => {
    for (const out of seen.values()) {
      const body = JSON.stringify({ ...out, scanId: '', verifiedAt: '', registration: undefined, genome: undefined, verification: undefined });
      for (const n of [DEFAULT_ANOMALY_CONFIG.suspiciousThreshold, DEFAULT_ANOMALY_CONFIG.impossibleTravelKmh, DEFAULT_ANOMALY_CONFIG.minTravelKm]) {
        expect(body).not.toMatch(new RegExp(`\\b${n}\\b`));
      }
    }
  });
});
