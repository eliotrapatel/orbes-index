/**
 * The recording of what the collector looks at, in the app (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.9 and
 * T.14 « test/web/seen-model.test.ts », step 3.8; src/web/verify/seen-model.ts, ApiClient.seen, seen.ts), with a fake
 * clock and plain stubs (vitest's node environment, no DOM):
 *
 *  - pageOf for every screen (the board, the scan, VERIFYING…, a problem and the password screen: null), its subjects,
 *    MY PIECES' tabs, a LIVE RELEASE's page, room and after-room;
 *  - ViewClock: hidden pauses, 120 s idle pauses (not on LIVE nor RESULT), input and showing again resume, a claim
 *    pauses the view under it and gives the time back, the password screen records nothing, a claim not on the page
 *    yet does not pause, the caps, the 1 s floor, the cut at a hide;
 *  - SeenQueue: merging, the 30 s ± 10 s rhythm, flush on hide, nothing during a LIVE room until a hide, 100 kept
 *    offline, 429 kept, 400 dropped, 50 a batch, views older than 24 h never sent, every batch one the server's schema
 *    takes;
 *  - ApiClient.seen: a same-origin keepalive POST without a CSRF token, never thrown;
 *  - the app's page names are the server's VIEW_PAGES but SCAN; the recorder does nothing outside a browser.
 */
import { describe, expect, it } from 'vitest';
import { seenBody } from '../../src/server/http/schemas.js';
import { SEEN_PAGES } from '../../src/server/services/tracking.js';
import { ApiClient } from '../../src/web/verify/api.js';
import {
  accountPageOf,
  BATCH_MAX,
  IDLE_MS,
  pageOf,
  QUEUE_MAX,
  SEEN_PAGE_NAMES,
  SeenQueue,
  ViewClock,
  VIEW_MAX_MS,
  VIEW_MAX_MS_LIVE,
  type FinishedView,
  type SeenAppState,
  type SeenBatchBody,
  type SeenScreen,
  type SeenSendResult,
} from '../../src/web/verify/seen-model.js';
import { seen } from '../../src/web/verify/seen.js';

const STATE: SeenAppState = { piecesTab: 'pieces', pieceId: 'O26-J-00184', sheetSlug: 'monolithe', releaseId: 'r-1', releaseAfterRoom: false, liveRoom: false, postId: 'p-1' };

function clock() {
  const done: FinishedView[] = [];
  const c = new ViewClock((v) => done.push(v), 0);
  const views = () => done.map((v) => [v.page, v.subject, v.ms, v.began]);
  return { c, done, views };
}

describe('pageOf (plan CUSTOMER INTELLIGENCE §3.3 T.9)', () => {
  it('names the page and subject of every screen, and none for the screens never recorded', () => {
    const all: Record<SeenScreen, unknown> = {
      landing: { page: 'NOW' },
      scan: null,
      verifying: null,
      result: { page: 'RESULT' },
      message: null,
      pieces: { page: 'MY_PIECES' },
      piece: { page: 'PIECE', subject: 'O26-J-00184' },
      certificate: { page: 'CERTIFICATE' },
      lookbook: { page: 'COLLECTION' },
      sheet: { page: 'MODEL', subject: 'monolithe' },
      releases: { page: 'RELEASES' },
      release: { page: 'RELEASE', subject: 'r-1' },
      live: { page: 'RELEASE', subject: 'r-1' },
      board: null,
      circle: { page: 'CIRCLE' },
      circlePost: { page: 'POST', subject: 'p-1' },
      club: { page: 'CLUB' },
      how: { page: 'HOW' },
      wishlist: { page: 'WISHLIST' },
    };
    for (const [screen, view] of Object.entries(all)) expect(pageOf(screen as SeenScreen, STATE), screen).toEqual(view);
  });

  it('reads MY PIECES’ tab, a LIVE RELEASE’s room and its after-room', () => {
    expect(pageOf('pieces', { ...STATE, piecesTab: 'orders' })).toEqual({ page: 'MY_ORDERS' });
    expect(pageOf('pieces', { ...STATE, piecesTab: 'releases' })).toEqual({ page: 'MY_RELEASES' });
    expect(pageOf('live', { ...STATE, liveRoom: true })).toEqual({ page: 'LIVE', subject: 'r-1' });
    expect(pageOf('live', { ...STATE, liveRoom: true, releaseAfterRoom: true })).toEqual({ page: 'AFTER_ROOM', subject: 'r-1' });
  });

  it('names the account sheet’s views, the password screen never', () => {
    expect(['account', 'messages', 'sizes', 'addresses', 'profile', 'password'].map((v) => accountPageOf(v as Parameters<typeof accountPageOf>[0]))).toEqual([
      'ACCOUNT',
      'MESSAGES',
      'SIZES',
      'ADDRESSES',
      'PROFILE',
      null,
    ]);
  });

  it('names the pages the server takes: VIEW_PAGES but SCAN', () => {
    expect([...SEEN_PAGE_NAMES]).toEqual([...SEEN_PAGES]);
  });
});

describe('ViewClock', () => {
  it('counts a view in front until the next one, and drops one under 1 s', () => {
    const { c, views } = clock();
    c.show({ page: 'NOW' }, 0);
    c.input(3_000);
    c.show({ page: 'MODEL', subject: 'monolithe' }, 5_000);
    c.show({ page: 'MODEL', subject: 'monolithe-blue' }, 5_900); // a variant's dot after 0.9 s: not a view
    c.show(null, 9_000); // the scan: never recorded
    c.show({ page: 'RESULT' }, 20_000);
    c.show({ page: 'NOW' }, 21_500);
    expect(views()).toEqual([
      ['NOW', null, 5_000, 0],
      ['MODEL', 'monolithe-blue', 3_100, 5_900],
      ['RESULT', null, 1_500, 20_000],
    ]);
  });

  it('pauses while the page is hidden, and resumes when it shows again', () => {
    const { c, views } = clock();
    c.show({ page: 'NOW' }, 0);
    c.visibility(false, 2_000);
    c.visibility(true, 10_000);
    c.show({ page: 'CLUB' }, 13_000);
    expect(views()).toEqual([['NOW', null, 5_000, 0]]);
  });

  it('pauses after 120 s without input, but not on a LIVE room nor a scan’s result; an input resumes', () => {
    const { c, views } = clock();
    c.show({ page: 'NOW' }, 0);
    c.tick(300_000);
    c.show({ page: 'COLLECTION' }, 400_000);
    c.input(600_000); // 200 s after: counted only up to 120 s, then from the input
    c.show({ page: 'LIVE', subject: 'r-1' }, 610_000);
    c.show({ page: 'RESULT' }, 1_000_000);
    c.show({ page: 'NOW' }, 1_400_000);
    expect(views()).toEqual([
      ['NOW', null, IDLE_MS, 0],
      ['COLLECTION', null, IDLE_MS + 10_000, 400_000],
      ['LIVE', 'r-1', 390_000, 610_000],
      ['RESULT', null, 400_000, 1_000_000],
    ]);
  });

  it('lets the account sheet cover the page, its views one after another, then gives the time back to the page', () => {
    const { c, views } = clock();
    const sheet = {};
    let open = true;
    c.show({ page: 'NOW' }, 0);
    c.claim(sheet, 'ACCOUNT', () => open, 4_000);
    c.claim(sheet, 'ACCOUNT', () => open, 5_000); // drawn again: the same view
    c.claim(sheet, 'MESSAGES', () => open, 10_000);
    c.claim(sheet, null, () => open, 13_000); // CHANGE PASSWORD: the page paused, nothing recorded
    c.claim(sheet, 'SIZES', () => open, 20_000);
    c.release(sheet, 22_000);
    open = false;
    c.show({ page: 'COLLECTION' }, 29_000);
    expect(views()).toEqual([
      ['ACCOUNT', null, 6_000, 4_000],
      ['MESSAGES', null, 3_000, 10_000],
      ['SIZES', null, 2_000, 20_000],
      ['NOW', null, 11_000, 0],
    ]);
  });

  it('does not pause the page for a panel not on it yet; a panel gone with its screen is finished at the next', () => {
    const { c, views } = clock();
    const panel = {};
    let connected = false;
    c.show({ page: 'RELEASE', subject: 'r-1' }, 0);
    c.claim(panel, 'SIGN_IN', () => connected, 1_000);
    c.tick(4_000);
    connected = true;
    c.claim(panel, 'SIGN_UP', () => connected, 4_000); // CREATE ACCOUNT pressed
    c.tick(9_000);
    connected = false; // the page swapped away, the panel with it
    c.show({ page: 'NOW' }, 9_000);
    c.show({ page: 'CLUB' }, 12_000);
    expect(views()).toEqual([
      ['RELEASE', 'r-1', 4_000, 0],
      ['SIGN_UP', null, 5_000, 4_000],
      ['NOW', null, 3_000, 9_000],
    ]);
  });

  it('caps a view at 30 minutes, a LIVE room at 3 hours', () => {
    const { c, views } = clock();
    c.show({ page: 'NOW' }, 0);
    for (let t = 60_000; t <= 7_200_000; t += 60_000) c.input(t);
    c.show({ page: 'LIVE', subject: 'r-1' }, 7_200_000);
    c.show({ page: 'NOW' }, 7_200_000 + 4 * 3_600_000);
    expect(views()).toEqual([
      ['NOW', null, VIEW_MAX_MS, 0],
      ['LIVE', 'r-1', VIEW_MAX_MS_LIVE, 7_200_000],
    ]);
  });

  it('gives every view open at a hide as it stands, then counts it again from zero', () => {
    const { c, views } = clock();
    const sheet = {};
    c.show({ page: 'NOW' }, 0);
    c.claim(sheet, 'PROFILE', () => true, 3_000);
    c.cut(8_000);
    c.release(sheet, 8_500);
    c.show({ page: 'CLUB' }, 12_000);
    expect(views()).toEqual([
      ['NOW', null, 3_000, 0],
      ['PROFILE', null, 5_000, 3_000],
      ['NOW', null, 3_500, 8_000],
    ]);
  });
});

describe('SeenQueue', () => {
  const DEVICE = { s: false, t: 5, w: 390 };
  const view = (page: FinishedView['page'], began: number, ms = 4_000, subject: string | null = null): FinishedView => ({ page, subject, ms, began });

  function queue(answers: SeenSendResult[] | (() => SeenSendResult) = () => 'sent', random = 0) {
    const sent: SeenBatchBody[] = [];
    const q = new SeenQueue({
      device: DEVICE,
      random: () => random,
      send: async (b) => {
        sent.push(JSON.parse(JSON.stringify(b)) as SeenBatchBody);
        return typeof answers === 'function' ? answers() : (answers.shift() ?? 'sent');
      },
    });
    return { q, sent };
  }

  it('merges the consecutive views of one page and subject, never two different ones', async () => {
    const { q, sent } = queue();
    q.push(view('MODEL', 0, 3_000, 'monolithe'), 3_000);
    q.push(view('MODEL', 3_000, 2_000, 'monolithe'), 5_000);
    q.push(view('MODEL', 5_000, 2_000, 'orbite'), 7_000);
    q.push(view('NOW', 7_000, 2_000), 9_000);
    q.push(view('MODEL', 9_000, 2_000, 'orbite'), 11_000);
    await q.flush(20_000);
    expect(sent).toEqual([
      {
        v: 1,
        d: DEVICE,
        e: [
          { p: 'MODEL', s: 'monolithe', ms: 5_000, ago: 20_000 },
          { p: 'MODEL', s: 'orbite', ms: 2_000, ago: 15_000 },
          { p: 'NOW', ms: 2_000, ago: 13_000 },
          { p: 'MODEL', s: 'orbite', ms: 2_000, ago: 11_000 },
        ],
      },
    ]);
    expect(seenBody.safeParse(sent[0]).success).toBe(true);
  });

  it('sends every 30 s ± 10 s while it holds views, never before', async () => {
    for (const [random, due] of [
      [0, 20_000],
      [0.5, 30_000],
      [0.999, 39_980],
    ] as const) {
      const { q, sent } = queue(() => 'sent', random);
      expect(q.dueAt).toBeNull();
      q.push(view('NOW', 0), 0);
      expect(q.dueAt).toBe(due);
      expect(q.tick(due - 1, { page: 'NOW' })).toBeNull();
      await q.tick(due, { page: 'NOW' });
      expect(sent).toHaveLength(1);
      expect(q.dueAt).toBeNull();
      expect(q.tick(due + 60_000, { page: 'NOW' })).toBeNull();
    }
  });

  it('sends nothing during a LIVE room until the page is hidden or closed', async () => {
    const { q, sent } = queue();
    q.push(view('RELEASE', 0, 9_000, 'r-1'), 9_000);
    expect(q.tick(60_000, { page: 'LIVE', subject: 'r-1' })).toBeNull();
    expect(sent).toEqual([]);
    await q.flush(70_000); // the hide
    expect(sent).toHaveLength(1);
  });

  it('keeps 100 views at most while they cannot be sent, the oldest dropped; keeps a batch refused for the rate; drops one refused as malformed', async () => {
    const { q, sent } = queue(['retry', 'drop', 'sent', 'sent']);
    for (let i = 0; i < 120; i++) q.push(view(i % 2 === 0 ? 'NOW' : 'CLUB', i * 1_000), i * 1_000);
    expect(q.size).toBe(QUEUE_MAX);
    await q.flush(200_000); // 429: kept
    expect(q.size).toBe(QUEUE_MAX);
    expect(sent[0]!.e).toHaveLength(BATCH_MAX);
    expect(sent[0]!.e[0]!.ago).toBe(200_000 - 20_000);
    await q.flush(210_000); // 400: those 50 dropped, the next 50 sent
    expect(q.size).toBe(0);
    expect(sent.map((b) => b.e.length)).toEqual([50, 50, 50]);
    expect(sent[2]!.e[0]!.ago).toBe(210_000 - 70_000);
  });

  it('never sends a view begun 24 h ago or more, nor a subject longer than the server takes, nor a device out of range', async () => {
    const sent: SeenBatchBody[] = [];
    const q = new SeenQueue({ device: { s: true, t: 99, w: 1e9 }, random: () => 0, send: async (b) => (sent.push(b), 'sent') });
    q.push(view('NOW', 0), 0);
    q.push(view('MODEL', 1_000, 2_000, 'x'.repeat(81)), 3_000);
    await q.flush(86_400_500);
    expect(sent).toEqual([{ v: 1, d: { s: true, t: 20, w: 10_000 }, e: [{ p: 'MODEL', ms: 2_000, ago: 86_399_500 }] }]);
    expect(seenBody.safeParse(sent[0]).success).toBe(true);
  });

  it('keeps the views when the request fails, and never merges into a batch being sent', async () => {
    let release: (r: SeenSendResult) => void = () => {};
    const sent: SeenBatchBody[] = [];
    const q = new SeenQueue({
      device: DEVICE,
      random: () => 0,
      send: (b) => {
        sent.push(JSON.parse(JSON.stringify(b)) as SeenBatchBody);
        return new Promise<SeenSendResult>((r) => (release = r));
      },
    });
    q.push(view('NOW', 0, 3_000), 3_000);
    const first = q.flush(5_000);
    q.push(view('NOW', 3_000, 2_000), 6_000); // while the batch with the first NOW is in flight: not merged into it
    expect(q.size).toBe(2);
    release('sent');
    // The send goes on with what was pushed meanwhile, as its own batch.
    await new Promise((r) => setTimeout(r, 0));
    release('sent');
    await first;
    expect(q.size).toBe(0);
    expect(sent.map((b) => b.e.map((e) => e.ms))).toEqual([[3_000], [2_000]]);
    const failing = new SeenQueue({ device: DEVICE, send: async () => Promise.reject(new Error('offline')) });
    failing.push(view('NOW', 0), 0);
    await failing.flush(1_000);
    expect(failing.size).toBe(1);
  });
});

describe('ApiClient.seen', () => {
  it('posts the batch same-origin with keepalive and no CSRF token, and never throws', async () => {
    const inits: RequestInit[] = [];
    const urls: string[] = [];
    const answers: (() => Response)[] = [
      () => new Response(null, { status: 204 }),
      () => new Response('{}', { status: 429 }),
      () => new Response('{}', { status: 400 }),
      () => new Response('{}', { status: 503 }),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    const api = new ApiClient({
      fetch: async (input, init) => {
        urls.push(String(input));
        inits.push(init ?? {});
        return answers.shift()!();
      },
    });
    const batch: SeenBatchBody = { v: 1, d: { s: false, t: 5, w: 390 }, e: [{ p: 'NOW', ms: 2_000, ago: 1_000 }] };
    expect([await api.seen(batch), await api.seen(batch), await api.seen(batch), await api.seen(batch), await api.seen(batch)]).toEqual(['sent', 'retry', 'drop', 'retry', 'retry']);
    expect(urls[0]).toBe('/api/v1/seen');
    expect(inits[0]).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json' } });
    expect((inits[0]!.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    expect(JSON.parse(String(inits[0]!.body))).toEqual(batch);
  });
});

describe('seen (the app’s recorder)', () => {
  it('does nothing outside a browser: it never starts, and every call is a no-op', () => {
    seen.start({ seen: async () => 'sent' });
    expect(seen.on).toBe(false);
    seen.screen('landing', STATE);
    seen.claim({}, 'ACCOUNT', () => true);
    seen.release({});
    expect(seen.on).toBe(false);
  });
});
