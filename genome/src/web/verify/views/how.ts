/**
 * HOW RELEASES WORK (plan NEXT-NINE of 2026-10-06, §3.5 FT-01; /verify/releases/how), public, in NOCTURNE's pieces with
 * the header, the rail and the footer of every screen, without a photograph: one page that explains every release, as
 * how-model.ts says it from GET /api/v1/releases/rules (its figures the server's, never typed).
 *
 *   ‹ THE RELEASES                         the crumb
 *   HOW RELEASES WORK                      the title and its sentence
 *   ───  THE WAYS TO TAKE PART             each section a hairline above it, its title, then each term in the display
 *        DRAW                              face with its sentence under it in the reading face (THE TIERS' rows under
 *        Any ORBES account may enter …     its sentence, in the reading face as THE CLUB's FROM n PIECES)
 *   ───  HOW THE ORDER IS SET
 *   ───  WHAT THE HOUSE NEVER DOES
 *   THE RELEASES                           a text link, back to the list
 *
 *   ONE MOMENT…                            while the figures are read
 *   How releases work could not be shown just now. TRY AGAIN
 *
 * No contact, no email, no phone: the page explains, the release's own page acts. CSP-safe: h() only, styles by class
 * (verify/styles.css, HOW RELEASES WORK).
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { HOW, RELEASES } from '../copy.js';
import { howPageModel, type HowPageModel } from '../how-model.js';
import type { ReleaseRules } from '../types.js';
import { RELEASES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { appAnchor, failedState, icon, loadingState, textLink } from './nocturne.js';

export interface HowDeps {
  api: Pick<ApiClient, 'releaseRules'>;
  /** ‹ THE RELEASES and THE RELEASES at the foot: the list. */
  onReleases(): void;
}

export interface HowView {
  root: HTMLElement;
  dispose(): void;
}

export function howView(deps: HowDeps): HowView {
  const page = new HowPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

type Load = { kind: 'loading' } | { kind: 'ready'; rules: ReleaseRules } | { kind: 'failed'; message: string };

class HowPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'n-how__body', attrs: { 'aria-live': 'polite' } });
  private load: Load = { kind: 'loading' };
  private disposed = false;
  private gen = 0;

  constructor(private readonly deps: HowDeps) {
    this.root = viewRoot('how', 'how-title');
    this.root.classList.add('n-how');
    const crumb = appAnchor(RELEASES_PATH, ['n-g', 'n-crumb', 'n-how__crumb'], () => deps.onReleases(), icon('back', { small: true }), RELEASES.link);
    this.root.append(
      crumb,
      h(
        'header',
        { class: 'n-px n-how__head' },
        h('h1', { class: 'n-g n-t1 n-how__title', id: 'how-title', attrs: { tabindex: -1 }, text: HOW.title }),
        h('p', { class: 'n-lead n-how__lead', text: HOW.lead }),
      ),
      this.body,
    );
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
  }

  private async fetch(): Promise<void> {
    const gen = ++this.gen;
    this.load = { kind: 'loading' };
    this.render();
    try {
      const rules = await this.deps.api.releaseRules();
      if (gen !== this.gen || this.disposed) return;
      this.load = { kind: 'ready', rules };
    } catch (e) {
      if (gen !== this.gen || this.disposed) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  private render(): void {
    const l = this.load;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(HOW.loading, { extraClass: 'n-how__waiting' }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(h('div', { class: 'n-px n-how__failed' }, failedState({ sentence: HOW.failed, reason: l.message, retry: HOW.retry, onRetry: () => void this.fetch() })));
      return;
    }
    this.body.replaceChildren(...this.page(howPageModel(l.rules)));
  }

  private page(m: HowPageModel): HTMLElement[] {
    const sections = m.sections.map((section) => {
      const id = `how-${section.id}`;
      return h(
        'section',
        { class: 'n-px n-how__section', attrs: { 'aria-labelledby': id }, data: { section: section.id } },
        h('h2', { class: 'n-g n-t3 n-how__section-title', id, text: section.title }),
        ...section.terms.map((t) =>
          h(
            'div',
            { class: 'n-how__term', data: { term: t.key } },
            h('h3', { class: 'n-g n-lb n-ivc n-how__name', text: t.term }),
            h('p', { class: 'n-tx n-how__text' }, ...withNumerals(t.text)),
            t.rows.length ? h('ul', { class: 'n-how__rows' }, ...t.rows.map((row) => h('li', { class: 'n-sm n-num n-how__row', text: row }))) : null,
          ),
        ),
      );
    });
    return [...sections, h('p', { class: 'n-px n-how__back' }, textLink(RELEASES.link, { href: RELEASES_PATH, onOpen: () => this.deps.onReleases(), extraClass: 'n-how__releases' }))];
  }
}
