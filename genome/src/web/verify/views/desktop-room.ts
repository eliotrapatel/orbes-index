/**
 * The LIVE RELEASE's room on a computer (desktop, BRIEF §5.7, decision 7: the Cinema room): every screen of the
 * room and the after-room staged over the release's model (variant) photograph, filling the window, darkened; the ORBES
 * wordmark top left and the count in the room top right; in the centre the door, the countdown, the line, the seal to
 * hold, the piece secured, with the host's messages under them; in the corners, bottom left the release's name and its
 * choice, bottom right the collector's own part (READY CHECK and ENTER THE ROOM, the add-ons and PAY). The one queue
 * (ONE QUEUE): its place and the pieces left in the centre, its time left bottom right, LEAVE THE LINE under the name. The room's own foot (HOW RELEASES WORK, THE RELEASES, SOUND, the legal pages) under the
 * window, in one row. CONFIRMED comes out into the light: the photograph gives way to the house's ivory, its words
 * beside its receipt. No menu, no SCAN, no account button (the phone's room hides them too); its controls are the room's
 * own, the tab order with them.
 *
 * views/live.ts draws every screen as on the phone, then hands it here on a computer (`arrange`): its elements are moved
 * into the stage's places, each leaving a mark where it stood, and put back there on a phone (`undo`) or before the
 * screen gives way to the next (`release`). What the corners add from the room's data (the name with its variant, the
 * choice, the count in the room) is drawn here, refreshed at each change of the room (`update`). The room stays dark in
 * both modes (decision 9): it is not one of NOCTURNE's screens, light.css never reaches it (shared/desktop-room.css).
 */
import { h } from '../../shared/dom.js';
import { LIVE } from '../copy.js';
import type { LiveScreenKind } from '../live-model.js';
import { listLine, withNumerals } from './common.js';

/** What the room's corners say, read from the release, the room and the account's entry at each change. */
export interface RoomFacts {
  /** The release's model (variant) photograph, the window's ground; null without one (the room's ground alone). */
  photo: string | null;
  /** Macro scope K44 T1: a set's pieces' photographs, side by side as the window's ground (in place of `photo`); null otherwise. */
  photos?: string[] | null;
  /** The model's name as the phone's room says it (MONOLITHE; LIVE RELEASE where the page has no live sheet). */
  name: string;
  /** The model's name itself (MONOLITHE), where the title's variant begins. */
  model: string;
  /** The release's title, the model with its variant (MONOLITHE IN BLUE). */
  heading: string;
  /** The account's choice (`SIZE 17 · 1 PIECE`), on the screens of the line; null elsewhere. */
  choice: string | null;
  /** The people in the room, on its screens while the release runs; null (or 0) and the count is not shown. */
  count: number | null;
}

type Kind = LiveScreenKind | 'failed';
type Place = 'head' | 'body' | 'bl' | 'br' | 'a' | 'b';

/**
 * The pages that end a visit (YOUR TURN HAS PASSED … YOUR ENTRY IS REMOVED, the release or its after-room ended before
 * the account's piece): NOCTURNE's pages on a phone, the room's on a computer (decision 7: "and the end screens").
 */
const END: ReadonlySet<Kind> = new Set<Kind>(['missed', 'expired', 'released', 'left', 'removed', 'ended', 'over']);

/** The room's screens the Cinema room stages: the others are NOCTURNE's pages (views/desktop-release.ts). */
const STAGED: ReadonlySet<Kind> = new Set<Kind>(['loading', 'signin', 'notEligible', 'room', 'join', 'queue', 'soldOut', 'turn', 'secured', 'confirmed', 'afterRoom', ...END]);

/** The screens with the room under way: its count top right, the host's messages under the centre. */
const RUNNING: ReadonlySet<Kind> = new Set<Kind>(['room', 'join', 'queue', 'soldOut', 'turn', 'secured']);

/**
 * An end page (views/live.ts edgeScreen): what happened over the centre, its sentence under it (the two one live region,
 * kept whole); WRITE TO ORBES CLIENT SERVICES (an entry removed), the question after once open and THE RELEASES in the
 * centre; the release's title and its LIVE RELEASE (THE AFTER-ROOM) · day line bottom left. Its photograph is the
 * window's; HOW RELEASES WORK is the room's foot's.
 */
const END_PLAN: readonly [Place, string][] = [
  ['head', ':scope > .n-live__outcome-block'],
  ['body', ':scope > .n-live__contact'],
  ['body', ':scope > .n-question'],
  ['body', ':scope > .n-live__back'],
  ['bl', ':scope > .n-live__words > .n-live__title'],
  ['bl', ':scope > .n-live__words > .n-live__kind'],
];

/**
 * Where each screen's elements stand (selectors from the screen's own element, in the order they are placed). The head
 * spans the window above the centre (the overline, a screen's title); the body is the centre, between the corners; `bl`
 * and `br` the corners. CONFIRMED is composed as a page in two columns (`a`, `b`).
 */
const PLAN: Partial<Record<Kind, readonly [Place, string][]>> = {
  ...Object.fromEntries([...END].map((k) => [k, END_PLAN])),
  room: [
    ['head', ':scope > .live__overline'],
    ['body', ':scope > .live-door'],
    ['body', ':scope > .live__count-block'],
    ['body', ':scope > .live__drawing'],
    ['bl', ':scope > .live__title'],
    ['bl', ':scope > .live__offer'],
    ['bl', ':scope > .live__surprise'],
    ['bl', ':scope > .live__see-model'],
    ['bl', ':scope > .live__prep > .live__picker'],
    ['bl', ':scope > .live__prep > .live__guarantee'],
    ['br', ':scope > .live__prep'],
  ],
  join: [
    ['head', ':scope > .live__overline'],
    ['body', ':scope > .live__plate--join'],
    ['body', ':scope > .live__left'],
    ['bl', ':scope > .live__title'],
    ['bl', ':scope > .live__offer'],
    ['bl', ':scope > .live__surprise'],
    ['bl', ':scope > .live__picker'],
    ['br', ':scope > .live__join-line'],
    ['br', ':scope > .live__error'],
    ['br', ':scope > .live__enter'],
  ],
  // ONE QUEUE (MK #queue, desk): YOUR PLACE large in the centre (READING YOUR PLACE there until it is read), the pieces
  // left (the Horizon band, D23) and the one note under it; the release's name, its choice and LEAVE THE LINE bottom left; PAUSED (or THE QUEUE
  // IS PAUSED) with its line, then the time left, bottom right.
  queue: [
    ['head', ':scope > .live__overline:not(.live__place-label)'],
    ['body', ':scope > .live__place-label'],
    ['body', ':scope > .live__place'],
    ['body', ':scope > .live__queue-reading'],
    ['body', ':scope > .live-hz'],
    ['body', ':scope > .live__queue-note'],
    ['bl', ':scope > .live__title'],
    ['bl', ':scope > .live__error'],
    ['bl', ':scope > .live__leave-line'],
    // The phone's lines under the name (its choice, the people in the room): the corners say both here (shared CSS).
    ['bl', ':scope > .live__choice'],
    ['bl', ':scope > .live__entry-count'],
    ['br', ':scope > .live__queue-paused'],
    ['br', ':scope > .live__queue-paused-line'],
    ['br', ':scope > .live__queue-time'],
  ],
  // SOLD OUT for your size (MK S, desk): SOLD OUT over the centre, its sentence, THE VAULT's place when there is one
  // (lot Q3), LEAVE THE LINE, the host's message between hairlines; the name and its choice bottom left; YOUR PLACE with
  // its large figure bottom right.
  soldOut: [
    ['head', ':scope > .live__title'],
    ['body', ':scope > .live__note'],
    ['body', ':scope > .live__vault-slot'],
    ['body', ':scope > .live__error'],
    ['body', ':scope > .live__leave-line'],
    ['bl', ':scope > .live__overline'],
    ['bl', ':scope > .live__choice'],
    ['bl', ':scope > .live__entry-count'],
    ['br', ':scope > .live__ahead'],
  ],
  turn: [
    ['head', ':scope > .live__overline'],
    ['head', ':scope > .live__title'],
    ['body', ':scope > .live-hold'],
    ['body', ':scope > .live__turn-left'],
    ['body', ':scope > .live__to-secure'],
    ['body', ':scope > .live__let-go'],
    ['body', ':scope > .live__error'],
    ['bl', ':scope > .live__turn-piece'],
  ],
  secured: [
    ['head', ':scope > .live__overline'],
    ['body', ':scope > .live__reveal'],
    ['body', ':scope > .live__deadline'],
    ['bl', ':scope > .live__title'],
    ['bl', ':scope > .live__detail'],
    ['bl', ':scope > .live__set-pieces'],
    ['br', ':scope > .live__addons-title'],
    ['br', ':scope > .live__addons'],
    ['br', ':scope > .live__items-title'],
    ['br', ':scope > .live__items'],
    ['br', ':scope > .live__items-note'],
    ['br', ':scope > .live__error'],
    ['br', ':scope > .live__pay'],
    ['br', ':scope > .live__pay-note'],
    ['br', ':scope > .live__release'],
  ],
  confirmed: [
    ['a', ':scope > .live__mark'],
    ['a', ':scope > .live__title'],
    ['a', ':scope > .live__confirmed-of'],
    ['a', ':scope > .live__set-reserved'],
    ['a', ':scope > .live__confirmed-text'],
    ['a', ':scope > .live__left-out'],
    ['a', ':scope > .n-story__open'],
    ['b', ':scope > .live__receipt-plate'],
    ['b', ':scope > .live__cs-title'],
    ['b', ':scope > .write__open'],
    ['b', ':scope > .live__pieces'],
  ],
  signin: [
    ['head', ':scope > .live__title'],
    ['body', ':scope > .live__panel'],
    ['bl', ':scope > .live__overline'],
  ],
  notEligible: [
    ['head', ':scope > .live__title'],
    ['body', ':scope > .live__note'],
    ['body', ':scope > .live__action'],
    ['bl', ':scope > .live__overline'],
  ],
  afterRoom: [
    ['head', ':scope > .live__overline'],
    ['head', ':scope > .live__title'],
    ['body', ':scope > .live-door--after'],
    ['br', ':scope > .live__after-text'],
    ['br', ':scope > .live__after-until'],
    ['br', ':scope > .live__after-enter'],
  ],
};

/**
 * The corner's name: the screen's own element where the phone names the model in it (its h1 in the room, the line, the
 * piece secured, an end page; the overline of an edge page), set to the release's title with its variant; a line of
 * the stage's own where the phone names it elsewhere (the seal's line at the turn) or not at all (the second door: the
 * release whose room it opens in, as every phase of the room names it, decision 7; the piece behind the door is the
 * after-room's, named once its line is entered).
 */
const NAMED: Partial<Record<Kind, string>> = {
  ...Object.fromEntries([...END].map((k) => [k, ':scope > .d-room__bl > .n-live__title'])),
  room: ':scope > .d-room__bl > .live__title',
  join: ':scope > .d-room__bl > .live__title',
  queue: ':scope > .d-room__bl > .live__title',
  secured: ':scope > .d-room__bl > .live__title',
  soldOut: ':scope > .d-room__bl > .live__overline',
  signin: ':scope > .d-room__bl > .live__overline',
  notEligible: ':scope > .d-room__bl > .live__overline',
};
const OWN_NAME: ReadonlySet<Kind> = new Set<Kind>(['turn', 'afterRoom']);
/** The screens whose corner says the account's choice under the name (the picker says it in the room, the detail once secured). */
const CHOICE: ReadonlySet<Kind> = new Set<Kind>(['queue', 'soldOut', 'turn']);

const ROOM = 'd-room';

/**
 * The room's reading sentences (its notes, the drawing's, CONFIRMED's, an end page's, the host's message and the pause):
 * their last three words held on one line, so none ends on a line of one or two words at any width (§10.9; text-wrap:
 * pretty only catches one). Their words are unchanged, and put back as they were on a phone.
 */
const SENTENCES = ':is(.live__note, .live__confirmed-text, .live__addon-line, .n-live__outcome-text, .live__notice-text)';

export class DesktopRoom {
  /** The window's ground: the release's photograph, its veils over it. */
  private readonly ground = h('div', { class: 'd-room__photo', attrs: { 'aria-hidden': 'true' } }, groundImage());
  /** The photographs the ground shows now, joined (a set's several side by side). */
  private groundKey = '';
  /** The count in the room, top right. */
  private readonly count = h('p', { class: 'd-room__count', attrs: { hidden: true } }, h('span', { class: 'live__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'd-room__count-text' }));
  /** Each element moved, and the mark left where it stood. */
  private readonly placed = new Map<HTMLElement, Comment>();
  /** Each element given the release's title, and what it held before. */
  private readonly renamed = new Map<HTMLElement, ChildNode[]>();
  private screen: HTMLElement | null = null;
  private kind: Kind | null = null;
  private name: HTMLElement | null = null;
  private choice: HTMLElement | null = null;
  /** Sold out in its size: YOUR PLACE's label and its figure, as the line draws them (the phone's one line says both). */
  private placeLabel: HTMLElement | null = null;
  private placeFigure: HTMLElement | null = null;
  private facts: RoomFacts | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly head: HTMLElement,
    private readonly notice: HTMLElement,
  ) {}

  /** Stages screen `el` of `kind` (just mounted): its elements in their places, the corners from `facts`. */
  arrange(kind: Kind, el: HTMLElement, facts: RoomFacts): void {
    if (this.screen === el && this.kind === kind) {
      this.update(facts);
      return;
    }
    this.release();
    this.screen = el;
    this.kind = kind;
    const staged = STAGED.has(kind);
    this.root.classList.toggle(ROOM, staged);
    this.landmarks(staged);
    if (!staged) {
      this.root.removeAttribute('data-d-kind');
      this.ground.remove();
      this.count.remove();
      return;
    }
    this.root.dataset.dKind = kind;
    if (this.ground.parentElement !== this.root) this.root.prepend(this.ground);
    if (this.count.parentElement !== this.head) this.head.append(this.count);
    el.classList.add('d-room__screen', `d-room__screen--${kind}`);
    if (END.has(kind)) el.classList.add('d-room__screen--end');
    const plan = PLAN[kind] ?? [];
    const boxes = new Map<Place, HTMLElement>();
    const box = (p: Place): HTMLElement => {
      let b = boxes.get(p);
      if (!b) {
        b = h('div', { class: `d-room__${p}` });
        boxes.set(p, b);
      }
      return b;
    };
    for (const [p, sel] of plan) {
      const found = el.querySelector<HTMLElement>(sel);
      if (found) this.place(found, box(p));
    }
    // The places in the eye's order (and the tab order's): the head, the centre, the corners left then right.
    const order: Place[] = kind === 'confirmed' ? ['a', 'b'] : ['head', 'body', 'bl', 'br'];
    if (kind !== 'confirmed' && kind !== 'loading') for (const p of ['body', 'bl', 'br'] as const) box(p);
    for (const p of order) {
      const b = boxes.get(p);
      if (b) el.append(b);
    }
    // The host's messages and the pause under the centre, above the corners (they stay the head's on a phone).
    if (RUNNING.has(kind)) this.place(this.notice, box('body'));
    // The corner's name: the release's title with its variant; then its choice.
    const bl = boxes.get('bl');
    if (bl) {
      // The price and the quantity line (`€ 125 400 · 120 PIECES · NEVER MORE, NEVER AGAIN`): broken only between its
      // values when the corner is narrower than it (§10.9).
      // So is an end page's LIVE RELEASE · MONDAY 5 OCTOBER.
      for (const line of bl.querySelectorAll<HTMLElement>(':scope > :is(.live__offer, .n-live__kind)')) {
        if (this.renamed.has(line)) continue;
        this.renamed.set(line, [...line.childNodes]);
        line.replaceChildren(...listLine((line.textContent ?? '').trim()));
      }
      const named = NAMED[kind];
      const own = named ? el.querySelector<HTMLElement>(named) : null;
      if (own) this.rename(own, facts, END.has(kind));
      else if (OWN_NAME.has(kind)) {
        this.name = h('p', { class: 'd-room__name' });
        bl.prepend(this.name);
      }
      if (CHOICE.has(kind)) {
        this.choice = h('p', { class: 'd-room__choice' });
        const after = this.name ?? own;
        if (after && after.parentElement === bl) after.after(this.choice);
        else bl.prepend(this.choice);
      }
    }
    this.facts = null;
    this.update(facts);
  }

  /** The corners' words and the ground, from the room's facts now (nothing is drawn again when they are the same). */
  update(facts: RoomFacts): void {
    if (!this.screen || !this.kind || !STAGED.has(this.kind)) return;
    this.facts = facts;
    // The ground: the release's photograph; a set's pieces' photographs side by side (macro scope K44 T1).
    const photos = facts.photos && facts.photos.length > 1 ? facts.photos : facts.photo ? [facts.photo] : [];
    const key = photos.join('|');
    if (key !== this.groundKey || this.ground.childElementCount === 0) {
      this.groundKey = key;
      this.ground.replaceChildren(...(photos.length > 0 ? photos.map((src) => groundImage(src)) : [groundImage()]));
    }
    // Marked on every update (a room's first screen without a photograph is bare too, whatever the key it starts from).
    this.ground.classList.toggle('is-bare', photos.length === 0);
    this.ground.classList.toggle('d-room__photo--tiles', photos.length > 1);
    const n = RUNNING.has(this.kind) ? (facts.count ?? 0) : 0;
    this.count.hidden = n <= 0;
    const text = this.count.lastElementChild as HTMLElement;
    const said = n > 0 ? LIVE.inRoom(n) : '';
    if (text.dataset.text !== said) {
      text.dataset.text = said;
      text.replaceChildren(...withNumerals(said));
    }
    if (this.name && this.name.dataset.text !== facts.heading) {
      this.name.dataset.text = facts.heading;
      this.name.replaceChildren(...titleParts(facts.heading, facts.model));
    }
    if (this.choice) {
      const choice = facts.choice ?? '';
      if (this.choice.dataset.text !== choice) {
        this.choice.dataset.text = choice;
        this.choice.replaceChildren(...withNumerals(choice));
      }
      this.choice.hidden = choice === '';
    }
    if (this.kind === 'soldOut') this.soldOutPlace();
    // The room's sentences: their last three words held together (§10.9), drawn again when a screen changes their words.
    for (const root of [this.screen, this.notice]) {
      for (const t of root.querySelectorAll<HTMLElement>(SENTENCES)) tail(t);
    }
    // YOUR PLACE on the right edge: its last figure said, so its side bearing is given back (shared/desktop-room.css).
    const place = this.screen.querySelector<HTMLElement>(':scope > .d-room__br > .live__place');
    if (place) {
      const last = (place.querySelector('.live__place-figure')?.textContent ?? '').trim().slice(-1);
      if (place.dataset.dLast !== last) place.dataset.dLast = last;
    }
  }

  /**
   * The screen on show gives way to the next (views/live.ts mounts another): the host's messages back in the head, the
   * marks of the screen leaving forgotten (its elements leave with it).
   */
  /**
   * The staged room's header (ORBES, the count in the room) and its foot (the room's foot row, the legal links) as the
   * page's banner and contentinfo landmarks (§10.32): the shell's own are hidden in the room (decision 7), and a header
   * or footer inside the page's main is none by itself.
   */
  private landmarks(on: boolean): void {
    const foot = this.root.querySelector<HTMLElement>(':scope > .live__foot');
    for (const [el, role] of [
      [this.head, 'banner'],
      [foot, 'contentinfo'],
    ] as const) {
      if (!el) continue;
      if (on) el.setAttribute('role', role);
      else if (el.getAttribute('role') === role) el.removeAttribute('role');
    }
  }

  release(): void {
    const mark = this.placed.get(this.notice);
    if (mark) {
      if (mark.isConnected) mark.replaceWith(this.notice);
      else this.head.append(this.notice);
    }
    this.placed.clear();
    this.renamed.clear();
    this.name = null;
    this.choice = null;
    this.placeLabel = null;
    this.placeFigure = null;
    this.screen = null;
    this.kind = null;
  }

  /** Back to the phone: every element where it stood, the stage's own parts gone, the words as the phone says them. */
  undo(): void {
    for (const root of [this.screen, this.notice]) {
      for (const t of root?.querySelectorAll<HTMLElement>('[data-d-tail]') ?? []) {
        t.textContent = t.textContent;
        delete t.dataset.dTail;
      }
    }
    for (const [el, nodes] of this.renamed) {
      el.replaceChildren(...nodes);
      el.classList.remove('d-room__name');
    }
    this.renamed.clear();
    for (const [el, mark] of this.placed) {
      if (mark.isConnected) mark.replaceWith(el);
      else mark.remove();
    }
    this.placed.clear();
    const el = this.screen;
    if (el) {
      for (const b of el.querySelectorAll(':scope > [class^="d-room__"]')) b.remove();
      el.classList.remove('d-room__screen', `d-room__screen--${this.kind}`, 'd-room__screen--end');
      for (const p of el.querySelectorAll<HTMLElement>('[data-d-last]')) delete p.dataset.dLast;
      for (const p of el.querySelectorAll<HTMLElement>('.d-room__redrawn')) p.classList.remove('d-room__redrawn');
    }
    this.name = null;
    this.choice = null;
    this.placeLabel = null;
    this.placeFigure = null;
    this.ground.remove();
    this.count.remove();
    this.root.classList.remove(ROOM);
    this.landmarks(false);
    this.root.removeAttribute('data-d-kind');
    this.screen = null;
    this.kind = null;
    this.facts = null;
  }

  /**
   * Sold out in its size (MK S, desk): where the phone says `YOUR PLACE 7` in one small line, the corner draws it as the
   * queue does, its label over its large figure (read as the phone's line is, `Your place in size 52: 7`); the phone's
   * line steps aside meanwhile. Without a place read, nothing.
   */
  private soldOutPlace(): void {
    const line = this.screen?.querySelector<HTMLElement>(':scope > .d-room__br > .live__ahead');
    if (!line) return;
    const figure = line.dataset.place ?? '';
    const said = line.dataset.said ?? '';
    line.classList.toggle('d-room__redrawn', figure !== '');
    if (figure === '') {
      this.placeLabel?.remove();
      this.placeFigure?.remove();
      return;
    }
    this.placeLabel ??= h('p', { class: 'live__overline live__place-label', attrs: { 'aria-hidden': 'true' }, text: LIVE.yourPlace });
    this.placeFigure ??= h('p', { class: 'live__place' }, h('span', { class: 'visually-hidden' }), h('span', { class: 'live__place-figure', attrs: { 'aria-hidden': 'true' } }));
    if (this.placeLabel.nextElementSibling !== this.placeFigure || this.placeFigure.nextElementSibling !== line) line.before(this.placeLabel, this.placeFigure);
    const reader = this.placeFigure.firstElementChild as HTMLElement;
    // Said before the figure, a space after it (the figure is the eye's: hidden from readers).
    const text = `${said || `${LIVE.yourPlaceSaid} ${figure}`} `;
    if (reader.textContent !== text) reader.textContent = text;
    const shown = this.placeFigure.lastElementChild as HTMLElement;
    if (shown.textContent !== figure) shown.textContent = figure;
  }

  private place(el: HTMLElement, into: HTMLElement): void {
    if (!this.placed.has(el)) {
      const mark = document.createComment('d-room');
      el.before(mark);
      this.placed.set(el, mark);
    }
    into.append(el);
  }

  /**
   * The screen's own element that names the model, given the release's title with its variant (put back on a phone).
   * `own`: it already says the title (an end page's h1, the model's name on a line of its own): on one line here.
   */
  private rename(el: HTMLElement, facts: RoomFacts, own = false): void {
    const text = (el.textContent ?? '').trim();
    // An after-room's edge page says THE AFTER-ROOM over its title, not the model: kept. The screens of the entry name
    // the release with its variant already (ONE QUEUE, D34): set apart here as every corner's name is.
    if (!own && text !== facts.name && text !== facts.heading) return;
    this.renamed.set(el, [...el.childNodes]);
    el.replaceChildren(...titleParts(own ? text : facts.heading, facts.model));
    el.classList.add('d-room__name');
  }
}

/**
 * An image of the window's ground (decorative: the corners name the release). One that cannot be loaded gives way to the
 * window's ground (no broken-image mark), as the phone's photograph does.
 */
function groundImage(src?: string): HTMLImageElement {
  const img = h('img', { class: 'd-room__img', attrs: { alt: '', decoding: 'async', fetchpriority: 'high', src: src ?? null } });
  img.addEventListener('error', () => img.classList.add('is-failed'), { once: true });
  return img;
}

/**
 * A sentence of the room with its last three words held on one line (`.d-room__tail`), its words unchanged; drawn again
 * when its words change (a screen sets them anew). A sentence with parts of its own (figures) is left as it is.
 */
function tail(t: HTMLElement): void {
  const text = t.textContent ?? '';
  const held = t.childElementCount === 1 && t.lastElementChild!.classList.contains('d-room__tail');
  if (held && t.dataset.dTail === text) return;
  if (t.childElementCount > 0 && !held) return;
  const words = text.split(' ');
  if (words.length < 4) return;
  t.dataset.dTail = text;
  const end = words.splice(-3).join(' ');
  t.replaceChildren(`${words.join(' ')} `, h('span', { class: 'd-room__tail', text: end }));
}

/** The release's title, its variant held on its own line's end (`MONOLITHE` / `IN BLUE`: never `IN` / `BLUE`, §10.9). */
function titleParts(heading: string, name: string): (string | Node)[] {
  if (heading.startsWith(`${name} `) && heading.length > name.length + 1) {
    return [...withNumerals(name), ' ', h('span', { class: 'd-room__variant' }, ...withNumerals(heading.slice(name.length + 1)))];
  }
  return withNumerals(heading);
}
