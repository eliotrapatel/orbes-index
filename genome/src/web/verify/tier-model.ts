/**
 * The club's tier at the head of MY PIECES (P-X04) — pure, no DOM.
 *
 * From GET /api/v1/club/status: the badge (the tier's name, set in the display
 * face, and the pieces it counts, in the reading face), the benefits of the
 * tier and of those below it, and the way to the next tier (how many more
 * pieces, from how many it starts, what it adds); PALLADIUM says it is the
 * highest. An account without a tier reads what its first piece opens. What
 * the server sends is read defensively: a missing or malformed field shows
 * less, never something wrong.
 */
import { TIER } from './copy.js';
import type { ClubStatus, ClubTierName } from './types.js';

const NAMES: readonly ClubTierName[] = ['TITANE', 'PLATINE', 'PALLADIUM'];

export interface TierModel {
  /** The section's label: YOUR TIER, or THE CLUB before the first tier. */
  label: string;
  /** The badge: the tier's name and the pieces it counts; null without a tier. */
  badge: { name: ClubTierName; pieces: string } | null;
  /** The benefits of the tier and of those below it, lowest first; [] without a tier. */
  benefits: string[];
  /** The way to the next tier; null at the highest, or when the server did not say. */
  next: { label: string; sentence: string; benefits: string[] } | null;
  /** PALLADIUM: no tier above. */
  top: string | null;
  /** MY PIECES lists more pieces than the tier counts (one revoked or retired): the note that says why. */
  note: string | null;
}

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((l) => l.trim()) : []);
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

/** The tier block of MY PIECES; `listed` is the number of pieces the page shows (to explain a piece that counts for none). */
export function tierModel(status: Pick<ClubStatus, 'tier' | 'pieces'> & Partial<Pick<ClubStatus, 'benefits' | 'next'>>, listed = 0): TierModel {
  const level = count(status?.tier?.level);
  const name = level >= 1 && level <= 3 ? NAMES[level - 1]! : null;
  const pieces = count(status?.pieces);
  const n = status?.next;
  const nextName = n && NAMES.includes(n.name) && count(n.level) === level + 1 ? n.name : null;
  const missing = Math.max(1, count(n?.missing));
  const from = count(n?.pieces);
  const next =
    nextName && n
      ? {
          label: TIER.next(nextName),
          sentence: name === null ? TIER.first(nextName) : TIER.nextWay(nextName, missing, from),
          benefits: lines(n.benefits),
        }
      : null;
  return {
    label: name ? TIER.label : TIER.noneLabel,
    badge: name ? { name, pieces: TIER.pieces(pieces) } : null,
    benefits: name ? lines(status.benefits) : [],
    next,
    top: name === 'PALLADIUM' ? TIER.top : null,
    note: listed > pieces ? TIER.counted : null,
  };
}
