/**
 * The returns report's fixture (plan MACRO M3 §2.4; test/services/returns-report.test.ts, test/api/admin-returns-report.test.ts):
 * order cases written row by row as services/order-cases.ts leaves them, each on an order of its own (a private-salon
 * order paid, its size set), so that every figure of the report can be counted by hand.
 */
import type { Db } from '../../src/server/db/connection.js';
import type { OrderCaseReason } from '../../src/server/db/schema.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { GrowthWorld } from './growth.js';

export interface CaseInput {
  modelId: string;
  /** The order's size; null: ONE SIZE. */
  size: string | null;
  kind: 'RETURN' | 'EXCHANGE' | 'LOST';
  reason?: OrderCaseReason;
  /** An exchange's size asked. */
  to?: string;
  opened: Date;
  cancelled?: boolean;
  /** The order of a test entrant. */
  test?: boolean;
}

export class ReturnsWorld {
  readonly growth: GrowthWorld;

  constructor(
    readonly db: Db,
    readonly adminId: string,
  ) {
    this.growth = new GrowthWorld(db);
  }

  async prepare(): Promise<this> {
    await this.growth.prepare();
    return this;
  }

  /** A model; with a label, its dot (a variant, or a main model with variants). */
  model(name: string, o: { variantOf?: string; label?: string } = {}): Promise<string> {
    return this.growth.model(name, { ...o, ...(o.label ? { swatch: '#C0C0C0' } : {}) });
  }

  /** One case on an order of its own; returns the case's id. */
  async case(c: CaseInput): Promise<string> {
    const accountId = await this.growth.account('2025-06-01', 'FR');
    if (c.test) await this.db.insertInto('test_entrants').values({ account_id: accountId }).execute();
    const orderId = await this.growth.order({ accountId, modelId: c.modelId, channel: 'SALON', paid: '2025-07-01', total: 100_000, currency: 'EUR' });
    await this.db.updateTable('orders').set({ size_label: c.size }).where('id', '=', orderId).execute();
    const exchangeSku = c.kind === 'EXCHANGE' ? await this.db.transaction().execute((tx) => ensureSku(tx, c.modelId, c.to!)) : null;
    const shipmentId =
      c.kind === 'LOST' ? (await this.db.insertInto('shipments').values({ order_id: orderId, location_id: this.growth.location }).returning('id').executeTakeFirstOrThrow()).id : null;
    const cancelledAt = c.cancelled ? new Date(c.opened.getTime() + 60_000) : null;
    return (
      await this.db
        .insertInto('order_cases')
        .values({
          order_id: orderId,
          shipment_id: shipmentId,
          kind: c.kind,
          opened_by_type: 'admin',
          opened_by_id: this.adminId,
          opened_at: c.opened,
          reason: c.kind === 'LOST' ? null : (c.reason ?? 'SIZE'),
          exchange_sku_id: exchangeSku,
          exchange_size_label: c.kind === 'EXCHANGE' ? c.to! : null,
          status: cancelledAt ? 'CANCELLED' : 'OPEN',
          cancelled_at: cancelledAt,
          cancel_note: cancelledAt ? 'Withdrawn.' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }
}
