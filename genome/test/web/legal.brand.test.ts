/**
 * The legal pages (J-06, src/web/legal/) against the authentication design
 * system (docs/BRAND-DESIGN-SYSTEM.md §3): the shell of the other apps (CSP
 * safe, the display font preloaded, the tab icon of /verify, the monogram
 * nowhere else, D-06), type from brand.css tokens only, the display face on
 * the wordmark, titles and labels and never on what is read, French titles
 * and links in the reading face (the display face has no accented capital),
 * figures of a heading in the reading face, the floors of §3.8 on every
 * text link, no readable text in --metal, and a print view.
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
const screen = all.filter((r) => r.media === null || !/print/.test(r.media));
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
  });

  it('shows the tab icon of /verify, the public app (D-06), and the monogram nowhere on the page', () => {
    const icons = renderFavicons();
    expect(icons.find((i) => i.app === 'legal')!.svg).toBe(icons.find((i) => i.app === 'verify')!.svg);
    expect(read('legal/favicon.svg')).toBe(read('verify/favicon.svg'));
    expect(shell).toContain('<link rel="icon" href="./favicon.svg" type="image/svg+xml">');
    expect(main).not.toContain('monogram');
    // The word ORBES stays typed, in the wordmark's one spec.
    expect(main).toContain("h('span', { class: 'wordmark wordmark--small legal-head__wordmark', text: 'ORBES' })");
  });
});

describe('legal pages: type and colour from brand.css (BRAND-DESIGN-SYSTEM §3.1, §3.2)', () => {
  it('imports the brand foundation and sets every font size from a token', () => {
    expect(styles).toMatch(/^@import "\.\.\/shared\/brand\.css";$/m);
    const sizes = all.map((r) => r.decls['font-size']).filter((v): v is string => v !== undefined);
    expect(sizes.length).toBeGreaterThan(5);
    for (const v of sizes) expect(v, v).toMatch(/^var\(--fs-[a-z-]+\)$/);
    for (const v of sizes) expect(tokens[v.slice(4, -1)], v).toBeDefined();
  });

  it('sets tracking from tokens wherever a token has the same value', () => {
    const byTrack = Object.fromEntries(Object.entries(tokens).filter(([t]) => t.startsWith('--track-')).map(([t, v]) => [v, t]));
    const literal = all.flatMap((r) => ['letter-spacing', 'text-indent'].map((p) => r.decls[p]).filter((v): v is string => v !== undefined && byTrack[v] !== undefined));
    expect(literal).toEqual([]);
  });

  it('names fonts only through the tokens, and never sets readable text in the decorative --metal', () => {
    for (const r of all) if (r.decls['font-family']) expect(['var(--font)', 'var(--font-display)'], r.selectors.join(', ')).toContain(r.decls['font-family']);
    expect(styles).not.toMatch(/(?<!-)font:\s*[^;]*(Gravesend|Helvetica)/);
    expect(styles).not.toMatch(/var\(--metal\)/);
    // Colours are brand.css tokens: no literal colour (comments aside).
    expect(styles.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|:\s*(?:black|white)\b/i);
  });

  it('sets the wordmark, titles, headings and labels in the display face, and what is read in the reading face', () => {
    expect(display(all)).toEqual(expect.arrayContaining(['.legal__title', '.legal__heading', '.legal-lang__dot', '.legal-foot__meta']));
    // brand.css sets the wordmark and the text links (the navigation, the index, the foot).
    expect(display(rules(brand))).toEqual(expect.arrayContaining(['.wordmark', '.textlink']));
    for (const read of ['.legal__text', '.legal__list', '.legal__item', '.legal__version', '.legal__link', '.legal__contact-link', '.legal__contact-hours', '.legal-index__summary']) {
      expect(display(all), read).not.toContain(read);
    }
    // A heading's figures (ARTICLE 8) read in --font, after the display rule so they win.
    const at = (sel: string) => all.findIndex((r) => r.selectors.includes(sel));
    expect(all[at('.legal__figure')].decls['font-family']).toBe('var(--font)');
    expect(main).toContain("h('span', { class: 'legal__figure', text: p.text })");
  });

  it('sets French titles and links in the reading face, after the display rule: the display face has no accented capital', () => {
    const french = all.find((r) => r.selectors.includes('.legal__title:lang(fr)'));
    expect(french?.selectors).toEqual(['.legal__title:lang(fr)', '.legal__heading:lang(fr)', '.textlink:lang(fr)']);
    expect(french?.decls['font-family']).toBe('var(--font)');
    expect(all.indexOf(french!)).toBeGreaterThan(all.findIndex((r) => r.selectors.includes('.legal__title') && r.decls['font-family'] === 'var(--font-display)'));
    // The subset the brand ships is Basic Latin and its punctuation: no É, no Ç.
    const range = /unicode-range:\s*([^;]+);/.exec(brand)![1];
    expect(range).not.toMatch(/U\+00C[0-9A-F]|U\+00E/);
    // Each language is named in its own: FRANÇAIS carries lang="fr", ENGLISH lang="en".
    expect(main).toContain("attrs: { href: hrefOf(route, l, hash), lang: l, hreflang: l,");
  });
});

describe('legal pages: the floors of §3.8 and the print view', () => {
  it('keeps every text link at 10 px and a 44 px zone, the shortest word widened to 44 px', () => {
    for (const r of screen) {
      if (!r.selectors.some((s) => /textlink|__link(?![\w-])/.test(s))) continue;
      if (r.decls['font-size']) expect(px(r.decls['font-size']), r.selectors.join(', ')).toBeGreaterThanOrEqual(10);
      for (const p of ['height', 'max-height', 'min-height']) if (r.decls[p]) expect(px(r.decls[p]), r.selectors.join(', ')).toBeGreaterThanOrEqual(44);
    }
    for (const sel of ['.legal-nav__link', '.legal-lang__link']) {
      expect(all.find((r) => r.selectors.includes(sel))?.decls['min-width'], sel).toBe('44px');
    }
    // The contact's links: an address and a number, each a 44 px zone.
    expect(all.find((r) => r.selectors.includes('.legal__contact-link'))?.decls['min-height']).toBe('44px');
    // The navigation, the index and the foot are text links of brand.css.
    for (const cls of ['textlink legal-index__link', 'textlink legal-foot__link']) expect(main).toContain(`class: '${cls}'`);
    expect(main).toContain("class: ['textlink', 'legal-nav__link'");
    expect(main).toContain("class: ['textlink', 'legal-lang__link'");
  });

  it('prints the text alone: no navigation, no grain, the addresses of links outside the site written after them', () => {
    const print = all.filter((r) => r.media === 'print');
    expect(print.length).toBeGreaterThan(3);
    const hidden = print.find((r) => r.decls.display === 'none')?.selectors ?? [];
    expect(hidden).toEqual(expect.arrayContaining(['.grain', '.legal-nav', '.legal-lang', '.legal-foot__link']));
    expect(print.find((r) => r.selectors.includes('.legal__link[href^="https:"]::after'))?.decls.content).toBe('" (" attr(href) ")"');
    expect(print.find((r) => r.selectors.includes('.legal__heading'))?.decls['break-after']).toBe('avoid');
    expect(styles).toMatch(/@page \{\s*margin: 18mm 16mm;\s*\}/);
  });
});
