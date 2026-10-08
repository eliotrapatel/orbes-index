/**
 * A parcel's page, `#/logistics/orders/:orderId` (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.6.8): what the agent
 * packs and ships, read from the parcel's own reply (`GET /api/admin/logistics/orders/:id`, ShippingOrderView): no
 * price, no email, no account, no release. ORBES staff take the same steps from the order page (§3.5.4.4), whose
 * Shipping section is drawn here too (`parcelSections`), with a declared value per order for ORBES only.
 *
 *  - Parcel: per order, the piece (MONOLITHE · BLUE), its size, add-ons, engraving and surprise.
 *  - Ship to: the name, the address, the country and the phone; ADDRESS CHANGED when the address was replaced.
 *  - Packing: Start packing (the address and the engraving lock for the collector); the checklist, each card ticked by
 *    its scan only; Scan the card (the sale mode's camera and photo reader, verify/scanner.ts); Add the photo (scaled
 *    to 1600 px as a JPEG of at most 1 MiB, seen by ORBES only); Packed, once every line is ticked, every card scanned
 *    and the photo added.
 *  - Shipment: Ship (a carrier of the parcel's reply, the tracking number), Mark delivered, Report a parcel problem.
 *  - History: the parcel's steps, who (a role, never a name) and when.
 * Each request is audited by the server; the page is read again.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { buildVerifyInput, defaultZoomLevel } from '../../verify/capture.js';
import { HINTS, PROBLEMS, SCAN_GUIDE, type ProblemKind } from '../../verify/copy.js';
import type { DecodeReply } from '../../verify/protocol.js';
import { Camera, CameraError, DecoderClient, DecoderUnavailableError, PhotoError, readPhoto, ScanSession, workerUrl } from '../../verify/scanner.js';
import { ApiError } from '../api.js';
import { formatDateTime } from '../format.js';
import { parseMoney } from '../model/live.js';
import {
  addressChangedLine,
  checklistComplete,
  HISTORY_BY,
  HISTORY_LABELS,
  PACKING_PHOTO_MAX_SIDE,
  PACKING_TEXT,
  PARCEL_PROBLEM_LABELS,
  PARCEL_STEP_LABELS,
  parcelActions,
  pieceWords,
  reportProblem,
  scanMessage,
  shipProblem,
  sizeText,
} from '../model/logistics.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import type { ShippingOrderView } from '../types.js';
import { button, checkbox, defList, linkButton, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { reencodePhoto } from '../ui/photo.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The open scanner, so main.ts can stop its camera when the console moves elsewhere or signs out. */
let scanner: CardScanner | null = null;

/** Stop the camera of a parcel's scanner, if one is open. */
export function disposeShippingView(): void {
  scanner?.dispose();
  scanner = null;
}

export async function shippingView(ctx: ViewContext): Promise<HTMLElement> {
  const view = await ctx.api.parcel(ctx.route.params.orderId ?? '');
  disposeShippingView();
  return h(
    'div',
    { class: 'view view--shipping', data: { testid: 'parcel' } },
    pageHeader({
      eyebrow: 'Logistics · To ship',
      title: view.reference,
      identifier: true,
      lead: `${view.location.name} · ${PARCEL_STEP_LABELS[view.step]}`,
      actions: [linkButton('Packing slip', href('logisticsSlip', { orderId: view.id }), 'secondary'), linkButton('Back to the list', href('logistics', {}, { tab: 'ship' }), 'ghost')],
    }),
    ...parcelSections(ctx, view, {}),
  );
}

export interface ParcelSectionOptions {
  /** ORBES staff on the order page: one declared value per order of the parcel, in its currency (never the agent). */
  declared?: { orderId: string; reference: string; currency: string | null }[];
  /** Leave out what the order page already shows (its pieces, its buyer). */
  only?: 'shipping';
}

/** The parcel's sections: Parcel, Ship to, Packing, Shipment, History (the order page keeps Packing to History). */
export function parcelSections(ctx: ViewContext, view: ShippingOrderView, opts: ParcelSectionOptions): HTMLElement[] {
  const role = ctx.session.admin.role;
  const acts = parcelActions(view, can(role, 'logistics'));
  const eyebrow = view.reference;
  const after = (message: string) => (v: unknown) => {
    if (!v) return;
    notify(message);
    ctx.reload();
  };

  // ── Parcel ───────────────────────────────────────────────────────────────
  const several = view.orders.length > 1;
  const parcel = section(
    'Parcel',
    table(
      [
        ...(several ? [{ label: 'Order', cell: (o: ShippingOrderView['orders'][number]) => h('span', { class: 'mono' }, o.reference), kind: ['nowrap' as const] }] : []),
        { label: 'Piece', cell: (o) => h('span', { data: { testid: 'parcel-piece' } }, pieceWords(o)) },
        { label: 'Size', cell: (o) => sizeText(o.sizeLabel), kind: ['nowrap'] },
        { label: 'Add-ons', cell: (o) => (o.addons.length ? o.addons.join(' · ') : '—') },
        { label: 'Engraving', cell: (o) => o.engraving ?? '—' },
        { label: 'Surprise', cell: (o) => o.surprise ?? '—' },
      ],
      view.orders,
      { caption: 'Parcel' },
    ),
    { id: 'parcel-orders', note: `${view.orders.length} ${view.orders.length === 1 ? 'piece' : 'pieces'}` },
  );

  // ── Ship to ──────────────────────────────────────────────────────────────
  const changed = view.addressChanged;
  const shipTo = section(
    'Ship to',
    [
      changed ? h('p', { class: 'notice', data: { testid: 'parcel-address-changed' } }, statusMark('ADDRESS CHANGED', 'alert'), ' ', addressChangedLine(changed)) : null,
      defList([
        { label: 'Name', value: h('span', { data: { testid: 'parcel-name' } }, view.shipTo.name ?? 'Not entered') },
        { label: 'Address', value: h('span', { class: 'prewrap', data: { testid: 'parcel-address' } }, view.shipTo.address ?? 'Not entered') },
        { label: 'Country', value: view.shipTo.country ?? 'Not entered' },
        { label: 'Phone', value: view.shipTo.phone ?? 'Not entered' },
      ]),
    ],
    { id: 'parcel-ship-to' },
  );

  // ── Packing ──────────────────────────────────────────────────────────────
  const start = () =>
    void openDialog({
      title: PACKING_TEXT.startTitle,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, PACKING_TEXT.startText),
      confirmLabel: PACKING_TEXT.startTitle,
      submit: async () => {
        await ctx.api.startPacking(view.id);
      },
    }).then(after(PACKING_TEXT.started));

  const ticked = new Set(view.checklist.filter((l) => l.ticked).map((l) => l.key));
  const packed = button(PACKING_TEXT.packed, { kind: 'primary', testId: 'parcel-packed' });
  const syncPacked = () => {
    packed.disabled = !checklistComplete(view, ticked);
  };
  packed.addEventListener('click', async () => {
    packed.disabled = true;
    try {
      await ctx.api.checkPacked(view.id, [...ticked].filter((k) => view.checklist.some((l) => l.key === k && !l.byScan)));
      notify(PACKING_TEXT.packedToast);
      ctx.reload();
    } catch (e) {
      notifyError(e);
      syncPacked();
    }
  });
  const checklist = h(
    'ul',
    { class: 'checklist', data: { testid: 'parcel-checklist' } },
    ...view.checklist.map((l) => {
      const label = checkbox(l.key, l.label, l.ticked);
      label.setAttribute('data-testid', l.byScan ? 'parcel-check-scan' : 'parcel-check');
      const box = label.querySelector('input')!;
      // A card's line is ticked by its scan only.
      box.disabled = l.byScan || !acts.check;
      box.addEventListener('change', () => {
        if (box.checked) ticked.add(l.key);
        else ticked.delete(l.key);
        syncPacked();
      });
      return h('li', { class: 'checklist__line' }, label);
    }),
  );
  syncPacked();

  const photoInput = h('input', { class: 'visually-hidden', attrs: { type: 'file', accept: 'image/*', capture: 'environment', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'parcel-photo-file' } });
  const photoButton = button(view.shipment?.photo ? PACKING_TEXT.photoAgain : PACKING_TEXT.photo, { kind: 'secondary', testId: 'parcel-photo', onClick: () => photoInput.click() });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    photoButton.disabled = true;
    try {
      const p = await reencodePhoto(file, PACKING_PHOTO_MAX_SIDE);
      await ctx.api.setPackingPhoto(view.id, p.blob);
      notify(PACKING_TEXT.photoAdded);
      ctx.reload();
    } catch (e) {
      notifyError(e, 'The photo could not be read: take it again.');
      photoButton.disabled = false;
    }
  });

  const cardScanner = acts.scan ? new CardScanner(ctx, view) : null;
  scanner?.dispose();
  scanner = cardScanner;

  const packingRows = [
    { label: 'Step', value: h('span', { data: { testid: 'parcel-step' } }, statusMark(PARCEL_STEP_LABELS[view.step], view.step === 'READY_TO_PACK' || view.step === 'PACKING' ? 'outline' : 'solid')) },
    ...(view.readySince
      ? [{ label: 'Ready since', value: h('span', null, formatDateTime(view.readySince), view.late ? h('span', { data: { testid: 'parcel-late' } }, ' ', statusMark('LATE', 'alert')) : null) }]
      : []),
  ];
  const packingBody: Child[] = [defList(packingRows)];
  if (view.shipment && view.shipment.status !== 'CANCELLED') {
    packingBody.push(checklist);
    if (cardScanner) packingBody.push(cardScanner.root);
    packingBody.push(
      h(
        'div',
        { class: 'parcel__photo' },
        acts.photo ? photoButton : null,
        acts.photo ? photoInput : null,
        view.shipment.photo ? h('a', { class: 'idlink', attrs: { href: `/api/admin/logistics/shipments/${encodeURIComponent(view.shipment.id)}/photo`, target: '_blank', rel: 'noopener', 'data-testid': 'parcel-photo-view' } }, PACKING_TEXT.viewPhoto) : null,
        h('p', { class: 'panel__text', data: { testid: 'parcel-photo-note' } }, view.shipment.photo ? PACKING_TEXT.photoNote : `${PACKING_TEXT.noPhoto} ${PACKING_TEXT.photoNote}`),
      ),
    );
  }
  const packingTools = [
    acts.start ? button(PACKING_TEXT.startTitle, { kind: 'primary', testId: 'parcel-start', onClick: start }) : null,
    acts.check ? packed : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  const packing = section('Packing', packingBody, { id: 'parcel-packing', tools: packingTools });

  // ── Shipment ─────────────────────────────────────────────────────────────
  const declaredFields: DialogField[] = (opts.declared ?? []).map((d) => ({
    name: `declared_${d.orderId}`,
    label: (opts.declared ?? []).length > 1 ? `Declared value · ${d.reference}` : 'Declared value',
    maxlength: 12,
    hint: d.currency ? `For the insurance, in ${d.currency}: 4800, or 4800.50. Kept on the shipment, never on the packing slip. Optional.` : 'Enter the order’s price first to declare a value.',
  }));
  const ship = () =>
    void openDialog({
      title: PACKING_TEXT.shipTitle,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, PACKING_TEXT.shipText),
      fields: [
        { name: 'carrierId', label: 'Carrier', kind: 'select', required: true, options: [{ value: '', label: 'Choose a carrier' }, ...view.carriers.map((c) => ({ value: c.id, label: c.name }))], value: '' },
        { name: 'trackingNumber', label: 'Tracking number', required: true, maxlength: 40, hint: PACKING_TEXT.trackingHint },
        ...declaredFields,
      ],
      validate: (v) => shipProblem(v, opts.declared ?? []),
      confirmLabel: 'Ship',
      submit: async (v) => {
        const declaredValues = (opts.declared ?? [])
          .map((d) => ({ orderId: d.orderId, text: (v[`declared_${d.orderId}`] ?? '').trim() }))
          .filter((d) => d.text !== '')
          .map((d) => ({ orderId: d.orderId, minor: parseMoney(d.text)! }));
        await ctx.api.shipParcel(view.id, { carrierId: v.carrierId, trackingNumber: v.trackingNumber.trim(), ...(declaredValues.length ? { declaredValues } : {}) });
      },
    }).then(after(PACKING_TEXT.shipped));
  const deliver = () =>
    void openDialog({
      title: PACKING_TEXT.deliveredTitle,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, PACKING_TEXT.deliveredText),
      confirmLabel: PACKING_TEXT.deliveredTitle,
      submit: async () => {
        await ctx.api.markParcelDelivered(view.id);
      },
    }).then(after(PACKING_TEXT.deliveredToast));
  const report = () =>
    void openDialog({
      title: PACKING_TEXT.reportTitle,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, PACKING_TEXT.reportText),
      fields: [
        {
          name: 'kind',
          label: 'What happened',
          kind: 'select',
          required: true,
          options: [{ value: '', label: 'Choose' }, ...Object.entries(PARCEL_PROBLEM_LABELS).map(([value, label]) => ({ value, label }))],
          value: '',
        },
        { name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: 1000 },
      ],
      validate: reportProblem,
      confirmLabel: PACKING_TEXT.reportConfirm,
      submit: async (v) => {
        await ctx.api.reportParcel(view.id, { kind: v.kind as 'BACK_TO_SENDER' | 'LOST' | 'DAMAGED', note: v.note.trim() });
      },
    }).then(after(PACKING_TEXT.reported));
  const s = view.shipment;
  const shipmentRows = s?.carrier
    ? [
        { label: 'Carrier', value: s.carrier.name },
        {
          label: 'Tracking number',
          value: s.trackingUrl
            ? h('a', { class: 'idlink', attrs: { href: s.trackingUrl, target: '_blank', rel: 'noopener noreferrer' }, data: { testid: 'parcel-tracking' } }, s.trackingNumber ?? '')
            : (s.trackingNumber ?? '—'),
        },
        ...(s.shippedAt ? [{ label: 'Shipped', value: formatDateTime(s.shippedAt) }] : []),
        ...(s.deliveredAt ? [{ label: 'Delivered', value: formatDateTime(s.deliveredAt) }] : []),
      ]
    : [];
  const shipmentTools = [
    acts.ship ? button('Ship', { kind: 'primary', testId: 'parcel-ship', onClick: ship }) : null,
    acts.deliver ? button(PACKING_TEXT.deliveredTitle, { kind: 'primary', testId: 'parcel-delivered', onClick: deliver }) : null,
    acts.report ? button(PACKING_TEXT.reportTitle, { kind: 'ghost', testId: 'parcel-report', onClick: report }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  const shipment = section('Shipment', shipmentRows.length ? defList(shipmentRows) : h('p', { class: 'panel__text' }, PACKING_TEXT.notShipped), { id: 'parcel-shipment', tools: shipmentTools });

  // ── History ──────────────────────────────────────────────────────────────
  const history = section(
    'History',
    table(
      [
        { label: 'When', cell: (e) => formatDateTime(e.at), kind: ['nowrap'] },
        { label: 'Step', cell: (e) => HISTORY_LABELS[e.action] ?? e.action },
        ...(several ? [{ label: 'Order', cell: (e: ShippingOrderView['history'][number]) => h('span', { class: 'mono' }, e.order), kind: ['nowrap' as const] }] : []),
        { label: 'By', cell: (e) => HISTORY_BY[e.by], kind: ['nowrap'] },
      ],
      [...view.history].reverse(),
      { caption: 'History', empty: 'No step yet.' },
    ),
    { id: 'parcel-history' },
  );

  return opts.only === 'shipping' ? [packing, shipment, history] : [parcel, shipTo, packing, shipment, history];
}

/**
 * Scan the card: the sale mode's camera screen and photo reader (verify/scanner.ts, its decoder worker bundled for the
 * console), the card's ORBES CODE sent with POST …/packing/scan; the right piece reads with a toast and the page is
 * read again, a refusal says why where the camera was.
 */
class CardScanner {
  readonly root: HTMLElement;
  private readonly stage = h('div', { class: 'parcel__scan', attrs: { 'aria-live': 'polite' }, data: { testid: 'parcel-scan-stage' } });
  private readonly photo = h('input', { class: 'visually-hidden', attrs: { type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'parcel-scan-photo' } });
  private readonly camera = new Camera();
  private decoder: DecoderClient | null = null;
  private session: ScanSession | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly ctx: ViewContext,
    private readonly view: ShippingOrderView,
  ) {
    this.photo.addEventListener('change', () => {
      const file = this.photo.files?.[0];
      this.photo.value = '';
      if (file) void this.readPhoto(file);
    });
    this.root = h('div', { class: 'parcel__scanner' }, this.stage, this.photo);
    this.showReady();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.stopCamera();
    this.decoder?.dispose();
    this.decoder = null;
  }

  private showReady(message?: { text: string; refused: boolean }): void {
    this.generation++;
    this.stopCamera();
    mount(
      this.stage,
      message ? h('p', { class: message.refused ? 'form-error' : 'panel__text', attrs: { role: message.refused ? 'alert' : null }, data: { testid: 'parcel-scan-message' } }, message.text) : null,
      h(
        'div',
        { class: 'row-actions' },
        button(PACKING_TEXT.scan, { kind: 'secondary', testId: 'parcel-scan', onClick: () => void this.startScan() }),
        button('Upload a photo', { kind: 'ghost', testId: 'parcel-scan-upload', onClick: () => this.photo.click() }),
      ),
    );
  }

  private showProblem(kind: ProblemKind): void {
    this.showReady({ text: `${PROBLEMS[kind].title}. ${PROBLEMS[kind].message}`, refused: true });
  }

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
    const status = h('p', { class: 'sale__status', attrs: { role: 'status', 'aria-live': 'polite' }, data: { testid: 'parcel-scan-status' } }, 'Starting the camera');
    const hint = h('p', { class: 'sale__hint' }, SCAN_GUIDE);
    const frame = h('div', { class: 'sale__camera', data: { testid: 'parcel-camera' } }, video, aperture);
    mount(
      this.stage,
      h(
        'div',
        { class: 'sale__scan' },
        frame,
        status,
        hint,
        h('div', { class: 'sale__actions' }, button('Upload a photo', { kind: 'ghost', onClick: () => this.photo.click() }), button('Close', { kind: 'ghost', testId: 'parcel-scan-close', onClick: () => this.showReady() })),
      ),
    );
    try {
      const caps = await this.camera.start(video);
      if (gen !== this.generation) return this.camera.stop();
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
        onHint: (x) => {
          hint.textContent = x ? HINTS[x] : SCAN_GUIDE;
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
    mount(this.stage, h('p', { class: 'panel__text' }, 'Reading the photo'));
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
    mount(this.stage, h('p', { class: 'panel__text' }, 'Checking the card'));
    try {
      const r = await this.ctx.api.scanPackingCard(this.view.id, buildVerifyInput(reply.decoded, source, decodeMs));
      if (gen !== this.generation) return;
      notify(scanMessage(r.piece));
      this.ctx.reload();
    } catch (e) {
      if (gen !== this.generation) return;
      if (e instanceof ApiError && e.status === 401) return;
      this.showReady({ text: e instanceof ApiError ? e.message : 'The card could not be checked. Try again.', refused: true });
    }
  }
}
