/**
 * A house message as the collector's MESSAGES draws it, in the console (plan MACRO M2 §1.6: the House messages page's
 * PREVIEW, a moment's and a custom message's): its author line (`ORBES · 21 OCT 2026 · 10:02`), its title in the label
 * face, its words (paragraphs kept), its links, on the collector's ground, value for value:
 *
 *   DARK     NOCTURNE's vault: ivory #f6f2ea on #0a0a0a, ash #a7a29a, hairlines at 14 % (shared/brand.css)
 *   LIGHT    the light mode's gallery white: #0a0a0a on #ffffff, soft #5e5e5e (shared/light.css)
 *   PHONE    390 px, the account sheet's MESSAGES: a 24 px margin, 18 px above and below an item, the author 9.5 px at
 *            0.28 em in the soft ink, the title 11 px at 0.26 em, the words 15 px on 1.55, a link 10.5 px at 0.26 em
 *            (shared/brand.css, shared/nocturne.css, verify/styles.css .n-messages__*)
 *   COMPUTER the CINEMA messages page's conversation: 24 px above and below an item, the author 11 px at 0.2 em in ink
 *            (an ORBES message's), the title 12 px, the words 16.5 px on 1.6 at a 36 em measure, a link 11.5 px at
 *            0.2 em (shared/desktop.css, shared/desktop-messages.css)
 *
 * Gravesend Sans (capitals) for the author line, title and links, its figures in the reading face; Helvetica Neue for
 * the words. Each value is a CSS custom property set through the CSSOM (never a style attribute: the CSP), read by
 * admin/styles.css's `.house-frame` rules. test/web/admin.house.test.ts pins HOUSE_PREVIEW to the collector's sheets, so
 * the preview follows the app's look.
 */
import { h, mount } from '../../shared/dom.js';
import { HOUSE_COPY as C, type HousePreviewItem } from '../model/house-messages.js';

export type HousePreviewMode = 'dark' | 'light';
export type HousePreviewWidth = 'phone' | 'computer';

export const HOUSE_PREVIEW = Object.freeze({
  modes: Object.freeze({
    dark: Object.freeze({ ground: '#0a0a0a', ink: '#f6f2ea', soft: '#a7a29a', hairline: 'rgba(246, 242, 234, 0.14)' }),
    light: Object.freeze({ ground: '#ffffff', ink: '#0a0a0a', soft: '#5e5e5e', hairline: 'rgba(10, 10, 10, 0.14)' }),
  }),
  widths: Object.freeze({
    phone: Object.freeze({
      /** The phone's width and its margin. */
      width: '390px',
      margin: '24px',
      /** Above and below an item (.n-messages__item). */
      item: '18px',
      /** The author line (.n-lb): its size and tracking; in the soft ink. */
      authorSize: '9.5px',
      authorTrack: '0.28em',
      authorInk: 'soft',
      /** The title (.n-t3, in ink). */
      titleSize: '11px',
      titleTrack: '0.26em',
      titleGap: '8px',
      /** The words (.n-tx, .n-messages__body: ink, 10 px under). */
      textSize: '15px',
      textLeading: '1.55',
      textGap: '10px',
      measure: 'none',
      /** A link (.n-tl). */
      linkSize: '10.5px',
      linkTrack: '0.26em',
    }),
    computer: Object.freeze({
      width: '100%',
      margin: '40px',
      item: '24px',
      authorSize: '11px',
      authorTrack: '0.2em',
      authorInk: 'ink',
      titleSize: '12px',
      titleTrack: '0.2em',
      titleGap: '12px',
      textSize: '16.5px',
      textLeading: '1.6',
      textGap: '12px',
      measure: '36em',
      linkSize: '11.5px',
      linkTrack: '0.2em',
    }),
  }),
});

/** The custom properties a frame carries for a mode and a width. */
export function previewProperties(mode: HousePreviewMode, width: HousePreviewWidth): Record<string, string> {
  const m = HOUSE_PREVIEW.modes[mode];
  const w = HOUSE_PREVIEW.widths[width];
  return {
    '--hp-ground': m.ground,
    '--hp-ink': m.ink,
    '--hp-hairline': m.hairline,
    '--hp-author': w.authorInk === 'ink' ? m.ink : m.soft,
    '--hp-width': w.width,
    '--hp-margin': w.margin,
    '--hp-item': w.item,
    '--hp-author-size': w.authorSize,
    '--hp-author-track': w.authorTrack,
    '--hp-title-size': w.titleSize,
    '--hp-title-track': w.titleTrack,
    '--hp-title-gap': w.titleGap,
    '--hp-text-size': w.textSize,
    '--hp-text-leading': w.textLeading,
    '--hp-text-gap': w.textGap,
    '--hp-measure': w.measure,
    '--hp-link-size': w.linkSize,
    '--hp-link-track': w.linkTrack,
  };
}

/** Figures in the reading face, as the app's withNumerals draws them. */
function numerals(text: string): (string | HTMLElement)[] {
  return text.split(/(\d+)/).flatMap((part, i): (string | HTMLElement)[] => (part === '' ? [] : i % 2 === 1 ? [h('span', { class: 'house-frame__numeral' }, part)] : [part]));
}

/** One item on its ground, at a mode and a width. */
export function houseFrame(item: HousePreviewItem, mode: HousePreviewMode, width: HousePreviewWidth): HTMLElement {
  const frame = h(
    'div',
    { class: ['house-frame', `house-frame--${mode}`, `house-frame--${width}`], data: { testid: 'house-frame', mode, width } },
    h(
      'article',
      { class: 'house-frame__item' },
      h('p', { class: 'house-frame__author', data: { testid: 'house-frame-author' } }, ...numerals(item.author)),
      h('h4', { class: 'house-frame__title', data: { testid: 'house-frame-title' } }, ...numerals(item.title)),
      h('p', { class: 'house-frame__body', data: { testid: 'house-frame-body' } }, item.body),
      item.links.length ? h('p', { class: 'house-frame__links' }, ...item.links.map((l) => h('span', { class: 'house-frame__link', data: { testid: 'house-frame-link' } }, l))) : null,
    ),
  );
  for (const [k, v] of Object.entries(previewProperties(mode, width))) frame.style.setProperty(k, v);
  return frame;
}

/** The preview's choice, kept while the console is open: DARK · LIGHT, PHONE · COMPUTER. */
let chosen: { mode: HousePreviewMode; width: HousePreviewWidth } = { mode: 'dark', width: 'phone' };

/** The preview with its two choices; `note` under it. */
export function housePreview(item: HousePreviewItem, o: { note?: string; testid?: string } = {}): HTMLElement {
  const stage = h('div', { class: 'house-view__stage' });
  const choices: HTMLButtonElement[] = [];
  const choice = (group: 'mode' | 'width', value: string, label: string) => {
    const b = h('button', { class: ['range__tab', 'house-view__choice'], attrs: { type: 'button', 'data-testid': `house-view-${value}` } }, label) as HTMLButtonElement;
    b.dataset.group = group;
    b.dataset.value = value;
    b.addEventListener('click', () => {
      chosen = group === 'mode' ? { ...chosen, mode: value as HousePreviewMode } : { ...chosen, width: value as HousePreviewWidth };
      show();
    });
    choices.push(b);
    return b;
  };
  const group = (label: string, ...buttons: HTMLButtonElement[]) =>
    h('div', { class: ['range', 'house-view__choices'], attrs: { role: 'group', 'aria-label': label } }, ...buttons.flatMap((b, i) => [i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null, b]));
  const head = h(
    'div',
    { class: 'house-view__head' },
    group('Mode', choice('mode', 'dark', C.dark), choice('mode', 'light', C.light)),
    group('Width', choice('width', 'phone', C.phone), choice('width', 'computer', C.computer)),
  );
  const show = () => {
    for (const b of choices) b.setAttribute('aria-pressed', String(b.dataset.value === (b.dataset.group === 'mode' ? chosen.mode : chosen.width)));
    mount(stage, h('div', { class: ['house-view__ground', `house-view__ground--${chosen.mode}`] }, houseFrame(item, chosen.mode, chosen.width)));
  };
  show();
  return h('div', { class: 'house-view', data: { testid: o.testid ?? 'house-preview' } }, head, stage, o.note ? h('p', { class: 'house-view__note' }, o.note) : null);
}
