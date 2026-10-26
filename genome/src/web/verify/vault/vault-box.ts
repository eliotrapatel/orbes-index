/**
 * THE VAULT's object (lot Q3, step Q3.10; plan §3.1; D30–D32, D37–D40): the vault reference's `door-open` section as
 * published (vault/the-vault.html, version 60 with its rounded corners, FOR YOU, the lit niche and the lid resting open
 * on its rim; never the stale gen-vault-v2.mjs), built with h() (CSP-safe: no markup strings, styles through classes and
 * the CSSOM only). Its other objects (seal, door, drawer, box, card), its object selector, PLAY buttons, SOUND toggle,
 * demo rewards and synthesized sound are not ported.
 *
 *   .vault-box (.vault-box--phone on a phone: the box at 0.8, the sides 80 px)
 *     section.vlt[data-variant=door-open]   --k (1, 1.4 rare), --p (the hold), is-holding / is-open / is-playing / is-rare / fy-in
 *       .vlt__rule                           the hairline above the box (S and the end page; none on THE VAULT page)
 *       .vlt__stage
 *         ground, floor and contact shadow   (.vo-ground2, .vo-floor, .vo-ground)
 *         .vo-dopen                          the box: sides and corner facets in the front's own brushed material, the rim,
 *                                            the inside walls, the back with its lit niche (.vo-rw: FROM THE VAULT, the
 *                                            prize, its line, its odds), the recessed lid with FOR YOU and its underside,
 *                                            the inside's reveal (.vo-in), the front (button): two halves with THE / VAULT
 *                                            engraved over the monogram, the seam and its point
 *         .vlt__prog, .vlt__lead, .vlt__hint, .vlt__reward (OPEN ANOTHER), .vlt__status
 *
 * No number anywhere (D10); no ivory edge line (D31); the keyboard's focus ring in the box's own grey, gone once open.
 */
import { MONOGRAM_PATHS } from '../../../core/render/monogram.js';
import { h, s } from '../../shared/dom.js';
import { VAULT } from '../copy.js';
import { DOOR_WORDS, EMBLEM_AXIS, EMBLEM_EDGE, EMBLEM_EDGE_WIDTH, EMBLEM_FILL, EMBLEM_FONT, EMBLEM_PLACE, EMBLEM_VEIL, EMBLEM_VIEWBOX, LID_WORDS, type EngravedLine } from './emblem.js';

/** Where the box stands: SOLD OUT for your size, the end page of a release sold out whole, a door of THE VAULT page. */
export type VaultPlace = 'soldOut' | 'end' | 'page';

/** The box's elements the opening drives. */
export interface VaultBoxParts {
  /** The wrapper (`.vault-box`, `.vault-box--phone` on a phone). */
  root: HTMLElement;
  /** The vault's section (`.vlt`): its states and timeline variables. */
  vlt: HTMLElement;
  /** The box that floats (`.vo-dopen`). */
  box: HTMLElement;
  /** The front: the door the collector draws down, holds, or holds Space or Enter on. */
  front: HTMLButtonElement;
  /** The reveal's prize (under the lid, in the niche), its line and its odds. */
  nichePrize: HTMLElement;
  nicheLine: HTMLElement;
  nicheOdds: HTMLElement;
  /** The reveal's copy the page reads (`.vo-in`, `.vlt__reward`). */
  inPrize: HTMLElement;
  inWhat: HTMLElement;
  prize: HTMLElement;
  what: HTMLElement;
  lead: HTMLElement;
  hint: HTMLElement;
  /** OPEN ANOTHER, under the reward once open (S and the end page; none on THE VAULT page, MK V). */
  again: HTMLButtonElement;
  /** What a reader hears once it opens. */
  status: HTMLElement;
}

let serial = 0;

const span = (cls?: string, ...children: (Node | null)[]): HTMLSpanElement => h('span', cls ? { class: cls } : null, ...children);
const hidden = (cls: string, ...children: (Node | null)[]): HTMLSpanElement => h('span', { class: cls, attrs: { 'aria-hidden': 'true' } }, ...children);
/** The clear coat over a face (v59): its layer and the grain under it. */
const coat = (): HTMLSpanElement => hidden('vo-coat', span());

/** A line of engraved letters, each at its ink position. */
function engraved(line: EngravedLine, cls?: string): SVGTextElement {
  const text = s('text', { class: cls, y: line.y, 'font-family': EMBLEM_FONT, 'font-size': line.size, fill: 'currentColor', opacity: line.opacity });
  for (const [letter, x] of line.letters) {
    const t = s('tspan', { x });
    t.textContent = letter;
    text.appendChild(t);
  }
  return text;
}

/** The engraved emblem: the monogram's fill and lit edge through its outline masks, the veil, then the words. */
function emblem(cls: string, words: readonly SVGElement[]): SVGSVGElement {
  const id = `vm-${++serial}`;
  const grad = (gid: string, stops: readonly (readonly [number, number])[]) =>
    s('linearGradient', { id: gid, ...EMBLEM_AXIS, gradientUnits: 'userSpaceOnUse' }, ...stops.map(([offset, o]) => s('stop', { offset, 'stop-color': 'currentColor', 'stop-opacity': o })));
  const outlines = (attrs: Record<string, string | number>) => s('g', { transform: EMBLEM_PLACE.outer }, s('g', { transform: EMBLEM_PLACE.inner }, ...MONOGRAM_PATHS.map((d) => s('path', { ...attrs, d }))));
  const mask = (mid: string, attrs: Record<string, string | number>) => s('mask', { id: mid, maskUnits: 'userSpaceOnUse', x: -22, y: -22, width: 44, height: 44 }, outlines(attrs));
  const veil = s(
    'radialGradient',
    { id: `${id}-veil`, cx: 0, cy: 0.6, r: 1, gradientUnits: 'userSpaceOnUse', gradientTransform: EMBLEM_VEIL.transform },
    ...EMBLEM_VEIL.stops.map(([offset, o]) => s('stop', { offset, 'stop-color': EMBLEM_VEIL.colour, 'stop-opacity': o })),
  );
  return s(
    'svg',
    { class: `vo-emb ${cls}`, viewBox: EMBLEM_VIEWBOX, 'aria-hidden': 'true', focusable: 'false' },
    s('defs', {}, grad(`${id}-fill`, EMBLEM_FILL), grad(`${id}-edge`, EMBLEM_EDGE), mask(`${id}-m1`, { fill: '#fff' }), mask(`${id}-m2`, { fill: 'none', stroke: '#fff', 'stroke-width': EMBLEM_EDGE_WIDTH, 'vector-effect': 'non-scaling-stroke' })),
    s('rect', { x: -22, y: -22, width: 44, height: 44, fill: `url(#${id}-fill)`, mask: `url(#${id}-m1)` }),
    s('rect', { x: -22, y: -22, width: 44, height: 44, fill: `url(#${id}-edge)`, mask: `url(#${id}-m2)` }),
    s('defs', {}, veil),
    s('rect', { x: -18, y: -9, width: 36, height: 18, fill: `url(#${id}-veil)` }),
    ...words,
  );
}

/** The seal's horizon (its gap, reflection, two lines and two points). */
const horizon = (aria: boolean): HTMLDivElement =>
  h(
    'div',
    { class: 'vlt__hz', attrs: aria ? { 'aria-hidden': 'true' } : undefined },
    span('vlt__gap'),
    span('vlt__reflect'),
    span('vlt__line vlt__line--l'),
    span('vlt__line vlt__line--r'),
    span('vlt__pt vlt__pt--l'),
    span('vlt__pt vlt__pt--r'),
  );

/** A half of the front: its brushed face with the emblem, the sheen, the coat (the lower one its grip). */
function half(which: 'up' | 'down'): HTMLSpanElement {
  return hidden(
    `vo-door__half vo-door__half--${which}`,
    span('vo-door__face', emblem('vo-door__emb', DOOR_WORDS.map((w) => engraved(w)))),
    span('vo-sheen', span()),
    coat(),
    which === 'down' ? span('vo-door__grip') : null,
  );
}

/** THE VAULT's box, closed, for `place`; `phone`: the phone's size (the box at 0.8 of the computer's). */
export function vaultBox(place: VaultPlace, phone: boolean): VaultBoxParts {
  const hintId = `vlt-hint-${++serial}`;
  const nichePrize = h('p', { class: 'vo-rw__prize' });
  const nicheLine = h('p', { class: 'vo-rw__line' });
  const nicheOdds = h('p', { class: 'vo-rw__odds' });
  const inPrize = h('p', { class: 'vlt__prize' });
  const inWhat = h('p', { class: 'live__note vlt__what' });
  const prize = h('p', { class: 'vlt__prize', attrs: { 'aria-hidden': 'true' } });
  const what = h('p', { class: 'live__note vlt__what' });
  const lead = h('p', { class: 'live__note vlt__lead', text: VAULT.door.lead });
  const hint = h('p', { class: 'live__fact vlt__hint', id: hintId, text: VAULT.door.hint });
  const again = h('button', { class: 'textlink vlt__again', attrs: { type: 'button' }, text: VAULT.reveal.again });
  const status = h('p', { class: 'visually-hidden vlt__status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const front = h(
    'button',
    { class: 'vo-dopen__front', attrs: { type: 'button', 'aria-label': VAULT.door.label, 'aria-describedby': hintId } },
    half('up'),
    half('down'),
    hidden('vo-door__seam', span('vo-door__pt')),
  );
  const lid = hidden('vo-dopen__lid', emblem('vo-dopen__mono', [engraved(LID_WORDS, 'vo-dopen__for')]), h('span', { class: 'vo-dopen__mark', text: VAULT.lidMark }), coat());
  const box = h(
    'div',
    { class: 'vo vo-dopen' },
    ...(['t', 'b', 'l', 'r'] as const).map((side) => hidden(`vo-side vo-side--${side}`, coat())),
    ...(['t-l', 't-r', 'b-l', 'b-r', 'l-t', 'l-b', 'r-t', 'r-b'] as const).map((corner) => hidden(`vo-cnr vo-cnr--${corner}`)),
    hidden('vo-rim'),
    ...(['t', 'b', 'l', 'r'] as const).map((wall) => hidden(`vo-wall vo-wall--${wall}`)),
    hidden('vo-back'),
    h(
      'div',
      { class: 'vo-rw', attrs: { 'aria-hidden': 'true' } },
      span('vo-rw__nb'),
      ...(['t', 'b', 'l', 'r'] as const).map((face) => span(`vo-rw__fc vo-rw__fc--${face}`)),
      h('div', { class: 'vo-rw__obj' }, h('p', { class: 'vo-rw__from', text: VAULT.reveal.from }), nichePrize, nicheLine, nicheOdds),
    ),
    h(
      'div',
      { class: 'vo-dopen__box' },
      hidden('vo-lid-edge', span('vo-lcnr vo-lcnr--l'), span('vo-lcnr vo-lcnr--r')),
      hidden('vo-out__tray', span('vo-out__floor'), span('vo-out__light')),
      hidden('vo-dopen__under', coat()),
      lid,
    ),
    hidden('vo-door__light'),
    h(
      'div',
      { class: 'vo-in', attrs: { 'aria-hidden': 'true' } },
      horizon(false),
      span('vlt__glow'),
      h('div', { class: 'vlt__above' }, h('p', { class: 'live__overline vlt__from', text: VAULT.reveal.from }), inPrize),
      hidden('vlt__hzline', span()),
      inWhat,
    ),
    front,
  );
  const vlt = h(
    'section',
    { class: 'vlt', attrs: { 'aria-label': VAULT.name }, data: { variant: 'door-open', place } },
    hidden('vlt__rule'),
    h(
      'div',
      { class: 'vlt__stage' },
      horizon(true),
      hidden('vlt__seam'),
      hidden('vo-ground2'),
      hidden('vo-floor', span('vo-floor__shadow'), span('vo-floor__ao')),
      hidden('vo-ground'),
      box,
      hidden('vlt__prog'),
      hidden('vlt__glow'),
      lead,
      hint,
      h('div', { class: 'vlt__reward' }, h('div', { class: 'vlt__above' }, h('p', { class: 'live__overline vlt__from', text: VAULT.reveal.from }), prize), what, again),
      status,
    ),
  );
  const root = h('div', { class: ['vault-box', phone && 'vault-box--phone'] }, vlt);
  return { root, vlt, box, front, nichePrize, nicheLine, nicheOdds, inPrize, inWhat, prize, what, lead, hint, again, status };
}
