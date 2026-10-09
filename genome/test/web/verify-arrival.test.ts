/**
 * The page load's arrival in the collector app (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.9 and A.15
 * « test/web/verify-arrival.test.ts », step 4.7; src/web/verify/arrival.ts, SeenQueue.arrive in seen-model.ts,
 * SeenRecorder.arrive in seen.ts). vitest's node environment, no DOM: readArrival and sendArrival take location,
 * document, storage, history and the timers as parameters, so plain stubs stand in for them.
 *
 *  - readArrival: `o` and the five `utm_` tags read, then exactly those six taken out of the address with
 *    history.replaceState (the other parameters byte for byte and the fragment kept, `/verify/c#…` untouched, nothing
 *    rewritten when none is there); every value the server would drop left out; the referrer once per tab (the flag
 *    sessionStorage['orbes.arrived']), every load without storage or with a throwing one, never this app's own address;
 *  - sendArrival: after the first screen (requestIdleCallback, else a 1.5 s timer), a prerendered page waiting for
 *    `prerenderingchange`, handed over once, every error swallowed;
 *  - SeenQueue.arrive: the first batch carries it, alone with `e: []` when no view has finished, with the views waiting
 *    otherwise; one per page load (never on an in-app move); a 429 keeps it, a 400 drops it; never during a LIVE room but
 *    on a hide or a close; every batch one the server's schema takes, the arrival's fields kept by arrivalShape;
 *  - the recorder does nothing with it outside a browser (off: nothing sent).
 */
import { describe, expect, it } from 'vitest';
import { seenBody } from '../../src/server/http/schemas.js';
import { ARRIVAL_DELAY_MS, ARRIVED_KEY, readArrival, sendArrival, type ArrivalEnv, type ArrivalHistory, type ArrivalLocation, type ArrivalStorage } from '../../src/web/verify/arrival.js';
import { ApiClient } from '../../src/web/verify/api.js';
import { SeenQueue, type FinishedView, type SeenArrival, type SeenBatchBody, type SeenSendResult } from '../../src/web/verify/seen-model.js';
import { seen } from '../../src/web/verify/seen.js';

const HOST = 'verify.theorbes.com';

function at(address: string): ArrivalLocation {
  const u = new URL(address, `https://${HOST}`);
  return { pathname: u.pathname, search: u.search, hash: u.hash, host: u.host };
}

function memory(): ArrivalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function historySpy(state: unknown = { depth: 0 }): ArrivalHistory & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { state, calls, replaceState: (...args: unknown[]) => void calls.push(args) };
}

const doc = (referrer = '') => ({ referrer });

describe('readArrival (plan CUSTOMER INTELLIGENCE §3.4 A.9)', () => {
  it('reads o and the five utm_ tags, then takes exactly those six out of the address, the other parameters and the fragment kept', () => {
    const h = historySpy({ screen: 'release', depth: 1 });
    const r = readArrival(
      at('/verify/releases/7c21?ref=a%20b&o=Instagram-Bio&utm_source=ig&utm_medium=social&utm_campaign=drop-14&utm_content=story-2&utm_term=ring&x=1+2#top'),
      doc(),
      memory(),
      h,
    );
    expect(r.arrival).toEqual({
      path: '/verify/releases/7c21',
      link: 'instagram-bio',
      utm: { source: 'ig', medium: 'social', campaign: 'drop-14', content: 'story-2', term: 'ring' },
    });
    // Byte for byte: `a%20b` and `1+2` are not re-encoded.
    expect(r.address).toBe('/verify/releases/7c21?ref=a%20b&x=1+2#top');
    expect(h.calls).toEqual([[{ screen: 'release', depth: 1 }, '', '/verify/releases/7c21?ref=a%20b&x=1+2#top']]);
  });

  it('rewrites nothing when none of the six is there: a certificate\'s fragment and a board\'s secret are never touched', () => {
    for (const address of ['/verify/c#k=0123456789abcdef', '/verify/board#s=secret', '/verify?lang=en', '/verify']) {
      const h = historySpy();
      const r = readArrival(at(address), doc(), memory(), h);
      expect(r.address, address).toBe(address);
      expect(h.calls, address).toEqual([]);
      expect(r.arrival.link).toBeUndefined();
      expect(r.arrival.utm).toBeUndefined();
    }
  });

  it('takes the six out even when their values are junk, and leaves out what the server would drop', () => {
    const h = historySpy();
    const long = 'x'.repeat(101);
    const r = readArrival(at(`/verify?o=ab&utm_source=%20%20&utm_medium=${long}&utm_campaign=dr%07op&utm_content=&utm_term`), doc(), memory(), h);
    expect(r.arrival).toEqual({ path: '/verify' });
    expect(r.address).toBe('/verify');
    expect(h.calls).toHaveLength(1);
    for (const code of ['x'.repeat(33), '<script>', 'a_b', '']) expect(readArrival(at(`/verify?o=${encodeURIComponent(code)}`), doc(), memory(), historySpy()).arrival.link, code).toBeUndefined();
    // Trimmed, kept as typed (the server lower-cases tags); the first of two values; a malformed escape is skipped.
    const t = readArrival(at('/verify?utm_source=%20Instagram%20&utm_source=tiktok&utm_campaign=%E0%A4%A&utm_campaign=ok&o=%20LEA-tiktok%20'), doc(), memory(), historySpy());
    expect(t.arrival.utm).toEqual({ source: 'Instagram', campaign: 'ok' });
    expect(t.arrival.link).toBe('lea-tiktok');
    expect(t.address).toBe('/verify');
    // A path that is not the app's is left out.
    expect(readArrival(at('/elsewhere?o=abc'), doc(), memory(), historySpy()).arrival).toEqual({ link: 'abc' });
    expect(readArrival(at(`/verify/${'p'.repeat(201)}`), doc(), memory(), historySpy()).arrival.path).toBeUndefined();
  });

  it('sends the referring page on the tab\'s first load only, never this app\'s own address nor what the server would drop', () => {
    const s = memory();
    expect(readArrival(at('/verify'), doc('https://www.instagram.com/p/xyz?igsh=1'), s, historySpy()).arrival.referrer).toBe('https://www.instagram.com/p/xyz?igsh=1');
    expect(s.map.get(ARRIVED_KEY)).toBe('1');
    // A reload, or a later page load in the same tab: the flag holds.
    expect(readArrival(at('/verify'), doc('https://www.instagram.com/'), s, historySpy()).arrival.referrer).toBeUndefined();
    // A new tab: its own storage.
    expect(readArrival(at('/verify'), doc('android-app://com.instagram.android/'), memory(), historySpy()).arrival.referrer).toBe('android-app://com.instagram.android/');
    for (const ref of [`https://${HOST}/verify/lookbook`, `https://${HOST.toUpperCase()}/verify`, 'ftp://files.example.com/', 'javascript:alert(1)', 'not a url', `https://example.com/${'x'.repeat(500)}`, '']) {
      expect(readArrival(at('/verify'), doc(ref), memory(), historySpy()).arrival.referrer, ref).toBeUndefined();
    }
    // theorbes.com is another site.
    expect(readArrival(at('/verify'), doc('https://theorbes.com/'), memory(), historySpy()).arrival.referrer).toBe('https://theorbes.com/');
  });

  it('sends the referrer each load where the tab has no storage, or one that throws, and never throws itself', () => {
    expect(readArrival(at('/verify'), doc('https://google.com/'), null, historySpy()).arrival.referrer).toBe('https://google.com/');
    const reading: ArrivalStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    for (let i = 0; i < 2; i++) expect(readArrival(at('/verify'), doc('https://google.com/'), reading, historySpy()).arrival.referrer).toBe('https://google.com/');
    // Read, but the flag cannot be written (a full quota): sent again next load.
    const full: ArrivalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    for (let i = 0; i < 2; i++) expect(readArrival(at('/verify'), doc('https://google.com/'), full, historySpy()).arrival.referrer).toBe('https://google.com/');
    // The address cannot be rewritten: the arrival is still read.
    const refusing: ArrivalHistory = {
      state: null,
      replaceState: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readArrival(at('/verify?o=instagram-bio'), doc(), memory(), refusing).arrival).toEqual({ path: '/verify', link: 'instagram-bio' });
    // A location that throws on read gives an empty arrival.
    const broken = {
      get pathname(): string {
        throw new Error('cross-origin');
      },
      search: '',
      hash: '',
      host: HOST,
    };
    expect(readArrival(broken, doc(), memory(), historySpy())).toEqual({ arrival: {}, address: '' });
  });

  it('builds an arrival the server takes as it is, within 2 KB, and alone with no view', () => {
    const r = readArrival(
      at(`/verify/lookbook/monolithe?o=lea-tiktok&utm_source=${'s'.repeat(100)}&utm_medium=${'m'.repeat(100)}&utm_campaign=${'c'.repeat(100)}&utm_content=${'t'.repeat(100)}&utm_term=${'r'.repeat(100)}`),
      doc(`https://example.com/${'x'.repeat(470)}`),
      memory(),
      historySpy(),
    );
    const body = { v: 1, d: { s: false, t: 5, w: 390 }, a: r.arrival, e: [] };
    expect(JSON.stringify(r.arrival).length).toBeLessThanOrEqual(2_048);
    const parsed = seenBody.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.a).toEqual(r.arrival);
  });
});

describe('sendArrival (plan CUSTOMER INTELLIGENCE §3.4 A.9)', () => {
  const A: SeenArrival = { path: '/verify', link: 'instagram-bio' };

  function env(o: { idle?: boolean; prerendering?: boolean } = {}) {
    const idle: { cb: () => void; opts?: { timeout: number } }[] = [];
    const timers: { cb: () => void; ms: number }[] = [];
    const listeners: { type: string; fn: () => void; once?: boolean }[] = [];
    const e: ArrivalEnv = {
      document: { prerendering: o.prerendering, addEventListener: (type, fn, opts) => void listeners.push({ type, fn, once: opts?.once }) },
      requestIdleCallback: o.idle === false ? undefined : (cb, opts) => void idle.push({ cb, opts }),
      setTimeout: (cb, ms) => void timers.push({ cb, ms }),
    };
    return { e, idle, timers, listeners };
  }

  it('hands the arrival over once the page is idle after its first screen, never at once', () => {
    const got: SeenArrival[] = [];
    const x = env();
    sendArrival({ arrive: (a) => void got.push(a) }, A, x.e);
    expect(got).toEqual([]);
    expect(x.idle).toHaveLength(1);
    expect(x.idle[0]!.opts).toEqual({ timeout: ARRIVAL_DELAY_MS });
    x.idle[0]!.cb();
    x.idle[0]!.cb();
    expect(got).toEqual([A]);
  });

  it('waits 1.5 s where the browser has no requestIdleCallback', () => {
    const got: SeenArrival[] = [];
    const x = env({ idle: false });
    sendArrival({ arrive: (a) => void got.push(a) }, A, x.e);
    expect(x.timers.map((t) => t.ms)).toEqual([1_500]);
    x.timers[0]!.cb();
    expect(got).toEqual([A]);
  });

  it('waits until a prerendered page is shown', () => {
    const got: SeenArrival[] = [];
    const x = env({ prerendering: true });
    sendArrival({ arrive: (a) => void got.push(a) }, A, x.e);
    expect(x.idle).toEqual([]);
    expect(x.listeners.map((l) => [l.type, l.once])).toEqual([['prerenderingchange', true]]);
    x.listeners[0]!.fn();
    expect(x.idle).toHaveLength(1);
    x.idle[0]!.cb();
    expect(got).toEqual([A]);
  });

  it('swallows every error: a target that throws, timers that throw', () => {
    const x = env();
    expect(() => sendArrival({ arrive: () => { throw new Error('boom'); } }, A, x.e)).not.toThrow();
    expect(() => x.idle[0]!.cb()).not.toThrow();
    const got: SeenArrival[] = [];
    // No idle, no timer: handed over at once rather than lost.
    const throwing: ArrivalEnv = {
      document: { addEventListener: () => {} },
      requestIdleCallback: () => {
        throw new Error('no');
      },
      setTimeout: () => {
        throw new Error('no');
      },
    };
    expect(() => sendArrival({ arrive: (a) => void got.push(a) }, A, throwing)).not.toThrow();
    expect(got).toEqual([A]);
    const deaf: ArrivalEnv = {
      document: {
        prerendering: true,
        addEventListener: () => {
          throw new Error('no');
        },
      },
      setTimeout: () => {},
    };
    expect(() => sendArrival({ arrive: () => {} }, A, deaf)).not.toThrow();
  });
});

describe('SeenQueue.arrive: the arrival in the page load\'s first batch (plan CUSTOMER INTELLIGENCE §3.3 T.9, §3.4 A.9)', () => {
  const DEVICE = { s: false, t: 5, w: 390 };
  const A: SeenArrival = { path: '/verify/releases/7c21', link: 'instagram-bio', referrer: 'https://www.instagram.com/' };
  const view = (page: FinishedView['page'], began: number, ms = 4_000, subject: string | null = null): FinishedView => ({ page, subject, ms, began });

  function queue(answers: SeenSendResult[] = []) {
    const sent: SeenBatchBody[] = [];
    const q = new SeenQueue({
      device: DEVICE,
      random: () => 0,
      send: async (b) => {
        sent.push(JSON.parse(JSON.stringify(b)) as SeenBatchBody);
        return answers.shift() ?? 'sent';
      },
    });
    return { q, sent };
  }

  it('sends it at the next turn, alone with e: [] when no view has finished, once per page load', async () => {
    const { q, sent } = queue();
    q.arrive(A, 1_000);
    expect(q.arriving).toBe(true);
    expect(q.dueAt).toBe(1_000);
    await q.tick(1_000, { page: 'RELEASE', subject: '7c21' });
    expect(sent).toEqual([{ v: 1, d: DEVICE, a: A, e: [] }]);
    expect(seenBody.safeParse(sent[0]).success).toBe(true);
    expect(q.arriving).toBe(false);
    expect(q.dueAt).toBeNull();
    // An in-app move, a second call: nothing more.
    q.arrive({ path: '/verify/lookbook' }, 5_000);
    expect(q.dueAt).toBeNull();
    expect(await q.flush(6_000)).toBeUndefined();
    expect(sent).toHaveLength(1);
    // Views after it go without it.
    q.push(view('NOW', 6_000), 10_000);
    await q.flush(12_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.a).toBeUndefined();
    expect(sent[1]!.e.map((e) => e.p)).toEqual(['NOW']);
  });

  it('rides with the views already finished', async () => {
    const { q, sent } = queue();
    q.push(view('NOW', 0, 2_000), 2_000);
    q.arrive(A, 3_000);
    await q.tick(3_000, { page: 'COLLECTION' });
    expect(sent).toEqual([{ v: 1, d: DEVICE, a: A, e: [{ p: 'NOW', ms: 2_000, ago: 3_000 }] }]);
    expect(seenBody.safeParse(sent[0]).success).toBe(true);
  });

  it('keeps it through a refused send (429, no answer), drops it with a malformed batch (400)', async () => {
    const kept = queue(['retry', 'sent']);
    kept.q.arrive(A, 0);
    await kept.q.tick(0, { page: 'NOW' });
    expect(kept.q.arriving).toBe(true);
    expect(kept.q.dueAt).toBe(20_000);
    await kept.q.tick(20_000, { page: 'NOW' });
    expect(kept.sent.map((b) => b.a)).toEqual([A, A]);
    expect(kept.q.arriving).toBe(false);

    const dropped = queue(['drop']);
    dropped.q.arrive(A, 0);
    await dropped.q.tick(0, { page: 'NOW' });
    expect(dropped.q.arriving).toBe(false);
    expect(dropped.q.dueAt).toBeNull();
    await dropped.q.flush(1_000);
    expect(dropped.sent).toHaveLength(1);
  });

  it('waits while a LIVE room is in front, then goes at a hide or a close', async () => {
    const { q, sent } = queue();
    q.arrive(A, 0);
    expect(q.tick(0, { page: 'LIVE', subject: '7c21' })).toBeNull();
    expect(q.tick(60_000, { page: 'LIVE', subject: '7c21' })).toBeNull();
    expect(sent).toEqual([]);
    await q.flush(90_000);
    expect(sent).toEqual([{ v: 1, d: DEVICE, a: A, e: [] }]);
  });

  it('is one request per page load whatever the turns: the recorder\'s own sends never repeat it', async () => {
    const { q, sent } = queue();
    q.arrive(A, 0);
    await Promise.all([q.tick(0, { page: 'NOW' }), q.flush(0), q.flush(1)]);
    await q.flush(2);
    expect(sent.filter((b) => b.a !== undefined)).toHaveLength(1);
  });
});

describe('the recorder and the API with an arrival', () => {
  it('does nothing outside a browser: the recorder is off, nothing sent, nothing thrown', () => {
    expect(seen.on).toBe(false);
    expect(() => seen.arrive({ path: '/verify' })).not.toThrow();
  });

  it('posts the arrival as `a`, same origin, keepalive, without a CSRF token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = new ApiClient({
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    expect(await api.seen({ v: 1, d: { s: false, t: 5, w: 390 }, a: { path: '/verify', link: 'instagram-bio' }, e: [] })).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/v1/seen');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin' });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ v: 1, d: { s: false, t: 5, w: 390 }, a: { path: '/verify', link: 'instagram-bio' }, e: [] });
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>).map((k) => k.toLowerCase())).not.toContain('x-csrf-token');
  });
});
