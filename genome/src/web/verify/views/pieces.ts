/**
 * MY PIECES (F-01, /verify/pieces; plan NOCTURNE, screen 3: C3, C24, C31, C32): the signed-in owner's pieces, its
 * orders and its releases, under three underlined tabs, in NOCTURNE's pieces (views/nocturne.ts).
 *
 *   [ the banner of the next LIVE RELEASE ]     over the PIECES tab (views/live-banner.ts, held by the shell; C3)
 *   MY PIECES                                    the page's title
 *   The pieces registered to your ORBES account. its sentence, on the PIECES tab (C3; C24 and C31 go without it)
 *   PIECES²  ORDERS⁴  RELEASES³                  the tabs, each with its count; a tab with nothing in it is left out
 *                                                (YOUR TIER is in the account sheet since NOCTURNE, decision 10)
 *   PIECES
 *     [ the model's photograph ]                 shown whole, full width, fading into the ground (never the piece's
 *     MONOLITHE                O26-J-00184       own photograph, decision 9), the words rising onto its foot
 *     BRACELET · 925 STERLING SILVER · SIZE 17   its type, its material and its size (addition 1)
 *     ✓ REGISTERED TO YOU · SINCE 3 OCT 2026      or its state: REPORTED LOST, REPORTED STOLEN, TRANSFER PENDING, IN SERVICE
 *     SEE THE PIECE                              its page (/verify/pieces/<id>, views/piece.ts: C4, C35)
 *     AFTER THE RELEASES                         the question after each LIVE RELEASE the account said I'LL BE THERE
 *       WHAT WOULD YOU HAVE WANTED? …            to and did not come to (plan LIVE RELEASE+, choice 11; views/question.ts)
 *     EARLY ACCESS                               the privilege of PLATINE and PALLADIUM, for an account without a tier
 *     ADD A PIECE                                scan a piece, then register it from its result; SCAN ORBES CODE
 *   ORDERS (plan LIVE RELEASE+, choice 6; C24, C32)
 *     [ the model's photograph ]                 its cover photograph (addition 3)
 *     LIVE RELEASE · MONOLITHE IN STEEL          where it was sold
 *     MONOLITHE                                  its model
 *     ●──○──○──○ RESERVED PAID SHIPPED DELIVERED its steps and their dates (or CANCELLED, or RETURNED)
 *     Your piece is reserved. …                  what its step means
 *     SIZE · PRICE · ENGRAVING · TOTAL           its terms; once shipped CARRIER and TRACKING NUMBER, TRACK THE SHIPMENT
 *     ORDER OR-3F9A21C4                          its reference, for ORBES Client Services
 *     [ WRITE TO ORBES CLIENT SERVICES ]         the write sheet, the order attached (plan NEXT-NINE, CS-01)
 *     DOCUMENTS                                  INVOICE, CREDIT NOTE (PDFs), CARE GUIDE (opens under it), OWNERSHIP
 *                                                CERTIFICATE (PDF, once the piece is registered to the account)
 *   RELEASES (P-R03; C31)
 *     MONOLITHE IN STEEL                         each entry of the account, a link to its release's page,
 *     LIVE RELEASE · CONFIRMED                   its state, what it means now, its id (the one the draw publishes) or its
 *     You secured your piece in size 16. …       reference, and WRITE TO ORBES CLIENT SERVICES for a place held or
 *                                                confirmed, the release attached (CS-01)
 *     REFERENCE LR-8K2M4Q
 *   (the header and its account sheet, the rail, the footer and the SCAN ring: views/shell.ts; SIGNED IN AS, CHANGE
 *   PASSWORD and SIGN OUT are the account sheet's, C2 and C39)
 *
 * Signed out (a direct link, a reload after the session ended, NOW's MY PIECES), the OWNERSHIP panel's sign-in forms
 * stand alone (its account mode), FORGOTTEN PASSWORD? included: an owner whose piece is gone reaches the account without
 * scanning it.
 *
 * Every action is a same-origin JSON call through ApiClient (session cookie + CSRF token); server messages are shown as
 * they come. A 401 anywhere ends the session on the page, which then offers the sign-in again.
 */
import { h } from '../../shared/dom.js';
import { saveDownload } from '../../shared/download.js';
import type { ApiClient, OrderDocumentKind } from '../api.js';
import { DEFAULT_CARE, ORDERS, PIECES, QUESTION, RELEASES } from '../copy.js';
import { orderContext } from '../messages-model.js';
import { myLiveEntries } from '../live-model.js';
import { orderModels, type OrderModel } from '../orders-model.js';
import { pieceModel, type PieceModel } from '../pieces-model.js';
import { myEntries, type MyEntryModel } from '../releases-model.js';
import type { SessionStore } from '../session.js';
import type { AccountOrder, AccountQuestion, ClientServices, ClubEntry, LiveAccountEntry, OwnedPiece } from '../types.js';
import { recoveryContactModel } from '../view-model.js';
import { PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { appAnchor, definitionList, fadedPhoto, failedState, icon, lift, loadingState, orderSteps, quietLine, tabs, textLink } from './nocturne.js';
import { writeButton } from './write.js';
import { OwnershipPanel } from './ownership.js';
import { QuestionBlock } from './question.js';

/** The tabs of MY PIECES (C3, C24, C31). */
export const PIECES_TABS = ['pieces', 'orders', 'releases'] as const;
export type PiecesTab = (typeof PIECES_TABS)[number];

/** A piece's page: `/verify/pieces/<product id>`. */
export function piecePath(productId: string): string {
  return `${PIECES_PATH}/${encodeURIComponent(productId)}`;
}

export interface PiecesDeps {
  api: ApiClient;
  session: SessionStore;
  /** SCAN ORBES CODE (ADD A PIECE). */
  onScan(): void;
  /** How ORBES Client Services is reached (`{}` when not configured); never rejects, never more than a second late. */
  clientServices(): Promise<ClientServices>;
  /** A release's page, from an entry; an after-room's, through the release it follows. */
  onRelease?(id: string): void;
  onAfterRoom?(parentId: string): void;
  /** SEE THE PIECE: the piece's page. */
  onPiece?(productId: string): void;
  /** The tab to open on (its place in the history keeps it), PIECES by default. */
  tab?: PiecesTab;
  /** Told each tab selected by the reader (the history keeps it; the banner is the PIECES tab's). */
  onTab?(tab: PiecesTab): void;
  /** ORDER OR-… from a piece's page (WHERE IT COMES FROM): the order brought into view on ORDERS. */
  order?: string | null;
  /** This phone's time zone: the question after's dates on its calendar (UTC by default). */
  localZone?: string;
}

export interface PiecesView {
  root: HTMLElement;
  /** The page is on screen (the app's swap done): the order asked for can be brought into view once read. */
  shown(): void;
  dispose(): void;
}

type Load = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };

export function piecesView(deps: PiecesDeps): PiecesView {
  const page = new PiecesPage(deps);
  return { root: page.root, shown: () => page.shown(), dispose: () => page.dispose() };
}

class PiecesPage {
  readonly root: HTMLElement;
  private readonly title = h('h1', { class: 'n-g n-t1 n-pieces__title', id: 'pieces-title', text: PIECES.title });
  private readonly lead = h('p', { class: 'n-tx n-pieces__lead', attrs: { hidden: true }, text: PIECES.lead });
  private readonly body = h('div', { class: 'n-pieces__body' });
  private unsubscribe: (() => void) | null;
  private disposed = false;
  /** The session and the contact of ORBES Client Services are known: the page can say what it holds. */
  private ready = false;
  private contacts: ClientServices = {};
  private signIn: OwnershipPanel | null = null;
  private pieces: PieceModel[] = [];
  /** The account's entries in the drops; null when they could not be read. */
  private entries: ClubEntry[] | null = [];
  /** Its entries in the LIVE RELEASES (plan of 2026-10-04: they stay here after the release); null when unread. */
  private liveEntries: LiveAccountEntry[] | null = [];
  /** Its orders (plan LIVE RELEASE+, choice 6), the latest first; null when they could not be read. */
  private orders: AccountOrder[] | null = [];
  /** The questions after open for it (choice 11); none when they could not be read (they are only asked). */
  private questions: AccountQuestion[] = [];
  /** Each question's block, kept while the page lives (a tap keeps its focus). */
  private questionBlocks = new Map<string, QuestionBlock>();
  /** The account's tier in the club (P-X02, its early access); null until the club's status is read. */
  private tier: number | null = null;
  private load: Load = { kind: 'idle' };
  /** Bumped on every load; an answer to an older one is dropped. */
  private loadGen = 0;
  private email: string | null = null;
  private tab: PiecesTab;
  /** The order to bring into view once the orders are drawn (from a piece's page), then forgotten. */
  private order: string | null;
  /** On screen: the app's swap is done (focus and scrolling then hold). */
  private onScreen = false;

  constructor(private readonly deps: PiecesDeps) {
    this.tab = deps.tab ?? 'pieces';
    this.order = deps.order ?? null;
    this.root = viewRoot('pieces', 'pieces-title');
    this.root.classList.add('n-pieces');
    this.root.append(h('div', { class: 'n-px n-pieces__head' }, this.title, this.lead), this.body);
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    this.render();
    void this.start();
  }

  shown(): void {
    this.onScreen = true;
    this.revealOrder();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.signIn?.dispose();
    this.signIn = null;
  }

  private async start(): Promise<void> {
    // The session (the panel asks again, and offers the sign-in, if the server cannot be reached) and the contact.
    const [contacts] = await Promise.all([this.deps.clientServices(), this.deps.session.ensure().catch(() => undefined)]);
    if (this.disposed) return;
    this.contacts = contacts;
    this.ready = true;
    this.onSession();
  }

  private onSession(): void {
    if (!this.ready || this.disposed) return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      // Signed in with this page's form (the button that was pressed is gone): once the pieces are there, keyboard focus
      // goes to the title above them.
      const fromForm = this.signIn !== null;
      this.signIn?.dispose();
      this.signIn = null;
      if (this.email !== s.account.email || this.load.kind === 'idle') {
        this.email = s.account.email;
        void this.loadPieces(fromForm);
      }
    } else {
      // Signed out (here, elsewhere, or the session ended): the pieces leave the page with the session.
      this.email = null;
      this.loadGen++;
      this.load = { kind: 'idle' };
      this.pieces = [];
      this.entries = [];
      this.orders = [];
      this.questions = [];
      this.questionBlocks.clear();
      this.tier = null;
      this.signIn ??= new OwnershipPanel(
        { kind: 'account' },
        { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan(), contact: recoveryContactModel(this.contacts, '') ?? undefined },
      );
    }
    this.render();
  }

  private async loadPieces(focusTitle: boolean): Promise<void> {
    const gen = ++this.loadGen;
    this.load = { kind: 'loading' };
    this.render();
    const soft = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((e: unknown) => {
        this.deps.session.noteError(e);
        return fallback;
      });
    try {
      // The account's entries in the drops (P-R03) and its orders with the pieces: without them, the pieces still show,
      // and their tab says they could not be shown. A question unread is a question not asked: nothing is said of it.
      const [list, club, live, orders, questions] = await Promise.all([
        this.deps.api.products(),
        soft(this.deps.api.clubStatus(), null),
        soft(this.deps.api.liveMine(), null),
        soft(this.deps.api.orders(), null),
        soft(this.deps.api.questions(), [] as AccountQuestion[]),
      ]);
      if (gen !== this.loadGen || this.disposed) return;
      this.pieces = list.map((p: OwnedPiece) => pieceModel(p));
      this.entries = club ? club.entries : null;
      this.liveEntries = live;
      this.orders = orders;
      this.questions = questions;
      this.tier = club ? Number(club.tier?.level) || 0 : null;
      this.load = { kind: 'ready' };
    } catch (e) {
      if (gen !== this.loadGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    // A tab with nothing in it is left out: the page opens on PIECES instead.
    if (this.load.kind === 'ready' && !this.available().includes(this.tab)) this.select('pieces', false);
    this.render();
    if (focusTitle) this.focusTitle();
    this.revealOrder();
  }

  private focusTitle(): void {
    if (!this.title.hasAttribute('tabindex')) this.title.tabIndex = -1;
    this.title.focus({ preventScroll: true });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const s = this.deps.session.state;
    const signedIn = this.ready && s.status === 'signed-in';
    this.lead.hidden = !(signedIn && this.tab === 'pieces');
    this.root.dataset.tab = signedIn ? this.tab : '';
    if (!this.ready) {
      this.body.replaceChildren(loadingState(PIECES.loading, { extraClass: 'n-pieces__waiting' }));
      return;
    }
    if (!signedIn) {
      this.body.replaceChildren(...(this.signIn ? [h('div', { class: 'n-px pieces__signin' }, this.signIn.root)] : []));
      return;
    }
    switch (this.load.kind) {
      case 'ready':
        this.body.replaceChildren(...this.tabbed());
        return;
      case 'failed':
        // Could not be shown: the sentence, the reason, TRY AGAIN (C40).
        this.body.replaceChildren(
          h('div', { class: 'n-px n-pieces__failed' }, failedState({ sentence: PIECES.loadFailed, reason: this.load.message, retry: PIECES.retry, onRetry: () => void this.loadPieces(true), retryClass: 'pieces__retry' })),
        );
        return;
      default:
        this.body.replaceChildren(loadingState(PIECES.loading, { extraClass: 'n-pieces__waiting' }));
    }
  }

  /** The entries of RELEASES, the LIVE RELEASES' first; null when they could not be read. */
  private releaseItems(): MyEntryModel[] | null {
    if (this.entries === null || this.liveEntries === null) return null;
    return [...myLiveEntries(this.liveEntries), ...myEntries(this.entries, { offsetMinutes: -new Date().getTimezoneOffset() })];
  }

  /** The tabs that have something to show (or that say they could not be read): PIECES always. */
  private available(): PiecesTab[] {
    const out: PiecesTab[] = ['pieces'];
    if (this.orders === null || orderModels(this.orders).length > 0) out.push('orders');
    const items = this.releaseItems();
    if (items === null || items.length > 0) out.push('releases');
    return out;
  }

  private select(tab: PiecesTab, render = true): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.deps.onTab?.(tab);
    if (render) this.render();
  }

  /** The tabs (when there is more than PIECES to show) and the selected one's panel. */
  private tabbed(): HTMLElement[] {
    const available = this.available();
    const orders = this.orders === null ? null : orderModels(this.orders);
    const items = this.releaseItems();
    const panel = h('div', { class: 'n-pieces__panel', id: `pieces-${this.tab}-panel`, attrs: { role: available.length > 1 ? 'tabpanel' : null, 'aria-labelledby': available.length > 1 ? `pieces-${this.tab}` : null } });
    if (this.tab === 'orders') panel.append(...this.ordersPanel(orders));
    else if (this.tab === 'releases') panel.append(this.releasesPanel(items));
    else panel.append(...this.piecesPanel());
    if (available.length < 2) return [panel];
    const count: Record<PiecesTab, number | undefined> = { pieces: this.pieces.length, orders: orders?.length, releases: items?.length };
    const list = tabs(
      available.map((id) => ({ id, label: PIECES.pageTabs[id], count: count[id] })),
      {
        selected: this.tab,
        label: PIECES.pageTabsLabel,
        idPrefix: 'pieces',
        onSelect: (id) => {
          this.select(id as PiecesTab);
          this.root.querySelector<HTMLElement>(`#pieces-${id}`)?.focus();
        },
      },
    );
    list.classList.add('n-px', 'n-pieces__tabs');
    return [list, panel];
  }

  // ── PIECES ───────────────────────────────────────────────────────────────

  private piecesPanel(): HTMLElement[] {
    const out: (HTMLElement | null)[] = [];
    if (this.pieces.length === 0) out.push(h('div', { class: 'n-px n-pieces__quiet' }, quietLine(PIECES.empty, 'pieces__empty')));
    else out.push(h('div', { class: 'n-pieces__list' }, ...this.pieces.map((m, i) => this.pieceCard(m, i))));
    out.push(this.questionsBlock(), this.earlyBlock(), this.addBlock(this.pieces.length === 0));
    return out.filter((x): x is HTMLElement => x !== null);
  }

  /** One piece of the list (C3): its model's photograph, its name and id, its type, material and size, its state, SEE THE PIECE. */
  private pieceCard(m: PieceModel, index: number): HTMLElement {
    const titleId = `${m.key || `piece-${index + 1}`}-title`;
    const photo = m.photos[0];
    const href = piecePath(m.productId);
    const see = textLink(PIECES.seePiece, { href, onOpen: this.deps.onPiece ? () => this.deps.onPiece!(m.productId) : undefined, extraClass: 'n-pieces__see' });
    see.setAttribute('aria-describedby', titleId);
    const words = [
      h('div', { class: 'n-sb n-pieces__name-line' }, h('h2', { class: 'n-g n-t2 n-pieces__name', id: titleId }, ...withNumerals(m.name)), h('span', { class: 'n-sm n-num n-pieces__id', text: m.productId })),
      m.listLine ? h('p', { class: 'n-g n-lb n-pieces__line' }, ...withNumerals(m.listLine)) : null,
      h('p', { class: 'n-state n-pieces__state' }, m.registered ? icon('check', { small: true }) : null, ...stateWords(m.stateLine)),
      h('p', { class: 'n-pieces__see-line' }, see),
    ];
    const article = h('article', { class: ['n-pieces__piece', photo ? null : 'n-pieces__piece--bare'], attrs: { 'aria-labelledby': titleId }, data: { piece: m.productId } });
    if (photo) {
      const frame = fadedPhoto(photo.src, photo.alt, { eager: index < 2 });
      // A photograph that cannot be loaded takes its place with it: never a broken image.
      frame.querySelector('img')?.addEventListener('error', () => {
        frame.remove();
        article.classList.add('n-pieces__piece--bare');
      }, { once: true });
      article.append(frame);
    }
    article.append(lift(words, { extraClass: 'n-pieces__words' }));
    return article;
  }

  /**
   * AFTER THE RELEASES (plan LIVE RELEASE+, choice 11): one block per question open, each answered in one tap and kept
   * here as answered. Nothing when none is open.
   */
  private questionsBlock(): HTMLElement | null {
    if (this.questions.length === 0) return null;
    const blocks = this.questions.map((q) => {
      let block = this.questionBlocks.get(q.dropId);
      if (!block) {
        block = new QuestionBlock({
          api: this.deps.api,
          session: this.deps.session,
          localZone: this.deps.localZone ?? 'UTC',
          tone: 'vault',
          named: true,
          onAnswered: (next) => {
            const at = this.questions.findIndex((x) => x.dropId === next.dropId);
            if (at >= 0) this.questions[at] = next;
          },
        });
        this.questionBlocks.set(q.dropId, block);
      }
      block.show(q);
      return block;
    });
    return h(
      'section',
      { class: 'n-px n-sec pieces__questions', attrs: { 'aria-labelledby': 'pieces-questions' } },
      h('h2', { class: 'n-g n-t3', id: 'pieces-questions', text: QUESTION.piecesTitle }),
      h('p', { class: 'n-tx n-pieces__section-lead pieces__questions-lead', text: QUESTION.piecesLead }),
      h('ul', { class: 'pieces__question-list' }, ...blocks.map((b) => h('li', { class: 'pieces__question' }, b.el))),
    );
  }

  /**
   * EARLY ACCESS (P-X02): the privilege of PLATINE and PALLADIUM recalled, for an account that holds no piece only (from
   * TITANE up, YOUR TIER in the account sheet says it).
   */
  private earlyBlock(): HTMLElement | null {
    if (this.tier !== 0) return null;
    return h(
      'section',
      { class: 'n-px n-sec pieces__early', attrs: { 'aria-labelledby': 'pieces-early' } },
      h('h2', { class: 'n-g n-t3', id: 'pieces-early', text: RELEASES.earlyAccess.label }),
      h('p', { class: 'n-tx n-pieces__section-lead pieces__early-text', text: RELEASES.earlyAccess.recall }),
    );
  }

  /**
   * ADD A PIECE (C3): scan it, then register it from its result; SCAN ORBES CODE, the hairline button. Without a piece,
   * the page's own sentence has just said how (PIECES.empty): it is not said twice.
   */
  private addBlock(empty: boolean): HTMLElement {
    return h(
      'section',
      { class: 'n-px n-sec n-pieces__add', attrs: { 'aria-labelledby': 'pieces-add' } },
      h('h2', { class: 'n-g n-t3', id: 'pieces-add', text: PIECES.add }),
      empty ? null : h('p', { class: 'n-tx n-pieces__section-lead', text: PIECES.addLead }),
      h('button', { class: 'n-g n-btn n-btn--ol n-pieces__scan', attrs: { type: 'button' }, on: { click: () => this.deps.onScan() } }, icon('scan'), PIECES.scan),
    );
  }

  // ── ORDERS ───────────────────────────────────────────────────────────────

  private ordersPanel(orders: OrderModel[] | null): HTMLElement[] {
    if (orders === null) return [h('div', { class: 'n-px n-pieces__quiet' }, h('p', { class: 'n-sm n-pieces__failed', attrs: { role: 'alert' }, text: ORDERS.loadFailed }))];
    const deps = { api: this.deps.api, session: this.deps.session };
    return [h('div', { class: 'n-pieces__orders' }, ...orders.map((m) => orderCard(m, deps)))];
  }

  /** ORDER OR-… opened from a piece's page: its order in view, its heading focused. */
  private revealOrder(): void {
    const reference = this.order;
    if (!reference || !this.onScreen || this.tab !== 'orders' || this.load.kind !== 'ready') return;
    this.order = null;
    const card = this.root.querySelector<HTMLElement>(`[data-order="${CSS.escape(reference)}"]`);
    const heading = card?.querySelector<HTMLElement>('h2');
    if (!card || !heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'start' });
  }

  // ── RELEASES ─────────────────────────────────────────────────────────────

  /**
   * YOUR RELEASES (P-R03; C31): each entry of the account, its release a link to its page, what it means now (a place
   * held until a time, then the contact of ORBES Client Services, who send no email) and its id, the one the draw
   * publishes.
   */
  private releasesPanel(items: MyEntryModel[] | null): HTMLElement {
    if (items === null) return h('div', { class: 'n-px n-pieces__quiet' }, h('p', { class: 'n-sm n-pieces__failed', attrs: { role: 'alert' }, text: RELEASES.entryFailed }));
    return h(
      'section',
      { class: 'n-px n-pieces__entries pieces__releases', attrs: { 'aria-label': RELEASES.yourEntries } },
      ...items.map((m) => this.entryBlock(m)),
    );
  }

  private entryBlock(m: MyEntryModel): HTMLElement {
    const open = m.afterRoomOf ? this.deps.onAfterRoom : this.deps.onRelease;
    const link = appAnchor(m.href, ['n-g', 'n-t3', 'n-ivc', 'n-u', 'n-pieces__entry-title', 'pieces__entry-title'], open ? () => open(m.afterRoomOf ?? m.dropId) : undefined, ...withNumerals(m.title));
    const write = m.entry.write;
    return h(
      'article',
      { class: 'n-pieces__entry pieces__entry-card', data: { status: m.entry.label ?? '' } },
      link,
      h('p', { class: 'n-g n-lb n-pieces__entry-line pieces__entry-state' }, ...withNumerals([m.stateLabel, m.entry.label].filter(Boolean).join(' · '))),
      h('p', { class: 'n-sm n-pieces__entry-line pieces__entry-sentence', text: m.entry.sentence }),
      // The entry's id as the draw publishes it (and hashes it): in the reading face and in lower case, to be compared
      // by eye with the draw's list, never in the label's capitals.
      m.entry.entryId ? h('p', { class: 'n-g n-lb n-pieces__entry-line' }, RELEASES.entryId(''), h('span', { class: 'n-num n-pieces__entry-id pieces__entry-id', text: m.entry.entryId })) : null,
      m.entry.reference ? h('p', { class: 'n-g n-lb n-num n-pieces__entry-line pieces__entry-id' }, ...withNumerals(m.entry.reference)) : null,
      write ? writeButton(write) : null,
    );
  }
}

/** A state line: its words, the date after SINCE in the reading face's figures (`.num`). */
function stateWords(line: string): (string | HTMLElement)[] {
  const at = line.indexOf(' · ');
  if (at < 0) return [line];
  return [`${line.slice(0, at)} · `, h('span', { class: 'n-num n-nw', text: line.slice(at + 3) })];
}

// ── One order ──────────────────────────────────────────────────────────────

interface OrderDeps {
  api: ApiClient;
  session: SessionStore;
}

/**
 * One order of ORDERS (C24, C32): its model's photograph (addition 3), where it was sold, its model, its steps, what its
 * step means, its terms, once shipped the carrier, the number and TRACK THE SHIPMENT (the carrier's page in a new tab),
 * its reference, its documents (M6).
 */
function orderCard(m: OrderModel, deps: OrderDeps): HTMLElement {
  const titleId = `${m.key}-title`;
  const ended = m.status === 'CANCELLED' || m.status === 'RETURNED';
  const steps = orderSteps(
    m.steps.map((s) => ({ label: s.label, date: s.date || null, done: s.state !== 'next', current: s.state === 'current' })),
    // The bar runs along the way the order went: a cancelled order has none, a returned one runs to its end (C32).
    { label: ORDERS.stepsLabel, bar: m.status === 'CANCELLED' ? 'none' : m.status === 'RETURNED' ? 'end' : 'auto' },
  );
  steps.classList.add('n-pieces__steps');
  const rows = [...m.rows, ...(m.shipment?.rows ?? [])];
  const words: (HTMLElement | null)[] = [
    h('p', { class: 'n-g n-lb n-pieces__order-line' }, ...withNumerals(m.line)),
    h('h2', { class: 'n-g n-t2 n-pieces__order-title', id: titleId }, ...withNumerals(m.title)),
    steps,
    h('p', { class: 'n-tx n-pieces__order-sentence', text: m.sentence }),
    rows.length > 0 ? h('div', { class: 'n-pieces__order-rows' }, definitionList(rows, { kind: 'kv' })) : null,
    m.shipment?.href
      ? h(
          'p',
          { class: 'n-pieces__order-track' },
          h('a', { class: 'n-g n-tl pieces__order-track', attrs: { href: m.shipment.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': m.shipment.label }, text: ORDERS.track }),
        )
      : null,
    h('p', { class: 'n-g n-lb n-num n-pieces__order-reference' }, ...withNumerals(m.reference)),
    // WRITE TO ORBES CLIENT SERVICES, the order attached (CS-01), under its reference and before its documents.
    writeButton(orderContext({ id: m.id, model: m.title, modelVariant: m.modelVariant })),
    m.documents.length > 0 ? orderDocumentsBlock(m, deps) : null,
  ];
  const article = h('article', { class: ['n-pieces__order', ended ? 'is-ended' : null], attrs: { 'aria-labelledby': titleId }, data: { status: m.status, order: m.reference.replace(/^ORDER /, '') } });
  if (m.photo) {
    const frame = fadedPhoto(m.photo.src, m.photo.alt);
    frame.querySelector('img')?.addEventListener('error', () => {
      frame.remove();
      article.classList.add('n-pieces__order--bare');
    }, { once: true });
    article.append(frame, lift(words, { extraClass: 'n-pieces__words' }));
  } else {
    article.classList.add('n-pieces__order--bare');
    article.append(h('div', { class: 'n-px n-pieces__words' }, ...words));
  }
  return article;
}

/**
 * An order's DOCUMENTS (M6; C24, C32): rows that lead on (›) for INVOICE and CREDIT NOTE with their numbers and the
 * OWNERSHIP CERTIFICATE, each saving its PDF; CARE GUIDE a row that opens (+ / −) the model's care guide under it (read
 * once, on first opening; the house's general care text when the model has none). A document that cannot be read says
 * so under the rows, the others still work.
 */
function orderDocumentsBlock(m: OrderModel, deps: OrderDeps): HTMLElement {
  const D = ORDERS.documents;
  const titleId = `${m.key}-documents`;
  const careId = `${m.key}-care`;
  const error = h('p', { class: 'n-sm n-pieces__document-error pieces__order-document-error', attrs: { role: 'alert', hidden: true } });
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  const save = async (b: HTMLButtonElement, file: OrderDocumentKind) => {
    if (b.getAttribute('aria-busy') === 'true') return;
    b.setAttribute('aria-busy', 'true');
    error.hidden = true;
    try {
      saveDownload(await deps.api.orderDocument(m.id, file));
    } catch (e) {
      deps.session.noteError(e);
      fail(D.downloadFailed);
    } finally {
      b.setAttribute('aria-busy', 'false');
    }
  };
  const row = (d: OrderModel['documents'][number]): HTMLElement => {
    // The label in the display face, the number in the reading face; under it, PDF or what the guide is.
    const title = h('span', { class: 'n-g n-t3 n-ivc n-acc__title' }, d.label, ...(d.number ? [' ', h('span', { class: 'n-pieces__document-number n-num', text: d.number })] : []));
    const text = h('span', { class: 'n-acc__text' }, title, h('span', { class: 'n-sm n-acc__line', text: d.file === null ? d.ariaLabel : D.pdf }));
    if (d.file !== null) {
      const file = d.file;
      const b: HTMLButtonElement = h(
        'button',
        { class: 'n-acc n-pieces__document pieces__order-document', attrs: { type: 'button', 'aria-label': d.ariaLabel }, data: { document: d.kind }, on: { click: () => void save(b, file) } },
        text,
        icon('chev', { small: true }),
      );
      return b;
    }
    // CARE GUIDE: it opens under its row.
    const sign = h('span', { class: 'n-acc__sign' }, icon('plus', { small: true }));
    const care = h('div', { class: 'n-acc__panel n-pieces__care pieces__order-care', id: careId, attrs: { hidden: true } });
    let careText: string | null = null;
    const b: HTMLButtonElement = h(
      'button',
      { class: 'n-acc n-pieces__document pieces__order-document', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': careId }, data: { document: d.kind } },
      text,
      sign,
    );
    const draw = (open: boolean) => {
      b.setAttribute('aria-expanded', String(open));
      care.hidden = !open;
      sign.replaceChildren(icon(open ? 'minus' : 'plus', { small: true }));
    };
    b.addEventListener('click', () => {
      void (async () => {
        if (b.getAttribute('aria-expanded') === 'true') return draw(false);
        if (careText === null) {
          if (b.getAttribute('aria-busy') === 'true') return;
          b.setAttribute('aria-busy', 'true');
          error.hidden = true;
          try {
            const g = await deps.api.orderCareGuide(m.id);
            careText = g.text && g.text.trim() ? g.text.trim() : DEFAULT_CARE;
          } catch (e) {
            deps.session.noteError(e);
            fail(D.careFailed);
            return;
          } finally {
            b.setAttribute('aria-busy', 'false');
          }
          care.replaceChildren(h('p', { class: 'n-tx n-pieces__care-text pieces__order-care-text', text: careText }));
        }
        draw(true);
      })();
    });
    return h('div', { class: 'n-acc-item' }, b, care);
  };
  return h(
    'div',
    { class: 'n-pieces__documents', attrs: { role: 'group', 'aria-labelledby': titleId } },
    h('h3', { class: 'n-g n-t3 n-pieces__documents-title', id: titleId, text: D.title }),
    h('div', { class: 'n-pieces__document-list' }, ...m.documents.map(row)),
    error,
  );
}
