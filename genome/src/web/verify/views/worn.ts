/**
 * WORN in a piece's OWNERSHIP tab, after OWNERSHIP CERTIFICATE (macro scope D31, G1 to G3; lot M2 plan §2.3, step
 * M2.10), in NOCTURNE's pieces: on a phone in the panel's one column, on a computer in its right column (CINEMA), the
 * same block, also a drop zone there.
 *
 *   WORN                                        its heading, then the one sentence of what it is
 *   [ CHOOSE A PHOTOGRAPH ]  or drop it here     a file chosen (or dropped), re-encoded on the device (shared/photo.ts)
 *   [ the photograph, as it will be sent ]      then its preview, cropped as the sheet shows it, its credit under it
 *   CAMILLE · FRANCE  @camille.m                (exactly the first name and country, plus the Instagram name when
 *   SHOW MY INSTAGRAM  @camille.m        (o)    SHOW MY INSTAGRAM is on; offered only with a name in YOUR PROFILE)
 *   I took this photograph or have …            the consent, its switch I AGREE, then SEND · CANCEL
 *   IN REVIEW / PUBLISHED                       the photograph sent, its credit; "ORBES is looking at your photograph.";
 *                                               "In WORN since 21 OCT 2026.", SEE IT ON THE SHEET; WITHDRAW, confirmed
 *                                               in place (REMOVE IT FROM WORN?), its bytes erased
 *   NOT PUBLISHED                               the reason in words, then CHOOSE ANOTHER PHOTOGRAPH
 *
 * A profile without its first name or country reads the sentence and YOUR PROFILE; a piece reported lost or stolen, in
 * service or with its transfer pending, one calm sentence. Nothing is drawn while the piece's WORN cannot be read, for a
 * model without a sheet, nor for a test account (worn-model.ts wornState). Sending shows SENDING… and keeps the preview;
 * a refusal of the server is said under it (the 24-hour limit in the server's words), a network failure with TRY AGAIN.
 * The preview is a blob: URL (img-src allows it), released when it is no longer shown.
 */
import { isDesktop } from '../../shared/desktop.js';
import { h } from '../../shared/dom.js';
import { PhotoError, reencodePhoto, type EncodedPhoto } from '../../shared/photo.js';
import { ApiError, type ApiClient } from '../api.js';
import { WORN } from '../copy.js';
import type { SessionStore } from '../session.js';
import type { PieceWorn } from '../types.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import { draftCredit, instagramOffer, wornPhotoWords, WORN_PHOTO_LIMITS, wornState, type CreditLine, type WornRefused } from '../worn-model.js';
import { withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { button, switchControl, textLink } from './nocturne.js';

export interface WornDeps {
  api: ApiClient;
  session: SessionStore;
  productId: string;
  /** The piece's WORN as read with the piece; null when it could not be read (nothing is drawn). */
  worn: PieceWorn | null;
  /**
   * YOUR PROFILE: the account sheet's on a phone, its page on a computer. `closed` runs as the sheet over the piece
   * closes, and the block reads its WORN again (a first name and country saved: CHOOSE A PHOTOGRAPH).
   */
  onProfile?(closed: () => void): void;
  /** SEE IT ON THE SHEET: the model's sheet in THE COLLECTION. */
  onSheet?(slug: string): void;
}

/** The photograph chosen, prepared on the device, until it is sent or put aside. */
interface Draft {
  photo: EncodedPhoto;
  url: string;
  instagram: boolean;
  consent: boolean;
}

type Focus = 'title' | 'choose' | 'send' | 'consent' | 'withdraw' | 'confirm' | null;

/** The codes after which the piece's WORN is read again: something changed elsewhere (another tab, ORBES). */
const STALE = new Set(['WORN_ALREADY', 'WORN_NOT_ALLOWED', 'WORN_PROFILE_INCOMPLETE', 'WORN_CONSENT', 'WORN_NOT_FOUND', 'PRODUCT_NOT_FOUND']);

/**
 * A sending refused, in words: the 24-hour limit in the server's own words (not the house's generic 429), a body the
 * edge or the server found too large as the preparation's own sentence, anything else as every form says it.
 */
export function sendRefusal(e: unknown): string {
  if (e instanceof ApiError && e.code === 'WORN_LIMIT') return e.message;
  if (e instanceof ApiError && e.status === 413) return WORN.tooLarge;
  return messageOf(e);
}

export class WornBlock {
  readonly root = h('section', { class: 'n-piece__worn piece__worn', attrs: { 'aria-labelledby': 'piece-worn' } });
  /** One file input for the block's life: CHOOSE A PHOTOGRAPH opens it (and the tests set its files). */
  private readonly file = h('input', { class: 'n-worn__file', attrs: { type: 'file', accept: 'image/*', hidden: true, tabindex: -1, 'aria-hidden': 'true' } });
  private worn: PieceWorn | null;
  private draft: Draft | null = null;
  /** The file being prepared: a later choice replaces it. */
  private preparing: Promise<EncodedPhoto> | null = null;
  private busy = false;
  private confirm = false;
  private error: string | null = null;
  /** The last sending failed on the network: SEND reads TRY AGAIN. */
  private retry = false;
  private notice: string | null = null;
  private dragging = 0;
  private disposed = false;

  constructor(private readonly deps: WornDeps) {
    this.worn = deps.worn;
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.prepare(f);
    });
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private render(focus: Focus = null): void {
    if (this.disposed) return;
    const s = wornState(this.worn);
    if (s.kind === 'hidden' || !this.worn) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    this.root.hidden = false;
    const out: (HTMLElement | null)[] = [
      h('h3', { class: 'n-g n-t3 n-piece__heading piece__worn-title', id: 'piece-worn', attrs: { tabindex: -1 }, text: WORN.title }),
      h('p', { class: 'n-sm n-piece__text n-piece__text--first n-worn__lead', text: WORN.lead }),
    ];
    switch (s.kind) {
      case 'review':
        out.push(this.stateHead(WORN.review), this.figure(s.photo.url, WORN.photoAlt, s.credit), this.text(WORN.reviewText), ...this.withdrawBlock(s.photo.id, WORN.withdrawAskReview));
        break;
      case 'published':
        out.push(
          this.stateHead(WORN.published),
          this.figure(s.photo.url, WORN.photoAlt, s.credit),
          h('p', { class: 'n-sm n-piece__text n-num n-worn__since' }, ...withNumerals(WORN.publishedSince(s.since))),
          this.confirm ? null : h('p', { class: 'n-piece__action-line n-worn__see' }, this.sheetLink(s.sheet)),
          ...this.withdrawBlock(s.photo.id, WORN.withdrawAsk),
        );
        break;
      case 'blocked':
        out.push(...this.refusedLines(s.refused), this.text(s.text, 'n-worn__blocked'));
        break;
      case 'profile':
        out.push(
          ...this.refusedLines(s.refused),
          this.text(s.text, 'n-worn__profile'),
          this.deps.onProfile ? h('p', { class: 'n-piece__action-line' }, textLink(WORN.profileLink, { onOpen: () => this.deps.onProfile?.(() => this.afterProfile()), extraClass: 'n-worn__profile-link' })) : null,
        );
        break;
      case 'choose':
        out.push(...this.refusedLines(s.refused), ...(this.draft ? this.draftBlock(this.draft) : [this.chooseZone(s.action)]));
        break;
    }
    out.push(this.notice ? h('p', { class: 'n-sm n-ivc n-piece__text n-worn__notice', attrs: { role: 'status' }, text: this.notice }) : null);
    const hadFocus = this.root.contains(document.activeElement);
    this.root.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel);
    let target: HTMLElement | null = null;
    if (focus === 'title') target = q('#piece-worn');
    else if (focus === 'choose') target = q('.n-worn__choose') ?? q('#piece-worn');
    else if (focus === 'send') target = q('.n-worn__send');
    else if (focus === 'consent') target = q('.n-worn__consent input');
    else if (focus === 'withdraw') target = q('.n-worn__withdraw') ?? q('#piece-worn');
    else if (focus === 'confirm') target = q('.n-worn__confirm');
    // A re-render replaced the focused control (busy): keep the keyboard in the block.
    else if (hadFocus && !this.root.contains(document.activeElement)) target = q('#piece-worn');
    target?.focus({ preventScroll: focus === null });
  }

  private stateHead(text: string): HTMLElement {
    return h('p', { class: 'n-g n-lb n-ivc n-worn__state', text });
  }

  private text(t: string, extra?: string): HTMLElement {
    return h('p', { class: ['n-sm', 'n-piece__text', extra] }, ...withNumerals(t));
  }

  private refusedLines(r: WornRefused | null): HTMLElement[] {
    return r ? [this.stateHead(r.head), this.text(r.text, 'n-worn__reason')] : [];
  }

  /** The photograph, cropped as the sheet shows it (4:5), its credit under it in the label face. */
  private figure(src: string | null, alt: string, credit: CreditLine | null): HTMLElement {
    return h(
      'figure',
      { class: 'n-worn__figure' },
      h('div', { class: 'n-worn__frame' }, src ? h('img', { class: 'n-worn__img', attrs: { src, alt, decoding: 'async' } }) : null),
      credit ? this.creditView(credit) : null,
    );
  }

  /** `CAMILLE · FRANCE` and, when shown, `@camille.m`: a link to its page on the sheet, plain text here (it is the owner's). */
  private creditView(c: CreditLine): HTMLElement {
    return h(
      'figcaption',
      { class: 'n-worn__credit' },
      h('span', { class: 'n-g n-lb n-ivc n-worn__name', text: c.line }),
      c.handle ? h('span', { class: 'n-sm n-worn__handle', text: c.handle }) : null,
    );
  }

  private sheetLink(slug: string): HTMLElement {
    return textLink(WORN.seeOnSheet, { href: lookbookSheetPath(slug), onOpen: this.deps.onSheet ? () => this.deps.onSheet!(slug) : undefined, extraClass: 'n-worn__see-link' });
  }

  /** WITHDRAW, then its question in place: WITHDRAW · CANCEL. */
  private withdrawBlock(id: string, ask: string): (HTMLElement | null)[] {
    const err = this.errorLine();
    if (!this.confirm) {
      return [err, h('div', { class: 'n-piece__action n-worn__action' }, button(WORN.withdraw, { outline: true, extraClass: 'n-worn__withdraw', onClick: () => this.openConfirm(), attrs: { disabled: this.busy } }))];
    }
    return [
      h('p', { class: 'n-g n-t3 n-ivc n-worn__ask', text: ask }),
      err,
      h(
        'div',
        { class: 'n-duo n-piece__duo n-worn__duo' },
        button(WORN.withdraw, { extraClass: 'n-worn__confirm', onClick: () => void this.withdraw(id), attrs: { disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' } }),
        button(WORN.cancel, { outline: true, extraClass: 'n-worn__keep', onClick: () => this.closeConfirm(), attrs: { disabled: this.busy } }),
      ),
    ];
  }

  /** CHOOSE A PHOTOGRAPH; on a computer the block's zone also takes a photograph dropped on it. */
  private chooseZone(action: string): HTMLElement {
    const preparing = this.preparing !== null;
    const choose = button(preparing ? WORN.preparing : action, {
      outline: true,
      extraClass: 'n-worn__choose',
      onClick: () => this.file.click(),
      attrs: { disabled: preparing, 'aria-busy': preparing ? 'true' : 'false' },
    });
    const zone = h('div', { class: ['n-worn__zone', this.dragging > 0 ? 'is-over' : null] }, choose, this.file, isDesktop() ? h('p', { class: 'n-sm n-worn__drop', attrs: { 'aria-hidden': 'true' }, text: WORN.drop }) : null);
    if (isDesktop()) this.dropZone(zone);
    return h('div', { class: 'n-piece__action n-worn__choice' }, zone, this.errorLine());
  }

  private dropZone(zone: HTMLElement): void {
    const files = (ev: DragEvent) => Array.from(ev.dataTransfer?.types ?? []).includes('Files');
    zone.addEventListener('dragenter', (ev) => {
      if (!files(ev)) return;
      ev.preventDefault();
      this.dragging++;
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragover', (ev) => {
      if (!files(ev)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', () => {
      this.dragging = Math.max(0, this.dragging - 1);
      if (this.dragging === 0) zone.classList.remove('is-over');
    });
    zone.addEventListener('drop', (ev) => {
      ev.preventDefault();
      this.dragging = 0;
      zone.classList.remove('is-over');
      const f = ev.dataTransfer?.files?.[0];
      if (f && this.preparing === null && !this.busy) void this.prepare(f);
    });
  }

  /** The photograph chosen: its preview and credit, SHOW MY INSTAGRAM, the consent, SEND · CANCEL. */
  private draftBlock(d: Draft): (HTMLElement | null)[] {
    const w = this.worn!;
    const handle = instagramOffer(w);
    const instagram = handle
      ? switchControl({
          label: `${WORN.instagram} ${handle}`,
          checked: d.instagram,
          onChange: (on) => {
            d.instagram = on;
            // Only the credit changes: the switch keeps the focus.
            const old = this.root.querySelector('.n-worn__figure .n-worn__credit');
            const credit = draftCredit(w, on);
            if (old && credit) old.replaceWith(this.creditView(credit));
          },
        })
      : null;
    if (instagram) instagram.input.disabled = this.busy;
    const consent = switchControl({
      label: WORN.consentLabel,
      checked: d.consent,
      onChange: (on) => {
        d.consent = on;
        if (on && this.error === WORN.consentMissing) {
          this.error = null;
          this.root.querySelector('.n-worn__error')?.remove();
        }
      },
    });
    consent.input.disabled = this.busy;
    consent.input.setAttribute('aria-describedby', 'piece-worn-consent');
    return [
      this.figure(d.url, WORN.previewAlt, draftCredit(w, d.instagram)),
      instagram
        ? h('label', { class: 'n-row n-worn__row n-worn__instagram' }, h('span', { class: 'n-g n-row__label' }, `${WORN.instagram} `, h('span', { class: 'n-worn__row-handle', text: handle ?? '' })), instagram.el)
        : null,
      h('p', { class: 'n-sm n-piece__text n-worn__consent-text', id: 'piece-worn-consent', text: WORN.consent }),
      h('label', { class: 'n-row n-worn__row n-worn__consent' }, h('span', { class: 'n-g n-row__label', text: WORN.consentLabel }), consent.el),
      this.errorLine(),
      h(
        'div',
        { class: 'n-duo n-piece__duo n-worn__duo' },
        button(this.busy ? WORN.sending : this.retry ? WORN.retry : WORN.send, {
          extraClass: 'n-worn__send',
          onClick: () => void this.send(),
          attrs: { disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' },
        }),
        button(WORN.cancel, { outline: true, extraClass: 'n-worn__cancel', onClick: () => this.putAside(), attrs: { disabled: this.busy } }),
      ),
    ];
  }

  private errorLine(): HTMLElement | null {
    return this.error ? h('p', { class: 'n-err n-piece__error n-worn__error', attrs: { role: 'alert' }, text: this.error }) : null;
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  /** A file chosen or dropped: prepared on the device (its orientation applied, its metadata gone), then previewed. */
  private async prepare(f: File): Promise<void> {
    if (this.busy) return;
    this.error = null;
    this.notice = null;
    this.retry = false;
    const pending = reencodePhoto(f, WORN_PHOTO_LIMITS, wornPhotoWords());
    this.preparing = pending;
    this.render();
    try {
      const photo = await pending;
      if (this.preparing !== pending || this.disposed) return;
      this.release();
      this.draft = { photo, url: URL.createObjectURL(photo.blob), instagram: false, consent: false };
      this.preparing = null;
      this.render('title');
      // The preview stands where the button was: the block's heading takes the keyboard, the preview in view.
      this.root.querySelector('.n-worn__figure')?.scrollIntoView?.({ block: 'nearest' });
    } catch (e) {
      if (this.preparing !== pending || this.disposed) return;
      this.preparing = null;
      this.error = e instanceof PhotoError ? e.message : WORN.unreadable;
      this.render('choose');
    }
  }

  /** CANCEL: the photograph put aside, CHOOSE A PHOTOGRAPH again. */
  private putAside(): void {
    this.release();
    this.error = null;
    this.retry = false;
    this.render('choose');
  }

  private release(): void {
    if (this.draft) URL.revokeObjectURL(this.draft.url);
    this.draft = null;
  }

  /** SEND: the photograph and the consent's version; done, the block reads IN REVIEW. */
  private async send(): Promise<void> {
    const d = this.draft;
    const w = this.worn;
    if (!d || !w || this.busy) return;
    if (!d.consent) {
      this.error = WORN.consentMissing;
      this.render('consent');
      return;
    }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.worn = await this.deps.api.sendWorn(this.deps.productId, d.photo.blob, { instagram: d.instagram && instagramOffer(w) !== null, consent: w.consentVersion });
      this.release();
      this.retry = false;
      this.busy = false;
      this.render('title');
      return;
    } catch (e) {
      this.deps.session.noteError(e);
      this.error = sendRefusal(e);
      this.retry = e instanceof ApiError && e.isNetwork;
      if (e instanceof ApiError && STALE.has(e.code)) {
        // Read again: the piece's state, or the consent's version, changed since it was read.
        await this.reread();
        if (e.code === 'WORN_CONSENT') d.consent = false;
        else if (wornState(this.worn).kind !== 'choose') this.release();
      }
    }
    this.busy = false;
    this.render(this.draft ? 'send' : 'title');
  }

  private openConfirm(): void {
    this.confirm = true;
    this.error = null;
    this.notice = null;
    this.render('confirm');
  }

  private closeConfirm(): void {
    this.confirm = false;
    this.error = null;
    this.render('withdraw');
  }

  /** WITHDRAW, confirmed: the photograph leaves WORN (or its review) at once, erased; CHOOSE A PHOTOGRAPH again. */
  private async withdraw(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await this.deps.api.withdrawWorn(id);
      this.confirm = false;
      this.notice = WORN.withdrawn;
      const before = this.worn!;
      if (!(await this.reread())) this.worn = { ...before, photo: null, reason: before.reason === 'LIVE' ? null : before.reason, canSend: before.reason === 'LIVE' || before.reason === null };
    } catch (e) {
      this.deps.session.noteError(e);
      this.error = messageOf(e);
      if (e instanceof ApiError && STALE.has(e.code)) {
        this.confirm = false;
        await this.reread();
      }
    } finally {
      this.busy = false;
    }
    this.render(this.confirm ? 'confirm' : wornState(this.worn).kind === 'choose' ? 'choose' : 'title');
  }

  /** The account sheet opened by YOUR PROFILE closed (a phone): read again, so a profile now complete offers CHOOSE A PHOTOGRAPH. */
  private afterProfile(): void {
    if (this.deps.session.state.status === 'signed-in') void this.refresh();
  }

  /** After a change of the piece elsewhere on its page (a report, PIECE FOUND, a transfer cancelled): read again, drawn again. */
  async refresh(): Promise<void> {
    if (this.busy || this.disposed) return;
    if (await this.reread()) {
      if (wornState(this.worn).kind !== 'choose') this.release();
      this.confirm = false;
      this.render();
    }
  }

  /** The piece's WORN as the server holds it now; false when it cannot be read just now (what was shown stays). */
  private async reread(): Promise<boolean> {
    try {
      this.worn = await this.deps.api.wornOfPiece(this.deps.productId);
      return true;
    } catch (e) {
      this.deps.session.noteError(e);
      return false;
    }
  }
}
