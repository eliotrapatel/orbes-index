/**
 * The SCAN page of the desktop layout (desktop, BRIEF §5.4; /verify/scan): a computer opens no camera, so
 * SCAN in the top bar (and every SCAN of the app on a computer) opens this page, which sends the collector to their
 * phone with a QR code of the app's scan address, and offers UPLOAD A PHOTO under it (the photo path, which leads to the
 * result as on a phone).
 *
 *   SCAN AN
 *   ORBES CODE
 *   The ORBES CODE on your piece’s certificate card
 *   is read by a phone’s camera.
 *   ─────────────────────────────          ┌──────────────┐
 *   WITH YOUR PHONE                        │   QR code    │  dark modules on pure white, its quiet zone
 *   Point your phone’s camera at this…     │              │  of 4 modules, whole pixels per module; on
 *   ─────────────────────────────          │              │  column 8, its top on the hairline of the way
 *   FROM THIS COMPUTER                     └──────────────┘  it belongs to
 *   Upload a photo of the ORBES CODE…      VERIFY.THEORBES.COM/VERIFY
 *   [ UPLOAD A PHOTO ]
 *
 * The page follows the light mode (its screen is `scanPage`, not the camera's `scan`). On a phone the address is not
 * this page's (main.ts routes it to NOW).
 */
import { h } from '../../shared/dom.js';
import { qrSvg } from '../../shared/qr.js';
import { DESKTOP, NOW } from '../copy.js';
import { viewRoot } from './common.js';
import { button } from './nocturne.js';

export const SCAN_PAGE_PATH = '/verify/scan';

export function isScanPagePath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === SCAN_PAGE_PATH;
}

export interface ScanPageDeps {
  /** UPLOAD A PHOTO: the photo picker (a click, so the picker opens). */
  onUpload(): void;
}

/**
 * The title on two lines whatever the window: SCAN AN / ORBES CODE (its end kept whole, BRIEF §10.9), broken by the page
 * so its second line takes its own letter's side bearing (shared/desktop.ts, §10.6).
 */
function title(text: string): (string | HTMLElement)[] {
  const at = text.lastIndexOf(' ', text.lastIndexOf(' ') - 1);
  return at < 0 ? [text] : [text.slice(0, at + 1), h('br'), text.slice(at + 1)];
}

/** A sentence that names a control (SCAN ORBES CODE): the name kept whole on its line (BRIEF §10.9). */
function keepName(text: string, name: string): (string | HTMLElement)[] {
  const at = text.indexOf(name);
  return at < 0 ? [text] : [text.slice(0, at), h('span', { class: 'n-nw', text: name }), text.slice(at + name.length)];
}

/**
 * The code's modules on whole device pixels (decision 4): a browser's zoom of 125 % makes a 6 px module 7.5 device
 * pixels. The module the page's CSS gives (`--qr-px`) rounded to the device's grid (`--qr-px-snap`): the code is then a
 * whole number of device pixels wide, and the browser sets its box on the device's pixels, so every module's edge falls
 * on one (never moved by a transform, which would take it off them again); again as the window or the zoom changes.
 */
function snapToDevice(svg: SVGSVGElement, page: HTMLElement): () => void {
  let frame = 0;
  let zoom: MediaQueryList | null = null;
  const snap = () => {
    frame = 0;
    if (!svg.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const px = parseFloat(getComputedStyle(svg).getPropertyValue('--qr-px')) || 8;
    const size = `${Math.max(1, Math.round(px * dpr)) / dpr}px`;
    if (svg.style.getPropertyValue('--qr-px-snap') !== size) svg.style.setProperty('--qr-px-snap', size);
  };
  const later = () => {
    if (!frame) frame = requestAnimationFrame(snap);
  };
  const watchZoom = () => {
    zoom?.removeEventListener('change', onZoom);
    zoom = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    zoom.addEventListener('change', onZoom);
  };
  const onZoom = () => {
    watchZoom();
    later();
  };
  watchZoom();
  const seen = new ResizeObserver(later);
  seen.observe(page);
  window.addEventListener('resize', later);
  later();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    seen.disconnect();
    window.removeEventListener('resize', later);
    zoom?.removeEventListener('change', onZoom);
  };
}

export function scanPageView(deps: ScanPageDeps): { root: HTMLElement; dispose(): void } {
  const words = DESKTOP.scanPage;
  const root = viewRoot('scanpage', 'scanpage-title');
  const qr = qrSvg(words.url, { label: words.qrLabel, className: 'd-scanpage__qr' });
  qr.style.setProperty('--qr-n', qr.getAttribute('data-modules') ?? '37');
  const way = (cls: string, id: string, label: string, text: string, ...more: HTMLElement[]) =>
    h(
      'section',
      { class: ['d-scanpage__way', cls], attrs: { 'aria-labelledby': id } },
      h('h2', { class: 'n-g n-lb d-scanpage__label', id, text: label }),
      h('div', { class: 'd-scanpage__way-body' }, h('p', { class: 'n-tx d-scanpage__text' }, ...keepName(text, NOW.scan)), ...more),
    );
  const page = h(
      'div',
      { class: 'd-scanpage' },
      h('h1', { class: 'n-g d-scanpage__title', id: 'scanpage-title', attrs: { tabindex: -1 } }, ...title(words.title)),
      h('p', { class: 'n-lead d-scanpage__intro', text: words.intro }),
      way('d-scanpage__way--phone', 'scanpage-phone', words.phoneLabel, words.phone),
      h('figure', { class: 'd-scanpage__code' }, qr, h('figcaption', { class: 'n-g n-lb d-scanpage__address', text: words.address })),
      way('d-scanpage__way--upload', 'scanpage-upload', words.computerLabel, words.computer, button(words.upload, { outline: true, extraClass: 'd-scanpage__upload', onClick: () => deps.onUpload() })),
    );
  root.append(page);
  const unsnap = snapToDevice(qr, page);
  return { root, dispose: unsnap };
}
