/**
 * The Horizon band of the stock and the figures' morph (ONE QUEUE, lot Q1 §3.2; ANSWERS C4, C8, r15–r20; D18, D23,
 * D24, D30), ported from the owner's mockup (single-queue/mockups/one-queue-final.preview.html: V3 · HORIZON as refined
 * in round 18, hz-lib.mjs; the morph of round 20, gen.mjs R20_JS), never re-invented.
 *
 *   horizonBand()   the stock as one band without a box: a hairline horizon near its foot, both ends dissolving into the
 *                   vault; the lit part is what is LEFT (full when full, emptying as pieces go, its edge gliding), the
 *                   light pooled above it, its top faded out, the five lights at 75 %; the sun breathing at the edge
 *                   every 4.8 s; LAST PIECES at 10 % left or fewer (the breath deepens, a slow light runs back along
 *                   what is left, the words under the band); at 0 the light goes out. Two tones only, no separator.
 *                   The release's PAUSE: the sun rests at a half-glow and the light holds still; PAUSE PACE: it keeps
 *                   breathing (OP-4). Reduced motion: still. The stock line's words inside it.
 *   morph(el, text) a figure changing: only its changed digits, each resolving from a 1.2 px blur and 1.5 % scale in
 *                   0.8 s, a digit that leaves folding its width away; tabular figures (CSS); reduced motion: at once.
 *                   `appear`: every digit resolves from nothing (THE OPENING's YOUR PLACE, MK Q1).
 *
 * The DOM is built with shared/dom.ts (no markup from data); the band's share is a custom property (CSSOM), as the
 * house sets its other measures. The look is house.css (the phone) and shared/desktop-room.css (the computer).
 */
import { h, prefersReducedMotion } from '../shared/dom.js';
import { LIVE } from './copy.js';
import type { BandModel } from './live-model.js';
import { withNumerals } from './views/common.js';

/** The breath of the sun at the band's edge (the mockup's --qv-breath), in ms. */
const BREATH_MS = 4800;
/** A morph's whole length (its digits' 0.8 s, and a margin), after which the figure is plain text again. */
const MORPH_MS = 850;

const reducedMotion = prefersReducedMotion;

// ── The morph ──────────────────────────────────────────────────────────────

const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** The text as the element shows it at rest: its figures in the reading face (`numerals`), or the figures alone. */
function rest(el: HTMLElement, text: string, numerals: boolean): void {
  if (numerals) el.replaceChildren(...withNumerals(text));
  else el.textContent = text;
}

/** One run of figures, the old over the new, aligned from the right: only the changed digits move. */
function digits(prev: string, next: string): (string | HTMLSpanElement)[] {
  const n = Math.max(prev.length, next.length);
  const out: (string | HTMLSpanElement)[] = [];
  for (let i = 0; i < n; i++) {
    const io = prev.length - n + i;
    const ic = next.length - n + i;
    const o = io < 0 ? '' : prev.charAt(io);
    const c = ic < 0 ? '' : next.charAt(ic);
    if (o === c) out.push(c);
    // A digit that leaves: its width folds away as it fades.
    else if (!c) out.push(h('span', { class: 'live-mf live-mf--out', data: { o }, attrs: { 'aria-hidden': 'true' } }));
    // A digit that changes: the old one drawn by the style (its text is the new one's alone, for the eye's reader and the
    // page's text), the new one resolving where it stood.
    else out.push(h('span', { class: 'live-mf', data: { o } }, h('span', { class: 'live-mf__n', text: c })));
  }
  return out;
}

/**
 * Show `text` in `el`, its changed figures morphing (D30): only the changed digits, aligned from the right of each run
 * of figures, while every word stays as it was; when the words change too (ESTIMATED 2 MINUTES LEFT → 1 MINUTE), or
 * under reduced motion, or the first time, at once. `numerals`: the figures at rest in the reading face (withNumerals,
 * as the room's facts set them); false for a figure alone (YOUR PLACE).
 */
export function morph(el: HTMLElement, text: string, opts: { numerals?: boolean; appear?: boolean } = {}): void {
  const numerals = opts.numerals ?? true;
  // `appear` (THE OPENING: YOUR PLACE morphing in): every figure resolves from nothing, its words as they are.
  const prev = opts.appear ? text.replace(/\d/g, '') : el.dataset.morph;
  if (prev === text && !opts.appear) return;
  const timer = pending.get(el);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(el);
  el.dataset.morph = text;
  const a = prev === undefined ? null : opts.appear ? text.split(/(\d+)/).map((part, i) => (i % 2 === 1 ? '' : part)) : prev.split(/(\d+)/);
  const b = text.split(/(\d+)/);
  const same = a !== null && a.length === b.length && a.every((part, i) => i % 2 === 1 || part === b[i]);
  if (!same || reducedMotion()) {
    rest(el, text, numerals);
    return;
  }
  const parts = b.flatMap((part, i): (string | HTMLSpanElement)[] => {
    if (i % 2 === 0) return part ? [part] : [];
    const run = digits(a[i] ?? '', part);
    return numerals ? [h('span', { class: 'numeral' }, ...run)] : run;
  });
  el.replaceChildren(...parts);
  // The new digits resolve and the old ones leave from their first frame: the styles read before the class is set.
  void el.offsetWidth;
  for (const m of el.querySelectorAll<HTMLElement>('.live-mf')) m.classList.add('is-on');
  pending.set(
    el,
    setTimeout(() => {
      pending.delete(el);
      if (el.dataset.morph === text) rest(el, text, numerals);
    }, MORPH_MS),
  );
}

// ── The Horizon band ───────────────────────────────────────────────────────

export interface HorizonBand {
  el: HTMLElement;
  /** The stock as read; `paused`: the release's PAUSE holds the light still (PAUSE PACE keeps it breathing). */
  set(m: BandModel, paused: 'RELEASE' | 'PACE' | null): void;
}

export function horizonBand(): HorizonBand {
  const pt = h('span', { class: 'live-hz__pt' });
  const art = h(
    'span',
    { class: 'live-hz__art', attrs: { 'aria-hidden': 'true' } },
    h(
      'span',
      { class: 'live-hz__in' },
      h('span', { class: 'live-hz__ground' }),
      h('span', { class: 'live-hz__line' }),
      h('span', { class: 'live-hz__fill' }, h('span', { class: 'live-hz__sky' }), h('span', { class: 'live-hz__lit' }), h('span', { class: 'live-hz__reflect' })),
      h('span', { class: 'live-hz__run' }, h('span', { class: 'live-hz__track' }, h('i'))),
    ),
  );
  const edge = h('span', { class: 'live-hz__edge', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'live-hz__halo' }, h('i')), pt);
  const word = h('p', { class: 'live-hz__word', attrs: { hidden: true }, text: LIVE.lastPieces });
  const words = h('span', { class: 'live-hz__words' });
  const text = h('p', { class: 'live-hz__text' }, words);
  const el = h('div', { class: 'live-hz' }, art, edge, word, text);
  let fraction: number | null = null;
  let wordTimer: ReturnType<typeof setTimeout> | null = null;

  /** The light along what is left leaves the edge at the top of a breath (the mockup's syncRun). */
  const syncRun = (): void => {
    try {
      const a = typeof pt.getAnimations === 'function' ? pt.getAnimations()[0] : undefined;
      const t = a && a.currentTime !== null ? Number(a.currentTime) % BREATH_MS : 0;
      el.style.setProperty('--live-hz-run-delay', `${Math.round((BREATH_MS / 2 - t + BREATH_MS) % BREATH_MS)}ms`);
    } catch {
      // The light runs from its own start.
    }
  };

  return {
    el,
    set(m, paused) {
      const snap = fraction === null;
      // The first reading in place at once; then the edge glides to each new share (the band's own transition).
      if (snap) el.classList.add('is-snap');
      if (fraction !== m.fraction) {
        fraction = m.fraction;
        el.style.setProperty('--live-hz-f', m.fraction.toFixed(4));
      }
      const wasLast = el.classList.contains('is-last');
      if (m.last && !wasLast) syncRun();
      el.classList.toggle('is-last', m.last);
      el.classList.toggle('is-out', m.out);
      el.classList.toggle('is-still', paused === 'RELEASE');
      // LAST PIECES resolves under the band, and fades away when it no longer holds (as the mockup's band does).
      if (wordTimer) clearTimeout(wordTimer);
      wordTimer = null;
      if (m.last) {
        if (word.hidden) {
          word.hidden = false;
          if (!snap && !reducedMotion()) {
            word.classList.add('is-hidden');
            void word.offsetWidth;
          }
        }
        word.classList.remove('is-hidden');
      } else if (!word.hidden) {
        if (snap || reducedMotion()) word.hidden = true;
        else {
          word.classList.add('is-hidden');
          wordTimer = setTimeout(() => {
            wordTimer = null;
            if (word.classList.contains('is-hidden')) word.hidden = true;
          }, 1700);
        }
      }
      morph(words, m.text);
      if (snap) {
        void el.offsetWidth;
        el.classList.remove('is-snap');
      }
    },
  };
}
