/**
 * Building blocks shared by the verification views: the orbit marks (drawn
 * from the geometry of the ORBES SEAL and the code's four moons), definition
 * rows, the contact of ORBES Client Services, the links to MY PIECES, to
 * THE COLLECTION, to THE RELEASES and to THE CIRCLE, the links to the legal
 * pages, the app's paths, the figures of a title set in the reading face, and
 * the view shell.
 */
import { h, s } from '../../shared/dom.js';
import { GEOIP_ATTRIBUTION, LEGAL_PAGES, legalPath } from '../../shared/legal.js';
import { CIRCLE_PATH, circlePostPath } from '../circle-model.js';
import { CIRCLE, CONTACT, LEGAL, LOOKBOOK, PIECES, RELEASES, SOUND } from '../copy.js';
import { LOOKBOOK_PATH, lookbookSheetPath } from '../lookbook-model.js';
import { releasePath, RELEASES_PATH } from '../releases-model.js';
import type { SoundSwitch } from '../sound.js';
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
 * ORBES Client Services' email under FORGOTTEN PASSWORD? in the vault's look (a LIVE RELEASE's sign-in): the prefilled
 * email as a text link, centred. The phone and the hours are no longer shown in the collector app (plan NEXT-NINE, CS-01).
 */
export function contactBlock(c: ContactModel): HTMLElement {
  return h('div', { class: 'contact', data: { placement: c.placement } }, c.mailto ? h('a', { class: 'textlink contact__email', attrs: { href: c.mailto }, text: CONTACT.action }) : null);
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
/** THE COLLECTION (P-R02): the lookbook's grid; a model's sheet is `/verify/lookbook/<slug>`. */
export { LOOKBOOK_PATH } from '../lookbook-model.js';
/** THE RELEASES (P-R03): the list; a release's page is `/verify/releases/<id>`. */
export { RELEASES_PATH } from '../releases-model.js';
/** THE CIRCLE (P-X01): the feed; a post is `/verify/circle/<id>`. */
export { CIRCLE_PATH } from '../circle-model.js';

/**
 * A link of this app (`href`, a real address: a click that opens a new tab or window is left to the browser); a plain
 * click stays in the app (`onOpen`: no reload, the history entry is the router's).
 */
function appLink(href: string, text: string, onOpen?: () => void, extraClass?: string): HTMLAnchorElement {
  return h('a', {
    class: ['textlink', extraClass],
    attrs: { href },
    on: {
      click: (ev) => {
        if (!onOpen || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        onOpen();
      },
    },
    text,
  });
}

/**
 * THE COLLECTION (P-R02): a text link to /verify/lookbook, on the landing, in MY PIECES and at the foot of a sheet; or,
 * with `slug`, SEE THE MODEL, a text link to that model's sheet (each card of the grid, and under an authentic result).
 */
export function lookbookLink(onOpen?: () => void, opts: { slug?: string; extraClass?: string } = {}): HTMLAnchorElement {
  return opts.slug ? appLink(lookbookSheetPath(opts.slug), LOOKBOOK.seeModel, onOpen, opts.extraClass) : appLink(LOOKBOOK_PATH, LOOKBOOK.link, onOpen, opts.extraClass);
}

/**
 * THE RELEASES (P-R03): a text link to /verify/releases, on the landing, in MY PIECES and at the foot of a release's
 * page; or, with `id`, SEE THE RELEASE, a text link to that release's page (each release of the list).
 */
export function releasesLink(onOpen?: () => void, opts: { id?: string; extraClass?: string } = {}): HTMLAnchorElement {
  return opts.id ? appLink(releasePath(opts.id), RELEASES.see, onOpen, opts.extraClass) : appLink(RELEASES_PATH, RELEASES.link, onOpen, opts.extraClass);
}

/**
 * THE CIRCLE (P-X01): a text link to /verify/circle, in MY PIECES for an owner, at the foot of a post (back to the
 * feed); or, with `id`, the link of one post of the feed (`label`: READ THE NOTE, SEE THE INVITATION, SEE THE POLL).
 */
export function circleLink(onOpen?: () => void, opts: { id?: string; label?: string; extraClass?: string } = {}): HTMLAnchorElement {
  return opts.id ? appLink(circlePostPath(opts.id), opts.label ?? CIRCLE.link, onOpen, opts.extraClass) : appLink(CIRCLE_PATH, CIRCLE.link, onOpen, opts.extraClass);
}

/**
 * Words a title sets in the display face, its figures in the reading face (`.numeral`): Gravesend's one is its capital
 * I, and its figures do not align. A model's or a collection's name may hold one (ORBIT 2026).
 */
export function withNumerals(text: string): (string | HTMLSpanElement)[] {
  return text.split(/(\d+)/).flatMap((part, i): (string | HTMLSpanElement)[] => (part === '' ? [] : i % 2 === 1 ? [h('span', { class: 'numeral', text: part })] : [part]));
}

/**
 * A day and its hour (`TUESDAY 20 OCTOBER · 12:00 PARIS`, a date of THE REVEALS) held on one line as the canvas's .nw
 * holds it, so it never starts beside the words before it once it has to leave them; on a phone too narrow to hold it
 * whole (320 px, fidelity rule 5) it breaks after its weekday only, the date, the hour and PARIS kept together.
 */
export function dayAndHour(when: string, cls: string): HTMLSpanElement {
  const at = when.indexOf(' ');
  if (at < 0) return h('span', { class: ['n-nw', cls] }, ...withNumerals(when));
  return h('span', { class: ['n-keep', cls] }, when.slice(0, at + 1), h('span', { class: 'n-nw' }, ...withNumerals(when.slice(at + 1))));
}

/**
 * MY PIECES (F-01): a text link to /verify/pieces. A plain click stays in the app (`onOpen`: no reload, the
 * history entry is the router's); a click that opens a new tab or window is left to the browser.
 */
export function piecesLink(onOpen?: () => void, extraClass?: string): HTMLAnchorElement {
  return appLink(PIECES_PATH, PIECES.link, onOpen, extraClass);
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

/**
 * Under CREATE ACCOUNT (C39): creating an account means accepting the terms of use (their article 1), then TERMS OF
 * USE · PRIVACY POLICY, both in a new tab (the form and the scan's window stay): the privacy policy says what the
 * account records, where the account data is collected. One sentence in ash, its links underlined in ivory.
 * `vault`: the look of a LIVE RELEASE's pages, as lot E built it (fidelity rule 6): the sentence, then the two links on
 * their own line, centred, held to the floors of §3.8 as legalLinks.
 */
export function termsNote(look: 'nocturne' | 'vault' = 'nocturne'): HTMLElement {
  if (look === 'vault') {
    return h(
      'div',
      { class: 'terms-note' },
      h('p', { class: 'terms-note__text', text: LEGAL.accept }),
      h(
        'div',
        { class: 'terms-note__links' },
        h('a', { class: 'textlink terms-note__link', attrs: { href: legalPath('terms'), ...NEW_TAB }, text: LEGAL.terms }),
        h('span', { class: 'terms-note__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }),
        h('a', { class: 'textlink terms-note__link', attrs: { href: legalPath('privacy'), ...NEW_TAB }, text: LEGAL.privacy }),
      ),
    );
  }
  return h(
    'p',
    { class: 'n-sm n-own__terms' },
    h('span', { text: LEGAL.accept }),
    ' ',
    h('a', { class: 'n-ivc n-u n-own__terms-link', attrs: { href: legalPath('terms'), ...NEW_TAB }, text: LEGAL.terms }),
    '\u00a0· ',
    h('a', { class: 'n-ivc n-u n-own__terms-link', attrs: { href: legalPath('privacy'), ...NEW_TAB }, text: LEGAL.privacy }),
  );
}

/**
 * SOUND ON / OFF (P-D07): a text link that switches the sound signature, its state in aria-pressed. Its accessible
 * name is SOUND; ON or OFF beside the word says the state to the eye (hidden from assistive technologies, which hear
 * the pressed state instead). At the foot of the landing (`landing__sound`) and of a LIVE RELEASE's room (`live__sound`).
 */
export function soundToggle(sound: SoundSwitch, extraClass: string): HTMLButtonElement {
  const state = h('span', { class: `${extraClass}-state`, attrs: { 'aria-hidden': 'true' } });
  const button = h('button', { class: `textlink ${extraClass}`, attrs: { type: 'button' } }, `${SOUND.label} `, state);
  const render = (): void => {
    button.setAttribute('aria-pressed', String(sound.on));
    state.textContent = sound.on ? SOUND.on : SOUND.off;
  };
  button.addEventListener('click', () => {
    sound.set(!sound.on);
    render();
  });
  render();
  return button;
}
