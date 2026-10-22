/**
 * Orders → Returns in the console (plan MACRO M3 §2.3, R1; model/order-returns.ts, router.ts): the page's state from its
 * address and the query it sends (the last 12 months by default, all time, a valid Custom only), its words (the
 * summary, the period, the share, the flag's line, Not given only when a case has none, the variant's name), and its
 * route before an order's page.
 */
import { describe, expect, it } from 'vitest';
import {
  customReturnsProblem,
  RETURNS_COPY,
  returnsApiQuery,
  returnsFlagLine,
  returnsHrefQuery,
  returnsModelChoices,
  returnsParams,
  returnsPeriodWords,
  returnsReasons,
  returnsShare,
  returnsSizeLabel,
  returnsSizeNote,
  returnsSummary,
} from '../../src/web/admin/model/order-returns.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import type { ReturnsReport } from '../../src/web/admin/types.js';

const ID = '3f0c2a1e-9b8d-4c7e-a6f5-0123456789ab';

describe('Orders → Returns (plan MACRO M3 §2.3)', () => {
  it('reads its state from the address, anything the server would refuse as the default', () => {
    expect(returnsParams({})).toEqual({ model: null, period: '12m', customFrom: null, customTo: null, test: false });
    expect(returnsParams({ model: ID.toUpperCase(), period: 'all', test: 'true' })).toEqual({ model: ID, period: 'all', customFrom: null, customTo: null, test: true });
    expect(returnsParams({ model: 'nope', period: 'week', from: '2026-01-01' })).toEqual({ model: null, period: '12m', customFrom: null, customTo: null, test: false });
    expect(returnsParams({ period: 'custom', from: '2026-01-01', to: '2026-02-31' })).toMatchObject({ customFrom: '2026-01-01', customTo: null });
  });

  it('asks the server for 12 months by default, all time, or a valid Custom only', () => {
    expect(returnsApiQuery(returnsParams({}))).toEqual({});
    expect(returnsApiQuery(returnsParams({ model: ID, period: 'all', test: 'true' }))).toEqual({ modelId: ID, all: true, test: true });
    expect(returnsApiQuery(returnsParams({ period: 'custom', from: '2026-01-01', to: '2026-03-31' }))).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(returnsApiQuery(returnsParams({ period: 'custom', from: '2026-03-01', to: '2026-01-31' }))).toEqual({});
    expect(customReturnsProblem('2026-03-01', '2026-01-31')).toBe(RETURNS_COPY.customProblem);
    expect(customReturnsProblem('', '2026-01-31')).toBe(RETURNS_COPY.customProblem);
    expect(customReturnsProblem('2026-01-31', '2026-01-31')).toBeNull();
  });

  it('keeps its state in the address, the defaults left out', () => {
    const p = returnsParams({ model: ID, period: 'custom', from: '2026-01-01', to: '2026-01-31', test: 'true' });
    expect(href('orderReturns', {}, returnsHrefQuery(p))).toBe(`#/orders/returns?model=${ID}&period=custom&from=2026-01-01&to=2026-01-31&test=true`);
    expect(href('orderReturns', {}, returnsHrefQuery(p, { period: '12m', model: null, test: false }))).toBe('#/orders/returns');
    expect(parseHash('#/orders/returns?period=all')).toMatchObject({ name: 'orderReturns', query: { period: 'all' } });
    expect(parseHash(`#/orders/${ID}`)).toMatchObject({ name: 'order', params: { orderId: ID } });
  });

  it('says the summary, the period, a share, the flag\'s line and a size', () => {
    expect(returnsSummary({ requests: 42, returns: 30, exchanges: 12 })).toBe('42 requests · 30 returns · 12 exchanges');
    expect(returnsSummary({ requests: 1, returns: 0, exchanges: 1 })).toBe('1 request · 0 returns · 1 exchange');
    expect(returnsPeriodWords({ from: '2025-10-23', to: '2026-10-22' })).toBe('23 OCT 2025 – 22 OCT 2026');
    expect(returnsPeriodWords({ from: null, to: null })).toBe('All time');
    expect(returnsShare(0.7895)).toBe('79 %');
    expect(returnsFlagLine({ flag: 'RUNS_SMALL', exchanges: 12, toLarger: 9, toSmaller: 1 })).toBe('9 of 12 exchanges to a larger size');
    expect(returnsFlagLine({ flag: 'RUNS_LARGE', exchanges: 3, toLarger: 1, toSmaller: 2 })).toBe('2 of 3 exchanges to a smaller size');
    expect(returnsFlagLine({ flag: null, exchanges: 2, toLarger: 2, toSmaller: 0 })).toBeNull();
    expect(returnsSizeLabel(null)).toBe('ONE SIZE');
    expect(returnsSizeLabel('52')).toBe('52');
  });

  it('shows Not given only when a case has no reason; a main model with every variant, then each variant marked under it, in the filter', () => {
    const reasons = (notGiven: number) =>
      ({ byReason: ['SIZE', 'NOT_AS_EXPECTED', 'DAMAGED', 'OTHER', 'NOT_GIVEN'].map((reason) => ({ reason, returns: 0, exchanges: 0, total: reason === 'NOT_GIVEN' ? notGiven : 1, share: 0 })) }) as Pick<ReturnsReport, 'byReason'>;
    expect(returnsReasons(reasons(0))).toEqual(['SIZE', 'NOT_AS_EXPECTED', 'DAMAGED', 'OTHER']);
    expect(returnsReasons(reasons(2))).toEqual(['SIZE', 'NOT_AS_EXPECTED', 'DAMAGED', 'OTHER', 'NOT_GIVEN']);
    const models = [
      { id: 'a', name: 'AURA', variant: 'Silver', variantOf: null },
      { id: 'b', name: 'AURA', variant: 'Steel', variantOf: 'a' },
      { id: 'c', name: 'HALO', variant: null, variantOf: null },
    ];
    expect(returnsModelChoices(models)).toEqual([
      { value: '', label: 'Every model' },
      { value: 'a', label: 'AURA · every variant' },
      { value: 'b', label: '— Steel' },
      { value: 'c', label: 'HALO' },
    ]);
    expect(returnsSizeNote({ modelId: 'a', models })).toBe('AURA · every variant · The size ordered.');
    expect(returnsSizeNote({ modelId: 'b', models })).toBe('AURA · Steel · The size ordered.');
    expect(returnsSizeNote({ modelId: 'c', models })).toBe('HALO · The size ordered.');
    // A main model with its own label but no variant left is chosen alone, by its own name.
    const alone = [{ id: 'd', name: 'ORBIT', variant: 'Gold', variantOf: null }];
    expect(returnsModelChoices(alone)[1]).toEqual({ value: 'd', label: 'ORBIT · Gold' });
    expect(returnsSizeNote({ modelId: 'd', models: alone })).toBe('ORBIT · Gold · The size ordered.');
    expect(returnsSizeNote({ modelId: null, models })).toBe('Every model · The size ordered.');
  });
});
