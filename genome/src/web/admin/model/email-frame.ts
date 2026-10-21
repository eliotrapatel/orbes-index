/**
 * How the console shows an email's HTML (ui/email-frame.ts) — pure helpers, no DOM.
 *
 * The console's CSP (`style-src 'self'`) refuses the inline styles an email is made of (even in a DOMParser document,
 * which inherits the page's CSP and reports each style attribute), and an HTML string is never set as markup in the
 * console (shared/dom.ts). So an email is read here into a plain tree (parseEmailHtml: the HTML email/render.ts
 * writes, tags, attributes, words and entities) and drawn again element by element, inside a shadow root: only the tags and attributes an email of email/render.ts uses, its styles set
 * through the CSSOM (which the CSP allows), its links opened in a new tab, its images only from the console's own
 * origin (the monogram). Its `<style>` (the light version a mail client that prefers light shows, the narrow
 * padding of a phone) is read here into rules the frame applies by hand for the scheme and the width chosen.
 */

/** The elements an email may hold, drawn again as they are. */
export const FRAME_TAGS: ReadonlySet<string> = new Set([
  'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'a', 'img', 'p', 'div', 'span', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'hr', 'center',
]);

/** The elements left out with all they hold (anything else unknown is left out, its words kept). */
export const DROPPED_TAGS: ReadonlySet<string> = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea',
  'link', 'meta', 'base', 'title', 'head', 'svg', 'math', 'video', 'audio', 'source', 'picture', 'canvas',
]);

/** The attributes kept (besides `href`, `src` and `style`, which are checked one by one). */
export const FRAME_ATTRS: ReadonlySet<string> = new Set(['width', 'height', 'align', 'valign', 'role', 'alt', 'cellpadding', 'cellspacing', 'border', 'colspan', 'rowspan', 'lang', 'dir']);

/** A class the email's `<style>` names (`o-ground`, `o-ink`…): kept, so its rules find their elements. */
export const isFrameClass = (c: string): boolean => /^o-[a-z][a-z0-9-]*$/.test(c);

/** A link of the email, opened in a new tab: an absolute http(s) address without credentials, or nothing. */
export function frameHref(value: string | null): string | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.username === '' && u.password === '' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * An image of the email as the console may show it: from the console's own origin only (its CSP); the monogram, whose
 * address carries the platform's public origin, is read from the console's (the same server).
 */
export function frameImageSrc(value: string | null, origin: string, monogramPath = '/api/v1/email/monogram.png'): string | null {
  if (!value) return null;
  try {
    const u = new URL(value, origin);
    if (u.origin === origin) return u.href;
    return u.pathname === monogramPath && u.search === '' ? `${origin}${monogramPath}` : null;
  } catch {
    return null;
  }
}

export interface EmailCssDecl {
  prop: string;
  value: string;
  important: boolean;
}

/** A rule of the email's `<style>`: its media condition (null: always), its selectors, its declarations. */
export interface EmailCssRule {
  media: string | null;
  selectors: string[];
  decls: EmailCssDecl[];
}

function decls(block: string): EmailCssDecl[] {
  const out: EmailCssDecl[] = [];
  for (const part of block.split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    let value = part.slice(i + 1).trim();
    if (!/^-?[a-z][a-z-]*$/.test(prop) || value === '') continue;
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    // A value that reaches out of the email (an image, an import) is never applied.
    if (/url\(|expression\(|@import|javascript:/i.test(value)) continue;
    out.push({ prop, value, important });
  }
  return out;
}

function rules(css: string, media: string | null, out: EmailCssRule[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) return;
    const head = css.slice(i, open).trim();
    // The block's end, its nested braces counted.
    let depth = 1;
    let j = open + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    const inner = css.slice(open + 1, j - 1);
    if (/^@media\b/i.test(head)) rules(inner, head.replace(/^@media\s*/i, '').trim(), out);
    else if (!head.startsWith('@')) out.push({ media, selectors: head.split(',').map((x) => x.trim()).filter(Boolean), decls: decls(inner) });
    i = j;
  }
}

/** The rules of an email's `<style>`, its comments left out; an at-rule other than @media is ignored. */
export function emailCssRules(css: string): EmailCssRule[] {
  const out: EmailCssRule[] = [];
  rules(css.replace(/\/\*[\s\S]*?\*\//g, ''), null, out);
  return out;
}

export type EmailScheme = 'dark' | 'light';

/** Whether a media condition holds in the frame: the scheme a mail client prefers, the frame's width; anything else does not. */
export function mediaApplies(media: string | null, env: { scheme: EmailScheme; width: number }): boolean {
  if (media === null || media.trim() === '' || /^(all|screen)$/i.test(media.trim())) return true;
  return media
    .split(/\s+and\s+/i)
    .map((c) => c.trim().replace(/^\(|\)$/g, '').trim())
    .every((c) => {
      const scheme = /^prefers-color-scheme\s*:\s*(light|dark)$/i.exec(c);
      if (scheme) return scheme[1]!.toLowerCase() === env.scheme;
      const max = /^max-width\s*:\s*(\d+(?:\.\d+)?)px$/i.exec(c);
      if (max) return env.width <= Number(max[1]);
      const min = /^min-width\s*:\s*(\d+(?:\.\d+)?)px$/i.exec(c);
      if (min) return env.width >= Number(min[1]);
      if (/^(screen|all)$/i.test(c)) return true;
      return false;
    });
}

/** A selector the frame applies: one class (`.o-ink`) or one tag (`a`); anything else (`:root`…) is not. */
export function simpleSelector(sel: string): { kind: 'class' | 'tag'; name: string } | null {
  const cls = /^\.([a-z][a-z0-9-]*)$/i.exec(sel);
  if (cls) return { kind: 'class', name: cls[1]! };
  const tag = /^([a-z][a-z0-9]*)$/i.exec(sel);
  if (tag && FRAME_TAGS.has(tag[1]!.toLowerCase())) return { kind: 'tag', name: tag[1]!.toLowerCase() };
  return null;
}

/** Which of the rules' media conditions hold now, as one key: the frame is drawn again only when it changes. */
export function mediaKey(all: readonly EmailCssRule[], env: { scheme: EmailScheme; width: number }): string {
  return [...new Set(all.map((r) => r.media))].map((m) => (mediaApplies(m, env) ? '1' : '0')).join('');
}

// ── The email's HTML as a plain tree ─────────────────────────────────────────────────────────────────────────────

/** An element of the email: its tag, its attributes (names in lower case), what it holds. */
export interface EmailElement {
  tag: string;
  attrs: Record<string, string>;
  children: EmailNode[];
}
export type EmailNode = EmailElement | string;

/** The elements that hold nothing and need no end tag. */
const VOID_TAGS: ReadonlySet<string> = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** The elements whose content is raw words (no tag inside). */
const RAW_TAGS: ReadonlySet<string> = new Set(['style', 'script', 'title', 'textarea']);

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '\u00b7', mdash: '\u2014', ndash: '\u2013', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', hellip: '\u2026' };

/** Words with their character references read (`&amp;`, `&#39;`, `&#x2019;`); an unknown one is kept as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const n = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

function attrsOf(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of source.matchAll(re)) {
    const name = m[1]!.toLowerCase();
    if (name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * The email's HTML as a tree, under a root `#document`: its elements, attributes and words, comments and the doctype
 * left out; an end tag closes the nearest open element of its name, an unknown one is ignored, what is left open is
 * closed at the end. Nothing is run or fetched: it is words.
 */
export function parseEmailHtml(html: string): EmailElement {
  const root: EmailElement = { tag: '#document', attrs: {}, children: [] };
  const stack: EmailElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/([a-zA-Z][a-zA-Z0-9]*)\s*>|<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => {
    if (t !== '') top().children.push(decodeEntities(t));
  };
  while ((m = re.exec(html)) !== null) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const name = m[1].toLowerCase();
      const at = stack.map((e) => e.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    if (!m[2]) continue; // a comment or the doctype
    const el: EmailElement = { tag: m[2].toLowerCase(), attrs: attrsOf(m[3] ?? ''), children: [] };
    top().children.push(el);
    if (RAW_TAGS.has(el.tag)) {
      const end = html.toLowerCase().indexOf(`</${el.tag}`, last);
      const stop = end < 0 ? html.length : end;
      if (stop > last) el.children.push(el.tag === 'style' || el.tag === 'script' ? html.slice(last, stop) : decodeEntities(html.slice(last, stop)));
      const close = end < 0 ? html.length : html.indexOf('>', end);
      last = close < 0 ? html.length : close + 1;
      re.lastIndex = last;
      continue;
    }
    if (!VOID_TAGS.has(el.tag) && m[4] !== '/') stack.push(el);
  }
  text(html.slice(last));
  return root;
}

/** The first element of a tag in the tree, depth first, or null. */
export function findElement(node: EmailElement, tag: string): EmailElement | null {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.tag === tag) return c;
    const inner = findElement(c, tag);
    if (inner) return inner;
  }
  return null;
}

/** Every `<style>`'s words in the tree. */
export function styleTexts(node: EmailElement): string[] {
  const out: string[] = [];
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.tag === 'style') out.push(c.children.filter((x): x is string => typeof x === 'string').join(''));
    else out.push(...styleTexts(c));
  }
  return out;
}
