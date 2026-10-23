/**
 * A set's release read by the release readers (macro scope of 2026-10-20, K44 T1; plan MACRO M3 §5.2, « the compiler's
 * list », step M3.14; services/release-offer.ts), each named KEPT, EXCLUDED, ADAPTED or SET-AWARE there. The set's draw
 * and LIVE RELEASE are written here as M3.15 and M3.16 will create them (no flow creates one before):
 *
 *  - `releaseOffer`: a model's release one piece (its model), a set's its pieces in the set's order;
 *  - ADAPTED, PAST: a set's draw drawn is its own entry, under its set's name, its pieces' names and photographs, its
 *    model all null, its line in sets; EXCLUDED, a model's sheet never lists it (`modelReleases`);
 *  - EXCLUDED, the house's guarantees: a RELEASE guarantee for a set's release refused (409 GUARANTEE_SET_RELEASE), a
 *    MODEL guarantee of one of its pieces never set aside for it;
 *  - ADAPTED, the planner: a set's LIVE RELEASE planned per piece, each piece's sizes by its own interest, the release's
 *    sets shared in each piece;
 *  - SET-AWARE: YOUR SIZES preselects one size per piece (a draw's `entryFor`, the room's `savedSizesByPiece`); the
 *    release's sizes linked to their piece's model's SKUs (`linkDropSizes`), a size without its piece refused.
 * The CAMPAIGN tab (KEPT) is test/services/campaign.test.ts's, GROWTH (KEPT) test/services/growth.test.ts's.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { modelReleases } from '../../src/server/services/past-releases.js';
import { releaseOffer } from '../../src/server/services/release-offer.js';
import { linkDropSizes } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';
import { giveSizes } from '../support/draws.js';
import { createAccount } from '../support/live.js';

const SEED_ENC = `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`;

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('a set\'s release read by the release readers (plan MACRO M3 §5.2)', () => {
  let h: Harness;
  let operator: Actor;
  let category: number;
  let ring: string;
  let chain: string;
  let set: string;
  const photo: Record<string, string> = {};

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-10T09:00:00.000Z');
    await seedCatalog(h.ctx);
    category = (await h.ctx.categories.getByCode('J'))!.index;
    operator = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    ring = await model('HALO', 'RING', ['52', '54']);
    chain = await model('LINEA', 'NECKLACE', ['45', '50']);
    set = (await h.ctx.services.sets.create({ name: 'The Pair', code: 'THE-PAIR', modelIds: [ring, chain] }, operator)).id;
  });
  afterAll(() => h?.close());

  const db = () => h.t.db;

  async function model(name: string, type: 'RING' | 'NECKLACE', labels: string[]): Promise<string> {
    const bytes = randomBytes(48);
    photo[name] = createHash('sha256').update(bytes).digest('hex');
    await db().insertInto('media_objects').values({ sha256: photo[name]!, mime: 'image/jpeg', bytes, width: 4, height: 5 }).execute();
    const m = await db()
      .insertInto('models')
      .values({ category_id: category, name, type, sku_prefix: `${name}-${randomUUID().slice(0, 6).toUpperCase()}`, image_sha256: photo[name]! })
      .returning('id')
      .executeTakeFirstOrThrow();
    await giveSizes(db(), m.id, labels, type);
    return m.id;
  }

  /** A release of the set (a draw by default), published, its sizes per piece (3 pieces each), unlinked as created. */
  async function release(o: { mode?: 'DRAW' | 'LIVE'; opens: string; drawn?: boolean; title?: string }): Promise<{ id: string; sizes: Record<string, string> }> {
    const opens = new Date(o.opens);
    const seed = randomBytes(32);
    const live = o.mode === 'LIVE';
    const d = await db()
      .insertInto('drops')
      .values({
        set_id: set,
        mode: o.mode ?? 'DRAW',
        title: o.title ?? 'THE PAIR — DRAW',
        quantity: 3,
        opens_at: opens,
        closes_at: new Date(opens.getTime() + 3_600_000),
        published_at: new Date(opens.getTime() - 86_400_000),
        seed_enc: SEED_ENC,
        seed_hash: o.drawn ? new Uint8Array(createHash('sha256').update(seed).digest()) : new Uint8Array(32),
        ...(o.drawn ? { seed: new Uint8Array(seed), drawn_at: new Date(opens.getTime() + 7_200_000) } : {}),
        // (ONE QUEUE, lot Q1, D1: a LIVE release has a pace.)
        ...(live ? { early_access_hours: 0, live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1, price_minor: 100_000, currency: 'EUR', quantity_line: '3 SETS', pace_batch: 5000, pace_minutes: 1 } : {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const sizes: Record<string, string> = {};
    for (const [i, [piece, label]] of ([[1, '52'], [1, '54'], [2, '45'], [2, '50']] as const).entries()) {
      sizes[label] = (await db().insertInto('drop_sizes').values({ drop_id: d.id, piece, label, position: i + 1, stock: 3 }).returning('id').executeTakeFirstOrThrow()).id;
    }
    return { id: d.id, sizes };
  }

  it('reads what a release sells: a model\'s its one piece, a set\'s its pieces in order', async () => {
    const r = await release({ opens: '2026-11-20T10:00:00Z' });
    const row = await db().selectFrom('drops').select(['model_id', 'set_id']).where('id', '=', r.id).executeTakeFirstOrThrow();
    const offer = await releaseOffer(db(), row);
    expect(offer).toMatchObject({ kind: 'SET', modelId: null, set: { id: set, name: 'The Pair', code: 'THE-PAIR', active: true } });
    expect(offer.pieces.map((p) => [p.piece, p.model.id, p.model.name, p.model.imageUrl])).toEqual([
      [1, ring, 'HALO', `/api/v1/media/${photo.HALO}`],
      [2, chain, 'LINEA', `/api/v1/media/${photo.LINEA}`],
    ]);
    expect(await releaseOffer(db(), { model_id: ring, set_id: null })).toMatchObject({ kind: 'MODEL', modelId: ring, set: null, pieces: [{ piece: null, model: { id: ring, name: 'HALO' } }] });
  });

  it('links each size of a set\'s release to its piece\'s model\'s SKU; a size without its piece refused', async () => {
    const r = await release({ opens: '2026-11-21T10:00:00Z' });
    await inTransaction(db(), (tx) => linkDropSizes(tx, r.id, null));
    const linked = await db()
      .selectFrom('drop_sizes as s')
      .innerJoin('skus as k', 'k.id', 's.sku_id')
      .select(['s.piece', 's.label', 'k.model_id', 'k.size_label'])
      .where('s.drop_id', '=', r.id)
      .orderBy('s.position')
      .execute();
    expect(linked.map((x) => [x.piece, x.label, x.model_id, x.size_label])).toEqual([
      [1, '52', ring, '52'],
      [1, '54', ring, '54'],
      [2, '45', chain, '45'],
      [2, '50', chain, '50'],
    ]);
    await db().insertInto('drop_sizes').values({ drop_id: r.id, piece: null, label: '56', position: 5, stock: 1 }).execute();
    expect(await refusal(inTransaction(db(), (tx) => linkDropSizes(tx, r.id, null)))).toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('Give each size of a set’s release its piece.') });
  });

  it('PAST: a set\'s draw drawn is its own entry under its set\'s name, its pieces\' names and photographs, in sets; never on a model\'s sheet', async () => {
    const r = await release({ opens: '2026-11-01T10:00:00Z', drawn: true, title: 'THE PAIR — PAST' });
    const page = await h.ctx.services.pastReleases.page({ page: 1, pageSize: 20 });
    expect(page.items.find((c) => c.id === r.id)).toEqual({
      id: r.id,
      kind: 'DRAW',
      title: 'THE PAIR — PAST',
      model: { name: null, type: null, collection: null, variant: null },
      imageUrl: null,
      opensAt: new Date('2026-11-01T10:00:00Z'),
      quantityLine: '3 SETS',
      set: {
        name: 'The Pair',
        pieces: [
          { name: 'HALO', variant: null, imageUrl: `/api/v1/media/${photo.HALO}` },
          { name: 'LINEA', variant: null, imageUrl: `/api/v1/media/${photo.LINEA}` },
        ],
      },
    });
    expect(await modelReleases(db(), [ring, chain], h.clock.now())).toEqual([]);
  });

  it('the house\'s guarantees: never granted for a set\'s release, never set aside for one', async () => {
    const r = await release({ opens: '2026-11-25T10:00:00Z' });
    const a = await createAccount(db());
    const grant = (scope: 'RELEASE' | 'MODEL', targetId: string) => h.ctx.services.guarantees.grant(a.id, { scope, targetId, pieces: 1, validUntil: '2026-12-31', visible: true }, operator);
    expect(await refusal(grant('RELEASE', r.id))).toEqual({ code: 'GUARANTEE_SET_RELEASE', status: 409, message: 'A set’s release is never guaranteed.' });
    // A guarantee of one of its pieces' models waits: the set's release is not a release of that model.
    expect((await grant('MODEL', ring)).setAsideFor).toBeNull();
    expect(await db().selectFrom('house_guarantees').select('id').where('covered_drop_id', '=', r.id).execute()).toEqual([]);
  });

  it('YOUR SIZES preselects a size for each piece of a set\'s draw and LIVE RELEASE, each by its own kind', async () => {
    const draw = await release({ opens: '2026-11-09T10:00:00Z' });
    const live = await release({ mode: 'LIVE', opens: '2026-11-12T10:00:00Z', title: 'THE PAIR — LIVE' });
    const a = await createAccount(db());
    await db().insertInto('account_sizes').values([{ account_id: a.id, kind: 'RING', value_mm: 52 }, { account_id: a.id, kind: 'NECKLACE', value_mm: 450 }]).execute();
    const read = await h.ctx.services.drops.entryFor(a.id, draw.id);
    expect(read).toMatchObject({ entry: null, savedSize: null, savedSizes: [{ piece: 1, id: draw.sizes['52'], label: '52' }, { piece: 2, id: draw.sizes['45'], label: '45' }] });
    expect(await h.ctx.services.liveRoom.savedSizesByPiece(a.id, live.id)).toEqual([
      { piece: 1, id: live.sizes['52'], label: '52' },
      { piece: 2, id: live.sizes['45'], label: '45' },
    ]);
    // A piece whose kind has no saved size preselects nothing.
    const b = await createAccount(db());
    await db().insertInto('account_sizes').values({ account_id: b.id, kind: 'NECKLACE', value_mm: 500 }).execute();
    expect((await h.ctx.services.drops.entryFor(b.id, draw.id)).savedSizes).toEqual([{ piece: 2, id: draw.sizes['50'], label: '50' }]);
    expect(await h.ctx.services.liveRoom.savedSizesByPiece(b.id, live.id)).toEqual([{ piece: 2, id: live.sizes['50'], label: '50' }]);
  });

  it('the planner plans a set\'s LIVE RELEASE per piece: each piece\'s sizes by its own interest, the release\'s sets in each', async () => {
    const r = await release({ mode: 'LIVE', opens: '2026-11-30T10:00:00Z', title: 'THE PAIR — PLANNED' });
    // Two collectors will be there: one in 52 and 45, the other in 54 and 45.
    for (const [ringSize, chainSize] of [['52', '45'], ['54', '45']] as const) {
      const a = await createAccount(db());
      await db().insertInto('live_interest').values({ drop_id: r.id, account_id: a.id, size_id: r.sizes[ringSize]! }).execute();
      await db()
        .insertInto('live_interest_sizes')
        .values([
          { drop_id: r.id, account_id: a.id, piece: 1, size_id: r.sizes[ringSize]! },
          { drop_id: r.id, account_id: a.id, piece: 2, size_id: r.sizes[chainSize]! },
        ])
        .execute();
    }
    const plan = await h.ctx.services.liveInsights.plan(r.id);
    expect(plan.modelType).toBe('RING · NECKLACE');
    expect(plan.pieces!.map((p) => [p.piece, p.model.id, p.modelType, p.sizes.map((s) => [s.label, s.interest])])).toEqual([
      [1, ring, 'RING', [['52', 1], ['54', 1]]],
      [2, chain, 'NECKLACE', [['45', 2], ['50', 0]]],
    ]);
    expect(plan.sizes.map((s) => s.label)).toEqual(['52', '54', '45', '50']);
    expect(plan.reasoning[0]).toContain('A set of 2 pieces');
    if (plan.quantity !== null) {
      for (const p of plan.pieces!) expect(p.sizes.reduce((n, s) => n + (s.suggested ?? 0), 0)).toBe(plan.quantity);
      // All the necklaces' demand is in 45: every set's necklace there.
      expect(plan.pieces![1]!.sizes.map((s) => s.suggested)).toEqual([plan.quantity, 0]);
    }
  });
});
