/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11): one block, on the release's end page in the vault
 * (to those who took part without a piece) and in MY PIECES in the house's ivory (to those who said I'LL BE THERE and did
 * not come). Model in question-model.ts.
 *
 *   ONE QUESTION                                  the label (display face)
 *   MONOLITHE · 2 NOV 2026                        MY PIECES only: the release
 *   WHAT WOULD YOU HAVE WANTED?                   the question
 *   ANOTHER SIZE                                  its answers, one under the other: one tap each, pressed like the
 *   ANOTHER FINISH  ‾‾‾‾‾‾                        sign-in's switch (as a poll of the circle), the chosen one in ink
 *   ANOTHER PRICE BAND                            and ruled; never a bordered button (the page keeps its own action)
 *   One tap. You may change your answer until …  until when (announced politely after an answer)
 *
 * On a release's pages before and after the room in NOCTURNE (C30, `nocturne`): a plate card, its label, its question
 * in the display face, its answers as pressed buttons one under the other (the chosen one filled ivory), until when.
 *
 * The answer goes to PUT /api/v1/live/:id/answer; while it is sent the answers wait; a refusal reads as the server
 * wrote it (closed, not asked), the block staying as it was.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { QUESTION } from '../copy.js';
import { questionModel } from '../question-model.js';
import type { SessionStore } from '../session.js';
import type { AccountQuestion } from '../types.js';
import { withNumerals } from './common.js';

export interface QuestionBlockDeps {
  api: ApiClient;
  session: SessionStore;
  localZone: string;
  /** NOCTURNE's plate card (a release's end and final pages, C30), the vault (MY PIECES) or the house's ivory. */
  tone: 'nocturne' | 'vault' | 'ivory';
  /** MY PIECES names the release above its question. */
  named?: boolean;
  /** Told of the question once answered (the page keeps it for its next screen). */
  onAnswered?(q: AccountQuestion): void;
}

let ids = 0;

export class QuestionBlock {
  readonly el: HTMLElement;
  private question: AccountQuestion | null = null;
  private busy = false;
  /** What the answers were drawn for; the buttons themselves. */
  private drawn = '';
  private buttons: HTMLButtonElement[] = [];
  private readonly textId = `question-${++ids}`;
  private readonly release = h('p', { class: 'question__release' });
  private readonly text: HTMLElement;
  private readonly answers = h('div', { class: 'question__answers', attrs: { role: 'group' } });
  private readonly note = h('p', { class: 'question__note', attrs: { 'aria-live': 'polite' } });
  private readonly error = h('p', { class: 'form__error question__error', attrs: { role: 'alert', hidden: true } });

  constructor(private readonly deps: QuestionBlockDeps) {
    const nocturne = deps.tone === 'nocturne';
    this.text = h(nocturne ? 'h2' : 'p', { class: nocturne ? 'n-g n-t2 n-question__text question__text' : 'question__text', id: this.textId });
    this.answers.setAttribute('aria-labelledby', this.textId);
    this.release.hidden = !deps.named;
    if (nocturne) {
      this.answers.className = 'n-opt2 n-question__answers';
      this.note.className = 'n-sm n-question__note question__note';
      this.error.className = 'n-sm n-ivc n-question__error form__error question__error';
      this.release.className = 'n-g n-lb n-question__release question__release';
      this.el = h(
        'section',
        { class: 'n-px n-question question--nocturne', attrs: { 'aria-labelledby': this.textId, hidden: true } },
        h('div', { class: 'n-card n-card--left n-question__card' }, h('p', { class: 'n-g n-lb n-question__label question__label', text: QUESTION.label }), this.release, this.text, this.answers, this.note, this.error),
      );
      return;
    }
    this.el = h(
      'section',
      { class: ['question', `question--${deps.tone}`], attrs: { 'aria-labelledby': this.textId, hidden: true } },
      h('p', { class: 'question__label', text: QUESTION.label }),
      this.release,
      this.text,
      this.answers,
      this.note,
      this.error,
    );
  }

  /** Show a question (null: none, the block hidden). The answers are drawn once and then marked: focus stays on a tap. */
  show(q: AccountQuestion | null): void {
    this.question = q;
    this.el.hidden = q === null;
    if (!q) return;
    const m = questionModel(q, this.deps.localZone);
    const key = JSON.stringify([m.dropId, m.text, m.answers.map((a) => a.label)]);
    if (key !== this.drawn) {
      this.drawn = key;
      this.release.replaceChildren(...withNumerals(m.release));
      this.text.replaceChildren(...withNumerals(m.text));
      this.buttons = m.answers.map((a) =>
        h(
          'button',
          { class: this.deps.tone === 'nocturne' ? 'n-g n-opt2__option question__answer' : 'auth__option question__answer', attrs: { type: 'button', 'aria-pressed': 'false' }, data: { answer: String(a.answer) }, on: { click: () => void this.choose(a.answer) } },
          ...withNumerals(a.label),
        ),
      );
      this.answers.replaceChildren(...this.buttons);
    }
    m.answers.forEach((a, i) => {
      const b = this.buttons[i]!;
      b.setAttribute('aria-pressed', a.chosen ? 'true' : 'false');
      if (this.busy) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
    });
    const note = this.busy ? QUESTION.saving : m.note;
    if (this.note.textContent !== note) this.note.textContent = note;
  }

  private async choose(answer: number): Promise<void> {
    const q = this.question;
    if (!q || this.busy || q.answer === answer) return;
    this.busy = true;
    this.error.hidden = true;
    this.show(q);
    try {
      const next = await this.deps.api.answer(q.dropId, answer);
      this.busy = false;
      this.show(next);
      this.deps.onAnswered?.(next);
    } catch (e) {
      this.busy = false;
      this.deps.session.noteError(e);
      this.show(q);
      this.error.textContent = e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : QUESTION.failed;
      this.error.hidden = false;
    }
  }
}
