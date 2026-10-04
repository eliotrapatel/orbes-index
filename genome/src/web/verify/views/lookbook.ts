/**
 * THE COLLECTION (P-R02): the lookbook of the models, /verify/lookbook, and
 * a model's sheet, /verify/lookbook/<slug>.
 *
 *              ORBES                         small wordmark
 *        T H E   C O L L E C T I O N         the page's title
 *   The models of ORBES, as the maison presents them.
 *   ORBIT                                    a collection (none: no heading)
 *   ┌            ┐  ┌            ┐
 *     [ photo ]       [ photo ]              ivory plates, each a model:
 *     MONOLITHE       ECLIPSE                its photograph (contained),
 *     RING            PENDANT                its name and type,
 *     SEE THE MODEL   SEE THE MODEL          and its one text link
 *   └            ┘  └            ┘
 *   THE PRIVATE SALON                        signed in with a piece only:
 *   …                                        the models of its tier, priced
 *            [ SCAN ORBES CODE ]
 *   PRIVACY · TERMS · LEGAL · HELP
 *
 * A card is no control of its own: its text link is (BRAND §3.8, the
 * pointer is the controls'). The sheet: the collection, the model's name and
 * type (THE PRIVATE SALON when the club opened it, P-X08, DISCONTINUED ·
 * <year> once an ADMIN discontinued it, P-R06), its photographs on an
 * ivory plate (the cover, then the gallery, each contained, never cropped),
 * for a model of the salon its price, the tier it is offered from and REQUEST
 * THIS PIECE (the sheet's one hairline button, with an optional note; once
 * requested, ORBES Client Services will contact you, and their contact),
 * THE STORY (shared/lookbook.ts, the paragraphs the console previews),
 * SPECIFICATIONS, CARE, then THE COLLECTION, back to the grid.
 *
 * The grid reads GET /api/v1/lookbook (the same for everyone) and, for a
 * signed-in account, the club's reserved models (a 403 for an account that
 * holds no piece: no section, nothing said). A sheet reads the public sheet,
 * then, when that answers 404 to a signed-in account, the club's (404 too
 * below the model's tier). Every photograph loads lazily: a grid may hold
 * many. REQUEST THIS PIECE is a same-origin JSON call through ApiClient (the
 * session cookie, the CSRF token); server messages are shown as they come.
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { LOOKBOOK } from '../copy.js';
import { lookbookGroups, SALON_NOTE_MAX, sheetLine, sheetModel, type CardModel, type CollectionGroup, type LookbookPhoto, type SheetModel } from '../lookbook-model.js';
import type { SessionStore } from '../session.js';
import type { ClientServices, LookbookCard } from '../types.js';
import { salonContactModel } from '../view-model.js';
import { contactBlock, legalLinks, lookbookLink, rows, sectionLabel, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';

export interface LookbookView {
  root: HTMLElement;
  dispose(): void;
}

type Session = Pick<SessionStore, 'ensure' | 'noteError'>;

export interface LookbookDeps {
  api: ApiClient;
  session: Session;
  /** SCAN ORBES CODE, the page's hairline button. */
  onScan(): void;
  /** Open a model's sheet in the app. */
  onSheet(slug: string): void;
}

export interface SheetDeps {
  api: ApiClient;
  session: Session;
  /** The address of the sheet; null when the path names none (the page says the model is not in the collection). */
  slug: string | null;
  /** THE COLLECTION: back to the grid. */
  onCollection(): void;
  /** P-X08: the contact of ORBES Client Services, shown once a piece of the salon is requested ({} when none is configured). */
  clientServices(): Promise<ClientServices>;
}

type GridLoad = { kind: 'loading' } | { kind: 'ready'; groups: CollectionGroup[]; reserved: CollectionGroup[] } | { kind: 'failed'; message: string };
type SheetLoad = { kind: 'loading' } | { kind: 'ready'; sheet: SheetModel } | { kind: 'missing' } | { kind: 'failed'; message: string };

export function lookbookView(deps: LookbookDeps): LookbookView {
  const page = new GridPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

export function sheetView(deps: SheetDeps): LookbookView {
  const page = new SheetPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

/** The small wordmark that opens every page of the app but the landing. */
const wordmark = (extraClass: string) => h('span', { class: `wordmark wordmark--small ${extraClass}`, attrs: { 'aria-hidden': 'true' }, text: 'ORBES' });

/** A photograph of the lookbook: contained in its square, never cropped; lazy unless it opens the page. */
function photo(p: LookbookPhoto, opts: { className: string; eager?: boolean }): HTMLImageElement {
  const img = h('img', { class: opts.className, attrs: { src: p.src, alt: p.alt, decoding: 'async', loading: opts.eager ? 'eager' : 'lazy' } });
  // A photograph removed meanwhile takes its frame with it, and the plate when none is left: never a broken image.
  img.addEventListener(
    'error',
    () => {
      img.closest<HTMLElement>('[data-photo]')?.setAttribute('hidden', '');
      const plate = img.closest<HTMLElement>('[data-photos]');
      if (plate && !plate.querySelector('[data-photo]:not([hidden])')) plate.hidden = true;
    },
    { once: true },
  );
  return img;
}

// ── The grid ───────────────────────────────────────────────────────────────

class GridPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'lookbook__body', attrs: { 'aria-live': 'polite' } });
  private load: GridLoad = { kind: 'loading' };
  private disposed = false;

  constructor(private readonly deps: LookbookDeps) {
    this.root = viewRoot('lookbook', 'lookbook-title');
    this.root.append(
      h(
        'header',
        { class: 'lookbook__head' },
        wordmark('lookbook__wordmark'),
        h('h1', { class: 'lookbook__title', id: 'lookbook-title', text: LOOKBOOK.title }),
        h('p', { class: 'prose lookbook__lead', text: LOOKBOOK.lead }),
      ),
      this.body,
      h(
        'footer',
        { class: 'lookbook__foot' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => deps.onScan() }, text: LOOKBOOK.scan }),
        legalLinks({ extraClass: 'lookbook__legal' }),
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
      const [cards, reserved] = await Promise.all([this.deps.api.lookbook(), this.reservedCards()]);
      if (this.disposed) return;
      this.load = { kind: 'ready', groups: lookbookGroups(cards), reserved: lookbookGroups(reserved) };
    } catch (e) {
      if (this.disposed) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /** The club's reserved models for a signed-in owner; nothing for anyone else, and nothing said (a 401, a 403, offline). */
  private async reservedCards(): Promise<LookbookCard[]> {
    try {
      const s = await this.deps.session.ensure();
      if (s.status !== 'signed-in') return [];
      return await this.deps.api.clubLookbook();
    } catch (e) {
      this.deps.session.noteError(e);
      return [];
    }
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    if (l.kind === 'loading') {
      this.body.replaceChildren(h('p', { class: 'lookbook__waiting micro', attrs: { 'aria-busy': 'true' }, text: LOOKBOOK.loading }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${LOOKBOOK.loadFailed} ${l.message}` }),
        h('button', { class: 'textlink lookbook__retry', attrs: { type: 'button' }, on: { click: () => void this.fetch() }, text: LOOKBOOK.retry }),
      );
      if (hadFocus) this.body.querySelector<HTMLElement>('.lookbook__retry')?.focus();
      return;
    }
    const sections: HTMLElement[] = l.groups.map((g, i) => this.group(g, `lookbook-group-${i}`));
    if (l.groups.length === 0) sections.push(h('p', { class: 'prose lookbook__empty', text: LOOKBOOK.empty }));
    if (l.reserved.length > 0) {
      sections.push(
        h(
          'section',
          { class: 'lookbook__reserved', attrs: { 'aria-labelledby': 'lookbook-reserved' } },
          sectionLabel(LOOKBOOK.reserved, 'lookbook-reserved'),
          h('p', { class: 'prose lookbook__reserved-lead', text: LOOKBOOK.reservedLead }),
          ...l.reserved.map((g, i) => this.group(g, `lookbook-reserved-${i}`)),
        ),
      );
    }
    this.body.replaceChildren(...sections);
  }

  private group(g: CollectionGroup, id: string): HTMLElement {
    const heading = g.collection ? h('h2', { class: 'lookbook__collection', id }, ...withNumerals(g.collection)) : null;
    return h(
      'section',
      { class: 'lookbook__group', attrs: heading ? { 'aria-labelledby': id } : { 'aria-label': LOOKBOOK.title } },
      heading,
      h('ul', { class: 'lookbook__grid' }, ...g.cards.map((c) => h('li', { class: 'lookbook__item' }, this.card(c, `${id}-${c.slug}`)))),
    );
  }

  private card(c: CardModel, id: string): HTMLElement {
    const link = lookbookLink(() => this.deps.onSheet(c.slug), { slug: c.slug, extraClass: 'lookbook-card__link' });
    // SEE THE MODEL, of which model: its name and type, for a screen reader moving from link to link.
    link.setAttribute('aria-describedby', `${id}-name`);
    return bracket(
      h(
        'article',
        { class: 'lookbook-card', attrs: { 'aria-labelledby': `${id}-name` } },
        h('div', { class: 'lookbook-card__frame', data: { photo: '' } }, c.image ? photo(c.image, { className: 'lookbook-card__img' }) : null),
        h('h3', { class: 'lookbook-card__name', id: `${id}-name` }, ...withNumerals(c.name)),
        h('p', { class: 'lookbook-card__type' }, ...withNumerals(c.type)),
        c.price ? h('p', { class: 'lookbook-card__price', text: c.price }) : null,
        link,
      ),
    );
  }
}

// ── A model's sheet ────────────────────────────────────────────────────────

class SheetPage {
  readonly root: HTMLElement;
  private readonly title = h('h1', { class: 'sheet__title', id: 'sheet-title', text: LOOKBOOK.title });
  private readonly eyebrow = h('p', { class: 'sheet__collection' });
  private readonly line = h('p', { class: 'sheet__line' });
  private readonly body = h('div', { class: 'sheet__body', attrs: { 'aria-live': 'polite' } });
  private load: SheetLoad = { kind: 'loading' };
  private disposed = false;
  /** P-X08: REQUEST THIS PIECE under way, its refusal, the note typed (kept across a render), the contact. */
  private busy = false;
  private requestError: string | null = null;
  private readonly note = h('textarea', {
    class: 'field__input sheet__note',
    attrs: { id: 'sheet-note', name: 'note', rows: 3, maxlength: SALON_NOTE_MAX, 'aria-describedby': 'sheet-note-hint' },
  });
  private contacts: ClientServices = {};

  constructor(private readonly deps: SheetDeps) {
    this.root = viewRoot('sheet', 'sheet-title');
    this.root.append(
      h('header', { class: 'sheet__head' }, wordmark('sheet__wordmark'), this.eyebrow, this.title, this.line),
      this.body,
      h(
        'footer',
        { class: 'sheet__foot' },
        lookbookLink(() => deps.onCollection(), { extraClass: 'sheet__collection-link' }),
        legalLinks({ extraClass: 'sheet__legal' }),
      ),
    );
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
  }

  /** The public sheet; a 404 to a signed-in account is asked again of the club (a RESERVED model, for an owner). */
  private async fetch(): Promise<void> {
    this.load = { kind: 'loading' };
    this.render();
    const slug = this.deps.slug;
    try {
      if (slug === null) {
        this.load = { kind: 'missing' };
      } else {
        this.load = { kind: 'ready', sheet: sheetModel(await this.deps.api.lookbookSheet(slug)) };
      }
    } catch (e) {
      if (this.disposed) return;
      this.load = e instanceof ApiError && e.status === 404 ? await this.fromClub(slug!) : { kind: 'failed', message: messageOf(e) };
    }
    if (this.disposed) return;
    this.render();
  }

  private async fromClub(slug: string): Promise<SheetLoad> {
    try {
      const s = await this.deps.session.ensure();
      if (s.status !== 'signed-in') return { kind: 'missing' };
      const sheet = sheetModel(await this.deps.api.clubLookbookSheet(slug));
      // A model of the salon: the contact shown once it is requested (none configured: {}).
      if (sheet.salon) this.contacts = await this.deps.clientServices().catch(() => ({}));
      return { kind: 'ready', sheet };
    } catch (e) {
      this.deps.session.noteError(e);
      // Not an owner (403), not shown (404), signed out meanwhile (401): the model is not in the collection for this reader.
      return e instanceof ApiError && !e.isNetwork && e.status < 500 && e.status !== 429 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
    }
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    if (l.kind !== 'ready') {
      this.eyebrow.replaceChildren();
      this.eyebrow.hidden = true;
      this.line.replaceChildren();
      this.line.hidden = true;
      this.title.textContent = LOOKBOOK.title;
    }
    if (l.kind === 'loading') {
      this.body.replaceChildren(h('p', { class: 'lookbook__waiting micro', attrs: { 'aria-busy': 'true' }, text: LOOKBOOK.loading }));
      return;
    }
    if (l.kind === 'missing') {
      this.body.replaceChildren(h('p', { class: 'prose sheet__missing', text: LOOKBOOK.notFound }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${LOOKBOOK.loadFailed} ${l.message}` }),
        h('button', { class: 'textlink sheet__retry', attrs: { type: 'button' }, on: { click: () => void this.fetch() }, text: LOOKBOOK.retry }),
      );
      if (hadFocus) this.body.querySelector<HTMLElement>('.sheet__retry')?.focus();
      return;
    }
    const s = l.sheet;
    this.root.dataset.lookbook = s.reserved ? 'reserved' : 'public';
    this.eyebrow.replaceChildren(...withNumerals(s.collection ?? s.category));
    this.eyebrow.hidden = false;
    this.title.replaceChildren(...withNumerals(s.name));
    this.line.replaceChildren(...withNumerals(sheetLine(s)));
    this.line.hidden = false;

    const sections: (HTMLElement | null)[] = [];
    if (s.photos.length > 0) {
      sections.push(
        h(
          'section',
          { class: 'sheet__photos', attrs: { 'aria-label': LOOKBOOK.photosLabel(s.name) }, data: { photos: '' } },
          bracket(
            h(
              'div',
              { class: ['sheet__plate', s.photos.length > 1 ? 'sheet__plate--gallery' : 'sheet__plate--single'] },
              ...s.photos.map((p, i) => h('figure', { class: 'sheet-photo', data: { photo: '' } }, photo(p, { className: 'sheet-photo__img', eager: i === 0 }))),
            ),
          ),
        ),
      );
    }
    if (s.salon) sections.push(this.salonSection(s));
    const story = storyBlock(s.story, { className: 'sheet__story', paragraphClass: 'prose sheet__paragraph' });
    if (story) sections.push(h('section', { class: 'sheet__section', attrs: { 'aria-labelledby': 'sheet-story' } }, sectionLabel(LOOKBOOK.story, 'sheet-story'), story));
    if (s.specs.length > 0) sections.push(h('section', { class: 'sheet__section', attrs: { 'aria-labelledby': 'sheet-specs' } }, sectionLabel(LOOKBOOK.specs, 'sheet-specs'), rows(s.specs)));
    sections.push(
      h('section', { class: 'sheet__section', attrs: { 'aria-labelledby': 'sheet-care' } }, sectionLabel(LOOKBOOK.care, 'sheet-care'), h('p', { class: 'prose sheet__care', text: s.care })),
    );
    this.body.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
    if (hadFocus && !this.body.contains(document.activeElement)) this.body.querySelector<HTMLElement>('#sheet-salon')?.focus({ preventScroll: true });
  }

  /**
   * P-X08, THE PRIVATE SALON: the price and the tier it is offered from; then REQUEST THIS PIECE with an optional note,
   * or, once requested, ORBES Client Services will contact you, and their contact.
   */
  private salonSection(s: SheetModel): HTMLElement {
    const salon = s.salon!;
    const heading = sectionLabel(LOOKBOOK.reserved, 'sheet-salon');
    heading.tabIndex = -1;
    const facts: [string, string][] = [];
    if (salon.price) facts.push([LOOKBOOK.salon.price, salon.price]);
    facts.push([LOOKBOOK.salon.tier, salon.tier]);
    const out: (HTMLElement | null)[] = [heading, rows(facts, 'sheet__salon-rows')];
    if (salon.request) {
      const contact = salonContactModel(this.contacts, s.name, salon.request.id);
      out.push(
        h(
          'div',
          { class: 'sheet__requested', attrs: { role: 'status' } },
          h('p', { class: 'ownership__status', text: LOOKBOOK.salon.requestedLabel }),
          h('p', { class: 'prose sheet__requested-text', text: LOOKBOOK.salon.requested }),
        ),
        contact ? contactBlock(contact) : null,
      );
    } else {
      out.push(
        h('p', { class: 'prose sheet__salon-lead', text: LOOKBOOK.salon.lead }),
        h(
          'div',
          { class: 'field sheet__note-field' },
          h('label', { class: 'field__label', attrs: { for: 'sheet-note' }, text: LOOKBOOK.salon.note }),
          this.note,
          h('span', { class: 'field__hint', id: 'sheet-note-hint', text: LOOKBOOK.salon.noteHint }),
        ),
        this.requestError ? h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${LOOKBOOK.salon.requestFailed} ${this.requestError}` }) : null,
        h(
          'button',
          {
            class: 'btn sheet__request',
            attrs: { type: 'button', disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' },
            on: { click: () => void this.requestPiece() },
            text: LOOKBOOK.salon.request,
          },
        ),
      );
    }
    return h('section', { class: 'sheet__section sheet__salon', attrs: { 'aria-labelledby': 'sheet-salon' } }, ...out.filter((x): x is HTMLElement => x !== null));
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
      this.load = { kind: 'ready', sheet: { ...sheet, salon: { ...sheet.salon!, request: { id: request.id } } } };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.requestError = messageOf(e);
    } finally {
      this.busy = false;
    }
    if (this.disposed) return;
    this.render();
    this.root.querySelector<HTMLElement>('#sheet-salon')?.focus({ preventScroll: true });
  }
}
