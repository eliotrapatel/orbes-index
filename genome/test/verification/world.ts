/**
 * In-process fixture for verification tests: a migrated PGlite database with
 * the real services wired together (keys, issuance, lifecycle, ownership,
 * warranty, anomaly, verification) on one manual clock.
 */
import { randomUUID } from 'node:crypto';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { frameCodeData, unframeCodeData } from '../../src/core/payload.js';
import { AuthenticatorRegistry } from '../../src/server/authenticators/index.js';
import { DEFAULT_ANOMALY_CONFIG, type AnomalyConfig } from '../../src/server/config.js';
import { KeyService, MemoryKeyProvider } from '../../src/server/keys/index.js';
import { AnomalyService } from '../../src/server/services/anomaly.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { IssuanceService, type IssueProductInput, type IssueResult } from '../../src/server/services/issuance.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { OwnershipService } from '../../src/server/services/ownership.js';
import { VerificationService, type ScanMeta, type VerifyInput } from '../../src/server/services/verification.js';
import { WarrantyService } from '../../src/server/services/warranty.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import type { Db } from '../../src/server/db/connection.js';
import { createTestDb, type TestDb } from '../support/db.js';

export const admin: Actor = { type: 'admin', id: 'admin-1' };

export interface World {
  t: TestDb;
  clock: ManualClock;
  config: { anomaly: AnomalyConfig };
  audit: AuditService;
  categories: CategoryRegistry;
  provider: MemoryKeyProvider;
  keys: KeyService;
  issuance: IssuanceService;
  lifecycle: LifecycleService;
  ownership: OwnershipService;
  warranty: WarrantyService;
  anomaly: AnomalyService;
  authenticators: AuthenticatorRegistry;
  verification: VerificationService;
  modelId: string;
  collectionId: string;
  close(): Promise<void>;
}

export async function createWorld(opts: { anomaly?: Partial<AnomalyConfig>; start?: string; db?: Db } = {}): Promise<World> {
  // A caller-supplied database (e.g. real PostgreSQL) is owned by the caller: close() leaves it open.
  const t: TestDb = opts.db ? ({ db: opts.db, pglite: undefined as never, close: async () => {} } as TestDb) : await createTestDb();
  const clock = createManualClock(opts.start ?? '2026-06-01T10:00:00.000Z');
  const config = { anomaly: { ...DEFAULT_ANOMALY_CONFIG, ...opts.anomaly } };
  const audit = new AuditService({ db: t.db, clock: clock.now });
  const categories = new CategoryRegistry({ db: t.db, audit, clock: clock.now });
  await categories.load();
  await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, admin);
  const col = await t.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
  const model = await t.db
    .insertInto('models')
    .values({
      category_id: 1,
      collection_id: col.id,
      name: 'MONOLITHE',
      type: 'RING',
      sku_prefix: 'MNL-RG',
      default_material: '925 STERLING SILVER',
      care_instructions: 'Polish with a soft dry cloth.',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const provider = new MemoryKeyProvider({ env: 'test' });
  // cacheTtlMs 0: key status changes made by tests through SQL are seen at once.
  const keys = new KeyService({ db: t.db, provider, audit, clock: clock.now, cacheTtlMs: 0 });
  await keys.rotate(admin, 'orbes-test-k1');
  const issuance = new IssuanceService({ db: t.db, keys, audit, categories, clock: clock.now });
  const lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
  const ownership = new OwnershipService({ db: t.db, audit, lifecycle, clock: clock.now });
  const warranty = new WarrantyService({ db: t.db, audit, lifecycle, clock: clock.now });
  const anomaly = new AnomalyService({ db: t.db, config: config.anomaly, audit, clock: clock.now });
  const authenticators = AuthenticatorRegistry.withDefaults();
  const verification = new VerificationService({ db: t.db, keys, anomaly, authenticators, config, clock: clock.now });
  return {
    t,
    clock,
    config,
    audit,
    categories,
    provider,
    keys,
    issuance,
    lifecycle,
    ownership,
    warranty,
    anomaly,
    authenticators,
    verification,
    modelId: model.id,
    collectionId: col.id,
    close: () => t.close(),
  };
}

export function ringInput(w: World, extra: Partial<IssueProductInput> = {}): IssueProductInput {
  return { categoryCode: 'J', modelId: w.modelId, collectionId: w.collectionId, material: '925 STERLING SILVER', ...extra };
}

export async function issue(w: World, extra: Partial<IssueProductInput> = {}): Promise<IssueResult> {
  return w.issuance.issueProduct(ringInput(w, extra), admin);
}

/** Issue and activate (retail sale): status ACTIVATED, warranty started. */
export async function issueActivated(w: World, extra: Partial<IssueProductInput> = {}): Promise<IssueResult> {
  const r = await issue(w, extra);
  await w.warranty.activate(r.product.productId, { purchaseDate: w.clock.now().toISOString().slice(0, 10), retailer: 'ORBES Paris', country: 'FR' }, admin);
  return r;
}

export async function createAccount(w: World, email = `${randomUUID()}@example.com`): Promise<string> {
  const row = await w.t.db
    .insertInto('accounts')
    .values({ email, email_normalized: email.toLowerCase(), password_hash: 'scrypt$15$8$1$x$y' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Verify and register the first owner through the real token flow. */
export async function registerOwner(w: World, r: IssueResult, accountId: string, claimCode?: string): Promise<void> {
  const out = await w.verification.verify({ code: r.code.data }, { deviceHash: 'reg-device' });
  if (!out.registration) throw new Error(`expected a registration token, got ${out.state}`);
  await w.ownership.registerFirst(accountId, { registrationToken: out.registration.token, claimCode }, { type: 'account', id: accountId });
}

export function verify(w: World, input: VerifyInput | string, meta: ScanMeta = {}) {
  return w.verification.verify(typeof input === 'string' ? { code: input } : input, meta);
}

/** Re-frame code data with a modified payload and/or signature (valid CRC, so it reaches the server checks). */
export function reframe(data: string, mutate: { payload?: (p: Uint8Array) => void; signature?: (s: Uint8Array) => void }): string {
  const { payloadBytes, signature } = unframeCodeData(fromBase64Url(data));
  mutate.payload?.(payloadBytes);
  mutate.signature?.(signature);
  return toBase64Url(frameCodeData(payloadBytes, signature));
}

/** Latest authentication event (internal record) of a scan. */
export async function authEvent(w: World, scanId: string) {
  return w.t.db.selectFrom('authentication_events').selectAll().where('scan_event_id', '=', scanId).executeTakeFirstOrThrow();
}

export async function scanEvent(w: World, scanId: string) {
  return w.t.db.selectFrom('scan_events').selectAll().where('id', '=', scanId).executeTakeFirstOrThrow();
}

export async function anomalies(w: World) {
  return w.t.db.selectFrom('anomalies').selectAll().orderBy('first_seen_at').execute();
}
