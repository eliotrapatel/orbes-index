/**
 * The thresholds of the club's tiers (plan NEXT-NINE, BP-19 T1): TITANE from 1 piece held now, PLATINE from 5,
 * PALLADIUM from 10 (`CLUB_TIER_THRESHOLDS`, a constant of the code), for every account at once.
 *
 *  - No text of the code, the docs or the test fixtures says the old thresholds any more: the old pairings
 *    ('PLATINE — 3', 'PALLADIUM — 5', 'PLATINE from 3', 'PALLADIUM from 5', '1, 3 and 5', 'dès 3', 'PALLADIUM dès 5', and
 *    their like) fail anywhere under genome/src, genome/scripts, docs/ or genome/test/support; the new words ('PLATINE —
 *    5 pieces held', '…open PLATINE, from 5 pieces held') pass. Left out, because they stay as they were shipped or
 *    written: the migrations 0001 to 0024 (0018_club_tiers' header among them), the past runbooks and reports
 *    under docs/launch/ and docs/reports/, and the compliance audit's record of the lots delivered (docs/COMPLIANCE.md).
 *  - The texts that state the thresholds state the constant: TERMS-FACTS R61, terms article 12 in terms.ts (EN, FR)
 *    and in its drafts docs/legal/terms.en.md and terms.fr.md, the note for counsel's item 17, BRAND §4.5, the
 *    console's Tiers lead and the private salon's tier options.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS } from '../../src/server/services/club.js';
import { SALON_TIER_OPTIONS } from '../../src/web/admin/model/lookbook.js';
import { TERMS } from '../../src/web/legal/content/terms.js';

const GENOME = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = resolve(GENOME, '..');
const [T1, T2, T3] = CLUB_TIER_THRESHOLDS as [number, number, number];

/** The old pairings, never followed by a figure (PLATINE from 30 is not PLATINE from 3). */
const OLD_PAIRINGS: readonly string[] = [
  'PLATINE — 3',
  'PALLADIUM — 5',
  'PLATINE from 3',
  'PALLADIUM from 5',
  '1, 3 and 5',
  'dès 3',
  'PALLADIUM dès 5',
  '1, 3 et 5',
  '1, 3, 5 pieces',
  '1, 3 or 5 pieces',
  '1 / 3 / 5',
  'from 3 pieces held',
];
const OLD = OLD_PAIRINGS.map((p) => ({ p, re: new RegExp(`${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\d])`) }));

/**
 * Where the old pairings may stay: the shipped migrations, the past runbooks and reports, and the compliance audit's
 * record of each lot as it was delivered (docs/COMPLIANCE.md §9: P-X04 at deployment A).
 */
const KEPT = [/^genome\/src\/server\/db\/migrations\/00(?:0\d|1\d|2[0-4])_/, /^docs\/launch\//, /^docs\/reports\//, /^docs\/COMPLIANCE\.md$/];
const SCANNED = ['genome/src', 'genome/scripts', 'genome/test/support', 'docs'];
const TEXT = /\.(?:ts|md|css|html|json|txt|sh|ya?ml)$/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (TEXT.test(name)) out.push(path);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The paragraph of `text` that starts with `lead` (a bold lead in the drafts, the start of a string in terms.ts). */
function paragraph(text: string, lead: string): string {
  const at = text.indexOf(lead);
  expect(at, `"${lead}" is not found`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n', at);
  return text.slice(at, end < 0 ? undefined : end);
}

describe('the tiers at 1, 5 and 10 pieces (plan NEXT-NINE, BP-19 T1)', () => {
  it('holds the constant at 1, 5 and 10, one per tier', () => {
    expect([...CLUB_TIER_THRESHOLDS]).toEqual([1, 5, 10]);
    expect(CLUB_TIER_THRESHOLDS).toHaveLength(CLUB_TIER_NAMES.length);
  });

  it('says no old pairing in the code, the docs or the test fixtures, the shipped migrations and past runbooks aside', () => {
    const found: string[] = [];
    for (const dir of SCANNED) {
      for (const path of filesUnder(join(ROOT, dir))) {
        const rel = relative(ROOT, path);
        if (KEPT.some((k) => k.test(rel))) continue;
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const { p, re } of OLD) if (re.test(line)) found.push(`${rel}:${i + 1}: '${p}'`);
          });
      }
    }
    expect(found).toEqual([]);
  });

  it('lets the new words through, and catches the old ones', () => {
    const hit = (line: string) => OLD.some(({ re }) => re.test(line));
    expect(hit('PLATINE — 5 pieces held')).toBe(false);
    expect(hit('3 more pieces registered to your account open PLATINE, from 5 pieces held.')).toBe(false);
    expect(hit('TITANE from 1 piece, PLATINE from 5, PALLADIUM from 10.')).toBe(false);
    expect(hit('PLATINE from 30 minutes')).toBe(false);
    expect(hit('TITANE from 1 piece, PLATINE from 3, PALLADIUM from 5.')).toBe(true);
    expect(hit('TITANE dès 1 pièce, PLATINE dès 3, PALLADIUM dès 5.')).toBe(true);
    expect(hit('PALLADIUM — 5 pieces held')).toBe(true);
  });

  it('states the constant in TERMS-FACTS R61', () => {
    const r61 = read('docs/legal/TERMS-FACTS.md')
      .split('\n')
      .find((l) => l.startsWith('| R61 |'));
    expect(r61).toBeDefined();
    expect(r61).toContain(`TITANE dès ${T1} pièce, PLATINE dès ${T2}, PALLADIUM dès ${T3}.`);
    expect(r61).toContain(`| ${T1}, ${T2} et ${T3} pièces |`);
  });

  it('states the constant in terms article 12, published (terms.ts) and drafted (terms.en.md, terms.fr.md)', () => {
    const en = JSON.stringify(TERMS.en);
    const fr = JSON.stringify(TERMS.fr);
    const thresholdsEn = `TITANE from ${T1} piece, PLATINE from ${T2}, PALLADIUM from ${T3}.`;
    const thresholdsFr = `TITANE dès ${T1} pièce, PLATINE dès ${T2}, PALLADIUM dès ${T3}.`;
    const draftEn = read('docs/legal/terms.en.md');
    const draftFr = read('docs/legal/terms.fr.md');
    for (const [text, lead, words] of [
      [en, '**Tiers and seniority.**', thresholdsEn],
      [draftEn, '**Tiers and seniority.**', thresholdsEn],
      [fr, '**Paliers et ancienneté.**', thresholdsFr],
      [draftFr, '**Paliers et ancienneté.**', thresholdsFr],
    ] as const) {
      expect(paragraph(text, lead)).toContain(words);
    }
    // The early access names PLATINE's threshold.
    expect(paragraph(en, '**Early access.**')).toContain(`(from ${T2} pieces)`);
    expect(paragraph(draftEn, '**Early access.**')).toContain(`(from ${T2} pieces)`);
    expect(paragraph(fr, '**Accès anticipé.**')).toContain(`(dès ${T2} pièces)`);
    expect(paragraph(draftFr, '**Accès anticipé.**')).toContain(`(dès ${T2} pièces)`);
  });

  it('states the constant in the note for counsel (items 15 and 17) and in BRAND §4.5', () => {
    const note = read('docs/legal/counsel-note.fr.md').split('\n');
    const item17 = note.find((l) => l.startsWith('17. '));
    expect(item17).toContain(`Seuls les seuils (${T1}, ${T2} et ${T3} pièces)`);
    // Item 15, the early access, as article 12 states it: PALLADIUM and PLATINE from their thresholds.
    const item15 = note.find((l) => l.startsWith('15. '))!;
    for (const words of [`PALLADIUM (dès ${T3} pièces)`, `PLATINE (dès ${T2} pièces)`, `borné par le seuil de ${T2} pièces`]) expect(item15, words).toContain(words);
    expect(item15).not.toContain('48 heures');
    const brand = read('docs/BRAND-DESIGN-SYSTEM.md');
    const lexicon = brand.slice(brand.indexOf('### 4.5 Lexicon'), brand.indexOf('### 4.6 '));
    expect(paragraph(lexicon, "**The tiers' words**")).toContain(`TITANE from ${T1} piece, PLATINE from ${T2}, PALLADIUM from ${T3}`);
  });

  it('states the constant in the console: the Tiers lead and the private salon\'s tier options', () => {
    expect(read('genome/src/web/admin/views/club.ts')).toContain(`reached with ${T1}, ${T2} and ${T3} pieces held now.`);
    expect(SALON_TIER_OPTIONS.map((o) => o.label)).toEqual([`TITANE — every owner (${T1} piece held)`, `PLATINE — ${T2} pieces held`, `PALLADIUM — ${T3} pieces held`]);
  });
});
