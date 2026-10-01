/**
 * The decoder latency budget that `npm run bench` enforces is the one
 * ORBES-CODE-SPEC §10 states (a timing assertion itself would be flaky in a
 * loaded test run; the benchmark checks it on a quiet machine).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DECODER_LATENCY_BUDGET_MS, decoderBudgetIssues } from '../../scripts/decoder-budget.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('decoder latency budget (ORBES-CODE-SPEC §10)', () => {
  it('passes figures within budget and names every figure over it', () => {
    expect(decoderBudgetIssues({ code: { p50: 46 }, free: { p50: 155, p95: 306 } })).toEqual([]);
    expect(decoderBudgetIssues({ code: { p50: 120 }, free: { p50: 210, p95: 420 } })).toEqual([
      'frames with a code, p50 120.0 ms ≥ 100 ms',
      'code-free frames, p50 210.0 ms ≥ 200 ms',
      'code-free frames, p95 420.0 ms ≥ 400 ms',
    ]);
    expect(decoderBudgetIssues({ code: { p50: Number.NaN }, free: { p50: 1, p95: 1 } })).toHaveLength(1);
  });

  it('is the budget the specification publishes', () => {
    const spec = readFileSync(join(ROOT, '../docs/ORBES-CODE-SPEC.md'), 'utf8');
    const row = spec.split('\n').find((l) => l.startsWith('| Latency |'));
    expect(row).toBeDefined();
    const b = DECODER_LATENCY_BUDGET_MS;
    expect(row).toContain(`median < ${b.codeP50} ms`);
    expect(row).toContain(`median < ${b.freeP50} ms`);
    expect(row).toContain(`p95 < ${b.freeP95} ms`);
  });
});
