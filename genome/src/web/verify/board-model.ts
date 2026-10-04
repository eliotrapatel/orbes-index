/**
 * The boutique board of a LIVE RELEASE (plan of 2026-10-04, The experience 11 and choice 31): what
 * /verify/releases/<id>/board#<secret> shows on a screen in a boutique or at an event, landscape and full screen, in the
 * vault: the countdown, the door, the pieces left overall, live. Never a person, the room's count, a host message nor a
 * size: the server sends none of them to a board (services/live-room.ts LiveBoard). Pure (no DOM) and unit-tested.
 *
 *  - Its address: the release's id in the path, the link's secret in the fragment, which no request line, proxy log
 *    nor Referer carries; the page sends it in a POST body (api.ts liveBoard, liveBoardStream).
 *  - Its stream: Server-Sent Events read from a POST's body (no EventSource can send one), parsed here (`SseParser`).
 *  - What it shows at the server's time: before T0 the door closed and the countdown; at T0 the door open on the piece,
 *    each part of it from its stage; the pieces left overall throughout; the end said as it came.
 */
import { LIVE } from './copy.js';
import { countdown, pictureOf, releaseTime, type LivePicture } from './live-model.js';
import { isReleaseId } from './releases-model.js';
import type { LiveBoard } from './types.js';
import { upper } from './view-model.js';

/** A board link's secret: 43 base64url characters (256 bits), as the console issues it. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The secret of a board's address, from its fragment (`#…`); null when it holds none that could be one. */
export function boardTokenOf(hash: string | null | undefined): string | null {
  const t = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  return TOKEN_RE.test(t) ? t : null;
}

// ── Its stream ─────────────────────────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Server-Sent Events as they arrive in pieces (WHATWG HTML §9.2.6): lines of `field: value`, an event ending at a blank
 * line; `event` names it (`message` when absent), `data` lines join with a line feed; a comment (`:`) — the heartbeat —
 * and the fields `id` and `retry` are ignored. Holds at most MAX_BUFFER characters of an event not yet ended.
 */
export class SseParser {
  static readonly MAX_BUFFER = 256 * 1024;
  private buffer = '';
  private event = '';
  private data: string[] = [];

  /** The events a chunk completes, in order. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    let at: number;
    while ((at = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, at);
      const eol = this.buffer.startsWith('\r\n', at) ? 2 : 1;
      // A lone CR at the very end may be the first half of a CRLF: wait for the next chunk.
      if (eol === 1 && this.buffer[at] === '\r' && at === this.buffer.length - 1) break;
      this.buffer = this.buffer.slice(at + eol);
      this.line(line, out);
    }
    if (this.buffer.length > SseParser.MAX_BUFFER) this.buffer = '';
    return out;
  }

  private line(line: string, out: SseEvent[]): void {
    if (line === '') {
      if (this.data.length > 0) out.push({ event: this.event || 'message', data: this.data.join('\n') });
      this.event = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
  }
}

/** The board's data of a `board` event, or null when it is not what a board sends. */
export function boardOf(data: string): (LiveBoard & { now?: string }) | null {
  try {
    const b = JSON.parse(data) as LiveBoard & { now?: string };
    return b && typeof b === 'object' && isReleaseId(b.id) && typeof b.left === 'number' && b.release && typeof b.opensAt === 'string' ? b : null;
  } catch {
    return null;
  }
}

// ── What it shows ──────────────────────────────────────────────────────────

export type BoardPhase = 'ANNOUNCED' | 'ROOM' | 'LIVE' | 'ENDED';

export interface BoardModel {
  phase: BoardPhase;
  /** LIVE RELEASE, THE ROOM IS OPEN, LIVE NOW, PAUSED; at the end SOLD OUT (once final with no piece left, not while a hold runs) or THE RELEASE HAS ENDED. */
  overline: string;
  /** The model's name once revealed, else TO BE REVEALED. */
  name: string;
  named: boolean;
  /** As the console wrote it: `25 PIECES`. */
  quantityLine: string;
  /** Before T0: OPENS IN, then UNTIL THE OPENING once the room is open, and the time left in two-digit groups. */
  countdown: { label: string; units: { value: string; unit: string }[] } | null;
  /** T0 in Paris: `SUNDAY 11 OCTOBER · 19:00 PARIS`. */
  when: string;
  /** The pieces left overall: `16`, `OF 25 LEFT`. */
  left: { value: string; of: string };
  /** One cell per piece up to METER_CELLS (taken, then free), else the share taken for a bar. */
  cells: ('gone' | 'free')[] | null;
  taken: number;
  /** The door: closed until T0, open on the piece from then on. */
  door: 'closed' | 'open';
  /** The time left to T0 (ms), for the lock's orbits. */
  untilOpening: number;
  /** The piece behind the door: its photograph, else its silhouette, else none (the seal). */
  picture: LivePicture | null;
}

/** The meter of the board draws a cell per piece up to this many. */
export const BOARD_CELLS = 50;

/**
 * The board at the server's time `now` (ms): its phase from the release's times (the end from the server, which knows a
 * sell-out or an end decided by ORBES).
 */
export function boardModel(b: LiveBoard, now: number): BoardModel {
  const room = Date.parse(b.roomOpensAt);
  const opens = Date.parse(b.opensAt);
  const closes = Date.parse(b.closesAt);
  const phase: BoardPhase = b.phase === 'ENDED' || b.over || now >= closes ? 'ENDED' : now >= opens ? 'LIVE' : now >= room ? 'ROOM' : 'ANNOUNCED';
  const quantity = Math.max(0, Math.trunc(b.quantity) || 0);
  const left = Math.min(quantity, Math.max(0, Math.trunc(b.left) || 0));
  const named = typeof b.release?.name === 'string' && b.release.name.trim().length > 0;
  const overline =
    phase === 'ENDED' ? (b.over && left === 0 ? LIVE.board.soldOut : LIVE.board.ended) : b.paused && phase === 'LIVE' ? LIVE.paused : phase === 'ANNOUNCED' ? LIVE.kind : LIVE.phase[phase];
  return {
    phase,
    overline,
    name: named ? upper(b.release.name!) : LIVE.unnamed,
    named,
    quantityLine: upper(b.quantityLine ?? ''),
    countdown: phase === 'ANNOUNCED' || phase === 'ROOM' ? { label: phase === 'ROOM' ? LIVE.untilOpening : LIVE.opensIn, units: countdown(opens - now) } : null,
    when: releaseTime(b.opensAt, 'Europe/Paris').paris,
    left: { value: String(left), of: LIVE.board.of(quantity) },
    cells: quantity > 0 && quantity <= BOARD_CELLS ? Array.from({ length: quantity }, (_, i) => (i < quantity - left ? 'gone' : 'free')) : null,
    taken: quantity > 0 ? (quantity - left) / quantity : 0,
    door: phase === 'LIVE' || phase === 'ENDED' ? 'open' : 'closed',
    untilOpening: opens - now,
    picture: pictureOf({ imageUrl: b.release?.imageUrl ?? null, silhouetteUrl: b.release?.silhouetteUrl ?? null, name: named ? b.release.name : null }),
  };
}
