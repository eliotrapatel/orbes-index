/**
 * Small DOM helpers shared by the ORBES web apps.
 *
 * Everything is built with createElement / textContent, never innerHTML, so
 * server-provided strings (product names, care text, error messages) can
 * never become markup. Styling goes through classes or the CSSOM only: the
 * CSP (`style-src 'self'`) forbids inline style attributes in markup.
 */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  /** Space-separated class names (falsy entries in an array are skipped). */
  class?: string | (string | false | null | undefined)[];
  id?: string;
  /** Plain text content (set via textContent). */
  text?: string;
  /** Attributes; `true` sets an empty attribute, `false`/null/undefined skips it. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** data-* attributes. */
  data?: Record<string, string | number | undefined>;
  /** Event listeners. */
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

function classOf(c: Props['class']): string {
  if (!c) return '';
  return Array.isArray(c) ? c.filter(Boolean).join(' ') : c;
}

function applyAttrs(node: Element, attrs: Props['attrs']): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    // Never allow event-handler or style attributes through this path (CSP and XSS hygiene).
    if (/^on/i.test(k) || k.toLowerCase() === 'style') throw new Error(`dom: attribute "${k}" is not allowed`);
    node.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(node: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Create an HTML element: `h('p', { class: 'micro' }, 'TEXT')`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    const cls = classOf(props.class);
    if (cls) node.className = cls;
    if (props.id) node.id = props.id;
    applyAttrs(node, props.attrs);
    if (props.data) for (const [k, v] of Object.entries(props.data)) if (v !== undefined) node.dataset[k] = String(v);
    if (props.on) {
      for (const [type, fn] of Object.entries(props.on)) if (fn) node.addEventListener(type, fn as EventListener);
    }
    if (props.text !== undefined) node.textContent = props.text;
  }
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element with attributes. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  ...children: (SVGElement | null | undefined | false)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (/^on/i.test(k) || k.toLowerCase() === 'style') throw new Error(`dom: attribute "${k}" is not allowed`);
    node.setAttribute(k, String(v));
  }
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/**
 * Parse SVG markup produced by our own renderers (core primitivesToSvg) into a
 * live element. Parsed as XML, so it can carry no scripts that would run;
 * any <script> or on* attribute is stripped regardless, as defence in depth.
 */
export function parseSvg(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('dom: invalid SVG markup');
  }
  for (const bad of Array.from(root.querySelectorAll('script, foreignObject'))) bad.remove();
  for (const node of Array.from(root.querySelectorAll('*')).concat(root)) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || attr.name === 'style') node.removeAttribute(attr.name);
    }
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

/** Remove every child of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's children. */
export function mount(parent: Node, ...children: Child[]): void {
  clear(parent);
  append(parent, children);
}

/** Look up a required element; throws with a clear message when the shell is broken. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`dom: #${id} is missing`);
  return node as T;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Resolve after `ms` (or immediately when the user prefers reduced motion and `motion` is true). */
export function wait(ms: number, motion = false): Promise<void> {
  if (motion && prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Move focus to a view's heading so screen readers announce the new screen. */
export function focusFirst(root: ParentNode, selectors: readonly string[] = ['[data-autofocus]', 'h1']): void {
  let target: HTMLElement | null = null;
  for (const sel of selectors) {
    target = root.querySelector<HTMLElement>(sel);
    if (target) break;
  }
  if (!target) return;
  if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/** Toggle a boolean ARIA/data attribute in one call. */
export function setFlag(node: Element, name: string, on: boolean): void {
  if (on) node.setAttribute(name, name.startsWith('aria-') ? 'true' : '');
  else if (name.startsWith('aria-')) node.setAttribute(name, 'false');
  else node.removeAttribute(name);
}
