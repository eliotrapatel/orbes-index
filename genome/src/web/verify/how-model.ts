/**
 * HOW RELEASES WORK (plan NEXT-NINE of 2026-10-06, §3.5 FT-01; /verify/releases/how) — pure, no DOM: what the page says,
 * its figures read from GET /api/v1/releases/rules, never typed into the copy (copy.ts HOW).
 *
 *   ‹ THE RELEASES
 *   HOW RELEASES WORK
 *   Every ORBES release follows the rules below, as the server applies them. …
 *   THE WAYS TO TAKE PART        DRAW (the place held: `48 hours`), EARLY ACCESS (the usual windows: PALLADIUM `4 hours`,
 *                                PLATINE `2 hours`), LIVE RELEASE, THE PRIVATE SALON
 *   HOW THE ORDER IS SET         THE TIERS (TITANE · FROM 1 PIECE / PLATINE · FROM 5 PIECES / PALLADIUM · FROM 10
 *                                PIECES), IN A DRAW, IN A LIVE RELEASE
 *   WHAT THE HOUSE NEVER DOES    NO PAID PRIORITY, NO AUCTIONS, A FIXED QUANTITY, ONE COLLECTOR, ONE ACCOUNT, A RETURNED
 *                                PIECE
 *   THE RELEASES
 *
 * A window of whole hours is said in hours (`2 hours`), any other in minutes (`90 minutes`). An early access of 0 is none:
 * PLATINE's left out when it has none, the sentence of no usual window when neither has one.
 */
import { HOW } from './copy.js';
import type { ReleaseRules } from './types.js';

/** The page, under THE RELEASES (releases-model.ts releasesRouteOf: `{ how: true }`). */
export const HOW_PATH = '/verify/releases/how';

/** A window in minutes as the page says it: whole hours in hours, else in minutes; null for none (0, or not a figure). */
export function windowWords(minutes: unknown): string | null {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) return null;
  return minutes % 60 === 0 ? HOW.hours(minutes / 60) : HOW.minutes(minutes);
}

/** A term of a section: its name in the display face, its sentence, and the rows under it (THE TIERS'). */
export interface HowTerm {
  key: string;
  term: string;
  text: string;
  rows: string[];
}

export interface HowSection {
  id: 'ways' | 'order' | 'never';
  title: string;
  terms: HowTerm[];
}

export interface HowPageModel {
  title: string;
  lead: string;
  sections: HowSection[];
}

const term = (key: string, t: { term: string; text: string }, rows: string[] = []): HowTerm => ({ key, term: t.term, text: t.text, rows });

/** The early access's sentence from the usual windows, PALLADIUM's then PLATINE's, in minutes. */
export function earlyText(palladium: unknown, platine: unknown): string {
  const p = windowWords(palladium);
  const l = windowWords(platine);
  if (p === null) return HOW.ways.early.none;
  if (l !== null && palladium === platine) return HOW.ways.early.same(p);
  return HOW.ways.early.text(p, l);
}

/** THE TIERS' rows, TITANE first, each from the pieces it starts from; a tier the server did not name is left out. */
export function tierRows(rules: Pick<ReleaseRules, 'tiers'>): string[] {
  const tiers = Array.isArray(rules?.tiers) ? rules.tiers : [];
  return tiers.filter((t) => typeof t?.name === 'string' && typeof t.pieces === 'number' && Number.isInteger(t.pieces) && t.pieces >= 1).map((t) => HOW.order.tiers.row(t.name, t.pieces));
}

/** The page from the server's figures (api.ts releaseRules has refused any that are not whole numbers in their place). */
export function howPageModel(rules: ReleaseRules): HowPageModel {
  const held = windowWords(rules.placeHeldHours * 60) ?? HOW.hours(rules.placeHeldHours);
  return {
    title: HOW.title,
    lead: HOW.lead,
    sections: [
      {
        id: 'ways',
        title: HOW.ways.title,
        terms: [
          term('draw', { term: HOW.ways.draw.term, text: HOW.ways.draw.text(held) }),
          term('early', { term: HOW.ways.early.term, text: earlyText(rules.earlyAccess?.PALLADIUM, rules.earlyAccess?.PLATINE) }),
          term('live', HOW.ways.live),
          term('salon', HOW.ways.salon),
        ],
      },
      {
        id: 'order',
        title: HOW.order.title,
        terms: [term('tiers', HOW.order.tiers, tierRows(rules)), term('draw', HOW.order.draw), term('live', HOW.order.live)],
      },
      {
        id: 'never',
        title: HOW.never.title,
        terms: [term('paid', HOW.never.paid), term('auctions', HOW.never.auctions), term('quantity', HOW.never.quantity), term('account', HOW.never.account), term('returned', HOW.never.returned)],
      },
    ],
  };
}
