/**
 * WHERE DID YOU SEE OR BUY THIS PIECE? Under the contact of ORBES Client Services on every result that was not
 * authentic (C-02, API §8.5), in NOCTURNE's pieces (C15, C16).
 *
 *   WHERE DID YOU SEE OR BUY THIS PIECE?      the question (a title)
 *   Optional. Your answer stays with …        one sentence
 *   [ BOUTIQUE ]      [ ONLINE ]              where: one choice, pressed (`.opt2`, two by two)
 *   [ PRIVATE SALE ]  [ OTHER ]
 *   PLACE (OPTIONAL) ________                 the place and the note, underlined fields, each with its hint
 *   NOTE (OPTIONAL)  ________
 *   [ SEND ANSWER ]                           a hairline button (sent with the choice made; without one, the
 *                                             keyboard is taken to the choices)
 *
 * Open under UNUSUAL ACTIVITY (C15); under the other results (`folded`, C16) the question and its sentence are a row
 * with a hairline that opens (+ / −) onto the rest. The answer is attached to the scan (one per scan, within 24
 * hours) and opens a case in the console's Cases queue. Server messages are shown as they come (written for
 * customers); nothing typed is kept beyond the form.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { REPORT, REQUEST_ERRORS } from '../copy.js';
import { REPORT_CHANNELS, type ReportChannel } from '../types.js';
import type { ReportModel } from '../view-model.js';
import { button, field, icon } from './nocturne.js';

export interface ReportDeps {
  api: Pick<ApiClient, 'report'>;
}

const PLACE_MAX = 200;
const NOTE_MAX = 500;

function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return REQUEST_ERRORS.network;
    if (e.status === 429) return REQUEST_ERRORS.rateLimited;
    if (e.status >= 500) return 'Your answer could not be sent just now. Please try again in a moment.';
    return e.message;
  }
  return 'Your answer could not be sent. Please try again.';
}

export function reportSection(model: ReportModel, deps: ReportDeps, opts: { folded?: boolean } = {}): HTMLElement {
  let channel: ReportChannel | null = null;
  const root = h('section', { class: ['n-px', 'n-sec', 'n-report', opts.folded ? 'n-report--folded' : null], attrs: { 'aria-labelledby': 'report-title' } });
  // Folded, the sentence is the row's second line, inside its button: a span.
  const lead: HTMLElement = opts.folded ? h('span', { class: 'n-sm n-acc__line n-report__lead', text: REPORT.lead }) : h('p', { class: 'n-sm n-report__lead', text: REPORT.lead });

  const options = REPORT_CHANNELS.map((c) =>
    h('button', {
      class: 'n-g n-opt2__option n-report__channel',
      attrs: { type: 'button', 'aria-pressed': 'false' },
      data: { channel: c },
      on: { click: () => choose(c) },
      text: REPORT.channels[c],
    }),
  );
  const channels = h('div', { class: 'n-opt2 n-report__channels', attrs: { role: 'group', 'aria-labelledby': 'report-title' } }, ...options);

  const place = h('input', { attrs: { type: 'text', name: 'place', autocomplete: 'off', maxlength: PLACE_MAX } });
  const note = h('textarea', { class: 'n-fld__input n-report__note', attrs: { id: 'report-note', name: 'note', rows: 1, maxlength: NOTE_MAX, 'aria-describedby': 'report-note-hint' } });
  const error = h('p', { class: 'n-err n-report__error', attrs: { role: 'alert', hidden: true } });
  // Unusable until an answer is chosen, and said so (aria-disabled), never silent; its look stays C15's.
  const send = button(REPORT.send, { outline: true, type: 'submit', extraClass: 'n-report__send', attrs: { 'aria-busy': 'false', 'aria-disabled': 'true' } });
  const form = h(
    'form',
    { class: 'n-report__form', attrs: { novalidate: true, 'aria-labelledby': 'report-title' } },
    field('report-place', REPORT.place, place, REPORT.placeHint),
    h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: 'report-note' } }, h('span', { class: 'n-g n-lab', text: REPORT.note })),
      note,
      h('p', { class: 'n-sm n-fld__hint', id: 'report-note-hint', text: REPORT.noteHint }),
    ),
    error,
    send,
  );

  function choose(c: ReportChannel): void {
    channel = c;
    for (const o of options) o.setAttribute('aria-pressed', o.dataset.channel === c ? 'true' : 'false');
    send.setAttribute('aria-disabled', 'false');
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (send.disabled) return;
    // Where comes first: without a choice (SEND ANSWER then says it is not usable yet), the keyboard is taken to the
    // four answers.
    if (!channel) {
      options[0]?.focus();
      return;
    }
    const chosen = channel;
    void (async () => {
      error.hidden = true;
      error.textContent = '';
      send.disabled = true;
      send.setAttribute('aria-busy', 'true');
      for (const o of options) o.disabled = true;
      try {
        await deps.api.report({ scanId: model.scanId, channel: chosen, where: place.value, note: note.value });
        // Sent: the form gives way to the thanks, read out once; keyboard focus follows it.
        const status = h('p', { class: 'n-g n-lb n-ivc n-report__status', attrs: { role: 'status', tabindex: '-1' }, text: REPORT.sent });
        const kept = h('p', { class: 'n-sm n-report__kept', text: REPORT.kept(model.reference) });
        // The question stays as its title; nothing is left to open or to send.
        root.replaceChildren(h('h2', { class: 'n-g n-t3 n-report__title', id: 'report-title', text: REPORT.title }), status, kept);
        status.focus({ preventScroll: true });
      } catch (e) {
        error.textContent = messageOf(e);
        error.hidden = false;
        send.focus();
      } finally {
        send.disabled = false;
        send.setAttribute('aria-busy', 'false');
        for (const o of options) o.disabled = false;
      }
    })();
  });

  const body = h('div', { class: 'n-report__body' }, channels, form);
  if (!opts.folded) {
    root.append(h('h2', { class: 'n-g n-t3 n-report__title', id: 'report-title', text: REPORT.title }), lead, body);
    return root;
  }
  // C16: the question and its sentence, a row that opens onto the answers.
  body.id = 'report-panel';
  body.hidden = true;
  const sign = h('span', { class: 'n-acc__sign' });
  const toggle = h(
    'button',
    { class: 'n-acc n-report__toggle', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'report-panel' } },
    h('span', { class: 'n-acc__text' }, h('span', { class: 'n-g n-t3 n-acc__title n-report__title', id: 'report-title', text: REPORT.title }), lead),
    sign,
  );
  const draw = (open: boolean): void => {
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    sign.replaceChildren(icon(open ? 'minus' : 'plus', { small: true }));
  };
  toggle.addEventListener('click', () => draw(toggle.getAttribute('aria-expanded') !== 'true'));
  draw(false);
  root.append(h('h2', { class: 'n-report__head' }, toggle), body);
  return root;
}
