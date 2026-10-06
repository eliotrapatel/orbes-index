/**
 * The legal pages (J-06, src/web/legal/) against the authentication design
 * system (docs/BRAND-DESIGN-SYSTEM.md §3): the shell of the other apps (CSP
 * safe, the display font preloaded, the tab icon of /verify, the monogram
 * nowhere else, D-06), type from brand.css tokens only, the display face on
 * the wordmark, titles and labels and never on what is read, in French as
 * in English (the subset carries the accented capitals of Latin-1), figures
 * of a heading in the reading face, the floors of §3.8 on every
 * text link, no readable text in --metal, and a print view; since NOCTURNE
 * (step N8) on the app's ground, with its header, rail and footer.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertCspSafeHtml } from '../../scripts/build-web.js';
import { renderFavicons } from '../../scripts/favicons.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../src/web');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');
const styles = read('legal/styles.css');
/** legal/styles.css with NOCTURNE's foundation it imports written in its place (brand.css read on its own). */
const sheetText = styles.replace('@import "../shared/nocturne.css";', read('shared/nocturne.css'));
const brand = read('shared/brand.css');
const shell = read('legal/index.html');
const main = read('legal/main.ts');

/** Every innermost rule of a stylesheet (inside @media too): its selectors, declarations and enclosing at-rule. */
function rules(css: string): { selectors: string[]; decls: Record<string, string>; media: string | null }[] {
  const out: { selectors: string[]; decls: Record<string, string>; media: string | null }[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const mediaAt = [...text.matchAll(/@media([^{]+)\{/g)].map((m) => ({ at: m.index ?? 0, query: m[1].trim(), end: closing(text, (m.index ?? 0) + m[0].length - 1) }));
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) decls[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
    const at = m.index ?? 0;
    const media = mediaAt.find((x) => at > x.at && at < x.end)?.query ?? null;
    out.push({ selectors: m[1].replace(/@media[^{]*$/, '').split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean), decls, media });
  }
  return out;
}

function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length;
}

const tokens: Record<string, string> = {};
for (const m of brand.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens[m[1]] = m[2].trim();
const px = (v: string): number => Number.parseFloat(v.replace(/var\((--[\w-]+)\)/g, (_, t: string) => tokens[t] ?? t));
const all = rules(styles);
const sheet = rules(sheetText);
const screen = sheet.filter((r) => r.media === null || !/print/.test(r.media));
const display = (css: ReturnType<typeof rules>) => css.filter((r) => r.decls['font-family'] === 'var(--font-display)').flatMap((r) => r.selectors);

describe('legal pages: the shell (J-06)', () => {
  it('is the shell of the other apps: CSP safe, the display font preloaded as they do, the stylesheet and the bundle', () => {
    expect(() => assertCspSafeHtml(shell, 'legal/index.html')).not.toThrow();
    const preload = '<link rel="preload" href="../shared/fonts/gravesend-sans-500.woff2" as="font" type="font/woff2" crossorigin>';
    for (const app of ['verify', 'admin', 'legal']) expect(read(`${app}/index.html`), app).toContain(preload);
    expect(shell).toContain('<link rel="stylesheet" href="./styles.css">');
    expect(shell).toContain('<script type="module" src="./main.ts"></script>');
    expect(shell).toContain('<html lang="en">');
    expect(shell).toContain('<meta name="referrer" content="no-referrer">');
    // No decoder: the pages read no code.
    expect(shell).not.toContain('orbes-worker');
    // NOCTURNE's ground from the first paint (plan, screen 9), Safari's bars in its ink (addition 13).
    expect(shell).toContain('<body class="nocturne">');
    expect(shell).toContain('<div id="app" class="n-column">');
    expect(shell).toContain('<meta name="theme-color" content="#0a0a0a">');
  });

  it('shows the tab icon of /verify, the public app (D-06), and the monogram nowhere on the page', () => {
    const icons = renderFavicons();
    expect(icons.find((i) => i.app === 'legal')!.svg).toBe(icons.find((i) => i.app === 'verify')!.svg);
    expect(read('legal/favicon.svg')).toBe(read('verify/favicon.svg'));
    expect(shell).toContain('<link rel="icon" href="./favicon.svg" type="image/svg+xml">');
    expect(main).not.toContain('monogram');
    // The word ORBES stays typed, in the wordmark's one spec.
    expect(main).toContain("h('span', { class: 'n-g n-wm', text: 'ORBES' })");
  });
});

describe('legal pages: type and colour from brand.css and NOCTURNE\'s foundation (BRAND-DESIGN-SYSTEM §3.1, §3.2; plan NOCTURNE, screen 9)', () => {
  it('imports the brand foundation, then NOCTURNE\'s, and sets every font size from a token', () => {
    expect(styles).toMatch(/^@import "\.\.\/shared\/brand\.css";\n@import "\.\.\/shared\/nocturne\.css";$/m);
    const sizes = sheet.map((r) => r.decls['font-size']).filter((v): v is string => v !== undefined);
    expect(sizes.length).toBeGreaterThan(5);
    for (const v of sizes) {
      if (v === 'inherit') continue;
      expect(v, v).toMatch(/^var\(--(n-)?fs-[a-z0-9-]+\)$/);
      expect(tokens[v.slice(4, -1)], v).toBeDefined();
    }
  });

  it('sets tracking from tokens wherever a token has the same value', () => {
    const byTrack = Object.fromEntries(Object.entries(tokens).filter(([t]) => t.startsWith('--track-')).map(([t, v]) => [v, t]));
    const literal = sheet.flatMap((r) => ['letter-spacing', 'text-indent'].map((p) => r.decls[p]).filter((v): v is string => v !== undefined && byTrack[v] !== undefined));
    expect(literal).toEqual([]);
  });

  it('names fonts only through the tokens, and never sets readable text in the decorative --metal', () => {
    for (const r of sheet) if (r.decls['font-family']) expect(['var(--font)', 'var(--font-display)'], r.selectors.join(', ')).toContain(r.decls['font-family']);
    expect(styles).not.toMatch(/(?<!-)font:\s*[^;]*(Gravesend|Helvetica)/);
    expect(styles).not.toMatch(/var\(--metal\)/);
    // Colours are brand.css tokens: no literal colour (comments aside).
    expect(styles.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|:\s*(?:black|white)\b/i);
  });

  it('sets the wordmark, titles, headings and labels in the display face (`n-g`), and what is read in the reading face', () => {
    expect(display(sheet)).toContain('.n-g');
    for (const cls of ["'n-g n-wm'", "'n-g n-t1 legal__title'", "'n-g n-t3 legal__heading'", "'n-g n-lb legal-lang'", "'n-g n-cr legal-foot__meta'", "'n-g n-acct legal-head__verify'", "'n-g n-fl legal-foot__pages'"]) {
      expect(main, cls).toContain(cls);
    }
    // What is read: paragraphs and lists (`.art`, 16/1.65, 34 em at most), the version, the index's summaries, the contact.
    for (const cls of ["'n-art legal__text'", "'n-art legal__list'", "'n-sm n-num legal__version'", "'n-sm n-acc__line legal-index__summary'", "'n-num legal__contact-link'"]) {
      expect(main, cls).toContain(`class: ${cls}`);
    }
    const art = sheet.find((r) => r.selectors.includes('.n-art'))!.decls;
    expect(art).toMatchObject({ 'max-width': '34em', 'font-size': 'var(--n-fs-lead)', 'line-height': 'var(--n-lh-art)' });
    expect(tokens['--n-fs-lead']).toBe('16px');
    expect(tokens['--n-lh-art']).toBe('1.65');
    // A heading's figures (ARTICLE 8) read in --font, after the display rule so they win.
    expect(sheet.find((r) => r.selectors.includes('.legal__figure'))!.decls['font-family']).toBe('var(--font)');
    expect(main).toContain("h('span', { class: 'legal__figure', text: p.text })");
  });

  it('sets French titles and links in the display face too: its subset carries the accented capitals (D-04)', () => {
    // No rule sends a language back to the reading face.
    expect(sheet.filter((r) => r.selectors.some((s) => /:lang\(/.test(s)))).toEqual([]);
    // The capitals of French titles (text-transform: uppercase): À Â Ç É È Ê Ë Î Ï Ô Ù Û Ü Œ Ÿ, and « ».
    const range = /unicode-range:\s*([^;]+);/.exec(brand)![1];
    for (const r of ['U+00AB', 'U+00BB', 'U+00C0-00DD', 'U+0152-0153', 'U+0178']) expect(range).toContain(r);
    // Each language is named in its own: FRANÇAIS carries lang="fr", ENGLISH lang="en".
    expect(main).toContain("attrs: { href: hrefOf(route, l, currentSection()), lang: l, hreflang: l,");
  });
});

describe('legal pages: the floors of §3.8 and the print view', () => {
  it('keeps every link at 9.5 px at least and a 44 px zone', () => {
    for (const r of screen) {
      if (!r.selectors.some((s) => /__link(?![\w-])|n-tl\b|n-acc\b/.test(s) && !s.includes('::'))) continue;
      if (r.decls['font-size']) expect(px(r.decls['font-size']), r.selectors.join(', ')).toBeGreaterThanOrEqual(9.5);
      for (const p of ['height', 'max-height', 'min-height']) if (r.decls[p]) expect(px(r.decls[p]), r.selectors.join(', ')).toBeGreaterThanOrEqual(44);
    }
    // A language's zone: 14.875 px above and below its line of 14.25 (9.5 px, 1.5).
    const lang = sheet.find((r) => r.selectors.includes('.legal-lang__link'))!.decls;
    expect(lang).toMatchObject({ padding: '14.875px 0', margin: '-14.875px 0', 'line-height': 'var(--n-lh-base)' });
    expect(14.875 * 2 + 9.5 * 1.5).toBe(44);
    // A page's tab (`.switch2`): 17 px above its word, 12 under it, its line 15 high (10 px, 1.5).
    expect(sheet.find((r) => r.selectors.includes('.n-switch2__tab') && r.decls.padding)!.decls.padding).toBe('17px 0 12px');
    // The contact's links: an address and a number, each a 44 px zone.
    expect(sheet.find((r) => r.selectors.includes('.legal__contact-link'))?.decls['min-height']).toBe('44px');
    // The pages, the index, VERIFY A PIECE and DB-IP are NOCTURNE's pieces (their zones in shared/nocturne.css).
    expect(main).toContain("class: ['n-g', 'n-switch2__tab', 'legal-nav__link']");
    expect(main).toContain("class: ['legal-lang__link', l === lang ? 'n-ivc n-u' : null]");
    for (const cls of ["'n-acc legal-index__link'", "'n-g n-tl legal-foot__link'", "'n-g n-dbip legal-foot__link'", "'n-fl__link'", "'n-g n-rail__link'"]) expect(main, cls).toContain(`class: ${cls}`);
  });

  it('prints the text alone: no header, rail or navigation, ink on white, the addresses of links outside the site written after them', () => {
    const print = all.filter((r) => r.media === 'print');
    expect(print.length).toBeGreaterThan(3);
    const hidden = print.find((r) => r.decls.display === 'none')?.selectors ?? [];
    expect(hidden).toEqual(expect.arrayContaining(['.n-hd', '.n-rail', '.legal-pages', '.legal-lang', '.legal-foot__pages', '.legal-foot__link']));
    expect(print.find((r) => r.selectors.includes(':root'))?.decls).toMatchObject({ '--vault-ground': 'var(--white)', '--vault-ink': 'var(--ink)', '--vault-soft': 'var(--ink)' });
    expect(print.find((r) => r.selectors.includes('.legal__link[href^="https:"]::after'))?.decls.content).toBe('" (" attr(href) ")"');
    expect(print.find((r) => r.selectors.includes('.legal__heading'))?.decls['break-after']).toBe('avoid');
    expect(styles).toMatch(/@page \{\s*margin: 18mm 16mm;\s*\}/);
  });
});
