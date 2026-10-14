/**
 * An engagement score as the morning run leaves it (account_scores, migration 0046; plan CUSTOMER INTELLIGENCE §3.5
 * SB.3.2), written straight for the tests that read it (Segments' SCORE, the access of a LIVE RELEASE): `score` split
 * into the five parts in their order, each within its bound, every figure behind them empty.
 */
import type { Db } from '../../src/server/db/connection.js';

/** The five parts' bounds, in the order the score fills them (recency, frequency, spend, release speed, attendance). */
const PARTS = [25, 20, 25, 10, 20] as const;

/** Writes (or replaces) `accountId`'s score, 0 to 100, as of `at`. */
export async function seedScore(db: Db, accountId: string, score: number, at: Date): Promise<void> {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error(`a score is 0 to 100, not ${score}`);
  let left = score;
  const [recency, frequency, spend, speed, attendance] = PARTS.map((max) => {
    const p = Math.min(max, left);
    left -= p;
    return p;
  }) as [number, number, number, number, number];
  const row = {
    account_id: accountId,
    formula: 1,
    score,
    recency_points: recency,
    frequency_points: frequency,
    spend_points: spend,
    speed_points: speed,
    attendance_points: attendance,
    active_days: 0,
    spend_eur_minor: 0,
    purchases: 0,
    unpriced: 0,
    speed_releases: 0,
    releases_taken: 0,
    releases_open: 0,
    changed_at: at,
  };
  const { account_id: _key, ...parts } = row;
  await db
    .insertInto('account_scores')
    .values(row)
    .onConflict((oc) => oc.column('account_id').doUpdateSet(parts))
    .execute();
}
