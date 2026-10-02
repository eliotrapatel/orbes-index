/**
 * WHERE DID YOU SEE OR BUY THIS PIECE? Under the contact of ORBES Client
 * Services on every result that was not authentic (C-02, API §8.5).
 *
 *   ──────────────────────────────
 *   WHERE DID YOU SEE OR BUY THIS PIECE?      the question (a status line)
 *   Optional. Your answer stays with …        one sentence
 *     BOUTIQUE   ONLINE                       where: one choice, pressed
 *     PRIVATE SALE   OTHER
 *   PLACE (OPTIONAL) ________                 once a choice is made
 *   NOTE (OPTIONAL)  ________
 *          SEND ANSWER                        a text link (the hairline button stays SCAN AGAIN)
 *
 * The answer is attached to the scan (one per scan, within 24 hours) and
 * opens a case in the console's Cases queue. Server messages are shown as
 * they come (written for customers); nothing typed is kept beyond the form.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { REPORT, REQUEST_ERRORS } from '../copy.js';
import { REPORT_CHANNELS, type ReportChannel } from '../types.js';
import type { ReportModel } from '../view-model.js';

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

export function reportSection(model: ReportModel, deps: ReportDeps): HTMLElement {
  let channel: ReportChannel | null = null;
  const root = h('section', { class: 'report', attrs: { 'aria-labelledby': 'report-title' } });
  const title = h('h2', { class: 'report__title', id: 'report-title', text: REPORT.title });
  const lead = h('p', { class: 'prose report__lead', text: REPORT.lead });

  const options = REPORT_CHANNELS.map((c) =>
    h('button', {
      class: 'auth__option report__channel',
      attrs: { type: 'button', 'aria-pressed': 'false' },
      data: { channel: c },
      on: { click: () => choose(c) },
      text: REPORT.channels[c],
    }),
  );
  const channels = h('div', { class: 'report__channels', attrs: { role: 'group', 'aria-labelledby': 'report-title' } }, ...options);

  const place = h('input', { class: 'field__input', attrs: { id: 'report-place', type: 'text', name: 'place', autocomplete: 'off', maxlength: PLACE_MAX, 'aria-describedby': 'report-place-hint' } });
  const note = h('textarea', { class: 'field__input report__note', attrs: { id: 'report-note', name: 'note', rows: 3, maxlength: NOTE_MAX, 'aria-describedby': 'report-note-hint' } });
  const error = h('p', { class: 'form__error', attrs: { role: 'alert', hidden: true } });
  const send = h('button', { class: 'textlink report__send', attrs: { type: 'submit', 'aria-busy': 'false' }, text: REPORT.send });
  const form = h(
    'form',
    { class: 'form report__form', attrs: { novalidate: true, hidden: true, 'aria-labelledby': 'report-title' } },
    h('div', { class: 'field' }, h('label', { class: 'field__label', attrs: { for: 'report-place' }, text: REPORT.place }), place, h('span', { class: 'field__hint', id: 'report-place-hint', text: REPORT.placeHint })),
    h('div', { class: 'field' }, h('label', { class: 'field__label', attrs: { for: 'report-note' }, text: REPORT.note }), note, h('span', { class: 'field__hint', id: 'report-note-hint', text: REPORT.noteHint })),
    error,
    h('div', { class: 'report__actions' }, send),
  );

  function choose(c: ReportChannel): void {
    channel = c;
    for (const o of options) o.setAttribute('aria-pressed', o.dataset.channel === c ? 'true' : 'false');
    form.hidden = false;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (send.disabled || !channel) return;
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
        const status = h('p', { class: 'report__status', attrs: { role: 'status', tabindex: '-1' }, text: REPORT.sent });
        root.replaceChildren(title, status, h('p', { class: 'prose report__lead', text: REPORT.kept(model.reference) }));
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

  root.append(title, lead, channels, form);
  return root;
}
