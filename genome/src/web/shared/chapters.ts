/**
 * The rail of chapters (plan NOCTURNE, Navigation): NOW · RELEASES · COLLECTION · CIRCLE · PIECES, their words and the
 * addresses of the verification app they open. Shared by the app's chrome (verify/views/shell.ts, through
 * verify/copy.ts CHROME) and the legal pages, which carry the same rail with no chapter current (C23, C41): there, a
 * chapter is a plain link into /verify.
 */

/** The chapters, in the rail's order. */
export const CHAPTER_IDS = ['now', 'releases', 'collection', 'circle', 'pieces'] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];

/** Each chapter's word on the rail. */
export const CHAPTER_LABELS: Readonly<Record<ChapterId, string>> = Object.freeze({ now: 'NOW', releases: 'RELEASES', collection: 'COLLECTION', circle: 'CIRCLE', pieces: 'PIECES' });

/** Each chapter's address in the verification app. */
export const CHAPTER_PATHS: Readonly<Record<ChapterId, string>> = Object.freeze({
  now: '/verify',
  releases: '/verify/releases',
  collection: '/verify/lookbook',
  circle: '/verify/circle',
  pieces: '/verify/pieces',
});

/** The rail's landmark, the canvas's. */
export const RAIL_LABEL = 'Main';

/**
 * RELEASES' dot said to a screen reader (the dot itself is decorative): the app's word LIVE, visually hidden beside it
 * while it shows, so the link reads RELEASES LIVE.
 */
export const RAIL_LIVE_WORD = 'LIVE';

/** RELEASES' dot and its word, shown or hidden together (the word empty while hidden). */
export function showRailLive(dot: HTMLElement, word: HTMLElement, on: boolean): void {
  dot.hidden = !on;
  word.hidden = !on;
  word.textContent = on ? ` ${RAIL_LIVE_WORD}` : '';
}
