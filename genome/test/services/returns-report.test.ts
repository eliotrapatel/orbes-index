/**
 * The returns and exchanges report (macro scope of 2026-10-20, K12 R1; plan MACRO M3 §2.4, step M3.4;
 * services/returns-report.ts), on the service as createContext wires it, over cases written as order-cases.ts leaves
 * them (test/support/returns.ts), each counted by hand:
 *
 *   SMALL    exchanges 52→54, 52→56, 54→56 (SIZE); a return of 52 (NOT AS EXPECTED); a return of 54 (OTHER) opened at
 *            the period's first Paris instant. Out: a return of 54 opened one minute before it, a return cancelled, a
 *            parcel lost, a test entrant's exchange 52→54.
 *   LARGE    exchanges 56→54, 58→54, 52→54: two of three smaller.
 *   TWO      exchanges 52→54 twice: under three, never flagged.
 *   MIXED    exchanges 52→54 twice, 56→54, 58→54: two each way.
 *   ONESIZE  exchanges ONE SIZE → ONE SIZE three times: one size, never flagged.
 *   AURA     a return of 50 (DAMAGED) on the main model, and one of 50 (OTHER) on its variant STEEL: two rows.
 *
 * The clock: 22 October 2026, 11:00 in Paris; the default period is 23 October 2025 to 22 October 2026 (Paris).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import {
  aggregateReturns,
  exchangeDirection,
  returnsCsv,
  returnsFlag,
  returnsPeriod,
  RETURNS_CSV_COLUMNS,
  twelveMonthsBefore,
  type ModelReturnsRow,
  type ReturnsModel,
  type ReturnsReport,
} from '../../src/server/services/returns-report.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { ReturnsWorld } from '../support/returns.js';

const NOW = '2026-10-22T09:00:00.000Z';
const at = (iso: string) => new Date(iso);

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('the returns report\'s rules (plan MACRO M3 §2.1)', () => {
  it('reads an exchange\'s direction by compareSizes, ONE SIZE as none and the same size whatever its case as neither', () => {
    expect(exchangeDirection('52', '54')).toBe(1);
    expect(exchangeDirection('54', '52')).toBe(-1);
    expect(exchangeDirection('9', '10')).toBe(1);
    expect(exchangeDirection('52', '52')).toBe(0);
    expect(exchangeDirection('m', 'M')).toBe(0);
    expect(exchangeDirection(null, 'ONE SIZE')).toBe(0);
    expect(exchangeDirection(null, '52')).toBe(1);
    expect(exchangeDirection('52', null)).toBe(0);
  });

  it('flags at 3 exchanges and two thirds one way: 2 (none), 3 of 3 larger (RUNS SMALL), 2 of 3 smaller (RUNS LARGE), mixed (none)', () => {
    expect(returnsFlag(2, 2, 0)).toBeNull();
    expect(returnsFlag(3, 3, 0)).toBe('RUNS_SMALL');
    expect(returnsFlag(3, 1, 2)).toBe('RUNS_LARGE');
    expect(returnsFlag(4, 2, 2)).toBeNull();
    expect(returnsFlag(12, 8, 4)).toBe('RUNS_SMALL');
    expect(returnsFlag(12, 7, 5)).toBeNull();
    expect(returnsFlag(3, 0, 0)).toBeNull();
  });

  it('counts a case without a reason as Not given', () => {
    const m: ReturnsModel = { id: 'm1', name: 'ORBIT', variant: null, variantOf: null };
    const r = aggregateReturns(
      [
        { kind: 'RETURN', reason: null, modelId: 'm1', orderSize: '52', exchangeSize: null },
        { kind: 'EXCHANGE', reason: 'SIZE', modelId: 'm1', orderSize: '52', exchangeSize: '54' },
      ],
      new Map([['m1', m]]),
    );
    expect(r.summary).toEqual({ requests: 2, returns: 1, exchanges: 1 });
    expect(r.byReason.map((x) => [x.reason, x.returns, x.exchanges, x.total, x.share])).toEqual([
      ['SIZE', 0, 1, 1, 0.5],
      ['NOT_AS_EXPECTED', 0, 0, 0, 0],
      ['DAMAGED', 0, 0, 0, 0],
      ['OTHER', 0, 0, 0, 0],
      ['NOT_GIVEN', 1, 0, 1, 0.5],
    ]);
    expect(r.byModel[0]!.reasons).toEqual({ SIZE: 1, NOT_AS_EXPECTED: 0, DAMAGED: 0, OTHER: 0, NOT_GIVEN: 1 });
  });

  it('reads the period in Paris days: the last 12 months by default, all time, and refuses a bad one (422 PERIOD_INVALID)', () => {
    const now = at(NOW);
    expect(returnsPeriod({}, now)).toEqual({ from: '2025-10-23', to: '2026-10-22', start: at('2025-10-22T22:00:00.000Z'), end: at('2026-10-22T22:00:00.000Z') });
    expect(returnsPeriod({ all: true }, now)).toEqual({ from: null, to: null, start: null, end: null });
    // Winter time: a Paris day of January starts at 23:00 UTC the day before.
    expect(returnsPeriod({ from: '2026-01-10', to: '2026-01-10' }, now)).toMatchObject({ start: at('2026-01-09T23:00:00.000Z'), end: at('2026-01-10T23:00:00.000Z') });
    expect(twelveMonthsBefore('2028-02-29')).toBe('2027-03-01');
    expect(twelveMonthsBefore('2026-03-01')).toBe('2025-03-02');
    for (const q of [{ from: '2026-01-01' }, { to: '2026-01-01' }, { from: '2026-02-01', to: '2026-01-01' }, { all: true, from: '2026-01-01', to: '2026-01-02' }]) {
      expect(() => returnsPeriod(q, now)).toThrow(DomainError);
      try {
        returnsPeriod(q, now);
      } catch (e) {
        expect((e as DomainError).code).toBe('PERIOD_INVALID');
        expect((e as DomainError).httpStatus).toBe(422);
      }
    }
  });
});

describe('the returns report (plan MACRO M3 §2.2, R1)', () => {
  let h: Harness;
  let w: ReturnsWorld;
  const m = { small: '', large: '', two: '', mixed: '', oneSize: '', aura: '', steel: '' };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    const admin = await createAdmin(h.ctx, 'ADMIN');
    w = await new ReturnsWorld(h.t.db, admin.id).prepare();
    m.small = await w.model('SMALL');
    m.large = await w.model('LARGE');
    m.two = await w.model('TWO');
    m.mixed = await w.model('MIXED');
    m.oneSize = await w.model('ONESIZE');
    m.aura = await w.model('AURA', { label: 'Silver' });
    m.steel = await w.model('AURA', { variantOf: m.aura, label: 'Steel' });
    const day = at('2026-03-10T10:00:00.000Z');
    const exchange = (modelId: string, size: string | null, to: string) => w.case({ modelId, size, kind: 'EXCHANGE', to, opened: day });
    await exchange(m.small, '52', '54');
    await exchange(m.small, '52', '56');
    await exchange(m.small, '54', '56');
    await w.case({ modelId: m.small, size: '52', kind: 'RETURN', reason: 'NOT_AS_EXPECTED', opened: day });
    // The period's first Paris instant (23 October 2025, 00:00 in Paris, summer time), and one minute before it.
    await w.case({ modelId: m.small, size: '54', kind: 'RETURN', reason: 'OTHER', opened: at('2025-10-22T22:00:00.000Z') });
    await w.case({ modelId: m.small, size: '54', kind: 'RETURN', reason: 'OTHER', opened: at('2025-10-22T21:59:00.000Z') });
    // Never counted: a return cancelled, a parcel lost; a test entrant's exchange only when asked.
    await w.case({ modelId: m.small, size: '52', kind: 'RETURN', reason: 'SIZE', opened: day, cancelled: true });
    await w.case({ modelId: m.small, size: '52', kind: 'LOST', opened: day });
    await w.case({ modelId: m.small, size: '52', kind: 'EXCHANGE', to: '54', opened: day, test: true });
    await exchange(m.large, '56', '54');
    await exchange(m.large, '58', '54');
    await exchange(m.large, '52', '54');
    await exchange(m.two, '52', '54');
    await exchange(m.two, '52', '54');
    await exchange(m.mixed, '52', '54');
    await exchange(m.mixed, '52', '54');
    await exchange(m.mixed, '56', '54');
    await exchange(m.mixed, '58', '54');
    for (let i = 0; i < 3; i += 1) await exchange(m.oneSize, null, 'ONE SIZE');
    await w.case({ modelId: m.aura, size: '50', kind: 'RETURN', reason: 'DAMAGED', opened: day });
    await w.case({ modelId: m.steel, size: '50', kind: 'RETURN', reason: 'OTHER', opened: day });
  });
  afterAll(() => h?.close());

  const report = (q: Parameters<Harness['ctx']['services']['returnsReport']['report']>[0] = {}) => h.ctx.services.returnsReport.report(q);
  const row = (r: ReturnsReport, id: string): ModelReturnsRow | undefined => r.byModel.find((x) => x.model.id === id);
  const sizes = (r: ReturnsReport, id: string) => r.bySize.filter((x) => x.model.id === id).map((x) => [x.size, x.returns, x.exchanges, x.toLarger, x.toSmaller]);

  it('counts the last 12 months by reason, model and size; cancelled cases, parcel problems and test orders left out', async () => {
    const r = await report();
    expect(r.period).toEqual({ from: '2025-10-23', to: '2026-10-22' });
    expect(r.test).toBe(false);
    expect(r.modelId).toBeNull();
    expect(r.summary).toEqual({ requests: 19, returns: 4, exchanges: 15 });
    expect(r.byReason.map((x) => [x.reason, x.returns, x.exchanges, x.total, x.share])).toEqual([
      ['SIZE', 0, 15, 15, 0.7895],
      ['NOT_AS_EXPECTED', 1, 0, 1, 0.0526],
      ['DAMAGED', 1, 0, 1, 0.0526],
      ['OTHER', 2, 0, 2, 0.1053],
      ['NOT_GIVEN', 0, 0, 0, 0],
    ]);
    // A variant on its own row, after its main model; the rows by name.
    expect(r.byModel.map((x) => [x.model.name, x.model.variant])).toEqual([
      ['AURA', 'Silver'],
      ['AURA', 'Steel'],
      ['LARGE', null],
      ['MIXED', null],
      ['ONESIZE', null],
      ['SMALL', null],
      ['TWO', null],
    ]);
    expect(row(r, m.small)).toMatchObject({ cases: 5, returns: 2, exchanges: 3, reasons: { SIZE: 3, NOT_AS_EXPECTED: 1, DAMAGED: 0, OTHER: 1, NOT_GIVEN: 0 }, toLarger: 3, toSmaller: 0, flag: 'RUNS_SMALL' });
    expect(row(r, m.large)).toMatchObject({ cases: 3, exchanges: 3, toLarger: 1, toSmaller: 2, flag: 'RUNS_LARGE' });
    expect(row(r, m.two)).toMatchObject({ exchanges: 2, toLarger: 2, flag: null });
    expect(row(r, m.mixed)).toMatchObject({ exchanges: 4, toLarger: 2, toSmaller: 2, flag: null });
    expect(row(r, m.oneSize)).toMatchObject({ exchanges: 3, toLarger: 0, toSmaller: 0, flag: null });
    expect(row(r, m.aura)).toMatchObject({ cases: 1, returns: 1, reasons: { DAMAGED: 1 }, flag: null });
    expect(row(r, m.steel)).toMatchObject({ cases: 1, returns: 1, reasons: { OTHER: 1 }, model: { variantOf: m.aura } });
    expect(sizes(r, m.small)).toEqual([
      ['52', 1, 2, 2, 0],
      ['54', 1, 1, 1, 0],
    ]);
    expect(sizes(r, m.large)).toEqual([
      ['52', 0, 1, 1, 0],
      ['56', 0, 1, 0, 1],
      ['58', 0, 1, 0, 1],
    ]);
    expect(sizes(r, m.oneSize)).toEqual([[null, 0, 3, 0, 0]]);
    // The filter's choices: every model, a main model followed by its variants.
    const ids = r.models.map((x) => x.id);
    expect(ids.indexOf(m.steel)).toBe(ids.indexOf(m.aura) + 1);
  });

  it('brings the test entrants\' orders in when asked', async () => {
    const r = await report({ test: true });
    expect(r.test).toBe(true);
    expect(r.summary).toEqual({ requests: 20, returns: 4, exchanges: 16 });
    expect(row(r, m.small)).toMatchObject({ exchanges: 4, toLarger: 4, flag: 'RUNS_SMALL' });
    expect(sizes(r, m.small)).toEqual([
      ['52', 1, 3, 3, 0],
      ['54', 1, 1, 1, 0],
    ]);
  });

  it('narrows to a model: one alone, a main model with its variants, a variant alone; refuses an unknown one (404 MODEL_NOT_FOUND)', async () => {
    const small = await report({ modelId: m.small });
    expect(small.modelId).toBe(m.small);
    expect(small.byModel.map((x) => x.model.id)).toEqual([m.small]);
    expect(small.summary).toEqual({ requests: 5, returns: 2, exchanges: 3 });
    expect(small.bySize.every((x) => x.model.id === m.small)).toBe(true);
    // The filter keeps every model as a choice.
    expect(small.models.length).toBe((await report()).models.length);
    expect((await report({ modelId: m.aura })).byModel.map((x) => x.model.id)).toEqual([m.aura, m.steel]);
    expect((await report({ modelId: m.steel.toUpperCase() })).byModel.map((x) => x.model.id)).toEqual([m.steel]);
    expect(await refusal(report({ modelId: '00000000-0000-4000-8000-000000000000' }))).toEqual({ code: 'MODEL_NOT_FOUND', status: 404, message: 'Model not found.' });
    expect((await refusal(report({ modelId: 'not-a-model' }))).code).toBe('MODEL_NOT_FOUND');
  });

  it('reads a period by its Paris bounds and all time', async () => {
    const first = await report({ from: '2025-10-23', to: '2025-10-23' });
    expect(first.summary).toEqual({ requests: 1, returns: 1, exchanges: 0 });
    const before = await report({ from: '2025-10-22', to: '2025-10-22' });
    expect(before.summary).toEqual({ requests: 1, returns: 1, exchanges: 0 });
    expect((await report({ all: true })).summary).toEqual({ requests: 20, returns: 5, exchanges: 15 });
    expect((await report({ all: true })).period).toEqual({ from: null, to: null });
    expect(await refusal(report({ from: '2026-01-01' }))).toMatchObject({ code: 'PERIOD_INVALID', status: 422 });
  });

  it('writes the CSV\'s columns: the by-model rows then the by-size rows, counts only, named by its Paris days', async () => {
    const file = await h.ctx.services.returnsReport.csv({ modelId: m.small });
    expect(file.filename).toBe('orbes-returns-2025-10-23-to-2026-10-22.csv');
    expect(file.contentType).toMatch(/^text\/csv/);
    const lines = file.body.trim().split('\r\n');
    expect(lines[0]).toBe(RETURNS_CSV_COLUMNS.map((c) => `"${c}"`).join(','));
    expect(lines.slice(1)).toEqual([
      '"By model","SMALL","","","5","2","3","3","1","0","1","0","3","0","RUNS SMALL"',
      '"By size","SMALL","","52","3","1","2","","","","","","2","0",""',
      '"By size","SMALL","","54","2","1","1","","","","","","1","0",""',
    ]);
    expect((await h.ctx.services.returnsReport.csv({ all: true })).filename).toBe('orbes-returns-all-time-to-2026-10-22.csv');
    // The pure writer: a variant's label in its own column, ONE SIZE for none.
    const csv = returnsCsv(await report({ modelId: m.oneSize }));
    expect(csv).toContain('"By size","ONESIZE","","ONE SIZE","3","0","3"');
    expect(returnsCsv(await report({ modelId: m.steel }))).toContain('"By model","AURA","Steel"');
  });
});
