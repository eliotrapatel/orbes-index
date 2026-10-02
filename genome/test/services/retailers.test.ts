/**
 * The register of points of sale (A-08): unique per name and city ignoring
 * case, audited with the values before and after, made inactive and never
 * deleted (the database refuses it), listed by name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isGuardViolation } from '../../src/server/db/pg-errors.js';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { RetailerService } from '../../src/server/services/retailers.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const admin: Actor = { type: 'admin', id: '0e2b7e24-3f3a-4f0e-8d7a-5b1e2f9c0a11' };

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

describe('RetailerService', () => {
  let t: TestDb;
  let audit: AuditService;
  let retailers: RetailerService;
  const clock = createManualClock('2026-10-02T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    retailers = new RetailerService({ db: t.db, audit, clock: clock.now });
  });
  afterAll(() => t.close());

  it('creates a point of sale, trimmed, with an upper-case country, and audits it', async () => {
    const r = await retailers.create({ name: '  ORBES Paris — Saint-Honoré ', city: ' Paris ', country: 'fr' }, admin);
    expect(r).toMatchObject({ name: 'ORBES Paris — Saint-Honoré', city: 'Paris', country: 'FR', active: true });
    expect(r.createdAt).toEqual(clock.now());
    const entry = (await audit.list({ action: 'retailer.create', targetId: r.id })).items[0];
    expect(entry).toMatchObject({ actorType: 'admin', actorId: admin.id, targetType: 'retailer' });
    expect(entry.details).toEqual({ name: 'ORBES Paris — Saint-Honoré', city: 'Paris', country: 'FR' });
    expect(await retailers.get(r.id)).toEqual(r);
  });

  it('refuses a look-alike in the same city (case-insensitive), accepts it in another', async () => {
    await retailers.create({ name: 'ORBES London', city: 'London', country: 'GB' }, admin);
    const e = await domainError(retailers.create({ name: 'orbes LONDON', city: 'london' }, admin));
    expect(e.code).toBe('RETAILER_EXISTS');
    expect(e.httpStatus).toBe(409);
    expect((await retailers.create({ name: 'ORBES London', city: 'Heathrow' }, admin)).city).toBe('Heathrow');
    // Without a city, one per name.
    await retailers.create({ name: 'ORBES.COM — Online boutique' }, admin);
    expect((await domainError(retailers.create({ name: 'orbes.com — online boutique', city: '' }, admin))).code).toBe('RETAILER_EXISTS');
  });

  it('validates names, cities and countries', async () => {
    for (const input of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 'A\u0007B' }, { name: 'OK', city: 'y'.repeat(81) }, { name: 'OK', country: 'FRA' }]) {
      expect((await domainError(retailers.create(input, admin))).code, JSON.stringify(input)).toBe('VALIDATION_FAILED');
    }
    expect((await domainError(retailers.update('00000000-0000-4000-8000-000000000000', {}, admin))).code).toBe('VALIDATION_FAILED');
    expect((await domainError(retailers.get('not-a-uuid'))).code).toBe('RETAILER_NOT_FOUND');
  });

  it('renames, moves and deactivates, auditing only what changed', async () => {
    const r = await retailers.create({ name: 'ORBES Milano', city: 'Milan', country: 'IT' }, admin);
    clock.advance(60_000);
    const moved = await retailers.update(r.id, { name: 'ORBES Milano — Via della Spiga', city: 'Milan', active: false }, admin);
    expect(moved).toMatchObject({ name: 'ORBES Milano — Via della Spiga', city: 'Milan', country: 'IT', active: false });
    expect(moved.updatedAt).toEqual(clock.now());
    const entry = (await audit.list({ action: 'retailer.update', targetId: r.id })).items[0];
    expect(entry.details).toEqual({ before: { name: 'ORBES Milano', active: true }, after: { name: 'ORBES Milano — Via della Spiga', active: false } });
    // Nothing changed: nothing written.
    await retailers.update(r.id, { active: false, city: 'Milan' }, admin);
    expect((await audit.list({ action: 'retailer.update', targetId: r.id })).items).toHaveLength(1);
    // A rename onto another shop of the same city is a conflict.
    await retailers.create({ name: 'ORBES Brera', city: 'Milan' }, admin);
    expect((await domainError(retailers.update(r.id, { name: 'orbes brera' }, admin))).code).toBe('RETAILER_EXISTS');
    expect((await domainError(retailers.update('00000000-0000-4000-8000-000000000000', { active: true }, admin))).code).toBe('RETAILER_NOT_FOUND');
  });

  it('lists by name, the active ones only on request; a point of sale is never deleted', async () => {
    const all = await retailers.list();
    const active = await retailers.list({ activeOnly: true });
    expect(all.map((r) => r.name).slice(0, 2)).toEqual(['ORBES Brera', 'ORBES London']);
    expect(all.some((r) => !r.active)).toBe(true);
    expect(active.every((r) => r.active)).toBe(true);
    expect(active.length).toBe(all.length - all.filter((r) => !r.active).length);
    const err = await t.db.deleteFrom('retailers').where('id', '=', all[0].id).execute().catch((e: unknown) => e);
    expect(isGuardViolation(err)).toBe(true);
  });
});
