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
 *   │ THE PRIVATE SALON  …      │            CODE, never a model (terms, article 12); an owner whose tier reaches no
 *   └───────────────────────────┘            model of it: the same plate, locked, with the tier that opens it and its
 *                                            pieces (It opens at PLATINE, from 5 pieces…) and SCAN ORBES CODE
 *
 * The sheet: ‹ THE COLLECTION; the photograph whole, faded; its collection, name, line (type, THE PRIVATE SALON,
 * DISCONTINUED · <year>), SIZES 16 · 17 · 18 (addition 8), the dots (each switches the sheet: its photographs, story,
 * facts, care, the salon's price and request; the address follows, so a variant's own address opens it selected), You
 * own N, then the heart and WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.1: the dot shown kept in YOUR WISHLIST, pressed
 * once it is; signed out, a tap says the wishlist is kept in the account, with SIGN IN; its status line under it after a
 * tap); the model's next release as a plate row (its day and hour, no countdown); for a model of the salon its price,
 * the tier it is offered from, its sentence, for a model of two sizes or more YOUR SIZE (its sizes and NOT SURE YET, the
 * one YOUR SIZES suggests preselected with SIZE 52 · FROM YOUR SIZES, else NOT SURE YET; plan NEXT-NINE, AC-01), a note
 * and REQUEST THIS PIECE (the sheet's one primary action), or once requested REQUESTED (and SIZE 52 when one was asked)
 * with WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01); THE STORY, the gallery full width, SPECIFICATIONS, CARE;
 * then THE RELEASES OF THIS MODEL (plan NEXT-NINE, CO-01), once the model has a past release: each one of the model and
 * its variants whatever the dot, the newest first, its date and its kind and variant (LIVE RELEASE · IN STEEL), a row to
 * its page, the six newest then SHOW ALL N RELEASES; and, last, PAIRS WELL WITH (plan NEXT-NINE, BP-34), one row of
 * cards that scrolls sideways, each another model's photograph, name and type, opening its sheet in this history entry.
 *
 * The grid's card (modelCard) is YOUR WISHLIST's too (plan CUSTOMER INTELLIGENCE §3.2 W.10.2, views/wishlist.ts).
 *
 * The grid reads GET /api/v1/lookbook (the same for everyone) and, for a signed-in account, the club's reserved models
 * (a 403 for an account that holds no piece: the teaser; none of its tier: what opens the salon, `opensAt`) and its
 * pieces (You own N). A sheet reads, signed in, the
 * club's (a public model with the variants of the salon its tier reaches, or a model of the salon; 404 below the model's
 * tier), the public sheet for an account that holds no piece (403) or signed out; and THE RELEASES' lists for its next
 * release. Both read again when the account signs in or out. REQUEST THIS PIECE is a same-origin
 * JSON call through ApiClient (the session cookie, the CSRF token); server messages are shown as they come. CSP-safe:
 * h() only, NOCTURNE's pieces (views/nocturne.ts), their places by class (verify/styles.css, THE COLLECTION).
 */
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { LIVE, LOOKBOOK, WISHLIST } from '../copy.js';
import { modelContext } from '../messages-model.js';
import {
  cardFace,
  lookbookGroups,
  lookbookSheetPath,
  ownedLine,
  RELEASES_SHOWN,
  SALON_NOTE_MAX,
  salonPicker,
  salonSizePick,
  selectDot,
  sheetLine,
  sheetModel,
  withRequest,
  type CardModel,
  type CollectionGroup,
  type LookbookPhoto,
  type PairCard,
  type SheetModel,
} from '../lookbook-model.js';
import { nextRelease, type NextReleaseModel } from '../next-release-model.js';
import type { SessionStore } from '../session.js';
import type { ClubLookbook, DropCard, LiveCard, OwnedPiece, SalonOpening } from '../types.js';
import { heartState, wishedSlugs } from '../wishlist-model.js';
import { LOOKBOOK_PATH, PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { accLink, appAnchor, button, definitionList, failedState, fadedPhoto, icon, lift, loadingState, plateCard, quietLine, sizeButtons, textLink, variantDots } from './nocturne.js';
import { writeButton } from './write.js';

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
  api: Pick<ApiClient, 'lookbookSheet' | 'clubLookbookSheet' | 'requestPiece' | 'products' | 'liveReleases' | 'drops' | 'wishlist' | 'wish' | 'unwish'>;
  session: Session;
  /** The heart's SIGN IN, signed out (plan CUSTOMER INTELLIGENCE §3.2 W.10.1): MY PIECES' sign-in, as the header's SIGN IN. */
  onSignIn(): void;
  /** The address of the sheet; null when the path names none (the page says the model is not in the collection). */
  slug: string | null;
  /** ‹ THE COLLECTION: back to the grid. */
  onCollection(): void;
  /** A dot chosen: the sheet's address becomes that variant's (no new history entry). */
  onVariant(slug: string): void;
  /** The model's next release, and a row of THE RELEASES OF THIS MODEL (CO-01): its page. */
  onRelease(id: string): void;
  /** A card of PAIRS WELL WITH (BP-34): that model's sheet, in this sheet's history entry. */
  onSheet?(slug: string): void;
  /** This phone's time zone: THE RELEASES OF THIS MODEL dates each release on its calendar (CO-01); UTC by default. */
  localZone?: string;
  /** Opened as a screen change: once read, focus comes to its title (the model's name), as it came to the sheet's before. */
  focus?: boolean;
}

/**
 * THE PRIVATE SALON on the grid: its models (an owner), locked below the owner's tier with what opens it, the teaser (a
 * visitor), or nothing (unknown, or no model offered above the owner's tier).
 */
type Salon = { kind: 'open'; groups: CollectionGroup[] } | { kind: 'locked'; opensAt: SalonOpening } | { kind: 'teaser'; signedIn: boolean } | { kind: 'none' };
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

/** A card's name and its small ›, the › kept on the line of the name's last word (BP-34). */
function nameWithChevron(name: string): (Node | string)[] {
  const at = name.lastIndexOf(' ');
  const last = h('span', { class: 'n-nw' }, ...withNumerals(name.slice(at + 1)), '\u00a0', icon('chev', { small: true }));
  return at < 0 ? [last] : [...withNumerals(name.slice(0, at + 1)), last];
}

/**
 * A model as THE COLLECTION's card shows it, full width (shared with YOUR WISHLIST, plan CUSTOMER INTELLIGENCE §3.2
 * W.10.2): its photograph whole and faded (lazy unless `eager`; none: its words open where it would be), then its words
 * lifted onto its foot, centred. Named by its `${id}-name` heading.
 */
export function modelCard(opts: {
  id: string;
  image: LookbookPhoto | null;
  eager?: boolean;
  following: boolean;
  words: (Node | null)[];
  extraClass?: string;
  data?: Record<string, string>;
}): HTMLElement {
  const photo = opts.image ? hideWhenBroken(fadedPhoto(opts.image.src, opts.image.alt, { eager: opts.eager, extraClass: 'n-lookbook__photo lookbook-card__frame' })) : null;
  return h(
    'article',
    {
      class: ['lookbook-card', 'n-lookbook__model', opts.following ? 'n-sec' : null, photo ? null : 'n-lookbook__model--bare', opts.extraClass],
      attrs: { 'aria-labelledby': `${opts.id}-name` },
      data: opts.data,
    },
    photo,
    lift(opts.words, { center: true, extraClass: photo ? undefined : 'n-lookbook__bare' }),
  );
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
  /** The status the latest read was made with (null until known), and its generation: an older read never lands. */
  private readingAs: boolean | null = null;
  private generation = 0;
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
      // Compared with the status the read under way was made with: a sign-out during the first read starts a fresh one,
      // which supersedes it (its generation).
      const known = this.readingAs ?? this.signedIn;
      const now = s.status === 'signed-in';
      if (s.status === 'unknown' || known === null || now === known) return;
      this.readingAs = now;
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
    try {
      const signedIn = await signedInNow(this.deps.session);
      if (stale()) return;
      this.readingAs = signedIn;
      const [cards, salon, pieces] = await Promise.all([this.deps.api.lookbook(), this.salon(signedIn), ownPieces(this.deps.api, this.deps.session, signedIn === true)]);
      if (stale()) return;
      this.signedIn = signedIn;
      this.load = { kind: 'ready', groups: lookbookGroups(cards), salon, pieces };
    } catch (e) {
      if (stale()) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /**
   * THE PRIVATE SALON: an owner signed in, the club's reserved models of its tier; none of its tier, locked with the tier
   * that opens it (none above it either: nothing said); signed out, or an account that holds no piece (403), the teaser;
   * nothing while the session or the club cannot be read.
   */
  private async salon(signedIn: boolean | null): Promise<Salon> {
    if (signedIn === null) return { kind: 'none' };
    if (!signedIn) return { kind: 'teaser', signedIn: false };
    let club: ClubLookbook;
    try {
      club = await this.deps.api.clubLookbook();
    } catch (e) {
      this.deps.session.noteError(e);
      if (e instanceof ApiError && !e.isNetwork && (e.status === 403 || e.status === 401)) return { kind: 'teaser', signedIn: e.status === 403 };
      return { kind: 'none' };
    }
    const groups = lookbookGroups(club.models);
    if (groups.length > 0) return { kind: 'open', groups };
    return club.opensAt ? { kind: 'locked', opensAt: club.opensAt } : { kind: 'none' };
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
    else if (l.salon.kind === 'teaser') sections.push(this.teaser({ signedIn: l.salon.signedIn, text: LOOKBOOK.teaser }));
    else if (l.salon.kind === 'locked') sections.push(this.teaser({ signedIn: true, text: LOOKBOOK.locked(l.salon.opensAt.name, l.salon.opensAt.pieces) }));
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
    const see = textLink(LOOKBOOK.seeModel, { href: face.href, onOpen: () => this.deps.onSheet(face.slug), extraClass: 'lookbook-card__link' });
    // SEE THE MODEL, of which model: its name and type, for a screen reader moving from link to link.
    see.setAttribute('aria-describedby', `${id}-name`);
    const price = face.price ? h('p', { class: 'n-num n-lookbook__price lookbook-card__price', text: face.price }) : null;
    const owned = ownedLine(c.slug, c.dots, pieces);
    const article = modelCard({
      id,
      image: face.image,
      following: opts.following,
      words: [
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
    });
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
   * for an owner below its tier (NOCTURNE, screen 5), the same plate with the tier that opens it and SCAN ORBES CODE (a
   * piece registered raises the tier). No model is shown (terms, article 12).
   */
  private teaser(opts: { signedIn: boolean; text: string }): HTMLElement {
    const { signedIn } = opts;
    const links: (Node | string)[] = [];
    if (!signedIn) links.push(textLink(LOOKBOOK.signIn, { href: PIECES_PATH, onOpen: () => this.deps.onSignIn(), extraClass: 'n-lookbook__sign-in' }), '     ');
    links.push(textLink(LOOKBOOK.scan, { onOpen: () => this.deps.onScan(), extraClass: 'n-lookbook__scan' }));
    return h(
      'section',
      { class: 'n-px n-sec n-lookbook__teaser', attrs: { 'aria-labelledby': 'lookbook-teaser' } },
      plateCard(
        [
          h('h2', { class: 'n-g n-t2', id: 'lookbook-teaser', text: LOOKBOOK.reserved }),
          h('p', { class: 'n-tx n-lookbook__teaser-text', text: opts.text }),
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
  /** The status the latest read was made with (null until known), and its generation: an older read never lands. */
  private readingAs: boolean | null = null;
  private generation = 0;
  private readonly unsubscribe: () => void;
  /** The account's pieces (You own N) and the model's next release, read with the sheet. */
  private pieces: OwnedPiece[] = [];
  private releases: { live: LiveCard[]; drops: DropCard[] } = { live: [], drops: [] };
  /** P-X08: REQUEST THIS PIECE under way, its refusal, the note typed (kept across a render). */
  private busy = false;
  private requestError: string | null = null;
  /**
   * AC-01: the size the collector tapped in YOUR SIZE on the model of the dot `slug` (null: NOT SURE YET), kept across a
   * render; none tapped yet: the size YOUR SIZES suggests is preselected, to confirm.
   */
  private sizeTapped: { slug: string; size: string | null } | null = null;
  private readonly note = h('textarea', {
    class: 'n-model__note sheet__note',
    attrs: { id: 'sheet-note', name: 'note', rows: 3, maxlength: SALON_NOTE_MAX, 'aria-describedby': 'sheet-note-hint' },
  });
  private focusPending: boolean;
  /** The address the sheet reads: the one it was opened with, then the dot chosen (the address follows it). */
  private slug: string | null;
  /** CO-01: SHOW ALL N RELEASES pressed (every row of THE RELEASES OF THIS MODEL shown), kept across a render. */
  private releasesUnfolded = false;
  /**
   * The heart (plan CUSTOMER INTELLIGENCE §3.2 W.10.1): the addresses of the account's wished models it may open now,
   * read with the sheet; null signed out, or when the wishlist could not be read (the heart is then not shown).
   */
  private wished: Set<string> | null = null;
  /** A wish or its removal under way: the heart disabled and busy meanwhile. */
  private heartBusy = false;
  /** The heart's status line after a tap, until the next tap, a dot chosen or the sheet left. */
  private heartLine: { text: string; signIn?: boolean } | null = null;

  constructor(private readonly deps: SheetDeps) {
    this.focusPending = deps.focus === true;
    this.slug = deps.slug;
    this.root = viewRoot('sheet', 'sheet-title');
    this.root.classList.add('n-model');
    this.root.append(appAnchor(LOOKBOOK_PATH, ['n-g', 'n-crumb', 'n-model__crumb'], () => deps.onCollection(), icon('back', { small: true }), LOOKBOOK.link), this.body);
    this.unsubscribe = deps.session.subscribe((s) => {
      // Compared with the status the read under way was made with: a sign-out during the first read starts a fresh one,
      // which supersedes it (its generation).
      const known = this.readingAs ?? this.signedIn;
      const now = s.status === 'signed-in';
      if (s.status === 'unknown' || known === null || now === known) return;
      this.readingAs = now;
      void this.fetch();
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
    const gen = ++this.generation;
    const stale = (): boolean => this.disposed || gen !== this.generation;
    this.load = { kind: 'loading' };
    this.render();
    const slug = this.slug;
    const signedIn = await signedInNow(this.deps.session);
    if (stale()) return;
    this.readingAs = signedIn;
    const extras = Promise.all([
      ownPieces(this.deps.api, this.deps.session, signedIn === true),
      this.deps.api.liveReleases().catch((): LiveCard[] => []),
      this.deps.api.drops().catch((): DropCard[] => []),
      // The heart's state: the account's wishlist, read once with the sheet; unreadable, no heart (never a wrong state).
      signedIn === true
        ? this.deps.api.wishlist().then(wishedSlugs, (e: unknown) => {
            this.deps.session.noteError(e);
            return null;
          })
        : Promise.resolve(null),
    ]);
    let load: SheetLoad | null = null;
    if (slug !== null && signedIn === true) {
      const club = await this.fromClub(slug, { owner: true });
      if (stale()) return;
      // Not an owner: the public sheet, as a visitor reads it.
      if (club !== 'not-owner') load = club;
    }
    if (load === null) {
      try {
        load = slug === null ? { kind: 'missing' } : { kind: 'ready', sheet: sheetModel(await this.deps.api.lookbookSheet(slug), this.deps.localZone) };
      } catch (e) {
        if (stale()) return;
        load = e instanceof ApiError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
      }
    }
    const [pieces, live, drops, wished] = await extras;
    if (stale()) return;
    this.signedIn = signedIn;
    this.pieces = pieces;
    this.wished = wished;
    this.heartLine = null;
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
      const sheet = sheetModel(await this.deps.api.clubLookbookSheet(slug), this.deps.localZone);
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
          this.heart(s.slug),
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
    // CO-01: THE RELEASES OF THIS MODEL, after CARE, only once the model has a past release.
    if (s.releases.length > 0) sections.push(this.releasesSection(s));
    // BP-34: PAIRS WELL WITH, the very last section, only when it has a card.
    if (s.pairs.length > 0) sections.push(this.pairsSection(s.pairs));
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
          // The heart's line goes with the dot it was about; the heart is drawn for the dot now shown (no request).
          this.heartLine = null;
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

  /**
   * The heart (plan CUSTOMER INTELLIGENCE §3.2 W.10.1), last in the words: the line icon and WISHLIST, pressed when the dot
   * shown is wished; signed out, not pressed; not shown when the wishlist could not be read. Its status line under it
   * after a tap. Null when not shown.
   */
  private heart(slug: string): HTMLElement | null {
    const st = heartState(this.signedIn, this.wished, slug);
    if (!st.shown) return null;
    const line = this.heartLine;
    return h(
      'div',
      { class: 'n-model__heart' },
      h(
        'button',
        {
          class: 'n-g n-ivc n-heart',
          attrs: { type: 'button', 'aria-pressed': String(st.pressed), 'aria-busy': this.heartBusy ? 'true' : 'false', disabled: this.heartBusy },
          on: { click: () => void this.toggleWish(slug) },
        },
        icon('heart'),
        WISHLIST.heart,
      ),
      line
        ? h(
            'p',
            { class: 'n-sm n-model__heart-line', attrs: { role: 'status' } },
            line.text,
            ...(line.signIn ? [' ', textLink(WISHLIST.signIn, { href: PIECES_PATH, onOpen: () => this.deps.onSignIn(), extraClass: 'n-model__heart-sign-in' })] : []),
          )
        : null,
    );
  }

  /**
   * The heart drawn again in place (its state, its line); the focus back on it when it had it, or when `focus` (it was
   * tapped, and the focus has gone nowhere else while it was busy).
   */
  private redrawHeart(slug: string, focus = false): void {
    const old = this.body.querySelector<HTMLElement>('.n-model__heart');
    if (!old) return;
    const active = document.activeElement;
    const back = old.contains(active) || (focus && (active === null || active === document.body));
    const next = this.heart(slug);
    if (next) old.replaceWith(next);
    else old.remove();
    if (back) next?.querySelector<HTMLElement>('.n-heart')?.focus({ preventScroll: true });
  }

  /**
   * A tap on the heart: signed out, nothing is sent and the line says the wishlist is kept in the account (SIGN IN);
   * signed in, the dot shown kept or removed (PUT or DELETE), the heart busy meanwhile, then pressed or not with its line;
   * a failure says so with the server's words and nothing flips; a model no longer in the collection (404): the sheet is
   * read again.
   */
  private async toggleWish(slug: string): Promise<void> {
    if (this.heartBusy) return;
    if (this.signedIn !== true || this.wished === null) {
      this.heartLine = { text: WISHLIST.signedOut, signIn: true };
      this.redrawHeart(slug);
      return;
    }
    const wished = this.wished.has(slug);
    // Tapped (or pressed from the keyboard): the focus comes back to it once it is no longer busy.
    const focus = document.activeElement?.closest('.n-model__heart') != null;
    this.heartBusy = true;
    this.heartLine = null;
    this.redrawHeart(slug);
    try {
      if (wished) await this.deps.api.unwish(slug);
      else await this.deps.api.wish(slug);
      if (this.disposed) return;
      if (wished) this.wished?.delete(slug);
      else this.wished?.add(slug);
      this.heartLine = { text: wished ? WISHLIST.removed : WISHLIST.added };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && !e.isNetwork && e.status === 404) {
        // The model left the collection meanwhile: the sheet read again says so.
        this.heartBusy = false;
        void this.fetch();
        return;
      }
      this.heartLine = { text: `${WISHLIST.failed} ${messageOf(e)}` };
    } finally {
      this.heartBusy = false;
    }
    if (this.disposed || this.load.kind !== 'ready') return;
    // Another dot chosen meanwhile: its heart, without the line of the one tapped.
    if (this.load.sheet.slug !== slug) this.heartLine = null;
    this.redrawHeart(this.load.sheet.slug, focus);
  }

  /**
   * CO-01, THE RELEASES OF THIS MODEL: each past release of the model and its variants, the newest first, a row with a
   * hairline that leads on (›) to its page: its opening date (figures in the reading face), then its kind and variant.
   * The six newest; beyond them SHOW ALL N RELEASES unfolds the rest in place, the focus moving to the seventh.
   */
  private releasesSection(s: SheetModel): HTMLElement {
    const shown = this.releasesUnfolded ? s.releases : s.releases.slice(0, RELEASES_SHOWN);
    const rows = shown.map((r) =>
      accLink(h('span', { class: 'n-num' }, ...withNumerals(r.date)), {
        line: r.line,
        lineKind: 'lb',
        href: r.href,
        onOpen: () => this.deps.onRelease(r.id),
        label: r.label,
        extraClass: 'n-model__release',
      }),
    );
    const more =
      shown.length < s.releases.length
        ? h(
            'p',
            { class: 'n-model__releases-more' },
            textLink(LOOKBOOK.releases.more(s.releases.length), {
              onOpen: () => {
                this.releasesUnfolded = true;
                quietly(this.body, () => this.render());
                this.body.querySelectorAll<HTMLElement>('.n-model__release')[RELEASES_SHOWN]?.focus();
              },
              extraClass: 'n-model__releases-all',
            }),
          )
        : null;
    return h(
      'section',
      { class: 'n-px n-sec sheet__section n-model__releases', attrs: { 'aria-labelledby': 'sheet-releases' } },
      h('h2', { class: 'n-g n-t3 n-model__heading', id: 'sheet-releases', text: LOOKBOOK.releases.title }),
      h('div', { class: 'n-model__release-rows' }, ...rows),
      more,
    );
  }

  /**
   * BP-34, PAIRS WELL WITH: the very last section, its heading on the margin, then one row of cards that scrolls sideways
   * (only the row, never the page), each 72 % of the column so the next one peeks (a lone card the column whole): the
   * model's photograph whole and square, lazy, without a fade (a broken one hides, the words stay), its name and a ›,
   * its type. A card opens that model's sheet in this sheet's history entry.
   */
  private pairsSection(pairs: readonly PairCard[]): HTMLElement {
    const cards = pairs.map((p) => {
      const photo = p.image ? hideWhenBroken(fadedPhoto(p.image.src, p.image.alt, { fade: false, extraClass: 'n-model__pair-photo' })) : null;
      // Square, at the card's width: the canvas's height is the column's.
      photo?.style.removeProperty('height');
      const card = appAnchor(
        p.href,
        ['n-model__pair'],
        this.deps.onSheet ? () => this.deps.onSheet!(p.slug) : undefined,
        ...(photo ? [photo] : []),
        h('p', { class: 'n-g n-t3 n-ivc n-model__pair-name' }, ...nameWithChevron(p.title)),
        h('p', { class: 'n-g n-lb n-model__pair-line' }, ...withNumerals(p.line)),
      );
      card.setAttribute('aria-label', p.label);
      return h('li', { class: 'n-model__pair-item' }, card);
    });
    return h(
      'section',
      { class: ['n-sec', 'n-model__pairs', pairs.length === 1 ? 'n-model__pairs--one' : null], attrs: { 'aria-labelledby': 'sheet-pairs' } },
      h('div', { class: 'n-px' }, h('h2', { class: 'n-g n-t3 n-model__heading', id: 'sheet-pairs', text: LOOKBOOK.pairs.title })),
      h('ul', { class: 'n-model__pairs-row', attrs: { role: 'list' } }, ...cards),
    );
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
          ...(n.variant ? [...withNumerals(n.variant), ' '] : []),
          ...(n.when.lead ? [...withNumerals(n.when.lead), ' '] : []),
          h('span', { class: 'n-nw' }, ...withNumerals(n.when.at)),
        ),
      ),
      icon('chev', { small: true }),
    );
  }

  /**
   * P-X08, THE PRIVATE SALON: the price and the tier it is offered from; its sentence, a note and REQUEST THIS PIECE, or,
   * once requested, REQUESTED: ORBES Client Services will contact you, and WRITE TO ORBES CLIENT SERVICES (CS-01).
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
      out.push(
        h(
          'div',
          { class: 'n-model__requested sheet__requested', attrs: { role: 'status' } },
          h('p', { class: 'n-g n-t3 n-ivc n-model__requested-label', text: LOOKBOOK.salon.requestedLabel }),
          // AC-01: the size asked, under its label.
          salon.request.size ? h('p', { class: 'n-g n-lb n-model__requested-size' }, ...withNumerals(LOOKBOOK.salon.requestedSize(salon.request.size))) : null,
          h('p', { class: 'n-tx n-model__requested-text sheet__requested-text', text: LOOKBOOK.salon.requested }),
        ),
        // WRITE TO ORBES CLIENT SERVICES, the model and its request attached (CS-01).
        writeButton(modelContext(salon.request.modelId, s.name, s.variant)),
      );
    } else {
      out.push(
        h('p', { class: 'n-tx n-model__salon-lead', text: LOOKBOOK.salon.lead }),
        this.salonSizes(s),
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

  /**
   * AC-01: the size the request asks for the sheet's model: the one tapped, else YOUR SIZES' suggestion; null for NOT SURE
   * YET, and for a model of one size (no picker). `fromYours` while the suggestion stands untapped.
   */
  private salonSizeOf(s: SheetModel): { size: string | null; fromYours: boolean } {
    return salonSizePick(s.salon, this.sizeTapped?.slug === s.slug ? this.sizeTapped : null);
  }

  /**
   * AC-01, YOUR SIZE: for a model of two sizes or more, its sizes and NOT SURE YET above the note; the size YOUR SIZES
   * suggests preselected with SIZE 52 · FROM YOUR SIZES and the sentence to check it, else NOT SURE YET; then the hint.
   * Nothing is sent before REQUEST THIS PIECE.
   */
  private salonSizes(s: SheetModel): HTMLElement | null {
    const picker = salonPicker(s.salon);
    if (!picker) return null;
    const picked = this.salonSizeOf(s);
    const NOT_SURE = '';
    const group = sizeButtons(
      [...picker.sizes.map((z) => ({ id: z, label: z })), { id: NOT_SURE, label: LOOKBOOK.salon.notSure }],
      {
        selected: picked.size ?? NOT_SURE,
        label: LOOKBOOK.salon.size,
        onSelect: (id) => {
          this.sizeTapped = { slug: s.slug, size: id === NOT_SURE ? null : id };
          quietly(this.body, () => this.render());
          this.body.querySelector<HTMLElement>('.n-model__size-picker [aria-pressed="true"]')?.focus();
        },
      },
    );
    group.classList.add('n-model__size-picker');
    group.setAttribute('aria-labelledby', 'sheet-size');
    group.removeAttribute('aria-label');
    const notSure = group.lastElementChild as HTMLElement | null;
    notSure?.classList.remove('n-num');
    notSure?.classList.add('n-g', 'n-model__not-sure');
    return h(
      'div',
      { class: 'n-model__size-field' },
      h('p', { class: 'n-g n-lb n-model__size-label', id: 'sheet-size', text: LOOKBOOK.salon.size }),
      group,
      picked.fromYours && picked.size
        ? h(
            'div',
            { class: 'n-model__yours' },
            h('p', { class: 'n-g n-lb n-model__yours-size' }, ...withNumerals(LIVE.there.fromYours(picked.size))),
            h('p', { class: 'n-sm n-model__yours-check', text: LIVE.there.checkSize }),
          )
        : null,
      h('p', { class: 'n-sm n-fld__hint n-model__size-hint', text: LOOKBOOK.salon.sizeHint }),
    );
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
      // AC-01: the size picked (YOUR SIZES' suggestion is confirmed by this press), or none.
      const size = this.salonSizeOf(sheet).size;
      const request = await this.deps.api.requestPiece(sheet.slug, note.length > 0 ? note : null, size);
      if (this.disposed) return;
      this.note.value = '';
      this.sizeTapped = null;
      this.load = { kind: 'ready', sheet: withRequest(this.load.kind === 'ready' ? this.load.sheet : sheet, sheet.slug, request.id, request.modelId, request.size ?? size) };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && e.code === 'SHOP_REQUEST_OPEN') {
        // Already requested (from another tab or device, or the sheet was stale): the sheet read again says REQUESTED,
        // with WRITE TO ORBES CLIENT SERVICES, rather than a failure.
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
