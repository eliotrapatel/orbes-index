/**
 * ONE QUEUE's figures (lot Q1, plan §1.3, §1.4): the queue's snapshot, what each phone reads of its own place, and the
 * close guard for the console.
 *
 * The snapshot (`liveQueueSnapshot`: three reads, then `queuePlaces`, pure) is built once per frame of a release
 * (services/live-room.ts LiveRoomService.frame, published once a second by the live streams and cached for the pages
 * that poll it) and never sent whole: each phone reads its own entry's figures only (D8, ANSWERS B8: "each phone gets
 * only its own place, its own estimated time and the stock; never batch size, gap, queue length or the scarcity
 * purpose"), the console reads them all (D11). For each QUEUED entry, in the order of the turns (the house's guarantee
 * first, then the place; a set's release by place):
 *
 *   place     1 + the QUEUED entries before it in its size (a set's entry: the most in any of its sizes, + 1) (D19);
 *   waitMs    the estimate, from the snapshot's time (D20): the next batches simulated as the engine gives them (each up
 *             to X turns in the order of the turns, only where a piece is free, an entry wanting more than its size can
 *             still give passed over, one that does not fit yet stopping its size; the set rule for a set's release), a
 *             piece in a turn or a hold coming back at its deadline for the first batch after it ("it moves later while
 *             pieces are held", ANSWERS r2), the hold counted (D16: the first batch at T0 + the hold); an entry beyond
 *             every piece still gets a time from its order among those left (ANSWERS r3: the time always shows); while
 *             PAUSE or PAUSE PACE holds, the clock frozen at the pause's start, so the time shown stays (D17) and moves
 *             later at the first reading after RESUME;
 *   next      whoever the next scheduled batch or one extra batch (NEXT BATCH NOW) could reach (D9, ANSWERS r4: "Whoever a
 *             batch can reach next sees every change each second (a turn lasts 30 s, so they must)"), by the per-entry
 *             rule: an entry e that its sizes can serve is next when (1) in each of its sizes, the pieces wanted by e and
 *             by the entries ahead of it there (those a batch passes over aside) are at most the pieces not confirmed
 *             (free + held), and (2) the entries ahead of e that a batch would surely serve number fewer than 2·X:
 *             every entry ahead of e in its sizes but those passed over, and, elsewhere, those the pieces free now
 *             serve by the batches' own rule (free pieces only grow until a turn is given, so those turns are sure;
 *             held pieces never counted outside e's sizes), each counted once. So a piece that returns can only reach
 *             someone already streaming. In an after-room (no pace, D29) every QUEUED entry is next;
 *   out       its size can no longer serve its quantity (stock − confirmed < quantity; a set's, in one of its sizes):
 *             SOLD OUT for your size (D27);
 *   beyond    its place in a size is past the pieces of that size not yet confirmed (the console's figure, D11);
 *   pollMs    behind the next ones (no stream: http/live-stream.ts), how soon its page reads its state again: a quarter
 *             of its estimate, within LIVE_QUEUE_FAR_POLL_MS (10 s to a minute, 30 s while paused), in whole seconds;
 *             null while it is next. A function of its own `waitMs` alone, so it says nothing of the pace (D8: the gap Y
 *             never reaches a phone). An entry that becomes next between two of its readings is covered by G2: a batch
 *             after the first waits for the reading of every entry it would reach, up to READ_WAIT_MS (live-frames.ts),
 *             the far-poll maximum.
 *
 * The close guard (D10, ANSWERS B10: "a console warning (EXTEND / SET PACE / NEXT BATCH NOW), advice only", e.g.
 * « AT THIS PACE, 120 PIECES REMAIN AT THE CLOSE »).
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { DropRow } from '../db/schema.js';

/** The close guard: the pieces the pace cannot offer before the close. */
export interface LiveCloseGuard {
  remain: number;
}

const SECOND = 1000;
const MINUTE_MS = 60_000;

/**
 * How soon a page whose entry waits behind the next ones reads its state (it holds no stream): a quarter of its
 * estimate, within `min` and `max`; `held` while the pace is held (PAUSE, PAUSE PACE). Whole seconds.
 */
export const LIVE_QUEUE_FAR_POLL_MS = Object.freeze({ min: 10_000, max: 60_000, held: 30_000 });

/**
 * The turns the pace can still give before the close: the batches left, from the next one every Y minutes, each strictly
 * before `closesAt`, times X; the pieces not confirmed yet less that, when above 0. Null once the release has ended, or
 * when the pace can offer every piece left. Nothing automatic follows from it.
 */
export function closeGuard(p: { batch: number; minutes: number; nextAt: Date; closesAt: Date; ended: boolean; notConfirmed: number }): LiveCloseGuard | null {
  if (p.ended || p.notConfirmed <= 0) return null;
  const next = new Date(p.nextAt).getTime();
  const close = new Date(p.closesAt).getTime();
  const step = p.minutes * MINUTE_MS;
  const batches = next < close && step > 0 ? Math.ceil((close - next) / step) : 0;
  const remain = p.notConfirmed - batches * p.batch;
  return remain > 0 ? { remain } : null;
}

// ── The snapshot ───────────────────────────────────────────────────────────

/** What holds the queue's batches: the release's PAUSE, the pace's PAUSE PACE, or nothing. */
export type LiveQueuePause = 'RELEASE' | 'PACE' | null;

/** One QUEUED entry's figures in the snapshot (the module's header says each). */
export interface LiveQueuePlace {
  place: number;
  /** From the snapshot's time (frozen at the pause's start while paused); null in an after-room (no time, D29). */
  waitMs: number | null;
  /** The estimated turn, ms since the epoch; null in an after-room. */
  estimatedAt: number | null;
  next: boolean;
  out: boolean;
  beyond: boolean;
  /** Null while it is next (it streams), and in an after-room. */
  pollMs: number | null;
}

/** A release's queue at one moment: built once per frame, read entry by entry. */
export interface LiveQueueSnapshot {
  dropId: string;
  /** When it was built (ms, the service's clock). */
  at: number;
  /** What holds the batches now. */
  paused: LiveQueuePause;
  /** Each QUEUED entry by its id. */
  entries: ReadonlyMap<string, LiveQueuePlace>;
}

/** A size as the snapshot reads it: its stock, the pieces of its entries in a turn, held, confirmed, and when each held piece comes back. */
export interface QueueSizeInput {
  id: string;
  stock: number;
  turn: number;
  secured: number;
  confirmed: number;
  /** The deadline (ms) of each piece in a turn or a hold, one per piece. */
  returns: readonly number[];
}

/** A QUEUED entry, in the order of the turns. */
export interface QueueEntryInput {
  id: string;
  /** Its size; a set's entry, each of its sizes. */
  sizeIds: readonly string[];
  quantity: number;
}

/** The pace as the snapshot reads it; null in an after-room. */
export interface QueuePaceInput {
  batch: number;
  minutes: number;
  /** The next batch due (T0 + the hold before the first), ms. */
  nextAt: number;
  paused: LiveQueuePause;
  /** When the pause in progress began (the earlier of the two), ms; null when none. */
  pausedSince: number | null;
}

export interface QueueInput {
  now: number;
  pace: QueuePaceInput | null;
  sizes: readonly QueueSizeInput[];
  /** In the order of the turns. */
  entries: readonly QueueEntryInput[];
}

/**
 * How soon a page behind the next ones reads its state again (LIVE_QUEUE_FAR_POLL_MS): from its own estimate only, never
 * the pace (D8: "never batch size, gap"), so no reading gives the gap away (`waitMs − 2·pollMs` was Y when it read
 * half the time until it could be next).
 */
export function queuePollMs(waitMs: number, paused: boolean): number {
  const { min, max, held } = LIVE_QUEUE_FAR_POLL_MS;
  if (paused) return held;
  return Math.min(max, Math.max(min, Math.round(waitMs / 4 / SECOND) * SECOND));
}

/** The non-empty subsets of a few sizes (a set's entry has at most four), each with its inclusion–exclusion sign. */
function subsets(sizes: readonly number[]): { key: string; sign: number }[] {
  const sorted = [...sizes].sort((a, b) => a - b);
  const out: { key: string; sign: number }[] = [];
  for (let mask = 1; mask < 1 << sorted.length; mask++) {
    const part = sorted.filter((_, i) => mask & (1 << i));
    out.push({ key: part.join(','), sign: part.length % 2 === 1 ? 1 : -1 });
  }
  return out;
}

/** Each QUEUED entry's figures (the module's header): pure. */
export function queuePlaces(input: QueueInput): Map<string, LiveQueuePlace> {
  const out = new Map<string, LiveQueuePlace>();
  const entries = input.entries;
  const n = entries.length;
  if (n === 0) return out;
  const index = new Map(input.sizes.map((s, k) => [s.id, k] as const));
  const S = input.sizes.length;
  const servable = input.sizes.map((s) => s.stock - s.confirmed);
  const freeNow = input.sizes.map((s) => Math.max(0, s.stock - s.turn - s.secured - s.confirmed));
  const sizesOf = entries.map((e) => [...new Set(e.sizeIds)].map((id) => index.get(id)).filter((x): x is number => x !== undefined));
  // A batch passes over an entry its sizes can no longer serve (setTurns, batchGrants).
  const out_ = entries.map((e, k) => sizesOf[k]!.length === 0 || sizesOf[k]!.some((s) => e.quantity > servable[s]!));

  // The place in its size (a set's: the most in any of its sizes), and beyond the pieces not yet confirmed.
  const counted = new Array<number>(S).fill(0);
  const place = new Array<number>(n);
  const beyond = new Array<boolean>(n);
  for (let k = 0; k < n; k++) {
    const own = sizesOf[k]!;
    place[k] = 1 + own.reduce((m, s) => Math.max(m, counted[s]!), 0);
    beyond[k] = own.some((s) => counted[s]! + 1 > servable[s]!);
    for (const s of own) counted[s]! += 1;
  }

  const pace = input.pace;
  if (!pace) {
    // An after-room (D29): no pace, no time; its turns go at once, so every QUEUED entry follows its stream.
    for (let k = 0; k < n; k++) out.set(entries[k]!.id, { place: place[k]!, waitMs: null, estimatedAt: null, next: true, out: out_[k]!, beyond: beyond[k]!, pollMs: null });
    return out;
  }

  const X = Math.max(1, pace.batch);
  const gap = Math.max(1, pace.minutes) * MINUTE_MS;
  // While paused the clock stands at the pause's start: the time shown stays frozen (D17).
  const clock = pace.paused !== null && pace.pausedSince !== null ? Math.min(input.now, pace.pausedSince) : input.now;
  const first = Math.max(pace.nextAt, clock);

  // The estimate: the batches simulated as the engine gives them.
  const avail = freeNow.slice();
  const returns = input.sizes.map((s) => [...s.returns].sort((a, b) => a - b));
  const returned = new Array<number>(S).fill(0);
  const lists: number[][] = Array.from({ length: S }, () => []);
  for (let k = 0; k < n; k++) for (const s of sizesOf[k]!) lists[s]!.push(k);
  const head = new Array<number>(S).fill(0);
  const batchOf = new Array<number>(n).fill(-1);
  const done = (k: number) => batchOf[k]! >= 0 || out_[k]!;
  let remaining = out_.filter((x) => !x).length;
  let b = 0;
  while (remaining > 0) {
    const t = first + b * gap;
    for (let s = 0; s < S; s++) {
      const r = returns[s]!;
      while (returned[s]! < r.length && r[returned[s]!]! <= t) {
        avail[s]! += 1;
        returned[s]! += 1;
      }
    }
    const stopped = new Array<boolean>(S).fill(false);
    let grants = 0;
    for (;;) {
      // The first entry in the order of the turns among the sizes still giving.
      let best = -1;
      for (let s = 0; s < S; s++) {
        if (stopped[s]) continue;
        const list = lists[s]!;
        while (head[s]! < list.length && done(list[head[s]!]!)) head[s]! += 1;
        if (head[s]! < list.length && (best < 0 || list[head[s]!]! < best)) best = list[head[s]!]!;
      }
      if (best < 0) break;
      const own = sizesOf[best]!;
      const q = entries[best]!.quantity;
      // One that does not fit yet stops its sizes (those behind it there wait).
      if (own.some((s) => stopped[s] || q > avail[s]!)) {
        for (const s of own) stopped[s] = true;
        continue;
      }
      batchOf[best] = b;
      for (const s of own) avail[s]! -= q;
      remaining -= 1;
      grants += 1;
      if (grants >= X) break;
    }
    if (remaining === 0) break;
    if (grants === 0) {
      // Nothing to give until a held piece comes back: the first batch after it.
      let back = Infinity;
      for (let s = 0; s < S; s++) if (returned[s]! < returns[s]!.length) back = Math.min(back, returns[s]![returned[s]!]!);
      if (!Number.isFinite(back)) break;
      b = Math.max(b + 1, Math.ceil((back - first) / gap));
    } else b += 1;
  }
  // Beyond every piece (or passed over): a time from its order among those left, X a batch (the time always shows).
  let left = 0;
  for (let k = 0; k < n; k++) {
    if (batchOf[k]! >= 0) continue;
    batchOf[k] = b + Math.floor(left / X);
    left += 1;
  }

  // The turns sure now: the batches' own rule (setTurns) on the pieces free now.
  const sure = new Array<boolean>(n).fill(false);
  {
    const free = freeNow.slice();
    const held = new Array<boolean>(S).fill(false);
    for (let k = 0; k < n; k++) {
      if (out_[k]) continue;
      const own = sizesOf[k]!;
      const q = entries[k]!.quantity;
      if (own.some((s) => held[s] || q > free[s]!)) {
        for (const s of own) held[s] = true;
        continue;
      }
      sure[k] = true;
      for (const s of own) free[s]! -= q;
    }
  }

  // `next` by the per-entry rule: running counts, by set of sizes, of the entries ahead (inclusion–exclusion).
  const ahead = new Map<string, number>();
  const sureAhead = new Map<string, number>();
  let sureAll = 0;
  const wanted = new Array<number>(S).fill(0);
  const paused = pace.paused !== null;
  for (let k = 0; k < n; k++) {
    const own = sizesOf[k]!;
    const q = entries[k]!.quantity;
    const parts = subsets(own);
    let touching = 0;
    let sureTouching = 0;
    for (const p of parts) {
      touching += p.sign * (ahead.get(p.key) ?? 0);
      sureTouching += p.sign * (sureAhead.get(p.key) ?? 0);
    }
    const before = touching + (sureAll - sureTouching);
    const fits = !out_[k] && own.every((s) => wanted[s]! + q <= servable[s]!);
    const next = fits && before < 2 * X;
    const waitMs = Math.max(0, Math.round((first + batchOf[k]! * gap - clock) / SECOND) * SECOND);
    out.set(entries[k]!.id, {
      place: place[k]!,
      waitMs,
      estimatedAt: clock + waitMs,
      next,
      out: out_[k]!,
      beyond: beyond[k]!,
      pollMs: next ? null : queuePollMs(waitMs, paused),
    });
    if (!out_[k]) {
      for (const p of parts) ahead.set(p.key, (ahead.get(p.key) ?? 0) + 1);
      for (const s of own) wanted[s]! += q;
    }
    if (sure[k]) {
      for (const p of parts) sureAhead.set(p.key, (sureAhead.get(p.key) ?? 0) + 1);
      sureAll += 1;
    }
  }
  return out;
}

/** The release's row as the snapshot reads it. */
export type LiveQueueRow = Pick<DropRow, 'id' | 'set_id' | 'opens_at' | 'paused_at' | 'pace_batch' | 'pace_minutes' | 'pace_paused_at' | 'pace_next_at' | 'pace_hold_minutes'>;

/**
 * The queue's snapshot of a release at `now` (the module's header): three reads (its sizes with the pieces confirmed,
 * the pieces in a turn or a hold with their deadlines, its QUEUED entries in the order of the turns), then `queuePlaces`.
 */
export async function liveQueueSnapshot(db: Db, d: LiveQueueRow, now: Date): Promise<LiveQueueSnapshot> {
  const set = d.set_id !== null;
  const [sizes, holding, queued] = await Promise.all([
    set
      ? sql<{ id: string; stock: number; confirmed: number | string | null }>`
          SELECT s.id, s.stock, (SELECT sum(e.quantity) FROM live_entry_sizes x JOIN live_entries e ON e.id = x.entry_id
                                  WHERE x.size_id = s.id AND e.status = 'CONFIRMED') AS confirmed
            FROM drop_sizes s WHERE s.drop_id = ${d.id} ORDER BY s.position`.execute(db)
      : sql<{ id: string; stock: number; confirmed: number | string | null }>`
          SELECT s.id, s.stock, (SELECT sum(e.quantity) FROM live_entries e WHERE e.size_id = s.id AND e.drop_id = ${d.id} AND e.status = 'CONFIRMED') AS confirmed
            FROM drop_sizes s WHERE s.drop_id = ${d.id} ORDER BY s.position`.execute(db),
    set
      ? sql<{ size_id: string; status: string; quantity: number; turn_expires_at: Date | null; hold_expires_at: Date | null }>`
          SELECT x.size_id, e.status, e.quantity, e.turn_expires_at, e.hold_expires_at
            FROM live_entry_sizes x JOIN live_entries e ON e.id = x.entry_id
           WHERE e.drop_id = ${d.id} AND e.status IN ('TURN', 'SECURED')`.execute(db)
      : sql<{ size_id: string; status: string; quantity: number; turn_expires_at: Date | null; hold_expires_at: Date | null }>`
          SELECT size_id, status, quantity, turn_expires_at, hold_expires_at
            FROM live_entries WHERE drop_id = ${d.id} AND status IN ('TURN', 'SECURED')`.execute(db),
    set
      ? sql<{ id: string; quantity: number; size_id: string }>`
          SELECT e.id, e.quantity, x.size_id
            FROM live_entries e JOIN live_entry_sizes x ON x.entry_id = e.id
           WHERE e.drop_id = ${d.id} AND e.status = 'QUEUED'
           ORDER BY e.position, e.id, x.piece`.execute(db)
      : sql<{ id: string; quantity: number; size_id: string }>`
          SELECT id, quantity, size_id
            FROM live_entries WHERE drop_id = ${d.id} AND status = 'QUEUED'
           ORDER BY (guarantee_id IS NULL), position, id`.execute(db),
  ]);
  const bySize = new Map<string, QueueSizeInput & { returns: number[] }>();
  for (const s of sizes.rows) bySize.set(s.id, { id: s.id, stock: Number(s.stock), turn: 0, secured: 0, confirmed: Number(s.confirmed ?? 0), returns: [] });
  for (const h of holding.rows) {
    const s = bySize.get(h.size_id);
    if (!s) continue;
    const q = Number(h.quantity);
    const until = h.status === 'TURN' ? h.turn_expires_at : h.hold_expires_at;
    if (h.status === 'TURN') s.turn += q;
    else s.secured += q;
    for (let i = 0; i < q; i++) s.returns.push(until ? new Date(until).getTime() : Infinity);
  }
  const entries: { id: string; sizeIds: string[]; quantity: number }[] = [];
  for (const r of queued.rows) {
    const last = entries.at(-1);
    if (last?.id === r.id) last.sizeIds.push(r.size_id);
    else entries.push({ id: r.id, sizeIds: [r.size_id], quantity: Number(r.quantity) });
  }
  const paused: LiveQueuePause = d.paused_at ? 'RELEASE' : d.pace_paused_at ? 'PACE' : null;
  const since = [d.paused_at, d.pace_paused_at].filter((x): x is Date => x !== null).map((x) => new Date(x).getTime());
  const paced = d.pace_batch !== null && d.pace_minutes !== null;
  const nextAt = paced ? (d.pace_next_at ? new Date(d.pace_next_at).getTime() : new Date(d.opens_at).getTime() + Number(d.pace_hold_minutes ?? 0) * MINUTE_MS) : 0;
  const at = now.getTime();
  return {
    dropId: d.id,
    at,
    paused,
    entries: queuePlaces({
      now: at,
      pace: paced ? { batch: d.pace_batch!, minutes: d.pace_minutes!, nextAt, paused, pausedSince: since.length ? Math.min(...since) : null } : null,
      sizes: [...bySize.values()],
      entries,
    }),
  };
}

/** What a phone reads of its own entry while it is QUEUED (LiveEntryView.queue): never the pace, never the line. */
export interface LiveQueueView {
  /** Its place in its size (a set's entry: the most in any of its sizes). */
  place: number;
  /** Its estimated wait, from the reading's time (frozen while paused); null in an after-room (no time). */
  waitMs: number | null;
  /** What holds the batches: the release's PAUSE, PAUSE PACE, or nothing. */
  paused: LiveQueuePause;
  /** It follows the stream (a batch can reach it next); otherwise it reads its state as `pollMs` says. */
  next: boolean;
  /** Its size can no longer serve it: SOLD OUT for your size. */
  out: boolean;
}

/** An entry's own figures from the snapshot, read at `now` (ms): its estimate counted down to then, unless paused. */
export function queueView(snapshot: LiveQueueSnapshot, entryId: string, now: number): LiveQueueView | null {
  const p = snapshot.entries.get(entryId);
  if (!p) return null;
  const waitMs = p.waitMs === null ? null : snapshot.paused !== null || p.estimatedAt === null ? p.waitMs : Math.max(0, Math.round((p.estimatedAt - now) / SECOND) * SECOND);
  return { place: p.place, waitMs, paused: snapshot.paused, next: p.next, out: p.out };
}
