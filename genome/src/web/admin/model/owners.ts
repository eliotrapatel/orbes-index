/**
 * The search field of Owners (A-06): one box for an email or a REF.
 *
 * Anything with an `@` is an email, which the server matches exactly (any
 * case, as at sign-in). Anything else must be a REF: the 8 characters
 * (0–9, A–F) the verify app prints after REF under every result, with or
 * without the word REF, or a whole scan id. The server parses both again;
 * this only spares a round trip for a typing mistake. Pure.
 *
 * The client sheet (plan LIVE RELEASE+, N4): the words and lines the owner's
 * sheet uses for the collector's orders, releases, interest and notes.
 */
import { formatCount } from '../format.js';
import type { ClientInterest, ClientNote, ClientOrder, ClientRelease, OwnerSheet } from '../types.js';

export type OwnerSearch = { kind: 'email'; email: string } | { kind: 'ref'; ref: string } | { kind: 'invalid'; message: string };

const REF_RE = /^(?:REF[\s:#-]*)?[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

export const OWNER_SEARCH_HINT = 'An exact email, or the REF under a result (8 characters, 0–9 and A–F).';

/** What the search box holds, or null when it is empty (the whole list). */
export function ownerSearch(input: string | null | undefined): OwnerSearch | null {
  const q = (input ?? '').trim();
  if (q === '') return null;
  if (q.includes('@')) return { kind: 'email', email: q };
  if (REF_RE.test(q)) return { kind: 'ref', ref: q.replace(/^REF[\s:#-]*/i, '').toUpperCase() };
  return { kind: 'invalid', message: 'Enter an exact email, or a REF of 8 characters (0–9, A–F).' };
}

// ── The client sheet (plan LIVE RELEASE+, N4) ──────────────────────────────

/** What became of an I'LL BE THERE. */
export const INTEREST_OUTCOME_LABELS: Readonly<Record<ClientInterest['outcome'], string>> = Object.freeze({
  UPCOMING: 'UPCOMING',
  CAME: 'CAME',
  DID_NOT_COME: 'DID NOT COME',
  CANCELLED: 'CANCELLED',
});

/** What a note of Client Services is about. */
export const NOTE_ABOUT_LABELS: Readonly<Record<ClientNote['about'], string>> = Object.freeze({
  ORDER: 'Order',
  DRAW: 'Draw',
  SALON: 'Private salon',
  LIVE: 'LIVE RELEASE',
});

/** A release's kind as the sheet names it. */
export const RELEASE_KIND_LABELS: Readonly<Record<ClientRelease['kind'], string>> = Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW' });

/** The steps an order reached, in order, each with its time: RESERVED, PAID, SHIPPED, DELIVERED, then CANCELLED or RETURNED. */
export function orderSteps(o: Pick<ClientOrder, 'steps'>): { step: string; at: string }[] {
  const s = o.steps;
  return [
    { step: 'RESERVED', at: s.reservedAt },
    { step: 'PAID', at: s.paidAt },
    { step: 'SHIPPED', at: s.shippedAt },
    { step: 'DELIVERED', at: s.deliveredAt },
    { step: 'CANCELLED', at: s.cancelledAt },
    { step: 'RETURNED', at: s.returnedAt },
  ].filter((x): x is { step: string; at: string } => typeof x.at === 'string');
}

/** The releases taken part in, said as a section's note: `3 releases taken part in · 2 pieces secured`. */
export function participationLine(r: Pick<OwnerSheet['releases'], 'count' | 'secured'>): string {
  const n = (k: number, one: string, many: string) => `${formatCount(k)} ${k === 1 ? one : many}`;
  return `${n(r.count, 'release', 'releases')} taken part in · ${n(r.secured, 'piece', 'pieces')} secured`;
}
