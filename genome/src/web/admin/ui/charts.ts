/**
 * Hairline curves for the Analytics view (A-09), CSP-safe: the SVG is built
 * element by element (shared/dom.ts `s`), its geometry in attributes, its
 * look in the stylesheet (classes only, never a style attribute), and what
 * moves (the cursor, the labels along the axes) is placed by CSS custom
 * properties set through the CSSOM (`--x`, `--y`), as barList does with `--f`;
 * the readout's side too (`--dx`, from the room the plot has: never past its
 * edges, so the page never scrolls sideways on a phone).
 *
 * The SVG stretches to its box (preserveAspectRatio="none"); its strokes keep
 * their width (`vector-effect: non-scaling-stroke` in the stylesheet), and
 * every label is HTML beside it, so no text is ever stretched.
 */
import { h, s } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { axisLevels, curve, dayReadout, dayTicks, nearestDay, niceMax, readoutPlacement, svgPoints, type Point, type StateRow } from '../model/analytics.js';
import type { AnalyticsData } from '../types.js';
import { statusMark } from './components.js';

/** The viewBox every curve is drawn in, stretched to its box by the stylesheet. */
const W = 1000;
const H = 200;
const SPARK_H = 40;

function place(el: HTMLElement, x: number, y?: number): void {
  // CSSOM custom properties (CSP-safe): the stylesheet positions the element with them.
  el.style.setProperty('--x', String(x));
  if (y !== undefined) el.style.setProperty('--y', String(y));
}

/**
 * Every scan per day over the window: one ink curve against a 1, 2, 5 ceiling, the ceiling (and its
 * half, when a whole number) marked, five day labels, and a cursor (pointer, or the arrow keys once focused) that reads a
 * day: its count, then each state seen that day.
 */
export function trendChart(d: AnalyticsData): HTMLElement {
  const values = d.daily.map((x) => x.total);
  const ceiling = niceMax(Math.max(0, ...values));
  const points = curve(values, ceiling);

  const levels = axisLevels(ceiling);
  const svg = s(
    'svg',
    { class: 'trend__svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
    ...levels.map((l) => s('line', { class: l.y === 0 ? 'trend__base' : 'trend__grid', x1: 0, y1: (1 - l.y) * H, x2: W, y2: (1 - l.y) * H })),
    s('polyline', { class: 'trend__line', points: svgPoints(points, W, H) }),
  );

  const yLabels = h(
    'div',
    { class: 'trend__yaxis', attrs: { 'aria-hidden': 'true' } },
    ...levels.map((l) => {
      const label = h('span', { class: 'trend__ylabel' }, formatCount(l.value));
      place(label, 0, l.y);
      return label;
    }),
  );

  const cursor = h('span', { class: 'trend__cursor', attrs: { hidden: true, 'aria-hidden': 'true' } });
  const dot = h('span', { class: 'trend__dot', attrs: { hidden: true, 'aria-hidden': 'true' } });
  const tip = h('div', { class: 'trend__tip', attrs: { hidden: true, 'aria-hidden': 'true', 'data-testid': 'analytics-tip' } });
  const plot = h(
    'div',
    {
      class: 'trend__plot',
      attrs: {
        tabindex: '0',
        role: 'slider',
        'aria-label': 'Scans per day. Arrow keys read one day.',
        'aria-valuemin': 0,
        'aria-valuemax': Math.max(0, d.daily.length - 1),
        'data-testid': 'analytics-trend',
      },
    },
    svg,
    cursor,
    dot,
    tip,
  );

  // The readout's side from the room the plot actually has, measured once its day is written in it.
  const placeTip = (p: Point) => {
    const { dx, low } = readoutPlacement(p, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: plot.clientWidth, height: plot.clientHeight });
    tip.style.setProperty('--dx', `${Math.round(dx)}px`);
    tip.classList.toggle('trend__tip--low', low);
  };

  let current = d.daily.length - 1;
  const show = (index: number) => {
    if (d.daily.length === 0) return;
    current = Math.max(0, Math.min(d.daily.length - 1, index));
    const p = points[current];
    const r = dayReadout(d, current);
    place(cursor, p.x);
    place(dot, p.x, p.y);
    place(tip, p.x);
    tip.replaceChildren(
      h('p', { class: 'trend__tip-total' }, r.total),
      h('p', { class: 'trend__tip-day' }, r.day),
      ...r.lines.map((l) => h('p', { class: 'trend__tip-line' }, statusMark(l.label, l.tone), h('span', { class: 'trend__tip-value' }, l.value))),
    );
    cursor.hidden = dot.hidden = tip.hidden = false;
    placeTip(p);
    plot.setAttribute('aria-valuenow', String(current));
    plot.setAttribute('aria-valuetext', [r.day, r.total, ...r.lines.map((l) => `${l.label} ${l.value}`)].join(', '));
  };
  const hide = () => {
    if (document.activeElement === plot) return;
    cursor.hidden = dot.hidden = tip.hidden = true;
  };
  plot.addEventListener('pointermove', (ev) => {
    const box = plot.getBoundingClientRect();
    if (box.width > 0) show(nearestDay((ev.clientX - box.left) / box.width, d.daily.length));
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('focus', () => show(current));
  plot.addEventListener('blur', () => {
    cursor.hidden = dot.hidden = tip.hidden = true;
  });
  plot.addEventListener('keydown', (ev) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7 };
    if (ev.key in step) show(current + step[ev.key]);
    else if (ev.key === 'Home') show(0);
    else if (ev.key === 'End') show(d.daily.length - 1);
    else return;
    ev.preventDefault();
  });
  if (d.daily.length > 0) plot.setAttribute('aria-valuenow', String(current));

  const axis = h(
    'div',
    { class: 'trend__axis', attrs: { 'aria-hidden': 'true' } },
    ...dayTicks(d.daily.map((x) => x.day)).map((t, i, all) => {
      const tick = h('span', { class: ['trend__tick', i === 0 && all.length > 1 ? 'trend__tick--first' : null, i === all.length - 1 && all.length > 1 ? 'trend__tick--last' : null] }, t.label);
      place(tick, t.x);
      return tick;
    }),
  );

  return h('figure', { class: 'trend' }, h('div', { class: 'trend__frame' }, yLabels, plot), axis);
}

/** One state's day-by-day curve, scaled to its own busiest day; a flat hairline when it has none. */
export function sparkline(row: StateRow): SVGSVGElement {
  const ceiling = Math.max(0, ...row.values);
  const label = `${row.label}: ${formatCount(row.total)} ${row.total === 1 ? 'scan' : 'scans'}${row.peak ? `, busiest day ${row.peak}` : ''}`;
  // The tooltip on hover; textContent, never markup.
  const title = s('title');
  title.textContent = label;
  return s(
    'svg',
    { class: `spark spark--${row.total > 0 ? row.tone : 'zero'}`, viewBox: `0 0 ${W} ${SPARK_H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
    title,
    s('line', { class: 'spark__base', x1: 0, y1: SPARK_H, x2: W, y2: SPARK_H }),
    row.total > 0 ? s('polyline', { class: 'spark__line', points: svgPoints(curve(row.values, ceiling), W, SPARK_H) }) : null,
  );
}
