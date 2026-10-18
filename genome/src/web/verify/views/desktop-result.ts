/**
 * A result on a computer (desktop, BRIEF §3, §6 "The scan", §10.24, §10.27): what the desktop layout changes in
 * a result's page, not only in its styles. shared/desktop.ts watchBar applies it each time a result is drawn, and undoes
 * it on a phone: each element is moved into its place, leaving a mark where it stood, and put back there.
 *
 * The page keeps the phone's order (the result, the GENOME, THE MODEL's photograph and the piece's lines, the tabs, ORBES
 * Client Services, the foot), staged in Cinema's two kinds of frame:
 *
 *   the stage     a result with a GENOME opens on it, under the solid bar (it has no photograph, so it is no frame) and
 *                 as tall as its content: the result on the left (its mark, its word, its sub-title, the server's
 *                 sentence, the second-hand guidance), the GENOME on the right (on a first registration's ceremony, its
 *                 names and SHARE under it), on one foot line; THE MODEL's frame starts inside the first window
 *   the frame     THE MODEL's photograph filling the window's width (never the piece's own), the piece's lines in its
 *                 lower third on the left, THE MODEL and the photograph's note on the right (as a piece's page)
 *   the canvas    the tabs; ORBES Client Services and the certificate-card section beside WHERE DID YOU SEE OR BUY THIS
 *                 PIECE?; the foot (the assurance note, VERIFIED and REF, SCAN ANOTHER)
 *
 * A result without a GENOME (an invalid signature, an unknown or unreadable code) opens on its head on the grid, as a
 * chapter's (§10.24). Nothing is dropped and nothing is added: every element of the phone's result is placed.
 *
 * The OWNERSHIP tab's panel is paired too, each time it is drawn (it draws itself anew as the session or the piece
 * changes): the piece's state and SIGNED IN AS in one column, what can be done with it (from its first heading:
 * TRANSFER OF OWNERSHIP, RECEIVING THIS PIECE) in the other; without a heading, SIGNED IN AS stands in the other.
 */
import type { Arrangement } from '../../shared/desktop.js';

const ARRANGED = 'd-res';

/** Each arranged result: the marks left where its elements stood, and the boxes made for the desktop. */
const arranged = new Map<HTMLElement, { marks: [Comment, Element][]; boxes: HTMLElement[]; classes: string[] }>();

function box(cls: string, ...children: (Element | null)[]): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  for (const c of children) if (c) el.append(c);
  return el;
}

function arrange(view: HTMLElement): void {
  const marks: [Comment, Element][] = [];
  const boxes: HTMLElement[] = [];
  const take = <T extends Element>(el: T | null): T | null => {
    if (!el) return null;
    const mark = document.createComment('d-res');
    el.before(mark);
    marks.push([mark, el]);
    return el;
  };
  const pick = (sel: string) => view.querySelector<HTMLElement>(`:scope > ${sel}`);
  const head = take(pick('.n-result__head'));
  const notice = take(pick('.n-result__notice-block'));
  const genome = take(pick('.n-result__ceremony') ?? pick('.n-result__genome'));
  const model = take(pick('.n-result__model'));
  const lines = take(pick('.n-result__lines'));
  const tabs = take(pick('.n-result__tabs'));
  const help = take(pick('.n-result__help'));
  const cards = [...view.querySelectorAll<HTMLElement>(':scope > .n-result__card')].map((c) => take(c));
  const report = take(pick('.n-report'));
  const foot = take(pick('.n-result__foot'));
  // THE MODEL and the photograph's note stand in the frame's right block.
  const caption = take(model?.querySelector<HTMLElement>(':scope > .n-cap2') ?? null);
  const note = take(model?.querySelector<HTMLElement>(':scope > .n-result__photo-note') ?? null);

  const words = box('d-res__words', head, notice);
  const opening = genome ? box('d-res__stage', words, box('d-res__visual', genome)) : box('d-res__head', words);
  const frame = model ? box('d-res__frame', model, box('d-res__frame-words', box('d-frame__main', lines), box('d-frame__aside', caption, note))) : lines;
  const pair = help || cards.length > 0 || report ? box('d-res__pair', box('d-res__col d-res__col--help', help, ...cards), report ? box('d-res__col d-res__col--report', report) : null) : null;
  const order = [opening, frame, tabs, pair, foot].filter((x): x is HTMLElement => x !== null);
  for (const el of [opening, frame, pair]) if (el && el !== lines) boxes.push(el);
  view.append(...order);
  const classes = [ARRANGED, genome ? 'd-res--stage' : 'd-res--head', model ? 'd-res--model' : null, genome?.classList.contains('n-result__ceremony') ? 'd-res--ceremony' : null].filter((c): c is string => c !== null);
  view.classList.add(...classes);
  arranged.set(view, { marks, boxes, classes });
}

function undo(view: HTMLElement): void {
  const entry = arranged.get(view);
  arranged.delete(view);
  if (!entry) return;
  // In reverse: the caption and the note go back into the photograph's section before it goes back itself.
  for (const [mark, el] of [...entry.marks].reverse()) {
    if (mark.isConnected) mark.replaceWith(el);
    else mark.remove();
  }
  for (const b of entry.boxes) b.remove();
  view.classList.remove(...entry.classes);
}

/** Each paired OWNERSHIP panel and its children in their own order, to put back. */
const paired = new Map<HTMLElement, Element[]>();
const PAIRED = 'd-own--pair';

function pairOwnership(own: HTMLElement): void {
  if (own.querySelector(':scope > .d-own__col')) return;
  const kids = [...own.children];
  const account = kids.find((k) => k.classList.contains('n-own__account')) ?? null;
  const at = kids.findIndex((k) => k.classList.contains('n-own__heading'));
  let main: Element[];
  let side: Element[];
  if (at > 0) {
    main = [...kids.slice(0, at), ...(account ? [account] : [])];
    side = kids.slice(at).filter((k) => k !== account);
  } else if (account && kids.length > 1) {
    main = kids.filter((k) => k !== account);
    side = [account];
  } else return;
  // Moving the focused control takes the focus away: given back where it stands now.
  const focused = document.activeElement instanceof HTMLElement && own.contains(document.activeElement) ? document.activeElement : null;
  paired.set(own, kids);
  own.classList.add(PAIRED);
  own.append(box('d-own__col d-own__col--main', ...main), box('d-own__col d-own__col--side', ...side));
  focused?.focus({ preventScroll: true });
}

function unpairOwnership(own: HTMLElement, kids: Element[]): void {
  own.classList.remove(PAIRED);
  const cols = [...own.querySelectorAll<HTMLElement>(':scope > .d-own__col')];
  // Drawn anew since it was paired: nothing of the pairing is left in it.
  if (cols.length === 0) return;
  const focused = document.activeElement instanceof HTMLElement && own.contains(document.activeElement) ? document.activeElement : null;
  own.replaceChildren(...kids);
  focused?.focus({ preventScroll: true });
}

export const resultArrangement: Arrangement = {
  apply(root) {
    for (const view of [...arranged.keys()]) if (!view.isConnected) arranged.delete(view);
    for (const own of [...paired.keys()]) if (!own.isConnected) paired.delete(own);
    const view = root.querySelector<HTMLElement>('.view--result');
    if (!view) return;
    if (!arranged.has(view) && !view.classList.contains(ARRANGED)) arrange(view);
    if (!arranged.has(view)) return;
    for (const own of view.querySelectorAll<HTMLElement>(':scope > .n-result__tabs .n-result__panel > .n-own')) {
      // Drawn anew: its old pairing is gone with its children.
      if (!own.querySelector(':scope > .d-own__col')) own.classList.remove(PAIRED);
      pairOwnership(own);
    }
  },
  undo() {
    for (const [own, kids] of paired) unpairOwnership(own, kids);
    paired.clear();
    for (const view of [...arranged.keys()]) undo(view);
  },
};
