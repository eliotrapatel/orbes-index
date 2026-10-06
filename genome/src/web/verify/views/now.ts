/**
 * NOW (plan NOCTURNE, screen 1, step N3): /verify, in place of the landing [C1, C10, C42, C43]. What leads is
 * now-model.ts's choice:
 *
 *   [the photograph, whole, faded]       a LIVE RELEASE (C1): LIVE RELEASE, its title, BRACELET · ORBITAL, OPENS IN
 *   LIVE RELEASE                         and its countdown (THE ROOM IS OPEN, LIVE NOW once there), its day and hour
 *   MONOLITHE                            in Paris (then on this phone), 25 PIECES · ONE PER COLLECTOR · FOR OWNERS,
 *   IN BLUE                              N COLLECTORS WILL BE THERE, SEE THE RELEASE; a draw open, soon open or in its
 *   OPENS IN  02 : 06 : 12               early access then follows as a plate card;
 *   …                                    or a draw (C42): DRAW · ENTRIES OPEN, its title, its model, its price, its
 *   [ SEE THE RELEASE ]                  pieces and the time that matters in UTC, then on this phone, SEE THE RELEASE;
 *                                        or the newest model (C43): THE COLLECTION · ORBITAL, its name, type, sizes,
 *                                        variant dots, You own N, SEE THE MODEL
 *   YOUR PIECES              MY PIECES   an owner: two pieces side by side, their model's photographs (decision 9),
 *   TITANE  2 pieces held. …             the tier in one line (decision 10)
 *   THE CIRCLE              THE CIRCLE   the next invitation as a plate card: YES / NO (addition 6), its places left
 *   THE COLLECTION             ORBITAL   a photograph of the collection and its link (not when the collection leads)
 *   [ ⌖ SCAN ORBES CODE ]                the scan; signed out, MY PIECES under it (its sign-in)
 *   UPLOAD A PHOTO
 *
 * With nothing announced and no model shown, NOW opens on YOUR PIECES (signed in) or the scan (signed out). The page
 * reads what leads once, on the server's clock for the countdown; at the end of the LIVE RELEASE it leads, or when the
 * account signs in or out, it reads it again. CSP-safe: h() only, its places by class (verify/styles.css, NOW).
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { CIRCLE, LIVE, LOOKBOOK, NOW, PIECES, RELEASES } from '../copy.js';
import { measureClock } from '../live-model.js';
import {
  collectionHero,
  collectionTeaser,
  drawLead,
  liveHero,
  livePhase,
  newestEntry,
  nextInvitation,
  nowPieces,
  nowTop,
  tierLine,
  type CollectionHeroModel,
  type DrawLeadModel,
  type LiveHeroModel,
  type NowTop,
} from '../now-model.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import type { SessionStore } from '../session.js';
import type { CircleCard, ClubStatus, DropCard, LiveCard, LookbookCard, OwnedPiece } from '../types.js';
import { CIRCLE_PATH, LOOKBOOK_PATH, PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { CircleCardLines } from './invitation.js';
import { appAnchor, countdown, fadedPhoto, icon, lift, loadingState, modelTitle, plateCard, textLink, variantDots } from './nocturne.js';

export interface NowDeps {
  api: Pick<ApiClient, 'liveReleases' | 'drops' | 'lookbook' | 'products' | 'clubStatus' | 'circle' | 'circleAnswer' | 'liveClock'>;
  session: SessionStore;
  /** This phone's time zone: a LIVE RELEASE says its time in Paris, then here when it differs. */
  localZone: string;
  onScan(): void;
  onUpload(): void;
  /** MY PIECES (signed out: its sign-in). */
  onPieces(): void;
  onRelease(id: string): void;
  onCollection(): void;
  onModel(slug: string): void;
  onCircle(): void;
  onPost(id: string): void;
  /**
   * NOW opens as a screen change (not the page's first load): focus, left on <body> by the screen that went, comes to
   * its title, or to SCAN ORBES CODE without one, the way the landing's did.
   */
  focus: boolean;
}

export interface NowView {
  root: HTMLElement;
  dispose(): void;
}

export function nowView(deps: NowDeps): NowView {
  return new Now(deps);
}

/** What NOW read: what leads, and, for an owner, the pieces, the tier and the feed of the circle. */
interface NowData {
  signedIn: boolean;
  /** The session could not be read (offline): no way to MY PIECES from here. */
  sessionKnown: boolean;
  top: NowTop;
  collection: LookbookCard[];
  /** The account's pieces; null when they could not be read (YOUR PIECES then says nothing of them). */
  pieces: OwnedPiece[] | null;
  club: ClubStatus | null;
  /** The feed's posts (null: no circle for this account, or unreadable). */
  circle: CircleCard[] | null;
}

/** The countdown is drawn again this often (its seconds within the last day). */
const PULSE_MS = 1000;

class Now implements NowView {
  readonly root: HTMLElement;
  private data: NowData | null = null;
  private offset = 0;
  private pulse: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private reading = 0;
  private hero: { model: LiveHeroModel; kind: HTMLElement; clock: HTMLElement; key: string } | null = null;
  /** THE CIRCLE's next invitation, its YES / NO answered in place. */
  private invitation: CircleCardLines | null = null;
  private readonly unsubscribe: () => void;
  private signedIn: boolean | null = null;
  /** The first page drawn takes the focus the screen change left on <body> (deps.focus). */
  private focusPending: boolean;

  constructor(private readonly deps: NowDeps) {
    this.focusPending = deps.focus;
    this.root = viewRoot('now');
    this.root.setAttribute('aria-label', NOW.label);
    this.root.append(loadingState(PIECES.loading));
    this.unsubscribe = deps.session.subscribe((s) => {
      // Signed in or out from the account sheet or a sign-in elsewhere: what NOW shows an owner changes.
      const now = s.status === 'signed-in';
      if (s.status !== 'unknown' && this.signedIn !== null && now !== this.signedIn) void this.read();
    });
    void this.read();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.stop();
    this.invitation?.dispose();
  }

  private stop(): void {
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = null;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private async read(): Promise<void> {
    const reading = ++this.reading;
    const { api, session } = this.deps;
    let signedIn = false;
    let sessionKnown = true;
    try {
      signedIn = (await session.ensure()).status === 'signed-in';
    } catch {
      sessionKnown = false;
    }
    const owner = <T>(read: () => Promise<T>, fallback: T): Promise<T> =>
      signedIn
        ? read().catch((e: unknown) => {
            session.noteError(e);
            return fallback;
          })
        : Promise.resolve(fallback);
    const [live, drops, collection, pieces, club, circle, clock] = await Promise.all([
      api.liveReleases().catch((): LiveCard[] => []),
      api.drops().catch((): DropCard[] => []),
      api.lookbook().catch((): LookbookCard[] => []),
      owner<OwnedPiece[] | null>(() => api.products(), null),
      owner<ClubStatus | null>(() => api.clubStatus(), null),
      // The next invitation: the feed read without counting a visit of the circle (403 without a piece: no circle).
      owner<CircleCard[] | null>(async () => (await api.circle(1, 50, { visit: false })).items, null),
      measureClock(() => api.liveClock(), 1).catch(() => null),
    ]);
    if (this.disposed || reading !== this.reading) return;
    if (clock) this.offset = clock.offset;
    this.signedIn = signedIn;
    this.data = { signedIn, sessionKnown, top: nowTop(live, drops, collection), collection, pieces, club, circle };
    this.render();
  }

  private now(): number {
    return Date.now() + this.offset;
  }

  // ── The page ─────────────────────────────────────────────────────────────

  private render(): void {
    const d = this.data;
    if (!d) return;
    this.stop();
    this.hero = null;
    this.invitation?.dispose();
    this.invitation = null;
    const pending = this.focusPending;
    this.focusPending = false;
    const active = document.activeElement;
    const hadFocus = this.root.contains(active) || (pending && (active === null || active === document.body));
    const sections: (HTMLElement | null)[] = [];
    const top = d.top;
    let heroSlug: string | null = null;
    if (top.kind === 'live') {
      sections.push(this.liveSection(liveHero(top.live, this.deps.localZone)));
      heroSlug = top.live.lookbook ?? null;
      const draw = top.draw ? drawLead(top.draw, offsetMinutes()) : null;
      if (draw) sections.push(this.drawCard(draw));
    } else if (top.kind === 'draw') {
      const draw = drawLead(top.draw, offsetMinutes());
      if (draw) sections.push(this.drawSection(draw));
      heroSlug = top.draw.model?.lookbook ?? null;
    } else if (top.kind === 'collection') {
      sections.push(this.collectionSection(collectionHero(top.entry, d.pieces ?? [])));
    }
    const lead = sections.length === 0;
    if (d.signedIn) {
      sections.push(this.piecesSection(d, lead));
      sections.push(this.circleSection(d));
    }
    const scan = this.scanSection(d, lead && !d.signedIn);
    if (d.signedIn) {
      if (top.kind !== 'collection') sections.push(this.teaserSection(d, heroSlug));
      sections.push(scan);
    } else {
      sections.push(scan);
      if (top.kind !== 'collection') sections.push(this.teaserSection(d, heroSlug));
    }
    this.root.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
    const h1 = this.root.querySelector('h1');
    if (h1) {
      h1.id = 'now-title';
      this.root.removeAttribute('aria-label');
      this.root.setAttribute('aria-labelledby', 'now-title');
    } else {
      this.root.removeAttribute('aria-labelledby');
      this.root.setAttribute('aria-label', NOW.label);
    }
    this.root.dataset.ready = 'true';
    if (this.hero) {
      this.drawPhase();
      this.pulse = setInterval(() => this.drawPhase(), PULSE_MS);
    }
    const scanButton = this.root.querySelector<HTMLElement>('.landing__scan');
    // Read before the screen change shows it: the change's focusFirst() then finds the title, or SCAN ORBES CODE.
    if (!h1) scanButton?.setAttribute('data-autofocus', '');
    const target = h1 ?? scanButton;
    if (hadFocus && target && !this.root.contains(document.activeElement)) {
      if (h1) h1.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }

  /** A title whose model's name begins it: the name on a line of its own (`MONOLITHE` / `IN BLUE`), as the canvas sets it. */
  private title(tag: 'h1' | 'h2', cls: string[], text: string, model: string | null): HTMLElement {
    return modelTitle(tag, cls, text, model);
  }

  /** A LIVE RELEASE leads (C1, C10). */
  private liveSection(m: LiveHeroModel): HTMLElement {
    const kind = h('p', { class: 'n-g n-lb' });
    const clock = h('div', { class: 'now__clock', attrs: { 'aria-live': 'off' } });
    this.hero = { model: m, kind, clock, key: '' };
    const picture = m.picture ? fadedPhoto(m.picture.src, m.picture.alt, { eager: true }) : null;
    return h(
      'section',
      { class: ['now__hero', picture ? null : 'now__hero--bare'], attrs: { 'aria-label': NOW.sections.release } },
      picture,
      lift(
        [
          kind,
          this.title('h1', ['n-g', 'n-t1', 'now__title'], m.title, m.model),
          m.line ? h('p', { class: 'n-g n-lb now__type' }, ...withNumerals(m.line)) : null,
          clock,
          h('p', { class: 'n-g n-lb now__when' }, ...withNumerals(m.when.paris)),
          m.when.local ? h('p', { class: 'n-g n-lb now__local' }, ...withNumerals(m.when.local)) : null,
          m.lines.length > 0
            ? h('div', { class: 'n-lines now__lines' }, ...m.lines.map((l, i) => h('span', { class: ['n-g', 'n-lines__line', i === 0 ? 'n-ivc' : null] }, ...withNumerals(l))))
            : null,
          m.interest ? h('p', { class: 'n-g n-lb now__interest' }, ...withNumerals(m.interest)) : null,
          appAnchor(m.href, ['n-g', 'n-btn', 'now__primary'], () => this.deps.onRelease(m.id), RELEASES.see),
        ],
        { center: true, extraClass: picture ? undefined : 'now__bare' },
      ),
    );
  }

  /** The LIVE RELEASE's state and countdown, on the server's clock; at its end, NOW reads what leads again. */
  private drawPhase(): void {
    const hero = this.hero;
    if (!hero || this.disposed) return;
    const p = livePhase(hero.model, this.now());
    if (p.ended) {
      this.stop();
      void this.read();
      return;
    }
    const key = `${p.kind}|${p.countdown?.map((g) => g.value).join(':') ?? ''}`;
    if (key === hero.key) return;
    hero.key = key;
    hero.kind.textContent = p.kind;
    hero.clock.replaceChildren(
      ...(p.countdown
        ? [
            h('p', { class: 'n-g n-lb now__opens', text: LIVE.opensIn }),
            countdown(
              p.countdown.map((g) => [g.value, g.unit] as const),
              { label: `${LIVE.opensIn} ${p.countdown.map((g) => `${g.value} ${g.unit}`).join(' ')}` },
            ),
          ]
        : []),
    );
  }

  /** A draw leads (C42). */
  private drawSection(m: DrawLeadModel): HTMLElement {
    const picture = m.image ? fadedPhoto(m.image.src, m.image.alt, { eager: true }) : null;
    return h(
      'section',
      { class: ['now__hero', picture ? null : 'now__hero--bare'], attrs: { 'aria-label': NOW.sections.release } },
      picture,
      lift(
        [
          h('p', { class: 'n-g n-lb', text: m.kind }),
          this.title('h1', ['n-g', 'n-t1', 'now__title'], m.title, firstWord(m.model)),
          h('p', { class: 'n-g n-lb now__type' }, ...withNumerals(m.model)),
          m.price ? h('p', { class: 'n-num now__price', text: m.price }) : null,
          this.drawLine(m, 'now__line'),
          m.local ? h('p', { class: 'n-sm n-num now__local-time', text: m.local }) : null,
          appAnchor(m.href, ['n-g', 'n-btn', 'now__primary'], () => this.deps.onRelease(m.id), RELEASES.see),
        ],
        { center: true, extraClass: picture ? undefined : 'now__bare' },
      ),
    );
  }

  /** `12 PIECES · ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC`: the date never parted from its hour. */
  private drawLine(m: DrawLeadModel, cls: string): HTMLElement {
    return h(
      'p',
      { class: ['n-g', 'n-lb', 'n-ivc', 'n-num', cls] },
      ...withNumerals(m.line.lead),
      m.line.time ? ' ' : null,
      m.line.time ? h('span', { class: 'n-nw' }, ...withNumerals(m.line.time)) : null,
    );
  }

  /** The draw under a LIVE RELEASE, as a plate card (C1). */
  private drawCard(m: DrawLeadModel): HTMLElement {
    return h(
      'section',
      { class: 'n-px n-sec', attrs: { 'aria-label': NOW.sections.also } },
      plateCard(
        [
          h('p', { class: 'n-g n-lb', text: m.kind }),
          h('h2', { class: 'n-g n-t2 now__card-title' }, ...withNumerals(m.title)),
          h('p', { class: 'n-g n-lb now__card-model' }, ...withNumerals(m.model)),
          m.price ? h('p', { class: 'n-num now__card-price', text: m.price }) : null,
          this.drawLine(m, 'now__card-line'),
          h('p', { class: 'now__card-link' }, textLink(RELEASES.see, { href: m.href, onOpen: () => this.deps.onRelease(m.id) })),
        ],
        { left: true, extraClass: 'now__card' },
      ),
    );
  }

  /** The newest model leads (C43): its dots switch the photograph and the model SEE THE MODEL opens. */
  private collectionSection(m: CollectionHeroModel): HTMLElement {
    let selected = m.slug;
    const photo = m.image ?? m.dots.find((d) => d.image)?.image ?? null;
    const picture = photo ? fadedPhoto(photo.src, photo.alt, { eager: true }) : null;
    const see = appAnchor(lookbookSheetPath(selected), ['n-g', 'n-btn', 'now__primary'], () => this.deps.onModel(selected), LOOKBOOK.seeModel);
    let dots: HTMLElement | null = null;
    const draw = () => {
      const dot = m.dots.find((d) => d.slug === selected);
      const img = picture?.querySelector('img');
      const image = dot?.image ?? m.image;
      if (img && image) {
        img.src = image.src;
        img.alt = image.alt;
      }
      see.setAttribute('href', lookbookSheetPath(selected));
      const next = variantDots(
        m.dots.map((d) => ({ id: d.slug, label: d.label, swatch: d.swatch })),
        {
          selected,
          label: LOOKBOOK.variants,
          onSelect: (id) => {
            selected = id;
            draw();
            dots?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
          },
        },
      );
      next.classList.add('now__dots');
      dots?.replaceWith(next);
      dots = next;
    };
    if (m.dots.length > 0) {
      dots = h('div');
      draw();
    }
    return h(
      'section',
      { class: ['now__hero', picture ? null : 'now__hero--bare'], attrs: { 'aria-label': NOW.sections.collection } },
      picture,
      lift(
        [
          h('p', { class: 'n-g n-lb' }, ...withNumerals(m.label)),
          h('h1', { class: 'n-g n-t1 now__title' }, ...withNumerals(m.name)),
          m.type ? h('p', { class: 'n-g n-lb now__type' }, ...withNumerals(m.type)) : null,
          m.sizes ? h('p', { class: 'n-g n-lb n-ivc n-num now__sizes' }, ...withNumerals(m.sizes)) : null,
          dots,
          m.owned ? h('p', { class: 'n-state now__owned' }, icon('check', { small: true }), m.owned) : null,
          see,
        ],
        { center: true, extraClass: picture ? undefined : 'now__bare' },
      ),
    );
  }

  /** YOUR PIECES (an owner's, C1): two side by side, their model's photographs; the tier in one line. */
  private piecesSection(d: NowData, lead: boolean): HTMLElement {
    const pieces = nowPieces(d.pieces ?? []);
    const tier = tierLine(d.club);
    return h(
      'section',
      { class: ['n-sec', lead ? 'now__lead' : null], attrs: { 'aria-label': NOW.sections.pieces } },
      h('div', { class: 'n-px n-sb' }, h('h2', { class: 'n-g n-t3', text: NOW.pieces }), textLink(PIECES.link, { href: PIECES_PATH, onOpen: () => this.deps.onPieces() })),
      pieces.length > 0
        ? h(
            'div',
            { class: 'n-two now__pieces' },
            ...pieces.map((p) =>
              appAnchor(
                PIECES_PATH,
                ['now__piece'],
                () => this.deps.onPieces(),
                p.image ? fadedPhoto(p.image.src, p.image.alt, { fade: false, height: 195 }) : h('div', { class: 'n-ph now__piece-ground' }),
                h('div', { class: 'n-two__caption' }, h('p', { class: 'n-g n-cap' }, ...withNumerals(p.name)), h('p', { class: 'n-sm n-num now__piece-id', text: p.productId })),
              ),
            ),
          )
        : d.pieces
          ? h('p', { class: 'n-px n-sm now__empty', text: PIECES.empty })
          : null,
      tier ? h('p', { class: 'n-px n-sm now__tier' }, h('span', { class: 'n-g n-ivc now__tier-name', text: tier.name }), ' \u00a0 ', tier.text) : null,
    );
  }

  /** THE CIRCLE (an owner's): its next invitation as a plate card, answered YES or NO here (addition 6; views/invitation.ts). */
  private circleSection(d: NowData): HTMLElement | null {
    const card = d.circle ? nextInvitation(d.circle, this.now()) : null;
    if (!card || !card.reply) return null;
    const host = plateCard([], { left: true, extraClass: 'now__card now__invitation' });
    this.invitation?.dispose();
    this.invitation = new CircleCardLines(card, host, { api: this.deps.api, session: this.deps.session, onPost: (id) => this.deps.onPost(id) }, { heading: 'h3' });
    return h(
      'section',
      { class: 'n-sec', attrs: { 'aria-label': NOW.sections.circle } },
      h('div', { class: 'n-px n-sb' }, h('h2', { class: 'n-g n-t3', text: CIRCLE.title }), textLink(CIRCLE.link, { href: CIRCLE_PATH, onOpen: () => this.deps.onCircle() })),
      host,
    );
  }

  /** THE COLLECTION under the hero: a photograph of its newest entry, its name and type, and its link. */
  private teaserSection(d: NowData, heroSlug: string | null): HTMLElement | null {
    const entry = newestEntry(d.collection);
    if (!entry) return null;
    const m = collectionTeaser(entry, heroSlug);
    return h(
      'section',
      { class: 'n-sec', attrs: { 'aria-label': NOW.sections.collection } },
      h('div', { class: 'n-px n-sb' }, h('h2', { class: 'n-g n-t3', text: LOOKBOOK.title }), m.collection ? h('span', { class: 'n-sm', text: m.collection }) : null),
      m.image ? fadedPhoto(m.image.src, m.image.alt, { extraClass: 'now__teaser-photo' }) : null,
      lift(
        [
          h('h3', { class: 'n-g n-t2' }, ...withNumerals(m.name)),
          m.type ? h('p', { class: 'n-g n-lb now__teaser-type' }, ...withNumerals(m.type)) : null,
          h('p', { class: 'now__teaser-link' }, textLink(LOOKBOOK.link, { href: LOOKBOOK_PATH, onOpen: () => this.deps.onCollection() })),
        ],
        { center: true, extraClass: m.image ? undefined : 'now__bare' },
      ),
    );
  }

  /** The scan: SCAN ORBES CODE, UPLOAD A PHOTO; signed out, MY PIECES (its sign-in) under them. */
  private scanSection(d: NowData, lead: boolean): HTMLElement {
    return h(
      'section',
      { class: ['n-px', 'n-sec', 'n-ctr', lead ? 'now__lead' : null], attrs: { 'aria-label': NOW.sections.scan } },
      h('button', { class: 'n-g n-btn n-btn--ol landing__scan', attrs: { type: 'button' }, on: { click: () => this.deps.onScan() } }, icon('scan'), NOW.scan),
      h('p', { class: 'now__scan-link' }, h('button', { class: 'n-g n-tl landing__upload', attrs: { type: 'button' }, on: { click: () => this.deps.onUpload() }, text: NOW.upload })),
      !d.signedIn && d.sessionKnown ? h('p', { class: 'now__scan-link' }, textLink(PIECES.link, { href: PIECES_PATH, onOpen: () => this.deps.onPieces(), extraClass: 'landing__pieces' })) : null,
    );
  }
}

/** The first word of a line (a model's name, before ` · ` or a space). */
function firstWord(line: string): string | null {
  const w = line.split(' · ')[0]?.trim();
  return w ? w : null;
}

/** This phone's offset from UTC, in minutes east. */
function offsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
