/**
 * THE RELEASES (P-R03): the releases ORBES announces, /verify/releases, and
 * a release's page, /verify/releases/<id>.
 *
 *              ORBES                         small wordmark
 *          T H E   R E L E A S E S           the page's title
 *   Pieces released in a limited number. …
 *   ┌                              ┐
 *     [ photo ]                              ivory plates, one per release:
 *     ENTRIES OPEN                           its state, its title, its model,
 *     MONOLITHE — RELEASE I                  its pieces and the time that
 *     MONOLITHE · RING                       matters now (UTC), and its one
 *     3 PIECES · ENTRIES CLOSE 14 OCT …      text link
 *     SEE THE RELEASE
 *   └                              ┘
 *            [ SCAN ORBES CODE ]
 *   THE COLLECTION
 *   PRIVACY · TERMS · LEGAL · HELP
 *
 * A release's page: its collection (or model), its title and state, then,
 * with an early access (P-X02), the line PLATINE AND PALLADIUM: FROM … ·
 * EVERYONE: FROM … (UTC); the model's photograph on an ivory plate, its
 * description; THE RELEASE (the model, with SEE THE MODEL when its sheet is
 * public, the pieces, the times in UTC then on this phone, the early access
 * among them, how long a place drawn is held, the places reserved directly,
 * and the paragraph on the early access); YOUR ENTRY (signed out: the sign-in
 * and CREATE ACCOUNT of the OWNERSHIP panel, any account may enter; signed
 * in: what the entry means now, ENTER THE DRAW or WITHDRAW, RESERVE A PLACE
 * for a PLATINE or PALLADIUM account during the early access, and for a
 * place held the contact of ORBES Client Services); THE DRAW (its rule,
 * word for word, and the seed's fingerprint; once drawn the seed, checked
 * on this phone against the fingerprint, and the entries by rank, the
 * account's own marked, a hundred at a time). ENTER THE DRAW, or RESERVE A
 * PLACE, is the page's hairline button while it is offered (the foot's
 * SCAN ORBES CODE is then a text link), as DOWNLOAD PDF is on a
 * certificate. After a reservation, the page is read again: its places.
 *
 * THE RELEASES lists the LIVE RELEASES first (plan of 2026-10-04: LIVE RELEASE cards), each on a vault plate among
 * the ivory ones of the draws: its picture of the stage reached (the seal before any), LIVE RELEASE and where it
 * stands, its name once revealed, its opening in Paris (then on this phone), its price and quantity line, its rule and
 * SEE THE RELEASE; its page is the LIVE RELEASE's (views/live.ts).
 *
 * Every action is a same-origin JSON call through ApiClient (the session
 * cookie, the CSRF token); server messages are shown as they come. A 401
 * ends the session on the page, which then offers the sign-in again.
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { RELEASES } from '../copy.js';
import { liveCards, type LiveCardModel } from '../live-model.js';
import { sealSvg } from '../live-seal.js';
import {
  drawLines,
  entryModel,
  releaseCards,
  releaseSheet,
  type EntryModel,
  type ReleaseCardModel,
  type ReleasePhoto,
  type ReleaseRow,
  type ReleaseSheetModel,
} from '../releases-model.js';
import type { SessionStore } from '../session.js';
import type { ClientServices, ClubEntry, DrawEntry } from '../types.js';
import { contactBlock, legalLinks, lookbookLink, releasesLink, sectionLabel, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { OwnershipPanel } from './ownership.js';

export interface ReleasesView {
  root: HTMLElement;
  dispose(): void;
}

export interface ReleasesDeps {
  api: ApiClient;
  /** SCAN ORBES CODE, the page's hairline button. */
  onScan(): void;
  /** Open a release's page in the app. */
  onRelease(id: string): void;
  /** THE COLLECTION, in the app. */
  onCollection(): void;
  /** This phone's time zone: a LIVE RELEASE's opening is said in Paris, then here when it differs. */
  localZone: string;
}

export interface ReleaseDeps {
  api: ApiClient;
  session: SessionStore;
  /** The release's id; null when the address names none (the page says the release is not known). */
  id: string | null;
  onScan(): void;
  /** THE RELEASES: back to the list. */
  onReleases(): void;
  /** SEE THE MODEL: its sheet in THE COLLECTION. */
  onModel(slug: string): void;
  /** How ORBES Client Services is reached (`{}` when not configured); never rejects. */
  clientServices(): Promise<ClientServices>;
  /** Minutes east of UTC of this phone's clock. */
  offsetMinutes: number;
}

export function releasesView(deps: ReleasesDeps): ReleasesView {
  const page = new ListPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

export function releaseView(deps: ReleaseDeps): ReleasesView {
  const page = new ReleasePage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

/** The small wordmark that opens every page of the app but the landing. */
const wordmark = (extraClass: string) => h('span', { class: `wordmark wordmark--small ${extraClass}`, attrs: { 'aria-hidden': 'true' }, text: 'ORBES' });

/** A photograph of a release: contained, never cropped; one that cannot be loaded takes its frame with it. */
function photo(p: ReleasePhoto, className: string, eager = false): HTMLImageElement {
  const img = h('img', { class: className, attrs: { src: p.src, alt: p.alt, decoding: 'async', loading: eager ? 'eager' : 'lazy' } });
  img.addEventListener('error', () => img.closest<HTMLElement>('[data-photo]')?.setAttribute('hidden', ''), { once: true });
  return img;
}

/**
 * The facts of a release as rows: a label in the display face, its value in the reading face; a time is said in UTC,
 * then on this phone's clock on a line of its own.
 */
function releaseRows(rows: readonly ReleaseRow[]): HTMLDListElement {
  return h(
    'dl',
    { class: 'rows release__rows' },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'rows__row' },
        h('dt', { class: 'rows__label', text: r.label }),
        h('dd', { class: 'rows__value' }, h('span', { class: 'release__utc', text: r.value }), r.local ? h('span', { class: 'release__local', text: r.local }) : null),
      ),
    ),
  );
}

// ── The list ───────────────────────────────────────────────────────────────

type ListLoad = { kind: 'loading' } | { kind: 'ready'; live: LiveCardModel[]; cards: ReleaseCardModel[] } | { kind: 'failed'; message: string };

class ListPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'releases__body', attrs: { 'aria-live': 'polite' } });
  private load: ListLoad = { kind: 'loading' };
  private disposed = false;

  constructor(private readonly deps: ReleasesDeps) {
    this.root = viewRoot('releases', 'releases-title');
    this.root.append(
      h(
        'header',
        { class: 'releases__head' },
        wordmark('releases__wordmark'),
        h('h1', { class: 'releases__title', id: 'releases-title', text: RELEASES.title }),
        h('p', { class: 'prose releases__lead', text: RELEASES.lead }),
      ),
      this.body,
      h(
        'footer',
        { class: 'releases__foot' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => deps.onScan() }, text: RELEASES.scan }),
        lookbookLink(() => deps.onCollection(), { extraClass: 'releases__collection' }),
        legalLinks({ extraClass: 'releases__legal' }),
      ),
    );
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
  }

  private async fetch(): Promise<void> {
    this.load = { kind: 'loading' };
    this.render();
    try {
      const [drops, live] = await Promise.all([this.deps.api.drops(), this.deps.api.liveReleases()]);
      if (this.disposed) return;
      this.load = { kind: 'ready', live: liveCards(live, this.deps.localZone), cards: releaseCards(drops) };
    } catch (e) {
      if (this.disposed) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    if (l.kind === 'loading') {
      this.body.replaceChildren(h('p', { class: 'releases__waiting micro', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${RELEASES.loadFailed} ${l.message}` }),
        h('button', { class: 'textlink releases__retry', attrs: { type: 'button' }, on: { click: () => void this.fetch() }, text: RELEASES.retry }),
      );
      if (hadFocus) this.body.querySelector<HTMLElement>('.releases__retry')?.focus();
      return;
    }
    if (l.cards.length === 0 && l.live.length === 0) {
      this.body.replaceChildren(h('p', { class: 'prose releases__empty', text: RELEASES.empty }));
      return;
    }
    this.body.replaceChildren(
      h(
        'ul',
        { class: 'releases__list' },
        ...l.live.map((c) => h('li', { class: 'releases__item' }, this.liveCard(c))),
        ...l.cards.map((c) => h('li', { class: 'releases__item' }, this.card(c))),
      ),
    );
  }

  /** A LIVE RELEASE: its vault plate, its picture of the stage reached (the seal before any), its opening, its rule. */
  private liveCard(c: LiveCardModel): HTMLElement {
    const id = `release-${c.id}`;
    const link = releasesLink(() => this.deps.onRelease(c.id), { id: c.id, extraClass: 'live-card__link' });
    link.setAttribute('aria-describedby', `${id}-title`);
    const frame = h('div', { class: 'live-card__frame' });
    if (c.picture) {
      const img = h('img', { class: ['live-card__img', `live-card__img--${c.picture.kind}`], attrs: { src: c.picture.src, alt: c.picture.alt, decoding: 'async', loading: 'lazy' } });
      img.addEventListener('error', () => img.replaceWith(sealSvg('live-card__seal')), { once: true });
      frame.append(img);
    } else frame.append(sealSvg('live-card__seal'));
    return bracket(
      h(
        'article',
        { class: 'live-card vault', attrs: { 'aria-labelledby': `${id}-title` } },
        frame,
        h('p', { class: 'live-card__kind', text: c.kind }),
        h('h2', { class: 'live-card__title', id: `${id}-title` }, ...withNumerals(c.title)),
        h('p', { class: 'live-card__when' }, ...withNumerals(c.when.paris)),
        c.when.local ? h('p', { class: 'live-card__when live-card__when--local' }, ...withNumerals(c.when.local)) : null,
        h('p', { class: 'live-card__line' }, ...withNumerals(c.line)),
        h('p', { class: 'live-card__access' }, ...withNumerals(c.access)),
        link,
      ),
    );
  }

  private card(c: ReleaseCardModel): HTMLElement {
    const id = `release-${c.id}`;
    const link = releasesLink(() => this.deps.onRelease(c.id), { id: c.id, extraClass: 'release-card__link' });
    // SEE THE RELEASE, of which release: its title, for a screen reader moving from link to link.
    link.setAttribute('aria-describedby', `${id}-title`);
    return bracket(
      h(
        'article',
        { class: 'release-card', data: { state: c.state }, attrs: { 'aria-labelledby': `${id}-title` } },
        c.image ? h('div', { class: 'release-card__frame', data: { photo: '' } }, photo(c.image, 'release-card__img')) : null,
        h('p', { class: 'release-card__state', text: c.stateLabel }),
        h('h2', { class: 'release-card__title', id: `${id}-title` }, ...withNumerals(c.title)),
        h('p', { class: 'release-card__model' }, ...withNumerals(c.model)),
        h('p', { class: 'release-card__line micro', text: c.line }),
        link,
      ),
    );
  }
}

// ── A release ──────────────────────────────────────────────────────────────

type ReleaseLoad = { kind: 'loading' } | { kind: 'ready'; sheet: ReleaseSheetModel } | { kind: 'missing' } | { kind: 'failed'; message: string };
/** The account's entry in this release: not asked yet (signed out), being read, read (null: none), or unreadable. */
type EntryLoad = { kind: 'none' } | { kind: 'loading' } | { kind: 'ready'; entry: ClubEntry | null } | { kind: 'failed'; message: string };
type DrawList = { kind: 'idle' } | { kind: 'loading'; items: DrawEntry[] } | { kind: 'ready'; items: DrawEntry[]; total: number } | { kind: 'failed'; items: DrawEntry[]; message: string };

/** Entries of the draw's list read at a time. */
const DRAW_PAGE = 100;

class ReleasePage {
  readonly root: HTMLElement;
  private readonly title = h('h1', { class: 'release__title', id: 'release-title', text: RELEASES.title });
  private readonly eyebrow = h('p', { class: 'release__eyebrow', attrs: { hidden: true } });
  private readonly stateLine = h('p', { class: 'release__state', attrs: { hidden: true } });
  /** P-X02: PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM … (UTC), with an early access. */
  private readonly accessLine = h('p', { class: 'release__access micro', attrs: { hidden: true } });
  private readonly body = h('div', { class: 'release__body', attrs: { 'aria-live': 'polite' } });
  private readonly entrySection = h('section', { class: 'release__section release__entry', attrs: { 'aria-labelledby': 'release-entry' } });
  private readonly drawSection = h('section', { class: 'release__section release__draw', attrs: { 'aria-labelledby': 'release-draw' } });
  private readonly foot = h('footer', { class: 'release__foot' });
  private load: ReleaseLoad = { kind: 'loading' };
  private entry: EntryLoad = { kind: 'none' };
  private draw: DrawList = { kind: 'idle' };
  /** The seed checked on this phone against its fingerprint: null until known. */
  private seedMatches: boolean | null = null;
  private signIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private contacts: ClientServices = {};
  private busy = false;
  private actionError: string | null = null;
  private disposed = false;
  /** Bumped on each read of the account's entry: an older answer is dropped. */
  private entryGen = 0;
  /** The account's tier now, read with its entry (the club's status): PLATINE and PALLADIUM reserve during the early access. */
  private tier = 0;

  constructor(private readonly deps: ReleaseDeps) {
    this.root = viewRoot('release', 'release-title');
    this.root.append(h('header', { class: 'release__head' }, wordmark('release__wordmark'), this.eyebrow, this.title, this.stateLine, this.accessLine), this.body, this.foot);
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    this.render();
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.signIn?.dispose();
    this.signIn = null;
  }

  private async start(): Promise<void> {
    const id = this.deps.id;
    if (id === null) {
      this.load = { kind: 'missing' };
      this.render();
      return;
    }
    try {
      const [sheet, contacts] = await Promise.all([this.deps.api.drop(id), this.deps.clientServices()]);
      if (this.disposed) return;
      this.contacts = contacts;
      this.load = { kind: 'ready', sheet: releaseSheet(sheet, this.deps.offsetMinutes) };
    } catch (e) {
      if (this.disposed) return;
      this.load = e instanceof ApiError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
    }
    this.render();
    if (this.load.kind !== 'ready') return;
    const s = this.load.sheet;
    if (s.drawn) {
      void this.checkSeed(s);
      void this.moreEntries();
    }
    await this.deps.session.ensure().catch(() => undefined);
    if (!this.disposed) this.onSession();
  }

  /** The session changed (signed in with this page's form, elsewhere, or ended): the account's entry follows. */
  private onSession(): void {
    if (this.disposed || this.load.kind !== 'ready') return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      this.signIn?.dispose();
      this.signIn = null;
      if (this.entry.kind === 'none') void this.readEntry();
    } else {
      this.entryGen++;
      this.entry = { kind: 'none' };
      this.tier = 0;
      this.actionError = null;
    }
    this.render();
  }

  private async readEntry(): Promise<void> {
    if (this.load.kind !== 'ready') return;
    const id = this.load.sheet.id;
    const gen = ++this.entryGen;
    this.entry = { kind: 'loading' };
    this.render();
    try {
      const status = await this.deps.api.clubStatus();
      if (gen !== this.entryGen || this.disposed) return;
      this.tier = Number(status.tier?.level) || 0;
      this.entry = { kind: 'ready', entry: status.entries.find((e) => e.dropId === id) ?? null };
    } catch (e) {
      if (gen !== this.entryGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.entry = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /** The draw's list, a hundred entries more at each SHOW MORE. */
  private async moreEntries(): Promise<void> {
    if (this.load.kind !== 'ready' || this.draw.kind === 'loading') return;
    const id = this.load.sheet.id;
    const items = this.draw.kind === 'idle' ? [] : this.draw.items;
    this.draw = { kind: 'loading', items };
    this.renderDraw();
    try {
      const page = await this.deps.api.drawEntries(id, Math.floor(items.length / DRAW_PAGE) + 1, DRAW_PAGE);
      if (this.disposed) return;
      this.draw = { kind: 'ready', items: [...items, ...page.items], total: page.total };
    } catch (e) {
      if (this.disposed) return;
      this.draw = { kind: 'failed', items, message: messageOf(e) };
    }
    this.renderDraw();
  }

  /** The seed's SHA-256, computed on this phone, against the fingerprint published with the release. */
  private async checkSeed(s: ReleaseSheetModel): Promise<void> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !s.seedHex || !s.seedHashHex) return;
    try {
      const bytes = new Uint8Array(s.seedHex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));
      const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
      if (this.disposed) return;
      this.seedMatches = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('') === s.seedHashHex;
    } catch {
      return;
    }
    this.renderDraw();
  }

  private async act(kind: 'enter' | 'withdraw' | 'reserve'): Promise<void> {
    if (this.busy || this.load.kind !== 'ready') return;
    const id = this.load.sheet.id;
    this.busy = true;
    this.actionError = null;
    this.renderEntry();
    try {
      const api = this.deps.api;
      const entry = kind === 'enter' ? await api.enterDrop(id) : kind === 'withdraw' ? await api.withdrawDrop(id) : await api.reserveDrop(id);
      if (this.disposed) return;
      this.entry = { kind: 'ready', entry };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.actionError = messageOf(e);
    } finally {
      this.busy = false;
    }
    // A reservation, made or refused (every piece held, the early access over), changes the release's places: read again.
    if (kind === 'reserve') await this.refreshSheet();
    if (this.disposed) return;
    this.render();
    // Keyboard focus on what the page now says of the entry.
    this.root.querySelector<HTMLElement>('#release-entry')?.focus({ preventScroll: true });
  }

  /** The release read again (its places, its state), the page as it was otherwise; kept as it was if it cannot be read. */
  private async refreshSheet(): Promise<void> {
    if (this.load.kind !== 'ready') return;
    try {
      const sheet = await this.deps.api.drop(this.load.sheet.id);
      if (this.disposed || this.load.kind !== 'ready') return;
      this.load = { kind: 'ready', sheet: releaseSheet(sheet, this.deps.offsetMinutes) };
    } catch {
      return;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    if (l.kind !== 'ready') {
      this.eyebrow.hidden = true;
      this.stateLine.hidden = true;
      this.accessLine.hidden = true;
      this.title.textContent = RELEASES.title;
      this.foot.replaceChildren(this.scanButton('btn'), releasesLink(() => this.deps.onReleases(), { extraClass: 'release__releases' }), legalLinks({ extraClass: 'release__legal' }));
    }
    if (l.kind === 'loading') {
      this.body.replaceChildren(h('p', { class: 'releases__waiting micro', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
      return;
    }
    if (l.kind === 'missing') {
      this.body.replaceChildren(h('p', { class: 'prose release__missing', text: RELEASES.notFound }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${RELEASES.loadFailed} ${l.message}` }),
        h('button', { class: 'textlink release__retry', attrs: { type: 'button' }, on: { click: () => void this.start() }, text: RELEASES.retry }),
      );
      if (hadFocus) this.body.querySelector<HTMLElement>('.release__retry')?.focus();
      return;
    }
    const s = l.sheet;
    this.root.dataset.release = s.state.toLowerCase();
    this.eyebrow.replaceChildren(...withNumerals(s.eyebrow));
    this.eyebrow.hidden = false;
    this.title.replaceChildren(...withNumerals(s.title));
    this.stateLine.textContent = s.stateLabel;
    this.stateLine.hidden = false;
    this.accessLine.textContent = s.access ?? '';
    this.accessLine.hidden = s.access === null;

    const sections: (HTMLElement | null)[] = [];
    if (s.image) {
      sections.push(h('section', { class: 'release__photo', attrs: { 'aria-label': s.image.alt }, data: { photo: '' } }, bracket(h('div', { class: 'release__plate' }, photo(s.image, 'release__img', true)))));
    }
    const description = storyBlock(s.description, { className: 'release__description', paragraphClass: 'prose release__paragraph' });
    if (description) sections.push(description);
    const model = h('p', { class: 'release__model' }, ...withNumerals(s.model));
    sections.push(
      h(
        'section',
        { class: 'release__section', attrs: { 'aria-labelledby': 'release-facts' } },
        sectionLabel(RELEASES.section.release, 'release-facts'),
        h('div', { class: 'release__model-line' }, model, s.lookbookSlug ? lookbookLink(() => this.deps.onModel(s.lookbookSlug!), { slug: s.lookbookSlug, extraClass: 'release__see-model' }) : null),
        releaseRows(s.rows),
        s.earlyNote ? h('p', { class: 'prose release__early', text: s.earlyNote }) : null,
      ),
    );
    sections.push(this.entrySection, this.drawSection);
    this.body.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
    this.renderEntry();
    this.renderDraw();
  }

  private scanButton(kind: 'btn' | 'textlink'): HTMLButtonElement {
    return h('button', { class: `${kind} release__scan`, attrs: { type: 'button' }, on: { click: () => this.deps.onScan() }, text: RELEASES.scan });
  }

  /** YOUR ENTRY: the sign-in when signed out, else what the entry means now and the one action it allows. */
  private renderEntry(): void {
    if (this.load.kind !== 'ready') return;
    const s = this.load.sheet;
    const hadFocus = this.entrySection.contains(document.activeElement);
    const session = this.deps.session.state;
    const heading = sectionLabel(RELEASES.section.entry, 'release-entry');
    heading.tabIndex = -1;
    let offersAction = false;
    const out: (HTMLElement | null)[] = [heading];
    if (session.status !== 'signed-in') {
      // No account needed to read; ENTER THE DRAW needs one (any): the OWNERSHIP panel's sign-in and CREATE ACCOUNT.
      if (s.state === 'OPEN' || s.state === 'UPCOMING') {
        this.signIn ??= new OwnershipPanel({ kind: 'account', lead: RELEASES.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
        out.push(h('div', { class: 'release__signin' }, this.signIn.root));
      } else {
        out.push(this.sentence(entryModel(this.releaseOf(s), null, this.entryOpts())));
      }
    } else if (this.entry.kind === 'loading' || this.entry.kind === 'none') {
      out.push(h('p', { class: 'ownership__meta micro soft', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
    } else if (this.entry.kind === 'failed') {
      out.push(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${RELEASES.entryFailed} ${this.entry.message}` }),
        h('button', { class: 'textlink release__retry-entry', attrs: { type: 'button' }, on: { click: () => void this.readEntry() }, text: RELEASES.retry }),
      );
    } else {
      const m = entryModel(this.releaseOf(s), this.entry.entry, this.entryOpts());
      out.push(this.sentence(m));
      if (m.entryId) out.push(h('p', { class: 'release__entry-id micro soft', text: RELEASES.entryId(m.entryId) }));
      if (this.actionError) out.push(h('p', { class: 'form__error', attrs: { role: 'alert' }, text: this.actionError }));
      if (m.canEnter) {
        offersAction = true;
        out.push(h('button', { class: 'btn release__enter', attrs: { type: 'button', disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' }, on: { click: () => void this.act('enter') }, text: RELEASES.enter }));
      }
      // P-X02: during the early access, a PLATINE or PALLADIUM account holds a place at once.
      if (m.canReserve) {
        offersAction = true;
        out.push(h('button', { class: 'btn release__reserve', attrs: { type: 'button', disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' }, on: { click: () => void this.act('reserve') }, text: RELEASES.reserve }));
      }
      if (m.canWithdraw) out.push(h('div', { class: 'ownership__actions' }, h('button', { class: 'textlink release__withdraw', attrs: { type: 'button', disabled: this.busy }, on: { click: () => void this.act('withdraw') }, text: RELEASES.withdraw })));
      if (m.contact) out.push(contactBlock(m.contact));
    }
    this.entrySection.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    // One hairline button on the page: ENTER THE DRAW or RESERVE A PLACE while it is offered, SCAN ORBES CODE otherwise.
    this.foot.replaceChildren(this.scanButton(offersAction ? 'textlink' : 'btn'), releasesLink(() => this.deps.onReleases(), { extraClass: 'release__releases' }), legalLinks({ extraClass: 'release__legal' }));
    if (hadFocus && !this.entrySection.contains(document.activeElement)) (this.entrySection.querySelector<HTMLElement>('input, button:not([disabled])') ?? heading).focus({ preventScroll: true });
  }

  private sentence(m: EntryModel): HTMLElement {
    return h('div', { class: 'release__status' }, m.label ? h('p', { class: 'ownership__status', text: m.label }) : null, h('p', { class: 'prose release__sentence', text: m.sentence }));
  }

  private releaseOf(s: ReleaseSheetModel) {
    return { id: s.id, title: s.title, state: s.state, opensAt: s.opensAt, earlyAccess: s.earlyAccess, full: s.full };
  }

  private entryOpts() {
    return { offsetMinutes: this.deps.offsetMinutes, clientServices: this.contacts, tier: this.tier };
  }

  /** THE DRAW: its rule and commitment; once drawn, the seed, the phone's check and the entries by rank. */
  private renderDraw(): void {
    if (this.load.kind !== 'ready') return;
    const s = this.load.sheet;
    const hadFocus = this.drawSection.contains(document.activeElement);
    const facts: ReleaseRow[] = [{ label: RELEASES.seedHash, value: s.seedHash }];
    if (s.seed) facts.push({ label: RELEASES.seed, value: s.seed });
    const out: (HTMLElement | null)[] = [
      sectionLabel(RELEASES.section.draw, 'release-draw'),
      h('p', { class: 'prose release__rule', text: RELEASES.rule }),
      h('p', { class: 'prose release__obligation', text: RELEASES.noObligation }),
      h('p', { class: 'prose release__commitment', text: RELEASES.commitment }),
      h(
        'dl',
        { class: 'rows release__seed' },
        ...facts.map((f) => h('div', { class: 'rows__row' }, h('dt', { class: 'rows__label', text: f.label }), h('dd', { class: 'rows__value release__hex', text: f.value }))),
      ),
    ];
    if (s.drawn && this.seedMatches !== null) {
      out.push(h('p', { class: 'prose release__check', attrs: { role: 'status' }, text: this.seedMatches ? RELEASES.seedChecked : RELEASES.seedMismatch }));
    }
    if (s.drawn) out.push(...this.drawList(s));
    this.drawSection.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    if (hadFocus && !this.drawSection.contains(document.activeElement)) this.drawSection.querySelector<HTMLElement>('.release__more, .release__retry-draw')?.focus({ preventScroll: true });
  }

  private drawList(s: ReleaseSheetModel): HTMLElement[] {
    const d = this.draw;
    const items = d.kind === 'idle' ? [] : d.items;
    const yours = this.entry.kind === 'ready' && this.entry.entry ? this.entry.entry.id : null;
    const lines = drawLines(items, yours);
    const out: HTMLElement[] = [sectionLabel(RELEASES.section.entries, 'release-entries'), h('p', { class: 'prose release__entries-lead', text: RELEASES.entriesLead(s.entries ?? 0) })];
    if (lines.length > 0) {
      out.push(
        h(
          'ol',
          { class: 'release__list', attrs: { 'aria-labelledby': 'release-entries' } },
          ...lines.map((l) =>
            h(
              'li',
              { class: ['release__item', l.yours ? 'is-yours' : null], data: { rank: String(l.rank) } },
              h('span', { class: 'release__item-line', text: l.line }),
              h('span', { class: 'release__item-id', text: l.id }),
              l.yours ? h('span', { class: 'release__item-yours', text: RELEASES.yours }) : null,
            ),
          ),
        ),
      );
    }
    if (d.kind === 'loading') out.push(h('p', { class: 'ownership__meta micro soft', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
    if (d.kind === 'failed') {
      out.push(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${RELEASES.entriesFailed} ${d.message}` }),
        h('button', { class: 'textlink release__retry-draw', attrs: { type: 'button' }, on: { click: () => void this.moreEntries() }, text: RELEASES.retry }),
      );
    }
    if (d.kind === 'ready' && d.items.length < d.total) {
      out.push(h('button', { class: 'textlink release__more', attrs: { type: 'button' }, on: { click: () => void this.moreEntries() }, text: RELEASES.more }));
    }
    return out;
  }
}
