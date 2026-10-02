import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { fromBase64Url, toHex } from '../../src/core/bytes.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { decodePayload, signingMessage, unframeCodeData } from '../../src/core/payload.js';
import { verifyCodeSignature } from '../../src/core/verify/ed25519.js';
import { verifyEd25519Node } from '../../src/server/crypto/ed25519-node.js';
import { DomainError } from '../../src/server/errors.js';
import { KeyService, MemoryKeyProvider, type KeyProvider } from '../../src/server/keys/index.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { verifyClaimCode } from '../../src/server/services/claim-codes.js';
import { deriveSku, ISSUE_BATCH_ACTION, IssuanceService, MAX_ISSUE_BATCH, normalizeAuthPolicy, type IssueProductInput } from '../../src/server/services/issuance.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { requireDecoder } from '../render/decoder-support.js';

const admin: Actor = { type: 'admin', id: 'admin-7', ipHash: 'iphash' };

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());

interface World {
  t: TestDb;
  clock: ManualClock;
  audit: AuditService;
  categories: CategoryRegistry;
  provider: MemoryKeyProvider;
  keys: KeyService;
  issuance: IssuanceService;
  modelId: string;
  leatherModelId: string;
  collectionId: string;
}

async function world(): Promise<World> {
  const t = await createTestDb();
  const clock = createManualClock('2026-05-14T09:30:00.000Z');
  const audit = new AuditService({ db: t.db, clock: clock.now });
  const categories = new CategoryRegistry({ db: t.db, audit, clock: clock.now });
  await categories.load();
  await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, admin);
  await categories.create({ code: 'L', name: 'Leather goods', warrantyMonths: 12 }, admin);
  const col = await t.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
  const model = await t.db
    .insertInto('models')
    .values({ category_id: 1, collection_id: col.id, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-RG', default_material: '925 STERLING SILVER' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const leather = await t.db
    .insertInto('models')
    .values({ category_id: 2, name: 'ECLIPSE', type: 'WALLET', sku_prefix: 'ECL-WL' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const provider = new MemoryKeyProvider({ env: 'test' });
  const keys = new KeyService({ db: t.db, provider, audit, clock: clock.now });
  await keys.rotate(admin, 'orbes-test-k1');
  const issuance = new IssuanceService({ db: t.db, keys, audit, categories, clock: clock.now });
  return { t, clock, audit, categories, provider, keys, issuance, modelId: model.id, leatherModelId: leather.id, collectionId: col.id };
}

const ring = (w: World, extra: Partial<IssueProductInput> = {}): IssueProductInput => ({
  categoryCode: 'J',
  modelId: w.modelId,
  material: '925 STERLING SILVER',
  ...extra,
});

describe('IssuanceService.issueProduct', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.t.close());

  it('issues product, genome, signed code, warranty, status history and audit in one go', async () => {
    const r = await w.issuance.issueProduct(
      ring(w, { variant: 'Size 52', productionBatch: 'B-2026-05', productionDate: '2026-05-02', collectionId: w.collectionId }),
      admin,
    );
    const { product, genome, code } = r;
    expect(r.claimCode).toBeUndefined();

    // Product.
    expect(product).toMatchObject({
      productId: 'O26-J-00001',
      year: 2026,
      categoryIndex: 1,
      categoryCode: 'J',
      serial: 1,
      sku: 'MNL-RG-SIZE-52',
      variant: 'Size 52',
      material: '925 STERLING SILVER',
      productionBatch: 'B-2026-05',
      productionDate: '2026-05-02',
      status: 'ISSUED',
      ownershipState: 'UNREGISTERED',
      authPolicy: 'PRINTED_CODE',
      hasClaimSecret: false,
    });
    const packed = packIdentity({ year: 2026, categoryIndex: 1, serial: 1 });
    expect(product.packedIdentity).toBe(packed);
    expect(product.createdAt.toISOString()).toBe('2026-05-14T09:30:00.000Z');

    // Genome: exactly computeGenome of the packed identity.
    const expected = computeGenome(packed, 1);
    expect(genome).toMatchObject({
      productUuid: product.id,
      productId: 'O26-J-00001',
      version: 1,
      value: expected.value,
      glyphs: expected.glyphs,
      ids: expected.ids,
      pattern: expected.ids.join('·'),
      fingerprint: expected.fingerprint,
    });

    // Code: payload fields, hash, signature against the STORED public key.
    expect(code).toMatchObject({ productUuid: product.id, productId: 'O26-J-00001', genomeUuid: genome.id, keyId: 1, issue: 1, codeVersion: 1, status: 'ACTIVE' });
    const row = await w.t.db.selectFrom('codes').selectAll().where('id', '=', code.id).executeTakeFirstOrThrow();
    const payload = decodePayload(row.payload);
    expect(payload).toMatchObject({ codeVersion: 1, genomeVersion: 1, keyId: 1, issue: 1, identity: { year: 2026, categoryIndex: 1, serial: 1 } });
    expect(payload.issuedDay).toBe(Math.floor((Date.UTC(2026, 4, 14) - Date.UTC(2024, 0, 1)) / 86_400_000));
    expect(code.issuedAt).toBe('2026-05-14');
    expect(row.nonce).toEqual(payload.nonce);
    expect(row.payload_hash).toEqual(sha256(row.payload));
    expect(code.payloadHash).toBe(toHex(sha256(row.payload)));
    const keyRow = await w.t.db.selectFrom('cryptographic_keys').selectAll().where('key_id', '=', row.key_id).executeTakeFirstOrThrow();
    expect(verifyEd25519Node(keyRow.public_key, signingMessage(row.payload), row.signature)).toBe(true);
    expect(verifyCodeSignature(keyRow.public_key, row.payload, row.signature)).toBe(true);

    // The framed data a scanner reads round-trips.
    const framed = unframeCodeData(fromBase64Url(code.data));
    expect(framed.payloadBytes).toEqual(row.payload);
    expect(framed.signature).toEqual(row.signature);

    // Warranty (not started; duration from the category), status history, audit.
    const warranty = await w.t.db.selectFrom('warranties').selectAll().where('product_id', '=', product.id).executeTakeFirstOrThrow();
    expect(warranty).toMatchObject({ duration_months: 24, start_date: null, end_date: null, purchase_date: null });
    const history = await w.t.db.selectFrom('product_status_history').selectAll().where('product_id', '=', product.id).execute();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from_status: null, to_status: 'ISSUED', actor_type: 'admin', actor_id: 'admin-7' });
    const audit = await w.audit.list({ action: 'product.issue', targetId: 'O26-J-00001' });
    expect(audit.total).toBe(1);
    expect(audit.items[0]).toMatchObject({ actorType: 'admin', actorId: 'admin-7', ipHash: 'iphash' });
    expect(audit.items[0].details).toMatchObject({ codeId: code.id, keyId: 1, genomeFingerprint: expected.fingerprint, claimSecret: false });

    // The overview view sees the active code and the genome.
    const ov = await w.t.db.selectFrom('product_overview').selectAll().where('id', '=', product.id).executeTakeFirstOrThrow();
    expect(ov).toMatchObject({ category: 'Jewelry', collection: 'ORBIT', model: 'MONOLITHE', code_id: code.id, genome_pattern: genome.pattern });
  });

  it('issues 50 products concurrently with unique, gap-free serials', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => w.issuance.issueProduct(ring(w, { year: 2027 }), admin)));
    const serials = results.map((r) => r.product.serial).sort((a, b) => a - b);
    expect(new Set(serials).size).toBe(50);
    expect(serials).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.product.productId)).size).toBe(50);
    expect(new Set(results.map((r) => r.genome.fingerprint)).size).toBe(50);
    expect(new Set(results.map((r) => r.code.nonce)).size).toBeGreaterThan(45); // 32-bit random nonces
    const keyRow = await w.t.db.selectFrom('cryptographic_keys').selectAll().where('key_id', '=', 1).executeTakeFirstOrThrow();
    for (const r of results) {
      expect(r.genome.glyphs).toEqual(computeGenome(r.product.packedIdentity).glyphs);
      expect(verifyEd25519Node(keyRow.public_key, signingMessage(r.code.payload), r.code.signature)).toBe(true);
    }
    expect((await w.audit.verifyChain()).ok).toBe(true);
  });

  it('accepts an explicit serial, refuses a taken one, and continues after the highest', async () => {
    const r = await w.issuance.issueProduct(ring(w, { year: 2025, serial: 184 }), admin);
    expect(r.product.productId).toBe('O25-J-00184');
    expect((await domainError(w.issuance.issueProduct(ring(w, { year: 2025, serial: 184 }), admin))).code).toBe('SERIAL_TAKEN');
    expect((await w.issuance.issueProduct(ring(w, { year: 2025 }), admin)).product.serial).toBe(185);
    const six = await w.issuance.issueProduct(ring(w, { year: 2025, serial: 123456 }), admin);
    expect(six.product.productId).toBe('O25-J-123456');
  });

  it('allocates serials per year and category', async () => {
    const l = await w.issuance.issueProduct({ categoryCode: 'l', modelId: w.leatherModelId, material: 'CALF LEATHER', year: 2025 }, admin);
    expect(l.product).toMatchObject({ productId: 'O25-L-00001', categoryIndex: 2, sku: 'ECL-WL' });
    const warranty = await w.t.db.selectFrom('warranties').select('duration_months').where('product_id', '=', l.product.id).executeTakeFirstOrThrow();
    expect(warranty.duration_months).toBe(12);
  });

  it('issues a claim code once, stores only its scrypt hash, keeps it out of the audit log', async () => {
    const r = await w.issuance.issueProduct(ring(w, { withClaimSecret: true }), admin);
    expect(r.claimCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(r.product.hasClaimSecret).toBe(true);
    const row = await w.t.db.selectFrom('products').select('claim_secret_hash').where('id', '=', r.product.id).executeTakeFirstOrThrow();
    expect(row.claim_secret_hash).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(await verifyClaimCode(r.claimCode, row.claim_secret_hash!)).toBe(true);
    expect(await verifyClaimCode('0000-0000-0000', row.claim_secret_hash!)).toBe(false);
    const entries = await w.audit.list({ targetId: r.product.productId });
    expect(JSON.stringify(entries)).not.toContain(r.claimCode!.slice(0, 4) + '-' + r.claimCode!.slice(5, 9));
    expect(entries.items[0].details).toMatchObject({ claimSecret: true });
    expect(JSON.stringify(r.product)).not.toContain('scrypt');
  });

  it('defaults the year to the clock year (UTC) and normalises the auth policy', async () => {
    w.clock.set('2028-01-01T00:00:00.000Z');
    const r = await w.issuance.issueProduct(ring(w, { authPolicy: 'printed_code+secure_nfc' }), admin);
    expect(r.product.year).toBe(2028);
    expect(r.product.productId).toBe('O28-J-00001');
    expect(r.product.authPolicy).toBe('PRINTED_CODE+SECURE_NFC');
    w.clock.set('2026-05-14T09:30:00.000Z');
  });

  it('validates input with precise errors and writes nothing on failure', async () => {
    const before = await w.t.db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const cases: [IssueProductInput | Record<string, unknown>, string][] = [
      [ring(w, { categoryCode: 'Z' }), 'CATEGORY_NOT_FOUND'],
      [ring(w, { categoryCode: 'JJ' }), 'VALIDATION_FAILED'],
      [ring(w, { categoryCode: 'L' }), 'VALIDATION_FAILED'], // model belongs to J
      [ring(w, { modelId: '00000000-0000-4000-8000-000000000000' }), 'MODEL_NOT_FOUND'],
      [ring(w, { modelId: 'not-a-uuid' }), 'VALIDATION_FAILED'],
      [ring(w, { collectionId: '00000000-0000-4000-8000-000000000000' }), 'COLLECTION_NOT_FOUND'],
      [ring(w, { material: '   ' }), 'VALIDATION_FAILED'],
      [ring(w, { material: 'silver\u0000' }), 'VALIDATION_FAILED'],
      [ring(w, { productionDate: '2026-02-30' }), 'VALIDATION_FAILED'],
      [ring(w, { productionDate: '2027-01-01' }), 'VALIDATION_FAILED'], // future
      [ring(w, { year: 1999 }), 'VALIDATION_FAILED'],
      [ring(w, { serial: 0 }), 'VALIDATION_FAILED'],
      [ring(w, { serial: 1_000_000 }), 'VALIDATION_FAILED'],
      [ring(w, { sku: '../../etc' }), 'VALIDATION_FAILED'],
      [ring(w, { authPolicy: 'SECURE_NFC' }), 'VALIDATION_FAILED'], // must include the printed code
      [ring(w, { authPolicy: 'PRINTED_CODE+MAGIC' }), 'VALIDATION_FAILED'],
      [{ ...ring(w), isAdmin: true }, 'VALIDATION_FAILED'],
    ];
    for (const [input, code] of cases) {
      const e = await domainError(w.issuance.issueProduct(input as IssueProductInput, admin));
      expect(e.code, JSON.stringify(input)).toBe(code);
    }
    const after = await w.t.db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it('refuses an inactive category', async () => {
    await w.categories.create({ code: 'W', name: 'Watches' }, admin);
    await w.categories.setActive('W', false, admin);
    const m = await w.t.db
      .insertInto('models')
      .values({ category_id: 3, name: 'HORIZON', type: 'WATCH', sku_prefix: 'HRZ' })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await domainError(w.issuance.issueProduct({ categoryCode: 'W', modelId: m.id, material: 'STEEL' }, admin))).code).toBe(
      'CATEGORY_INACTIVE',
    );
  });

  it('treats empty optional form fields as absent', async () => {
    const r = await w.issuance.issueProduct(
      { ...ring(w), variant: '', sku: '', productionBatch: '', productionDate: '', collectionId: '' } as unknown as IssueProductInput,
      admin,
    );
    expect(r.product).toMatchObject({ variant: null, sku: 'MNL-RG', productionBatch: null, productionDate: null, collectionId: null });
  });
});

describe('IssuanceService keys and transactions', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });
  afterAll(async () => {
    await w?.t.close();
  });

  it('signs with the active key after rotation; codes of the retired key stay verifiable', async () => {
    const first = await w.issuance.issueProduct(ring(w), admin);
    await w.keys.rotate(admin);
    const second = await w.issuance.issueProduct(ring(w), admin);
    expect(first.code.keyId).toBe(1);
    expect(second.code.keyId).toBe(2);
    const k1 = await w.keys.publicKey(1);
    expect(k1?.status).toBe('RETIRED');
    expect(verifyEd25519Node(k1!.publicKey, signingMessage(first.code.payload), first.code.signature)).toBe(true);
    await w.t.close();
  });

  it('retries with the new key when another instance rotated meanwhile (stale cached signer)', async () => {
    await w.keys.activeSigner(); // cache key 1 in this instance
    const otherInstance = new KeyService({ db: w.t.db, provider: w.provider, audit: w.audit, clock: w.clock.now });
    await otherInstance.rotate(admin); // key 1 RETIRED, key 2 ACTIVE — unseen by w.keys' cache
    const r = await w.issuance.issueProduct(ring(w), admin);
    expect(r.code.keyId).toBe(2);
    expect(decodePayload(r.code.payload).keyId).toBe(2);
    await w.t.close();
  });

  it('without an active key nothing is issued (503) and nothing is written', async () => {
    await w.keys.retire(1, admin);
    const e = await domainError(w.issuance.issueProduct(ring(w), admin));
    expect(e).toMatchObject({ code: 'NO_ACTIVE_KEY', httpStatus: 503 });
    expect(await w.t.db.selectFrom('products').selectAll().execute()).toEqual([]);
    await w.t.close();
  });

  it('a signing failure rolls the whole issuance back', async () => {
    const failing: KeyProvider = {
      name: 'memory',
      generate: (kid) => w.provider.generate(kid),
      sign: async () => {
        throw new Error('HSM offline');
      },
    };
    const keys = new KeyService({ db: w.t.db, provider: failing, audit: w.audit, clock: w.clock.now });
    const issuance = new IssuanceService({ db: w.t.db, keys, audit: w.audit, categories: w.categories, clock: w.clock.now });
    const auditBefore = (await w.audit.list()).total;
    const e = await domainError(issuance.issueProduct(ring(w), admin));
    expect(e.code).toBe('SIGNING_UNAVAILABLE');
    for (const table of ['products', 'genomes', 'codes', 'warranties', 'product_status_history'] as const) {
      expect(await w.t.db.selectFrom(table).selectAll().execute(), table).toEqual([]);
    }
    expect((await w.audit.list()).total).toBe(auditBefore);
    // The serial was not consumed.
    expect((await w.issuance.issueProduct(ring(w), admin)).product.serial).toBe(1);
    await w.t.close();
  });
});

describe('IssuanceService.reissueCode', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.t.close());

  it('supersedes the active code and signs issue+1 for the same genome', async () => {
    const { product, genome, code } = await w.issuance.issueProduct(ring(w), admin);
    w.clock.advance(3 * 86_400_000);
    const next = await w.issuance.reissueCode('O26-J-00001', 'Engraving damaged', admin);
    expect(next).toMatchObject({ issue: 2, status: 'ACTIVE', genomeUuid: genome.id, productUuid: product.id, keyId: 1, issuedAt: '2026-05-17' });
    expect(next.nonce).not.toBe(code.nonce);
    const p2 = decodePayload(next.payload);
    expect(p2.identity).toEqual({ year: 2026, categoryIndex: 1, serial: 1 });
    expect(p2.issue).toBe(2);
    const k = await w.keys.publicKey(1);
    expect(verifyEd25519Node(k!.publicKey, signingMessage(next.payload), next.signature)).toBe(true);

    const old = await w.t.db.selectFrom('codes').selectAll().where('id', '=', code.id).executeTakeFirstOrThrow();
    expect(old).toMatchObject({ status: 'SUPERSEDED', revocation_reason: 'Engraving damaged' });
    expect(old.revoked_at?.toISOString()).toBe('2026-05-17T09:30:00.000Z');
    const audit = await w.audit.list({ action: 'code.reissue' });
    expect(audit.items[0].details).toMatchObject({ supersededCodeIds: [code.id], previousIssue: 1, issue: 2, codeId: next.id });

    // By row uuid as well; the genome never changes.
    const third = await w.issuance.reissueCode(product.id, 'Customer request', admin);
    expect(third.issue).toBe(3);
    expect(third.genomeUuid).toBe(genome.id);
    const active = await w.t.db.selectFrom('codes').select(['issue']).where('product_id', '=', product.id).where('status', '=', 'ACTIVE').execute();
    expect(active).toEqual([{ issue: 3 }]);
  });

  it('validates the product, its status and the reason', async () => {
    expect((await domainError(w.issuance.reissueCode('O26-J-99999', 'x', admin))).code).toBe('PRODUCT_NOT_FOUND');
    expect((await domainError(w.issuance.reissueCode('garbage', 'x', admin))).code).toBe('PRODUCT_NOT_FOUND');
    expect((await domainError(w.issuance.reissueCode('O26-J-00001', '  ', admin))).code).toBe('VALIDATION_FAILED');
    const { product } = await w.issuance.issueProduct(ring(w), admin);
    await w.t.db.updateTable('products').set({ status: 'RETIRED' }).where('id', '=', product.id).execute();
    expect((await domainError(w.issuance.reissueCode(product.productId, 'x', admin))).code).toBe('PRODUCT_NOT_REISSUABLE');
  });

  it('stops at issue 255', async () => {
    const { product, genome } = await w.issuance.issueProduct(ring(w), admin);
    // Fast-forward: pretend 254 more issues exist (all superseded).
    await w.t.db.updateTable('codes').set({ status: 'SUPERSEDED' }).where('product_id', '=', product.id).execute();
    const signer = await w.keys.activeSigner();
    for (let issue = 2; issue <= 255; issue++) {
      const payload = new Uint8Array(13);
      payload[0] = 0x11;
      payload[1] = 1;
      payload[6] = issue;
      payload.set([issue, 0, 0, 1], 9);
      await w.t.db
        .insertInto('codes')
        .values({
          product_id: product.id,
          genome_id: genome.id,
          key_id: signer.keyId,
          code_version: 1,
          issue,
          issued_day: 0,
          nonce: payload.slice(9),
          payload,
          signature: new Uint8Array(64),
          payload_hash: sha256(payload),
          status: issue === 255 ? 'ACTIVE' : 'SUPERSEDED',
        })
        .execute();
    }
    expect((await domainError(w.issuance.reissueCode(product.productId, 'again', admin))).code).toBe('ISSUES_EXHAUSTED');
  });
});

describe('IssuanceService.revokeCode', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.t.close());

  it('revokes one code with a revocations row and an audit entry; the product keeps its identity', async () => {
    const { product, code } = await w.issuance.issueProduct(ring(w), admin);
    w.clock.advance(60_000);
    const r = await w.issuance.revokeCode(code.id, '  Label printed twice  ', admin);
    expect(r).toMatchObject({ id: code.id, productId: product.productId, status: 'REVOKED', revocationReason: 'Label printed twice' });
    expect(r.revokedAt?.toISOString()).toBe('2026-05-14T09:31:00.000Z');
    const rev = await w.t.db.selectFrom('revocations').selectAll().where('target_type', '=', 'CODE').where('target_id', '=', code.id).executeTakeFirstOrThrow();
    expect(rev).toMatchObject({ reason_code: 'CODE_REVOKED', reason: 'Label printed twice', created_by: 'admin:admin-7' });
    const entry = (await w.audit.list({ action: 'code.revoke' })).items[0];
    expect(entry).toMatchObject({ targetType: 'code', targetId: code.id, details: { productId: product.productId, issue: 1, previousStatus: 'ACTIVE' } });
    // A new code can be issued for the same identity.
    expect((await w.issuance.reissueCode(product.productId, 'replacement label', admin)).issue).toBe(2);
  });

  it('validates the code id, the reason and refuses a second revocation', async () => {
    const { code } = await w.issuance.issueProduct(ring(w), admin);
    expect((await domainError(w.issuance.revokeCode('not-a-uuid', 'x', admin))).code).toBe('CODE_NOT_FOUND');
    expect((await domainError(w.issuance.revokeCode('00000000-0000-4000-8000-000000000000', 'x', admin))).code).toBe('CODE_NOT_FOUND');
    expect((await domainError(w.issuance.revokeCode(code.id, '   ', admin))).code).toBe('VALIDATION_FAILED');
    await w.issuance.revokeCode(code.id, 'lost roll of labels', admin);
    expect((await domainError(w.issuance.revokeCode(code.id, 'again', admin))).code).toBe('CODE_ALREADY_REVOKED');
  });
});

describe('IssuanceService.renderCode', () => {
  let w: World;
  let codeId: string;
  let productId: string;
  beforeAll(async () => {
    w = await world();
    const r = await w.issuance.issueProduct(ring(w, { serial: 184 }), admin);
    codeId = r.code.id;
    productId = r.product.productId;
  });
  afterAll(() => w.t.close());

  it('renders SVG with the core renderer', async () => {
    const svg = await w.issuance.renderCode(codeId, 'svg');
    expect(svg.contentType).toMatch(/^image\/svg\+xml/);
    expect(svg.filename).toBe('ORBES-O26-J-00184-I1-classic-30mm.svg');
    const body = svg.body as string;
    expect(body.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-25 -25 50 50" width="30mm" height="30mm">')).toBe(true);
    expect(body).toContain('<title>ORBES CODE O26-J-00184</title>');
    expect(body.trimEnd().endsWith('</svg>')).toBe(true);
    // Deterministic: same code, same options, same bytes.
    expect((await w.issuance.renderCode(codeId, 'svg')).body).toBe(body);
  });

  it('renders a labeled ivory SVG print sheet', async () => {
    const svg = await w.issuance.renderCode(codeId, 'svg', { theme: 'ivory', label: true, widthMm: 40, decor: false });
    const body = svg.body as string;
    expect(svg.filename).toBe('ORBES-O26-J-00184-I1-ivory-40mm-label.svg');
    expect(body).toContain('viewBox="-25 -25 50 57.5" width="40mm" height="46mm"');
    expect(body).toContain('fill="#F6F2EA"');
    expect(body).toContain('data-layer="label"');
    expect(body).not.toContain('data-layer="decor"');
  });

  it('renders PNG (signature bytes, size from widthMm × dpi, pHYs) that decodes back to the code', async () => {
    const png = await w.issuance.renderCode(codeId, 'png', { widthMm: 30, dpi: 300 });
    expect(png.contentType).toBe('image/png');
    const bytes = png.body as Uint8Array;
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const img = PNG.sync.read(Buffer.from(bytes));
    expect(img.width).toBe(354); // 30 mm at 300 dpi
    expect(img.height).toBe(354);

    const decoder = await requireDecoder();
    const res = decoder.decodeOrbesCode(decoder.rgbaToGray(img.data, img.width, img.height), { readGenome: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const row = await w.t.db.selectFrom('codes').selectAll().where('id', '=', codeId).executeTakeFirstOrThrow();
      expect(res.payloadBytes).toEqual(row.payload);
      expect(res.signature).toEqual(row.signature);
      // What a scanner reads is exactly the stored code, signed by the registered key.
      const key = await w.keys.publicKey(decodePayload(res.payloadBytes).keyId);
      expect(verifyEd25519Node(key!.publicKey, signingMessage(res.payloadBytes), res.signature)).toBe(true);
      const genome = await w.t.db.selectFrom('genomes').select('glyphs').where('id', '=', row.genome_id).executeTakeFirstOrThrow();
      expect(res.genome?.glyphs).toEqual(genome.glyphs);
    }
  });

  it('renders a vector PDF sized to the artifact plus label', async () => {
    const pdf = await w.issuance.renderCode(codeId, 'pdf', { label: true, widthMm: 25.4 });
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.filename).toBe('ORBES-O26-J-00184-I1-classic-25.4mm-label.pdf');
    const text = Buffer.from(pdf.body as Uint8Array).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // 25.4 mm = 72 pt wide; label adds 7.5/50 of the width.
    expect(text).toMatch(/\/MediaBox \[0 0 72 82\.8\]/);
    expect(text.replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, '')).not.toMatch(/\/Subtype \/Image|\/Font/);
  });

  it('audits downloads when an actor is given', async () => {
    await w.issuance.renderCode(codeId, 'pdf', { theme: 'inverted' }, admin);
    const entries = await w.audit.list({ action: 'code.render' });
    expect(entries.total).toBe(1);
    expect(entries.items[0].details).toMatchObject({ productId, format: 'pdf', theme: 'inverted' });
  });

  it('validates options and ids', async () => {
    for (const opts of [{ widthMm: 1 }, { widthMm: 501 }, { dpi: 10 }, { theme: 'neon' }, { widthMm: Number.NaN }]) {
      expect((await domainError(w.issuance.renderCode(codeId, 'png', opts as never))).code).toBe('VALIDATION_FAILED');
    }
    expect((await domainError(w.issuance.renderCode(codeId, 'png', { widthMm: 400, dpi: 2400 }))).publicMessage).toMatch(/too large/);
    expect((await domainError(w.issuance.renderCode(codeId, 'gif' as never))).code).toBe('VALIDATION_FAILED');
    expect((await domainError(w.issuance.renderCode('nope', 'svg'))).code).toBe('CODE_NOT_FOUND');
    expect((await domainError(w.issuance.renderCode('00000000-0000-4000-8000-000000000000', 'svg'))).code).toBe('CODE_NOT_FOUND');
  });

  it('refuses superseded codes', async () => {
    const r = await w.issuance.issueProduct(ring(w), admin);
    await w.issuance.reissueCode(r.product.productId, 'damaged', admin);
    const e = await domainError(w.issuance.renderCode(r.code.id, 'svg'));
    expect(e.code).toBe('CODE_NOT_ACTIVE');
  });

  it('refuses codes of products out of circulation or under incident', async () => {
    const r = await w.issuance.issueProduct(ring(w), admin);
    for (const status of ['STOLEN', 'LOST', 'COUNTERFEIT_FLAGGED', 'REVOKED', 'RETIRED'] as const) {
      await w.t.db.updateTable('products').set({ status }).where('id', '=', r.product.id).execute();
      expect((await domainError(w.issuance.renderCode(r.code.id, 'png'))).code, status).toBe('PRODUCT_NOT_PRINTABLE');
    }
    for (const status of ['ACTIVATED', 'OWNED', 'SERVICED'] as const) {
      await w.t.db.updateTable('products').set({ status }).where('id', '=', r.product.id).execute();
      expect((await w.issuance.renderCode(r.code.id, 'svg')).contentType, status).toMatch(/svg/);
    }
  });

  it('refuses to render a stored code that fails its integrity check', async () => {
    const r = await w.issuance.issueProduct(ring(w), admin);
    // Simulate a compromised database: bypass the immutability guard and swap the signature.
    await w.t.pglite.exec('ALTER TABLE codes DISABLE TRIGGER codes_immutable_identity');
    try {
      const forged = new Uint8Array(r.code.signature);
      forged[0] ^= 1;
      await w.t.db.updateTable('codes').set({ signature: forged }).where('id', '=', r.code.id).execute();
      expect((await domainError(w.issuance.renderCode(r.code.id, 'svg'))).code).toBe('CODE_INTEGRITY');

      await w.t.db.updateTable('codes').set({ signature: r.code.signature, issue: 9 }).where('id', '=', r.code.id).execute();
      expect((await domainError(w.issuance.renderCode(r.code.id, 'svg'))).code).toBe('CODE_INTEGRITY');
      await w.t.db.updateTable('codes').set({ issue: 1 }).where('id', '=', r.code.id).execute();
      expect((await w.issuance.renderCode(r.code.id, 'svg')).contentType).toMatch(/svg/);
    } finally {
      await w.t.pglite.exec('ALTER TABLE codes ENABLE TRIGGER codes_immutable_identity');
    }
  });

  it('refuses to render a code signed after its key was compromised', async () => {
    w.clock.advance(86_400_000); // the first code (codeId) predates everything below
    const r = await w.issuance.issueProduct(ring(w), admin);
    await w.keys.revoke(1, { reason: 'compromise', compromisedAt: new Date(w.clock.now().getTime() - 60_000) }, admin);
    expect((await domainError(w.issuance.renderCode(r.code.id, 'svg'))).code).toBe('CODE_INTEGRITY');
    // A code recorded before the compromise is still trusted and renders.
    expect((await w.issuance.renderCode(codeId, 'svg')).contentType).toMatch(/svg/);
    await w.keys.rotate(admin);
  });

  it('renders a multi-page print sheet of active codes', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await w.issuance.issueProduct(ring(w), admin)).code.id);
    const sheet = await w.issuance.renderPrintSheet([...ids, ids[0]], { widthMm: 60, page: 'A4' }, admin);
    expect(sheet.contentType).toBe('application/pdf');
    const text = Buffer.from(sheet.body as Uint8Array).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/Count 1\b/); // 3 unique codes at 60 mm fit on one A4 page
    expect((await w.audit.list({ action: 'code.render_sheet' })).items[0].details).toMatchObject({ codeIds: ids });
    expect((await domainError(w.issuance.renderPrintSheet([]))).code).toBe('VALIDATION_FAILED');
  });
});

describe('IssuanceService.issueBatch', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });
  afterAll(async () => {
    await w?.t.close();
  });

  const template = (w: World, extra: Partial<IssueProductInput> = {}) => ({ categoryCode: 'J', modelId: w.modelId, material: '925 STERLING SILVER', productionBatch: 'B-2026-05-A', ...extra });
  const products = (w: World) => w.t.db.selectFrom('products').select(['product_id', 'serial', 'variant', 'sku', 'production_batch']).orderBy('serial').execute();

  it('issues the pieces in order, one product each, and records the batch without its claim codes', async () => {
    const r = await w.issuance.issueBatch(template(w, { withClaimSecret: true }), [{ variant: '52' }, { variant: '54', sku: 'MNL-RG-54-POLI' }, {}], admin);
    expect(r).toMatchObject({ issued: 3, failed: 0, skipped: 0 });
    expect(r.lines.map((l) => [l.index, l.status])).toEqual([[0, 'ISSUED'], [1, 'ISSUED'], [2, 'ISSUED']]);
    const issued = r.lines.map((l) => (l.status === 'ISSUED' ? l.result : null)!);
    expect(issued.map((x) => x.product.serial)).toEqual([1, 2, 3]);
    expect(issued.map((x) => x.product.sku)).toEqual(['MNL-RG-52', 'MNL-RG-54-POLI', 'MNL-RG']);
    expect(issued.every((x) => x.product.productionBatch === 'B-2026-05-A' && x.product.hasClaimSecret)).toBe(true);
    // Each claim code is the product's own (its hash only is stored).
    const hashes = await w.t.db.selectFrom('products').select(['product_id', 'claim_secret_hash']).execute();
    for (const x of issued) {
      const row = hashes.find((h) => h.product_id === x.product.productId)!;
      expect(await verifyClaimCode(x.claimCode!, row.claim_secret_hash!)).toBe(true);
    }
    expect(new Set(issued.map((x) => x.claimCode)).size).toBe(3);

    const batch = (await w.audit.list({ action: ISSUE_BATCH_ACTION })).items;
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ actorType: 'admin', actorId: 'admin-7', targetType: 'product', targetId: null });
    expect(batch[0].details).toEqual({
      count: 3,
      issued: 3,
      failed: 0,
      skipped: 0,
      productIds: issued.map((x) => x.product.productId),
      failures: [],
      category: 'J',
      modelId: w.modelId,
      productionBatch: 'B-2026-05-A',
      claimSecret: true,
    });
    expect((await w.audit.list({ action: 'product.issue' })).total).toBe(3);
    const everything = JSON.stringify((await w.audit.list({}, { page: 1, pageSize: 200 })).items);
    for (const x of issued) expect(everything).not.toContain(x.claimCode!.replace(/-/g, '').slice(0, 8));
  });

  it('a variant, SKU or serial in the template does not reach the pieces', async () => {
    const r = await w.issuance.issueBatch({ ...template(w), variant: 'X', sku: 'NOPE', serial: 900 } as never, [{ variant: '50' }, {}], admin);
    expect(r.issued).toBe(2);
    expect((await products(w)).map((p) => [p.serial, p.variant, p.sku])).toEqual([
      [1, '50', 'MNL-RG-50'],
      [2, null, 'MNL-RG'],
    ]);
  });

  it('checks every line, the serials and the template before signing anything', async () => {
    for (const items of [[], Array.from({ length: MAX_ISSUE_BATCH + 1 }, () => ({}))]) {
      expect(await domainError(w.issuance.issueBatch(template(w), items, admin))).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
    }
    const bad = await domainError(w.issuance.issueBatch(template(w), [{ variant: '50' }, { variant: '52' }, { sku: '-bad' }], admin));
    expect(bad).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(bad.publicMessage).toMatch(/^items\.2: SKU may contain/);
    const twice = await domainError(w.issuance.issueBatch(template(w), [{ serial: 12 }, { variant: '52' }, { serial: 12 }], admin));
    expect(twice.publicMessage).toBe('items.2.serial: the same serial as items.0.');
    const material = await domainError(w.issuance.issueBatch(template(w, { material: 'a\tb' }), [{}, {}], admin));
    expect(material.publicMessage).toBe('template: Material contains invalid characters.');
    expect(await domainError(w.issuance.issueBatch(template(w, { modelId: w.leatherModelId }), [{}], admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await domainError(w.issuance.issueBatch(template(w, { modelId: '00000000-0000-4000-8000-000000000000' }), [{}], admin))).toMatchObject({ code: 'MODEL_NOT_FOUND' });
    expect(await domainError(w.issuance.issueBatch(template(w, { productionDate: '2026-06-30' }), [{}], admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await products(w)).toEqual([]);
    expect((await w.audit.list({ action: ISSUE_BATCH_ACTION })).total).toBe(0);
  });

  it('a serial taken meanwhile fails its piece alone: the others are issued', async () => {
    await w.issuance.issueProduct(ring(w, { serial: 7 }), admin);
    const r = await w.issuance.issueBatch(template(w), [{ variant: '50' }, { serial: 7 }, { variant: '54' }], admin);
    expect(r).toMatchObject({ issued: 2, failed: 1, skipped: 0 });
    expect(r.lines[1]).toEqual({ index: 1, status: 'FAILED', error: { code: 'SERIAL_TAKEN', message: 'This serial number is already used.' } });
    expect((await products(w)).filter((p) => p.production_batch === 'B-2026-05-A').map((p) => [p.serial, p.variant])).toEqual([
      [8, '50'],
      [9, '54'],
    ]);
    const batch = (await w.audit.list({ action: ISSUE_BATCH_ACTION })).items[0];
    expect(batch.details).toMatchObject({ issued: 2, failed: 1, failures: [{ index: 1, code: 'SERIAL_TAKEN' }] });
  });

  it('a failure that is not the piece\'s own stops the batch: signed pieces stay, the rest is skipped', async () => {
    let signs = 0;
    const flaky: KeyProvider = {
      name: 'memory',
      generate: (kid) => w.provider.generate(kid),
      sign: async (ref, message) => {
        if (++signs > 1) throw new Error('HSM offline');
        return w.provider.sign(ref, message);
      },
    };
    const keys = new KeyService({ db: w.t.db, provider: flaky, audit: w.audit, clock: w.clock.now });
    const issuance = new IssuanceService({ db: w.t.db, keys, audit: w.audit, categories: w.categories, clock: w.clock.now });
    const r = await issuance.issueBatch(template(w, { withClaimSecret: true }), [{ variant: '50' }, { variant: '52' }, { variant: '54' }], admin);
    expect(r).toMatchObject({ issued: 1, failed: 1, skipped: 1 });
    expect(r.lines.map((l) => l.status)).toEqual(['ISSUED', 'FAILED', 'SKIPPED']);
    expect(r.lines[1]).toMatchObject({ error: { code: 'SIGNING_UNAVAILABLE' } });
    expect((await products(w)).map((p) => p.variant)).toEqual(['50']);
    expect((await w.audit.list({ action: ISSUE_BATCH_ACTION })).items[0].details).toMatchObject({ issued: 1, failed: 1, skipped: 1 });

    // An unexpected error stops it the same way, with a generic message.
    const plain = new IssuanceService({ db: w.t.db, keys: w.keys, audit: w.audit, categories: w.categories, clock: w.clock.now });
    const original = plain.issueProduct.bind(plain);
    let n = 0;
    plain.issueProduct = async (input, actor) => {
      if (++n === 2) throw new TypeError('boom');
      return original(input, actor);
    };
    const u = await plain.issueBatch(template(w), [{}, {}, {}], admin);
    expect(u.lines.map((l) => l.status)).toEqual(['ISSUED', 'FAILED', 'SKIPPED']);
    expect(u.lines[1]).toEqual({ index: 1, status: 'FAILED', error: { code: 'INTERNAL_ERROR', message: 'This piece could not be issued.' } });
  });

  it('returns the signed pieces even when the batch\'s own audit entry cannot be written', async () => {
    const record = w.audit.record.bind(w.audit);
    w.audit.record = (async (entry, trx) => {
      if (entry.action === ISSUE_BATCH_ACTION) throw new Error('audit unavailable');
      return record(entry, trx);
    }) as typeof w.audit.record;
    const r = await w.issuance.issueBatch(template(w, { withClaimSecret: true }), [{}, {}], admin);
    expect(r.issued).toBe(2);
    expect(r.lines.every((l) => l.status === 'ISSUED' && typeof l.result.claimCode === 'string')).toBe(true);
    expect((await w.audit.list({ action: 'product.issue' })).total).toBe(2);
  });

  it('signs one batch at a time per admin', async () => {
    const first = w.issuance.issueBatch(template(w, { withClaimSecret: true }), [{}, {}], admin);
    const second = await domainError(w.issuance.issueBatch(template(w), [{}], admin));
    expect(second).toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
    // Another admin is not held back, and the first admin may start again once the first batch is done.
    const other = await w.issuance.issueBatch(template(w), [{}], { type: 'admin', id: 'admin-8', ipHash: 'iphash' });
    expect(other.issued).toBe(1);
    expect((await first).issued).toBe(2);
    expect((await w.issuance.issueBatch(template(w), [{}], admin)).issued).toBe(1);
  });
});

describe('helpers', () => {
  it('derives SKUs from the model prefix and variant', () => {
    expect(deriveSku('MNL-RG', undefined)).toBe('MNL-RG');
    expect(deriveSku('mnl-rg', 'Taille 52 — Or rosé')).toBe('MNL-RG-TAILLE-52-OR-ROSE');
    expect(deriveSku('MNL', '***')).toBe('MNL');
  });

  it('normalises authentication policies', () => {
    expect(normalizeAuthPolicy(undefined)).toBe('PRINTED_CODE');
    expect(normalizeAuthPolicy(' printed_code + secure_element ')).toBe('PRINTED_CODE+SECURE_ELEMENT');
    expect(() => normalizeAuthPolicy('PRINTED_CODE+PRINTED_CODE')).toThrow(DomainError);
  });
});

/**
 * Opt-in: true parallelism on PostgreSQL (pool of 8), with a key rotation in
 * the middle of the burst.
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/issuance.test.ts
 */
const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
describe.skipIf(!pgUrl)('IssuanceService on PostgreSQL', () => {
  it('issues 50 products from 5 service instances in parallel while the key rotates', async () => {
    const { sql } = await import('kysely');
    const { closeDb, createDb } = await import('../../src/server/db/connection.js');
    const { migrateToLatest } = await import('../../src/server/db/migrate.js');
    const { randomBytes } = await import('node:crypto');
    const adminDb = createDb(pgUrl!);
    const dbName = `orbes_iss_${randomBytes(6).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(adminDb);
    const u = new URL(pgUrl!);
    u.pathname = `/${dbName}`;
    const db = createDb(u.toString(), { poolMax: 8 });
    try {
      await migrateToLatest(db);
      const audit = new AuditService({ db });
      const categories = new CategoryRegistry({ db, audit });
      await categories.load();
      await categories.create({ code: 'J', name: 'Jewelry' }, admin);
      const model = await db
        .insertInto('models')
        .values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MNL-RG' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const provider = new MemoryKeyProvider({ env: 'test' });
      const instances = Array.from({ length: 5 }, () => {
        const keys = new KeyService({ db, provider, audit });
        const cats = new CategoryRegistry({ db, audit });
        return { keys, issuance: new IssuanceService({ db, keys, audit, categories: cats }), cats };
      });
      await Promise.all(instances.map((i) => i.cats.load()));
      await instances[0].keys.rotate({ type: 'system' });

      const jobs = Array.from({ length: 50 }, (_, n) =>
        instances[n % 5].issuance.issueProduct({ categoryCode: 'J', modelId: model.id, material: 'SILVER' }, { type: 'system' }),
      );
      jobs.splice(25, 0, instances[1].keys.rotate({ type: 'system' }) as never);
      const settled = await Promise.all(jobs);
      const results = settled.filter((r): r is Awaited<ReturnType<IssuanceService['issueProduct']>> => 'product' in (r as object));
      expect(results).toHaveLength(50);
      expect(new Set(results.map((r) => r.product.serial)).size).toBe(50);
      expect(Math.max(...results.map((r) => r.product.serial))).toBe(50);
      const keyRows = await db.selectFrom('cryptographic_keys').selectAll().execute();
      expect(keyRows.map((k) => k.status).sort()).toEqual(['ACTIVE', 'RETIRED']);
      for (const r of results) {
        const key = keyRows.find((k) => k.key_id === r.code.keyId)!;
        expect(verifyEd25519Node(key.public_key, signingMessage(r.code.payload), r.code.signature)).toBe(true);
      }
      expect((await audit.verifyChain()).ok).toBe(true);
    } finally {
      await closeDb(db);
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(adminDb);
      await closeDb(adminDb);
    }
  });
});
