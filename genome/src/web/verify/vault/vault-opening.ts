/**
 * THE VAULT's opening (lot Q3, step Q3.10; plan §3.2; D15, D33–D36, D58; N2, N3): the gesture, the server's draw, the
 * timeline, its sounds and its vibration, as the vault reference's `mount()` plays its door-open variant (vault/
 * the-vault.html as published: HOLD_MS 1500, RESET_MS 380, drawn down 110 px, VARIANTS['door-open'].ms 6550, × 1.4 rare).
 *
 *   press and hold (pointer) ─┐  1500 ms, the box easing to its held pose (40 % of its tilt in 250 ms)
 *   draw it down (pointer)   ─┼─▶ at the end: POST …/open, the box kept in its held pose (nothing of the opening started)
 *   Space or Enter held      ─┘   └─ the answer ──▶ the reveal: is-rare, the prize (letters, shrunk to fit 306 px), its
 *                                     line, its odds and --fyd set first, then is-playing: the --k timeline from 0 (the
 *                                     unlock sound at 0, the halves 0.1 k, the lid and the vibration 2 k, the reveal or rare
 *                                     tone 3.40 k, the end 6.55 k; k 1.4 rare); then the open box floats at 30 %
 *                                  └─ a refusal ──▶ the box settles back closed (380 ms) with the server's sentence
 *   let go early ──▶ back to rest in 380 ms, with a few px of weight past it (FOR YOU cleared)
 *   OPEN ANOTHER (S and the end page) ──▶ the box closes (the lid and the halves back, at rest), then `onAgain`
 *
 * FOR YOU (v61): hidden while sealed; `fy-in` 1000 ms after a hold or a draw first passes 0.02 (a 0.5 s ease-out); once
 * the opening plays, `vo-fy` after `--fyd`, what is left of that second (1 s into an opening without a hold); cleared on
 * an early let-go. Reduced motion: the reward at once (the reveal's tone only), FOR YOU shown, the focus on OPEN ANOTHER.
 * Sound follows the foot's SOUND preference (live-sound.ts); the vibration plays where the device has one, whatever SOUND
 * says (OP-19); no SOUND toggle under the vault (D35).
 */
import { prefersReducedMotion } from '../../shared/dom.js';
import { VAULT } from '../copy.js';
import type { LivePassage } from '../live-sound.js';
import type { VaultRevealView } from '../types.js';
import type { VaultBoxParts } from './vault-box.js';
import { vaultFloat, type VaultFloat } from './vault-float.js';

/** The press held this long opens it (the reference's HOLD_MS). */
export const HOLD_MS = 1500;
/** Let go early: back to rest in this time (RESET_MS). */
export const RESET_MS = 380;
/** Drawn down this far opens it. */
export const DRAW_PX = 110;
/** The opening's length at k 1 (VARIANTS['door-open'].ms); a rare reward's × RARE_K. */
export const OPENING_MS = 6550;
export const RARE_K = 1.4;
/** The vibration, at 2 s × k (the lid's swing): a soft lock. */
export const VIBRATION = [16, 40, 26] as const;
export const VIBRATE_AT_S = 2;
/** FOR YOU resolves this long after the hold first shows the halves parting. */
export const FOR_YOU_MS = 1000;
/** The prize in the niche shrinks to fit this width (px). */
export const NICHE_FIT_PX = 306;

/** The sounds of the opening (live-sound.ts): primed in the gesture, cued at the answer. */
export interface VaultSound {
  prime(set?: 'live' | 'vault'): void;
  cue(passage: LivePassage, options?: { base?: number }): void;
}

export interface VaultOpeningDeps {
  /** The server's draw (POST /api/v1/account/vaults/:id/open). */
  open(): Promise<VaultRevealView>;
  sound: VaultSound;
  /** The frame the pointer is read over for the float (the page). */
  surface?: HTMLElement | null;
  /** The sentence of a refusal (the server's own words; VAULT.failed without one). */
  messageOf(error: unknown): string;
  /** Once it has opened (the answer drawn). */
  onOpened?(reveal: VaultRevealView): void;
  /** OPEN ANOTHER pressed, once the box has closed (S and the end page: THE VAULT page, N3). */
  onAgain?(): void;
  /** The page's clock and timers (the tests'). */
  now?(): number;
  vibrate?(pattern: readonly number[]): void;
}

/** The letters of a prize, each its own span (the reference's chars()): its length marks its size. */
export function prizeLetters(el: HTMLElement, text: string): void {
  el.textContent = '';
  Array.from(text).forEach((c, i) => {
    const sp = document.createElement('span');
    sp.style.setProperty('--i', String(i));
    sp.textContent = c === ' ' ? ' ' : c;
    el.appendChild(sp);
  });
  el.setAttribute('data-len', prizeLength(text));
}

/** A prize's size by its length (s ≤ 4, m ≤ 8, l ≤ 10, xl beyond). */
export function prizeLength(text: string): 's' | 'm' | 'l' | 'xl' {
  const n = Array.from(text).length;
  return n <= 4 ? 's' : n <= 8 ? 'm' : n <= 10 ? 'l' : 'xl';
}

/** The opening's passage: its sounds, by rarity and motion (live-sound.ts SFX_AT). */
export function vaultPassage(rare: boolean, reduced: boolean): LivePassage {
  return reduced ? (rare ? 'vaultStillRare' : 'vaultStill') : rare ? 'vaultRare' : 'vault';
}

export class VaultOpening {
  private float: VaultFloat | null;
  private p = 0;
  private raf = 0;
  private holding = false;
  private pending = false;
  private opened = false;
  private drag: { id: number; y0: number; moved: boolean } | null = null;
  private fy0 = 0;
  private fyTimer: ReturnType<typeof setTimeout> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly parts: VaultBoxParts,
    private readonly deps: VaultOpeningDeps,
  ) {
    this.float = vaultFloat(parts.box, { surface: deps.surface ?? null });
    this.wire();
  }

  /** Whether the vault has opened here. */
  get isOpen(): boolean {
    return this.opened;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.clearTimers();
    this.fyClear();
    this.float?.stop();
    this.float = null;
    for (const f of this.off) f();
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  private reduced(): boolean {
    return prefersReducedMotion();
  }

  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void): void {
    el.addEventListener(type, fn as EventListener);
    this.off.push(() => el.removeEventListener(type, fn as EventListener));
  }

  private wire(): void {
    const el = this.parts.front;
    this.listen(el, 'pointerdown', (ev) => {
      if (ev.button !== 0 || this.opened || this.pending) return;
      ev.preventDefault();
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // A pointer that cannot be captured still ends with pointerup.
      }
      this.drag = { id: ev.pointerId, y0: ev.clientY, moved: false };
      this.deps.sound.prime('vault');
      this.press();
    });
    this.listen(el, 'pointermove', (ev) => {
      const drag = this.drag;
      if (!drag || drag.id !== ev.pointerId || this.opened || this.pending) return;
      const dy = ev.clientY - drag.y0;
      if (!drag.moved && dy > 6) {
        drag.moved = true;
        this.stop();
      }
      if (!drag.moved) return;
      // Drawn down: slight resistance (the last part asks a little more).
      const v = Math.max(0, Math.min(1, dy / DRAW_PX));
      this.setP(v < 1 ? 1 - Math.pow(1 - v, 1.35) : 1);
      if (v >= 1) {
        this.holding = false;
        void this.finish();
      }
    });
    const up = (): void => {
      if (this.opened || this.pending) {
        this.drag = null;
        return;
      }
      this.drag = null;
      this.release();
    };
    this.listen(el, 'pointerup', up);
    this.listen(el, 'pointercancel', up);
    this.listen(el, 'lostpointercapture', up);
    this.listen(el, 'keydown', (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      ev.preventDefault();
      if (ev.repeat) return;
      this.deps.sound.prime('vault');
      this.press();
    });
    this.listen(el, 'keyup', (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      ev.preventDefault();
      this.release();
    });
    this.listen(el, 'blur', () => {
      if (!this.drag) this.release();
    });
    this.listen(el, 'contextmenu', (ev) => ev.preventDefault());
    this.listen(el, 'click', (ev) => ev.preventDefault());
    this.listen(this.parts.again, 'click', () => this.again());
  }

  private setP(v: number): void {
    this.p = v;
    this.parts.vlt.style.setProperty('--p', v.toFixed(4));
    this.fyMark(v);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private at(seconds: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, seconds * 1000));
  }

  private fyClear(): void {
    if (this.fyTimer) clearTimeout(this.fyTimer);
    this.fyTimer = null;
    this.fy0 = 0;
    this.parts.vlt.classList.remove('fy-in');
    this.parts.vlt.style.removeProperty('--fyd');
  }

  /** FOR YOU: marked 1000 ms after the hold (or the draw) first passes 0.02; cleared when it settles back to 0. */
  private fyMark(v: number): void {
    if (v > 0.02 && !this.fy0) {
      this.fy0 = this.now();
      this.fyTimer = setTimeout(() => this.parts.vlt.classList.add('fy-in'), FOR_YOU_MS);
    } else if (v <= 0 && !this.opened && !this.pending) this.fyClear();
  }

  private press(): void {
    if (this.opened || this.holding || this.pending || this.disposed) return;
    this.stop();
    this.holding = true;
    this.unsay();
    this.float?.hold();
    this.parts.vlt.classList.add('is-holding');
    const t0 = this.now() - this.p * HOLD_MS;
    const step = (): void => {
      if (!this.holding || this.drag?.moved) return;
      const v = Math.min(1, (this.now() - t0) / HOLD_MS);
      this.setP(v);
      if (v >= 1) {
        this.holding = false;
        this.raf = 0;
        void this.finish();
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    step();
  }

  /** Let go too early: back to rest, with a little weight (a few px past it, then home). */
  private release(): void {
    if (!this.holding) return;
    if (!this.opened) this.float?.release();
    this.holding = false;
    this.stop();
    this.settleBack();
  }

  private settleBack(): void {
    const from = this.p;
    if (this.reduced()) {
      this.setP(0);
      this.parts.vlt.classList.remove('is-holding');
      return;
    }
    const t0 = this.now();
    const back = (): void => {
      const t = Math.min(1, (this.now() - t0) / RESET_MS);
      const c = 1.6;
      const e = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
      this.setP(from * (1 - e));
      if (t < 1) this.raf = requestAnimationFrame(back);
      else {
        this.raf = 0;
        this.setP(0);
        this.parts.vlt.classList.remove('is-holding');
      }
    };
    back();
  }

  /** The hold (or the draw) complete: the server draws while the box keeps its held pose; the reveal at its answer. */
  private async finish(): Promise<void> {
    if (this.pending || this.opened) return;
    this.pending = true;
    this.drag = null;
    this.float?.hold();
    let reveal: VaultRevealView;
    try {
      reveal = await this.deps.open();
    } catch (e) {
      if (this.disposed) return;
      this.pending = false;
      this.float?.release();
      this.settleBack();
      this.say(this.deps.messageOf(e) || VAULT.failed);
      return;
    }
    if (this.disposed) return;
    this.pending = false;
    this.reveal(reveal);
  }

  /** A refusal's sentence, where the hint stands (the door's line stays), said to a reader too. */
  private say(text: string): void {
    this.parts.vlt.classList.add('has-error');
    this.parts.hint.textContent = text;
    this.parts.status.textContent = text;
  }

  private unsay(): void {
    if (!this.parts.vlt.classList.contains('has-error')) return;
    this.parts.vlt.classList.remove('has-error');
    this.parts.hint.textContent = VAULT.door.hint;
    this.parts.status.textContent = '';
  }

  private reveal(r: VaultRevealView): void {
    const { vlt, prize, what, inPrize, inWhat, nichePrize, nicheLine, nicheOdds, status, again } = this.parts;
    const line = r.line ?? '';
    this.opened = true;
    // FOR YOU: what is left of its second once the opening plays (1 s into one that needed no hold, the CSS's default).
    if (this.fy0 && !vlt.classList.contains('fy-in')) {
      if (this.fyTimer) clearTimeout(this.fyTimer);
      this.fyTimer = null;
      vlt.style.setProperty('--fyd', `${(Math.max(0, this.fy0 + FOR_YOU_MS - this.now()) / 1000).toFixed(3)}s`);
    }
    this.float?.hold();
    this.drag = null;
    prizeLetters(prize, r.prize);
    prize.style.fontSize = '';
    what.textContent = line;
    what.appendChild(Object.assign(document.createElement('span'), { className: 'vlt__odds', textContent: r.odds }));
    inPrize.replaceChildren(...Array.from(prize.childNodes, (n) => n.cloneNode(true)));
    inPrize.setAttribute('data-len', prize.getAttribute('data-len') ?? '');
    inWhat.replaceChildren(...Array.from(what.childNodes, (n) => n.cloneNode(true)));
    nichePrize.replaceChildren(...Array.from(prize.childNodes, (n) => n.cloneNode(true)));
    nichePrize.setAttribute('data-len', prize.getAttribute('data-len') ?? '');
    nicheLine.textContent = line;
    nicheOdds.textContent = r.odds;
    nichePrize.style.fontSize = '';
    // The prize's letters shrunk to fit the niche (306 px), never wrapped.
    const width = nichePrize.scrollWidth;
    const size = parseFloat(getComputedStyle(nichePrize).fontSize);
    if (width > NICHE_FIT_PX && size > 0) nichePrize.style.fontSize = `${Math.floor((size * NICHE_FIT_PX * 10) / width) / 10}px`;
    vlt.classList.remove('is-holding');
    vlt.classList.toggle('is-rare', r.rare);
    status.textContent = VAULT.reveal.said(r.prize, r.line, r.odds);
    this.clearTimers();
    const k = r.rare ? RARE_K : 1;
    const base = this.now();
    if (this.reduced()) {
      vlt.classList.add('is-open');
      // The focus on OPEN ANOTHER, as the reference puts it (none on a door of THE VAULT page: it has none there).
      if (vlt.dataset.place !== 'page') again.focus({ preventScroll: true });
      this.deps.sound.cue(vaultPassage(r.rare, true), { base });
      this.deps.onOpened?.(r);
      return;
    }
    void vlt.offsetWidth;
    vlt.style.setProperty('--n', String(Math.max(0, Array.from(r.prize).length - 3)));
    vlt.classList.add('is-open', 'is-playing');
    this.deps.sound.cue(vaultPassage(r.rare, false), { base });
    this.at(VIBRATE_AT_S * k, () => this.vibrate());
    this.at((OPENING_MS * k) / 1000, () => {
      vlt.classList.remove('is-playing');
      this.setP(0);
      this.float?.calm();
    });
    this.deps.onOpened?.(r);
  }

  private vibrate(): void {
    try {
      if (this.deps.vibrate) this.deps.vibrate(VIBRATION);
      else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([...VIBRATION]);
    } catch {
      // No haptics here.
    }
  }

  /** OPEN ANOTHER: the box closes (the lid and the halves back, at rest), then THE VAULT page. */
  private again(): void {
    if (!this.opened || this.parts.vlt.dataset.place === 'page') return;
    this.float?.release();
    this.clearTimers();
    this.stop();
    this.holding = false;
    this.drag = null;
    this.parts.vlt.classList.remove('is-open', 'is-playing', 'is-rare', 'is-holding');
    this.setP(0);
    this.fyClear();
    this.parts.status.textContent = '';
    const done = (): void => {
      if (!this.disposed) this.deps.onAgain?.();
    };
    if (this.reduced()) done();
    else this.timers.push(setTimeout(done, RESET_MS));
  }
}
