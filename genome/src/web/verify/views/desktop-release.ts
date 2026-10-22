/**
 * A release's pages on a computer (desktop, BRIEF §3, §6, §10.27, §10.30): what the desktop layout changes in
 * them, not only in their styles (shared/desktop.ts watchBar applies it each time a page is drawn, and undoes it on a
 * phone, every element back where it stood).
 *
 * - A draw's page (views/releases.ts): its photograph and its words a page frame (`d-pframe`), the words in its two
 *   blocks (shared/desktop.ts); under it THE RELEASE beside YOUR ENTRY (shared/desktop.css), then THE DRAW's words
 *   beside its seed, then THE ENTRIES as a table across the canvas: the head of its columns (RANK, TIER, SENIORITY,
 *   SIZE, IDENTIFIER) over the ranked entries, held under the bar while they scroll.
 * - A LIVE RELEASE's pages before and after the room (views/live.ts): the photograph (or the seal) and the words a page
 *   frame; announced, ADD TO CALENDAR under the time in its right block, then the release's description and the way the
 *   places are drawn beside I'LL BE THERE (and WHO MAY ENTER); once over, THIS RELEASE IS OVER and the account's part
 *   in the right block, the description beside the receipt or the question after; at the end of a visit, what happened
 *   in the right block, WRITE TO ORBES CLIENT SERVICES beside the question after. (A computer draws the
 *   end of a visit as the Cinema room, views/desktop-room.ts: its page is no longer NOCTURNE's there, so this is not
 *   applied to it.)
 */
import { h } from '../../shared/dom.js';
import type { Arrangement } from '../../shared/desktop.js';
import { DESKTOP, RELEASES } from '../copy.js';
import { withNumerals } from './common.js';

/** An element moved for the desktop and the mark left where it stood; and the boxes made to hold them. */
const placed = new Map<HTMLElement, Comment>();
const made = new Set<HTMLElement>();

/** Moves `el` to the end of `into` (or before `before` in it), leaving a mark where it stood. */
function place(el: HTMLElement, into: HTMLElement, before: Node | null = null): void {
  if (el.parentElement === into && (before === null ? into.lastElementChild === el : el.nextSibling === before)) return;
  if (!placed.has(el)) {
    const mark = document.createComment('d-release');
    el.before(mark);
    placed.set(el, mark);
  }
  into.insertBefore(el, before);
}

/** A box of the desktop layout, made where `at` stands (before it). */
function box(cls: string, at: Element): HTMLElement {
  const b = h('div', { class: cls });
  at.before(b);
  made.add(b);
  return b;
}

/** Forgets what a page drawn anew left behind (its elements and boxes gone with it). */
function forget(): void {
  for (const [el, mark] of placed) if (!el.isConnected && !mark.isConnected) placed.delete(el);
  for (const b of made) if (!b.isConnected) made.delete(b);
  for (const title of rebroken.keys()) if (!title.isConnected) rebroken.delete(title);
  for (const el of parted.keys()) if (!el.isConnected) parted.delete(el);
  for (const el of roled.keys()) if (!el.isConnected) roled.delete(el);
  for (const head of headed.keys()) if (!head.isConnected) headed.delete(head);
  for (const row of framedRows) if (!row.isConnected) framedRows.delete(row);
}

// ── A release's title ────────────────────────────────────────────────────────

/** Each title broken anew for the desktop, and what it held before (put back on a phone). */
const rebroken = new Map<HTMLElement, ChildNode[]>();

/**
 * A release's title in its frame, at most two lines (§10.5, §10.9): broken after its last comma where it has one
 * (`MONOLITHE IN STEEL,` / `THE GUARANTEED DRAW OF OCTOBER`, as `MONOLITHE,` / `THE OCTOBER DRAW` already is), its
 * second line kept whole and the size fitted to it (shared/desktop.ts); else as the page breaks it (the model's name on
 * its line: `MONOLITHE` / `IN BLUE`). The words, and what reads them, are the same.
 */
function breakAtComma(title: HTMLElement): void {
  if (rebroken.has(title)) return;
  const br = title.querySelector(':scope > br');
  const text = (title.textContent ?? '').replace(/\s+/g, ' ').trim();
  const comma = text.lastIndexOf(', ');
  if (!br || comma < 0) return;
  const head = text.slice(0, comma + 1);
  const tail = text.slice(comma + 2);
  if (!tail.includes(' ')) return;
  let before = '';
  for (let n = title.firstChild; n && n !== br; n = n.nextSibling) before += n.textContent ?? '';
  if (before.trim() === head) return;
  rebroken.set(title, [...title.childNodes]);
  title.replaceChildren(...withNumerals(`${head} `), document.createElement('br'), ...withNumerals(tail));
}

function undoTitles(): void {
  for (const [title, nodes] of rebroken) if (title.isConnected) title.replaceChildren(...nodes);
  rebroken.clear();
}

// ── Lines set in parts on a computer ─────────────────────────────────────────

/** Each line set anew in parts for the desktop, and what it held before (put back on a phone, as the page drew it). */
const parted = new Map<HTMLElement, ChildNode[]>();

/** Sets `el`'s words anew from its text, in parts the desktop places; the words and what reads them are the same. */
function inParts(el: HTMLElement, build: (text: string) => (string | Node)[]): void {
  if (parted.has(el)) return;
  parted.set(el, [...el.childNodes]);
  el.replaceChildren(...build(el.textContent ?? ''));
}

/** Parts of a line between its separators (` · `), the separators kept between them in spans of their own. */
function between(text: string, sep: string, part: string, each: (t: string) => (string | Node)[]): (string | Node)[] {
  return text.split(' · ').flatMap((t, i) => [...(i > 0 ? [h('span', { class: sep, text: ' · ' })] : []), h('span', { class: part }, ...each(t))]);
}

/**
 * A line of THE ENTRIES (`12 · PLATINE · 2 YEARS · SIZE 17`, `GUARANTEED · 2 PIECES`): each value a span, the table's
 * cells (§10.30).
 */
function entryCells(line: string): (string | Node)[] {
  // Macro scope K44 T1: a set's entry, its sizes one cell (SIZE 17 · 52 · 45), its own separators kept in it.
  const parts = line.split(' · ');
  if (parts.length > 4 && /^\d+$/.test(parts[0]!)) {
    const sizes = parts.slice(3).join(' · ');
    return [...between(parts.slice(0, 3).join(' · '), 'n-release__sep', 'n-release__cell', (t) => withNumerals(t)), h('span', { class: 'n-release__sep', text: ' · ' }), h('span', { class: 'n-release__cell' }, ...withNumerals(sizes))];
  }
  return between(line, 'n-release__sep', 'n-release__cell', (t) => withNumerals(t));
}

/** P-X02's openings (`PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …`): one tier's to a line, each time kept whole. */
function accessParts(line: string): (string | Node)[] {
  const timed = (text: string) => text.split(/(\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2})/).flatMap((p, i) => (p === '' ? [] : i % 2 === 1 ? [h('span', { class: 'n-nw' }, ...withNumerals(p))] : withNumerals(p)));
  return line.split(/ · (?=[A-Z][A-Z ]*: )/).flatMap((phase, i) => [...(i > 0 ? [h('span', { class: 'n-release__phase-sep', text: ' · ' })] : []), h('span', { class: 'n-release__phase' }, ...timed(phase))]);
}

/** YOUR ENTRY and its identifier, the identifier in a span of its own (selected whole in one click, §10.19). */
function entryIdParts(text: string): (string | Node)[] {
  const at = text.lastIndexOf(' ');
  return at < 0 ? [text] : [text.slice(0, at + 1), h('span', { class: 'n-release__entry-ref', text: text.slice(at + 1) })];
}

/**
 * A time on this computer under its UTC (`4 OCT 2026 · 12:00 on this computer (UTC+02:00)`): the date and its hour
 * one group, the zone's words another, so a narrow column breaks the line only between them (§10.9).
 */
function localParts(text: string): (string | Node)[] {
  const m = /^(\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2}) (.+)$/.exec(text);
  return m ? [h('span', { class: 'n-nw' }, ...withNumerals(m[1]!)), ' ', h('span', { class: 'n-nw' }, ...withNumerals(m[2]!))] : withNumerals(text);
}

function partLines(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('.view--release .n-release__hero.d-pframe .n-release__state')) inParts(el, (t) => between(t, 'n-release__state-sep', 'n-release__state-part', (x) => [x]));
  for (const el of root.querySelectorAll<HTMLElement>('.view--release .n-release__hero.d-pframe .n-release__access')) inParts(el, accessParts);
  for (const el of root.querySelectorAll<HTMLElement>('.view--release .n-release__item-line')) inParts(el, entryCells);
  for (const el of root.querySelectorAll<HTMLElement>('.view--release .n-release__entry-id')) inParts(el, entryIdParts);
  for (const el of root.querySelectorAll<HTMLElement>('.view--release .n-release__row .release__local')) inParts(el, localParts);
}

// ── A page's h1 where the phone has none ────────────────────────────────────

/** Each sentence set as an h1 on a computer, and the element it stood as (put back on a phone). */
const headed = new Map<HTMLElement, HTMLElement>();

/**
 * An address that leads to no release (C40): on a phone its sentence alone names the page; on a computer it is the
 * page's h1 (§10.32), the same words, id and focus.
 */
function headMissing(root: ParentNode): void {
  const line = root.querySelector<HTMLElement>('.view--release .n-release__missing > p.release__missing');
  if (!line) return;
  const head = h('h1', { class: [...line.classList, 'd-missing__title'], attrs: { id: line.id || undefined, tabindex: line.getAttribute('tabindex') ?? undefined } }, ...line.childNodes);
  const focused = document.activeElement === line;
  line.replaceWith(head);
  headed.set(head, line);
  if (focused) head.focus({ preventScroll: true });
}

function undoHeads(): void {
  for (const [head, line] of headed) {
    if (!head.isConnected) continue;
    const focused = document.activeElement === head;
    line.replaceChildren(...head.childNodes);
    head.replaceWith(line);
    if (focused) line.focus({ preventScroll: true });
  }
  headed.clear();
}

function undoParts(): void {
  for (const [el, nodes] of parted) if (el.isConnected) el.replaceChildren(...nodes);
  parted.clear();
}

// ── A draw's frame: the time of its phase ───────────────────────────────────

const WHEN = 'n-release__frame-when';
const FRAMED_ROW = 'd-release__row--framed';
/** THE RELEASE's rows whose time stands in the frame's right block (hidden in the facts on a computer). */
const framedRows = new Set<HTMLElement>();

/**
 * A draw's frame on a computer gives, under its state in the right block, the time of its phase as NOW's frame gives
 * it (§10.27): soon (and in its early access) when entries open, open when they close, closed or cancelled when they
 * closed; each in UTC (`ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC`), then on this computer under it. THE RELEASE's row of
 * that time is then not repeated in the facts (one place per piece of information); its words are the row's own. None
 * once drawn (THIS RELEASE IS OVER and the account's part stand there).
 */
function frameWhen(root: ParentNode): void {
  const page = root.querySelector<HTMLElement>('.view--release');
  const words = page?.querySelector<HTMLElement>(':scope > .n-release__hero.d-pframe > .n-release__words');
  const existing = words?.querySelector<HTMLElement>(`.${WHEN}`) ?? null;
  const state = page?.dataset.release ?? '';
  const label = state === 'upcoming' ? RELEASES.rows.opens : state === 'open' || state === 'closed' || state === 'cancelled' ? RELEASES.rows.closes : null;
  const row = label && page ? [...page.querySelectorAll<HTMLElement>('.n-release__section .n-release__row')].find((r) => r.querySelector('dt')?.textContent?.trim() === label) : undefined;
  const utc = row?.querySelector('.release__utc')?.textContent?.trim() ?? '';
  for (const r of framedRows) {
    if (r !== row) {
      r.classList.remove(FRAMED_ROW);
      framedRows.delete(r);
    }
  }
  if (!words || !label || !row || !utc) {
    if (existing && !existing.closest('.d-frame__aside')) existing.remove();
    else if (existing) existing.replaceChildren();
    return;
  }
  if (!row.classList.contains(FRAMED_ROW)) row.classList.add(FRAMED_ROW);
  framedRows.add(row);
  const local = row.querySelector('.release__local')?.textContent?.trim() ?? '';
  const key = JSON.stringify([label, utc, local]);
  if (existing && existing.dataset.key === key) return;
  const lines: HTMLElement[] = [h('p', { class: 'n-g n-lb n-release__when' }, `${label} `, h('span', { class: 'n-nw' }, ...withNumerals(utc)))];
  if (local) lines.push(h('p', { class: 'n-sm n-num n-release__when-local' }, ...localParts(local)));
  // Once its block is gathered (shared/desktop.ts), its words change in place, never the element.
  if (existing) {
    existing.replaceChildren(...lines);
    existing.dataset.key = key;
    return;
  }
  const when = h('div', { class: WHEN, attrs: { 'data-key': key } }, ...lines);
  const state0 = words.querySelector<HTMLElement>(':scope > .n-release__state');
  if (state0) state0.after(when);
  else words.append(when);
  made.add(when);
}

function undoFrameWhen(): void {
  for (const r of framedRows) r.classList.remove(FRAMED_ROW);
  framedRows.clear();
}

// ── A draw's page ────────────────────────────────────────────────────────────

const TEXT = 'd-draw__text';
const SEED = 'd-draw__seed';
const ENTRIES = 'd-draw__entries';
const TABLE = 'd-entries__table';
const HEAD = 'd-entries__head';

/** THE ENTRIES' head row: its columns' names, over the ranked list; SIZE in a draw with sizes. */
function entriesHead(sized: boolean): HTMLElement {
  const e = DESKTOP.entries;
  const cell = (text: string, cls: string) => h('span', { class: ['n-g', 'd-entries__name', cls], attrs: { role: 'columnheader' }, text });
  return h(
    'div',
    { class: HEAD, attrs: { role: 'row' } },
    cell(e.rank, 'd-entries__name--rank'),
    cell(e.tier, 'd-entries__name--tier'),
    cell(e.seniority, 'd-entries__name--years'),
    sized ? cell(e.size, 'd-entries__name--size') : null,
    cell(e.id, 'd-entries__name--id'),
  );
}

/** Each element given a role of the table on a computer, and the role it had (taken back on a phone). */
const roled = new Map<Element, string | null>();

function setRole(el: Element, role: string): void {
  if (el.getAttribute('role') === role) return;
  if (!roled.has(el)) roled.set(el, el.getAttribute('role'));
  el.setAttribute('role', role);
}

/**
 * The ranked list read as a table (§10.30): its rows, and in each its cells (the rank, the tier, the seniority, the
 * size, the identifier, YOURS), under the head row's names; the separators between them are not read.
 */
function tableRoles(ranked: HTMLElement): void {
  setRole(ranked, 'rowgroup');
  for (const item of ranked.querySelectorAll(':scope > .n-release__item')) {
    setRole(item, 'row');
    const line = item.querySelector(':scope > .n-release__item-line');
    if (line) setRole(line, 'none');
    for (const cell of item.querySelectorAll(':scope > .n-release__item-line > .n-release__cell, :scope > .n-release__item-id, :scope > .n-release__item-yours')) setRole(cell, 'cell');
  }
}

function undoRoles(): void {
  for (const [el, role] of roled) {
    if (role === null) el.removeAttribute('role');
    else el.setAttribute('role', role);
  }
  roled.clear();
}

/**
 * THE DRAW: its title and its paragraphs (`d-draw__text`), its seed and the check (`d-draw__seed`), then THE ENTRIES
 * (`d-draw__entries`) with its head row over the ranked list. Drawn again by the page whenever the seed is checked or
 * entries arrive: arranged again then.
 */
function arrangeDraw(draw: HTMLElement): void {
  if (draw.querySelector(`:scope > .${TEXT}`)) return;
  const kids = [...draw.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const seedAt = kids.findIndex((el) => el.matches('.release__seed'));
  if (seedAt < 0) return;
  const entriesAt = kids.findIndex((el) => el.matches('.n-release__entries'));
  const end = entriesAt < 0 ? kids.length : entriesAt;
  const text = box(TEXT, kids[0]!);
  for (const el of kids.slice(0, seedAt)) place(el, text);
  const seed = box(SEED, kids[seedAt]!);
  for (const el of kids.slice(seedAt, end)) place(el, seed);
  if (entriesAt < 0) return;
  const entries = box(ENTRIES, kids[entriesAt]!);
  for (const el of kids.slice(entriesAt)) place(el, entries);
  const ranked = entries.querySelector<HTMLElement>(':scope > .release__list');
  if (ranked) {
    // A draw with sizes: each ranked line holds a fourth value, its size.
    const sized = [...ranked.querySelectorAll('.n-release__item-line')].some((line) => line.querySelectorAll(':scope > .n-release__cell').length > 3);
    entries.classList.toggle('d-entries--sized', sized);
    // The head row and the ranked rows one table, named by THE ENTRIES' heading.
    const table = box(TABLE, ranked);
    table.setAttribute('role', 'table');
    const named = ranked.getAttribute('aria-labelledby');
    if (named) table.setAttribute('aria-labelledby', named);
    table.append(entriesHead(sized));
    place(ranked, table);
    tableRoles(ranked);
  }
}

function undoDraw(): void {
  for (const head of document.querySelectorAll(`.${HEAD}`)) head.remove();
  for (const hero of document.querySelectorAll('.n-release__hero.d-pframe')) hero.classList.remove('d-pframe');
  undoRoles();
}

// ── A LIVE RELEASE's pages before and after the room ────────────────────────

const FRAME = 'd-pframe';
const CANVAS = 'd-live__canvas';
const ROW = 'd-live__row';
const ACTIONS = 'd-live__actions';

/**
 * Two lines of the frame's left block side by side on one baseline (§10.27: the block in the frame's lower third): its
 * type and collection beside its price (or its pieces, once over); A SURPRISE IN EVERY BOX beside SEE THE MODEL.
 */
function pairUp(words: HTMLElement, first: string, second: string): void {
  const a = words.querySelector<HTMLElement>(`:scope > ${first}`);
  const b = words.querySelector<HTMLElement>(`:scope > ${second}`);
  if (!a || !b) return;
  const row = box(ROW, a);
  place(a, row);
  place(b, row);
}

/**
 * The page's photograph (or seal) and its words in one frame; what the frame's right block shows moved into the words
 * (shared/desktop.ts gathers it there); the rest of the page on the canvas, in two columns where it pairs; at the end
 * of a visit its actions in one row under the frame (§10.22).
 */
function arrangeLive(page: HTMLElement): void {
  if (page.querySelector(`:scope > .${FRAME}`)) return;
  const words = page.querySelector<HTMLElement>(':scope > .n-live__words');
  const picture = words?.previousElementSibling;
  if (!words || !(picture instanceof HTMLElement) || !picture.matches('.n-ph, .n-live__seal')) return;
  const frame = box(picture.matches('.n-live__seal') ? `${FRAME} ${FRAME}--sealed` : FRAME, picture);
  place(picture, frame);
  place(words, frame);
  pairUp(words, '.n-live__type', ':is(.n-live__price, .n-live__pieces-line)');
  pairUp(words, '.n-live__surprise', '.n-live__see-line');
  // The frame's right block: ADD TO CALENDAR (after WHO MAY ENTER, it stands with I'LL BE THERE on a phone), THIS
  // RELEASE IS OVER (the phone's plate under the frame), what happened at the end of a visit.
  for (const sel of [':scope > .n-live__after-rules > .n-live__calendar-line', ':scope > .n-live__over', ':scope > .n-live__outcome-block']) {
    const el = page.querySelector<HTMLElement>(sel);
    if (el) place(el, words);
  }
  // At the end of a visit, its actions in one row on the edge, the main one first: WRITE TO ORBES CLIENT SERVICES (an
  // entry removed), THE RELEASES, HOW RELEASES WORK.
  const end = page.matches('.n-live__end');
  if (end) {
    const acts = [...page.querySelectorAll<HTMLElement>(':scope > :is(.n-live__contact, .n-live__back, .n-live__how)')];
    if (acts.length > 0) {
      const row = box(ACTIONS, acts[0]!);
      for (const el of acts) place(el, row);
    }
  }
  // The canvas: on the left the release's description and how its places are drawn; on the right WHO MAY ENTER and
  // I'LL BE THERE, the receipt, the question after.
  const left = [
    ...words.querySelectorAll<HTMLElement>(':scope > :is(.n-live__description, .n-live__rule)'),
    ...page.querySelectorAll<HTMLElement>(':scope > .n-live__after-rules > :is(.n-live__description, .n-live__rule), :scope > .n-live__description'),
  ];
  const right = [
    ...page.querySelectorAll<HTMLElement>(':scope > .n-live__rules'),
    ...words.querySelectorAll<HTMLElement>(':scope > .n-live__there'),
    ...page.querySelectorAll<HTMLElement>(':scope > .n-live__after-rules > .n-live__there, :scope > .n-live__receipt-slot, :scope > .n-question'),
  ];
  if (left.length + right.length === 0) return;
  // At the end of a visit the question after, once open, is the canvas's one block: on the edge, never alone on the right.
  if (end && left.length === 0) left.push(...right.splice(0));
  const a = h('div', { class: 'd-live__a' });
  const b = h('div', { class: 'd-live__b' });
  const canvas = h('div', { class: CANVAS }, a, b);
  frame.after(canvas);
  made.add(canvas);
  for (const el of left) place(el, a);
  for (const el of right) place(el, b);
}

// ── The arrangement ──────────────────────────────────────────────────────────

export const releaseArrangement: Arrangement = {
  apply(root) {
    forget();
    // A draw's page: its photograph's frame (a release without one opens under its crumb).
    for (const hero of root.querySelectorAll<HTMLElement>('.view--release > .n-release__hero')) {
      const framed = hero.querySelector(':scope > .n-ph') !== null;
      if (hero.classList.contains(FRAME) !== framed) hero.classList.toggle(FRAME, framed);
    }
    partLines(root);
    frameWhen(root);
    const draw = root.querySelector<HTMLElement>('.view--release .release__draw');
    if (draw) arrangeDraw(draw);
    const page = root.querySelector<HTMLElement>('.view--live.is-nocturne .live__stage > .n-livepage');
    if (page) arrangeLive(page);
    for (const title of root.querySelectorAll<HTMLElement>('.n-release__hero.d-pframe .n-release__title, .n-livepage > .d-pframe .n-live__title')) breakAtComma(title);
    headMissing(root);
  },
  undo() {
    undoDraw();
    undoFrameWhen();
    undoTitles();
    undoParts();
    undoHeads();
    // Every element back where it stood, then the boxes that held them gone.
    for (const [el, mark] of placed) {
      if (mark.isConnected) mark.replaceWith(el);
      else mark.remove();
    }
    placed.clear();
    for (const b of made) b.remove();
    made.clear();
  },
};
