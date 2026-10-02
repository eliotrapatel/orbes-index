/**
 * Sale mode (A-08, `#/sale`): the counter of a boutique, on the seller's phone.
 *
 *   POINT OF SALE (remembered on this phone)
 *   SCAN THE PIECE ─▶ camera, the orbit, the decoder worker ─▶ CHECKING THE PIECE
 *   ─▶ the piece: READY TO SELL, or why it cannot be sold ─▶ ACTIVATE WARRANTY
 *   ─▶ WARRANTY ACTIVE, and the sentence for the client ─▶ NEXT SALE
 *
 * The camera, the frame pump, the decoder client and the photo fallback are
 * the verification app's (verify/scanner.ts), its worker bundled for the
 * console (admin/worker.ts): the console's main bundle carries no decoder.
 * The lookup records one ADMIN_TEST scan under this console user and, when
 * the piece can be sold, returns a 10-minute token that the activation spends
 * (POST /api/admin/sale/lookup, /activate). The token lives in this module
 * only and goes with the screen.
 */
import { bracket } from '../../shared/corners.js';
import { h, mount } from '../../shared/dom.js';
import { buildVerifyInput, defaultZoomLevel } from '../../verify/capture.js';
import { HINTS, PROBLEMS, SCAN_GUIDE, type ProblemKind } from '../../verify/copy.js';
import type { DecodeReply } from '../../verify/protocol.js';
import { Camera, CameraError, DecoderClient, DecoderUnavailableError, PhotoError, readPhoto, ScanSession, workerUrl } from '../../verify/scanner.js';
import { ApiError } from '../api.js';
import { formatDate, humanize } from '../format.js';
import { CLIENT_REGISTRATION, minutesLeft, pieceLines, preselectedRetailer, RETAILER_STORAGE_KEY, retailerOptions, saleVerdict } from '../model/sale.js';
import { toneOf } from '../model/tone.js';
import type { Retailer, SaleLookup } from '../types.js';
import { button, defList, field, loading, pageHeader, select, statusMark } from '../ui/components.js';
import type { ViewContext } from './context.js';

/** The open sale screen, so main.ts can stop its camera when the console moves elsewhere or signs out. */
let current: SaleFlow | null = null;
/** Bumped by every disposal: a sale screen whose points of sale arrive after one was never shown. */
let screens = 0;

/** Stop the camera and forget the sale token of the sale screen, if one is open. */
export function disposeSaleView(): void {
  screens++;
  current?.dispose();
  current = null;
}

export async function saleView(ctx: ViewContext): Promise<HTMLElement> {
  const asked = screens;
  const retailers = (await ctx.api.retailers({ activeOnly: true })).items;
  // The console moved on (or opened the sale mode again) while the list was on its way: this screen is
  // stale. Neither a camera, a decoder worker nor listeners for it, and the one now open is left alone.
  if (asked !== screens) return h('div', { class: 'view view--sale' });
  disposeSaleView();
  const flow = new SaleFlow(ctx, retailers);
  current = flow;
  return flow.root;
}

function remembered(): string | null {
  try {
    return localStorage.getItem(RETAILER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    if (id) localStorage.setItem(RETAILER_STORAGE_KEY, id);
  } catch {
    /* private mode: chosen again next time */
  }
}

class SaleFlow {
  readonly root: HTMLElement;
  private readonly stage = h('div', { class: 'sale__stage', attrs: { 'aria-live': 'polite' } });
  private readonly where: HTMLSelectElement | null;
  private readonly photo = h('input', { class: 'visually-hidden', attrs: { type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'sale-photo' } });
  private readonly camera = new Camera();
  private decoder: DecoderClient | null = null;
  private session: ScanSession | null = null;
  /** Bumped by every step; async work started under an older value is dropped. */
  private generation = 0;
  private disposed = false;
  /** The camera is released in the background (battery, the privacy indicator); the seller scans again on return. */
  private readonly onHidden = (ev: Event) => {
    const away = ev.type === 'pagehide' || document.visibilityState === 'hidden';
    if (away && this.stage.querySelector('[data-testid=sale-camera]')) this.showReady();
  };

  constructor(
    private readonly ctx: ViewContext,
    retailers: readonly Retailer[],
  ) {
    const options = retailerOptions(retailers);
    let whereField: HTMLElement;
    if (options.length === 0) {
      this.where = null;
      whereField = h('p', { class: 'sale__notice', data: { testid: 'sale-no-retailer' } }, 'No point of sale is registered yet. An ADMIN adds them on the Points of sale page; until then a warranty cannot be started here.');
    } else {
      this.where = select('retailerId', [{ value: '', label: 'Choose the point of sale' }, ...options], preselectedRetailer(retailers, remembered()));
      this.where.setAttribute('data-testid', 'sale-retailer');
      this.where.addEventListener('change', () => {
        remember(this.where!.value);
        // A scan that can no longer be used (data-dead) stays off: the way forward is a new scan.
        this.stage.querySelector<HTMLButtonElement>('[data-testid=sale-activate]:not([data-dead])')?.toggleAttribute('disabled', !this.where!.value);
      });
      whereField = field('Point of sale', this.where, { hint: 'Remembered on this phone for the next sale.', wide: true });
    }
    this.photo.addEventListener('change', () => {
      const file = this.photo.files?.[0];
      this.photo.value = '';
      if (file) void this.readPhoto(file);
    });
    this.root = h(
      'div',
      { class: 'view view--sale', data: { testid: 'sale' } },
      pageHeader({ eyebrow: 'Boutique', title: 'Sale mode', lead: 'Scan the ORBES CODE of the piece being sold, then start its warranty.' }),
      h('div', { class: 'sale__where' }, whereField),
      this.stage,
      this.photo,
    );
    this.showReady();
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onHidden);
    // Boot the decoder worker and compile the decoder while the seller picks the piece up.
    const warm = () => void this.decoderClient()?.warm();
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle.call(window, warm);
    else setTimeout(warm, 300);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pagehide', this.onHidden);
    this.disposed = true;
    this.generation++;
    this.stopCamera();
    this.decoder?.dispose();
    this.decoder = null;
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  private show(...children: (HTMLElement | null)[]): void {
    mount(this.stage, ...children);
  }

  private showReady(): void {
    this.generation++;
    this.stopCamera();
    const scan = button('Scan the piece', { kind: 'primary', testId: 'sale-scan', onClick: () => void this.startScan() });
    const upload = button('Upload a photo', { kind: 'ghost', testId: 'sale-upload', onClick: () => this.photo.click() });
    this.show(h('div', { class: 'sale__start' }, scan, upload, h('p', { class: 'sale__note' }, 'Each scan here is recorded under your name.')));
  }

  private showChecking(text = 'Checking the piece'): void {
    this.show(loading(text));
  }

  private showProblem(kind: ProblemKind): void {
    this.generation++;
    this.stopCamera();
    const copy = PROBLEMS[kind];
    this.show(
      h(
        'div',
        { class: 'sale__problem', attrs: { role: 'alert' }, data: { testid: 'sale-problem' } },
        h('p', { class: 'sale__title' }, copy.title),
        h('p', { class: 'sale__text' }, copy.message),
        h(
          'div',
          { class: 'sale__actions' },
          button('Scan again', { kind: 'primary', onClick: () => void this.startScan() }),
          button('Upload a photo', { kind: 'ghost', onClick: () => this.photo.click() }),
        ),
      ),
    );
  }

  private showFailure(message: string): void {
    this.show(
      h(
        'div',
        { class: 'sale__problem', attrs: { role: 'alert' }, data: { testid: 'sale-problem' } },
        h('p', { class: 'sale__title' }, 'Unavailable'),
        h('p', { class: 'sale__text' }, message),
        h('div', { class: 'sale__actions' }, button('Scan again', { kind: 'primary', onClick: () => void this.startScan() })),
      ),
    );
  }

  /** The piece behind the scanned code, and the activation when it can be sold. */
  private showPiece(r: SaleLookup): void {
    const verdict = saleVerdict(r);
    const p = r.piece;
    const error = h('p', { class: 'form-error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'sale__verdict', data: { testid: 'sale-verdict' } }, statusMark(verdict.label, verdict.tone)),
    ];
    if (p) {
      const [first, second] = pieceLines(p);
      parts.push(
        h('p', { class: 'sale__id', data: { testid: 'sale-product' } }, p.productId),
        h('p', { class: 'sale__line' }, first),
        h('p', { class: 'sale__line sale__line--soft' }, second),
        defList([
          { label: 'Status', value: statusMark(humanize(p.status), toneOf('product', p.status)) },
          {
            label: 'Warranty',
            value: statusMark(humanize(p.warranty.status), toneOf('warranty', p.warranty.status)),
            note: p.warranty.startDate ? `${formatDate(p.warranty.startDate)} – ${formatDate(p.warranty.endDate)}` : undefined,
          },
          { label: 'Client account', value: p.registered ? 'Registered' : 'Not registered yet' },
        ]),
      );
    }
    parts.push(h('p', { class: 'sale__text', data: { testid: 'sale-message' } }, verdict.message));

    const again = button('Scan another', { kind: verdict.canActivate ? 'ghost' : 'primary', testId: 'sale-again', onClick: () => void this.startScan() });
    if (verdict.canActivate && r.sale) {
      const token = r.sale.token;
      const activate = button('Activate warranty', { kind: 'primary', testId: 'sale-activate', disabled: !this.where?.value });
      activate.addEventListener('click', () => void this.activate(r, token, activate, error));
      parts.push(
        h('div', { class: 'sale__actions' }, activate, again),
        error,
        h('p', { class: 'sale__note' }, this.where ? `This scan stays valid for ${minutesLeft(r.sale.expiresAt, this.ctx.now())} minutes.` : 'Add a point of sale first.'),
      );
    } else {
      parts.push(h('div', { class: 'sale__actions' }, again));
    }
    this.show(h('section', { class: 'sale__piece', attrs: { 'aria-label': 'The scanned piece' } }, ...parts));
    this.stage.querySelector<HTMLElement>('[data-testid=sale-activate]:not([disabled]), [data-testid=sale-again]')?.focus({ preventScroll: true });
  }

  private showDone(r: SaleLookup, result: { warranty: { startDate: string | null; endDate: string | null; retailer: string | null } }): void {
    const w = result.warranty;
    const next = button('Next sale', { kind: 'primary', testId: 'sale-next', onClick: () => void this.startScan() });
    this.show(
      h(
        'section',
        { class: 'sale__piece sale__piece--done', attrs: { 'aria-label': 'Warranty active' }, data: { testid: 'sale-done' } },
        h('div', { class: 'sale__verdict' }, statusMark('WARRANTY ACTIVE', 'solid')),
        h('p', { class: 'sale__id' }, r.piece?.productId ?? ''),
        h('p', { class: 'sale__line' }, `${formatDate(w.startDate)} – ${formatDate(w.endDate)}`),
        h('p', { class: 'sale__line sale__line--soft' }, w.retailer ?? ''),
        bracket(
          h(
            'div',
            { class: 'sale__client' },
            h('p', { class: 'sale__label' }, 'Tell the client'),
            h('p', { class: 'sale__client-text', data: { testid: 'sale-client-note' } }, CLIENT_REGISTRATION),
            h('p', { class: 'sale__note' }, 'Hand over the certificate card: its claim code proves the piece is theirs when they register it.'),
          ),
        ),
        h('div', { class: 'sale__actions' }, next),
      ),
    );
    next.focus({ preventScroll: true });
  }

  // ── Camera ───────────────────────────────────────────────────────────────

  private decoderClient(): DecoderClient | null {
    if (!this.decoder && !this.disposed) {
      try {
        this.decoder = new DecoderClient(workerUrl());
      } catch {
        this.decoder = null;
      }
    }
    return this.decoder;
  }

  private stopCamera(): void {
    this.session?.stop();
    this.session = null;
    this.camera.stop();
  }

  private async startScan(): Promise<void> {
    const gen = ++this.generation;
    this.stopCamera();
    const decoder = this.decoderClient();
    if (!decoder) return this.showProblem('decoder-failed');

    const video = h('video', { class: 'sale__video', attrs: { playsinline: true, muted: true, autoplay: true, disablepictureinpicture: true, 'aria-hidden': 'true' } });
    const aperture = h('div', { class: 'sale__aperture', attrs: { 'aria-hidden': 'true' } });
    const status = h('p', { class: 'sale__status', attrs: { role: 'status', 'aria-live': 'polite' }, data: { testid: 'sale-status' } }, 'Starting the camera');
    const hint = h('p', { class: 'sale__hint' }, SCAN_GUIDE);
    const torch = button('Light', { kind: 'ghost', testId: 'sale-torch' });
    torch.hidden = true;
    torch.setAttribute('aria-pressed', 'false');
    torch.addEventListener('click', () => {
      const on = !this.camera.torch;
      void this.camera.setTorch(on).then((ok) => ok && torch.setAttribute('aria-pressed', on ? 'true' : 'false'));
    });
    const frame = h('div', { class: 'sale__camera', data: { testid: 'sale-camera' } }, video, aperture);
    this.show(
      h(
        'div',
        { class: 'sale__scan' },
        frame,
        status,
        hint,
        h('div', { class: 'sale__actions' }, torch, button('Upload a photo', { kind: 'ghost', onClick: () => this.photo.click() }), button('Close', { kind: 'ghost', testId: 'sale-close', onClick: () => this.showReady() })),
      ),
    );

    try {
      const caps = await this.camera.start(video);
      if (gen !== this.generation) return this.camera.stop();
      torch.hidden = !caps.torch;
      // About 2× when the camera can: small codes read from a distance the camera can focus at.
      const level = defaultZoomLevel(caps.zoom);
      if (level !== null) await this.camera.setZoom(level);
      if (gen !== this.generation) return this.camera.stop();
    } catch (e) {
      if (gen === this.generation) this.showProblem(e instanceof CameraError ? e.kind : 'camera-failed');
      return;
    }

    let session: ScanSession;
    try {
      session = new ScanSession({ video, reticleSize: () => aperture.getBoundingClientRect().width }, decoder, {
        onDecoded: (reply, ms) => void this.onDecoded(gen, reply, ms, 'camera'),
        onHint: (h) => {
          hint.textContent = h ? HINTS[h] : SCAN_GUIDE;
        },
        onTimeout: () => gen === this.generation && this.showProblem('scan-timeout'),
        onFatal: () => gen === this.generation && this.showProblem('decoder-failed'),
      });
    } catch {
      return this.showProblem('decoder-failed');
    }
    this.session = session;
    frame.classList.add('is-ready');
    status.textContent = 'Scanning';
    session.start();
  }

  private async readPhoto(file: File): Promise<void> {
    const gen = ++this.generation;
    this.stopCamera();
    const decoder = this.decoderClient();
    if (!decoder) return this.showProblem('decoder-failed');
    this.showChecking('Reading the photo');
    try {
      const read = await readPhoto(file, decoder);
      if (gen !== this.generation) return;
      await this.onDecoded(gen, read.reply, read.decodeMs, 'upload');
    } catch (e) {
      if (gen !== this.generation) return;
      this.showProblem(e instanceof PhotoError ? e.kind : e instanceof DecoderUnavailableError ? 'decoder-failed' : 'upload-unreadable');
    }
  }

  private async onDecoded(gen: number, reply: Extract<DecodeReply, { ok: true }>, decodeMs: number, source: 'camera' | 'upload'): Promise<void> {
    if (gen !== this.generation) return;
    navigator.vibrate?.(12);
    this.stopCamera();
    this.showChecking();
    try {
      const r = await this.ctx.api.saleLookup(buildVerifyInput(reply.decoded, source, decodeMs));
      if (gen !== this.generation) return;
      this.showPiece(r);
    } catch (e) {
      if (gen !== this.generation) return;
      if (e instanceof ApiError && e.status === 401) return; // the console shows the sign-in
      this.showFailure(e instanceof ApiError ? e.message : 'The piece could not be checked. Try again.');
    }
  }

  // ── Activation ───────────────────────────────────────────────────────────

  private async activate(r: SaleLookup, token: string, btn: HTMLButtonElement, error: HTMLElement): Promise<void> {
    const retailerId = this.where?.value ?? '';
    error.textContent = '';
    if (!retailerId) {
      error.textContent = 'Choose the point of sale first.';
      this.where?.focus();
      return;
    }
    const gen = this.generation;
    const label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Activating…';
    try {
      const done = await this.ctx.api.saleActivate(token, retailerId);
      if (gen !== this.generation) return;
      remember(retailerId);
      this.showDone(r, done);
    } catch (e) {
      if (gen !== this.generation) return;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = label;
      if (e instanceof ApiError && e.status === 401) return;
      error.textContent = e instanceof ApiError ? e.message : 'The warranty could not be started. Try again.';
      // A scan that can no longer be used: the way forward is a new one, whatever point of sale is chosen next.
      if (e instanceof ApiError && /^SALE_TOKEN_/.test(e.code)) {
        btn.disabled = true;
        btn.setAttribute('data-dead', '');
      }
    }
  }
}
