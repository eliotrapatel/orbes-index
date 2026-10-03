/**
 * The forbidden lexicon of BRAND-DESIGN-SYSTEM §4.5, for documents whose copy
 * reaches customers or the public (docs/launch/):
 *
 *  - English: the "Never use" column of the §4.5 table, read from the brand
 *    document itself (so a term added there is enforced here), plus "product"
 *    (§4.1: the customer's object is a piece);
 *  - French: the « Jamais » column of the lexicon that
 *    docs/launch/PACKAGING-KIT.md marks between LEXICON_BEGIN and LEXICON_END,
 *    its translation of §4.5.
 *
 * A document may quote a forbidden term only inside such a marked block.
 * Matching is by whole word (Unicode letters), case-insensitive, with spaces
 * and hyphens interchangeable, letters and digits split ("Web3", "Web 3"),
 * and plural, feminine or verb endings allowed on every word of a term.
 *
 * Held to it: the packaging kit (packaging-kit.test.ts) and the sales
 * playbook, docs/launch/SALES-PLAYBOOK.md (sales-playbook.test.ts), whose
 * staff instructions may also hold such a word inside a code span that quotes
 * the software itself (`Products`, `STOLEN`): see `codeSpans`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const readDoc = (relative: string): string => readFileSync(join(REPO, relative), 'utf8');

export const PACKAGING_KIT = 'docs/launch/PACKAGING-KIT.md';
export const LEXICON_BEGIN = '<!-- lexicon:begin -->';
export const LEXICON_END = '<!-- lexicon:end -->';

/** BRAND §4.1, outside the §4.5 table. */
export const EXTRA_FORBIDDEN_EN: readonly string[] = Object.freeze(['product']);

/** Body of the markdown section whose heading line starts with `heading`, up to the next heading of the same or a higher level. */
export function section(md: string, heading: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`no heading "${heading}"`);
  const level = /^#+/.exec(lines[start])?.[0].length ?? 0;
  if (level === 0) throw new Error(`"${heading}" is not a heading`);
  let end = start + 1;
  while (end < lines.length && !(/^#+ /.test(lines[end]) && (/^#+/.exec(lines[end])?.[0].length ?? 7) <= level)) end++;
  return lines.slice(start + 1, end).join('\n');
}

/** Rows of the first markdown table in `md` whose header has a cell `column`, as that column's cell text. */
function column(md: string, name: string): string[] {
  const lines = md.split('\n');
  const head = lines.findIndex((l) => l.trim().startsWith('|') && cells(l).includes(name));
  if (head < 0) throw new Error(`no table with a "${name}" column`);
  const index = cells(lines[head]).indexOf(name);
  const out: string[] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.trim().startsWith('|')) break;
    out.push(cells(line)[index] ?? '');
  }
  return out;
}

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** "Never use" terms of the BRAND §4.5 table, qualifiers removed ("GENUINE as a verdict" → "GENUINE"). */
export function brandForbiddenTerms(brand = readDoc('docs/BRAND-DESIGN-SYSTEM.md')): string[] {
  return column(section(brand, '### 4.5 Lexicon'), 'Never use')
    .flatMap((cell) => cell.split(','))
    .map((t) => t.replace(/\(.*?\)/g, '').replace(/\bas a verdict\b/i, '').trim())
    .filter((t) => t.length > 0);
}

/** The marked lexicon block(s) of a document, and the document without them. */
export function splitLexicon(md: string): { lexicon: string; rest: string } {
  const lexicon: string[] = [];
  let rest = md;
  for (;;) {
    const begin = rest.indexOf(LEXICON_BEGIN);
    if (begin < 0) break;
    const end = rest.indexOf(LEXICON_END, begin);
    if (end < 0) throw new Error('unterminated lexicon block');
    lexicon.push(rest.slice(begin + LEXICON_BEGIN.length, end));
    rest = rest.slice(0, begin) + rest.slice(end + LEXICON_END.length);
  }
  if (rest.includes(LEXICON_END)) throw new Error('lexicon end without a begin');
  return { lexicon: lexicon.join('\n'), rest };
}

/** « … » terms of the « Jamais » column of the kit's marked lexicon. */
export function frenchForbiddenTerms(kit = readDoc(PACKAGING_KIT)): string[] {
  return column(splitLexicon(kit).lexicon, 'Jamais').flatMap((cell) => [...cell.matchAll(/«\s*([^»]+?)\s*»/g)].map((m) => m[1]));
}

/** Every forbidden term: English (§4.5 and §4.1), then French (the kit's lexicon). */
export function forbiddenTerms(): string[] {
  return [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN, ...frenchForbiddenTerms()];
}

/** Endings any word of a term may carry: plural and feminine (« volées », « codes-barres », « certifiée originale »), English -ing, -ed, -er ("counterfeiting"). */
const ENDING = '(?:e?s|e|x|ing|ed|ers?)?';

/**
 * Whole-word, case-insensitive matcher: "TAMPER-PROOF" also matches "tamper
 * proof", « volé » « volées », « code-barres » « codes-barres », "Web3" "Web 3".
 * A word ending in -al also takes the French plural -aux (« originaux certifiés »).
 */
export function termPattern(term: string): RegExp {
  const words = term
    .trim()
    .split(/[\s-]+|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]"))
    .map((w) => `${w.replace(/al$/i, 'a(?:l|ux)')}${ENDING}`);
  if (words.length === 0) throw new Error('empty term');
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s-]*')}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Fenced code blocks (```…```) of a markdown text, from the opening fence to the closing one. */
const FENCE = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
/** An inline code span on one line: `Products`. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** The contents of the inline code spans of a markdown text, fenced blocks left out: `Products` → Products. */
export function codeSpans(md: string): string[] {
  return [...md.replace(FENCE, '').matchAll(CODE_SPAN)].map((m) => m[1]);
}

/** The text with each inline code span replaced by a space; fenced blocks are kept, as text. */
export function withoutCodeSpans(md: string): string {
  const fences: string[] = [];
  const held = md.replace(FENCE, (f) => `\u0000${fences.push(f) - 1}\u0000`);
  return held.replace(CODE_SPAN, ' ').replace(/\u0000(\d+)\u0000/g, (_, i: string) => fences[Number(i)]);
}

/** Forbidden terms found in `text`, each with a little context: [] when the text is clean. */
export function findForbidden(text: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  for (const term of terms) {
    for (const m of text.matchAll(termPattern(term))) {
      const at = m.index ?? 0;
      hits.push(`"${term}" in "…${text.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, ' ')}…"`);
    }
  }
  return hits;
}
