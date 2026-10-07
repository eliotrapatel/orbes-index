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
 * stage at all.
 *
 * The room (`frame`): built once for all of a release's viewers (routes/live.ts fans it out once a second): its phase,
 * the pieces left and held per size, the people in the room and in the line, the latest host message; and the board's
 * share of it (the countdown, the door, the pieces left overall: no personal data). `viewer` says who may read it: a
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
import { dropNotFound } from './drops.js';
import {
  accessOf,
  announcedAt,
  isAnnounced,
  liveAccessRule,
  liveBoardTokenHash,
  liveEntryViews,
  liveNotEligible,
  livePhase,
  liveRuleText,
  liveStages,
  roomOpensAt,
  stagesAt,
  LIVE_OPEN_STATUSES,
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_TURN_SECONDS,
  type LiveAccess,
  type LiveEntryView,
  type LiveInterestView,
} from './live.js';
import { mediaUrl } from './media.js';

/** THE RELEASES' LIVE half lists at most this many releases. */
export const LIVE_LIST_LIMIT = 50;
/** MY PIECES lists an account's latest entries, at most this many. */
export const LIVE_MINE_LIMIT = 50;
/** The .ics alarm: this many minutes before the room opens. */
export const LIVE_CALENDAR_ALARM_MINUTES = 10;

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
}

/**
 * A LIVE RELEASE's page (GET /api/v1/live/:id) while it is announced, in its room, or live; ENDED while a turn or a
 * hold still runs to its deadline after the end.
 */
export interface LiveSheet extends Omit<LiveCard, 'phase'> {
  phase: LivePublicPhase | 'ENDED';
  /** From the name's stage. */
  description: string | null;
  /** Its sizes in order, with their stock. */
  sizes: { id: string; label: string; stock: number }[];
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
  stock: number;
  left: number;
  held: number;
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
  /** The sum of the stock. */
  quantity: number;
  quantityLine: string;
  /** Pieces free now, overall. */
  left: number;
  /** Pieces in a turn or held, which may return. */
  held: number;
  sizes: LiveRoomSize[];
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
  /** The piece, each part from its stage (the board shows the door, then the piece behind it). */
  release: { revealed: LiveCard['revealed']; name: string | null; silhouetteUrl: string | null; imageUrl: string | null };
}

/** One build of a release's room: what its viewers and its boards read. */
export interface LiveFrame {
  room: LiveRoom;
  board: LiveBoard;
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
  };
  entry: LiveEntryView;
}

const streamRefused = () => new DomainError('LIVE_REMOVED', 403, 'Your entry in this release has been removed.');

type ReadRow = DropRow & {
  /** An after-room's: its parent's surprise, which it inherits; null for a release. */
  parent_surprise: boolean | null;
  model_name: string;
  model_variant: string | null;
  model_type: string;
  model_image: string | null;
  model_slug: string | null;
  model_lookbook: string;
  collection: string | null;
};

const MINUTE_MS = 60_000;

// ── The calendar ───────────────────────────────────────────────────────────

const icsTime = (t: Date) => `${new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 §3.1: lines of at most 75 octets, continued on the next after a space; never inside a character. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * The .ics of a release: one event from the room's opening to the end of the sales, an alarm LIVE_CALENDAR_ALARM_MINUTES
 * before, its page's address, the model's name only once revealed, no personal data.
 */
export function liveCalendar(input: { id: string; name: string | null; roomOpensAt: Date; opensAt: Date; closesAt: Date; now: Date; origin: string }): string {
  const host = new URL(input.origin).host;
  const summary = input.name ? `LIVE RELEASE · ${input.name} · ORBES` : 'LIVE RELEASE · ORBES';
  const url = `${input.origin}/verify/releases/${input.id}`;
  const minutes = Math.round((input.opensAt.getTime() - input.roomOpensAt.getTime()) / MINUTE_MS);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ORBES//LIVE RELEASE//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:live-${input.id}@${host}`,
    `DTSTAMP:${icsTime(input.now)}`,
    `DTSTART:${icsTime(input.roomOpensAt)}`,
    `DTEND:${icsTime(input.closesAt)}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(`The room opens ${minutes} minute${minutes === 1 ? '' : 's'} before the release. ${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(summary)}`,
    `TRIGGER:-PT${LIVE_CALENDAR_ALARM_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
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
    const interest = await this.interestCounts(rows.map((r) => r.id));
    return Promise.all(rows.map((r) => this.card(r, now, interest.get(r.id) ?? 0)));
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
          name: atEnd.name ? r.model_name : null,
          variant: atEnd.name ? r.model_variant : null,
          type: atEnd.name ? r.model_type : null,
          collection: atEnd.name ? r.collection : null,
          description: atEnd.name ? r.description : null,
          silhouetteUrl: atEnd.silhouette ? mediaUrl(r.silhouette_sha256) : null,
          imageUrl: atEnd.photo ? mediaUrl(r.model_image) : null,
          lookbook: atEnd.photo && r.model_lookbook === 'PUBLIC' && r.model_slug ? r.model_slug : null,
          opensAt: r.opens_at,
          quantityLine: r.quantity_line ?? '',
        };
      }
    }
    const [sizes, addons, interest] = await Promise.all([
      this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', id).orderBy('position').execute(),
      this.db.selectFrom('live_addons').select(['id', 'label', 'line', 'price_minor']).where('drop_id', '=', id).orderBy('position').execute(),
      this.interestCounts([id]),
    ]);
    const card = await this.card(r, now, interest.get(id) ?? 0);
    return {
      ...card,
      phase: livePhase(r, now) as LiveSheet['phase'],
      description: stages.name ? r.description : null,
      sizes,
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
    return {
      id: pick.r.id,
      phase: pick.phase,
      name: stages.name ? pick.r.model_name : null,
      variant: stages.name ? pick.r.model_variant : null,
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
    return {
      filename: 'orbes-live-release.ics',
      body: liveCalendar({ id, name: stages.name ? r.model_name : null, roomOpensAt: roomOpensAt(r), opensAt: r.opens_at, closesAt: r.closes_at, now, origin: this.origin }),
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
    return { dropId: id, access, entry: entry?.status ?? null };
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
    return {
      access: viewer.access,
      entry: views.get(accountId) ?? null,
      interest: interest ? { dropId: interest.drop_id, size: { id: interest.size_id, label: interest.label }, since: interest.created_at } : null,
      guarantee: guarantee ? { pieces: guarantee.pieces } : null,
    };
  }

  /** The entries of the accounts following a release, by account id (one read for all of them). */
  async viewerEntries(dropId: string, accountIds: readonly string[]): Promise<Map<string, LiveEntryView>> {
    if (accountIds.length === 0) return new Map();
    return liveEntryViews(this.db, this.turnKey, { dropId, accountIds }, this.clock());
  }

  /**
   * One build of a release's room and board, for every viewer and board at once: four reads whatever the audience. Null
   * once it is no longer an announced, published LIVE RELEASE (cancelled, unpublished).
   */
  async frame(dropId: string): Promise<LiveFrame | null> {
    const id = releaseId(dropId);
    const now = this.clock();
    const r = await this.reads().where('d.id', '=', id).where('d.mode', '=', 'LIVE').where('d.published_at', 'is not', null).executeTakeFirst();
    if (!r || r.cancelled_at || !isAnnounced(r, stagesAt(r, now))) return null;
    const [sizes, counts, message] = await Promise.all([
      this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', id).orderBy('position').execute(),
      this.db
        .selectFrom('live_entries')
        .select((eb) => ['size_id', 'status', eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('quantity').as('q')])
        .where('drop_id', '=', id)
        .groupBy(['size_id', 'status'])
        .execute(),
      this.db.selectFrom('live_messages').select(['text', 'created_at']).where('drop_id', '=', id).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst(),
    ]);
    const people = (statuses: readonly string[]) => counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + Number(c.n), 0);
    const pieces = (sizeId: string, statuses: readonly string[]) =>
      counts.filter((c) => c.size_id === sizeId && statuses.includes(c.status)).reduce((n, c) => n + Number(c.q ?? 0), 0);
    const roomSizes: LiveRoomSize[] = sizes.map((s) => {
      const held = pieces(s.id, ['TURN', 'SECURED']);
      return { id: s.id, label: s.label, stock: s.stock, left: Math.max(0, s.stock - held - pieces(s.id, ['CONFIRMED'])), held };
    });
    const phase = livePhase(r, now) as LiveRoom['phase'];
    // Over once the engine has recorded the end (with the waiting and queued entries ENDED in the same transaction) and
    // no turn or hold remains: the clock alone (`phase`, for display) may run ahead of the engine's pass.
    const over = r.ended_at !== null && people(['TURN', 'SECURED']) === 0;
    const stages = liveStages(r, now)!;
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
      quantity: sizes.reduce((n, s) => n + s.stock, 0),
      quantityLine: r.quantity_line ?? '',
      left: roomSizes.reduce((n, s) => n + s.left, 0),
      held: roomSizes.reduce((n, s) => n + s.held, 0),
      sizes: roomSizes,
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
        name: stages.name ? r.model_name : null,
        silhouetteUrl: stages.silhouette ? mediaUrl(r.silhouette_sha256) : null,
        imageUrl: stages.photo ? mediaUrl(r.model_image) : null,
      },
    };
    return { room, board, boardTokenHash: r.board_token_hash ? new Uint8Array(r.board_token_hash) : null };
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
    return rows.map((r) => {
      const stages = liveStages(r, now);
      return {
        release: {
          id: r.id,
          phase: livePhase(r, now),
          endedReason: r.ended_reason,
          title: stages?.name ? r.title : null,
          name: stages?.name ? r.model_name : null,
          variant: stages?.name ? r.model_variant : null,
          imageUrl: stages?.photo ? mediaUrl(r.model_image) : null,
          opensAt: r.opens_at,
          closesAt: r.closes_at,
          afterRoomOf: r.parent_drop_id,
        },
        entry: views.get(r.id)!,
      };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private reads() {
    return this.db
      .selectFrom('drops as d')
      .innerJoin('models as m', 'm.id', 'd.model_id')
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

  private async card(r: ReadRow, now: Date, interest: number): Promise<LiveCard> {
    const stages = liveStages(r, now)!;
    const rule = await liveAccessRule(this.db, r, now);
    return {
      id: r.id,
      kind: 'LIVE',
      phase: livePhase(r, now) as LivePublicPhase,
      revealed: { silhouette: stages.silhouette, name: stages.name, photo: stages.photo },
      stages: { silhouetteAt: stages.silhouetteAt, nameAt: stages.nameAt, photoAt: stages.photoAt },
      reveals: [
        ...(!stages.silhouette && r.silhouette_sha256 ? [{ stage: 'SILHOUETTE' as const, at: stages.silhouetteAt }] : []),
        ...(!stages.name ? [{ stage: 'NAME' as const, at: stages.nameAt }] : []),
        ...(!stages.photo && (r.model_image || (r.model_lookbook === 'PUBLIC' && r.model_slug)) ? [{ stage: 'PHOTO' as const, at: stages.photoAt }] : []),
      ],
      title: stages.name ? r.title : null,
      name: stages.name ? r.model_name : null,
      variant: stages.name ? r.model_variant : null,
      type: stages.name ? r.model_type : null,
      collection: stages.name ? r.collection : null,
      silhouetteUrl: stages.silhouette ? mediaUrl(r.silhouette_sha256) : null,
      imageUrl: stages.photo ? mediaUrl(r.model_image) : null,
      lookbook: stages.photo && r.model_lookbook === 'PUBLIC' && r.model_slug ? r.model_slug : null,
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
    };
  }
}
