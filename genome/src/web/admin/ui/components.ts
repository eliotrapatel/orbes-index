/**
 * Console building blocks: status marks, section headers, definition lists,
 * hairline tables, pagers, bars, buttons and form fields.
 *
 * All text goes through textContent (shared/dom.ts `h`), so values from the
 * database can never become markup. Monospace is reserved for identifiers
 * and hashes (`mono`).
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import type { BarRow } from '../model/dashboard.js';
import type { Tone } from '../model/tone.js';

// ── Text ───────────────────────────────────────────────────────────────────

/** An identifier or hash in monospace, with the full value as tooltip. */
export function mono(value: string | number | null | undefined, display?: string): HTMLElement {
  const v = value === null || value === undefined || value === '' ? '—' : String(value);
  return h('span', { class: 'mono', attrs: { title: v === '—' ? null : v } }, display ?? v);
}

/** Status mark: a small square (filled, hollow, grey, inverted or red) and the uppercase value. */
export function statusMark(text: string, tone: Tone): HTMLElement {
  return h('span', { class: ['status', `status--${tone}`] }, h('span', { class: 'status__mark', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'status__text' }, text));
}

export function micro(text: string, extra?: string): HTMLElement {
  return h('span', { class: ['micro', 'soft', extra] }, text);
}

// ── Layout ─────────────────────────────────────────────────────────────────

/**
 * Page header: eyebrow (section), title, optional lead text and actions on the right.
 * `identifier`: the title is a record id (a product id), set in the reading face, not the display face.
 */
export function pageHeader(opts: { eyebrow: string; title: string; identifier?: boolean; lead?: string; actions?: Child[] }): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    h(
      'div',
      { class: 'page-head__text' },
      h('p', { class: 'page-head__eyebrow' }, opts.eyebrow),
      h('h1', { class: ['page-head__title', opts.identifier ? 'page-head__title--id' : null], attrs: { tabindex: '-1' } }, opts.title),
      opts.lead ? h('p', { class: 'page-head__lead' }, opts.lead) : null,
    ),
    opts.actions && opts.actions.length ? h('div', { class: 'page-head__actions' }, ...opts.actions) : null,
  );
}

/** A titled section with a hairline above and optional right-aligned tools. */
export function section(title: string, body: Child | Child[], opts: { tools?: Child[]; id?: string; note?: string; class?: string } = {}): HTMLElement {
  const children = Array.isArray(body) ? body : [body];
  return h(
    'section',
    { class: ['panel', opts.class], ...(opts.id ? { id: opts.id } : {}) },
    h(
      'div',
      { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, title),
      opts.note ? h('span', { class: 'panel__note' }, opts.note) : null,
      opts.tools && opts.tools.length ? h('div', { class: 'panel__tools' }, ...opts.tools) : null,
    ),
    h('div', { class: 'panel__body' }, ...children),
  );
}

export interface DefRow {
  label: string;
  value: Child;
  note?: string;
}

/** Label / value rows separated by hairlines (spec §22 fact sheet). */
export function defList(rows: DefRow[], extra?: string): HTMLElement {
  return h(
    'dl',
    { class: ['deflist', extra] },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'deflist__row' },
        h('dt', { class: 'deflist__label' }, r.label),
        h('dd', { class: 'deflist__value' }, r.value, r.note ? h('span', { class: 'deflist__note' }, r.note) : null),
      ),
    ),
  );
}

// ── Tables ─────────────────────────────────────────────────────────────────

export interface Column<T> {
  label: string;
  cell: (row: T) => Child;
  /** 'num' right-aligns, 'mono' for id columns, 'wide' takes remaining width, 'nowrap'. */
  kind?: ('num' | 'mono' | 'wide' | 'nowrap' | 'actions')[];
}

export function table<T>(
  columns: Column<T>[],
  rows: T[],
  opts: { empty?: string; onRow?: (row: T) => string | null; caption?: string; /** The row the page is about (`is-current`). */ current?: (row: T) => boolean } = {},
): HTMLElement {
  if (rows.length === 0) {
    return h('div', { class: 'empty' }, h('span', { class: 'empty__mark', attrs: { 'aria-hidden': 'true' } }), h('p', { class: 'empty__text' }, opts.empty ?? 'Nothing to show.'));
  }
  const cls = (c: Column<T>) => (c.kind ?? []).map((k) => `col--${k}`);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table' },
      opts.caption ? h('caption', { class: 'visually-hidden' }, opts.caption) : null,
      h('thead', null, h('tr', null, ...columns.map((c) => h('th', { class: cls(c), attrs: { scope: 'col' } }, c.label)))),
      h(
        'tbody',
        null,
        ...rows.map((r) => {
          const link = opts.onRow?.(r) ?? null;
          const current = opts.current?.(r) === true;
          const tr = h(
            'tr',
            { class: [link ? 'is-link' : null, current ? 'is-current' : null], attrs: { 'aria-current': current ? 'true' : null } },
            ...columns.map((c) => h('td', { class: cls(c) }, c.cell(r))),
          );
          if (link) {
            // Whole-row navigation for the mouse; the first link in the row stays the keyboard target.
            tr.addEventListener('click', (ev) => {
              const t = ev.target as HTMLElement;
              if (t.closest('a, button, input, select, textarea')) return;
              location.hash = link.startsWith('#') ? link.slice(1) : link;
            });
          }
          return tr;
        }),
      ),
    ),
  );
}

/** `01–50 OF 1 204` and PREVIOUS / NEXT. */
export function pager(p: { page: number; pageSize: number; total: number }, go: (page: number) => void): HTMLElement | null {
  // Nothing to page through: the empty state says it all.
  if (p.total === 0 && p.page <= 1) return null;
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
  const to = Math.min(p.total, p.page * p.pageSize);
  return h(
    'nav',
    { class: 'pager', attrs: { 'aria-label': 'Pagination' } },
    h('span', { class: 'pager__range' }, `${formatCount(from)}–${formatCount(to)} of ${formatCount(p.total)}`),
    h(
      'span',
      { class: 'pager__nav' },
      button('Previous', { kind: 'ghost', disabled: p.page <= 1, onClick: () => go(p.page - 1) }),
      h('span', { class: 'pager__page' }, `${p.page} / ${pages}`),
      button('Next', { kind: 'ghost', disabled: p.page >= pages, onClick: () => go(p.page + 1) }),
    ),
  );
}

// ── Bars & figures ─────────────────────────────────────────────────────────

/** Hairline bar: grey 1 px track, black (or red for critical) segment scaled by `fraction`. */
export function barList(rows: BarRow[], opts: { link?: (row: BarRow) => string | null } = {}): HTMLElement {
  return h(
    'ul',
    { class: 'bars' },
    ...rows.map((r) => {
      const fill = h('span', { class: ['bar__fill', `bar__fill--${r.tone}`] });
      // CSSOM custom property (CSP-safe): the stylesheet scales the fill with it.
      fill.style.setProperty('--f', String(Math.max(0, Math.min(1, r.fraction))));
      const href = opts.link?.(r) ?? null;
      const label = href ? h('a', { class: 'bar__label', attrs: { href } }, r.label) : h('span', { class: 'bar__label' }, r.label);
      return h(
        'li',
        { class: ['bar', r.value === 0 ? 'bar--zero' : null] },
        label,
        h('span', { class: 'bar__track', attrs: { 'aria-hidden': 'true' } }, fill),
        h('span', { class: 'bar__value' }, formatCount(r.value)),
        h('span', { class: 'bar__share' }, r.share),
      );
    }),
  );
}

export function kpi(label: string, value: string, note: string, tone: Tone = 'solid'): HTMLElement {
  return h('div', { class: ['kpi', `kpi--${tone}`] }, h('p', { class: 'kpi__label' }, label), h('p', { class: 'kpi__value' }, value), h('p', { class: 'kpi__note' }, note));
}

// ── Controls ───────────────────────────────────────────────────────────────

export interface ButtonOptions {
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (ev: MouseEvent) => void;
  title?: string;
  testId?: string;
}

export function button(label: string, o: ButtonOptions = {}): HTMLButtonElement {
  const b = h('button', {
    class: ['cbtn', `cbtn--${o.kind ?? 'secondary'}`],
    attrs: { type: o.type ?? 'button', disabled: !!o.disabled, title: o.title, 'data-testid': o.testId },
  }, label);
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** A link styled as a console button. */
export function linkButton(label: string, href: string, kind: ButtonOptions['kind'] = 'secondary'): HTMLAnchorElement {
  return h('a', { class: ['cbtn', `cbtn--${kind}`], attrs: { href } }, label);
}

/** Disable a button and show a working label while `fn` runs; always restores it. */
export async function busy<T>(btn: HTMLButtonElement, fn: () => Promise<T>, working = 'Working…'): Promise<T> {
  const label = btn.textContent ?? '';
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = working;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = label;
  }
}

let fieldSeq = 0;

export interface FieldOptions {
  hint?: string;
  required?: boolean;
  wide?: boolean;
}

/** Label + control + hint/error line. The control gets an id and aria-describedby. */
export function field(label: string | Node, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, o: FieldOptions = {}): HTMLElement {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  if (o.required) control.required = true;
  const hint = h('span', { class: 'cfield__hint', id: `${id}-hint` }, o.hint ?? '');
  control.setAttribute('aria-describedby', `${id}-hint`);
  return h(
    'div',
    { class: ['cfield', o.wide ? 'cfield--wide' : null], data: { field: control.name || undefined } },
    h('label', { class: 'cfield__label', attrs: { for: id } }, label, o.required ? h('span', { class: 'cfield__req', attrs: { 'aria-hidden': 'true' } }, ' ·') : null),
    control,
    hint,
  );
}

/** Show or clear a field error (keeps the original hint to restore later). */
export function setFieldError(container: ParentNode, name: string, message: string | undefined): void {
  const wrap = container.querySelector<HTMLElement>(`.cfield[data-field="${name}"]`);
  if (!wrap) return;
  const control = wrap.querySelector<HTMLElement>('input, select, textarea');
  const hint = wrap.querySelector<HTMLElement>('.cfield__hint');
  if (!hint) return;
  if (hint.dataset.hint === undefined) hint.dataset.hint = hint.textContent ?? '';
  if (message) {
    hint.textContent = message;
    wrap.classList.add('is-invalid');
    control?.setAttribute('aria-invalid', 'true');
  } else {
    hint.textContent = hint.dataset.hint ?? '';
    wrap.classList.remove('is-invalid');
    control?.removeAttribute('aria-invalid');
  }
}

export function input(name: string, o: { type?: string; value?: string; placeholder?: string; maxlength?: number; autocomplete?: string; min?: string | number; max?: string | number; step?: string | number; inputmode?: string; mono?: boolean } = {}): HTMLInputElement {
  const el = h('input', {
    class: ['cinput', o.mono ? 'mono' : null],
    attrs: {
      name,
      type: o.type ?? 'text',
      placeholder: o.placeholder,
      maxlength: o.maxlength,
      autocomplete: o.autocomplete ?? 'off',
      min: o.min,
      max: o.max,
      step: o.step,
      inputmode: o.inputmode,
      spellcheck: 'false',
    },
  });
  if (o.value !== undefined) el.value = o.value;
  return el;
}

export function textarea(name: string, o: { rows?: number; maxlength?: number; placeholder?: string } = {}): HTMLTextAreaElement {
  return h('textarea', { class: 'cinput cinput--area', attrs: { name, rows: o.rows ?? 3, maxlength: o.maxlength, placeholder: o.placeholder } });
}

export function select(name: string, options: { value: string; label: string }[], value?: string): HTMLSelectElement {
  const el = h('select', { class: 'cinput cinput--select', attrs: { name } }, ...options.map((o) => h('option', { attrs: { value: o.value } }, o.label)));
  if (value !== undefined) el.value = value;
  return el;
}

export function checkbox(name: string, label: string, checked = false): HTMLLabelElement {
  const box = h('input', { class: 'ccheck__box', attrs: { type: 'checkbox', name } });
  box.checked = checked;
  return h('label', { class: 'ccheck' }, box, h('span', { class: 'ccheck__mark', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'ccheck__label' }, label));
}

/** Inline filter bar for list views. */
export function filterBar(...children: Child[]): HTMLElement {
  return h('div', { class: 'filters' }, ...children);
}

/** Copy text to the clipboard with a short confirmation on the button. */
export function copyButton(value: string, label = 'Copy'): HTMLButtonElement {
  const b = button(label, { kind: 'ghost' });
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => (b.textContent = label), 1600);
  });
  return b;
}

/** A centred loading line for the main area. */
export function loading(text = 'Loading'): HTMLElement {
  return h('div', { class: 'loading', attrs: { role: 'status' } }, h('span', { class: 'loading__orbit', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'loading__text' }, text));
}

/** A failure block for a view that could not load. */
export function failure(message: string, retry?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'failure', attrs: { role: 'alert' } },
    h('p', { class: 'failure__title' }, 'Unavailable'),
    h('p', { class: 'failure__text' }, message),
    retry ? button('Retry', { kind: 'secondary', onClick: retry }) : null,
  );
}
