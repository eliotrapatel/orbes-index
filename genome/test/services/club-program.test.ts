/**
 * THE PROGRAM and SHIPPING (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T2, step 2.2; migration 0026), on the services as
 * createContext wires them and through their console routes:
 *
 *  - without a row, THE PROGRAM is the columns' defaults (DEFAULT_PROGRAM), and no shipping rate is preset;
 *  - every value within its bounds, PALLADIUM's early access at least PLATINE's (422), a gift's model existing (404) and
 *    active (409; one chosen before and discontinued since may stay);
 *  - ADMIN only changes them, an OPERATOR and an AUDITOR read; each change audited before and after;
 *  - the program lines of each tier, as /verify will show them, from the settings;
 *  - the shipping rates set whole, each currency and service once, a rate left out cleared;
 *  - the birthday credit (plan CUSTOMER INTELLIGENCE §3.5 SB.4.3, migration 0045): on, € 20 for 30 days by default, its
 *    switch a boolean, 1 to 100 000 000 minor units and 1 to 365 days, saved and audited with the rest; no program line.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { HOUSE_CURRENCIES } from '../../src/server/db/schema.js';
import { checkProgram, DEFAULT_PROGRAM, giftModels, programLines, programMoney, type ClubProgram } from '../../src/server/services/club-program.js';
import { liveMoney } from '../../src/server/services/live-console.js';
import { ORDER_CURRENCIES } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { adminClient, createAdmin, createHarness, errorOf, type Client, type Harness } from '../api/support.js';
import { createModel } from '../support/live.js';

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('THE PROGRAM\'s amounts', () => {
  it('says money as the LIVE console does (programMoney, kept apart to avoid an import cycle)', () => {
    for (const currency of HOUSE_CURRENCIES) for (const minor of [0, 5_000, 10_050, 123_456_789]) expect(programMoney(minor, currency)).toBe(liveMoney(minor, currency));
  });
});

describe('THE PROGRAM and SHIPPING (BP-19 T2)', () => {
  let h: Harness;
  let admin: { type: 'admin'; id: string };
  let clients: { ADMIN: Client; OPERATOR: Client; AUDITOR: Client };
  let gift: string;
  let inactive: string;

  beforeAll(async () => {
    h = await createHarness();
    await h.ctx.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    clients = { ADMIN: await adminClient(h, 'ADMIN'), OPERATOR: await adminClient(h, 'OPERATOR'), AUDITOR: await adminClient(h, 'AUDITOR') };
    gift = await createModel(h.ctx.db, 'ECLIPSE');
    inactive = await createModel(h.ctx.db, 'HALO');
    await h.ctx.db.updateTable('models').set({ active: false }).where('id', '=', inactive).execute();
  });
  afterAll(() => h.close());

  const svc = () => h.ctx.services.clubProgram;
  const audits = (action: string) => h.ctx.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', action).orderBy('id').execute();
  const program = (over: Partial<ClubProgram> = {}): ClubProgram => ({ ...DEFAULT_PROGRAM, creditChannels: [...DEFAULT_PROGRAM.creditChannels], ...over });

  it('reads the defaults without a row: 4 h and 2 h, free standard and express shipping, care 1 and every piece, priority from PLATINE, no gift, € 50 and € 100 for 12 months on every channel, the birthday credit on at € 20 for 30 days', async () => {
    expect(await h.ctx.db.selectFrom('club_program_settings').selectAll().execute()).toEqual([]);
    expect(await svc().read()).toEqual({
      earlyAccessPalladiumHours: 4,
      earlyAccessPlatineHours: 2,
      shippingFreePlatine: 'STANDARD',
      shippingFreePalladium: 'EXPRESS',
      carePiecesPlatine: 1,
      carePiecesPalladium: null,
      messagesPriorityMinTier: 2,
      giftPlatineModelId: null,
      giftPalladiumModelId: null,
      creditPlatineMinor: 5000,
      creditPalladiumMinor: 10000,
      creditCurrency: 'EUR',
      creditValidityMonths: 12,
      creditChannels: ['DRAW', 'LIVE', 'SALON'],
      experienceMembersEveningMinTier: 2,
      experienceLaunchPreviewMinTier: 3,
      experiencePartnerMinTier: 3,
      birthdayCreditOn: true,
      birthdayCreditMinor: 2000,
      birthdayCreditDays: 30,
    });
    // The column defaults of migrations 0026 and 0045 are DEFAULT_PROGRAM's: a row inserted with none reads the same, but
    // for PLATINE's PRIVATE CARE: 0048's default is every piece (null), which DEFAULT_PROGRAM takes in step 1.4 of the
    // ORBES CARE plan (step 1.1 changes only the column).
    await h.ctx.db.insertInto('club_program_settings').values({ id: 1 }).execute();
    expect(await svc().read()).toEqual({ ...program(), carePiecesPlatine: null });
    await h.ctx.db.deleteFrom('club_program_settings').execute();
    expect(Object.isFrozen(DEFAULT_PROGRAM)).toBe(true);
    // The credit and the rates are in the currencies an order is priced in.
    expect([...HOUSE_CURRENCIES]).toEqual([...ORDER_CURRENCIES]);
    const sheet = await svc().sheet();
    expect(sheet).toMatchObject({ gifts: { platine: null, palladium: null }, updatedAt: null, updatedBy: null });
    expect(sheet.giftOptions.map((m) => m.name)).toContain('ECLIPSE');
    expect(sheet.giftOptions.map((m) => m.name)).not.toContain('HALO');
    expect((await svc().shippingRates()).items).toEqual([]);
  });

  it('says each tier\'s program in its lines, each only while its setting gives it', () => {
    const p = program();
    expect(programLines(p, 1)).toEqual([]);
    expect(programLines(p, 2)).toEqual([
      'Early access to each draw: a place reserved directly 2 hours before entries open to everyone, unless its page says otherwise.',
      'Free shipping on every order.',
      'The yearly care of 1 piece a year by the ORBES atelier, asked for from the piece, with a prepaid label both ways.',
      'Priority with ORBES Client Services: your messages are read first.',
      'A credit of €\u00a050, valid 12 months, on a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.',
      'The members’ evening, once a year, by invitation in THE CIRCLE.',
    ]);
    expect(programLines(p, 3, { 3: 'ECLIPSE' })).toEqual([
      'Early access to each draw: a place reserved directly 4 hours before entries open to everyone, unless its page says otherwise.',
      'Free express shipping on every order.',
      'The yearly care of every piece by the ORBES atelier, once a year each, asked for from the piece, with a prepaid label both ways.',
      'A welcome gift, ECLIPSE, added to your next order.',
      'A credit of €\u00a0100, valid 12 months, on a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.',
      'Launch previews and partner experiences, by invitation in THE CIRCLE.',
    ]);
    // The birthday credit is no tier's benefit: on or off, at any amount, no line of any tier changes.
    for (const t of [1, 2, 3] as const) {
      expect(programLines(program({ birthdayCreditOn: false }), t)).toEqual(programLines(p, t));
      expect(programLines(program({ birthdayCreditMinor: 5_000, birthdayCreditDays: 7 }), t)).toEqual(programLines(p, t));
    }
    // Nothing given, nothing said: no early access, no shipping, no care, priority off, no credit; one hour, one month.
    const bare = program({
      earlyAccessPalladiumHours: 1,
      earlyAccessPlatineHours: 0,
      shippingFreePlatine: 'NONE',
      carePiecesPlatine: 0,
      carePiecesPalladium: 3,
      messagesPriorityMinTier: 0,
      creditPlatineMinor: 0,
      creditValidityMonths: 1,
      creditCurrency: 'GBP',
      creditChannels: ['SALON'],
      experienceMembersEveningMinTier: 1,
      experiencePartnerMinTier: 2,
    });
    expect(programLines(bare, 1)).toEqual(['The members’ evening, once a year, by invitation in THE CIRCLE.']);
    expect(programLines(bare, 2)).toEqual(['Partner experiences, by invitation in THE CIRCLE.']);
    expect(programLines(bare, 3)).toEqual([
      'Early access to each draw: a place reserved directly 1 hour before entries open to everyone, unless its page says otherwise.',
      'Free express shipping on every order.',
      'The yearly care of 3 pieces a year by the ORBES atelier, asked for from the piece, with a prepaid label both ways.',
      'A credit of £\u00a0100, valid 1 month, on a piece from THE PRIVATE SALON.',
      'Launch previews, by invitation in THE CIRCLE.',
    ]);
  });

  it('holds every value to its bounds, and PALLADIUM\'s early access to at least PLATINE\'s (422)', async () => {
    for (const [over, what] of [
      [{ earlyAccessPalladiumHours: 337 }, 'hours over 336'],
      [{ earlyAccessPlatineHours: -1 }, 'negative hours'],
      [{ earlyAccessPlatineHours: 1.5 }, 'a fraction of an hour'],
      [{ shippingFreePlatine: 'FAST' }, 'an unknown shipping'],
      [{ carePiecesPlatine: 21 }, 'care over 20'],
      [{ carePiecesPalladium: -1 }, 'negative care'],
      [{ messagesPriorityMinTier: 1 }, 'priority from TITANE'],
      [{ creditPlatineMinor: 100_000_001 }, 'a credit over the bound'],
      [{ creditCurrency: 'JPY' }, 'another currency'],
      [{ creditValidityMonths: 0 }, 'no validity'],
      [{ creditValidityMonths: 61 }, 'over 60 months'],
      [{ creditChannels: [] }, 'no channel'],
      [{ creditChannels: ['STORE'] }, 'an unknown channel'],
      [{ experiencePartnerMinTier: 0 }, 'an experience for no tier'],
      [{ birthdayCreditOn: 'yes' }, 'a birthday switch not a boolean'],
      [{ birthdayCreditOn: undefined }, 'no birthday switch'],
      [{ birthdayCreditMinor: 0 }, 'a birthday credit of 0'],
      [{ birthdayCreditMinor: 2000.5 }, 'a fraction of a minor unit'],
      [{ birthdayCreditDays: 0 }, 'a birthday credit valid no day'],
      [{ birthdayCreditDays: 366 }, 'a birthday credit valid 366 days'],
    ] as [Record<string, unknown>, string][]) {
      expect(() => checkProgram({ ...program(), ...over }), what).toThrow(DomainError);
    }
    // The birthday credit's words (§3.5 SB.4.3), and its bounds reached.
    expect(() => checkProgram({ ...program(), birthdayCreditMinor: 100_000_001 })).toThrow('The birthday credit, in minor units, is 1 to 100000000.');
    expect(() => checkProgram({ ...program(), birthdayCreditDays: 366 })).toThrow('The birthday credit’s validity, in days, is 1 to 365.');
    expect(() => checkProgram({ ...program(), birthdayCreditOn: 1 })).toThrow('The birthday credit is given or not: true or false.');
    // PLATINE's PRIVATE CARE every piece (null, migration 0048, plan ORBES CARE step 1.1), as PALLADIUM's.
    expect(checkProgram({ ...program(), carePiecesPlatine: null })).toMatchObject({ carePiecesPlatine: null, carePiecesPalladium: null });
    expect(checkProgram(program({ birthdayCreditOn: false, birthdayCreditMinor: 100_000_000, birthdayCreditDays: 365 }))).toMatchObject({ birthdayCreditOn: false, birthdayCreditMinor: 100_000_000, birthdayCreditDays: 365 });
    expect(checkProgram(program({ birthdayCreditMinor: 1, birthdayCreditDays: 1 }))).toMatchObject({ birthdayCreditOn: true, birthdayCreditMinor: 1, birthdayCreditDays: 1 });
    await rejects(svc().update(program({ earlyAccessPalladiumHours: 2, earlyAccessPlatineHours: 3 }), admin), 'PROGRAM_EARLY_ACCESS', 422);
    // Equal windows are allowed: PLATINE and PALLADIUM from the same time.
    expect(checkProgram(program({ earlyAccessPalladiumHours: 3, earlyAccessPlatineHours: 3 })).earlyAccessPlatineHours).toBe(3);
    expect(await h.ctx.db.selectFrom('club_program_settings').selectAll().execute()).toEqual([]);
  });

  it('refuses a gift model unknown (404) or inactive (409); a model chosen and discontinued since may stay', async () => {
    await rejects(svc().update(program({ giftPlatineModelId: '00000000-0000-4000-8000-000000000000' }), admin), 'MODEL_NOT_FOUND', 404);
    await rejects(svc().update(program({ giftPalladiumModelId: inactive }), admin), 'MODEL_INACTIVE', 409);
    const sheet = await svc().update(program({ giftPlatineModelId: gift }), admin);
    expect(sheet.gifts.platine).toMatchObject({ id: gift, name: 'ECLIPSE', active: true, discontinued: false, sizes: 0, available: 0 });
    expect(sheet.lines.PLATINE).toContain('A welcome gift, ECLIPSE, added to your next order.');
    // Discontinued since: it stays in the program, says so, and gives no line.
    await h.ctx.db.updateTable('models').set({ active: false, discontinued_at: h.clock.now(), discontinued_by: admin.id }).where('id', '=', gift).execute();
    const kept = await svc().update(program({ giftPlatineModelId: gift, creditPlatineMinor: 6000 }), admin);
    expect(kept.gifts.platine).toMatchObject({ id: gift, active: false, discontinued: true });
    expect(kept.lines.PLATINE.some((l) => l.startsWith('A welcome gift'))).toBe(false);
    await h.ctx.db.updateTable('models').set({ active: true, discontinued_at: null, discontinued_by: null }).where('id', '=', gift).execute();
  });

  it('counts a gift model\'s offered sizes only, the ones a gift can take: a size set aside is left out (NEXT LOT §3.3)', async () => {
    const sized = await createModel(h.ctx.db, 'JONC ASIDE');
    for (const label of ['50', '52']) await ensureSku(h.ctx.db, sized, label);
    await h.ctx.db.updateTable('skus').set({ set_aside_at: h.clock.now() }).where('model_id', '=', sized).where('size_label', '=', '52').execute();
    expect((await giftModels(h.ctx.db, [sized])).get(sized)).toMatchObject({ id: sized, sizes: 1 });
  });

  it('saves THE PROGRAM whole for an ADMIN, audited before and after; read back as set', async () => {
    const before = await svc().read();
    const next = program({
      earlyAccessPalladiumHours: 6,
      earlyAccessPlatineHours: 3,
      shippingFreePlatine: 'NONE',
      carePiecesPalladium: 2,
      messagesPriorityMinTier: 3,
      giftPalladiumModelId: gift,
      creditCurrency: 'CHF',
      creditChannels: ['LIVE', 'DRAW'],
      birthdayCreditMinor: 2550,
      birthdayCreditDays: 15,
    });
    const sheet = await svc().update(next, admin);
    expect(await svc().read()).toEqual({ ...next, creditChannels: ['DRAW', 'LIVE'] });
    expect(sheet.updatedBy?.id).toBe(admin.id);
    expect(sheet.updatedAt).toEqual(h.clock.now());
    const [last] = (await audits('club.program.update')).slice(-1);
    expect(last).toMatchObject({ actor_type: 'admin', actor_id: admin.id, details: { before: { ...before }, after: { ...next, creditChannels: ['DRAW', 'LIVE'] } } });
    // The birthday credit in the before and the after, as every figure (§3.5 SB.4.3: no new code).
    expect(last!.details).toMatchObject({ before: { birthdayCreditOn: true, birthdayCreditMinor: 2000, birthdayCreditDays: 30 }, after: { birthdayCreditOn: true, birthdayCreditMinor: 2550, birthdayCreditDays: 15 } });
    expect(await h.ctx.db.selectFrom('club_program_settings').select(['birthday_credit_on', 'birthday_credit_minor', 'birthday_credit_days']).executeTakeFirstOrThrow()).toEqual({ birthday_credit_on: true, birthday_credit_minor: 2550, birthday_credit_days: 15 });
    // Switched off: the amount and the days kept for when it comes back.
    await svc().update({ ...next, birthdayCreditOn: false }, admin);
    expect(await svc().read()).toMatchObject({ birthdayCreditOn: false, birthdayCreditMinor: 2550, birthdayCreditDays: 15 });
    expect((await audits('club.program.update')).slice(-1)[0]!.details).toMatchObject({ before: { birthdayCreditOn: true }, after: { birthdayCreditOn: false, birthdayCreditMinor: 2550, birthdayCreditDays: 15 } });
    // Only a console user changes it.
    await rejects(svc().update(next, SYSTEM_ACTOR), 'FORBIDDEN', 403);
  });

  it('serves THE PROGRAM to every reader of the console and lets only an ADMIN change it', async () => {
    for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) {
      const res = await clients[role].get('/api/admin/club/program');
      expect(res.statusCode, role).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ earlyAccessPalladiumHours: 6, lines: { TITANE: expect.any(Array), PLATINE: expect.any(Array), PALLADIUM: expect.any(Array) } });
    }
    const body = { ...program(), giftPalladiumModelId: gift };
    for (const role of ['AUDITOR', 'OPERATOR'] as const) {
      const res = await clients[role].request('PUT', '/api/admin/club/program', { body });
      expect(res.statusCode, role).toBe(403);
    }
    const bad = await clients.ADMIN.request('PUT', '/api/admin/club/program', { body: { ...body, earlyAccessPlatineHours: 5 } });
    expect(bad.statusCode).toBe(422);
    expect(errorOf(bad)).toEqual({ code: 'PROGRAM_EARLY_ACCESS', message: 'PALLADIUM’s early access starts no later than PLATINE’s.' });
    const missing = await clients.ADMIN.request('PUT', '/api/admin/club/program', { body: { earlyAccessPalladiumHours: 4 } });
    expect(missing.statusCode).toBe(400);
    // The birthday credit is part of the program sent whole: without it, or out of its bounds, refused.
    const { birthdayCreditOn: _on, ...withoutBirthday } = body;
    expect((await clients.ADMIN.request('PUT', '/api/admin/club/program', { body: withoutBirthday })).statusCode).toBe(400);
    expect((await clients.ADMIN.request('PUT', '/api/admin/club/program', { body: { ...body, birthdayCreditDays: 366 } })).statusCode).toBe(400);
    expect((await clients.ADMIN.request('PUT', '/api/admin/club/program', { body: { ...body, birthdayCreditMinor: 0 } })).statusCode).toBe(400);
    const ok = await clients.ADMIN.request('PUT', '/api/admin/club/program', { body });
    expect(ok.statusCode).toBe(200);
    expect(await svc().read()).toEqual(body);
  });

  it('sets the shipping rates whole (ADMIN), each currency and service once, a rate left out cleared; audited before and after', async () => {
    const a = await svc().setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 2000 }, { currency: 'EUR', service: 'EXPRESS', feeMinor: 4000 }, { currency: 'GBP', service: 'STANDARD', feeMinor: 1800 }], admin);
    expect(a.items.map((r) => [r.currency, r.service, r.feeMinor])).toEqual([
      ['EUR', 'STANDARD', 2000],
      ['EUR', 'EXPRESS', 4000],
      ['GBP', 'STANDARD', 1800],
    ]);
    const b = await svc().setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 2500 }], admin);
    expect(b.items.map((r) => [r.currency, r.service, r.feeMinor])).toEqual([['EUR', 'STANDARD', 2500]]);
    expect((await audits('order.shipping_rates.update')).slice(-1)[0]!.details).toEqual({
      before: { 'EUR STANDARD': 2000, 'EUR EXPRESS': 4000, 'GBP STANDARD': 1800 },
      after: { 'EUR STANDARD': 2500 },
    });
    await rejects(svc().setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 1 }, { currency: 'EUR', service: 'STANDARD', feeMinor: 2 }], admin), 'VALIDATION_FAILED', 400);
    await rejects(svc().setShippingRates([{ currency: 'JPY', service: 'STANDARD', feeMinor: 1 }], admin), 'VALIDATION_FAILED', 400);
    await rejects(svc().setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: -1 }], admin), 'VALIDATION_FAILED', 400);
    // The routes: every reader reads them, an ADMIN alone sets them.
    expect((await clients.AUDITOR.get('/api/admin/orders/shipping-rates')).statusCode).toBe(200);
    expect((await clients.OPERATOR.request('PUT', '/api/admin/orders/shipping-rates', { body: { rates: [] } })).statusCode).toBe(403);
    const cleared = await clients.ADMIN.request('PUT', '/api/admin/orders/shipping-rates', { body: { rates: [] } });
    expect(cleared.statusCode).toBe(200);
    expect(JSON.parse(cleared.body)).toEqual({ items: [] });
  });
});
