/**
 * What the collector looks at, and for how long (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.9, step 3.8): the
 * pure part of the recording, tested with a fake clock (test/web/seen-model.test.ts). The glue (the page's events, the
 * timers, the request) is seen.ts; the server is POST /api/v1/seen (routes/seen.ts, API §8.14). Nothing here is drawn,
 * and no word is added to copy.ts.
 *
 *   pageOf      the screen on show → its page and subject (a model's slug, a release's or a post's id, a piece's serial),
 *               or null for the screens never recorded: the scan itself, VERIFYING…, a problem of the scan, a LIVE
 *               RELEASE's boutique board (a shop's screen) and the password screen.
 *   ViewClock   the time a view is in front: it pauses while the page is hidden and after IDLE_MS without a touch, a key
 *               or a scroll (but on a LIVE room and a scan's result, watched without touching), and resumes on input or
 *               when the page shows again; a new screen counts from its showing (the collector's doing). A claim (the account sheet and its views, the sign-in and create-account
 *               panel) pauses the view under it and counts its own, then gives the time back to the view under it. A
 *               view under VIEW_MIN_MS is not one; a view's time is capped (VIEW_MAX_MS, VIEW_MAX_MS_LIVE).
 *   SeenQueue   the finished views wait in memory (never in storage), the consecutive views of one page and subject
 *               merged, at most QUEUE_MAX (the oldest dropped first); sent every 30 s ± 10 s while it holds some, at once
 *               when the page is hidden or closed, and never during a LIVE room but on hide or close (5 000 phones in a
 *               room at T0 send nothing). A batch refused for the rate (429), or not answered, is kept for the next
 *               send; one refused as malformed (400) is dropped.
 */

/** Every page the app names (the server's VIEW_PAGES but SCAN, which only the server writes; checked by test/web/seen-model.test.ts). */
export const SEEN_PAGE_NAMES = [
  'NOW',
  'RESULT',
  'MY_PIECES',
  'MY_ORDERS',
  'MY_RELEASES',
  'PIECE',
  'CERTIFICATE',
  'COLLECTION',
  'MODEL',
  'CLUB',
  'RELEASES',
  'RELEASE',
  'LIVE',
  'AFTER_ROOM',
  'HOW',
  'CIRCLE',
  'POST',
  'ACCOUNT',
  'MESSAGES',
  'SIGN_IN',
  'SIGN_UP',
  'SIZES',
  'ADDRESSES',
  'PROFILE',
  'WISHLIST',
] as const;
export type SeenPageName = (typeof SEEN_PAGE_NAMES)[number];

/** A view: its page and, for a model, a release, a post or a piece, its subject. */
export interface SeenView {
  page: SeenPageName;
  subject?: string | null;
}

/** Without a touch, a key or a scroll this long, a view stops counting (but a LIVE room and a scan's result). */
export const IDLE_MS = 120_000;
/** A view shorter than this is not one (the server drops it too). */
export const VIEW_MIN_MS = 1_000;
/** A view's time at most: a screen left open is not a look. */
export const VIEW_MAX_MS = 1_800_000;
/** A LIVE room's time at most. */
export const VIEW_MAX_MS_LIVE = 10_800_000;
/** The views a batch holds at most (the server's BATCH_MAX_EVENTS). */
export const BATCH_MAX = 50;
/** The views held while they cannot be sent (offline), the oldest dropped first. */
export const QUEUE_MAX = 100;
/** A send every FLUSH_MS ± FLUSH_JITTER_MS while views wait. */
export const FLUSH_MS = 30_000;
export const FLUSH_JITTER_MS = 10_000;
/** A view begun this long ago is too old to place: never sent (the server takes `ago` below 24 h). */
export const VIEW_MAX_AGE_MS = 86_400_000;
/** A subject longer than this is never sent (the server's limit). */
export const SUBJECT_MAX = 80;

// ── pageOf ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The app's screens (main.ts `Screen`). */
export type SeenScreen =
  | 'landing'
  | 'scan'
  | 'verifying'
  | 'result'
  | 'message'
  | 'pieces'
  | 'piece'
  | 'certificate'
  | 'lookbook'
  | 'sheet'
  | 'releases'
  | 'release'
  | 'live'
  | 'board'
  | 'circle'
  | 'circlePost'
  | 'club'
  | 'how'
  | 'wishlist';

/** What the app holds beside its screen, for the subject. */
export interface SeenAppState {
  piecesTab: 'pieces' | 'orders' | 'releases';
  pieceId: string | null;
  sheetSlug: string | null;
  releaseId: string | null;
  /** The LIVE RELEASE's page shown is the after-room. */
  releaseAfterRoom: boolean;
  /** The LIVE RELEASE's page shows its room (the vault, without the chrome), not its page before or after the room. */
  liveRoom: boolean;
  postId: string | null;
}

/** The view of a screen, or null when the screen is never recorded. */
export function pageOf(screen: SeenScreen, state: SeenAppState): SeenView | null {
  switch (screen) {
    case 'landing':
      return { page: 'NOW' };
    case 'result':
      return { page: 'RESULT' };
    case 'pieces':
      return { page: state.piecesTab === 'orders' ? 'MY_ORDERS' : state.piecesTab === 'releases' ? 'MY_RELEASES' : 'MY_PIECES' };
    case 'piece':
      return { page: 'PIECE', subject: state.pieceId };
    case 'certificate':
      return { page: 'CERTIFICATE' };
    case 'lookbook':
      return { page: 'COLLECTION' };
    case 'sheet':
      return { page: 'MODEL', subject: state.sheetSlug };
    case 'club':
      return { page: 'CLUB' };
    case 'releases':
      return { page: 'RELEASES' };
    case 'release':
      return { page: 'RELEASE', subject: state.releaseId };
    case 'live':
      return { page: state.releaseAfterRoom ? 'AFTER_ROOM' : state.liveRoom ? 'LIVE' : 'RELEASE', subject: state.releaseId };
    case 'how':
      return { page: 'HOW' };
    case 'circle':
      return { page: 'CIRCLE' };
    case 'circlePost':
      return { page: 'POST', subject: state.postId };
    case 'wishlist':
      return { page: 'WISHLIST' };
    // The scan, VERIFYING…, a problem of the scan, the boutique board: never recorded.
    default:
      return null;
  }
}

/** The account sheet's views (views/account.ts): the password screen is never recorded. */
export function accountPageOf(view: 'account' | 'password' | 'messages' | 'sizes' | 'addresses' | 'profile'): SeenPageName | null {
  switch (view) {
    case 'account':
      return 'ACCOUNT';
    case 'messages':
      return 'MESSAGES';
    case 'sizes':
      return 'SIZES';
    case 'addresses':
      return 'ADDRESSES';
    case 'profile':
      return 'PROFILE';
    default:
      return null;
  }
}

// ── ViewClock ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A view finished (or cut at a hide): its page, subject, time in front and when it began (the page's clock). */
export interface FinishedView {
  page: SeenPageName;
  subject: string | null;
  ms: number;
  began: number;
}

interface Record {
  page: SeenPageName;
  subject: string | null;
  ms: number;
  began: number;
}

interface Claim {
  owner: object;
  rec: Record | null;
  live: () => boolean;
  /** It was in front once: gone from the page since (`live` false), it is finished at the next screen. */
  wasLive: boolean;
}

const sameView = (a: { page: string; subject: string | null }, b: { page: string; subject: string | null }) => a.page === b.page && a.subject === b.subject;
const subjectOf = (s: string | null | undefined): string | null => (typeof s === 'string' && s.length > 0 ? s : null);

/**
 * The time each view is in front (see the header). Every method takes the page's clock (`now`, ms) and first counts the
 * time since the last call for the view in front; finished views go to `onFinish`.
 */
export class ViewClock {
  private base: Record | null = null;
  private claims: Claim[] = [];
  private visible = true;
  private lastInput: number;
  private mark: number;
  /** The view in front since the last mark: the time up to the next call is its (a claim's `live` read at each call). */
  private current: Record | null = null;

  constructor(
    private readonly onFinish: (v: FinishedView) => void,
    now: number,
    private readonly idleMs = IDLE_MS,
  ) {
    this.lastInput = now;
    this.mark = now;
  }

  /** The view counting now (a live claim on top, else the screen), or null. */
  front(): SeenView | null {
    const r = this.frontRecord();
    return r ? { page: r.page, subject: r.subject } : null;
  }

  /** After every call: the view in front from now on. */
  private settle(): void {
    for (const c of this.claims) if (c.live()) c.wasLive = true;
    this.current = this.frontRecord();
  }

  /** The screen changed: its view (null: never recorded) takes the place of the one before, which is finished. */
  show(view: SeenView | null, now: number): void {
    this.account(now);
    const next = view ? { page: view.page, subject: subjectOf(view.subject) } : null;
    if (next && this.base && sameView(this.base, next)) return this.settle();
    this.finish(this.base);
    this.base = next ? { ...next, ms: 0, began: now } : null;
    // A new screen is the collector's doing: it counts from now, whatever the time since the last touch.
    this.lastInput = now;
    // A claim that was in front and has left the page since (its panel gone with the screen) is finished.
    for (const c of [...this.claims]) {
      if (c.wasLive && !c.live()) this.drop(c);
    }
    this.settle();
  }

  /**
   * `owner` (the account sheet, a sign-in panel) covers the screen while `live()` holds: its page counts (null: it
   * pauses the view under it and records nothing, the password screen). Claimed again with another page, its view
   * before is finished; with the same, nothing changes.
   */
  claim(owner: object, page: SeenPageName | null, live: () => boolean, now: number): void {
    this.account(now);
    const existing = this.claims.find((c) => c.owner === owner);
    if (existing) {
      existing.live = live;
      const same = existing.rec ? page !== null && sameView(existing.rec, { page, subject: null }) : page === null;
      if (!same) {
        this.finish(existing.rec);
        existing.rec = page ? { page, subject: null, ms: 0, began: now } : null;
      }
      return this.settle();
    }
    this.claims.push({ owner, rec: page ? { page, subject: null, ms: 0, began: now } : null, live, wasLive: false });
    this.settle();
  }

  /** `owner` no longer covers the screen: its view is finished, and the view under it counts again. */
  release(owner: object, now: number): void {
    this.account(now);
    const c = this.claims.find((x) => x.owner === owner);
    if (c) this.drop(c);
    this.settle();
  }

  /** A touch, a key or a scroll: the view counts again if it had stopped. */
  input(now: number): void {
    this.account(now);
    this.lastInput = now;
    this.settle();
  }

  /** The page hidden or shown again (shown: as an input). */
  visibility(visible: boolean, now: number): void {
    this.account(now);
    this.visible = visible;
    if (visible) this.lastInput = now;
    this.settle();
  }

  /** Count the time up to `now` (a timer's tick, a send). */
  tick(now: number): void {
    this.account(now);
    this.settle();
  }

  /**
   * The page hidden or closing: every view open is given to `onFinish` as it stands, then goes on from zero (counted
   * again as a new view if the collector comes back to it).
   */
  cut(now: number): void {
    this.account(now);
    for (const r of [this.base, ...this.claims.map((c) => c.rec)]) {
      if (!r) continue;
      if (r.ms >= VIEW_MIN_MS) this.emit(r);
      r.ms = 0;
      r.began = now;
    }
    this.settle();
  }

  private frontRecord(): Record | null {
    for (let i = this.claims.length - 1; i >= 0; i--) {
      const c = this.claims[i]!;
      if (c.live()) return c.rec;
    }
    return this.base;
  }

  /** Add the time since the last mark to the view in front, as long as the page is shown and not idle. */
  private account(now: number): void {
    const from = this.mark;
    this.mark = Math.max(this.mark, now);
    if (!this.visible || now <= from) return;
    const r = this.current;
    if (!r) return;
    const watched = r.page === 'LIVE' || r.page === 'RESULT';
    const until = watched ? now : Math.min(now, this.lastInput + this.idleMs);
    if (until > from) r.ms += until - from;
  }

  private drop(c: Claim): void {
    this.finish(c.rec);
    if (this.current === c.rec) this.current = null;
    this.claims = this.claims.filter((x) => x !== c);
  }

  private finish(r: Record | null): void {
    if (r && r.ms >= VIEW_MIN_MS) this.emit(r);
  }

  private emit(r: Record): void {
    const cap = r.page === 'LIVE' ? VIEW_MAX_MS_LIVE : VIEW_MAX_MS;
    this.onFinish({ page: r.page, subject: r.subject, ms: Math.min(Math.round(r.ms), cap), began: r.began });
  }
}

// ── SeenQueue ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/seen's body (http/schemas.ts seenBody; the arrival `a` comes with plan step 4.7). */
export interface SeenBatchBody {
  v: 1;
  d: { s: boolean; t: number; w: number };
  e: { p: SeenPageName; s?: string; ms: number; ago: number }[];
}

/** What a send came to: sent, kept for the next send (429, no answer), or dropped (refused as malformed). */
export type SeenSendResult = 'sent' | 'retry' | 'drop';

export interface SeenQueueDeps {
  /** The device's own words (`d`), read once. */
  device: { s: boolean; t: number; w: number };
  send(batch: SeenBatchBody): Promise<SeenSendResult>;
  /** The page's clock, read again after a batch is sent (the next batch's `ago`); the `now` given otherwise. */
  now?: () => number;
  /** [0, 1): the send's rhythm (tests give a fixed one). */
  random?: () => number;
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : 0)));

/** The finished views waiting to be sent (see the header). */
export class SeenQueue {
  private items: FinishedView[] = [];
  /** The views of the batch being sent: never merged into, so nothing pushed meanwhile is lost with them. */
  private inFlight = new Set<FinishedView>();
  private due: number | null = null;
  private sending: Promise<void> | null = null;
  private readonly device: SeenBatchBody['d'];
  private readonly random: () => number;

  constructor(private readonly deps: SeenQueueDeps) {
    this.device = { s: deps.device.s === true, t: clampInt(deps.device.t, 0, 20), w: clampInt(deps.device.w, 0, 10_000) };
    this.random = deps.random ?? Math.random;
  }

  /** The views waiting, oldest first (tests). */
  get size(): number {
    return this.items.length;
  }

  /** When the next send is due (the page's clock), or null while nothing waits. */
  get dueAt(): number | null {
    return this.due;
  }

  /** A finished view: merged into the last one waiting when it is the same page and subject. */
  push(v: FinishedView, now: number): void {
    const last = this.items[this.items.length - 1];
    if (last && !this.inFlight.has(last) && last.page === v.page && last.subject === v.subject) {
      const cap = v.page === 'LIVE' ? VIEW_MAX_MS_LIVE : VIEW_MAX_MS;
      last.ms = Math.min(cap, last.ms + v.ms);
      last.began = Math.min(last.began, v.began);
    } else {
      this.items.push({ ...v });
      if (this.items.length > QUEUE_MAX) this.items.splice(0, this.items.length - QUEUE_MAX);
    }
    this.due ??= this.nextDue(now);
  }

  /** The timer's turn: sends when due, unless the view in front is a LIVE room (it waits for a hide or a close). */
  tick(now: number, front: SeenView | null): Promise<void> | null {
    if (this.due === null || now < this.due || front?.page === 'LIVE') return null;
    return this.flush(now);
  }

  /**
   * Send what waits, BATCH_MAX views a batch, now (a hide, a close, the timer). Views older than VIEW_MAX_AGE_MS are
   * dropped; a batch kept (429, no answer) stops the send until the next turn. Never thrown.
   */
  flush(now: number): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.run(now).finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async run(now: number): Promise<void> {
    this.items = this.items.filter((v) => now - v.began < VIEW_MAX_AGE_MS);
    while (this.items.length > 0) {
      const batch = this.items.slice(0, BATCH_MAX);
      const body: SeenBatchBody = {
        v: 1,
        d: this.device,
        e: batch.map((v) => {
          const e: SeenBatchBody['e'][number] = { p: v.page, ms: clampInt(v.ms, 0, VIEW_MAX_MS_LIVE), ago: clampInt(now - v.began, 0, VIEW_MAX_AGE_MS - 1) };
          if (v.subject !== null && v.subject.length <= SUBJECT_MAX) e.s = v.subject;
          return e;
        }),
      };
      let result: SeenSendResult;
      this.inFlight = new Set(batch);
      try {
        result = await this.deps.send(body);
      } catch {
        result = 'retry';
      } finally {
        this.inFlight = new Set();
      }
      if (result === 'retry') {
        this.due = this.items.length > 0 ? this.nextDue(now) : null;
        return;
      }
      // Sent, or refused as malformed: those views go (views pushed meanwhile stay).
      const sent = new Set(batch);
      this.items = this.items.filter((v) => !sent.has(v));
      now = Math.max(now, this.deps.now?.() ?? now);
    }
    this.due = null;
  }

  private nextDue(now: number): number {
    return now + FLUSH_MS - FLUSH_JITTER_MS + Math.floor(this.random() * 2 * FLUSH_JITTER_MS);
  }
}
