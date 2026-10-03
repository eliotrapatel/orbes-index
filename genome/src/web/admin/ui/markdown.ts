/**
 * A small Markdown renderer for the staff documents (views/documents.ts).
 *
 * It builds DOM nodes with `h()`, never markup: the text of a document can
 * never become HTML, and the console's CSP holds. It reads what the playbook
 * and the packaging kit use: headings, paragraphs, lists (nested by indent),
 * tables, fenced code, block quotes, rules, and inline code, bold, italic,
 * links and images.
 *
 * Links: http(s) opens in a new tab; a link to the other document opens it in
 * the console; any other relative link (the repository's docs) reads as plain
 * text, since the console does not serve them. Images: `../assets/<name>`
 * comes from GET /api/admin/documents/assets/<name>; others are left out.
 */
import { h, type Child } from '../../shared/dom.js';
import { href } from '../router.js';

export interface MarkdownOptions {
  /** `SALES-PLAYBOOK.md` → `sales-playbook`: the documents the console shows. */
  documentIds: Readonly<Record<string, string>>;
  /** The URL of an illustration by its file name. */
  assetUrl: (name: string) => string;
}

export interface RenderedMarkdown {
  body: HTMLElement;
  /** The level-2 headings, for the table of contents. */
  toc: { id: string; text: string }[];
}

const FENCE = /^```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Text of a heading as an anchor id: `## 3. Vente en boutique` → `3-vente-en-boutique`. */
export function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[`*_[\]()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section'
  );
}

/** Inline text with the words a heading or a TOC entry shows (no markup characters). */
export function plain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '');
}

const INLINE = [
  { kind: 'code', re: /`([^`]+)`/ },
  { kind: 'image', re: /!\[([^\]]*)\]\(([^)\s]+)\)/ },
  { kind: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { kind: 'bold', re: /\*\*(.+?)\*\*/ },
  { kind: 'italic', re: /\*(?!\s)(.+?)(?<!\s)\*/ },
] as const;

function inline(text: string, o: MarkdownOptions): Child[] {
  const out: Child[] = [];
  let rest = text;
  while (rest) {
    let best: { kind: (typeof INLINE)[number]['kind']; m: RegExpExecArray } | null = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { kind: p.kind, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { kind, m } = best;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
    if (kind === 'code') out.push(h('code', { class: 'md__code' }, m[1]));
    else if (kind === 'bold') out.push(h('strong', null, ...inline(m[1], o)));
    else if (kind === 'italic') out.push(h('em', null, ...inline(m[1], o)));
    else if (kind === 'image') out.push(image(m[1], m[2], o));
    else out.push(link(m[1], m[2], o));
  }
  return out;
}

function link(label: string, url: string, o: MarkdownOptions): Child {
  const text = inline(label, o);
  if (/^https?:\/\//i.test(url)) return h('a', { class: 'md__link', attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } }, ...text);
  const file = url.split('#')[0].split('/').pop() ?? '';
  const id = o.documentIds[file];
  if (id) return h('a', { class: 'md__link', attrs: { href: href('document', { docId: id }) } }, ...text);
  return h('span', { class: 'md__ref' }, ...text);
}

function image(alt: string, src: string, o: MarkdownOptions): Child {
  const m = /^\.\.\/assets\/(?:ui\/)?([\w.-]+)$/.exec(src);
  if (!m) return null;
  return h(
    'figure',
    { class: 'md__figure' },
    h('img', { class: 'md__img', attrs: { src: o.assetUrl(m[1]), alt, loading: 'lazy', decoding: 'async' } }),
    alt ? h('figcaption', { class: 'md__caption' }, alt) : null,
  );
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (c === '\\' && r[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      inCode = !inCode;
      cur += c;
    } else if (c === '|' && !inCode) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function indentOf(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
}

/** Render the blocks of `lines` (already split) into `parent`. */
function blocks(lines: string[], o: MarkdownOptions, toc: RenderedMarkdown['toc'], used: Set<string>): Child[] {
  const out: Child[] = [];
  let i = 0;
  const startsBlock = (l: string): boolean =>
    FENCE.test(l.trim()) || HEADING.test(l) || RULE.test(l.trim()) || l.trimStart().startsWith('>') || LIST_ITEM.test(l) || l.trimStart().startsWith('|');

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    const fence = FENCE.exec(t);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(h('pre', { class: 'md__pre', data: { lang: fence[1] || undefined } }, h('code', null, code.join('\n'))));
      continue;
    }
    const head = HEADING.exec(line);
    if (head) {
      const level = head[1].length;
      const text = head[2];
      let id = slug(plain(text));
      for (let n = 2; used.has(id); n++) id = `${slug(plain(text))}-${n}`;
      used.add(id);
      if (level === 2) toc.push({ id, text: plain(text) });
      const tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(level, 6) - 1];
      out.push(h(tag, { class: `md__h md__h${level}`, attrs: { id } }, ...inline(text, o)));
      i++;
      continue;
    }
    if (RULE.test(t)) {
      out.push(h('hr', { class: 'md__rule' }));
      i++;
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        h(
          'div',
          { class: 'md__table-wrap' },
          h(
            'table',
            { class: 'md__table' },
            h('thead', null, h('tr', null, ...header.map((c) => h('th', null, ...inline(c, o))))),
            h('tbody', null, ...rows.map((r) => h('tr', null, ...header.map((_, k) => h('td', null, ...inline(r[k] ?? '', o)))))),
          ),
        ),
      );
      continue;
    }
    if (t.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) inner.push(lines[i++].trimStart().replace(/^>\s?/, ''));
      out.push(h('blockquote', { class: 'md__quote' }, ...blocks(inner, o, [], used)));
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const base = indentOf(line);
      const ordered = /\d/.test(item[2]);
      const items: Child[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
        const body: string[] = [m[3]];
        i++;
        // The item's continuation: deeper lines (sub-lists, wrapped text), and lazy lines that start no block.
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            const next = lines[i + 1];
            if (next !== undefined && next.trim() && indentOf(next) > base) {
              body.push('');
              i++;
              continue;
            }
            break;
          }
          if (indentOf(l) > base) body.push(l.slice(Math.min(indentOf(l), base + m[2].length + 1)));
          else if (!startsBlock(l)) body.push(l.trim());
          else break;
          i++;
        }
        const deeper = body.slice(1).some((l) => LIST_ITEM.test(l) || l.trim() === '');
        const content: Child[] = deeper
          ? blocks(body, o, [], used)
          : [h('span', null, ...inline(body.map((l) => l.trim()).join(' '), o))];
        items.push(h('li', { class: 'md__li' }, ...content));
      }
      out.push(h(ordered ? 'ol' : 'ul', { class: ['md__list', ordered ? 'md__list--ol' : null] }, ...items));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++].trim());
    const text = para.join(' ');
    const only = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(text);
    out.push(only ? image(only[1], only[2], o) : h('p', { class: 'md__p' }, ...inline(text, o)));
  }
  return out;
}

export function renderMarkdown(markdown: string, o: MarkdownOptions): RenderedMarkdown {
  const toc: RenderedMarkdown['toc'] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const body = h('div', { class: 'md' }, ...blocks(lines, o, toc, new Set()));
  return { body, toc };
}
