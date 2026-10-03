import { describe, expect, it } from 'vitest';
import {
  anomalyName,
  formatAge,
  formatCount,
  formatDate,
  formatDateTime,
  formatWindowBound,
  groupChars,
  humanize,
  isoDay,
  percent,
  reasonLabel,
  shortHash,
  summarizeDetails,
  versionLabel,
} from '../../src/web/admin/format.js';
import { buildQuery, filenameFromDisposition } from '../../src/web/admin/api.js';
import { href, parseHash, parseQuery, productHref } from '../../src/web/admin/router.js';

describe('admin formatters', () => {
  it('formats dates in UTC, whatever the input form', () => {
    expect(formatDate('2026-10-01T23:30:00.000Z')).toBe('01 OCT 2026');
    expect(formatDate('2026-02-09')).toBe('09 FEB 2026');
    expect(formatDate(new Date(Date.UTC(2024, 0, 1)))).toBe('01 JAN 2024');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
    expect(formatDateTime('2026-10-01T14:32:09.000Z')).toBe('01 OCT 2026 · 14:32 UTC');
    expect(formatDateTime('2026-10-01T14:32:09.000Z', { seconds: true })).toBe('01 OCT 2026 · 14:32:09 UTC');
    expect(isoDay(new Date(Date.UTC(2026, 8, 5, 23, 59)))).toBe('2026-09-05');
  });

  it('reads a scans window as the server does: a UTC day from its first second to its last', () => {
    expect(formatWindowBound('2026-07-04', 'from')).toBe('04 JUL 2026 · 00:00:00 UTC');
    expect(formatWindowBound('2026-10-01', 'to')).toBe('01 OCT 2026 · 23:59:59 UTC');
    expect(formatWindowBound('2026-10-01T23:59:59.999Z', 'to')).toBe('01 OCT 2026 · 23:59:59 UTC');
    expect(formatWindowBound('2026-10-01T10:01:00.000Z', 'from')).toBe('01 OCT 2026 · 10:01:00 UTC');
    expect(formatWindowBound(undefined, 'from')).toBe('…');
    expect(formatWindowBound('', 'to')).toBe('…');
  });

  it('formats ages relative to an injected clock', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(formatAge('2026-10-01T11:59:40Z', now)).toBe('JUST NOW');
    expect(formatAge('2026-10-01T11:48:00Z', now)).toBe('12 MIN AGO');
    expect(formatAge('2026-10-01T09:00:00Z', now)).toBe('3 H AGO');
    expect(formatAge('2026-09-26T12:00:00Z', now)).toBe('5 D AGO');
    expect(formatAge('2026-06-01T12:00:00Z', now)).toBe('01 JUN 2026');
    expect(formatAge('2026-10-02T12:00:00Z', now)).toBe('02 OCT 2026'); // future (clock skew) → date
  });

  it('formats counts with thin-space thousands and never NaN', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(12480)).toBe('12 480');
    expect(formatCount(1234567)).toBe('1 234 567');
    expect(formatCount(-1500)).toBe('−1 500');
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(5, 0)).toBe('0%');
  });

  it('names anomaly types: UNSOLD PIECE SCANNED (S-07), any other type humanized', () => {
    expect(anomalyName('UNSOLD_PIECE_SCAN')).toBe('UNSOLD PIECE SCANNED');
    expect(anomalyName('IMPOSSIBLE_TRAVEL')).toBe('IMPOSSIBLE TRAVEL');
    expect(anomalyName('constructor')).toBe('CONSTRUCTOR');
    expect(anomalyName(null)).toBe('—');
  });

  it('reads a scan\'s reasons: an anomaly under its console name (ANOMALY: UNSOLD PIECE SCANNED), any other reason humanized', () => {
    expect(reasonLabel('ANOMALY:UNSOLD_PIECE_SCAN')).toBe('ANOMALY: UNSOLD PIECE SCANNED');
    expect(reasonLabel('ANOMALY:IMPOSSIBLE_TRAVEL')).toBe('ANOMALY: IMPOSSIBLE TRAVEL');
    expect(reasonLabel('UNSOLD_PIECE_SCAN')).toBe('UNSOLD PIECE SCAN');
    expect(reasonLabel('MALFORMED:CRC')).toBe('MALFORMED:CRC');
    expect(reasonLabel('RISK_THRESHOLD_OWNER')).toBe('RISK THRESHOLD OWNER');
    expect(reasonLabel(null)).toBe('—');
  });

  it('humanizes enums and shortens hashes', () => {
    expect(humanize('COUNTERFEIT_FLAGGED')).toBe('COUNTERFEIT FLAGGED');
    expect(humanize('monolithe')).toBe('MONOLITHE');
    expect(humanize(null)).toBe('—');
    const h = 'a'.repeat(30) + 'beef';
    expect(shortHash(h)).toBe('aaaaaaaa…beef');
    expect(shortHash('short')).toBe('short');
    expect(shortHash(null)).toBe('—');
    expect(groupChars('JBSWY3DPEHPK3PXP', 4)).toBe('JBSW Y3DP EHPK 3PXP');
    expect(versionLabel('CODE', 1)).toBe('CODE-01');
    expect(versionLabel('GENOME', 12)).toBe('GENOME-12');
  });

  it('summarises JSON details on one bounded line', () => {
    expect(summarizeDetails({ a: 1, b: null, c: { d: 'x' } })).toBe('a: 1 · c: {"d":"x"}');
    expect(summarizeDetails({ long: 'x'.repeat(300) }, 20)).toHaveLength(20);
    expect(summarizeDetails(null)).toBe('');
  });
});

describe('admin api helpers', () => {
  it('builds query strings from defined, non-empty values only', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: null, e: 'x y', f: false })).toBe('?a=1&e=x%20y&f=false');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });

  it('extracts a safe file name from Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="ORBES-O26-J-00001-I1-classic-30mm.svg"', 'x')).toBe('ORBES-O26-J-00001-I1-classic-30mm.svg');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''ORBES%20code.pdf", 'x')).toBe('ORBES_code.pdf');
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"', 'x')).toBe('_.._etc_passwd');
    expect(filenameFromDisposition('attachment; filename=".hidden"', 'fallback.svg')).toBe('hidden');
    expect(filenameFromDisposition(null, 'fallback.svg')).toBe('fallback.svg');
    expect(filenameFromDisposition('attachment', 'fallback.svg')).toBe('fallback.svg');
  });
});

describe('admin hash router', () => {
  it('parses routes, params and queries', () => {
    expect(parseHash('')).toMatchObject({ name: 'dashboard', path: '/dashboard' });
    expect(parseHash('#/')).toMatchObject({ name: 'dashboard' });
    expect(parseHash('#/products?status=OWNED&page=2')).toEqual({ name: 'products', params: {}, query: { status: 'OWNED', page: '2' }, path: '/products' });
    expect(parseHash('#/products/O26-J-00184')).toMatchObject({ name: 'product', params: { productId: 'O26-J-00184' } });
    expect(parseHash('#/products/O26-J-00184/')).toMatchObject({ name: 'product' });
    expect(parseHash('#/nope')).toMatchObject({ name: 'not-found' });
    expect(parseHash('#/cases?status=OPEN')).toMatchObject({ name: 'cases', query: { status: 'OPEN' } });
    expect(href('cases', {}, { anomalyId: 'a1', status: '' })).toBe('#/cases?anomalyId=a1');
    expect(parseHash('#/products/%E0%A4%A')).toMatchObject({ name: 'not-found' }); // malformed escape
    expect(parseHash('products')).toMatchObject({ name: 'products' });
    // A model's lookbook (P-R02): a page under the Catalogue, reached from its row.
    const modelId = '73c68b47-012d-4569-a59a-fd2effa613c1';
    expect(parseHash('#/catalogue')).toMatchObject({ name: 'catalogue' });
    expect(parseHash(`#/catalogue/${modelId}`)).toMatchObject({ name: 'model', params: { modelId }, path: `/catalogue/${modelId}` });
    expect(href('model', { modelId })).toBe(`#/catalogue/${modelId}`);
  });

  it('drops unsafe query keys and bounds values', () => {
    const q = parseQuery('__proto__=x&constructor=y&ok=1&long=' + 'z'.repeat(500) + '&bad=%E0%A4%A');
    expect(Object.keys(q).sort()).toEqual(['long', 'ok']);
    expect(q.long).toHaveLength(200);
    expect(Object.getPrototypeOf(q)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('builds hashes that round-trip', () => {
    const h = href('scans', {}, { productId: 'O26-J-00184', state: '', page: 3 });
    expect(h).toBe('#/scans?productId=O26-J-00184&page=3');
    expect(parseHash(h)).toMatchObject({ name: 'scans', query: { productId: 'O26-J-00184', page: '3' } });
    expect(productHref('O26-J-00184')).toBe('#/products/O26-J-00184');
    expect(parseHash(href('product', { productId: 'a/b c' })).params.productId).toBe('a/b c');
    expect(() => href('product')).toThrow(/missing route param/);
  });
});
