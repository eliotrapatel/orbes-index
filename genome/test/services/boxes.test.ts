/**
 * The standard boxes (macro scope of 2026-10-20, D16 B1; plan MACRO M3 §1.2, step M3.2; services/boxes.ts), on the
 * service and the routes as createContext and buildApp wire them:
 *
 *  - a box created with its name, inside sides, empty weight and cost; every bound (1 to 2 000 mm, 1 to 30 000 g, a cost
 *    of 0 to 1 000 000.00 with a currency of cents, both or neither); its name once whatever the case (409
 *    BOX_NAME_TAKEN);
 *  - the card rule: the 95 × 62 mm certificate card flat in either orientation, refused otherwise (422
 *    BOX_TOO_SMALL_FOR_CARD), on a change too; CERTIFICATE_CARD_MM is the card render/certificate.ts draws;
 *  - changed field by field, nothing changed nothing written; set aside refused while an active model packs in it, its
 *    own or a variant's main model's (409 BOX_IN_USE), allowed once the model is inactive; reinstated;
 *  - the audit: `box.create`, `box.update` (each field before and after), `box.set_aside`, `box.reinstate`.
 * The routes are test/api/admin-boxes.test.ts's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { CERTIFICATE_CARD } from '../../src/server/render/certificate.js';
import { cardFits, CERTIFICATE_CARD_MM } from '../../src/server/services/boxes.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

const CUBE = { name: 'CUBE 100', insideLengthMm: 100, insideWidthMm: 70, insideHeightMm: 40, emptyWeightG: 120 };

describe('BoxService (plan MACRO M3 §1.2, B1)', () => {
  let h: Harness;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    await seedCatalog(h.ctx);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
  });
  afterAll(() => h?.close());

  const boxes = () => h.ctx.services.boxes;

  it('holds the certificate card render/certificate.ts draws, flat in either orientation', () => {
    expect(CERTIFICATE_CARD_MM).toEqual({ long: Math.max(CERTIFICATE_CARD.widthMm, CERTIFICATE_CARD.heightMm), short: Math.min(CERTIFICATE_CARD.widthMm, CERTIFICATE_CARD.heightMm) });
    expect(cardFits(95, 62)).toBe(true);
    expect(cardFits(62, 95)).toBe(true);
    expect(cardFits(94, 62)).toBe(false);
    expect(cardFits(95, 61)).toBe(false);
    expect(cardFits(61, 2000)).toBe(false);
  });

  it('creates a box with its sides, empty weight and cost; every bound; its name once whatever the case; audited box.create', async () => {
    const b = await boxes().create({ ...CUBE, name: '  CUBE   100 ', costMinor: 85, currency: 'eur' }, admin);
    expect(b).toEqual({
      id: expect.any(String),
      name: 'CUBE 100',
      insideLengthMm: 100,
      insideWidthMm: 70,
      insideHeightMm: 40,
      emptyWeightG: 120,
      active: true,
      costMinor: 85,
      currency: 'EUR',
      models: 0,
      createdAt: new Date('2026-10-22T09:00:00.000Z'),
      updatedAt: new Date('2026-10-22T09:00:00.000Z'),
    });
    expect((await h.t.db.selectFrom('boxes').select('created_by').where('id', '=', b.id).executeTakeFirstOrThrow()).created_by).toBe(admin.id);
    expect(await refusal(boxes().create({ ...CUBE, name: 'cube 100' }, admin))).toMatchObject({ code: 'BOX_NAME_TAKEN', status: 409 });
    // Without a cost: none.
    expect(await boxes().create({ ...CUBE, name: 'NO COST' }, admin)).toMatchObject({ costMinor: null, currency: null });
    // The upper bounds hold, one past them is refused, as are a fraction, 0 and a cost without its currency.
    expect(await boxes().create({ name: 'X'.repeat(60), insideLengthMm: 2000, insideWidthMm: 2000, insideHeightMm: 2000, emptyWeightG: 30_000, costMinor: 100_000_000, currency: 'CHF' }, admin)).toMatchObject({
      insideLengthMm: 2000,
      emptyWeightG: 30_000,
      costMinor: 100_000_000,
    });
    for (const bad of [
      { name: 'X'.repeat(61) },
      { name: '' },
      { insideLengthMm: 2001 },
      { insideHeightMm: 0 },
      { insideWidthMm: 70.5 },
      { emptyWeightG: 30_001 },
      { emptyWeightG: 0 },
      { costMinor: 100_000_001, currency: 'EUR' },
      { costMinor: -1, currency: 'EUR' },
      { costMinor: 10 },
      { costMinor: 10, currency: 'JPY' },
      { costMinor: 10, currency: 'EU' },
    ]) {
      expect((await refusal(boxes().create({ ...CUBE, name: `BAD ${JSON.stringify(bad)}`.slice(0, 60), ...bad }, admin))).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    const entry = (await h.ctx.audit.list({ action: 'box.create', targetId: b.id })).items[0];
    expect(entry).toMatchObject({ actorId: admin.id, details: { name: 'CUBE 100', insideLengthMm: 100, insideWidthMm: 70, insideHeightMm: 40, emptyWeightG: 120, costMinor: 85, currency: 'EUR' } });
  });

  it('takes the 95 × 62 mm card flat in either orientation, and refuses a box that cannot, created or changed', async () => {
    expect(await boxes().create({ ...CUBE, name: 'LONG WAY', insideLengthMm: 95, insideWidthMm: 62 }, admin)).toMatchObject({ insideLengthMm: 95, insideWidthMm: 62 });
    expect(await boxes().create({ ...CUBE, name: 'OTHER WAY', insideLengthMm: 62, insideWidthMm: 95 }, admin)).toMatchObject({ insideLengthMm: 62, insideWidthMm: 95 });
    const tooSmall = { code: 'BOX_TOO_SMALL_FOR_CARD', status: 422, message: 'This box cannot take the 95 × 62 mm certificate card flat.' };
    expect(await refusal(boxes().create({ ...CUBE, name: 'SHORT', insideLengthMm: 94, insideWidthMm: 62 }, admin))).toEqual(tooSmall);
    expect(await refusal(boxes().create({ ...CUBE, name: 'NARROW', insideLengthMm: 61, insideWidthMm: 200 }, admin))).toEqual(tooSmall);
    // The height does not take the card: a deep narrow box is refused.
    expect(await refusal(boxes().create({ ...CUBE, name: 'TUBE', insideLengthMm: 40, insideWidthMm: 40, insideHeightMm: 200 }, admin))).toEqual(tooSmall);
    const b = await boxes().create({ ...CUBE, name: 'SHRINK' }, admin);
    expect(await refusal(boxes().update(b.id, { insideWidthMm: 60 }, admin))).toEqual(tooSmall);
    expect((await boxes().get(b.id)).insideWidthMm).toBe(70);
    expect(await h.t.db.selectFrom('boxes').select('id').where('name', 'in', ['SHORT', 'NARROW', 'TUBE']).execute()).toEqual([]);
  });

  it('changes a box field by field, audited box.update with each field before and after; nothing changed, nothing written; 404 for an unknown box', async () => {
    const b = await boxes().create({ ...CUBE, name: 'EDIT ME' }, admin);
    h.clock.advance(60_000);
    const changed = await boxes().update(b.id, { name: 'EDITED', insideHeightMm: 55, costMinor: 120, currency: 'GBP' }, admin);
    expect(changed).toMatchObject({ name: 'EDITED', insideHeightMm: 55, costMinor: 120, currency: 'GBP', updatedAt: new Date('2026-10-22T09:01:00.000Z'), createdAt: new Date('2026-10-22T09:00:00.000Z') });
    const entries = async () => (await h.ctx.audit.list({ action: 'box.update', targetId: b.id })).items;
    expect((await entries())[0]).toMatchObject({
      actorId: admin.id,
      details: { name: { from: 'EDIT ME', to: 'EDITED' }, insideHeightMm: { from: 40, to: 55 }, costMinor: { from: null, to: 120 }, currency: { from: null, to: 'GBP' } },
    });
    await boxes().update(b.id, { name: 'EDITED', insideHeightMm: 55 }, admin);
    expect(await entries()).toHaveLength(1);
    expect((await boxes().update(b.id, { costMinor: null, currency: null }, admin))).toMatchObject({ costMinor: null, currency: null });
    expect((await refusal(boxes().update(b.id, { costMinor: 5 }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(boxes().update(b.id, {}, admin))).code).toBe('VALIDATION_FAILED');
    expect(await refusal(boxes().update(b.id, { name: 'Cube 100' }, admin))).toMatchObject({ code: 'BOX_NAME_TAKEN', status: 409 });
    expect(await refusal(boxes().update('00000000-0000-4000-8000-000000000000', { name: 'X' }, admin))).toMatchObject({ code: 'BOX_NOT_FOUND', status: 404 });
    expect(await refusal(boxes().get('nope'))).toMatchObject({ code: 'BOX_NOT_FOUND', status: 404 });
  });

  it('sets a box aside only while no active model packs in it, its own or a variant\'s main model\'s; reinstates it; lists the active first', async () => {
    const b = await boxes().create({ ...CUBE, name: 'IN USE' }, admin);
    const main = (await seedCatalog(h.ctx)).modelId;
    const m = await h.t.db.selectFrom('models').selectAll().where('id', '=', main).executeTakeFirstOrThrow();
    await h.t.db.updateTable('models').set({ variant_label: 'Steel', variant_swatch: '#8A8D8F' }).where('id', '=', main).execute();
    const blue = (
      await h.t.db
        .insertInto('models')
        .values({ category_id: m.category_id, name: m.name, type: m.type, sku_prefix: `${m.sku_prefix}-BL`, variant_of: main, variant_label: 'Blue', variant_swatch: '#1F3A93' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await h.ctx.services.catalog.setModelPacking(main, { boxId: b.id }, admin);
    expect((await boxes().get(b.id)).models).toBe(1);
    expect(await refusal(boxes().setAside(b.id, admin))).toEqual({ code: 'BOX_IN_USE', status: 409, message: '2 active models pack in this box: give them another box first.' });
    // The main model inactive: its variant still reads its box.
    await h.t.db.updateTable('models').set({ active: false }).where('id', '=', main).execute();
    expect(await refusal(boxes().setAside(b.id, admin))).toMatchObject({ code: 'BOX_IN_USE', message: '1 active model packs in this box: give it another box first.' });
    // The variant with its own box: nothing active packs in it any more.
    const other = await boxes().create({ ...CUBE, name: 'OTHER' }, admin);
    await h.ctx.services.catalog.setModelPacking(blue, { boxId: other.id }, admin);
    expect(await boxes().setAside(b.id, admin)).toMatchObject({ active: false });
    expect((await h.ctx.audit.list({ action: 'box.set_aside', targetId: b.id })).items).toHaveLength(1);
    // Again: nothing written.
    await boxes().setAside(b.id, admin);
    expect((await h.ctx.audit.list({ action: 'box.set_aside', targetId: b.id })).items).toHaveLength(1);
    const list = await boxes().list();
    expect(list.findIndex((x) => x.id === b.id)).toBeGreaterThan(list.findIndex((x) => x.id === other.id));
    expect(list.filter((x) => !x.active).every((x) => list.indexOf(x) >= list.filter((y) => y.active).length)).toBe(true);
    expect(await boxes().reinstate(b.id, admin)).toMatchObject({ active: true });
    expect((await h.ctx.audit.list({ action: 'box.reinstate', targetId: b.id })).items[0]).toMatchObject({ actorId: admin.id, details: { name: 'IN USE' } });
    // Never deleted while a model names it.
    await expect(h.t.db.deleteFrom('boxes').where('id', '=', b.id).execute()).rejects.toThrow();
  });
});
