/**
 * Verify app against the authentication design system (docs/BRAND-DESIGN-SYSTEM.md
 * §3 and §8): ink token for the scanner ground, a legible customer reference,
 * the SEAL proportions of the favicon, and type set from brand.css tokens.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODE01 } from '../../src/core/code/profile.js';
import { ORBES_CODE_STYLES } from '../../src/core/code/styles.js';
import { computeGenome } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import { genomeRowMarkup } from '../../src/web/verify/genome-view.js';
import { registrationStatus } from '../../src/web/verify/view-model.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../src/web');
const styles = readFileSync(join(WEB, 'verify/styles.css'), 'utf8');
const brand = readFileSync(join(WEB, 'shared/brand.css'), 'utf8');
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

const tokens: Record<string, string> = {};
for (const m of brand.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens[m[1]] = m[2].trim();
const resolve = (v: string): string => v.replace(/var\((--[\w-]+)\)/g, (_, t: string) => tokens[t] ?? t);

describe('verify app: brand deviations (BRAND-DESIGN-SYSTEM §8)', () => {
  it('grounds the scanner in the ink token #0A0A0A, never pure black', () => {
    expect(tokens['--ink']).toBe('#0a0a0a');
    expect(rule(styles, 'body[data-screen="scan"]').background).toBe('var(--ink)');
    expect(rule(styles, '.view--scan').background).toBe('var(--ink)');
    expect(styles).not.toMatch(/#000(000)?\b|\bblack\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\b/i);
  });

  it('draws the GENOME on its ivory plate in the ivory colourway ink (#111111), as it is printed', () => {
    const g = computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 }), 1);
    const markup = genomeRowMarkup({ id: 'O26-J-00184', version: 'GENOME-01', versionNumber: 1, fingerprint: g.fingerprint, glyphs: [...g.glyphs], ids: [...g.ids] });
    expect(markup).not.toBeNull();
    const inks = new Set([...markup!.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== 'none'));
    expect([...inks]).toEqual([ORBES_CODE_STYLES.ivory.ink]);
    expect(rule(styles, '.result__genome').background).toBe('var(--ivory)');
    expect(tokens['--ivory']?.toLowerCase()).toBe(ORBES_CODE_STYLES.ivory.paper.toLowerCase());
  });

  it('sets the customer-quotable reference (VERIFIED · REF) at ≥ 10 px in a readable tone', () => {
    const meta = rule(styles, '.result__meta');
    const px = Number.parseFloat(resolve(meta['font-size']));
    expect(px).toBeGreaterThanOrEqual(10);
    // Not the 8 px .nano utility class, and in --ink-soft (6.7 : 1), not --metal.
    const cls = /class: 'result__meta([^']*)'/.exec(resultView)?.[1] ?? '';
    expect(cls).not.toMatch(/\bnano\b/);
    expect(meta.color ?? 'var(--ink-soft)').toMatch(/--ink-soft|--ink\b/);
  });

  it('draws the favicon in the SEAL proportions: core r 2, gap to 3, ring 3–4', () => {
    const circles = [...favicon.matchAll(/<circle([^>]*)\/>/g)].map((m) => {
      const get = (n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(m[1])?.[1];
      return { r: Number(get('r')), fill: get('fill'), stroke: get('stroke'), width: Number(get('stroke-width') ?? 0) };
    });
    const core = circles.find((c) => c.fill && c.fill !== 'none' && c.fill.toLowerCase() === '#0a0a0a');
    const ring = circles.find((c) => c.stroke && c.fill === 'none');
    expect(core && ring).toBeTruthy();
    const unit = core!.r / CODE01.seal.coreRadius;
    expect((ring!.r - ring!.width / 2) / unit).toBeCloseTo(CODE01.seal.gapOuter, 2);
    expect((ring!.r + ring!.width / 2) / unit).toBeCloseTo(CODE01.seal.ringOuter, 2);
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

  it('sets every fixed font size of both apps from a brand.css token (no off-scale literal sizes)', () => {
    const admin = readFileSync(join(WEB, 'admin/styles.css'), 'utf8');
    const literal = [styles, admin].flatMap((css) => [...css.matchAll(/^\s*font-size:\s*([0-9.]+px)\s*;/gm)].map((m) => m[1]));
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
});

describe('GENOME-01 vocabulary specimen (docs/assets/genome-01-vocabulary.svg)', () => {
  const svg = readFileSync(join(WEB, '../../../docs/assets/genome-01-vocabulary.svg'), 'utf8');
  const colours = new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()));

  it('is printed on brand ivory with brand greys only (ivory colourway ink #111111, --ink-soft)', () => {
    expect(svg).toContain('fill="#f6f2ea"');
    expect([...colours].sort()).toEqual(['#111111', '#5c5c5c', '#f6f2ea']);
  });
});
