/**
 * YEARLY CARE in a piece's SERVICE tab (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6), above SERVICE HISTORY, in
 * NOCTURNE's pieces: the label (Gravesend), the reading text, the hairline button, the underlined fields, the `.kv` rows
 * and the text links. care-model.ts says what it shows; this draws it, opens the request's own form in place, and sends
 * the request, its cancellation and the label's download.
 *
 * Nothing is drawn while the care is read, when it cannot be read, or when the account's tier includes no care (and no
 * request of the piece is open): the SERVICE tab then reads as before.
 */
import { h } from '../../shared/dom.js';
import { saveDownload } from '../../shared/download.js';
import type { ApiClient } from '../api.js';
import { careFormModel, careFormProblem, careModel, type CareBlock } from '../care-model.js';
import type { SessionStore } from '../session.js';
import type { PieceCare } from '../types.js';
import { withNumerals } from './common.js';
import { FormError, messageOf, nocturneForm } from './forms.js';
import { button, definitionList, field, textLink } from './nocturne.js';

export interface YearlyCareDeps {
  api: ApiClient;
  session: SessionStore;
  productId: string;
  /** Asked after a step that changes the piece's history (none here today): SERVICE HISTORY read again. */
  onChange?(): void;
}

export class YearlyCareBlock {
  readonly root = h('section', { class: 'n-piece__care-year piece__yearly-care', attrs: { 'aria-labelledby': 'piece-yearly-care', hidden: true } });
  private care: PieceCare | null = null;
  private form = false;
  private error: string | null = null;
  private busy = false;
  private disposed = false;

  constructor(private readonly deps: YearlyCareDeps) {}

  dispose(): void {
    this.disposed = true;
  }

  /** Read the piece's care, then draw it (nothing when it cannot be read). */
  async load(): Promise<void> {
    try {
      const care = await this.deps.api.pieceCare(this.deps.productId);
      if (this.disposed) return;
      this.care = care;
    } catch (e) {
      this.deps.session.noteError(e);
      this.care = null;
    }
    this.render();
  }

  private render(focus: 'title' | 'field' | null = null): void {
    const m = careModel(this.care);
    if (!m) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    this.root.hidden = false;
    const out: (HTMLElement | null)[] = [h('h3', { class: 'n-g n-lb n-piece__care-year-label', id: 'piece-yearly-care', attrs: { tabindex: -1 }, text: m.label })];
    if (m.notice) out.push(this.text(m.notice, 'n-piece__care-year-notice'));
    out.push(...this.block(m.block));
    this.root.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    if (focus === 'title') this.root.querySelector<HTMLElement>('#piece-yearly-care')?.focus({ preventScroll: true });
    if (focus === 'field') this.root.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  }

  private text(t: string, extra?: string): HTMLElement {
    return h('p', { class: ['n-tx', 'n-piece__care-year-text', extra] }, ...withNumerals(t));
  }

  private rows(rows: readonly (readonly [string, string])[]): HTMLElement {
    return definitionList(
      rows.map(([label, value]) => [label, h('span', { class: 'n-piece__care-year-value' }, ...value.split('\n').flatMap((line, i) => (i ? [h('br'), ...withNumerals(line)] : withNumerals(line))))] as const),
      { kind: 'kv', extraClass: 'n-piece__care-year-rows' },
    );
  }

  private errorLine(): HTMLElement | null {
    return this.error ? h('p', { class: 'n-err n-piece__care-year-error', attrs: { role: 'alert' }, text: this.error }) : null;
  }

  private block(b: CareBlock): (HTMLElement | null)[] {
    switch (b.kind) {
      case 'available':
        if (this.form) return this.formView();
        return [this.text(b.text), h('div', { class: 'n-piece__action-line' }, button(b.action, { outline: true, extraClass: 'n-piece__care-year-request', onClick: () => this.openForm() }))];
      case 'requested':
        return [
          h('p', { class: 'n-g n-t3 n-ivc n-num n-piece__care-year-head' }, ...withNumerals(b.head)),
          this.text(b.text),
          this.rows(b.rows),
          this.errorLine(),
          h('p', { class: 'n-piece__action-line' }, textLink(b.action, { onOpen: () => void this.cancel(b.requestId), extraClass: 'n-piece__care-year-cancel' })),
        ];
      case 'label':
        return [
          h('p', { class: 'n-g n-t3 n-ivc n-piece__care-year-head', text: b.head }),
          this.text(b.text),
          b.download ? h('div', { class: 'n-piece__action-line' }, button(b.download, { outline: true, extraClass: 'n-piece__care-year-download', onClick: () => void this.download(b.requestId) })) : null,
          this.errorLine(),
          this.rows(b.rows),
        ];
      case 'received':
        return [h('p', { class: 'n-g n-t3 n-ivc n-piece__care-year-head', text: b.head }), this.text(b.text)];
      case 'returning':
        return [
          h('p', { class: 'n-g n-t3 n-ivc n-piece__care-year-head', text: b.head }),
          this.rows(b.rows),
          b.track ? h('p', { class: 'n-piece__action-line' }, textLink(b.track.text, { href: b.track.href, newTab: true, extraClass: 'n-piece__care-year-track' })) : null,
        ];
      default:
        return [this.text(b.text)];
    }
  }

  private openForm(): void {
    this.form = true;
    this.error = null;
    this.render('field');
  }

  /** The request's own form, in place: the question, RETURN ADDRESS, NAME and ADDRESS, CONFIRM REQUEST · CANCEL. */
  private formView(): HTMLElement[] {
    const f = careFormModel(this.care!);
    const id = `${this.deps.productId}-care`;
    const name = h('input', { attrs: { type: 'text', name: 'name', autocomplete: 'name', maxlength: f.name.max, required: true } });
    name.value = f.name.value;
    const address = h('textarea', {
      class: 'n-fld__input n-piece__care-year-address',
      id: `${id}-address`,
      attrs: { name: 'address', rows: 3, maxlength: f.address.max, required: true, autocomplete: 'street-address', 'aria-describedby': f.prefilled ? `${id}-prefilled` : null },
    });
    address.value = f.address.value;
    const addressField = h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: `${id}-address` } }, h('span', { class: 'n-g n-lab', text: f.address.label })),
      address,
      f.prefilled ? h('p', { class: 'n-sm n-fld__hint n-piece__care-year-prefilled', id: `${id}-prefilled`, text: f.prefilled }) : null,
    );
    const cancel = button(f.cancel, {
      outline: true,
      extraClass: 'n-piece__care-year-dismiss',
      onClick: () => {
        this.form = false;
        this.render('title');
      },
    });
    const form = nocturneForm(
      this.deps.session,
      'yearly-care',
      [field(`${id}-name`, f.name.label, name), addressField],
      f.confirm,
      async () => {
        const problem = careFormProblem(name.value, address.value);
        if (problem) {
          (name.value.trim() === '' ? name : address).setAttribute('aria-invalid', 'true');
          throw new FormError(problem);
        }
        this.care = await this.deps.api.requestCare(this.deps.productId, name.value.trim(), address.value.replace(/\r\n?/g, '\n').trim());
        this.form = false;
        this.render('title');
      },
      cancel,
    );
    return [
      h('p', { class: 'n-tx n-piece__care-year-question' }, ...withNumerals(f.question)),
      h('p', { class: 'n-g n-lb n-piece__care-year-to', text: f.label }),
      h('p', { class: 'n-sm n-piece__care-year-lead', text: f.lead }),
      form,
    ];
  }

  private async cancel(requestId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      this.care = await this.deps.api.cancelCare(requestId);
    } catch (e) {
      this.deps.session.noteError(e);
      this.error = messageOf(e);
    } finally {
      this.busy = false;
    }
    if (!this.disposed) this.render('title');
  }

  private async download(requestId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      saveDownload(await this.deps.api.careLabel(requestId));
    } catch (e) {
      this.deps.session.noteError(e);
      this.error = messageOf(e);
      this.render();
    } finally {
      this.busy = false;
    }
  }
}
