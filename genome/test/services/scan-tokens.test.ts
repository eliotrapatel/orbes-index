import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import {
  consumeScanToken,
  createScanToken,
  hashScanToken,
  inspectScanToken,
  purgeScanTokens,
  SCAN_TOKEN_TTL_MS,
} from '../../src/server/services/scan-tokens.js';
import { fromBase64Url } from '../../src/core/bytes.js';
import type { Db } from '../../src/server/db/connection.js';
import { createManualClock } from '../../src/server/types.js';

let serial = 0;
async function seedScan(db: Db, at: Date): Promise<{ productId: string; scanEventId: string }> {
  const s = ++serial;
  const product = await db
    .insertInto('products')
    .values({
      product_id: `O26-J-${String(s).padStart(5, '0')}`,
      packed_identity: (26 << 25) | (1 << 20) | s,
      year: 2026,
      category_id: 1,
      serial: s,
      sku: `SKU-${s}`,
      model_id: (await db.selectFrom('models').select('id').executeTakeFirstOrThrow()).id,
      material: 'SILVER',
      status: 'ACTIVATED',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const scan = await db
    .insertInto('scan_events')
    .values({ product_id: product.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_FIRST_REGISTRATION', occurred_at: at })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { productId: product.id, scanEventId: scan.id };
}

describe('scan tokens', () => {
  let t: TestDb;
  const clock = createManualClock('2026-05-10T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).execute();
    await t.db.insertInto('models').values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON' }).execute();
  });
  afterAll(() => t.close());

  it('mints a 32-byte token valid for 15 minutes and stores only its hash', async () => {
    const s = await seedScan(t.db, clock.now());
    const { token, expiresAt } = await createScanToken(t.db, { ...s, now: clock.now() });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fromBase64Url(token)).toHaveLength(32);
    expect(expiresAt.getTime() - clock.now().getTime()).toBe(SCAN_TOKEN_TTL_MS);
    const row = await t.db.selectFrom('scan_tokens').selectAll().where('product_id', '=', s.productId).executeTakeFirstOrThrow();
    expect(Buffer.from(row.id_hash).equals(createHash('sha256').update(fromBase64Url(token)).digest())).toBe(true);
    expect(row).toMatchObject({ purpose: 'FIRST_REGISTRATION', scan_event_id: s.scanEventId, used_at: null });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('is single-use', async () => {
    const s = await seedScan(t.db, clock.now());
    const { token } = await createScanToken(t.db, { ...s, now: clock.now() });
    expect(await inspectScanToken(t.db, token, { now: clock.now() })).toMatchObject({ ok: true, productId: s.productId });
    const first = await consumeScanToken(t.db, token, { now: clock.now() });
    expect(first).toMatchObject({ ok: true, productId: s.productId, scanEventId: s.scanEventId });
    expect(await consumeScanToken(t.db, token, { now: clock.now() })).toEqual({ ok: false, reason: 'USED' });
    expect(await inspectScanToken(t.db, token, { now: clock.now() })).toEqual({ ok: false, reason: 'USED' });
  });

  it('only one of several concurrent consumers wins', async () => {
    const s = await seedScan(t.db, clock.now());
    const { token } = await createScanToken(t.db, { ...s, now: clock.now() });
    const results = await Promise.all(Array.from({ length: 5 }, () => consumeScanToken(t.db, token, { now: clock.now() })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'USED')).toHaveLength(4);
  });

  it('expires after its TTL', async () => {
    const s = await seedScan(t.db, clock.now());
    const { token, expiresAt } = await createScanToken(t.db, { ...s, now: clock.now(), ttlMs: 60_000 });
    expect((await inspectScanToken(t.db, token, { now: new Date(expiresAt.getTime() - 1) })).ok).toBe(true);
    expect(await consumeScanToken(t.db, token, { now: expiresAt })).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(await inspectScanToken(t.db, token, { now: expiresAt })).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('is bound to its product', async () => {
    const a = await seedScan(t.db, clock.now());
    const b = await seedScan(t.db, clock.now());
    const { token } = await createScanToken(t.db, { ...a, now: clock.now() });
    expect(await consumeScanToken(t.db, token, { now: clock.now(), productId: b.productId })).toEqual({ ok: false, reason: 'WRONG_PRODUCT' });
    expect((await consumeScanToken(t.db, token, { now: clock.now(), productId: a.productId })).ok).toBe(true);
  });

  it('classifies malformed and unknown tokens', async () => {
    for (const bad of [undefined, 42, '', 'abc', 'A'.repeat(44), `${'A'.repeat(42)}!`]) {
      expect(await consumeScanToken(t.db, bad, { now: clock.now() })).toEqual({ ok: false, reason: 'MALFORMED' });
    }
    // Non-canonical base64url (unused trailing bits set) is malformed, not a second spelling.
    expect(hashScanToken(`${'A'.repeat(42)}B`)).toBeUndefined();
    expect(await consumeScanToken(t.db, 'A'.repeat(43), { now: clock.now() })).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('stays usable when the consuming transaction rolls back', async () => {
    const s = await seedScan(t.db, clock.now());
    const { token } = await createScanToken(t.db, { ...s, now: clock.now() });
    await expect(
      t.db.transaction().execute(async (trx) => {
        expect((await consumeScanToken(trx, token, { now: clock.now() })).ok).toBe(true);
        throw new Error('registration failed');
      }),
    ).rejects.toThrow('registration failed');
    expect((await consumeScanToken(t.db, token, { now: clock.now() })).ok).toBe(true);
  });

  it('validates creation input', async () => {
    const s = await seedScan(t.db, clock.now());
    await expect(createScanToken(t.db, { productId: 'x', scanEventId: s.scanEventId })).rejects.toThrow(TypeError);
    await expect(createScanToken(t.db, { productId: s.productId, scanEventId: 'x' })).rejects.toThrow(TypeError);
    await expect(createScanToken(t.db, { ...s, ttlMs: 10 })).rejects.toThrow(RangeError);
    await expect(createScanToken(t.db, { ...s, purpose: 'OTHER' as 'FIRST_REGISTRATION' })).rejects.toThrow(TypeError);
  });

  it('purges expired tokens', async () => {
    const s = await seedScan(t.db, clock.now());
    await createScanToken(t.db, { ...s, now: clock.now() });
    const later = new Date(clock.now().getTime() + 2 * SCAN_TOKEN_TTL_MS);
    expect(await purgeScanTokens(t.db, later)).toBeGreaterThan(0);
    expect(await t.db.selectFrom('scan_tokens').select('id_hash').where('expires_at', '<', later).execute()).toEqual([]);
  });
});
