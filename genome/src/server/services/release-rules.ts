/**
 * HOW RELEASES WORK (plan NEXT-NINE of 2026-10-06, §3.5 FT-01; API §8.13): the figures the page that explains every
 * release states, read from where the server applies them, so the page never types one into its words.
 *
 *   tiers           each tier from the pieces held now it starts from (CLUB_TIER_THRESHOLDS, CLUB_TIER_NAMES): 1, 5, 10;
 *   earlyAccess     a new draw's early access by default, PALLADIUM's and PLATINE's, in minutes before entries open to
 *                   everyone (THE PROGRAM, ClubProgramService.read: 240 and 120 by default; 0: none); each draw may set
 *                   its own (its page gives them);
 *   placeHeldHours  how long a place drawn is held by default (PURCHASE_WINDOW_HOURS.default, 48), set per draw too;
 *   salonFromTier   the lowest tier THE PRIVATE SALON shows a model to (a model's `private_min_tier`, 1 to 3 by
 *                   migration 0020's CHECK, TITANE at the lowest).
 *
 * The same for everyone, no account named, nothing written: GET /api/v1/releases/rules (routes/public.ts), kept a minute.
 */
import type { AppContext } from '../context.js';
import { CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS, tierName, type ClubTier, type ClubTierName } from './club.js';
import { PURCHASE_WINDOW_HOURS } from './drops.js';

/** The lowest tier a reserved model of THE PRIVATE SALON may be offered from (models.private_min_tier ≥ 1). */
const SALON_LOWEST_TIER: ClubTier = 1;

/** What HOW RELEASES WORK states, as the server applies it. */
export interface ReleaseRules {
  tiers: { name: ClubTierName; level: 1 | 2 | 3; pieces: number }[];
  /** Minutes before entries open to everyone, each tier's by default (0: none). */
  earlyAccess: { PALLADIUM: number; PLATINE: number };
  placeHeldHours: number;
  salonFromTier: ClubTierName;
}

/** The rules of every release, read now (THE PROGRAM's windows may change in the console). */
export async function releaseRules(ctx: Pick<AppContext, 'services'>): Promise<ReleaseRules> {
  const program = await ctx.services.clubProgram.read();
  return {
    tiers: CLUB_TIER_NAMES.map((name, i) => ({ name, level: (i + 1) as 1 | 2 | 3, pieces: CLUB_TIER_THRESHOLDS[i]! })),
    earlyAccess: { PALLADIUM: program.earlyAccessPalladiumHours * 60, PLATINE: program.earlyAccessPlatineHours * 60 },
    placeHeldHours: PURCHASE_WINDOW_HOURS.default,
    salonFromTier: tierName(SALON_LOWEST_TIER)!,
  };
}
