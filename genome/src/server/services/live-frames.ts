/**
 * At most one batch per frame (lot Q1, plan §1.2; ANSWERS r4: "Whoever a batch can reach next sees every change each
 * second (a turn lasts 30 s, so they must)"; B: "whoever a batch can reach next reads every second").
 *
 * A LIVE RELEASE's queue is read by its phones through frames: the room as LiveRoomService.frame builds it, published
 * once a second by the live streams (http/live-stream.ts LiveHub) to those who follow it, and cached for those who poll
 * it. Whoever the next batch (or one extra batch, NEXT BATCH NOW) can reach follows each frame, so two batches must
 * never go out between two frames: the second could reach someone who did not read the change the first made.
 *
 * The gate keeps, per release and in this process's memory (the engine's process: one leads, live-engine.ts):
 *  - `given`: the batches given (scheduled, overdue, NEXT BATCH NOW, an empty one included), counted inside the
 *    transaction that gives one, so a second batch is held from that moment;
 *  - `settled`: `given` once that transaction has ended (committed or not): a frame begun after it reads its outcome;
 *  - `seen`: the newest `settled` a published frame was begun after (−1 before the first frame since the start).
 * A batch goes only while `seen >= given` (`open`): the frame begun after the last batch has been published. So the
 * first batch after a restart waits for the first frame, and overdue slots go one per frame, each keeping its logical
 * time and its number (services/live.ts giveDue).
 *
 * Frames: the hub marks a frame `begin` before it reads it and `published` once sent (or cached, with nobody following:
 * the polling pages read it); `ask` requests one (the engine while a batch waits, a NEXT BATCH NOW waiting for its
 * frame), which the hub builds at most once a pulse. Without a publisher (tests, a script, a process with no hub), a frame
 * asked for counts as published at once.
 *
 * NEXT BATCH NOW pressed while the gate is shut waits here (`pending`), in the order pressed, with its press time: the
 * first pass after the next frame gives it, in the order due among the scheduled slots (services/live.ts giveDue).
 *
 * The readings (PLAN amendment 1, G2: "a batch after the first may only give a turn to an entry whose phone has READ that
 * it is next"): a frame published is not yet a frame read, as a phone further back reads its state every 10 to 60 s. Once
 * switched on (`useReadings`), the gate keeps, per release, the `next` flag of each entry's last reading (`read`: the
 * stream's `you` event, GET /state), and a batch after the first (scheduled, overdue after a restart, or NEXT BATCH NOW
 * pressed again) waits (`unread`) until every entry it would give a turn to has read that it is next, capped at
 * READ_WAIT_MS (60 s, the far-poll limit) after the previous batch was given in this process (after a restart, after the
 * moment it first waited); it keeps its logical time and its number (services/live.ts giveDue). Off, every reading counts
 * as made: a process with no hub (tests, a script), and, until step Q1.3 records the readings from the queue's
 * snapshot `next` and switches it on, the app.
 */

/** How long a batch after the first waits at most for the entries it reaches to read that they are next (the far-poll limit). */
export const READ_WAIT_MS = 60_000;

/** A NEXT BATCH NOW waiting for a fresh frame. */
export interface PendingBatch {
  /** Its press time: the batch's logical time. */
  at: Date;
  /** Who pressed it (the audit's actor). */
  actorId: string;
  /** Settled once given (its number) or refused. */
  done: Promise<number>;
  resolve(batch: number): void;
  reject(e: unknown): void;
  settled: boolean;
  /**
   * Taken by the transaction that gives it (services/live.ts giveDue), until that transaction ends: it cannot be
   * withdrawn meanwhile (its request's wait over, or its request closed), so a press answered "nothing given" is never
   * given afterwards.
   */
  giving: boolean;
}

interface ReleaseFrames {
  given: number;
  settled: number;
  seen: number;
  waiters: (() => void)[];
  pending: PendingBatch[];
  /** The `next` flag of each entry's last reading. */
  readings: Map<string, boolean>;
  /** When the last batch was given in this process (the service's clock), or null. */
  givenAt: number | null;
  /** When a batch first waited for readings since the last batch given (after a restart: the cap counts from it). */
  heldSince: number | null;
}

export class LiveFrameGate {
  private readonly releases = new Map<string, ReleaseFrames>();
  private publisher: ((dropId: string) => Promise<void> | void) | null = null;
  private readingsOn = false;

  /** The hub that builds and publishes frames (http/live-stream.ts); null: a frame asked for is published at once. */
  usePublisher(publisher: ((dropId: string) => Promise<void> | void) | null): void {
    this.publisher = publisher;
  }

  private of(dropId: string): ReleaseFrames {
    let r = this.releases.get(dropId);
    if (!r) this.releases.set(dropId, (r = { given: 0, settled: 0, seen: -1, waiters: [], pending: [], readings: new Map(), givenAt: null, heldSince: null }));
    return r;
  }

  /** Whether a batch may be given now: the frame begun after the last batch has been published. */
  open(dropId: string): boolean {
    const r = this.of(dropId);
    return r.seen >= r.given;
  }

  /** A frame of the release begins (before its reads): what it can see. */
  begin(dropId: string): number {
    return this.of(dropId).settled;
  }

  /** The frame begun with `mark` is published: the gate opens if it was begun after the last batch. */
  published(dropId: string, mark: number): void {
    const r = this.of(dropId);
    r.seen = Math.max(r.seen, mark);
    if (r.seen < r.given) return;
    const waiters = r.waiters.splice(0);
    for (const w of waiters) w();
  }

  /** A batch is being given (inside its transaction) at `at` (the service's clock): the gate shuts. */
  giving(dropId: string, at?: Date): void {
    const r = this.of(dropId);
    r.given += 1;
    if (at) r.givenAt = at.getTime();
    r.heldSince = null;
  }

  /** Whether batches wait for the readings (G2); off, every reading counts as made. */
  useReadings(on: boolean): void {
    this.readingsOn = on;
  }

  /** An entry's phone has read its state: whether that reading said it is next (its last reading counts). */
  read(dropId: string, entryId: string, next: boolean): void {
    this.of(dropId).readings.set(entryId, next);
  }

  /** Whether the entry's last reading said it is next (always, with the readings off). */
  hasReadNext(dropId: string, entryId: string): boolean {
    return !this.readingsOn || this.of(dropId).readings.get(entryId) === true;
  }

  /**
   * Whether a batch after the first, which would give its turns to `entryIds`, waits for their readings at `now`: one of
   * them has not read that it is next, and READ_WAIT_MS have not passed since the previous batch was given in this
   * process (or, after a restart, since the batch first waited). False with the readings off.
   */
  unread(dropId: string, entryIds: readonly string[], now: Date): boolean {
    if (!this.readingsOn) return false;
    const r = this.of(dropId);
    if (entryIds.every((id) => r.readings.get(id) === true)) return false;
    r.heldSince ??= now.getTime();
    const since = r.givenAt ?? r.heldSince;
    return now.getTime() - since < READ_WAIT_MS;
  }

  /** The transaction that may have given a batch has ended: a frame begun from now on reads its outcome. */
  settle(dropId: string): void {
    const r = this.of(dropId);
    r.settled = r.given;
  }

  /**
   * Ask for a frame of the release: the hub's (at most one a pulse; resolves once it is published, or at once when the
   * hub has published one within the pulse), or at once without a hub. Never rejects.
   */
  async ask(dropId: string): Promise<void> {
    if (!this.publisher) {
      this.published(dropId, this.begin(dropId));
      return;
    }
    try {
      await this.publisher(dropId);
    } catch {
      // The hub logs its own failures; the next ask tries again.
    }
  }

  /** Resolves once the gate is open again (at once when it is). */
  whenOpen(dropId: string): Promise<void> {
    if (this.open(dropId)) return Promise.resolve();
    return new Promise((resolve) => this.of(dropId).waiters.push(resolve));
  }

  /** A NEXT BATCH NOW waits for its frame, in the order pressed. */
  press(dropId: string, at: Date, actorId: string): PendingBatch {
    let resolve!: (n: number) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<number>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Its request awaits it; one refused before anyone awaits it is not an unhandled rejection.
    done.catch(() => {});
    const p: PendingBatch = {
      at,
      actorId,
      done,
      settled: false,
      giving: false,
      resolve: (n) => {
        p.settled = true;
        resolve(n);
      },
      reject: (e) => {
        p.settled = true;
        reject(e);
      },
    };
    this.of(dropId).pending.push(p);
    return p;
  }

  /** The first NEXT BATCH NOW still waiting, if any (one a transaction is giving is not: its outcome settles it). */
  firstPending(dropId: string): PendingBatch | null {
    const r = this.of(dropId);
    while (r.pending.length > 0 && r.pending[0]!.settled) r.pending.shift();
    return r.pending.find((p) => !p.giving && !p.settled) ?? null;
  }

  /** A pending batch done with (given or refused): out of the queue. */
  drop(dropId: string, p: PendingBatch): void {
    const r = this.of(dropId);
    const i = r.pending.indexOf(p);
    if (i >= 0) r.pending.splice(i, 1);
  }
}
