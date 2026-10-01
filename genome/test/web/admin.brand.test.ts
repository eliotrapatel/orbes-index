/**
 * GENOME console against the authentication design system
 * (docs/BRAND-DESIGN-SYSTEM.md §3 and §8): readable text never in the
 * decorative --metal grey, one wordmark spec, the single hairline button,
 * identifiers in their true case, the SEAL proportions of the favicon and
 * type set from brand.css tokens.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODE01 } from '../../src/core/code/profile.js';
import { dashboardKpis } from '../../src/web/admin/model/dashboard.js';
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

  it('draws the favicon in the SEAL proportions: core r 2, gap to 3, ring 3–4', () => {
    const circles = [...favicon.matchAll(/<circle([^>]*)\/>/g)].map((m) => {
      const get = (n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(m[1])?.[1];
      return { r: Number(get('r')), cx: Number(get('cx')), fill: get('fill'), stroke: get('stroke'), width: Number(get('stroke-width') ?? 0) };
    });
    const ring = circles.find((c) => c.stroke && c.fill === 'none')!;
    const core = circles.filter((c) => c.fill?.toLowerCase() === '#0a0a0a' && c.cx === ring.cx).sort((a, b) => b.r - a.r)[0];
    expect(core && ring).toBeTruthy();
    const unit = core.r / CODE01.seal.coreRadius;
    expect((ring.r - ring.width / 2) / unit).toBeCloseTo(CODE01.seal.gapOuter, 2);
    expect((ring.r + ring.width / 2) / unit).toBeCloseTo(CODE01.seal.ringOuter, 2);
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
