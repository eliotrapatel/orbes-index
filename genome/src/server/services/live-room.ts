/**
 * What the LIVE RELEASES show (plan of 2026-10-04, The experience 1–10; services/live.ts holds their rules and actions):
 * the public announcements, each stage at its time; the room as its viewers read it; the boutique board; an account's
 * own entries. Read only.
 *
 * Public (routes/live.ts, no session):
 *   list      THE RELEASES' LIVE tab: every LIVE RELEASE announced and not ended, the next opening first (once ended,
 *             it is in THE RELEASES' PAST, services/past-releases.ts);
 *   sheet     one of them; once over, its final state (plan LIVE RELEASE+, decision 30: what was announced, each part
 *             from its stage as it stood at the end, the opening and the quantity line; never an end figure: no stock,
 *             count, reason or interest);
 *   next      the banner of /verify and MY PIECES: the release live now, else the room open, else the next announced;
 *   calendar  its .ics: the room's opening, an alarm 10 minutes before, the name once revealed, no personal data.
 * Before its announcement (`announce_at`, the publication when NULL; for good when it ended before it), a draft, a
 * cancelled release, a DRAW, an unknown or malformed id: one 404 DROP_NOT_FOUND, on every surface.
 *
 * The staged reveals (`liveStages`): the silhouette at `silhouette_at`, the name at `name_at` (the release's title, the
 * model's name, type and collection, the description), the photograph and the lookbook's link at `photo_at`, each NULL
 * one at the announcement, each never before the one it follows, all of them at the room's opening at the latest. No
 * surface returns a stage before its time: the cards and sheets, the banner, the .ics, the board, and the rule of access
 * wherever it is said, a 403 LIVE_NOT_ELIGIBLE included (live.ts liveAccessRule: a model the rule names that is the
 * release's own is « this model », and its model's collection « this model’s collection », until its name is
 * revealed). The room's snapshots and an account's entry name no
 * stage at all, but for a set's release (macro scope K44 T1): its room's `pieces` name each piece's model from the name's
 * stage and show its photograph from the photograph's, as its card's `set` does.
 *
 * The room (`frame`): built once for all of a release's viewers (routes/live.ts fans it out once a second): its phase,
 * the pieces left and held per size, the people in the room and in the line, the latest host message; and the board's
 * share of it (the countdown, the door, the pieces left overall: no personal data); on a paced release (W2) the queue's
 * small frame too (`LiveQueueFrame`: the next batch, the pace, held or not, the batches, those waiting), which the
 * viewers waiting for their batch read in place of the room. `viewer` says who may read it: a
 * signed-in account allowed to enter the release now, or holding an entry in it (a REMOVED one reads its state but
 * follows no stream); never anyone else (spectator mode was declined).
 *
 * An after-room (services/after-room.ts, plan LIVE RELEASE+ decision 28) is on no public surface: not in the list, the
 * banner, the .ics, the boutique board, nor its own public page (each the 404 of an unknown release). Its guests alone
 * read it, from its T0: its page by its parent's (`afterRoomSheet`, an account's answer, never kept), its room and their
 * own entry (`viewer`); their own entry in the parent says when the second door appears (live.ts LiveEntryView.afterRoom).
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { DropRow, LiveEndReason } from '../db/schema.js';
import { DomainError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { afterRoomPlace, isAfterRoom } from './after-room.js';
import { CALENDAR_ALARM_MINUTES, releaseIcs } from './calendar.js';
import { dropNotFound } from './drops.js';
import {
  accessOf,
  announcedAt,
  isAnnounced,
  liveAccessRule,
  liveBoardTokenHash,
  liveEntryViews,
  liveInterestPieceSizes,
  liveNotEligible,
  livePhase,
  liveRuleText,
  liveStages,
  paceHeld,
  paceNextAt,
  roomOpensAt,
  stagesAt,
  onSaleOf,
  LIVE_OPEN_STATUSES,
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_TURN_SECONDS,
  type LiveAccess,
  type LiveEntryView,
  type LiveInterestView,
  type LivePieceSize,
  type LiveStages,
} from './live.js';
import { mediaUrl } from './media.js';
import { savedSizeAmong } from './sizes.js';
import { releaseOffer, savedSizesByPiece, setPiecesOf, type ReleaseOffer } from './release-offer.js';

/** THE RELEASES' LIVE half lists at most this many releases. */
export const LIVE_LIST_LIMIT = 50;
/**
 * The frame (built once a second) keeps a set's release's offer this long (macro scope K44 T1): its set and pieces never
 * change once it is announced (SetService, live-console.ts), so only a piece's renamed model or new photograph waits for it.
 */
export const LIVE_FRAME_SET_OFFER_MS = 60_000;
/** MY PIECES lists an account's latest entries, at most this many. */
export const LIVE_MINE_LIMIT = 50;
/** The .ics alarm: this many minutes before the room opens (services/calendar.ts, a draw's before its entries open too). */
export const LIVE_CALENDAR_ALARM_MINUTES = CALENDAR_ALARM_MINUTES;

// ── The stages ─────────────────────────────────────────────────────────────

/** The stages (services/live.ts, where the rule of access reads them too). */
export { liveStages, type LiveStages } from './live.js';

// ── Views ──────────────────────────────────────────────────────────────────

/** Where an announced release stands for the public. */
export type LivePublicPhase = 'ANNOUNCED' | 'ROOM' | 'LIVE';

/** A stage of the staged reveals. */
export type LiveRevealStage = 'SILHOUETTE' | 'NAME' | 'PHOTO';

/** A LIVE RELEASE in THE RELEASES (GET /api/v1/live). */
export interface LiveCard {
  id: string;
  kind: 'LIVE';
  phase: LivePublicPhase;
  /** Which stages are revealed now. */
  revealed: { silhouette: boolean; name: boolean; photo: boolean };
  /** When each one is (or was). */
  stages: { silhouetteAt: Date; nameAt: Date; photoAt: Date };
  /**
   * The calendar of the reveals still to come, in order: each stage not revealed yet that will show something (the
   * silhouette when one is uploaded, the name, the photograph when the model has one), and its time; never what it shows.
   */
  reveals: { stage: LiveRevealStage; at: Date }[];
  /** From the name's stage: the release's title, its model's name, type and collection; null before. */
  title: string | null;
  name: string | null;
  /** From the name's stage (NOCTURNE N1): the model's label among its variants (« Blue »: MONOLITHE in blue); null before, or without one. */
  variant: string | null;
  type: string | null;
  collection: string | null;
  /** From the silhouette's stage: the uploaded silhouette (`/api/v1/media/<sha256>`); null before it, or without one (the seal stands in). */
  silhouetteUrl: string | null;
  /** From the photograph's stage: the model's photograph and the `<slug>` of its lookbook sheet when PUBLIC there; null before. */
  imageUrl: string | null;
  lookbook: string | null;
  announcedAt: Date;
  roomOpensAt: Date;
  /** T0. */
  opensAt: Date;
  closesAt: Date;
  priceMinor: number;
  currency: string;
  /** The quantity as the console wrote it (« 25 PIECES »). */
  quantityLine: string;
  perAccount: number;
  /**
   * Who may enter: the lowest tier (0 any ORBES account … 3 PALLADIUM), and every rule in words after « for » (« owners
   * from PLATINE », « collectors who have taken part in 3 releases », « selected collectors », joined by « or » when any
   * one is enough: live.ts liveRuleText).
   */
  access: { minTier: number; text: string };
  /** A surprise in every box (plan LIVE RELEASE+, choice 3): the page says so, never what (its description is internal). */
  surprise: boolean;
  /** I'LL BE THERE: how many accounts said so (« 428 COLLECTORS WILL BE THERE »), public. */
  interest: number;
  /**
   * Macro scope K44 T1: a set's release, its set and its pieces in the set's order, each part from its stage (`name`,
   * `variant`, `type` and `collection` then are the set's: its name, null, SET, null; `imageUrl` and `lookbook` null: its
   * pieces' photographs side by side, no photograph of its own); `quantity` lines, `priceMinor` and `perAccount` are per
   * set (T4). Absent on a model's release.
   */
  set?: LiveSetView;
}

/** Macro scope K44 T1: a set's release as the public reads it, each part from its stage. */
export interface LiveSetView {
  /** The set's name, from the name's stage; null before. */
  name: string | null;
  /** Its pieces in the set's order: each its model's name, variant, type and collection from the name's stage, its photograph and lookbook sheet from the photograph's. */
  pieces: LiveSetPiece[];
}

export interface LiveSetPiece {
  piece: number;
  name: string | null;
  variant: string | null;
  type: string | null;
  collection: string | null;
  imageUrl: string | null;
  lookbook: string | null;
}

/**
 * A LIVE RELEASE's page (GET /api/v1/live/:id) while it is announced, in its room, or live; ENDED while a turn or a
 * hold still runs to its deadline after the end.
 */
export interface LiveSheet extends Omit<LiveCard, 'phase'> {
  phase: LivePublicPhase | 'ENDED';
  /** From the name's stage. */
  description: string | null;
  /** Its sizes in order, with their stock; on a set's release each with its piece (1 to 4). */
  sizes: { id: string; label: string; stock: number; piece?: number }[];
  /** The add-ons offered with a piece held, in order, their price per piece. */
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
  roomOpensMinutes: number;
  turnSeconds: number;
  payMinutes: number;
  /** The line at T0 by tier first (PALLADIUM, PLATINE, TITANE, then the others), random within a tier; else random for all. */
  tierPriority: boolean;
}

/**
 * A LIVE RELEASE's page once it is over, in its final state (plan LIVE RELEASE+, decision 30, which lifts the LIVE plan's
 * choice 32): what was announced, each part from its stage as it stood at the end (its title, its model's name, type and
 * collection, its description; its silhouette, its photograph and its lookbook sheet: one ended before a stage never
 * reveals it), its opening and its quantity line as announced (decision 29). No end figure (choice 5): no sizes or
 * stock, no count, no reason of the end, no interest.
 */
export interface LiveEndedSheet {
  id: string;
  kind: 'LIVE';
  phase: 'ENDED';
  title: string | null;
  name: string | null;
  /** NOCTURNE N1: the model's label among its variants, from the name's stage as it stood at the end; null otherwise. */
  variant: string | null;
  type: string | null;
  collection: string | null;
  description: string | null;
  silhouetteUrl: string | null;
  imageUrl: string | null;
  lookbook: string | null;
  /** T0. */
  opensAt: Date;
  /** The quantity as the console wrote it and the announcement said it (« 25 PIECES »), even after pieces added live. */
  quantityLine: string;
  /** Macro scope K44 T1: a set's release, as LiveCard's `set`, each part from its stage as it stood at the end; absent otherwise. */
  set?: LiveSetView;
}

/** An after-room's page, as its guest reads it (`afterRoomSheet`): its own page, and the release it follows. */
export type LiveAfterRoomSheet = (LiveSheet | LiveEndedSheet) & { afterRoom: { parentId: string } };

/** The banner (GET /api/v1/live/next): LIVE RELEASE · <name once revealed> · OPENS IN … / THE ROOM IS OPEN / LIVE NOW. */
export interface LiveBanner {
  id: string;
  phase: LivePublicPhase;
  /** The model's name from its stage; null before. */
  name: string | null;
  /** NOCTURNE N1: the model's label among its variants, from the name's stage; null before, or without one. */
  variant: string | null;
  /** When the name is (or was) revealed: the banner reads the release again then. */
  nameAt: Date;
  roomOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
}

/** A size in the room: its stock, the pieces free now (`left`), and those in a turn or held that may return (`held`). */
export interface LiveRoomSize {
  id: string;
  label: string;
  /** Macro scope K44 T1: on a set's release, its piece (1 to 4); absent on a model's. */
  piece?: number;
  stock: number;
  left: number;
  held: number;
}

/** Macro scope K44 T1: a piece of a set's release in the room: its model from its stage, its sizes. */
export interface LiveRoomPiece {
  piece: number;
  /** Its model's name and variant from the name's stage, its photograph from the photograph's; null before. */
  name: string | null;
  variant: string | null;
  imageUrl: string | null;
  sizes: LiveRoomSize[];
}

/** The room of a release as its viewers read it, once a second (no stage, no personal data). */
export interface LiveRoom {
  id: string;
  phase: 'ANNOUNCED' | 'ROOM' | 'LIVE' | 'ENDED';
  /** A pause in progress: no new turn, the deadlines frozen. */
  paused: boolean;
  /** Ended, and no turn or hold left: nothing will change any more. */
  over: boolean;
  endedReason: LiveEndReason | null;
  roomOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
  /** The people in the release: waiting in the room, in the line, in their turn, holding a piece. */
  inRoom: number;
  /** The people in the line (QUEUED). */
  line: number;
  /** The sum of the stock; on a set's release, its sets on sale (the smallest of its pieces' totals). */
  quantity: number;
  quantityLine: string;
  /** Pieces free now, overall; on a set's release, the sets its pieces can still make now (each piece's free pieces, the smallest). */
  left: number;
  /** Pieces in a turn or held, which may return; on a set's release, the sets. */
  held: number;
  sizes: LiveRoomSize[];
  /** Macro scope K44 T1: on a set's release, its pieces in the set's order, each with its sizes; absent on a model's. */
  pieces?: LiveRoomPiece[];
  /** The latest host message. */
  message: { text: string; at: Date } | null;
}

/** The boutique board's share of the room: the countdown, the door, the pieces left overall; never a person. */
export interface LiveBoard {
  id: string;
  phase: LiveRoom['phase'];
  paused: boolean;
  over: boolean;
  roomOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
  quantity: number;
  quantityLine: string;
  left: number;
  /**
   * The piece, each part from its stage (the board shows the door, then the piece behind it); macro scope K44 T1: a set's
   * release, its set's name and its pieces (`set`, their photographs side by side), `imageUrl` null.
   */
  release: { revealed: LiveCard['revealed']; name: string | null; silhouetteUrl: string | null; imageUrl: string | null; set?: LiveSetView };
}

/**
 * The queue page's shared frame (W2, W5): what a viewer whose entry waits for its batch reads in place of the room, the
 * same small frame for all of them, once a second: the next batch, the pace (X, Y: the page computes each estimate from
 * them and its own place, never shows them), whether it is held, the batches so far and those waiting. No person.
 */
export interface LiveQueueFrame {
  phase: LiveRoom['phase'];
  /** When the next batch is due (T0 before the first); a pause in progress moves it when it ends. */
  nextBatchAt: Date;
  /** X: the buyers admitted per batch. */
  batch: number;
  /** Y: the minutes between two batches. */
  minutes: number;
  /** The pace held (PAUSE PACE, or the release's PAUSE): no batch comes, every place is kept. */
  paused: boolean;
  /** The batches admitted so far. */
  batches: number;
  /** The entries in the line waiting for their batch. */
  waiting: number;
}

/** One build of a release's room: what its viewers and its boards read. */
export interface LiveFrame {
  room: LiveRoom;
  board: LiveBoard;
  /** W2: on a paced release, the queue's frame for the viewers waiting for their batch; null without a pace. */
  queue: LiveQueueFrame | null;
  /**
   * The SHA-256 of the board link's secret as it stands now (null: revoked or never issued), for the hub to end a board
   * stream opened with a link since replaced or revoked. Internal: never in `room` or `board`, never sent.
   */
  boardTokenHash: Uint8Array | null;
}

/** An account's standing in a release, as its state and stream are opened with it. */
export interface LiveViewer {
  dropId: string;
  access: LiveAccess;
  /** Its entry's status, when it holds one. */
  entry: LiveEntryView['status'] | null;
  /** Macro scope K44 T1: the release sells a set (its own state then reads its sizes per piece). */
  set?: boolean;
}

/** An account's own entry in a release, and its interest (GET /api/v1/live/:id/state, with the room). */
export interface LiveOwnState {
  access: LiveAccess;
  entry: LiveEntryView | null;
  interest: LiveInterestView | null;
  /**
   * IN-01: the house's guarantee set aside for this release for the account, its pieces, when it is shown to the client;
   * null otherwise (one not shown leaves no mark).
   */
  guarantee: { pieces: number } | null;
  /**
   * AC-01: the size the account's saved size (YOUR SIZES) preselects, among this release's sizes with stock, only while it
   * holds neither an entry nor an interest; null otherwise. The collector confirms it with its own press: nothing is
   * written here.
   */
  savedSize: LiveSavedSize | null;
  /**
   * Macro scope K44 T1: on a set's release, the size YOUR SIZES preselects for each piece that has one (each by its
   * model's size kind), on the same terms as `savedSize` (null there); absent on a model's release.
   */
  savedSizes?: { piece: number; id: string; label: string }[];
}

/** A size of a release preselected from YOUR SIZES (AC-01). */
export interface LiveSavedSize {
  id: string;
  label: string;
}

/** An entry of the account in MY PIECES, with its release (each part of it from its stage). */
export interface LiveAccountEntry {
  release: {
    id: string;
    phase: ReturnType<typeof livePhase>;
    endedReason: LiveEndReason | null;
    title: string | null;
    name: string | null;
    /** NOCTURNE N1: the model's label among its variants, from the name's stage; null before, or without one. */
    variant: string | null;
    imageUrl: string | null;
    opensAt: Date;
    closesAt: Date;
    /** An after-room's: the release it follows (its page is read through that release's); null otherwise. */
    afterRoomOf: string | null;
    /** Macro scope K44 T1: a set's release, as LiveCard's `set` (its `name` then the set's, `imageUrl` null); absent otherwise. */
    set?: LiveSetView;
  };
  entry: LiveEntryView;
}

const streamRefused = () => new DomainError('LIVE_REMOVED', 403, 'Your entry in this release has been removed.');

type ReadRow = DropRow & {
  /** An after-room's: its parent's surprise, which it inherits; null for a release. */
  parent_surprise: boolean | null;
  /** Its model's (null on a set's release: macro scope K44 T1, its pieces are read with `releaseOffer`). */
  model_name: string | null;
  model_variant: string | null;
  model_type: string | null;
  model_image: string | null;
  model_slug: string | null;
  model_lookbook: string | null;
  collection: string | null;
};

/** Macro scope K44 T1: what a set's release sells, its pieces' collections named, read once per release. */
type SetOffer = { offer: Extract<ReleaseOffer, { kind: 'SET' }>; collections: Map<string, string> };

/** A set's release as the public reads it at `stages` (LiveSetView): each part from its stage. */
function setView(o: SetOffer, stages: Pick<LiveStages, 'name' | 'photo'>): LiveSetView {
  return {
    name: stages.name ? o.offer.set.name : null,
    pieces: o.offer.pieces.map((p) => ({
      piece: p.piece!,
      name: stages.name ? p.model.name : null,
      variant: stages.name ? p.model.variant : null,
      type: stages.name ? p.model.type : null,
      collection: stages.name && p.model.collectionId ? (o.collections.get(p.model.collectionId) ?? null) : null,
      imageUrl: stages.photo ? p.model.imageUrl : null,
      lookbook: stages.photo && p.model.lookbook === 'PUBLIC' && p.model.slug ? p.model.slug : null,
    })),
  };
}

/** The name a release goes by at its name's stage: its model's, or its set's. */
const nameOf = (r: ReadRow, set: SetOffer | undefined): string | null => (set ? set.offer.set.name : r.model_name);

const MINUTE_MS = 60_000;

// ── The calendar ───────────────────────────────────────────────────────────

/** RFC 5545 folding, from the shared writer (services/calendar.ts). */
export { foldIcsLine } from './calendar.js';

/**
 * The .ics of a release: one event from the room's opening to the end of the sales, an alarm LIVE_CALENDAR_ALARM_MINUTES
 * before, its page's address, the model's name only once revealed, no personal data. Written by the shared writer
 * (services/calendar.ts releaseIcs), byte for byte as before it (test/services/calendar.test.ts).
 */
export function liveCalendar(input: { id: string; name: string | null; roomOpensAt: Date; opensAt: Date; closesAt: Date; now: Date; origin: string }): string {
  const host = new URL(input.origin).host;
  const summary = input.name ? `LIVE RELEASE · ${input.name} · ORBES` : 'LIVE RELEASE · ORBES';
  const url = `${input.origin}/verify/releases/${input.id}`;
  const minutes = Math.round((input.opensAt.getTime() - input.roomOpensAt.getTime()) / MINUTE_MS);
  return releaseIcs({
    prodId: '-//ORBES//LIVE RELEASE//EN',
    uid: `live-${input.id}@${host}`,
    now: input.now,
    start: input.roomOpensAt,
    end: input.closesAt,
    summary,
    description: `The room opens ${minutes} minute${minutes === 1 ? '' : 's'} before the release. ${url}`,
    url,
    alarms: [{ minutes: LIVE_CALENDAR_ALARM_MINUTES, description: summary }],
  });
}

// ── Service ────────────────────────────────────────────────────────────────

export interface LiveRoomServiceDeps {
  db: Db;
  /** The key of the turns' secrets (live.ts deriveLiveTurnKey): an entry's view carries its own turn's secret. */
  turnKey: Uint8Array;
  /** PUBLIC_ORIGIN: the .ics names the release's page. */
  publicOrigin: string;
  clock?: Clock;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function releaseId(id: string): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw dropNotFound();
  return id.toLowerCase();
}

export class LiveRoomService {
  private readonly db: Db;
  private readonly turnKey: Uint8Array;
  private readonly origin: string;
  private readonly clock: Clock;
  /** The frame's set offers, by release (LIVE_FRAME_SET_OFFER_MS). */
  private readonly frameSets = new Map<string, { setId: string; at: number; set: SetOffer }>();

  constructor(deps: LiveRoomServiceDeps) {
    if (!(deps.turnKey instanceof Uint8Array) || deps.turnKey.length !== 32) throw new RangeError('turnKey must be 32 bytes');
    this.db = deps.db;
    this.turnKey = deps.turnKey;
    this.origin = deps.publicOrigin;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Public ───────────────────────────────────────────────────────────────

  /** Every LIVE RELEASE announced and not ended, the next opening first (LIVE_LIST_LIMIT). */
  async list(): Promise<LiveCard[]> {
    const now = this.clock();
    const rows = await this.current(now);
    const [interest, sets] = await Promise.all([this.interestCounts(rows.map((r) => r.id)), this.setOffers(rows)]);
    return Promise.all(rows.map((r) => this.card(r, now, interest.get(r.id) ?? 0, sets.get(r.id))));
  }

  /**
   * A release's page: 404 before its announcement; once over (the end recorded, no turn or hold left, as the room's
   * `over`), its final state (LiveEndedSheet). Between the end and the last deadline a turn may still be secured and a hold confirmed
   * (the plan's The end, item 10): the page is whole, its phase ENDED.
   */
  async sheet(dropId: string): Promise<LiveSheet | LiveEndedSheet> {
    const id = releaseId(dropId);
    const now = this.clock();
    return this.sheetOf(await this.publicRow(id, now), now);
  }

  /**
   * An after-room's page for one of its guests (GET /api/v1/live/:id/after-room, :id the release it follows), from its
   * T0, as `sheet` writes a release's (its final state, once over), with the release it follows; the same 404 as
   * an unknown release for anyone else, before its T0, and for a release without one opened.
   */
  async afterRoomSheet(accountId: string, parentId: string): Promise<LiveAfterRoomSheet> {
    const id = releaseId(parentId);
    const now = this.clock();
    const r = await this.reads().where('d.parent_drop_id', '=', id).where('d.mode', '=', 'LIVE').where('d.published_at', 'is not', null).executeTakeFirst();
    if (!r || (await afterRoomPlace(this.db, r, accountId, now)) === null) throw dropNotFound();
    return { ...(await this.sheetOf(r, now)), afterRoom: { parentId: id } };
  }

  private async sheetOf(r: ReadRow, now: Date): Promise<LiveSheet | LiveEndedSheet> {
    const id = r.id;
    const stages = liveStages(r, now)!;
    const set = (await this.setOffers([r])).get(id);
    if (livePhase(r, now) === 'ENDED' && r.ended_at !== null) {
      const open = await this.db.selectFrom('live_entries').select('id').where('drop_id', '=', id).where('status', 'in', ['TURN', 'SECURED']).limit(1).executeTakeFirst();
      if (!open) {
        // As announced at its end: a stage it ended before is never revealed, even once its time has passed.
        const atEnd = liveStages(r, stagesAt(r, now))!;
        return {
          id,
          kind: 'LIVE',
          phase: 'ENDED',
          title: atEnd.name ? r.title : null,
          name: atEnd.name ? nameOf(r, set) : null,
          variant: atEnd.name && !set ? r.model_variant : null,
          type: atEnd.name ? (set ? 'SET' : r.model_type) : null,
          collection: atEnd.name && !set ? r.collection : null,
          description: atEnd.name ? r.description : null,
          silhouetteUrl: atEnd.silhouette ? mediaUrl(r.silhouette_sha256) : null,
          imageUrl: atEnd.photo && !set ? mediaUrl(r.model_image) : null,
          lookbook: atEnd.photo && !set && r.model_lookbook === 'PUBLIC' && r.model_slug ? r.model_slug : null,
          opensAt: r.opens_at,
          quantityLine: r.quantity_line ?? '',
          ...(set ? { set: setView(set, atEnd) } : {}),
        };
      }
    }
    const [sizes, addons, interest] = await Promise.all([
      this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'piece']).where('drop_id', '=', id).orderBy('position').execute(),
      this.db.selectFrom('live_addons').select(['id', 'label', 'line', 'price_minor']).where('drop_id', '=', id).orderBy('position').execute(),
      this.interestCounts([id]),
    ]);
    const card = await this.card(r, now, interest.get(id) ?? 0, set);
    return {
      ...card,
      phase: livePhase(r, now) as LiveSheet['phase'],
      description: stages.name ? r.description : null,
      sizes: sizes.map((z) => ({ id: z.id, label: z.label, stock: z.stock, ...(z.piece !== null ? { piece: z.piece } : {}) })),
      addons: addons.map((a) => ({ id: a.id, label: a.label, line: a.line, priceMinor: a.price_minor })),
      roomOpensMinutes: r.room_opens_minutes ?? LIVE_ROOM_OPENS_MINUTES.default,
      turnSeconds: r.turn_seconds ?? LIVE_TURN_SECONDS.default,
      payMinutes: r.pay_minutes ?? LIVE_PAY_MINUTES.default,
      tierPriority: r.tier_priority ?? true,
    };
  }

  /** The banner: the release live now, else the one whose room is open, else the next announced; null when none. */
  async next(): Promise<LiveBanner | null> {
    const now = this.clock();
    const rows = await this.current(now);
    const rank = { LIVE: 0, ROOM: 1, ANNOUNCED: 2 } as const;
    const pick = rows
      .map((r) => ({ r, phase: livePhase(r, now) as LivePublicPhase }))
      .sort((a, b) => rank[a.phase] - rank[b.phase] || a.r.opens_at.getTime() - b.r.opens_at.getTime())[0];
    if (!pick) return null;
    const stages = liveStages(pick.r, now)!;
    const set = (await this.setOffers([pick.r])).get(pick.r.id);
    return {
      id: pick.r.id,
      phase: pick.phase,
      name: stages.name ? nameOf(pick.r, set) : null,
      variant: stages.name && !set ? pick.r.model_variant : null,
      nameAt: stages.nameAt,
      roomOpensAt: roomOpensAt(pick.r),
      opensAt: pick.r.opens_at,
      closesAt: pick.r.closes_at,
    };
  }

  /** The .ics of an announced release not ended (404 otherwise). */
  async calendar(dropId: string): Promise<{ filename: string; body: string }> {
    const id = releaseId(dropId);
    const now = this.clock();
    const r = await this.publicRow(id, now);
    if (livePhase(r, now) === 'ENDED') throw dropNotFound();
    const stages = liveStages(r, now)!;
    const set = (await this.setOffers([r])).get(id);
    return {
      filename: 'orbes-live-release.ics',
      body: liveCalendar({ id, name: stages.name ? nameOf(r, set) : null, roomOpensAt: roomOpensAt(r), opensAt: r.opens_at, closesAt: r.closes_at, now, origin: this.origin }),
    };
  }

  // ── The room ─────────────────────────────────────────────────────────────

  /**
   * Who may read a release's room: an announced LIVE RELEASE (404 otherwise; an after-room, its guests from its T0), and
   * a signed-in account allowed to enter it now or holding an entry in it (403 LIVE_NOT_ELIGIBLE, with the rule in words,
   * otherwise). For a stream, not a REMOVED entry (403 LIVE_REMOVED).
   */
  async viewer(accountId: string, dropId: string, purpose: 'state' | 'stream'): Promise<LiveViewer> {
    const id = releaseId(dropId);
    const now = this.clock();
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').where('published_at', 'is not', null).executeTakeFirst();
    if (!d || d.cancelled_at || !isAnnounced(d, stagesAt(d, now))) throw dropNotFound();
    // An after-room: its guests, from its T0; anyone else reads an unknown release.
    if (isAfterRoom(d) && (await afterRoomPlace(this.db, d, accountId, now)) === null) throw dropNotFound();
    const [entry, access] = await Promise.all([
      this.db.selectFrom('live_entries').select('status').where('drop_id', '=', id).where('account_id', '=', accountId).executeTakeFirst(),
      accessOf(this.db, d, accountId, now),
    ]);
    if (!entry && !access.allowed) throw liveNotEligible(await liveAccessRule(this.db, d, now), access);
    if (purpose === 'stream' && entry?.status === 'REMOVED') throw streamRefused();
    return { dropId: id, access, entry: entry?.status ?? null, set: d.set_id !== null };
  }

  /** The account's own entry and interest in a release it may read (`viewer` first). */
  async own(accountId: string, viewer: LiveViewer): Promise<LiveOwnState> {
    const now = this.clock();
    const [views, interest, guarantee] = await Promise.all([
      liveEntryViews(this.db, this.turnKey, { dropId: viewer.dropId, accountIds: [accountId] }, now),
      this.db
        .selectFrom('live_interest as i')
        .innerJoin('drop_sizes as s', 's.id', 'i.size_id')
        .select(['i.drop_id', 'i.size_id', 's.label', 'i.created_at'])
        .where('i.drop_id', '=', viewer.dropId)
        .where('i.account_id', '=', accountId)
        .executeTakeFirst(),
      this.db
        .selectFrom('house_guarantees')
        .select('pieces')
        .where('account_id', '=', accountId)
        .where('covered_drop_id', '=', viewer.dropId)
        .where('status', '=', 'ACTIVE')
        .where('visible', '=', true)
        .executeTakeFirst(),
    ]);
    const entry = views.get(accountId) ?? null;
    // Macro scope K44 T1: on a set's release, the interest's size per piece and YOUR SIZES' preselection per piece.
    const isSet = viewer.set ?? (await this.db.selectFrom('drops').select('set_id').where('id', '=', viewer.dropId).executeTakeFirst())?.set_id != null;
    const interestSizes: LivePieceSize[] = interest && isSet ? await liveInterestPieceSizes(this.db, viewer.dropId, accountId) : [];
    return {
      access: viewer.access,
      entry,
      interest: interest
        ? { dropId: interest.drop_id, size: { id: interest.size_id, label: interest.label }, ...(interestSizes.length ? { sizes: interestSizes } : {}), since: interest.created_at }
        : null,
      guarantee: guarantee ? { pieces: guarantee.pieces } : null,
      savedSize: entry || interest ? null : await this.matchSavedSize(accountId, viewer.dropId),
      ...(isSet ? { savedSizes: entry || interest ? [] : await this.savedSizesByPiece(accountId, viewer.dropId) } : {}),
    };
  }

  /**
   * AC-01: the size the account's saved size preselects in a release (the stream's first frame), while it holds neither
   * an entry nor an interest there; null otherwise. Reads only.
   */
  async savedSize(accountId: string, dropId: string): Promise<LiveSavedSize | null> {
    const [entry, interest] = await Promise.all([
      this.db.selectFrom('live_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst(),
      this.db.selectFrom('live_interest').select('size_id').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst(),
    ]);
    return entry || interest ? null : this.matchSavedSize(accountId, dropId);
  }

  /**
   * Macro scope K44 T1: on a set's release, YOUR SIZES' size per piece (`savedSizesByPiece`) while the account holds
   * neither an entry nor an interest there (the stream's first frame, as `savedSize`); empty otherwise. Reads only.
   */
  async savedSizesNow(accountId: string, dropId: string): Promise<{ piece: number; id: string; label: string }[]> {
    const [entry, interest] = await Promise.all([
      this.db.selectFrom('live_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst(),
      this.db.selectFrom('live_interest').select('size_id').where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirst(),
    ]);
    return entry || interest ? [] : this.savedSizesByPiece(accountId, dropId);
  }

  /**
   * The release's size the account's saved size matches, among its sizes with stock (services/sizes.ts matchSavedSize);
   * none on a set's release, which preselects one per piece (`savedSizesByPiece`).
   */
  private async matchSavedSize(accountId: string, dropId: string): Promise<LiveSavedSize | null> {
    const d = await this.db.selectFrom('drops').select(['model_id', 'set_id']).where('id', '=', dropId).executeTakeFirst();
    if (!d || d.model_id === null) return null;
    const match = await savedSizeAmong(this.db, accountId, d.model_id, await this.sizeCandidates(dropId));
    return match ? { id: match.id, label: match.label } : null;
  }

  /**
   * Macro scope K44 T1: on a set's LIVE RELEASE, the size YOUR SIZES preselects for each piece that has one, among each
   * piece's sizes with stock (release-offer.ts savedSizesByPiece); none on a model's release. Reads only.
   */
  async savedSizesByPiece(accountId: string, dropId: string): Promise<{ piece: number; id: string; label: string }[]> {
    const d = await this.db.selectFrom('drops').select(['model_id', 'set_id']).where('id', '=', dropId).executeTakeFirst();
    if (!d || d.set_id === null) return [];
    return savedSizesByPiece(this.db, accountId, await releaseOffer(this.db, d), await this.sizeCandidates(dropId));
  }

  /** A release's sizes as YOUR SIZES reads them: each its piece, label, fit and stock. */
  private async sizeCandidates(dropId: string) {
    const sizes = await this.db
      .selectFrom('drop_sizes as s')
      .leftJoin('skus as k', 'k.id', 's.sku_id')
      .select(['s.id', 's.piece', 's.label', 's.stock', 'k.fit_min_mm', 'k.fit_max_mm'])
      .where('s.drop_id', '=', dropId)
      .orderBy('s.position')
      .execute();
    return sizes.map((z) => ({ id: z.id, piece: z.piece, label: z.label, fitMinMm: z.fit_min_mm ?? null, fitMaxMm: z.fit_max_mm ?? null, stock: z.stock }));
  }

  /** The entries of the accounts following a release, by account id (one read for all of them). */
  async viewerEntries(dropId: string, accountIds: readonly string[]): Promise<Map<string, LiveEntryView>> {
    if (accountIds.length === 0) return new Map();
    return liveEntryViews(this.db, this.turnKey, { dropId, accountIds }, this.clock());
  }

  /**
   * One build of a release's room, board and queue, for every viewer and board at once: four reads whatever the audience
   * (five on a paced release: those waiting for their batch). Null once it is no longer an announced, published LIVE
   * RELEASE (cancelled, unpublished).
   */
  async frame(dropId: string): Promise<LiveFrame | null> {
    const id = releaseId(dropId);
    const now = this.clock();
    const r = await this.reads().where('d.id', '=', id).where('d.mode', '=', 'LIVE').where('d.published_at', 'is not', null).executeTakeFirst();
    if (!r || r.cancelled_at || !isAnnounced(r, stagesAt(r, now))) return null;
    const paced = r.pace_batch !== null && r.pace_minutes !== null;
    const isSet = r.set_id !== null;
    const [sizes, counts, message, waiting, bySize, set] = await Promise.all([
      this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'piece']).where('drop_id', '=', id).orderBy('position').execute(),
      this.db
        .selectFrom('live_entries')
        .select((eb) => ['size_id', 'status', eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('quantity').as('q')])
        .where('drop_id', '=', id)
        .groupBy(['size_id', 'status'])
        .execute(),
      this.db.selectFrom('live_messages').select(['text', 'created_at']).where('drop_id', '=', id).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst(),
      // W2: a paced release's line waiting for its batch (the partial index live_entries_waiting_admission): one read more.
      paced
        ? this.db
            .selectFrom('live_entries')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .where('drop_id', '=', id)
            .where('status', '=', 'QUEUED')
            .where('admitted_at', 'is', null)
            .executeTakeFirstOrThrow()
        : Promise.resolve(null),
      // Macro scope K44 T1: a set's entry counts in each of its sizes (its quantity its sets).
      isSet
        ? this.db
            .selectFrom('live_entry_sizes as x')
            .innerJoin('live_entries as e', 'e.id', 'x.entry_id')
            .select((eb) => ['x.size_id', 'e.status', eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('e.quantity').as('q')])
            .where('e.drop_id', '=', id)
            .where('e.status', 'in', ['TURN', 'SECURED', 'CONFIRMED'])
            .groupBy(['x.size_id', 'e.status'])
            .execute()
        : Promise.resolve(null),
      isSet ? this.frameSetOffer(r, now) : Promise.resolve(undefined),
    ]);
    const people = (statuses: readonly string[]) => counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + Number(c.n), 0);
    const pieces = (sizeId: string, statuses: readonly string[]) =>
      (bySize ?? counts).filter((c) => c.size_id === sizeId && statuses.includes(c.status)).reduce((n, c) => n + Number(c.q ?? 0), 0);
    const roomSizes: LiveRoomSize[] = sizes.map((s) => {
      const held = pieces(s.id, ['TURN', 'SECURED']);
      return { id: s.id, label: s.label, ...(s.piece !== null ? { piece: s.piece } : {}), stock: s.stock, left: Math.max(0, s.stock - held - pieces(s.id, ['CONFIRMED'])), held };
    });
    const stages = liveStages(r, now)!;
    // A set's release: its pieces, each with its sizes; its figures in sets (each piece's sizes summed, the smallest).
    const roomPieces: LiveRoomPiece[] | null = set
      ? set.offer.pieces.map((p) => ({
          piece: p.piece!,
          name: stages.name ? p.model.name : null,
          variant: stages.name ? p.model.variant : null,
          imageUrl: stages.photo ? p.model.imageUrl : null,
          sizes: roomSizes.filter((z) => z.piece === p.piece),
        }))
      : null;
    const perPiece = (k: 'left' | 'held') => (roomPieces ? Math.min(...roomPieces.map((p) => p.sizes.reduce((n, z) => n + z[k], 0))) : roomSizes.reduce((n, z) => n + z[k], 0));
    const phase = livePhase(r, now) as LiveRoom['phase'];
    // Over once the engine has recorded the end (with the waiting and queued entries ENDED in the same transaction) and
    // no turn or hold remains: the clock alone (`phase`, for display) may run ahead of the engine's pass.
    const over = r.ended_at !== null && people(['TURN', 'SECURED']) === 0;
    const room: LiveRoom = {
      id,
      phase,
      paused: r.paused_at !== null && !over,
      over,
      endedReason: r.ended_reason,
      roomOpensAt: roomOpensAt(r),
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      inRoom: people(LIVE_OPEN_STATUSES),
      line: people(['QUEUED']),
      quantity: onSaleOf(sizes),
      quantityLine: r.quantity_line ?? '',
      left: perPiece('left'),
      // A set's held sets: each counted once, in its first piece.
      held: roomPieces ? (roomPieces[0]?.sizes.reduce((n, z) => n + z.held, 0) ?? 0) : roomSizes.reduce((n, s) => n + s.held, 0),
      sizes: roomSizes,
      ...(roomPieces ? { pieces: roomPieces } : {}),
      message: message ? { text: message.text, at: message.created_at } : null,
    };
    const board: LiveBoard = {
      id,
      phase,
      paused: room.paused,
      over,
      roomOpensAt: room.roomOpensAt,
      opensAt: room.opensAt,
      closesAt: room.closesAt,
      quantity: room.quantity,
      quantityLine: room.quantityLine,
      left: room.left,
      release: {
        revealed: { silhouette: stages.silhouette, name: stages.name, photo: stages.photo },
        name: stages.name ? nameOf(r, set) : null,
        silhouetteUrl: stages.silhouette ? mediaUrl(r.silhouette_sha256) : null,
        imageUrl: stages.photo && !set ? mediaUrl(r.model_image) : null,
        ...(set ? { set: setView(set, stages) } : {}),
      },
    };
    const queue: LiveQueueFrame | null = paced
      ? {
          phase,
          nextBatchAt: paceNextAt(r)!,
          batch: r.pace_batch!,
          minutes: r.pace_minutes!,
          paused: paceHeld(r) && !over,
          batches: Number(r.pace_batches),
          waiting: Number(waiting?.n ?? 0),
        }
      : null;
    return { room, board, queue, boardTokenHash: r.board_token_hash ? new Uint8Array(r.board_token_hash) : null };
  }

  /**
   * The boutique board's release by its secret link: the release named, its link's secret matching the one issued and
   * not revoked, announced and not over. Anything else, a missing or malformed secret included: one 404. Its secret's
   * hash (`tokenHash`) goes with its stream, which ends once the link is replaced or revoked (LiveFrame.boardTokenHash).
   */
  async board(dropId: string, token: unknown): Promise<{ dropId: string; tokenHash: Uint8Array }> {
    const id = releaseId(dropId);
    const hash = liveBoardTokenHash(token);
    if (!hash) throw dropNotFound();
    const now = this.clock();
    const d = await this.db
      .selectFrom('drops')
      .selectAll()
      .where('id', '=', id)
      .where('board_token_hash', '=', hash)
      .where('mode', '=', 'LIVE')
      .where('parent_drop_id', 'is', null)
      .where('published_at', 'is not', null)
      .executeTakeFirst();
    if (!d || d.cancelled_at || !isAnnounced(d, now)) throw dropNotFound();
    if (d.ended_at) {
      const open = await this.db.selectFrom('live_entries').select('id').where('drop_id', '=', id).where('status', 'in', ['TURN', 'SECURED']).limit(1).executeTakeFirst();
      if (!open) throw dropNotFound();
    }
    return { dropId: id, tokenHash: hash };
  }

  /**
   * Which of these sessions (SessionInfo.id, the hex SHA-256 of the cookie's token) are still live sessions of an ACTIVE
   * account at `now`, as sessionGuard would let them in: one read for every viewer stream of the process, so a stream
   * opened before a sign-out, a revocation, a lock or a disabling ends at the next pulse.
   */
  async liveSessions(sessionIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(sessionIds.filter((x) => /^[0-9a-f]{64}$/.test(x)))];
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectFrom('sessions as s')
      .innerJoin('accounts as a', 'a.id', 's.subject_id')
      .select('s.id_hash')
      .where('s.id_hash', 'in', ids.map((x) => new Uint8Array(Buffer.from(x, 'hex'))))
      .where('s.subject_type', '=', 'account')
      .where('s.expires_at', '>', this.clock())
      .where('a.status', '=', 'ACTIVE')
      .execute();
    return new Set(rows.map((r) => Buffer.from(r.id_hash).toString('hex')));
  }

  // ── The account ──────────────────────────────────────────────────────────

  /** The account's entries, the latest release first (LIVE_MINE_LIMIT), each with its release (MY PIECES). */
  async mine(accountId: string): Promise<LiveAccountEntry[]> {
    const now = this.clock();
    const views = await liveEntryViews(this.db, this.turnKey, { accountId }, now);
    if (views.size === 0) return [];
    const rows = await this.reads()
      .where('d.id', 'in', [...views.keys()])
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .limit(LIVE_MINE_LIMIT)
      .execute();
    const sets = await this.setOffers(rows);
    return rows.map((r) => {
      const stages = liveStages(r, now);
      const set = sets.get(r.id);
      return {
        release: {
          id: r.id,
          phase: livePhase(r, now),
          endedReason: r.ended_reason,
          title: stages?.name ? r.title : null,
          name: stages?.name ? nameOf(r, set) : null,
          variant: stages?.name && !set ? r.model_variant : null,
          imageUrl: stages?.photo && !set ? mediaUrl(r.model_image) : null,
          opensAt: r.opens_at,
          closesAt: r.closes_at,
          afterRoomOf: r.parent_drop_id,
          ...(set ? { set: setView(set, stages ?? { name: false, photo: false }) } : {}),
        },
        entry: views.get(r.id)!,
      };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The releases with their model (macro scope K44 T1: none on a set's release, read with `setOffers`). */
  private reads() {
    return this.db
      .selectFrom('drops as d')
      .leftJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('collections as c', 'c.id', 'm.collection_id')
      .leftJoin('drops as pd', 'pd.id', 'd.parent_drop_id')
      .selectAll('d')
      .select([
        'pd.surprise_enabled as parent_surprise',
        'm.name as model_name',
        'm.variant_label as model_variant',
        'm.type as model_type',
        'm.image_sha256 as model_image',
        'm.slug as model_slug',
        'm.lookbook as model_lookbook',
        'c.name as collection',
      ]);
  }

  /** The LIVE RELEASES announced and not ended at `now`, the next opening first; never an after-room. */
  private async current(now: Date): Promise<ReadRow[]> {
    return this.reads()
      .where('d.mode', '=', 'LIVE')
      .where('d.parent_drop_id', 'is', null)
      .where('d.published_at', 'is not', null)
      .where('d.cancelled_at', 'is', null)
      .where('d.ended_at', 'is', null)
      .where('d.closes_at', '>', now)
      .where(sql<Date>`coalesce(d.announce_at, d.published_at)`, '<=', now)
      .orderBy('d.opens_at')
      .orderBy('d.id')
      .limit(LIVE_LIST_LIMIT)
      .execute();
  }

  /** An announced LIVE RELEASE, not cancelled: its row with its model; 404 otherwise, and for an after-room. */
  private async publicRow(id: string, now: Date): Promise<ReadRow> {
    const r = await this.reads().where('d.id', '=', id).where('d.mode', '=', 'LIVE').where('d.parent_drop_id', 'is', null).where('d.published_at', 'is not', null).executeTakeFirst();
    // One ended before its announcement was never announced.
    if (!r || r.cancelled_at || !isAnnounced(r, stagesAt(r, now))) throw dropNotFound();
    return r;
  }

  /**
   * Macro scope K44 T1: what each set's release among `rows` sells (release-offer.ts), its pieces' collections named:
   * three reads whatever their number.
   */
  private async setOffers(rows: readonly ReadRow[]): Promise<Map<string, SetOffer>> {
    const out = new Map<string, SetOffer>();
    const setIds = [...new Set(rows.flatMap((r) => (r.set_id === null ? [] : [r.set_id])))];
    if (setIds.length === 0) return out;
    const [sets, pieces] = await Promise.all([this.db.selectFrom('sets').select(['id', 'name', 'code', 'active']).where('id', 'in', setIds).execute(), setPiecesOf(this.db, setIds)]);
    const collectionIds = [...new Set([...pieces.values()].flat().flatMap((p) => (p.model.collectionId === null ? [] : [p.model.collectionId])))];
    const names = new Map(collectionIds.length ? (await this.db.selectFrom('collections').select(['id', 'name']).where('id', 'in', collectionIds).execute()).map((c) => [c.id, c.name]) : []);
    for (const r of rows) {
      const set = r.set_id === null ? undefined : sets.find((x) => x.id === r.set_id);
      if (!set) continue;
      const own = pieces.get(set.id) ?? [];
      const collections = new Map(own.flatMap((p) => (p.model.collectionId !== null && names.has(p.model.collectionId) ? [[p.model.collectionId, names.get(p.model.collectionId)!] as const] : [])));
      out.set(r.id, { offer: { kind: 'SET', modelId: null, set, pieces: own }, collections });
    }
    return out;
  }

  /** A set's release's offer for its frame: read again once LIVE_FRAME_SET_OFFER_MS have passed (or its set changed). */
  private async frameSetOffer(r: ReadRow, now: Date): Promise<SetOffer | undefined> {
    const at = now.getTime();
    const fresh = (x: { at: number }) => at >= x.at && at - x.at < LIVE_FRAME_SET_OFFER_MS;
    const hit = this.frameSets.get(r.id);
    if (hit && hit.setId === r.set_id && fresh(hit)) return hit.set;
    const set = (await this.setOffers([r])).get(r.id);
    for (const [id, x] of this.frameSets) if (!fresh(x)) this.frameSets.delete(id);
    if (set && r.set_id !== null) this.frameSets.set(r.id, { setId: r.set_id, at, set });
    return set;
  }

  /** I'LL BE THERE, counted per release: one read for all of them. */
  private async interestCounts(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('live_interest')
      .select((eb) => ['drop_id', eb.fn.countAll<number>().as('n')])
      .where('drop_id', 'in', [...ids])
      .groupBy('drop_id')
      .execute();
    return new Map(rows.map((x) => [x.drop_id, Number(x.n)]));
  }

  private async card(r: ReadRow, now: Date, interest: number, set?: SetOffer): Promise<LiveCard> {
    const stages = liveStages(r, now)!;
    const rule = await liveAccessRule(this.db, r, now);
    // A photograph to reveal: its model's or its lookbook sheet; a set's, one of its pieces'.
    const pictured = set
      ? set.offer.pieces.some((p) => p.model.imageUrl || (p.model.lookbook === 'PUBLIC' && p.model.slug))
      : r.model_image || (r.model_lookbook === 'PUBLIC' && r.model_slug);
    return {
      id: r.id,
      kind: 'LIVE',
      phase: livePhase(r, now) as LivePublicPhase,
      revealed: { silhouette: stages.silhouette, name: stages.name, photo: stages.photo },
      stages: { silhouetteAt: stages.silhouetteAt, nameAt: stages.nameAt, photoAt: stages.photoAt },
      reveals: [
        ...(!stages.silhouette && r.silhouette_sha256 ? [{ stage: 'SILHOUETTE' as const, at: stages.silhouetteAt }] : []),
        ...(!stages.name ? [{ stage: 'NAME' as const, at: stages.nameAt }] : []),
        ...(!stages.photo && pictured ? [{ stage: 'PHOTO' as const, at: stages.photoAt }] : []),
      ],
      title: stages.name ? r.title : null,
      name: stages.name ? nameOf(r, set) : null,
      variant: stages.name && !set ? r.model_variant : null,
      type: stages.name ? (set ? 'SET' : r.model_type) : null,
      collection: stages.name && !set ? r.collection : null,
      silhouetteUrl: stages.silhouette ? mediaUrl(r.silhouette_sha256) : null,
      imageUrl: stages.photo && !set ? mediaUrl(r.model_image) : null,
      lookbook: stages.photo && !set && r.model_lookbook === 'PUBLIC' && r.model_slug ? r.model_slug : null,
      announcedAt: announcedAt(r)!,
      roomOpensAt: roomOpensAt(r),
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      priceMinor: r.price_minor ?? 0,
      currency: r.currency ?? 'EUR',
      quantityLine: r.quantity_line ?? '',
      perAccount: r.per_account ?? LIVE_PER_ACCOUNT.default,
      access: { minTier: rule.minTier, text: liveRuleText(rule) },
      // An after-room's boxes hold its release's surprise (services/after-room.ts).
      surprise: (r.parent_drop_id ? r.parent_surprise : r.surprise_enabled) === true,
      interest,
      ...(set ? { set: setView(set, stages) } : {}),
    };
  }
}
