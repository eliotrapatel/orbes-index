/**
 * An email as a mail client shows it, in the console (the Emails page's preview, an email of the outbox, the founding
 * announcement's preview): its HTML read into a plain tree and drawn again element by element in a shadow root, never
 * set as markup, its styles through the CSSOM (model/email-frame.ts says why and what is kept). DARK · LIGHT · PLAIN TEXT
 * choose the version: a mail client that prefers light reads the email's light version, as its `<style>` says.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import {
  DROPPED_TAGS,
  emailCssRules,
  findElement,
  FRAME_ATTRS,
  FRAME_TAGS,
  frameHref,
  frameImageSrc,
  isFrameClass,
  mediaApplies,
  mediaKey,
  parseEmailHtml,
  simpleSelector,
  styleTexts,
  type EmailCssRule,
  type EmailElement,
  type EmailScheme,
} from '../model/email-frame.js';
import { EMAILS_COPY as C } from '../model/emails.js';
import type { RenderedEmail } from '../types.js';

/** The email's elements drawn again under `into`, its classes kept for its rules; what is not an email's left out. */
function draw(source: EmailElement, into: Node, origin: string): void {
  for (const node of source.children) {
    if (typeof node === 'string') {
      into.appendChild(document.createTextNode(node));
      continue;
    }
    const tag = node.tag;
    if (DROPPED_TAGS.has(tag)) continue;
    if (!FRAME_TAGS.has(tag)) {
      // Unknown: its words kept, the element left out.
      draw(node, into, origin);
      continue;
    }
    const copy = document.createElement(tag);
    for (const [name, value] of Object.entries(node.attrs)) if (FRAME_ATTRS.has(name)) copy.setAttribute(name, value);
    const classes = (node.attrs.class ?? '').split(/\s+/).filter(isFrameClass);
    if (classes.length) copy.className = classes.join(' ');
    // The CSSOM, never a style attribute (the CSP): what the email wrote inline.
    const style = node.attrs.style;
    if (style && !/url\(|expression\(|javascript:/i.test(style)) copy.style.cssText = style;
    if (tag === 'a') {
      const href = frameHref(node.attrs.href ?? null);
      if (href) {
        copy.setAttribute('href', href);
        copy.setAttribute('target', '_blank');
        copy.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'img') {
      const src = frameImageSrc(node.attrs.src ?? null, origin);
      if (!src) continue;
      copy.setAttribute('src', src);
      copy.setAttribute('referrerpolicy', 'no-referrer');
    }
    draw(node, copy, origin);
    into.appendChild(copy);
  }
}

/** The `<style>` rules that hold for this scheme and width, applied as a stylesheet would: `!important` over the inline. */
function apply(root: ParentNode, all: readonly EmailCssRule[], env: { scheme: EmailScheme; width: number }): void {
  for (const rule of all) {
    if (!mediaApplies(rule.media, env)) continue;
    for (const sel of rule.selectors) {
      const simple = simpleSelector(sel);
      if (!simple) continue;
      const targets = root.querySelectorAll<HTMLElement>(simple.kind === 'class' ? `.${simple.name}` : simple.name);
      for (const el of Array.from(targets)) {
        for (const d of rule.decls) {
          // A rule without !important never beats what the element wrote inline.
          if (!d.important && el.style.getPropertyValue(d.prop) !== '') continue;
          el.style.setProperty(d.prop, d.value, d.important ? 'important' : '');
        }
      }
    }
  }
}

/** One email's HTML in a shadow root, in the scheme given; drawn again when its width crosses one of its media rules. */
export function emailFrame(html: string, scheme: EmailScheme): HTMLElement {
  const doc = parseEmailHtml(html);
  const all = styleTexts(doc).flatMap((css) => emailCssRules(css));
  const source = findElement(doc, 'body') ?? doc;
  const host = h('div', { class: 'email-frame__host', data: { testid: 'email-frame', scheme } });
  const shadow = host.attachShadow({ mode: 'open' });
  const origin = location.origin;
  let key = '';
  const render = (width: number) => {
    const env = { scheme, width };
    const next = mediaKey(all, env);
    if (next === key && shadow.firstChild) return;
    key = next;
    // The body becomes the frame's ground, with its own style.
    const body = document.createElement('div');
    const bodyStyle = source.attrs.style;
    if (bodyStyle && !/url\(|expression\(|javascript:/i.test(bodyStyle)) body.style.cssText = bodyStyle;
    const bodyClasses = (source.attrs.class ?? '').split(/\s+/).filter(isFrameClass);
    if (bodyClasses.length) body.className = bodyClasses.join(' ');
    body.setAttribute('part', 'body');
    draw(source, body, origin);
    const wrap = document.createElement('div');
    wrap.appendChild(body);
    apply(wrap, all, env);
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    shadow.appendChild(body);
  };
  render(Number.POSITIVE_INFINITY);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) render(w);
    }).observe(host);
  }
  return host;
}

export type EmailView = 'dark' | 'light' | 'text';

/**
 * The email with its subject over it and DARK · LIGHT · PLAIN TEXT, the version chosen kept while the page is open
 * (`view`): the Emails page's preview, an email of the outbox, the founding announcement's preview.
 */
export function emailViewer(email: RenderedEmail, o: { view?: EmailView; onView?: (v: EmailView) => void; note?: string; testid?: string } = {}): HTMLElement {
  let view: EmailView = o.view ?? 'dark';
  const stage = h('div', { class: 'email-view__stage' });
  const choice = (v: EmailView, label: string) => {
    const b = h('button', { class: ['range__tab', 'email-view__choice'], attrs: { type: 'button', 'aria-pressed': String(v === view), 'data-testid': `email-view-${v}` } }, label);
    b.addEventListener('click', () => {
      if (view === v) return;
      view = v;
      o.onView?.(v);
      show();
    });
    return b;
  };
  const choices = [choice('dark', C.dark), choice('light', C.light), choice('text', C.text)];
  const show = () => {
    for (const b of choices) b.setAttribute('aria-pressed', String(b.dataset.testid === `email-view-${view}`));
    const content: Child =
      view === 'text'
        ? h('pre', { class: 'email-view__text', data: { testid: 'email-text' } }, email.text)
        : h('div', { class: ['email-view__frame', `email-view__frame--${view}`] }, emailFrame(email.html, view));
    mount(stage, content);
  };
  show();
  return h(
    'div',
    { class: 'email-view', data: { testid: o.testid ?? 'email-view' } },
    h(
      'div',
      { class: 'email-view__head' },
      h('p', { class: 'email-view__subject' }, h('span', { class: 'email-view__label' }, 'Subject'), h('span', { data: { testid: 'email-subject' } }, email.subject)),
      h('div', { class: ['range', 'email-view__choices'], attrs: { role: 'group', 'aria-label': 'Version' } }, ...choices.flatMap((b, i) => [i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null, b])),
    ),
    stage,
    o.note ? h('p', { class: 'email-view__note' }, o.note) : null,
  );
}
