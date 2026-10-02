/**
 * Building blocks shared by the verification views: the orbit marks (drawn
 * from the geometry of the ORBES SEAL and the code's four moons), definition
 * rows, the contact of ORBES Client Services and the view shell.
 */
import { h, s } from '../../shared/dom.js';
import { CONTACT } from '../copy.js';
import type { ContactModel, Row, Tone } from '../view-model.js';

/** A <main> view root with its modifier class. */
export function viewRoot(name: string, labelledBy?: string): HTMLElement {
  return h('main', { class: ['view', `view--${name}`], attrs: { 'aria-labelledby': labelledBy } });
}

/**
 * The state mark above a result title, a quiet echo of the seal:
 *   authentic — ring and core (the full seal)
 *   caution   — ring with a single moon on its orbit
 *   void      — the empty ring
 */
export function toneMark(tone: Tone): SVGSVGElement {
  const svg = s(
    'svg',
    { class: `mark mark--${tone}`, viewBox: '-24 -24 48 48', width: 44, height: 44, 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { class: 'mark__ring', cx: 0, cy: 0, r: 18 }),
  );
  if (tone === 'authentic') svg.appendChild(s('circle', { class: 'mark__core', cx: 0, cy: 0, r: 6.5 }));
  if (tone === 'caution') svg.appendChild(s('circle', { class: 'mark__core', cx: 0, cy: -18, r: 2.6 }));
  return svg;
}

/**
 * The orbit reticle: a hairline circle, a travelling arc while searching, and
 * four small moons on the diagonals as in CODE-01 (polaris, top left, with
 * its halo). Coordinates: the circle has radius 100.
 */
export function orbitReticle(extraClass = ''): SVGSVGElement {
  const moon = (x: number, y: number, polaris = false) =>
    s('g', { class: polaris ? 'reticle__moon reticle__moon--polaris' : 'reticle__moon' },
      s('circle', { cx: x, cy: y, r: 2.6 }),
      polaris ? s('circle', { class: 'reticle__halo', cx: x, cy: y, r: 6.5 }) : null,
    );
  const d = 88; // moons sit just outside the circle's corners, as on the printed code
  return s(
    'svg',
    { class: `reticle ${extraClass}`.trim(), viewBox: '-130 -130 260 260', 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { class: 'reticle__ring', cx: 0, cy: 0, r: 100 }),
    s('g', { class: 'reticle__sweep' }, s('path', { class: 'reticle__arc', d: arcPath(100, -14, 14) })),
    moon(-d, -d, true),
    moon(d, -d),
    moon(-d, d),
    moon(d, d),
  );
}

/** SVG arc on a circle of radius r centred on the origin, angles in degrees clockwise from north. */
export function arcPath(r: number, fromDeg: number, toDeg: number): string {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(r * Math.sin(a)).toFixed(3)} ${(-r * Math.cos(a)).toFixed(3)}`;
  };
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${p(fromDeg)} A ${r} ${r} 0 ${large} 1 ${p(toDeg)}`;
}

/** A definition list of label/value rows. */
export function rows(list: readonly Row[], extraClass = ''): HTMLDListElement {
  return h(
    'dl',
    { class: ['rows', extraClass] },
    ...list.flatMap(([label, value]) => [
      h('div', { class: 'rows__row' }, h('dt', { class: 'rows__label', text: label }), h('dd', { class: 'rows__value', text: value })),
    ]),
  );
}

/**
 * ORBES Client Services: the prefilled email as a text link (a secondary
 * action: the hairline button stays the foot's SCAN AGAIN or SCAN ANOTHER,
 * BRAND-DESIGN-SYSTEM §3.8), then the phone (a tel: link) and the hours,
 * centred. Each line only when configured.
 */
export function contactBlock(c: ContactModel): HTMLElement {
  return h(
    'div',
    { class: 'contact', data: { placement: c.placement } },
    c.mailto ? h('a', { class: 'textlink contact__email', attrs: { href: c.mailto }, text: CONTACT.action }) : null,
    c.phone ? h('a', { class: 'textlink contact__phone', attrs: { href: c.phone.href, 'aria-label': `${CONTACT.call} ${c.phone.label}` }, text: c.phone.label }) : null,
    c.hours ? h('p', { class: 'contact__hours micro', text: c.hours }) : null,
  );
}

/** A small uppercase section heading. */
export function sectionLabel(text: string, id?: string): HTMLHeadingElement {
  return h('h3', { class: 'section-label', id, text });
}
