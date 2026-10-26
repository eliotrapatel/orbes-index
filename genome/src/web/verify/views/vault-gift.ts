/**
 * A credit to give, as its friend opens it (lot Q3, step Q3.11; plan §3.10; N10): /verify/gift/<code>, a short page in
 * the account's look, the same on a phone and a computer, in the device's mode.
 *
 *   A FRIEND SENT YOU A CREDIT                    its title (never the giver: N10)
 *   €30 for your first piece, until 27 NOVEMBER.  its amount and until when (a Paris day)
 *   [ ACCEPT ]                                    offered while it can be accepted by this account
 *   Accepted. The credit is in YOUR ACCOUNT …     once accepted; else the server's own sentence (yours to give, an account
 *                                                 that holds a piece, ended)
 *
 * Signed out: the sign-in first (main.ts), this page once signed in. ONE MOMENT… while it is read; could not be read: the
 * sentence, the server's words, TRY AGAIN; a code that is none: its sentence. CSP-safe: h() only.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { VAULT } from '../copy.js';
import type { SessionStore } from '../session.js';
import { vaultGiftModel, type VaultGiftModel } from '../vault-model.js';
import { viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { button, failedState, loadingState } from './nocturne.js';

export interface VaultGiftDeps {
  api: Pick<ApiClient, 'vaultGift' | 'acceptVaultGift'>;
  session: Pick<SessionStore, 'ensure' | 'noteError' | 'subscribe'>;
  /** The code of the link (XXXX-XXXX-XXXX), or null for an address that holds none. */
  code: string | null;
  /** Signed out: the sign-in, then this page. */
  onSignIn(): void;
}

export interface VaultGiftView {
  root: HTMLElement;
  dispose(): void;
}

type Load = { kind: 'loading' } | { kind: 'ready'; model: VaultGiftModel; error: string | null } | { kind: 'missing' } | { kind: 'failed'; message: string };

export function vaultGiftView(deps: VaultGiftDeps): VaultGiftView {
  const page = new GiftPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class GiftPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'n-px vp-gift__body', attrs: { 'aria-live': 'polite' } });
  private load: Load = { kind: 'loading' };
  private busy = false;
  private disposed = false;
  private generation = 0;
  private readonly unsubscribe: () => void;
  private signedIn: boolean | null = null;

  constructor(private readonly deps: VaultGiftDeps) {
    this.root = viewRoot('gift', 'gift-title');
    this.root.classList.add('vp-gift');
    this.root.append(h('header', { class: 'n-px vp-gift__head' }, h('h1', { class: 'n-g n-t1 vp-gift__title', id: 'gift-title', attrs: { tabindex: -1 }, text: VAULT.gift.title })), this.body);
    this.unsubscribe = deps.session.subscribe((s) => {
      const now = s.status === 'signed-in';
      if (s.status === 'unknown' || this.signedIn === null || now === this.signedIn) return;
      void this.fetch();
    });
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  private async fetch(): Promise<void> {
    const gen = ++this.generation;
    const stale = (): boolean => this.disposed || gen !== this.generation;
    this.load = { kind: 'loading' };
    this.render();
    let signedIn: boolean | null;
    try {
      signedIn = (await this.deps.session.ensure()).status === 'signed-in';
    } catch {
      signedIn = null;
    }
    if (stale()) return;
    this.signedIn = signedIn;
    if (signedIn === false) {
      this.deps.onSignIn();
      return;
    }
    if (!this.deps.code) {
      this.load = { kind: 'missing' };
      this.render();
      return;
    }
    try {
      const g = await this.deps.api.vaultGift(this.deps.code);
      if (stale()) return;
      this.load = { kind: 'ready', model: vaultGiftModel(g), error: null };
    } catch (e) {
      if (stale()) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && e.status === 401) {
        this.deps.onSignIn();
        return;
      }
      this.load = e instanceof ApiError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  private async accept(): Promise<void> {
    if (this.busy || this.load.kind !== 'ready' || !this.deps.code) return;
    this.busy = true;
    this.render();
    try {
      const g = await this.deps.api.acceptVaultGift(this.deps.code);
      if (this.disposed) return;
      this.load = { kind: 'ready', model: vaultGiftModel(g), error: null };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      if (this.load.kind === 'ready') this.load = { ...this.load, error: messageOf(e) };
    } finally {
      this.busy = false;
    }
    this.render();
    this.body.querySelector<HTMLElement>('.vp-gift__note, .vp-gift__error')?.focus();
  }

  private render(): void {
    const l = this.load;
    this.root.dataset.state = l.kind;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(VAULT.gift.loading));
      return;
    }
    if (l.kind === 'missing') {
      this.body.replaceChildren(h('p', { class: 'n-tx vp-gift__note', attrs: { tabindex: -1 }, text: VAULT.gift.notFound }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(failedState({ sentence: VAULT.gift.unreadable, reason: l.message, retry: VAULT.gift.retry, onRetry: () => void this.fetch(), retryClass: 'vp-gift__retry' }));
      return;
    }
    const m = l.model;
    this.body.replaceChildren(
      ...[
        h('p', { class: 'n-lead vp-gift__line' }, ...withNumerals(m.line)),
        m.canAccept ? h('p', { class: 'vp-gift__actions' }, button(VAULT.gift.accept, { onClick: () => void this.accept(), extraClass: 'vp-gift__accept', attrs: { disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' } })) : null,
        m.note ? h('p', { class: 'n-tx vp-gift__note', attrs: { role: 'status', tabindex: -1 }, text: m.note }) : null,
        l.error ? h('p', { class: 'n-err vp-gift__error', attrs: { role: 'alert', tabindex: -1 }, text: l.error }) : null,
      ].filter((x): x is HTMLParagraphElement => x !== null),
    );
  }
}
