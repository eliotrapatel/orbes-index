/**
 * WORN, from the owner's side (macro scope D31, G1 to G3; lot M2 plan §2.3, step M2.10), as pure functions the piece's
 * block (views/worn.ts) and the tests share: which state a piece's WORN shows, the credit line under a photograph, the
 * Instagram address, the day a photograph was published (in Paris), and how a photograph is prepared before it is sent.
 *
 * The block is drawn only for a piece whose model has a sheet to show a photograph on, held by its owner now, and not
 * for a test account. A photograph in review or published shows first, with WITHDRAW; then what stops a sending (a piece
 * reported lost or stolen, or in service; a transfer pending; a profile without its first name or country); then CHOOSE
 * A PHOTOGRAPH, under the reason ORBES gave when it did not publish the last one.
 *
 * The credit is exactly the first name and the country, in capitals (`CAMILLE · FRANCE`), plus the Instagram name when
 * the owner chose to show it (`@camille.m`, a link to its page); never the model's variant (G3). The console writes it
 * the same way (admin/model/worn.ts creditLine), held equal by a test.
 */
import { PHOTO_MAX_BYTES, PHOTO_QUALITIES, PHOTO_MAX_SIDE, type PhotoLimits, type PhotoWords } from '../shared/photo.js';
import { WORN } from './copy.js';
import type { OwnerWornPhoto, PieceWorn, WornRefusal } from './types.js';
import { formatDate } from './view-model.js';

/** A credit as it reads under a photograph: the line, and the Instagram name with its address when shown. */
export interface CreditLine {
  /** `CAMILLE · FRANCE`. */
  line: string;
  /** `@camille.m`, or null. */
  handle: string | null;
  /** `https://www.instagram.com/camille.m/`, or null. */
  href: string | null;
}

/** The address of an Instagram name's page (opened apart, noopener noreferrer). */
export const instagramHref = (username: string): string => `https://www.instagram.com/${encodeURIComponent(username)}/`;

/** The credit under a photograph (G3): exactly the first name and the country, plus the Instagram name when shown. */
export function creditLine(c: { firstName: string; country: string; instagram: string | null }): CreditLine {
  const line = `${c.firstName.trim()} · ${c.country.trim()}`.toUpperCase();
  const name = c.instagram?.trim() ? c.instagram.trim() : null;
  return { line, handle: name ? `@${name}` : null, href: name ? instagramHref(name) : null };
}

/** The reason ORBES gave, in words; null for none (or one this app does not know). */
export function refusalWords(r: WornRefusal | null): string | null {
  return r && Object.hasOwn(WORN.refusal, r) ? WORN.refusal[r] : null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
let parisDays: Intl.DateTimeFormat | null | undefined;

/** The day of `iso` in Paris (`21 OCT 2026`): a photograph published at 23:30 UTC on the 20th was published on the 21st. */
export function parisDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  if (parisDays === undefined) {
    try {
      parisDays = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric' });
    } catch {
      parisDays = null;
    }
  }
  if (!parisDays) return formatDate(iso);
  const parts = Object.fromEntries(parisDays.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const month = MONTHS[Number(parts.month) - 1];
  return month ? `${Number(parts.day)} ${month} ${parts.year}` : formatDate(iso);
}

/** What ORBES said of the last photograph it did not publish (or took down): shown above CHOOSE ANOTHER PHOTOGRAPH. */
export interface WornRefused {
  head: string;
  text: string;
}

/** The state a piece's WORN shows. */
export type WornState =
  /** No block: the model has no sheet, the piece is no longer the account's, or the account is a test account. */
  | { kind: 'hidden' }
  /** A photograph in review: WITHDRAW. */
  | { kind: 'review'; photo: OwnerWornPhoto; credit: CreditLine }
  /** A photograph published: since when, SEE IT ON THE SHEET, WITHDRAW. */
  | { kind: 'published'; photo: OwnerWornPhoto; credit: CreditLine; since: string; sheet: string }
  /** The piece cannot send now: one calm sentence, no button. */
  | { kind: 'blocked'; text: string; refused: WornRefused | null }
  /** The credit cannot be written: YOUR PROFILE first. */
  | { kind: 'profile'; text: string; refused: WornRefused | null }
  /** CHOOSE A PHOTOGRAPH (or ANOTHER, after one not published). */
  | { kind: 'choose'; action: string; refused: WornRefused | null };

/** The piece's WORN, in the order the block reads it (see the header). */
export function wornState(w: PieceWorn | null): WornState {
  if (!w || !w.sheet || w.reason === 'NO_SHEET' || w.reason === 'TEST_ENTRANT' || w.reason === 'NOT_HELD') return { kind: 'hidden' };
  const p = w.photo;
  if (p && p.status === 'PENDING') return { kind: 'review', photo: p, credit: creditLine(p.credit) };
  if (p && p.status === 'PUBLISHED') return { kind: 'published', photo: p, credit: creditLine(p.credit), since: parisDay(p.publishedAt ?? p.sentAt), sheet: w.sheet.slug };
  const words = p && (p.status === 'REFUSED' || p.status === 'TAKEN_DOWN') ? refusalWords(p.refusal) : null;
  const refused: WornRefused | null = words ? { head: WORN.notPublished, text: words } : null;
  if (w.reason === 'STATUS') return { kind: 'blocked', text: WORN.status, refused };
  if (w.reason === 'TRANSFER_PENDING') return { kind: 'blocked', text: WORN.transfer, refused };
  if (w.reason === 'PROFILE_INCOMPLETE') return { kind: 'profile', text: WORN.profile, refused };
  // LIVE without its photograph (read between two changes): nothing to offer until it is read again.
  if (!w.canSend) return { kind: 'hidden' };
  return { kind: 'choose', action: refused ? WORN.chooseAnother : WORN.choose, refused };
}

/** The credit a sending would carry now, with the Instagram name when SHOW MY INSTAGRAM is on; null without a name and a country. */
export function draftCredit(w: PieceWorn, showInstagram: boolean): CreditLine | null {
  const { firstName, country, instagram } = w.credit;
  if (!firstName || !country) return null;
  return creditLine({ firstName, country, instagram: showInstagram ? instagram : null });
}

/** SHOW MY INSTAGRAM is offered only with an Instagram name in YOUR PROFILE: `@camille.m`, else null. */
export function instagramOffer(w: PieceWorn): string | null {
  const name = w.credit.instagram?.trim();
  return name ? `@${name}` : null;
}

/** How a WORN photograph is prepared on the device: the console's encoder (shared/photo.ts), 2 000 px within 1 MiB. */
export const WORN_PHOTO_LIMITS: PhotoLimits = Object.freeze({
  sides: Object.freeze([PHOTO_MAX_SIDE]),
  qualities: PHOTO_QUALITIES,
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: WORN.tooLarge,
});

/** What the collector reads when a photograph cannot be prepared (read each time: a computer's words differ). */
export function wornPhotoWords(): PhotoWords {
  return { unreadable: WORN.unreadable, empty: WORN.unreadable, noCanvas: WORN.noCanvas };
}
