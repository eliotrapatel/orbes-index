/**
 * The LIVE RELEASES in real time (plan of 2026-10-04, Architecture › Real time): Server-Sent Events.
 *
 *   viewers   GET /api/v1/live/:id/stream (routes/live.ts), a signed-in account allowed to enter the release (or holding
 *             an entry in it): `room` events, the room as LiveRoomService.frame builds it, and `you` events, the
 *             account's own entry (with its turn's secret while it is its turn), each sent when it changed;
 *   boards    POST /api/v1/live/:id/board/stream, by the board's secret link: `board` events (the countdown, the door, the
 *             pieces left overall), sent when they changed.
 * Every event carries the server's time (`now`); a comment line keeps a quiet stream open every LIVE_HEARTBEAT_MS
 * (20 s), under the server's idle timeout and the proxies'.
 *
 * One pulse a second (LIVE_PULSE_MS) for each release that has a stream open on this process: its frame built once
 * (four reads) and the entries of all its viewers read at once (a few more), then fanned out from memory. The database
 * work per second grows with the releases followed, never with the people following them; the state that a client
 * polls when its stream is lost (`room`) shares the same frame, at most a pulse old. A frame that no longer exists (the
 * release cancelled) closes its streams; a release that is over sends its last frame, then closes them, and a stream
 * asked for again answers 204, which an EventSource takes as the end. An entry REMOVED sends its last `you` event and
 * closes that stream. A stream is checked again at every pulse, not only when it opens: a viewer's session that has
 * ended (signed out, revoked, its account locked or disabled: one read for every viewer of the process) and a board
 * whose link has been replaced or revoked since it opened (the frame carries the link's hash) close their streams,
 * which then reconnect through the same checks as a new one.
 *
 * At most LIVE_STREAMS_PER_ACCOUNT (2) streams per account on a process (429 LIVE_STREAMS_LIMIT for a third: the page
 * then polls its state). A disconnection removes the stream at once; a client that does not read (more than
 * MAX_BUFFERED_BYTES waiting) is disconnected; the server's shutdown (app.ts, preClose) ends every stream. Streams
 * live in the process that serves them: with several instances, each builds the frames its own streams need.
 */
import type { ServerResponse } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../errors.js';
import type { LiveEntryView } from '../services/live.js';
import type { LiveBoard, LiveFrame, LiveRoom, LiveRoomService } from '../services/live-room.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';

export const LIVE_PULSE_MS = 1000;
export const LIVE_HEARTBEAT_MS = 20_000;
export const LIVE_STREAMS_PER_ACCOUNT = 2;
/** What an EventSource waits before it reconnects a stream that dropped. */
export const LIVE_RETRY_MS = 2000;
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

export interface LiveHubDeps extends LiveHubOptions {
  room: LiveRoomService;
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

type AnyStream = ViewerStream | BoardStream;

/** The same link's hash (not a secret: both sides are the server's own hashes). */
function sameHash(a: Uint8Array, b: Uint8Array | null): boolean {
  return b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}

export class LiveHub {
  private readonly room: LiveRoomService;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly pulseMs: number;
  private readonly heartbeatMs: number;
  private readonly cacheMs: number;
  private readonly perAccount: number;
  private readonly streams = new Map<string, Set<AnyStream>>();
  private readonly accounts = new Map<string, number>();
  private readonly frames = new Map<string, { at: number; frame: Promise<LiveFrame | null> }>();
  private timer: NodeJS.Timeout | undefined;
  private pulsing: Promise<void> | undefined;
  private stopped = false;

  constructor(deps: LiveHubDeps) {
    this.room = deps.room;
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

  /** A release's room, from memory when built within the cache's time (the state polled when a stream is lost). */
  async roomOf(dropId: string): Promise<LiveRoom | null> {
    return (await this.frame(dropId, false))?.room ?? null;
  }

  /** A release's board, as the board's page reads it before its stream. */
  async boardOf(dropId: string): Promise<LiveBoard | null> {
    return (await this.frame(dropId, false))?.board ?? null;
  }

  /**
   * Open a viewer's stream (the route has checked who may read the room), for as long as its session lives: 429
   * LIVE_STREAMS_LIMIT past the account's streams; 204 when the release is over.
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
      const views = await this.room.viewerEntries(dropId, [accountId]);
      const stream: ViewerStream = { kind: 'viewer', dropId, accountId, sessionId, res: this.begin(request, reply), lastWrite: 0, sent: undefined, you: undefined, closed: false };
      this.register(stream);
      registered = true;
      this.deliver(stream, frame, views);
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
    this.deliver(stream, frame, new Map());
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

  /** End every stream and the pulse (the server's shutdown). */
  stop(): void {
    this.stopped = true;
    this.stopTimer();
    for (const set of [...this.streams.values()]) for (const s of [...set]) this.close(s);
    this.frames.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async runPulse(): Promise<void> {
    await this.endSignedOut();
    for (const [dropId, set] of [...this.streams]) {
      if (set.size === 0) continue;
      // The streams opened while the frame is built were checked against the database by their route, after it.
      const checked = new Set(set);
      try {
        const frame = await this.frame(dropId, true);
        if (!frame) {
          for (const s of [...set]) this.close(s);
          continue;
        }
        for (const s of [...set]) if (s.kind === 'board' && checked.has(s) && !sameHash(s.tokenHash, frame.boardTokenHash)) this.close(s);
        const viewers = [...set].filter((s): s is ViewerStream => s.kind === 'viewer').map((s) => s.accountId);
        const views = await this.room.viewerEntries(dropId, [...new Set(viewers)]);
        for (const s of [...set]) this.deliver(s, frame, views);
        if (frame.room.over) for (const s of [...set]) this.close(s);
      } catch (e) {
        this.log.error({ dropId, err: { message: (e as Error)?.message } }, 'live stream: a release could not be read');
      }
    }
    const now = this.clock().getTime();
    for (const set of this.streams.values()) {
      for (const s of set) if (now - s.lastWrite >= this.heartbeatMs) this.write(s, ': still here\n\n');
    }
  }

  /** Close the viewer streams whose session has ended (one read for all of them). */
  private async endSignedOut(): Promise<void> {
    const viewers = [...this.streams.values()].flatMap((set) => [...set]).filter((s): s is ViewerStream => s.kind === 'viewer');
    if (viewers.length === 0) return;
    try {
      const live = await this.room.liveSessions(viewers.map((s) => s.sessionId));
      for (const s of viewers) if (!live.has(s.sessionId)) this.close(s);
    } catch (e) {
      this.log.error({ err: { message: (e as Error)?.message } }, 'live stream: the viewers\' sessions could not be read');
    }
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
    res.write(`retry: ${LIVE_RETRY_MS}\n\n`);
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

  /** Send what changed for this stream since its last event. */
  private deliver(s: AnyStream, frame: LiveFrame, views: ReadonlyMap<string, LiveEntryView>): void {
    if (s.closed) return;
    const now = this.clock();
    const data = s.kind === 'viewer' ? frame.room : frame.board;
    const json = JSON.stringify(data);
    if (json !== s.sent) {
      s.sent = json;
      this.event(s, s.kind === 'viewer' ? 'room' : 'board', { now, ...data });
    }
    if (s.kind !== 'viewer') return;
    const entry = views.get(s.accountId) ?? null;
    const you = JSON.stringify(entry);
    if (you !== s.you) {
      s.you = you;
      this.event(s, 'you', { now, entry });
    }
    if (entry?.status === 'REMOVED') this.close(s);
  }

  private event(s: AnyStream, name: string, data: unknown): void {
    this.write(s, `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
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
    }
    if (s.kind === 'viewer') this.release(s.accountId);
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
