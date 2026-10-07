/**
 * THE CLUB (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T9; /verify/club), public, in NOCTURNE's pieces with the header,
 * the rail and the footer of every screen: the tiers and what each gives, as club-model.ts says them (GET
 * /api/v1/the-club). Each tier is a plate with a hairline above it: its name in the display face, FROM n PIECES in the
 * reading face, its lines as – rows, its welcome gift's photograph full width with its name. Then HOW THE TIERS WORK,
 * and the way to the reader's own tier: the account sheet, MY PIECES, or its sign-in.
 *
 *   ONE MOMENT…                          while it is read
 *   The club could not be shown just now. TRY AGAIN
 *
 * The page links nowhere else: no HOW RELEASES WORK, which is reached from THE RELEASES and the releases' pages only.
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { clubPageModel, type ClubPageModel } from '../club-model.js';
import { CLUB_PAGE } from '../copy.js';
import type { SessionStore } from '../session.js';
import type { ClubStatus, TheClub } from '../types.js';
import { PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { accLink, failedState, fadedPhoto, loadingState } from './nocturne.js';

export interface ClubDeps {
  api: Pick<ApiClient, 'theClub' | 'clubStatus'>;
  session: SessionStore;
  /** YOUR TIER: …, the account sheet (`trigger`: the link, focus comes back to it). */
  onAccount(trigger: HTMLElement): void;
  /** YOUR FIRST PIECE OPENS TITANE and SIGN IN TO SEE YOUR TIER: MY PIECES, and its sign-in. */
  onPieces(): void;
}

export interface ClubView {
  root: HTMLElement;
  dispose(): void;
}

export function clubView(deps: ClubDeps): ClubView {
  const page = new ClubPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

type Load = { kind: 'loading' } | { kind: 'ready'; club: TheClub; status: ClubStatus | null } | { kind: 'failed'; message: string };

class ClubPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'n-club__body club__body', attrs: { 'aria-live': 'polite' } });
  private load: Load = { kind: 'loading' };
  private unsubscribe: (() => void) | null;
  private disposed = false;
  private gen = 0;

  constructor(private readonly deps: ClubDeps) {
    this.root = viewRoot('club', 'club-title');
    this.root.classList.add('n-club');
    this.root.append(h('header', { class: 'n-px n-club__head' }, h('h1', { class: 'n-g n-t1 club__title', id: 'club-title', attrs: { tabindex: -1 }, text: CLUB_PAGE.title })), this.body);
    // Signed in or out here or elsewhere: the way to the reader's tier follows.
    this.unsubscribe = deps.session.subscribe(() => {
      if (this.load.kind === 'ready') void this.fetch();
    });
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async fetch(): Promise<void> {
    const gen = ++this.gen;
    if (this.load.kind !== 'ready') {
      this.load = { kind: 'loading' };
      this.render();
    }
    try {
      await this.deps.session.ensure().catch(() => undefined);
      const signedIn = this.deps.session.state.status === 'signed-in';
      const [club, status] = await Promise.all([
        this.deps.api.theClub(),
        signedIn
          ? this.deps.api.clubStatus().catch((e: unknown) => {
              this.deps.session.noteError(e);
              return null;
            })
          : Promise.resolve(null),
      ]);
      if (gen !== this.gen || this.disposed) return;
      this.load = { kind: 'ready', club, status };
    } catch (e) {
      if (gen !== this.gen || this.disposed) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  private render(): void {
    const l = this.load;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(CLUB_PAGE.loading, { extraClass: 'n-club__waiting' }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(h('div', { class: 'n-px n-club__failed' }, failedState({ sentence: CLUB_PAGE.failed, reason: l.message, retry: CLUB_PAGE.retry, onRetry: () => void this.fetch() })));
      return;
    }
    const signedIn = this.deps.session.state.status === 'signed-in';
    const m = clubPageModel(l.club, signedIn ? { signedIn: true, status: l.status } : { signedIn: false });
    this.body.replaceChildren(...this.page(m));
  }

  private page(m: ClubPageModel): HTMLElement[] {
    const out: (HTMLElement | null)[] = [m.lead ? h('p', { class: 'n-px n-lead n-club__lead club__lead' }, ...withNumerals(m.lead)) : null];
    for (const t of m.tiers) {
      const id = `club-tier-${t.name.toLowerCase()}`;
      out.push(
        h(
          'section',
          { class: 'n-club__tier club__tier', attrs: { 'aria-labelledby': id }, data: { tier: t.name } },
          h(
            'div',
            { class: 'n-px n-club__plate' },
            h('h2', { class: 'n-g n-t2 n-club__name', id, text: t.name }),
            h('p', { class: 'n-sm n-num n-club__from' }, ...withNumerals(t.from)),
            t.lines.length ? h('ul', { class: 'n-club__lines' }, ...t.lines.map((line) => h('li', { class: 'n-sm n-club__line' }, ...withNumerals(line)))) : null,
          ),
          t.gift
            ? h(
                'figure',
                { class: 'n-club__gift' },
                fadedPhoto(t.gift.src, t.gift.alt, { height: 300, fade: false, extraClass: 'n-club__gift-photo' }),
                h('figcaption', { class: 'n-px n-g n-lb n-club__gift-name', text: t.gift.model }),
              )
            : null,
        ),
      );
    }
    out.push(
      h(
        'section',
        { class: 'n-px n-club__how', attrs: { 'aria-labelledby': 'club-how' } },
        h('h2', { class: 'n-g n-lb', id: 'club-how', text: m.how.label }),
        h('ul', { class: 'n-club__rules' }, ...m.how.lines.map((line) => h('li', { class: 'n-sm n-club__rule' }, ...withNumerals(line)))),
      ),
    );
    if (m.yours) {
      const yours = m.yours;
      const link = accLink(h('span', { class: 'n-num' }, ...withNumerals(yours.text)), {
        ...(yours.to === 'account' ? {} : { href: PIECES_PATH }),
        onOpen: () => (yours.to === 'account' ? this.deps.onAccount(link) : this.deps.onPieces()),
        extraClass: 'n-club__yours club__yours',
      });
      link.dataset.to = yours.to;
      out.push(h('div', { class: 'n-px n-club__way' }, link));
    }
    return out.filter((x): x is HTMLElement => x !== null);
  }
}
