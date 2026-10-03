/**
 * MY PIECES (F-01, /verify/pieces): the signed-in owner's pieces, each in its
 * écrin, an ivory plate framed by brackets, as the result shows a GENOME.
 *
 *              ORBES                         small wordmark
 *          M Y   P I E C E S                 the page's title
 *   The pieces registered to your ORBES account.
 *   ┌                      ┐
 *     GENOME  O26-J-00184                    the piece's title (h2)
 *     ◔ · ◯ · ◕ · …                          the glyphs in their orbit, around the SEAL
 *     G1-E1DC-BE52 · GENOME-01
 *   └                      ┘
 *   ┌                      ┐
 *     [ this piece ] [ model ]               the photographs ORBES holds (F-04),
 *   └                      ┘                 on ivory, as on an authentic result
 *   MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026
 *   OWNERSHIP · WARRANTY · SERVICE            tabs (the result's tablist)
 *     REGISTERED TO YOU · SINCE · ACQUIRED · OWNERSHIP · TRANSFER
 *     REPORT LOST / STOLEN  (confirmed: LOST · STOLEN, then CONFIRM REPORT;
 *                           a piece the server would refuse to report, revoked,
 *                           retired or flagged: ORBES Client Services instead)
 *     PIECE FOUND           (a loss the owner reported; confirmed with the
 *                           account's password)
 *     OWNERSHIP CERTIFICATE (F-06: CREATE CERTIFICATE, 7 · 30 · 90 DAYS, then
 *                           CREATE LINK; the link shown once, COPY LINK, OPEN;
 *                           the open links, each with WITHDRAW; read again
 *                           after a creation, TRY AGAIN while unreadable)
 *   ── next piece ──
 *   SIGNED IN AS …     CHANGE PASSWORD   SIGN OUT
 *            [ SCAN ORBES CODE ]
 *   PRIVACY · TERMS · LEGAL · HELP            the legal pages (J-06), in a new tab,
 *   IP Geolocation by DB-IP                   signed out too (the sign-in collects data)
 *
 * Signed out (a direct link, a reload after the session ended, the landing's
 * MY PIECES), the OWNERSHIP panel's sign-in forms stand alone (its account
 * mode), FORGOTTEN PASSWORD? included: an owner whose piece is gone reaches
 * the account without scanning it. A STOLEN, or a LOST ORBES Client Services
 * recorded, is theirs to withdraw: the panel then offers their contact.
 *
 * Every action is a same-origin JSON call through ApiClient (session cookie +
 * CSRF token); server messages are shown as they come. A 401 anywhere ends
 * the session on the page, which then offers the sign-in again. After a
 * report, a withdrawal or a cancelled transfer, the piece is read again
 * (GET /api/v1/account/products): the status it returned to is the server's
 * (a loss declared during a service returns to IN SERVICE), never guessed.
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { ownerCertificateLine } from '../certificate-model.js';
import { ACCOUNT_PASSWORD, PHOTOS, PIECES } from '../copy.js';
import { genomeBlock } from '../genome-view.js';
import { PIECE_TAB_LABELS, PIECE_TABS, pieceModel, serviceRows, type PieceModel, type PieceTabId } from '../pieces-model.js';
import type { SessionStore } from '../session.js';
import type { CertificateOffer, ClientServices, IncidentType, OwnedPiece, OwnerCertificate, ServiceRecord } from '../types.js';
import { formatDate, pieceContactModel, recoveryContactModel } from '../view-model.js';
import { contactBlock, legalLinks, rows, sectionLabel, viewRoot } from './common.js';
import { accountForm, field, FormError, messageOf, MIN_PASSWORD } from './forms.js';
import { OwnershipPanel } from './ownership.js';
import { photoPlate } from './photos.js';
import { tabsView } from './tabs.js';

export interface PiecesDeps {
  api: ApiClient;
  session: SessionStore;
  /** SCAN ORBES CODE, the page's hairline button. */
  onScan(): void;
  /** How ORBES Client Services is reached (`{}` when not configured); never rejects, never more than a second late. */
  clientServices(): Promise<ClientServices>;
}

export interface PiecesView {
  root: HTMLElement;
  dispose(): void;
}

type Load = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };

export function piecesView(deps: PiecesDeps): PiecesView {
  const page = new PiecesPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class PiecesPage {
  readonly root: HTMLElement;
  private readonly lead = h('p', { class: 'prose pieces__lead', attrs: { hidden: true }, text: PIECES.lead });
  private readonly body = h('div', { class: 'pieces__body' });
  private readonly account = h('div', { class: 'pieces__account' });
  private unsubscribe: (() => void) | null;
  private disposed = false;
  /** The session and the contact of ORBES Client Services are known: the page can say what it holds. */
  private ready = false;
  private contacts: ClientServices = {};
  private signIn: OwnershipPanel | null = null;
  private cards: PieceCard[] = [];
  private load: Load = { kind: 'idle' };
  /** Bumped on every load; an answer to an older one is dropped. */
  private loadGen = 0;
  private email: string | null = null;
  private changing = false;
  private notice: string | null = null;
  private busy = false;

  constructor(private readonly deps: PiecesDeps) {
    this.root = viewRoot('pieces', 'pieces-title');
    this.root.append(
      h(
        'header',
        { class: 'pieces__head' },
        h('span', { class: 'wordmark wordmark--small pieces__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }),
        h('h1', { class: 'pieces__title', id: 'pieces-title', text: PIECES.title }),
        this.lead,
      ),
      this.body,
      this.account,
      h(
        'footer',
        { class: 'pieces__foot' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => deps.onScan() }, text: PIECES.scan }),
        // The legal pages (J-06), in a new tab: the account's data is collected here too (its sign-in, CREATE
        // ACCOUNT), and a form under way stays.
        legalLinks({ newTab: true, extraClass: 'pieces__legal' }),
      ),
    );
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    this.renderBody();
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
      // Signed in with this page's form (the button that was pressed is gone, disabled while it was sent): once the
      // pieces are there, keyboard focus goes to the title above them.
      const fromForm = this.signIn !== null;
      this.signIn?.dispose();
      this.signIn = null;
      if (this.email !== s.account.email || this.load.kind === 'idle') {
        this.email = s.account.email;
        this.changing = false;
        this.notice = null;
        void this.loadPieces(fromForm);
      }
    } else {
      // Signed out (here, elsewhere, or the session ended): the pieces leave the page with the session.
      this.email = null;
      this.loadGen++;
      this.load = { kind: 'idle' };
      this.cards = [];
      this.changing = false;
      this.signIn ??= new OwnershipPanel(
        { kind: 'account' },
        { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan(), contact: recoveryContactModel(this.contacts, '') ?? undefined },
      );
    }
    this.renderBody();
    this.renderAccount();
  }

  private async loadPieces(focusTitle: boolean): Promise<void> {
    const gen = ++this.loadGen;
    this.load = { kind: 'loading' };
    this.renderBody();
    try {
      // The open certificate links with the pieces (F-06); without them, the pieces still show, and each says so.
      const [list, certificates] = await Promise.all([
        this.deps.api.products(),
        this.deps.api.certificates().catch((e: unknown) => {
          this.deps.session.noteError(e);
          return null;
        }),
      ]);
      if (gen !== this.loadGen || this.disposed) return;
      this.cards = list.map(
        (p, i) =>
          new PieceCard(p, i, {
            api: this.deps.api,
            session: this.deps.session,
            contacts: this.contacts,
            certificates: certificates === null ? null : certificates.filter((c) => c.productId === p.productId),
          }),
      );
      this.load = { kind: 'ready' };
    } catch (e) {
      if (gen !== this.loadGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.renderBody();
    if (focusTitle) this.focusTitle();
  }

  private focusTitle(): void {
    const title = this.root.querySelector<HTMLElement>('#pieces-title');
    if (!title) return;
    if (!title.hasAttribute('tabindex')) title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private renderBody(): void {
    const s = this.deps.session.state;
    this.lead.hidden = !(this.ready && s.status === 'signed-in');
    if (!this.ready) {
      this.body.replaceChildren(this.waiting());
      return;
    }
    if (s.status !== 'signed-in') {
      this.body.replaceChildren(...(this.signIn ? [h('div', { class: 'pieces__signin' }, this.signIn.root)] : []));
      return;
    }
    switch (this.load.kind) {
      case 'ready':
        this.body.replaceChildren(
          this.cards.length === 0
            ? h('p', { class: 'prose pieces__empty', text: PIECES.empty })
            : h('div', { class: 'pieces__list' }, ...this.cards.map((c) => c.root)),
        );
        return;
      case 'failed':
        this.body.replaceChildren(
          h(
            'div',
            { class: 'pieces__state' },
            h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${PIECES.loadFailed} ${this.load.message}` }),
            h('div', { class: 'ownership__actions' }, h('button', { class: 'textlink', attrs: { type: 'button' }, on: { click: () => void this.loadPieces(true) }, text: PIECES.retry })),
          ),
        );
        return;
      default:
        this.body.replaceChildren(this.waiting());
    }
  }

  private waiting(): HTMLElement {
    return h('p', { class: 'ownership__meta micro soft pieces__waiting', attrs: { 'aria-busy': 'true' }, text: PIECES.loading });
  }

  /** Signed in: the account line under the pieces, SIGNED IN AS … · CHANGE PASSWORD (C-04, moved here from the OWNERSHIP panel) · SIGN OUT. */
  private renderAccount(): void {
    const s = this.deps.session.state;
    if (!this.ready || s.status !== 'signed-in') {
      this.account.replaceChildren();
      return;
    }
    const hadFocus = this.account.contains(document.activeElement);
    // The account line under the pieces; CHANGE PASSWORD opens its form beneath it.
    const out: HTMLElement[] = [
      h(
        'div',
        { class: 'ownership__account' },
        h('p', { class: 'ownership__who micro soft' }, 'SIGNED IN AS ', h('span', { class: 'ownership__email', text: s.account.email })),
        h(
          'div',
          { class: 'ownership__links' },
          this.changing ? null : this.textButton(ACCOUNT_PASSWORD.change, () => this.openChange(), 'pieces__change'),
          this.textButton('SIGN OUT', () => this.signOut()),
        ),
      ),
    ];
    if (this.changing) out.push(...this.changeBlock());
    if (this.notice) out.push(h('p', { class: 'form__notice', attrs: { role: 'status' }, text: this.notice }));
    this.account.replaceChildren(...out);
    if (hadFocus && !this.account.contains(document.activeElement)) (this.account.querySelector<HTMLElement>('input, button:not([disabled])') ?? this.account).focus({ preventScroll: true });
  }

  private textButton(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
    return h('button', { class: ['textlink', extraClass], attrs: { type: 'button', disabled: this.busy }, on: { click: onClick }, text: label });
  }

  // ── Password (C-04) ──────────────────────────────────────────────────────

  /** CHANGE PASSWORD: the current password, then the new one. This session stays; the others end. */
  private changeBlock(): HTMLElement[] {
    const title = h('h2', { class: 'ownership__status', id: 'password-title', attrs: { tabindex: -1 }, text: ACCOUNT_PASSWORD.change });
    return [
      h(
        'section',
        { class: 'pieces__password', attrs: { 'aria-labelledby': 'password-title' } },
        title,
        h('p', { class: 'prose ownership__text', text: ACCOUNT_PASSWORD.changeLead }),
        this.changeForm(),
        h('div', { class: 'ownership__actions' }, this.textButton(ACCOUNT_PASSWORD.cancel, () => this.closeChange(null, true))),
      ),
    ];
  }

  private openChange(): void {
    this.changing = true;
    this.notice = null;
    this.renderAccount();
    this.account.querySelector<HTMLInputElement>('input')?.focus();
  }

  private closeChange(notice: string | null, focusLink = false): void {
    this.changing = false;
    this.notice = notice;
    this.renderAccount();
    if (focusLink) this.account.querySelector<HTMLElement>('.pieces__change')?.focus();
  }

  /** A wrong current password is a 400 (never a 401), said on its field; the session stays. */
  private changeForm(): HTMLFormElement {
    const current = h('input', { attrs: { type: 'password', name: 'current-password', autocomplete: 'current-password', required: true, maxlength: 1024 } });
    const next = h('input', { attrs: { type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD, maxlength: 1024 } });
    return accountForm(
      this.deps.session,
      'password',
      [field('current-password', ACCOUNT_PASSWORD.currentPassword, current), field('new-password', ACCOUNT_PASSWORD.newPassword, next, `At least ${MIN_PASSWORD} characters.`)],
      ACCOUNT_PASSWORD.change,
      async () => {
        if (!current.value) {
          current.setAttribute('aria-invalid', 'true');
          throw new FormError('Enter your current password.');
        }
        if (next.value.length < MIN_PASSWORD) {
          next.setAttribute('aria-invalid', 'true');
          throw new FormError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
        }
        try {
          await this.deps.api.changePassword(current.value, next.value);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'CURRENT_PASSWORD_INVALID') {
            current.value = '';
            current.setAttribute('aria-invalid', 'true');
          }
          throw e;
        }
        current.value = '';
        next.value = '';
        // Done: the form gives way to the sentence (a status, read out), and focus returns to CHANGE PASSWORD.
        this.closeChange(ACCOUNT_PASSWORD.changed, true);
      },
    );
  }

  private signOut(): void {
    if (this.busy) return;
    this.busy = true;
    this.renderAccount();
    void (async () => {
      try {
        await this.deps.api.logout();
      } catch {
        // The cookie is cleared by the server when it answers; the page forgets the session either way.
      } finally {
        this.busy = false;
        this.deps.session.signedOut();
      }
    })();
  }
}

// ── One piece ──────────────────────────────────────────────────────────────

interface CardDeps {
  api: ApiClient;
  session: SessionStore;
  contacts: ClientServices;
  /** The piece's open certificate links, newest first; null when they could not be read. */
  certificates: OwnerCertificate[] | null;
}

type Confirm = null | 'report' | 'found';

/** How long a new certificate link stays valid: the choice MY PIECES offers (the server takes 1 to 90 days). */
export const CERTIFICATE_DAYS = [7, 30, 90] as const;
type CertificateDays = (typeof CERTIFICATE_DAYS)[number];

/** One piece: its plate, its lines and its tabs. The OWNERSHIP panel re-renders itself on each change of its own state. */
class PieceCard {
  readonly root: HTMLElement;
  private readonly key: string;
  private model: PieceModel;
  private readonly panel = h('div', { class: 'ownership piece__ownership' });
  private confirm: Confirm = null;
  private choice: IncidentType | null = null;
  private busy = false;
  private error: string | null = null;
  private notice: string | null = null;
  private services: { kind: 'loading' } | { kind: 'ready'; list: ServiceRecord[] } | { kind: 'failed'; message: string } | null = null;
  private readonly servicePanel = h('div', { class: 'panel' });
  /** The open certificate links (F-06), null when they could not be read; the link just created, shown once. */
  private certificates: OwnerCertificate[] | null;
  private offer: CertificateOffer | null = null;
  private creating = false;
  private days: CertificateDays = 30;
  private certificateError: string | null = null;

  constructor(
    /** The piece as the server described it; a change made here is applied to it, then read again through pieceModel. */
    private piece: OwnedPiece,
    index: number,
    private readonly deps: CardDeps,
  ) {
    this.model = pieceModel(piece);
    this.certificates = deps.certificates;
    this.key = this.model.key || `piece-${index + 1}`;
    const titleId = `${this.key}-title`;
    const plate = bracket(
      h(
        'div',
        { class: 'piece__plate' },
        this.model.genome ? genomeBlock(this.model.genome, { titleId }) : h('h2', { class: 'genome__id', id: titleId, text: this.model.productId }),
      ),
    );
    // The photographs (F-04) under the plate, which carries the piece's heading: they belong to this piece for a
    // screen reader as for the eye, the plate of each named after it.
    const photos = photoPlate(this.model.photos, { extraClass: 'piece__photos', label: PHOTOS.labelOf(this.model.productId) });
    const lines = h('ul', { class: 'lines piece__lines', attrs: { 'aria-label': 'Piece' } }, ...this.model.productLines.map((line) => h('li', { class: 'lines__line', text: line })));
    const tabs = tabsView<PieceTabId>(PIECE_TABS, (id) => this.build(id), 'ownership', {
      labels: PIECE_TAB_LABELS,
      idPrefix: `${this.key}-`,
      label: `${this.model.productId} information`,
    });
    this.root = h('article', { class: 'piece', attrs: { 'aria-labelledby': titleId } }, plate, photos, lines, tabs.root);
    this.render();
  }

  private build(id: PieceTabId): HTMLElement {
    switch (id) {
      case 'ownership':
        return h('div', { class: 'panel' }, this.panel);
      case 'warranty':
        return this.warrantyPanel();
      case 'service':
        if (this.services === null) void this.loadServices();
        return this.servicePanel;
    }
  }

  private warrantyPanel(): HTMLElement {
    const w = this.model.warranty;
    if (!w) return h('div', { class: 'panel' }, h('p', { class: 'prose panel__note', text: 'Warranty details for this piece are available from ORBES Client Services.' }));
    return h('div', { class: 'panel' }, rows(w.rows), h('p', { class: 'prose panel__note', text: w.note }));
  }

  // ── SERVICE ──────────────────────────────────────────────────────────────

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

  private renderServices(): void {
    const s = this.services;
    const hadFocus = this.servicePanel.contains(document.activeElement);
    const out: HTMLElement[] = [sectionLabel(PIECES.services)];
    if (!s || s.kind === 'loading') out.push(h('p', { class: 'ownership__meta micro soft', attrs: { 'aria-busy': 'true' }, text: PIECES.loading }));
    else if (s.kind === 'failed') {
      out.push(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${PIECES.serviceFailed} ${s.message}` }),
        h('div', { class: 'ownership__actions' }, h('button', { class: 'textlink', attrs: { type: 'button' }, on: { click: () => void this.loadServices() }, text: PIECES.retry })),
      );
    } else if (s.list.length === 0) out.push(h('p', { class: 'prose panel__note', text: PIECES.noService }));
    else out.push(rows(serviceRows(s.list)));
    this.servicePanel.replaceChildren(...out);
    // TRY AGAIN was pressed: keyboard focus stays in the panel.
    if (hadFocus && !this.servicePanel.contains(document.activeElement)) this.servicePanel.closest<HTMLElement>('[role="tabpanel"]')?.focus({ preventScroll: true });
  }

  // ── OWNERSHIP ────────────────────────────────────────────────────────────

  /**
   * Re-render the panel. `focus` moves the keyboard focus after a step: the status line (a report or its withdrawal
   * done), the heading of a confirmation, the action that opened it (CANCEL), or the confirmation's button (a refusal).
   */
  private render(focus: 'status' | 'title' | 'action' | 'retry' | null = null): void {
    const m = this.model;
    const hadFocus = this.panel.contains(document.activeElement);
    const out: (HTMLElement | null)[] = [
      h('p', { class: 'ownership__status', attrs: { tabindex: -1 }, text: m.status }),
      rows(m.ownershipRows),
      ...m.ownershipNotes.map((n) => this.text(n)),
    ];
    if (m.transferPending && this.confirm === null) out.push(this.actions(this.textButton(PIECES.cancelTransfer, () => this.cancelTransfer(), 'piece__transfer-action')));
    out.push(...this.incidentBlock());
    // A piece reported lost or stolen, revoked or retired takes no certificate (the server refuses one): no section.
    if (m.certificateOffered && this.confirm === null) out.push(...this.certificateBlock());
    if (this.notice) out.push(h('p', { class: 'form__notice', attrs: { role: 'status' }, text: this.notice }));
    this.panel.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    const q = (sel: string) => this.panel.querySelector<HTMLElement>(sel);
    let target: HTMLElement | null = null;
    if (focus === 'status') target = q('.ownership__status');
    else if (focus === 'title') target = q('.section-label');
    else if (focus === 'action') target = q('.piece__incident-action');
    else if (focus === 'retry') target = q('.btn:not([disabled])') ?? q('button:not([disabled])');
    // A re-render replaced the focused control (busy): keep keyboard and screen-reader users in the panel.
    else if (hadFocus && !this.panel.contains(document.activeElement)) target = q('.ownership__status');
    target?.focus({ preventScroll: focus === null });
  }

  /** Loss and theft: report, withdraw a loss of one's own, or reach ORBES Client Services. */
  private incidentBlock(): (HTMLElement | null)[] {
    const m = this.model;
    const inc = m.incident;
    if (inc.kind === 'with-services' || inc.kind === 'not-reportable') {
      // A theft or a loss ORBES Client Services recorded, or a piece the server would refuse to report: theirs.
      const contact = pieceContactModel(this.deps.contacts, m.productId, m.status);
      return [this.text(inc.kind === 'with-services' ? PIECES.withClientServices[inc.type] : PIECES.notReportable), contact ? contactBlock(contact) : null];
    }
    if (inc.kind === 'found') {
      if (this.confirm !== 'found') return [this.text(PIECES.lostByYou), this.actions(this.textButton(PIECES.found, () => this.open('found'), 'piece__incident-action'))];
      return [this.label(PIECES.foundTitle), this.text(PIECES.foundLead), this.foundForm(), this.actions(this.textButton(PIECES.cancel, () => this.close()))];
    }
    if (this.confirm !== 'report') return [this.text(PIECES.reportLead), this.actions(this.textButton(PIECES.report, () => this.open('report'), 'piece__incident-action'))];
    const option = (type: IncidentType, label: string) =>
      h('button', {
        class: 'auth__option',
        attrs: { type: 'button', 'aria-pressed': this.choice === type ? 'true' : 'false', disabled: this.busy },
        data: { incident: type },
        on: { click: () => this.choose(type) },
        text: label,
      });
    return [
      this.label(PIECES.reportTitle),
      h(
        'div',
        { class: 'auth__switch piece__choice', attrs: { role: 'group', 'aria-label': PIECES.reportChoice } },
        option('LOST', PIECES.lost),
        h('span', { class: 'tabs__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }),
        option('STOLEN', PIECES.stolen),
      ),
      this.choice ? this.text(PIECES.reportHow[this.choice]) : null,
      this.text(PIECES.reportEffect),
      this.errorLine(),
      this.actions(this.confirmButton(PIECES.confirmReport, () => this.report()), this.textButton(PIECES.cancel, () => this.close())),
    ];
  }

  /**
   * OWNERSHIP CERTIFICATE (F-06): a link to the live record of the piece, for a buyer or an insurer. CREATE CERTIFICATE
   * opens the choice of its validity (7 · 30 · 90 DAYS) and CREATE LINK; the link is then shown once, with COPY LINK and
   * OPEN; each open link has WITHDRAW.
   */
  private certificateBlock(): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [
      h('h3', { class: 'section-label piece__certificate-title', attrs: { tabindex: -1 }, text: PIECES.certificateTitle }),
      this.text(PIECES.certificateLead),
    ];
    const offer = this.offer;
    if (offer) {
      out.push(
        h(
          'div',
          { class: 'certificate-link' },
          h('p', { class: 'certificate-link__label micro soft', text: PIECES.certificateLink }),
          h('p', { class: 'certificate-link__value', text: offer.url }),
          h('p', { class: 'certificate-link__label micro soft', text: PIECES.certificateUntil(formatDate(offer.expiresAt)) }),
        ),
        this.text(PIECES.certificateShown),
        this.actions(
          this.textButton(PIECES.copyLink, () => void this.copyLink(offer.url), 'certificate-link__copy'),
          h('a', { class: 'textlink certificate-link__open', attrs: { href: offer.url, target: '_blank', rel: 'noopener noreferrer' }, text: PIECES.openLink }),
        ),
      );
    }
    if (this.certificates === null) {
      // The open links could not be read: said, with TRY AGAIN, for as long as they cannot (never an empty list).
      out.push(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: PIECES.certificatesFailed }),
        this.actions(this.textButton(PIECES.retry, () => void this.retryCertificates(), 'piece__certificates-retry')),
      );
    } else if (this.certificates.length > 0) {
      out.push(
        h(
          'ul',
          { class: 'piece__certificates', attrs: { 'aria-label': PIECES.certificateTitle } },
          ...this.certificates.map((c) =>
            h(
              'li',
              { class: 'piece__certificate' },
              h('p', { class: 'ownership__meta micro piece__certificate-line', text: ownerCertificateLine(c) }),
              h('button', {
                class: 'textlink piece__certificate-withdraw',
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
      out.push(this.certificateErrorLine(), this.actions(this.textButton(PIECES.createCertificate, () => this.openCertificate(), 'piece__certificate-action')));
      return out;
    }
    const option = (days: CertificateDays) =>
      h('button', {
        class: 'auth__option',
        attrs: { type: 'button', 'aria-pressed': this.days === days ? 'true' : 'false', disabled: this.busy },
        data: { days },
        on: { click: () => this.chooseDays(days) },
        text: PIECES.certificateDays[days],
      });
    const choice: HTMLElement[] = [];
    CERTIFICATE_DAYS.forEach((d, i) => {
      if (i > 0) choice.push(h('span', { class: 'tabs__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }));
      choice.push(option(d));
    });
    out.push(
      h('div', { class: 'auth__switch piece__choice piece__validity', attrs: { role: 'group', 'aria-label': PIECES.certificateValidity } }, ...choice),
      this.text(PIECES.certificateHow),
      this.certificateErrorLine(),
      this.actions(this.confirmButton(PIECES.confirmCertificate, () => void this.createCertificate()), this.textButton(PIECES.cancel, () => this.closeCertificate())),
    );
    return out;
  }

  private certificateErrorLine(): HTMLElement | null {
    return this.certificateError ? h('p', { class: 'form__error', attrs: { role: 'alert' }, text: this.certificateError }) : null;
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
    this.renderFocus(ok ? '.certificate-link__copy' : '.piece__certificate-title ~ .ownership__actions .btn:not([disabled])');
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

  private text(text: string): HTMLElement {
    return h('p', { class: 'prose ownership__text', text });
  }

  private label(text: string): HTMLElement {
    return h('h3', { class: 'section-label', attrs: { tabindex: -1 }, text });
  }

  private actions(...children: HTMLElement[]): HTMLElement {
    return h('div', { class: ['ownership__actions', children.length > 1 && 'ownership__actions--stack'] }, ...children);
  }

  private errorLine(): HTMLElement | null {
    return this.error ? h('p', { class: 'form__error', attrs: { role: 'alert' }, text: this.error }) : null;
  }

  private textButton(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
    return h('button', { class: ['textlink', extraClass], attrs: { type: 'button', disabled: this.busy }, on: { click: onClick }, text: label });
  }

  private confirmButton(label: string, onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'btn btn--block', attrs: { type: 'button', 'aria-busy': this.busy ? 'true' : 'false', disabled: this.busy }, on: { click: onClick }, text: label });
  }

  private open(confirm: Exclude<Confirm, null>): void {
    this.confirm = confirm;
    this.choice = null;
    this.error = null;
    this.notice = null;
    this.render('title');
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
   * it to is the server's: a loss declared during a service returns to IN SERVICE). `guess`, the change as the page
   * knows it, only when the list cannot be read just now (or no longer holds the piece).
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

  /** One request at a time; done, the piece is read again as the server now holds it, and its status line takes the focus. */
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

  /** A change made: the piece read again, the confirmation closed, the sentence that says what was done. */
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
      this.panel.querySelector<HTMLElement>('.piece__choice .auth__option')?.focus();
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
    return accountForm(this.deps.session, 'found', [field(`${this.key}-found-password`, PIECES.foundPassword, password)], PIECES.confirmFound, async () => {
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
    });
  }

  private cancelTransfer(): void {
    void this.run(() => this.deps.api.cancelTransfer(this.model.productId), PIECES.transferCancelled, (p) => ({ ...p, transfer: { pending: false } }));
  }
}
