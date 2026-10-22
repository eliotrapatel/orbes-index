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
import type { OwnerWornPhoto, PieceWorn, SheetWornPhoto, WornRefusal } from './types.js';
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

// ── WORN at the foot of a model's sheet (G3, G4, G5; lot M2 plan §2.3, step M2.11) ───────────────────────────────────

/** The photographs a page of a sheet's WORN holds (services/worn.ts WORN_PAGE_SIZE): the sheet carries the first. */
export const WORN_PAGE_SIZE = 12;
/** The photographs shown first: two columns of three on a phone, two rows of four on a computer. */
export const WORN_FIRST_PHONE = 6;
export const WORN_FIRST_DESK = 8;
/** SHOW MORE shows this many more, reading the next page when they are not read yet. */
export const WORN_MORE = 12;

/** A photograph of the sheet's WORN, as the grid and the enlarged photograph show it. */
export interface SheetWornItem {
  id: string;
  src: string;
  /** `Worn by Camille, France`. */
  alt: string;
  /** Its button's name: `Open the photograph worn by Camille, France`. */
  open: string;
  credit: CreditLine;
  /** The Instagram name's link name, or null. */
  instagramLabel: string | null;
}

/** The sheet's WORN as the server sent it: its photographs read, and how many it has. */
export interface SheetWornModel {
  items: SheetWornItem[];
  total: number;
}

/** A WORN photograph's own address on this origin (GET /api/v1/worn/:id/photo); anything else is not shown. */
const WORN_SRC = /^\/api\/v1\/worn\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/photo$/i;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The photographs of a page as the sheet shows them (G3): each with its credit, exactly the first name and the country
 * (plus the Instagram name when its owner chose it), never a variant or a serial whatever else came; one without its
 * own address, a first name or a country is left out.
 */
export function sheetWornItems(list: unknown): SheetWornItem[] {
  const out: SheetWornItem[] = [];
  for (const p of Array.isArray(list) ? (list as (Partial<SheetWornPhoto> | null)[]) : []) {
    if (!p || typeof p.id !== 'string' || typeof p.url !== 'string' || !WORN_SRC.test(p.url)) continue;
    const firstName = text(p.credit?.firstName);
    const country = text(p.credit?.country);
    if (!firstName || !country) continue;
    const instagram = text(p.credit?.instagram);
    const credit = creditLine({ firstName, country, instagram: /^[a-z0-9._]{1,30}$/.test(instagram) ? instagram : null });
    out.push({
      id: p.id,
      src: p.url,
      alt: WORN.sheet.alt(firstName, country),
      open: WORN.sheet.open(firstName, country),
      credit,
      instagramLabel: credit.handle ? WORN.sheet.instagram(credit.handle) : null,
    });
  }
  return out;
}

/** The sheet's WORN (its first page): none at all while it has no photograph (the section is then not drawn). */
export function sheetWornModel(w: unknown): SheetWornModel {
  const v = (w ?? {}) as { photos?: unknown; total?: unknown };
  const items = sheetWornItems(v.photos);
  const total = typeof v.total === 'number' && Number.isInteger(v.total) && v.total > 0 ? v.total : 0;
  return { items, total: items.length === 0 ? 0 : Math.max(total, items.length) };
}

/** The photographs read so far with a page's added after them, each once (one published meanwhile shifts the pages). */
export function withPage(have: readonly SheetWornItem[], page: readonly SheetWornItem[]): SheetWornItem[] {
  const seen = new Set(have.map((i) => i.id));
  return [...have, ...page.filter((i) => !seen.has(i.id))];
}

/** How many photographs are to be shown: the first ones, then WORN_MORE more for each SHOW MORE; never past the total. */
export function wornTarget(total: number, desk: boolean, more: number): number {
  return Math.min(total, (desk ? WORN_FIRST_DESK : WORN_FIRST_PHONE) + Math.max(0, more) * WORN_MORE);
}

/**
 * The page to read so that `target` photographs can be shown, having read `pages` pages and `read` photographs; null
 * when they are read already (or every page is: the total was counted before a photograph left).
 */
export function wornPageToRead(read: number, pages: number, target: number, total: number): number | null {
  if (read >= target) return null;
  if (pages * WORN_PAGE_SIZE >= total) return null;
  return pages + 1;
}
