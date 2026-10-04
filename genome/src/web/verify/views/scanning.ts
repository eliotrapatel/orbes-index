/**
 * Scanner: full-bleed camera, the orbit reticle with its four moons, and the
 * status line (SCANNING… → ORBES CODE FOUND → VERIFYING…) announced through
 * an aria-live region. Torch and zoom appear only when the camera offers them.
 *
 * The scan as a ritual (P-D10), three states of the reticle:
 *   searching   the travelling arc (the sweep);
 *   seal seen   .is-sealed: a decoder reply carried a confident seal (onSeal), so
 *               the ring tightens around the centre (--seal-scale, set through the
 *               CSSOM) and its focus breathes; without one for SEAL_HOLD_MS it
 *               loosens back to the search;
 *   locked      .is-locked: the code was read, the orbit closes.
 * With reduced motion the ring neither tightens nor breathes: it only steadies.
 */
import { h } from '../../shared/dom.js';
import { SEAL_HOLD_MS, sealScale } from '../capture.js';
import { SCAN_GUIDE, STATUS } from '../copy.js';
import { orbitReticle, viewRoot } from './common.js';

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

export function scanView(handlers: ScanHandlers): ScanView {
  const root = viewRoot('scan', 'scan-title');
  const video = h('video', {
    class: 'scan__video',
    attrs: { playsinline: true, muted: true, autoplay: true, disablepictureinpicture: true, 'aria-hidden': 'true' },
  });
  const aperture = h('div', { class: 'scan__aperture', attrs: { 'aria-hidden': 'true' } });
  const reticle = orbitReticle('reticle--live');
  const status = h('p', { class: 'scan__status micro indent-micro', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, text: STATUS.starting });
  const hint = h('p', { class: 'scan__hint', text: SCAN_GUIDE });
  const torch = h('button', { class: 'scan__control', attrs: { type: 'button', 'aria-pressed': 'false', hidden: true }, on: { click: () => handlers.onTorch() }, text: 'LIGHT' });
  const zoom = h('button', { class: 'scan__control scan__zoom', attrs: { type: 'button', 'aria-pressed': 'false', hidden: true }, on: { click: () => handlers.onZoom() }, text: '2×' });

  root.append(
    video,
    aperture,
    h('div', { class: 'scan__reticle' }, reticle),
    h(
      'header',
      { class: 'scan__top' },
      h('span', { class: 'wordmark wordmark--small scan__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }),
      h('button', { class: 'textlink scan__close', attrs: { type: 'button' }, on: { click: () => handlers.onClose() }, text: 'CLOSE' }),
    ),
    h('h1', { class: 'visually-hidden', id: 'scan-title', text: 'Scan an ORBES CODE' }),
    h(
      'footer',
      { class: 'scan__bottom' },
      status,
      hint,
      h(
        'div',
        { class: 'scan__controls' },
        torch,
        zoom,
        h('button', { class: 'scan__control', attrs: { type: 'button' }, on: { click: () => handlers.onUpload() }, text: 'UPLOAD A PHOTO' }),
      ),
    ),
  );

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
      zoom.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
  };
}
