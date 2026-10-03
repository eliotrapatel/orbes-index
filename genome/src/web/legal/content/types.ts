/**
 * The shape of the legal pages' content (J-06).
 *
 * A page is a title, an introduction and sections. Each block of text is
 * written in a small subset of Markdown, which legal/model.ts parses into
 * runs (parseBlock, parseInline) and legal/main.ts builds with textContent
 * only, never as HTML:
 *
 *   - a block whose every line starts with "- " is a list, each line an item;
 *   - any other block is a paragraph;
 *   - inline, **words** are set apart (the lead of a clause, a cookie's name),
 *     and [words](/legal/terms) or [words](https://…) is a link.
 *
 * The terms of use and the legal notice keep the words of their drafts in
 * docs/legal/ (J-04) in that same Markdown, so test/web/legal.content.test.ts
 * compares them clause by clause; `{ contact: true }` marks where the page
 * shows the contact of ORBES Client Services when the server publishes one.
 */
export type Lang = 'en' | 'fr';

export const LANGS: readonly Lang[] = ['en', 'fr'];

/** A paragraph or a list, or the place of the contact of ORBES Client Services. */
export type Block = string | { readonly contact: true };

export interface LegalSection {
  /** The section's anchor (`/legal/terms#article-8`): the same in both languages. */
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly Block[];
}

export interface LegalDocument {
  /** The page's heading and the start of the tab's title. */
  readonly title: string;
  /** One sentence for the index of the legal pages. */
  readonly summary: string;
  readonly intro: readonly Block[];
  readonly sections: readonly LegalSection[];
}
