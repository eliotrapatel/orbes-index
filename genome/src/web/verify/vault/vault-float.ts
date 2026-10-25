/**
 * THE VAULT's box, a real object in space (lot Q3, step Q3.10; plan §3.1; D32; the vault reference's `__vaultFloat`,
 * ported as published). At rest it turns slowly (up to 11° × 14°) and lifts off the ground (--eye 0..1 = a 12 px lift):
 * it follows the pointer over its frame on a computer (smoothed, ~0.08 a frame), else the device's orientation where the
 * device gives it without asking (never a permission prompt, N24), else a slow drift (a Lissajous of 11 and 13 s).
 * hold(): in 250 ms it eases to a calm held pose, 40 % of its tilt, and stays there while it opens (the opening plays in
 * that pose). calm(): once opened, a very slow float at 30 %. release(): the full float again. Each face is lit from its
 * own angle: --shade (turned away, a little darker) and --spec (turned to the light, a soft sheen, at most 6 %).
 * Reduced motion: face-on, still. Transforms only (CSS variables through the CSSOM). One frame loop per box, paused while
 * the box is off screen (IntersectionObserver) or the page hidden; `stop()` ends it and its listeners.
 */

export interface VaultFloat {
  hold(): void;
  calm(): void;
  release(): void;
  stop(): void;
}

/** The tilt's reach (degrees) about the horizontal and the vertical axes. */
export const FLOAT_AX = 11;
export const FLOAT_AY = 14;
/** The held pose: this share of the tilt, reached in this time (ms). */
export const HELD_SHARE = 0.4;
export const HELD_MS = 250;
/** The open box's float: this share of the tilt. */
export const CALM_SHARE = 0.3;

/** The faces whose light follows their angle: each with its normal (the rounded corners' facets at 22.5°, v62). */
const FACES: readonly (readonly [selector: string, normal: readonly [number, number, number]])[] = [
  ['.vo-dopen__front', [0, 0, 1]],
  ['.vo-side--t', [0, -1, 0]],
  ['.vo-side--b', [0, 1, 0]],
  ['.vo-side--l', [-1, 0, 0]],
  ['.vo-side--r', [1, 0, 0]],
  ['.vo-cnr--t-l', [-0.3827, -0.9239, 0]],
  ['.vo-cnr--t-r', [0.3827, -0.9239, 0]],
  ['.vo-cnr--b-l', [-0.3827, 0.9239, 0]],
  ['.vo-cnr--b-r', [0.3827, 0.9239, 0]],
  ['.vo-cnr--l-t', [-0.9239, -0.3827, 0]],
  ['.vo-cnr--l-b', [-0.9239, 0.3827, 0]],
  ['.vo-cnr--r-t', [0.9239, -0.3827, 0]],
  ['.vo-cnr--r-b', [0.9239, 0.3827, 0]],
];

/** The light: above, a little to the left, in front; its half vector; the face-on intensity. */
const L = [-0.298, -0.596, 0.745] as const;
const HV = [-0.16, -0.319, 0.934] as const;
const I0 = 0.873;

/**
 * Float the box `el` (`.vo-dopen`); its variables are set on its parent (the stage). `surface`: the frame whose rect the
 * pointer is read over (the window's pointer, as the frame itself takes no pointer events); `phase` offsets the drift.
 */
export function vaultFloat(el: HTMLElement, opts: { surface?: HTMLElement | null; phase?: number } = {}): VaultFloat {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const ph = opts.phase ?? 0;
  let rx = 0;
  let ry = 0;
  let eye = 0;
  let amp = 1;
  let ampNow = 0;
  let settle: { t: number; rx: number; ry: number; eye: number; tx: number; ty: number; te: number } | null = null;
  let held = false;
  let raf = 0;
  const t0 = performance.now();
  let last = t0;
  let px = 0;
  let py = 0;
  let lastPointer = -1e9;
  let ori: { x: number; y: number } | null = null;
  let visible = true;
  let stopped = false;
  const host = el.parentElement ?? el;
  const faces = FACES.map(([sel, n]) => [el.querySelector<HTMLElement>(sel), n] as const).filter((f): f is readonly [HTMLElement, readonly [number, number, number]] => f[0] !== null);

  function light(): void {
    const a = (rx * Math.PI) / 180;
    const b = (ry * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    for (const [face, n] of faces) {
      const x1 = n[0] * cb + n[2] * sb;
      const y1 = n[1];
      const z1 = -n[0] * sb + n[2] * cb;
      const x = x1;
      const y = y1 * ca - z1 * sa;
      const z = y1 * sa + z1 * ca;
      const d = Math.max(0, x * L[0] + y * L[1] + z * L[2]);
      const I = 0.5 + 0.5 * d;
      const sp = Math.max(0, x * HV[0] + y * HV[1] + z * HV[2]);
      face.style.setProperty('--shade', Math.max(0, Math.min(0.3, ((I0 - I) / I0) * 0.5)).toFixed(3));
      // A face turned towards the light catches it: a soft lightening with the light's angle plus the sheen (at most 6 %).
      face.style.setProperty('--spec', Math.min(0.06, 0.06 * Math.pow(sp, 12) + 0.07 * Math.max(0, d - 0.3)).toFixed(4));
    }
  }

  function set(): void {
    host.style.setProperty('--rx', `${rx.toFixed(3)}deg`);
    host.style.setProperty('--ry', `${ry.toFixed(3)}deg`);
    host.style.setProperty('--eye', eye.toFixed(3));
    host.style.setProperty('--rxn', rx.toFixed(3));
    host.style.setProperty('--ryn', ry.toFixed(3));
    el.style.setProperty('--sx', ((ry / FLOAT_AY) * 90 - (rx / FLOAT_AX) * 24).toFixed(1));
    light();
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (mq?.matches) {
      if (rx || ry || eye) {
        rx = 0;
        ry = 0;
        eye = 0;
        set();
      }
      return;
    }
    if (settle) {
      const k = Math.min(1, (now - settle.t) / HELD_MS);
      const e = 1 - Math.pow(1 - k, 3);
      rx = settle.rx + (settle.tx - settle.rx) * e;
      ry = settle.ry + (settle.ty - settle.ry) * e;
      eye = settle.eye + (settle.te - settle.eye) * e;
      set();
      if (k >= 1) settle = null;
      return;
    }
    if (held) return;
    ampNow += (amp - ampNow) * (1 - Math.exp(-dt / 0.6));
    const t = (now - t0) / 1000;
    const slow = amp < 1 ? 2.2 : 1;
    let tx: number;
    let ty: number;
    if (now - lastPointer < 2500) {
      tx = -py * FLOAT_AX;
      ty = px * FLOAT_AY;
    } else if (ori) {
      tx = -ori.y * FLOAT_AX;
      ty = ori.x * FLOAT_AY;
    } else {
      tx = FLOAT_AX * Math.sin((2 * Math.PI * t) / (11 * slow) + ph);
      ty = FLOAT_AY * Math.sin((2 * Math.PI * t) / (13 * slow) + ph * 1.7 + 0.6);
    }
    const f = 1 - Math.pow(1 - 0.08, dt * 60);
    rx += (tx * ampNow - rx) * f;
    ry += (ty * ampNow - ry) * f;
    eye += (Math.min(1, ampNow / Math.max(amp, 0.0001)) * (amp < 1 ? 0.6 : 1) - eye) * f;
    set();
  }

  // The frame takes no pointer events, so the pointer is read on the window, over the frame's rect.
  const onPointer = (ev: PointerEvent): void => {
    const surface = opts.surface;
    if (!surface) return;
    const r = surface.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    px = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1));
    py = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1));
    lastPointer = performance.now();
  };
  // The device's tilt where it is given without asking (iOS asks for a permission: never asked, the drift instead).
  const onOrientation = (ev: DeviceOrientationEvent): void => {
    if (ev.gamma == null || ev.beta == null) return;
    ori = { x: Math.max(-1, Math.min(1, ev.gamma / 25)), y: Math.max(-1, Math.min(1, (ev.beta - 45) / 25)) };
  };
  const run = (): void => {
    if (stopped || raf || !visible || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const pause = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVisibility = (): void => (document.visibilityState === 'hidden' ? pause() : run());
  if (opts.surface) window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('deviceorientation', onOrientation);
  document.addEventListener('visibilitychange', onVisibility);
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (visible) run();
          else pause();
        })
      : null;
  io?.observe(host);
  set();
  run();

  return {
    hold() {
      if (held) return;
      held = true;
      settle = { t: performance.now(), rx, ry, eye, tx: rx * HELD_SHARE, ty: ry * HELD_SHARE, te: Math.min(eye, 0.6) };
    },
    calm() {
      held = false;
      settle = null;
      amp = CALM_SHARE;
      ampNow = Math.min(ampNow, CALM_SHARE);
    },
    release() {
      held = false;
      settle = null;
      amp = 1;
    },
    stop() {
      stopped = true;
      pause();
      io?.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onOrientation);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
