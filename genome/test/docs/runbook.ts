/**
 * Helpers shared by the tests of the owner's deployment runbooks (docs/launch/DEPLOY-*.md): the shell blocks
 * one command at a time, and the anchors a relative link may name.
 */

/** The fenced blocks of one language, their lines out of the list item's indentation. */
export function fenced(md: string, lang: string): string[] {
  const out: string[] = [];
  const re = /^([ \t]*)```([\w-]*)\n([\s\S]*?)\n\1```[ \t]*$/gm;
  for (const m of md.matchAll(re)) {
    if (m[2] !== lang) continue;
    const indent = m[1]!.length;
    out.push(
      m[3]!
        .split('\n')
        .map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)))
        .join('\n'),
    );
  }
  return out;
}

/** GitHub's anchor of a markdown heading. */
export const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** The anchors of every heading of a markdown document. */
export const anchors = (md: string): Set<string> =>
  new Set(
    md
      .split('\n')
      .filter((l) => /^#{1,6} /.test(l))
      .map((l) => slug(l.replace(/^#{1,6} /, ''))),
  );
