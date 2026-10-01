/**
 * Per-frame latency budget of the reference decoder (ORBES-CODE-SPEC §10),
 * checked by `npm run bench` on whole 1280 × 720 frames in the production
 * decoder worker (Chromium). Node timings are reported but not judged: the
 * scanner never decodes in Node.
 *
 * Frames with a code must be fast (they end the scan). Code-free frames —
 * most frames before the code is in view — run every detection pass and the
 * seal-less fallback before giving up, so their budget is wider; the
 * scanner keeps at most one frame in flight and decodes only the square
 * under the reticle (≤ 960 px), so they delay the next attempt, never the
 * camera preview.
 */
export const DECODER_LATENCY_BUDGET_MS = Object.freeze({
  /** Frames with a code: median. */
  codeP50: 100,
  /** Code-free frames: median and 95th percentile. */
  freeP50: 200,
  freeP95: 400,
});

export interface DecoderLatency {
  code: { p50: number };
  free: { p50: number; p95: number };
}

/** Budget violations, as readable lines (empty when every figure is within budget). */
export function decoderBudgetIssues(m: DecoderLatency, budget = DECODER_LATENCY_BUDGET_MS): string[] {
  const out: string[] = [];
  const check = (label: string, value: number, limit: number) => {
    if (!(value < limit)) out.push(`${label} ${Number.isFinite(value) ? value.toFixed(1) : String(value)} ms ≥ ${limit} ms`);
  };
  check('frames with a code, p50', m.code.p50, budget.codeP50);
  check('code-free frames, p50', m.free.p50, budget.freeP50);
  check('code-free frames, p95', m.free.p95, budget.freeP95);
  return out;
}
