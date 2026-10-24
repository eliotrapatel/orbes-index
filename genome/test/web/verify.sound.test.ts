/**
 * The sound signature (P-D07, src/web/verify/sound.ts) and the preference
 * kept on the device (src/web/shared/prefs.ts): the chord scheduled on a
 * recording AudioContext, when it plays (an AUTHENTIC_* result, after the
 * gesture that created the context, the page in view, the sound on), the
 * ambient audio session set before the context exists, the context suspended
 * between chords, and a storage that refuses every access. A LIVE RELEASE's
 * designed sounds (lot Q1 §3.10, src/web/verify/live-sound.ts): the eleven
 * files shipped, their cues (SFX_AT) on a recording context through a gain of
 * 0.9, the context made in the room's gesture and its files loaded then, the
 * SOUND preference shared with the chord, stopAll at a screen change, the
 * welcome voice once per entry, and the room's synthesized tick and chord
 * replaced (the scan keeps its chord, N12). The landing's
 * SOUND ON / OFF and the chord in a real page are checked in Chromium by
 * verify.e2e.test.ts.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceStorage, readPref, setSoundPref, SOUND_OFF, SOUND_PREF_KEY, soundPref, writePref, type PrefStorage } from '../../src/web/shared/prefs.js';
import { SOUND } from '../../src/web/verify/copy.js';
import { browserSoundEnvironment, scheduleSignature, SIGNATURE, SoundSignature, SUSPEND_AFTER_MS, type SoundContext, type SoundEnvironment, type SoundNode, type SoundParam } from '../../src/web/verify/sound.js';
import {
  LATE_S,
  LIVE_GAIN,
  LIVE_SOUND_FILES,
  LIVE_SOUNDS,
  LiveSound,
  rememberWelcome,
  REST_MARGIN_MS,
  SFX_AT,
  WELCOME_KEEP,
  WELCOME_KEY,
  welcomed,
  type LiveAudioContext,
  type LiveBuffer,
  type LiveNode,
  type LiveSoundEnvironment,
  type LiveSoundName,
  type LiveSource,
} from '../../src/web/verify/live-sound.js';
import { VERIFICATION_STATES } from '../../src/web/verify/types.js';
import { at, installDevice } from '../support/fake-device.js';

/** A Map behind the Storage interface. */
class MemoryStorage implements PrefStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A storage that refuses everything (a private window, blocked site data). */
const REFUSING: PrefStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

type Event = [string, number, number];

interface Voice {
  type: string;
  frequency: Event[];
  gain: Event[];
  start?: number;
  stop?: number;
  /** Where the oscillator, then its gain, are connected. */
  chain: string[];
}

/** A gain node of the recorder: its events, and where it leads once connected. */
interface RecordedGain {
  events: Event[];
  to: unknown;
  gain: SoundParam;
  connect(node: SoundNode): unknown;
}

const param = (events: Event[]): SoundParam => ({
  setValueAtTime: (v: number, t: number) => events.push(['set', v, t]),
  exponentialRampToValueAtTime: (v: number, t: number) => events.push(['exp', v, t]),
});

/** An AudioContext that records the voices scheduled on it (an oscillator and the gain it is connected to). */
class RecordingContext implements SoundContext {
  currentTime = 3;
  state = 'running';
  readonly destination: SoundNode = { connect: () => undefined };
  private readonly oscillators: { voice: Voice; gain: RecordedGain | null }[] = [];
  resumes = 0;
  suspends = 0;
  get voices(): Voice[] {
    return this.oscillators.map(({ voice, gain }) => ({
      ...voice,
      gain: gain?.events ?? [],
      chain: [gain ? 'gain' : 'none', gain?.to === this.destination ? 'destination' : 'other'],
    }));
  }
  createOscillator() {
    const voice: Voice = { type: '', frequency: [], gain: [], chain: [] };
    const entry: { voice: Voice; gain: RecordedGain | null } = { voice, gain: null };
    this.oscillators.push(entry);
    return {
      get type() {
        return voice.type as OscillatorType;
      },
      set type(t: OscillatorType) {
        voice.type = t;
      },
      frequency: param(voice.frequency),
      connect(node: SoundNode) {
        entry.gain = node as RecordedGain;
        return node;
      },
      start: (t: number) => void (voice.start = t),
      stop: (t: number) => void (voice.stop = t),
    };
  }
  createGain(): RecordedGain {
    const events: Event[] = [];
    const node: RecordedGain = {
      events,
      to: null,
      gain: param(events),
      connect: (n) => {
        node.to = n;
        return n;
      },
    };
    return node;
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

/** A page's environment: contexts recorded as they are created, a session, timers run by hand. */
function environment(opts: { storage?: PrefStorage | null; session?: { type: string } | null; webAudio?: boolean } = {}) {
  const log: string[] = [];
  const contexts: RecordingContext[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const session = opts.session === null ? undefined : (opts.session ?? { type: 'auto' });
  let hidden = false;
  const env: SoundEnvironment = {
    createContext: () => {
      if (opts.webAudio === false) return null;
      log.push(`context (session ${session?.type ?? 'none'})`);
      const ctx = new RecordingContext();
      contexts.push(ctx);
      return ctx;
    },
    audioSession: () => session,
    hidden: () => hidden,
    storage: opts.storage === undefined ? new MemoryStorage() : opts.storage,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => void ((t as { cleared: boolean }).cleared = true),
  };
  return { env, log, contexts, timers, session, setHidden: (h: boolean) => void (hidden = h) };
}

const AUTHENTIC = ['AUTHENTIC', 'AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_REGISTERED', 'AUTHENTIC_OWNERSHIP_VERIFIED'] as const;

describe('the preference kept on the device (shared/prefs.ts, P-D07)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the sound on by default, stores "off" under orbes.sound once turned off, and removes the key when turned back on', () => {
    const storage = new MemoryStorage();
    expect(SOUND_PREF_KEY).toBe('orbes.sound');
    expect(soundPref(storage)).toBe(true);
    expect(setSoundPref(false, storage)).toBe(true);
    expect([...storage.items]).toEqual([['orbes.sound', SOUND_OFF]]);
    expect(SOUND_OFF).toBe('off');
    expect(soundPref(storage)).toBe(false);
    expect(setSoundPref(true, storage)).toBe(true);
    expect([...storage.items]).toEqual([]);
    expect(soundPref(storage)).toBe(true);
    // Any other value (an older page, an edit by hand) reads as the default.
    storage.setItem(SOUND_PREF_KEY, 'whatever');
    expect(soundPref(storage)).toBe(true);
  });

  it('works without a storage: a refused read gives the default, a refused write is dropped, nothing throws', () => {
    expect(readPref(SOUND_PREF_KEY, REFUSING)).toBeNull();
    expect(writePref(SOUND_PREF_KEY, 'off', REFUSING)).toBe(false);
    expect(writePref(SOUND_PREF_KEY, null, REFUSING)).toBe(false);
    expect(soundPref(REFUSING)).toBe(true);
    expect(setSoundPref(false, REFUSING)).toBe(false);
    expect(soundPref(null)).toBe(true);
    expect(setSoundPref(false, null)).toBe(false);
  });

  it('finds the browser storage, and none where reading localStorage itself throws or it does not exist', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(deviceStorage()).toBe(storage);
    expect(setSoundPref(false)).toBe(true);
    expect(soundPref()).toBe(false);
    vi.unstubAllGlobals();
    expect(deviceStorage()).toBeNull();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(deviceStorage()).toBeNull();
      expect(soundPref()).toBe(true);
      expect(setSoundPref(false)).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('the chord (P-D07)', () => {
  it('schedules four soft sine voices, D4 A4 C♯5 E5, struck 40 ms apart, fading to silence about 0.9 s after the first', () => {
    const ctx = new RecordingContext();
    scheduleSignature(ctx);
    const t0 = ctx.currentTime + SIGNATURE.lead;
    const end = t0 + SIGNATURE.duration;
    expect(SIGNATURE.duration).toBeCloseTo(0.9, 5);
    expect(ctx.voices.map((v) => v.type)).toEqual(['sine', 'sine', 'sine', 'sine']);
    expect(ctx.voices.map((v) => v.frequency)).toEqual(SIGNATURE.notes.map((hz, i) => [['set', hz, t0 + i * SIGNATURE.stagger]]));
    expect([...SIGNATURE.notes]).toEqual([293.66, 440, 554.37, 659.26]);
    ctx.voices.forEach((v, i) => {
      const start = t0 + i * SIGNATURE.stagger;
      expect(v.start, `voice ${i}`).toBeCloseTo(start, 9);
      expect(v.gain, `voice ${i}`).toEqual([
        ['set', SIGNATURE.floor, start],
        ['exp', SIGNATURE.peak, start + SIGNATURE.attack],
        ['exp', SIGNATURE.floor, end],
      ]);
      expect(v.stop, `voice ${i}`).toBeCloseTo(end + SIGNATURE.tail, 9);
      // Oscillator → its gain → the output.
      expect(v.chain).toEqual(['gain', 'destination']);
    });
    // Soft: the four peaks together stay far under full scale, and the whole chord ends within a second.
    expect(SIGNATURE.notes.length * SIGNATURE.peak).toBeLessThanOrEqual(0.25);
    expect(Math.max(...ctx.voices.map((v) => v.stop!)) - ctx.currentTime).toBeLessThan(1);
    expect(SUSPEND_AFTER_MS).toBe(1040);
  });
});

describe('SoundSignature: when the chord plays (P-D07)', () => {
  it('creates the AudioContext in the gesture (prime), the audio session made ambient first, once; then plays on an AUTHENTIC_* result only', () => {
    const { env, log, contexts, session } = environment();
    const sound = new SoundSignature(env);
    expect(sound.on).toBe(true);
    // No gesture yet: no context, no chord.
    expect(sound.resultShown('AUTHENTIC')).toBe(false);
    expect(contexts).toHaveLength(0);
    sound.prime();
    expect(log).toEqual(['context (session ambient)']);
    expect(session?.type).toBe('ambient');
    // A second gesture keeps the same context.
    sound.prime();
    expect(contexts).toHaveLength(1);
    for (const state of VERIFICATION_STATES) {
      const before = contexts[0].voices.length;
      const played = sound.resultShown(state);
      expect(played, state).toBe((AUTHENTIC as readonly string[]).includes(state));
      expect(contexts[0].voices.length - before, state).toBe(played ? SIGNATURE.notes.length : 0);
    }
    expect(VERIFICATION_STATES.filter((s) => s.startsWith('AUTHENTIC'))).toEqual([...AUTHENTIC]);
  });

  it('suspends the context once the chord has faded, and resumes it in the next gesture or before the next chord', () => {
    const { env, contexts, timers } = environment();
    const sound = new SoundSignature(env);
    sound.prime();
    const ctx = contexts[0];
    expect(sound.play()).toBe(true);
    expect(timers.map((t) => t.ms)).toEqual([SUSPEND_AFTER_MS]);
    timers[0].fn();
    expect(ctx.suspends).toBe(1);
    expect(ctx.state).toBe('suspended');
    sound.prime();
    expect(ctx.resumes).toBe(1);
    // Two chords close together: the first's suspension is cancelled, the second's waits its own chord.
    expect(sound.play()).toBe(true);
    expect(sound.play()).toBe(true);
    expect(timers.slice(1).map((t) => t.cleared)).toEqual([true, false]);
    // Suspended by then (TRY AGAIN, VIEW AS OWNER after a while): the chord resumes it first.
    timers[2].fn();
    expect(ctx.state).toBe('suspended');
    expect(sound.play()).toBe(true);
    expect(ctx.resumes).toBe(2);
    // A context the browser interrupted (a call on iPhone) is resumed too; a running one never is.
    ctx.state = 'interrupted';
    sound.prime();
    expect(ctx.resumes).toBe(3);
    sound.prime();
    expect(ctx.resumes).toBe(3);
  });

  it('plays nothing while the page is in the background', () => {
    const { env, contexts, setHidden } = environment();
    const sound = new SoundSignature(env);
    sound.prime();
    setHidden(true);
    expect(sound.resultShown('AUTHENTIC_REGISTERED')).toBe(false);
    expect(contexts[0].voices).toHaveLength(0);
    setHidden(false);
    expect(sound.resultShown('AUTHENTIC_REGISTERED')).toBe(true);
  });

  it('SOUND OFF: kept on the device, no context created, no chord; read back by the next page; SOUND ON again', () => {
    const storage = new MemoryStorage();
    const first = environment({ storage });
    const sound = new SoundSignature(first.env);
    sound.prime();
    sound.play();
    sound.set(false);
    expect(sound.on).toBe(false);
    expect(storage.getItem(SOUND_PREF_KEY)).toBe('off');
    // Off releases the audio output at once, and its pending suspension with it.
    expect(first.contexts[0].suspends).toBe(1);
    expect(first.timers[0].cleared).toBe(true);
    expect(sound.resultShown('AUTHENTIC')).toBe(false);

    // The next visit reads it: no context is ever created while it is off.
    const next = environment({ storage });
    const again = new SoundSignature(next.env);
    expect(again.on).toBe(false);
    again.prime();
    expect(next.contexts).toHaveLength(0);
    expect(next.session?.type).toBe('auto');
    expect(again.resultShown('AUTHENTIC')).toBe(false);
    again.set(true);
    expect(storage.getItem(SOUND_PREF_KEY)).toBeNull();
    again.prime();
    expect(again.resultShown('AUTHENTIC')).toBe(true);
  });

  it('never breaks a result: no Web Audio, no audio session, a session or a context that throws, a storage that refuses', () => {
    // No Web Audio at all.
    const none = environment({ webAudio: false });
    const mute = new SoundSignature(none.env);
    mute.prime();
    expect(mute.resultShown('AUTHENTIC')).toBe(false);

    // No navigator.audioSession (every browser but Safari): the context is created all the same.
    const plain = environment({ session: null });
    const s1 = new SoundSignature(plain.env);
    s1.prime();
    expect(plain.log).toEqual(['context (session none)']);
    expect(s1.play()).toBe(true);

    // A session that refuses the type.
    const strict = environment();
    strict.env.audioSession = () =>
      Object.defineProperty({} as { type: string }, 'type', {
        get: () => 'auto',
        set: () => {
          throw new TypeError('refused');
        },
      });
    const s2 = new SoundSignature(strict.env);
    s2.prime();
    expect(strict.contexts).toHaveLength(1);

    // A constructor that throws (too many contexts), then scheduling that throws.
    const broken = environment();
    broken.env.createContext = () => {
      throw new Error('NotSupportedError');
    };
    const s3 = new SoundSignature(broken.env);
    expect(() => s3.prime()).not.toThrow();
    expect(s3.play()).toBe(false);
    const failing = environment();
    const s4 = new SoundSignature(failing.env);
    s4.prime();
    failing.contexts[0].createOscillator = () => {
      throw new Error('InvalidStateError');
    };
    expect(s4.play()).toBe(false);

    // A storage that refuses: on by default, and the switch still works for this page.
    const refused = environment({ storage: REFUSING });
    const s5 = new SoundSignature(refused.env);
    expect(s5.on).toBe(true);
    s5.set(false);
    expect(s5.on).toBe(false);
  });

  it('labels the switch SOUND, its state ON or OFF', () => {
    expect(SOUND).toEqual({ label: 'SOUND', on: 'ON', off: 'OFF' });
  });
});

/** A decoded file of the recorder: its source's URL, a second long unless named in DURATIONS. */
interface FakeBuffer {
  readonly url: string;
  readonly duration: number;
}

/** A source of the recorder: the buffer it plays, the gain it goes through, when it starts, whether it was stopped. */
interface PlayedSource {
  buffer: FakeBuffer | null;
  gain: number | null;
  toDestination: boolean;
  start: number | null;
  stopped: boolean;
}

/** An AudioContext that records the buffer sources started on it, and the files it decodes. */
class LiveRecordingContext implements LiveAudioContext {
  currentTime = 5;
  state = 'running';
  readonly destination: LiveNode = { connect: () => undefined };
  readonly played: PlayedSource[] = [];
  readonly decoded: string[] = [];
  resumes = 0;
  suspends = 0;
  failDecode = false;
  failSource = false;
  createBufferSource(): LiveSource {
    if (this.failSource) throw new Error('InvalidStateError');
    const rec: PlayedSource = { buffer: null, gain: null, toDestination: false, start: null, stopped: false };
    this.played.push(rec);
    const ctx = this;
    return {
      get buffer() {
        return rec.buffer;
      },
      set buffer(b) {
        rec.buffer = b as FakeBuffer;
      },
      onended: null,
      connect(node) {
        const g = node as LiveNode & { gain: { value: number }; to?: unknown };
        rec.gain = g.gain.value;
        // The gain's own connection is read when the source starts.
        (rec as PlayedSource & { node?: unknown }).node = g;
        return node;
      },
      start(when) {
        rec.start = when;
        rec.toDestination = ((rec as PlayedSource & { node?: { to?: unknown } }).node?.to ?? null) === ctx.destination;
      },
      stop() {
        rec.stopped = true;
      },
    };
  }
  createGain() {
    const node = {
      gain: { value: 1 },
      to: null as unknown,
      connect(n: LiveNode) {
        node.to = n;
        return n;
      },
    };
    return node;
  }
  decodeAudioData(data: ArrayBuffer, ok: (b: LiveBuffer) => void, fail: (e: unknown) => void): void {
    const url = new TextDecoder().decode(data);
    if (this.failDecode) {
      fail(new Error('EncodingError'));
      return;
    }
    this.decoded.push(url);
    // The welcome's voice is long, room-tick.mp3 lasts 0.522 s as published, the others a second.
    ok({ url, duration: url.includes('welcome') ? 12 : url.includes('room-tick') ? 0.522 : 1 } as FakeBuffer);
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

/** The name of a published sound from its URL (`…/room-tick.mp3`, or a build's `room-tick-HASH.mp3`). */
const soundName = (url: string) => /([a-z-]+?)(-[A-Z0-9]{8})?\.mp3$/.exec(url)?.[1] ?? url;

/** A page's environment for the LIVE sounds: contexts recorded, files served as their URL, a clock and timers by hand. */
function liveEnvironment(opts: { storage?: PrefStorage | null; session?: { type: string } | null; webAudio?: boolean; load?: (url: string) => Promise<ArrayBuffer> } = {}) {
  const log: string[] = [];
  const contexts: LiveRecordingContext[] = [];
  const loads: string[] = [];
  const timers: { fn: () => void; ms: number; at: number; done: boolean }[] = [];
  const session = opts.session === null ? undefined : (opts.session ?? { type: 'auto' });
  let hidden = false;
  let now = 1_000;
  const storage = opts.storage === undefined ? new MemoryStorage() : opts.storage;
  const env: LiveSoundEnvironment = {
    createContext: () => {
      if (opts.webAudio === false) return null;
      log.push(`context (session ${session?.type ?? 'none'})`);
      const ctx = new LiveRecordingContext();
      contexts.push(ctx);
      return ctx;
    },
    audioSession: () => session,
    hidden: () => hidden,
    storage,
    load: (url) => {
      loads.push(url);
      return opts.load ? opts.load(url) : Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer);
    },
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, at: now + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => void ((t as { done: boolean }).done = true),
  };
  /** Let the promises of the loads settle. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  /** Move the clock on by `ms` (the context's with it), running the timers due, then let the promises settle. */
  const advance = async (ms: number) => {
    now += ms;
    for (const ctx of contexts) if (ctx.state === 'running') ctx.currentTime += ms / 1000;
    for (const t of timers) {
      if (!t.done && t.at <= now) {
        t.done = true;
        t.fn();
      }
    }
    await settle();
  };
  return { env, log, contexts, loads, timers, session, storage, advance, settle, setHidden: (h: boolean) => void (hidden = h), now: () => now };
}

/** A SOUND switch as the page's SoundSignature is, on a phone (on by default). */
const switchOn = (storage: PrefStorage | null) => new SoundSignature({ ...environment({ storage }).env, defaultOn: () => true });

describe('a LIVE RELEASE\'s designed sounds (lot Q1 §3.10, live-sound.ts)', () => {
  const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/web/verify/sounds');
  const LIVE_VIEW = join(dirname(fileURLToPath(import.meta.url)), '../../src/web/verify/views/live.ts');

  it('ships the eleven LIVE files of the sixteen chosen, byte for byte as sound/final (picks.json): no vault-*, never welcome.prev-confident', () => {
    expect([...LIVE_SOUNDS]).toEqual(['room-tick', 'draw', 'opening', 'welcome', 'place', 'turn', 'hold', 'secured', 'confirmed', 'sold-out', 'after-room']);
    expect(readdirSync(SOUNDS_DIR).sort()).toEqual(LIVE_SOUNDS.map((n) => `${n}.mp3`).sort());
    // sha256 of each file of .claude/orbes-run/sound/final/ as chosen (welcome.mp3: WARM, tightened; N6).
    const SHA256: Record<LiveSoundName, string> = {
      'after-room': '297556383e9dffb4bbdebe3789a15b0a4433008f23bd374459edab622b6f43c5',
      confirmed: '75429e8be714dd8e14c129d3aa02f1de88c0afe9ec8b0f16de4666bc7d8c80b6',
      draw: '0e077b02a5c8d16b74f956089db4c8cf309eca5fe055eb7d7e5f2366b9731982',
      hold: 'f266f2ef5f05b6049bd7ced13a15d2163e4542c0cacac9b9c1c4e5a0a1db926b',
      opening: 'ba78e4c226893f40ff1f4a59c862eaf5ed7bbda7d86d56c78bc126dc461e017d',
      place: '823190eb703e977edd25fdb752cc909f7e38e731b4b3d33739f0fb964e45e600',
      'room-tick': '86ed16aa33379cd21864fdf23eb11defebc5d700dfca1ad8c380f9c4bba187f1',
      secured: 'b7386ddb515dbd3e04d0f961ece27376173239e717fde3edffe4bfb3f9ed4300',
      'sold-out': '7cfeb65cf8a519c764b7a864a4f39ec494a6c4c465c2ead3d40f06ccf04f1767',
      turn: '5de32883c7c6514f02087b73eca164e36ad7c191f0839ab61355b3b1209c7010',
      welcome: '36c954837c7d081dd0ce9a55557369c62aa405e89ada26f664601233ed124c95',
    };
    for (const name of LIVE_SOUNDS) {
      const bytes = readFileSync(join(SOUNDS_DIR, `${name}.mp3`));
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(SHA256[name]);
      expect(bytes.subarray(0, 3).toString('latin1'), name).toBe('ID3');
      expect(soundName(LIVE_SOUND_FILES[name]), name).toBe(name);
    }
  });

  it('plays each passage\'s sounds at the offsets of the mockup\'s SFX_AT, each from its own passage\'s start, through a gain of 0.9', () => {
    expect(LIVE_GAIN).toBe(0.9);
    expect(SFX_AT).toEqual({
      tick: [['room-tick', 0]],
      draw: [['draw', 0.85]],
      open: [
        ['opening', 0.4],
        ['welcome', 3.0],
      ],
      welcome: [['welcome', 0]],
      place: [['place', 0]],
      turn: [['turn', 0.3]],
      hold: [['hold', 0]],
      secured: [['secured', 0.6]],
      sold: [['sold-out', 0.25]],
      confirmed: [['confirmed', 0.6]],
      after: [['after-room', 1.15]],
    });
    // Every LIVE file has its passage (the welcome THE OPENING's).
    expect(new Set(Object.values(SFX_AT).flatMap((cues) => cues.map(([name]) => name)))).toEqual(new Set(LIVE_SOUNDS));
  });

  it('makes its context in the room\'s gesture, the session ambient first, then loads every file once, off the gesture\'s task', async () => {
    const { env, log, contexts, loads, timers, session, settle } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    // Nothing before a gesture: no context, no file, no sound.
    expect(sound.play('room-tick')).toBe(false);
    expect(contexts).toHaveLength(0);
    sound.prime();
    expect(session?.type).toBe('ambient');
    expect(log).toEqual(['context (session ambient)']);
    // The loads wait for the gesture's task to end (a timer of 0 ms each).
    await settle();
    expect(loads).toEqual([]);
    expect(timers.filter((t) => t.ms === 0)).toHaveLength(11);
    for (const t of timers) t.fn();
    await settle();
    expect(loads.map(soundName)).toEqual([...LIVE_SOUNDS]);
    expect(contexts[0]!.decoded.map(soundName)).toEqual([...LIVE_SOUNDS]);
    // A later gesture neither makes another context nor loads again.
    sound.prime();
    for (const t of timers) t.fn();
    await settle();
    expect(contexts).toHaveLength(1);
    expect(loads).toHaveLength(11);
  });

  it('schedules a cue on the context\'s clock from its passage\'s start: SECURED 0.6 s in, the tick at once, a late start counted', async () => {
    const { env, contexts, timers, advance } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    const ctx = contexts[0]!;
    sound.cue('secured');
    expect(ctx.played).toHaveLength(1);
    expect(ctx.played[0]).toMatchObject({ gain: 0.9, toDestination: true, start: 5.6, stopped: false });
    expect(soundName(ctx.played[0]!.buffer!.url)).toBe('secured');
    // A passage that began 200 ms ago: its sound at 0.3 s starts 0.1 s from now.
    const base = env.now() - 200;
    sound.cue('turn', { base });
    expect(ctx.played[1]!.start).toBeCloseTo(5.1, 6);
    sound.cue('tick');
    expect(ctx.played[2]).toMatchObject({ start: 5, gain: 0.9 });
    expect(soundName(ctx.played[2]!.buffer!.url)).toBe('room-tick');
  });

  it('waits for a file still loading and plays it at its time, or not at all once more than half a second late', async () => {
    const { env, contexts, timers, advance } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    const ctx = contexts[0]!;
    // Asked for before its file is loaded: it waits for it.
    expect(sound.play('turn', 0.3)).toBe(true);
    expect(ctx.played).toHaveLength(0);
    for (const t of timers.splice(0)) t.fn();
    await advance(100);
    expect(ctx.played).toHaveLength(1);
    expect(ctx.played[0]!.start).toBeCloseTo(5.1 + 0.2, 6);
    // A tick asked for 0.6 s before its file came: not heard.
    const second = liveEnvironment();
    const late = new LiveSound(switchOn(second.env.storage), second.env);
    late.prime();
    expect(late.play('room-tick')).toBe(true);
    await second.advance(LATE_S * 1000 + 100);
    for (const t of second.timers.filter((t) => t.ms === 0)) t.fn();
    await second.settle();
    expect(second.contexts[0]!.played).toHaveLength(0);
  });

  it('stops what sounds or waits to sound at a screen change (stopAll), then suspends the context once nothing is left', async () => {
    const { env, contexts, timers, advance } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    const ctx = contexts[0]!;
    sound.cue('sold');
    expect(ctx.played).toHaveLength(1);
    sound.stopAll();
    expect(ctx.played[0]!.stopped).toBe(true);
    await advance(REST_MARGIN_MS);
    expect(ctx.state).toBe('suspended');
    // A cue waiting for its file when the screen changes never starts.
    const other = liveEnvironment();
    const waiting = new LiveSound(switchOn(other.env.storage), other.env);
    waiting.prime();
    waiting.cue('confirmed');
    waiting.stopAll();
    for (const t of other.timers.filter((t) => t.ms === 0)) t.fn();
    await other.settle();
    expect(other.contexts[0]!.played).toHaveLength(0);
  });

  it('keeps the context running while a sound plays and suspends it after, resumed by the next sound', async () => {
    const { env, contexts, timers, advance } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    const ctx = contexts[0]!;
    sound.cue('turn');
    // turn.mp3 lasts a second here, from 0.3 s: running at 1.5 s, suspended by 1.3 s + the margin.
    await advance(1_500);
    expect(ctx.state).toBe('running');
    await advance(REST_MARGIN_MS);
    expect(ctx.state).toBe('suspended');
    sound.cue('tick');
    expect(ctx.state).toBe('running');
    expect(ctx.resumes).toBeGreaterThan(0);
  });

  it('keeps the context running through the ten ticks of the last ten seconds, a second apart, and suspends it once after the last', async () => {
    const { env, contexts, timers, advance } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    const ctx = contexts[0]!;
    const resumesBefore = ctx.resumes;
    // Each figure change a second apart: the context never rests between two, so each tick starts on its change.
    for (let i = 0; i < 10; i++) {
      sound.cue('tick');
      expect(ctx.state).toBe('running');
      expect(ctx.played.at(-1)!.start).toBeCloseTo(ctx.currentTime, 6);
      await advance(1_000);
    }
    expect(ctx.played).toHaveLength(10);
    expect(ctx.suspends).toBe(0);
    expect(ctx.resumes).toBe(resumesBefore);
    expect(0.522 * 1000 + REST_MARGIN_MS).toBeGreaterThan(1_000);
    // After the last: suspended once, the margin after its end.
    await advance(0.522 * 1000 + REST_MARGIN_MS);
    expect(ctx.state).toBe('suspended');
    expect(ctx.suspends).toBe(1);
  });

  it('never holds a sound scheduled while a suspend is still settling: it asks the context to resume at once', async () => {
    const { env, contexts, timers, advance } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    const ctx = contexts[0]!;
    // A browser's suspend() and resume() change the state later, in the order asked (Web Audio's control messages).
    const asked: string[] = [];
    ctx.suspend = () => {
      ctx.suspends++;
      asked.push('suspended');
      return Promise.resolve();
    };
    ctx.resume = () => {
      ctx.resumes++;
      asked.push('running');
      return Promise.resolve();
    };
    const settleState = () => {
      for (const state of asked.splice(0)) ctx.state = state;
    };
    sound.cue('place');
    // place.mp3 (a second here) has ended and the margin passed: the suspend is asked, the state still 'running'.
    await advance(1_000 + REST_MARGIN_MS);
    expect(ctx.suspends).toBe(1);
    expect(ctx.state).toBe('running');
    const resumesBefore = ctx.resumes;
    // The next tick in that window: a resume is asked after the suspend, so the context runs on and the tick sounds.
    sound.cue('tick');
    expect(ctx.resumes).toBe(resumesBefore + 1);
    settleState();
    expect(ctx.state).toBe('running');
    expect(ctx.played).toHaveLength(2);
    // Its own rest comes once the tick has ended: one suspend more, not before.
    await advance(0.522 * 1000 + REST_MARGIN_MS - 1);
    expect(ctx.suspends).toBe(1);
    await advance(1);
    expect(ctx.suspends).toBe(2);
    settleState();
    expect(ctx.state).toBe('suspended');
  });

  it('follows the device\'s SOUND preference with the scan\'s chord: off, nothing is made, loaded or heard; off in the room stops what plays', async () => {
    const storage = new MemoryStorage();
    setSoundPref(false, storage);
    const off = liveEnvironment({ storage });
    const silent = new LiveSound(switchOn(storage), off.env);
    expect(silent.on).toBe(false);
    silent.prime();
    silent.cue('turn');
    await off.advance(0);
    expect(off.contexts).toHaveLength(0);
    expect(off.loads).toEqual([]);
    // SOUND ON in the room's foot (a tap): kept on the device, and the context made in that tap.
    silent.set(true);
    expect(storage.items.has(SOUND_PREF_KEY)).toBe(false);
    expect(off.contexts).toHaveLength(1);
    for (const t of off.timers.splice(0)) t.fn();
    await off.advance(0);
    silent.cue('after');
    expect(off.contexts[0]!.played).toHaveLength(1);
    // SOUND OFF: kept, what plays stops, the context released; nothing more is heard.
    silent.set(false);
    expect(storage.items.get(SOUND_PREF_KEY)).toBe(SOUND_OFF);
    expect(off.contexts[0]!.played[0]!.stopped).toBe(true);
    expect(off.contexts[0]!.state).toBe('suspended');
    expect(silent.play('room-tick')).toBe(false);
    // The scan's chord and the room read one switch: off there is off here.
    const shared = new MemoryStorage();
    const signature = switchOn(shared);
    const live = new LiveSound(signature, liveEnvironment({ storage: shared }).env);
    signature.set(false);
    expect(live.on).toBe(false);
  });

  it('plays nothing while the page is in the background', async () => {
    const { env, contexts, timers, advance, setHidden } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    setHidden(true);
    expect(sound.play('turn')).toBe(false);
    setHidden(false);
    expect(sound.play('turn')).toBe(true);
    expect(contexts[0]!.played).toHaveLength(1);
  });

  it('says the welcome once per entry, 3 s into THE OPENING (a late comer\'s at its first reading), never in the after-room: remembered on the device, the last twenty', async () => {
    const { env, contexts, timers, advance, storage } = liveEnvironment();
    const sound = new LiveSound(switchOn(env.storage), env);
    sound.prime();
    for (const t of timers.splice(0)) t.fn();
    await advance(0);
    const ctx = contexts[0]!;
    const names = () => ctx.played.map((p) => soundName(p.buffer!.url));
    sound.cue('open', { entryId: 'e-1' });
    expect(names()).toEqual(['opening', 'welcome']);
    expect(ctx.played.map((p) => p.start)).toEqual([5.4, 8]);
    expect((storage as MemoryStorage).items.get(WELCOME_KEY)).toBe('e-1');
    expect(welcomed('e-1', storage)).toBe(true);
    // The same entry again (a reload, a second opening): the opening only.
    sound.cue('open', { entryId: 'e-1' });
    expect(names()).toEqual(['opening', 'welcome', 'opening']);
    // The after-room, or no entry: never.
    sound.cue('open', { entryId: 'e-2', afterRoom: true });
    sound.cue('open', {});
    expect(names().filter((n) => n === 'welcome')).toHaveLength(1);
    expect(welcomed('e-2', storage)).toBe(false);
    // A late comer's first reading of its place (no opening passage): the voice at once, once; never in the after-room.
    const before = ctx.played.length;
    sound.cue('welcome', { entryId: 'e-4' });
    sound.cue('welcome', { entryId: 'e-4' });
    sound.cue('welcome', { entryId: 'e-5', afterRoom: true });
    expect(names().slice(before)).toEqual(['welcome']);
    expect(welcomed('e-4', storage)).toBe(true);
    expect(welcomed('e-5', storage)).toBe(false);
    // Not heard (the sound off): not remembered.
    const quiet = new MemoryStorage();
    setSoundPref(false, quiet);
    new LiveSound(switchOn(quiet), liveEnvironment({ storage: quiet }).env).cue('open', { entryId: 'e-3' });
    expect(quiet.items.has(WELCOME_KEY)).toBe(false);
    // The memory keeps the last twenty entries, the newest last.
    for (let i = 0; i < WELCOME_KEEP + 5; i++) rememberWelcome(`x-${i}`, storage);
    const kept = (storage as MemoryStorage).items.get(WELCOME_KEY)!.split(' ');
    expect(kept).toHaveLength(WELCOME_KEEP);
    expect(kept.at(-1)).toBe(`x-${WELCOME_KEEP + 4}`);
    expect(welcomed('e-1', storage)).toBe(false);
    expect(WELCOME_KEY).toBe('orbes.live.welcome');
  });

  it('never breaks the page: no Web Audio, a refusing session or storage, a file that fails, a decode or a source that throws', async () => {
    // No Web Audio: nothing created, nothing loaded, nothing thrown.
    const none = liveEnvironment({ webAudio: false });
    const noAudio = new LiveSound(switchOn(none.env.storage), none.env);
    expect(() => noAudio.prime()).not.toThrow();
    expect(noAudio.play('turn')).toBe(false);
    expect(none.loads).toEqual([]);
    // A session that throws, a storage that refuses: the sounds still play, the welcome too, each time.
    const throwing = { get type() { return 'auto'; }, set type(_v: string) { throw new Error('NotAllowedError'); } };
    const refusing = liveEnvironment({ session: throwing, storage: REFUSING });
    const sound = new LiveSound(switchOn(null), refusing.env);
    expect(() => sound.prime()).not.toThrow();
    for (const t of refusing.timers.splice(0)) t.fn();
    await refusing.advance(0);
    expect(() => sound.cue('open', { entryId: 'e-1' })).not.toThrow();
    expect(refusing.contexts[0]!.played).toHaveLength(2);
    // A file that fails to load is not heard, and is tried again at the next gesture.
    let fail = true;
    const flaky = liveEnvironment({ load: (url) => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer)) });
    const retry = new LiveSound(switchOn(flaky.env.storage), flaky.env);
    retry.prime();
    for (const t of flaky.timers.splice(0)) t.fn();
    await flaky.advance(0);
    expect(retry.play('turn')).toBe(false);
    fail = false;
    retry.prime();
    for (const t of flaky.timers.splice(0)) t.fn();
    await flaky.advance(0);
    expect(retry.play('turn')).toBe(true);
    expect(flaky.contexts[0]!.played).toHaveLength(1);
    // A decode or a source that throws: nothing heard, nothing thrown.
    const broken = liveEnvironment();
    const b = new LiveSound(switchOn(broken.env.storage), broken.env);
    b.prime();
    broken.contexts[0]!.failDecode = true;
    for (const t of broken.timers.splice(0)) t.fn();
    await broken.advance(0);
    expect(b.play('turn')).toBe(false);
    const sourceFails = liveEnvironment();
    const c = new LiveSound(switchOn(sourceFails.env.storage), sourceFails.env);
    c.prime();
    for (const t of sourceFails.timers.splice(0)) t.fn();
    await sourceFails.advance(0);
    sourceFails.contexts[0]!.failSource = true;
    expect(() => c.cue('secured')).not.toThrow();
    expect(() => c.stopAll()).not.toThrow();
  });

  it('replaces the room\'s two synthesized sounds: the last ten seconds\' tick and SECURED\'s chord; a screen change stops the sounds; the scan keeps its chord (N12)', () => {
    const view = readFileSync(LIVE_VIEW, 'utf8');
    // Lot Q1 §3.4: each change of the last ten seconds' figures (its 00:00 only after the countdown was seen counting).
    expect(view).toContain("if (tick !== null && tick !== this.lastTick && this.synced && (tick > 0 || counted)) this.deps.sound.cue('tick');");
    // The draw 0.85 s after 00:00, THE OPENING's sounds from its start, a late comer's welcome at its first reading.
    expect(view).toContain("this.deps.sound.cue('draw', { base: this.drawAt });");
    expect(view).toContain("this.deps.sound.cue('open', { entryId: this.entry?.id ?? null, afterRoom: !!this.afterRoomOf() });");
    expect(view).toContain("this.deps.sound.cue('welcome', { entryId: e.id, afterRoom: !!this.afterRoomOf() });");
    expect(view).toContain("this.deps.sound.cue('secured');");
    // Lot Q1 §3.5: the turn as it arrives (0.3 s into its passage), hold.mp3 with the press itself (the ring's fill).
    expect(view).toContain("if (kind === 'turn' && previous !== undefined && previous !== 'turn') this.deps.sound.cue('turn');");
    expect(view).toMatch(/this\.deps\.sound\.prime\(\);\n\s*this\.deps\.sound\.cue\('hold'\);/);
    expect(view).toContain('if (previous !== kind) this.deps.sound.stopAll();');
    expect(view).not.toMatch(/sound\.(tick|play)\(/);
    expect(view).not.toMatch(/SoundSignature/);
    // The scan result's chord stays (sound.ts), its tick gone.
    const signature = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/verify/sound.ts'), 'utf8');
    expect(signature).toContain('export function scheduleSignature(');
    expect(signature).not.toMatch(/scheduleTick|TICK/);
    // Vibration as before (turn and SECURED).
    expect(view).toContain('navigator.vibrate?.(12);');
    expect(view).toContain('navigator.vibrate?.([...CEREMONY_VIBRATION]);');
  });
});

describe('a computer\'s sound (desktop, BRIEF §5.10; decision D6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The page's own environment on `name` at `width` px, its preference kept in `storage`. */
  const onDevice = (name: string, width: number, storage: PrefStorage) => {
    installDevice(at(name, width));
    return { ...browserSoundEnvironment(), storage };
  };

  it('starts off on a computer with nothing kept, whatever its window\'s width, and on on a phone or a tablet', () => {
    for (const [name, width, on] of [
      ['a Mac', 1440, false],
      ['a Mac', 900, false],
      ['a Windows computer with a mouse', 683, false],
      ['a Windows laptop with a touch screen and a trackpad', 1920, false],
      ['an iPhone', 390, true],
      ['an iPad with its trackpad (Safari, as a Mac)', 1366, true],
      ['an Android tablet with a trackpad cover (a fine pointer)', 1280, true],
    ] as const) {
      const env = onDevice(name, width, new MemoryStorage());
      expect(env.defaultOn!(), `${name} at ${width}`).toBe(on);
      expect(new SoundSignature(env).on, `${name} at ${width}`).toBe(on);
    }
  });

  it('keeps SOUND ON as on on a computer, and SOUND OFF as off', () => {
    const storage = new MemoryStorage();
    const sound = new SoundSignature(onDevice('a Mac', 1440, storage));
    sound.set(true);
    expect(storage.items.get(SOUND_PREF_KEY)).toBe('on');
    expect(new SoundSignature(onDevice('a Mac', 1440, storage)).on).toBe(true);
    sound.set(false);
    expect(storage.items.get(SOUND_PREF_KEY)).toBe(SOUND_OFF);
    expect(new SoundSignature(onDevice('a Mac', 1440, storage)).on).toBe(false);
  });

  it('keeps SOUND ON pressed in a narrow window: a wide window of the same computer starts with the sound on', () => {
    const storage = new MemoryStorage();
    const narrow = new SoundSignature(onDevice('a Mac', 900, storage));
    expect(narrow.on).toBe(false);
    narrow.set(true);
    // Once the key was removed here (the narrow window took a phone's default, on), and a wide window started off again.
    expect(storage.items.get(SOUND_PREF_KEY)).toBe('on');
    expect(new SoundSignature(onDevice('a Mac', 1440, storage)).on).toBe(true);
    expect(new SoundSignature(onDevice('a Mac', 900, storage)).on).toBe(true);
  });

  it('keeps a phone as production has it: off stored, on removes the key', () => {
    const storage = new MemoryStorage();
    const sound = new SoundSignature(onDevice('an iPhone', 390, storage));
    expect(sound.on).toBe(true);
    sound.set(false);
    expect(storage.items.get(SOUND_PREF_KEY)).toBe(SOUND_OFF);
    sound.set(true);
    expect(storage.items.has(SOUND_PREF_KEY)).toBe(false);
  });
});
