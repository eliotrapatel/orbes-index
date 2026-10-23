/**
 * ONE QUEUE's figures for the console (lot Q1, plan §1.4; pure): the close guard (D10, ANSWERS B10: "a console warning
 * (EXTEND / SET PACE / NEXT BATCH NOW), advice only", e.g. « AT THIS PACE, 120 PIECES REMAIN AT THE CLOSE »).
 */

/** The close guard: the pieces the pace cannot offer before the close. */
export interface LiveCloseGuard {
  remain: number;
}

const MINUTE_MS = 60_000;

/**
 * The turns the pace can still give before the close: the batches left, from the next one every Y minutes, each strictly
 * before `closesAt`, times X; the pieces not confirmed yet less that, when above 0. Null once the release has ended, or
 * when the pace can offer every piece left. Nothing automatic follows from it.
 */
export function closeGuard(p: { batch: number; minutes: number; nextAt: Date; closesAt: Date; ended: boolean; notConfirmed: number }): LiveCloseGuard | null {
  if (p.ended || p.notConfirmed <= 0) return null;
  const next = new Date(p.nextAt).getTime();
  const close = new Date(p.closesAt).getTime();
  const step = p.minutes * MINUTE_MS;
  const batches = next < close && step > 0 ? Math.ceil((close - next) / step) : 0;
  const remain = p.notConfirmed - batches * p.batch;
  return remain > 0 ? { remain } : null;
}
