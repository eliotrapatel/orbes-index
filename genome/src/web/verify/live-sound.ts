/**
 * The designed sounds of a LIVE RELEASE (lot Q1 §3.10; D45 OP-19, D46, D47 OP-28): the owner's files of
 * sound/final/ (picks.json) replace the room's synthesized tick and chord. The LIVE flow's eleven ship here
 * (`sounds/*.mp3`, published by scripts/build-web.ts under /assets/ with a content hash, cached as immutable); the
 * vault's five come with THE VAULT (lot Q3). The scan result's chord stays in sound.ts (reading N12).
 *
 *   gesture ──▶ prime(): the audio session ambient (where offered), the AudioContext created or resumed, each file
 *               fetched and decoded off the gesture's task (once; a file that failed is tried again at the next)
 *   cue(passage, base) ──▶ each of its sounds at its offset from the passage's own start (SFX_AT), on the context's
 *               clock, each buffer through a GainNode at 0.9, as the mockup's sfx-engine.js plays them
 *   a screen change ──▶ stopAll(): what still sounds or waits to sound is stopped
 *
 * It follows the SOUND preference of the device (shared/prefs.ts, the foot's SOUND ON / OFF): the same switch as the
 * scan's chord (`SoundSignature`); SOUND OFF stops what plays and fetches nothing. Once nothing has sounded for a
 * second the context is suspended, so it holds no audio output while nothing plays (as sound.ts does), yet runs on
 * through sounds that follow each other closely (the ten ticks a second apart, N4: each on its figure change, never
 * waiting for a resume); a sound scheduled while a suspend is still pending resumes it at once. Nothing starts while
 * the page is in the background. The welcome voice (`welcome.mp3`, D46) is heard once per entry, never in the after-room (N6):
 * the entries that heard it are remembered on the device (WELCOME_KEY), never sent. Vibration is the page's, as
 * before. Nothing here may break the page: every call into Web Audio, the network and the storage is wrapped, and a
 * sound that cannot play is simply not heard.
 */
import { deviceStorage, readPref, writePref, type PrefStorage } from '../shared/prefs.js';
import type { SoundSwitch } from './sound.js';
import afterRoomMp3 from './sounds/after-room.mp3';
import confirmedMp3 from './sounds/confirmed.mp3';
import drawMp3 from './sounds/draw.mp3';
import holdMp3 from './sounds/hold.mp3';
import openingMp3 from './sounds/opening.mp3';
import placeMp3 from './sounds/place.mp3';
import roomTickMp3 from './sounds/room-tick.mp3';
import securedMp3 from './sounds/secured.mp3';
import soldOutMp3 from './sounds/sold-out.mp3';
import turnMp3 from './sounds/turn.mp3';
import welcomeMp3 from './sounds/welcome.mp3';

/** The LIVE flow's designed sounds: eleven of the sixteen chosen (the five vault-* come with lot Q3). */
export const LIVE_SOUNDS = ['room-tick', 'draw', 'opening', 'welcome', 'place', 'turn', 'hold', 'secured', 'confirmed', 'sold-out', 'after-room'] as const;
export type LiveSoundName = (typeof LIVE_SOUNDS)[number];

/** Each sound's published URL (the build's hashed /assets/ file). */
export const LIVE_SOUND_FILES: Readonly<Record<LiveSoundName, string>> = Object.freeze({
  'room-tick': roomTickMp3,
  draw: drawMp3,
  opening: openingMp3,
  welcome: welcomeMp3,
  place: placeMp3,
  turn: turnMp3,
  hold: holdMp3,
  secured: securedMp3,
  confirmed: confirmedMp3,
  'sold-out': soldOutMp3,
  'after-room': afterRoomMp3,
});

/** The gain each buffer plays through (sfx-engine.js: `g.gain.value = 0.9`). */
export const LIVE_GAIN = 0.9;

/**
 * When each passage's sounds start, in seconds from the passage's own start (the mockup's SFX_AT, read for the product,
 * plan §3.4–§3.10): a tick at each figure change of the countdown's last ten seconds (N4); the draw 0.85 s after the
 * countdown reaches 00:00 (SFX_AT draw 2.25 − its 00:00 at 1.4); THE OPENING's sound, then the welcome voice; a place
 * that moves; the turn; the hold with the press itself (the ring starts to fill at 0 s); SECURED; SOLD OUT for the
 * size; CONFIRMED; the after-room's door.
 */
export const SFX_AT = Object.freeze({
  tick: [['room-tick', 0]],
  draw: [['draw', 0.85]],
  open: [
    ['opening', 0.4],
    ['welcome', 3.0],
  ],
  place: [['place', 0]],
  turn: [['turn', 0.3]],
  hold: [['hold', 0]],
  secured: [['secured', 0.6]],
  sold: [['sold-out', 0.25]],
  confirmed: [['confirmed', 0.6]],
  after: [['after-room', 1.15]],
} satisfies Record<string, readonly (readonly [LiveSoundName, number])[]>);
export type LivePassage = keyof typeof SFX_AT;

/** A sound asked for later than this after its time (its file still loading) is not heard: late, it would mislead. */
export const LATE_S = 0.5;
/**
 * The context is suspended this long after the last sound scheduled has ended: longer than the gap between two ticks of
 * the last ten seconds (a figure change each second, room-tick.mp3 lasting 0.52 s), so the ten keep it running, as the
 * room's synthesized tick did (SUSPEND_AFTER_MS 1040 ms from each tick).
 */
export const REST_MARGIN_MS = 1000;

/** The device's memory of the entries that heard the welcome voice (their ids, space-separated, the newest last). */
export const WELCOME_KEY = 'orbes.live.welcome';
/** How many entries it keeps: the oldest goes first. */
export const WELCOME_KEEP = 20;

/** Whether this entry already heard the welcome voice on this device (a storage that cannot be read: no). */
export function welcomed(entryId: string, storage: PrefStorage | null = deviceStorage()): boolean {
  return (readPref(WELCOME_KEY, storage) ?? '').split(' ').includes(entryId);
}

/** Remember that this entry heard the welcome voice (a storage that refuses it: dropped). */
export function rememberWelcome(entryId: string, storage: PrefStorage | null = deviceStorage()): void {
  const ids = (readPref(WELCOME_KEY, storage) ?? '').split(' ').filter((id) => id !== '' && id !== entryId);
  ids.push(entryId);
  writePref(WELCOME_KEY, ids.slice(-WELCOME_KEEP).join(' '), storage);
}

/** A decoded sound (an AudioBuffer). */
export interface LiveBuffer {
  readonly duration: number;
}

/** The part of an AudioNode the sounds use. */
export interface LiveNode {
  connect(destination: LiveNode): unknown;
}

/** The part of an AudioBufferSourceNode the sounds use. */
export interface LiveSource extends LiveNode {
  buffer: LiveBuffer | null;
  onended: (() => void) | null;
  start(when: number): void;
  stop(): void;
}

/** The part of an AudioContext the sounds use (an AudioContext; a recorder in the tests). */
export interface LiveAudioContext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: LiveNode;
  createBufferSource(): LiveSource;
  createGain(): LiveNode & { gain: { value: number } };
  decodeAudioData(data: ArrayBuffer, ok: (buffer: LiveBuffer) => void, fail: (error: unknown) => void): Promise<LiveBuffer> | void;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

/** What the sounds need from the browser (the page's; fakes in the tests). */
export interface LiveSoundEnvironment {
  /** A new AudioContext, or null where Web Audio is missing. */
  createContext(): LiveAudioContext | null;
  /** navigator.audioSession (Safari 17 and later), when it exists. */
  audioSession(): { type: string } | undefined;
  /** Whether the page is in the background. */
  hidden(): boolean;
  /** Where the welcome voice's memory is kept (null: nowhere, it plays at each entry's first opening on this page). */
  storage: PrefStorage | null;
  /** A file's bytes (same origin). */
  load(url: string): Promise<ArrayBuffer>;
  /** performance.now(): the clock the passages' starts are read on. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type AudioContextClass = new () => AudioContext;

/** The browser's environment: AudioContext (webkitAudioContext on an older Safari), audioSession, fetch, local storage. */
export function browserLiveSoundEnvironment(): LiveSoundEnvironment {
  return {
    createContext() {
      const w = globalThis as typeof globalThis & { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      return Ctor ? (new Ctor() as unknown as LiveAudioContext) : null;
    },
    audioSession: () => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { audioSession?: { type: string } }).audioSession),
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    storage: deviceStorage(),
    load: async (url) => {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`sound ${response.status}`);
      return response.arrayBuffer();
    },
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/** Decode with the callbacks every browser has, and the promise where it is returned. */
function decode(ctx: LiveAudioContext, bytes: ArrayBuffer): Promise<LiveBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

/** Options of a cue: the passage's start (performance.now(); now by default), the entry, whether in the after-room. */
export interface CueOptions {
  base?: number;
  /** The entry the welcome voice is for (THE OPENING, or a late comer's first reading). */
  entryId?: string | null;
  afterRoom?: boolean;
}

/** The LIVE flow's sounds: one per page, sharing the device's SOUND preference with the scan's chord. */
export class LiveSound implements SoundSwitch {
  private ctx: LiveAudioContext | null = null;
  private readonly buffers = new Map<LiveSoundName, LiveBuffer>();
  private readonly loading = new Map<LiveSoundName, Promise<LiveBuffer | null>>();
  private readonly sources = new Set<LiveSource>();
  /** Moves on at each stopAll: a sound still loading for an earlier screen never starts. */
  private generation = 0;
  private rest: unknown = null;
  private restUntil = 0;
  /** The last state asked of the context (resume() and suspend() settle later): a pending suspend is never trusted. */
  private asked: 'resume' | 'suspend' | null = null;

  constructor(
    private readonly preference: SoundSwitch,
    private readonly env: LiveSoundEnvironment = browserLiveSoundEnvironment(),
  ) {}

  /** Whether the sounds play: the device's SOUND preference. */
  get on(): boolean {
    return this.preference.on;
  }

  /** SOUND ON / OFF (in a tap): kept on the device; on primes in the tap, off stops what plays and releases the output. */
  set(on: boolean): void {
    this.preference.set(on);
    if (on) this.prime();
    else {
      this.stopAll();
      this.suspend();
    }
  }

  /**
   * In a gesture of the room (a size, ENTER, ENTER THE LINE, the seal, a tap or a key in the room), before anything is
   * awaited: the audio session made ambient, the AudioContext created (the first time) or resumed, the files loaded.
   * Nothing when the sound is off.
   */
  prime(): void {
    if (!this.on) return;
    try {
      const session = this.env.audioSession();
      if (session && session.type !== 'ambient') session.type = 'ambient';
    } catch {
      // A session that refuses the type: the sounds still play, as the browser decides.
    }
    try {
      if (!this.ctx) this.ctx = this.env.createContext();
      else this.resume(this.ctx);
    } catch {
      this.ctx = null;
    }
    if (this.ctx) this.load(this.ctx);
  }

  /** Each file fetched and decoded once, off the gesture's own task; one that failed is tried again at the next prime. */
  private load(ctx: LiveAudioContext): void {
    for (const name of LIVE_SOUNDS) {
      if (this.buffers.has(name) || this.loading.has(name)) continue;
      const pending = new Promise<void>((resolve) => this.env.setTimeout(resolve, 0))
        .then(() => this.env.load(LIVE_SOUND_FILES[name]))
        .then((bytes) => decode(ctx, bytes))
        .then((buffer) => {
          this.buffers.set(name, buffer);
          return buffer;
        })
        .catch(() => {
          this.loading.delete(name);
          return null;
        });
      this.loading.set(name, pending);
    }
  }

  /** A passage's sounds, each at its offset from the passage's start (SFX_AT); the welcome voice once per entry. */
  cue(passage: LivePassage, options: CueOptions = {}): void {
    const base = options.base ?? this.env.now();
    for (const [name, offset] of SFX_AT[passage]) {
      if (name === 'welcome') {
        const id = options.entryId;
        if (!id || options.afterRoom || welcomed(id, this.env.storage)) continue;
        if (this.play(name, offset, base)) rememberWelcome(id, this.env.storage);
      } else this.play(name, offset, base);
    }
  }

  /**
   * One sound, `delay` seconds after `base` (performance.now(); now by default), on the context's clock, through a gain
   * of 0.9. True when it is scheduled (or waits for its file): the sound on, a gesture made the context, the page in view.
   */
  play(name: LiveSoundName, delay = 0, base = this.env.now()): boolean {
    const ctx = this.ctx;
    if (!this.on || !ctx || this.env.hidden()) return false;
    const due = base + delay * 1000;
    const generation = this.generation;
    const start = (buffer: LiveBuffer): void => {
      if (generation !== this.generation || this.ctx !== ctx || !this.on) return;
      const ahead = (due - this.env.now()) / 1000;
      if (ahead < -LATE_S) return;
      try {
        this.resume(ctx);
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = LIVE_GAIN;
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => this.sources.delete(source);
        source.start(ctx.currentTime + Math.max(0, ahead));
        this.sources.add(source);
        this.keepUntil(this.env.now() + Math.max(0, ahead) * 1000 + buffer.duration * 1000);
      } catch {
        // A sound that cannot play is not heard.
      }
    };
    const ready = this.buffers.get(name);
    if (ready) {
      start(ready);
      return true;
    }
    const pending = this.loading.get(name);
    if (!pending) return false;
    void pending.then((buffer) => {
      if (buffer) start(buffer);
    });
    return true;
  }

  /** At a screen change: every sound playing or waiting to play stops. */
  stopAll(): void {
    this.generation += 1;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.sources.clear();
    // Nothing scheduled is left: the context rests after the margin (a cue right after keeps it running).
    this.restUntil = 0;
    this.keepUntil(this.env.now());
  }

  /** Keep the context running until `until` (performance.now()) plus a margin, then suspend it. */
  private keepUntil(until: number): void {
    this.restUntil = Math.max(this.restUntil, until + REST_MARGIN_MS);
    if (this.rest !== null) this.env.clearTimeout(this.rest);
    this.rest = this.env.setTimeout(() => {
      this.rest = null;
      if (this.env.now() + 1 >= this.restUntil) this.suspend();
      else this.keepUntil(this.restUntil - REST_MARGIN_MS);
    }, Math.max(0, this.restUntil - this.env.now()));
  }

  /** Running again: also when it still reads 'running' but a suspend asked earlier has not settled yet. */
  private resume(ctx: LiveAudioContext): void {
    try {
      if (ctx.state === 'closed') return;
      if (ctx.state !== 'running' || this.asked === 'suspend') {
        this.asked = 'resume';
        void ctx.resume().catch(() => undefined);
      }
    } catch {
      // A context that refuses: nothing is heard.
    }
  }

  private suspend(): void {
    if (this.rest !== null) {
      this.env.clearTimeout(this.rest);
      this.rest = null;
    }
    const ctx = this.ctx;
    try {
      if (!ctx || ctx.state === 'closed' || this.asked === 'suspend') return;
      // Running, or a resume asked that has not settled yet: suspended after it.
      if (ctx.state === 'running' || this.asked === 'resume') {
        this.asked = 'suspend';
        void ctx.suspend().catch(() => undefined);
      }
    } catch {
      // Nothing to release.
    }
  }
}
