/**
 * The sound signature (P-D07, src/web/verify/sound.ts) and the preference
 * kept on the device (src/web/shared/prefs.ts): the chord scheduled on a
 * recording AudioContext, when it plays (an AUTHENTIC_* result, after the
 * gesture that created the context, the page in view, the sound on), the
 * ambient audio session set before the context exists, the context suspended
 * between chords, and a storage that refuses every access. The landing's
 * SOUND ON / OFF and the chord in a real page are checked in Chromium by
 * verify.e2e.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceStorage, readPref, setSoundPref, SOUND_OFF, SOUND_PREF_KEY, soundPref, writePref, type PrefStorage } from '../../src/web/shared/prefs.js';
import { SOUND } from '../../src/web/verify/copy.js';
import { scheduleSignature, SIGNATURE, SoundSignature, SUSPEND_AFTER_MS, type SoundContext, type SoundEnvironment, type SoundNode, type SoundParam } from '../../src/web/verify/sound.js';
import { VERIFICATION_STATES } from '../../src/web/verify/types.js';

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
