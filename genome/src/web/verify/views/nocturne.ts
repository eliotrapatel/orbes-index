/**
 * NOCTURNE's pieces (plan NOCTURNE, step N2): every shared piece of the validated canvas (C1–C43) as view code, the
 * rules of each in verify/styles.css (NOCTURNE), its values the rulebook's (nocturne-ref/build.py, COMMON_CSS and
 * C_CSS), its classes the rulebook's own names under `n-` (`.btn` → `.n-btn`, `.rail` → `.n-rail`).
 *
 *   type          n-g (Gravesend capitals) · n-t1 n-t2 n-t3 · n-lb · n-lead n-tx n-sm · n-ivc · n-num · n-nw
 *   icon()        the canvas's line icons (22 px, 1.25 stroke; `small`: 16 px)
 *   monogram()    the ORBES monogram on its master artboard, in ivory (28 px in the header, 38 px at the foot…)
 *   button()      an ivory filled button (54 px), the one primary action; `outline`: the hairline button
 *   textLink()    a text link underlined at 5 px (`.tl`)
 *   tabs()        underlined tabs, as a tablist (`.tabs`, MY PIECES; `.tabsx`, a result's; `.switch2`, SIGN IN)
 *   accordionRow() a row with a hairline that opens (+ / −); leadRow() one that leads on (›)
 *   definitionList() facts (`.dl`), or label and value rows (`.kv`)
 *   field()       a field underlined on the dark (`.fld`, its label `.lab`)
 *   plateCard()   a plate card framed by a hairline inset 14 px (`.card`)
 *   fadedPhoto()  a photograph shown whole at the column's full width, fading into the ground at its top and foot
 *                 (`.ph.fade.contain`); lift() the text that rises 56 px onto it
 *   countdown()   the figures in weight 200, their units under them, colons between them
 *   tierDots()    the tier as five dots
 *   switchControl() a switch (`.sw`)
 *   variantDots() a model's variant dots (the selected one ringed), each drawn from its swatch
 *   sizeButtons() the sizes, the selected one doubly ringed
 *   orderSteps()  the steps of an order, its bar to the current one
 *   loadingState() the monogram breathing above ONE MOMENT… (addition 14); failedState() could not be shown, with the
 *                 reason and TRY AGAIN; quietLine() an empty page's sentence, an owners-only or not-found one (C40)
 *
 * The header, the rail, the SCAN ring and the footer are built here too (views/shell.ts holds them on every screen
 * but the scan, the room, the board and the shared certificate). CSP-safe: h() and s() only, no markup strings, styles
 * by class (a swatch through the CSSOM).
 */
import { h, s } from '../../shared/dom.js';
import { GEOIP_ATTRIBUTION, LEGAL_PAGES, legalPath } from '../../shared/legal.js';
import { monogramSvg } from '../../shared/monogram.js';
import { LEGAL, SOUND } from '../copy.js';
import { swatchGradient } from '../nocturne-model.js';
import type { SoundSwitch } from '../sound.js';

// ── Icons ──────────────────────────────────────────────────────────────────

/** The canvas's line icons (build.py ICONS), each a 22 × 22 drawing in currentColor. */
const ICONS = Object.freeze({
  close: [['path', { d: 'M5.5 5.5l11 11M16.5 5.5l-11 11' }]],
  scan: [
    ['path', { d: 'M2.5 7V2.5H7M15 2.5h4.5V7M19.5 15v4.5H15M7 19.5H2.5V15' }],
    ['circle', { cx: 11, cy: 11, r: 4.2 }],
    ['circle', { cx: 11, cy: 11, r: 1.1, fill: 'currentColor', stroke: 'none' }],
  ],
  back: [['path', { d: 'M13.5 4.5L7 11l6.5 6.5' }]],
  chev: [['path', { d: 'M8.5 4.5L15 11l-6.5 6.5' }]],
  plus: [['path', { d: 'M11 5v12M5 11h12' }]],
  minus: [['path', { d: 'M5 11h12' }]],
  check: [['path', { d: 'M4.5 11.5l4 4 9-9.5' }]],
  cal: [['path', { d: 'M3.5 5.5h15v13h-15zM3.5 9.5h15M7.5 3v4M14.5 3v4' }]],
  doc: [['path', { d: 'M6 2.5h7l4 4v13H6z' }], ['path', { d: 'M13 2.5v4h4M9 11.5h5M9 14.5h5' }]],
  shield: [['path', { d: 'M11 2.8l6.5 2.7v5c0 4.3-2.8 7.2-6.5 8.2-3.7-1-6.5-3.9-6.5-8.2v-5z' }]],
  share: [['path', { d: 'M11 3v11M7 7l4-4 4 4M5 11v7.5h12V11' }]],
  lock: [['path', { d: 'M5.5 10h11v9h-11zM8 10V7a3 3 0 0 1 6 0v3' }]],
  key: [['circle', { cx: 7.5, cy: 11, r: 3.5 }], ['path', { d: 'M11 11h8M16 11v3M18.5 11v2' }]],
  mail: [['path', { d: 'M3 5.5h16v11H3z' }], ['path', { d: 'M3.5 6l7.5 6 7.5-6' }]],
} as const satisfies Record<string, readonly (readonly ['path' | 'circle', Record<string, string | number>])[]>);

export type IconName = keyof typeof ICONS;

/** A line icon, decorative (aria-hidden): 22 px, or 16 px `small`. */
export function icon(name: IconName, opts: { small?: boolean } = {}): SVGSVGElement {
  return s(
    'svg',
    { class: opts.small ? 'n-ic n-ic--sm' : 'n-ic', viewBox: '0 0 22 22', 'aria-hidden': 'true', focusable: 'false' },
    ...ICONS[name].map(([tag, attrs]) => s(tag, attrs as Record<string, string | number>)),
  );
}

/** The ORBES monogram on its master artboard, in ivory, `px` square (the header's 28, the footer's 38, a loading state's 40). */
export function monogram(px: 28 | 38 | 40 | 52, opts: { label?: boolean; extraClass?: string } = {}): SVGSVGElement {
  return monogramSvg({ class: `n-mono n-mono--${px}${opts.extraClass ? ` ${opts.extraClass}` : ''}`, decorative: !opts.label, artboard: true });
}

// ── Actions ────────────────────────────────────────────────────────────────

export interface ButtonOptions {
  /** The hairline button (secondary); the filled ivory one otherwise (the screen's one primary action). */
  outline?: boolean;
  type?: 'button' | 'submit';
  onClick?: (ev: MouseEvent) => void;
  extraClass?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

/** A button, 54 px, its label in Gravesend capitals: ivory filled, or `outline` the hairline one. */
export function button(label: string | Node, opts: ButtonOptions = {}): HTMLButtonElement {
  return h(
    'button',
    {
      class: ['n-g', 'n-btn', opts.outline ? 'n-btn--ol' : null, opts.extraClass],
      attrs: { type: opts.type ?? 'button', ...opts.attrs },
      on: opts.onClick ? { click: opts.onClick } : undefined,
    },
    label,
  );
}

/**
 * A link of this app (a real address: a click that opens a new tab or window is left to the browser); a plain click
 * stays in the app (`onOpen`: no reload, the history entry is the router's).
 */
export function appAnchor(href: string, cls: (string | null | undefined | false)[], onOpen: (() => void) | undefined, ...children: (Node | string)[]): HTMLAnchorElement {
  return h(
    'a',
    {
      class: cls,
      attrs: { href },
      on: {
        click: (ev) => {
          if (!onOpen || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
          ev.preventDefault();
          onOpen();
        },
      },
    },
    ...children,
  );
}

/** A text link (`.tl`): Gravesend capitals underlined at 5 px; a button when it acts (`onClick` without `href`). */
export function textLink(label: string, opts: { href?: string; onOpen?: () => void; newTab?: boolean; extraClass?: string } = {}): HTMLAnchorElement | HTMLButtonElement {
  const cls = ['n-g', 'n-tl', opts.extraClass];
  if (opts.href === undefined) return h('button', { class: cls, attrs: { type: 'button' }, on: opts.onOpen ? { click: () => opts.onOpen?.() } : undefined, text: label });
  if (opts.newTab) return h('a', { class: cls, attrs: { href: opts.href, target: '_blank', rel: 'noopener' }, text: label });
  return appAnchor(opts.href, cls, opts.onOpen, label);
}

// ── Structure ──────────────────────────────────────────────────────────────

export interface TabItem {
  id: string;
  label: string;
  /** The count beside the label (`.tabs sup`, in the reading face). */
  count?: number;
}

/**
 * Underlined tabs as a tablist: `.tabs` (MY PIECES: 30 px apart), `.tabsx` (a result's: spread across), `.switch2`
 * (SIGN IN · CREATE ACCOUNT). Each tab says its panel (`aria-controls` = `${idPrefix}-${id}-panel`); the arrows move
 * between them.
 */
export function tabs(items: readonly TabItem[], opts: { selected: string; label: string; idPrefix: string; kind?: 'tabs' | 'tabsx' | 'switch2'; onSelect(id: string): void }): HTMLElement {
  const kind = opts.kind ?? 'tabs';
  const list = h('div', { class: `n-${kind}`, attrs: { role: 'tablist', 'aria-label': opts.label } });
  const buttons = items.map((t) =>
    h(
      'button',
      {
        class: ['n-g', `n-${kind}__tab`],
        id: `${opts.idPrefix}-${t.id}`,
        // With its count, its name says both apart (« ORDERS 4 »), as the eye reads them.
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === opts.selected), 'aria-controls': `${opts.idPrefix}-${t.id}-panel`, 'aria-label': t.count !== undefined ? `${t.label} ${t.count}` : undefined, tabindex: t.id === opts.selected ? 0 : -1 },
        on: { click: () => opts.onSelect(t.id) },
      },
      t.label,
      t.count !== undefined ? h('span', { class: 'n-tabs__count n-num', text: String(t.count) }) : null,
    ),
  );
  list.addEventListener('keydown', (ev) => {
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const next = ev.key === 'ArrowRight' ? (at + 1) % buttons.length : ev.key === 'ArrowLeft' ? (at - 1 + buttons.length) % buttons.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? buttons.length - 1 : -1;
    if (next < 0) return;
    ev.preventDefault();
    buttons[next]!.focus();
    opts.onSelect(items[next]!.id);
  });
  list.append(...buttons);
  return list;
}

/** A row with a hairline that opens as an accordion (+ / −): its title, an optional line under it, and its panel. */
export function accordionRow(title: string, panel: HTMLElement, opts: { line?: string; open?: boolean; id: string }): HTMLElement {
  const panelId = `${opts.id}-panel`;
  const sign = h('span', { class: 'n-acc__sign' });
  const toggle = h(
    'button',
    { class: 'n-acc', attrs: { type: 'button', 'aria-expanded': String(!!opts.open), 'aria-controls': panelId }, id: opts.id },
    h('span', { class: 'n-acc__text' }, h('span', { class: 'n-g n-t3 n-ivc n-acc__title', text: title }), opts.line ? h('span', { class: 'n-sm n-acc__line', text: opts.line }) : null),
    sign,
  );
  panel.id = panelId;
  panel.classList.add('n-acc__panel');
  const draw = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    sign.replaceChildren(icon(open ? 'minus' : 'plus', { small: true }));
  };
  toggle.addEventListener('click', () => draw(toggle.getAttribute('aria-expanded') !== 'true'));
  draw(!!opts.open);
  return h('div', { class: 'n-acc-item' }, toggle, panel);
}

/**
 * A row with a hairline that leads on (›), as an accordion row is laid out (`.acc`): its title, a line under it (a
 * sentence `sm`, or a label `lb`), a link (`href`) or a button.
 */
export function accLink(title: string | Node, opts: { line?: string | Node; lineKind?: 'sm' | 'lb'; href?: string; onOpen?: () => void; newTab?: boolean; label?: string; extraClass?: string } = {}): HTMLAnchorElement | HTMLButtonElement {
  const text = h(
    'span',
    { class: 'n-acc__text' },
    h('span', { class: 'n-g n-t3 n-ivc n-acc__title' }, title),
    opts.line ? h('span', { class: opts.lineKind === 'lb' ? 'n-g n-lb n-acc__line n-acc__line--lb' : 'n-sm n-acc__line' }, opts.line) : null,
  );
  const children = [text, icon('chev', { small: true })];
  const cls = ['n-acc', opts.extraClass];
  const label = opts.label ? { 'aria-label': opts.label } : {};
  if (opts.href === undefined) return h('button', { class: cls, attrs: { type: 'button', ...label }, on: opts.onOpen ? { click: () => opts.onOpen?.() } : undefined }, ...children);
  if (opts.newTab) return h('a', { class: cls, attrs: { href: opts.href, target: '_blank', rel: 'noopener', ...label } }, ...children);
  const a = appAnchor(opts.href, cls, opts.onOpen, ...children);
  if (opts.label) a.setAttribute('aria-label', opts.label);
  return a;
}

/** A row of a sheet that leads on (›, `.row`): a link (`href`) or a button (`onOpen`), its label in Gravesend capitals. */
export function leadRow(label: string, opts: { href?: string; onOpen?: () => void; newTab?: boolean; extraClass?: string; attrs?: Record<string, string> } = {}): HTMLAnchorElement | HTMLButtonElement {
  const children = [h('span', { class: 'n-g n-row__label', text: label }), icon('chev', { small: true })];
  const cls = ['n-row', 'n-row--lead', opts.extraClass];
  if (opts.href === undefined) return h('button', { class: cls, attrs: { type: 'button', ...opts.attrs }, on: opts.onOpen ? { click: () => opts.onOpen?.() } : undefined }, ...children);
  if (opts.newTab) return h('a', { class: cls, attrs: { href: opts.href, target: '_blank', rel: 'noopener', ...opts.attrs } }, ...children);
  return appAnchor(opts.href, cls, opts.onOpen, ...children);
}

/** Facts: `.dl` (a label in ash, its value at the right, 14 px rows) or `.kv` (a Gravesend label, 13.5 px rows). */
export function definitionList(list: readonly (readonly [string, string | Node])[], opts: { kind?: 'dl' | 'kv'; extraClass?: string } = {}): HTMLDListElement {
  const kind = opts.kind ?? 'dl';
  return h(
    'dl',
    { class: [`n-${kind}`, opts.extraClass] },
    ...list.map(([label, value]) =>
      h('div', { class: `n-${kind}__row` }, h('dt', { class: kind === 'kv' ? 'n-g n-kv__label' : 'n-dl__label', text: label }), h('dd', { class: `n-${kind}__value` }, value)),
    ),
  );
}

/** A field underlined on the dark: its label (Gravesend), the input, and the hint it is described by. */
export function field(id: string, label: string, input: HTMLInputElement, hint?: string): HTMLElement {
  input.id = id;
  input.classList.add('n-fld__input');
  const hintEl = hint ? h('p', { class: 'n-sm n-fld__hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'n-fld-group' }, h('label', { class: 'n-fld', attrs: { for: id } }, h('span', { class: 'n-g n-lab', text: label })), input, hintEl);
}

/** A plate card: the plate, a hairline frame inset 14 px; centred unless `left`. */
export function plateCard(children: (Node | null)[], opts: { left?: boolean; extraClass?: string; label?: string } = {}): HTMLElement {
  return h('article', { class: ['n-card', opts.left ? 'n-card--left' : null, opts.extraClass], attrs: { 'aria-label': opts.label } }, ...children);
}

// ── Photographs ────────────────────────────────────────────────────────────

/**
 * A photograph shown whole at the column's full width (never cropped), on the photograph's ground while it loads; with
 * `fade` (a hero's, a list's) it dissolves into the ground at its top (22 %) and its foot (46 %). `height` is the
 * canvas's (390 px for a square one).
 */
export function fadedPhoto(src: string, alt: string, opts: { height?: number; fade?: boolean; eager?: boolean; extraClass?: string } = {}): HTMLElement {
  const box = h('div', { class: ['n-ph', 'n-ph--contain', opts.fade === false ? null : 'n-fade', opts.extraClass] });
  box.style.height = `${opts.height ?? 390}px`;
  box.append(h('img', { attrs: { src, alt, decoding: 'async', loading: opts.eager ? 'eager' : 'lazy' } }));
  return box;
}

/** The text that rises onto a faded photograph's foot (56 px), in the column's margin. */
export function lift(children: (Node | null)[], opts: { center?: boolean; extraClass?: string } = {}): HTMLElement {
  return h('div', { class: ['n-px', 'n-lift', opts.center ? 'n-ctr' : null, opts.extraClass] }, ...children);
}

// ── Figures ────────────────────────────────────────────────────────────────

/** A countdown: each figure in weight 200 over its unit, colons between them; one line (no figure parts from its unit). */
export function countdown(groups: readonly (readonly [string, string])[], opts: { label?: string } = {}): HTMLElement {
  const parts: HTMLElement[] = [];
  groups.forEach(([value, unit], i) => {
    if (i > 0) parts.push(h('em', { class: 'n-cd__sep', attrs: { 'aria-hidden': 'true' }, text: ':' }));
    parts.push(h('div', { class: 'n-cd__group' }, h('b', { class: 'n-cd__value', text: value }), h('span', { class: 'n-g n-cd__unit', text: unit })));
  });
  return h('div', { class: 'n-cd n-num', attrs: { role: 'timer', 'aria-label': opts.label } }, ...parts);
}

/** The tier as five dots, `on` of them filled (the pieces held, to five). Decorative: the words say it. */
export function tierDots(on: number, opts: { start?: boolean } = {}): HTMLElement {
  const n = Math.max(0, Math.min(5, Math.floor(on)));
  return h(
    'div',
    { class: ['n-meter', opts.start ? 'n-meter--start' : null], attrs: { 'aria-hidden': 'true' } },
    ...Array.from({ length: 5 }, (_, i) => h('i', { class: ['n-meter__dot', i < n ? 'is-on' : null] })),
  );
}

// ── Controls ───────────────────────────────────────────────────────────────

/** A switch (`.sw`): a checkbox with the switch role, its label beside it in the row that holds it. */
export function switchControl(opts: { label: string; checked: boolean; onChange(on: boolean): void }): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'n-sw__input', attrs: { type: 'checkbox', role: 'switch', 'aria-label': opts.label } });
  input.checked = opts.checked;
  input.addEventListener('change', () => opts.onChange(input.checked));
  return { el: h('span', { class: 'n-sw' }, input, h('i', { class: 'n-sw__track', attrs: { 'aria-hidden': 'true' } })), input };
}

export interface VariantDot {
  id: string;
  label: string;
  /** Its colour, #RRGGBB (models.variant_swatch): the dot is drawn from it with the canvas's soft highlight. */
  swatch: string;
}

/** A model's variant dots: each a 16 px dot over its label, pressed when selected (a ring round it). */
export function variantDots(dots: readonly VariantDot[], opts: { selected: string; label: string; onSelect(id: string): void }): HTMLElement {
  return h(
    'div',
    { class: 'n-vsel', attrs: { role: 'group', 'aria-label': opts.label } },
    ...dots.map((d) => {
      const dot = h('i', { class: 'n-vsel__dot', attrs: { 'aria-hidden': 'true' } });
      dot.style.backgroundImage = swatchGradient(d.swatch);
      return h('button', { class: 'n-vsel__option', attrs: { type: 'button', 'aria-pressed': String(d.id === opts.selected) }, on: { click: () => opts.onSelect(d.id) } }, dot, d.label);
    }),
  );
}

/** A finish's dot in a line of facts (`.fin`), 12 px, drawn from its swatch. */
export function finishDot(swatch: string, label: string): HTMLElement {
  const dot = h('i', { class: 'n-fin__dot', attrs: { 'aria-hidden': 'true' } });
  dot.style.backgroundImage = swatchGradient(swatch);
  return h('span', { class: 'n-fin__item' }, dot, label);
}

/** The sizes (16 · 17 · 18), each a 78 × 54 button in the reading face, the selected one doubly ringed. */
export function sizeButtons(sizes: readonly { id: string; label: string }[], opts: { selected: string | null; label: string; onSelect(id: string): void }): HTMLElement {
  return h(
    'div',
    { class: 'n-sizes', attrs: { role: 'group', 'aria-label': opts.label } },
    ...sizes.map((z) => h('button', { class: 'n-sizes__option n-num', attrs: { type: 'button', 'aria-pressed': String(z.id === opts.selected) }, on: { click: () => opts.onSelect(z.id) }, text: z.label })),
  );
}

export interface OrderStep {
  label: string;
  /** Its date once reached, else null. */
  date: string | null;
  done: boolean;
  /** The step the order is at. */
  current: boolean;
}

/**
 * The steps of an order: a dot each on a hairline, the bar drawn to the step reached, each with its label and date;
 * a list for assistive technologies, its current step marked (aria-current).
 */
export function orderSteps(steps: readonly OrderStep[], opts: { label: string; bar?: 'auto' | 'none' | 'end' }): HTMLElement {
  const at = steps.reduce((last, st, i) => (st.done ? i : last), -1);
  const bar = h('span', { class: 'n-steps__bar', attrs: { 'aria-hidden': 'true' } });
  const list = h(
    'div',
    { class: 'n-steps', attrs: { role: 'list', 'aria-label': opts.label } },
    bar,
    ...steps.map((st) =>
      h(
        'div',
        { class: ['n-steps__step', st.done ? 'is-done' : null], attrs: { role: 'listitem', 'aria-current': st.current ? 'step' : null } },
        h('i', { class: 'n-steps__dot', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'n-g n-steps__label', text: st.label }),
        st.date ? h('p', { class: 'n-steps__date n-num', text: st.date }) : null,
      ),
    ),
  );
  // A column per step, four at least (C32: a cancelled order's two steps in the four columns of the way); the hairline
  // runs from the first dot to the last column, the bar to the step reached (`auto`). A cancelled order has no bar
  // (`none`); a returned one's runs to the end of the line (`end`, C32: its fifth column).
  const n = Math.max(4, steps.length);
  list.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  list.style.setProperty('--n-steps-last', `${100 / n}%`);
  const mode = opts.bar ?? 'auto';
  if (mode === 'end' && at > 0) bar.style.width = 'calc(100% - 10px)';
  else if (mode === 'auto' && at > 0) bar.style.width = `${(at / n) * 100}%`;
  else bar.hidden = true;
  return list;
}

// ── A result's marks and its contact (C9, C13–C17) ─────────────────────────

/**
 * The tone mark above a result's word and a problem's title (n.py TONE), 44 px, in ivory: authentic, the ring and its
 * core; caution, the ring and a moon; void, the empty ring. Decorative: the word says it.
 */
export function toneMark(tone: 'authentic' | 'caution' | 'void'): SVGSVGElement {
  const svg = s(
    'svg',
    { class: `n-tone n-tone--${tone}`, viewBox: '0 0 44 44', 'aria-hidden': 'true', focusable: 'false' },
    s('circle', { class: 'n-tone__ring', cx: 22, cy: 22, r: 20 }),
  );
  if (tone === 'authentic') svg.append(s('circle', { class: 'n-tone__core', cx: 22, cy: 22, r: 7.5 }));
  // The canvas's moon (n.py TONE.caution) closes on itself and draws nothing; the plan's caution mark is the ring and
  // a moon: the same 8 px circle at the centre, a crescent of it.
  if (tone === 'caution') svg.append(s('path', { class: 'n-tone__core', d: 'M22 14A8 8 0 0 0 22 30A3 8 0 0 1 22 14z' }));
  return svg;
}

/** How ORBES Client Services is reached, each line when configured. */
export interface ContactLines {
  mailto?: string;
  phone?: { label: string; href: string };
  hours?: string;
  placement?: string;
}

/**
 * ORBES Client Services (n.py contact()): CONTACT ORBES CLIENT SERVICES (the prefilled email, in Gravesend), the phone
 * (its accessible name says the call) and the hours, one under the other on the margin.
 */
export function contactLines(c: ContactLines, labels: { action: string; call: string }): HTMLElement {
  return h(
    'div',
    { class: 'n-contact', data: c.placement ? { placement: c.placement } : undefined },
    c.mailto ? h('a', { class: 'n-g n-contact__email', attrs: { href: c.mailto }, text: labels.action }) : null,
    c.phone ? h('a', { class: 'n-num n-contact__phone', attrs: { href: c.phone.href, 'aria-label': `${labels.call} ${c.phone.label}` }, text: c.phone.label }) : null,
    c.hours ? h('span', { class: 'n-contact__hours', text: c.hours }) : null,
  );
}

// ── States of a page (C40) ─────────────────────────────────────────────────

/** A page while it reads: the monogram breathing (decorative; still when the phone asks for less motion) above ONE MOMENT…, the status read aloud. */
export function loadingState(text: string, opts: { extraClass?: string } = {}): HTMLElement {
  return h(
    'div',
    { class: ['n-loading', opts.extraClass] },
    monogram(40, { extraClass: 'n-breath' }),
    h('p', { class: 'n-g n-lb n-ivc n-ctr n-loading__text', attrs: { role: 'status' }, text }),
  );
}

/** A page that could not be shown: its sentence (ivory), the reason (ash), and TRY AGAIN, a hairline button. */
export function failedState(opts: { sentence: string; reason: string; retry: string; onRetry(): void; retryClass?: string; extraClass?: string }): HTMLElement {
  return h(
    'section',
    { class: ['n-ctr', 'n-failed', opts.extraClass], attrs: { role: 'alert' } },
    h('p', { class: 'n-tx n-ivc n-failed__sentence', text: opts.sentence }),
    opts.reason ? h('p', { class: 'n-sm n-failed__reason', text: opts.reason }) : null,
    button(opts.retry, { outline: true, onClick: () => opts.onRetry(), extraClass: ['n-failed__retry', opts.retryClass].filter(Boolean).join(' ') }),
  );
}

/** An empty page's sentence, or an owners-only or not-found one, in its own words (`.sm`). */
export function quietLine(text: string, extraClass?: string): HTMLParagraphElement {
  return h('p', { class: ['n-sm', 'n-quiet', extraClass], text });
}

// ── The chrome ─────────────────────────────────────────────────────────────

/** The chapters of the rail, in its order. */
export const CHAPTERS = ['now', 'releases', 'collection', 'circle', 'pieces'] as const;
export type Chapter = (typeof CHAPTERS)[number];

/** A link that opens in a new tab, so the screen it leaves stays as it was. */
const NEW_TAB = { target: '_blank', rel: 'noopener' } as const;

/**
 * The footer, as on the canvas: the monogram; PRIVACY · TERMS · LEGAL · HELP (a new tab, so the screen stays); SOUND
 * ON / OFF (the sound signature, P-D07: its accessible name SOUND, its state pressed); DB-IP's attribution; © ORBES ·
 * PARIS (in ash: the canvas's smoke is under 4.5 : 1; © ORBES · GENOME CODE · PARIS from 560 px wide, as before).
 */
export function footer(sound: SoundSwitch | null, onSound: () => void): { el: HTMLElement; soundButton: HTMLButtonElement | null } {
  let soundButton: HTMLButtonElement | null = null;
  if (sound) {
    const state = h('b', { class: 'n-snd__state', attrs: { 'aria-hidden': 'true' } });
    soundButton = h('button', { class: 'n-g n-snd', attrs: { type: 'button' }, on: { click: () => onSound() } }, `${SOUND.label} `, state);
  }
  const el = h(
    'footer',
    { class: 'n-foot' },
    monogram(38, { label: true }),
    h(
      'nav',
      { class: 'n-g n-fl', attrs: { 'aria-label': LEGAL.label } },
      ...LEGAL_PAGES.map((page) => h('a', { class: 'n-fl__link', attrs: { href: legalPath(page), ...NEW_TAB }, text: LEGAL.links[page] })),
    ),
    soundButton ? h('p', { class: 'n-foot__sound' }, soundButton) : null,
    h('p', { class: 'n-foot__credit' }, h('a', { class: 'n-g n-dbip', attrs: { href: GEOIP_ATTRIBUTION.href, ...NEW_TAB }, text: GEOIP_ATTRIBUTION.text })),
    // GENOME CODE joins the line on a screen 560 px wide or more, as the landing's foot had it before NOCTURNE.
    h('p', { class: 'n-g n-cr' }, '© ORBES', h('span', { class: 'n-cr__wide', text: ' · GENOME CODE' }), ' · PARIS'),
  );
  return { el, soundButton };
}

/** SOUND ON / OFF drawn from the switch: pressed when on. */
export function drawSound(button: HTMLButtonElement, sound: SoundSwitch): void {
  button.setAttribute('aria-pressed', String(sound.on));
  const state = button.querySelector('.n-snd__state');
  if (state) state.textContent = sound.on ? SOUND.on : SOUND.off;
}
