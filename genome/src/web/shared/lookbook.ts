/**
 * The words of a lookbook sheet (P-R02), as both apps show them: the
 * verification app's sheet (/verify/lookbook/<slug>) and the console's
 * preview of it (Catalogue → Lookbook), so what the console shows is what a
 * client reads.
 *
 *  - The story is plain paragraphs: a blank line starts a new one, a single
 *    line break stays a line break inside it. No Markdown: an asterisk or a
 *    hash is shown as typed. Built with textContent only, never markup.
 *  - The specifications are one `Label: value` line each, the label before
 *    the first colon. The server keeps only lines of that form
 *    (services/lookbook.ts normalizeSpecs: no figure in a label, which is set
 *    in the display face) and sends them parsed to the verification app; the
 *    console reads them here from what is typed, the same way.
 */
import { h } from './dom.js';

/** The address of a sheet: lower-case letters and digits, words joined by single hyphens (the server's SLUG_RE). */
export const LOOKBOOK_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LOOKBOOK_SLUG_MAX = 80;
export const LOOKBOOK_STORY_MAX = 4000;
export const LOOKBOOK_SPECS_MAX = 1000;
export const LOOKBOOK_SPEC_LABEL_MAX = 40;

/** Whether `slug` is the address of a sheet. */
export function isLookbookSlug(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && slug.length <= LOOKBOOK_SLUG_MAX && LOOKBOOK_SLUG_RE.test(slug);
}

/** The paragraphs of a story, each a list of its lines: blank lines separate paragraphs, whitespace is trimmed. */
export function storyParagraphs(story: string | null | undefined): string[][] {
  if (!story) return [];
  return story
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    )
    .filter((lines) => lines.length > 0);
}

/** The story as <p> elements (a <br> between the lines of one), in a block of `className`; null without a story. */
export function storyBlock(story: string | null | undefined, opts: { className?: string; paragraphClass?: string } = {}): HTMLElement | null {
  const paragraphs = storyParagraphs(story);
  if (paragraphs.length === 0) return null;
  return h(
    'div',
    { class: opts.className ?? 'story' },
    ...paragraphs.map((lines) => h('p', { class: opts.paragraphClass ?? 'story__paragraph' }, ...lines.flatMap((line, i) => (i === 0 ? [line] : [h('br'), line])))),
  );
}

export interface SpecRow {
  label: string;
  value: string;
}

/** The `Label: value` lines of specifications as typed; a line without a label or a value is left out. */
export function specRows(specs: string | null | undefined): SpecRow[] {
  if (!specs) return [];
  const out: SpecRow[] = [];
  for (const line of specs.replace(/\r\n?/g, '\n').split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (label && value) out.push({ label, value });
  }
  return out;
}

/**
 * What the server would refuse in typed specifications, said as it says it (services/lookbook.ts normalizeSpecs), or
 * null: so the console says it before anything is sent.
 */
export function specsProblem(specs: string | null | undefined): string | null {
  const text = (specs ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length > LOOKBOOK_SPECS_MAX) return `The specifications must be at most ${LOOKBOOK_SPECS_MAX} characters.`;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const [i, line] of lines.entries()) {
    const colon = line.indexOf(':');
    const label = colon < 0 ? '' : line.slice(0, colon).trim();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    if (!label || !value) return `Specifications, line ${i + 1}: write it as Label: value (for example, Metal: 925 sterling silver).`;
    if (label.length > LOOKBOOK_SPEC_LABEL_MAX) return `Specifications, line ${i + 1}: a label has at most ${LOOKBOOK_SPEC_LABEL_MAX} characters.`;
    if (/[0-9]/.test(label)) return `Specifications, line ${i + 1}: a label has no figure (labels are set in the display face); put the figures in the value.`;
  }
  return null;
}
