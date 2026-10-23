/**
 * The LIVE RELEASES in real time (plan of 2026-10-04, Architecture › Real time): Server-Sent Events.
 *
 *   viewers   GET /api/v1/live/:id/stream (routes/live.ts), a signed-in account allowed to enter the release (or holding
 *             an entry in it): `room` events, the room as LiveRoomService.frame builds it, and `you` events, the
 *             account's own entry (with its turn's secret while it is its turn), each sent when it changed; the first
 *             `you` event also carries `savedSize` (AC-01: the size YOUR SIZES preselects, or null), and on a set's
 *             release `savedSizes` (macro scope K44 T1: one per piece that has one). ONE QUEUE (lot Q1 §1.3): a QUEUED
 *             entry's `you` event carries its own figures from the frame's queue snapshot (services/live-queue.ts: its
 *             place in its size, its estimated wait, what holds the batches, whether a batch can reach it next, whether
 *             its size can still serve it), never the pace, the line's length or a held piece (D8, D25). Only an entry
 *             a batch can reach next (`queue.next`; every QUEUED entry of an after-room) keeps its stream, one second a
 *             frame (D9): one further behind is sent its `you` and the room, then its stream ends, and a stream it asks
 *             for answers 204 until it is next; its page reads GET /state meanwhile, as often as its `pollMs` says (10 s
 *             to a minute). So a queue of thousands holds about 2·X streams, not thousands (docs/reports/live-load.md).
 *             Each `you` event a QUEUED entry is sent, as each GET /state, is recorded as its phone's reading (G2,
 *             services/live-frames.ts `read`: a batch after the first waits until the entries it reaches have read
 *             that they are next);
 *   boards    POST /api/v1/live/:id/board/stream, by the board's secret link: `board` events (the countdown, the door, the
 *             pieces left overall), sent when they changed;
 *   consoles  GET /api/admin/live/:id/stream (routes/admin/live.ts), a console session (AUDITOR and up): `console` events
 *             (`{ now, board }`), the live board as LiveConsoleService.board builds it (the counters, the line), the customers' emails in clear
 *             for an OPERATOR or an ADMIN and masked for an AUDITOR (`consoleView`), sent when it changed.
 * The frames and the batches (services/live-frames.ts, lot Q1 §1.2): a paced release gives at most one batch per published
 * frame. Each pulse that builds a release's frame for its streams marks it with the gate (`begin` before its reads,
 * `published` once sent); a release nobody follows has a frame built and cached when the engine or a NEXT BATCH NOW
 * asks for one (`publishFrame`, at most one a pulse per release), which the pages that poll it read.
 * Every event carries the server's time (`now`: the same for every event of a pulse, the moment its room was read); a
 * comment line keeps a quiet stream open every LIVE_HEARTBEAT_MS (20 s), under the server's idle timeout and the proxies'.
 *
 * One pulse a second (LIVE_PULSE_MS) for each release that has a stream open on this process: its frame built once
 * (four reads) and the entries of all its viewers read at once (a few more), then fanned out from memory, the room's
 * event (and the board's) written once for all and each stream sent one chunk; its console board, when a console
 * follows it, built once too. The database
 * work per second grows with the releases followed, never with the people following them; the state that a client
 * polls when its stream is lost (`room` and its own entry, with `pollMs`: LIVE_ROOM_POLL_MS, or its queue's `pollMs`
 * behind the next ones) shares the same frame, at most a pulse old. A frame that no
 * longer exists (the release cancelled) closes its streams; a release that is over sends its last frame, then closes them, and a stream
 * asked for again answers 204, which an EventSource takes as the end. An entry REMOVED sends its last `you` event and
 * closes that stream. A stream is checked again at every pulse, not only when it opens: a viewer's session that has
 * ended (signed out, revoked, its account locked or disabled: one read for every viewer of the process), a console's
 * whose session has ended or whose role no longer reads the console (one read for every console; a role changed between
 * AUDITOR and OPERATOR changes how its emails read from the next event) and a board whose link has been replaced or
 * revoked since it opened (the frame carries the link's hash) close their streams, which then reconnect through the same
 * checks as a new one. A console's stream ends with its release (cancelled, over) as a viewer's does.
 *
 * At most LIVE_STREAMS_PER_ACCOUNT (2) streams per account, and per console user, on a process (429 LIVE_STREAMS_LIMIT
 * for a third: the page then polls its state). A disconnection removes the stream at once; a client that does not read (more than
 * MAX_BUFFERED_BYTES waiting) is disconnected; the server's shutdown (app.ts, preClose) ends every stream. Streams
 * live in the process that serves them: with several instances, each builds the frames its own streams need.
 */
import type { ServerResponse } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../errors.js';
import { liveReadsNext, type LiveEntryView } from '../services/live.js';
import type { AdminLiveBoard } from '../services/live-console.js';
import type { LiveFrameGate } from '../services/live-frames.js';
import { LIVE_QUEUE_FAR_POLL_MS, queueView } from '../services/live-queue.js';
import type { LiveBoard, LiveFrame, LiveRoom, LiveRoomService, LiveSavedSize } from '../services/live-room.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';

/**
 * The routes that stream (a viewer's, the board's, the console's): the edge passes exactly these on uncompressed and at
 * once (deploy/vps/Caddyfile, `@live_stream`).
 */
export const LIVE_STREAM_ROUTES = Object.freeze(['/api/v1/live/:id/stream', '/api/v1/live/:id/board/stream', '/api/admin/live/:id/stream'] as const);

export const LIVE_PULSE_MS = 1000;
/**
 * A page whose stream is lost reads its state this often (web/verify/views/live.ts LIVE_POLL_MS): in the room, and in the
 * queue while a batch can reach it next…
 */
export const LIVE_ROOM_POLL_MS = 2000;
/**
 * …and, further behind (no stream), as its queue's `pollMs` says (services/live-queue.ts: a quarter of its estimate,
 * never the pace, within these bounds, `held` while the batches are held). Between two readings its page counts its own time
 * down; its place moves at the readings (D9).
 */
export { LIVE_QUEUE_FAR_POLL_MS };
export const LIVE_HEARTBEAT_MS = 20_000;
export const LIVE_STREAMS_PER_ACCOUNT = 2;
/**
 * What an EventSource waits before it reconnects a stream that dropped: at least LIVE_RETRY_MS, plus a share of
 * LIVE_RETRY_SPREAD_MS drawn per connection, so that a room dropped all at once (a restart, the edge recreated) comes
 * back spread over three seconds rather than in the same instant.
 */
export const LIVE_RETRY_MS = 2000;
export const LIVE_RETRY_SPREAD_MS = 3000;
export const liveRetryMs = (random: () => number = Math.random): number =>
  LIVE_RETRY_MS + Math.min(LIVE_RETRY_SPREAD_MS - 1, Math.floor(random() * LIVE_RETRY_SPREAD_MS));
/** A client this far behind is disconnected rather than buffered without end. */
const MAX_BUFFERED_BYTES = 256 * 1024;

export const liveStreamsLimit = () =>
  new DomainError('LIVE_STREAMS_LIMIT', 429, 'This account already follows the release on two screens. Close one to follow it here.');

export interface LiveHubOptions {
  /** The pulse; 0: none (tests drive `pulse()`). */
  pulseMs?: number;
  heartbeatMs?: number;
  /** A frame younger than this is served from memory (default: the pulse; 0: always built again). */
  cacheMs?: number;
  perAccount?: number;
}

/** What the console's streams read (services/live-console.ts LiveConsoleService). */
export interface LiveConsoleSource {
  board(dropId: string): Promise<AdminLiveBoard | null>;
  consoleSessions(sessionIds: readonly string[]): Promise<Map<string, { inClear: boolean }>>;
}

export interface LiveHubDeps extends LiveHubOptions {
  room: LiveRoomService;
  /** The console's live board; without it, no console stream opens. */
  console?: LiveConsoleSource;
  /** At most one batch per published frame (services/live-frames.ts): the frames this hub publishes are marked on it. */
  frames?: LiveFrameGate;
  /** The live board as a console reads it: the emails in clear or masked (routes/admin/live.ts liveBoardJson). */
  consoleView?: (board: AdminLiveBoard, inClear: boolean) => unknown;
  clock?: Clock;
  log?: Logger;
}

interface Stream {
  dropId: string;
  res: ServerResponse;
  /** When it was last written to (the hub's clock). */
  lastWrite: number;
  /** The last frame and entry it was sent, as JSON. */
  sent: string | undefined;
  you: string | undefined;
  closed: boolean;
}

interface ViewerStream extends Stream {
  kind: 'viewer';
  accountId: string;
  /** Its session (SessionInfo.id), checked at every pulse. */
  sessionId: string;
}

interface BoardStream extends Stream {
  kind: 'board';
  /** The SHA-256 of the link's secret it opened with, compared at every pulse with the release's current one. */
  tokenHash: Uint8Array;
}

/**
 * What a pulse sends the streams of a release: the server's time once, and the room's and the board's JSON and event
 * made once, when a stream first needs them, whatever the audience.
 */
interface Outgoing {
  frame: LiveFrame;
  /** The server's time of these events, as JSON… */
  now: string;
  /** …and in ms. */
  at: number;
  room?: Shared;
  board?: Shared;
}

interface Shared {
  /** The data, to compare with what a stream was last sent. */
  json: string;
  /** Its whole event. */
  event: string;
}

interface ConsoleStream extends Stream {
  kind: 'console';
  /** The console user, whose streams are counted as an account's (`admin:<id>`). */
  adminId: string;
  /** Its session (SessionInfo.id), checked at every pulse with the role it reads under. */
  sessionId: string;
  inClear: boolean;
}

type AnyStream = ViewerStream | BoardStream | ConsoleStream;

/** A QUEUED entry no batch can reach next (its queue's `next` false): it holds no stream, its page reads its state. */
function behindNextBatch(entry: LiveEntryView | null | undefined): boolean {
  return entry?.status === 'QUEUED' && !!entry.queue && !entry.queue.next;
}

/** A viewer's own entry with its figures from the frame's queue snapshot, read at `now` (ms). */
function withQueue(entry: LiveEntryView | null, frame: LiveFrame, now: number): LiveEntryView | null {
  if (entry?.status !== 'QUEUED' || !frame.queue) return entry;
  return { ...entry, queue: queueView(frame.queue, entry.id, now) };
}

/** The same link's hash (not a secret: both sides are the server's own hashes). */
function sameHash(a: Uint8Array, b: Uint8Array | null): boolean {
  return b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}

export class LiveHub {
  private readonly room: LiveRoomService;
  private readonly console: LiveConsoleSource | undefined;
  private readonly gate: LiveFrameGate | undefined;
  /** When each release's frame was last published, for `publishFrame` (performance.now()). */
  private readonly publishedAt = new Map<string, number>();
  private readonly consoleView: (board: AdminLiveBoard, inClear: boolean) => unknown;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly pulseMs: number;
  private readonly heartbeatMs: number;
  private readonly cacheMs: number;
  private readonly perAccount: number;
  private readonly streams = new Map<string, Set<AnyStream>>();
  private readonly accounts = new Map<string, number>();
  private readonly frames = new Map<string, { at: number; frame: Promise<LiveFrame | null> }>();
  private readonly boards = new Map<string, { at: number; board: Promise<AdminLiveBoard | null> }>();
  private timer: NodeJS.Timeout | undefined;
  private pulsing: Promise<void> | undefined;
  private stopped = false;

  constructor(deps: LiveHubDeps) {
    this.room = deps.room;
    this.console = deps.console;
    this.gate = deps.frames;
    this.consoleView = deps.consoleView ?? ((board) => board);
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.pulseMs = deps.pulseMs ?? LIVE_PULSE_MS;
    this.heartbeatMs = deps.heartbeatMs ?? LIVE_HEARTBEAT_MS;
    this.cacheMs = deps.cacheMs ?? this.pulseMs;
    this.perAccount = deps.perAccount ?? LIVE_STREAMS_PER_ACCOUNT;
  }

  /** The streams open now: in all, per release, per account. */
  get open(): { streams: number; releases: number; accounts: ReadonlyMap<string, number> } {
    let n = 0;
    for (const set of this.streams.values()) n += set.size;
    return { streams: n, releases: this.streams.size, accounts: new Map(this.accounts) };
  }

  /**
   * What a viewer polls when it has no stream (GET /state), from the same frame (from memory when built within the
   * cache's time): the room, its own entry with its figures from the frame's queue snapshot (an entry newer than the
   * frame, a late comer's first reading, reads a frame built afresh), and how soon to read again: its queue's `pollMs`
   * behind the next ones, LIVE_ROOM_POLL_MS otherwise. The reading is recorded (G2: live-frames.ts `read`). Null once
   * the release is no longer one to read.
   */
  async stateOf(dropId: string, entry: LiveEntryView | null): Promise<{ room: LiveRoom; entry: LiveEntryView | null; pollMs: number } | null> {
    let frame = await this.frame(dropId, false);
    if (frame && entry?.status === 'QUEUED' && frame.queue && !frame.queue.entries.has(entry.id)) frame = await this.frame(dropId, true);
    if (!frame) return null;
    const own = withQueue(entry, frame, this.clock().getTime());
    if (own?.status === 'QUEUED') this.gate?.read(dropId, own.id, liveReadsNext(own));
    const behind = behindNextBatch(own) ? frame.queue?.entries.get(own!.id)?.pollMs : null;
    return { room: frame.room, entry: own, pollMs: behind ?? LIVE_ROOM_POLL_MS };
  }

  /** A release's board, as the board's page reads it before its stream. */
  async boardOf(dropId: string): Promise<LiveBoard | null> {
    return (await this.frame(dropId, false))?.board ?? null;
  }

  /**
   * Open a viewer's stream (the route has checked who may read the room), for as long as its session lives: 429
   * LIVE_STREAMS_LIMIT past the account's streams; 204 when the release is over, or while its entry waits behind the
   * next ones (ONE QUEUE §1.3: its page reads its state).
   */
  async openViewer(request: FastifyRequest, reply: FastifyReply, dropId: string, viewer: { accountId: string; sessionId: string }): Promise<void> {
    const { accountId, sessionId } = viewer;
    const held = this.accounts.get(accountId) ?? 0;
    if (held >= this.perAccount) throw liveStreamsLimit();
    this.accounts.set(accountId, held + 1);
    let registered = false;
    try {
      const frame = await this.frame(dropId, false);
      if (!frame || frame.room.over) {
        reply.code(204).send();
        return;
      }
      const views = await this.room.viewerEntries(dropId, [accountId], frame.queue);
      if (behindNextBatch(views.get(accountId))) {
        reply.code(204).send();
        return;
      }
      // AC-01: the first frame says which size YOUR SIZES preselects, while the account holds no entry nor interest.
      const savedSize = views.has(accountId) ? null : await this.room.savedSize(accountId, dropId);
      // Macro scope K44 T1: a set's release, YOUR SIZES' size per piece.
      const savedSizes = frame.room.pieces ? (views.has(accountId) ? [] : await this.room.savedSizesNow(accountId, dropId)) : undefined;
      const stream: ViewerStream = { kind: 'viewer', dropId, accountId, sessionId, res: this.begin(request, reply), lastWrite: 0, sent: undefined, you: undefined, closed: false };
      this.register(stream);
      registered = true;
      this.deliver(stream, this.outgoing(frame), views, { savedSize, ...(savedSizes ? { savedSizes } : {}) });
    } finally {
      if (!registered) this.release(accountId);
    }
  }

  /** Open a board's stream (the route has checked its link, whose hash it keeps): 204 when the release is over. */
  async openBoard(request: FastifyRequest, reply: FastifyReply, dropId: string, tokenHash: Uint8Array): Promise<void> {
    const frame = await this.frame(dropId, false);
    if (!frame || frame.room.over) {
      reply.code(204).send();
      return;
    }
    const stream: BoardStream = { kind: 'board', dropId, tokenHash, res: this.begin(request, reply), lastWrite: 0, sent: undefined, you: undefined, closed: false };
    this.register(stream);
    this.deliver(stream, this.outgoing(frame), new Map());
  }

  /**
   * Open a console's stream (the route has checked its session and role): the live board, its emails as `inClear`
   * says, for as long as its session reads the console. False, nothing sent, for a release that is not a LIVE RELEASE
   * (the route's 404); 429 LIVE_STREAMS_LIMIT past the console user's streams; 204 for a release that is not published,
   * cancelled or over (the page then reads the board once).
   */
  async openConsole(request: FastifyRequest, reply: FastifyReply, dropId: string, staff: { adminId: string; sessionId: string; inClear: boolean }): Promise<boolean> {
    if (!this.console) throw new DomainError('NOT_FOUND', 404, 'Not found.');
    // The board read once: it says whether the release exists, then starts the stream.
    const board = await this.consoleBoard(dropId, false);
    if (!board) return false;
    const key = `admin:${staff.adminId}`;
    const held = this.accounts.get(key) ?? 0;
    if (held >= this.perAccount) throw liveStreamsLimit();
    this.accounts.set(key, held + 1);
    let registered = false;
    try {
      if (board.phase === 'DRAFT' || board.phase === 'CANCELLED' || board.over) {
        reply.code(204).send();
        return true;
      }
      const stream: ConsoleStream = { kind: 'console', dropId, adminId: staff.adminId, sessionId: staff.sessionId, inClear: staff.inClear, res: this.begin(request, reply), lastWrite: 0, sent: undefined, you: undefined, closed: false };
      this.register(stream);
      registered = true;
      this.deliverConsole(stream, board, new Map());
    } finally {
      if (!registered) this.release(key);
    }
    return true;
  }

  /**
   * One pulse: the viewers whose session has ended closed; for each release followed, its frame built once and its
   * viewers' entries read at once, its boards whose link has changed closed, each other stream sent what changed for
   * it; a heartbeat to the quiet ones. One pulse at a time.
   */
  pulse(): Promise<void> {
    this.pulsing ??= this.runPulse().finally(() => {
      this.pulsing = undefined;
    });
    return this.pulsing;
  }

  /**
   * A frame of the release asked for (services/live-frames.ts `ask`: a batch waits for it): built afresh, sent to its
   * streams and cached for its polls, then marked published; at most one a pulse per release (a release followed by
   * viewers or boards has one every pulse anyway: nothing more then). Errors are logged; the next ask tries again.
   */
  publishFrame(dropId: string): Promise<void> {
    if (this.stopped || !this.gate) return Promise.resolve();
    // Asked for after a change (a batch, a control: D9, "recomputed at once"): no poll reads the frame from before it.
    this.frames.delete(dropId);
    const set = this.streams.get(dropId);
    if (set && [...set].some((s) => s.kind !== 'console') && this.timer) return Promise.resolve();
    const last = this.publishedAt.get(dropId);
    if (last !== undefined && performance.now() - last < this.pulseMs) return Promise.resolve();
    this.publishedAt.set(dropId, performance.now());
    return this.publishNow(dropId).catch((e) => this.log.error({ dropId, err: { message: (e as Error)?.message } }, 'live stream: a frame could not be published'));
  }

  private async publishNow(dropId: string): Promise<void> {
    const mark = this.gate!.begin(dropId);
    const frame = await this.frame(dropId, true);
    const set = this.streams.get(dropId);
    if (frame && set) {
      const viewers = [...set].filter((s): s is ViewerStream => s.kind === 'viewer').map((s) => s.accountId);
      const views = viewers.length ? await this.room.viewerEntries(dropId, [...new Set(viewers)], frame.queue) : new Map<string, LiveEntryView>();
      const out = this.outgoing(frame);
      for (const s of [...set]) if (s.kind !== 'console') this.deliver(s, out, views);
    }
    this.publishedAt.set(dropId, performance.now());
    this.gate!.published(dropId, mark);
  }

  /** End every stream and the pulse (the server's shutdown). */
  stop(): void {
    this.stopped = true;
    this.stopTimer();
    for (const set of [...this.streams.values()]) for (const s of [...set]) this.close(s);
    this.frames.clear();
    this.boards.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async runPulse(): Promise<void> {
    await this.endSignedOut();
    for (const [dropId, set] of [...this.streams]) {
      if (set.size === 0) continue;
      // The streams opened while the frame is built were checked against the database by their route, after it.
      const checked = new Set(set);
      const consoles = [...set].filter((s): s is ConsoleStream => s.kind === 'console');
      try {
        if (consoles.length > 0) {
          const board = await this.consoleBoard(dropId, true);
          const views = new Map<boolean, string>();
          for (const s of consoles) {
            if (!board || board.phase === 'CANCELLED') this.close(s);
            else this.deliverConsole(s, board, views);
          }
          if (board?.over) for (const s of consoles) this.close(s);
        }
        if (consoles.length === set.size) continue;
        const mark = this.gate?.begin(dropId);
        const frame = await this.frame(dropId, true);
        if (!frame) {
          for (const s of [...set]) if (s.kind !== 'console') this.close(s);
          continue;
        }
        for (const s of [...set]) if (s.kind === 'board' && checked.has(s) && !sameHash(s.tokenHash, frame.boardTokenHash)) this.close(s);
        const viewers = [...set].filter((s): s is ViewerStream => s.kind === 'viewer').map((s) => s.accountId);
        const views = await this.room.viewerEntries(dropId, [...new Set(viewers)], frame.queue);
        const out = this.outgoing(frame);
        for (const s of [...set]) if (s.kind !== 'console') this.deliver(s, out, views);
        // The frame is out: a batch waiting for it may go (services/live-frames.ts).
        if (mark !== undefined) {
          this.publishedAt.set(dropId, performance.now());
          this.gate!.published(dropId, mark);
        }
        if (frame.room.over) for (const s of [...set]) if (s.kind !== 'console') this.close(s);
      } catch (e) {
        this.log.error({ dropId, err: { message: (e as Error)?.message } }, 'live stream: a release could not be read');
      }
    }
    const now = this.clock().getTime();
    for (const set of this.streams.values()) {
      for (const s of set) if (now - s.lastWrite >= this.heartbeatMs) this.write(s, ': still here\n\n');
    }
  }

  /**
   * Close the viewer streams whose session has ended (one read for all of them), and the console streams whose session
   * no longer reads the console (one read for all of them); a console's role read again says how its emails read.
   */
  private async endSignedOut(): Promise<void> {
    const all = [...this.streams.values()].flatMap((set) => [...set]);
    const viewers = all.filter((s): s is ViewerStream => s.kind === 'viewer');
    const consoles = all.filter((s): s is ConsoleStream => s.kind === 'console');
    if (viewers.length > 0) {
      try {
        const live = await this.room.liveSessions(viewers.map((s) => s.sessionId));
        for (const s of viewers) if (!live.has(s.sessionId)) this.close(s);
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'live stream: the viewers\' sessions could not be read');
      }
    }
    if (consoles.length > 0 && this.console) {
      try {
        const live = await this.console.consoleSessions(consoles.map((s) => s.sessionId));
        for (const s of consoles) {
          const session = live.get(s.sessionId);
          if (!session) this.close(s);
          else if (session.inClear !== s.inClear) {
            s.inClear = session.inClear;
            s.sent = undefined;
          }
        }
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'live stream: the consoles\' sessions could not be read');
      }
    }
  }

  /** A release's live board for the consoles: built again when `fresh` or older than the cache's time; one build at a time. */
  private consoleBoard(dropId: string, fresh: boolean): Promise<AdminLiveBoard | null> {
    const now = performance.now();
    const cached = this.boards.get(dropId);
    if (cached && !fresh && now - cached.at < this.cacheMs) return cached.board;
    const board = this.console ? this.console.board(dropId) : Promise.resolve(null);
    const entry = { at: now, board };
    this.boards.set(dropId, entry);
    board.catch(() => {
      if (this.boards.get(dropId) === entry) this.boards.delete(dropId);
    });
    return board;
  }

  /** Send a console the live board when it changed for it (its JSON made once per pulse for each way of reading emails). */
  private deliverConsole(s: ConsoleStream, board: AdminLiveBoard, views: Map<boolean, string>): void {
    if (s.closed) return;
    let json = views.get(s.inClear);
    if (json === undefined) {
      json = JSON.stringify(this.consoleView(board, s.inClear));
      views.set(s.inClear, json);
    }
    if (json === s.sent) return;
    s.sent = json;
    this.write(s, `event: console\ndata: {"now":${JSON.stringify(this.clock())},"board":${json}}\n\n`);
  }

  /** The frame of a release: built again when `fresh` or older than the cache's time; one build at a time per release. */
  private frame(dropId: string, fresh: boolean): Promise<LiveFrame | null> {
    const now = performance.now();
    const cached = this.frames.get(dropId);
    if (cached && !fresh && now - cached.at < this.cacheMs) return cached.frame;
    const frame = this.room.frame(dropId);
    const entry = { at: now, frame };
    this.frames.set(dropId, entry);
    frame.catch(() => {
      if (this.frames.get(dropId) === entry) this.frames.delete(dropId);
    });
    return frame;
  }

  /** Take the response over and write the stream's head. */
  private begin(request: FastifyRequest, reply: FastifyReply): ServerResponse {
    reply.hijack();
    const res = reply.raw;
    const headers: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string | number | string[];
    delete headers['content-length'];
    delete headers['x-powered-by'];
    res.removeHeader('x-powered-by');
    res.writeHead(200, {
      ...headers,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    request.raw.socket?.setNoDelay(true);
    res.write(`retry: ${liveRetryMs()}\n\n`);
    return res;
  }

  private register(s: AnyStream): void {
    let set = this.streams.get(s.dropId);
    if (!set) this.streams.set(s.dropId, (set = new Set()));
    set.add(s);
    s.res.on('close', () => this.close(s));
    this.startTimer();
    // Gone while its first frame was read: removed at once.
    if (s.res.destroyed) this.close(s);
  }

  /** A frame about to be sent, stamped with the server's time. */
  private outgoing(frame: LiveFrame): Outgoing {
    const now = this.clock();
    return { frame, now: JSON.stringify(now), at: now.getTime() };
  }

  /** The room's or the board's JSON and event (`{ now, ...data }`), made once per pulse (the queue's snapshot never). */
  private shared(out: Outgoing, kind: 'room' | 'board'): Shared {
    let shared = out[kind];
    if (!shared) {
      const json = JSON.stringify(out.frame[kind]);
      // `{ now, ...data }`, the data's fields after the time (the room and the board are never empty objects).
      shared = { json, event: `event: ${kind}\ndata: {"now":${out.now},${json.slice(1)}\n\n` };
      out[kind] = shared;
    }
    return shared;
  }

  /**
   * Send what changed for this stream since its last events, in one write: the viewer's own entry first (QUEUED, with its
   * figures from the frame's queue snapshot: its reading recorded, G2), then the room, so a page that stops following at
   * a room that is over has already read its final entry.
   */
  private deliver(
    s: ViewerStream | BoardStream,
    out: Outgoing,
    views: ReadonlyMap<string, LiveEntryView>,
    first?: { savedSize: LiveSavedSize | null; savedSizes?: { piece: number; id: string; label: string }[] },
  ): void {
    if (s.closed) return;
    const entry = s.kind === 'viewer' ? withQueue(views.get(s.accountId) ?? null, out.frame, out.at) : null;
    if (entry?.status === 'QUEUED') this.gate?.read(s.dropId, entry.id, liveReadsNext(entry));
    const shared = this.shared(out, s.kind === 'board' ? 'board' : 'room');
    let chunk = '';
    if (s.kind === 'viewer') {
      const you = JSON.stringify(entry);
      if (you !== s.you) {
        s.you = you;
        // The first frame alone carries the size YOUR SIZES preselects (AC-01).
        const saved = first ? `,"savedSize":${JSON.stringify(first.savedSize)}${first.savedSizes ? `,"savedSizes":${JSON.stringify(first.savedSizes)}` : ''}` : '';
        chunk = `event: you\ndata: {"now":${out.now},"entry":${you}${saved}}\n\n`;
      }
    }
    if (shared.json !== s.sent) {
      s.sent = shared.json;
      chunk += shared.event;
    }
    if (chunk) this.write(s, chunk);
    // REMOVED: its last event. Behind the next ones (D9): its own figures and the room sent, its page reads its state
    // until a batch can reach it next.
    if (entry?.status === 'REMOVED' || behindNextBatch(entry)) this.close(s);
  }

  private write(s: AnyStream, chunk: string): void {
    if (s.closed) return;
    if (s.res.writableLength > MAX_BUFFERED_BYTES) {
      this.close(s);
      return;
    }
    s.res.write(chunk);
    s.lastWrite = this.clock().getTime();
  }

  /** Remove a stream (once): its release's set, its account's count, its response ended. */
  private close(s: AnyStream): void {
    if (s.closed) return;
    s.closed = true;
    const set = this.streams.get(s.dropId);
    set?.delete(s);
    if (set && set.size === 0) {
      this.streams.delete(s.dropId);
      this.frames.delete(s.dropId);
      this.boards.delete(s.dropId);
    }
    if (s.kind === 'viewer') this.release(s.accountId);
    if (s.kind === 'console') this.release(`admin:${s.adminId}`);
    if (!s.res.writableEnded) s.res.end();
    if (this.streams.size === 0) this.stopTimer();
  }

  private release(accountId: string): void {
    const n = (this.accounts.get(accountId) ?? 1) - 1;
    if (n <= 0) this.accounts.delete(accountId);
    else this.accounts.set(accountId, n);
  }

  private startTimer(): void {
    if (this.timer || this.pulseMs <= 0 || this.stopped) return;
    this.timer = setInterval(() => void this.pulse(), this.pulseMs);
    this.timer.unref();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
