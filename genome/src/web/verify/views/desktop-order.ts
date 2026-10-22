/**
 * An order as its own page on a computer (desktop, BRIEF decision 5, §10.30; /verify/orders/OR-1A2B3C4D): what
 * the order's card of MY PIECES shows on a phone, under the same conditions, laid out across the window; its edits are
 * forms of the page, never a sheet, a side panel or a dialog. MY PIECES' ORDERS lists the orders as rows that open it.
 *
 *   ‹ MY PIECES
 *   ┌──────────────────────┐   LIVE RELEASE · MONOLITHE IN STEEL          where it was sold
 *   │ the model's          │   MONOLITHE                                  its model (T1)
 *   │ photograph (square)  │   ORDER OR-6ACD9A60                          its reference, selected whole in one click
 *   │                      │   ●────○────○────○────○                       its steps and their dates
 *   │                      │   Your piece is reserved. …                  what its step means now
 *   └──────────────────────┘   YOUR NEW CLAIM CODE … SHOW THE CODE        while one waits (shown once, as today)
 *                              SIZE · PRICE · ENGRAVING · … · TOTAL       its terms; CARRIER, TRACKING NUMBER once shipped
 *                              TRACK THE SHIPMENT  [ WRITE TO ORBES CLIENT SERVICES ]
 *   ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   THE SET                    a set's piece (macro scope K44): THE SET · <name>, ONE PRICE FOR THE SET and its total,
 *                              its pieces, each a link to its own page, this one marked
 *   DELIVERY ADDRESS           its address and CHANGE (the form in its place), ADD THE DELIVERY ADDRESS, or packing begun
 *   ENGRAVING                  what it is, ADD AN ENGRAVING or CHANGE THE ENGRAVING (the form), or packing begun
 *   ADD-ONS                    what they are, each REMOVE, ADD AN ADD-ON (the form: the add-ons available, their units,
 *                              the total, ADD), or packing begun (plan MACRO M3 §4.4, D2)
 *   RETURNS AND EXCHANGES      a request as it stands, or (delivered, 14 days) REQUEST A RETURN and EXCHANGE THE SIZE
 *   DOCUMENTS                  INVOICE, ORBES CARE CONDITIONS, CREDIT NOTE, CARE GUIDE, OWNERSHIP CERTIFICATE
 *
 * Every part is the card's own (views/pieces.ts: YOUR NEW CLAIM CODE, a request, the documents) or the sheet's own form
 * (views/order-sheet.ts in its `inline` mode): their words, their requests, their states; only the layout is the page's.
 * There is no cancel button (cancelling is asked in MESSAGES), never AWAITING STOCK, never the packing photograph, no
 * delivery estimate and no notification dot: none of them is in the order's model (verify/orders-model.ts).
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { ORDERS, PIECES, SETS } from '../copy.js';
import { orderContext } from '../messages-model.js';
import { orderModels, type OrderModel } from '../orders-model.js';
import type { SessionStore } from '../session.js';
import type { AccountOrder } from '../types.js';
import { listLine, orderPagePath, PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { appAnchor, button, definitionList, failedState, icon, loadingState, orderSteps, textLink } from './nocturne.js';
import { OrderSheet, type OrderSheetRequest } from './order-sheet.js';
import { orderAddonsBlock } from './order-addons.js';
import { ClaimBlock, lines, orderDocumentsBlock, requestBlock, type OrderDeps } from './pieces.js';
import { writeButton } from './write.js';

export { ORDERS_PAGE_PATH, orderPagePath } from './common.js';
const REFERENCE = /^OR-[0-9A-F]{8}$/;

/** Whether an address is under /verify/orders. */
export function isOrdersPath(pathname: string): boolean {
  return /^\/verify\/orders(\/|$)/i.test(pathname.replace(/\/+$/, '') || '/');
}

/** The reference an address names (/verify/orders/OR-1A2B3C4D, in any case), or null. */
export function orderReferenceOf(pathname: string): string | null {
  const m = /^\/verify\/orders\/([^/]+)\/?$/i.exec(pathname);
  if (!m) return null;
  let ref: string;
  try {
    ref = decodeURIComponent(m[1]!).toUpperCase();
  } catch {
    return null;
  }
  return REFERENCE.test(ref) ? ref : null;
}

export interface OrderPageDeps {
  api: ApiClient;
  session: SessionStore;
  /** `OR-1A2B3C4D`. */
  reference: string;
  /** ‹ MY PIECES: MY PIECES on ORDERS. */
  onPieces(): void;
  /** Not one of the account's orders (or no longer readable as one): MY PIECES' ORDERS in its place. */
  onMissing(): void;
  /** Signed out (reached by its address, or the session ended here): the sign-in page, then this page. */
  onSignIn(): void;
  /** Macro scope K44: another piece of its set, its own page. */
  onOrder?(reference: string): void;
}

export interface OrderPageView {
  root: HTMLElement;
  dispose(): void;
}

export function orderPageView(deps: OrderPageDeps): OrderPageView {
  const page = new OrderPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };
type Editing = OrderSheetRequest['kind'];

class OrderPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'd-order__body' });
  private load: Load = { kind: 'loading' };
  private loadGen = 0;
  private orders: AccountOrder[] = [];
  private model: OrderModel | null = null;
  /** YOUR NEW CLAIM CODE, kept while the page lives (a code shown stays shown until the page is left, as on MY PIECES). */
  private claim: ClaimBlock | null = null;
  /** The form open in its section, null for none: one at a time, as the phone's one sheet. */
  private editing: Editing | null = null;
  private readonly editor: OrderSheet;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly deps: OrderPageDeps) {
    this.root = viewRoot('order', 'order-title');
    this.root.classList.add('d-order');
    const crumb = appAnchor(PIECES_PATH, ['n-g', 'n-crumb', 'd-order__crumb'], () => deps.onPieces(), icon('back', { small: true }), PIECES.back);
    this.root.append(h('div', { class: 'd-order__crumb-line' }, crumb), this.body);
    this.editor = new OrderSheet({ api: deps.api, session: deps.session, outside: () => [], inline: { closed: (focus) => this.closed(focus), drawn: (panel) => pairFields(panel) } });
    this.unsubscribe = deps.session.subscribe((s) => {
      if (s.status === 'anonymous' && !this.disposed) deps.onSignIn();
    });
    this.render();
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.loadGen++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.editor.isOpen) this.editor.close();
  }

  private async start(): Promise<void> {
    await this.deps.session.ensure().catch(() => undefined);
    if (this.disposed) return;
    if (this.deps.session.state.status !== 'signed-in') {
      this.deps.onSignIn();
      return;
    }
    await this.read();
  }

  /** The account's orders read, this one found; `quiet`: the page stays as it is while they are (REGISTER THIS PIECE). */
  private async read(opts: { quiet?: boolean } = {}): Promise<void> {
    const gen = ++this.loadGen;
    if (!opts.quiet) {
      this.load = { kind: 'loading' };
      this.render();
    }
    try {
      const list = await this.deps.api.orders();
      if (gen !== this.loadGen || this.disposed) return;
      this.orders = list;
      if (!this.place()) return;
      this.load = { kind: 'ready' };
    } catch (e) {
      if (gen !== this.loadGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      if (opts.quiet) return;
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
    if (!opts.quiet) this.focusTitle();
  }

  /** This order's model from the orders as read (its address follows an order it travels with); false when it is none of them. */
  private place(): boolean {
    const m = orderModels(this.orders).find((o) => o.reference === ORDERS.reference(this.deps.reference)) ?? null;
    if (!m) {
      this.deps.onMissing();
      return false;
    }
    this.model = m;
    return true;
  }

  private focusTitle(): void {
    this.root.querySelector<HTMLElement>('#order-title')?.focus({ preventScroll: true });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private render(): void {
    if (this.load.kind === 'loading') {
      this.body.replaceChildren(loadingState(PIECES.loading, { extraClass: 'd-order__loading' }));
      return;
    }
    if (this.load.kind === 'failed') {
      this.body.replaceChildren(
        h('div', { class: 'd-order__failed' }, failedState({ sentence: ORDERS.loadFailed, reason: this.load.message, retry: PIECES.retry, onRetry: () => void this.read() })),
      );
      return;
    }
    const m = this.model!;
    this.root.dataset.status = m.status;
    this.body.replaceChildren(this.head(m), ...this.sections(m));
  }

  /** What every part of the card needs: the requests, and the page told when one of them changed the order. */
  private orderDeps(): OrderDeps {
    return {
      api: this.deps.api,
      session: this.deps.session,
      onRegistered: () => void this.read({ quiet: true }),
      onChanged: (order, focus) => this.changed(order, focus),
    };
  }

  /** The photograph beside the summary: the line, the title, the reference, the steps, the sentence, the claim, the terms. */
  private head(m: OrderModel): HTMLElement {
    const photo = m.photo
      ? h('img', { class: 'd-order__img', attrs: { src: m.photo.src, alt: m.photo.alt, decoding: 'async', loading: 'eager', fetchpriority: 'high' } })
      : null;
    const frame = h('div', { class: ['d-order__photo', photo ? null : 'is-bare'] }, photo);
    // A photograph that cannot be loaded leaves its plate, never a broken image.
    photo?.addEventListener('error', () => frame.classList.add('is-bare'), { once: true });
    const steps = orderSteps(
      m.steps.map((s) => ({ label: s.label, date: s.date || null, done: s.state !== 'next', current: s.state === 'current' })),
      { label: ORDERS.stepsLabel, bar: m.status === 'CANCELLED' ? 'none' : m.status === 'RETURNED' ? 'end' : 'auto' },
    );
    steps.classList.add('d-order__steps');
    // A column per step of this order (a cancelled order's two, a returned one's six), so the hairline and the bar stop on
    // its last dot (shared/desktop-order.css); a returned order's bar ends on RETURNED, not past it.
    steps.style.setProperty('--d-steps', String(Math.max(2, m.steps.length)));
    if (m.status === 'RETURNED') steps.querySelector('.n-steps__bar')?.classList.add('d-order__bar--end');
    const reference = m.reference.replace(/^ORDER /, '');
    const rows = [...m.rows, ...(m.shipment?.rows ?? [])];
    const track = m.shipment?.href
      ? h('a', { class: 'n-g n-tl d-order__track pieces__order-track', attrs: { href: m.shipment.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': m.shipment.label }, text: ORDERS.track })
      : null;
    const claim = this.claimBlock(m);
    return h(
      'section',
      { class: 'd-order__head', attrs: { 'aria-labelledby': 'order-title' } },
      frame,
      h(
        'div',
        { class: 'd-order__summary' },
        h('p', { class: 'n-g n-lb d-order__line' }, ...listLine(m.line)),
        h('h1', { class: 'n-g d-order__title', id: 'order-title', attrs: { tabindex: -1 } }, ...withNumerals(m.title)),
        // The reference ORBES Client Services finds it by: the value alone selected in one click (§10.19).
        h('p', { class: 'n-g n-lb d-order__ref' }, `${ORDERS.reference('')}`.trim(), ' ', h('span', { class: 'n-num d-order__ref-value' }, ...withNumerals(reference))),
        steps,
        h('p', { class: 'n-tx d-order__sentence', text: m.sentence }),
        claim,
        rows.length > 0 ? h('div', { class: 'd-order__terms' }, definitionList(rows, { kind: 'kv' })) : null,
        h(
          'div',
          { class: 'd-order__actions' },
          // WRITE TO ORBES CLIENT SERVICES, the order attached (CS-01): MESSAGES on this order's subject.
          writeButton(orderContext({ id: m.id, model: m.title, modelVariant: m.modelVariant })),
          track,
        ),
      ),
    );
  }

  /** YOUR NEW CLAIM CODE: while a code waits for the order, or once shown, registered or refused here. */
  private claimBlock(m: OrderModel): HTMLElement | null {
    if (m.claim) {
      if (this.claim) this.claim.update(m.claim);
      else this.claim = new ClaimBlock(m.id, m.key, m.claim, this.orderDeps());
      return this.claim.el;
    }
    if (this.claim?.settled) return this.claim.el;
    this.claim = null;
    return null;
  }

  /** The order's sections, each a row of the page: its label on the left, what it holds (or its form) on the right. */
  private sections(m: OrderModel): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (m.set) out.push(this.section('set', SETS.orders.title, this.setPart(m)));
    if (m.address) out.push(this.section('address', ORDERS.address.label, this.addressPart(m)));
    if (m.engraving) out.push(this.section('engraving', ORDERS.engraving.title, this.engravingPart(m)));
    if (m.addons) out.push(this.section('addons', ORDERS.addons.title, this.addonsPart(m)));
    if (m.returns || m.request) out.push(this.section('returns', ORDERS.returns.label, this.returnsPart(m)));
    if (m.documents.length > 0) out.push(this.section('documents', ORDERS.documents.title, this.documentsPart(m)));
    return out;
  }

  private section(key: string, label: string, content: (HTMLElement | null)[]): HTMLElement {
    const id = `order-part-${key}`;
    return h(
      'section',
      { class: ['d-order__row', `d-order__row--${key}`], attrs: { 'aria-labelledby': id } },
      h('div', { class: 'd-order__row-side' }, h('h2', { class: 'n-g d-order__row-label', id, text: label })),
      h('div', { class: 'd-order__row-main' }, ...content.filter((c): c is HTMLElement => c !== null)),
    );
  }

  /**
   * THE SET (macro scope K44 T1 to T3): THE SET · <name> and its pieces, the set's one price and its total, then each of
   * its pieces (its model, its size, its reference, RETURNED or CANCELLED once it has left the set), a link to its own
   * page, this one marked as the page's.
   */
  private setPart(m: OrderModel): (HTMLElement | null)[] {
    const set = m.set!;
    const rows = [...(set.price ? [[SETS.onePrice, set.price] as [string, string]] : []), ...(set.total ? [[SETS.orders.total, set.total] as [string, string]] : [])];
    const pieces = set.pieces.map((p) => {
      const reference = p.reference;
      // A piece no longer of the set (returned, its exchange's new order beside it; cancelled) says so on its line.
      const ended = p.status === 'RETURNED' || p.status === 'CANCELLED' ? ORDERS.step[p.status] : null;
      const words = [h('span', { class: 'n-g d-oset__piece-title' }, ...withNumerals(p.title)), h('span', { class: 'n-g n-lb d-oset__piece-line' }, ...listLine([p.size, reference, ended].filter(Boolean).join(' · ')))];
      if (p.id === m.id) return h('li', { class: `d-oset__piece is-current${ended ? ' is-ended' : ''}`, attrs: { 'aria-current': 'page' } }, ...words);
      const a = appAnchor(orderPagePath(reference), ['d-oset__piece-link'], this.deps.onOrder ? () => this.deps.onOrder!(reference) : undefined, ...words);
      a.setAttribute('aria-label', SETS.orders.pieceLabel(p.title, reference));
      return h('li', { class: ended ? 'd-oset__piece is-ended' : 'd-oset__piece' }, a);
    });
    return [
      h('p', { class: 'n-g n-t3 d-oset__heading' }, ...withNumerals(set.name)),
      h('p', { class: 'n-g n-lb d-oset__count' }, ...withNumerals(set.count)),
      rows.length > 0 ? h('div', { class: 'd-order__terms d-oset__terms' }, definitionList(rows, { kind: 'kv' })) : null,
      h('ul', { class: 'd-oset__pieces' }, ...pieces),
    ];
  }

  /** DELIVERY ADDRESS: its lines and CHANGE (the form in their place), ADD THE DELIVERY ADDRESS, or why it no longer changes. */
  private addressPart(m: OrderModel): (HTMLElement | null)[] {
    if (this.editing === 'address') return [this.editor.el];
    const a = m.address!;
    const A = ORDERS.address;
    let action: HTMLElement | null = null;
    if (a.state === 'editable') {
      action = textLink(A.change, { extraClass: 'd-order__change pieces__address-change', onOpen: () => this.edit({ kind: 'address' }) });
      action.setAttribute('aria-label', A.changeLabel(m.reference.replace(/^ORDER /, '')));
    } else if (a.state === 'empty') {
      action = button(A.add, { outline: true, extraClass: 'd-order__add pieces__address-add', onClick: () => this.edit({ kind: 'address' }) });
    }
    if (action) action.dataset.focus = 'address';
    return [
      a.lines.length > 0 ? lines(a.lines, 'd-order__lines') : null,
      a.sentence ? h('p', { class: 'n-sm d-order__note', text: a.sentence }) : null,
      action ? h('p', { class: 'd-order__do' }, action) : null,
    ];
  }

  /** ENGRAVING: what it is and its link (the form in their place), or the line once packing has begun. */
  private engravingPart(m: OrderModel): (HTMLElement | null)[] {
    if (this.editing === 'engraving') return [this.editor.el];
    const e = m.engraving!;
    if (!e.action) return [h('p', { class: 'n-sm d-order__note pieces__engraving-locked', text: e.locked ?? '' })];
    const link = textLink(e.action, { extraClass: 'd-order__change pieces__engraving', onOpen: () => this.edit({ kind: 'engraving' }) });
    link.dataset.focus = 'engraving';
    return [h('p', { class: 'n-tx d-order__text', text: ORDERS.engraving.lead }), h('p', { class: 'd-order__do' }, link)];
  }

  /**
   * ADD-ONS (plan MACRO M3 §4.4, D2): what they are, each REMOVE, ADD AN ADD-ON (the form in their place: the add-ons
   * available, their units, the total, ADD), or the line once packing has begun.
   */
  private addonsPart(m: OrderModel): (HTMLElement | null)[] {
    if (this.editing === 'addons') return [this.editor.el];
    const block = orderAddonsBlock({ order: m, deps: this.orderDeps(), onAdd: () => this.edit({ kind: 'addons' }), desktop: true });
    return [m.addons?.locked ? null : h('p', { class: 'n-tx d-order__text', text: ORDERS.addons.lead }), ...block];
  }

  /**
   * RETURNS AND EXCHANGES: a request as it stands (its label, received, what to do, the return address), then, delivered
   * within its 14 days, the way to ask: its sentence, REQUEST A RETURN and EXCHANGE THE SIZE (none for a model of one
   * size), the form in their place.
   */
  private returnsPart(m: OrderModel): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [];
    if (m.request) out.push(requestBlock(m));
    if (this.editing === 'RETURN' || this.editing === 'EXCHANGE') {
      out.push(this.editor.el);
      return out;
    }
    const r = m.returns;
    if (r) {
      const R = ORDERS.returns;
      const ask = (kind: 'RETURN' | 'EXCHANGE', label: string, cls: string): HTMLButtonElement => {
        const b = button(label, { outline: true, extraClass: cls, onClick: () => this.edit({ kind }) });
        b.dataset.focus = kind === 'RETURN' ? 'request' : 'exchange';
        return b;
      };
      out.push(
        h('p', { class: 'n-tx d-order__text pieces__returns-lead', text: r.lead }),
        // Macro scope K44 T3: a set's piece is returned only with its set.
        r.set ? h('p', { class: 'n-sm d-order__note n-pieces__returns-whole', text: SETS.orders.returnWhole }) : null,
        h('div', { class: 'd-order__asks' }, ask('RETURN', r.set ? SETS.orders.returnSet : R.requestReturn, 'pieces__return'), ...(r.sizes.length > 0 ? [ask('EXCHANGE', R.exchange, 'pieces__exchange')] : [])),
      );
    }
    return out;
  }

  /** DOCUMENTS: the card's rows (each PDF saved, the care guide opening under its row), under the section's label. */
  private documentsPart(m: OrderModel): HTMLElement[] {
    const block = orderDocumentsBlock(m, this.orderDeps());
    block.querySelector(':scope > .n-pieces__documents-title')?.remove();
    block.setAttribute('aria-labelledby', 'order-part-documents');
    return [block];
  }

  // ── The forms ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A form opened in its section (the one open closed first): the section drawn with it, the focus in it. */
  private edit(what: { kind: Editing }): void {
    const m = this.model;
    if (!m) return;
    if (this.editor.isOpen) this.editor.close();
    const onDone = (order: AccountOrder): HTMLElement | null => {
      this.replace(order);
      return null;
    };
    const trigger = this.body;
    let req: OrderSheetRequest | null = null;
    if (what.kind === 'address') req = { kind: 'address', order: m, trigger, onDone };
    else if (what.kind === 'engraving' && m.engraving) req = { kind: 'engraving', order: m, engraving: m.engraving, trigger, onDone };
    else if (what.kind === 'addons' && m.addons?.canAdd) req = { kind: 'addons', order: m, trigger, onDone };
    else if ((what.kind === 'RETURN' || what.kind === 'EXCHANGE') && m.returns) req = { kind: what.kind, order: m, returns: m.returns, trigger, onDone };
    if (!req) return;
    this.editing = req.kind;
    this.render();
    this.editor.open(req);
  }

  /** The form closed (sent, or CANCEL): the section drawn again, the focus on its control (or what the form named). */
  private closed(focus: HTMLElement | null): void {
    const was = this.editing;
    this.editing = null;
    if (this.disposed) return;
    this.render();
    if (focus?.isConnected) {
      focus.focus({ preventScroll: true });
      return;
    }
    const key = was === 'RETURN' || was === 'EXCHANGE' ? (this.model?.request ? null : was === 'RETURN' ? 'request' : 'exchange') : was;
    const control = key ? this.body.querySelector<HTMLElement>(`[data-focus="${key}"]`) : null;
    if (control) control.focus({ preventScroll: true });
    else if (was === 'RETURN' || was === 'EXCHANGE') this.body.querySelector<HTMLElement>('.n-pieces__request-label')?.focus({ preventScroll: true });
  }

  /** The order as the server answered a form: in its place among the orders, the page drawn again. */
  private replace(order: AccountOrder): void {
    const at = this.orders.findIndex((o) => o.id === order.id);
    if (at >= 0) this.orders[at] = order;
    else this.orders.push(order);
    this.place();
    // Macro scope K44 T3: a set's return asked here is every piece's: the orders read again, quietly.
    if (order.set && order.case?.kind === 'RETURN') void this.read({ quiet: true });
  }

  /** A part of the card changed the order (DOCUMENTS never does; kept for the card's own interface). */
  private changed(order: AccountOrder, focus: string): HTMLElement | null {
    this.replace(order);
    this.render();
    return this.body.querySelector<HTMLElement>(`[data-focus="${focus}"]`);
  }
}

/** A form's fields that pair side by side (§10.22): a new address's COUNTRY beside its PHONE, as YOUR ADDRESSES has them. */
function pairFields(panel: HTMLElement): void {
  const one = panel.querySelector('#order-address-country')?.closest<HTMLElement>('.n-fld-group');
  const two = panel.querySelector('#order-address-phone')?.closest<HTMLElement>('.n-fld-group');
  if (!one || !two || one.parentElement !== two.parentElement || one.parentElement?.classList.contains('d-acct__pair')) return;
  const box = h('div', { class: 'd-acct__pair' });
  one.before(box);
  box.append(one, two);
}
