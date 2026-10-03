/**
 * ORBES legal pages (J-06): the privacy policy, the terms of use, the legal
 * notice and the FAQ, in English and French, at /legal/privacy,
 * /legal/terms, /legal/notice and /legal/faq (server/http/static.ts serves
 * this shell at /legal and /legal/*; /legal is their index).
 *
 *   ORBES                                    the wordmark (display face)
 *   PRIVACY  TERMS  LEGAL  HELP              the four pages, the current one marked
 *   ENGLISH · FRANÇAIS                       the language, each named in its own
 *   PRIVACY POLICY                           the title
 *   Version of 3 October 2026                LEGAL_VERSION (content/index.ts)
 *   the introduction, then each section: its heading (an anchor) and its text
 *   VERIFY A PIECE · IP GEOLOCATION BY DB-IP · © ORBES
 *
 * The language is `?lang=`, else the browser's (model.ts pickLanguage),
 * and it is the page's `<html lang>`; every link between the pages keeps it.
 * The text is built with textContent only (shared/dom.ts): the content's
 * small Markdown is parsed into runs first (model.ts), never read as HTML.
 * Where a page names ORBES Client Services' contact, it shows the one the
 * server publishes (GET /api/v1/client-services), and nothing when there is
 * none. The pages print as documents (styles.css, @media print).
 */
import { contactLines, phoneHref } from '../shared/client-services.js';
import { byId, h, mount } from '../shared/dom.js';
import { GEOIP_ATTRIBUTION, LEGAL_PAGES } from '../shared/legal.js';
import { DOCUMENTS, LANGS, LANGUAGE_NAMES, LEGAL_VERSION, WORDS, type Block, type Lang, type LegalDocument, type LegalWords } from './content/index.js';
import { hrefOf, parseBlock, pickLanguage, routeOf, splitFigures, typography, type LegalRoute, type Run } from './model.js';

/** How long the page waits for the contact of ORBES Client Services before leaving it out. */
const CONTACT_TIMEOUT_MS = 5_000;
/** The address of the verification app, for VERIFY A PIECE. */
const VERIFY_PATH = '/verify';

const NEW_TAB = { target: '_blank', rel: 'noopener' } as const;

/** Inline runs as nodes: text, set apart (strong, in ink), links (an https address opens apart). */
function inline(runs: Run[]): Node[] {
  return runs.map((r) => {
    if (r.kind === 'text') return document.createTextNode(r.text);
    if (r.kind === 'strong') return h('strong', { class: 'legal__strong', text: r.text });
    return h('a', { class: 'legal__link', attrs: { href: r.href, ...(r.external ? NEW_TAB : {}) }, text: r.text });
  });
}

/** A heading in the display face, its figures set apart in the reading face (Gravesend's one is its capital I). */
function heading<K extends 'h1' | 'h2'>(tag: K, text: string, cls: string, lang: Lang, id?: string): HTMLElementTagNameMap[K] {
  const parts = splitFigures(typography(text, lang)).map((p) => (p.figure ? h('span', { class: 'legal__figure', text: p.text }) : p.text));
  return h(tag, { class: cls, id }, ...parts);
}

function block(b: Block, lang: Lang): HTMLElement {
  // The contact of ORBES Client Services: filled once the server has said it (fillContacts), hidden until then.
  if (typeof b !== 'string') return h('div', { class: 'legal__contact', attrs: { hidden: true } });
  const parsed = parseBlock(b, lang);
  if (parsed.kind === 'list') return h('ul', { class: 'legal__list' }, ...parsed.items.map((item) => h('li', { class: 'legal__item' }, ...inline(item))));
  return h('p', { class: 'legal__text' }, ...inline(parsed.runs));
}

/**
 * The four pages, PRIVACY · TERMS · LEGAL · HELP, the current one marked (aria-current, its hairline drawn). Spaced
 * without dots: in French the row wraps on a phone, and a dot would end a line.
 */
function pagesNav(route: LegalRoute, lang: Lang, words: LegalWords): HTMLElement {
  const links = LEGAL_PAGES.map((page) =>
    h('a', {
      class: ['textlink', 'legal-nav__link', page === route && 'is-current'],
      attrs: { href: hrefOf(page, lang), 'aria-current': page === route ? 'page' : null },
      text: words.nav[page],
    }),
  );
  return h('nav', { class: 'legal-nav', attrs: { 'aria-label': words.navLabel } }, ...links);
}

/** The section the address names (#article-8), or ''. */
const currentSection = (): string => (/^#[a-z0-9-]+$/.test(location.hash) ? location.hash : '');

/**
 * ENGLISH · FRANÇAIS: the same page (and section) in the other language; each name in its own language. The section
 * is the one the address names now: a link followed inside the page (see Cookies, #cookies) moves it, and the
 * switch follows ('hashchange').
 */
function languageNav(route: LegalRoute, lang: Lang, words: LegalWords): HTMLElement {
  const links = LANGS.map((l) =>
    h('a', {
      class: ['textlink', 'legal-lang__link', l === lang && 'is-current'],
      attrs: { href: hrefOf(route, l, currentSection()), lang: l, hreflang: l, 'aria-current': l === lang ? 'true' : null },
      text: LANGUAGE_NAMES[l],
    }),
  );
  window.addEventListener('hashchange', () => {
    links.forEach((a, i) => a.setAttribute('href', hrefOf(route, LANGS[i], currentSection())));
  });
  const items = links.flatMap((a, i) => [i > 0 ? h('span', { class: 'legal-lang__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }) : null, a]);
  return h('nav', { class: 'legal-lang', attrs: { 'aria-label': words.languageLabel } }, ...items);
}

function documentView(doc: LegalDocument, lang: Lang): HTMLElement[] {
  return [
    heading('h1', doc.title, 'legal__title', lang),
    h('p', { class: 'legal__version', text: WORDS[lang].version(LEGAL_VERSION) }),
    ...doc.intro.map((b) => block(b, lang)),
    ...doc.sections.map((s) =>
      h('section', { class: 'legal__section', attrs: { 'aria-labelledby': s.id } }, heading('h2', s.title, 'legal__heading', lang, s.id), ...s.blocks.map((b) => block(b, lang))),
    ),
  ];
}

/** /legal: the four pages, each with its sentence. */
function indexView(lang: Lang, words: LegalWords): HTMLElement[] {
  return [
    heading('h1', words.indexTitle, 'legal__title', lang),
    h('p', { class: 'legal__version', text: words.version(LEGAL_VERSION) }),
    h('p', { class: 'legal__text', text: typography(words.indexLead, lang) }),
    h(
      'ul',
      { class: 'legal-index' },
      ...LEGAL_PAGES.map((page) => {
        const doc = DOCUMENTS[page][lang];
        return h(
          'li',
          { class: 'legal-index__item' },
          h('a', { class: 'textlink legal-index__link', attrs: { href: hrefOf(page, lang) }, text: typography(doc.title, lang) }),
          h('p', { class: 'legal-index__summary', text: typography(doc.summary, lang) }),
        );
      }),
    ),
  ];
}

function foot(lang: Lang, words: LegalWords): HTMLElement {
  return h(
    'footer',
    { class: 'legal-foot' },
    h('a', { class: 'textlink legal-foot__link', attrs: { href: VERIFY_PATH }, text: words.verify }),
    h('a', { class: 'textlink legal-foot__link', attrs: { href: GEOIP_ATTRIBUTION.href, lang: 'en', ...NEW_TAB }, text: GEOIP_ATTRIBUTION.text }),
    h('p', { class: 'legal-foot__meta', text: '© ORBES · GENOME CODE · PARIS' }),
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
      lines.email ? h('a', { class: 'legal__contact-link', attrs: { href: `mailto:${lines.email}`, 'aria-label': `${words.writeTo}: ${lines.email}` }, text: lines.email }) : null,
      lines.phone ? h('a', { class: 'legal__contact-link', attrs: { href: phoneHref(lines.phone), 'aria-label': `${words.call}: ${lines.phone}` }, text: lines.phone }) : null,
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
  mount(
    root,
    h('header', { class: 'legal-head' }, h('span', { class: 'wordmark wordmark--small legal-head__wordmark', text: 'ORBES' }), pagesNav(route, lang, words), languageNav(route, lang, words)),
    h('main', { class: 'legal', id: 'main' }, ...(doc ? documentView(doc, lang) : indexView(lang, words))),
    foot(lang, words),
  );
  // An anchor in the address (/legal/faq#transfer): its section, now that it exists.
  const section = currentSection();
  const target = section ? document.getElementById(section.slice(1)) : null;
  target?.scrollIntoView();
  void fillContacts(root, words);
}

start();
