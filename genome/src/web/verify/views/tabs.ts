/**
 * PRODUCT · WARRANTY · CARE · OWNERSHIP on a result, OWNERSHIP · WARRANTY ·
 * SERVICE on each piece of MY PIECES — an ARIA tablist (manual activation
 * is unnecessary here: panels are light, so arrow keys select).
 * Keyboard: ←/→ move, Home/End jump; only the selected tab is in the tab
 * order (roving tabindex). Panels are built lazily on first selection.
 *
 * Element ids are `tab-{id}` and `panel-{id}`, after `idPrefix` when a page
 * shows several tablists (MY PIECES: one per piece).
 */
import { h } from '../../shared/dom.js';
import { TAB_LABELS, type TabId } from '../view-model.js';

export interface TabsView<T extends string = TabId> {
  root: HTMLElement;
  /**
   * Show a tab's panel (built on first selection); `focus` also moves keyboard focus to the tab. The result's link
   * under the second-hand guidance (J-02) opens OWNERSHIP with it.
   */
  select(id: T, focus?: boolean): void;
}

export interface TabsOptions<T extends string> {
  /** The label of each tab (default: the result's TAB_LABELS). */
  labels?: Readonly<Record<T, string>>;
  /** Prefix of the tabs' and panels' element ids, unique on the page. */
  idPrefix?: string;
  /** Accessible name of the tablist (default "Product information"). */
  label?: string;
}

export function tabsView<T extends string = TabId>(ids: readonly T[], build: (id: T) => HTMLElement, initial: T = ids[0], opts: TabsOptions<T> = {}): TabsView<T> {
  const labels = (opts.labels ?? TAB_LABELS) as Readonly<Record<string, string>>;
  const prefix = opts.idPrefix ?? '';
  const list = h('div', { class: 'tabs__list', attrs: { role: 'tablist', 'aria-label': opts.label ?? 'Product information' } });
  const panels = h('div', { class: 'tabs__panels' });
  const tabs = new Map<T, HTMLButtonElement>();
  const built = new Map<T, HTMLElement>();
  let current: T | undefined;

  const select = (id: T, focus = false) => {
    if (!tabs.has(id)) return;
    current = id;
    for (const [tid, tab] of tabs) {
      const on = tid === id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      const panel = built.get(tid);
      if (panel) panel.hidden = !on;
    }
    if (!built.has(id)) {
      const panel = h('div', { class: 'tabs__panel', id: `${prefix}panel-${id}`, attrs: { role: 'tabpanel', 'aria-labelledby': `${prefix}tab-${id}`, tabindex: 0 } }, build(id));
      built.set(id, panel);
      panels.appendChild(panel);
    }
    if (focus) tabs.get(id)?.focus();
  };

  ids.forEach((id, i) => {
    if (i > 0) list.appendChild(h('span', { class: 'tabs__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }));
    const tab = h('button', {
      class: 'tabs__tab',
      id: `${prefix}tab-${id}`,
      attrs: { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': `${prefix}panel-${id}`, tabindex: -1 },
      on: { click: () => select(id) },
      text: labels[id],
    });
    tabs.set(id, tab);
    list.appendChild(tab);
  });

  list.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (current === undefined) return;
    const i = ids.indexOf(current);
    let next: number | undefined;
    if (ev.key === 'ArrowRight') next = (i + 1) % ids.length;
    else if (ev.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = ids.length - 1;
    if (next === undefined) return;
    ev.preventDefault();
    select(ids[next], true);
  });

  select(initial);
  return { root: h('section', { class: 'tabs', attrs: { 'aria-label': 'Details' } }, list, panels), select };
}
