/**
 * The boutique board of a LIVE RELEASE (plan of 2026-10-04, The experience 11, choice 31; src/web/verify/board-model.ts):
 * its secret from the fragment only; its stream's Server-Sent Events read from a POST's body, in whatever pieces they
 * come; what it shows at the server's time (the countdown before T0, the door closed then open, the pieces left overall,
 * the end as it came) and never a person, the room's count, a host message nor a size. Pure: no DOM. The page is driven
 * in Chromium by verify.live-announce.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { boardModel, boardOf, boardTokenOf, BOARD_CELLS, SseParser } from '../../src/web/verify/board-model.js';
import type { LiveBoard } from '../../src/web/verify/types.js';

const ID = '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d';
const T0 = Date.parse('2026-10-11T17:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();
const media = (n: number) => `/api/v1/media/${n.toString(16).padStart(2, '0').repeat(32)}`;

function board(extra: Partial<LiveBoard> = {}): LiveBoard {
  return {
    id: ID,
    phase: 'ANNOUNCED',
    paused: false,
    over: false,
    roomOpensAt: iso(T0 - 300_000),
    opensAt: iso(T0),
    closesAt: iso(T0 + 3_600_000),
    quantity: 25,
    quantityLine: '25 pieces',
    left: 25,
    release: { revealed: { silhouette: false, name: false, photo: false }, name: null, silhouetteUrl: null, imageUrl: null },
    ...extra,
  };
}

describe('the boutique board: its link', () => {
  it('takes its secret from the fragment only, 43 base64url characters', () => {
    const secret = 'Ab0_-'.repeat(8) + 'xyz';
    expect(boardTokenOf(`#${secret}`)).toBe(secret);
    expect(boardTokenOf(secret)).toBe(secret);
    for (const bad of ['', '#', `#${secret}x`, `#${secret.slice(1)}`, `#${secret.slice(1)}=`, `#${secret.slice(2)}%2`, null, undefined]) expect(boardTokenOf(bad)).toBeNull();
  });
});

describe('the boutique board: its stream', () => {
  it('reads the events in whatever pieces they come: names, multi-line data, CRLF, comments (the heartbeat) and other fields ignored', () => {
    const p = new SseParser();
    expect(p.push('retry: 2000\n\n: heartbeat\n\nevent: bo')).toEqual([]);
    expect(p.push('ard\ndata: {"a":')).toEqual([]);
    expect(p.push('1}\n\nid: 7\nevent: board\r')).toEqual([{ event: 'board', data: '{"a":1}' }]);
    expect(p.push('\ndata: one\r\ndata:two\r\n\r\ndata: plain\n\n')).toEqual([
      { event: 'board', data: 'one\ntwo' },
      { event: 'message', data: 'plain' },
    ]);
    // A line of no data ends nothing: an event needs data.
    expect(p.push('event: board\n\n')).toEqual([]);
  });

  it('drops an event that never ends rather than holding it without limit', () => {
    const p = new SseParser();
    p.push(`data: ${'x'.repeat(SseParser.MAX_BUFFER + 10)}`);
    expect(p.push('\n\n')).toEqual([]);
    expect(p.push('data: next\n\n')).toEqual([{ event: 'message', data: 'next' }]);
  });

  it('takes a board event only when it is a board', () => {
    expect(boardOf(JSON.stringify({ now: iso(T0), ...board() }))).toMatchObject({ id: ID, left: 25 });
    for (const bad of ['', 'nope', '[]', JSON.stringify({ ...board(), id: 'x' }), JSON.stringify({ ...board(), left: '3' }), JSON.stringify({ ...board(), release: null })]) expect(boardOf(bad)).toBeNull();
  });
});

describe('the boutique board: what it shows', () => {
  it('before T0: the door closed, OPENS IN then UNTIL THE OPENING once the room is open, the pieces left overall; TO BE REVEALED before the name', () => {
    const m = boardModel(board(), T0 - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000));
    expect(m).toMatchObject({
      phase: 'ANNOUNCED',
      overline: 'LIVE RELEASE',
      name: 'TO BE REVEALED',
      named: false,
      quantityLine: '25 PIECES',
      countdown: { label: 'OPENS IN', units: [{ value: '02', unit: 'DAYS' }, { value: '03', unit: 'HOURS' }, { value: '04', unit: 'MINUTES' }] },
      when: 'SUNDAY 11 OCTOBER · 19:00 PARIS',
      left: { value: '25', of: 'OF 25 LEFT' },
      door: 'closed',
      picture: null,
    });
    expect(m.cells).toEqual(Array(25).fill('free'));
    const room = boardModel(board({ phase: 'ROOM', release: { revealed: { silhouette: true, name: true, photo: false }, name: 'Monolithe', silhouetteUrl: media(2), imageUrl: null } }), T0 - 61_000);
    expect(room).toMatchObject({ phase: 'ROOM', overline: 'THE ROOM IS OPEN', name: 'MONOLITHE', named: true, door: 'closed', untilOpening: 61_000 });
    expect(room.countdown).toEqual({ label: 'UNTIL THE OPENING', units: [{ value: '00', unit: 'HOURS' }, { value: '01', unit: 'MINUTES' }, { value: '01', unit: 'SECONDS' }] });
    expect(room.picture).toMatchObject({ src: media(2), kind: 'silhouette' });
  });

  it('from T0 on the server\'s clock: the door open on the piece, LIVE NOW, the pieces left; a pause said; no countdown', () => {
    const b = board({ phase: 'ROOM', left: 16, release: { revealed: { silhouette: true, name: true, photo: true }, name: 'Monolithe', silhouetteUrl: media(2), imageUrl: media(1) } });
    expect(boardModel(b, T0 - 1).door).toBe('closed');
    const m = boardModel(b, T0);
    expect(m).toMatchObject({ phase: 'LIVE', overline: 'LIVE NOW', countdown: null, door: 'open', left: { value: '16', of: 'OF 25 LEFT' }, picture: { src: media(1), kind: 'photo' } });
    expect(m.cells!.filter((c) => c === 'gone')).toHaveLength(9);
    expect(m.cells!.slice(0, 9)).toEqual(Array(9).fill('gone'));
    expect(boardModel({ ...b, phase: 'LIVE', paused: true }, T0 + 1).overline).toBe('PAUSED');
    // A picture from anywhere but this origin's media route is no picture.
    expect(boardModel({ ...b, release: { ...b.release, imageUrl: 'https://elsewhere.example/p.jpg', silhouetteUrl: null } }, T0).picture).toBeNull();
  });

  it('at the end: SOLD OUT when no piece is left, else THE RELEASE HAS ENDED; at its close on the server\'s clock too', () => {
    expect(boardModel(board({ phase: 'ENDED', over: true, left: 0 }), T0 + 60_000)).toMatchObject({ phase: 'ENDED', overline: 'SOLD OUT', door: 'open', countdown: null, left: { value: '0' } });
    expect(boardModel(board({ phase: 'ENDED', over: true, left: 4 }), T0 + 60_000).overline).toBe('THE RELEASE HAS ENDED');
    expect(boardModel(board({ phase: 'LIVE', left: 4 }), T0 + 3_600_000)).toMatchObject({ phase: 'ENDED', overline: 'THE RELEASE HAS ENDED' });
  });

  it('draws a bar past BOARD_CELLS pieces, and keeps the figures within the quantity', () => {
    const big = boardModel(board({ quantity: 200, left: 50 }), T0);
    expect(big.cells).toBeNull();
    expect(big.taken).toBe(0.75);
    expect(boardModel(board({ quantity: BOARD_CELLS, left: BOARD_CELLS }), T0).cells).toHaveLength(BOARD_CELLS);
    expect(boardModel(board({ quantity: 3, left: 9 }), T0).left).toEqual({ value: '3', of: 'OF 3 LEFT' });
    expect(boardModel(board({ quantity: 3, left: -1 }), T0).left.value).toBe('0');
  });

  it('shows nothing of a person, the room\'s count, a host message nor a size: its model has no place for them', () => {
    const m = boardModel(board({ phase: 'LIVE', left: 2 }), T0 + 5_000);
    expect(Object.keys(m).sort()).toEqual(['cells', 'countdown', 'door', 'left', 'name', 'named', 'overline', 'phase', 'picture', 'quantityLine', 'taken', 'untilOpening', 'when']);
  });
});
