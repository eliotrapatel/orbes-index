/**
 * Hairline corner brackets, the framing device of theorbes.com.
 *
 *   viewportCorners()   four fixed brackets at the viewport corners
 *   bracket(node)       four small brackets framing one block
 *
 * Both are decorative (aria-hidden) and drawn entirely in CSS (brand.css:
 * .corners/.corner and .bracketed/.bracket); colour follows `currentColor`.
 */
import { h } from './dom.js';

const POSITIONS = ['tl', 'tr', 'bl', 'br'] as const;

/** The fixed viewport frame. Insert once per page. */
export function viewportCorners(extraClass?: string): HTMLDivElement {
  return h(
    'div',
    { class: ['corners', extraClass], attrs: { 'aria-hidden': 'true' } },
    ...POSITIONS.map((p) => h('span', { class: `corner corner--${p}` })),
  );
}

/** Frame `node` with four small brackets (adds the `bracketed` class). Returns the node. */
export function bracket<T extends HTMLElement>(node: T): T {
  node.classList.add('bracketed');
  for (const p of POSITIONS) node.appendChild(h('span', { class: `bracket bracket--${p}`, attrs: { 'aria-hidden': 'true' } }));
  return node;
}
