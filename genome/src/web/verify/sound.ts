/**
 * The sound signature of an authentic piece (P-D07): a soft chord of about
 * 0.9 s, composed in code with Web Audio (no sound file is shipped).
 *
 *   gain                        four sine voices, D major ninth in an open
 *    │ ╭╮                       voicing (D4 A4 C♯5 E5), struck 40 ms apart
 *    │ │╰─╮                     like a soft arpeggio; each rises in 12 ms and
 *    │ │  ╰──╮                  fades exponentially to silence at 0.9 s
 *    │ │     ╰────╮
 *    └─┴──────────┴──▶ 0.9 s
 *
 * When: only as a result of an AUTHENTIC_* state appears (AUTHENTIC, FIRST
 * REGISTRATION, REGISTERED, OWNERSHIP VERIFIED), never for another result,
 * and not while the page is in the background. A LIVE RELEASE (plan of
 * 2026-10-04) plays it too, at the reveal of a piece secured, and before it a
 * soft tick each second of the last ten before the door opens (TICK: one sine
 * voice of 80 ms, struck and faded); its room creates the context in its taps
 * (a size, ENTER, the seal pressed), as SCAN does.
 *
 * The AudioContext is created in the gesture SCAN ORBES CODE or UPLOAD A
 * PHOTO (`prime()`): a browser lets a page sound only from a tap. A later
 * gesture of either resumes it; between two chords it is suspended, so it
 * holds no audio output while nothing plays.
 *
 * On by default; SOUND ON / OFF at the foot of the landing turns it off on
 * this device (shared/prefs.ts). Where the browser offers it (Safari on
 * iPhone), `navigator.audioSession.type` is set to "ambient" before the
 * context exists: the chord then follows the phone's silent switch and mixes
 * with what the phone is already playing. Elsewhere the setting of the page is
 * the only switch (the web cannot read the phone's).
 *
 * Imported statically (the verify app ships one bundle). Nothing here may
 * break a result: every call into Web Audio is wrapped, and a sound that
 * cannot play is simply not heard.
 */
import { setSoundPref, soundPref, type PrefStorage, deviceStorage } from '../shared/prefs.js';
import type { VerificationState } from './types.js';
import { isAuthenticState } from './view-model.js';

/** The chord: its voices, how they are struck, how long it lasts. Times in seconds. */
export const SIGNATURE = Object.freeze({
  /** D4 A4 C♯5 E5 (Hz): D major ninth, open voicing. */
  notes: Object.freeze([293.66, 440, 554.37, 659.26]),
  /** Between two voices struck one after the other. */
  stagger: 0.04,
  /** The rise of a voice to its peak. */
  attack: 0.012,
  /** From the first voice to silence. */
  duration: 0.9,
  /** The peak gain of one voice: four together stay far under full scale (soft). */
  peak: 0.05,
  /** The gain an exponential ramp starts from and fades to (it cannot reach 0). */
  floor: 0.0001,
  /** Scheduled this far ahead of the context's clock, so the first voice is never cut. */
  lead: 0.02,
  /** A voice stops this long after the chord has faded. */
  tail: 0.02,
});

/** The part of an AudioParam the chord uses. */
export interface SoundParam {
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

/** The part of an AudioNode the chord uses. */
export interface SoundNode {
  connect(destination: SoundNode): unknown;
}

/** The part of an AudioContext the chord uses (an AudioContext; a recorder in the tests). */
export interface SoundContext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: SoundNode;
  createOscillator(): SoundNode & { type: OscillatorType; frequency: SoundParam; start(when: number): void; stop(when: number): void };
  createGain(): SoundNode & { gain: SoundParam };
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

/** Schedule the chord on `ctx`, from its clock (plus SIGNATURE.lead). */
export function scheduleSignature(ctx: SoundContext): void {
  const t0 = ctx.currentTime + SIGNATURE.lead;
  const end = t0 + SIGNATURE.duration;
  SIGNATURE.notes.forEach((hz, i) => {
    const start = t0 + i * SIGNATURE.stagger;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, start);
    const voice = ctx.createGain();
    voice.gain.setValueAtTime(SIGNATURE.floor, start);
    voice.gain.exponentialRampToValueAtTime(SIGNATURE.peak, start + SIGNATURE.attack);
    voice.gain.exponentialRampToValueAtTime(SIGNATURE.floor, end);
    osc.connect(voice);
    voice.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + SIGNATURE.tail);
  });
}

/** The tick of the last ten seconds before a LIVE RELEASE opens: one soft voice, struck and faded. Times in seconds. */
export const TICK = Object.freeze({
  /** E6 (Hz): above the chord, short enough to read as a tick rather than a note. */
  note: 1318.51,
  attack: 0.004,
  duration: 0.08,
  /** Softer than one voice of the chord. */
  peak: 0.035,
  floor: SIGNATURE.floor,
  lead: SIGNATURE.lead,
  tail: SIGNATURE.tail,
});

/** Schedule one tick on `ctx`, from its clock (plus TICK.lead). */
export function scheduleTick(ctx: SoundContext): void {
  const start = ctx.currentTime + TICK.lead;
  const end = start + TICK.duration;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(TICK.note, start);
  const voice = ctx.createGain();
  voice.gain.setValueAtTime(TICK.floor, start);
  voice.gain.exponentialRampToValueAtTime(TICK.peak, start + TICK.attack);
  voice.gain.exponentialRampToValueAtTime(TICK.floor, end);
  osc.connect(voice);
  voice.connect(ctx.destination);
  osc.start(start);
  osc.stop(end + TICK.tail);
}

/** What the signature needs from the browser (the page's; fakes in the tests). */
export interface SoundEnvironment {
  /** A new AudioContext, or null where Web Audio is missing. */
  createContext(): SoundContext | null;
  /** navigator.audioSession (Safari 17 and later), when it exists. */
  audioSession(): { type: string } | undefined;
  /** Whether the page is in the background. */
  hidden(): boolean;
  /** Where the preference is kept (null: nowhere, the default holds). */
  storage: PrefStorage | null;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type AudioContextClass = new () => AudioContext;

/** The browser's environment: AudioContext (webkitAudioContext on an older Safari), audioSession, visibility, local storage. */
export function browserSoundEnvironment(): SoundEnvironment {
  return {
    createContext() {
      const w = globalThis as typeof globalThis & { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      return Ctor ? (new Ctor() as unknown as SoundContext) : null;
    },
    audioSession: () => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { audioSession?: { type: string } }).audioSession),
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    storage: deviceStorage(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/** How long after a chord starts its context is suspended: the chord, its lead, its tail, and a margin. */
export const SUSPEND_AFTER_MS = Math.round((SIGNATURE.lead + SIGNATURE.duration + SIGNATURE.tail + 0.1) * 1000);

/** The sound switch the landing shows (SOUND ON / OFF). */
export interface SoundSwitch {
  readonly on: boolean;
  set(on: boolean): void;
}

/** The sound signature of the app: one per page. */
export class SoundSignature implements SoundSwitch {
  private ctx: SoundContext | null = null;
  private enabled: boolean;
  private rest: unknown = null;

  constructor(private readonly env: SoundEnvironment = browserSoundEnvironment()) {
    this.enabled = soundPref(env.storage);
  }

  /** Whether the chord plays (the preference of this device; on by default). */
  get on(): boolean {
    return this.enabled;
  }

  /** SOUND ON / OFF: kept on this device; off also releases the audio output at once. */
  set(on: boolean): void {
    this.enabled = on;
    setSoundPref(on, this.env.storage);
    if (!on) this.suspend();
  }

  /**
   * In the gesture SCAN ORBES CODE or UPLOAD A PHOTO, before anything is awaited: the audio session made ambient,
   * then the AudioContext created (the first time) or resumed. Nothing when the sound is off.
   */
  prime(): void {
    if (!this.enabled) return;
    try {
      const session = this.env.audioSession();
      if (session && session.type !== 'ambient') session.type = 'ambient';
    } catch {
      // A session that refuses the type: the chord still plays, as the browser decides.
    }
    try {
      if (!this.ctx) this.ctx = this.env.createContext();
      else this.resume(this.ctx);
    } catch {
      this.ctx = null;
    }
  }

  /** A result is on screen: the chord, for an AUTHENTIC_* state only. True when it was scheduled. */
  resultShown(state: VerificationState): boolean {
    return isAuthenticState(state) && this.play();
  }

  /** The chord, when the sound is on, a gesture created the context and the page is in view. True when scheduled. */
  play(): boolean {
    return this.sound(scheduleSignature);
  }

  /** A tick of the last ten seconds before a LIVE RELEASE opens, on the same conditions as the chord. True when scheduled. */
  tick(): boolean {
    return this.sound(scheduleTick);
  }

  /** Schedule a sound, then suspend the context once it has faded (a tick a second keeps it running through the ten). */
  private sound(schedule: (ctx: SoundContext) => void): boolean {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || this.env.hidden()) return false;
    try {
      this.resume(ctx);
      schedule(ctx);
    } catch {
      return false;
    }
    if (this.rest !== null) this.env.clearTimeout(this.rest);
    this.rest = this.env.setTimeout(() => {
      this.rest = null;
      this.suspend();
    }, SUSPEND_AFTER_MS);
    return true;
  }

  private resume(ctx: SoundContext): void {
    if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
  }

  private suspend(): void {
    if (this.rest !== null) {
      this.env.clearTimeout(this.rest);
      this.rest = null;
    }
    const ctx = this.ctx;
    if (ctx?.state === 'running') void ctx.suspend().catch(() => undefined);
  }
}
