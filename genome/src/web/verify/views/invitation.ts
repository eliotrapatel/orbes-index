/**
 * A post's card in THE CIRCLE's feed (C8), and the next invitation on NOW (C1): its kind (and the tiers it is kept
 * for), its title, its day; an invitation's event line in UTC, its places (N LEFT OF C) and YES / NO, the reader's
 * answer pressed, answered here by the post's own route and rules (plan NOCTURNE, addition 6: closed once the event
 * has begun, YES held back once every place is taken by others); what the reader did otherwise (YOU ANSWERED, YOU
 * VOTED); and its one text link (SEE THE INVITATION, SEE THE POLL, READ THE NOTE).
 *
 *   INVITATION                                     n-circle-card__kind
 *   AN EVENING AT THE ATELIER                      n-circle-card__title
 *   3 OCT 2026                                     n-circle-card__date
 *   12 OCT 2026 · 17:00 UTC · PARIS                n-circle-card__event (its time never parts from its hour)
 *   3 LEFT OF 12                                   n-circle-card__places
 *   [ YES ]  [  NO  ]                              n-circle-card__answer: the answer pressed, the other a hairline
 *   SEE THE INVITATION                             n-circle-card__link
 *
 * The lines are drawn into a host the page frames (NOW's plate card, the feed's photograph and its lifted words): an
 * answer draws them again in place, its photograph untouched. CSP-safe: h() only, its places by class.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { circlePostPath, invitationReply, type CircleCardModel, type InvitationReply } from '../circle-model.js';
import { CIRCLE } from '../copy.js';
import type { SessionStore } from '../session.js';
import type { CircleAnswer } from '../types.js';
import { withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { textLink } from './nocturne.js';

export interface CircleCardDeps {
  api: Pick<ApiClient, 'circleAnswer' | 'circle'>;
  session: SessionStore;
  /** Open the post in the app. */
  onPost(id: string): void;
}

/** The kind of a post, and the tiers it is kept for when they are not every owner's: POLL · PLATINE AND PALLADIUM. */
export const kindLine = (m: { kindLabel: string; reach: string | null }): string => [m.kindLabel, m.reach].filter(Boolean).join(' · ');

/** An invitation's event line (`12 OCT 2026 · 17:00 UTC · PARIS`): its time kept whole, then its place. */
export function splitEvent(line: string): { time: string; place: string | null } {
  const at = line.indexOf(' UTC');
  if (at < 0) return { time: line, place: null };
  const time = line.slice(0, at + 4);
  const rest = line.slice(at + 4).replace(/^ · /, '');
  return { time, place: rest || null };
}

/**
 * The lines of a post's card, drawn into `host`; an invitation's YES / NO answered in place. `heading` is the title's
 * level in its page (NOW's card is under THE CIRCLE's section title, a feed's post under the page's).
 */
export class CircleCardLines {
  private reply: InvitationReply | null;
  private busy = false;
  private error: string | null = null;
  private disposed = false;

  constructor(
    private readonly card: CircleCardModel,
    readonly host: HTMLElement,
    private readonly deps: CircleCardDeps,
    private readonly opts: { heading: 'h2' | 'h3'; titleId?: string },
  ) {
    this.reply = card.reply;
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
  }

  private draw(): void {
    const { card } = this;
    const reply = this.reply;
    const event = card.event ? splitEvent(card.event) : null;
    const option = (answer: CircleAnswer, label: string, r: InvitationReply) =>
      h('button', {
        class: ['n-g', 'n-btn', r.answer === answer ? null : 'n-btn--ol', 'n-circle-card__option'],
        attrs: { type: 'button', 'aria-pressed': String(r.answer === answer), disabled: this.busy || (answer === 'YES' && r.full) },
        data: { answer },
        on: { click: () => void this.answer(answer) },
        text: label,
      });
    // The reader's answer is the pressed button while answers are taken; once closed, it is said in words.
    const mine = reply?.open ? null : card.mine;
    const link = textLink(card.linkLabel, { href: circlePostPath(card.id), onOpen: () => this.deps.onPost(card.id), extraClass: 'n-circle-card__see circle-card__link' });
    // Which post a link opens: its title, for a screen reader moving from link to link.
    if (this.opts.titleId) link.setAttribute('aria-describedby', this.opts.titleId);
    const lines: (HTMLElement | null)[] = [
        h('p', { class: 'n-g n-lb n-circle-card__kind circle-card__kind', text: kindLine(card) }),
        card.experience ? h('p', { class: 'n-g n-lb n-circle-card__experience circle-card__experience', text: card.experience }) : null,
        h(this.opts.heading, { class: 'n-g n-t2 n-circle-card__title circle-card__title', id: this.opts.titleId }, ...withNumerals(card.title)),
        card.date ? h('p', { class: 'n-sm n-num n-circle-card__date', text: card.date }) : null,
        event
          ? h('p', { class: 'n-g n-lb n-ivc n-num n-circle-card__event circle-card__event' }, h('span', { class: 'n-nw' }, ...withNumerals(event.time)), ...(event.place ? [' · ', ...withNumerals(event.place)] : []))
          : null,
        reply?.places ? h('p', { class: 'n-g n-lb n-num n-circle-card__places' }, ...withNumerals(reply.places)) : null,
        reply?.open ? h('div', { class: 'n-duo n-circle-card__answer', attrs: { role: 'group', 'aria-label': CIRCLE.answerChoice } }, option('YES', CIRCLE.yes, reply), option('NO', CIRCLE.no, reply)) : null,
        mine ? h('p', { class: 'n-g n-lb n-ivc n-circle-card__mine circle-card__mine', text: mine }) : null,
        this.error ? h('p', { class: 'n-sm n-ivc n-circle-card__error', attrs: { role: 'alert' }, text: this.error }) : null,
        h('p', { class: 'n-circle-card__link' }, link),
    ];
    this.host.replaceChildren(...lines.filter((x): x is HTMLElement => x !== null));
  }

  /** YES or NO, by the post's own route and rules: one request at a time, then the invitation as the server holds it. */
  private async answer(answer: CircleAnswer): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.error = null;
    this.draw();
    try {
      const post = await this.deps.api.circleAnswer(this.card.id, answer);
      if (this.disposed) return;
      this.reply = invitationReply(post.invitation, post.answer) ?? this.reply;
      this.card.mine = this.reply?.answer ? CIRCLE.answered(this.reply.answer) : null;
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.error = messageOf(e);
      // Refused by what changed meanwhile (the places taken, the event begun): the feed is read again, without
      // counting a visit of the circle.
      if (e instanceof ApiError && e.status === 409) {
        try {
          const items = (await this.deps.api.circle(1, 50, { visit: false })).items;
          const fresh = items.find((c) => c.id === this.card.id);
          const reply = fresh ? invitationReply(fresh.invitation, fresh.answer) : null;
          if (reply) this.reply = reply;
        } catch (again) {
          this.deps.session.noteError(again);
        }
      }
    } finally {
      this.busy = false;
    }
    if (this.disposed) return;
    this.draw();
    this.host.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
}
