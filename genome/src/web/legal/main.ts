/**
 * ORBES legal pages (J-06): the privacy policy, the terms of use, the legal
 * notice and the FAQ, in English and French, at /legal/privacy,
 * /legal/terms, /legal/notice and /legal/faq (server/http/static.ts serves
 * this shell at /legal and /legal/*; /legal is their index). Since NOCTURNE
 * (plan NOCTURNE, screen 9, step N8; C23, C41) they stand on the app's ground,
 * with its header, its rail and its footer:
 *
 *   ORBES                         VERIFY A PIECE   the header: the wordmark, the way back to the app
 *   NOW  RELEASES •  COLLECTION  CIRCLE  PIECES    the app's rail, no chapter current (each a link into /verify;
 *   ──────────────────────────────────────────    RELEASES' dot while a release is live or announced)
 *   PRIVACY  TERMS  LEGAL  HELP                    the four pages, the current one underlined (.switch2)
 *   Version of 7 October 2026   ENGLISH · FRANÇAIS LEGAL_VERSION (content/index.ts); the language, each in its own
 *   TERMS OF USE                                   the title
 *   the introduction, then each section: its heading (an anchor) and its text, every section open
 *   ──────────────────────────────────────────
 *   PRIVACY  TERMS  LEGAL  HELP                    the footer: the four pages again, VERIFY A PIECE, DB-IP's
 *   VERIFY A PIECE · IP GEOLOCATION BY DB-IP       attribution, © ORBES · GENOME CODE · PARIS
 *   © ORBES · GENOME CODE · PARIS
 *
 * Reading text is 16/1.65, at most 34 em a line (about 68 characters), headings in Gravesend (styles.css).
 * The language is `?lang=`, else the browser's (model.ts pickLanguage),
 * and it is the page's `<html lang>`; every link between the pages keeps it.
 * The text is built with textContent only (shared/dom.ts): the content's
 * small Markdown is parsed into runs first (model.ts), never read as HTML.
 * Where a page names ORBES Client Services' contact, it shows the one the
 * server publishes (GET /api/v1/client-services), and nothing when there is
 * none. The pages print as documents (styles.css, @media print).
 */
import { CHAPTER_IDS, CHAPTER_LABELS, CHAPTER_PATHS, RAIL_LABEL } from '../shared/chapters.js';
import { contactLines, phoneHref } from '../shared/client-services.js';
import { byId, h, mount, s } from '../shared/dom.js';
import { GEOIP_ATTRIBUTION, LEGAL_PAGES } from '../shared/legal.js';
import { railLive } from '../verify/nocturne-model.js';
import { DOCUMENTS, LANGS, LANGUAGE_NAMES, LEGAL_VERSION, WORDS, type Block, type Lang, type LegalDocument, type LegalWords } from './content/index.js';
import { hrefOf, parseBlock, pickLanguage, routeOf, splitFigures, typography, type LegalRoute, type Run } from './model.js';

/** How long the page waits for the contact of ORBES Client Services, or for what the rail's dot says, before going on without it. */
const CONTACT_TIMEOUT_MS = 5_000;
/** The address of the verification app, for VERIFY A PIECE. */
const VERIFY_PATH = '/verify';

const NEW_TAB = { target: '_blank', rel: 'noopener' } as const;

/** Inline runs as nodes: text, set apart (strong, in ivory), links (ivory, underlined; an https address opens apart). */
function inline(runs: Run[]): Node[] {
  return runs.map((r) => {
    if (r.kind === 'text') return document.createTextNode(r.text);
    if (r.kind === 'strong') return h('strong', { class: 'legal__strong', text: r.text });
    return h('a', { class: 'n-ivc n-u legal__link', attrs: { href: r.href, ...(r.external ? NEW_TAB : {}) }, text: r.text });
  });
}

/** A heading in the display face, its figures set apart in the reading face (Gravesend's one is its capital I). */
function heading<K extends 'h1' | 'h2'>(tag: K, text: string, cls: string, lang: Lang, id?: string): HTMLElementTagNameMap[K] {
  const parts = splitFigures(typography(text, lang)).map((p) => (p.figure ? h('span', { class: 'legal__figure', text: p.text }) : p.text));
  return h(tag, { class: cls, id }, ...parts);
}

function block(b: Block, lang: Lang): HTMLElement {
  // The contact of ORBES Client Services: filled once the server has said it (fillContacts), hidden until then.
  if (typeof b !== 'string') return h('div', { class: 'n-contact legal__contact', attrs: { hidden: true } });
  const parsed = parseBlock(b, lang);
  if (parsed.kind === 'list') return h('ul', { class: 'n-art legal__list' }, ...parsed.items.map((item) => h('li', { class: 'legal__item' }, ...inline(item))));
  return h('p', { class: 'n-art legal__text' }, ...inline(parsed.runs));
}

/** The chevron of a row that leads on (the canvas's `chev`, 16 px). */
function chevron(): SVGSVGElement {
  return s('svg', { class: 'n-ic n-ic--sm', viewBox: '0 0 22 22', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: 'M8.5 4.5L15 11l-6.5 6.5' }));
}

/** The header (C23): ORBES at the left; VERIFY A PIECE, the way back to the app, at the right. */
function header(words: LegalWords): HTMLElement {
  return h('header', { class: 'n-hd legal-head' }, h('span', { class: 'n-g n-wm', text: 'ORBES' }), h('a', { class: 'n-g n-acct legal-head__verify', attrs: { href: VERIFY_PATH }, text: words.verify }));
}

/**
 * The app's rail (C23, C41): its five chapters, none current here, each a link into /verify. RELEASES carries its dot
 * while a LIVE RELEASE is announced, its room open or live, or a draw open, soon open or in its early access, as the
 * app's own rail says it (verify/nocturne-model.ts railLive); nothing is said when that cannot be read.
 */
function rail(): { el: HTMLElement; live: HTMLElement } {
  const live = h('i', { class: 'n-rail__live', attrs: { 'aria-hidden': 'true', hidden: true } });
  const links = CHAPTER_IDS.map((c) => h('a', { class: 'n-g n-rail__link', attrs: { href: CHAPTER_PATHS[c] }, data: { chapter: c } }, CHAPTER_LABELS[c], c === 'releases' ? live : null));
  return { el: h('nav', { class: 'n-rail legal-rail', attrs: { 'aria-label': RAIL_LABEL } }, ...links), live };
}

/** RELEASES' dot: what is announced, read from the app's public routes (GET /api/v1/live/next, /api/v1/drops). */
async function readRail(live: HTMLElement): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CONTACT_TIMEOUT_MS);
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin', signal: abort.signal });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  try {
    const [next, drops] = await Promise.all([get('/api/v1/live/next'), get('/api/v1/drops')]);
    const release = (next as { release?: unknown } | null)?.release ?? null;
    const list = (drops as { drops?: unknown } | null)?.drops;
    live.hidden = !railLive(release as Parameters<typeof railLive>[0], Array.isArray(list) ? list : []);
  } catch {
    // Offline or refused: the rail without its dot.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The four pages, PRIVACY · TERMS · LEGAL · HELP, the current one underlined (aria-current, `.switch2`). In French the
 * row wraps on a phone, its hairline under the last line.
 */
function pagesNav(route: LegalRoute, lang: Lang, words: LegalWords): HTMLElement {
  const links = LEGAL_PAGES.map((page) =>
    h('a', {
      class: ['n-g', 'n-switch2__tab', 'legal-nav__link'],
      attrs: { href: hrefOf(page, lang), 'aria-current': page === route ? 'page' : null },
      text: words.nav[page],
    }),
  );
  return h('nav', { class: 'n-px legal-pages', attrs: { 'aria-label': words.navLabel } }, h('div', { class: 'n-switch2 legal-nav' }, ...links));
}

/** The section the address names (#article-8), or ''. */
const currentSection = (): string => (/^#[a-z0-9-]+$/.test(location.hash) ? location.hash : '');

/**
 * ENGLISH · FRANÇAIS: the same page (and section) in the other language; each name in its own language, the current
 * one in ivory, underlined. The section is the one the address names now: a link followed inside the page (see
 * Cookies, #cookies) moves it, and the switch follows ('hashchange').
 */
function languageNav(route: LegalRoute, lang: Lang, words: LegalWords): HTMLElement {
  const links = LANGS.map((l) =>
    h('a', {
      class: ['legal-lang__link', l === lang ? 'n-ivc n-u' : null],
      attrs: { href: hrefOf(route, l, currentSection()), lang: l, hreflang: l, 'aria-current': l === lang ? 'true' : null },
      text: LANGUAGE_NAMES[l],
    }),
  );
  window.addEventListener('hashchange', () => {
    links.forEach((a, i) => a.setAttribute('href', hrefOf(route, LANGS[i], currentSection())));
  });
  const items = links.flatMap((a, i) => [i > 0 ? h('span', { class: 'legal-lang__dot', attrs: { 'aria-hidden': 'true' }, text: ' · ' }) : null, a]);
  return h('nav', { class: 'n-g n-lb legal-lang', attrs: { 'aria-label': words.languageLabel } }, ...items);
}

/** The line above the title: the version of the texts, and the language. */
function versionLine(route: LegalRoute, lang: Lang, words: LegalWords): HTMLElement {
  return h('div', { class: 'n-px n-sb legal-meta' }, h('p', { class: 'n-sm n-num legal__version', text: words.version(LEGAL_VERSION) }), languageNav(route, lang, words));
}

function documentView(doc: LegalDocument, lang: Lang): HTMLElement[] {
  return [
    h('div', { class: 'n-px legal-titles' }, heading('h1', doc.title, 'n-g n-t1 legal__title', lang), ...doc.intro.map((b) => block(b, lang))),
    h(
      'article',
      { class: 'n-px legal__body' },
      ...doc.sections.map((sec) => h('section', { class: 'legal__section', attrs: { 'aria-labelledby': sec.id } }, heading('h2', sec.title, 'n-g n-t3 legal__heading', lang, sec.id), ...sec.blocks.map((b) => block(b, lang)))),
    ),
  ];
}

/** /legal: the four pages, each a row that leads on, with its sentence. */
function indexView(lang: Lang, words: LegalWords): HTMLElement[] {
  return [
    h('div', { class: 'n-px legal-titles' }, heading('h1', words.indexTitle, 'n-g n-t1 legal__title', lang), h('p', { class: 'n-art legal__text', text: typography(words.indexLead, lang) })),
    h(
      'ul',
      { class: 'n-px legal-index' },
      ...LEGAL_PAGES.map((page) => {
        const doc = DOCUMENTS[page][lang];
        return h(
          'li',
          { class: 'legal-index__item' },
          h(
            'a',
            { class: 'n-acc legal-index__link', attrs: { href: hrefOf(page, lang) } },
            h('span', { class: 'n-acc__text' }, h('span', { class: 'n-g n-t3 n-ivc n-acc__title legal-index__title', text: typography(doc.title, lang) }), h('span', { class: 'n-sm n-acc__line legal-index__summary', text: typography(doc.summary, lang) })),
            chevron(),
          ),
        );
      }),
    ),
  ];
}

/** The footer (C23's): the four pages, VERIFY A PIECE, DB-IP's attribution, © ORBES · GENOME CODE · PARIS. */
function foot(route: LegalRoute, lang: Lang, words: LegalWords): HTMLElement {
  return h(
    'footer',
    { class: 'n-foot legal-foot' },
    h(
      'nav',
      // Named as the app's footer names its legal links (Legal information), apart from the pages' tabs above.
      { class: 'n-g n-fl legal-foot__pages', attrs: { 'aria-label': words.indexTitle } },
      ...LEGAL_PAGES.map((page) => h('a', { class: 'n-fl__link', attrs: { href: hrefOf(page, lang), 'aria-current': page === route ? 'page' : null }, text: words.nav[page] })),
    ),
    h('p', { class: 'legal-foot__verify' }, h('a', { class: 'n-g n-tl legal-foot__link', attrs: { href: VERIFY_PATH }, text: words.verify })),
    h('p', { class: 'n-foot__credit' }, h('a', { class: 'n-g n-dbip legal-foot__link', attrs: { href: GEOIP_ATTRIBUTION.href, lang: 'en', ...NEW_TAB }, text: GEOIP_ATTRIBUTION.text })),
    h('p', { class: 'n-g n-cr legal-foot__meta', text: '© ORBES · GENOME CODE · PARIS' }),
  );
}

/**
 * The contact of ORBES Client Services where a page names it: its email and phone as links, its hours, as the server
 * publishes them (CLIENT_SERVICES_*). Nothing configured, or no answer in time: the places stay hidden.
 */
async function fillContacts(root: HTMLElement, words: LegalWords): Promise<void> {
  const places = [...root.querySelectorAll<HTMLElement>('.legal__contact')];
  if (places.length === 0) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CONTACT_TIMEOUT_MS);
  let lines: ReturnType<typeof contactLines> = null;
  try {
    const res = await fetch('/api/v1/client-services', { headers: { accept: 'application/json' }, credentials: 'same-origin', signal: abort.signal });
    if (res.ok) lines = contactLines(await res.json());
  } catch {
    // Offline or refused: the page reads as it is, without the contact.
  } finally {
    clearTimeout(timer);
  }
  if (!lines) return;
  for (const place of places) {
    mount(
      place,
      lines.email ? h('a', { class: 'n-num legal__contact-link', attrs: { href: `mailto:${lines.email}`, 'aria-label': `${words.writeTo}: ${lines.email}` }, text: lines.email }) : null,
      lines.phone ? h('a', { class: 'n-num legal__contact-link', attrs: { href: phoneHref(lines.phone), 'aria-label': `${words.call}: ${lines.phone}` }, text: lines.phone }) : null,
      lines.hours ? h('p', { class: 'legal__contact-hours', text: lines.hours }) : null,
    );
    place.hidden = false;
  }
}

function start(): void {
  const lang = pickLanguage(location.search, navigator.languages?.length ? navigator.languages : [navigator.language]);
  const { route, path } = routeOf(location.pathname);
  document.documentElement.lang = lang;
  // A path the pages do not know shows the index: its address is put back to /legal (the query and anchor kept).
  if (location.pathname !== path) history.replaceState(null, '', `${path}${location.search}${location.hash}`);

  const words = WORDS[lang];
  const doc = route === 'index' ? null : DOCUMENTS[route][lang];
  document.title = `${doc ? doc.title : words.indexTitle} — ORBES`;
  const root = byId('app');
  const chapters = rail();
  mount(
    root,
    header(words),
    chapters.el,
    h('main', { class: 'legal', id: 'main' }, pagesNav(route, lang, words), versionLine(route, lang, words), ...(doc ? documentView(doc, lang) : indexView(lang, words))),
    foot(route, lang, words),
  );
  // An anchor in the address (/legal/faq#transfer): its section, now that it exists.
  const section = currentSection();
  const target = section ? document.getElementById(section.slice(1)) : null;
  target?.scrollIntoView();
  void fillContacts(root, words);
  void readRail(chapters.live);
}

start();
