/**
 * Logistics over HTTP (plan NEXT LOT of 2026-10-07, §3.5.6.9; routes/admin/locations.ts and routes/admin/logistics.ts),
 * built in halves: the location's address (step 5.6), the receptions and their cards (step 5.7), the stock (step 5.8),
 * the packing (step 5.9).
 *
 *  - a location's postal address, entered by an ADMIN (an OPERATOR 403), line breaks kept, cleared with null, read by an
 *    AUDITOR, never by a LOGISTICS login; audited `stock.location.update` with `fields: ['address']`, never its words.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

type Json = Record<string, any>;

describe('Logistics over HTTP (plan NEXT LOT §3.5.6.9)', () => {
  let h: Harness;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  let agent: Client;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-08T09:00:00.000Z');
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    logistics = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'LOGISTICS WAREHOUSE').executeTakeFirstOrThrow()).id;
    agent = await adminClient(h, 'LOGISTICS', {}, { stockLocationIds: [logistics] });
  });
  afterAll(() => h?.close());

  describe('a location\'s address (step 5.6)', () => {
    it('is entered by an ADMIN, its lines kept, read by an AUDITOR, cleared; never an OPERATOR\'s nor the agent\'s; audited without its words', async () => {
      const address = '12 rue des Entrepôts\r\n93200 Saint-Denis\nFrance';
      expect(errorOf(await operator.patch(`/api/admin/locations/${logistics}`, { address })).code).toBe('FORBIDDEN');
      expect(errorOf(await admin.patch(`/api/admin/locations/${logistics}`, { address: 'x'.repeat(501) })).code).toBe('VALIDATION_FAILED');
      expect(errorOf(await admin.patch(`/api/admin/locations/${logistics}`, { address: 'A\u0007B' })).code).toBe('VALIDATION_FAILED');
      const set = safeJson(await admin.patch(`/api/admin/locations/${logistics}`, { address })) as Json;
      expect(set).toEqual({ id: logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false, shopifyLocationId: null, address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' });
      const read = (safeJson(await auditor.get('/api/admin/locations')) as { items: Json[] }).items.find((l) => l.id === logistics)!;
      expect(read.address).toBe('12 rue des Entrepôts\n93200 Saint-Denis\nFrance');
      expect(errorOf(await agent.get('/api/admin/locations')).code).toBe('FORBIDDEN');
      // The same address again changes nothing; cleared with null.
      expect(errorOf(await admin.patch(`/api/admin/locations/${logistics}`, { address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' })).code).toBe('VALIDATION_FAILED');
      expect((safeJson(await admin.patch(`/api/admin/locations/${logistics}`, { address: null })) as Json).address).toBeNull();
      // A location added with its address.
      const added = safeJson(await admin.post('/api/admin/locations', { name: 'NORTH HUB', address: '1 Quay Street\nLeith' })) as Json;
      expect(added).toMatchObject({ name: 'NORTH HUB', address: '1 Quay Street\nLeith' });
      const audits = await h.t.db.selectFrom('audit_logs').select(['action', 'target_id', 'details']).where('action', 'in', ['stock.location.update', 'stock.location.create']).orderBy('id').execute();
      expect(audits.map((a) => [a.action, a.details])).toEqual([
        ['stock.location.update', { fields: ['address'] }],
        ['stock.location.update', { fields: ['address'] }],
        ['stock.location.create', { name: 'NORTH HUB', fields: ['address'] }],
      ]);
      expect(JSON.stringify(audits)).not.toMatch(/Entrep|Saint-Denis|Quay/);
    });
  });
});
