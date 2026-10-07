/**
 * THE CLUB (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T9; /verify/club) — pure, no DOM: what the page says, from GET
 * /api/v1/the-club (every tier, from how many pieces, its program's lines then its words, the credit's currency, the
 * welcome gifts) and, signed in, the account's own standing (GET /api/v1/club/status).
 *
 *   THE CLUB
 *   Your tier is set by the pieces registered to your ORBES account now: TITANE from 1 piece, PLATINE from 5, …
 *   ───  TITANE                            each tier, a hairline above: its name, FROM n PIECES, its lines as – rows,
 *        FROM 1 PIECE                      its welcome gift's photograph (with its name) when its model has one
 *        – …
 *   HOW THE TIERS WORK                     the rules, the credit's currency read from the setting
 *   YOUR TIER: PLATINE · 6 PIECES HELD  ›  signed in (the account sheet); YOUR FIRST PIECE OPENS TITANE › without a
 *                                          tier (MY PIECES); SIGN IN TO SEE YOUR TIER › signed out (MY PIECES' sign-in)
 *
 * Every figure comes from the server, never typed into the copy. The page has no link to HOW RELEASES WORK. What the
 * server sends is read defensively: a missing or malformed field shows less, never something wrong.
 */
import { CLUB_PAGE } from './copy.js';
import type { ClubStatus, ClubTierName, TheClub } from './types.js';
import { upper } from './view-model.js';

export const CLUB_PATH = '/verify/club';

/** Whether a path is THE CLUB's (a slash at its end, any case, allowed). */
export function isClubPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === CLUB_PATH;
}

/** A photograph of this origin's media route, never another address. */
const MEDIA_SRC = /^\/api\/v1\/media\/[0-9a-f]{64}$/;
const NAMES: readonly ClubTierName[] = ['TITANE', 'PLATINE', 'PALLADIUM'];

export interface ClubTierPlate {
  name: ClubTierName;
  from: string;
  lines: string[];
  gift: { src: string; alt: string; model: string } | null;
}

export interface ClubPageModel {
  title: string;
  lead: string | null;
  tiers: ClubTierPlate[];
  how: { label: string; lines: string[] };
  /** The way to the account's tier: the account sheet, MY PIECES, or its sign-in; null when the status could not be read. */
  yours: { text: string; to: 'account' | 'pieces' | 'signIn' } | null;
}

/** Who reads the page: signed out, or signed in with its status (null when it could not be read). */
export type ClubViewer = { signedIn: false } | { signedIn: true; status: Pick<ClubStatus, 'tier' | 'pieces'> | null };

const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((l) => l.trim()) : []);

/** THE CLUB's page from the server's answer and the viewer. */
export function clubPageModel(club: TheClub, viewer: ClubViewer): ClubPageModel {
  const t = Array.isArray(club?.tierThresholds) ? club.tierThresholds.map(whole) : [];
  const lead = t.length === 3 && t.every((n) => n !== null) ? CLUB_PAGE.lead(t[0]!, t[1]!, t[2]!) : null;
  const tiers: ClubTierPlate[] = [];
  for (const name of NAMES) {
    const tier = Array.isArray(club?.tiers) ? club.tiers.find((x) => x?.name === name) : undefined;
    const pieces = whole(tier?.pieces);
    if (!tier || pieces === null) continue;
    const g = Array.isArray(club.gifts) ? club.gifts.find((x) => x?.tier === name) : undefined;
    const model = g && typeof g.model === 'string' ? upper(g.model) : '';
    tiers.push({
      name,
      from: CLUB_PAGE.from(pieces),
      lines: lines(tier.lines),
      gift: g && model && typeof g.imageUrl === 'string' && MEDIA_SRC.test(g.imageUrl) ? { src: g.imageUrl, alt: CLUB_PAGE.giftAlt(model), model } : null,
    });
  }
  const how = [CLUB_PAGE.follows, CLUB_PAGE.once, ...(typeof club?.creditCurrency === 'string' && /^[A-Z]{3}$/.test(club.creditCurrency) ? [CLUB_PAGE.currency(club.creditCurrency)] : []), CLUB_PAGE.shipping, CLUB_PAGE.draws];
  let yours: ClubPageModel['yours'] = { text: CLUB_PAGE.signIn, to: 'signIn' };
  if (viewer.signedIn && viewer.status === null) yours = null;
  else if (viewer.signedIn) {
    const s = viewer.status;
    const level = s?.tier?.level;
    const name = typeof level === 'number' && level >= 1 && level <= 3 ? NAMES[level - 1]! : null;
    const pieces = typeof s?.pieces === 'number' && Number.isInteger(s.pieces) && s.pieces >= 0 ? s.pieces : 0;
    yours = name ? { text: CLUB_PAGE.yourTier(name, pieces), to: 'account' } : { text: CLUB_PAGE.first, to: 'pieces' };
  }
  return { title: CLUB_PAGE.title, lead, tiers, how: { label: CLUB_PAGE.how, lines: how }, yours };
}
