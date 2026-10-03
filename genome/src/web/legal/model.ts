/**
 * The logic of the legal pages, without the DOM (unit tested in Node,
 * test/web/legal.model.test.ts):
 *
 *  - the language: `?lang=fr` or `?lang=en`, else the first of the
 *    browser's languages (navigator.languages, else navigator.language)
 *    that is French or English, else English;
 *  - the route: /legal (the index), /legal/privacy, /legal/terms,
 *    /legal/notice, /legal/faq; any other path under /legal shows the index,
 *    its address put back to /legal;
 *  - the addresses of the pages, which keep the language;
 *  - the text: the small Markdown of content/types.ts parsed into runs the
 *    page builds with textContent (never HTML), every link checked first;
 *  - French typography: a narrow no-break space before : ; ? ! » and after «.
 */
import { LEGAL_PAGES, LEGAL_PATH, legalPath, type LegalPage } from '../shared/legal.js';
import type { Lang } from './content/types.js';

// ── Language ───────────────────────────────────────────────────────────────

const SUPPORTED: Readonly<Record<string, Lang>> = { en: 'en', fr: 'fr' };

/** The primary subtag of a language tag when it is one of ours: 'fr-CA' → 'fr', 'de' → undefined. */
function supported(tag: unknown): Lang | undefined {
  if (typeof tag !== 'string') return undefined;
  return SUPPORTED[tag.trim().toLowerCase().split(/[-_]/)[0] ?? ''];
}

/** `?lang=` first (when it names a language of ours), then the browser's languages in order, then English. */
export function pickLanguage(search: string, browserLanguages: readonly string[]): Lang {
  const asked = supported(new URLSearchParams(search).get('lang'));
  if (asked) return asked;
  for (const tag of browserLanguages) {
    const lang = supported(tag);
    if (lang) return lang;
  }
  return 'en';
}

// ── Route ──────────────────────────────────────────────────────────────────

export type LegalRoute = LegalPage | 'index';

/** The page a path shows, and its canonical path (the address the page puts back when it differs). */
export function routeOf(pathname: string): { route: LegalRoute; path: string } {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  const page = LEGAL_PAGES.find((p) => path === legalPath(p));
  return page ? { route: page, path: legalPath(page) } : { route: 'index', path: LEGAL_PATH };
}

/** The address of a page in a language: /legal/terms?lang=fr; the index is /legal?lang=fr. */
export function hrefOf(route: LegalRoute, lang: Lang, hash = ''): string {
  return `${route === 'index' ? LEGAL_PATH : legalPath(route)}?lang=${lang}${hash}`;
}

// ── Text ───────────────────────────────────────────────────────────────────

export type Run = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'link'; text: string; href: string; external: boolean };

export type ParsedBlock = { kind: 'paragraph'; runs: Run[] } | { kind: 'list'; items: Run[][] };

/**
 * A link's target, when it may become one: a page of /legal (its language added), an anchor of this page, or an
 * https address (opened apart). Anything else (javascript:, data:, http:, //host) stays plain text.
 */
export function linkTarget(href: string, lang: Lang): { href: string; external: boolean } | null {
  if (/^#[a-z0-9-]+$/.test(href)) return { href, external: false };
  const internal = /^(\/legal(?:\/[a-z]+)?)(#[a-z0-9-]+)?$/.exec(href);
  if (internal) {
    const { route, path } = routeOf(internal[1]);
    return path === internal[1] ? { href: hrefOf(route, lang, internal[2] ?? ''), external: false } : null;
  }
  if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w./#%-]*)?$/i.test(href)) return { href, external: true };
  return null;
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The runs of one line: plain text, **set apart**, [links](…). A link whose target is refused reads as its words. */
export function parseInline(src: string, lang: Lang): Run[] {
  const runs: Run[] = [];
  const text = (t: string) => {
    if (t === '') return;
    const last = runs.at(-1);
    if (last?.kind === 'text') last.text += t;
    else runs.push({ kind: 'text', text: t });
  };
  let at = 0;
  for (const m of src.matchAll(INLINE)) {
    text(src.slice(at, m.index));
    at = (m.index ?? 0) + m[0].length;
    if (m[1] !== undefined) {
      runs.push({ kind: 'strong', text: m[1] });
      continue;
    }
    const target = linkTarget(m[3], lang);
    if (target) runs.push({ kind: 'link', text: m[2], ...target });
    else text(m[2]);
  }
  text(src.slice(at));
  return runs.map((r) => ({ ...r, text: typography(r.text, lang) }));
}

/** A block of content: a list when every line starts with "- ", else a paragraph (its lines joined). */
export function parseBlock(src: string, lang: Lang): ParsedBlock {
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length > 0 && lines.every((l) => l.startsWith('- '))) return { kind: 'list', items: lines.map((l) => parseInline(l.slice(2), lang)) };
  return { kind: 'paragraph', runs: parseInline(lines.join(' '), lang) };
}

/** The text a block reads, links and emphasis dropped: what a search of the page, or a test, compares. */
export function plainText(block: ParsedBlock): string {
  const line = (runs: Run[]) => runs.map((r) => r.text).join('');
  return block.kind === 'list' ? block.items.map(line).join('\n') : line(block.runs);
}

const NNBSP = ' ';

/**
 * French typography: a narrow no-break space before : ; ? ! and », and after «, so the sign never starts a line.
 * Spaces typed in the text become that space; English text is left as it is. A colon inside an address
 * (https://…) has no space before it and is left alone.
 */
export function typography(text: string, lang: Lang): string {
  if (lang !== 'fr') return text;
  return text.replace(/ ([:;?!»])/g, `${NNBSP}$1`).replace(/« /g, `«${NNBSP}`);
}

/** Runs of digits in a display-face heading (Gravesend's one is its capital I): the page sets them in --font. */
export function splitFigures(text: string): { text: string; figure: boolean }[] {
  return text
    .split(/(\d+)/)
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, figure: /^\d+$/.test(t) }));
}
