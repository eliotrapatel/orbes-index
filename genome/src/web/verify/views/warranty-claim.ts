/**
 * The WARRANTY CLAIM of a piece in its ORBES CARE tab (plan ORBES CARE §2(a) item 2, answer 9), under WARRANTY, in
 * NOCTURNE's pieces as PRIVATE CARE's block: the label (Gravesend), the step's head, the reading text, DOWNLOAD LABEL (the
 * hairline button), the `.kv` rows and TRACK THE SHIPMENT. care-model.ts claimModel says what it shows; this draws it
 * and saves the prepaid label. The claim comes with the piece's care status (views/yearly-care.ts reads it).
 *
 * Nothing is drawn without a claim of the piece (or one ended more than 30 days ago, which the server no longer sends).
 * Nothing here starts or feeds a claim: no button but DOWNLOAD LABEL and TRACK THE SHIPMENT.
 */
import { h } from '../../shared/dom.js';
import { saveDownload } from '../../shared/download.js';
import type { ApiClient } from '../api.js';
import { claimModel, type ClaimModel } from '../care-model.js';
import type { SessionStore } from '../session.js';
import type { PieceClaim } from '../types.js';
import { withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { button, definitionList, textLink } from './nocturne.js';

export interface WarrantyClaimDeps {
  api: ApiClient;
  session: SessionStore;
}

export class WarrantyClaimBlock {
  readonly root = h('section', { class: 'n-piece__care-section n-piece__claim piece__warranty-claim', attrs: { 'aria-labelledby': 'piece-warranty-claim', hidden: true } });
  private claim: PieceClaim | null = null;
  private error: string | null = null;
  private busy = false;

  constructor(private readonly deps: WarrantyClaimDeps) {}

  /** Draw the piece's claim as the care status sends it (null: none, the block hidden). */
  show(claim: PieceClaim | null | undefined): void {
    if (claim?.id !== this.claim?.id || claim?.status !== this.claim?.status) this.error = null;
    this.claim = claim ?? null;
    this.render();
  }

  private render(): void {
    const m = claimModel(this.claim);
    if (!m) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    this.root.hidden = false;
    this.root.replaceChildren(...this.parts(m).filter((x): x is HTMLElement => x !== null));
  }

  private parts(m: ClaimModel): (HTMLElement | null)[] {
    return [
      h('h3', { class: 'n-g n-lb n-piece__claim-label', id: 'piece-warranty-claim', text: m.label }),
      m.head ? h('p', { class: 'n-g n-t3 n-ivc n-piece__care-year-head', text: m.head }) : null,
      ...m.texts.map((t) => h('p', { class: 'n-tx n-piece__care-year-text' }, ...withNumerals(t))),
      m.download
        ? h('div', { class: 'n-piece__action-line' }, button(m.download, { outline: true, extraClass: 'n-piece__claim-download', onClick: () => void this.download(m.claimId) }))
        : null,
      this.error ? h('p', { class: 'n-err n-piece__care-year-error', attrs: { role: 'alert' }, text: this.error }) : null,
      m.rows.length > 0
        ? definitionList(
            m.rows.map(([label, value]) => [label, h('span', { class: 'n-piece__care-year-value' }, ...withNumerals(value))] as const),
            { kind: 'kv', extraClass: 'n-piece__care-year-rows' },
          )
        : null,
      m.track ? h('p', { class: 'n-piece__action-line' }, this.trackLink(m.track)) : null,
    ];
  }

  /** TRACK THE SHIPMENT, in a new tab, its accessible name saying where (ORDERS.trackLabel). */
  private trackLink(t: { text: string; href: string; label: string }): HTMLElement {
    const link = textLink(t.text, { href: t.href, newTab: true, extraClass: 'n-piece__claim-track' });
    link.setAttribute('aria-label', t.label);
    return link;
  }

  private async download(claimId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      saveDownload(await this.deps.api.claimLabel(claimId));
    } catch (e) {
      this.deps.session.noteError(e);
      this.error = messageOf(e);
      this.render();
    } finally {
      this.busy = false;
    }
  }
}
