/**
 * THE HOUSE'S GUARANTEE on /verify (plan NEXT-NINE, §3.3 IN-01), as pure functions: the account sheet's blocks, the box of
 * a draw's YOUR ENTRY, the lines GUARANTEED BY THE HOUSE above a drawn release's ranked list (YOURS on the account's own,
 * only when its guarantee is shown to it), and the LIVE RELEASE's lines. Only a guarantee shown to the client reaches the
 * app (the server leaves out the others): one not shown leaves no mark for its holder anywhere. Every word is
 * copy.ts GUARANTEE's.
 */
import { GUARANTEE } from './copy.js';
import { releasePath } from './releases-model.js';
import type { ClubEntry, ClubGuarantee, ClubStatus, DropState } from './types.js';
import { formatDateLong } from './view-model.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One block of the account sheet, under YOUR TIER. */
export interface GuaranteeBlockModel {
  id: string;
  title: string;
  sentence: string;
  /** RELEASE (once set aside and announced: a link to its page), PIECES, VALID UNTIL. */
  rows: { label: string; value: string; href?: string; releaseId?: string }[];
  note: string;
}

const piecesOf = (n: unknown): number => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5 ? (n as number) : 1);

/** `31 DECEMBER 2026`: the day it is valid until (the end of that day in Paris, the same day in UTC). */
export function validUntilWords(iso: string): string {
  return formatDateLong(iso).toUpperCase();
}

function sentenceOf(g: ClubGuarantee): string {
  if (g.scope === 'MODEL' && g.target) return GUARANTEE.model(g.target);
  if (g.scope === 'COLLECTION' && g.target) return GUARANTEE.collection(g.target);
  if (g.scope === 'RELEASE' && g.target) return GUARANTEE.release(g.target);
  return GUARANTEE.comingRelease;
}

/** The account sheet's blocks: one per guarantee shown, the soonest validity first (the server's order). */
export function guaranteeBlocks(status: Pick<ClubStatus, 'guarantees'> | null): GuaranteeBlockModel[] {
  const list = Array.isArray(status?.guarantees) ? status!.guarantees : [];
  return list
    .filter((g) => g && typeof g.id === 'string' && typeof g.validUntil === 'string')
    .map((g) => {
      const rows: GuaranteeBlockModel['rows'] = [];
      if (g.release && UUID.test(g.release.id)) {
        rows.push({ label: GUARANTEE.rows.release, value: g.release.title ? g.release.title.toUpperCase() : GUARANTEE.unnamed, href: releasePath(g.release.id), releaseId: g.release.id });
      }
      rows.push({ label: GUARANTEE.rows.pieces, value: String(piecesOf(g.pieces)) }, { label: GUARANTEE.rows.validUntil, value: validUntilWords(g.validUntil) });
      return { id: g.id, title: GUARANTEE.title, sentence: sentenceOf(g), rows, note: GUARANTEE.note };
    });
}

/** The guarantee shown to the account that is set aside for this release, or null. */
export function guaranteeFor(status: Pick<ClubStatus, 'guarantees'> | null, dropId: string): ClubGuarantee | null {
  const list = Array.isArray(status?.guarantees) ? status!.guarantees : [];
  return list.find((g) => g?.release?.id === dropId) ?? null;
}

/**
 * The box of a draw's YOUR ENTRY (shown guarantees only): before entries open, while open and not entered, entered, or a
 * reservation (the holder's own early access); nothing once drawn (the place held says it), cancelled or closed.
 */
export function guaranteeBox(
  release: { state: DropState; drawn: boolean },
  entry: (Pick<ClubEntry, 'status'> & { reserved?: boolean; guaranteed?: boolean; pieces?: number }) | null,
  guarantee: Pick<ClubGuarantee, 'pieces'> | null,
  opts: { canReserve?: boolean } = {},
): string | null {
  if (release.drawn || release.state === 'DRAWN' || release.state === 'CANCELLED') return null;
  if (entry?.guaranteed === true) {
    if (entry.status === 'ENTERED') return GUARANTEE.box.entered(GUARANTEE.pieces(piecesOf(entry.pieces)));
    if (entry.status === 'SELECTED' && entry.reserved === true) return GUARANTEE.box.reservation;
    return null;
  }
  if (!guarantee || (entry && entry.status !== 'WITHDRAWN')) return null;
  const pieces = GUARANTEE.pieces(piecesOf(guarantee.pieces));
  if (release.state === 'UPCOMING') return opts.canReserve ? GUARANTEE.box.reservation : GUARANTEE.box.upcoming(pieces);
  if (release.state === 'OPEN') return GUARANTEE.box.open(pieces);
  return null;
}

/** One line of GUARANTEED BY THE HOUSE: its pieces, the entry's id, YOURS on the account's own entry when it is shown. */
export interface GuaranteedLine {
  id: string;
  line: string;
  yours: boolean;
}

/**
 * GUARANTEED BY THE HOUSE: the release's guaranteed places (the page's `guaranteed`, by entry id), YOURS only from the
 * account's own entry when it says `guaranteed: true` (a guarantee shown to it); never from the list itself.
 */
export function guaranteedLines(items: readonly { id: string; pieces: number }[] | undefined, own: Pick<ClubEntry, 'id'> & { guaranteed?: boolean } | null): GuaranteedLine[] {
  return (Array.isArray(items) ? items : [])
    .filter((x) => x && typeof x.id === 'string' && UUID.test(x.id))
    .map((x) => ({ id: x.id, line: GUARANTEE.list.line(piecesOf(x.pieces)), yours: own !== null && own.guaranteed === true && own.id === x.id }));
}
