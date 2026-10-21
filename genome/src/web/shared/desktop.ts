/**
 * The desktop switch (desktop, BRIEF §4): a computer's window at least 1024 px wide, with a mouse or a
 * trackpad, gets the desktop layout (CINEMA, shared/desktop.css); a phone and a tablet keep the phone layout. The CSS
 * media query and `isDesktop()` read the same query, so the styles and the behaviour switch together.
 *
 * Phones and tablets (the owner's answer Q2): every Android, iPhone and iPad device keeps the phone layout, a tablet
 * with a keyboard or trackpad cover included (it can answer the query as a computer does), and so does any screen
 * whose main pointer is a finger (`touchLayout()`: the system named by the browser, or its main pointer coarse).
 * shared/mode-early.ts mirrors that for the CSS before the first paint (`html.d-touch`, which every rule of
 * desktop.css excludes). A computer with a touch screen (a Windows laptop, a Chromebook) has the desktop layout; it
 * can be tapped by finger, so it is marked `html.d-tap` there too, and each desktop control's hit area reaches 44 px
 * under it (shared/desktop-tap.css), with no visual change.
 *
 * A computer's words and its sound (decision D6): `onComputer()` (a fine pointer with hover, not a phone or a
 * tablet) whatever the window's width, so a narrow or zoomed window still says "on this computer" and starts with
 * the sound off; the width is for the layout only.
 *
 * A window resized across the breakpoint switches its styles at once, the few places that move in the page with them
 * (`onDesktopChange`), and its routes on its next navigation: nothing here assumes the answer stays the same.
 *
 * Three things of the layout need the page's elements, not only styles:
 * - `dockRail`: the menu stands inside the top bar, between the wordmark and SCAN, so the Tab order follows the eye
 *   (wordmark, menu, SCAN, the account); on a phone it is back under the header.
 * - `watchBar`: the top bar has no ground over the frame a page opens on (its own veil under its words), and takes
 *   it, with its hairline, before the frame's words reach it: when the top of the words' higher block (or of the crumb
 *   over the frame) reaches the bar's foot (`html.d-bar-over`: an IntersectionObserver on a mark of no height there,
 *   `.d-bar-mark`, no scroll handler). A change of the menu's current item is drawn at once, never faded
 *   (`stillOnCurrent`).
 * - the frames' words (in `watchBar`): a frame's words stand in two blocks in its lower third, the name and its lines on
 *   the left (`.d-frame__main`), the clock, the choices and the main button in a block of fixed width on the right
 *   (`.d-frame__aside`); the elements are moved into their block, each leaving a mark where it was, and put back there
 *   on a phone.
 * And, in `watchBar` too: where each frame's words begin (`--d-words-top`, for the crop and a light frame's photograph),
 * NOW's title on one line where a short light window asks for it and the line holds it (`d-one-line`), a frame
 * title's size fitted to its kept line (`--d-title-fit`), the first photograph of a list fetched first, display titles'
 * optical alignment and kept ends, a two-column list's rows (`--d-rows`), and a page's own arrangement
 * (`Arrangement`: NOW's, verify/views/desktop-now.ts), each undone on a phone.
 */

/** The query the desktop layout answers to (shared/desktop.css and the shells' layout <link> repeat it). */
export const DESKTOP_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

/** A computer's pointer, whatever the window's width (the shells' hover <link> repeats it). */
export const POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** The top bar's height on desktop (shared/desktop.css --d-bar). */
const BAR_HEIGHT = 84;

let query: MediaQueryList | null | undefined;

function desktopQuery(): MediaQueryList | null {
  if (query === undefined) query = typeof matchMedia === 'function' ? matchMedia(DESKTOP_QUERY) : null;
  return query;
}

/** What the browser says of its device, as `touchLayout` reads it (the page's navigator; fakes in the tests). */
export interface DeviceFacts {
  /** `navigator.userAgent`. */
  readonly userAgent: string;
  /** `navigator.platform` (an iPad's Safari as a computer's says `MacIntel`). */
  readonly platform: string;
  /** `navigator.userAgentData.platform`, where the browser has it (`Android`, `Windows`, `macOS`…). */
  readonly system?: string;
  /** `navigator.maxTouchPoints`. */
  readonly touchPoints: number;
  /** Whether the main pointer is coarse (a finger): `(pointer: coarse)`. */
  readonly coarse: boolean;
}

/**
 * A phone or a tablet (Q2): an Android, iOS or iPadOS device, named by the browser's system or its user agent, an
 * iPad's Safari that says it is a Mac (a Mac never has touch points), an Android tablet whose Chrome asks for the
 * computer's site (it then says Linux, but its platform keeps its ARM processor and it has touch points; a Chromebook
 * says CrOS), or a device whose main pointer is a finger. It keeps the phone layout, a keyboard or trackpad cover or
 * not. shared/mode-early.ts holds the same test.
 */
export function phoneOrTablet(d: DeviceFacts): boolean {
  if (/^(android|ios|ipados)$/i.test(d.system ?? '')) return true;
  if (/Android|iPhone|iPad|iPod/i.test(d.userAgent)) return true;
  if ((/Macintosh/i.test(d.userAgent) || d.platform === 'MacIntel') && d.touchPoints > 0) return true;
  if (/^Linux (arm|aarch64)/i.test(d.platform) && !/CrOS/.test(d.userAgent) && d.touchPoints > 0) return true;
  return d.coarse;
}

/** The page's own device facts (none outside a browser). */
function pageDevice(): DeviceFacts | null {
  if (typeof navigator === 'undefined') return null;
  let coarse = false;
  try {
    coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  const n = navigator as Navigator & { userAgentData?: { platform?: string } };
  return { userAgent: n.userAgent ?? '', platform: n.platform ?? '', system: n.userAgentData?.platform, touchPoints: n.maxTouchPoints ?? 0, coarse };
}

/**
 * A phone or a tablet (`html.d-touch`): never the desktop layout, nor a computer's words. Once the page is marked
 * so before its first paint, it stays so, as its styles do.
 */
export function touchLayout(): boolean {
  if (typeof document !== 'undefined' && document.documentElement?.classList.contains('d-touch')) return true;
  const d = pageDevice();
  return d !== null && phoneOrTablet(d);
}

/**
 * A computer with a touch screen (`html.d-tap`): the desktop layout, its controls' hit areas at 44 px. The module's
 * statement of shared/mode-early.ts's d-tap test (which the page runs before its first paint, with its own copy of it),
 * held equal to it by test/web/desktop.switch.test.ts; no app code calls it.
 */
export function tapComputer(): boolean {
  const d = pageDevice();
  return d !== null && !phoneOrTablet(d) && d.touchPoints > 0;
}

/**
 * A computer (decision D6): a fine pointer with hover, on a device that is not a phone or a tablet, whatever the
 * window's width. Its words (verify/copy.ts `forDevice`: "on this computer", CLICK) and its sound (off by default,
 * verify/sound.ts) read this, so a window under 1024 px or zoomed to 150 % keeps them.
 */
export function onComputer(): boolean {
  if (touchLayout()) return false;
  try {
    return typeof matchMedia === 'function' && matchMedia(POINTER_QUERY).matches;
  } catch {
    return false;
  }
}

/** Whether the window shows the desktop layout now. */
export function isDesktop(): boolean {
  return !touchLayout() && (desktopQuery()?.matches ?? false);
}

/** Calls `onChange` each time the window crosses the breakpoint; returns the way to stop. */
export function onDesktopChange(onChange: (desktop: boolean) => void): () => void {
  const q = desktopQuery();
  if (!q || touchLayout()) return () => undefined;
  const listener = (ev: MediaQueryListEvent) => onChange(ev.matches);
  q.addEventListener('change', listener);
  return () => q.removeEventListener('change', listener);
}

/**
 * The top bar on desktop: the menu (`rail`) inside the header, after the wordmark, and the header's end (`end`: SCAN
 * and the account, or the legal pages' way back) gathered in one box after it, so the bar is three places (the
 * wordmark, the menu in the centre, the end) and the Tab order follows the eye. On a phone, all as they were: the end's
 * items back in the header, the menu after it.
 */
export function dockRail(header: HTMLElement, rail: HTMLElement, end: () => readonly HTMLElement[]): void {
  const box = document.createElement('div');
  box.className = 'd-bar__end';
  const place = () => {
    const items = end();
    if (isDesktop()) {
      if (rail.parentNode !== header) header.append(rail);
      if (box.parentNode !== header) header.append(box);
      for (const el of items) if (el.parentNode !== box) box.append(el);
    } else {
      for (const el of items) if (el.parentNode !== header) header.append(el);
      box.remove();
      if (rail.previousSibling !== header) header.after(rail);
    }
  };
  place();
  onDesktopChange(place);
}

/**
 * The ORBES wordmark at the left of the top bar (`word`, the phone's typed word, in its place): on a computer a link to
 * NOW (`link()` makes it) stands in its place, the first stop of the Tab order (§10.17), as a computer's wordmark leads
 * home; on a phone the word as it is. Swapped in place as the window crosses the breakpoint.
 */
export function wordmarkLink(word: HTMLElement | null, link: () => HTMLAnchorElement): void {
  if (!word) return;
  let anchor: HTMLAnchorElement | null = null;
  let shown: HTMLElement = word;
  const place = (desktop: boolean) => {
    const next = desktop ? (anchor ??= link()) : word;
    if (next === shown || !shown.parentNode) return;
    shown.replaceWith(next);
    shown = next;
  };
  place(isDesktop());
  onDesktopChange(place);
}

// ── The frames ───────────────────────────────────────────────────────────────

/**
 * The photographs a page may open on, drawn from the top of the window under the bar (shared/desktop.css draws them as
 * frames and pulls them under the bar on the same conditions): NOW's lead, a model's cover, a piece's photograph.
 */
export const OPENING_FRAMES = [
  'body:not([data-banner]) .view--now > .now__hero:first-child:not(.now__hero--bare)',
  'body:not([data-banner]) .view--sheet .n-model__body > .n-model__photo:first-child',
  'body:not([data-banner]) .view--piece .n-piece__body > .n-piece__article:first-child > .n-piece__photo:first-child',
  // A release's page (a draw's, a LIVE RELEASE's before and after the room): its photograph's frame (views/desktop-release.ts).
  'body:not([data-banner]) .view--release > .n-release__hero.d-pframe',
  'body:not([data-banner]) .view--live.is-nocturne .n-livepage > .d-pframe:not(.d-pframe--sealed)',
  // The sign-in page of a computer (decision 6): its photograph under the bar (views/desktop-signin.ts). The box the bar
  // watches runs from the page's top to the photograph's foot or the panel's top, whichever comes first, so the bar
  // takes its ground before its words would stand over the panel's fields (shared/desktop-account.css `.d-signin__over`).
  'body:not([data-banner]) .view--signin > .d-signin > .d-signin__over',
  // The emails' pages (lot M1, step M1.19: SET A NEW PASSWORD, STOP THESE EMAILS) in the same frame (views/mail-frame.ts).
  'body:not([data-banner]) .n-mail--desk > .d-signin > .d-signin__over',
  // (A result's stage has no photograph: it opens under the solid bar, as every page without a frame.)
].join(', ');

/**
 * Each frame's words: the box that holds them, and what goes in the right block, in its order. With `main`, the rest of
 * the words go in a left block of their own (`.d-frame__main`), so the two blocks stand side by side on one foot line
 * whatever their heights; without it (a piece: its lines are the frame's sibling) the right block alone is moved.
 */
const FRAME_WORDS: readonly { words: string; aside: readonly string[]; main: boolean }[] = [
  // NOW: a LIVE RELEASE, a draw, the newest model.
  // (Without its photograph, a page head on the canvas in the same two blocks: shared/desktop.css.)
  { words: '.now__hero > .n-lift', main: true, aside: ['.now__clock', '.now__when', '.now__local', '.now__line', '.now__local-time', '.now__sizes', '.now__dots', '.now__owned', '.now__primary'] },
  // NOW: THE COLLECTION under the canvas, a frame of its own.
  { words: '.view--now > .n-sec:has(> .now__teaser-photo) > .n-lift', main: true, aside: ['.now__teaser-link'] },
  // THE RELEASES: a LIVE RELEASE (photographed or sealed), a draw.
  // PAST: a release ended, its mark (YOU SECURED A PIECE) and SEE THE RELEASE on the right.
  { words: '.n-releases__release > .n-releases__words', main: true, aside: ['.n-releases__clock', '.n-releases__when', '.n-releases__local', '.n-releases__see', '.n-releases__mark', '.n-releases__see-line'] },
  // THE COLLECTION: a model. (A wish of YOUR WISHLIST is drawn by the same card: a tile of its grid, not a frame.)
  // (A model without a photograph keeps the same two blocks, on the canvas: no empty frame.)
  { words: '.n-lookbook__model:not(.n-wishlist__card) > .n-lift', main: true, aside: ['.n-lookbook__dots', '.n-lookbook__owned', '.n-lookbook__see'] },
  // A model: its sizes, its finishes, what the collector owns.
  { words: '.n-model__body > .n-model__words', main: true, aside: ['.n-model__sizes', '.n-model__dots', '.n-model__owned'] },
  // A release's page (views/desktop-release.ts): a draw's state, when its entries close (or open), ADD TO CALENDAR and
  // YOUR ENTRY's main action, or once drawn THIS RELEASE IS OVER and the account's part (its early access stays under
  // its title); a LIVE RELEASE's clock, its time and ADD TO CALENDAR, or once over THIS RELEASE IS OVER and the
  // account's part, or the end of a visit and its sentence.
  { words: '.n-release__hero.d-pframe > .n-release__words', main: true, aside: ['.n-release__state', '.n-release__frame-when', '.n-release__calendar-line', '.n-release__frame-action', '.n-release__over-word', '.n-release__part'] },
  { words: '.d-pframe > .n-live__words', main: true, aside: ['.n-live__opens', '.n-live__countdown', '.n-live__when', '.n-live__local', '.n-live__calendar-line', '.n-live__over', '.n-live__part', '.n-live__outcome-block'] },
  // A piece: its state, THE MODEL and the photograph's note, in the photograph's frame.
  { words: '.n-piece__article > .n-piece__photo', main: false, aside: ['.n-piece__state-line', '.n-cap2', '.n-result__photo-note'] },
  // THE CIRCLE: a post without its photograph (none, or one that could not be loaded) in two blocks on one foot line,
  // its kind, title and day on the left, its event, places, YES / NO and its link on the right
  // (shared/desktop-circle.css). NOW's invitation card keeps its one column.
  {
    words: '.view--circle .n-circle-card > :is(.n-circle-card__words:only-child, .n-circle-card__plate, .n-circle-card__photo[hidden] + .n-circle-card__words)',
    main: true,
    aside: ['.n-circle-card__event', '.n-circle-card__places', '.n-circle-card__answer', '.n-circle-card__mine', '.n-circle-card__error', '.n-circle-card__link'],
  },
];

const MAIN = 'd-frame__main';
const ASIDE = 'd-frame__aside';
/** Each block's marks, in its children's order: where each of them stood. */
const marks = new WeakMap<HTMLElement, Comment[]>();
const blocks = new Set<HTMLElement>();

/** Moves `items` into a new block of class `cls` appended to `host`, each leaving a mark where it stood. */
function gather(host: HTMLElement, items: readonly HTMLElement[], cls: string): void {
  const box = document.createElement('div');
  box.className = cls;
  const list: Comment[] = [];
  for (const el of items) {
    const mark = document.createComment('d-frame');
    el.before(mark);
    list.push(mark);
    box.append(el);
  }
  host.append(box);
  marks.set(box, list);
  blocks.add(box);
}

function split(words: HTMLElement, aside: readonly string[], main: boolean): void {
  if (words.querySelector(`:scope > .${ASIDE}, :scope > .${MAIN}`)) return;
  // The piece's state line is the photograph's sibling: the right block gathers from the frame's parent.
  const scope = words.parentElement ?? words;
  const right = aside.flatMap((sel) => [...scope.querySelectorAll<HTMLElement>(`:scope > ${sel}, :scope > * > ${sel}`)].filter((el) => el.closest(`.${ASIDE}`) === null));
  if (right.length === 0) return;
  if (main) {
    const left = [...words.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !right.includes(el));
    gather(words, left, MAIN);
  }
  gather(words, right, ASIDE);
}

function unsplitAll(): void {
  for (const box of blocks) {
    const list = marks.get(box) ?? [];
    const items = [...box.children];
    list.forEach((mark, i) => {
      const el = items[i];
      if (el && mark.isConnected) mark.replaceWith(el);
      else mark.remove();
    });
    box.remove();
  }
  blocks.clear();
}

/**
 * Display titles: their first letter named (`data-d-initial`), so desktop.css gives back that letter's own side
 * bearing at display sizes (§10.6: Gravesend's M stands further in than its T or Z) and the title's first stem meets the
 * label above it.
 */
const DISPLAY_TITLES = '.now__title, .n-release__title, .n-live__title, .n-how__title, .n-releases__title, .n-releases__past-title, .lookbook-card__name:not(.n-wishlist__name), .n-model__title, .n-result__name, .n-result__word, .n-message__title, .releases__title, .n-lookbook__head .n-t1, .n-lookbook__salon-title, .view--now .n-sec > .n-lift .n-t2, .d-scanpage__title, .d-acct__title, .d-acct__t1, .d-signin__title, .n-pieces__title, .d-msg__title, .legal__title, .d-order__title, .circle__title, .club__title, .n-post__title, .release__title, .n-piece__signin > h1, .n-live__plain > h1, #wishlist-title';

function nameInitials(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>(DISPLAY_TITLES)) {
    const initial = (el.textContent ?? '').trim().charAt(0).toUpperCase();
    if (el.dataset.dInitial !== initial) el.dataset.dInitial = initial;
    // A line after a break (`MONOLITHE,` / `THE OCTOBER DRAW`): its own letter's bearing, by a mark of no width.
    for (const br of el.querySelectorAll(':scope > br')) {
      let next = br.nextSibling;
      if (next instanceof HTMLElement && next.classList.contains(LINE_START)) next = next.nextSibling;
      const letter = (next?.textContent ?? '').trim().charAt(0).toUpperCase();
      const mark = br.nextSibling instanceof HTMLElement && br.nextSibling.classList.contains(LINE_START) ? br.nextSibling : null;
      if (!letter) {
        mark?.remove();
        continue;
      }
      if (mark) {
        if (mark.dataset.dInitial !== letter) mark.dataset.dInitial = letter;
        continue;
      }
      const span = document.createElement('span');
      span.className = LINE_START;
      span.setAttribute('aria-hidden', 'true');
      span.dataset.dInitial = letter;
      br.after(span);
    }
  }
}

const LINE_START = 'd-line-start';

/**
 * Titles whose last line would hold one short word (`MONOLITHE, THE OCTOBER` / `DRAW`):
 * their end kept on one line (§10.9), the words after a title's comma (`THE OCTOBER DRAW`), else its last two words.
 * Their figures stay in their spans. A title with a break of its own keeps the line after its break whole
 * (`MONOLITHE,` / `THE OCTOBER DRAW`, never `THE OCTOBER` / `DRAW`); its size then fits that line (`fitTitle`).
 */
const KEPT_TITLES = '.now__title, .n-release__title, .n-live__title, .now__card-title, .n-circle-card__title, .n-post__title, .n-releases__title, .n-releases__past-title, .lookbook-card__name, .n-model__title, .n-result__name';
const KEEP = 'd-keep';

const isWord = (n: ChildNode) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.classList.contains('numeral'));

/** The line after a title's last break, kept whole when it holds two words or more. */
function keepAfterBreak(br: Element): void {
  let first = br.nextSibling;
  if (first instanceof HTMLElement && first.classList.contains(LINE_START)) first = first.nextSibling;
  const rest: ChildNode[] = [];
  for (let n = first; n; n = n.nextSibling) rest.push(n);
  if (!first || !rest.every(isWord) || !rest.map((n) => n.textContent ?? '').join('').trim().includes(' ')) return;
  const keep = document.createElement('span');
  keep.className = KEEP;
  first.before(keep);
  while (keep.nextSibling) keep.append(keep.nextSibling);
}

function keepTitleEnds(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>(KEPT_TITLES)) {
    if (el.querySelector(`:scope > .${KEEP}`)) continue;
    const breaks = el.querySelectorAll(':scope > br');
    if (breaks.length > 0) {
      keepAfterBreak(breaks[breaks.length - 1]!);
      continue;
    }
    // NOW's title is set by its break alone.
    if (el.classList.contains('now__title')) continue;
    const nodes = [...el.childNodes];
    if (!nodes.every(isWord)) continue;
    const text = el.textContent ?? '';
    const comma = text.lastIndexOf(', ');
    let start = comma >= 0 && text.slice(comma + 2).trim().includes(' ') ? comma + 2 : -1;
    if (start < 0) {
      const words = [...text.matchAll(/\S+/g)];
      if (words.length < 3) continue;
      start = words[words.length - 2]!.index!;
    }
    // Split the text node the kept end starts in, then gather everything from there into one span.
    let at = 0;
    let first: ChildNode | null = null;
    for (const n of nodes) {
      const len = (n.textContent ?? '').length;
      if (at + len > start) {
        if (n.nodeType === Node.TEXT_NODE && start > at) first = (n as Text).splitText(start - at);
        else first = n;
        break;
      }
      at += len;
    }
    if (!first) continue;
    const keep = document.createElement('span');
    keep.className = KEEP;
    first.before(keep);
    while (keep.nextSibling) keep.append(keep.nextSibling);
  }
}

/**
 * A list read column by column in two columns (THE RELEASES OF THIS MODEL): its column's height in rows
 * (`--d-rows`, shared/desktop.css), the first column holding the extra row when its count is odd.
 */
function twoColumnRows(root: ParentNode): void {
  for (const list of root.querySelectorAll<HTMLElement>('.n-model__release-rows')) {
    const rows = String(Math.max(1, Math.ceil(list.childElementCount / 2)));
    if (list.style.getPropertyValue('--d-rows') !== rows) list.style.setProperty('--d-rows', rows);
  }
}

/**
 * Display titles the app does not break itself (a result's word, a problem's title: the server's and copy.ts's words):
 * where the browser wraps them, an explicit break is set (`<br class="d-br">`), so the line after it takes its own
 * letter's side bearing as the first line does (nameInitials; §10.6); a last line of one short word (≤ 5 letters) takes
 * the word before it with it (`UNKNOWN` / `ORBES CODE`, never `UNKNOWN ORBES` / `CODE`, §10.9). Measured once the fonts
 * are in, from the words' own boxes; the titles scale with the window, so their breaks hold at every width.
 */
const WRAP_TITLES = '.n-result__word, .n-message__title';
const BR = 'd-br';
let fontsAwaited = false;

function breakWrapped(root: ParentNode): void {
  const titles = [...root.querySelectorAll<HTMLElement>(WRAP_TITLES)].filter((el) => el.dataset.dBroken === undefined && el.offsetParent !== null);
  if (titles.length === 0) return;
  if (typeof document.fonts !== 'undefined' && document.fonts.status !== 'loaded') {
    if (!fontsAwaited) {
      fontsAwaited = true;
      void document.fonts.ready.then(() => {
        fontsAwaited = false;
        if (isDesktop()) {
          breakWrapped(document);
          nameInitials(document);
        }
      });
    }
    return;
  }
  for (const el of titles) {
    el.dataset.dBroken = '';
    const node = el.firstChild;
    if (el.childNodes.length !== 1 || !(node instanceof Text)) continue;
    const text = node.data;
    const words = [...text.matchAll(/\S+/g)].map((m) => ({ at: m.index!, len: m[0].length }));
    if (words.length < 2) continue;
    const range = document.createRange();
    const tops = words.map((w) => {
      range.setStart(node, w.at);
      range.setEnd(node, w.at + 1);
      return range.getBoundingClientRect().top;
    });
    const lines: number[][] = [];
    tops.forEach((top, i) => {
      if (i === 0 || top - tops[i - 1]! > 4) lines.push([i]);
      else lines[lines.length - 1]!.push(i);
    });
    if (lines.length < 2) continue;
    const last = lines[lines.length - 1]!;
    const before = lines[lines.length - 2]!;
    if (last.length === 1 && words[last[0]!]!.len <= 5 && before.length >= 2) last.unshift(before.pop()!);
    // From the end, so the earlier offsets hold.
    for (const line of lines.slice(1).reverse()) {
      const rest = node.splitText(words[line[0]!]!.at);
      const br = document.createElement('br');
      br.className = BR;
      rest.before(br);
    }
  }
}

function unbreakWrapped(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-d-broken]')) {
    for (const br of el.querySelectorAll(`:scope > br.${BR}`)) {
      if (br.nextElementSibling?.classList.contains(LINE_START)) br.nextElementSibling.remove();
      br.remove();
    }
    el.normalize();
    delete el.dataset.dBroken;
  }
}

/**
 * Names set at a fixed size in a narrow column (a first registration's ceremony: the model's name under its GENOME; a
 * piece's name in its frame's left block):
 * when their widest word is wider than the column (a 24-character model), their size is lowered just enough
 * (`--d-word-fit`, px; shared/desktop.css takes the smaller), so a word is never cut nor spills past the edge. Read
 * again when the column changes width.
 */
const FIT_WORDS_SEL = '.d-res__visual .n-ceremony__name, .n-piece__lines .n-result__name';
const WORD_FIT = '--d-word-fit';
let wordObserver: ResizeObserver | null = null;

function fitWords(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>(FIT_WORDS_SEL)) {
    const width = el.clientWidth;
    if (width <= 0 || el.dataset.dFitW === String(width)) continue;
    if (typeof document.fonts !== 'undefined' && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => isDesktop() && fitWords(document));
      continue;
    }
    el.dataset.dFitW = String(width);
    wordObserver ??= new ResizeObserver((entries) => {
      for (const e of entries) delete (e.target as HTMLElement).dataset.dFitW;
      if (isDesktop()) fitWords(document);
    });
    wordObserver.observe(el);
    el.style.removeProperty(WORD_FIT);
    const size = parseFloat(getComputedStyle(el).fontSize);
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    el.append(probe);
    let widest = 0;
    for (const word of (el.textContent ?? '').split(/\s+/).filter(Boolean)) {
      probe.textContent = word;
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.remove();
    // A hair of room kept (2 %) for the page's own rounding, so the word never meets the edge and breaks there.
    if (widest > width * 0.98 && size > 0) el.style.setProperty(WORD_FIT, `${Math.floor((size * width * 0.98) / widest)}px`);
  }
}

function unfitWords(): void {
  wordObserver?.disconnect();
  for (const el of document.querySelectorAll<HTMLElement>(FIT_WORDS_SEL)) {
    el.style.removeProperty(WORD_FIT);
    delete el.dataset.dFitW;
  }
}

/**
 * A result's word on its stage (`UNUSUAL ACTIVITY DETECTED`), beside the GENOME's block of fixed width: at most two lines
 * in its block (§10.5), so where its best two lines (or the lines its breaks set) are wider than the block, its size is
 * lowered just enough (`--d-line-fit`, px, on its title; shared/desktop.css takes the smaller). Measured before its
 * breaks are set, and again when the block changes width.
 */
const FIT_LINES_SEL = '.d-res__stage > .d-res__words .n-result__word';
const LINE_FIT = '--d-line-fit';
let lineObserver: ResizeObserver | null = null;
const lineTitles = new Map<HTMLElement, HTMLElement>();

function fitLines(root: ParentNode): void {
  for (const word of root.querySelectorAll<HTMLElement>(FIT_LINES_SEL)) {
    const title = word.closest<HTMLElement>('.n-result__title');
    const block = word.closest<HTMLElement>('.d-res__words');
    if (!title || !block) continue;
    const cs = getComputedStyle(block);
    const room = block.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(room > 0) || title.dataset.dFitRoom === String(room)) continue;
    if (typeof document.fonts !== 'undefined' && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => isDesktop() && fitLines(document));
      continue;
    }
    title.dataset.dFitRoom = String(room);
    lineObserver ??= new ResizeObserver((entries) => {
      for (const e of entries) {
        const t = lineTitles.get(e.target as HTMLElement);
        if (t) delete t.dataset.dFitRoom;
      }
      if (isDesktop()) fitLines(document);
    });
    if (!lineTitles.has(block)) {
      lineTitles.set(block, title);
      lineObserver.observe(block);
    }
    title.style.removeProperty(LINE_FIT);
    const size = parseFloat(getComputedStyle(word).fontSize);
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    word.append(probe);
    const width = (text: string): number => {
      probe.textContent = text;
      return probe.getBoundingClientRect().width;
    };
    // Its lines as its breaks set them; without breaks, the best of one line or two.
    const lines: string[] = [''];
    for (const n of word.childNodes) {
      if (n === probe) continue;
      if (n instanceof HTMLBRElement) lines.push('');
      else lines[lines.length - 1] += n.textContent ?? '';
    }
    let need: number;
    if (lines.length > 1) need = Math.max(...lines.map((l) => width(l.trim())));
    else {
      const words = lines[0]!.trim().split(/\s+/).filter(Boolean);
      need = width(words.join(' '));
      for (let k = 1; k < words.length; k++) need = Math.min(need, Math.max(width(words.slice(0, k).join(' ')), width(words.slice(k).join(' '))));
    }
    probe.remove();
    if (need > room && size > 0) title.style.setProperty(LINE_FIT, `${Math.floor(((size * room) / need) * 10) / 10}px`);
  }
}

function unfitLines(): void {
  lineObserver?.disconnect();
  lineObserver = null;
  for (const title of lineTitles.values()) {
    title.style.removeProperty(LINE_FIT);
    delete title.dataset.dFitRoom;
  }
  lineTitles.clear();
}

function splitAll(root: ParentNode): void {
  for (const block of [...lineTitles.keys()]) {
    if (block.isConnected) continue;
    lineObserver?.unobserve(block);
    lineTitles.delete(block);
  }
  fitLines(root);
  breakWrapped(root);
  fitWords(root);
  nameInitials(root);
  keepTitleEnds(root);
  twoColumnRows(root);
  for (const f of FRAME_WORDS) for (const words of root.querySelectorAll<HTMLElement>(f.words)) split(words, f.aside, f.main);
  // Blocks of words no longer on the page: forgotten.
  for (const box of blocks) if (!box.isConnected) blocks.delete(box);
}

// ── Elements moved for the desktop ───────────────────────────────────────────

/** Each element moved for the desktop, and the mark left where it stood on the phone. */
const moved = new Map<HTMLElement, Comment>();

/**
 * Puts `el` right after `ref` on desktop (so the page's order, and the Tab order with it, is the order the eye reads),
 * leaving a mark where it stood; `undoMoves` puts it back there on a phone. Does nothing when it is already in place.
 */
export function moveAfter(el: HTMLElement, ref: Element): void {
  // A page drawn anew leaves its moved elements behind: forgotten.
  for (const [old, mark] of moved) if (!old.isConnected && !mark.isConnected) moved.delete(old);
  if (ref.nextElementSibling === el) return;
  if (!moved.has(el)) {
    const mark = document.createComment('d-moved');
    el.before(mark);
    moved.set(el, mark);
  }
  ref.after(el);
}

function undoMoves(): void {
  for (const [el, mark] of moved) {
    if (mark.isConnected && el.isConnected) mark.replaceWith(el);
    else mark.remove();
  }
  moved.clear();
}

/** A page's own desktop arrangement (the collector app's, verify/views/desktop-now.ts): applied each time the page
 *  changes on desktop, undone on a phone. `apply` must change nothing when the page is already arranged. */
export interface Arrangement {
  apply(root: ParentNode): void;
  undo(): void;
}

// ── The frames' crop (BRIEF §10.10) ──────────────────────────────────────────

/**
 * A frame and its photograph; the words that stand in it are its blocks (`.d-frame__main`, `.d-frame__aside`), a
 * piece's lines, NOW's collection label row.
 */
const FIT_FRAMES = [
  '.now__hero',
  '.view--now > .n-sec:has(> .now__teaser-photo)',
  '.n-releases__release',
  '.n-lookbook__model:not(.n-wishlist__card)',
  '.n-model__body',
  '.n-piece__article',
  '.d-res__frame',
  '.d-pframe',
].join(', ');
const FIT_PHOTO = ':scope > .n-ph > img, :scope > .now__teaser-photo > img, :scope > .n-model__photo > img, :scope > .n-piece__photo > .n-ph > img, :scope > .n-result__model > .n-ph > img';
const FIT_WORDS = '.d-frame__main, .d-frame__aside, :scope > .n-piece__lines, :scope > .n-sb';
const WORDS_TOP = '--d-words-top';

let fitObserver: ResizeObserver | null = null;
const fitted = new Set<HTMLElement>();

/**
 * Writes on each frame where its words begin, measured from its photograph's top (`--d-words-top`, px): the crop of
 * shared/desktop.css keeps the piece above them, and a light frame's photograph ends on them (a model's, a piece's).
 * Read again whenever a frame, its photograph or its words change size (a window resized, the fonts arrived).
 */
function fitFrames(root: ParentNode): void {
  if (!fitObserver) {
    fitObserver = new ResizeObserver(() => measureFrames());
    // A title fitted before its face arrived is fitted again in it.
    void document.fonts?.ready.then(() => measureFrames());
  }
  for (const frame of root.querySelectorAll<HTMLElement>(FIT_FRAMES)) {
    const img = frame.querySelector<HTMLElement>(FIT_PHOTO);
    // A frame without its photograph (a model not photographed yet) still fits its title to its block.
    fitted.add(frame);
    // Observed again as the page changes: a frame's words may have been drawn anew.
    for (const el of [frame, ...(img?.parentElement ? [img.parentElement] : []), ...frame.querySelectorAll<HTMLElement>(FIT_WORDS)]) fitObserver.observe(el);
  }
  measureFrames();
}

/**
 * NOW's title on one line where shared/desktop.css asks for it (a short window in the light mode: `MONOLITHE IN BLUE`)
 * and the line holds it whole; else with its break (`MONOLITHE,` / `THE OCTOBER DRAW`). Tried, then kept or taken back:
 * where the rule does not apply the title keeps its two lines and the mark goes.
 */
const ONE_LINE = 'd-one-line';

function fitOneLine(frame: HTMLElement): void {
  const title = frame.querySelector<HTMLElement>(':scope > .n-lift .now__title');
  if (!title) return;
  if (!title.querySelector(':scope > br')) {
    title.classList.remove(ONE_LINE);
    return;
  }
  title.classList.add(ONE_LINE);
  const size = parseFloat(getComputedStyle(title).fontSize);
  if (title.getBoundingClientRect().height > size * 1.5) title.classList.remove(ONE_LINE);
}

/**
 * A frame's title set to fit its left block (`--d-title-fit`, px; shared/desktop.css takes the smaller of it and the
 * role's size), so it keeps the lines it is set in, two at most (§10.5, §10.9): a title with its own break, each of its
 * lines whole (`MONOLITHE ARCHITECTURALE,` / `THE SECOND EDITION`, `MONOLITHE,` / `THE OCTOBER DRAW`); one without, its
 * longest word and its kept end never cut (a model of 24 characters: `MONOLITHE` / `ARCHITECTURALE`). Widths are read
 * on a canvas in the title's own type and tracking (never in the page, whose changes this module watches); in ems they
 * do not depend on the size, so the fit is stable.
 */
const TITLE_FIT = '--d-title-fit';
const FIT_TITLES = '.d-frame__main > :is(.now__title, .n-release__title, .n-live__title, .n-releases__title, .n-model__title, .lookbook-card__name)';
let measureCanvas: CanvasRenderingContext2D | null = null;

/** The widest of `texts`, each on one line in `title`'s type, in px at its present size. */
function widest(title: HTMLElement, texts: readonly string[]): number {
  measureCanvas ??= document.createElement('canvas').getContext('2d');
  if (!measureCanvas) return 0;
  const cs = getComputedStyle(title);
  measureCanvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const tracking = parseFloat(cs.letterSpacing) || 0;
  let most = 0;
  for (const t of texts) most = Math.max(most, measureCanvas.measureText(t).width + tracking * [...t].length);
  return most;
}

/** What must stay on one line in a title: each line between its breaks; without a break, each word and its kept end. */
function unbroken(title: HTMLElement): string[] {
  const lines: string[] = [''];
  for (const n of title.childNodes) {
    if (n instanceof HTMLBRElement) lines.push('');
    else lines[lines.length - 1] += n.textContent ?? '';
  }
  const trimmed = lines.map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l.length > 0);
  if (trimmed.length > 1) return trimmed;
  const keep = title.querySelector(`:scope > .${KEEP}`)?.textContent?.trim();
  return [...(trimmed[0] ?? '').split(' '), ...(keep ? [keep.replace(/\s+/g, ' ')] : [])];
}

/**
 * A release's page frame (a draw's, a LIVE RELEASE's: `.d-pframe`) sets its title, the page's h1, in one of two roles
 * and never a size between them (§10.5), chosen by its words alone, so a release keeps its title's size in every state
 * and every frame of the same kind keeps one role at one width: D2 wherever its lines hold beside the right block, on
 * one line where that line holds it whole (`MONOLITHE IN BLUE`), else in the page's lines (`MONOLITHE` / `IN STEEL`,
 * `MONOLITHE,` / `THE OCTOBER DRAW`); else D3, on one line where it holds (a title without a comma), else in its lines,
 * broken after its comma (`MONOLITHE IN STEEL,` / `THE LAST DRAW OF SEPTEMBER`). A short window's role is D3 alone. A D3 line that
 * does not hold beside the right block takes the words' whole width (`d-title-wide`, shared/desktop.css): it runs past
 * the left block, toward the right block, as long as it stops a gutter before what the right block draws (its plate,
 * its button, its words); where it would reach it, the right block stands on the foot line under the title's last
 * line, 24 px under it: what the left block holds under the title is given room to (`--d-title-drop`, the title's own
 * margin below), so both blocks keep one foot line.
 */
const WIDE = 'd-title-wide';
const DROP = '--d-title-drop';
/** A canvas's measure against the page's: the room a line keeps for their rounding (px). */
const HAIR = 2;

/** The lines a title takes in its block, read in the page. */
function titleLines(title: HTMLElement): number {
  const cs = getComputedStyle(title);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.04;
  return Math.round(title.getBoundingClientRect().height / lh);
}

/**
 * The window width a title's role is chosen at (§10.5's values are those of 1440): wider, a title keeps the role it
 * takes there (MONOLITHE IN GOLD, / THE WEEKEND DRAW stays D3, never D3 at 1440 and D2 at 1920, 1.7 times its size);
 * narrower, it steps down where it does not hold.
 */
const ROLE_AT = 1440;

/** The canvas's width at a window of `w` px (shared/desktop.css --d-edge: the margin's clamp, the content's 1600 px). */
function canvasAt(w: number): number {
  return w - 2 * Math.max(Math.min(128, Math.max(48, w * 0.06667)), (w - 1600) / 2);
}

/** A block's room (px) as it would be at 1440: the block grows with the canvas, its right block and gap fixed. */
function roomAtRole(room: number): number {
  return room - (canvasAt(window.innerWidth) - canvasAt(ROLE_AT));
}

/** A page frame's title in its role (above); true when it takes the words' whole width. */
function fitPageTitle(title: HTMLElement, size: number, room: number, full: number, framed: boolean): boolean {
  const w = window.innerWidth;
  const d2 = Math.min(96, Math.max(48, w * 0.05));
  const d3 = Math.min(72, Math.max(40, w * 0.03889));
  const br = title.querySelector(':scope > br');
  // A title broken after its comma (a draw's) is never set on one line in D3: its break is its reading.
  const comma = br !== null && /,\s*$/.test(br.previousSibling?.textContent ?? '');
  // In ems, read once at the present size (a size changed below never changes them).
  const whole = widest(title, [(title.textContent ?? '').replace(/\s+/g, ' ').trim()]) / size;
  const parts = widest(title, unbroken(title)) / size;
  const holds = (px: number, ems: number, width: number) => ems * px <= width - HAIR;
  const set = (fit: string, one: boolean, wide: boolean) => {
    if (title.classList.contains(ONE_LINE) !== one) title.classList.toggle(ONE_LINE, one);
    if (title.classList.contains(WIDE) !== wide) title.classList.toggle(WIDE, wide);
    if (title.style.getPropertyValue(TITLE_FIT) !== fit) title.style.setProperty(TITLE_FIT, fit);
  };
  const tries: ['d2' | 'd3', boolean][] = window.innerHeight > 780 ? [['d2', true], ['d2', false], ['d3', true], ['d3', false]] : [['d3', true], ['d3', false]];
  // Wider than 1440: the role (and its one line or two) the title takes at 1440 (D2 72, D3 56 there), never a larger
  // one; the tries below start from it.
  let from = 0;
  if (w > ROLE_AT) {
    const ref = roomAtRole(room);
    from = tries.findIndex(([role, one], i) => {
      if (one && (br === null || (role === 'd3' && comma))) return false;
      if (i === tries.length - 1) return true;
      return holds(role === 'd2' ? 72 : 56, one ? whole : parts, ref);
    });
    if (from < 0) from = 0;
  }
  for (const [role, one] of tries.slice(from)) {
    if (one && (br === null || (role === 'd3' && comma))) continue;
    const px = role === 'd2' ? d2 : d3;
    const last = role === 'd3' && !one;
    if (!last && !holds(px, one ? whole : parts, room)) continue;
    const wide = last && framed && !holds(px, parts, room);
    // A line longer than the words' whole width even in D3 (no title of the demo's): fitted to it, never under 40 px.
    const over = wide && !holds(px, parts, full);
    set(over ? `${Math.max(40, Math.floor(((full - HAIR) / parts) * 10) / 10)}px` : `var(--d-fs-${role})`, one, wide);
    // The canvas's measure confirmed in the page: a line it let through that the page wraps tries the next role.
    if (last || titleLines(title) <= (one ? 1 : 2)) return wide;
  }
  return false;
}

/**
 * NOW's title's role for a fit of `px`: D2 (a tall window) or D3 where it holds, else null (the fit itself). Wider than
 * 1440, never a larger role than the one its fit at 1440 (`refPx`, D2 72, D3 56 there) gives.
 */
function nowRole(px: number, refPx: number | null): string | null {
  const w = window.innerWidth;
  const d2 = Math.min(96, Math.max(48, w * 0.05));
  const d3 = Math.min(72, Math.max(40, w * 0.03889));
  const tall = window.innerHeight > 780;
  const d2Ok = refPx === null || (tall && refPx >= 72);
  const d3Ok = refPx === null || refPx >= 56;
  if (tall && d2Ok && px >= d2) return 'var(--d-fs-d2)';
  if (d3Ok && px >= d3) return 'var(--d-fs-d3)';
  return null;
}

function fitTitle(frame: HTMLElement): void {
  const title = frame.querySelector<HTMLElement>(FIT_TITLES);
  const words = title?.parentElement?.parentElement;
  if (!title || !words) {
    title?.style.removeProperty(TITLE_FIT);
    return;
  }
  const size = parseFloat(getComputedStyle(title).fontSize);
  const ems = widest(title, unbroken(title)) / size;
  const cs = getComputedStyle(words);
  const aside = words.querySelector<HTMLElement>(':scope > .d-frame__aside');
  const full = words.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const room = full - (aside ? aside.getBoundingClientRect().width + (parseFloat(cs.columnGap) || 0) : 0);
  if (!(ems > 0) || !(room > 0)) return;
  let wide = false;
  if (frame.classList.contains('d-pframe')) wide = fitPageTitle(title, size, room, full, aside !== null);
  else {
    // A hair of room kept for the canvas's own rounding.
    let px = Math.floor(((room * 0.99) / ems) * 10) / 10;
    // NOW's frame (D2, D3 in a short window) keeps the roles only (§10.5): D2 where its lines hold beside the right
    // block, else D3 (`MONOLITHE,` / `THE OCTOBER DRAW` at 1440), fitted below D3 only where even D3 would cut a line.
    const refPx = window.innerWidth > ROLE_AT ? Math.floor(((roomAtRole(room) * 0.99) / ems) * 10) / 10 : null;
    const role = frame.classList.contains('now__hero') ? nowRole(px, refPx) : null;
    const value = role ?? `${px}px`;
    if (title.style.getPropertyValue(TITLE_FIT) !== value) title.style.setProperty(TITLE_FIT, value);
    // Two lines at most (§10.5): a title whose words, each whole, still take three lines in its block at that size
    // (`MONOLITHE` / `ARCHITECTURALE` / `IN POLISHED`) steps down until they take two.
    for (let i = 0; i < 16 && titleLines(title) > 2; i++) {
      px = Math.floor(Math.min(px, parseFloat(getComputedStyle(title).fontSize)) * 0.95 * 10) / 10;
      title.style.setProperty(TITLE_FIT, `${px}px`);
    }
  }
  // A wide title: where its lines, in their place without room under them, would come within 24 px of what the right
  // block draws, the room under it for the right block (what the left block holds under it counted).
  let drop = '';
  if (wide && aside) {
    const main = title.parentElement!;
    const now = parseFloat(getComputedStyle(title).marginBottom) || 0;
    const held = main.getBoundingClientRect().bottom - title.getBoundingClientRect().bottom - now;
    const range = document.createRange();
    range.selectNodeContents(title);
    const lines = [...range.getClientRects()].filter((q) => q.width > 1).map((q) => ({ top: q.top + now, bottom: q.bottom + now, right: q.right }));
    const drawn: DOMRect[] = [];
    for (const el of aside.children) {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
      const cs = getComputedStyle(el);
      if (el.matches('.n-btn, :has(> .n-btn)') || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none') drawn.push(el.getBoundingClientRect());
      else {
        range.selectNodeContents(el);
        drawn.push(...[...range.getClientRects()].filter((q) => q.width > 1));
      }
    }
    // Beside it, the blocks' own gap (the gutter, as between the two blocks); above or under it, 24 px.
    const gap = parseFloat(cs.columnGap) || 24;
    const meets = lines.some((l) => drawn.some((d) => l.right + gap > d.left && l.bottom + 24 > d.top && l.top - 24 < d.bottom));
    if (meets) drop = `${Math.max(0, Math.ceil(aside.getBoundingClientRect().height + 24 - held))}px`;
  }
  if (title.style.getPropertyValue(DROP) !== drop) {
    if (drop) title.style.setProperty(DROP, drop);
    else title.style.removeProperty(DROP);
  }
}

function measureFrames(): void {
  for (const frame of fitted) {
    if (!frame.isConnected) {
      fitted.delete(frame);
      continue;
    }
    fitTitle(frame);
    if (frame.classList.contains('now__hero')) fitOneLine(frame);
    const box = frame.querySelector<HTMLElement>(FIT_PHOTO)?.parentElement;
    fitFoot(frame, box ?? null);
    // Where the words themselves begin: a block's top past its padding (a light piece's lines are held down by theirs).
    const tops = [...frame.querySelectorAll<HTMLElement>(FIT_WORDS)].filter((w) => w.offsetParent !== null).map((w) => w.getBoundingClientRect().top + parseFloat(getComputedStyle(w).paddingTop));
    placeBarMark(frame, tops.length > 0 ? [...tops, ...crumbTops(frame)] : tops);
    if (!box || tops.length === 0) continue;
    const value = `${Math.round(Math.min(...tops) - box.getBoundingClientRect().top)}px`;
    if (frame.style.getPropertyValue(WORDS_TOP) !== value) frame.style.setProperty(WORDS_TOP, value);
    fitDissolve(frame, box);
  }
}

/** A page frame (NOW's, a model's, a piece's): its light photograph's dissolve placed for the whole piece. */
const PAGE_FRAMES = '.now__hero, .d-pframe:not(.d-pframe--sealed), .n-model__body, .n-piece__article';
/** A list's frame (THE RELEASES', THE COLLECTION's, NOW's collection, a result's): the same, its piece the bar's room
 *  under its top too, as its top passes under the bar. */
const LIST_FRAMES = '.n-releases__release, .n-lookbook__model:not(.n-wishlist__card), .view--now > .n-sec, .d-res__frame';
const DIS = '--d-dis';
/** Where a light frame's dissolve starts, as a share of its photograph's height: light.css's at most, the last tenth at
 *  least, or the last 32 px of a page frame's photograph in a short window (fitFoot). */
const DIS_FROM = 0.76;
const DIS_TO = 0.9;
const DIS_PX = 32;

const FOOT = '--d-foot';
const GAP = '--d-gap';
/** A light page frame's words: their foot (72 px, 24 at least), the white above them (24 px, none at least), and the
 *  dissolve under the piece that a short window keeps before taking from the foot (40 px). */
const FOOT_MAX = 72;
const FOOT_MIN = 24;
const GAP_MAX = 24;
const DIS_KEEP = 40;

/** The height of a frame's words, both on one foot line: its two blocks together; a piece's lines (without their
 *  padding) beside its right block. */
function wordsHeight(frame: HTMLElement): number {
  let most = 0;
  const blocks = [...frame.querySelectorAll<HTMLElement>('.d-frame__main, .d-frame__aside')].filter((b) => b.offsetParent !== null);
  if (blocks.length > 0) {
    const rects = blocks.map((b) => b.getBoundingClientRect());
    most = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top));
  }
  const lines = frame.querySelector<HTMLElement>(':scope > .n-piece__lines');
  if (lines) {
    const cs = getComputedStyle(lines);
    most = Math.max(most, lines.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  }
  return most;
}

/**
 * A light page frame (NOW's, a model's, a piece's) keeps the window's height (BRIEF §10.10): the piece whole 24 px
 * under the bar, its words' foot 72 px above the frame's (§10.27). A window too short for both takes its room first
 * from the 24 px of white between the photograph and the words, then from the words' foot, down to 24 px, keeping
 * 40 px of dissolve under the piece, then 32 (desktop.css --d-photo-min); only a window that leaves less grows the
 * frame. Written on the frame (`--d-foot`, `--d-gap`), read by desktop.css; nothing in the dark.
 */
function fitFoot(frame: HTMLElement, box: HTMLElement | null): void {
  const light = document.documentElement.dataset.mode === 'light' && document.body.dataset.screen !== 'scan';
  if (!light || !box || !frame.matches(PAGE_FRAMES)) {
    if (frame.style.getPropertyValue(FOOT)) frame.style.removeProperty(FOOT);
    if (frame.style.getPropertyValue(GAP)) frame.style.removeProperty(GAP);
    return;
  }
  const words = wordsHeight(frame);
  if (!(words > 0)) return;
  const focus = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--frame-focus-h')) || 0;
  const room = Math.max(window.innerHeight, 640) - (BAR_HEIGHT + 24 + focus * window.innerWidth) - words;
  let foot = FOOT_MAX;
  let gap = GAP_MAX;
  const short = () => DIS_KEEP - (room - foot - gap);
  if (short() > 0) gap = Math.max(0, gap - short());
  if (short() > 0) foot = Math.max(FOOT_MIN, foot - short());
  const f = `${Math.round(foot)}px`;
  const g = `${Math.round(gap)}px`;
  if (frame.style.getPropertyValue(FOOT) !== f) frame.style.setProperty(FOOT, f);
  if (frame.style.getPropertyValue(GAP) !== g) frame.style.setProperty(GAP, g);
}

/**
 * In the light mode a frame's photograph dissolves into the white at its foot (shared/desktop.css). Its dissolve
 * starts as late as the light's own (76 % of the photograph) allows the piece to stand whole above it, its top the
 * bar's height and 24 px under the frame's top (a page frame's and a list frame's alike) and its height
 * --frame-focus-h of the window's width; lower
 * when the photograph is short for the window's width, to 90 % at most (a frame grows past its height only beyond
 * that, desktop.css --d-photo-min and the list frames' photograph minimum). Read after the photograph took its
 * height; it moves only the crop and the dissolve, never a box.
 */
function fitDissolve(frame: HTMLElement, box: HTMLElement): void {
  const light = document.documentElement.dataset.mode === 'light' && document.body.dataset.screen !== 'scan';
  const page = frame.matches(PAGE_FRAMES);
  if (!light || !(page || frame.matches(LIST_FRAMES))) {
    if (frame.style.getPropertyValue(DIS)) frame.style.removeProperty(DIS);
    return;
  }
  const height = box.getBoundingClientRect().height;
  const focus = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--frame-focus-h')) || 0;
  if (height <= 0) return;
  const need = BAR_HEIGHT + 24 + focus * window.innerWidth;
  const to = page ? Math.max(DIS_TO, 1 - DIS_PX / height) : DIS_TO;
  const value = Math.min(to, Math.max(DIS_FROM, need / height)).toFixed(4);
  if (frame.style.getPropertyValue(DIS) !== value) frame.style.setProperty(DIS, value);
}

// ── The top bar's mark ───────────────────────────────────────────────────────

/**
 * The mark of no height the top bar watches on the frame a page opens on (§10.14): at the top of the frame's words (the
 * higher of its two blocks, past its padding; a piece's lines) or of the crumb standing over the frame (‹ THE
 * COLLECTION, ‹ MY PIECES, ‹ THE RELEASES: `crumbTops`), whichever is higher, so the bar takes its ground, its hairline
 * and its words before any word of the frame reaches it, and is clear again once they are back under it. Placed by
 * `measureFrames` whenever a frame or its words change size; a frame without words keeps none (the bar then watches the
 * frame's foot). (Watching the frame's foot let the frame's words slide under the clear bar's words while scrolling,
 * against "nothing overlaps"; the bar's own veil, shared/desktop.css, stays under its words while the photograph passes
 * under it.)
 */
const BAR_MARK = 'd-bar-mark';

function barMarkOf(frame: HTMLElement): HTMLElement {
  let mark = frame.querySelector<HTMLElement>(`:scope > .${BAR_MARK}`);
  if (!mark) {
    mark = document.createElement('span');
    mark.className = BAR_MARK;
    mark.setAttribute('aria-hidden', 'true');
    frame.append(mark);
  }
  return mark;
}

/**
 * The mark's lead over the words' top (px): a display title set solid (D1 at line-height 1.0) draws its capitals a few
 * px above its box, and the bar's ground takes 240 ms to come; one step of the scale (§10.4) keeps both clear.
 */
const BAR_LEAD = 16;

/** Puts `frame`'s mark (when it has one) at the top of its words (`tops`: each block's, in the window), less its lead. */
function placeBarMark(frame: HTMLElement, tops: readonly number[]): void {
  const mark = frame.querySelector<HTMLElement>(`:scope > .${BAR_MARK}`);
  if (!mark) return;
  if (tops.length === 0) {
    mark.hidden = true;
    return;
  }
  if (mark.hidden) mark.hidden = false;
  const parent = mark.offsetParent;
  const base = parent ? parent.getBoundingClientRect().top + parent.clientTop : -window.scrollY;
  const value = `${Math.round(Math.min(...tops) - BAR_LEAD - base)}px`;
  if (mark.style.top !== value) mark.style.top = value;
}

/**
 * The tops (in the window) of the page's crumbs that stand over `frame` (a crumb of the same view, its box inside the
 * frame's height): on a model, a piece, a release, the crumb is the frame's first words under the bar.
 */
function crumbTops(frame: HTMLElement): number[] {
  const view = frame.closest('.view');
  if (!view) return [];
  const f = frame.getBoundingClientRect();
  const out: number[] = [];
  for (const c of view.querySelectorAll<HTMLElement>('.n-crumb')) {
    if (c.offsetParent === null) continue;
    const r = c.getBoundingClientRect();
    if (r.height > 0 && r.top >= f.top - 0.5 && r.top < f.bottom) out.push(r.top);
  }
  return out;
}

/** The mark the bar watches for the frame a page opens on: at the top of its words, or none (a frame without words). */
function barMark(opening: Element): HTMLElement | null {
  // The sign-in page's photograph has its own mark (views/desktop-signin.ts), watched by its foot.
  if (opening.matches('.d-signin__over')) return null;
  const frame = opening.closest<HTMLElement>(FIT_FRAMES);
  if (!frame || !frame.querySelector(FIT_WORDS)) return null;
  const mark = barMarkOf(frame);
  const tops = [...frame.querySelectorAll<HTMLElement>(FIT_WORDS)].filter((w) => w.offsetParent !== null).map((w) => w.getBoundingClientRect().top + parseFloat(getComputedStyle(w).paddingTop));
  placeBarMark(frame, tops.length > 0 ? [...tops, ...crumbTops(frame)] : tops);
  return mark.hidden ? null : mark;
}

function unmarkAll(): void {
  for (const mark of document.querySelectorAll(`.${BAR_MARK}`)) mark.remove();
}

function unfitAll(): void {
  fitObserver?.disconnect();
  for (const frame of fitted) {
    frame.style.removeProperty(WORDS_TOP);
    frame.style.removeProperty(DIS);
    frame.style.removeProperty(FOOT);
    frame.style.removeProperty(GAP);
    frame.querySelector(`.${ONE_LINE}`)?.classList.remove(ONE_LINE);
    for (const title of frame.querySelectorAll<HTMLElement>('.now__title, .n-release__title, .n-live__title, .n-releases__title, .n-model__title, .lookbook-card__name')) {
      title.style.removeProperty(TITLE_FIT);
      title.style.removeProperty(DROP);
      title.classList.remove(WIDE);
    }
  }
  fitted.clear();
}

/**
 * The first photograph of a list (THE RELEASES, THE COLLECTION) stands in the first window: fetched at once and first
 * (BRIEF §10.11), the others as they near the window. A page's opening photograph is asked for so where it is made
 * (views/nocturne.ts fadedPhoto).
 */
function firstListPhotos(root: ParentNode): void {
  for (const sel of ['.n-releases__release > .n-ph > img', '.n-lookbook__model:not(.n-wishlist__card) > .n-ph > img']) {
    const img = root.querySelector<HTMLImageElement>(sel);
    if (img && img.loading === 'lazy') {
      img.setAttribute('fetchpriority', 'high');
      img.loading = 'eager';
    }
  }
}

// ── The top bar ──────────────────────────────────────────────────────────────

const OVER = 'd-bar-over';
const STILL = 'd-bar-still';
/** Set while the bar turns solid or clear as the page scrolls: its words then change in the bar's 240 ms (§10.14). */
const TURN = 'd-bar-turn';
const TURN_MS = 240;

/**
 * Keeps the frames' words in their two blocks and the top bar's ground in step with the page (BRIEF §5.3, §10.14): over
 * the frame a page opens on, `html.d-bar-over` (no ground; its own veil under its words, shared/desktop.css) until the
 * top of the frame's words reaches the bar's foot (the frame's mark, above; the frame's own foot for one without
 * words), then the ground, the hairline and the words together, the veil going as the ground comes (240 ms,
 * `html.d-bar-turn` while they turn), so no word of the frame ever passes under the bar's words; clear again once they
 * are back under it. The class is set without its transition when a
 * page arrives (a frame drawn, a frame gone), so a page never opens with the bar changing. Pages are watched as they
 * are drawn (a MutationObserver: a screen draws its frame once it has read its data); scrolling is the
 * IntersectionObserver's alone (the mark or the frame, the window less the bar's height: no scroll handler, no layout read).
 */
export function watchBar(opts: { content?: Node; arrange?: readonly Arrangement[] } = {}): void {
  // A phone or a tablet never has the desktop layout (touchLayout): nothing to arrange, nothing to watch.
  if (touchLayout()) return;
  const arrangements = opts.arrange ?? [];
  const root = document.documentElement;
  let frame: Element | null = null;
  let io: IntersectionObserver | null = null;
  const still = (over: boolean) => {
    if (root.classList.contains(OVER) === over) return;
    root.classList.add(STILL);
    root.classList.toggle(OVER, over);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(STILL)));
  };
  let turnEnd = 0;
  const turn = (over: boolean) => {
    if (root.classList.contains(OVER) === over) return;
    root.classList.add(TURN);
    root.classList.toggle(OVER, over);
    window.clearTimeout(turnEnd);
    turnEnd = window.setTimeout(() => root.classList.remove(TURN), TURN_MS + 40);
  };
  const observe = (opening: Element | null) => {
    // What the bar watches: the mark at the top of the frame's words (its top), else the frame itself (its foot).
    const mark = opening ? barMark(opening) : null;
    const next = mark ?? opening;
    if (next === frame) return;
    io?.disconnect();
    io = null;
    frame = next;
    if (!next) {
      still(false);
      return;
    }
    // Over the frame while the watched edge is under the bar's foot (a mark below the window included).
    const over = (rect: DOMRectReadOnly) => (mark ? rect.top >= BAR_HEIGHT - 0.5 : rect.bottom > BAR_HEIGHT + 0.5);
    // Read once as the frame arrives, so the bar is right in the first paint; then the observer tells each crossing.
    still(over(next.getBoundingClientRect()));
    io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (e && frame === next) turn(over(e.boundingClientRect));
      },
      { rootMargin: `-${BAR_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(next);
  };
  const read = () => {
    if (!isDesktop()) {
      unfitAll();
      unsplitAll();
      unbreakWrapped();
      unfitWords();
      unfitLines();
      for (const a of arrangements) a.undo();
      undoMoves();
      observe(null);
      unmarkAll();
      levelPanelHeads(false);
      return;
    }
    // An element moved into its desktop place loses the focus a screen had just given it (a dot pressed, a size chosen,
    // REQUESTED's heading): given back, where it now stands.
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    for (const a of arrangements) a.apply(document);
    splitAll(document);
    levelPanelHeads(true);
    if (active && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    firstListPhotos(document);
    fitFrames(document);
    observe(document.querySelector(OPENING_FRAMES));
  };
  new MutationObserver(read).observe(opts.content ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-banner', 'hidden'] });
  onDesktopChange(read);
  read();
  stillOnCurrent();
}

/**
 * A piece's tab sections (WARRANTY, WARRANTY CLAIM, PRIVATE CARE, CARING FOR THIS PIECE, SERVICE HISTORY, OWNERSHIP
 * CERTIFICATE, REPORT LOST / STOLEN…): on a computer their heads are of level 2, as the piece's other sections under its
 * h1 (WHERE IT COMES FROM, GENOME), so the headings never skip a level when those are not shown (§10.32); a phone keeps
 * its h3s as they are.
 */
const PANEL_HEADS = '.view--piece [role="tabpanel"] h3';
const LEVELLED = 'dLevel';

function levelPanelHeads(on: boolean): void {
  if (on) {
    for (const el of document.querySelectorAll<HTMLElement>(PANEL_HEADS)) {
      if (el.getAttribute('aria-level') === '2') continue;
      el.setAttribute('aria-level', '2');
      el.dataset[LEVELLED] = '';
    }
    return;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-d-level]')) {
    el.removeAttribute('aria-level');
    delete el.dataset[LEVELLED];
  }
}

/**
 * A page change moves the menu's current item (and SCAN's, the account's current mark): the words take their ink or
 * their soft at once, never in the hover's 160 ms (§10.13: the menu's current item changes instantly), whether or not
 * the bar turns at the same time. The bar's words are held still (`html.d-bar-still`) for the two frames the change is
 * drawn in, as a page arriving holds them (watchBar).
 */
function stillOnCurrent(): void {
  if (touchLayout()) return;
  const root = document.documentElement;
  new MutationObserver((records) => {
    if (!isDesktop() || !records.some((r) => r.target instanceof Element && r.target.closest('.n-hd'))) return;
    root.classList.add(STILL);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(STILL)));
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
}
