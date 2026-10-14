/**
 * The Collectors page's shared pieces (plan CUSTOMER INTELLIGENCE §3.6 C.6.3; steps 9.9 and 9.10): a figure and its link
 * to its collectors, a comparison, bars with their shares and comparisons, tabs inside a panel, the empty state. Used by
 * views/collectors.ts (the page, At a glance, Who they are) and views/collectors-panels.ts (the other panels). Text
 * through h() only (CSP-safe).
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { CONTROLS_COPY as K, filterCount, PANEL_COPY, shareOf, type CollectorsParams, type CompareWords, type Reader } from '../model/collectors.js';
import type { CollectorsOptions, CollectorsQuery } from '../types.js';
import { button, emptyState } from '../ui/components.js';
import type { ViewContext } from './context.js';

// ── Pieces shared by the panels ──────────────────────────────────────────────────────────────────────────────────

/** A figure: a link to its collectors (with its `aria-label`), or its text when it opens nothing. */
export function figureLink(text: string, link: string | null, label: string, cls = 'idlink'): HTMLElement {
  return link
    ? h('a', { class: [cls, 'collectors__figure'], attrs: { href: link, 'aria-label': label, 'data-testid': 'collectors-figure' } }, text)
    : h('span', { class: 'collectors__figure' }, text);
}

/** A comparison under a figure: its change, then the previous value in small type. */
export function compareBlock(c: CompareWords | null): HTMLElement | null {
  if (!c) return null;
  return h('span', { class: 'collectors__cmp' }, h('span', { class: 'collectors__change' }, c.change), c.before ? h('span', { class: 'collectors__before' }, c.before) : null);
}

/** A bar of a panel: its label, its count (the share of `total` beside it), its comparison, and the link to its collectors. */
export interface PanelBar {
  key: string;
  label: string;
  n: number;
  compare: CompareWords | null;
  link: string | null;
  aria: string;
  /** A swatch before the label (a finish). */
  swatch?: string | null;
  /** The previous period's value, drawn pale behind (SCORE SPREAD). */
  ghost?: number | null;
}

/** Hairline bars with their counts, shares and comparisons (the stylesheet's `.bars`, a comparison column added). */
export function panelBars(rows: PanelBar[], total: number, testid: string): HTMLElement {
  const max = Math.max(0, ...rows.map((r) => Math.max(r.n, r.ghost ?? 0)));
  const withCompare = rows.some((r) => r.compare !== null);
  return h(
    'ul',
    { class: ['bars', 'collectors__bars', withCompare ? 'collectors__bars--cmp' : null], data: { testid } },
    ...rows.map((r) => {
      const fill = h('span', { class: ['bar__fill', 'bar__fill--solid'] });
      // CSSOM custom property (CSP-safe): the stylesheet scales the fill with it.
      fill.style.setProperty('--f', String(max > 0 ? r.n / max : 0));
      const label: Child[] = [r.swatch ? swatch(r.swatch) : null, r.label];
      const ghost = r.ghost === undefined || r.ghost === null ? null : h('span', { class: ['bar__fill', 'bar__fill--muted', 'collectors__ghost'] });
      ghost?.style.setProperty('--f', String(max > 0 ? (r.ghost ?? 0) / max : 0));
      return h(
        'li',
        { class: ['bar', r.n === 0 ? 'bar--zero' : null], data: { key: r.key } },
        r.link ? h('a', { class: 'bar__label', attrs: { href: r.link, 'aria-label': r.aria, title: r.label, 'data-testid': 'collectors-figure' } }, ...label) : h('span', { class: 'bar__label', attrs: { title: r.label } }, ...label),
        h('span', { class: 'bar__track', attrs: { 'aria-hidden': 'true' } }, ghost, fill),
        h('span', { class: 'bar__value' }, formatCount(r.n)),
        h('span', { class: 'bar__share' }, shareOf(r.n, total)),
        withCompare ? (compareBlock(r.compare) ?? h('span', { class: 'collectors__cmp' })) : null,
      );
    }),
  );
}

/** A finish's colour dot (the CSSOM sets its colour: CSP-safe). */
export function swatch(color: string): HTMLElement {
  const dot = h('span', { class: 'collectors__swatch', attrs: { 'aria-hidden': 'true' } });
  if (/^#[0-9a-f]{3,8}$/i.test(color)) dot.style.setProperty('--swatch', color);
  return dot;
}

/**
 * Tabs inside a panel: buttons that switch what the panel shows, the current one underlined (`.range`). One stop in
 * the Tab order (the current tab; a roving tabindex), Left and Right (Home and End) move to the next tab and show it;
 * the panel's redraw gives the focus back to the new tab (`keepFocus`).
 */
export function panelTabs<T extends string>(label: string, items: readonly { key: T; text: string }[], current: T, pick: (key: T) => void, testid: string): HTMLElement {
  const stop = items.some((t) => t.key === current) ? current : items[0]?.key;
  const buttons: HTMLElement[] = [];
  const list = h(
    'div',
    { class: ['range', 'collectors__tabs'], attrs: { role: 'tablist', 'aria-label': label }, data: { testid } },
    ...items.flatMap((t, i) => {
      const b = h('button', { class: 'range__tab', attrs: { type: 'button', role: 'tab', 'aria-selected': t.key === current ? 'true' : 'false', tabindex: t.key === stop ? '0' : '-1', 'data-key': t.key } }, t.text);
      b.addEventListener('click', () => pick(t.key));
      b.addEventListener('keydown', (ev) => {
        const to = tabStep(ev.key, i, items.length);
        if (to === null) return;
        ev.preventDefault();
        // The new tab focused first, so the redraw finds it and focuses its copy.
        buttons[to]?.focus();
        pick(items[to]!.key);
      });
      buttons.push(b);
      return [i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null, b];
    }),
  );
  return list;
}

/** The tab a key moves to from tab `i` of `n` (wrapping), or null for another key. */
export function tabStep(key: string, i: number, n: number): number | null {
  if (n <= 0) return null;
  if (key === 'ArrowRight') return (i + 1) % n;
  if (key === 'ArrowLeft') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

const quoted = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`;

/**
 * Where a focused control is, as a selector that finds its copy once its part of the page is drawn again: a switch's
 * key in its list (`[data-testid="collectors-who-tabs"] [data-key="cities"]`), else its own test id when it is the only
 * one under `root`, else its name. Null for anything else (a figure's link).
 */
export function focusMark(el: Element | null, root: ParentNode): string | null {
  if (!el) return null;
  const key = el.getAttribute('data-key');
  const group = el.parentElement?.closest('[data-testid]')?.getAttribute('data-testid');
  if (key !== null && group) return `[data-testid=${quoted(group)}] [data-key=${quoted(key)}]`;
  const id = el.getAttribute('data-testid');
  if (id && root.querySelectorAll(`[data-testid=${quoted(id)}]`).length === 1) return `[data-testid=${quoted(id)}]`;
  const name = el.getAttribute('name');
  if (name) return `[name=${quoted(name)}]`;
  return null;
}

/** The focused element inside `root`, or null. */
export function focusedIn(root: Element): Element | null {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return active && root.contains(active) ? active : null;
}

/** Focuses the copy `mark` names under `root`, unless the focus has moved elsewhere meanwhile; true when it did. */
export function refocus(root: ParentNode, mark: string | null): boolean {
  if (!mark) return false;
  const active = document.activeElement;
  if (active && active !== document.body && (active as Element).isConnected && !(root as Node).contains(active)) return false;
  const again = root.querySelector<HTMLElement>(mark);
  if (!again) return false;
  if (document.activeElement !== again) again.focus({ preventScroll: true });
  return true;
}

/** Redraws part of a panel (`draw` replaces `root`'s children), the focus kept on the same control's copy. */
export function keepFocus(root: HTMLElement, draw: () => void): void {
  const mark = focusMark(focusedIn(root), root);
  draw();
  refocus(root, mark);
}

/**
 * Show all: draws the full list, then focuses the first row it adds (its link, or the row itself), counted by `rows`
 * under `root` before and after.
 */
export function showMore(root: HTMLElement, rows: string, draw: () => void): void {
  const before = root.querySelectorAll(rows).length;
  draw();
  const row = root.querySelectorAll<HTMLElement>(rows)[before];
  if (!row) return;
  const target = row.querySelector<HTMLElement>('a[href], button') ?? row;
  if (target === row && !row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/** The children worth appending: nothing for null, a number as its text. */
export function nodes(children: Child[]): (Node | string)[] {
  return children.filter((x): x is Node | string | number => x !== null && x !== undefined && x !== false).map((x) => (typeof x === 'number' ? String(x) : x));
}

/** A line of the panel, in small type. */
export function panelLine(text: string | null, testid?: string): HTMLElement | null {
  return text ? h('p', { class: 'growth__line', data: { testid } }, text) : null;
}

/** What a panel's drawing is given. */
export interface PanelCtx {
  ctx: ViewContext;
  p: CollectorsParams;
  options: CollectorsOptions | null;
  reader: Reader;
  /** Read the panel again (its own choices, e.g. Over time's figure, or the currency). */
  reload: (extra?: Pick<CollectorsQuery, 'figure' | 'split' | 'currency'>) => void;
  /** Clear filters (the empty state's button). */
  clear: () => void;
}

/** 'No collector matches these filters.', with Clear filters when one is set. */
export function noMatch(pc: PanelCtx): HTMLElement {
  return h(
    'div',
    { class: 'collectors__empty', data: { testid: 'collectors-no-match' } },
    emptyState(PANEL_COPY.noMatch),
    filterCount(pc.p) > 0 ? button(K.clear, { kind: 'secondary', onClick: pc.clear }) : null,
  );
}

