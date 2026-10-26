/**
 * THE VAULT's engraved emblem (lot Q3, step Q3.10; D30, D40): the ORBES monogram engraved on the door and on the lid, THE
 * (small) over VAULT (large) in Gravesend Sans on the door's two halves, FOR YOU across the lid's monogram. Data only,
 * read as published: `.claude/orbes-run/single-queue/mockups/_build/vault/emblem-engraved.json` (the emblem's body, the
 * vault reference's `vo-emb`), each letter placed one by one at its glyph's ink position (`<tspan x>`), centred by ink,
 * never by letter-spacing or textLength (SCOPE 23 Oct 00:31–00:34); FOR YOU's positions as the reference's lid draws them
 * (vault/the-vault.html, v61). The monogram's outlines are the master's (core/render/monogram.ts MONOGRAM_PATHS).
 */

/** The emblem's box, in its own units (the reference's `viewBox="-18 -18 36 36"`). */
export const EMBLEM_VIEWBOX = '-18 -18 36 36';

/** The monogram's place in the emblem: the master's 500-unit outlines brought to the emblem's units, then centred. */
export const EMBLEM_PLACE = Object.freeze({ outer: 'translate(-0.49 0) scale(2.8378)', inner: 'translate(-8.4493 -8.7300) scale(0.033782)' });

/** The engraving's fill and its lit edge (currentColor, its opacity along the diagonal). */
export const EMBLEM_FILL: readonly (readonly [offset: number, opacity: number])[] = [
  [0, 0.17],
  [0.42, 0.05],
  [0.58, 0.09],
  [1, 0.03],
];
export const EMBLEM_EDGE: readonly (readonly [offset: number, opacity: number])[] = [
  [0, 0.62],
  [0.45, 0.16],
  [0.6, 0.3],
  [1, 0.12],
];
/** Both gradients' line (userSpaceOnUse). */
export const EMBLEM_AXIS = Object.freeze({ x1: -16, y1: -18, x2: 14, y2: 18 });
/** The engraved edge's stroke (non-scaling). */
export const EMBLEM_EDGE_WIDTH = 0.55;

/** The veil behind the words: a radial of the box's black, so the letters read over the monogram. */
export const EMBLEM_VEIL = Object.freeze({
  transform: 'translate(0.8 0.6) scale(17 7.5)',
  colour: '#0b0b0c',
  stops: [
    [0, 0.72],
    [0.6, 0.35],
    [1, 0],
  ] as readonly (readonly [number, number])[],
});

/** The font the engraving is set in (SVG presentation attribute). */
export const EMBLEM_FONT = 'Gravesend Sans, Helvetica Neue, Arial, sans-serif';

/** A line of engraved letters: each letter at its ink position. */
export interface EngravedLine {
  y: number;
  size: number;
  opacity?: number;
  letters: readonly (readonly [letter: string, x: number])[];
}

/** THE, small, over VAULT, large: the door's words, across its seam. */
export const DOOR_WORDS: readonly EngravedLine[] = [
  {
    y: -3.25,
    size: 2.5,
    opacity: 0.85,
    letters: [
      ['T', -4.296],
      ['H', -1.569],
      ['E', 1.574],
    ],
  },
  {
    y: 4.97,
    size: 7.4,
    letters: [
      ['V', -16.726],
      ['A', -9.397],
      ['U', -1.831],
      ['L', 6.016],
      ['T', 12.553],
    ],
  },
];

/** FOR YOU, engraved across the lid's monogram (hidden while the vault is sealed). */
export const LID_WORDS: EngravedLine = {
  y: 1.61,
  size: 4.6,
  letters: [
    ['F', -14.718],
    ['O', -10.504],
    ['R', -5.43],
    ['Y', 1.727],
    ['O', 6.116],
    ['U', 11.189],
  ],
};
