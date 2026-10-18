/**
 * The legal pages' lines written for a phone and their words on a computer (src/web/legal/content/desktop.ts
 * `forComputer`, plan §2(i)): each pair's phone phrase is found exactly once in its language's current texts, in a
 * section's heading or a block, the texts legal/main.ts reads through `forComputer` on the page and in its list of
 * sections. So a later edit of a legal text cannot silently drop a computer line (the phrase gone: the computer
 * reads the phone's words) nor leave one half read (the phrase twice: `forComputer` replaces it once). The texts
 * themselves and LEGAL_VERSION are not changed by a computer's words (Q3 (b)): legal.content.test.ts pins them.
 */
import { describe, expect, it } from 'vitest';
import { DOCUMENTS, LANGS, type Lang, type LegalDocument } from '../../src/web/legal/content/index.js';
import { DESKTOP_WORDING, forComputer } from '../../src/web/legal/content/desktop.js';
import { LEGAL_PAGES, type LegalPage } from '../../src/web/shared/legal.js';

/** Where a text is read: `converted` when legal/main.ts reads it through `forComputer` wherever it shows it. */
interface Text {
  where: string;
  text: string;
  converted: boolean;
}

/**
 * Every text of a document: its title and summary (read as they are on the index of /legal, never in a
 * computer's words), its sections' headings, its introduction's and its sections' blocks (the contact's place
 * holds no words).
 */
function texts(page: LegalPage, doc: LegalDocument): Text[] {
  const blocks = (where: string, bs: LegalDocument['intro']): Text[] =>
    bs.flatMap((b, i) => (typeof b === 'string' ? [{ where: `${where} block ${i + 1}`, text: b, converted: true }] : []));
  return [
    { where: `${page} title`, text: doc.title, converted: false },
    { where: `${page} summary`, text: doc.summary, converted: false },
    ...blocks(`${page} intro`, doc.intro),
    ...doc.sections.flatMap((s) => [{ where: `${page} ${s.id} heading`, text: s.title, converted: true }, ...blocks(`${page} ${s.id}`, s.blocks)]),
  ];
}

const textsOf = (lang: Lang): Text[] => LEGAL_PAGES.flatMap((page) => texts(page, DOCUMENTS[page][lang]));

/** How many times `phrase` is found in `text`, each match counted once (non-overlapping, as `replace` reads it). */
const count = (text: string, phrase: string): number => text.split(phrase).length - 1;

describe('legal pages on a computer: each forComputer pair in its current text', () => {
  it('has pairs in both languages, each a phrase and words of its own', () => {
    expect(Object.keys(DESKTOP_WORDING).sort()).toEqual([...LANGS].sort());
    for (const lang of LANGS) {
      expect(DESKTOP_WORDING[lang].length, lang).toBeGreaterThan(0);
      const phones = DESKTOP_WORDING[lang].map(([phone]) => phone);
      expect(new Set(phones).size, `${lang}: a phone phrase listed twice`).toBe(phones.length);
      for (const [phone, computer] of DESKTOP_WORDING[lang]) {
        expect(phone.trim(), `${lang}: ${phone}`).toBe(phone);
        expect(phone.length, `${lang}: ${phone}`).toBeGreaterThan(10);
        expect(computer.trim(), `${lang}: ${computer}`).toBe(computer);
        expect(computer, `${lang}: ${phone}`).not.toBe(phone);
        // A computer's words never hold a phone phrase of its language: `forComputer` replaces each pair once, in
        // order, so such words would be read half replaced.
        for (const other of phones) expect(computer.includes(other), `${lang}: "${computer}" holds "${other}"`).toBe(false);
      }
    }
  });

  for (const lang of LANGS) {
    for (const [phone, computer] of DESKTOP_WORDING[lang]) {
      it(`${lang}: "${phone}" is found exactly once, where a computer reads it in its own words`, () => {
        const hits = textsOf(lang).flatMap((t) => Array.from({ length: count(t.text, phone) }, () => t));
        expect(
          hits.map((t) => t.where),
          `${lang}: "${phone}" must be found once in the legal texts (desktop.ts DESKTOP_WORDING and legal/content/*.ts)`,
        ).toHaveLength(1);
        const [hit] = hits;
        // Not in a title or a summary: the index of /legal shows them as they are, on a computer too.
        expect(hit!.converted, `${lang}: "${phone}" is in ${hit!.where}, which a computer reads as it is`).toBe(true);
        const read = forComputer(hit!.text, lang);
        expect(read.includes(phone), `${lang}: ${hit!.where} still reads the phone's words on a computer`).toBe(false);
        expect(read.includes(computer), `${lang}: ${hit!.where} does not read the computer's words`).toBe(true);
      });
    }

    it(`${lang}: every other text reads the same on a computer as on a phone`, () => {
      const holding = textsOf(lang).filter((t) => DESKTOP_WORDING[lang].some(([phone]) => t.text.includes(phone)));
      const changed = textsOf(lang).filter((t) => forComputer(t.text, lang) !== t.text);
      expect(changed.map((t) => t.where)).toEqual(holding.map((t) => t.where));
    });
  }

  it("reads a language's pairs only in that language", () => {
    for (const lang of LANGS) {
      for (const other of LANGS.filter((l) => l !== lang)) {
        for (const [phone] of DESKTOP_WORDING[lang]) {
          expect(forComputer(phone, other), `${lang} pair read in ${other}`).toBe(phone);
        }
      }
    }
  });
});
