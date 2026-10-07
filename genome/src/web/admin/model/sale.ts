/**
 * The sale mode (A-08, `#/sale`) and the points of sale: what the screens
 * say about a looked-up piece, which point of sale is preselected, how one
 * is named in a list. Pure: views/sale.ts and views/retailers.ts render it,
 * the server stays the authority (a token only when the piece can be sold,
 * 409 RETAILER_INACTIVE, 410 SALE_TOKEN_EXPIRED…).
 */
import { humanize } from '../format.js';
import type { Retailer, SaleLookup } from '../types.js';
import { toneOf, type Tone } from './tone.js';

/** What the seller tells the client once the warranty has started (the closing instruction of the sale). */
export const CLIENT_REGISTRATION = 'Register your piece with its card at theorbes.com/verify.';

/**
 * The seller's own note under TELL THE CLIENT. The claim code proves that its holder has the card, not who owns the
 * piece (BRAND §4.1, §4.6; registration is not a title of ownership): it lets the client register the piece in their
 * name, the words of BRAND §4.4.
 */
export const SALE_CARD_NOTE = 'Hand over the certificate card: with the claim code printed on it, they register the piece in their name.';

/** The browser storage key of the point of sale this phone sells from. */
export const RETAILER_STORAGE_KEY = 'orbes.sale.retailer';

/** `ORBES Paris — Saint-Honoré · Paris · FR`: a point of sale as a list shows it. */
export function retailerLabel(r: Pick<Retailer, 'name' | 'city' | 'country'>): string {
  return [r.name, r.city, r.country].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(' · ');
}

/** The options of a point-of-sale select: active ones only, by name (the server's order). */
export function retailerOptions(list: readonly Retailer[]): { value: string; label: string }[] {
  return list.filter((r) => r.active).map((r) => ({ value: r.id, label: retailerLabel(r) }));
}

/**
 * The point of sale to preselect: the one this phone sold from last when it is still active,
 * else the only active one, else none (the seller chooses).
 */
export function preselectedRetailer(list: readonly Retailer[], remembered: string | null | undefined): string {
  const active = list.filter((r) => r.active);
  if (remembered && active.some((r) => r.id === remembered)) return remembered;
  return active.length === 1 ? active[0].id : '';
}

export interface SaleVerdict {
  /** The status mark over the piece. */
  label: string;
  tone: Tone;
  /** One sentence under it: what to do now. */
  message: string;
  /** The token is there: ACTIVATE WARRANTY is offered. */
  canActivate: boolean;
}

/**
 * Under READY TO SELL: only what the lookup proved (BRAND §4.1), a code signed by ORBES for a piece of
 * its registry whose warranty has not started; the server gives no token to a piece a client holds.
 */
export const READY_TO_SELL = 'Signed by ORBES and in its registry; its warranty has not started. Choose the point of sale, then activate its warranty.';

/** What the screen says about a looked-up piece. */
export function saleVerdict(r: Pick<SaleLookup, 'state' | 'piece' | 'sale' | 'refusal'>): SaleVerdict {
  if (r.sale && r.piece) {
    return { label: 'READY TO SELL', tone: 'solid', message: READY_TO_SELL, canActivate: true };
  }
  const code = r.refusal?.code;
  if (code === 'WARRANTY_ACTIVE' || code === 'ALREADY_REGISTERED') return { label: 'ALREADY SOLD', tone: 'outline', message: r.refusal!.message, canActivate: false };
  if (code === 'WARRANTY_VOID') return { label: 'WARRANTY VOID', tone: 'alert', message: r.refusal!.message, canActivate: false };
  if (code === 'NOT_FOR_SALE') return { label: 'NOT FOR SALE', tone: 'alert', message: r.refusal!.message, canActivate: false };
  return {
    label: humanize(r.state),
    tone: toneOf('verification', r.state),
    message: r.refusal?.message ?? 'This code did not verify as a registered ORBES piece. Do not sell it; contact ORBES.',
    canActivate: false,
  };
}

/** `MONOLITHE · RING · 52`, then `925 STERLING SILVER · JEWELRY`: the two lines that name a piece. */
export function pieceLines(p: NonNullable<SaleLookup['piece']>): [string, string] {
  const first = [p.model, p.type, p.variant].filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(humanize);
  const second = [p.material, p.category.name, p.collection].filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(humanize);
  return [first.join(' · '), second.join(' · ')];
}

/** Whole minutes left on a sale token, at least 0 (shown under ACTIVATE WARRANTY). */
export function minutesLeft(expiresAt: string, now: Date): number {
  const ms = Date.parse(expiresAt) - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 60_000)) : 0;
}
