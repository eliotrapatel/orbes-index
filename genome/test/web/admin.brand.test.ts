/**
 * GENOME console against the authentication design system
 * (docs/BRAND-DESIGN-SYSTEM.md §3 and §8): readable text never in the
 * decorative --metal grey, one wordmark spec, the single hairline button,
 * identifiers in their true case, the monogram where the brand put it (tab
 * icon, sign-in, sidebar) beside a word ORBES that stays typed, and type set
 * from brand.css tokens.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ORBES_CODE_STYLES } from '../../src/core/code/styles.js';
import { computeGenome } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import { MONOGRAM_PATHS } from '../../src/core/render/monogram.js';
import { BIRTHDAY_CREDIT_LABEL, clubBlockLines } from '../../src/web/admin/model/club.js';
import { dashboardKpis } from '../../src/web/admin/model/dashboard.js';
import { APPLY_CREDIT_TEXT, creditAppliedLine, creditAvailableLine } from '../../src/web/admin/model/orders.js';
import { LIKES_COPY } from '../../src/web/admin/model/likes.js';
import { BIRTHDAY_NOTE } from '../../src/web/admin/model/program.js';
import { SEGMENT_COPY, SEGMENT_GROUP_LABELS, SEGMENT_RULE_LABELS } from '../../src/web/admin/model/segments.js';
import { SIGN_UP_COPY } from '../../src/web/admin/model/sign-up.js';
import { genomeFigureMarkup } from '../../src/web/admin/ui/figures.js';
import type { DashboardData } from '../../src/web/admin/types.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../src/web');
const styles = readFileSync(join(WEB, 'admin/styles.css'), 'utf8');
const brand = readFileSync(join(WEB, 'shared/brand.css'), 'utf8');
const main = readFileSync(join(WEB, 'admin/main.ts'), 'utf8');
const tone = readFileSync(join(WEB, 'admin/model/tone.ts'), 'utf8');
const favicon = readFileSync(join(WEB, 'admin/favicon.svg'), 'utf8');

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

const tokens: Record<string, string> = {};
for (const m of brand.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens[m[1]] = m[2].trim();

/** WCAG relative luminance contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('console: brand deviations (BRAND-DESIGN-SYSTEM §8)', () => {
  it('never sets readable text in the decorative --metal grey (2.8 : 1); --ink-soft reads at ≥ 4.5 : 1', () => {
    expect(styles).not.toMatch(/(^|[;{\s])color:\s*var\(--metal\)/m);
    for (const sel of ['.side__group-title', '.login__foot', '.cinput::placeholder']) expect(rule(styles, sel).color, sel).toBe('var(--ink-soft)');
    expect(rule(styles, '.bar--zero .bar__label,\n.bar--zero .bar__value').color).toBe('var(--ink-soft)');
    expect(contrast(tokens['--ink-soft'], '#ffffff')).toBeGreaterThan(4.5);
    expect(contrast(tokens['--ink-soft'], tokens['--ivory'])).toBeGreaterThan(4.5);
    // The comment in brand.css states the measured ratio.
    expect(contrast(tokens['--ink-soft'], '#ffffff').toFixed(1)).toBe('6.7');
    expect(brand).toMatch(/Secondary text[^\n]*6\.7:1 on white/);
  });

  it('draws the GENOME on its ivory plates in the ivory colourway ink (#111111), as it is printed', () => {
    const g = computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 }), 1);
    const json = { id: 'g', productId: 'p', version: 1, versionLabel: 'GENOME-01', value: g.value, glyphs: [...g.glyphs], ids: [...g.ids], pattern: '', fingerprint: g.fingerprint, createdAt: '2026-01-01T00:00:00.000Z' };
    for (const layout of ['orbit', 'row'] as const) {
      const markup = genomeFigureMarkup(json, layout);
      const inks = new Set([...markup.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== 'none'));
      expect([...inks], layout).toEqual([ORBES_CODE_STYLES.ivory.ink]);
    }
  });

  it('uses the one wordmark spec of brand.css (.wordmark tracking) in the sidebar', () => {
    expect(main).toMatch(/class: \['wordmark', 'side__wordmark'\]/);
    const side = rule(styles, '.side__wordmark');
    expect(side['letter-spacing']).toBeUndefined();
    expect(rule(brand, '.wordmark')['letter-spacing']).toBe('var(--track-wordmark)');
  });

  it('draws the primary console button as the single hairline button (fills only on hover / focus)', () => {
    const primary = rule(styles, '.cbtn--primary');
    expect(primary.background ?? 'transparent').toBe('transparent');
    expect(primary.color ?? 'var(--ink)').toBe('var(--ink)');
    const hover = rule(styles, '.cbtn--primary:hover,\n.cbtn--primary:focus-visible');
    expect(hover).toMatchObject({ background: 'var(--ink)', color: 'var(--white)' });
  });

  it('describes the alert tone as the CSS draws it', () => {
    expect(tone).not.toMatch(/inverted label/);
    expect(tone).toMatch(/alert\s+rotated square \(diamond\) and a bold label/);
    expect(rule(styles, '.status--alert .status__mark').transform).toBe('rotate(45deg)');
    expect(rule(styles, '.status--alert .status__text')['font-weight']).toBe('700');
  });

  it('keeps the case-sensitive key id in its true case on the dashboard', () => {
    expect(rule(styles, '.kpi__note')['text-transform']).toBeUndefined();
    const d = {
      products: { total: 3, byStatus: {} },
      scans: { last24h: 1, last7d: 2 },
      anomalies: { open: 0, openBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } },
      activeKey: { keyId: 1, kid: 'orbes-k001-2026', activatedAt: null },
    } as unknown as DashboardData;
    const notes = dashboardKpis(d).map((k) => k.note);
    expect(notes).toContain('orbes-k001-2026');
    expect(notes.filter((n) => n !== 'orbes-k001-2026').every((n) => n === n.toUpperCase())).toBe(true);
  });

  it('draws the tab icon from the monogram, in ink on ivory with the four corner moons (BRAND §3.5, §3.9)', () => {
    // Generated by scripts/favicons.ts; test/web/monogram.test.ts checks it byte for byte.
    expect([...favicon.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1])).toEqual(MONOGRAM_PATHS);
    expect(favicon).toContain('<g fill="#0a0a0a" transform="matrix(');
    expect(favicon).toContain(`<rect width="32" height="32" fill="${tokens['--ivory'].toLowerCase()}"/>`);
    expect(favicon.match(/<circle [^>]*r="2" fill="#0a0a0a"\/>/g)).toHaveLength(4);
  });

  it('puts the monogram over the typed word on the sign-in screen and in the sidebar, decorative there', () => {
    const login = readFileSync(join(WEB, 'admin/views/login.ts'), 'utf8');
    expect(login).toMatch(/monogramSvg\(\{ class: 'login__monogram', decorative: true \}\),\s*h\('p', \{ class: 'wordmark login__wordmark' \}, 'Orbes'\)/);
    expect(main).toMatch(/monogramSvg\(\{ class: 'side__monogram', decorative: true \}\),\s*h\('span', \{ class: \['wordmark', 'side__wordmark'\] \}, 'Orbes'\)/);
    // The console sizes it; it takes the ink of its context (currentColor): no stylesheet colours it.
    expect(rule(styles, '.login__monogram').width).toBe('72px');
    expect(rule(styles, '.side__monogram').width).toBe('44px');
    for (const sel of ['.login__monogram', '.side__monogram']) expect(Object.keys(rule(styles, sel)), sel).not.toEqual(expect.arrayContaining(['color']));
    expect(Object.keys(rule(brand, '.monogram')).filter((p) => p === 'fill' || p === 'color')).toEqual([]);
  });

  it('draws the Analytics curves as hairlines, CSP-safe, oxblood only for INVALID SIGNATURE (BRAND §6)', () => {
    const charts = readFileSync(join(WEB, 'admin/ui/charts.ts'), 'utf8');
    const view = readFileSync(join(WEB, 'admin/views/analytics.ts'), 'utf8');
    // Built element by element, never from markup; what moves is placed through the CSSOM.
    for (const src of [charts, view]) {
      expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style/);
    }
    expect(charts).toMatch(/style\.setProperty\('--x'/);
    expect(charts).toMatch(/style\.setProperty\('--y'/);
    expect(rule(styles, '.trend__line,\n.spark__line')).toMatchObject({ fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke' });
    expect(rule(styles, '.trend__grid,\n.trend__base,\n.spark__base')).toMatchObject({ stroke: 'var(--hairline)', 'stroke-width': '1' });
    expect(rule(styles, '.spark--critical .spark__line').stroke).toBe('var(--critical)');
    expect(rule(styles, '.spark--muted .spark__line').stroke).toBe('var(--metal)');
    // The axis labels and the cursor's readout are values: Helvetica Neue, never --metal.
    expect(rule(styles, '.trend__ylabel').color).toBe('var(--ink-soft)');
    expect(rule(styles, '.trend__tick').color).toBe('var(--ink-soft)');
    // LAST 30 DAYS: the tab in the display face, its figures in Helvetica Neue.
    expect(styles).toMatch(/\.range__tab,\n\.gen__notes-title,/);
    expect(rule(styles, '.cbtn__figure,\n.range__figure')['font-family']).toBe('var(--font)');
  });

  it('never says atelier, handmade or craft in the copy of Logistics and Supplier orders (plan NEXT LOT §0.8, §3.5.10)', () => {
    // ORBES does not make its pieces: suppliers do. Every view and model of the supply chain, its comments aside.
    const files = ['model', 'views'].flatMap((dir) =>
      readdirSync(join(WEB, 'admin', dir))
        .filter((f) => /^(logistics|shipping|reception|supplier)/.test(f))
        .map((f) => join(WEB, 'admin', dir, f)),
    );
    expect(files.map((f) => f.slice(WEB.length))).toEqual(expect.arrayContaining(['/admin/model/logistics.ts', '/admin/views/logistics.ts', '/admin/model/suppliers.ts', '/admin/views/supplier-orders.ts']));
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
    }
  });

  it('writes the Sign-up page calmly (plan CUSTOMER INTELLIGENCE §3.1 P.10): no atelier, handmade or craft, no exclamation mark', () => {
    for (const f of ['admin/model/sign-up.ts', 'admin/views/sign-up.ts']) {
      const code = readFileSync(join(WEB, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
    }
    const words = JSON.stringify(SIGN_UP_COPY);
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/atelier|handmade|craft|product/i);
  });

  it('writes the Links pages calmly (plan CUSTOMER INTELLIGENCE §3.4 A.10): no atelier, handmade or craft, no exclamation mark, never « product »', () => {
    const files = ['model', 'views'].flatMap((dir) =>
      readdirSync(join(WEB, 'admin', dir))
        .filter((f) => /^link/.test(f))
        .map((f) => join(WEB, 'admin', dir, f)),
    );
    expect(files.map((f) => f.slice(WEB.length))).toEqual(expect.arrayContaining(['/admin/model/links.ts', '/admin/views/links.ts']));
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
      // Every word between quotes: no exclamation mark, never « product » (a piece, a model, a link).
      const words = [...code.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
      expect(words, f).not.toMatch(/!(?!==?)/);
      expect(words, f).not.toMatch(/\bproducts?\b/i);
    }
  });

  it('writes the client sheet\'s Profile, Tags and private notes and Intelligence calmly (plan CUSTOMER INTELLIGENCE §3.6 C.4, §0.7): no atelier, handmade or craft, no exclamation mark, never « product »', () => {
    const files = ['model', 'views'].flatMap((dir) =>
      readdirSync(join(WEB, 'admin', dir))
        .filter((f) => /^(client-profile|client-notes|owner-intelligence|engagement)\./.test(f))
        .map((f) => join(WEB, 'admin', dir, f)),
    );
    // With the Intelligence's engagement score (§3.5 SB.3.6, step 7.5): model/engagement.ts.
    expect(files.map((f) => f.slice(WEB.length))).toEqual(expect.arrayContaining(['/admin/model/client-profile.ts', '/admin/views/client-profile.ts', '/admin/model/client-notes.ts', '/admin/views/client-notes.ts', '/admin/model/owner-intelligence.ts', '/admin/views/owner-intelligence.ts', '/admin/model/engagement.ts']));
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
      const words = [...code.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
      expect(words, f).not.toMatch(/!(?!==?)/);
      expect(words, f).not.toMatch(/\bproducts?\b/i);
    }
  });

  it('writes the Segments builder\'s new criteria calmly (plan CUSTOMER INTELLIGENCE §3.6 C.5.1, §0.7): no atelier, handmade or craft, no exclamation mark, never « product »', () => {
    const files = ['admin/model/segments.ts', 'admin/views/segments.ts'].map((f) => join(WEB, f));
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
      const words = [...code.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
      expect(words, f).not.toMatch(/!(?!==?)/);
      expect(words, f).not.toMatch(/\bproducts?\b/i);
    }
    const said = [...Object.values(SEGMENT_GROUP_LABELS), ...Object.values(SEGMENT_RULE_LABELS), ...Object.values(SEGMENT_COPY)].join('\n');
    expect(said).not.toMatch(/!|atelier|handmade|hand-made|craft|\bproducts?\b/i);
  });

  it('writes the Collectors page\'s What they like calmly (plan CUSTOMER INTELLIGENCE §3.2 W.8, §0.7): no atelier, handmade or craft, no exclamation mark, never « product »', () => {
    const f = join(WEB, 'admin/model/likes.ts');
    const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
    const words = [...code.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
    expect(words, f).not.toMatch(/!(?!==?)/);
    expect(words, f).not.toMatch(/\bproducts?\b/i);
    expect(JSON.stringify(LIKES_COPY)).not.toMatch(/!|atelier|handmade|hand-made|craft|\bproducts?\b/i);
  });

  it('writes the birthday credit calmly in the console (plan CUSTOMER INTELLIGENCE §3.5 SB.4.6, §0.7): no atelier, handmade or craft, no exclamation mark, never « product » nor « gift », no figure in a label', () => {
    const club = { tier: null, careThisYear: null };
    const given = { tier: null, kind: 'BIRTHDAY' as const, birthdayOn: '2027-03-14', grantedAt: '2027-03-13T23:00:00.000Z', amountMinor: 2000, balanceMinor: 2000, currency: 'EUR', expiresAt: '2027-04-12T21:59:59.999Z', gift: null };
    const lines = (['OFF', 'NO_DATE', 'TEST_ENTRANT'] as const).flatMap((state) => clubBlockLines({ ...club, grants: [], birthdayNext: { state } }));
    lines.push(...clubBlockLines({ ...club, grants: [], birthdayNext: { state: 'NEXT', on: '2027-03-14' } }), ...clubBlockLines({ ...club, grants: [given], birthdayNext: { state: 'NEXT', on: '2028-03-14' } }, new Date('2027-03-20T10:00:00.000Z')));
    expect(lines).toHaveLength(5);
    // A label is set in the display face, which takes no figure.
    for (const l of lines) expect(l.label).toBe(BIRTHDAY_CREDIT_LABEL);
    expect(BIRTHDAY_CREDIT_LABEL).not.toMatch(/\d/);
    const credit = {
      available: [{ grantId: 'gb', kind: 'BIRTHDAY' as const, tier: null, balanceMinor: 2000, currency: 'EUR', expiresAt: '2027-04-12T21:59:59.999Z' }],
      applied: [{ id: 'u', grantId: 'gb', kind: 'BIRTHDAY' as const, tier: null, amountMinor: 2000, appliedAt: '2027-03-20T10:00:00.000Z', releasedAt: null, releasedReason: null }],
    };
    const words = [APPLY_CREDIT_TEXT, BIRTHDAY_CREDIT_LABEL, ...lines.map((l) => l.value), creditAvailableLine({ credit }), creditAppliedLine({ credit, currency: 'EUR' }), BIRTHDAY_NOTE].join('\n');
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/atelier|handmade|hand-made|craft|product|gift/i);
    expect(words).toContain('Birthday €\u00a020 until 12 APR 2027');
    expect(words).toContain('\u2212 €\u00a020 (BIRTHDAY)');
    // The words of the two files that say it, their comments aside.
    for (const f of ['admin/model/club.ts', 'admin/model/orders.ts']) {
      const code = readFileSync(join(WEB, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      const said = [...code.matchAll(/'([^'\n]*[Bb]irthday[^'\n]*)'|`([^`\n]*[Bb]irthday[^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
      expect(said.length, f).toBeGreaterThan(0);
      expect(said, f).not.toMatch(/!(?!==?)/);
      expect(said, f).not.toMatch(/atelier|handmade|hand-made|craft|\bproducts?\b|\bgift\b/i);
    }
  });

  it('sets type from brand.css tokens wherever a token has the same value', () => {
    const bySize: Record<string, string> = {};
    const byTrack: Record<string, string> = {};
    for (const [t, v] of Object.entries(tokens)) {
      if (t.startsWith('--fs-')) bySize[v] = t;
      if (t.startsWith('--track-')) byTrack[v] = t;
    }
    const literal: string[] = [];
    for (const m of styles.matchAll(/^\s*(font-size|letter-spacing|text-indent):\s*([^;]+);/gm)) {
      const [, prop, value] = m;
      if (prop === 'font-size' && bySize[value]) literal.push(`${prop}: ${value} → var(${bySize[value]})`);
      if (prop !== 'font-size' && byTrack[value]) literal.push(`${prop}: ${value} → var(${byTrack[value]})`);
    }
    expect(literal).toEqual([]);
  });
});
