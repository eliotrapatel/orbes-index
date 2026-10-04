/**
 * The ownership certificate (F-06, /verify/c#…): the page a buyer or an
 * insurer opens from the link an owner shared from MY PIECES.
 *
 *              ORBES                         small wordmark
 *     O W N E R S H I P   C E R T I F I C A T E
 *                VALID                       or NO LONGER VALID, NOT FOUND
 *   What the ORBES registry records about this piece, read just now. …
 *   ┌                      ┐
 *     GENOME  O26-J-00184                    the écrin of MY PIECES
 *     ◔ · ◯ · ◕ · …
 *     G1-E1DC-BE52 · GENOME-01
 *   └                      ┘
 *   MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026
 *   DISCONTINUED · 2027                      once its model was (P-R06)
 *   THE RECORD        OWNERSHIP · SINCE · WARRANTY (FROM, UNTIL) · LOSS OR THEFT
 *   THIS CERTIFICATE  CHECKED · ISSUED · VALID UNTIL
 *   A certificate names no owner. …
 *            [ DOWNLOAD PDF ]
 *            SCAN ORBES CODE
 *   VERIFY ONLY AT THEORBES.COM/VERIFY
 *
 * The token is the link's fragment: the page sends it in the body of a POST
 * (lookup, PDF), so it never appears in a request line or a proxy's log. No
 * session is needed and none is used. Never the word AUTHENTIC: a
 * certificate attests a record, not the object it is shown with.
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { saveDownload } from '../../shared/download.js';
import { ApiError, type ApiClient } from '../api.js';
import { certificateScreen, type CertificateScreen } from '../certificate-model.js';
import { CERTIFICATE } from '../copy.js';
import { genomeBlock } from '../genome-view.js';
import { rows, sectionLabel, viewRoot } from './common.js';
import { messageOf } from './forms.js';

export interface CertificateDeps {
  api: ApiClient;
  /** The token of the link's fragment (certificateTokenOf), or null when the address carries none. */
  token: string | null;
  /** SCAN ORBES CODE. */
  onScan(): void;
  /** Minutes east of UTC of the viewer, for the time the record was read. */
  offsetMinutes: number;
}

export interface CertificateView {
  root: HTMLElement;
  dispose(): void;
}

type Load = { kind: 'loading' } | { kind: 'ready'; screen: CertificateScreen } | { kind: 'failed'; message: string };

export function certificateView(deps: CertificateDeps): CertificateView {
  const page = new CertificatePage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class CertificatePage {
  readonly root: HTMLElement;
  private readonly state = h('p', { class: 'certificate__state', attrs: { 'aria-live': 'polite' } });
  private readonly lead = h('p', { class: 'prose certificate__lead' });
  private readonly body = h('div', { class: 'certificate__body' });
  private readonly foot = h('footer', { class: 'certificate__foot' });
  private load: Load = { kind: 'loading' };
  private disposed = false;
  private busy = false;
  private error: string | null = null;

  constructor(private readonly deps: CertificateDeps) {
    this.root = viewRoot('certificate', 'certificate-title');
    this.root.append(
      h(
        'header',
        { class: 'certificate__head' },
        h('span', { class: 'wordmark wordmark--small certificate__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }),
        h('h1', { class: 'certificate__title', id: 'certificate-title', text: CERTIFICATE.title }),
        this.state,
        this.lead,
      ),
      this.body,
      this.foot,
    );
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Read the certificate: a 404 (or no token) is NOT FOUND; a failure of the network or the server offers TRY AGAIN. */
  private async fetch(): Promise<void> {
    this.load = { kind: 'loading' };
    this.render();
    const token = this.deps.token;
    if (token === null) {
      this.load = { kind: 'ready', screen: certificateScreen(null) };
      this.render();
      return;
    }
    try {
      const r = await this.deps.api.lookupCertificate(token);
      if (this.disposed) return;
      this.load = { kind: 'ready', screen: certificateScreen(r, { offsetMinutes: this.deps.offsetMinutes }) };
    } catch (e) {
      if (this.disposed) return;
      this.load = e instanceof ApiError && e.status === 404 ? { kind: 'ready', screen: certificateScreen(null) } : { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  private render(): void {
    // A control that had the keyboard focus is replaced below: the focus then goes to its successor.
    const hadFocus = this.body.contains(document.activeElement) || this.foot.contains(document.activeElement);
    const l = this.load;
    if (l.kind === 'loading') {
      this.state.textContent = '';
      this.lead.textContent = '';
      this.lead.hidden = true;
      this.body.replaceChildren(h('p', { class: 'ownership__meta micro soft certificate__waiting', attrs: { 'aria-busy': 'true' }, text: CERTIFICATE.loading }));
      this.foot.replaceChildren();
      return;
    }
    if (l.kind === 'failed') {
      this.state.textContent = '';
      this.lead.hidden = true;
      this.body.replaceChildren(
        h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${CERTIFICATE.failed} ${l.message}` }),
        h('div', { class: 'ownership__actions' }, h('button', { class: 'textlink certificate__retry', attrs: { type: 'button' }, on: { click: () => void this.fetch() }, text: CERTIFICATE.retry })),
      );
      this.foot.replaceChildren(this.scanButton('btn'));
      if (hadFocus) this.root.querySelector<HTMLElement>('.certificate__retry')?.focus();
      return;
    }
    const s = l.screen;
    this.root.dataset.state = s.kind;
    this.state.textContent = s.state;
    this.lead.textContent = s.lead;
    this.lead.hidden = false;
    if (s.kind !== 'valid') {
      this.body.replaceChildren();
      this.foot.replaceChildren(this.scanButton('btn'), this.verifyOnly());
      if (hadFocus) this.foot.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    const titleId = `${s.key || 'certificate'}-title`;
    this.body.replaceChildren(
      bracket(
        h(
          'div',
          { class: 'piece__plate certificate__plate' },
          s.genome ? genomeBlock(s.genome, { titleId }) : h('h2', { class: 'genome__id', id: titleId, text: s.productId }),
        ),
      ),
      h('ul', { class: 'lines certificate__lines', attrs: { 'aria-label': 'Piece' } }, ...s.productLines.map((line) => h('li', { class: 'lines__line', text: line }))),
      h('section', { class: 'certificate__section', attrs: { 'aria-labelledby': 'certificate-record' } }, sectionLabel(CERTIFICATE.record, 'certificate-record'), rows(s.recordRows)),
      h('section', { class: 'certificate__section', attrs: { 'aria-labelledby': 'certificate-self' } }, sectionLabel(CERTIFICATE.certificate, 'certificate-self'), rows(s.certificateRows)),
      h('p', { class: 'prose certificate__note', text: s.note }),
    );
    const pdf = h('button', {
      class: 'btn certificate__pdf',
      attrs: { type: 'button', 'aria-busy': this.busy ? 'true' : 'false', disabled: this.busy },
      on: { click: () => void this.download() },
      text: CERTIFICATE.pdf,
    });
    const error = this.error ? [h('p', { class: 'form__error', attrs: { role: 'alert' }, text: this.error })] : [];
    this.foot.replaceChildren(pdf, ...error, this.scanButton('textlink'), this.verifyOnly());
    if (hadFocus) (this.error ? pdf : this.foot.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
  }

  private scanButton(kind: 'btn' | 'textlink'): HTMLButtonElement {
    return h('button', { class: `${kind} certificate__scan`, attrs: { type: 'button' }, on: { click: () => this.deps.onScan() }, text: CERTIFICATE.scan });
  }

  private verifyOnly(): HTMLElement {
    return h('p', { class: 'certificate__footnote micro soft', text: CERTIFICATE.verifyOnly });
  }

  /** DOWNLOAD PDF: the certificate as it reads now. Once it no longer holds (409), the page reads it again. */
  private async download(): Promise<void> {
    const token = this.deps.token;
    if (this.busy || token === null) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      saveDownload(await this.deps.api.certificatePdf(token));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        this.busy = false;
        await this.fetch();
        return;
      }
      this.error = e instanceof ApiError && e.status >= 500 ? CERTIFICATE.pdfFailed : messageOf(e);
    } finally {
      this.busy = false;
    }
    if (!this.disposed) this.render();
  }
}
