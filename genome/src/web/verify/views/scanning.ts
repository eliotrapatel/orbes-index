/**
 * Scanner (plan NOCTURNE, screen 2; C11, C12, C38): full-bleed camera, the orbit with its four moons, and the status
 * line (PREPARING CAMERA… → SCANNING… → ORBES CODE FOUND → VERIFYING…) announced through an aria-live region, the
 * guide (or a hint) under it, then LIGHT and the zoom toggle when the camera offers them, and UPLOAD A PHOTO. No rail,
 * no SCAN ring: the scanner keeps the whole screen.
 *
 *                 ORBES                CLOSE
 *
 *        ◎ ·                    ·
 *               (   orbit   )          272 px, the veil round it (50 %), its ring in ivory (80 %)
 *          ·                    ·
 *               SCANNING…
 *   Align the ORBES CODE within the orbit
 *          [ LIGHT ]  [ 0.5× ]         each 44 px high, a hairline round it
 *            UPLOAD A PHOTO
 *
 * The scan as a ritual (P-D10), three states of the orbit:
 *   searching   the travelling arc (the sweep);
 *   seal seen   .is-sealed: a decoder reply carried a confident seal (onSeal), so the ring tightens round the centre
 *               (--seal-scale, set through the CSSOM), heavier, its light breathing; without one for SEAL_HOLD_MS it
 *               loosens back to the search;
 *   locked      .is-locked: the code was read, the frame freezes under a darker veil (78 %), the ring and the moons
 *               heavier, the controls fainter; then VERIFYING…, one status line (C12).
 * With reduced motion the ring neither tightens nor breathes: it only steadies.
 */
import { h, s } from '../../shared/dom.js';
import { SEAL_HOLD_MS, sealScale } from '../capture.js';
import { ACTION_LABELS, SCAN_GUIDE, STATUS, ZOOM } from '../copy.js';
import { arcPath, viewRoot } from './common.js';
import { textLink } from './nocturne.js';

export interface ScanHandlers {
  onClose(): void;
  onUpload(): void;
  onTorch(): void;
  onZoom(): void;
}

export interface ScanView {
  root: HTMLElement;
  video: HTMLVideoElement;
  /** Diameter of the reticle circle in CSS pixels. */
  reticleSize(): number;
  setStatus(text: string): void;
  setHint(text: string | null): void;
  /** A seal was seen (P-D10), with this confidence: the ring tightens around the centre while it lasts. */
  setSeal(confidence: number): void;
  /** Code found: the orbit closes and the frame freezes. */
  setLocked(locked: boolean): void;
  setReady(ready: boolean): void;
  setTorch(available: boolean, on: boolean): void;
  setZoom(available: boolean, label: string, active: boolean): void;
}

/**
 * The orbit of the scanner (C11): the aperture that cuts the veil, the ring, the travelling arc, and the four moons of
 * the printed code round it (polaris, top left, a ring round its dot). Decorative: the status line says what happens.
 */
export function cameraOrbit(): { orbit: HTMLElement; aperture: HTMLElement; ring: HTMLElement } {
  const aperture = h('div', { class: 'n-cam__aperture' });
  const ring = h('div', { class: 'n-cam__ring' });
  const sweep = s('svg', { class: 'n-cam__sweep', viewBox: '-101 -101 202 202', 'aria-hidden': 'true', focusable: 'false' }, s('path', { class: 'n-cam__arc', d: arcPath(100.5, -14, 14) }));
  const moon = (where: string) => h('span', { class: ['n-cam__moon', `n-cam__moon--${where}`] });
  const polaris = h('span', { class: 'n-cam__moon n-cam__moon--polaris' }, h('span', { class: 'n-cam__polaris-core' }));
  const orbit = h('div', { class: 'n-cam__orbit', attrs: { 'aria-hidden': 'true' } }, aperture, ring, sweep, polaris, moon('ne'), moon('sw'), moon('se'));
  return { orbit, aperture, ring };
}

/** The scanner's header (C11): ORBES centred, and CLOSE at the right when the screen can be left from it. */
export function cameraHeader(onClose?: () => void): HTMLElement {
  return h(
    'header',
    { class: 'n-hd n-cam__hd' },
    h('span', { class: 'n-g n-wm n-cam__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }),
    onClose ? h('button', { class: 'n-g n-acct n-cam__close', attrs: { type: 'button' }, on: { click: () => onClose() }, text: 'CLOSE' }) : null,
  );
}

export function scanView(handlers: ScanHandlers): ScanView {
  const root = viewRoot('scan', 'scan-title');
  root.classList.add('n-cam');
  const video = h('video', {
    class: 'n-cam__video',
    attrs: { playsinline: true, muted: true, autoplay: true, disablepictureinpicture: true, 'aria-hidden': 'true' },
  });
  const { orbit, aperture } = cameraOrbit();
  const status = h('p', { class: 'n-g n-lb n-ivc n-cam__line', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, text: STATUS.starting });
  const hint = h('p', { class: 'n-tx n-ivc n-cam__hint', text: SCAN_GUIDE });
  // LIGHT, in Gravesend; the zoom, its figures in the reading face (C11). Each shown only when the camera offers it.
  const torch = h('button', { class: 'n-g n-cam__control n-cam__light', attrs: { type: 'button', 'aria-pressed': 'false', hidden: true }, on: { click: () => handlers.onTorch() }, text: 'LIGHT' });
  const zoom = h('button', { class: 'n-num n-cam__control n-cam__zoom', attrs: { type: 'button', 'aria-pressed': 'false', hidden: true }, on: { click: () => handlers.onZoom() }, text: '2×' });

  root.append(
    video,
    orbit,
    cameraHeader(() => handlers.onClose()),
    h('h1', { class: 'visually-hidden', id: 'scan-title', text: 'Scan an ORBES CODE' }),
    h('div', { class: 'n-ctr n-cam__status' }, status, hint),
    h('div', { class: 'n-cam__controls' }, torch, zoom),
    h('p', { class: 'n-ctr n-cam__upload' }, textLink(ACTION_LABELS.upload, { onOpen: () => handlers.onUpload(), extraClass: 'n-cam__upload-link' })),
  );

  // Locked (C12): the frame the code was read in stays under the veil once the camera is released, drawn on a canvas.
  const freeze = (): void => {
    if (!video.videoWidth || !video.videoHeight || root.querySelector('.n-cam__still')) return;
    const still = h('canvas', { class: 'n-cam__video n-cam__still', attrs: { 'aria-hidden': 'true', width: video.videoWidth, height: video.videoHeight } });
    try {
      still.getContext('2d')?.drawImage(video, 0, 0);
    } catch {
      return;
    }
    video.after(still);
  };

  // The seal seen (P-D10): held for SEAL_HOLD_MS after the last confident signal, then the search again.
  let sealTimer: ReturnType<typeof setTimeout> | undefined;
  const loosen = (): void => {
    clearTimeout(sealTimer);
    sealTimer = undefined;
    root.classList.remove('is-sealed');
  };

  return {
    root,
    video,
    reticleSize: () => aperture.getBoundingClientRect().width,
    setStatus: (text) => {
      if (status.textContent !== text) status.textContent = text;
      // C12: VERIFYING… is the one status line, a title rather than a label.
      const verifying = text === STATUS.verifying;
      status.classList.toggle('n-t3', verifying);
      status.classList.toggle('n-lb', !verifying);
      root.classList.toggle('is-verifying', verifying);
    },
    setHint: (text) => {
      const next = text ?? SCAN_GUIDE;
      if (hint.textContent === next) return;
      hint.classList.remove('is-changing');
      // Restart the fade so a changed hint is noticed without anything moving.
      void hint.offsetWidth;
      hint.textContent = next;
      hint.classList.add('is-changing');
    },
    setSeal: (confidence) => {
      const scale = sealScale(confidence);
      if (scale === null || root.classList.contains('is-locked')) return;
      root.style.setProperty('--seal-scale', String(scale));
      root.classList.add('is-sealed');
      clearTimeout(sealTimer);
      sealTimer = setTimeout(loosen, SEAL_HOLD_MS);
    },
    setLocked: (locked) => {
      // Locked takes over from the seal seen: the orbit closes on the code.
      if (locked) loosen();
      root.classList.toggle('is-locked', locked);
      if (locked) {
        video.pause();
        hint.textContent = '';
        freeze();
      }
    },
    setReady: (ready) => root.classList.toggle('is-ready', ready),
    setTorch: (available, on) => {
      torch.hidden = !available;
      torch.setAttribute('aria-pressed', on ? 'true' : 'false');
    },
    setZoom: (available, label, active) => {
      zoom.hidden = !available;
      zoom.textContent = label;
      // C11: the name says what pressing does; zoomed in, the figure is the widest view it returns to.
      if (label) zoom.setAttribute('aria-label', active ? ZOOM.out(label) : ZOOM.in(label));
      else zoom.removeAttribute('aria-label');
      zoom.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
  };
}
