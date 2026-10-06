/**
 * The logic of the legal pages (J-06, src/web/legal/model.ts), without the
 * DOM: the language (?lang=, then the browser's), the route under /legal and
 * the address put back, the addresses that keep the language, the small
 * Markdown of the content and the links it may hold, French typography, the
 * figures of a heading; and the contact of ORBES Client Services the pages
 * share with /verify (src/web/shared/client-services.ts).
 */
import { describe, expect, it } from 'vitest';
import { contactLines, phoneHref } from '../../src/web/shared/client-services.js';
import { GEOIP_ATTRIBUTION, LEGAL_PAGES, LEGAL_PATH, legalPath } from '../../src/web/shared/legal.js';
import { dateInWords, LEGAL_VERSION, WORDS } from '../../src/web/legal/content/index.js';
import { hrefOf, linkTarget, parseBlock, parseInline, pickLanguage, plainText, routeOf, splitFigures, typography } from '../../src/web/legal/model.js';

const NNBSP = ' ';

describe('legal pages: the language', () => {
  it('takes ?lang= first, whatever the browser says', () => {
    expect(pickLanguage('?lang=fr', ['en-US'])).toBe('fr');
    expect(pickLanguage('?lang=en', ['fr-FR', 'fr'])).toBe('en');
    expect(pickLanguage('?lang=FR', [])).toBe('fr');
    expect(pickLanguage('?x=1&lang=fr-CA', ['en'])).toBe('fr');
  });

  it("then the first of the browser's languages that is French or English, else English", () => {
    expect(pickLanguage('', ['fr-FR', 'en-US'])).toBe('fr');
    expect(pickLanguage('', ['de-DE', 'fr-BE', 'en'])).toBe('fr');
    expect(pickLanguage('', ['de-DE', 'en-GB', 'fr'])).toBe('en');
    expect(pickLanguage('', ['de-DE', 'it'])).toBe('en');
    expect(pickLanguage('', [])).toBe('en');
    // A language the pages do not have is no choice: the browser's languages decide.
    expect(pickLanguage('?lang=de', ['fr'])).toBe('fr');
    expect(pickLanguage('?lang=', ['fr'])).toBe('fr');
  });
});

describe('legal pages: routes and addresses', () => {
  it('serves the four pages at /legal/<page> and their index at /legal, as shared/legal.ts names them', () => {
    expect(LEGAL_PAGES).toEqual(['privacy', 'terms', 'notice', 'faq']);
    expect(LEGAL_PATH).toBe('/legal');
    for (const page of LEGAL_PAGES) {
      expect(legalPath(page)).toBe(`/legal/${page}`);
      expect(routeOf(`/legal/${page}`)).toEqual({ route: page, path: `/legal/${page}` });
      expect(routeOf(`/legal/${page}/`)).toEqual({ route: page, path: `/legal/${page}` });
    }
    expect(routeOf('/legal')).toEqual({ route: 'index', path: '/legal' });
    expect(routeOf('/legal/')).toEqual({ route: 'index', path: '/legal' });
  });

  it('shows the index for any other path under /legal, its address put back to /legal (a capital is forgiven)', () => {
    expect(routeOf('/legal/cookies')).toEqual({ route: 'index', path: '/legal' });
    expect(routeOf('/legal/privacy/extra')).toEqual({ route: 'index', path: '/legal' });
    expect(routeOf('/LEGAL/PRIVACY')).toEqual({ route: 'privacy', path: '/legal/privacy' });
  });

  it('keeps the language in every address between the pages', () => {
    expect(hrefOf('terms', 'fr')).toBe('/legal/terms?lang=fr');
    expect(hrefOf('index', 'en')).toBe('/legal?lang=en');
    expect(hrefOf('faq', 'en', '#transfer')).toBe('/legal/faq?lang=en#transfer');
  });
});

describe('legal pages: the text of the content', () => {
  it('reads a paragraph: plain text, **set apart**, and [links](…)', () => {
    expect(parseBlock('**Creation.** The account [is](/legal/terms) here.', 'en')).toEqual({
      kind: 'paragraph',
      runs: [
        { kind: 'strong', text: 'Creation.' },
        { kind: 'text', text: ' The account ' },
        { kind: 'link', text: 'is', href: '/legal/terms?lang=en', external: false },
        { kind: 'text', text: ' here.' },
      ],
    });
  });

  it('reads a list when every line starts with "- ", a paragraph otherwise', () => {
    const list = parseBlock('- **one**: a\n- two', 'en');
    expect(list.kind).toBe('list');
    expect(plainText(list)).toBe('one: a\ntwo');
    expect(parseBlock('- one\nnot an item', 'en').kind).toBe('paragraph');
  });

  it('links only to the legal pages (keeping the language), an anchor of the page, or an https address opened apart', () => {
    expect(linkTarget('/legal/notice', 'fr')).toEqual({ href: '/legal/notice?lang=fr', external: false });
    expect(linkTarget('/legal/faq#transfer', 'en')).toEqual({ href: '/legal/faq?lang=en#transfer', external: false });
    expect(linkTarget('/legal', 'en')).toEqual({ href: '/legal?lang=en', external: false });
    expect(linkTarget('#cookies', 'en')).toEqual({ href: '#cookies', external: false });
    expect(linkTarget(GEOIP_ATTRIBUTION.href, 'en')).toEqual({ href: 'https://db-ip.com', external: true });
    expect(linkTarget('https://creativecommons.org/licenses/by/4.0/', 'en')).toEqual({ href: 'https://creativecommons.org/licenses/by/4.0/', external: true });
    for (const refused of ['javascript:alert(1)', 'http://db-ip.com', '//evil.example', 'data:text/html,x', '/legal/cookies', '/verify', 'terms.en.md', 'https://x']) {
      expect(linkTarget(refused, 'en'), refused).toBeNull();
    }
    // A refused link reads as its words, never as markup.
    expect(parseInline('see [this](javascript:alert(1)) now', 'en')).toEqual([{ kind: 'text', text: 'see this) now' }]);
    expect(parseInline('<b>x</b> & [y](/legal/faq)', 'en')[0]).toEqual({ kind: 'text', text: '<b>x</b> & ' });
  });

  it("links a cross-reference to an article of the same document, its text unchanged (C23)", () => {
    const anchors = new Set(['article-11', 'article-12', 'article-15']);
    expect(parseInline('MY PIECES also presents ORBES Care (article 11).', 'en', anchors)).toEqual([
      { kind: 'text', text: 'MY PIECES also presents ORBES Care (' },
      { kind: 'link', text: 'article 11', href: '#article-11', external: false },
      { kind: 'text', text: ').' },
    ]);
    // In French too, after an elision; an article the document does not have stays plain text.
    expect(parseInline("ce que disent cet article et l'article 15 ; voir l'article 4.", 'fr', anchors)).toEqual([
      { kind: 'text', text: "ce que disent cet article et l'" },
      { kind: 'link', text: 'article 15', href: '#article-15', external: false },
      { kind: 'text', text: `${NNBSP}; voir l'article 4.` },
    ]);
    // Inside a list item, beside **set apart** and a [link](…), which keep their own runs.
    const list = parseBlock('- **Tier**: a rank (article 12).\n- [privacy](/legal/privacy) (article 99)', 'en', anchors);
    expect(list).toEqual({
      kind: 'list',
      items: [
        [{ kind: 'strong', text: 'Tier' }, { kind: 'text', text: ': a rank (' }, { kind: 'link', text: 'article 12', href: '#article-12', external: false }, { kind: 'text', text: ').' }],
        [{ kind: 'link', text: 'privacy', href: '/legal/privacy?lang=en', external: false }, { kind: 'text', text: ' (article 99)' }],
      ],
    });
    expect(plainText(list)).toBe('Tier: a rank (article 12).\nprivacy (article 99)');
    // Without the document's anchors (or with none), nothing is linked.
    expect(parseInline('ORBES Care (article 11).', 'en')).toEqual([{ kind: 'text', text: 'ORBES Care (article 11).' }]);
  });

  it('sets French punctuation with a narrow no-break space, and leaves English and addresses as they are', () => {
    expect(typography('Que prouve un résultat ?', 'fr')).toBe(`Que prouve un résultat${NNBSP}?`);
    expect(typography('« Vous achetez cette pièce ? »', 'fr')).toBe(`«${NNBSP}Vous achetez cette pièce${NNBSP}?${NNBSP}»`);
    expect(typography('ORBES CODE : la vérification ; puis', 'fr')).toBe(`ORBES CODE${NNBSP}: la vérification${NNBSP}; puis`);
    expect(typography('https://db-ip.com', 'fr')).toBe('https://db-ip.com');
    expect(typography('Buying this piece? Ask: now', 'en')).toBe('Buying this piece? Ask: now');
    expect(parseInline('Remise : [mentions](/legal/notice) ?', 'fr').map((r) => r.text).join('')).toBe(`Remise${NNBSP}: mentions${NNBSP}?`);
  });

  it('sets apart the figures of a heading, which the page sets in the reading face', () => {
    expect(splitFigures('Article 12 — Locking an account')).toEqual([
      { text: 'Article ', figure: false },
      { text: '12', figure: true },
      { text: ' — Locking an account', figure: false },
    ]);
    expect(splitFigures('Cookies')).toEqual([{ text: 'Cookies', figure: false }]);
  });

  it('dates the version in words, in both languages', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(`${LEGAL_VERSION}T00:00:00Z`))).toBe(false);
    expect(dateInWords('2026-10-03', 'en')).toBe('3 October 2026');
    expect(dateInWords('2026-10-03', 'fr')).toBe('3 octobre 2026');
    expect(dateInWords('2027-02-01', 'fr')).toBe('1er février 2027');
    expect(WORDS.en.version('2026-10-03')).toBe('Version of 3 October 2026');
    expect(WORDS.fr.version('2026-10-03')).toBe('Version du 3 octobre 2026');
    expect(() => dateInWords('2026-13-01', 'en')).toThrow();
  });
});

describe('the contact of ORBES Client Services (shared by /verify and the legal pages)', () => {
  it('keeps only the lines the server rules allow, and nothing without an email or a phone', () => {
    expect(contactLines({ email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday' })).toEqual({
      email: 'clientservices@theorbes.com',
      phone: '+33 1 23 45 67 89',
      hours: 'Monday to Saturday',
    });
    expect(contactLines({})).toBeNull();
    expect(contactLines({ hours: 'Monday' })).toBeNull();
    expect(contactLines(null)).toBeNull();
    expect(contactLines('x')).toBeNull();
    expect(contactLines({ email: 'a@b.c?subject=x', phone: '+33 1 23' })).toBeNull();
    expect(contactLines({ email: ' clientservices@theorbes.com ', hours: 'line\nbreak' })).toEqual({ email: 'clientservices@theorbes.com' });
    expect(phoneHref('+33 1 23 45 67 89')).toBe('tel:+33123456789');
  });
});
