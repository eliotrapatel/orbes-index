import { describe, expect, it } from 'vitest';
import {
  createManualClock,
  DEFAULT_PAGE_SIZE,
  makePage,
  mapPage,
  MAX_PAGE_SIZE,
  noopLogger,
  pageOffset,
  pageRequest,
  SYSTEM_ACTOR,
  systemActor,
} from '../../src/server/types.js';
import { badRequest, conflict, DomainError, forbidden, isDomainError, notFound, tooManyRequests, unauthorized, validationError } from '../../src/server/errors.js';

describe('pagination helpers', () => {
  it('defaults, clamps and ignores garbage', () => {
    expect(pageRequest()).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(pageRequest({ page: '3', pageSize: '20' })).toEqual({ page: 3, pageSize: 20 });
    expect(pageRequest({ page: 2, pageSize: 1000 })).toEqual({ page: 2, pageSize: MAX_PAGE_SIZE });
    for (const bad of ['0', '-1', '1.5', 'abc', '', ' ', '1e3', null, {}, [], NaN, 2.5, -3]) {
      expect(pageRequest({ page: bad, pageSize: bad })).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    }
    expect(pageRequest({ page: '99999999999' }).page).toBe(1); // over 9 digits is garbage, not a huge offset
    expect(pageRequest({ page: 5_000_000 }).page).toBe(1_000_000);
  });

  it('computes offsets and builds pages', () => {
    const req = { page: 3, pageSize: 25 };
    expect(pageOffset(req)).toBe(50);
    const p = makePage([1, 2], 52, req);
    expect(p).toEqual({ items: [1, 2], page: 3, pageSize: 25, total: 52 });
    expect(mapPage(p, (n) => n * 10)).toEqual({ items: [10, 20], page: 3, pageSize: 25, total: 52 });
  });
});

describe('clock, actor and logger', () => {
  it('manual clock is deterministic and hands out copies', () => {
    const c = createManualClock('2026-01-01T00:00:00.000Z');
    const d = c.now();
    d.setFullYear(1999);
    expect(c.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(c.advance(60_000).toISOString()).toBe('2026-01-01T00:01:00.000Z');
    c.set(new Date('2030-01-01T00:00:00.000Z'));
    expect(c.now().getUTCFullYear()).toBe(2030);
    expect(() => c.advance(Infinity)).toThrow(RangeError);
    expect(() => createManualClock('not a date')).toThrow(RangeError);
  });

  it('system actor helpers', () => {
    expect(SYSTEM_ACTOR).toEqual({ type: 'system' });
    expect(Object.isFrozen(SYSTEM_ACTOR)).toBe(true);
    expect(systemActor('bootstrap')).toEqual({ type: 'system', id: 'bootstrap' });
    expect(() => noopLogger.info({ a: 1 }, 'm')).not.toThrow();
  });
});

describe('DomainError', () => {
  it('carries code, status and a public message; internal detail never reaches the response', () => {
    const e = new DomainError('PRODUCT_NOT_FOUND', 404, 'Product not found.', { detail: 'row 42 missing', cause: new Error('sql') });
    expect(e).toBeInstanceOf(Error);
    expect(isDomainError(e)).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect(e.name).toBe('DomainError');
    expect(e.message).toBe('Product not found.');
    expect(e.cause).toBeInstanceOf(Error);
    expect(e.toResponse()).toEqual({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } });
    expect(JSON.stringify(e.toResponse())).not.toContain('row 42');
  });

  it('validates its own construction', () => {
    expect(() => new DomainError('lower', 400, 'x')).toThrow(TypeError);
    expect(() => new DomainError('OK', 200, 'x')).toThrow(TypeError);
  });

  it('shorthands map to consistent codes and statuses', () => {
    const cases: [DomainError, string, number][] = [
      [badRequest('BAD_CODE', 'Bad.'), 'BAD_CODE', 400],
      [validationError(), 'VALIDATION_FAILED', 400],
      [unauthorized(), 'UNAUTHORIZED', 401],
      [forbidden(), 'FORBIDDEN', 403],
      [notFound('Product'), 'NOT_FOUND', 404],
      [notFound('Category', 'CATEGORY_NOT_FOUND'), 'CATEGORY_NOT_FOUND', 404],
      [conflict('ALREADY_OWNED', 'Already owned.'), 'ALREADY_OWNED', 409],
      [tooManyRequests(), 'RATE_LIMITED', 429],
    ];
    for (const [e, code, status] of cases) {
      expect(e.code).toBe(code);
      expect(e.httpStatus).toBe(status);
    }
    expect(notFound('Product').publicMessage).toBe('Product not found.');
  });
});
