/**
 * A model's warranty choice changed while pieces of it are issued (plan ORBES CARE, answer 12, step 1.3): a change
 * (CatalogService.setWarranty) takes the model's row FOR UPDATE and rewrites the warranties of its pieces in the same
 * transaction; an issuance reads the model's choice under a share lock inside its own transaction (the Generator's
 * `issueIn`, the stock's `issueStockIdentity`) and writes it on the piece's warranty. Whichever commits first, every
 * piece of the model ends on the model's choice: a change that commits first is read by the issuance, an issuance that
 * commits first holds its share lock until then and the change, run after it, rewrites its row. Nothing deadlocks.
 *
 * On PGlite (always) the calls are issued together and the database serialises their transactions: every order must
 * give a correct result. On PostgreSQL (opt-in, a pool of 8: true parallelism) the same cases run, in genome-ci:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/model-warranty-concurrency.test.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { KeyService, MemoryKeyProvider } from '../../src/server/keys/index.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CatalogService } from '../../src/server/services/catalog.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { hashClaimCode } from '../../src/server/services/claim-codes.js';
import { IssuanceService, issueStockIdentity } from '../../src/server/services/issuance.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
const admin: Actor = { type: 'admin', id: 'admin-7', ipHash: 'iphash' };

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const root = createDb(adminUrl!);
      const name = `orbes_model_warranty_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(root);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(root);
          await closeDb(root);
        },
      };
    },
  },
];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`a model's warranty changed while it is issued, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    const clock = createManualClock('2026-10-15T09:00:00.000Z');
    let catalog: CatalogService;
    /** Two processes' issuance services over the same database. */
    let issuers: IssuanceService[];
    let modelId: string;
    let skuId: string;
    let lineId: string;
    let receptionId: string;
    let claimHash: string;

    beforeAll(async () => {
      ({ db, close } = await backend.open());
      const audit = new AuditService({ db, clock: clock.now });
      const categories = new CategoryRegistry({ db, audit, clock: clock.now });
      await categories.load();
      await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, admin);
      catalog = new CatalogService({ db, audit, categories, clock: clock.now });
      modelId = (await catalog.createModel({ categoryCode: 'J', name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL-RG', defaultMaterial: '925 STERLING SILVER' }, admin)).id;
      const provider = new MemoryKeyProvider({ env: 'test' });
      const keys = new KeyService({ db, provider, audit, clock: clock.now });
      await keys.rotate(admin, 'orbes-test-k1');
      const registries = [0, 1].map(() => new CategoryRegistry({ db, audit, clock: clock.now }));
      await Promise.all(registries.map((r) => r.load()));
      issuers = registries.map((cats) => new IssuanceService({ db, keys: new KeyService({ db, provider, audit, clock: clock.now }), audit, categories: cats, clock: clock.now }));
      // A confirmed reception owing identities of the model (the stock's path).
      skuId = await ensureSku(db, modelId, '52');
      const location = await db.insertInto('stock_locations').values({ name: `WAREHOUSE ${randomBytes(3).toString('hex')}` }).returning('id').executeTakeFirstOrThrow();
      const supplier = await db.insertInto('suppliers').values({ name: 'Maison Nord', currency: 'EUR' }).returning('id').executeTakeFirstOrThrow();
      const order = await db
        .insertInto('supplier_orders')
        .values({ supplier_id: supplier.id, location_id: location.id, status: 'SENT', sent_at: clock.now(), currency: 'EUR', expected_on: '2026-11-01' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const orderLine = await db.insertInto('supplier_order_lines').values({ supplier_order_id: order.id, sku_id: skuId, quantity: 50, unit_price_minor: 12_000 }).returning('id').executeTakeFirstOrThrow();
      receptionId = (
        await db.insertInto('receptions').values({ supplier_order_id: order.id, location_id: location.id, status: 'CONFIRMED', confirmed_at: clock.now() }).returning('id').executeTakeFirstOrThrow()
      ).id;
      lineId = (await db.insertInto('reception_lines').values({ reception_id: receptionId, sku_id: skuId, supplier_order_line_id: orderLine.id, accepted: 50 }).returning('id').executeTakeFirstOrThrow()).id;
      claimHash = await hashClaimCode('ABCD-EFGH-JKMN');
    }, 60_000);
    afterAll(() => close?.());

    const generator = (i: number) => issuers[i % 2].issueProduct({ categoryCode: 'J', modelId, material: '925 STERLING SILVER' }, admin);
    const stock = (i: number, during?: () => void) =>
      issuers[i % 2].inSigningTransaction(async (trx, signFirst) => {
        const out = await issueStockIdentity(trx, signFirst, { modelId, skuId, material: '925 STERLING SILVER', productionBatch: 'SO-7C21A0B9', claimHash, receptionLineId: lineId }, { receptionId }, admin, clock.now());
        if (during) {
          // The piece's row is written, the share lock held: a change started now waits for this commit (PostgreSQL), or
          // runs after it (PGlite), and rewrites the new row.
          during();
          await pause(50);
        }
        return out;
      });

    /** Every warranty of the model's pieces on the model's choice (none VOID here); the 2-year ones not started have no end date. */
    async function expectAllOnTheModelsChoice(): Promise<number> {
      const m = await db.selectFrom('models').select('warranty_lifetime').where('id', '=', modelId).executeTakeFirstOrThrow();
      const rows = await db
        .selectFrom('warranties as w')
        .innerJoin('products as p', 'p.id', 'w.product_id')
        .select(['p.product_id', 'w.lifetime', 'w.end_date'])
        .where('p.model_id', '=', modelId)
        .execute();
      for (const r of rows) {
        expect(r.lifetime, r.product_id).toBe(m.warranty_lifetime);
        expect(r.end_date, r.product_id).toBeNull();
      }
      return rows.length;
    }

    it('a change committed while a stock issuance holds its share lock rewrites the new piece', async () => {
      for (const to of [false, true]) {
        let change: Promise<unknown> | undefined;
        const issued = await stock(0, () => {
          change = catalog.setWarranty(modelId, to, admin);
        });
        await change;
        const row = await db.selectFrom('warranties').select('lifetime').where('product_id', '=', issued.product.id).executeTakeFirstOrThrow();
        expect(row.lifetime).toBe(to);
        await expectAllOnTheModelsChoice();
      }
    }, 60_000);

    it('changes and issuances of both paths started together, in both orders: every piece ends on the model’s choice, nothing deadlocks', async () => {
      let n = 0;
      for (const [round, to] of [false, true, false, true].entries()) {
        // Odd rounds start the change before the issuances, even rounds after them.
        const first = round % 2 === 1 ? catalog.setWarranty(modelId, to, admin) : undefined;
        const issue = [generator(n++), stock(n++), generator(n++), stock(n++)];
        const change = first ?? catalog.setWarranty(modelId, to, admin);
        await Promise.all([change, ...issue]);
        expect((await db.selectFrom('models').select('warranty_lifetime').where('id', '=', modelId).executeTakeFirstOrThrow()).warranty_lifetime).toBe(to);
        await expectAllOnTheModelsChoice();
      }
      expect(await expectAllOnTheModelsChoice()).toBeGreaterThanOrEqual(16);
    }, 120_000);
  });
}
