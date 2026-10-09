/**
 * The size preselected everywhere (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.7: « only the size preselected
 * everywhere (YOUR SIZES extended to every new place a size is chosen) »).
 *
 *  - Every size picker of the collector app (each call of NOCTURNE's `sizeButtons` in src/web/verify/views/) has its
 *    way to YOUR SIZES' size: the LIVE room's `initialPick`, the private salon's `salonSizePick`, the draw's `drawPick`,
 *    EXCHANGE THE SIZE's `savedSize`. A new picker, or a second one in a file, fails here until it has its own: so the
 *    owner's « every new place a size is chosen » stays true as the app grows.
 *  - EXCHANGE THE SIZE's model (orders-model.ts `orderReturns`): the server's `returnable.savedSize`, preselected only
 *    when it is one of the sizes in stock; none otherwise (a server before it, a size greyed out, one not offered).
 * Pure: no DOM. The sheet itself is driven in Chromium by test/web/verify.orders.e2e.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE } from '../../src/web/verify/copy.js';
import { orderReturns } from '../../src/web/verify/orders-model.js';
import type { AccountOrder } from '../../src/web/verify/types.js';

const VIEWS = join(dirname(fileURLToPath(import.meta.url)), '../../src/web/verify/views');

/** Each view that draws a size picker, and the way its picker reads YOUR SIZES (a name its code calls or reads). */
const PRESELECTION: Readonly<Record<string, RegExp>> = Object.freeze({
  'live.ts': /\binitialPick\(/,
  'lookbook.ts': /\bsalonSizePick\(/,
  'releases.ts': /\bdrawPick\(/,
  'order-sheet.ts': /\breturns\.savedSize\b/,
});

describe('the size preselected everywhere (plan CUSTOMER INTELLIGENCE §3.7)', () => {
  it('gives every size picker of the collector app its way to YOUR SIZES\' size', () => {
    const calls: Record<string, number> = {};
    for (const file of readdirSync(VIEWS).filter((f) => f.endsWith('.ts') && f !== 'nocturne.ts')) {
      const src = readFileSync(join(VIEWS, file), 'utf8');
      const n = (src.match(/\bsizeButtons\(/g) ?? []).length;
      if (n > 0) calls[file] = n;
    }
    // A picker in a view not listed here: give it its preselection from YOUR SIZES, then list it.
    expect(Object.keys(calls).sort()).toEqual(Object.keys(PRESELECTION).sort());
    for (const [file, way] of Object.entries(PRESELECTION)) {
      // One picker each: a second one in the same view needs its own preselection too.
      expect(calls[file], file).toBe(1);
      const code = readFileSync(join(VIEWS, file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(import|\*|\/\/|\/\*\*)/.test(l))
        .join('\n');
      expect(code, `${file} reads YOUR SIZES' size`).toMatch(way);
    }
  });

  it('preselects in EXCHANGE THE SIZE the size the server reads from YOUR SIZES, when it is in stock; none otherwise', () => {
    const order = (savedSize: unknown): AccountOrder =>
      ({
        id: '1a2b3c4d-0000-4000-8000-000000000000',
        reference: 'OR-1A2B3C4D',
        channel: 'SALON',
        model: 'HALO',
        modelVariant: null,
        size: { label: '50' },
        status: 'DELIVERED',
        deliveredAt: '2026-10-07T10:00:00.000Z',
        returnable: { until: '2026-10-21T10:00:00.000Z', sizes: [{ label: '52', available: true }, { label: '54', available: false }, { label: '56', available: true }], savedSize },
      }) as unknown as AccountOrder;
    expect(orderReturns(order({ label: '52' }), 0)!.savedSize).toBe('52');
    // Greyed out (not in stock), not one of the sizes, or none: nothing preselected, the collector chooses.
    expect(orderReturns(order({ label: '54' }), 0)!.savedSize).toBeNull();
    expect(orderReturns(order({ label: '50' }), 0)!.savedSize).toBeNull();
    expect(orderReturns(order(null), 0)!.savedSize).toBeNull();
    expect(orderReturns(order(undefined), 0)!.savedSize).toBeNull();
    // The words are the LIVE room's and the salon's, none new.
    expect(LIVE.there.fromYours('52')).toBe('SIZE 52 · FROM YOUR SIZES');
    expect(LIVE.there.checkSize).toBe('Check it is right for this model before you confirm.');
  });
});
