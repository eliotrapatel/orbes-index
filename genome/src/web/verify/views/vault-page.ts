/**
 * THE VAULT page (lot Q3, step Q3.11; plan §3.5; D16, D36, D41–D46, D69; MK #vault-page): /verify/vault on a phone,
 * /verify/account/vault on a computer (its own page, never a panel), the same information on both (D55), dark in both
 * modes (D41: the light tokens never applied, shared/light.css leaves the screen `vault` out as the camera's).
 *
 *   YOUR ACCOUNT · THE VAULT          the overline, the title, his sentence word for word (D16); a hairline
 *   THE VAULT
 *   Vaults are given on …
 *   YOUR VAULTS · 2 WAITING           13 px phone / 16 px computer, ivory (D43); each waiting vault a big door, 246 px ×
 *   [ the door ]                      its zoom tall (0.98 phone, 1.3 computer: MK `calc(246px * var(--dz))`), 56 / 136 px
 *        PRESS AND HOLD               under the line above (D69), PRESS AND HOLD under the box on a closed one (OP-23,
 *   YOUR SIZE SOLD OUT · MONOLITHE…   N1), its source line and WAITS UNTIL (MK `.vp-vault__text`); nothing else of the
 *        WAITS UNTIL 27 NOVEMBER      door's own lines (no hairline, line, DRAW IT DOWN hint, OPEN ANOTHER: vault.css)
 *   OPENED                            smaller (OP-24); compact rows: the day, the source's bare label, what it held (€,
 *   28 OCTOBER     €25 · HOUSE CREDIT OP-32); SAVE THE IMAGE on I WAS THERE, GIVE IT on a credit to give, GIVEN once a
 *   A NEW PIECE                       friend accepted it (N33), in MK's text-link style: on the row's second line on a
 *                                     phone, after the prize on a computer
 *   HOW TO OBTAIN A VAULT             the ledger with this collector's state (N21; THE HOUSE as it is, OP-21)
 *   WHAT A VAULT CAN HOLD             the grid of eight, RARE on the rare ones; CREDIT never €, no odds (D45)
 *
 * A door opened here plays in place and stays open where it is, its source line and WAITS UNTIL under it, PRESS AND
 * HOLD gone, no OPEN ANOTHER, the page never dimmed (N35); the other doors stay as they are; the count and OPENED follow
 * at the page's next reading. ONE MOMENT… while read; could not be read: the sentence, the server's words, TRY AGAIN.
 * No rules link (D43). CSP-safe: h() only; its places by class (vault/vault-page.css, shared/desktop-account.css).
 */
import { h } from '../../shared/dom.js';
import { isDesktop, onDesktopChange } from '../../shared/desktop.js';
import { ApiError, type ApiClient } from '../api.js';
import { VAULT } from '../copy.js';
import type { SessionStore } from '../session.js';
import type { AccountVaultsView, VaultRevealView } from '../types.js';
import { giftUrl, revealAction, vaultPageModel, type IWasThereInput, type VaultDoorModel, type VaultLedgerModel, type VaultOpenedAction, type VaultOpenedModel, type VaultPageModel } from '../vault-model.js';
import { saveIWasThere } from '../vault/i-was-there.js';
import { shareLink } from '../vault/share-link.js';
import { vaultBox } from '../vault/vault-box.js';
import { VaultOpening, type VaultSound } from '../vault/vault-opening.js';
import { viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { appAnchor, failedState, loadingState } from './nocturne.js';

export interface VaultPageDeps {
  api: Pick<ApiClient, 'vaults' | 'openVault' | 'vaultInvite'>;
  session: Pick<SessionStore, 'ensure' | 'noteError' | 'subscribe'>;
  sound: VaultSound;
  /** Signed out (or signed out meanwhile): the sign-in in the page's place, the page once signed in. */
  onSignIn(): void;
  /** SEND A PHOTOGRAPH: MY PIECES (WORN is sent from a piece). */
  onPieces(): void;
  /** YOUR PROFILE's percentage: the profile in YOUR ACCOUNT. */
  onProfile(): void;
  /** The site's origin (a credit to give's link). */
  origin?: string;
  /** Tests: the data as read, without the server. */
  read?(): Promise<AccountVaultsView>;
}

export interface VaultPageView {
  root: HTMLElement;
  dispose(): void;
}

type Load = { kind: 'loading' } | { kind: 'ready'; model: VaultPageModel } | { kind: 'failed'; message: string };

export function vaultPageView(deps: VaultPageDeps): VaultPageView {
  const page = new VaultPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class VaultPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'vp-body' });
  /** What a press of GIVE IT, INVITE A FRIEND or SAVE THE IMAGE did (LINK COPIED, or why not). */
  private readonly status = h('p', { class: 'n-sm vp-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  private load: Load = { kind: 'loading' };
  private openings: VaultOpening[] = [];
  private disposed = false;
  private generation = 0;
  private signedIn: boolean | null = null;
  private readonly off: (() => void)[] = [];

  constructor(private readonly deps: VaultPageDeps) {
    this.root = viewRoot('vault', 'vault-title');
    this.root.classList.add('vp');
    this.root.classList.toggle('vp--desk', isDesktop());
    this.status.hidden = true;
    this.root.append(
      h('p', { class: 'vp-over vp-over--top', text: VAULT.page.overline }),
      h('h1', { class: 'vp-title', id: 'vault-title', attrs: { tabindex: -1 }, text: VAULT.page.title }),
      h('p', { class: 'vp-lead', text: VAULT.page.lead }),
      this.status,
      this.body,
    );
    this.off.push(
      onDesktopChange((desktop) => {
        this.root.classList.toggle('vp--desk', desktop);
        for (const box of this.root.querySelectorAll('.vault-box')) box.classList.toggle('vault-box--phone', !desktop);
      }),
    );
    this.off.push(
      deps.session.subscribe((s) => {
        const now = s.status === 'signed-in';
        if (s.status === 'unknown' || this.signedIn === null || now === this.signedIn) return;
        if (!now) this.deps.onSignIn();
        else void this.fetch();
      }),
    );
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    this.stopDoors();
    for (const f of this.off) f();
  }

  private stopDoors(): void {
    for (const o of this.openings) o.dispose();
    this.openings = [];
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
    try {
      const data = await (this.deps.read ? this.deps.read() : this.deps.api.vaults());
      if (stale()) return;
      this.load = { kind: 'ready', model: vaultPageModel(data) };
    } catch (e) {
      if (stale()) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && e.status === 401) {
        this.deps.onSignIn();
        return;
      }
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  private say(text: string | null, error = false): void {
    this.status.textContent = text ?? '';
    this.status.hidden = text === null;
    this.status.classList.toggle('n-err', error);
  }

  private render(): void {
    this.stopDoors();
    const l = this.load;
    this.root.dataset.state = l.kind === 'ready' ? (l.model.first ? 'first' : l.model.doors.length === 0 ? 'empty' : 'ready') : l.kind;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(VAULT.page.loading, { extraClass: 'vp-waiting' }));
      return;
    }
    if (l.kind === 'failed') {
      const hadFocus = this.body.contains(document.activeElement);
      this.body.replaceChildren(failedState({ sentence: VAULT.page.unreadable, reason: l.message, retry: VAULT.page.retry, onRetry: () => void this.fetch(), retryClass: 'vp-retry', extraClass: 'vp-failed' }));
      if (hadFocus) this.body.querySelector<HTMLElement>('.vp-retry')?.focus();
      return;
    }
    const m = l.model;
    this.body.replaceChildren(
      ...[
        m.first ? null : this.vaults(m),
        m.opened.length > 0 ? this.opened(m.opened) : null,
        m.ledger.length > 0 ? this.ledger(m.ledger) : null,
        this.grid(m),
      ].filter((x): x is HTMLElement => x !== null),
    );
  }

  // ── YOUR VAULTS ────────────────────────────────────────────────────────────────────────────────────────────────────

  private vaults(m: VaultPageModel): HTMLElement {
    const heading = h('h2', { class: 'vp-over', id: 'vault-waiting' }, ...withNumerals(m.heading));
    if (m.doors.length === 0) return h('section', { class: 'vp-sec vp-sec--vaults', attrs: { 'aria-labelledby': 'vault-waiting' } }, heading, h('p', { class: 'vp-p vp-none', text: m.none ?? VAULT.page.none }));
    return h('section', { class: 'vp-sec vp-sec--vaults', attrs: { 'aria-labelledby': 'vault-waiting' } }, heading, h('ul', { class: 'vp-vaults' }, ...m.doors.map((d) => this.door(d))));
  }

  private door(d: VaultDoorModel): HTMLElement {
    const parts = vaultBox('page', !isDesktop());
    parts.front.setAttribute('aria-label', d.label);
    const doorEl = h('div', { class: 'vp-door' }, parts.root);
    const press = h('p', { class: 'live__fact vlt__hint vp-press', text: VAULT.page.press });
    const text = h(
      'div',
      { class: 'vp-vault__text' },
      h('p', { class: 'vp-from' }, ...withNumerals(d.line)),
      h('p', { class: 'vp-until' }, ...withNumerals(d.until)),
    );
    const li = h('li', { class: 'vp-vault', data: { vault: d.id } }, doorEl, press, text);
    const opening = new VaultOpening(parts, {
      open: () => this.deps.api.openVault(d.id),
      sound: this.deps.sound,
      surface: li,
      messageOf,
      // Opened here: it stays open in place, PRESS AND HOLD gone, its action under the box (N33); the count and OPENED
      // follow at the next reading.
      onOpened: (r) => {
        li.classList.add('is-opened');
        press.remove();
        const act = this.revealActionLink(r, d.image);
        if (act) doorEl.after(h('p', { class: 'vp-act' }, act));
      },
    });
    this.openings.push(opening);
    return li;
  }

  // ── OPENED ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private opened(rows: VaultOpenedModel[]): HTMLElement {
    return h(
      'section',
      { class: 'vp-sec vp-sec--opened', attrs: { 'aria-labelledby': 'vault-opened' } },
      h('h2', { class: 'vp-over', id: 'vault-opened', text: VAULT.page.opened }),
      h(
        'dl',
        { class: 'vp-opened' },
        ...rows.map((r) => {
          const act = r.action ? this.actionLink(r.action) : null;
          return h(
            'div',
            { class: ['vp-row', act ? 'has-act' : null], data: { vault: r.id } },
            h('dt', {}, ...withNumerals(r.day), ' ', h('span', { class: 'vp-src', text: r.label })),
            h('dd', {}, h('span', { class: 'vp-held' }, ...withNumerals(r.held)), act),
          );
        }),
      ),
    );
  }

  /** An OPENED row's action, in MK's ledger text-link style (`.vp-occ__state--link`); GIVEN plain. */
  private actionLink(a: VaultOpenedAction): HTMLElement {
    if (a.kind === 'given') return h('span', { class: 'vp-occ__state vp-act__given', text: VAULT.page.given });
    if (a.kind === 'save') return this.link(VAULT.page.save, () => void this.save(a.image), 'vp-act__save');
    return this.link(VAULT.page.give, () => void this.share(giftUrl(this.origin(), a.code)), 'vp-act__give');
  }

  private revealActionLink(r: VaultRevealView, image: IWasThereInput): HTMLElement | null {
    const a = revealAction(r, image);
    return a ? this.actionLink(a) : null;
  }

  private link(label: string, onClick: () => void, cls: string): HTMLButtonElement {
    return h('button', { class: ['vp-occ__state', 'vp-occ__state--link', 'vp-link', cls], attrs: { type: 'button' }, on: { click: onClick }, text: label });
  }

  private origin(): string {
    return this.deps.origin ?? (typeof location === 'undefined' ? '' : location.origin);
  }

  private async save(image: IWasThereInput): Promise<void> {
    this.say(null);
    if (!(await saveIWasThere(image))) this.say(VAULT.failed, true);
  }

  private async share(url: string): Promise<void> {
    this.say(null);
    const out = await shareLink(url);
    if (out === 'copied') this.say(VAULT.page.copied);
    else if (out === 'failed') this.say(VAULT.page.copyFailed, true);
  }

  private async invite(): Promise<void> {
    this.say(null);
    try {
      const { url } = await this.deps.api.vaultInvite();
      await this.share(url);
    } catch (e) {
      this.deps.session.noteError(e);
      this.say(messageOf(e), true);
    }
  }

  // ── HOW TO OBTAIN A VAULT ──────────────────────────────────────────────────────────────────────────────────────────

  private ledger(rows: VaultLedgerModel[]): HTMLElement {
    return h(
      'section',
      { class: 'vp-sec vp-sec--how', attrs: { 'aria-labelledby': 'vault-how' } },
      h('h2', { class: 'vp-over', id: 'vault-how', text: VAULT.page.how }),
      h(
        'ol',
        { class: 'vp-ledger' },
        ...rows.map((r) =>
          h(
            'li',
            { class: ['vp-occ', r.state?.done ? 'is-done' : null], data: { source: r.source } },
            h('p', { class: 'vp-occ__k', text: r.label }),
            h(
              'div',
              { class: 'vp-occ__line' },
              h('p', { class: 'vp-occ__p', text: r.line }),
              r.progress
                ? h(
                    'div',
                    { class: 'vp-occ__prog' },
                    this.bar(r.progress.fraction),
                    h('p', { class: 'vp-occ__of' }, ...withNumerals(r.progress.of)),
                  )
                : null,
            ),
            this.state(r),
          ),
        ),
      ),
    );
  }

  /** The tier's horizon, lit to the progress, its point at the edge (MK's `.vp-bar`, `--f` through the CSSOM). */
  private bar(fraction: number): HTMLElement {
    const bar = h('span', { class: 'vp-bar', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'vp-bar__line' }), h('span', { class: 'vp-bar__pt' }));
    bar.style.setProperty('--f', Math.max(0, Math.min(1, fraction)).toFixed(3));
    return bar;
  }

  private state(r: VaultLedgerModel): HTMLElement | null {
    const s = r.state;
    if (!s) return null;
    if (s.link === 'worn') return appAnchor('/verify/pieces', ['vp-occ__state', 'vp-occ__state--link', 'vp-link'], () => this.deps.onPieces(), s.text);
    if (s.link === 'profile') return appAnchor('/verify/account/profile', ['vp-occ__state', 'vp-occ__state--link', 'vp-link'], () => this.deps.onProfile(), ...withNumerals(s.text));
    if (s.link === 'invite') return this.link(s.text, () => void this.invite(), 'vp-invite');
    if (s.done) {
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tick.setAttribute('class', 'vp-check');
      tick.setAttribute('viewBox', '0 0 10 10');
      tick.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M1.5 5.2 4 7.6 8.6 2.6');
      tick.appendChild(path);
      return h('p', { class: 'vp-occ__state' }, tick, s.text);
    }
    return h('p', { class: 'vp-occ__state' }, ...withNumerals(s.text));
  }

  // ── WHAT A VAULT CAN HOLD ──────────────────────────────────────────────────────────────────────────────────────────

  private grid(m: VaultPageModel): HTMLElement {
    return h(
      'section',
      { class: 'vp-sec vp-sec--hold', attrs: { 'aria-labelledby': 'vault-hold' } },
      h('h2', { class: 'vp-over', id: 'vault-hold', text: VAULT.page.hold }),
      h(
        'ul',
        { class: 'vp-hold' },
        ...m.grid.map((g) =>
          h(
            'li',
            { class: ['vp-rw', g.rare ? 'is-rare' : null], data: { kind: g.kind } },
            g.rare ? h('p', { class: 'vp-rw__rare' }, h('span', { class: 'vp-rw__pt', attrs: { 'aria-hidden': 'true' } }), VAULT.page.rare) : h('p', { class: 'vp-rw__rare', attrs: { 'aria-hidden': 'true' } }),
            h('p', { class: 'vp-rw__r', text: g.label }),
            h('p', { class: 'vp-rw__p', text: g.line }),
          ),
        ),
      ),
    );
  }
}
