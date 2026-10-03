/**
 * Building blocks shared by the verification views: the orbit marks (drawn
 * from the geometry of the ORBES SEAL and the code's four moons), definition
 * rows, the contact of ORBES Client Services, the link to MY PIECES, the
 * links to the legal pages, the app's paths and the view shell.
 */
import { h, s } from '../../shared/dom.js';
import { GEOIP_ATTRIBUTION, LEGAL_PAGES, legalPath } from '../../shared/legal.js';
import { CONTACT, LEGAL, PIECES } from '../copy.js';
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

/** The app's own paths (static.ts serves the shell at /verify and /verify/*; main.ts routes them). */
export const LANDING_PATH = '/verify';
export const PIECES_PATH = '/verify/pieces';
/** The ownership certificate (F-06): its token follows in the fragment, `/verify/c#…`, never in the path. */
export const CERTIFICATE_PATH = '/verify/c';

/**
 * MY PIECES (F-01): a text link to /verify/pieces. A plain click stays in the app (`onOpen`: no reload, the
 * history entry is the router's); a click that opens a new tab or window is left to the browser.
 */
export function piecesLink(onOpen?: () => void, extraClass?: string): HTMLAnchorElement {
  return h('a', {
    class: ['textlink', extraClass],
    attrs: { href: PIECES_PATH },
    on: {
      click: (ev) => {
        if (!onOpen || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        onOpen();
      },
    },
    text: PIECES.link,
  });
}

/** A link that opens in a new tab, so the screen it leaves (a result, a registration under way) stays as it was. */
const NEW_TAB = { target: '_blank', rel: 'noopener' } as const;

/**
 * The legal pages (J-06): PRIVACY · TERMS · LEGAL · HELP (/legal/privacy, /legal/terms, /legal/notice, /legal/faq),
 * then DB-IP's attribution, the licence of the location of scans (shared/legal.ts). Text links held to the floors of
 * §3.8 like every other: 10 px type, 44 × 44 px zones, the shortest word (HELP) widened to 44 px. Under a result they
 * open a new tab (`newTab`), so the result stays for the customer to come back to; on the landing, the page itself.
 * DB-IP's site always opens apart.
 */
export function legalLinks(opts: { newTab?: boolean; extraClass?: string } = {}): HTMLElement {
  const target = opts.newTab ? NEW_TAB : {};
  const pages = LEGAL_PAGES.flatMap((page, i) => [
    i > 0 ? h('span', { class: 'legal-links__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }) : null,
    h('a', { class: 'textlink legal-links__link', attrs: { href: legalPath(page), ...target }, text: LEGAL.links[page] }),
  ]);
  return h(
    'nav',
    { class: ['legal-links', opts.extraClass], attrs: { 'aria-label': LEGAL.label } },
    h('div', { class: 'legal-links__pages' }, ...pages),
    h('a', { class: 'textlink legal-links__credit', attrs: { href: GEOIP_ATTRIBUTION.href, ...NEW_TAB }, text: GEOIP_ATTRIBUTION.text }),
  );
}

/** Under CREATE ACCOUNT: creating an account means accepting the terms of use (their article 1), and the link to them. */
export function termsNote(): HTMLElement {
  return h(
    'div',
    { class: 'terms-note' },
    h('p', { class: 'terms-note__text', text: LEGAL.accept }),
    h('a', { class: 'textlink terms-note__link', attrs: { href: legalPath('terms'), ...NEW_TAB }, text: LEGAL.terms }),
  );
}
