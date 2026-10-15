/**
 * The ORBES CARE conditions as printed (plan ORBES CARE of 2026-10-15, answer 14, step 1.9; render/care-conditions.ts):
 * article 11 of the terms in force, in English then in French, given with every order. A4 pages on the invoice's grid,
 * black on white, the house's lettering (no font, no text object), the monogram on the first; its title, VERSION and
 * ORDER; each article's title and every paragraph whole and in order across the pages, each page with its foot and
 * PAGE n OF m; no character the lettering would drop; no forbidden word (the BRAND lexicon, never "atelier"); refused
 * for an order reference it cannot print; deterministic.
 */
import { describe, expect, it } from 'vitest';
import { CertificateInputError } from '../../src/server/render/certificate.js';
import {
  CARE_CONDITIONS,
  CARE_CONDITIONS_COPY,
  CARE_CONDITIONS_LAYOUT,
  CARE_CONDITIONS_VERSION,
  careConditionsFilename,
  careConditionsParagraph,
  careConditionsTexts,
  layoutCareConditions,
  renderCareConditionsPdf,
  wrapArticleText,
} from '../../src/server/render/care-conditions.js';
import { DOCUMENT_CHARSET, measureText, toArticleText } from '../../src/server/render/label-font.js';
import { findForbidden, forbiddenTerms } from '../docs/lexicon.js';

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const ORDER = 'OR-1A2B3C4D';
const HEADS = ['ARTICLE 11 - ORBES CARE AND THE WARRANTIES', 'ARTICLE 11 - ORBES CARE ET GARANTIES'];

/** The text as the lettering should draw it with nothing dropped: accents off, capitals, the house's dashes, quotes and ellipsis. */
const expected = (block: string) =>
  block
    .replace(/\*\*/g, '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

function bounds(d: string): { x0: number; y0: number; x1: number; y1: number } {
  const p: [number, number][] = [];
  for (const m of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const n = m[2].trim().split(/[ ,]+/).map(Number);
    p.push([n[n.length - 2]!, n[n.length - 1]!]);
  }
  return { x0: Math.min(...p.map(([x]) => x)), y0: Math.min(...p.map(([, y]) => y)), x1: Math.max(...p.map(([x]) => x)), y1: Math.max(...p.map(([, y]) => y)) };
}

describe('the ORBES CARE conditions PDF (render/care-conditions.ts)', () => {
  it('holds article 11 in English and in French, paragraph for paragraph, each led by its bold words; the review line and the link left out', () => {
    expect(CARE_CONDITIONS.en.title).toBe('Article 11 — ORBES CARE and the warranties');
    expect(CARE_CONDITIONS.fr.title).toBe('Article 11 — ORBES CARE et garanties');
    expect(CARE_CONDITIONS.en.blocks).toHaveLength(21);
    expect(CARE_CONDITIONS.fr.blocks).toHaveLength(21);
    for (const article of [CARE_CONDITIONS.en, CARE_CONDITIONS.fr]) {
      for (const b of article.blocks) {
        expect(b, b).toMatch(/^\*\*[^*]+\*\* \S/);
        expect(b).not.toMatch(/\]\(|\*Code|https?:/);
      }
    }
    // The parts in their order, the same in both languages.
    const leads = (blocks: readonly string[]) => blocks.map((b) => /^\*\*([AB](?:\.\d)?)[. ]/.exec(b)?.[1] ?? null).filter((x) => x !== null);
    expect(leads(CARE_CONDITIONS.en.blocks)).toEqual(['A', 'A.1', 'A.2', 'A.3', 'A.4', 'A.5', 'A.6', 'B', 'B.1', 'B.2', 'B.3']);
    expect(leads(CARE_CONDITIONS.fr.blocks)).toEqual(leads(CARE_CONDITIONS.en.blocks));
    expect(CARE_CONDITIONS.en.blocks[2]).toContain('given in the legal notice, and reached');
    expect(CARE_CONDITIONS.fr.blocks[2]).toContain('figure dans les mentions légales, joignable');
    expect(CARE_CONDITIONS.en.blocks.at(-1)).toMatch(/^\*\*Written conditions\.\*\* .*ORBES CARE CONDITIONS/);
    expect(CARE_CONDITIONS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never says a forbidden word, nor "atelier", in either language', () => {
    const text = [CARE_CONDITIONS.en, CARE_CONDITIONS.fr].flatMap((a) => [a.title, ...a.blocks]).join('\n');
    expect(findForbidden(text, [...forbiddenTerms(), 'atelier'])).toEqual([]);
    expect(text).not.toMatch(/stolen|volé|atelier/i);
  });

  it('letters every character of the article: nothing outside DOCUMENT_CHARSET reaches the lettering, nothing is dropped', () => {
    for (const article of [CARE_CONDITIONS.en, CARE_CONDITIONS.fr]) {
      for (const b of [article.title, ...article.blocks]) {
        const lettered = b === article.title ? toArticleText(b) : careConditionsParagraph(b);
        expect(lettered, b).toBe(expected(b));
        for (const ch of lettered) expect(DOCUMENT_CHARSET.has(ch), `${JSON.stringify(ch)} in ${b}`).toBe(true);
      }
    }
    // The percent sign and the semicolon are lettered, not dropped.
    expect(careConditionsParagraph(CARE_CONDITIONS.en.blocks.find((b) => b.startsWith('**A.4'))!)).toContain('A CREDIT OF 30 % OF');
    expect(careConditionsParagraph(CARE_CONDITIONS.fr.blocks.find((b) => b.startsWith('**A.2'))!)).toContain('DECLARE ; UNE PIECE');
    expect(careConditionsParagraph(CARE_CONDITIONS.en.blocks[1]!)).toContain('(CUFFLINKS, KEY RINGS...)');
  });

  it('prints its head, VERSION and ORDER, then the English article and the French, every paragraph whole and in order across the pages, each page numbered', () => {
    const pages = careConditionsTexts({ orderReference: ORDER });
    expect(pages.length).toBeGreaterThan(1);
    const [first] = pages;
    expect(first!.slice(0, 7)).toEqual(['ORBES', 'ORBES CARE CONDITIONS', 'VERSION', '15 OCTOBER 2026', 'ORDER', ORDER, HEADS[0]]);
    pages.forEach((p, i) => {
      expect(p.slice(-2), `page ${i + 1}`).toEqual([CARE_CONDITIONS_COPY.foot, `PAGE ${i + 1} OF ${pages.length}`]);
      if (i > 0) expect(p.slice(0, 3)).toEqual(['ORBES', 'ORBES CARE CONDITIONS', ORDER]);
    });
    // The body across the pages: each article's title once, in its place, then its paragraphs' lines, nothing else.
    const body = pages.flatMap((p, i) => p.slice(i === 0 ? 6 : 3, -2));
    const fr = body.indexOf(HEADS[1]!);
    expect(body[0]).toBe(HEADS[0]);
    expect(fr).toBeGreaterThan(0);
    const join = (lines: string[]) => lines.join(' ');
    expect(join(body.slice(1, fr))).toBe(CARE_CONDITIONS.en.blocks.map(careConditionsParagraph).join(' '));
    expect(join(body.slice(fr + 1))).toBe(CARE_CONDITIONS.fr.blocks.map(careConditionsParagraph).join(' '));
    // Each paragraph starts a line of its own.
    for (const b of [...CARE_CONDITIONS.en.blocks, ...CARE_CONDITIONS.fr.blocks]) expect(body, b).toContain(wrapArticleText(careConditionsParagraph(b))[0]);
    // Every line fits the column.
    const B = CARE_CONDITIONS_LAYOUT.body;
    for (const l of body.filter((t) => !HEADS.includes(t))) expect(measureText(l, B.tracking) * B.cap, l).toBeLessThanOrEqual(CARE_CONDITIONS_LAYOUT.right - CARE_CONDITIONS_LAYOUT.left);
  });

  it('wraps a paragraph between words, never losing one', () => {
    const text = careConditionsParagraph(CARE_CONDITIONS.en.blocks[4]!);
    const lines = wrapArticleText(text);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(text);
    expect(wrapArticleText('')).toEqual([]);
    expect(wrapArticleText('A B', 0)).toEqual(['A', 'B']);
  });

  it('lays the pages out in the margins, above the foot, the monogram on the first page only', () => {
    const L = CARE_CONDITIONS_LAYOUT;
    const pages = layoutCareConditions({ orderReference: ORDER });
    expect(pages.length).toBe(careConditionsTexts({ orderReference: ORDER }).length);
    pages.forEach((page, i) => {
      expect([page.widthMm, page.heightMm]).toEqual([210, 297]);
      expect(page.placements).toEqual([]);
      if (i === 0) expect(new Set(page.shapes!.map((s) => s.color))).toEqual(new Set(['#0A0A0A']));
      else expect(page.shapes).toEqual([]);
      for (const st of page.marks!) {
        const b = bounds(st.d);
        expect(b.x0).toBeGreaterThanOrEqual(L.left - 0.5);
        expect(b.x1).toBeLessThanOrEqual(L.right + 0.5);
        expect(b.y1).toBeLessThan(290);
        expect(st.width).toBeGreaterThanOrEqual(0.1);
      }
    });
  });

  it('refuses an order reference it cannot print', () => {
    for (const bad of ['OR-123', 'or-1a2b3c4d', 'INV-2026-000001', '', 'OR-1A2B3C4D ']) {
      expect(() => layoutCareConditions({ orderReference: bad }), bad).toThrow(CertificateInputError);
    }
  });

  it('renders a valid, deterministic PDF: no font, no text object, its title the conditions of the order, dated by its version', async () => {
    const a = await renderCareConditionsPdf({ orderReference: ORDER });
    const b = await renderCareConditionsPdf({ orderReference: ORDER });
    expect(a.contentType).toBe('application/pdf');
    expect(a.filename).toBe('ORBES-CARE-CONDITIONS-OR-1A2B3C4D.pdf');
    expect(careConditionsFilename('OR-00FF00FF')).toBe('ORBES-CARE-CONDITIONS-OR-00FF00FF.pdf');
    expect(Buffer.from(a.body).equals(Buffer.from(b.body))).toBe(true);
    const text = latin1(a.body);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('(ORBES CARE CONDITIONS OR-1A2B3C4D)');
    expect(text).toContain(`D:${CARE_CONDITIONS_VERSION.replace(/-/g, '')}000000`);
    expect(text.replace(/stream[\s\S]*?endstream/g, '')).not.toMatch(/\/Font|\/Subtype\s*\/Image/);
    expect(text).not.toMatch(/atelier|stolen/i);
    // Another order, another file.
    const c = await renderCareConditionsPdf({ orderReference: 'OR-00FF00FF' });
    expect(Buffer.from(c.body).equals(Buffer.from(a.body))).toBe(false);
  });
});
