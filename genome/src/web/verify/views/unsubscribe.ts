/**
 * STOP THESE EMAILS, the page of an email's link (macro scope E1, E2; lot M1 plan §4.4, step M1.19; /verify/unsubscribe).
 * The token (`#<token>`, reset-model.ts) is read by main.ts and taken out of the address bar before the page is drawn.
 *
 *   ONE MOMENT…                          what the link stops is read (GET /api/v1/email/unsubscribe)
 *   STOP THESE EMAILS?                   what it stops, in a sentence (the founding list's email, or release notices),
 *   [ STOP ]                             then STOP (POST, the same answer for any link)
 *   EMAILS STOPPED                       what no longer comes; release notices, the way to switch them on again
 *   STOP THESE EMAILS                    a link the server does not recognise: one calm sentence, whoever it was for
 *   This could not be done just now.     the read or STOP failed: the reason, TRY AGAIN
 *
 * Every word in copy.ts (UNSUBSCRIBE); CSP-safe: h() only.
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { UNSUBSCRIBE } from '../copy.js';
import type { UnsubscribeKind } from '../types.js';
import { messageOf } from './forms.js';
import { mailFrame } from './mail-frame.js';
import { button, failedState, loadingState } from './nocturne.js';

export interface UnsubscribeDeps {
  api: Pick<ApiClient, 'lookbook' | 'unsubscribeKind' | 'unsubscribe'>;
  /** The link's token (null: opened without one). */
  token: string | null;
}

export interface UnsubscribeView {
  root: HTMLElement;
  dispose(): void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; stops: UnsubscribeKind; busy: boolean }
  | { kind: 'done'; stops: UnsubscribeKind }
  | { kind: 'invalid' }
  /** The read (`stops` null) or STOP failed. */
  | { kind: 'failed'; stops: UnsubscribeKind | null; reason: string };

export function unsubscribeView(deps: UnsubscribeDeps): UnsubscribeView {
  const page = new UnsubscribePage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class UnsubscribePage {
  private readonly frame;
  private state: State = { kind: 'loading' };
  private disposed = false;
  private gen = 0;

  constructor(private readonly deps: UnsubscribeDeps) {
    this.frame = mailFrame(deps.api, 'unsubscribe');
    if (deps.token === null) this.state = { kind: 'invalid' };
    this.render();
    if (deps.token !== null) void this.read();
  }

  get root(): HTMLElement {
    return this.frame.root;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async read(): Promise<void> {
    const gen = ++this.gen;
    this.state = { kind: 'loading' };
    this.render();
    try {
      const stops = await this.deps.api.unsubscribeKind(this.deps.token!);
      if (this.disposed || gen !== this.gen) return;
      this.state = stops ? { kind: 'ask', stops, busy: false } : { kind: 'invalid' };
    } catch (e) {
      if (this.disposed || gen !== this.gen) return;
      this.state = { kind: 'failed', stops: null, reason: messageOf(e) };
    }
    this.render();
  }

  private async stop(stops: UnsubscribeKind): Promise<void> {
    if (this.state.kind === 'ask' && this.state.busy) return;
    const gen = ++this.gen;
    this.state = { kind: 'ask', stops, busy: true };
    this.render();
    try {
      await this.deps.api.unsubscribe(this.deps.token!);
      if (this.disposed || gen !== this.gen) return;
      this.state = { kind: 'done', stops };
    } catch (e) {
      if (this.disposed || gen !== this.gen) return;
      this.state = { kind: 'failed', stops, reason: messageOf(e) };
    }
    this.render();
    this.frame.root.querySelector<HTMLElement>('.n-mail__stopped, .n-failed')?.focus({ preventScroll: true });
  }

  private render(): void {
    const s = this.state;
    const U = UNSUBSCRIBE;
    switch (s.kind) {
      case 'loading':
        this.frame.head(U.plain, null);
        this.frame.body(loadingState(U.loading, { extraClass: 'n-mail__loading' }));
        return;
      case 'ask':
        this.frame.head(U.ask, null);
        this.frame.body(
          h(
            'div',
            { class: 'n-mail__part' },
            h('p', { class: 'n-tx n-ivc n-mail__kind', text: U.kind[s.stops] }),
            button(U.stop, { onClick: () => void this.stop(s.stops), extraClass: 'n-mail__action', attrs: { disabled: s.busy, 'aria-busy': s.busy ? 'true' : 'false' } }),
          ),
        );
        return;
      case 'done':
        this.frame.head(U.done, null);
        this.frame.body(
          h(
            'div',
            { class: 'n-mail__part' },
            h('p', { class: 'n-tx n-ivc n-mail__stopped', attrs: { role: 'status', tabindex: -1 }, text: U.stopped[s.stops] }),
            s.stops === 'RELEASE_NOTICE' ? h('p', { class: 'n-sm n-mail__again', text: U.again }) : null,
          ),
        );
        return;
      case 'invalid':
        this.frame.head(U.plain, null);
        this.frame.body(h('div', { class: 'n-mail__part' }, h('p', { class: 'n-tx n-mail__invalid', text: U.invalid })));
        return;
      case 'failed': {
        const failed = failedState({ sentence: U.failed, reason: s.reason, retry: U.retry, onRetry: () => void (s.stops ? this.stop(s.stops) : this.read()), extraClass: 'n-mail__failed' });
        failed.setAttribute('tabindex', '-1');
        this.frame.head(s.stops ? U.ask : U.plain, null);
        this.frame.body(failed);
      }
    }
  }
}
