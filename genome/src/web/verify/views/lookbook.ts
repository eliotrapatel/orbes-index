/**
 * THE COLLECTION (P-R02; plan NOCTURNE, screen 5, step N6): the lookbook of the models, /verify/lookbook [C5], and a
 * model's sheet, /verify/lookbook/<slug> [C6, C33].
 *
 *   THE COLLECTION                           the page's title and its sentence
 *   The models of ORBES, as the maison…
 *   ORBITAL                                  a collection (none: no heading)
 *   [ the photograph, whole, faded ]         each model full width: its photograph (its dot's), its words lifted onto
 *            MONOLITHE                       its foot, its variant dots (each switches the photograph and SEE THE
 *            BRACELET                        MODEL), You own N (the account's pieces of it and its variants, from MY
 *        ◉ Steel  ● Gold  ● Blue             PIECES), SEE THE MODEL
 *     ✓ You own two: steel and gold
 *          SEE THE MODEL
 *   THE PRIVATE SALON                        an owner signed in (P-X08): the models of its tier, priced;
 *   Pieces offered to the owners…            a visitor (signed out, or an account that holds no piece; addition 7): a
 *   ┌───────────────────────────┐            plate card that says what it is and what opens it, SIGN IN and SCAN ORBES
 *   │ THE PRIVATE SALON  …      │            CODE, never a model (terms, article 12)
 *   └───────────────────────────┘
 *
 * The sheet: ‹ THE COLLECTION; the photograph whole, faded; its collection, name, line (type, THE PRIVATE SALON,
 * DISCONTINUED · <year>), SIZES 16 · 17 · 18 (addition 8), the dots (each switches the sheet: its photographs, story,
 * facts, care, the salon's price and request; the address follows, so a variant's own address opens it selected), You
 * own N; the model's next release as a plate row (its day and hour, no countdown); for a model of the salon its price,
 * the tier it is offered from, its sentence, a note and REQUEST THIS PIECE (the sheet's one primary action), or once
 * requested REQUESTED with the contact of ORBES Client Services; THE STORY, the gallery full width, SPECIFICATIONS, CARE.
 *
 * The grid reads GET /api/v1/lookbook (the same for everyone) and, for a signed-in account, the club's reserved models
 * (a 403 for an account that holds no piece: the teaser) and its pieces (You own N). A sheet reads, signed in, the
 * club's (a public model with the variants of the salon its tier reaches, or a model of the salon; 404 below the model's
 * tier), the public sheet for an account that holds no piece (403) or signed out; and THE RELEASES' lists for its next
 * release. Both read again when the account signs in or out. REQUEST THIS PIECE is a same-origin
 * JSON call through ApiClient (the session cookie, the CSRF token); server messages are shown as they come. CSP-safe:
 * h() only, NOCTURNE's pieces (views/nocturne.ts), their places by class (verify/styles.css, THE COLLECTION).
 */
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { CONTACT, LOOKBOOK } from '../copy.js';
import { cardFace, lookbookGroups, lookbookSheetPath, ownedLine, SALON_NOTE_MAX, selectDot, sheetLine, sheetModel, withRequest, type CardModel, type CollectionGroup, type SheetModel } from '../lookbook-model.js';
import { nextRelease, type NextReleaseModel } from '../next-release-model.js';
import type { SessionStore } from '../session.js';
import type { ClientServices, DropCard, LiveCard, LookbookCard, OwnedPiece } from '../types.js';
import { salonContactModel } from '../view-model.js';
import { LOOKBOOK_PATH, PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { appAnchor, button, contactLines, definitionList, failedState, fadedPhoto, icon, lift, loadingState, plateCard, quietLine, textLink, variantDots } from './nocturne.js';

export interface LookbookView {
  root: HTMLElement;
  dispose(): void;
}

type Session = Pick<SessionStore, 'ensure' | 'noteError' | 'subscribe'>;

export interface LookbookDeps {
  api: Pick<ApiClient, 'lookbook' | 'clubLookbook' | 'products'>;
  session: Session;
  /** SCAN ORBES CODE (THE PRIVATE SALON's teaser). */
  onScan(): void;
  /** SIGN IN (THE PRIVATE SALON's teaser): MY PIECES' sign-in, as the header's SIGN IN. */
  onSignIn(): void;
  /** Open a model's sheet in the app. */
  onSheet(slug: string): void;
}

export interface SheetDeps {
  api: Pick<ApiClient, 'lookbookSheet' | 'clubLookbookSheet' | 'requestPiece' | 'products' | 'liveReleases' | 'drops'>;
  session: Session;
  /** The address of the sheet; null when the path names none (the page says the model is not in the collection). */
  slug: string | null;
  /** ‹ THE COLLECTION: back to the grid. */
  onCollection(): void;
  /** A dot chosen: the sheet's address becomes that variant's (no new history entry). */
  onVariant(slug: string): void;
  /** The model's next release: its page. */
  onRelease(id: string): void;
  /** P-X08: the contact of ORBES Client Services, shown once a piece of the salon is requested ({} when none is configured). */
  clientServices(): Promise<ClientServices>;
  /** Opened as a screen change: once read, focus comes to its title (the model's name), as it came to the sheet's before. */
  focus?: boolean;
}

/** THE PRIVATE SALON on the grid: its models (an owner), the teaser (a visitor), or nothing (unknown, or none of its tier). */
type Salon = { kind: 'open'; groups: CollectionGroup[] } | { kind: 'teaser'; signedIn: boolean } | { kind: 'none' };
type GridLoad = { kind: 'loading' } | { kind: 'ready'; groups: CollectionGroup[]; salon: Salon; pieces: OwnedPiece[] } | { kind: 'failed'; message: string };
type SheetLoad = { kind: 'loading' } | { kind: 'ready'; sheet: SheetModel } | { kind: 'missing' } | { kind: 'failed'; message: string };

export function lookbookView(deps: LookbookDeps): LookbookView {
  const page = new GridPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

export function sheetView(deps: SheetDeps): LookbookView {
  const page = new SheetPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

/** The account's pieces (You own N); none signed out, or when they cannot be read. */
async function ownPieces(api: Pick<ApiClient, 'products'>, session: Session, signedIn: boolean): Promise<OwnedPiece[]> {
  if (!signedIn) return [];
  try {
    return await api.products();
  } catch (e) {
    session.noteError(e);
    return [];
  }
}

/** Whether the account is signed in; null when the session cannot be read (offline). */
async function signedInNow(session: Session): Promise<boolean | null> {
  try {
    return (await session.ensure()).status === 'signed-in';
  } catch {
    return null;
  }
}

/** A photograph removed meanwhile takes its frame with it: never a broken image. */
function hideWhenBroken(box: HTMLElement): HTMLElement {
  box.querySelector('img')?.addEventListener('error', () => (box.hidden = true), { once: true });
  return box;
}

/**
 * A dot chosen re-draws a card or the sheet inside its live region: silent while it changes (the pressed dot, which
 * keeps the focus, says what changed), polite again on the next frame for loads, failures and REQUESTED.
 */
function quietly(region: HTMLElement, change: () => void): void {
  region.setAttribute('aria-live', 'off');
  change();
  requestAnimationFrame(() => region.setAttribute('aria-live', 'polite'));
}

// ── The grid (C5) ──────────────────────────────────────────────────────────

class GridPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'n-lookbook__body', attrs: { 'aria-live': 'polite' } });
  private load: GridLoad = { kind: 'loading' };
  private disposed = false;
  private signedIn: boolean | null = null;
  private readonly unsubscribe: () => void;
  /** The dot selected on each card (by the card's address), kept across a render. */
  private readonly selected = new Map<string, string>();

  constructor(private readonly deps: LookbookDeps) {
    this.root = viewRoot('lookbook', 'lookbook-title');
    this.root.classList.add('n-lookbook');
    this.root.append(
      h(
        'header',
        { class: 'n-px n-lookbook__head' },
        h('h1', { class: 'n-g n-t1', id: 'lookbook-title', text: LOOKBOOK.title }),
        h('p', { class: 'n-lead n-lookbook__lead', text: LOOKBOOK.lead }),
      ),
      this.body,
    );
    // Signed in or out meanwhile (the account sheet, a sign-in elsewhere): THE PRIVATE SALON and You own N change.
    this.unsubscribe = deps.session.subscribe((s) => {
      if (s.status !== 'unknown' && this.signedIn !== null && (s.status === 'signed-in') !== this.signedIn) void this.fetch();
    });
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  private async fetch(): Promise<void> {
    this.load = { kind: 'loading' };
    this.render();
    try {
      const signedIn = await signedInNow(this.deps.session);
      const [cards, salon, pieces] = await Promise.all([this.deps.api.lookbook(), this.salon(signedIn), ownPieces(this.deps.api, this.deps.session, signedIn === true)]);
      if (this.disposed) return;
      this.signedIn = signedIn;
      this.load = { kind: 'ready', groups: lookbookGroups(cards), salon, pieces };
    } catch (e) {
      if (this.disposed) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /**
   * THE PRIVATE SALON: an owner signed in, the club's reserved models of its tier (none: nothing said); signed out, or an
   * account that holds no piece (403), the teaser; nothing while the session or the club cannot be read.
   */
  private async salon(signedIn: boolean | null): Promise<Salon> {
    if (signedIn === null) return { kind: 'none' };
    if (!signedIn) return { kind: 'teaser', signedIn: false };
    let cards: LookbookCard[];
    try {
      cards = await this.deps.api.clubLookbook();
    } catch (e) {
      this.deps.session.noteError(e);
      if (e instanceof ApiError && !e.isNetwork && (e.status === 403 || e.status === 401)) return { kind: 'teaser', signedIn: e.status === 403 };
      return { kind: 'none' };
    }
    const groups = lookbookGroups(cards);
    return groups.length > 0 ? { kind: 'open', groups } : { kind: 'none' };
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(LOOKBOOK.loading, { extraClass: 'lookbook__waiting' }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(failedState({ sentence: LOOKBOOK.loadFailed, reason: l.message, retry: LOOKBOOK.retry, onRetry: () => void this.fetch(), retryClass: 'lookbook__retry', extraClass: 'n-px n-lookbook__failed' }));
      if (hadFocus) this.body.querySelector<HTMLElement>('.lookbook__retry')?.focus();
      return;
    }
    const sections: HTMLElement[] = l.groups.map((g, i) => this.group(g, `lookbook-group-${i}`, l.pieces, { first: i === 0 }));
    if (l.groups.length === 0) sections.push(h('div', { class: 'n-px n-lookbook__empty-line' }, quietLine(LOOKBOOK.empty, 'lookbook__empty')));
    if (l.salon.kind === 'open') sections.push(this.salonSection(l.salon.groups, l.pieces));
    else if (l.salon.kind === 'teaser') sections.push(this.teaser(l.salon.signedIn));
    this.body.replaceChildren(...sections);
  }

  /** A collection: its heading (none for the models without one), then each of its models. */
  private group(g: CollectionGroup, id: string, pieces: readonly OwnedPiece[], opts: { first: boolean; salon?: boolean }): HTMLElement {
    const heading = g.collection ? h(opts.salon ? 'h3' : 'h2', { class: 'n-px n-g n-t3 lookbook__collection', id }, ...withNumerals(g.collection)) : null;
    return h(
      'section',
      {
        class: ['lookbook__group', opts.first ? (opts.salon ? 'n-lookbook__group--salon-first' : 'n-lookbook__group--first') : 'n-sec', heading ? 'n-lookbook__group--headed' : null],
        // A collection is a region named by its heading; the models without one sit under the page's (or the salon's) title.
        attrs: heading ? { 'aria-labelledby': id } : undefined,
      },
      heading,
      ...g.cards.map((c, i) => this.card(c, `${id}-${c.slug}`, pieces, { following: i > 0, salon: opts.salon === true })),
    );
  }

  /**
   * A model, full width: its photograph (its dot's), faded, its words lifted onto its foot; its dots switch the
   * photograph, the price and SEE THE MODEL; You own N for an account that owns pieces of it or its variants.
   */
  private card(c: CardModel, id: string, pieces: readonly OwnedPiece[], opts: { following: boolean; salon: boolean }): HTMLElement {
    const selected = c.dots.some((d) => d.slug === this.selected.get(c.slug)) ? this.selected.get(c.slug)! : c.slug;
    const face = cardFace(c, selected);
    const photo = face.image ? hideWhenBroken(fadedPhoto(face.image.src, face.image.alt, { extraClass: 'n-lookbook__photo lookbook-card__frame' })) : null;
    const see = textLink(LOOKBOOK.seeModel, { href: face.href, onOpen: () => this.deps.onSheet(face.slug), extraClass: 'lookbook-card__link' });
    // SEE THE MODEL, of which model: its name and type, for a screen reader moving from link to link.
    see.setAttribute('aria-describedby', `${id}-name`);
    const price = face.price ? h('p', { class: 'n-num n-lookbook__price lookbook-card__price', text: face.price }) : null;
    const owned = ownedLine(c.slug, c.dots, pieces);
    const article = h(
      'article',
      { class: ['lookbook-card', 'n-lookbook__model', opts.following ? 'n-sec' : null, photo ? null : 'n-lookbook__model--bare'], attrs: { 'aria-labelledby': `${id}-name` } },
      photo,
      lift(
        [
          h('h3', { class: 'n-g n-t2 lookbook-card__name', id: `${id}-name` }, ...withNumerals(face.name)),
          h('p', { class: 'n-g n-lb n-lookbook__type lookbook-card__type' }, ...withNumerals(face.type)),
          c.dots.length > 0
            ? variantDots(
                c.dots.map((d) => ({ id: d.slug, label: d.label, swatch: d.swatch })),
                {
                  selected,
                  label: LOOKBOOK.variants,
                  onSelect: (slug) => {
                    this.selected.set(c.slug, slug);
                    const next = this.card(c, id, pieces, opts);
                    quietly(this.body, () => article.replaceWith(next));
                    next.querySelector<HTMLElement>('.n-vsel [aria-pressed="true"]')?.focus();
                  },
                },
              )
            : null,
          owned ? h('p', { class: 'n-state n-lookbook__owned' }, icon('check', { small: true }), owned) : null,
          price,
          h('p', { class: opts.salon ? 'n-lookbook__see n-lookbook__see--salon' : 'n-lookbook__see' }, see),
        ],
        { center: true, extraClass: photo ? undefined : 'n-lookbook__bare' },
      ),
    );
    article.querySelector('.n-vsel')?.classList.add('n-lookbook__dots');
    return article;
  }

  /** THE PRIVATE SALON for an owner (P-X08): its title, its sentence, then the models of its tier, priced. */
  private salonSection(groups: readonly CollectionGroup[], pieces: readonly OwnedPiece[]): HTMLElement {
    return h(
      'section',
      { class: 'n-sec lookbook__reserved n-lookbook__salon', attrs: { 'aria-labelledby': 'lookbook-reserved' } },
      h(
        'div',
        { class: 'n-px' },
        h('h2', { class: 'n-g n-t1 n-lookbook__salon-title', id: 'lookbook-reserved', text: LOOKBOOK.reserved }),
        h('p', { class: 'n-tx n-lookbook__salon-lead lookbook__reserved-lead', text: LOOKBOOK.reservedLead }),
      ),
      ...groups.map((g, i) => this.group(g, `lookbook-reserved-${i}`, pieces, { first: i === 0, salon: true })),
    );
  }

  /**
   * THE PRIVATE SALON for a visitor (addition 7): what it is and what opens it, SIGN IN (signed out) and SCAN ORBES CODE;
   * no model is shown (terms, article 12).
   */
  private teaser(signedIn: boolean): HTMLElement {
    const links: (Node | string)[] = [];
    if (!signedIn) links.push(textLink(LOOKBOOK.signIn, { href: PIECES_PATH, onOpen: () => this.deps.onSignIn(), extraClass: 'n-lookbook__sign-in' }), '     ');
    links.push(textLink(LOOKBOOK.scan, { onOpen: () => this.deps.onScan(), extraClass: 'n-lookbook__scan' }));
    return h(
      'section',
      { class: 'n-px n-sec n-lookbook__teaser', attrs: { 'aria-labelledby': 'lookbook-teaser' } },
      plateCard(
        [
          h('h2', { class: 'n-g n-t2', id: 'lookbook-teaser', text: LOOKBOOK.reserved }),
          h('p', { class: 'n-tx n-lookbook__teaser-text', text: LOOKBOOK.teaser }),
          h('p', { class: 'n-lookbook__teaser-links' }, ...links),
        ],
        { left: true, extraClass: 'n-lookbook__teaser-card' },
      ),
    );
  }
}

// ── A model's sheet (C6, C33) ──────────────────────────────────────────────

class SheetPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'n-model__body sheet__body', attrs: { 'aria-live': 'polite' } });
  private load: SheetLoad = { kind: 'loading' };
  private disposed = false;
  private signedIn: boolean | null = null;
  private readonly unsubscribe: () => void;
  /** The account's pieces (You own N) and the model's next release, read with the sheet. */
  private pieces: OwnedPiece[] = [];
  private releases: { live: LiveCard[]; drops: DropCard[] } = { live: [], drops: [] };
  /** P-X08: REQUEST THIS PIECE under way, its refusal, the note typed (kept across a render), the contact. */
  private busy = false;
  private requestError: string | null = null;
  private readonly note = h('textarea', {
    class: 'n-model__note sheet__note',
    attrs: { id: 'sheet-note', name: 'note', rows: 3, maxlength: SALON_NOTE_MAX, 'aria-describedby': 'sheet-note-hint' },
  });
  private contacts: ClientServices = {};
  private focusPending: boolean;
  /** The address the sheet reads: the one it was opened with, then the dot chosen (the address follows it). */
  private slug: string | null;

  constructor(private readonly deps: SheetDeps) {
    this.focusPending = deps.focus === true;
    this.slug = deps.slug;
    this.root = viewRoot('sheet', 'sheet-title');
    this.root.classList.add('n-model');
    this.root.append(appAnchor(LOOKBOOK_PATH, ['n-g', 'n-crumb', 'n-model__crumb'], () => deps.onCollection(), icon('back', { small: true }), LOOKBOOK.link), this.body);
    this.unsubscribe = deps.session.subscribe((s) => {
      if (s.status !== 'unknown' && this.signedIn !== null && (s.status === 'signed-in') !== this.signedIn) void this.fetch();
    });
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  /**
   * Signed out, the public sheet. Signed in, the club's first: it serves a public model too, with the variants of the
   * salon the account's tier reaches among its dots, and their requests; an account that holds no piece (401, 403) reads
   * the public sheet. A 404 says the model is not in the collection for this reader.
   */
  private async fetch(): Promise<void> {
    this.load = { kind: 'loading' };
    this.render();
    const slug = this.slug;
    const signedIn = await signedInNow(this.deps.session);
    const extras = Promise.all([
      ownPieces(this.deps.api, this.deps.session, signedIn === true),
      this.deps.api.liveReleases().catch((): LiveCard[] => []),
      this.deps.api.drops().catch((): DropCard[] => []),
    ]);
    let load: SheetLoad | null = null;
    if (slug !== null && signedIn === true) {
      const club = await this.fromClub(slug, { owner: true });
      if (this.disposed) return;
      // Not an owner: the public sheet, as a visitor reads it.
      if (club !== 'not-owner') load = club;
    }
    if (load === null) {
      try {
        load = slug === null ? { kind: 'missing' } : { kind: 'ready', sheet: sheetModel(await this.deps.api.lookbookSheet(slug)) };
      } catch (e) {
        if (this.disposed) return;
        load = e instanceof ApiError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
      }
    }
    const [pieces, live, drops] = await extras;
    if (this.disposed) return;
    this.signedIn = signedIn;
    this.pieces = pieces;
    this.releases = { live, drops };
    this.load = load;
    this.render();
  }

  /**
   * The club's sheet (a PUBLIC model or one of the salon, with the variants of the salon the account's tier reaches and
   * its requests). With `owner`, an account that holds no piece (403) or signed out meanwhile (401) answers
   * 'not-owner': the public sheet is read instead.
   */
  private async fromClub(slug: string, opts: { owner?: boolean } = {}): Promise<SheetLoad | 'not-owner'> {
    try {
      const s = await this.deps.session.ensure();
      if (s.status !== 'signed-in') return opts.owner ? 'not-owner' : { kind: 'missing' };
      const sheet = sheetModel(await this.deps.api.clubLookbookSheet(slug));
      // A model of the salon among its dots: the contact shown once it is requested (none configured: {}).
      if (sheet.salon || sheet.dots.some((d) => d.face.salon)) this.contacts = await this.deps.clientServices().catch(() => ({}));
      return { kind: 'ready', sheet };
    } catch (e) {
      this.deps.session.noteError(e);
      if (opts.owner && e instanceof ApiError && !e.isNetwork && (e.status === 401 || e.status === 403)) return 'not-owner';
      // Not an owner (403), not shown (404), signed out meanwhile (401): the model is not in the collection for this reader.
      return e instanceof ApiError && !e.isNetwork && e.status < 500 && e.status !== 429 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
    }
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(LOOKBOOK.loading, { extraClass: 'lookbook__waiting' }));
      return;
    }
    if (l.kind === 'missing') {
      // C40: the sentence alone on the margin, under ‹ THE COLLECTION; it names the page.
      const line = quietLine(LOOKBOOK.notFound, 'sheet__missing');
      line.id = 'sheet-title';
      this.body.replaceChildren(h('div', { class: 'n-px n-model__missing' }, line));
      this.focusTitle();
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(failedState({ sentence: LOOKBOOK.loadFailed, reason: l.message, retry: LOOKBOOK.retry, onRetry: () => void this.fetch(), retryClass: 'sheet__retry', extraClass: 'n-px n-model__failed' }));
      if (hadFocus) this.body.querySelector<HTMLElement>('.sheet__retry')?.focus();
      return;
    }
    const s = l.sheet;
    this.root.dataset.lookbook = s.reserved ? 'reserved' : 'public';
    const [cover, ...gallery] = s.photos;
    const photo = cover ? hideWhenBroken(fadedPhoto(cover.src, cover.alt, { eager: true, extraClass: 'n-model__photo sheet__photos' })) : null;
    const owned = ownedLine(s.slug, s.dots, this.pieces);
    const next = nextRelease(s.dots.length > 0 ? s.dots.map((d) => d.slug) : [s.slug], this.releases.live, this.releases.drops, Date.now());
    const sections: (HTMLElement | null)[] = [
      photo,
      lift(
        [
          h('p', { class: 'n-g n-lb sheet__collection' }, ...withNumerals(s.collection ?? s.category)),
          h('h1', { class: 'n-g n-t1 n-model__title sheet__title', id: 'sheet-title' }, ...withNumerals(s.name)),
          h('p', { class: 'n-g n-lb n-model__line sheet__line' }, ...withNumerals(sheetLine(s))),
          s.sizes ? h('p', { class: 'n-g n-lb n-ivc n-num n-model__sizes' }, ...withNumerals(s.sizes)) : null,
          s.dots.length > 0 ? this.dots(s) : null,
          owned ? h('p', { class: 'n-state n-model__owned' }, icon('check', { small: true }), owned) : null,
        ],
        { center: true, extraClass: photo ? 'n-model__words' : 'n-model__words n-model__bare' },
      ),
      next ? this.nextRow(next) : null,
      s.salon ? this.salonSection(s) : null,
    ];
    const story = storyBlock(s.story, { className: 'n-model__story sheet__story', paragraphClass: 'n-lead n-ivc sheet__paragraph' });
    if (story) sections.push(h('section', { class: 'n-px n-sec sheet__section', attrs: { 'aria-labelledby': 'sheet-story' } }, h('h2', { class: 'n-g n-t3 n-model__heading', id: 'sheet-story', text: LOOKBOOK.story }), story));
    if (gallery.length > 0) {
      sections.push(
        h(
          'section',
          { class: 'n-sec n-model__gallery', attrs: { 'aria-label': LOOKBOOK.photosLabel(s.name) } },
          ...gallery.map((p) => hideWhenBroken(fadedPhoto(p.src, p.alt, { fade: false, extraClass: 'n-model__gallery-photo sheet-photo' }))),
        ),
      );
    }
    if (s.specs.length > 0) {
      sections.push(
        h(
          'section',
          { class: 'n-px n-sec sheet__section', attrs: { 'aria-labelledby': 'sheet-specs' } },
          h('h2', { class: 'n-g n-t3 n-model__heading', id: 'sheet-specs', text: LOOKBOOK.specs }),
          definitionList(s.specs, { kind: 'kv', extraClass: 'n-model__facts' }),
        ),
      );
    }
    sections.push(
      h(
        'section',
        { class: 'n-px n-sec sheet__section', attrs: { 'aria-labelledby': 'sheet-care' } },
        h('h2', { class: 'n-g n-t3 n-model__heading', id: 'sheet-care', text: LOOKBOOK.care }),
        h('p', { class: 'n-tx n-model__care sheet__care', text: s.care }),
      ),
    );
    this.body.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
    if (hadFocus && !this.body.contains(document.activeElement)) this.body.querySelector<HTMLElement>('#sheet-salon')?.focus({ preventScroll: true });
    this.focusTitle();
  }

  /** Opened as a screen change, once read: the focus, left on <body> while it read, comes to the page's title. */
  private focusTitle(): void {
    if (!this.focusPending) return;
    this.focusPending = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !this.root.contains(active)) return;
    const title = this.body.querySelector<HTMLElement>('#sheet-title');
    if (!title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }

  /** The dots: each switches the sheet to that variant, and the address with it. */
  private dots(s: SheetModel): HTMLElement {
    const el = variantDots(
      s.dots.map((d) => ({ id: d.slug, label: d.label, swatch: d.swatch })),
      {
        selected: s.slug,
        label: LOOKBOOK.variant,
        onSelect: (slug) => {
          if (this.load.kind !== 'ready' || slug === this.load.sheet.slug) return;
          this.requestError = null;
          this.load = { kind: 'ready', sheet: selectDot(this.load.sheet, slug) };
          // A sign-in or sign-out meanwhile reads the sheet again: of the dot chosen, the address's.
          this.slug = slug;
          this.deps.onVariant(slug);
          quietly(this.body, () => this.render());
          this.body.querySelector<HTMLElement>('.n-model__dots [aria-pressed="true"]')?.focus();
        },
      },
    );
    el.classList.add('n-model__dots');
    return el;
  }

  /** The model's next release (C6): a plate row, the live dot, its kind, its variant and its day and hour; its page. */
  private nextRow(n: NextReleaseModel): HTMLElement {
    return appAnchor(
      n.href,
      ['n-nx', 'n-model__next'],
      () => this.deps.onRelease(n.id),
      h('i', { class: 'n-live', attrs: { 'aria-hidden': 'true' } }),
      h(
        'div',
        { class: 'n-nx__grow' },
        h('p', { class: 'n-g n-lb' }, n.kind),
        // Only the date and its hour are kept together (a date never parts from its hour): the words before them wrap.
        h(
          'p',
          { class: 'n-g n-t3 n-ivc n-num n-model__next-when' },
          ...(n.variant ? [n.variant, ' '] : []),
          ...(n.when.lead ? [n.when.lead, ' '] : []),
          h('span', { class: 'n-nw' }, ...withNumerals(n.when.at)),
        ),
      ),
      icon('chev', { small: true }),
    );
  }

  /**
   * P-X08, THE PRIVATE SALON: the price and the tier it is offered from; its sentence, a note and REQUEST THIS PIECE, or,
   * once requested, REQUESTED: ORBES Client Services will contact you, and their contact.
   */
  private salonSection(s: SheetModel): HTMLElement {
    const salon = s.salon!;
    const heading = h('h2', { class: 'n-g n-t3 n-model__heading', id: 'sheet-salon', text: LOOKBOOK.reserved });
    heading.tabIndex = -1;
    const facts: [string, string][] = [];
    if (salon.price) facts.push([LOOKBOOK.salon.price, salon.price]);
    facts.push([LOOKBOOK.salon.tier, salon.tier]);
    const out: (HTMLElement | null)[] = [heading, definitionList(facts, { kind: 'kv', extraClass: 'n-model__facts sheet__salon-rows' })];
    if (salon.request) {
      const contact = salonContactModel(this.contacts, s.name, salon.request.id);
      out.push(
        h(
          'div',
          { class: 'n-model__requested sheet__requested', attrs: { role: 'status' } },
          h('p', { class: 'n-g n-t3 n-ivc n-model__requested-label', text: LOOKBOOK.salon.requestedLabel }),
          h('p', { class: 'n-tx n-model__requested-text sheet__requested-text', text: LOOKBOOK.salon.requested }),
        ),
        contact ? contactLines(contact, CONTACT) : null,
      );
    } else {
      out.push(
        h('p', { class: 'n-tx n-model__salon-lead', text: LOOKBOOK.salon.lead }),
        h(
          'div',
          { class: 'n-fld-group n-model__note-field' },
          h('label', { class: 'n-fld', attrs: { for: 'sheet-note' } }, h('span', { class: 'n-g n-lab', text: LOOKBOOK.salon.note })),
          this.note,
          h('p', { class: 'n-sm n-fld__hint', id: 'sheet-note-hint', text: LOOKBOOK.salon.noteHint }),
        ),
        this.requestError ? h('p', { class: 'n-err form__error', attrs: { role: 'alert' }, text: `${LOOKBOOK.salon.requestFailed} ${this.requestError}` }) : null,
        button(LOOKBOOK.salon.request, {
          onClick: () => void this.requestPiece(),
          extraClass: 'n-model__request sheet__request',
          attrs: { disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' },
        }),
      );
    }
    return h('section', { class: 'n-px n-sec n-model__salon sheet__section sheet__salon', attrs: { 'aria-labelledby': 'sheet-salon' } }, ...out.filter((x): x is HTMLElement => x !== null));
  }

  /** REQUEST THIS PIECE: the request recorded, then the sheet says ORBES Client Services will contact you. */
  private async requestPiece(): Promise<void> {
    if (this.busy || this.load.kind !== 'ready' || !this.load.sheet.salon) return;
    const sheet = this.load.sheet;
    this.busy = true;
    this.requestError = null;
    this.render();
    try {
      const note = this.note.value.trim();
      const request = await this.deps.api.requestPiece(sheet.slug, note.length > 0 ? note : null);
      if (this.disposed) return;
      this.note.value = '';
      this.load = { kind: 'ready', sheet: withRequest(this.load.kind === 'ready' ? this.load.sheet : sheet, sheet.slug, request.id) };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && e.code === 'SHOP_REQUEST_OPEN') {
        // Already requested (from another tab or device, or the sheet was stale): the sheet read again says REQUESTED,
        // with the contact of ORBES Client Services, rather than a failure.
        const again = await this.fromClub(sheet.slug);
        this.load = again === 'not-owner' ? { kind: 'missing' } : again;
      } else {
        this.requestError = messageOf(e);
      }
    } finally {
      this.busy = false;
    }
    if (this.disposed) return;
    this.render();
    this.root.querySelector<HTMLElement>('#sheet-salon')?.focus({ preventScroll: true });
  }
}
