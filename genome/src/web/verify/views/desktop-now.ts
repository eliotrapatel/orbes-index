/**
 * NOW on a computer (desktop, BRIEF §3, §10.17, §10.27): what the desktop layout changes in NOW's page, not
 * only in its styles (shared/desktop.ts watchBar applies it each time NOW is drawn, and undoes it on a phone).
 *
 * - The order: the page reads, and the Tab key goes, as the eye does. Under the frame, MESSAGES' line, then the draw
 *   and, beside it, THE CIRCLE's invitation (or the scan), then YOUR PIECES: the phone's order puts MESSAGES after the
 *   draw and the invitation after YOUR PIECES, so they are moved (each leaving a mark where it stood on the phone).
 *   Without a draw under the frame (the draw or the newest model leads), THE CIRCLE's invitation is paired with the
 *   scan instead, where the phone shows the invitation. A paired invitation's head stands on its card's first line
 *   (`headIntoCard`).
 * - One h1 per page (BRIEF §10.32): NOW without a frame (nothing leads it: YOUR PIECES first) is named by a heading
 *   only a screen reader reads, the menu's word NOW (copy.ts NOW.label), before its first section.
 * - The scan: SCAN ORBES CODE leads to the SCAN page on a computer. Beside a draw it is the draw's pair, a card of the
 *   same height (SCAN, the SCAN page's sentence, then its button and its links at the card's foot); elsewhere it is a
 *   section on the grid, its words on the left columns, its actions on the right ones. The words are the SCAN page's
 *   (copy.ts DESKTOP): nothing of the phone's is dropped.
 */
import { h } from '../../shared/dom.js';
import { moveAfter, type Arrangement } from '../../shared/desktop.js';
import { DESKTOP, NOW } from '../copy.js';

const HERO = ':scope > .now__hero:first-child';
const MESSAGES = ':scope > .now__messages';
const VAULT = ':scope > .now__vault';
const DRAW = ':scope > .n-sec:has(> .now__card:not(.now__invitation, .d-scan__card))';
const CIRCLE = ':scope > .n-sec:has(.now__invitation)';
const SCAN = ':scope > .n-sec:has(.landing__scan)';

const HEAD = 'd-scan__head';
const ACTIONS = 'd-scan__actions';
const LINKS = 'd-scan__links';
const CARD = 'd-scan__card';
const ROW = 'd-scan--row';
const PAIRED = 'd-scan--card';
/** The two cards side by side, named for the layout (shared/desktop.css lays them in two columns): the draw or, without
 *  one, THE CIRCLE's invitation; and its pair. */
const LEAD_CLASS = 'd-now-lead';
const PAIR_CLASS = 'd-now-pair';

/** NOW's heading when nothing leads it (a page always has its h1 on a computer). */
const NAMED = 'd-now-h1';

function nameNow(now: HTMLElement): void {
  const own = now.querySelector(`:scope > h1.${NAMED}`);
  const other = [...now.querySelectorAll('h1')].some((el) => el !== own);
  if (other) own?.remove();
  else if (!own && now.firstElementChild) now.prepend(h('h1', { class: `visually-hidden ${NAMED}`, text: NOW.label }));
}

/** The scan sections arranged, to undo on a phone. */
const scans = new Set<HTMLElement>();

/**
 * THE CIRCLE beside the draw: its head (THE CIRCLE and its link) on its card's first line with the invitation's kind
 * (THE CIRCLE  INVITATION … THE CIRCLE), as the draw's card opens on its own label (DRAW · ENTRIES OPEN): the two
 * columns start at their cards, their first lines and titles side by side (§10.27). The card draws its lines anew on
 * an answer (views/invitation.ts): the head is put back on its first line each time, with the card's new kind.
 */
const HEAD_IN_CARD = 'd-now-head';
const heads = new Map<HTMLElement, { head: HTMLElement; mark: Comment }>();

function headIntoCard(section: HTMLElement): void {
  const card = section.querySelector<HTMLElement>(':scope > .now__invitation');
  let entry = heads.get(section);
  const head = entry?.head ?? section.querySelector<HTMLElement>(':scope > .n-sb');
  const title = head?.querySelector(':scope > h2');
  if (!card || !head || !title) return;
  if (!entry) {
    const mark = document.createComment('d-head');
    head.before(mark);
    entry = { head, mark };
    heads.set(section, entry);
  }
  if (card.firstElementChild !== head) card.prepend(head);
  if (!head.classList.contains(HEAD_IN_CARD)) head.classList.add(HEAD_IN_CARD);
  const kind = card.querySelector<HTMLElement>(':scope > .n-circle-card__kind');
  if (kind) {
    head.querySelector(':scope > .n-circle-card__kind')?.remove();
    title.after(kind);
  }
}

function headOutOfCard(section: HTMLElement): void {
  const entry = heads.get(section);
  if (!entry) return;
  heads.delete(section);
  const { head, mark } = entry;
  const card = section.querySelector<HTMLElement>(':scope > .now__invitation');
  const kind = head.querySelector<HTMLElement>(':scope > .n-circle-card__kind');
  if (kind && card && !card.querySelector(':scope > .n-circle-card__kind')) card.prepend(kind);
  else kind?.remove();
  head.classList.remove(HEAD_IN_CARD);
  if (mark.isConnected) mark.replaceWith(head);
  else mark.remove();
}

function arrangeScan(section: HTMLElement, card: boolean): void {
  const kind = card ? PAIRED : ROW;
  if (section.classList.contains(kind)) return;
  if (scans.has(section)) undoScan(section);
  const button = section.querySelector<HTMLElement>(':scope > .landing__scan');
  if (!button) return;
  const links = [...section.querySelectorAll<HTMLElement>(':scope > .now__scan-link')];
  const head = h('div', { class: HEAD }, h('p', { class: 'n-g n-lb d-scan__label', text: DESKTOP.scan }), h('p', { class: 'n-sm d-scan__lead', text: DESKTOP.scanPage.lead }));
  const actions = h('div', { class: ACTIONS }, button, h('div', { class: LINKS }, ...links));
  if (card) section.append(h('article', { class: `n-card n-card--left now__card ${CARD}` }, head, actions));
  else section.append(head, actions);
  section.classList.add(kind);
  scans.add(section);
}

function undoScan(section: HTMLElement): void {
  const button = section.querySelector<HTMLElement>(`.${ACTIONS} > .landing__scan`);
  const links = [...section.querySelectorAll<HTMLElement>(`.${LINKS} > .now__scan-link`)];
  section.querySelector(`:scope > .${CARD}`)?.remove();
  section.querySelector(`:scope > .${HEAD}`)?.remove();
  section.querySelector(`:scope > .${ACTIONS}`)?.remove();
  if (button) section.append(button, ...links);
  section.classList.remove(PAIRED, ROW);
  scans.delete(section);
}

export const nowArrangement: Arrangement = {
  apply(root) {
    for (const scan of scans) if (!scan.isConnected) scans.delete(scan);
    const now = root.querySelector<HTMLElement>('.view--now');
    if (!now) return;
    nameNow(now);
    const hero = now.querySelector(HERO);
    const messages = now.querySelector<HTMLElement>(MESSAGES);
    const draw = now.querySelector<HTMLElement>(DRAW);
    const circle = now.querySelector<HTMLElement>(CIRCLE);
    const scan = now.querySelector<HTMLElement>(SCAN);
    if (hero && messages) moveAfter(messages, hero);
    // THE VAULT's line (lot Q3 §3.7) follows MESSAGES' (or the frame, without it), as on the phone.
    const vault = now.querySelector<HTMLElement>(VAULT);
    const vaultAfter = messages ?? hero;
    if (vault && vaultAfter) moveAfter(vault, vaultAfter);
    // The draw's pair: THE CIRCLE's invitation, else the scan; without a draw, the invitation's: the scan.
    const lead = draw ?? (circle && scan ? circle : null);
    const pair = draw ? (circle ?? scan) : lead ? scan : null;
    if (lead && pair) moveAfter(pair, lead);
    for (const el of now.querySelectorAll(`.${LEAD_CLASS}, .${PAIR_CLASS}`)) {
      if (el !== lead) el.classList.remove(LEAD_CLASS);
      if (el !== pair) el.classList.remove(PAIR_CLASS);
    }
    if (lead && pair) {
      if (!lead.classList.contains(LEAD_CLASS)) lead.classList.add(LEAD_CLASS);
      if (!pair.classList.contains(PAIR_CLASS)) pair.classList.add(PAIR_CLASS);
    }
    if (scan) arrangeScan(scan, scan === pair);
    // THE CIRCLE's head in its card only beside its pair; a page drawn anew forgets the old one's.
    for (const section of [...heads.keys()]) if (!section.isConnected) heads.delete(section);
    const paired = circle && pair && (pair === circle || lead === circle) ? circle : null;
    for (const section of [...heads.keys()]) if (section !== paired) headOutOfCard(section);
    if (paired) headIntoCard(paired);
  },
  undo() {
    for (const el of document.querySelectorAll(`h1.${NAMED}`)) el.remove();
    for (const section of [...heads.keys()]) headOutOfCard(section);
    for (const scan of [...scans]) if (scan.isConnected) undoScan(scan);
    scans.clear();
    for (const el of document.querySelectorAll(`.${LEAD_CLASS}, .${PAIR_CLASS}`)) el.classList.remove(LEAD_CLASS, PAIR_CLASS);
  },
};
