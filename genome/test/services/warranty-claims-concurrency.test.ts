/**
 * Two decisions of one warranty claim at once (plan ORBES CARE, §2(f), step 1.6; services/warranty-claims.ts
 * `decide`): the claim's row is taken FOR UPDATE and its step checked under the lock, so one decision wins and the
 * other reads the claim DECIDED or DONE and is refused 409 CLAIM_STEP; at most one grant is given, the piece is revoked
 * once. A claim opened while the piece's owner asks for PRIVATE CARE: both lock the piece's row (services/care.ts
 * `request` after the account's, as the house's order account → product), so one of them waits and is refused, never
 * both written. (Two claims of one root are never live at once through the service: one live claim per piece, and every
 * replacement revokes the old piece; `warranty_claims_free_once` is tested by direct inserts in migrations.test.ts.)
 *
 * On PGlite (always) the calls are issued together and the database serialises their transactions. On PostgreSQL
 * (opt-in, a pool of 8: true parallelism) the same cases run, in genome-ci:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/warranty-claims-concurrency.test.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packIdentity } from '../../src/core/identity.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CareService } from '../../src/server/services/care.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { WarrantyService } from '../../src/server/services/warranty.js';
import { WarrantyClaimService, type DecideClaimInput } from '../../src/server/services/warranty-claims.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'));

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
      const name = `orbes_warranty_claims_${randomBytes(6).toString('hex')}`;
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

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`two decisions of one warranty claim at once, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    const clock = createManualClock('2026-10-15T09:00:00.000Z');
    /** Two processes' claim services over the same database. */
    let services: WarrantyClaimService[];
    /** PRIVATE CARE, in a third process. */
    let care: CareService;
    let staff: Actor;
    let carrierId: string;
    let accountId: string;
    let conversationId: string;
    let modelId: string;
    let category: number;
    let serial = 0;

    beforeAll(async () => {
      ({ db, close } = await backend.open());
      const audit = new AuditService({ db, clock: clock.now });
      const categories = new CategoryRegistry({ db, audit, clock: clock.now });
      await categories.load();
      category = (await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, { type: 'system' })).index;
      services = [0, 1].map(() => {
        const lifecycle = new LifecycleService({ db, audit, clock: clock.now });
        const warranty = new WarrantyService({ db, audit, lifecycle, clock: clock.now });
        return new WarrantyClaimService({ db, audit, warranty, lifecycle, clock: clock.now });
      });
      {
        const lifecycle = new LifecycleService({ db, audit, clock: clock.now });
        care = new CareService({ db, audit, warranty: new WarrantyService({ db, audit, lifecycle, clock: clock.now }), clock: clock.now });
      }
      const admin = await db.insertInto('admin_users').values({ email: 'cs@orbes.test', email_normalized: 'cs@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
      staff = { type: 'admin', id: admin.id };
      carrierId = (await db.insertInto('carriers').values({ name: `Claims ${randomBytes(3).toString('hex')}`, tracking_url: 'https://track.test/{tracking}' }).returning('id').executeTakeFirstOrThrow()).id;
      accountId = (await db.insertInto('accounts').values({ email: 'claimant@example.com', email_normalized: 'claimant@example.com', password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;
      conversationId = (await db.insertInto('client_conversations').values({ account_id: accountId, status: 'ANSWERED', last_message_at: clock.now() }).returning('id').executeTakeFirstOrThrow()).id;
      modelId = (
        await db
          .insertInto('models')
          // No longer made: its pieces' claims may take the credit of their value (answer 4).
          .values({ category_id: category, name: 'ECLIPSE', type: 'RING', sku_prefix: 'ECL-RG', default_material: '925 STERLING SILVER', warranty_lifetime: true, base_price_minor: 45_000, base_currency: 'EUR', active: false, discontinued_at: new Date('2026-06-01T10:00:00Z') })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }, 60_000);
    afterAll(() => close?.());

    /** A piece held by `owner` since 1 March 2026, its lifetime warranty started. */
    async function ownedPiece(owner: string): Promise<{ id: string; product_id: string }> {
      serial += 1;
      const p = await db
        .insertInto('products')
        .values({
          product_id: `O26-J-${String(serial).padStart(5, '0')}`,
          packed_identity: packIdentity({ year: 2026, categoryIndex: category, serial }),
          year: 2026,
          category_id: category,
          serial,
          sku: `ECL-${serial}`,
          model_id: modelId,
          material: '925 STERLING SILVER',
          status: 'OWNED',
          ownership_state: 'OWNED',
        })
        .returning(['id', 'product_id'])
        .executeTakeFirstOrThrow();
      await db.insertInto('ownership').values({ product_id: p.id, account_id: owner, acquired_via: 'FIRST_REGISTRATION', started_at: new Date('2026-03-01T10:00:00Z') }).execute();
      await db.insertInto('warranties').values({ product_id: p.id, purchase_date: '2026-03-01', start_date: '2026-03-01', duration_months: 24, lifetime: true }).execute();
      return p;
    }

    /** A piece of the account, its lifetime warranty started, claimed and received by ORBES. */
    async function receivedClaim(): Promise<{ claimId: string; productId: string }> {
      const p = await ownedPiece(accountId);
      const c = await services[0]!.open({ conversationId, productId: p.product_id, basis: 'WARRANTY' }, staff);
      await services[0]!.label(c.id, { pdf: PDF, carrierId, tracking: '6A12345678901' }, staff);
      await services[1]!.receive(c.id, staff);
      return { claimId: c.id, productId: p.id };
    }

    async function race(claimId: string, a: DecideClaimInput, b: DecideClaimInput) {
      const settled = await Promise.allSettled([services[0]!.decide(claimId, a, staff), services[1]!.decide(claimId, b, staff)]);
      const won = settled.filter((s) => s.status === 'fulfilled');
      const lost = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]!.reason).toBeInstanceOf(DomainError);
      expect((lost[0]!.reason as DomainError).code).toBe('CLAIM_STEP');
    }

    it('the same credit twice: one decision, one grant, the piece revoked once', async () => {
      for (let round = 0; round < 3; round++) {
        const { claimId, productId } = await receivedClaim();
        await race(claimId, { outcome: 'VALUE_CREDIT' }, { outcome: 'VALUE_CREDIT' });
        const claim = await db.selectFrom('warranty_claims').select(['status', 'outcome', 'grant_id']).where('id', '=', claimId).executeTakeFirstOrThrow();
        expect(claim).toMatchObject({ status: 'DONE', outcome: 'VALUE_CREDIT' });
        const grants = await db.selectFrom('tier_grants').select('id').where('account_id', '=', accountId).where('kind', '=', 'WARRANTY').execute();
        expect(grants.map((g) => g.id)).toContain(claim.grant_id);
        expect(grants).toHaveLength(round + 1);
        const p = await db.selectFrom('products').select('product_id').where('id', '=', productId).executeTakeFirstOrThrow();
        expect(await db.selectFrom('revocations').select('id').where('target_id', '=', p.product_id).execute()).toHaveLength(1);
      }
    }, 60_000);

    it('a credit against a refusal: whichever wins, the other is refused and nothing of it is written', async () => {
      const { claimId } = await receivedClaim();
      const before = (await db.selectFrom('tier_grants').select('id').where('kind', '=', 'WARRANTY').execute()).length;
      await race(claimId, { outcome: 'VALUE_CREDIT' }, { outcome: 'REFUSED', refusalReason: 'SCRATCHED' });
      const claim = await db.selectFrom('warranty_claims').select(['outcome', 'grant_id', 'refusal_reason']).where('id', '=', claimId).executeTakeFirstOrThrow();
      const after = (await db.selectFrom('tier_grants').select('id').where('kind', '=', 'WARRANTY').execute()).length;
      if (claim.outcome === 'VALUE_CREDIT') {
        expect(after).toBe(before + 1);
        expect(claim.refusal_reason).toBeNull();
      } else {
        expect(claim).toMatchObject({ outcome: 'REFUSED', refusal_reason: 'SCRATCHED', grant_id: null });
        expect(after).toBe(before);
      }
    }, 60_000);

    it('a claim opened while its owner asks for PRIVATE CARE: one of them is refused, never both written', async () => {
      for (let round = 0; round < 3; round++) {
        const email = `care-race-${round}-${randomBytes(3).toString('hex')}@example.com`;
        const owner = (await db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;
        const conversation = (await db.insertInto('client_conversations').values({ account_id: owner, status: 'ANSWERED', last_message_at: clock.now() }).returning('id').executeTakeFirstOrThrow()).id;
        // Six pieces: PRIVATE CARE is the account's (THE PROGRAM's defaults).
        for (let i = 0; i < 5; i++) await ownedPiece(owner);
        const p = await ownedPiece(owner);
        const settled = await Promise.allSettled([
          services[0]!.open({ conversationId: conversation, productId: p.product_id, basis: 'WARRANTY' }, staff),
          care.request(owner, p.product_id, { name: 'Camille Martin', address: '12 rue de la Paix\n75002 Paris' }, { type: 'account', id: owner }),
        ]);
        const won = settled.filter((s) => s.status === 'fulfilled');
        const lost = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect(lost[0]!.reason).toBeInstanceOf(DomainError);
        expect(['CARE_OPEN', 'CARE_UNAVAILABLE']).toContain((lost[0]!.reason as DomainError).code);
        const claims = await db.selectFrom('warranty_claims').select('id').where('product_id', '=', p.id).execute();
        const requests = await db.selectFrom('care_requests').select('id').where('product_id', '=', p.id).execute();
        expect(claims.length + requests.length).toBe(1);
      }
    }, 60_000);
  });
}
