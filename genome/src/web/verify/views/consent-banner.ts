/**
 * The consent banner (lot M4 plan §3.4; macro scope K27 A4), shown only while conversions are switched on and no choice is
 * held (consent.ts bannerWanted), never modal: the page under it stays usable.
 *
 *   ─────────────────────────────────────────────     a phone: a band at the foot of the screen, NOCTURNE's ground and a
 *   ORBES can tell Meta, TikTok and Google when you   hairline above, the words in ivory at reading size, PRIVACY (the
 *   join, enter a release or pay an order after one   privacy policy's Advertising measurement) after them, the two
 *   of their ads, to measure those ads. Only if you   buttons of equal weight side by side; the SCAN ring stays where it
 *   agree. No advertising cookie. PRIVACY             is, over the band's foot
 *   [  ACCEPT  ]  [  DECLINE  ]
 *                      ( ⌖ )
 *
 *   a computer (CINEMA): a band at the foot of the window, on the page's edges, the words and PRIVACY (34 em at most) at
 *   the left, ACCEPT · DECLINE at the right (shared/desktop-account.css)
 *
 * States: shown; saving (ONE MOMENT…, both buttons held); error (Your choice could not be saved. Try again., both buttons
 * again); gone once answered. Never over the screens consent.ts CONSENT_NEVER_ON names (it waits for the next other one).
 * In English whatever the browser's language (`lang`, no hyphenation): the app's own. No motion but its fade in.
 */
import { h } from '../../shared/dom.js';
import { CONSENT } from '../copy.js';
import type { AdsChoice } from '../types.js';
import { button } from './nocturne.js';

export interface ConsentBannerDeps {
  /** ACCEPT or DECLINE saved (consent.ts AdsConsent.choose); thrown when it could not be. */
  choose(choice: AdsChoice): Promise<void>;
}

export type ConsentBannerState = 'shown' | 'saving' | 'error';

export class ConsentBanner {
  readonly el: HTMLElement;
  private readonly accept: HTMLButtonElement;
  private readonly decline: HTMLButtonElement;
  private readonly line: HTMLElement;
  private state: ConsentBannerState = 'shown';
  private wanted = false;
  private allowed = false;

  constructor(private readonly deps: ConsentBannerDeps) {
    this.accept = button(CONSENT.accept, { outline: true, extraClass: 'n-consent__button', attrs: { 'data-choice': 'GRANTED' }, onClick: () => void this.choose('GRANTED') });
    this.decline = button(CONSENT.decline, { outline: true, extraClass: 'n-consent__button', attrs: { 'data-choice': 'DECLINED' }, onClick: () => void this.choose('DECLINED') });
    this.line = h('p', { class: 'n-err n-consent__line', attrs: { role: 'status', hidden: true } });
    this.el = h(
      'section',
      { class: 'n-consent', attrs: { 'aria-label': CONSENT.region, lang: 'en', hidden: true, 'data-state': 'shown' } },
      h(
        'div',
        { class: 'n-consent__inner' },
        h('p', { class: 'n-tx n-ivc n-consent__text' }, `${CONSENT.text} `, h('a', { class: 'n-g n-tl n-consent__privacy', attrs: { href: CONSENT.privacyHref }, text: CONSENT.privacy })),
        h('div', { class: 'n-consent__side' }, h('div', { class: 'n-duo n-consent__choice', attrs: { role: 'group', 'aria-label': CONSENT.region } }, this.accept, this.decline), this.line),
      ),
    );
  }

  /** What it shows now (tests and the states' readiness: `data-state`). */
  get shownState(): ConsentBannerState | null {
    return this.el.hidden ? null : this.state;
  }

  /** The banner wanted (switched on, no choice held) and the screen on show one it may stand on. */
  update(wanted: boolean, allowed: boolean): void {
    this.wanted = wanted;
    this.allowed = allowed;
    this.draw();
  }

  private draw(): void {
    const shown = this.wanted && this.allowed;
    // In the page only once wanted: with conversions off, nothing of it is there (the page as it was, byte for byte).
    if (!shown && !this.el.isConnected) return;
    if (shown && !this.el.isConnected) document.body.append(this.el);
    const was = !this.el.hidden;
    this.el.hidden = !shown;
    document.body.classList.toggle('n-consent-on', shown);
    if (!shown) {
      document.documentElement.style.removeProperty('--n-consent-h');
      // Answered (or the switch gone): a new showing starts as shown.
      if (!this.wanted) this.set('shown');
      return;
    }
    if (!was) this.measure();
  }

  /** The band's height, kept for the page's foot (so the page's end scrolls into view above it). */
  private measure(): void {
    requestAnimationFrame(() => {
      if (this.el.hidden) return;
      document.documentElement.style.setProperty('--n-consent-h', `${Math.ceil(this.el.getBoundingClientRect().height)}px`);
    });
  }

  private set(state: ConsentBannerState, text = ''): void {
    this.state = state;
    this.el.dataset.state = state;
    const saving = state === 'saving';
    this.accept.disabled = saving;
    this.decline.disabled = saving;
    this.el.setAttribute('aria-busy', saving ? 'true' : 'false');
    this.line.textContent = text;
    this.line.hidden = text === '';
    if (!this.el.hidden) this.measure();
  }

  private async choose(choice: AdsChoice): Promise<void> {
    if (this.state === 'saving') return;
    this.set('saving', CONSENT.saving);
    try {
      await this.deps.choose(choice);
    } catch {
      this.set('error', CONSENT.failed);
      (choice === 'GRANTED' ? this.accept : this.decline).focus({ preventScroll: true });
      return;
    }
    // Saved: consent.ts tells the app, which hides it (update). Should it still be wanted, it shows as before.
    if ((this.state as ConsentBannerState) === 'saving') this.set('shown');
  }
}
