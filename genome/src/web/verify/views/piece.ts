/**
 * A piece of MY PIECES (/verify/pieces/<product id>; plan NOCTURNE, screen 4: C4, C35), centred, in NOCTURNE's pieces.
 *
 *   ‹ MY PIECES                                 the crumb back to the list
 *   [ THE MODEL's photograph ]                  full width, shown whole (never the piece's own, decision 9)
 *   THE MODEL                                   its caption, then the app's sentence for it
 *   Photographed by ORBES. Compare it with the piece in your hands.
 *              MONOLITHE                        the model's name
 *   BRACELET / JEWELRY / 18K YELLOW GOLD / SIZE 17 / CREATED 2026      its lines, its size among them (addition 1)
 *            SEE THE MODEL                      its sheet in THE COLLECTION, when the model is PUBLIC there
 *         ✓ REGISTERED TO YOU                   its state: or REPORTED LOST, REPORTED STOLEN, TRANSFER PENDING, IN SERVICE
 *   WHERE IT COMES FROM                         addition 2: its release (its page) and its order (ORDERS, the order in
 *     THE DRAW OF 14 SEPTEMBER   ›              view), from the order of the account the piece fulfils; nothing for a
 *     ORDER OR-7C21A9F0          ›              piece without one (a boutique sale)
 *            GENOME                             its GENOME in ivory, the ORBES monogram at its centre (decision 12)
 *   OWNERSHIP  ORBES CARE  SERVICE              underlined tabs (`.tabsx`; plan ORBES CARE §2(a), answer 6)
 *     ACQUIRED · OWNERSHIP · SINCE · TRANSFER   the facts of its ownership; a transfer under way and CANCEL TRANSFER
 *     OWNERSHIP CERTIFICATE                     (F-06) CREATE CERTIFICATE, 7 · 30 · 90 DAYS, then CREATE LINK; the link
 *                                               shown once, COPY LINK, OPEN LINK; the open links, each with WITHDRAW
 *     REPORT LOST / STOLEN                      confirmed: LOST · STOLEN, then CONFIRM REPORT; reported lost by the
 *                                               owner: PIECE FOUND, confirmed with the account's password; a theft or a
 *                                               loss ORBES Client Services recorded, or a piece the server would refuse
 *                                               to report: their sentence
 *     WRITE TO ORBES CLIENT SERVICES            the write sheet, the piece attached (plan NEXT-NINE, CS-01)
 *     ORBES CARE: WARRANTY (C35: STATUS, FROM, UNTIL and its sentence), the WARRANTY CLAIM while one is under way
 *     (views/warranty-claim.ts), PRIVATE CARE (plan NEXT-NINE, BP-19 T6: views/yearly-care.ts; or the tier it opens
 *     from), CARING FOR THIS PIECE, then the contact sentence and WRITE TO ORBES CLIENT SERVICES, the piece attached;
 *     SERVICE: SERVICE HISTORY, each service
 *
 * Signed out, the OWNERSHIP panel's sign-in forms stand alone, as on MY PIECES; a piece the account does not hold (an
 * address that is none, a piece passed on) gives way to MY PIECES (`onMissing`).
 *
 * After a report, a withdrawal or a cancelled transfer, the piece is read again (GET /api/v1/account/products): the
 * status it returned to is the server's (a loss declared during a service returns to IN SERVICE), never guessed.
 */
import { isDesktop } from '../../shared/desktop.js';
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { ownerCertificateLine } from '../certificate-model.js';
import { LOOKBOOK, ORBES_CARE, PIECES, RELEASES } from '../copy.js';
import { nocturneGenome } from '../genome-view.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import { PIECE_TAB_LABELS, PIECE_TABS, pieceModel, serviceRows, type PieceModel, type PieceTabId } from '../pieces-model.js';
import type { SessionStore } from '../session.js';
import type { CertificateOffer, ClientServices, IncidentType, OwnedPiece, OwnerCertificate, ServiceRecord } from '../types.js';
import { formatDate, recoveryContactModel } from '../view-model.js';
import { pieceContext } from '../messages-model.js';
import { listLine, orderPagePath, PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { FormError, messageOf, nocturneForm } from './forms.js';
import { accLink, appAnchor, button, definitionList, failedState, field, icon, loadingState, textLink } from './nocturne.js';
import { writeButton } from './write.js';
import { WarrantyClaimBlock } from './warranty-claim.js';
import { YearlyCareBlock } from './yearly-care.js';
import { OwnershipPanel } from './ownership.js';
import { modelPhoto } from './result.js';
import { tabsView } from './tabs.js';

export interface PieceDeps {
  api: ApiClient;
  session: SessionStore;
  /** The piece's id, from its address. */
  productId: string;
  /** The tab it opens on (OWNERSHIP by default; ORBES CARE from a house message's CARING FOR YOUR PIECE, lot M2). */
  tab?: PieceTabId;
  /** How ORBES Client Services is reached (`{}` when not configured); never rejects, never more than a second late. */
  clientServices(): Promise<ClientServices>;
  /** ‹ MY PIECES. */
  onPieces(): void;
  /** The account holds no such piece: MY PIECES in its place. */
  onMissing(): void;
  /** SEE THE RELEASE (WHERE IT COMES FROM): the release's page. */
  onRelease?(id: string): void;
  /** ORDER OR-… (WHERE IT COMES FROM): ORDERS of MY PIECES, the order in view. */
  onOrder?(reference: string): void;
  /** SEE THE MODEL: its sheet in THE COLLECTION. */
  onModel?(slug: string): void;
  onScan(): void;
}

export interface PieceView {
  root: HTMLElement;
  dispose(): void;
}

export function pieceView(deps: PieceDeps): PieceView {
  const page = new PiecePage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

type Load = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };

class PiecePage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'n-piece__body' });
  private unsubscribe: (() => void) | null;
  private disposed = false;
  private ready = false;
  private contacts: ClientServices = {};
  private signIn: OwnershipPanel | null = null;
  private card: PieceCard | null = null;
  private load: Load = { kind: 'idle' };
  private loadGen = 0;
  private email: string | null = null;

  constructor(private readonly deps: PieceDeps) {
    this.root = viewRoot('piece', 'piece-title');
    this.root.classList.add('n-piece');
    const crumb = appAnchor(PIECES_PATH, ['n-g', 'n-crumb', 'n-piece__crumb'], () => deps.onPieces(), icon('back', { small: true }), PIECES.back);
    this.root.append(crumb, this.body);
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
      const fromForm = this.signIn !== null;
      this.signIn?.dispose();
      this.signIn = null;
      if (this.email !== s.account.email || this.load.kind === 'idle') {
        this.email = s.account.email;
        void this.loadPiece(fromForm);
      }
    } else {
      this.email = null;
      this.loadGen++;
      this.load = { kind: 'idle' };
      this.card = null;
      this.signIn ??= new OwnershipPanel(
        { kind: 'account' },
        { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan(), contact: recoveryContactModel(this.contacts, '') ?? undefined },
      );
    }
    this.render();
  }

  private async loadPiece(focusTitle: boolean): Promise<void> {
    const gen = ++this.loadGen;
    this.load = { kind: 'loading' };
    this.render();
    try {
      // Its open certificate links with it (F-06); without them, the piece still shows, and its section says so.
      const [list, certificates] = await Promise.all([
        this.deps.api.products(),
        this.deps.api.certificates().catch((e: unknown) => {
          this.deps.session.noteError(e);
          return null;
        }),
      ]);
      if (gen !== this.loadGen || this.disposed) return;
      const piece = list.find((p) => p.productId.toUpperCase() === this.deps.productId.toUpperCase());
      if (!piece) {
        this.deps.onMissing();
        return;
      }
      this.card = new PieceCard(piece, {
        api: this.deps.api,
        session: this.deps.session,
        contacts: this.contacts,
        certificates: certificates === null ? null : certificates.filter((c) => c.productId === piece.productId),
        onRelease: this.deps.onRelease,
        onOrder: this.deps.onOrder,
        onModel: this.deps.onModel,
        tab: this.deps.tab,
      });
      this.load = { kind: 'ready' };
    } catch (e) {
      if (gen !== this.loadGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
    if (focusTitle) this.root.querySelector<HTMLElement>('#piece-title')?.focus({ preventScroll: true });
  }

  private render(): void {
    if (!this.ready) {
      this.body.replaceChildren(loadingState(PIECES.loading, { extraClass: 'n-piece__waiting' }));
      return;
    }
    if (this.deps.session.state.status !== 'signed-in') {
      this.body.replaceChildren(
        h('div', { class: 'n-px n-piece__signin' }, h('h1', { class: 'n-g n-t1', id: 'piece-title', text: PIECES.title })),
        ...(this.signIn ? [h('div', { class: 'pieces__signin' }, this.signIn.root)] : []),
      );
      return;
    }
    if (this.load.kind === 'ready' && this.card) this.body.replaceChildren(this.card.root);
    else if (this.load.kind === 'failed')
      this.body.replaceChildren(h('div', { class: 'n-px n-piece__failed' }, failedState({ sentence: PIECES.loadFailed, reason: this.load.message, retry: PIECES.retry, onRetry: () => void this.loadPiece(true) })));
    else this.body.replaceChildren(loadingState(PIECES.loading, { extraClass: 'n-piece__waiting' }));
  }
}

// ── The piece ──────────────────────────────────────────────────────────────

interface CardDeps {
  api: ApiClient;
  session: SessionStore;
  contacts: ClientServices;
  /** The piece's open certificate links, newest first; null when they could not be read. */
  certificates: OwnerCertificate[] | null;
  onRelease?(id: string): void;
  onOrder?(reference: string): void;
  onModel?(slug: string): void;
  tab?: PieceTabId;
}

type Confirm = null | 'report' | 'found';

/** How long a new certificate link stays valid: the choice a piece offers (the server takes 1 to 90 days). */
export const CERTIFICATE_DAYS = [7, 30, 90] as const;
type CertificateDays = (typeof CERTIFICATE_DAYS)[number];

/** The piece's page under its crumb. The OWNERSHIP panel and the state line are drawn again on each change. */
class PieceCard {
  readonly root: HTMLElement;
  private model: PieceModel;
  private readonly stateLine = h('p', { class: 'n-ctr n-piece__state-line' });
  private readonly panel = h('div', { class: 'n-piece__panel n-piece__ownership piece__ownership' });
  private confirm: Confirm = null;
  private choice: IncidentType | null = null;
  private busy = false;
  private error: string | null = null;
  private notice: string | null = null;
  private services: { kind: 'loading' } | { kind: 'ready'; list: ServiceRecord[] } | { kind: 'failed'; message: string } | null = null;
  private readonly servicePanel = h('div', { class: 'n-piece__panel' });
  /** PRIVATE CARE (BP-19 T6) in ORBES CARE: drawn when the tier includes it (or the tier it opens from), or a request of the piece is open. */
  private readonly yearlyCare: YearlyCareBlock;
  /** The piece's WARRANTY CLAIM in ORBES CARE (plan ORBES CARE, answer 9), read with PRIVATE CARE's status. */
  private readonly claim: WarrantyClaimBlock;
  private certificates: OwnerCertificate[] | null;
  private offer: CertificateOffer | null = null;
  private creating = false;
  private days: CertificateDays = 30;
  private certificateError: string | null = null;

  constructor(
    private piece: OwnedPiece,
    private readonly deps: CardDeps,
  ) {
    this.model = pieceModel(piece);
    this.certificates = deps.certificates;
    this.claim = new WarrantyClaimBlock({ api: deps.api, session: deps.session });
    this.yearlyCare = new YearlyCareBlock({ api: deps.api, session: deps.session, productId: piece.productId, onCare: (care) => this.claim.show(care?.claim ?? null) });
    const m = this.model;
    const key = m.key || 'piece';
    const slug = m.lookbook;
    const lines = h(
      'section',
      { class: 'n-ctr n-result__lines n-piece__lines', attrs: { 'aria-label': 'The piece' } },
      h('h1', { class: 'n-g n-t1 n-result__name', id: 'piece-title', attrs: { tabindex: -1 } }, ...withNumerals(m.name)),
      // Plan NEXT LOT §3.1: the model's variant on its own line, right under its name, in the style of the lines.
      m.variant ? h('p', { class: 'n-g n-lines__line piece__variant' }, ...withNumerals(m.variant)) : null,
      h('ul', { class: 'n-lines n-result__line-list piece__lines' }, ...m.pieceLines.map((line) => h('li', { class: 'n-g n-lines__line' }, ...withNumerals(line)))),
      slug ? h('p', { class: 'n-result__model-line' }, textLink(LOOKBOOK.seeModel, { href: lookbookSheetPath(slug), onOpen: deps.onModel ? () => deps.onModel!(slug) : undefined, extraClass: 'n-piece__model-link' })) : null,
    );
    const tabs = tabsView<PieceTabId>(PIECE_TABS, (id) => this.build(id), deps.tab ?? 'ownership', {
      labels: PIECE_TAB_LABELS,
      idPrefix: `${key}-`,
      label: `${m.productId} information`,
      kind: 'tabsx',
    });
    tabs.root.classList.add('n-px', 'n-piece__tabs');
    this.root = h(
      'article',
      { class: 'n-piece__article piece', attrs: { 'aria-labelledby': 'piece-title' }, data: { piece: m.productId } },
      modelPhoto(m.photos, { extraClass: 'n-piece__photo' }),
      lines,
      this.stateLine,
      this.originBlock(),
      m.genome ? nocturneGenome(m.genome, { extraClass: 'n-piece__genome' }) : null,
      tabs.root,
    );
    this.render();
  }

  /** WHERE IT COMES FROM (addition 2, C4): its release, a link to its page; its order, ORDERS with it in view. */
  private originBlock(): HTMLElement | null {
    const o = this.model.origin;
    if (!o) return null;
    const release = o.release;
    return h(
      'section',
      { class: 'n-px n-piece__origin', attrs: { 'aria-labelledby': 'piece-origin' } },
      h('h2', { class: 'n-g n-lb', id: 'piece-origin', text: PIECES.origin.label }),
      h(
        'div',
        { class: 'n-piece__origin-rows' },
        release
          ? accLink(h('span', null, ...withNumerals(release.title)), {
              line: RELEASES.see,
              lineKind: 'lb',
              href: release.href,
              onOpen: this.deps.onRelease ? () => this.deps.onRelease!(release.id) : undefined,
              extraClass: 'n-piece__origin-release',
            })
          : null,
        accLink(h('span', { class: 'n-num' }, ...withNumerals(o.order.title)), {
          line: h('span', null, ...withNumerals(o.order.line)),
          lineKind: 'lb',
          // Desktop (decision 5): on a computer the order's own page.
          href: isDesktop() ? orderPagePath(o.order.reference) : PIECES_PATH,
          onOpen: this.deps.onOrder ? () => this.deps.onOrder!(o.order.reference) : undefined,
          extraClass: 'n-piece__origin-order',
        }),
      ),
    );
  }

  private build(id: PieceTabId): HTMLElement {
    switch (id) {
      case 'ownership':
        return this.panel;
      case 'care':
        void this.yearlyCare.load();
        return this.orbesCarePanel();
      case 'service':
        if (this.services === null) void this.loadServices();
        return this.servicePanel;
    }
  }

  // ── ORBES CARE, SERVICE (C35; plan ORBES CARE §2(a)) ─────────────────────

  /**
   * ORBES CARE (answers 1, 6 and 9), in this order: WARRANTY, its rows and its sentence; the WARRANTY CLAIM while one is
   * under way; PRIVATE CARE (or the tier it opens from); CARING FOR THIS PIECE, the care of its model; then how to reach
   * ORBES Client Services and WRITE TO ORBES CLIENT SERVICES, the piece attached, as on OWNERSHIP.
   */
  private orbesCarePanel(): HTMLElement {
    const m = this.model;
    const key = m.key || 'piece';
    const w = m.warranty;
    return h(
      'div',
      { class: 'n-piece__panel n-piece__care piece__care' },
      h(
        'section',
        { class: 'n-piece__care-section n-piece__warranty piece__warranty', attrs: { 'aria-labelledby': `${key}-warranty` } },
        h('h3', { class: 'n-g n-lb', id: `${key}-warranty`, text: ORBES_CARE.warranty.label }),
        // CARE-C2: a piece its claim closed reads one calm line (its head, its sentence), never NO LONGER VALID.
        ...(m.closed
          ? [h('p', { class: 'n-g n-t3 n-ivc n-piece__warranty-closed', text: m.closed.head }), h('p', { class: 'n-tx n-piece__note', text: m.closed.text })]
          : w
            ? [definitionList(w.rows, { kind: 'kv', extraClass: 'n-piece__warranty-rows' }), h('p', { class: 'n-tx n-piece__note', text: w.note })]
            : [h('p', { class: 'n-tx n-piece__note', text: ORBES_CARE.warranty.none })]),
      ),
      this.claim.root,
      this.yearlyCare.root,
      h(
        'section',
        { class: 'n-piece__care-guide', attrs: { 'aria-labelledby': `${key}-care-guide` } },
        h('h3', { class: 'n-g n-lb', id: `${key}-care-guide`, text: ORBES_CARE.careLabel }),
        h('p', { class: 'n-tx n-piece__care-text piece__care-text', text: m.care }),
      ),
      h('p', { class: 'n-tx n-piece__care-contact', text: ORBES_CARE.contact }),
      writeButton(pieceContext(this.piece)),
    );
  }

  private async loadServices(): Promise<void> {
    this.services = { kind: 'loading' };
    this.renderServices();
    try {
      this.services = { kind: 'ready', list: await this.deps.api.serviceHistory(this.model.productId) };
    } catch (e) {
      this.deps.session.noteError(e);
      this.services = { kind: 'failed', message: messageOf(e) };
    }
    this.renderServices();
  }

  /** SERVICE HISTORY (C35, state 2): each service, its dates and its place, then its kind; or that none is recorded. */
  private renderServices(): void {
    const s = this.services;
    const hadFocus = this.servicePanel.contains(document.activeElement);
    const out: HTMLElement[] = [h('h3', { class: 'n-g n-lb', text: PIECES.services })];
    if (!s || s.kind === 'loading') out.push(h('p', { class: 'n-sm n-piece__service-wait', attrs: { 'aria-busy': 'true' }, text: PIECES.loading }));
    else if (s.kind === 'failed') {
      out.push(
        h('p', { class: 'n-sm n-ivc n-piece__service-error', attrs: { role: 'alert' }, text: `${PIECES.serviceFailed} ${s.message}` }),
        h('p', { class: 'n-piece__action-line' }, textLink(PIECES.retry, { onOpen: () => void this.loadServices() })),
      );
    } else if (s.list.length === 0) out.push(h('p', { class: 'n-sm n-piece__service-none', text: PIECES.noService }));
    else
      out.push(
        h(
          'ul',
          { class: 'n-piece__services' },
          ...serviceRows(s.list).map(([kind, when]) =>
            h('li', { class: 'n-piece__service' }, h('p', { class: 'n-g n-t3 n-ivc n-num' }, ...withNumerals(when)), h('p', { class: 'n-g n-lb n-piece__service-kind', text: kind })),
          ),
        ),
      );
    this.servicePanel.replaceChildren(...out);
    if (hadFocus && !this.servicePanel.contains(document.activeElement)) this.servicePanel.closest<HTMLElement>('[role="tabpanel"]')?.focus({ preventScroll: true });
  }

  // ── OWNERSHIP ────────────────────────────────────────────────────────────

  /**
   * Draw the state line and the panel again. `focus` moves the keyboard focus after a step: the incident's heading (a
   * report or its withdrawal done, its new status), the heading of a confirmation, the action that opened it (CANCEL),
   * or the confirmation's button (a refusal).
   */
  private render(focus: 'status' | 'title' | 'action' | 'retry' | null = null): void {
    const m = this.model;
    this.stateLine.replaceChildren(h('span', { class: 'n-state n-piece__state' }, m.registered ? icon('check', { small: true }) : null, m.status));
    const hadFocus = this.panel.contains(document.activeElement);
    const facts: (HTMLElement | null)[] = [definitionList(m.ownershipRows, { kind: 'kv', extraClass: 'n-piece__rows' }), ...m.ownershipNotes.map((n) => this.small(n))];
    if (m.transferPending && this.confirm === null) facts.push(this.actionLine(this.outline(PIECES.cancelTransfer, () => this.cancelTransfer(), 'piece__transfer-action')));
    const actions: (HTMLElement | null)[] = [];
    const notice = this.notice ? h('p', { class: 'n-sm n-ivc n-piece__notice', attrs: { role: 'status' }, text: this.notice }) : null;
    // A piece reported lost or stolen, revoked or retired takes no certificate (the server refuses one): no section.
    const certificate = m.certificateOffered && this.confirm === null;
    // Desktop (BRIEF §10.4): a link's notice (copied, withdrawn) stands in the certificate's block, under what
    // it answers, not under the report; a phone keeps every notice at the panel's foot.
    const ofCertificate = certificate && isDesktop() && (this.notice === PIECES.copied || this.notice === PIECES.withdrawn);
    if (certificate) actions.push(...this.certificateBlock(ofCertificate ? notice : null));
    actions.push(...this.incidentBlock());
    if (!ofCertificate) actions.push(notice);
    const write = writeButton(pieceContext(this.piece));
    const kept = (list: (HTMLElement | null)[]) => list.filter((x): x is HTMLElement => x !== null);
    // Desktop (BRIEF §10.22): the facts and WRITE TO ORBES CLIENT SERVICES on the left, the certificate and the
    // report on the right (shared/desktop.css); a phone keeps one column in this order.
    if (isDesktop()) this.panel.replaceChildren(h('div', { class: 'd-own__facts' }, ...kept(facts), write), h('div', { class: 'd-own__actions' }, ...kept(actions)));
    else this.panel.replaceChildren(...kept([...facts, ...actions, write]));
    const q = (sel: string) => this.panel.querySelector<HTMLElement>(sel);
    let target: HTMLElement | null = null;
    if (focus === 'status' || focus === 'title') target = q('.n-piece__incident-title');
    else if (focus === 'action') target = q('.piece__incident-action');
    else if (focus === 'retry') target = q('.n-btn:not([disabled]):not(.n-btn--ol)') ?? q('button:not([disabled])');
    // A re-render replaced the focused control (busy): keep keyboard and screen-reader users in the panel.
    else if (hadFocus && !this.panel.contains(document.activeElement)) target = q('.n-piece__incident-title');
    target?.focus({ preventScroll: focus === null });
  }

  /** Loss and theft (C4; C35, states 5 to 7): report, withdraw a loss of one's own, or reach ORBES Client Services. */
  private incidentBlock(): (HTMLElement | null)[] {
    const m = this.model;
    const inc = m.incident;
    const title = (text: string) => h('h3', { class: 'n-g n-t3 n-ivc n-piece__heading n-piece__incident-title', attrs: { tabindex: -1 }, text });
    if (inc.kind === 'with-services') return [title(m.status), this.small(PIECES.withClientServices[inc.type])];
    if (inc.kind === 'not-reportable') return [title(PIECES.reportTitle), this.small(PIECES.notReportable, true)];
    if (inc.kind === 'found') {
      // C35, state 6: REPORTED LOST, its sentences 8 px apart, then the password and CONFIRM · CANCEL.
      if (this.confirm !== 'found') return [title(m.status), this.small(PIECES.lostByYou), this.actionLine(this.outline(PIECES.found, () => this.open('found'), 'piece__incident-action'))];
      return [title(m.status), this.small(PIECES.lostByYou), this.small(PIECES.foundLead), this.foundForm()];
    }
    if (this.confirm !== 'report') return [title(PIECES.reportTitle), this.small(PIECES.reportLead, true), this.actionLine(this.outline(PIECES.report, () => this.open('report'), 'piece__incident-action'))];
    const option = (type: IncidentType, label: string) =>
      h('button', {
        class: ['n-g', 'n-btn', this.choice === type ? null : 'n-btn--ol', 'n-piece__option'],
        attrs: { type: 'button', 'aria-pressed': this.choice === type ? 'true' : 'false', disabled: this.busy },
        data: { incident: type },
        on: { click: () => this.choose(type) },
        text: label,
      });
    return [
      title(PIECES.reportTitle),
      h('div', { class: 'n-duo n-piece__choice piece__choice', attrs: { role: 'group', 'aria-label': PIECES.reportChoice } }, option('LOST', PIECES.lost), option('STOLEN', PIECES.stolen)),
      this.choice ? this.small(PIECES.reportHow[this.choice], true) : null,
      this.small(PIECES.reportEffect, !this.choice),
      this.errorLine(this.error),
      h('div', { class: 'n-duo n-piece__duo' }, this.filled(PIECES.confirmReport, () => this.report()), this.outline(PIECES.cancel, () => this.close())),
    ];
  }

  /**
   * OWNERSHIP CERTIFICATE (F-06; C4, C35 state 4): a link to the live record of the piece, for a buyer or an insurer.
   * CREATE CERTIFICATE opens the choice of its validity (7 · 30 · 90 DAYS) and CREATE LINK; the link is then shown once,
   * with COPY LINK and OPEN LINK; each open link has WITHDRAW.
   */
  private certificateBlock(notice: HTMLElement | null = null): (HTMLElement | null)[] {
    // COPY LINK answered under its pair, in the link's block; WITHDRAW (its row gone) under CREATE CERTIFICATE.
    const underLink = notice !== null && this.offer !== null && this.notice === PIECES.copied;
    const out: (HTMLElement | null)[] = [
      h('h3', { class: 'n-g n-t3 n-piece__heading n-piece__heading--first piece__certificate-title', attrs: { tabindex: -1 }, text: PIECES.certificateTitle }),
      this.small(PIECES.certificateLead, true),
    ];
    const offer = this.offer;
    if (offer) {
      out.push(
        h(
          'div',
          { class: 'n-piece__link certificate-link' },
          h('p', { class: 'n-g n-lb certificate-link__label' }, `${PIECES.certificateLink} · `, h('span', { class: 'n-num certificate-link__label', text: PIECES.certificateUntil(formatDate(offer.expiresAt)) })),
          h('p', { class: 'n-sm n-num n-ivc n-piece__link-value certificate-link__value', text: offer.url }),
          this.small(PIECES.certificateShown),
          h(
            'div',
            { class: 'n-duo n-piece__duo' },
            this.filled(PIECES.copyLink, () => void this.copyLink(offer.url), 'certificate-link__copy'),
            h('a', { class: 'n-g n-btn n-btn--ol certificate-link__open', attrs: { href: offer.url, target: '_blank', rel: 'noopener noreferrer' }, text: PIECES.openLink }),
          ),
          underLink ? notice : null,
        ),
      );
    }
    if (this.certificates === null) {
      // The open links could not be read: said, with TRY AGAIN, for as long as they cannot (never an empty list).
      out.push(
        h('p', { class: 'n-sm n-ivc n-piece__error', attrs: { role: 'alert' }, text: PIECES.certificatesFailed }),
        h('p', { class: 'n-piece__action-line' }, this.textAction(PIECES.retry, () => void this.retryCertificates(), 'piece__certificates-retry')),
      );
    } else if (this.certificates.length > 0) {
      out.push(
        h(
          'ul',
          { class: 'n-piece__certificates piece__certificates', attrs: { 'aria-label': PIECES.certificateTitle } },
          ...this.certificates.map((c) =>
            h(
              'li',
              { class: 'n-kv__row n-piece__certificate piece__certificate' },
              // On a computer the line breaks between its values only (listLine): VALID UNTIL never parts from its date.
              h('span', { class: 'n-g n-kv__label n-num piece__certificate-line' }, ...listLine(ownerCertificateLine(c))),
              h('button', {
                class: 'n-g n-tl n-piece__withdraw piece__certificate-withdraw',
                attrs: { type: 'button', disabled: this.busy, 'aria-label': `${PIECES.withdraw} · ${ownerCertificateLine(c)}` },
                data: { certificate: c.id },
                on: { click: () => void this.withdraw(c.id) },
                text: PIECES.withdraw,
              }),
            ),
          ),
        ),
      );
    }
    if (!this.creating) {
      out.push(this.errorLine(this.certificateError), this.actionLine(this.outline(PIECES.createCertificate, () => this.openCertificate(), 'piece__certificate-action')), underLink ? null : notice);
      return out;
    }
    const option = (days: CertificateDays) =>
      h('button', {
        class: 'n-g n-opt2__option',
        attrs: { type: 'button', 'aria-pressed': this.days === days ? 'true' : 'false', disabled: this.busy },
        data: { days },
        on: { click: () => this.chooseDays(days) },
        text: PIECES.certificateDays[days],
      });
    out.push(
      h('div', { class: 'n-opt2 n-piece__validity piece__validity', attrs: { role: 'group', 'aria-label': PIECES.certificateValidity } }, ...CERTIFICATE_DAYS.map(option)),
      this.small(PIECES.certificateHow, true),
      this.errorLine(this.certificateError),
      h('div', { class: 'n-duo n-piece__duo' }, this.filled(PIECES.confirmCertificate, () => void this.createCertificate()), this.outline(PIECES.cancel, () => this.closeCertificate())),
      underLink ? null : notice,
    );
    return out;
  }

  /** Re-render, then put the keyboard focus on `selector` of the panel. */
  private renderFocus(selector: string): void {
    this.render();
    this.panel.querySelector<HTMLElement>(selector)?.focus();
  }

  private openCertificate(): void {
    this.creating = true;
    this.certificateError = null;
    this.notice = null;
    this.renderFocus('.piece__validity [aria-pressed="true"]');
  }

  private closeCertificate(): void {
    this.creating = false;
    this.certificateError = null;
    this.renderFocus('.piece__certificate-action');
  }

  private chooseDays(days: CertificateDays): void {
    this.days = days;
    this.renderFocus(`.piece__validity [data-days="${days}"]`);
  }

  /** The piece's open links as the server lists them now, newest first; null when they cannot be read. */
  private async readCertificates(): Promise<OwnerCertificate[] | null> {
    try {
      return (await this.deps.api.certificates()).filter((c) => c.productId === this.piece.productId);
    } catch (e) {
      this.deps.session.noteError(e);
      return null;
    }
  }

  /** TRY AGAIN under a list that could not be read: read it again; the alert stays while it still cannot be. */
  private async retryCertificates(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.notice = null;
    this.render();
    try {
      this.certificates = await this.readCertificates();
    } finally {
      this.busy = false;
    }
    this.renderFocus(this.certificates === null ? '.piece__certificates-retry' : '.piece__certificate-title');
  }

  /**
   * CREATE LINK: the link, shown once, then COPY LINK takes the focus; the list is read again, the new link in it. A
   * list that could not be read before stays unread (its alert and TRY AGAIN) until it can be: shown as the new link
   * alone, it would hide the others, which could then not be withdrawn.
   */
  private async createCertificate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.certificateError = null;
    this.notice = null;
    this.render();
    let ok = false;
    try {
      const offer = await this.deps.api.createCertificate(this.model.productId, this.days);
      this.offer = offer;
      this.creating = false;
      ok = true;
      const made: OwnerCertificate = { id: offer.id, productId: offer.productId, createdAt: offer.createdAt, expiresAt: offer.expiresAt, valid: true };
      const listed = await this.readCertificates();
      if (listed !== null) this.certificates = listed.some((c) => c.id === offer.id) ? listed : [made, ...listed];
      else if (this.certificates !== null) this.certificates = [made, ...this.certificates];
    } catch (e) {
      this.deps.session.noteError(e);
      this.certificateError = messageOf(e);
    } finally {
      this.busy = false;
    }
    this.renderFocus(ok ? '.certificate-link__copy' : '.n-piece__duo .n-btn:not(.n-btn--ol):not([disabled])');
  }

  private async copyLink(url: string): Promise<void> {
    this.certificateError = null;
    try {
      await navigator.clipboard.writeText(url);
      this.notice = PIECES.copied;
    } catch {
      this.certificateError = PIECES.copyFailed;
    }
    this.renderFocus('.certificate-link__copy');
  }

  /** WITHDRAW: from then on the link answers as one that never existed. */
  private async withdraw(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.certificateError = null;
    this.notice = null;
    this.render();
    try {
      await this.deps.api.revokeCertificate(id);
      this.certificates = (this.certificates ?? []).filter((c) => c.id !== id);
      if (this.offer?.id === id) this.offer = null;
      this.notice = PIECES.withdrawn;
    } catch (e) {
      this.deps.session.noteError(e);
      this.certificateError = messageOf(e);
    } finally {
      this.busy = false;
    }
    this.renderFocus('.piece__certificate-title');
  }

  // ── The panel's pieces ──

  /** A sentence of the panel (`.sm`); `first` under a heading (10 px), else under a sentence (8 px). */
  private small(text: string, first = false): HTMLElement {
    return h('p', { class: ['n-sm', 'n-piece__text', first ? 'n-piece__text--first' : null], text });
  }

  private actionLine(child: HTMLElement): HTMLElement {
    return h('div', { class: 'n-piece__action' }, child);
  }

  private errorLine(text: string | null): HTMLElement | null {
    return text ? h('p', { class: 'n-err n-piece__error', attrs: { role: 'alert' }, text }) : null;
  }

  /** The hairline button. */
  private outline(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
    return button(label, { outline: true, onClick, extraClass, attrs: { disabled: this.busy } });
  }

  /** The ivory button: the confirmation's one action. */
  private filled(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
    return button(label, { onClick, extraClass, attrs: { disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' } });
  }

  private textAction(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
    return textLink(label, { onOpen: onClick, extraClass }) as HTMLButtonElement;
  }

  private open(confirm: Exclude<Confirm, null>): void {
    this.confirm = confirm;
    this.choice = null;
    this.error = null;
    this.notice = null;
    this.render('title');
    // PIECE FOUND: the password, at once.
    if (confirm === 'found') this.panel.querySelector<HTMLElement>('input')?.focus();
  }

  private close(): void {
    this.confirm = null;
    this.choice = null;
    this.error = null;
    this.render('action');
  }

  private choose(type: IncidentType): void {
    this.choice = type;
    this.error = null;
    this.render();
    this.panel.querySelector<HTMLElement>(`.piece__choice [data-incident="${type}"]`)?.focus();
  }

  /**
   * After a change the server made: the piece as the server now holds it, read again (the status a withdrawal returns
   * it to is the server's). `guess`, the change as the page knows it, only when the list cannot be read just now.
   */
  private async refresh(guess: (p: OwnedPiece) => OwnedPiece): Promise<void> {
    let fresh: OwnedPiece | undefined;
    try {
      fresh = (await this.deps.api.products()).find((p) => p.productId === this.piece.productId);
    } catch (e) {
      this.deps.session.noteError(e);
    }
    this.piece = fresh ?? guess(this.piece);
    this.model = pieceModel(this.piece);
  }

  /** One request at a time; done, the piece is read again as the server now holds it, and its status takes the focus. */
  private async run(action: () => Promise<void>, notice: string, guess: (p: OwnedPiece) => OwnedPiece): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.render();
    let ok = false;
    try {
      await action();
      ok = true;
    } catch (e) {
      this.deps.session.noteError(e);
      this.error = messageOf(e);
    }
    try {
      if (ok) await this.done(notice, guess);
    } finally {
      this.busy = false;
    }
    this.render(ok ? 'status' : 'retry');
  }

  private async done(notice: string, guess: (p: OwnedPiece) => OwnedPiece): Promise<void> {
    await this.refresh(guess);
    this.confirm = null;
    this.choice = null;
    this.notice = notice;
  }

  /** REPORT LOST / STOLEN, once confirmed: every scan then shows UNUSUAL ACTIVITY, and a pending transfer is cancelled. */
  private report(): void {
    const type = this.choice;
    if (!type) {
      this.error = PIECES.chooseFirst;
      this.render();
      this.panel.querySelector<HTMLElement>('.piece__choice button')?.focus();
      return;
    }
    void this.run(
      async () => {
        await this.deps.api.reportIncident(this.model.productId, type);
        // Its certificate links end with the report (F-06): the server reads them NO LONGER VALID from now on.
        this.certificates = this.certificates?.map((c) => ({ ...c, valid: false })) ?? null;
        this.offer = null;
        this.creating = false;
      },
      PIECES.reported[type],
      (p) => ({ ...p, incident: type, incidentResolvable: type === 'LOST', incidentReportable: false, certificateAllowed: false, transfer: { pending: false } }),
    );
  }

  /**
   * PIECE FOUND, confirmed with the account's password (a session alone does not withdraw a report): the piece returns
   * to the status it held before the loss, read again from the server. A wrong password is said on its field (a 400,
   * never a 401: the session stays).
   */
  private foundForm(): HTMLFormElement {
    const password = h('input', { attrs: { type: 'password', name: 'current-password', autocomplete: 'current-password', required: true, maxlength: 1024 } });
    const cancel = this.outline(PIECES.cancel, () => this.close());
    const form = nocturneForm(
      this.deps.session,
      'found',
      [field(`${this.model.key || 'piece'}-found-password`, PIECES.foundPassword, password)],
      PIECES.confirmFound,
      async () => {
        if (!password.value) {
          password.setAttribute('aria-invalid', 'true');
          throw new FormError(PIECES.foundPasswordMissing);
        }
        if (this.busy) return;
        this.busy = true;
        try {
          try {
            await this.deps.api.resolveIncident(this.model.productId, password.value);
          } catch (e) {
            if (e instanceof ApiError && e.code === 'CURRENT_PASSWORD_INVALID') {
              password.value = '';
              password.setAttribute('aria-invalid', 'true');
            }
            throw e;
          }
          password.value = '';
          this.error = null;
          await this.done(PIECES.resolved, (p) => ({ ...p, incident: null, incidentResolvable: false, incidentReportable: true, certificateAllowed: true }));
        } finally {
          this.busy = false;
        }
        this.render('status');
      },
      cancel,
    );
    form.classList.add('n-piece__form');
    return form;
  }

  private cancelTransfer(): void {
    void this.run(() => this.deps.api.cancelTransfer(this.model.productId), PIECES.transferCancelled, (p) => ({ ...p, transfer: { pending: false } }));
  }
}
