/**
 * Verify app against the authentication design system (docs/BRAND-DESIGN-SYSTEM.md
 * §3 and §8): ink token for the scanner ground, a legible customer reference,
 * the monogram where the brand put it (tab icon, landing) beside a word ORBES
 * that stays typed, type set from brand.css tokens, the
 * floors of what is acted on (10 px type, 44 px tap zones; measured in a real
 * page by the E2E suites, test/support/tap-zones.ts), and the shipped display
 * face (Gravesend Sans) on titles and labels of both apps, never on what is
 * read; the copy against the lexicon of §4.5, and the second-hand guidance
 * under AUTHENTIC — REGISTERED (J-02) as §4.3 and §4.4 quote it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODE01 } from '../../src/core/code/profile.js';
import { ORBES_CODE_STYLES } from '../../src/core/code/styles.js';
import { computeGenome, genomeLayout } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import { MONOGRAM_BOUNDS, MONOGRAM_PATHS } from '../../src/core/render/monogram.js';
import { genomeFigureMarkup } from '../../src/web/admin/ui/figures.js';
import * as verifyCopy from '../../src/web/verify/copy.js';
import { RESALE_ACTION, RESALE_GUIDANCE } from '../../src/web/verify/copy.js';
import { GENOME_SCREEN_INK, genomeRowMarkup } from '../../src/web/verify/genome-view.js';
import { registrationStatus } from '../../src/web/verify/view-model.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden, readDoc, section } from '../docs/lexicon.js';
import { parseUnicodeRange, readWoff2, woff2CodePoints, woff2Names, woff2WeightClass } from '../support/woff2.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../src/web');
/**
 * A stylesheet with the sheets it imports from this app or shared/ written in its place (brand.css aside, read on its
 * own): verify/styles.css is the house look (verify/house.css), NOCTURNE's foundation (shared/nocturne.css, which the
 * legal pages import too) and NOCTURNE's screens, in that order of the cascade.
 */
function withImports(file: string): string {
  return readFileSync(join(WEB, file), 'utf8').replace(/^@import "([^"]+)";$/gm, (line, rel: string) =>
    rel.endsWith('/brand.css') ? line : withImports(join(dirname(file), rel)),
  );
}
const styles = withImports('verify/styles.css');
const brand = readFileSync(join(WEB, 'shared/brand.css'), 'utf8');
const adminStyles = readFileSync(join(WEB, 'admin/styles.css'), 'utf8');
const resultView = readFileSync(join(WEB, 'verify/views/result.ts'), 'utf8');
const favicon = readFileSync(join(WEB, 'verify/favicon.svg'), 'utf8');

/** Declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule ${selector}`);
  const out: Record<string, string> = {};
  for (const decl of m[1].split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const G184 = computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 }), 1);
const GENOME_184 = { id: 'O26-J-00184', version: 'GENOME-01', versionNumber: 1, fingerprint: G184.fingerprint, glyphs: [...G184.glyphs], ids: [...G184.ids] };

const tokens: Record<string, string> = {};
for (const m of brand.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens[m[1]] = m[2].trim();
const resolve = (v: string): string => v.replace(/var\((--[\w-]+)\)/g, (_, t: string) => tokens[t] ?? t);

describe('verify app: brand deviations (BRAND-DESIGN-SYSTEM §8)', () => {
  it('grounds the scanner in the ink token #0A0A0A, never pure black', () => {
    expect(tokens['--ink']).toBe('#0a0a0a');
    expect(rule(styles, 'body[data-screen="scan"]').background).toBe('var(--ink)');
    // The scanner (NOCTURNE, C11) stands on the canvas's camera ground, #050505: near the ink, never pure black.
    expect(rule(styles, '.n-cam').background).toBe('var(--n-camera)');
    expect(tokens['--n-camera']).toBe('#050505');
    expect(styles).not.toMatch(/#000(000)?\b|\bblack\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\b/i);
  });

  it('draws the GENOME as it is printed (the ivory colourway ink, #111111) by default and on the shared certificate\'s ivory plate; in ivory on a collector\'s screen (NOCTURNE)', () => {
    for (const layout of ['orbit', 'row'] as const) {
      const markup = genomeRowMarkup(GENOME_184, { layout });
      expect(markup, layout).not.toBeNull();
      const inks = new Set([...markup!.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== 'none'));
      expect([...inks], layout).toEqual([ORBES_CODE_STYLES.ivory.ink]);
    }
    // The shared certificate's écrin (MY PIECES' plate before NOCTURNE) keeps the ivory paper the code is printed on.
    expect(rule(styles, '.piece__plate').background).toBe('var(--ivory)');
    expect(tokens['--ivory']?.toLowerCase()).toBe(ORBES_CODE_STYLES.ivory.paper.toLowerCase());
    // On a collector's screen (a result, a piece, the ceremony): the ink of the ground's text, --vault-ink.
    expect(GENOME_SCREEN_INK).toBe(tokens['--vault-ink']);
    const screen = genomeRowMarkup(GENOME_184, { layout: 'orbit', centre: 'monogram', ink: GENOME_SCREEN_INK })!;
    expect([...new Set([...screen.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== 'none'))]).toEqual([GENOME_SCREEN_INK]);
  });

  it('draws the GENOME of a piece of MY PIECES on the ground, in ivory, as a result does (NOCTURNE, N5: C4); the écrin is the shared certificate\'s alone (F-01)', () => {
    // The écrin keeps its ivory plate and its margins, for the shared certificate (choice 3).
    expect(rule(styles, '.piece__plate')).toMatchObject({ background: 'var(--ivory)', color: 'var(--ink)', padding: '34px 22px 28px', 'text-align': 'center' });
    expect(rule(styles, '.piece__plate .bracket').color).toBe('var(--hairline-strong)');
    // MY PIECES lists the pieces (C3); a piece's page draws its GENOME as a result does, its monogram at the centre (C4).
    const pieces = readFileSync(join(WEB, 'verify/views/pieces.ts'), 'utf8');
    const piece = readFileSync(join(WEB, 'verify/views/piece.ts'), 'utf8');
    expect(pieces).not.toContain('bracket(');
    expect(pieces).not.toContain('genomeBlock(');
    expect(piece).not.toContain('bracket(');
    expect(piece).toContain("nocturneGenome(m.genome, { extraClass: 'n-piece__genome' })");
    expect(rule(styles, '.n-piece__genome')['margin-top']).toBe('48px');
    // Both run the column's width, their photographs to its edges (C3, C4).
    expect(rule(styles, 'body.nocturne .view--pieces.n-pieces,\nbody.nocturne[data-banner] .view--pieces.n-pieces,\nbody.nocturne .view--piece')).toMatchObject({ padding: '0', 'max-width': 'none' });
  });

  it('sets the piece of an ownership certificate in the same écrin, in the column of a result, titled like MY PIECES (F-06)', () => {
    const view = readFileSync(join(WEB, 'verify/views/certificate.ts'), 'utf8');
    expect(view).toContain("{ class: 'piece__plate certificate__plate' }");
    // The shared certificate keeps the GENOME as printed: around the SEAL, on its ivory plate (NOCTURNE, choice 3).
    expect(view).toContain('genomeBlock(s.genome, { titleId, seal: true })');
    expect(view).toContain('bracket(\n');
    // No rule of its own restyles the plate: it is the écrin of MY PIECES as it is.
    expect(rules(styles).filter((r) => r.selectors.some((s) => s.includes('certificate__plate')))).toEqual([]);
    expect(rule(styles, '.view--certificate')['max-width']).toBe('560px');
    expect(rule(styles, '.view--certificate').padding).toBe('calc(60px + var(--safe-top)) 32px calc(64px + var(--safe-bottom))');
    // Its title tracked as MY PIECES' was before NOCTURNE (the page keeps its look, choice 3).
    expect(rule(styles, '.certificate__title')).toMatchObject({ 'font-size': 'var(--fs-title)', 'font-weight': '400', 'letter-spacing': '0.3em', 'text-indent': '0.3em' });
    // One hairline button per screen (§3.8): DOWNLOAD PDF on a valid certificate, SCAN ORBES CODE otherwise.
    expect(view).toContain("class: 'btn certificate__pdf'");
    expect(view).toContain("this.scanButton('textlink')");
    // The link just created on a piece's page sits on the ground (C35): no ivory plate in /verify but CONFIRMED's (C29).
    expect(rules(styles).filter((r) => r.selectors.some((s) => s.includes('certificate-link')))).toEqual([]);
  });

  it('sets the customer-quotable reference (VERIFIED · REF) as the canvas does: its label in ash, its value in ivory in the reading face', () => {
    // C9: VERIFIED and REF are labels (.lb, 9.5 px, ash: 7.8 : 1), each value in ivory (17.7 : 1), never the 8 px .nano.
    expect(resultView).toContain("h('span', { class: 'n-g n-lb n-result__meta-item' }, `${label} `, h('span', { class: 'n-num n-ivc n-result__meta-value', text: value }))");
    expect(resultView).not.toMatch(/\bnano\b/);
    expect(rule(styles, '.n-result__meta-value')).toMatchObject({ 'font-family': 'var(--font)', 'letter-spacing': '0.04em' });
    expect(rule(styles, '.n-lb').color).toBe('var(--vault-soft)');
    expect(rule(styles, '.n-ivc').color).toBe('var(--vault-ink)');
  });

  it('draws the tab icon from the monogram, in ink on a white disc (BRAND §3.5, §3.9)', () => {
    // Generated by scripts/favicons.ts; test/web/monogram.test.ts checks it byte for byte.
    expect([...favicon.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1])).toEqual(MONOGRAM_PATHS);
    expect(favicon).toContain('<g fill="#0a0a0a" transform="matrix(');
    expect(favicon).toContain('<circle cx="16" cy="16" r="15" fill="#ffffff"/>');
  });

  it('sets type from brand.css tokens wherever a token has the same value, in the app and in brand.css itself', () => {
    const bySize: Record<string, string> = {};
    const byTrack: Record<string, string> = {};
    for (const [t, v] of Object.entries(tokens)) {
      if (t.startsWith('--fs-')) bySize[v] = t;
      if (t.startsWith('--track-')) byTrack[v] = t;
    }
    const literal: string[] = [];
    // brand.css sets the shared roles of every app (.wordmark--small on the result, scanner, MY PIECES,
    // certificate and legal headers; .field__input--code), so it is held to the rule it defines.
    for (const [file, css] of Object.entries({ 'verify/styles.css': styles, 'shared/brand.css': brand })) {
      for (const m of css.matchAll(/^\s*(font-size|letter-spacing|text-indent):\s*([^;]+);/gm)) {
        const [, prop, value] = m;
        if (prop === 'font-size' && bySize[value]) literal.push(`${file} ${prop}: ${value} → var(${bySize[value]})`);
        if (prop !== 'font-size' && byTrack[value]) literal.push(`${file} ${prop}: ${value} → var(${byTrack[value]})`);
      }
    }
    expect(literal).toEqual([]);
  });

  it('sets every fixed font size of brand.css and of every app from a brand.css token (no off-scale literal sizes)', () => {
    const sheets = {
      'shared/brand.css': brand,
      'verify/styles.css': styles,
      'admin/styles.css': readFileSync(join(WEB, 'admin/styles.css'), 'utf8'),
      'legal/styles.css': readFileSync(join(WEB, 'legal/styles.css'), 'utf8'),
    };
    const literal = Object.entries(sheets).flatMap(([file, css]) => [...css.matchAll(/^\s*font-size:\s*([0-9.]+px)\s*;/gm)].map((m) => `${file} ${m[1]}`));
    expect(literal).toEqual([]);
  });

  it('uses every type token it defines (no dead tokens)', () => {
    const admin = readFileSync(join(WEB, 'admin/styles.css'), 'utf8');
    for (const t of Object.keys(tokens).filter((k) => k.startsWith('--fs-') || k.startsWith('--track-'))) {
      const used = [brand, styles, admin].some((css) => css.includes(`var(${t})`));
      expect(used, t).toBe(true);
    }
  });
});

describe('verify app: floors of 10 px for what is acted on and 44 px for what is tapped (BRAND-DESIGN-SYSTEM §3.8)', () => {
  const all = [...rules(brand), ...rules(styles)];
  const px = (v: string) => Number.parseFloat(resolve(v));
  /** Every rule that styles `cls` itself, alone or compound, in a descendant selector or a media query (not its ::after rule). */
  const about = (cls: string) => {
    const re = new RegExp(`${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    return all.filter((r) => r.selectors.some((s) => re.test(s) && !s.includes('::')));
  };
  // Whatever the app offers to tap shows a pointer: that is how a control is found.
  const interactive = [...new Set(all.filter((r) => r.decls.cursor === 'pointer').flatMap((r) => r.selectors))].sort();

  /** NOCTURNE's controls (views/nocturne.ts, the chrome, the account sheet), held to the rulebook (build.py). */
  const NOCTURNE_CONTROLS = [
    '.n-acc',
    '.n-account__close',
    '.n-acct',
    '.n-btn',
    '.n-cam__control',
    '.n-chips__option',
    '.n-crumb',
    '.n-dbip',
    '.n-fl__link',
    '.n-foot__club-link',
    '.n-opt2__option',
    '.n-own__link',
    '.n-own__terms-link',
    '.n-rail__link',
    '.n-row',
    '.n-scan__ring',
    '.n-sizes__option',
    '.n-snd',
    '.n-sw__input',
    '.n-switch2__tab',
    '.n-tabs__tab',
    '.n-tabsx__tab',
    '.n-tl',
    '.n-vsel__option',
  ];
  /**
   * The rulebook sets six controls at 9.5 px (build.py: `.acct`, `.rail a`, `.dbip`, `.banner`, n.py's account line, and
   * `.kv .g` on C35's WITHDRAW): the account button, the rail's chapters, DB-IP's attribution, the banner of the LIVE
   * RELEASES, the OWNERSHIP panel's MY PIECES and SIGN OUT, and WITHDRAW in a certificate link's row on a piece's page,
   * validated by the owner on the canvas (who
   * declined larger labels). Their 44 px zones are measured in the page (test/support/tap-zones.ts,
   * test/web/nocturne.styles.e2e.test.ts, test/web/verify.live-announce.e2e.test.ts). The banner keeps the house's rule
   * for a screen out of NOCTURNE; NOCTURNE's size is its `body.nocturne` rule's (RULEBOOK_RULE).
   */
  const RULEBOOK_TYPE: Readonly<Record<string, number>> = { '.n-acct': 9.5, '.n-rail__link': 9.5, '.n-dbip': 9.5, '.live-banner': 9.5, '.n-own__link': 9.5, '.n-piece__withdraw': 9.5 };
  // MY PIECES and SIGN OUT take the account line's label size (.lb, n.py account_line(): C14).
  const RULEBOOK_RULE: Readonly<Record<string, string>> = { '.live-banner': 'body.nocturne .live-banner', '.n-own__link': '.n-lb' };
  const legacy = interactive.filter((sel) => !sel.startsWith('.n-'));

  it('finds every control of the app by its pointer', () => {
    expect(legacy).toEqual(['.auth__option', '.btn', '.tabs__tab', '.textlink']);
    expect(interactive.filter((sel) => sel.startsWith('.n-'))).toEqual(NOCTURNE_CONTROLS);
  });

  it('sets NOCTURNE\'s controls at 10 px at least, but the four the rulebook sets at 9.5 px; their zones are measured in the page', () => {
    for (const sel of NOCTURNE_CONTROLS) {
      for (const r of about(sel)) {
        const where = `${sel} (${r.selectors.join(', ')})`;
        if (r.decls['font-size']) expect(px(r.decls['font-size']), where).toBeGreaterThanOrEqual(RULEBOOK_TYPE[sel] ?? 10);
      }
    }
    for (const [sel, size] of Object.entries(RULEBOOK_TYPE)) expect(px(all.find((r) => r.selectors.includes(RULEBOOK_RULE[sel] ?? sel))!.decls['font-size']!), sel).toBe(size);
  });

  it('sets no interactive selector under 10 px of type nor under a 44 px minimum height', () => {
    for (const sel of [...legacy, '.field__input']) {
      const base = all.find((r) => r.selectors.includes(sel));
      expect(base?.decls['font-size'], sel).toBeDefined();
      expect(base?.decls['min-height'], sel).toBeDefined();
      // No variant, state, descendant or media rule takes either below its floor.
      for (const r of about(sel)) {
        const where = `${sel} (${r.selectors.join(', ')})`;
        if (r.decls['font-size']) expect(px(r.decls['font-size']), where).toBeGreaterThanOrEqual(10);
        for (const p of ['min-height', 'height', 'max-height']) if (r.decls[p]) expect(px(r.decls[p]), where).toBeGreaterThanOrEqual(44);
      }
    }
    // The scanner's LIGHT and zoom (C11): 44 px high; the zoom shows two characters, its zone at least as wide.
    expect(px(rule(styles, '.n-cam__control').height)).toBe(44);
    expect(px(rule(styles, '.n-cam__zoom')['min-width'])).toBeGreaterThanOrEqual(44);
  });

  it('lets no class the views put on a button or a link take it under either floor', () => {
    // Every class written on an h('button') or h('a') of the verify views (the control classes and those beside
    // them: .scan__zoom, .scan__close, .landing__upload, .contact__email…), so a rule that names the element by
    // its modifier alone is held to the same floors.
    const sources = readdirSync(join(WEB, 'verify/views')).map((f) => readFileSync(join(WEB, 'verify/views', f), 'utf8'));
    const classes = [
      ...new Set(sources.flatMap((src) => [...src.matchAll(/h\(\s*'(?:button|a)',\s*\{\s*class:\s*'([^']+)'/g)].flatMap((m) => m[1].split(/\s+/)))),
    ].sort();
    expect(classes).toEqual(
      expect.arrayContaining(['auth__option', 'btn', 'btn--block', 'contact__email', 'landing__scan', 'landing__upload', 'n-cam__close', 'n-cam__light', 'n-cam__zoom', 'textlink']),
    );
    for (const cls of classes) {
      for (const r of about(`.${cls}`)) {
        const where = `.${cls} (${r.selectors.join(', ')})`;
        if (r.decls['font-size']) expect(px(r.decls['font-size']), where).toBeGreaterThanOrEqual(RULEBOOK_TYPE[`.${cls}`] ?? 10);
        for (const p of ['min-height', 'height', 'max-height']) if (r.decls[p]) expect(px(r.decls[p]), where).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('draws the keyboard focus ring where it was before the tap zones grew, never around the transparent padding', () => {
    // Each control whose zone is transparent padding drops the page's outline and draws its ring with ::before,
    // inset to its former box (plus the outline offset it had), so the ring stays clear of the tab dots and of the
    // switch beside a sign-in option.
    const RINGS: Record<string, string> = {
      '.textlink': '0 -4px',
      '.tabs__tab': '1px calc(var(--tab-pad) - 2px) -2px',
      '.auth__option': '4px -4px',
    };
    for (const [sel, inset] of Object.entries(RINGS)) {
      const ring = all.filter((r) => r.selectors.includes(`${sel}:focus-visible::before`));
      expect(ring.at(-1)?.decls.inset, sel).toBe(inset);
    }
    for (const sel of ['.textlink', '.tabs__tab', '.auth__option']) {
      expect(all.some((r) => r.selectors.includes(`${sel}:focus-visible`) && r.decls.outline === 'none'), sel).toBe(true);
      const ring = all.find((r) => r.selectors.includes(`${sel}:focus-visible::before`))!;
      expect(ring.decls, sel).toMatchObject({ content: '""', position: 'absolute', outline: '1px solid currentColor', 'pointer-events': 'none' });
      // No rule gives the control itself an outline offset any more (it would draw around the zone).
      expect(about(sel).filter((r) => r.selectors.some((s) => s.includes(':focus-visible')) && r.decls['outline-offset'] !== undefined), sel).toEqual([]);
    }
  });

  it('keeps the hairline button for the foot of a result: ORBES Client Services is WRITE TO ORBES CLIENT SERVICES, a hairline button, and the email under FORGOTTEN PASSWORD? a link', () => {
    // A result draws one button of its own, the foot's SCAN AGAIN or SCAN ANOTHER, a hairline button (C9, C15, C16);
    // under the help line or in the WARRANTY tab, WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01) is the same
    // hairline button, never the ivory one (views/write.ts writeButton: `outline: true`).
    const buttons = (f: string) => (readFileSync(join(WEB, 'verify', f), 'utf8').match(/\bbutton\(/g) ?? []).length;
    expect(['views/result.ts', 'views/panels.ts', 'views/tabs.ts'].map(buttons)).toEqual([1, 0, 0]);
    expect(resultView).toContain("button(vm.tone === 'authentic' ? 'SCAN ANOTHER' : 'SCAN AGAIN', { outline: true,");
    expect(resultView).toContain("vm.write?.placement === 'help' ? writeButton(vm.write.context) : null");
    expect(readFileSync(join(WEB, 'verify/views/panels.ts'), 'utf8')).toContain("vm.write?.placement === 'warranty' ? writeButton(vm.write.context) : null");
    const write = readFileSync(join(WEB, 'verify/views/write.ts'), 'utf8');
    expect(write).toContain("button(MESSAGES.write, { outline: true, onClick: open,");
    const pieces = readFileSync(join(WEB, 'verify/views/nocturne.ts'), 'utf8');
    expect(pieces).toContain("h('a', { class: 'n-g n-contact__email', attrs: { href: c.mailto }, text: labels.action })");
    // Its 44 px zone is padding given back upward: the email stands where the canvas sets it.
    expect(rule(styles, '.n-contact__email')).toMatchObject({ 'margin-top': '-28.25px', 'padding-top': '28.25px' });
    // WHERE DID YOU SEE OR BUY THIS PIECE? (under the contact): its answers pressed two by two (.opt2), SEND ANSWER a
    // hairline button (C15), never the ivory one.
    const report = readFileSync(join(WEB, 'verify/views/report.ts'), 'utf8');
    expect(buttons('views/report.ts')).toBe(1);
    expect(report).toContain("class: 'n-g n-opt2__option n-report__channel'");
    expect(report).toContain('button(REPORT.send, { outline: true, type: \'submit\'');
  });

  it('draws text links at 80 % ink at rest (11 : 1 on white), no longer 62 %', () => {
    expect(Number(rule(brand, '.textlink').opacity)).toBeGreaterThanOrEqual(0.8);
  });

  it('sets the field labels and the lines that carry a fact at 10 px, leaving 8 px to decoration', () => {
    expect(px(rule(brand, '.field__label')['font-size'])).toBeGreaterThanOrEqual(10);
    expect(px(rule(styles, '.genome__meta')['font-size'])).toBeGreaterThanOrEqual(10);
    // The views set these lines with the 10 px .micro class: the closing time of registration, the
    // transfer code's labels and validity, the signed-in account, the GENOME fingerprint.
    const views = ['views/ownership.ts', 'views/pieces.ts', 'views/piece.ts', 'views/certificate.ts', 'views/now.ts', 'views/scanning.ts', 'views/result.ts', 'views/message.ts', 'views/panels.ts', 'views/tabs.ts', 'genome-view.ts', 'main.ts'];
    const classes = views.flatMap((f) => [...readFileSync(join(WEB, 'verify', f), 'utf8').matchAll(/class: '([^']+)'/g)].map((m) => m[1]));
    // (A piece's page sets its certificate link's line as the canvas does, a label: C35.)
    for (const line of ['ownership__meta', 'certificate__footnote', 'ownership__who', 'genome__meta']) {
      const set = classes.filter((c) => c.split(' ').includes(line) && !c.split(' ').includes('prose'));
      expect(set.length, line).toBeGreaterThan(0);
      for (const c of set) expect(c.split(' '), c).toContain('micro');
    }
    // The OWNERSHIP panel of a result (NOCTURNE, C9, C14, C37) sets these lines as the canvas does: labels (.lb).
    const ownership = readFileSync(join(WEB, 'verify/views/ownership.ts'), 'utf8');
    expect(ownership).toContain("class: ['n-g', 'n-lb', 'n-num', ivory ? 'n-ivc' : null, 'n-own__until']");
    expect(ownership).toContain("class: 'n-g n-lb n-own__code-label', text: 'TRANSFER CODE'");
    expect(ownership).toContain("class: 'n-g n-lb n-own__account'");
    // The 8 px .nano class is left to decoration: no view sets it now (the landing's © ORBES · GENOME CODE · PARIS
    // gave way to NOCTURNE's footer, whose © ORBES · PARIS is 9 px, in ash).
    expect(classes.filter((c) => c.split(' ').includes('nano'))).toEqual([]);
  });
});

/** Every innermost rule of a stylesheet (inside @media too): its selectors and declarations. */
function rules(css: string): { selectors: string[]; decls: Record<string, string> }[] {
  const out: { selectors: string[]; decls: Record<string, string> }[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) decls[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
    out.push({ selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
  }
  return out;
}

/** Selectors set in the display face (font-family: var(--font-display)). */
const displaySelectors = (css: string): string[] => rules(css).filter((r) => r.decls['font-family'] === 'var(--font-display)').flatMap((r) => r.selectors);

const FONT_FILE = join(WEB, 'shared/fonts/gravesend-sans-500.woff2');

describe('display face: Gravesend Sans for the wordmark, titles and labels (BRAND-DESIGN-SYSTEM §3.1, §8 item 18)', () => {
  const face = rules(brand).find((r) => r.selectors[0] === '@font-face')!.decls;
  const font = readWoff2(readFileSync(FONT_FILE));

  it('declares the shipped WOFF2 in @font-face: Gravesend Sans, weight 500, font-display swap', () => {
    expect(face['font-family']).toBe('"Gravesend Sans"');
    expect(face.src).toBe('url("./fonts/gravesend-sans-500.woff2") format("woff2")');
    expect(existsSync(join(WEB, 'shared', 'fonts', 'gravesend-sans-500.woff2'))).toBe(true);
    expect(face['font-display']).toBe('swap');
    expect(face['font-style']).toBe('normal');
    // The one cut supplied: Medium. The declared weight is the file's own.
    expect(face['font-weight']).toBe('500');
    expect(woff2WeightClass(font)).toBe(500);
    expect(rules(brand).filter((r) => r.selectors[0] === '@font-face')).toHaveLength(1);
  });

  it('keeps Helvetica Neue for reading and puts Gravesend first in --font-display, then the same stack', () => {
    const families = (v: string) => resolve(v).split(',').map((f) => f.trim());
    // --font is the stack of theorbes.com (index.html), unchanged: reading text, values and inputs.
    expect(tokens['--font']).toBe('"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif');
    expect(families(tokens['--font-display'])).toEqual(['"Gravesend Sans"', ...families(tokens['--font'])]);
    expect(families(tokens['--font-display']).at(-1)).toBe('sans-serif');
    // The page default reads; the display face is opted into, role by role.
    expect(rules(brand).find((r) => r.selectors.includes('body'))?.decls['font-family']).toBe('var(--font)');
  });

  it('ships exactly the declared subset (Basic Latin, the accented capitals of French, the brand punctuation), with its licence names', () => {
    expect(font.flavor).toBe('OTTO');
    const declared = parseUnicodeRange(face['unicode-range']);
    expect([...woff2CodePoints(font)].sort((a, b) => a - b)).toEqual([...declared].sort((a, b) => a - b));
    for (let c = 0x20; c <= 0x7e; c++) expect(declared.has(c), `U+${c.toString(16)}`).toBe(true);
    // The punctuation the interfaces set in titles and labels: · — – … × → ’ © (copy.ts, views).
    for (const ch of '·—–…×→’©') expect(declared.has(ch.codePointAt(0)!), ch).toBe(true);
    // The capitals of French titles set in capitals (the legal pages, J-06): CONFIDENTIALITÉ, FRANÇAIS, « ».
    for (const ch of 'ÀÂÆÇÉÈÊËÎÏÔÙÛÜŒŸ«»') expect(declared.has(ch.codePointAt(0)!), ch).toBe(true);
    // The copyright and designer names travel with the file (NOTICE.md).
    const names = woff2Names(font);
    expect(names.get(0)).toMatch(/Rian Hughes \/ Device/);
    expect(names.get(16) ?? names.get(1)).toBe('Gravesend Sans');
    // A preload on the critical path: kept small.
    expect(readFileSync(FONT_FILE).length).toBeLessThan(16 * 1024);
  });

  const BRAND_DISPLAY = ['.wordmark', '.btn', '.textlink', '.field__label'];
  const VERIFY_DISPLAY = ['.n-g', '.certificate__title', '.certificate__state', '.certificate__footnote', '.genome__label', '.tabs__tab', '.rows__label', '.section-label', '.ownership__status', '.auth__option', '.live__surprise', '.question__label', '.question__release', '.question__text'];
  const ADMIN_DISPLAY = ['.side__group-title', '.side__link', '.page-head__eyebrow', '.page-head__title', '.panel__title', '.kpi__label', '.deflist__label', '.table th', '.cbtn', '.cfield__label', '.login__title'];
  // What is read, quoted or compared stays in --font: sentences, values, identifiers, codes, inputs,
  // and the lines that can carry a figure (Gravesend's one is its capital I).
  const VERIFY_READ = ['.prose', '.field__input', '.field__input--code', '.field__hint', '.photos__note', '.genome__id', '.genome__meta', '.lines__line', '.rows__value', '.certificate__lead', '.certificate__note', '.certificate-link__value', '.certificate-link__label', '.n-cam__zoom', '.n-own__code', '.n-own__email', '.n-gen__fp', '.n-result__meta-value', '.form__error', '.ownership__meta', '.ownership__who', '.ownership__email', '.pieces__benefit', '.n-tx', '.n-sm', '.n-lead', '.n-art', '.n-cd__value', '.n-fld__input', '.pieces__order-step-date', '.pieces__order-care-text', '.question__note'];
  const ADMIN_READ = ['.mono', '.status', '.kpi__value', '.kpi__note', '.bar__label', '.deflist__value', '.table', '.cinput', '.sheet__id', '.sheet__plain', '.gen__identity-id', '.claim__code', '.enrol__code', '.enrol__step', '.timeline__move', '.pager__range', '.pager__page', '.topbar__clock', '.topbar__crumb', '.panel__note', '.dialog__eyebrow', '.dialog__title', '.cfield__phrase', '.page-head__title--id', '.side__who', '.side__role'];

  it('sets the wordmark, titles and tracked-capital labels of both apps in the display face', () => {
    expect(displaySelectors(brand)).toEqual(BRAND_DISPLAY);
    expect(displaySelectors(styles)).toEqual(expect.arrayContaining(VERIFY_DISPLAY));
    expect(displaySelectors(adminStyles)).toEqual(expect.arrayContaining(ADMIN_DISPLAY));
  });

  it('never sets what is read in the display face', () => {
    const display = new Set([...displaySelectors(brand), ...displaySelectors(styles), ...displaySelectors(adminStyles)]);
    for (const s of [...VERIFY_READ, ...ADMIN_READ]) expect(display.has(s), s).toBe(false);
    // Gravesend has proportional figures only and one weight: a display role never asks for
    // tabular numerals, nor for a bold the browser would have to fake.
    for (const css of [brand, styles, adminStyles]) {
      for (const r of rules(css)) {
        if (!r.selectors.some((s) => display.has(s))) continue;
        expect(r.decls['font-variant-numeric'] ?? '', r.selectors.join(', ')).not.toMatch(/tabular-nums/);
        expect(Number(r.decls['font-weight'] ?? 400), r.selectors.join(', ')).toBeLessThan(600);
      }
    }
  });

  it('sets a figure in the reading face where a display role may show one (Gravesend\'s one is its capital I)', () => {
    // The overrides come after the display rule of their stylesheet, so they win at equal specificity.
    for (const [css, selector] of [[styles, '.n-cam__zoom'], [adminStyles, '.page-head__title--id'], [adminStyles, '.cfield__phrase']] as const) {
      const all = rules(css);
      const at = all.findIndex((r) => r.selectors.includes(selector));
      expect(all[at]?.decls['font-family'], selector).toBe('var(--font)');
      expect(at, selector).toBeGreaterThan(all.findIndex((r) => r.decls['font-family'] === 'var(--font-display)'));
    }
    // The zoom control (1×, 2×) and every console page titled with a product id use them (the phone of ORBES Client
    // Services, which did too, is no longer shown in the collector app: plan NEXT-NINE, CS-01).
    expect(readFileSync(join(WEB, 'verify/views/scanning.ts'), 'utf8')).toContain("class: 'n-num n-cam__control n-cam__zoom'");
    expect(readFileSync(join(WEB, 'verify/views/common.ts'), 'utf8')).not.toContain('contact__phone');
    for (const view of ['product', 'generator']) {
      const src = readFileSync(join(WEB, `admin/views/${view}.ts`), 'utf8');
      const titled = (src.match(/title: p\.productId,/g) ?? []).length;
      expect(titled, view).toBeGreaterThan(0);
      expect((src.match(/title: p\.productId,\n\s*identifier: true,/g) ?? []).length, view).toBe(titled);
    }
    // A dialog's eyebrow names the product, key or anomaly it acts on, so it has no display rule at all;
    // the phrase to type in a confirmation (REVOKE O26-J-00184) is a --font span inside its label;
    // and no field label is written with a figure (its range or example goes in the hint, read in --font).
    expect(rules(adminStyles).some((r) => r.selectors.includes('.dialog__eyebrow') && r.decls['font-family'] !== undefined)).toBe(false);
    // (The phrase may depend on the fields, a ticked box that revokes a code: the span is filled as they change.)
    const dialogSrc = readFileSync(join(WEB, 'admin/ui/dialog.ts'), 'utf8');
    expect(dialogSrc).toContain("const phraseText = h('span', { class: 'cfield__phrase' });");
    expect(dialogSrc).toContain("h('span', null, 'Type ', phraseText, ' to confirm')");
    expect(dialogSrc).toContain("phraseText.textContent = p ?? '';");
    for (const view of readdirSync(join(WEB, 'admin/views'))) {
      const src = readFileSync(join(WEB, 'admin/views', view), 'utf8');
      const labels = [...src.matchAll(/\blabel: '([^']*)'/g), ...src.matchAll(/\bfield\('([^']*)'/g)].map((m) => m[1]);
      for (const l of labels) expect(/[0-9]/.test(l) && !/^(Payload SHA-256|Public key \(base64url\))$/.test(l), `${view}: ${l}`).toBe(false);
    }
  });

  it('names fonts only through the tokens (--font, --font-display, the console --mono)', () => {
    for (const [name, css] of [['brand.css', brand], ['verify', styles], ['admin', adminStyles]] as const) {
      const families = rules(css)
        .filter((r) => r.selectors[0] !== '@font-face')
        .map((r) => r.decls['font-family'])
        .filter((v): v is string => v !== undefined);
      for (const v of families) expect(['var(--font)', 'var(--font-display)', 'var(--mono)'], `${name}: ${v}`).toContain(v);
      expect(css, name).not.toMatch(/(?<!-)font:\s*[^;]*(Gravesend|Helvetica)/);
    }
  });
});

describe('verify app: the monogram beside the word ORBES (BRAND-DESIGN-SYSTEM §3.9, §8 item 1)', () => {
  const shell = readFileSync(join(WEB, 'verify/views/shell.ts'), 'utf8');

  it('sets the monogram beside the typed wordmark of the header (NOW replaced the landing, N3), decorative there', () => {
    // The header: ORBES typed at its left; the account button's monogram at its right, decorative (its name is the
    // button's: "Your account, TITANE", decision 11); the footer's names ORBES.
    expect(shell).toContain("h('header', { class: 'n-hd' }, h('span', { class: 'n-g n-wm', text: 'ORBES' }), this.account, this.signIn)");
    expect(shell).toMatch(/this\.accountText,\s*monogram\(28\),/);
    const pieces = readFileSync(join(WEB, 'verify/views/nocturne.ts'), 'utf8');
    expect(pieces).toContain("return monogramSvg({ class: `n-mono n-mono--${px}${opts.extraClass ? ` ${opts.extraClass}` : ''}`, decorative: !opts.label, artboard: true });");
    expect(pieces).toContain('monogram(38, { label: true })');
    // brand.css draws it as a block that keeps the ratio of its ink box.
    expect(rule(brand, '.monogram')).toMatchObject({ display: 'block', height: 'auto', 'aspect-ratio': `${MONOGRAM_BOUNDS.w} / ${MONOGRAM_BOUNDS.h}` });
    // NOW draws no emblem of its own: the landing's monogram over its word left with it.
    expect(existsSync(join(WEB, 'verify/views/landing.ts'))).toBe(false);
    expect(readFileSync(join(WEB, 'verify/views/now.ts'), 'utf8')).not.toMatch(/monogramSvg|monogram\(/);
  });

  it('keeps the word ORBES typed, in the display face, wherever it was: the emblem never replaces it', () => {
    // The scanner, VERIFYING… and a problem of the scan type it in their own header (cameraHeader, C11, C17); a result
    // has NOCTURNE's header (views/shell.ts), its ORBES typed.
    expect(readFileSync(join(WEB, 'verify/views/scanning.ts'), 'utf8')).toMatch(/class: 'n-g n-wm n-cam__wordmark'[^)]*text: 'ORBES'/);
    for (const file of ['views/verifying.ts', 'views/message.ts']) expect(readFileSync(join(WEB, 'verify', file), 'utf8'), file).toContain('cameraHeader()');
    expect(displaySelectors(brand)).toContain('.wordmark');
    // The result and the scanner keep the word alone: they draw no emblem of their own (NOCTURNE's header sets the
    // monogram beside its typed ORBES, decision 11, and the GENOME's orbit holds it at its centre, decision 12).
    for (const file of ['views/result.ts', 'views/scanning.ts', 'views/verifying.ts', 'views/message.ts']) expect(readFileSync(join(WEB, 'verify', file), 'utf8'), file).not.toMatch(/monogramSvg|monogram\(/);
    expect(shell).toContain("h('span', { class: 'n-g n-wm', text: 'ORBES' })");
  });
});

describe('verify app: the GENOME in its orbit, as on the piece (BRAND-DESIGN-SYSTEM §2.3, §2.6)', () => {
  it('draws the result GENOME in the orbit layout, the figure of the console and of the code, the ORBES monogram at its centre on a collector\'s screen (decision 12)', () => {
    const view = readFileSync(join(WEB, 'verify/genome-view.ts'), 'utf8');
    const block = view.slice(view.indexOf('export function genomeBlock'));
    // A collector's screen: the monogram's centre, in ivory, with its glow; the shared certificate (`seal`): as printed.
    expect(block).toContain("opts.seal ? genomeRow(m, { layout: 'orbit' }) : genomeRow(m, { layout: 'orbit', centre: 'monogram', ink: GENOME_SCREEN_INK })");
    expect(block).toContain("if (figure && !opts.seal) figure.classList.add('n-glow');");
    expect(rule(styles, '.n-glow').filter).toBe('var(--n-glow)');
    expect(tokens['--n-glow']).toBe('drop-shadow(0 0 18px rgba(246, 242, 234, 0.22))');
    // The same core renderer, the same ink and the same geometry as the console's product page, by default.
    const json = { id: 'g', productId: GENOME_184.id, version: 1, versionLabel: 'GENOME-01', value: G184.value, glyphs: [...G184.glyphs], ids: [...G184.ids], pattern: '', fingerprint: G184.fingerprint, createdAt: '2026-01-01T00:00:00.000Z' };
    expect(genomeRowMarkup(GENOME_184, { layout: 'orbit' })).toBe(genomeFigureMarkup(json, 'orbit'));
    // The seal at the centre, then one group per glyph (glyph 0 at north, clockwise: genomeLayout).
    const markup = genomeRowMarkup(GENOME_184, { layout: 'orbit' })!;
    expect(markup.match(/data-layer="seal"/g)).toHaveLength(1);
    expect(markup.match(/data-layer="genome"/g)).toHaveLength(CODE01.genome.count);
    // On a collector's screen: the monogram's five master outlines in place of the seal, the same glyphs.
    const screen = genomeRowMarkup(GENOME_184, { layout: 'orbit', centre: 'monogram', ink: GENOME_SCREEN_INK })!;
    expect(screen).not.toContain('data-layer="seal"');
    expect(screen.match(/data-layer="monogram"/g)).toHaveLength(1);
    expect(screen.match(/data-layer="genome"/g)).toHaveLength(CODE01.genome.count);
    expect(screen.slice(screen.indexOf('data-layer="monogram"')).match(/<path /g)!.length).toBeGreaterThanOrEqual(MONOGRAM_PATHS.length);
    // Every screen that draws a piece's GENOME uses the block: a result and its ceremony, a piece's page (C4); the certificate keeps the seal.
    expect(resultView).toContain('nocturneGenome(vm.genome, { size: ceremony ? 220 : 200, extraClass: \'n-result__genome\' })');
    const nocturneBlock = view.slice(view.indexOf('export function nocturneGenome'));
    expect(nocturneBlock).toContain("genomeRow(m, { layout: 'orbit', centre: 'monogram', ink: GENOME_SCREEN_INK })");
    expect(nocturneBlock).toContain("figure.classList.add('n-glow')");
    expect(readFileSync(join(WEB, 'verify/views/piece.ts'), 'utf8')).toContain("nocturneGenome(m.genome, { extraClass: 'n-piece__genome' })");
  });

  it('sizes the orbit as a centred square of min(64vw, 260px): glyphs of about 43 px, never under the 12 px floor', () => {
    const orbit = rule(styles, '.genome-svg--orbit');
    expect(orbit.width).toBe('min(64vw, 260px)');
    expect(orbit['aspect-ratio']).toBe('1');
    expect(orbit.margin).toBe('0 auto');
    const { viewBox, glyphRadius } = genomeLayout(G184, 'orbit');
    expect(viewBox.w).toBe(viewBox.h);
    const glyphPx = (side: number) => (side * 2 * glyphRadius) / viewBox.w;
    expect(glyphPx(260)).toBeCloseTo(43, 0);
    // 390 px phone: 64vw = 249.6 px; the smallest phone in use (320 px) still draws 34 px glyphs.
    expect(glyphPx(0.64 * 390)).toBeGreaterThan(41);
    expect(glyphPx(0.64 * 320)).toBeGreaterThan(12);
    // A result's (NOCTURNE, C9): a 200 px square (220 px in the ceremony, C36), glyphs of about 33 px; 48 px under the
    // message, as the canvas sets it.
    expect(rule(styles, '.n-gen__figure')).toMatchObject({ width: '200px', height: '200px' });
    expect(rule(styles, '.n-gen__figure--220')).toMatchObject({ width: '220px', height: '220px' });
    expect(rule(styles, '.n-gen__figure .genome-svg')).toMatchObject({ width: '100%', height: '100%' });
    expect(glyphPx(200)).toBeGreaterThan(12);
    expect(rule(styles, '.n-result__genome')['margin-top']).toBe('48px');
  });
});

describe('verify app: the photographs of an authentic piece (F-04)', () => {
  const pieceView = readFileSync(join(WEB, 'verify/views/piece.ts'), 'utf8');
  const piecesView = readFileSync(join(WEB, 'verify/views/pieces.ts'), 'utf8');

  it('sets THE MODEL\'s photograph under the GENOME of a result, full width, whole, without the fade, captioned (C9, decision 9)', () => {
    const at = (needle: string) => resultView.indexOf(needle);
    // The GENOME first, then the photograph (C9), the ceremony's GENOME too (C36).
    expect(at('sections.push(genome, modelPhoto(vm.photos));')).toBeGreaterThan(at('nocturneGenome(vm.genome'));
    expect(resultView).toContain("fadedPhoto(photo.src, photo.alt, { fade: false, eager: true, extraClass: 'n-result__photo' })");
    expect(resultView).toContain("h('span', { class: 'n-g n-lb n-result__caption', text: photo.caption })");
    expect(resultView).toContain("h('p', { class: 'n-px n-sm n-result__photo-note', text: PHOTOS.note(1) })");
    // Shown whole (contain), never cropped; 48 px under the GENOME, as the GENOME under the message.
    expect(rule(styles, '.n-ph--contain > img')['object-fit']).toBe('contain');
    expect(rule(styles, '.n-result__model')['margin-top']).toBe(rule(styles, '.n-result__genome')['margin-top']);
    // The ivory plate of photographs is gone with MY PIECES' (N5): no ivory plate in /verify but CONFIRMED's (C29).
    expect(rules(styles).filter((r) => r.selectors.some((s) => /\.photos?__|\.result__photos/.test(s)))).toEqual([]);
  });

  it('sets the same photograph on a piece\'s page (C4), right under its crumb, captioned THE MODEL; MY PIECES and its orders show it whole and faded (C3, C24; additions 3 and decision 9)', () => {
    expect(pieceView).toContain("modelPhoto(m.photos, { extraClass: 'n-piece__photo' })");
    expect(rule(styles, '.n-piece__photo')['margin-top']).toBe('0');
    // The list and the orders: the model's photograph (never the piece's own), faded into the ground, the words lifted.
    expect(piecesView).toContain('const photo = m.photos[0];');
    expect(piecesView).toContain('fadedPhoto(photo.src, photo.alt, { eager: index < 2 })');
    expect(piecesView).toContain('fadedPhoto(m.photo.src, m.photo.alt)');
    expect(piecesView).not.toContain('photoUrl');
    expect(pieceView).not.toContain('photoUrl');
  });

  it('never shows a broken image: a photograph that cannot be loaded takes its place with it', () => {
    expect(resultView).toContain("frame.querySelector('img')?.addEventListener('error', () => (section.hidden = true), { once: true });");
    expect(piecesView.match(/querySelector\('img'\)\?\.addEventListener\('error'/g)).toHaveLength(2);
  });
});

describe('verify app: one button to ORBES Client Services, the email under FORGOTTEN PASSWORD? alone (plan NEXT-NINE, CS-01)', () => {
  /** Every source file of the collector app (src/web/verify), with its path. */
  const sources = (dir = join(WEB, 'verify')): { file: string; text: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return /\.(ts|css|html)$/.test(e.name) ? [{ file: path.slice(WEB.length + 1), text: readFileSync(path, 'utf8') }] : [];
    });
  const all = sources();
  const code = all.filter((s) => s.file.endsWith('.ts'));

  it('reads every file of the app', () => {
    expect(all.map((s) => s.file)).toEqual(expect.arrayContaining(['verify/view-model.ts', 'verify/views/write.ts', 'verify/messages-model.ts', 'verify/styles.css', 'verify/house.css']));
  });

  it('has no tel: link and no phoneHref anywhere under src/web/verify', () => {
    for (const s of all) {
      expect(s.text, s.file).not.toMatch(/tel:/);
      expect(s.text, s.file).not.toMatch(/phoneHref/);
    }
  });

  it('builds a mailto: in contactOf alone, which recoveryContactModel alone calls', () => {
    const builders = code.filter((s) => /mailto:\$\{|`mailto:|'mailto:/.test(s.text)).map((s) => s.file);
    expect(builders).toEqual(['verify/view-model.ts']);
    const vm = code.find((s) => s.file === 'verify/view-model.ts')!.text;
    // The template that builds it sits in contactOf.
    const at = vm.indexOf('`mailto:');
    expect(vm.lastIndexOf('function contactOf(', at)).toBeGreaterThan(vm.lastIndexOf('\nfunction ', at - 1) - 1);
    expect(vm.slice(vm.lastIndexOf('function ', at), at)).toMatch(/^function contactOf\(/);
    // contactOf is called once, from recoveryContactModel; nothing else in the app calls it.
    const calls = [...vm.matchAll(/contactOf\(/g)].map((m) => m.index!);
    expect(calls).toHaveLength(2);
    expect(vm.slice(vm.lastIndexOf('export function ', calls[1]), calls[1])).toMatch(/^export function recoveryContactModel\(/);
    for (const s of code.filter((x) => x.file !== 'verify/view-model.ts')) expect(s.text, s.file).not.toMatch(/\bcontactOf\(/);
  });

  it('renders no opening hours in the collector app: no hours field, line or style', () => {
    for (const s of all) {
      expect(s.text, s.file).not.toMatch(/contact__hours|\b(?:c|cs|lines|contact|clientServices|services)\.hours\b/);
    }
  });

  it('writes MESSAGES calmly: no exclamation mark and no word of §4.5', () => {
    const words = JSON.stringify(verifyCopy.MESSAGES);
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });

  it('writes the tier program\'s words calmly (YEARLY_CARE, TIER, CLUB_PAGE; plan NEXT-NINE BP-19): no exclamation mark and no word of §4.5', () => {
    const said = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => unknown)('PLATINE', 1, 2026))] : v && typeof v === 'object' ? Object.values(v).flatMap(said) : [];
    for (const group of ['YEARLY_CARE', 'TIER', 'CLUB_PAGE'] as const) {
      const words = said(verifyCopy[group]).join('\n');
      expect(words.length, group).toBeGreaterThan(50);
      expect(words, group).not.toContain('!');
      expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN]), group).toEqual([]);
    }
  });

  it('writes THE HOUSE’S GUARANTEE calmly (plan NEXT-NINE, IN-01): no exclamation mark, no word of §4.5, a place and never authenticity', () => {
    const said = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => unknown)('MONOLITHE', 2))] : v && typeof v === 'object' ? Object.values(v).flatMap(said) : [];
    const words = said(verifyCopy.GUARANTEE).join('\n');
    expect(words.length).toBeGreaterThan(200);
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    // The house's guarantee names a place in a release (BRAND §4.5): never what a piece is.
    expect(words).not.toMatch(/authentic|genuine|real\b|certif/i);
  });
});

describe('verify app: the lexicon of BRAND-DESIGN-SYSTEM §4.5, and the second-hand guidance (J-02)', () => {
  /** The sentences and labels under `root`: nested functions are called with stand-in values. */
  const linesOf = (root: unknown): string[] => {
    const out: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') out.push(v);
      else if (typeof v === 'function') {
        const r: unknown = (v as (...args: unknown[]) => unknown)('O26-J-00184', 'RING');
        if (typeof r === 'string') out.push(r);
      } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(root);
    return out;
  };
  /** Every sentence and label of the verify app's copy (copy.ts). */
  const copyLines = (): string[] =>
    // The module's own functions (camera and API classifiers) return kinds, not copy.
    Object.values(verifyCopy).flatMap((v) => (typeof v === 'function' ? [] : linesOf(v)));
  const terms = [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN];

  it('writes no word of §4.5 (nor "product", §4.1) anywhere in the copy; "genuine" only where the footnote says what a code cannot prove', () => {
    const lines = copyLines();
    expect(lines.length).toBeGreaterThan(100);
    expect(lines).toContain(RESALE_GUIDANCE);
    expect(lines).toContain(RESALE_ACTION);
    // MY PIECES is the owner's own page (F-01): it names the owner's own declaration in their words, LOST or STOLEN
    // (§4.5, LOST and STOLEN in MY PIECES), and no other word of the table.
    const ownPage = new Set(linesOf(verifyCopy.PIECES));
    expect(ownPage.size).toBeGreaterThan(20);
    expect(findForbidden([...ownPage].join('\n'), terms.filter((t) => t !== 'STOLEN'))).toEqual([]);
    // §4.5 forbids GENUINE as a verdict: the footnote's one use is the limitation itself (§4.6).
    expect(findForbidden(lines.filter((l) => l !== verifyCopy.ASSURANCE_NOTE && !ownPage.has(l)).join('\n'), terms)).toEqual([]);
    expect(findForbidden(verifyCopy.ASSURANCE_NOTE, terms)).toEqual([expect.stringContaining('"GENUINE"')]);
    expect(verifyCopy.ASSURANCE_NOTE).toMatch(/cannot prove that an object is genuine/);
    expect(lines.join('\n')).not.toContain('!');
  });

  it('asks a buyer for the seller\'s transfer code in one calm sentence, quoted in BRAND §4.3, its link in §4.3 and §4.4', () => {
    // A request, never an accusation: it names the transfer code, the seller's ORBES account and the registered owner.
    expect(RESALE_GUIDANCE).toMatch(/^Buying this piece\? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one\.$/);
    const doc = readDoc('docs/BRAND-DESIGN-SYSTEM.md');
    expect(section(doc, '### 4.3')).toContain(`| ${RESALE_GUIDANCE} · Then **${RESALE_ACTION}**`);
    expect(section(doc, '### 4.4')).toMatch(new RegExp(`^\\| Owned by someone else, reached from the second-hand guidance.*\\| ${RESALE_ACTION},`, 'm'));
    expect(section(doc, '### 4.4')).toContain('RECEIVING THIS PIECE');
  });

  it('puts the sentence in the result\'s notice and its link under it, a text link (the hairline button stays the foot\'s)', () => {
    const at = (needle: string) => resultView.indexOf(needle);
    // C13: the sentence in ivory, then I HAVE A TRANSFER CODE, a text link (.tl) 16 px under it.
    expect(at("class: 'n-tx n-ivc n-result__notice'")).toBeGreaterThan(0);
    expect(at("textLink(vm.noticeLink.label, { onOpen: () => openNoticeLink(vm.noticeLink!.tab), extraClass: 'n-result__notice-link' })")).toBeGreaterThan(at("class: 'n-tx n-ivc n-result__notice'"));
    expect(rule(styles, '.n-result__notice-line')['margin-top']).toBe('16px');
    expect(rules(styles).filter((r) => r.selectors.includes('.n-result__notice-link'))).toEqual([]);
    // RECEIVING THIS PIECE, where it leads, is a heading focused on purpose: no ring (§3.8).
    const ownershipView = readFileSync(join(WEB, 'verify/views/ownership.ts'), 'utf8');
    expect(ownershipView).toContain('this.heading(RECEIVING.title, RECEIVING_ID)');
    expect(verifyCopy.RECEIVING.title).toBe('RECEIVING THIS PIECE');
    expect(styles).toMatch(/\.n-own__heading\[tabindex="-1"\]:focus/);
  });
});

describe('verify app: the ceremony of a first registration (P-D01)', () => {
  const ownershipView = readFileSync(join(WEB, 'verify/views/ownership.ts'), 'utf8');
  const mainSrc = readFileSync(join(WEB, 'verify/main.ts'), 'utf8');
  const shareSrc = readFileSync(join(WEB, 'verify/share-image.ts'), 'utf8');

  it('is asked for by VIEW AS OWNER after a first registration only, through retryVerify to the result', () => {
    const block = ownershipView.slice(ownershipView.indexOf('private confirmationBlock'), ownershipView.indexOf('private accountLine'));
    expect(block).toContain("const ceremony = c.via === 'register';");
    expect(block).toContain("this.action('VIEW AS OWNER', () => refresh({ ceremony }),");
    expect(mainSrc).toContain('onRefresh: (opts) => void this.retryVerify(input, opts?.ceremony === true)');
    expect(mainSrc).toContain('await this.verify(input, gen, ceremony);');
    expect(mainSrc).toContain('resultViewModel(outcome, { offsetMinutes: -new Date().getTimezoneOffset(), clientServices, receivedAt, ceremony })');
    // TRY AGAIN after a connection problem keeps it; the result, once on screen, is told so (its vibration).
    expect(mainSrc).toContain('void this.retryVerify(this.lastInput, this.lastCeremony)');
    expect(mainSrc).toMatch(/this\.live = view;\n\s*view\.shown\(\);/);
  });

  it('reveals the glyphs group by group (layer genome, --i set through the CSSOM), then the names, unless motion is reduced', () => {
    expect(resultView).toContain(".genome-svg g[data-layer=\"genome\"]').forEach((g, i) => g.style.setProperty('--i', String(i)))");
    expect(resultView).toMatch(/if \(!prefersReducedMotion\(\)\) \{\n\s*\/\/[^\n]*\n\s*root\.classList\.add\('is-ceremony'\);/);
    const glyph = rule(styles, '.is-ceremony .n-gen .genome-svg g[data-layer="genome"]');
    expect(glyph).toMatchObject({ 'transform-box': 'fill-box', 'transform-origin': 'center', animation: 'ceremony-glyph 0.7s var(--ease) both' });
    expect(glyph['animation-delay']).toContain('var(--i, 0)');
    expect(styles).toMatch(/@keyframes ceremony-glyph \{\s*from \{ opacity: 0; transform: scale\(0\.55\); \}/);
    // The names rise after the eighth glyph has appeared (0.9 s + 7 × 0.16 s, then its 0.7 s).
    const names = rules(styles).find((r) => r.selectors.includes('.is-ceremony .n-ceremony__name'))!.decls;
    expect(names.animation).toBe('brand-rise 1.2s var(--ease) both');
    expect(Number.parseFloat(names['animation-delay'])).toBeGreaterThanOrEqual(0.9 + 7 * 0.16);
    // With reduced motion the class is never set, and the stylesheet stops the animations as well.
    const reduced = styles.slice(styles.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.is-ceremony \.n-gen \.genome-svg g\[data-layer="genome"\],[\s\S]*?\{\s*animation: none;/);
    // A vibration where the device has one, as the names rise (or at once without motion).
    expect(resultView).toContain('navigator.vibrate?.([...CEREMONY_VIBRATION])');
    expect(resultView).toContain("names.addEventListener('animationstart', vibration, { once: true })");
  });

  it('offers SHARE THE GENOME as a text link, its image prepared before the tap by a module imported statically', () => {
    expect(verifyCopy.CEREMONY.share).toBe('SHARE THE GENOME');
    expect(resultView).toContain("textLink(CEREMONY.share, { onOpen: () => void (image && shareGenomeImage(image)), extraClass: 'n-ceremony__share' })");
    expect(resultView).toContain("import { prepareShareImage, shareGenomeImage } from '../share-image.js';");
    // One bundle (verify.build.test.ts): no dynamic import anywhere in the app.
    for (const src of [resultView, mainSrc, shareSrc]) expect(src).not.toMatch(/\bimport\(/);
    // Drawn when the result is built; the tap only hands the ready file over.
    const block = resultView.slice(resultView.indexOf('function ceremonyBlock'), resultView.indexOf('export function resultView'));
    expect(block.indexOf('void prepareShareImage(')).toBeGreaterThan(0);
    expect(rule(styles, '.n-ceremony__share-line[hidden]').display).toBe('none');
    // navigator.share({ files }) when navigator.canShare accepts it, else saveDownload; Path2D from genomeLayout.
    expect(shareSrc).toContain("nav.canShare(data)");
    expect(shareSrc).toContain("import { saveDownload } from '../shared/download.js';");
    expect(shareSrc).toContain('new Path2D(primitiveToPathData(p))');
    // As the result draws it: the ORBES monogram at the orbit's centre (NOCTURNE, decision 12).
    expect(shareSrc).toContain("genomeLayout(genome, 'orbit', { centre: 'monogram' })");
    expect(shareSrc).toContain('for (const d of monogram ?? []) ctx.fill(new Path2D(d));');
    // The names in the display face, their figures in the reading face.
    expect(resultView).toContain("h('p', { class: 'n-g n-t1 n-ceremony__name' }, ...withNumerals(c.name))");
  });
});

describe('verify app: the scan as a ritual (P-D10)', () => {
  const scanningSrc = readFileSync(join(WEB, 'verify/views/scanning.ts'), 'utf8');
  const verifyingSrc = readFileSync(join(WEB, 'verify/views/verifying.ts'), 'utf8');
  const scannerSrc = readFileSync(join(WEB, 'verify/scanner.ts'), 'utf8');
  const mainSrc = readFileSync(join(WEB, 'verify/main.ts'), 'utf8');
  const decls = (selector: string): Record<string, string> => {
    const found = rules(styles).find((r) => r.selectors.includes(selector));
    if (!found) throw new Error(`no rule ${selector}`);
    return found.decls;
  };
  const reduced = styles.slice(styles.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

  it('raises onSeal from the decoder replies that carry a seal, through SealSignal, outside the decoding', () => {
    expect(scannerSrc).toContain('onSeal?(confidence: number): void;');
    expect(scannerSrc).toContain('private readonly seals = new SealSignal();');
    expect(scannerSrc).toContain('this.seals.reset();');
    // In the reply branch of a failed decode, after the hint: nothing added to the frame pump or the worker.
    const reply = scannerSrc.slice(scannerSrc.indexOf('this.hints.push(failure);'), scannerSrc.indexOf('.catch((e: unknown)'));
    expect(reply).toContain('this.seals.offer(performance.now(), failure)');
    expect(reply).toContain('this.callbacks.onSeal?.(seal)');
    for (const file of ['verify/frame-decoder.ts', 'verify/worker.ts']) expect(readFileSync(join(WEB, file), 'utf8'), file).not.toMatch(/SealSignal|onSeal/);
    // The page passes it to the scanner's view, for the scan on show only.
    expect(mainSrc).toContain('onSeal: (confidence) => gen === this.generation && view.setSeal(confidence),');
  });

  it('draws three states of the orbit: the sweep, the ring tightened around the centre, the lock (C11, C12, C38)', () => {
    // Searching: the sweep, once the camera streams; the ring 1 px at 80 % (C11), half lit before (C38, PREPARING).
    expect(decls('.n-cam.is-ready .n-cam__sweep').opacity).toBe('1');
    expect(decls('.n-cam__ring')['box-shadow']).toBe('0 0 0 1px rgba(246, 242, 234, 0.5)');
    expect(decls('.n-cam.is-ready .n-cam__ring')['box-shadow']).toBe('0 0 0 1px rgba(246, 242, 234, 0.8)');
    // The orbit as C11 sets it: 272 px, its veil 50 %.
    expect(decls('.n-cam')['--orbit']).toBe('min(272px, 32.23svh)');
    expect(decls('.n-cam__aperture')['box-shadow']).toBe('0 0 0 200vmax rgba(5, 5, 5, 0.5)');
    // Seal seen: the ring scaled about the orbit's centre, heavier with its light (C38), breathing; the sweep gone.
    expect(decls('.n-cam__ring').transition).toContain('transform');
    expect(decls('.n-cam.is-sealed .n-cam__ring')).toMatchObject({
      transform: 'scale(var(--seal-scale, 0.92))',
      'box-shadow': '0 0 0 1.5px rgba(246, 242, 234, 0.9), 0 0 30px rgba(246, 242, 234, 0.2)',
      animation: 'n-cam-breathe 0.8s var(--ease) infinite alternate',
    });
    expect(decls('.n-cam.is-sealed .n-cam__sweep').opacity).toBe('0');
    expect(decls('.n-cam.is-locked .n-cam__sweep').opacity).toBe('0');
    // Its scale set through the CSSOM (no inline style attribute is written), held SEAL_HOLD_MS, then the search.
    expect(scanningSrc).toContain("root.style.setProperty('--seal-scale', String(scale));");
    expect(scanningSrc).toContain("root.classList.add('is-sealed');");
    expect(scanningSrc).toContain('sealTimer = setTimeout(loosen, SEAL_HOLD_MS);');
    expect(scanningSrc).toContain("import { SEAL_HOLD_MS, sealScale } from '../capture.js';");
    // Locked (C12): the veil darker (78 %), the ring 2 px, the moons heavier, the frame frozen and darker, the controls fainter.
    expect(decls('.n-cam.is-locked .n-cam__aperture')['box-shadow']).toBe('0 0 0 200vmax rgba(5, 5, 5, 0.78)');
    expect(decls('.n-cam.is-locked .n-cam__ring')).toMatchObject({ transform: 'none', 'box-shadow': '0 0 0 2px rgba(246, 242, 234, 0.95)', animation: 'none' });
    expect(decls('.n-cam.is-locked .n-cam__moon')).toMatchObject({ width: '12px', height: '12px' });
    expect(decls('.n-cam.is-locked .n-cam__video').filter).toBe('brightness(0.55)');
    expect(decls('.n-cam.is-locked .n-cam__controls').opacity).toBe('0.6');
    expect(scanningSrc).toMatch(/if \(locked\) loosen\(\);\n\s*root\.classList\.toggle\('is-locked', locked\);/);
    expect(scanningSrc).toContain("still.getContext('2d')?.drawImage(video, 0, 0);");
    // The scan's controls and screen stay as they were (test/e2e/fallbacks.test.ts measures them).
    expect(scanningSrc).toContain('textLink(ACTION_LABELS.upload,');
    expect(scanningSrc).toContain("text: 'LIGHT'");
    expect(scanningSrc).toContain("text: 'CLOSE'");
    expect(mainSrc).toContain("if (!(await this.swap(view.root, 'scan'))) return;");
  });

  it('takes the orbit up on VERIFYING…, with no transition between screens', () => {
    // The photo path's VERIFYING… is the scanner's orbit, locked, its arc travelling (C12's look, without the camera).
    expect(verifyingSrc).toContain("root.classList.add('n-cam', 'n-cam--still', 'is-ready', 'is-locked', 'is-verifying');");
    expect(verifyingSrc).toContain('cameraOrbit().orbit');
    expect(verifyingSrc).not.toMatch(/loader|getBoundingClientRect|animate\(/);
    expect(decls('.n-cam--still.is-locked .n-cam__sweep')).toMatchObject({ opacity: '1', 'animation-duration': '2.4s' });
    // One status line, 8 px under the scanner's, a title (C12).
    expect(decls('.n-cam.is-verifying .n-cam__status').top).toBe('calc(67.77% + 8px)');
    expect(styles).not.toMatch(/\.loader/);
    // The GENOME then opens from its centre on the result (P-D10): a circle widening over it, the name and duration only.
    expect(decls('.n-result:not(.is-leaving) .n-result__genome')).toEqual({ animation: 'genome-open 1.4s var(--ease) both' });
    expect(styles).toMatch(/@keyframes genome-open \{\s*from \{ opacity: 0; clip-path: circle\(0% at 50% 50%\); \}\s*to \{ opacity: 1; clip-path: circle\(75% at 50% 50%\); \}/);
    // No FLIP: nothing measures one screen to animate the next.
    expect(mainSrc).not.toMatch(/\bFLIP\b|\.animate\(/);
  });

  it('respects reduced motion: the seal seen only steadies the ring, the arc stands still', () => {
    expect(reduced).toMatch(/\.n-cam\.is-sealed \.n-cam__ring \{\s*transform: none;\s*animation: none;\s*\}/);
    expect(reduced).toMatch(/\.n-cam__sweep \{\s*animation: none;/);
    expect(reduced).toMatch(/\.n-result:not\(\.is-leaving\) \.n-result__genome \{\s*animation: none;\s*\}/);
  });
});

describe('verify app: OWNERSHIP heading follows the registration window', () => {
  const now = Date.parse('2026-10-01T08:30:00.000Z');
  it('says REGISTRATION OPEN only while the scan token is valid', () => {
    expect(registrationStatus('2026-10-01T08:45:00.000Z', now)).toBe('REGISTRATION OPEN');
    expect(registrationStatus('2026-10-01T08:30:00.000Z', now)).toBe('REGISTRATION CLOSED');
    expect(registrationStatus('garbage', now)).toBe('REGISTRATION CLOSED');
  });

  it('builds the heading of the register block from it', () => {
    const src = readFileSync(join(WEB, 'verify/views/ownership.ts'), 'utf8');
    const block = src.slice(src.indexOf('private registerBlock'), src.indexOf('private yoursBlock'));
    expect(block).toContain('registrationStatus(');
    expect(block).not.toMatch(/this\.status\('REGISTRATION OPEN'\)/);
  });

  it('offers RECEIVE THIS PIECE only within the transfer window of the scan, and sends the code for this piece with it (F-03)', () => {
    const src = readFileSync(join(WEB, 'verify/views/ownership.ts'), 'utf8');
    const block = src.slice(src.indexOf('private registeredBlock'), src.indexOf('private confirmationBlock'));
    expect(block).toContain('registrationOpen(t.expiresAt, this.now())');
    expect(block).toContain('RECEIVING.until(');
    expect(block).toContain('this.transferForm(m.productId, t)');
    // The window is the scan's account's: another account signed in on the result is offered VERIFY AGAIN instead.
    expect(block).toContain('this.windowAccount === s.account.email ? m.transfer : undefined');
    const form = src.slice(src.indexOf('private transferForm'), src.indexOf('// ── Actions'));
    expect(form).toContain('registrationOpen(scan.expiresAt, this.now())');
    expect(form).toContain('this.deps.api.acceptTransfer(code.value, productId, scan.token)');
  });
});

describe('GENOME-01 vocabulary specimen (docs/assets/genome-01-vocabulary.svg)', () => {
  const svg = readFileSync(join(WEB, '../../../docs/assets/genome-01-vocabulary.svg'), 'utf8');
  const colours = new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()));

  it('is printed on brand ivory with brand greys only (ivory colourway ink #111111, --ink-soft)', () => {
    expect(svg).toContain('fill="#f6f2ea"');
    expect([...colours].sort()).toEqual(['#111111', '#5c5c5c', '#f6f2ea']);
  });
});
