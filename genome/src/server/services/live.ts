/**
 * The LIVE RELEASE (plan of 2026-10-04; migration 0021): an instant drop lived in real time. A release of `drops`
 * whose `mode` is LIVE, published by the console, announced from `announce_at` (its publication when NULL).
 *
 *   the room   from `opens_at − room_opens_minutes`: an account allowed in ENTERS with a size of the release (and a
 *              quantity up to `per_account`): WAITING. Until T0 it changes its size, leaves, enters again.
 *   T0         `opens_at`: the line forms (`formLine`): every WAITING entry QUEUED, its tier read again now, ordered
 *              by tier (PALLADIUM first, then PLATINE, TITANE, the others; unless `tier_priority` is off), then by
 *              `sha256(seed ‖ entry id)` (the draw's key, drops.ts `drawKey`, from the release's sealed seed, never
 *              revealed), then by id; places 1, 2, 3… An entry after T0 joins behind, in arrival order. The size never
 *              changes after T0.
 *   turns      a size gives turns while it has free pieces: its stock less the quantities of its entries in TURN,
 *              SECURED and CONFIRMED. The turn goes to the first QUEUED entry of the size, by place, if its quantity
 *              fits; it then holds the seal within `turn_seconds` (TURN). An entry that wants more pieces than its size
 *              can still give (its stock less its CONFIRMED pieces) waits without blocking those behind it; adding pieces
 *              may serve it again. On a release the turns come by the batches of its pace (below); in an after-room at
 *              once. The console may LET IN a QUEUED entry out of order, within the free pieces.
 *   secure     the seal pressed (PRESS: `press_started_at`, the server's clock) and held: SECURE needs the turn's secret
 *              (`liveTurnToken`, its SHA-256 stored), a press at least LIVE_GESTURE_MIN_MS (1.4 s) earlier and a turn
 *              still running; the gesture's length is kept (`gesture_ms`) for the console's bot radar. SECURED: the hold
 *              runs `pay_minutes`; the add-ons are chosen; PAY (CONFIRM) confirms it: one order per piece, RESERVED,
 *              created in the same transaction (services/orders.ts ordersForLiveEntry), which ORBES Client Services
 *              follows to its delivery; RELEASE gives the piece back.
 *   second     a turn that runs out (MISSED), a hold that runs out or is freed by the console (EXPIRED, its add-ons
 *   chance     dropped), a place given back (RELEASED), an entry that leaves its turn or is removed: the piece returns,
 *              and goes to the next in line for that size at the next batch (in an after-room, at once).
 *   pause      the console's PAUSE stops new turns and freezes the deadlines: nobody presses or secures during it (a hold
 *              may still be confirmed, given back, its add-ons chosen); RESUME moves the turns and holds that were still
 *              running when it began by the time paused (`paused_ms_total` adds it). Paused time never consumes a turn
 *              or a hold, and never revives one that had run out.
 *   the pace   ONE QUEUE (lot Q1: ANSWERS CURRENT STATE B1-B7; migrations 0049 and 0058; it replaces K30 as built in
 *              M1, macro scope note of 2026-10-21): every LIVE release has a pace, X people per batch every Y minutes
 *              (`pace_batch`, `pace_minutes`), and a hold after the opening (`pace_hold_minutes`, 0 for none); an
 *              after-room has neither. Batches give TURNS: the first is due at T0 + the hold (everyone waits it, the
 *              house's guarantees included), then one every Y minutes (`pace_next_at`, `pace_batches`); each gives up to
 *              X turns in the order of the turns (`guarantee_id IS NULL, position`) among the entries placed by its
 *              logical time, only where the entry's size has a free piece for it, so fewer while pieces are held; each
 *              turn is stamped with the batch (`admitted_at` its logical time, `admitted_batch` its number), and a batch
 *              that gives none still moves the clock. A piece that returns (MISSED, EXPIRED, RELEASED, LEFT, REMOVED,
 *              freed) and ADD PIECES wait for the next batch. At most one batch goes per published frame of the queue
 *              (live-frames.ts, ANSWERS r4: whoever a batch can reach next reads every change): overdue slots after a
 *              restart go one per frame, each with its own logical time and number. The release's PAUSE and the pace's
 *              PAUSE PACE hold the batches (RESUME moves the next one by the time paused); SET PACE changes X and Y from
 *              the next batch, which keeps its time; NEXT BATCH NOW gives up to X extra turns now (409
 *              LIVE_NOTHING_FREE when no piece is free for anyone waiting), the clock keeping its time; SHORTEN THE HOLD
 *              and END THE HOLD NOW bring the first batch forward, never later, from the announcement until it (before
 *              the announcement the hold is a setting; a NEXT BATCH NOW during the hold leaves it: `pace_extra_batches`);
 *              LET IN gives one entry its turn now, out of order, during the hold too. An entry keeps its place
 *              whatever happens; an absent one's turn runs out (MISSED) and its piece goes at the next batch.
 *   the end    SOLD_OUT, every piece confirmed: WAITING and QUEUED entries ENDED at once. CLOSED at `closes_at`: no new
 *              turn, WAITING and QUEUED ENDED at once; a turn in progress may still be secured, a hold confirmed, until
 *              their deadlines. ENDED by an ADMIN: WAITING, QUEUED and TURN ENDED at once; holds may still be
 *              confirmed. `ended_at` and `ended_reason` say when it began; the release is over once no turn and no hold
 *              is left. EXTEND moves `closes_at`, ADD PIECES raises a size's stock, before the end only.
 *
 * The after-room (after-room.ts, plan LIVE RELEASE+): a child LIVE RELEASE (`parent_drop_id`) that a release's sell-out
 * opens for the entries it ENDS, remembered then (`endRelease`, before they are ENDED). It is seen from its T0 by its
 * guests only (`lockAnnouncedLive`: anyone else, and a guest before it, reads an unknown release); a guest ENTERS with
 * a size straight into its line, at the place it was given (its order in the parent's line); then the turns, the hold,
 * the add-ons and PAY as above, with the parent's per-tier windows. It has no boutique board.
 *
 * THE SET (macro scope of 2026-10-20, K44 T1, T2 and T4; plan MACRO M3 §5.1 and §5.2; migration 0057): a LIVE RELEASE
 * may sell a set (`set_id`, its sizes given per piece, `drop_sizes.piece`): I'LL BE THERE, ENTER and CHANGE SIZE name a
 * size per piece (`sizes`, 422 LIVE_SET_SIZES otherwise), its first piece's kept in `size_id`, every piece's in
 * `live_entry_sizes` and `live_interest_sizes`; an entry's quantity is its sets, a set counting as one toward
 * `per_account` (T4, 1 to LIVE_PER_ACCOUNT.max sets: its orders' `orders.piece` up to 20). An entry counts in each of its
 * sizes (`sizeTotals`); it takes its turn when each of its sizes has free pieces for its sets, one that does not fit yet
 * holding back every size it needs (`setTurns`); LET IN within each of its sizes; PAY makes one set sale per set, one order
 * per piece (orders.ts ordersForLiveEntry, set-sales.ts ordersForSetSale: T2, each piece its own ORBES identity); its sets
 * on sale are the smallest of its pieces' totals (`onSaleOf`, its `quantity`), SOLD_OUT once they are confirmed; ADD
 * PIECES raises one size of one piece. A set's release is never guaranteed and never has an after-room.
 *
 * THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01; services/guarantees.ts, migration 0029): a holder of a guarantee set
 * aside for the release is let in whatever its rule (`accessOf`), takes up to max(`per_account`, its pieces), in a size
 * that can still serve it (409 LIVE_GUARANTEE_SIZE_FULL, at ENTER and CHANGE SIZE; a guarantee not shown leaves no mark
 * there: the entry is an ordinary one and the guarantee stays set aside). Its entry (`guarantee_id`) comes
 * first in line at T0 (`lineOrder`) and first among those waiting in its size afterwards (`batchGrants`, the places
 * ahead, the console's list and the after-room's guests order `guarantee_id IS NULL, position`); the turn given uses the
 * guarantee (USED). LEAVE, REMOVE and a lock before the turn unbind it, the guarantee staying ACTIVE; at the end and at
 * a cancellation, a guarantee set aside and not used is carried to the next release of its model or collection, or
 * expires with a chosen release. An after-room is never covered.
 *
 * Access (`accessOf`), read at INTEREST, ENTER and SECURE (just before the action takes the release's row: its rules no
 * longer change once it is announced), and when the room is read: an ACTIVE account against each rule the release has,
 * combined as `access_combine` says (AND, the default: every rule; OR: any one of them):
 *  - the tier: its tier (club.ts `tierOf`, the pieces held now) reaches `live_min_tier` (a rule from TITANE up);
 *  - the pieces: when the release names models (`live_access_models`) or a collection (`access_collection_id`), it
 *    holds now a piece of one of them (its own collection first, its model's otherwise; a test entrant holds one);
 *  - taking part (plan LIVE RELEASE+, choice 4): it has taken part in at least `min_participations` releases
 *    (services/participation.ts), the release itself never counted;
 *  - a segment (choice 27, N5): it is a member of `access_segment_id` now (services/segments.ts).
 * The public reads each rule in words (`liveRuleText`): « owners from PLATINE », « collectors who have taken part in 3
 * releases », « selected collectors » (decision 32: a segment's name is never said), the rules joined by « or » with OR;
 * with AND, one collector who meets them all (« selected owners from PLATINE who have taken part in 3 releases »). A
 * refusal (403 LIVE_NOT_ELIGIBLE, `liveRefusal`) says the rule, and how many releases the account has taken part in
 * when the release counts them; a collector who lacks only the segment reads « This release is for selected
 * collectors. ».
 *
 * The engine (live-engine.ts) runs `advance` for each release in its live window every 250 ms: one transaction, the
 * release's row FOR NO KEY UPDATE: the line at T0, the turns and holds run out (not while paused), the end, the turns. Every
 * customer and console action takes the release's row first, then the entry's (FOR SHARE when it changes no count:
 * PRESS, SECURE, add-ons, interest; FOR UPDATE otherwise), and reads the clock once it holds them; every transaction
 * writes its audit entries last, so no row is locked after the audit chain's lock. Deadlines are compared with the
 * clock in every action, so a turn or a hold that ran out is refused even before the engine marks it; what the engine
 * writes uses the logical times (a turn MISSED at its deadline, a release CLOSED at `closes_at`), so a restart changes
 * nothing.
 *
 * The audit log names releases, entries, sizes and add-ons by id, never an email: the customers' state changes
 * (`drop.live.enter`, `.size`, `.leave`, `.interest`, `.interest.withdraw`, `.secure`, `.addons`, `.confirm`,
 * `.release`; a PRESS changes no state and is not audited), the engine's (`drop.live.queue` at T0, `drop.live.end` for
 * SOLD_OUT and CLOSED, `drop.live.batch` for a batch that gave turns, as counts, the system as actor) and the console's
 * (`drop.live.pause`, `.resume`, `.extend`, `.stock`, `.free`, `.let_in`, `.message`, `.end`, `.remove`, the pace's
 * `.pace`, `.pace.pause`, `.pace.resume` and `.pace.next`, the hold's `.hold.shorten` and `.hold.end`, as counts, and
 * the boutique board's link, `.board.issue` and
 * `.board.revoke`, never with its secret). A lock of an account (OwnerService) removes its open entries and
 * withdraws its interest in the releases not opened yet (`removeAccountLiveEntries`); the right of access exports every
 * entry with its add-ons, and its interest (`accountLiveData`).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { normalizeIP } from '@fastify/rate-limit';
import { sql, type Expression, type SqlBool } from 'kysely';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { LIVE_HOLD_MINUTES, LIVE_PACE_BATCH, LIVE_PACE_MINUTES, type AccessCombine, type DropRow, type LiveEndReason, type LiveEntryStatus, type LiveResolution } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, SYSTEM_ACTOR, type Actor, type Clock } from '../types.js';
import { afterRoomDoors, afterRoomPlace, isAfterRoom, settleAfterRoom, type AfterRoomDoor } from './after-room.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { clubCounts, clubStandings, isTestEntrant, tierName, tierOf, type ClubTier } from './club.js';
import { DROP_QUANTITY_MAX, drawKey, dropNotFound, openDropSeed } from './drops.js';
import { holderGuarantee, holdsGuaranteeFor, releaseCovered, sizeServesGuarantee, useGuarantees, visibleGuaranteeIds } from './guarantees.js';
import { LiveChanges, LiveFrameGate, withLiveChanges, type PendingBatch } from './live-frames.js';
import { closeGuard, liveQueueSnapshot, queueView, type LiveCloseGuard, type LiveQueueSnapshot, type LiveQueueView } from './live-queue.js';
import { addonOffer, choicesOf, cleanAddonItems, clearChoices, setChoices, type AddonOfferItem, type AddonUnitsInput, type ChosenAddon, type LeftOutAddon } from './order-addons.js';
import { ordersForLiveEntry } from './orders.js';
import { setPieces, type ReleasePiece } from './release-offer.js';
import { entryPieceSizes } from './set-sales.js';
import { defaultLocationId } from './stock.js';
import { readActingAccount } from './ownership.js';
import { participationCount, participations } from './participation.js';
import { cleanCriteria, isSegmentMember, segmentCondition, type SegmentGroup } from './segments.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The settings of a LIVE RELEASE, their bounds (the CHECKs of migration 0021) and their defaults (the plan's choices 15 and 16). */
export const LIVE_ROOM_OPENS_MINUTES = Object.freeze({ min: 1, max: 60, default: 5 });
export const LIVE_TURN_SECONDS = Object.freeze({ min: 10, max: 300, default: 30 });
export const LIVE_PAY_MINUTES = Object.freeze({ min: 1, max: 60, default: 5 });
export const LIVE_PER_ACCOUNT = Object.freeze({ min: 1, max: 5, default: 1 });
/** A size's stock at most (drop_sizes.stock). */
export const LIVE_SIZE_STOCK_MAX = 10_000;
/** The add-ons a release offers, at most (live_addons.position 1..6). */
export const LIVE_ADDONS_MAX = 6;
/** The seal held at least this long, from the press to the secure, on the server's clock (live_entries.gesture_ms). */
export const LIVE_GESTURE_MIN_MS = 1400;
/** A host message: one line of 1 to 140 characters. */
export const LIVE_MESSAGE_MAX = 140;
/** EXTEND moves the end of the sales by 1 to 240 minutes at a time. */
export const LIVE_EXTEND_MINUTES = Object.freeze({ min: 1, max: 240 });
/** ADD PIECES raises a size's stock by 1 to 1 000 at a time. */
export const LIVE_ADD_PIECES = Object.freeze({ min: 1, max: 1000 });
/** A rule of taking part (plan LIVE RELEASE+, choice 4): at least 1 to 100 releases (drops.min_participations). */
export const LIVE_MIN_PARTICIPATIONS = Object.freeze({ min: 1, max: 100 });
/** The surprise in every box (choice 3): its description, internal, 1 to 500 characters (drops.surprise_text). */
export const LIVE_SURPRISE_MAX = 500;
/**
 * The question after a release (plan LIVE RELEASE+, choice 11) when the console does not rewrite it: its words and its
 * answers, in order (release_answers.answer is an answer's position, from 1).
 */
export const LIVE_QUESTION_DEFAULT = Object.freeze({
  text: 'WHAT WOULD YOU HAVE WANTED?',
  answers: Object.freeze(['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'] as const),
});
/** The boutique board's link: a secret of 32 random bytes (256 bits), base64url, kept only as its SHA-256. */
export const LIVE_BOARD_TOKEN_BYTES = 32;
/** The network's hash of an entry is erased this many days after the release's end (or its cancellation). */
export const LIVE_NETWORK_RETENTION_DAYS = 30;
/** The pace (the CHECKs of migration 0049): X people per batch every Y minutes, X 1 to 5 000, Y 1 to 60; the hold after the opening (0058), 0 to 120 minutes. */
export { LIVE_HOLD_MINUTES, LIVE_PACE_BATCH, LIVE_PACE_MINUTES };

/**
 * What a release has on sale (macro scope K44 T1): a model's, its sizes' stock summed; a set's, its sets, the smallest of
 * its pieces' totals (each piece's sizes summed: a set takes one piece of each).
 */
export function onSaleOf(sizes: readonly { piece?: number | null; stock: number }[]): number {
  const byPiece = new Map<number, number>();
  let plain = 0;
  for (const s of sizes) {
    if (s.piece === null || s.piece === undefined) plain += s.stock;
    else byPiece.set(s.piece, (byPiece.get(s.piece) ?? 0) + s.stock);
  }
  return byPiece.size === 0 ? plain : Math.min(...byPiece.values());
}

/**
 * The turns a set's release gives now (macro scope K44 T1; pure, a batch's turns on a set's release, `batchGrants`): in the
 * line's order, an entry takes its turn when each of its sizes has free pieces for its quantity. One that wants more than
 * one of its sizes can ever give (its stock less its confirmed pieces) is passed over, as for a model; one that does not
 * fit yet, or waits behind a size held back, holds back every size it needs, so an entry behind it needing one of them
 * waits (each size keeps its line's order), while entries needing other sizes go on. A model's release is the same rule
 * with one size per entry.
 */
export function setTurns<E extends { quantity: number; sizeIds: readonly string[] }>(queued: readonly E[], sizes: ReadonlyMap<string, { free: number; servable: number }>): E[] {
  const free = new Map([...sizes].map(([id, s]) => [id, s.free]));
  const held = new Set<string>();
  const out: E[] = [];
  for (const e of queued) {
    if (e.sizeIds.length === 0 || e.sizeIds.some((id) => e.quantity > (sizes.get(id)?.servable ?? 0))) continue;
    if (e.sizeIds.some((id) => held.has(id) || e.quantity > (free.get(id) ?? 0))) {
      for (const id of e.sizeIds) held.add(id);
      continue;
    }
    out.push(e);
    for (const id of e.sizeIds) free.set(id, free.get(id)! - e.quantity);
  }
  return out;
}

/** The entries that hold pieces of their size, by their quantity. */
export const LIVE_HOLDING_STATUSES = Object.freeze(['TURN', 'SECURED', 'CONFIRMED'] as const);
/** The entries still in a release. */
export const LIVE_OPEN_STATUSES = Object.freeze(['WAITING', 'QUEUED', 'TURN', 'SECURED'] as const);

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const TURN_KEY_INFO = 'orbes/live-turn/v1';
const NETWORK_LABEL = 'orbes/live-network/v1';

type LiveDrop = DropRow;
type Lock = 'update' | 'share';

/** When the room of a release opens: `room_opens_minutes` before T0. */
export function roomOpensAt(d: Pick<DropRow, 'opens_at' | 'room_opens_minutes'>): Date {
  return new Date(new Date(d.opens_at).getTime() - (d.room_opens_minutes ?? LIVE_ROOM_OPENS_MINUTES.default) * MINUTE_MS);
}

/** When a release is announced: `announce_at`, or its publication; null while it is a DRAFT. */
export function announcedAt(d: Pick<DropRow, 'announce_at' | 'published_at'>): Date | null {
  return d.announce_at ?? d.published_at ?? null;
}

/** When each stage of a release is revealed, and whether it is at `now`. */
export interface LiveStages {
  silhouetteAt: Date;
  nameAt: Date;
  photoAt: Date;
  silhouette: boolean;
  name: boolean;
  photo: boolean;
}

export type LiveStageRow = Pick<DropRow, 'announce_at' | 'published_at' | 'silhouette_at' | 'name_at' | 'photo_at' | 'opens_at' | 'room_opens_minutes'>;

/**
 * The stages of an announced release (null before its publication): each at its time, a NULL one at the announcement,
 * none before the one it follows, every one at the room's opening at the latest.
 */
export function liveStages(d: LiveStageRow, now: Date): LiveStages | null {
  const announced = announcedAt(d);
  if (!announced) return null;
  const a = announced.getTime();
  const room = Math.max(a, roomOpensAt(d).getTime());
  const at = (stage: Date | null, after: number) => Math.min(room, Math.max(after, stage ? new Date(stage).getTime() : a));
  const silhouetteAt = at(d.silhouette_at, a);
  const nameAt = at(d.name_at, silhouetteAt);
  const photoAt = at(d.photo_at, nameAt);
  const t = now.getTime();
  return {
    silhouetteAt: new Date(silhouetteAt),
    nameAt: new Date(nameAt),
    photoAt: new Date(photoAt),
    silhouette: t >= silhouetteAt,
    name: t >= nameAt,
    photo: t >= photoAt,
  };
}

/**
 * The moment a release's stages are read at `now`: its end once ended, else now. A release ended before a stage never
 * reaches it (one ended before its name was revealed is named nowhere, even after the time its name was set for); one
 * ended before its announcement was never announced.
 */
export function stagesAt(d: Pick<DropRow, 'ended_at'>, now: Date): Date {
  return d.ended_at && new Date(d.ended_at).getTime() < now.getTime() ? new Date(d.ended_at) : now;
}

/** How long a pause in progress has lasted at `now` (0 without one). */
export function pausedFor(d: Pick<DropRow, 'paused_at'>, now: Date): number {
  return d.paused_at ? Math.max(0, now.getTime() - new Date(d.paused_at).getTime()) : 0;
}

/** A deadline as it stands at `now`: moved by the pause in progress (RESUME moves the stored one by the whole pause). */
export function effectiveDeadline(deadline: Date, d: Pick<DropRow, 'paused_at'>, now: Date): Date {
  return new Date(new Date(deadline).getTime() + pausedFor(d, now));
}

export type LivePaceRow = Pick<DropRow, 'opens_at' | 'paused_at' | 'pace_batch' | 'pace_minutes' | 'pace_paused_at' | 'pace_next_at' | 'pace_hold_minutes'>;

/**
 * When the next batch of a paced release is due: `pace_next_at`, or T0 + the hold before the first (D4: everyone waits
 * the hold). Null without a pace (an after-room).
 */
export function paceNextAt(d: LivePaceRow): Date | null {
  if (d.pace_batch === null || d.pace_batch === undefined) return null;
  return new Date(d.pace_next_at ?? new Date(new Date(d.opens_at).getTime() + (d.pace_hold_minutes ?? 0) * MINUTE_MS));
}

/**
 * When the hold after the opening ends (the first scheduled batch's time) while it lasts: a hold set, no scheduled batch
 * given yet; else null. A NEXT BATCH NOW during the hold starts the first turns early and leaves the hold as it was (D4,
 * ANSWERS A 157 "The batch clock keeps its time", A 160 "You can bring the first turns forward (or start them now with
 * NEXT BATCH NOW)"): its batches (`pace_extra_batches`) do not end it, so it can still be shortened or ended.
 */
export function holdEndsAt(d: LivePaceRow & Pick<DropRow, 'pace_batches' | 'pace_extra_batches'>): Date | null {
  if (d.pace_batch === null || !(Number(d.pace_hold_minutes) > 0) || Number(d.pace_batches) > Number(d.pace_extra_batches ?? 0)) return null;
  return paceNextAt(d);
}

/** Whether a paced release holds its pace now: by the pace's own pause or by the release's PAUSE. */
export function paceHeld(d: Pick<DropRow, 'paused_at' | 'pace_paused_at'>): boolean {
  return d.paused_at !== null || d.pace_paused_at !== null;
}

/**
 * How far one pause that ends at `now` moves the next batch: the time it was the pace's only hold, so a stretch held
 * by both pauses (the pace's own and the release's) counts once. `own` began this pause; `other` is the other one, if
 * it is still in progress (it moves the batch for the rest when it ends).
 */
export function paceShiftMs(own: Date, other: Date | null, now: Date): number {
  const end = other ? Math.min(now.getTime(), new Date(other).getTime()) : now.getTime();
  return Math.max(0, end - new Date(own).getTime());
}

/** Where a published LIVE RELEASE stands at `now`, from its row alone. */
export type LivePhase = 'DRAFT' | 'CANCELLED' | 'HIDDEN' | 'ANNOUNCED' | 'ROOM' | 'LIVE' | 'ENDED';
/** Every phase, in the order a release goes through them (the console mirrors it: web/admin/types.ts LIVE_PHASES). */
export const LIVE_PHASES = Object.freeze(['DRAFT', 'HIDDEN', 'ANNOUNCED', 'ROOM', 'LIVE', 'ENDED', 'CANCELLED'] as const satisfies readonly LivePhase[]);

export function livePhase(d: Pick<DropRow, 'published_at' | 'cancelled_at' | 'announce_at' | 'opens_at' | 'closes_at' | 'room_opens_minutes' | 'ended_at'>, now: Date): LivePhase {
  if (d.cancelled_at) return 'CANCELLED';
  if (!d.published_at) return 'DRAFT';
  if (d.ended_at || now.getTime() >= new Date(d.closes_at).getTime()) return 'ENDED';
  if (now.getTime() >= new Date(d.opens_at).getTime()) return 'LIVE';
  if (now.getTime() >= roomOpensAt(d).getTime()) return 'ROOM';
  const announced = announcedAt(d);
  return announced && now.getTime() >= announced.getTime() ? 'ANNOUNCED' : 'HIDDEN';
}

/** The turn and pay windows of an entry: its tier's override where one is set, the release's otherwise. */
export interface LiveWindows {
  turnSeconds: number;
  payMinutes: number;
}

export interface LiveTierWindow {
  tier: number;
  turn_seconds: number | null;
  pay_minutes: number | null;
}

export function windowsFor(d: Pick<DropRow, 'turn_seconds' | 'pay_minutes'>, overrides: readonly LiveTierWindow[], tier: number): LiveWindows {
  const o = overrides.find((w) => w.tier === tier);
  return {
    turnSeconds: o?.turn_seconds ?? d.turn_seconds ?? LIVE_TURN_SECONDS.default,
    payMinutes: o?.pay_minutes ?? d.pay_minutes ?? LIVE_PAY_MINUTES.default,
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The line at T0 (pure): the places guaranteed by the house first (plan NEXT-NINE, IN-01: `guaranteed`), then the tier
 * (descending, when `tierPriority`), then `drawKey(seed, id)` (ascending), then the id. Anyone with the seed, the entries
 * and their tiers computes the same places.
 */
export function lineOrder<T extends { id: string; tier: number; guaranteed?: boolean }>(entries: readonly T[], seed: Uint8Array, tierPriority: boolean): T[] {
  const keyed = entries.map((e) => ({ e, id: e.id.toLowerCase(), key: drawKey(seed, e.id) }));
  keyed.sort((a, b) => Number(b.e.guaranteed === true) - Number(a.e.guaranteed === true) || (tierPriority ? b.e.tier - a.e.tier : 0) || compare(a.key, b.key) || compare(a.id, b.id));
  return keyed.map((k) => k.e);
}

/**
 * Purpose-bound key of the turns' secrets: HKDF from the key-encryption key when configured, else from the cookie
 * secret, as the seeds of the drops (drops.ts `deriveDropSeedKey`).
 */
export function deriveLiveTurnKey(config: Pick<AppConfig, 'keys' | 'cookieSecret'>): Uint8Array {
  const ikm = config.keys.encryptionKey ? fromBase64Url(config.keys.encryptionKey) : utf8(config.cookieSecret);
  return deriveSubkey(ikm, TURN_KEY_INFO, { salt: 'ORBES' });
}

/**
 * The secret of a turn, given to its account only (its own state): HMAC-SHA256 of the entry and the turn's start,
 * base64url. Any instance of the server computes it again; the database keeps its SHA-256 (`turn_token_hash`).
 */
export function liveTurnToken(turnKey: Uint8Array, entryId: string, turnAt: Date): string {
  return createHmac('sha256', turnKey).update(`${TURN_KEY_INFO}\u0000${entryId.toLowerCase()}\u0000${new Date(turnAt).getTime()}`, 'utf8').digest('base64url');
}

export function turnTokenHash(token: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

/** The SHA-256 of a board link's secret (drops.board_token_hash); null for anything that cannot be one (not 43 base64url characters). */
export function liveBoardTokenHash(token: unknown): Uint8Array | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

function sameHash(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && timingSafeEqual(a, b);
}

/** The network an address belongs to, as the bot radar groups entries: its /24 in IPv4, its /48 in IPv6. */
export function liveNetworkPrefix(ip: string): string {
  let address: string;
  try {
    address = normalizeIP(ip, 48);
  } catch {
    address = String(ip).toLowerCase();
  }
  if (isIPv4(address)) return `${address.split('.').slice(0, 3).join('.')}.0/24`;
  return `${address}/48`;
}

/** The keyed SHA-256 of an address's network (live_entries.network_hash): HMAC with the IP pepper, never the address. */
export function liveNetworkHash(pepper: string, ip: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', pepper).update(`${NETWORK_LABEL}\u0000${liveNetworkPrefix(ip)}`, 'utf8').digest());
}

// ── Errors ─────────────────────────────────────────────────────────────────

const utcMinute = (t: Date) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const liveCancelled = () => conflict('DROP_CANCELLED', 'This release has been cancelled.');
const roomNotOpen = (from: Date) => conflict('LIVE_ROOM_NOT_OPEN', `The room of this release opens on ${utcMinute(from)}.`);
const liveOver = () => conflict('LIVE_OVER', 'This release is over.');
const alreadyEntered = () => conflict('LIVE_ALREADY_ENTERED', 'You are already in this release.');
const notEntered = () => conflict('LIVE_NOT_ENTERED', 'You are not in this release.');
const notInLine = () => conflict('LIVE_NOT_IN_LINE', 'You are no longer in the line of this release.');
const sizeUnknown = () => new DomainError('LIVE_SIZE_UNKNOWN', 400, 'Choose one of the sizes of this release.');
const sizeSoldOut = () => conflict('LIVE_SIZE_SOLD_OUT', 'Every piece in this size is reserved.');
/** IN-01: the size cannot serve the house's guarantee of the entry (verify/copy.ts GUARANTEE.sizeFull). */
const guaranteeSizeFull = () => conflict('LIVE_GUARANTEE_SIZE_FULL', 'Your guaranteed place cannot be given in this size: choose another size.');
const quantityInvalid = (max: number, sets = false) =>
  new DomainError('LIVE_QUANTITY_INVALID', 400, max === 1 ? `This release offers one ${sets ? 'set' : 'piece'} per person.` : `This release offers 1 to ${max} ${sets ? 'sets' : 'pieces'} per person.`);
/** Macro scope K44 T1: 422 LIVE_SET_SIZES, an entry or an interest of a set's release names one size per piece, of that piece. */
const setSizes = (message: string) => new DomainError('LIVE_SET_SIZES', 422, message);
const notASet = () => validationError('This release sells one model: choose its size.');
const sizeLocked = () => conflict('LIVE_SIZE_LOCKED', 'Sizes are fixed once the release opens.');
const notYourTurn = () => conflict('LIVE_NOT_YOUR_TURN', 'It is not your turn.');
const turnChanged = () => conflict('LIVE_TURN_CHANGED', 'This turn is no longer the one on your screen. Refresh the page.');
const turnPassed = () => conflict('LIVE_TURN_PASSED', 'Your turn has passed.');
const holdTooShort = () => conflict('LIVE_HOLD_TOO_SHORT', 'Press and hold the seal until the ring is full.');
const livePaused = () => conflict('LIVE_PAUSED', 'The release is paused. It resumes shortly.');
const notSecured = () => conflict('LIVE_NOT_SECURED', 'No piece is held for you.');
const holdEnded = () => conflict('LIVE_HOLD_ENDED', 'Your hold has ended.');
const interestClosed = () => conflict('LIVE_INTEREST_CLOSED', 'The release has opened: the room replaces I’LL BE THERE.');
const notInterested = () => conflict('LIVE_NOT_INTERESTED', 'You have not said you will be there.');
const addonUnknown = () => new DomainError('LIVE_ADDON_UNKNOWN', 400, 'Choose among the add-ons of this release.');
const liveNotStarted = () => conflict('LIVE_NOT_STARTED', 'This release has not opened yet.');
const liveEnded = () => conflict('LIVE_ENDED', 'This release has ended.');
const liveNotAnnounced = () => conflict('LIVE_NOT_ANNOUNCED', 'This release is not announced yet: change its sizes in the settings until the announcement.');
const messageTooEarly = () => conflict('LIVE_NOT_ANNOUNCED', 'This release is not announced yet: a host message is written from its announcement.');
const alreadyPaused = () => conflict('LIVE_ALREADY_PAUSED', 'This release is already paused.');
const notPaused = () => conflict('LIVE_NOT_PAUSED', 'This release is not paused.');
const noFreePiece = () => conflict('LIVE_NO_FREE_PIECE', 'No piece of this size is free for this entry.');
const entryNotFound = () => notFound('Entry', 'LIVE_ENTRY_NOT_FOUND');
const entryNotQueued = () => conflict('LIVE_ENTRY_NOT_QUEUED', 'Only an entry waiting in the line can take its turn now.');
const entryNotSecured = () => conflict('LIVE_ENTRY_NOT_SECURED', 'Only a held piece can be freed.');
const entryClosed = () => conflict('LIVE_ENTRY_CLOSED', 'This entry is no longer in the release.');
const noBoardLink = () => conflict('LIVE_NO_BOARD_LINK', 'This release has no board link.');
const afterRoomBoard = () => conflict('LIVE_AFTER_ROOM', 'An after-room has no board: nobody but its guests ever sees it.');
const afterRoomPace = () => conflict('LIVE_AFTER_ROOM', 'An after-room has no pace: its guests come straight from the release’s line.');
const noPace = () => conflict('LIVE_NO_PACE', 'This release has no pace: set one first.');
const paceAlreadyPaused = () => conflict('LIVE_PACE_ALREADY_PAUSED', 'The pace of this release is already paused.');
const paceNotPaused = () => conflict('LIVE_PACE_NOT_PAUSED', 'The pace of this release is not paused.');
const paceInvalid = () =>
  validationError(`A pace gives ${LIVE_PACE_BATCH.min} to ${LIVE_PACE_BATCH.max} turns every ${LIVE_PACE_MINUTES.min} to ${LIVE_PACE_MINUTES.max} minutes.`);
const nothingFree = () => conflict('LIVE_NOTHING_FREE', 'No piece is free for anyone waiting.');
const batchWaiting = () => new DomainError('LIVE_BATCH_WAITING', 503, 'The batch could not be given yet: nothing was given. Press NEXT BATCH NOW again in a moment.');
const noHold = () => conflict('LIVE_NO_HOLD', 'This release has no hold left: its first turns have been given or are due now.');
const holdLater = () => conflict('LIVE_HOLD_LATER', 'A hold can only be shortened.');
const holdTooEarly = () => conflict('LIVE_NOT_ANNOUNCED', 'This release is not announced yet: change its hold in the settings until the announcement.');
const holdPast = () => validationError('A shortened hold ends later than now: END THE HOLD NOW starts the turns at once.');
const holdInvalid = () => validationError(`A hold lasts ${LIVE_HOLD_MINUTES.min} to ${LIVE_HOLD_MINUTES.max} minutes after the opening.`);

/** 403 LIVE_NOT_ELIGIBLE: the rule of the release in words, and the account's own standing against it (`liveRefusal`). */
export const liveNotEligible = (rule: LiveAccessRule, access?: LiveAccess) => new DomainError('LIVE_NOT_ELIGIBLE', 403, liveRefusal(rule, access));
const notEligible = liveNotEligible;

function assertStaff(actor: Actor, what: string): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
  return actor.id.toLowerCase();
}

function assertAccount(accountId: string): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
  return accountId.toLowerCase();
}

function knownId(id: string, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

// ── Access ─────────────────────────────────────────────────────────────────

/**
 * Who may enter a release: a tier, the owners of its models or of its collection when it names any, the collectors who
 * have taken part in a number of releases, the members of a segment; and how those rules combine.
 */
export interface LiveAccessRule {
  minTier: ClubTier;
  models: { id: string; name: string }[];
  collection: { id: string; name: string } | null;
  /** The releases taken part in, at least; null (or absent): no such rule. */
  minParticipations?: number | null;
  /** A segment's members (its name never said: decision 32); false (or absent): no such rule. */
  segment?: boolean;
  /** AND (or absent): every rule; OR: any one of them. */
  combine?: AccessCombine;
}

/** A rule of a release, in the order they are read and said. */
export type LiveAccessMissing = 'TIER' | 'PIECE' | 'PARTICIPATION' | 'SEGMENT';

/** An account against the rule of a release, now. */
export interface LiveAccess {
  allowed: boolean;
  /** The account's tier now (club.ts tierOf). */
  tier: ClubTier;
  /**
   * What it lacks, null when allowed: with AND the first rule it does not meet (the tier, a piece of the models or
   * collection named, the releases taken part in, the segment); with OR, every rule failed, the release's first.
   */
  missing: LiveAccessMissing | null;
  /** The releases it has taken part in (the release itself not counted), when the release has that rule; else null. */
  participations: number | null;
}

const releasesWord = (n: number) => `${n} ${n === 1 ? 'release' : 'releases'}`;

/**
 * The rule in words, as an announcement says it after « FOR »: « owners from PLATINE », « owners of MONOLITHE »,
 * « collectors who have taken part in 3 releases », « selected collectors »; with OR, each rule said and joined by « or »
 * (« owners from PLATINE or collectors who have taken part in 3 releases »); with AND, the one collector who meets them
 * all (« selected owners from PLATINE who have taken part in 3 releases »). « every ORBES account » without any rule.
 */
export function liveRuleText(rule: LiveAccessRule): string {
  const collection = rule.collection && (rule.collection.name === LIVE_UNNAMED_COLLECTION ? LIVE_UNNAMED_COLLECTION : `the ${rule.collection.name} collection`);
  const names = [...rule.models.map((m) => m.name), ...(collection ? [collection] : [])];
  const of = names.length === 0 ? '' : ` of ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`}`;
  const took = rule.minParticipations ? `who have taken part in ${releasesWord(rule.minParticipations)}` : null;
  if (rule.combine === 'OR') {
    const said = [
      rule.minTier >= 2 ? `owners from ${tierName(rule.minTier)}` : rule.minTier === 1 ? 'owners' : null,
      // TITANE is any owner: a piece of the models named adds nobody to it.
      of && rule.minTier !== 1 ? `owners${of}` : null,
      took ? `collectors ${took}` : null,
      rule.segment ? 'selected collectors' : null,
    ].filter((x): x is string => x !== null);
    return said.length ? said.join(' or ') : 'every ORBES account';
  }
  const base = rule.minTier >= 2 ? `owners from ${tierName(rule.minTier)}${of}` : rule.minTier === 1 || of ? `owners${of}` : null;
  if (!took && !rule.segment) return base ?? 'every ORBES account';
  return [rule.segment ? 'selected' : null, base ?? 'collectors', took].filter((x): x is string => x !== null).join(' ');
}

/**
 * What a refusal says (403 LIVE_NOT_ELIGIBLE, the not-eligible page): « This release is for <the rule>. », then, when the
 * release counts the releases taken part in, « You have taken part in 1 release. »; a collector who meets every rule
 * but the segment (AND) reads only « This release is for selected collectors. » (decision 32).
 */
export function liveRefusal(rule: LiveAccessRule, access?: Pick<LiveAccess, 'missing' | 'participations'>): string {
  if (rule.combine !== 'OR' && access?.missing === 'SEGMENT') return 'This release is for selected collectors.';
  const counted = rule.minParticipations && access && access.participations !== null ? ` You have taken part in ${releasesWord(access.participations)}.` : '';
  return `This release is for ${liveRuleText(rule)}.${counted}`;
}

/** The model named in place of the release's own before its name's stage. */
export const LIVE_UNNAMED_MODEL = 'this model';
/** The collection named in place of the release's model's own before its name's stage. */
export const LIVE_UNNAMED_COLLECTION = 'this model’s collection';

/**
 * The rule of a release as anyone may read it at `now` (an announcement, a 403 LIVE_NOT_ELIGIBLE, the circle's post): a
 * model it names that is the release's own is « this model », and a collection that is its model's own « this model’s
 * collection », until the name's stage (liveStages, read at the end once ended: stagesAt), so no answer says the name or
 * its collection before; `unnamed`: so at any time (the circle's post, which never names the piece).
 */
export async function liveAccessRule(
  db: Db,
  d: Pick<DropRow, 'id' | 'model_id' | 'live_min_tier' | 'access_collection_id' | 'min_participations' | 'access_segment_id' | 'access_combine' | 'ended_at'> & { set_id?: string | null } & LiveStageRow,
  now: Date,
  unnamed = false,
): Promise<LiveAccessRule> {
  const models = await db
    .selectFrom('live_access_models as a')
    .innerJoin('models as m', 'm.id', 'a.model_id')
    .select(['m.id', 'm.name'])
    .where('a.drop_id', '=', d.id)
    .orderBy('m.name')
    .orderBy('m.id')
    .execute();
  const collection = d.access_collection_id
    ? ((await db.selectFrom('collections').select(['id', 'name']).where('id', '=', d.access_collection_id).executeTakeFirst()) ?? null)
    : null;
  const named = !unnamed && (liveStages(d, stagesAt(d, now))?.name ?? false);
  // The release's own models: its model's, or (macro scope K44 T1) each of its set's pieces', unnamed until the name's stage.
  const ownModels = named ? [] : d.set_id ? (await setPieces(db, d.set_id)).map((p) => p.model.id) : d.model_id ? [d.model_id] : [];
  const own =
    collection && !named && ownModels.length
      ? await db.selectFrom('models').select('collection_id').where('id', 'in', ownModels).where('collection_id', '=', collection.id).executeTakeFirst()
      : undefined;
  return {
    minTier: Math.min(3, Math.max(0, d.live_min_tier ?? 0)) as ClubTier,
    models: named ? models : models.map((m) => (ownModels.includes(m.id) ? { id: m.id, name: LIVE_UNNAMED_MODEL } : m)),
    collection: collection && own?.collection_id === collection.id ? { id: collection.id, name: LIVE_UNNAMED_COLLECTION } : collection,
    minParticipations: d.min_participations ?? null,
    segment: d.access_segment_id !== null && d.access_segment_id !== undefined,
    combine: d.access_combine ?? 'AND',
  };
}

/**
 * The account against the rules of the release at `now` (see the file header), combined by `access_combine` (NULL: AND).
 * Each rule is read only when the release has it: the tier when `live_min_tier` is set above 0; the pieces when it names
 * models or a collection, a piece the club counts (club.ts) held now; taking part when `min_participations` is set,
 * this release left out; the segment when `access_segment_id` is set, its members read now.
 */
export async function accessOf(
  db: Db,
  d: Pick<DropRow, 'id' | 'live_min_tier' | 'access_collection_id' | 'min_participations' | 'access_segment_id' | 'access_combine'>,
  accountId: string,
  now: Date,
): Promise<LiveAccess> {
  const { tier } = await tierOf(db, accountId, now);
  const models = await db.selectFrom('live_access_models').select('model_id').where('drop_id', '=', d.id).execute();
  const ids = models.map((m) => m.model_id);
  const counted = d.min_participations ? await participations(db, accountId, now, d.id) : null;
  const rules: { rule: LiveAccessMissing; met: () => Promise<boolean> }[] = [];
  if ((d.live_min_tier ?? 0) > 0) rules.push({ rule: 'TIER', met: async () => tier >= (d.live_min_tier ?? 0) });
  if (ids.length > 0 || d.access_collection_id) {
    rules.push({
      rule: 'PIECE',
      met: async () => {
        const held = await db
          .selectFrom('ownership as o')
          .innerJoin('products as p', 'p.id', 'o.product_id')
          .innerJoin('models as m', 'm.id', 'p.model_id')
          .select('o.id')
          .where('o.account_id', '=', accountId)
          .where('o.ended_at', 'is', null)
          .where(clubCounts('p', 'o.account_id'))
          .where((eb) =>
            eb.or([
              ...(ids.length > 0 ? [eb('p.model_id', 'in', ids)] : []),
              ...(d.access_collection_id ? [eb(eb.fn.coalesce('p.collection_id', 'm.collection_id'), '=', d.access_collection_id)] : []),
            ]),
          )
          .limit(1)
          .executeTakeFirst();
        return held !== undefined || (await isTestEntrant(db, accountId)); // a test entrant owns its models (services/test-entrants.ts)
      },
    });
  }
  if (counted !== null) rules.push({ rule: 'PARTICIPATION', met: async () => counted >= (d.min_participations ?? 0) });
  if (d.access_segment_id) rules.push({ rule: 'SEGMENT', met: () => isSegmentMember(db, d.access_segment_id!, accountId, now) });
  if (rules.length === 0) return { allowed: true, tier, missing: null, participations: counted };
  // IN-01: the house's guarantee lets its holder in whatever the release's rule.
  if (await holdsGuaranteeFor(db, accountId, d.id)) return { allowed: true, tier, missing: null, participations: counted };
  if (d.access_combine === 'OR') {
    for (const r of rules) if (await r.met()) return { allowed: true, tier, missing: null, participations: counted };
    return { allowed: false, tier, missing: rules[0]!.rule, participations: counted };
  }
  for (const r of rules) if (!(await r.met())) return { allowed: false, tier, missing: r.rule, participations: counted };
  return { allowed: true, tier, missing: null, participations: counted };
}

/**
 * Every ACTIVE account the rules of a release let in at `now`, as `accessOf` reads them one by one (the console's planner
 * and forecast count them: live-insights.ts), in one query; null when the release names no rule beyond the tier and the
 * pieces combined by AND, which the planner counts from the pieces held alone.
 */
export async function accessAccounts(
  db: Db,
  d: Pick<DropRow, 'id' | 'live_min_tier' | 'access_collection_id' | 'min_participations' | 'access_segment_id' | 'access_combine'>,
  now: Date,
): Promise<Set<string> | null> {
  if (!d.min_participations && !d.access_segment_id && d.access_combine !== 'OR') return null;
  const [models, segment] = await Promise.all([
    db.selectFrom('live_access_models').select('model_id').where('drop_id', '=', d.id).execute(),
    d.access_segment_id ? db.selectFrom('segments').select('criteria').where('id', '=', d.access_segment_id).executeTakeFirst() : undefined,
  ]);
  const minTier = d.live_min_tier ?? 0;
  const pieces: SegmentGroup['rules'] = [
    ...(models.length ? [{ kind: 'OWNS_MODEL' as const, modelIds: models.map((m) => m.model_id) }] : []),
    ...(d.access_collection_id ? [{ kind: 'OWNS_COLLECTION' as const, collectionIds: [d.access_collection_id] }] : []),
  ];
  const rows = await db
    .selectFrom('accounts as a')
    .select('a.id')
    .where('a.status', '=', 'ACTIVE')
    .where((eb) => {
      const rules: Expression<SqlBool>[] = [];
      if (minTier > 0) rules.push(segmentCondition(db, eb, { match: 'ALL', rules: [{ kind: 'TIER', tiers: [1, 2, 3].filter((t) => t >= minTier) }] }, now));
      if (pieces.length) rules.push(segmentCondition(db, eb, { match: 'ANY', rules: pieces }, now));
      if (d.min_participations) rules.push(sql<SqlBool>`(${participationCount(db, now, eb.ref('a.id'), d.id)}) >= ${d.min_participations}`);
      // A segment gone (never: a used one is not deleted) lets nobody in.
      if (d.access_segment_id) rules.push(segment ? segmentCondition(db, eb, cleanCriteria(segment.criteria), now) : sql<SqlBool>`false`);
      if (rules.length === 0) return sql<SqlBool>`true`;
      return d.access_combine === 'OR' ? eb.or(rules) : eb.and(rules);
    })
    .execute();
  return new Set(rows.map((r) => r.id));
}

// ── Views ──────────────────────────────────────────────────────────────────

export interface LiveSizeRef {
  id: string;
  label: string;
}

/** Macro scope K44 T1: the size an entry or an interest of a set's release chose for one piece (1 to 4, the set's order). */
export interface LivePieceSize extends LiveSizeRef {
  piece: number;
}

/**
 * What ENTER, CHANGE SIZE and I'LL BE THERE name: a model's release's size (`sizeId`), or (macro scope K44 T1) a set's
 * size per piece (`sizes`, each piece once; CHANGE SIZE may name some of them, the others kept).
 */
export interface LiveSizeChoice {
  sizeId?: string | null;
  sizes?: readonly { piece: number; sizeId: string }[] | null;
}

export interface LiveEntryAddon {
  id: string;
  label: string;
  /** Per piece, at the time it was chosen. */
  priceMinor: number;
}

/** The signed-in account's entry in a release, as its own screens read it. */
export interface LiveEntryView {
  id: string;
  dropId: string;
  status: LiveEntryStatus;
  /** Its size; on a set's release, its first piece's (`sizes` gives every piece's). */
  size: LiveSizeRef;
  /** Macro scope K44 T1: on a set's release, the size chosen for each piece, in the set's order; absent otherwise. */
  sizes?: LivePieceSize[];
  /** Its pieces; on a set's release, its sets (T4: a set counts as one). */
  quantity: number;
  /** The club's tier at entry, then at T0. */
  tier: number;
  /** The place in the line; null before T0. */
  position: number | null;
  joinedAt: Date;
  /** The turn: its deadline as it stands now (a pause in progress moves it); `token` only while it is TURN. */
  turn: { at: Date; expiresAt: Date; token: string | null } | null;
  /** The hold: its deadline as it stands now. */
  hold: { securedAt: Date; expiresAt: Date } | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
  /** The console let this entry take its turn out of order. */
  letIn: boolean;
  addons: LiveEntryAddon[];
  currency: string;
  /** Per piece. */
  priceMinor: number;
  /** quantity × (price + the add-ons), plus the catalogue add-ons (`addonItems`). */
  totalMinor: number;
  /**
   * Plan MACRO M3 §4.2 (D2): the catalogue add-ons of the entry: while SECURED, those chosen with the hold (each its units
   * and its price per unit in the release's currency now, null when no longer priced); once CONFIRMED, those carried onto
   * its first order (as added). Empty otherwise.
   */
  addonItems: ChosenAddon[];
  /** While SECURED: the catalogue add-ons offered with the piece now (available at the release's location, priced in its currency). */
  addonOffer: AddonOfferItem[];
  /** PAY's answer only: the add-ons chosen that could not be added to the order (none left, no longer offered). */
  addonsLeftOut?: LeftOutAddon[];
  /**
   * ENDED by the release's sell-out while in its line: its after-room's door (when it appears, when it closes), from the
   * sell-out until the after-room ends; null otherwise (and for anyone else: an entry's own).
   */
  afterRoom: AfterRoomDoor | null;
  /** IN-01: the entry uses the house's guarantee and the guarantee is shown to the client (false for one not shown). */
  guaranteed: boolean;
  /**
   * ONE QUEUE (lot Q1, plan §1.3): while QUEUED, its own figures from the queue's snapshot (live-queue.ts): its place in
   * its size, its estimated wait, what holds the batches, whether a batch can reach it next (its page then follows the
   * stream; otherwise it reads its state as `pollMs` says) and whether its size can no longer serve it. Never the pace,
   * the line's length or a held piece (D8, D25). Null otherwise, and in an action's answer (its page reads its place
   * at its next reading: READING YOUR PLACE, D15).
   */
  queue: LiveQueueView | null;
}

export type { LiveQueueView };

/**
 * Whether a reading of an entry tells its phone that it is next (G2, PLAN amendment 1; live-frames.ts `read`): QUEUED and
 * a batch can reach it next, as the queue's snapshot says (`queue.next`; every QUEUED entry of an after-room).
 */
export function liveReadsNext(entry: Pick<LiveEntryView, 'status' | 'queue'> | null | undefined): boolean {
  return entry?.status === 'QUEUED' && entry.queue?.next === true;
}

/** An account's interest (I'LL BE THERE). */
export interface LiveInterestView {
  dropId: string;
  /** Its size; on a set's release, its first piece's (`sizes` gives every piece's). */
  size: LiveSizeRef;
  /** Macro scope K44 T1: on a set's release, the size given for each piece; absent otherwise. */
  sizes?: LivePieceSize[];
  since: Date;
}

/** A release's live state, as the console's controls return it. */
export interface LiveReleaseState {
  id: string;
  roomOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
  pausedAt: Date | null;
  /** Every pause that ended, in milliseconds. */
  pausedMs: number;
  endedAt: Date | null;
  endedReason: LiveEndReason | null;
  /** The sum of the sizes' stock; on a set's release, its sets on sale (the smallest of its pieces' totals). */
  quantity: number;
  quantityLine: string;
  /** Each size with its stock; on a set's release, with its piece (1 to 4). */
  sizes: (LiveSizeRef & { stock: number; piece?: number })[];
  /** The pace and the hold, null without a pace (an after-room). */
  pace: LivePaceState | null;
}

/** The pace of a release as the console reads it (ONE QUEUE). */
export interface LivePaceState {
  /** X: the turns a batch gives at most. */
  batch: number;
  /** Y: the minutes between two batches. */
  minutes: number;
  /** When the next batch is due (T0 + the hold before the first; a pause in progress moves it when it ends). */
  nextAt: Date;
  /** The pace's own pause in progress (PAUSE PACE): since when; the release's PAUSE is `pausedAt`. */
  pausedAt: Date | null;
  paused: boolean;
  /** The batches given so far (an empty one counts; NEXT BATCH NOW's too). */
  batches: number;
  /** In the queue: the entries in the line (QUEUED), none of them given a turn yet. */
  waiting: number;
  /** Given a turn so far, all ways: by the batches and by LET IN. */
  admitted: number;
  /** Given a turn by the batches (the pace, NEXT BATCH NOW included). */
  turnsGiven: number;
  /** Given a turn by LET IN. */
  letIn: number;
  /** The hold after the opening as set, in minutes (0: none). */
  holdMinutes: number;
  /** When the hold ends (the first batch's time) while it lasts; null otherwise. */
  holdEndsAt: Date | null;
  /** Beyond the pieces: entries in the queue whose place in their size is past the pieces of that size not yet confirmed. */
  beyond: number;
  /** D10, the close guard (advice only): the pieces the pace cannot offer before the close, when there are any; null otherwise. */
  closeGuard: LiveCloseGuard | null;
}

/** An entry as the console's controls return it; the routes mask the email for an AUDITOR. */
export interface AdminLiveEntry {
  id: string;
  accountId: string;
  /** As stored. */
  email: string;
  status: LiveEntryStatus;
  /** Its size; on a set's release, its first piece's (`sizes` gives every piece's). */
  size: LiveSizeRef;
  /** Macro scope K44 T1: on a set's release, the size chosen for each piece; absent otherwise. */
  sizes?: LivePieceSize[];
  /** Its pieces; on a set's release, its sets. */
  quantity: number;
  tier: number;
  position: number | null;
  joinedAt: Date;
  turnAt: Date | null;
  /** As it stands now. */
  turnExpiresAt: Date | null;
  securedAt: Date | null;
  /** As it stands now. */
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
  gestureMs: number | null;
  letIn: boolean;
  /** IN-01: the entry uses the house's guarantee (GUARANTEED: first in line in its size). */
  guaranteed: boolean;
  /** When its turn was given: by a batch, the batch's logical time; by LET IN, then. Null while it waits. */
  admittedAt: Date | null;
  /** The batch that gave its turn; 0 in an after-room (no pace); by LET IN, the batches given until then. */
  batch: number | null;
  /** In the queue, its place in its size past the pieces of that size not yet confirmed (the console's « beyond the pieces »). */
  beyond: boolean;
  /** In the queue (QUEUED), its place in its size, from the queue's snapshot (D11, live-queue.ts); null otherwise. */
  placeInSize: number | null;
  /** In the queue of a paced release, its estimated turn from the snapshot; null otherwise (an after-room has no time). */
  estimatedTurnAt: Date | null;
}

/** An entry's queue place and estimated turn for the console (AdminLiveEntry), from the release's snapshot. */
export function adminQueueFigures(snapshot: LiveQueueSnapshot | null, entryId: string): { placeInSize: number | null; estimatedTurnAt: Date | null } {
  const p = snapshot?.entries.get(entryId);
  return { placeInSize: p?.place ?? null, estimatedTurnAt: p?.estimatedAt != null ? new Date(p.estimatedAt) : null };
}

export interface LiveMessageView {
  id: string;
  text: string;
  createdAt: Date;
}

/** What one `advance` of the engine did to a release. */
export interface LiveAdvance {
  dropId: string;
  /** Entries placed in the line (the cohort of T0, or a late one). */
  queued: number;
  /** In an after-room (no pace): the entries admitted at once as they take their place. */
  admitted: number;
  /** On a paced release: the batch given by this pass (at most one: live-frames.ts), its number; null if none. */
  batch: number | null;
  /** A batch is due (or a NEXT BATCH NOW waits) but the frame after the last batch is not published yet. */
  waiting: boolean;
  missed: number;
  expired: number;
  turns: number;
  /** The end that began now, if one did. */
  ended: LiveEndReason | null;
}

// ── Lock of an account and right of access (OwnerService) ──────────────────

/** An entry a lock removed, and an interest it withdrew, for their audit entries after the row locks. */
export interface RemovedLiveEntry {
  dropId: string;
  entryId: string;
  from: LiveEntryStatus;
}

export interface WithdrawnLiveInterest {
  dropId: string;
}

/**
 * Remove the open entries of an account (WAITING, QUEUED, TURN, SECURED: REMOVED by the lock's ADMIN, add-ons
 * dropped) and withdraw its interest in the releases not opened yet, in the transaction of its lock, whose row lock
 * on the account is already held; the releases of those entries are locked first (FOR UPDATE, by id), as every action
 * takes them. A piece so given back goes to the next in line at the engine's next pass. Returns them for their audit
 * entries, written after the lock's row locks (auditRemovedLiveEntries).
 */
export async function removeAccountLiveEntries(
  tx: Db,
  accountId: string,
  actor: Actor,
  now: Date,
): Promise<{ entries: RemovedLiveEntry[]; interest: WithdrawnLiveInterest[] }> {
  const account = assertAccount(accountId);
  const admin = actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
  const open = await tx.selectFrom('live_entries').select(['drop_id']).where('account_id', '=', account).where('status', 'in', [...LIVE_OPEN_STATUSES]).execute();
  const dropIds = [...new Set(open.map((r) => r.drop_id))].sort();
  let entries: RemovedLiveEntry[] = [];
  if (dropIds.length > 0) {
    await tx.selectFrom('drops').select('id').where('id', 'in', dropIds).orderBy('id').forUpdate().execute();
    const before = await tx
      .selectFrom('live_entries')
      .select(['id', 'drop_id', 'status'])
      .where('account_id', '=', account)
      .where('status', 'in', [...LIVE_OPEN_STATUSES])
      .forUpdate()
      .execute();
    const ids = before.map((e) => e.id);
    if (ids.length > 0) {
      await tx.deleteFrom('live_entry_addons').where('entry_id', 'in', ids).execute();
      await clearChoices(tx, 'live_entry_id', ids);
      await tx
        .updateTable('live_entries')
        .set({ status: 'REMOVED', removed_by: admin, removed_at: sql<Date>`greatest(${now}::timestamptz, joined_at)`, ended_at: sql<Date>`greatest(${now}::timestamptz, joined_at)` })
        .where('id', 'in', ids)
        .execute();
      // IN-01: a guarantee not used yet (WAITING, QUEUED) is unbound and stays ACTIVE: a lock does not revoke it.
      const waiting = before.filter((e) => e.status === 'WAITING' || e.status === 'QUEUED').map((e) => e.id);
      if (waiting.length > 0) await tx.updateTable('live_entries').set({ guarantee_id: null }).where('id', 'in', waiting).execute();
    }
    entries = before
      .map((e) => ({ dropId: e.drop_id, entryId: e.id, from: e.status }))
      .sort((a, b) => compare(`${a.dropId} ${a.entryId}`, `${b.dropId} ${b.entryId}`));
  }
  const pending = await tx
    .selectFrom('live_interest as i')
    .innerJoin('drops as d', 'd.id', 'i.drop_id')
    .select('i.drop_id')
    .where('i.account_id', '=', account)
    .where('d.opens_at', '>', now)
    .where('d.ended_at', 'is', null)
    .where('d.cancelled_at', 'is', null)
    .execute();
  const pendingIds = pending.map((r) => r.drop_id);
  // Macro scope K44 T1: an interest in a set's release, its sizes per piece first (they name it: ON DELETE RESTRICT).
  if (pendingIds.length > 0) await tx.deleteFrom('live_interest_sizes').where('account_id', '=', account).where('drop_id', 'in', pendingIds).execute();
  const withdrawn = pendingIds.length > 0 ? await tx.deleteFrom('live_interest').where('account_id', '=', account).where('drop_id', 'in', pendingIds).returning('drop_id').execute() : [];
  return { entries, interest: withdrawn.map((r) => ({ dropId: r.drop_id })).sort((a, b) => compare(a.dropId, b.dropId)) };
}

/** One `drop.live.remove` entry per entry a lock removed, one `drop.live.interest.withdraw` per interest, with the reason. */
export async function auditRemovedLiveEntries(
  audit: AuditService,
  tx: Db,
  actor: Actor,
  removed: { entries: readonly RemovedLiveEntry[]; interest: readonly WithdrawnLiveInterest[] },
  reason: 'account_locked',
): Promise<void> {
  for (const e of removed.entries) {
    await audit.record({ actor, action: 'drop.live.remove', targetType: 'drop', targetId: e.dropId, details: { entryId: e.entryId, from: e.from, reason } }, tx);
  }
  for (const i of removed.interest) {
    await audit.record({ actor, action: 'drop.live.interest.withdraw', targetType: 'drop', targetId: i.dropId, details: { reason } }, tx);
  }
}

/**
 * An account's entries in the LIVE RELEASES, for its right-of-access export: every one, oldest first, with its add-ons,
 * the gesture's length, its country, and the note ORBES Client Services added when it concluded it; never who let it in,
 * removed it or concluded it, never its network's hash (a keyed one-way pseudonym).
 */
export interface ExportedLiveEntry {
  entryId: string;
  dropId: string;
  title: string;
  /** Its size; on a set's release, its first piece's (`sizes` gives every piece's). */
  size: string;
  /** Macro scope K44 T1: on a set's release, the size chosen for each piece; absent otherwise. */
  sizes?: { piece: number; size: string }[];
  quantity: number;
  status: LiveEntryStatus;
  tier: number;
  position: number | null;
  joinedAt: Date;
  queuedAt: Date | null;
  /** W4: when it was admitted to take a turn (its batch's time), null if it never was. */
  admittedAt: Date | null;
  turnAt: Date | null;
  turnExpiresAt: Date | null;
  pressStartedAt: Date | null;
  gestureMs: number | null;
  securedAt: Date | null;
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
  letIn: boolean;
  country: string | null;
  currency: string | null;
  priceMinor: number | null;
  addons: { label: string; priceMinor: number }[];
  resolution: LiveResolution | null;
  handledAt: Date | null;
  resolutionNote: string | null;
  /** Still in the line at the release's sell-out: its place in the release's after-room (after-room.ts), else null. */
  afterRoomPlace: number | null;
}

export interface ExportedLiveInterest {
  dropId: string;
  title: string;
  size: string;
  since: Date;
  /** Macro scope K44 T1: on a set's release, the size given for each piece; absent otherwise. */
  sizes?: { piece: number; size: string }[];
}

export async function accountLiveData(db: Db, accountId: string): Promise<{ entries: ExportedLiveEntry[]; interest: ExportedLiveInterest[] }> {
  const account = assertAccount(accountId);
  const rows = await db
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select([
      'e.id', 'e.drop_id', 'd.title', 's.label', 'e.quantity', 'e.status', 'e.tier', 'e.position', 'e.joined_at', 'e.queued_at', 'e.admitted_at', 'e.turn_at',
      'e.turn_expires_at', 'e.press_started_at', 'e.gesture_ms', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at',
      'e.let_in_by', 'e.country', 'd.currency', 'd.price_minor', 'e.resolution', 'e.handled_at', 'e.resolution_note',
    ])
    .where('e.account_id', '=', account)
    .orderBy('e.joined_at')
    .orderBy('e.id')
    .execute();
  const addons = rows.length
    ? await db
        .selectFrom('live_entry_addons as x')
        .innerJoin('live_addons as a', 'a.id', 'x.addon_id')
        .select(['x.entry_id', 'a.label', 'x.price_minor', 'a.position'])
        .where('x.entry_id', 'in', rows.map((r) => r.id))
        .orderBy('a.position')
        .execute()
    : [];
  const guests = rows.length
    ? await db.selectFrom('after_room_guests').select(['entry_id', 'position']).where('entry_id', 'in', rows.map((r) => r.id)).execute()
    : [];
  const pieces = await entryPieceSizes(db, 'live_entry_sizes', rows.map((r) => r.id));
  const interest = await db
    .selectFrom('live_interest as i')
    .innerJoin('drops as d', 'd.id', 'i.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'i.size_id')
    .select(['i.drop_id', 'd.title', 's.label', 'i.created_at'])
    .where('i.account_id', '=', account)
    .orderBy('i.created_at')
    .orderBy('i.drop_id')
    .execute();
  // Macro scope K44 T1: an interest in a set's release gives a size per piece.
  const interestPieces = await db
    .selectFrom('live_interest_sizes as x')
    .innerJoin('drop_sizes as s', 's.id', 'x.size_id')
    .select(['x.drop_id', 'x.piece', 's.label'])
    .where('x.account_id', '=', account)
    .orderBy('x.drop_id')
    .orderBy('x.piece')
    .execute();
  return {
    entries: rows.map((r) => ({
      entryId: r.id,
      dropId: r.drop_id,
      title: r.title,
      size: r.label,
      quantity: r.quantity,
      status: r.status,
      tier: r.tier,
      position: r.position,
      joinedAt: r.joined_at,
      queuedAt: r.queued_at,
      admittedAt: r.admitted_at,
      turnAt: r.turn_at,
      turnExpiresAt: r.turn_expires_at,
      pressStartedAt: r.press_started_at,
      gestureMs: r.gesture_ms,
      securedAt: r.secured_at,
      holdExpiresAt: r.hold_expires_at,
      confirmedAt: r.confirmed_at,
      endedAt: r.ended_at,
      letIn: r.let_in_by !== null,
      country: r.country,
      currency: r.currency,
      priceMinor: r.price_minor,
      addons: addons.filter((a) => a.entry_id === r.id).map((a) => ({ label: a.label, priceMinor: a.price_minor })),
      resolution: r.resolution,
      handledAt: r.handled_at,
      resolutionNote: r.resolution_note,
      afterRoomPlace: guests.find((g) => g.entry_id === r.id)?.position ?? null,
      ...(pieces.has(r.id) ? { sizes: pieces.get(r.id)! } : {}),
    })),
    interest: interest.map((i) => {
      const own = interestPieces.filter((x) => x.drop_id === i.drop_id);
      return { dropId: i.drop_id, title: i.title, size: i.label, since: i.created_at, ...(own.length ? { sizes: own.map((x) => ({ piece: x.piece, size: x.label })) } : {}) };
    }),
  };
}

/**
 * Erase the network's hash of the entries of every release that ended (or was cancelled) LIVE_NETWORK_RETENTION_DAYS
 * ago or more (housekeeping). Returns how many entries lost it.
 */
export async function eraseLiveNetworkHashes(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - LIVE_NETWORK_RETENTION_DAYS * DAY_MS);
  const r = await db
    .updateTable('live_entries as e')
    .from('drops as d')
    .set({ network_hash: null })
    .whereRef('d.id', '=', 'e.drop_id')
    .where('e.network_hash', 'is not', null)
    .where(sql<Date>`coalesce(d.ended_at, d.cancelled_at)`, '<=', cutoff)
    .executeTakeFirst();
  return Number(r.numUpdatedRows ?? 0);
}

/** The accounts' ids per statement of `liveEntryViews` (a release's room is read in chunks of this many). */
const VIEW_CHUNK = 1000;

const chunks = <T>(xs: readonly T[], n = VIEW_CHUNK): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * The entries of published LIVE RELEASES as their accounts' own screens read them: those of `accountIds` in one release,
 * by account id (the room's viewers, read once a second for all of them by the live streams, routes/live.ts), or every
 * entry of one account, by release id (MY PIECES). A few statements whatever the number of accounts: the entries and
 * their add-ons. Deadlines as they stand at `now` (a pause in progress moves them); the turn's secret only while it is
 * TURN, to its own account. A QUEUED entry's `queue` comes from its release's snapshot when `queues` gives one (the
 * frame's: live-room.ts), null otherwise (no entry's own read ever reads the whole line: docs/reports/live-load.md).
 */
export async function liveEntryViews(
  db: Db,
  turnKey: Uint8Array,
  of: { dropId: string; accountIds: readonly string[] } | { accountId: string },
  now: Date,
  queues?: (dropId: string) => LiveQueueSnapshot | null | undefined,
): Promise<Map<string, LiveEntryView>> {
  const base = db
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select([
      'e.id', 'e.drop_id', 'e.account_id', 'e.status', 'e.size_id', 's.label', 'e.quantity', 'e.tier', 'e.position', 'e.joined_at', 'e.turn_at',
      'e.turn_expires_at', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at', 'e.let_in_by', 'd.paused_at', 'd.price_minor', 'd.currency',
      'e.guarantee_id', 'e.admitted_at', 'd.opens_at', 'd.pace_batch', 'd.pace_minutes', 'd.pace_paused_at', 'd.pace_next_at', 'd.pace_hold_minutes', 'd.stock_location_id', 'd.parent_drop_id',
      'd.set_id',
    ])
    .where('d.mode', '=', 'LIVE')
    .where('d.published_at', 'is not', null);
  const rows =
    'accountId' in of
      ? await base.where('e.account_id', '=', of.accountId).execute()
      : (await Promise.all(chunks([...new Set(of.accountIds)]).map((ids) => base.where('e.drop_id', '=', of.dropId).where('e.account_id', 'in', ids).execute()))).flat();
  const out = new Map<string, LiveEntryView>();
  if (rows.length === 0) return out;
  const addons = (
    await Promise.all(
      chunks(rows.map((r) => r.id)).map((ids) =>
        db
          .selectFrom('live_entry_addons as x')
          .innerJoin('live_addons as a', 'a.id', 'x.addon_id')
          .select(['x.entry_id', 'a.id', 'a.label', 'x.price_minor', 'a.position'])
          .where('x.entry_id', 'in', ids)
          .orderBy('a.position')
          .execute(),
      ),
    )
  ).flat();
  const doors = await afterRoomDoors(db, rows.filter((r) => r.status === 'ENDED').map((r) => r.id));
  const shown = await visibleGuaranteeIds(db, rows.map((r) => r.guarantee_id));
  // Plan MACRO M3 §4.2 (D2): the catalogue add-ons chosen with a hold, and the units carried onto a confirmed entry's order.
  const items = await liveAddonItems(db, rows);
  // Macro scope K44 T1: a set's entries, their sizes per piece.
  const pieceSizes = await livePieceSizes(db, rows.filter((r) => r.set_id !== null).map((r) => r.id));
  for (const r of rows) {
    const own = addons.filter((a) => a.entry_id === r.id);
    const price = r.price_minor ?? 0;
    const unit = price + own.reduce((n, a) => n + a.price_minor, 0);
    const chosen = items.chosen.get(r.id) ?? [];
    out.set('accountId' in of ? r.drop_id : r.account_id, {
      id: r.id,
      dropId: r.drop_id,
      status: r.status,
      size: { id: r.size_id, label: r.label },
      ...(pieceSizes.has(r.id) ? { sizes: pieceSizes.get(r.id)! } : {}),
      quantity: r.quantity,
      tier: r.tier,
      position: r.position,
      joinedAt: r.joined_at,
      turn:
        r.turn_at && r.turn_expires_at
          ? {
              at: r.turn_at,
              expiresAt: r.status === 'TURN' ? effectiveDeadline(r.turn_expires_at, r, now) : r.turn_expires_at,
              token: r.status === 'TURN' ? liveTurnToken(turnKey, r.id, r.turn_at) : null,
            }
          : null,
      hold:
        r.secured_at && r.hold_expires_at
          ? { securedAt: r.secured_at, expiresAt: r.status === 'SECURED' ? effectiveDeadline(r.hold_expires_at, r, now) : r.hold_expires_at }
          : null,
      confirmedAt: r.confirmed_at,
      endedAt: r.ended_at,
      letIn: r.let_in_by !== null,
      addons: own.map((a) => ({ id: a.id, label: a.label, priceMinor: a.price_minor })),
      currency: r.currency ?? 'EUR',
      priceMinor: price,
      totalMinor: r.quantity * unit + chosen.reduce((n, a) => n + a.units * (a.priceMinor ?? 0), 0),
      addonItems: chosen,
      addonOffer: items.offer.get(r.id) ?? [],
      afterRoom: doors.get(r.id) ?? null,
      guaranteed: r.guarantee_id !== null && shown.has(r.guarantee_id),
      queue: r.status === 'QUEUED' ? queueOf(queues?.(r.drop_id), r.id, now) : null,
    });
  }
  return out;
}

/** The sizes per piece of entries of a set's release (macro scope K44 T1), by entry id, in the set's order; none for a model's. Reads only. */
export async function livePieceSizes(db: Db, entryIds: readonly string[]): Promise<Map<string, LivePieceSize[]>> {
  const out = new Map<string, LivePieceSize[]>();
  for (const ids of chunks([...new Set(entryIds)])) {
    const rows = await db
      .selectFrom('live_entry_sizes as x')
      .innerJoin('drop_sizes as s', 's.id', 'x.size_id')
      .select(['x.entry_id', 'x.piece', 's.id', 's.label'])
      .where('x.entry_id', 'in', ids)
      .orderBy('x.entry_id')
      .orderBy('x.piece')
      .execute();
    for (const r of rows) out.set(r.entry_id, [...(out.get(r.entry_id) ?? []), { piece: r.piece, id: r.id, label: r.label }]);
  }
  return out;
}

/** The sizes per piece of an account's interest in a set's release (macro scope K44 T1), in the set's order; none otherwise. Reads only. */
export async function liveInterestPieceSizes(db: Db, dropId: string, accountId: string): Promise<LivePieceSize[]> {
  return db
    .selectFrom('live_interest_sizes as x')
    .innerJoin('drop_sizes as s', 's.id', 'x.size_id')
    .select(['x.piece', 's.id', 's.label'])
    .where('x.drop_id', '=', dropId)
    .where('x.account_id', '=', accountId)
    .orderBy('x.piece')
    .execute();
}

/** Where a LIVE release's add-ons are held and offered: its location (an after-room's, its parent's), else the default. */
export async function liveAddonLocation(db: Db, d: { stock_location_id: string | null; parent_drop_id: string | null }): Promise<string> {
  if (d.stock_location_id) return d.stock_location_id;
  if (d.parent_drop_id) {
    const p = await db.selectFrom('drops').select('stock_location_id').where('id', '=', d.parent_drop_id).executeTakeFirst();
    if (p?.stock_location_id) return p.stock_location_id;
  }
  return defaultLocationId(db);
}

const liveCurrency = (c: string | null): 'EUR' | 'GBP' | 'USD' | 'CHF' | null => (c === 'EUR' || c === 'GBP' || c === 'USD' || c === 'CHF' ? c : null);

/**
 * The catalogue add-ons of entries (plan MACRO M3 §4.2): a SECURED entry's choices (priced in its release's currency
 * now) and what is offered with it, a CONFIRMED entry's units on its orders (one row per add-on and price).
 */
async function liveAddonItems(
  db: Db,
  rows: readonly { id: string; status: LiveEntryStatus; currency: string | null; stock_location_id: string | null; parent_drop_id: string | null }[],
): Promise<{ chosen: Map<string, ChosenAddon[]>; offer: Map<string, AddonOfferItem[]> }> {
  const secured = rows.filter((r) => r.status === 'SECURED');
  const currencies = new Map(secured.map((r) => [r.id, liveCurrency(r.currency)]));
  const chosen = await choicesOf(db, 'live_entry_id', secured.map((r) => r.id), (id) => currencies.get(id) ?? null);
  const offer = new Map<string, AddonOfferItem[]>();
  for (const r of secured) {
    const currency = liveCurrency(r.currency);
    if (currency !== null) offer.set(r.id, await addonOffer(db, await liveAddonLocation(db, r), currency));
  }
  const confirmed = rows.filter((r) => r.status === 'CONFIRMED');
  if (confirmed.length > 0) {
    const units = await db
      .selectFrom('order_addon_items as u')
      .innerJoin('orders as o', 'o.id', 'u.order_id')
      .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
      .select(['o.live_entry_id', 'u.addon_id', 'a.name', 'a.line', 'u.price_minor'])
      .where('o.live_entry_id', 'in', confirmed.map((r) => r.id))
      .where('u.status', '<>', 'REMOVED')
      .orderBy('u.added_at')
      .orderBy('u.id')
      .execute();
    for (const u of units) {
      const list = chosen.get(u.live_entry_id!) ?? [];
      const row = list.find((x) => x.addonId === u.addon_id && x.priceMinor === u.price_minor);
      if (row) row.units += 1;
      else list.push({ addonId: u.addon_id, name: u.name, line: u.line, units: 1, priceMinor: u.price_minor });
      chosen.set(u.live_entry_id!, list);
    }
  }
  return { chosen, offer };
}

/** A QUEUED entry's own figures from its release's snapshot, read at `now`; null without one. */
function queueOf(snapshot: LiveQueueSnapshot | null | undefined, entryId: string, now: Date): LiveQueueView | null {
  return snapshot ? queueView(snapshot, entryId, now.getTime()) : null;
}

/** A set's entry's or interest's size for one piece (macro scope K44 T1), as chosen: its piece and its size with its stock. */
type ChosenPiece = { piece: number; size: { id: string; stock: number } };

/** An entry's sizes per piece written (a set's release): every piece's, replacing those it had. */
async function writeLiveEntrySizes(tx: Db, dropId: string, entryId: string, set: readonly ChosenPiece[]): Promise<void> {
  await tx.deleteFrom('live_entry_sizes').where('entry_id', '=', entryId).execute();
  await tx.insertInto('live_entry_sizes').values(set.map((c) => ({ entry_id: entryId, drop_id: dropId, piece: c.piece, size_id: c.size.id }))).execute();
}

/** A set's sizes per piece as the audit log records them, or nothing. */
const auditedSizes = (set: readonly ChosenPiece[] | null) => (set ? { sizes: set.map((c) => ({ piece: c.piece, sizeId: c.size.id })) } : {});

/** Whether a set's sizes chosen are those stored (each piece in the same size). */
const sameSizes = (set: readonly ChosenPiece[], stored: readonly { piece: number; size_id: string }[]) =>
  set.length === stored.length && set.every((c) => stored.some((x) => x.piece === c.piece && x.size_id === c.size.id));

// ── Service ────────────────────────────────────────────────────────────────

export interface LiveServiceDeps {
  db: Db;
  audit: AuditService;
  /** The key sealing the drops' seeds (drops.ts deriveDropSeedKey): the line at T0 is ordered with the release's seed. */
  seedKey: Uint8Array;
  /** The key of the turns' secrets (deriveLiveTurnKey). */
  turnKey: Uint8Array;
  /** At most one batch per published frame (live-frames.ts); one of its own when none is given. */
  frames?: LiveFrameGate;
  clock?: Clock;
  /** How long a NEXT BATCH NOW waits to be given at most (PRESS_WAIT_MS; tests shorten it). */
  pressWaitMs?: number;
}

/** What one pass of the batches did (giveDue): the batch it gave, and whether one waits for a frame. */
interface BatchPass {
  /** The batch given: its number, its turns, the NEXT BATCH NOW it was (null for a scheduled slot); null when none. */
  given: { batch: number; turns: number; press: PendingBatch | null } | null;
  /** A batch is due, or a NEXT BATCH NOW waits, until the next frame, or until the entries it reaches have read that they are next. */
  waiting: boolean;
  /** It waits for readings (live-frames.ts `unread`), not for a frame: a frame asked for does not let it go. */
  readings: boolean;
  /** Whether this transaction gave a batch (the gate shut by it, settled once it ends). */
  gave: boolean;
  /** The gate's mark of this transaction's batch or change (live-frames.ts), settled once it ends; 0 for none. */
  mark: number;
  /** The NEXT BATCH NOW this transaction is giving (`giving`, released if the transaction fails). */
  taking: PendingBatch | null;
}

/**
 * How long a NEXT BATCH NOW waits to be given at most, its request held open meanwhile: for its frame (one comes every
 * second while anyone follows the release), then for the readings of those it reaches (READ_WAIT_MS at most after the
 * previous batch). Under the server's 30 s idle timeout (app.ts connectionTimeout), so its answer always reaches the
 * console. Past it (a hub that publishes no frame, phones that have not read yet), the press is withdrawn: 503
 * LIVE_BATCH_WAITING, nothing given, and never given afterwards.
 */
const PRESS_WAIT_MS = 25_000;

interface SizeTotal {
  id: string;
  label: string;
  /** Macro scope K44 T1: a set's release's piece (1 to 4); null on a model's. */
  piece: number | null;
  stock: number;
  turn: number;
  secured: number;
  confirmed: number;
}

/** The pieces a size can give now. */
const freeOf = (s: SizeTotal): number => s.stock - s.turn - s.secured - s.confirmed;
/** The pieces a size can still give, now or once its turns and holds return. */
const servableOf = (s: SizeTotal): number => s.stock - s.confirmed;

type EntryRow = {
  id: string;
  drop_id: string;
  account_id: string;
  size_id: string;
  quantity: number;
  status: LiveEntryStatus;
  tier: number;
  position: number | null;
  joined_at: Date;
  turn_at: Date | null;
  turn_expires_at: Date | null;
  turn_token_hash: Uint8Array | null;
  press_started_at: Date | null;
  secured_at: Date | null;
  hold_expires_at: Date | null;
  guarantee_id: string | null;
  admitted_at: Date | null;
};

const ENTRY_COLUMNS = [
  'id', 'drop_id', 'account_id', 'size_id', 'quantity', 'status', 'tier', 'position', 'joined_at', 'turn_at', 'turn_expires_at', 'turn_token_hash',
  'press_started_at', 'secured_at', 'hold_expires_at', 'guarantee_id', 'admitted_at',
] as const;

export class LiveService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly seedKey: Uint8Array;
  private readonly turnKey: Uint8Array;
  private readonly clock: Clock;
  /** At most one batch per published frame (live-frames.ts): the live streams publish the frames it waits for. */
  readonly frames: LiveFrameGate;
  private readonly pressWaitMs: number;

  constructor(deps: LiveServiceDeps) {
    for (const [name, key] of [['seedKey', deps.seedKey], ['turnKey', deps.turnKey]] as const) {
      if (!(key instanceof Uint8Array) || key.length !== 32) throw new RangeError(`${name} must be 32 bytes`);
    }
    this.db = deps.db;
    this.audit = deps.audit;
    this.seedKey = deps.seedKey;
    this.turnKey = deps.turnKey;
    this.clock = deps.clock ?? systemClock;
    this.frames = deps.frames ?? new LiveFrameGate();
    this.pressWaitMs = deps.pressWaitMs ?? PRESS_WAIT_MS;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** The rule of a published LIVE RELEASE and where the account stands against it now (404 DROP_NOT_FOUND before its announcement). */
  async access(accountId: string, dropId: string): Promise<{ rule: LiveAccessRule; access: LiveAccess }> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const now = this.clock();
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').where('published_at', 'is not', null).executeTakeFirst();
    if (!d || !isAnnounced(d, now)) throw dropNotFound();
    if (isAfterRoom(d) && (await afterRoomPlace(this.db, d, account, now)) === null) throw dropNotFound();
    return { rule: await liveAccessRule(this.db, d, now), access: await accessOf(this.db, d, account, now) };
  }

  /** The account's entry in a published LIVE RELEASE, or null. */
  /**
   * The account's entry in a published LIVE RELEASE, or null; while QUEUED, with its own figures from the release's queue
   * read now (live-queue.ts liveQueueSnapshot), as its phone reads them (the scripts' and the tests' reading).
   */
  async entry(accountId: string, dropId: string): Promise<LiveEntryView | null> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const now = this.clock();
    const view = (await liveEntryViews(this.db, this.turnKey, { dropId: id, accountIds: [account] }, now)).get(account) ?? null;
    if (view?.status !== 'QUEUED') return view;
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    return { ...view, queue: queueView(await liveQueueSnapshot(this.db, d, now), view.id, now.getTime()) };
  }

  /** The account's interest in a release, or null. */
  async interest(accountId: string, dropId: string): Promise<LiveInterestView | null> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    return this.interestView(this.db, account, id);
  }

  // ── The customer ─────────────────────────────────────────────────────────

  /**
   * ENTER: from the room's opening to the end of the sales, an account allowed in takes a size of the release (stock > 0)
   * and a quantity (1 to `per_account`, at most the size's stock). Before T0 it waits in the room (WAITING); after T0 it
   * joins the line behind (QUEUED), never in a size whose pieces are all confirmed. One entry per account and release: a
   * LEFT entry that never had a place (it left the room) enters again, the same row. Refused: a LOCKED account (403),
   * not announced (404), cancelled (409), over (409 LIVE_OVER), before the room (409 LIVE_ROOM_NOT_OPEN), the rule
   * (403 LIVE_NOT_ELIGIBLE), a size or quantity outside the release's (400), an entry already (409
   * LIVE_ALREADY_ENTERED). Audited `drop.live.enter` with the entry, size and quantity. Macro scope K44 T1 and T4: on a
   * set's release, a size per piece (`sizes`; 422 LIVE_SET_SIZES otherwise), its first piece's kept in `size_id`, every
   * piece's in `live_entry_sizes`, its quantity in sets (1 to `per_account`), never a guarantee; after T0, refused in a
   * size of any of its pieces whose pieces are all confirmed.
   */
  async enter(
    accountId: string,
    dropId: string,
    input: LiveSizeChoice & { quantity?: number },
    actor: Actor,
    client: { networkHash?: Uint8Array | null; country?: string | null } = {},
  ): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const networkHash = client.networkHash instanceof Uint8Array && client.networkHash.length === 32 ? client.networkHash : null;
    const country = typeof client.country === 'string' && /^[A-Z]{2}$/.test(client.country) ? client.country : null;
    const early = await this.accessAhead(id, account);
    // After T0 the entry takes its place at once: the next batch waits for a frame that shows it (D9).
    await this.changing(id, (mark) => inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now, place } = await this.lockAnnouncedLive(tx, id, 'update', account);
      const notes: AuditRecordInput[] = [];
      if (d.cancelled_at) throw liveCancelled();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveOver();
      if (now.getTime() < roomOpensAt(d).getTime()) throw roomNotOpen(roomOpensAt(d));
      const access = early ?? (await accessOf(tx, d, account, now));
      if (!access.allowed) throw notEligible(await liveAccessRule(tx, d, now), access);
      const existing = await tx.selectFrom('live_entries').select(['id', 'status', 'position']).where('drop_id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (existing && !(existing.status === 'LEFT' && existing.position === null)) throw alreadyEntered();
      // IN-01: the house's guarantee set aside for this release, after the entry's row (the lock order): up to its pieces,
      // the size still serving it; never in an after-room. One not shown that the size cannot serve leaves no mark: the
      // entry is an ordinary one and the guarantee stays set aside.
      // Macro scope K44 (plan MACRO M3 §5.1): a set's release is never guaranteed.
      const held = d.set_id === null ? await holderGuarantee(tx, account, d) : null;
      const { size, quantity, set } = await this.chosen(tx, d, input, input?.quantity, now, held?.pieces);
      const g = held ? await this.guaranteeInSize(tx, d, held, size.id, quantity, existing?.id ?? null) : null;
      const late = now.getTime() >= d.opens_at.getTime();
      if (late) {
        mark();
        await this.formLine(tx, d, now, notes);
        const totals = await this.sizeTotals(tx, d);
        for (const sid of set ? set.map((c) => c.size.id) : [size.id]) if (quantity > servableOf(totals.find((s) => s.id === sid)!)) throw sizeSoldOut();
      }
      // An after-room's guest takes the place it was given at the sell-out (its order in the parent's line); anyone after
      // T0 the next place behind the line.
      const slot = late
        ? { status: 'QUEUED' as const, position: place ?? (await this.lastPosition(tx, id)) + 1, queued_at: now }
        : { status: 'WAITING' as const, position: null, queued_at: null };
      // W4: with no pace a place in the line is an admission (batch 0); with one, the entry waits for its batch.
      const admission = late && d.pace_batch === null ? { admitted_at: now, admitted_batch: 0 } : { admitted_at: null, admitted_batch: null };
      const values = { size_id: size.id, quantity, tier: access.tier, joined_at: now, ended_at: null, network_hash: networkHash, country, guarantee_id: g?.id ?? null, ...slot, ...admission };
      let entryId: string;
      if (existing) {
        await tx.updateTable('live_entries').set(values).where('id', '=', existing.id).where('status', '=', 'LEFT').execute();
        entryId = existing.id;
      } else {
        try {
          entryId = (await tx.insertInto('live_entries').values({ drop_id: id, account_id: account, ...values }).returning('id').executeTakeFirstOrThrow()).id;
        } catch (e) {
          if (isUniqueViolation(e, 'live_entries_drop_account_key')) throw alreadyEntered();
          throw e;
        }
      }
      if (set) await writeLiveEntrySizes(tx, id, entryId, set);
      notes.push({
        actor,
        action: 'drop.live.enter',
        targetType: 'drop',
        targetId: id,
        details: {
          entryId,
          sizeId: size.id,
          ...auditedSizes(set),
          quantity,
          ...(late ? { position: slot.position } : {}),
          ...(existing ? { again: true } : {}),
          ...(g ? { guaranteeId: g.id } : {}),
        },
      });
      await this.record(tx, notes);
    }));
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * CHANGE SIZE (and quantity) while WAITING, before T0 only (409 LIVE_SIZE_LOCKED from T0 on, the size never changes
   * after). Audited `drop.live.size`. Macro scope K44 T1: on a set's release, the size of any of its pieces (`sizes`, the
   * others kept) and its sets.
   */
  async changeSize(accountId: string, dropId: string, input: LiveSizeChoice & { quantity?: number }, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update', account);
      if (d.cancelled_at) throw liveCancelled();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveOver();
      const e = await this.lockEntry(tx, id, account);
      if (!e || e.status === 'LEFT') throw notEntered();
      if (now.getTime() >= d.opens_at.getTime() || e.position !== null) throw sizeLocked();
      if (e.status !== 'WAITING') throw notInLine();
      if (d.set_id !== null) {
        await this.changeSetSizes(tx, d, e, input, now, actor);
        return;
      }
      // IN-01: the entry's guarantee, or the one set aside for the account when the entry is not bound (its size could not
      // serve it): the new size is checked again, and binds it when it can.
      const held = e.guarantee_id
        ? await tx.selectFrom('house_guarantees').select(['id', 'pieces', 'visible']).where('id', '=', e.guarantee_id).forUpdate().executeTakeFirst()
        : await holderGuarantee(tx, account, d);
      if (input?.sizes !== undefined && input?.sizes !== null) throw notASet();
      const { size, quantity } = await this.choice(tx, d, input?.sizeId, input?.quantity ?? e.quantity, held?.pieces);
      if (size.id === e.size_id && quantity === e.quantity) return;
      const g = held ? await this.guaranteeInSize(tx, d, held, size.id, quantity, e.id) : null;
      const bound = g?.id ?? null;
      await tx.updateTable('live_entries').set({ size_id: size.id, quantity, guarantee_id: bound }).where('id', '=', e.id).where('status', '=', 'WAITING').execute();
      await this.audit.record(
        {
          actor,
          action: 'drop.live.size',
          targetType: 'drop',
          targetId: id,
          details: { entryId: e.id, sizeId: size.id, quantity, before: { sizeId: e.size_id, quantity: e.quantity }, ...(bound !== e.guarantee_id ? { guaranteeId: bound, guaranteeBefore: e.guarantee_id } : {}) },
        },
        tx,
      );
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * LEAVE: WAITING (the room), QUEUED (the line) or TURN (a turn given back: the piece goes to the next) → LEFT; a turn
   * whose deadline has passed is not given back (409 LIVE_TURN_PASSED: the engine marks it MISSED at its deadline).
   * Never back in the line after T0. Audited `drop.live.leave` with the status it left.
   */
  async leave(accountId: string, dropId: string, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    // A place left in the line moves those behind it up: the next batch waits for a frame that shows it (D9).
    await this.changing(id, (mark) => inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update', account);
      const e = await this.lockEntry(tx, id, account);
      if (!e) throw notEntered();
      if (e.status !== 'WAITING' && e.status !== 'QUEUED' && e.status !== 'TURN') throw notInLine();
      if (e.status === 'QUEUED') mark();
      // A turn that has run out, the engine not having marked it yet: MISSED at its deadline, not LEFT.
      if (e.status === 'TURN' && effectiveDeadline(e.turn_expires_at!, d, now).getTime() <= now.getTime()) throw turnPassed();
      // IN-01: a guarantee not used yet (WAITING, QUEUED) is unbound and stays ACTIVE; one used at the turn stays used.
      const unbind = e.guarantee_id !== null && e.status !== 'TURN';
      await tx
        .updateTable('live_entries')
        .set({ status: 'LEFT', ended_at: maxDate(now, e.joined_at), ...(unbind ? { guarantee_id: null } : {}) })
        .where('id', '=', e.id)
        .execute();
      const notes: AuditRecordInput[] = [];
      if (e.status === 'TURN') await this.giveTurnsAtOnce(tx, d, now, notes);
      await this.audit.record(
        { actor, action: 'drop.live.leave', targetType: 'drop', targetId: id, details: { entryId: e.id, from: e.status, ...(e.guarantee_id ? { guaranteeId: e.guarantee_id } : {}) } },
        tx,
      );
      await this.record(tx, notes);
    }));
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * I'LL BE THERE with a size, from the announcement to T0, for an account allowed in: one per account and release, its
   * size changed in place. Audited `drop.live.interest` with the size. Macro scope K44 T1: on a set's release, a size per
   * piece (`sizes`, every piece; 422 LIVE_SET_SIZES otherwise), its first piece's kept in `size_id`, every piece's in
   * `live_interest_sizes`.
   */
  async setInterest(accountId: string, dropId: string, choice: string | LiveSizeChoice, actor: Actor): Promise<LiveInterestView> {
    const given: LiveSizeChoice = typeof choice === 'string' ? { sizeId: choice } : (choice ?? {});
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const early = await this.accessAhead(id, account);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share', account);
      if (d.cancelled_at) throw liveCancelled();
      if (d.ended_at || now.getTime() >= d.opens_at.getTime()) throw interestClosed();
      const access = early ?? (await accessOf(tx, d, account, now));
      if (!access.allowed) throw notEligible(await liveAccessRule(tx, d, now), access);
      const { size, set } = await this.chosen(tx, d, given, 1, now);
      const before = await tx.selectFrom('live_interest').select('size_id').where('drop_id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      const sizesBefore = set && before ? await tx.selectFrom('live_interest_sizes').select(['piece', 'size_id']).where('drop_id', '=', id).where('account_id', '=', account).orderBy('piece').execute() : [];
      if (before?.size_id === size.id && (!set || sameSizes(set, sizesBefore))) return;
      await tx
        .insertInto('live_interest')
        .values({ drop_id: id, account_id: account, size_id: size.id, created_at: now })
        .onConflict((oc) => oc.columns(['drop_id', 'account_id']).doUpdateSet({ size_id: size.id }))
        .execute();
      if (set) {
        await tx.deleteFrom('live_interest_sizes').where('drop_id', '=', id).where('account_id', '=', account).execute();
        await tx.insertInto('live_interest_sizes').values(set.map((c) => ({ drop_id: id, account_id: account, piece: c.piece, size_id: c.size.id }))).execute();
      }
      await this.audit.record(
        {
          actor,
          action: 'drop.live.interest',
          targetType: 'drop',
          targetId: id,
          details: {
            sizeId: size.id,
            ...auditedSizes(set),
            ...(before ? { before: before.size_id } : {}),
            ...(set && before ? { sizesBefore: sizesBefore.map((x) => ({ piece: x.piece, sizeId: x.size_id })) } : {}),
          },
        },
        tx,
      );
    });
    return (await this.interestView(this.db, account, id))!;
  }

  /** Withdraw I'LL BE THERE, before T0 (409 LIVE_INTEREST_CLOSED after; LIVE_NOT_INTERESTED without one). Audited `drop.live.interest.withdraw`. */
  async withdrawInterest(accountId: string, dropId: string, actor: Actor): Promise<void> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share', account);
      if (now.getTime() >= d.opens_at.getTime()) throw interestClosed();
      // Macro scope K44 T1: a set's interest, its sizes per piece first (they name it: ON DELETE RESTRICT).
      await tx.deleteFrom('live_interest_sizes').where('drop_id', '=', id).where('account_id', '=', account).execute();
      const r = await tx.deleteFrom('live_interest').where('drop_id', '=', id).where('account_id', '=', account).returning('size_id').executeTakeFirst();
      if (!r) throw notInterested();
      await this.audit.record({ actor, action: 'drop.live.interest.withdraw', targetType: 'drop', targetId: id, details: { sizeId: r.size_id } }, tx);
    });
  }

  /**
   * PRESS: the seal pressed, on the server's clock, during one's own turn (its secret), the release not paused. A new
   * press replaces the last (letting go resets the ring). No state changes: not audited.
   */
  async press(accountId: string, dropId: string, token: string): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share', account);
      const e = await this.runningTurn(tx, d, account, token, now);
      await tx.updateTable('live_entries').set({ press_started_at: now }).where('id', '=', e.id).where('status', '=', 'TURN').execute();
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * SECURE: the seal held. Needs one's own running turn (its secret; 409 LIVE_TURN_PASSED once its deadline is past,
   * LIVE_PAUSED during a pause), a press at least LIVE_GESTURE_MIN_MS earlier on the server's clock (409
   * LIVE_HOLD_TOO_SHORT), and the rule of the release still met (403). SECURED: the hold runs the pay window of the
   * entry's tier. Audited `drop.live.secure` with the gesture's length.
   */
  async secure(accountId: string, dropId: string, token: string, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const early = await this.accessAhead(id, account);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share', account);
      const e = await this.runningTurn(tx, d, account, token, now);
      const gesture = e.press_started_at ? now.getTime() - e.press_started_at.getTime() : -1;
      if (gesture < LIVE_GESTURE_MIN_MS) throw holdTooShort();
      const access = early ?? (await accessOf(tx, d, account, now));
      if (!access.allowed) throw notEligible(await liveAccessRule(tx, d, now), access);
      const { payMinutes } = windowsFor(d, await this.tierWindows(tx, d), e.tier);
      await tx
        .updateTable('live_entries')
        .set({ status: 'SECURED', secured_at: now, hold_expires_at: new Date(now.getTime() + payMinutes * MINUTE_MS), gesture_ms: gesture })
        .where('id', '=', e.id)
        .where('status', '=', 'TURN')
        .execute();
      await this.audit.record({ actor, action: 'drop.live.secure', targetType: 'drop', targetId: id, details: { entryId: e.id, gestureMs: gesture } }, tx);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * ADD-ONS: the add-ons of the release chosen for a held piece (at most LIVE_ADDONS_MAX, each once), replacing the
   * previous choice, each with its price now. Plan MACRO M3 §4.2 (D2): `items`, when sent, replaces the catalogue
   * add-ons chosen with it (services/order-addons.ts setChoices: offered at the release's location in its currency, that
   * many available there, at most 3 of each), carried onto its order at PAY; left out, they stay as they were. Audited
   * `drop.live.addons` with their ids (and the items, when sent).
   */
  async setAddons(accountId: string, dropId: string, addonIds: readonly string[], actor: Actor, items?: readonly AddonUnitsInput[]): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    if (!Array.isArray(addonIds) || addonIds.length > LIVE_ADDONS_MAX) throw addonUnknown();
    const wanted = [...new Set(addonIds.map((a) => knownId(a, addonUnknown)))].sort();
    const catalogue = items === undefined ? undefined : cleanAddonItems(items);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share', account);
      const e = await this.runningHold(tx, d, account, now);
      const addons = wanted.length ? await tx.selectFrom('live_addons').select(['id', 'price_minor']).where('drop_id', '=', id).where('id', 'in', wanted).execute() : [];
      if (addons.length !== wanted.length) throw addonUnknown();
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      if (addons.length) await tx.insertInto('live_entry_addons').values(addons.map((a) => ({ entry_id: e.id, addon_id: a.id, price_minor: a.price_minor }))).execute();
      const chosen =
        catalogue === undefined ? undefined : await setChoices(tx, { liveEntryId: e.id }, catalogue, { locationId: await liveAddonLocation(tx, d), currency: liveCurrency(d.currency) }, now);
      await this.audit.record({ actor, action: 'drop.live.addons', targetType: 'drop', targetId: id, details: { entryId: e.id, addonIds: wanted, ...(chosen !== undefined ? { items: chosen } : {}) } }, tx);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * PAY (a placeholder for now): the held piece CONFIRMED, and its orders created in the same transaction, one per piece,
   * RESERVED (services/orders.ts ordersForLiveEntry: each holds a piece in stock or one to make), which ORBES Client
   * Services follows to their delivery. Its hold must be running (409 LIVE_HOLD_ENDED). The last piece confirmed ends
   * the release, SOLD_OUT. Audited `drop.live.confirm`, and `order.create` for each order. On a paced release, a piece
   * confirmed lowers what its size can still serve (a multi-piece entry ahead may then be passed over): the next batch
   * waits for a frame read after it (D9, live-frames.ts `changed`).
   */
  async confirm(accountId: string, dropId: string, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    let leftOut: LeftOutAddon[] = [];
    await this.changing(id, (mark, changes) => inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update', account);
      const e = await this.runningHold(tx, d, account, now);
      if (d.pace_batch !== null) mark();
      await tx.updateTable('live_entries').set({ status: 'CONFIRMED', confirmed_at: now }).where('id', '=', e.id).where('status', '=', 'SECURED').execute();
      const confirmed: AuditRecordInput = { actor, action: 'drop.live.confirm', targetType: 'drop', targetId: id, details: { entryId: e.id, quantity: e.quantity } };
      const notes: AuditRecordInput[] = [confirmed];
      await this.settleEnd(tx, d, now, notes, changes);
      const created = await ordersForLiveEntry(tx, e.id, actor, now);
      notes.push(...created.notes);
      // Plan MACRO M3 §4.2 (D2): the add-ons that could not be added, said in PAY's answer and its audit entry.
      leftOut = created.addonsLeftOut;
      if (leftOut.length > 0) confirmed.details = { ...confirmed.details, addonsLeftOut: leftOut.map((l) => ({ addonId: l.addonId, units: l.units, reason: l.reason })) };
      await this.record(tx, notes);
    }));
    const entry = (await this.viewerEntry(this.db, account, id))!;
    return leftOut.length > 0 ? { ...entry, addonsLeftOut: leftOut } : entry;
  }

  /** RELEASE MY PLACE: the held piece given back (RELEASED, add-ons dropped); the next in line gets it. Audited `drop.live.release`. */
  async release(accountId: string, dropId: string, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update', account);
      const e = await this.runningHold(tx, d, account, now);
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      await clearChoices(tx, 'live_entry_id', [e.id]);
      await tx.updateTable('live_entries').set({ status: 'RELEASED', ended_at: now }).where('id', '=', e.id).where('status', '=', 'SECURED').execute();
      const notes: AuditRecordInput[] = [];
      await this.giveTurnsAtOnce(tx, d, now, notes);
      await this.audit.record({ actor, action: 'drop.live.release', targetType: 'drop', targetId: id, details: { entryId: e.id } }, tx);
      await this.record(tx, notes);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  // ── The console's controls (OPERATOR; END and REMOVE: ADMIN, by the routes) ─

  /**
   * PAUSE a release that has opened and not ended: no new turn, the deadlines frozen, the batches held (a batch due
   * before now goes after RESUME, with its own time and number). Audited `drop.live.pause`.
   */
  async pause(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'pause a release');
    return this.control(dropId, async (tx, d, now) => {
      if (now.getTime() < d.opens_at.getTime()) throw liveNotStarted();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      if (d.paused_at) throw alreadyPaused();
      const notes: AuditRecordInput[] = [];
      await this.formLine(tx, d, now, notes);
      await tx.updateTable('drops').set({ paused_at: now }).where('id', '=', d.id).execute();
      notes.push({ actor, action: 'drop.live.pause', targetType: 'drop', targetId: d.id, details: {} });
      await this.record(tx, notes);
    });
  }

  /**
   * RESUME: every running turn and hold moved by the time paused, and the next batch too; then turns again, at the next
   * batch (an after-room: at once). Audited `drop.live.resume` with the time paused and, on a paced release, the next
   * batch's time after it (as RESUME PACE: the TEST REPORT's PACE check reads it).
   */
  async resume(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'resume a release');
    return this.control(dropId, async (tx, d, now) => {
      if (!d.paused_at) throw notPaused();
      const pausedMs = await this.unpause(tx, d, now);
      const next = paceNextAt(d);
      const notes: AuditRecordInput[] = [];
      await this.giveTurnsAtOnce(tx, d, now, notes);
      await this.audit.record({ actor, action: 'drop.live.resume', targetType: 'drop', targetId: d.id, details: { pausedMs, ...(next ? { nextAt: next.toISOString() } : {}) } }, tx);
      await this.record(tx, notes);
    });
  }

  /** EXTEND the sales by `minutes` (LIVE_EXTEND_MINUTES), before their end. Audited `drop.live.extend` with the close before and after. */
  async extend(dropId: string, minutes: number, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'extend a release');
    if (!Number.isInteger(minutes) || minutes < LIVE_EXTEND_MINUTES.min || minutes > LIVE_EXTEND_MINUTES.max) {
      throw validationError(`A release is extended by ${LIVE_EXTEND_MINUTES.min} to ${LIVE_EXTEND_MINUTES.max} minutes.`);
    }
    return this.control(dropId, async (tx, d, now) => {
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      const closesAt = new Date(d.closes_at.getTime() + minutes * MINUTE_MS);
      await tx.updateTable('drops').set({ closes_at: closesAt }).where('id', '=', d.id).execute();
      await this.audit.record(
        { actor, action: 'drop.live.extend', targetType: 'drop', targetId: d.id, details: { minutes, before: d.closes_at.toISOString(), after: closesAt.toISOString() } },
        tx,
      );
    });
  }

  /**
   * ADD PIECES to a size (LIVE_ADD_PIECES), from the announcement (409 LIVE_NOT_ANNOUNCED before: the sizes are a
   * setting until then) to the end: its stock and the release's quantity raised; the pieces are offered at the next
   * batches, at the release's pace (an after-room: at once to whoever they serve). Audited `drop.live.stock` with the stock before and after, and the quantity line the
   * announcement promised (the plan's choice 36: every addition reported). Macro scope K44 T1: on a set's release, one
   * size of one piece; its quantity is then its sets on sale, the smallest of its pieces' totals (the entry's `quantity`).
   */
  async addPieces(dropId: string, sizeId: string, pieces: number, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'add pieces to a release');
    if (!Number.isInteger(pieces) || pieces < LIVE_ADD_PIECES.min || pieces > LIVE_ADD_PIECES.max) {
      throw validationError(`Add ${LIVE_ADD_PIECES.min} to ${LIVE_ADD_PIECES.max} pieces at a time.`);
    }
    const size = knownId(sizeId, sizeUnknown);
    return this.control(dropId, async (tx, d, now) => {
      // Before the announcement the stock is a setting (its quantity line following it): ADD PIECES comes after.
      if (!isAnnounced(d, now)) throw liveNotAnnounced();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      const s = await tx.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'piece']).where('drop_id', '=', d.id).where('id', '=', size).forUpdate().executeTakeFirst();
      if (!s) throw sizeUnknown();
      // Macro scope K44 T1: a set's piece holds at most a release's pieces; the release's quantity is then its sets on sale.
      const all = s.piece === null ? [] : await tx.selectFrom('drop_sizes').select(['id', 'piece', 'stock']).where('drop_id', '=', d.id).execute();
      const inPiece = s.piece === null ? d.quantity : all.filter((x) => x.piece === s.piece).reduce((n, x) => n + x.stock, 0);
      if (s.stock + pieces > LIVE_SIZE_STOCK_MAX || inPiece + pieces > DROP_QUANTITY_MAX) {
        throw validationError(`A size holds at most ${LIVE_SIZE_STOCK_MAX} pieces, a release ${DROP_QUANTITY_MAX}.`);
      }
      const quantity = s.piece === null ? d.quantity + pieces : onSaleOf(all.map((x) => (x.id === s.id ? { ...x, stock: x.stock + pieces } : x)));
      await tx.updateTable('drop_sizes').set({ stock: s.stock + pieces }).where('id', '=', s.id).execute();
      if (quantity !== d.quantity) await tx.updateTable('drops').set({ quantity }).where('id', '=', d.id).execute();
      d.quantity = quantity;
      const notes: AuditRecordInput[] = [];
      await this.giveTurnsAtOnce(tx, d, now, notes);
      await this.audit.record(
        {
          actor,
          action: 'drop.live.stock',
          targetType: 'drop',
          targetId: d.id,
          details: {
            sizeId: s.id,
            size: s.label,
            ...(s.piece !== null ? { piece: s.piece } : {}),
            pieces,
            before: s.stock,
            after: s.stock + pieces,
            quantity,
            quantityLine: d.quantity_line,
          },
        },
        tx,
      );
      await this.record(tx, notes);
    });
  }

  /**
   * FREE A HOLD: a SECURED entry EXPIRED now (at its deadline when that has already passed, the engine not having marked
   * it yet), its add-ons dropped; the piece is offered at the next batch (an after-room: at once). Audited `drop.live.free`.
   */
  async freeHold(dropId: string, entryId: string, actor: Actor): Promise<AdminLiveEntry> {
    assertStaff(actor, 'free a hold');
    return this.entryControl(dropId, entryId, async (tx, d, e, now) => {
      if (e.status !== 'SECURED') throw entryNotSecured();
      const ranOut = effectiveDeadline(e.hold_expires_at!, d, now).getTime() <= now.getTime();
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      await clearChoices(tx, 'live_entry_id', [e.id]);
      await tx.updateTable('live_entries').set({ status: 'EXPIRED', ended_at: ranOut ? e.hold_expires_at : now }).where('id', '=', e.id).execute();
      const notes: AuditRecordInput[] = [];
      await this.giveTurnsAtOnce(tx, d, now, notes);
      await this.audit.record({ actor, action: 'drop.live.free', targetType: 'drop', targetId: d.id, details: { entryId: e.id } }, tx);
      await this.record(tx, notes);
    });
  }

  /**
   * LET IN: a QUEUED entry takes its turn now, out of order, within the free pieces of its size (409
   * LIVE_NO_FREE_PIECE), from T0 (during the hold too: D4) while the release is live and not paused; its turn is stamped
   * now, with the batches given so far as its batch (`let_in_by` says it was let in). Audited `drop.live.let_in` with its
   * place. Macro scope K44 T1: a set's entry, within the free pieces of each of its sizes.
   */
  async letIn(dropId: string, entryId: string, actor: Actor): Promise<AdminLiveEntry> {
    const admin = assertStaff(actor, 'let an entry in');
    return this.entryControl(dropId, entryId, async (tx, d, e, now) => {
      if (now.getTime() < d.opens_at.getTime()) throw liveNotStarted();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      if (d.paused_at) throw livePaused();
      // Right at T0 the engine may not have formed the line yet: it is formed first.
      const notes: AuditRecordInput[] = [];
      const entry = e.status === 'WAITING' && (await this.formLine(tx, d, now, notes)) > 0 ? (await this.entryRow(tx, e.id))! : e;
      if (entry.status !== 'QUEUED') throw entryNotQueued();
      const totals = await this.sizeTotals(tx, d);
      const sizeIds = d.set_id === null ? [entry.size_id] : (await tx.selectFrom('live_entry_sizes').select('size_id').where('entry_id', '=', entry.id).execute()).map((x) => x.size_id);
      for (const sid of sizeIds) if (entry.quantity > freeOf(totals.find((s) => s.id === sid)!)) throw noFreePiece();
      const admitted = entry.admitted_at === null;
      if (admitted) {
        await tx.updateTable('live_entries').set({ admitted_at: now, admitted_batch: d.pace_batches }).where('id', '=', entry.id).where('status', '=', 'QUEUED').execute();
      }
      const used: AuditRecordInput[] = [];
      await this.grant(tx, d, [entry], now, admin, used);
      notes.push({ actor, action: 'drop.live.let_in', targetType: 'drop', targetId: d.id, details: { entryId: entry.id, position: entry.position, ...(admitted ? { admitted: true } : {}) } }, ...used);
      await this.record(tx, notes);
    });
  }

  /**
   * SET PACE: X turns every Y minutes (LIVE_PACE_BATCH, LIVE_PACE_MINUTES), slower or faster, any time until the end;
   * never on an after-room (409 LIVE_AFTER_ROOM). It takes effect from the next batch, which keeps its time (before T0
   * the first batch stays at T0 + the hold). Waiting screens show a later or earlier time at their next reading.
   * Audited `drop.live.pace` with the pace before and after.
   */
  async setPace(dropId: string, pace: { batch: number; minutes: number }, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'set the pace of a release');
    const batch = pace?.batch;
    const minutes = pace?.minutes;
    if (!Number.isInteger(batch) || batch < LIVE_PACE_BATCH.min || batch > LIVE_PACE_BATCH.max) throw paceInvalid();
    if (!Number.isInteger(minutes) || minutes < LIVE_PACE_MINUTES.min || minutes > LIVE_PACE_MINUTES.max) throw paceInvalid();
    const state = await this.control(dropId, async (tx, d, now) => {
      if (isAfterRoom(d) || d.pace_batch === null) throw afterRoomPace();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      const notes: AuditRecordInput[] = [];
      const started = now.getTime() >= d.opens_at.getTime();
      if (started) await this.formLine(tx, d, now, notes);
      const before = { batch: d.pace_batch, minutes: d.pace_minutes };
      // The next batch keeps its time (stored once the release runs); before T0 the first stays at T0 + the hold.
      const nextAt = started ? paceNextAt(d) : null;
      await tx.updateTable('drops').set({ pace_batch: batch, pace_minutes: minutes, pace_next_at: nextAt }).where('id', '=', d.id).execute();
      Object.assign(d, { pace_batch: batch, pace_minutes: minutes, pace_next_at: nextAt });
      notes.push({ actor, action: 'drop.live.pace', targetType: 'drop', targetId: d.id, details: { before, after: { batch, minutes }, nextAt: nextAt ? nextAt.toISOString() : null } });
      await this.record(tx, notes);
    });
    void this.frames.ask(state.id);
    return state;
  }

  /**
   * PAUSE PACE: no batch is given until RESUME PACE; the turns already given go on, and NEXT BATCH NOW and LET IN still
   * work. From T0 (409 LIVE_NOT_STARTED before) to the end, on a paced release (409 LIVE_NO_PACE: an after-room). Audited
   * `drop.live.pace.pause`.
   */
  async pausePace(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'pause the pace of a release');
    return this.control(dropId, async (tx, d, now) => {
      if (d.pace_batch === null) throw noPace();
      if (now.getTime() < d.opens_at.getTime()) throw liveNotStarted();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      if (d.pace_paused_at) throw paceAlreadyPaused();
      const notes: AuditRecordInput[] = [];
      await this.formLine(tx, d, now, notes);
      const nextAt = paceNextAt(d)!;
      await tx.updateTable('drops').set({ pace_paused_at: now, pace_next_at: nextAt }).where('id', '=', d.id).execute();
      Object.assign(d, { pace_paused_at: now, pace_next_at: nextAt });
      notes.push({ actor, action: 'drop.live.pace.pause', targetType: 'drop', targetId: d.id, details: { batches: d.pace_batches } });
      await this.record(tx, notes);
    });
  }

  /**
   * RESUME PACE: the next batch moved by the time the pace was held by this pause alone (paceShiftMs: a stretch the
   * release's PAUSE also held is moved once); the batches go on from it. Until the end (409 LIVE_ENDED after, as PAUSE
   * PACE and NEXT BATCH NOW). Audited `drop.live.pace.resume` with the time paused.
   */
  async resumePace(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'resume the pace of a release');
    return this.control(dropId, async (tx, d, now) => {
      if (d.pace_batch === null) throw noPace();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      if (!d.pace_paused_at) throw paceNotPaused();
      const pausedMs = Math.max(0, now.getTime() - d.pace_paused_at.getTime());
      const next = paceNextAt(d)!;
      const nextAt = next.getTime() > d.pace_paused_at.getTime() ? new Date(next.getTime() + paceShiftMs(d.pace_paused_at, d.paused_at, now)) : next;
      await tx.updateTable('drops').set({ pace_paused_at: null, pace_next_at: nextAt }).where('id', '=', d.id).execute();
      Object.assign(d, { pace_paused_at: null, pace_next_at: nextAt });
      await this.record(tx, [{ actor, action: 'drop.live.pace.resume', targetType: 'drop', targetId: d.id, details: { pausedMs, nextAt: nextAt.toISOString() } }]);
    });
  }

  /**
   * NEXT BATCH NOW (D6, ANSWERS B6: "up to X extra turns where a piece is free; refused when none; the batch clock keeps
   * its time"): one extra batch, up to X turns in the order of the turns where the entry's size has a free piece, at
   * its press time. From T0 (409 LIVE_NOT_STARTED before; during the hold it starts the first turns early, the first
   * scheduled batch keeping its time) to the end (409 LIVE_ENDED), refused while the release is PAUSED (409 LIVE_PAUSED:
   * its turns are frozen), working while PAUSE PACE holds the batches; refused with 409 LIVE_NOTHING_FREE when it would
   * give no turn. At most one batch per frame (live-frames.ts): pressed when a batch has been given since the last frame
   * (a scheduled one, or another press within the same second), it is checked at once, waits for the next frame and is
   * then given with its press time, in the order due (G2: once those it reaches have read that they are next); the answer
   * comes once it is given. Not given within PRESS_WAIT_MS, or its request closed (`signal`) before, it is withdrawn:
   * 503 LIVE_BATCH_WAITING, nothing given, never given afterwards (one being given at that moment is answered as given).
   * Audited `drop.live.pace.next` with its batch and turns (and `drop.live.batch`, the system's record of the batch,
   * `extra`).
   */
  async nextBatch(dropId: string, actor: Actor, opts: { signal?: AbortSignal } = {}): Promise<LiveReleaseState> {
    const admin = assertStaff(actor, 'give the next batch now');
    const id = knownId(dropId, dropNotFound);
    let press: PendingBatch | null = null;
    // Checked at once, under the release's row: the refusals as they stand now; then the press waits its turn (a press
    // whose transaction fails is withdrawn: it was never given).
    const pressed = () => press as PendingBatch | null;
    await this.batches(id, async (tx, d, now, notes, pass) => {
      if (d.cancelled_at) throw liveCancelled();
      if (d.pace_batch === null) throw noPace();
      if (now.getTime() < d.opens_at.getTime()) throw liveNotStarted();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      if (d.paused_at) throw livePaused();
      await this.formLine(tx, d, now, notes, pass);
      if ((await this.batchGrants(tx, d, now, d.pace_batch)).length === 0) throw nothingFree();
      press = this.frames.press(d.id, now, admin);
      await this.giveDue(tx, d, now, notes, pass);
    }).catch((e: unknown) => {
      const p = pressed();
      if (p && !p.settled) {
        this.frames.drop(id, p);
        p.reject(e);
      }
      throw e;
    });
    const mine = pressed();
    if (!mine) throw nothingFree();
    const until = Date.now() + this.pressWaitMs;
    const { signal } = opts;
    const closed = signal ? new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true }))) : null;
    // Held by the readings of those it reaches (G2) rather than by a frame: tried again every 250 ms (the engine too).
    let readings = false;
    while (!mine.settled) {
      if (Date.now() >= until || signal?.aborted) {
        // Withdrawn, unless a transaction is giving it this moment: then its outcome is the answer.
        if (!mine.giving) {
          this.frames.drop(id, mine);
          mine.reject(batchWaiting());
          break;
        }
        await Promise.race([mine.done.then(noop, noop), delay(50)]);
        continue;
      }
      if (!readings) void this.frames.ask(id);
      await Promise.race([mine.done.then(noop, noop), ...(readings ? [] : [this.frames.whenOpen(id)]), ...(closed ? [closed] : []), delay(250)]);
      if (mine.settled) break;
      if (!this.frames.open(id)) {
        readings = false;
        continue;
      }
      try {
        let held = false;
        await this.batches(id, async (tx, d, now, notes, pass) => {
          await this.giveDue(tx, d, now, notes, pass);
          held = pass.readings;
        });
        readings = held;
      } catch (e) {
        if (!mine.settled && !mine.giving) {
          this.frames.drop(id, mine);
          mine.reject(e);
        }
      }
    }
    await mine.done;
    return this.releaseState(this.db, id);
  }

  /**
   * SHORTEN THE HOLD (D4, ANSWERS B4: "once open it can only be shortened or ended"): the hold after the opening set to
   * `minutes` from T0, so the first batch comes earlier, never later (409 LIVE_HOLD_LATER) and not before now (400: END
   * THE HOLD NOW does that). From the announcement (409 LIVE_NOT_ANNOUNCED before: the hold is a setting until then,
   * set longer or shorter freely) until the first scheduled batch, a NEXT BATCH NOW during the hold leaving it as it was
   * (409 LIVE_NO_HOLD once that batch has gone or is due, or with no hold);
   * never on an after-room (409 LIVE_AFTER_ROOM). Audited `drop.live.hold.shorten` with the first batch before and after.
   */
  async shortenHold(dropId: string, minutes: number, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'shorten the hold of a release');
    if (!Number.isInteger(minutes) || minutes < LIVE_HOLD_MINUTES.min || minutes > LIVE_HOLD_MINUTES.max) throw holdInvalid();
    const state = await this.control(dropId, async (tx, d, now) => {
      const before = this.holdLeft(d, now);
      const after = new Date(d.opens_at.getTime() + minutes * MINUTE_MS);
      if (after.getTime() >= before.getTime()) throw holdLater();
      if (after.getTime() < now.getTime()) throw holdPast();
      await tx.updateTable('drops').set({ pace_hold_minutes: minutes, pace_next_at: after }).where('id', '=', d.id).execute();
      await this.audit.record(
        { actor, action: 'drop.live.hold.shorten', targetType: 'drop', targetId: d.id, details: { before: before.toISOString(), after: after.toISOString(), minutes } },
        tx,
      );
    });
    void this.frames.ask(state.id);
    return state;
  }

  /**
   * END THE HOLD NOW: the first batch due now (at T0 before T0), the next ones every Y minutes from it; the engine gives
   * it at its next pass. From the announcement until the first scheduled batch, as SHORTEN THE HOLD (409 LIVE_NOT_ANNOUNCED,
   * LIVE_NO_HOLD, LIVE_AFTER_ROOM). Audited `drop.live.hold.end` with the first batch's time.
   */
  async endHold(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'end the hold of a release');
    const state = await this.control(dropId, async (tx, d, now) => {
      const before = this.holdLeft(d, now);
      const at = maxDate(now, d.opens_at);
      await tx.updateTable('drops').set({ pace_hold_minutes: 0, pace_next_at: at }).where('id', '=', d.id).execute();
      await this.audit.record({ actor, action: 'drop.live.hold.end', targetType: 'drop', targetId: d.id, details: { before: before.toISOString(), at: at.toISOString() } }, tx);
    });
    void this.frames.ask(state.id);
    return state;
  }

  /** The first batch's time while a hold is left to shorten or end (the refusals of SHORTEN THE HOLD and END THE HOLD NOW otherwise). */
  private holdLeft(d: LiveDrop, now: Date): Date {
    if (isAfterRoom(d) || d.pace_batch === null) throw afterRoomPace();
    if (!isAnnounced(d, now)) throw holdTooEarly();
    if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
    const first = holdEndsAt(d);
    if (!first || first.getTime() <= now.getTime()) throw noHold();
    return first;
  }

  /**
   * A host message: one line of 1 to LIVE_MESSAGE_MAX characters, the latest shown in the room; from the announcement
   * (409 LIVE_NOT_ANNOUNCED before) to the end (409 LIVE_ENDED after). Audited `drop.live.message`.
   */
  async message(dropId: string, text: string, actor: Actor): Promise<LiveMessageView> {
    const admin = assertStaff(actor, 'write to the room');
    const line = typeof text === 'string' ? text.trim() : '';
    if (line.length < 1 || line.length > LIVE_MESSAGE_MAX || CONTROL_CHARS.test(line)) throw validationError(`A message is one line of 1 to ${LIVE_MESSAGE_MAX} characters.`);
    let out: LiveMessageView | undefined;
    await this.control(dropId, async (tx, d, now) => {
      if (!isAnnounced(d, now)) throw messageTooEarly();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      const row = await tx.insertInto('live_messages').values({ drop_id: d.id, text: line, created_by: admin, created_at: now }).returning(['id', 'text', 'created_at']).executeTakeFirstOrThrow();
      out = { id: row.id, text: row.text, createdAt: row.created_at };
      await this.audit.record({ actor, action: 'drop.live.message', targetType: 'drop', targetId: d.id, details: { messageId: row.id, text: line } }, tx);
    });
    return out!;
  }

  /**
   * END NOW (ADMIN, a phrase typed in the console): no new turn; WAITING, QUEUED and TURN entries ENDED at once; the
   * holds may still be confirmed until their deadlines (a pause in progress ends with it, the deadlines moved as by
   * RESUME). Audited `drop.live.end` with the reason ENDED.
   */
  async end(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'end a release');
    return this.control(dropId, async (tx, d, now, changes) => {
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      const resumed = d.paused_at ? await this.unpause(tx, d, now) : null;
      const notes: AuditRecordInput[] = [];
      await this.endRelease(tx, d, 'ENDED', now, actor, resumed === null ? {} : { pausedMs: resumed }, notes, changes);
      await this.record(tx, notes);
    });
  }

  /** REMOVE (ADMIN): an open entry REMOVED, its add-ons dropped; a piece it held goes to the next. Audited `drop.live.remove`. */
  async remove(dropId: string, entryId: string, actor: Actor): Promise<AdminLiveEntry> {
    const admin = assertStaff(actor, 'remove an entry');
    return this.entryControl(dropId, entryId, async (tx, d, e, now) => {
      if (!(LIVE_OPEN_STATUSES as readonly string[]).includes(e.status)) throw entryClosed();
      const at = maxDate(now, e.joined_at);
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      await clearChoices(tx, 'live_entry_id', [e.id]);
      // IN-01: a guarantee not used yet (WAITING, QUEUED) is unbound and stays ACTIVE; one used at the turn stays used.
      const unbind = e.guarantee_id !== null && (e.status === 'WAITING' || e.status === 'QUEUED');
      await tx
        .updateTable('live_entries')
        .set({ status: 'REMOVED', removed_by: admin, removed_at: at, ended_at: at, ...(unbind ? { guarantee_id: null } : {}) })
        .where('id', '=', e.id)
        .execute();
      const notes: AuditRecordInput[] = [];
      if (e.status === 'TURN' || e.status === 'SECURED') await this.giveTurnsAtOnce(tx, d, now, notes);
      await this.audit.record(
        { actor, action: 'drop.live.remove', targetType: 'drop', targetId: d.id, details: { entryId: e.id, from: e.status, ...(e.guarantee_id ? { guaranteeId: e.guarantee_id } : {}) } },
        tx,
      );
      await this.record(tx, notes);
    });
  }

  /**
   * The boutique board's secret link (the plan's choice 31): a new secret of LIVE_BOARD_TOKEN_BYTES random bytes,
   * base64url, returned once; only its SHA-256 is kept (`board_token_hash`), with the time it was issued. Issuing again
   * replaces it: the previous link stops working at once. Any LIVE RELEASE not cancelled (the console prepares the
   * screen before the announcement; the board itself shows nothing before it). Audited `drop.live.board.issue`, never
   * with the secret.
   */
  async issueBoardLink(dropId: string, actor: Actor): Promise<{ token: string; issuedAt: Date }> {
    assertStaff(actor, 'issue a board link');
    const id = knownId(dropId, dropNotFound);
    const token = randomBytes(LIVE_BOARD_TOKEN_BYTES).toString('base64url');
    const issuedAt = await inTransaction(this.db, async (tx) => {
      const d = await this.lockAnyLive(tx, id);
      const now = this.clock();
      if (d.cancelled_at) throw liveCancelled();
      if (isAfterRoom(d)) throw afterRoomBoard();
      await tx.updateTable('drops').set({ board_token_hash: liveBoardTokenHash(token), board_token_issued_at: now }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'drop.live.board.issue', targetType: 'drop', targetId: id, details: d.board_token_hash ? { replaced: true } : {} }, tx);
      return now;
    });
    return { token, issuedAt };
  }

  /** Revoke the board's link: the board answers 404 from then on (409 LIVE_NO_BOARD_LINK without one). Audited `drop.live.board.revoke`. */
  async revokeBoardLink(dropId: string, actor: Actor): Promise<void> {
    assertStaff(actor, 'revoke a board link');
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      const d = await this.lockAnyLive(tx, id);
      if (!d.board_token_hash) throw noBoardLink();
      await tx.updateTable('drops').set({ board_token_hash: null, board_token_issued_at: null }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'drop.live.board.revoke', targetType: 'drop', targetId: id, details: {} }, tx);
    });
  }

  // ── The engine (live-engine.ts) ──────────────────────────────────────────

  /** The releases in their live window at `now`: published, not cancelled, from T0 until no entry is left open. */
  async liveReleaseIds(db: Db = this.db): Promise<string[]> {
    const now = this.clock();
    const rows = await db
      .selectFrom('drops as d')
      .select('d.id')
      .where('d.mode', '=', 'LIVE')
      .where('d.published_at', 'is not', null)
      .where('d.cancelled_at', 'is', null)
      .where('d.opens_at', '<=', now)
      .where((eb) =>
        eb.or([
          eb('d.ended_at', 'is', null),
          eb.exists(eb.selectFrom('live_entries as e').select('e.id').whereRef('e.drop_id', '=', 'd.id').where('e.status', 'in', [...LIVE_OPEN_STATUSES])),
        ]),
      )
      .orderBy('d.opens_at')
      .orderBy('d.id')
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * One pass of the engine on one release, in one transaction, its row FOR NO KEY UPDATE (as lockLive): the line at T0,
   * the turns and holds that ran out (not while paused), the end (SOLD_OUT, CLOSED), then the turns: on a paced release
   * the batch due, at most one per frame (giveDue); in an after-room, at once. Null when it is not a live LIVE RELEASE
   * (any more).
   */
  async advance(dropId: string, db: Db = this.db): Promise<LiveAdvance | null> {
    const id = knownId(dropId, dropNotFound);
    const first = await this.advanceOnce(id, db);
    // A batch due waits for the frame after the last batch: asked for, and once it is out, the pass goes again (the
    // first batch after a restart waits for the first frame; the hub publishes at most one a pulse).
    if (!first?.waiting || first.batch !== null) return first;
    await this.frames.ask(id);
    if (!this.frames.open(id)) return first;
    const again = await this.advanceOnce(id, db);
    if (!again) return first;
    return {
      ...again,
      queued: first.queued + again.queued,
      admitted: first.admitted + again.admitted,
      missed: first.missed + again.missed,
      expired: first.expired + again.expired,
      turns: first.turns + again.turns,
      ended: first.ended ?? again.ended,
    };
  }

  private async advanceOnce(id: string, db: Db): Promise<LiveAdvance | null> {
    const pass: BatchPass = { given: null, waiting: false, readings: false, gave: false, mark: 0, taking: null };
    // Its end may carry a guarantee to another running release, bound there to a QUEUED entry (guarantees.ts).
    const changes = new LiveChanges(this.frames);
    let out: LiveAdvance | null;
    let committed = false;
    try {
      out = await inTransaction(db, async (tx) => {
        const d = await tx.selectFrom('drops').selectAll().where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
        if (!d || d.mode !== 'LIVE' || !d.published_at || d.cancelled_at) return null;
        const now = this.clock();
        const out: LiveAdvance = { dropId: id, queued: 0, admitted: 0, batch: null, waiting: false, missed: 0, expired: 0, turns: 0, ended: null };
        if (now.getTime() < d.opens_at.getTime()) return out;
        const notes: AuditRecordInput[] = [];
        out.queued = await this.formLine(tx, d, now, notes, pass);
        if (!d.paused_at) await this.runOut(tx, d, now, out);
        const paused = d.paused_at !== null;
        out.ended = await this.settleEnd(tx, d, now, notes, changes);
        // A pause the end has just ended (settleEnd): what ran out before it began is marked now, as a pass after it would.
        if (paused && !d.paused_at) await this.runOut(tx, d, now, out);
        if (d.pace_batch !== null) {
          await this.giveDue(tx, d, now, notes, pass);
          out.batch = pass.given?.batch ?? null;
          out.turns = pass.given?.turns ?? 0;
          out.waiting = pass.waiting;
        } else out.turns = await this.giveTurnsAtOnce(tx, d, now, notes, out);
        await this.record(tx, notes);
        return out;
      });
      committed = true;
    } finally {
      if (pass.mark) this.frames.settle(id, pass.mark);
      changes.settle();
      // Not given after all: the press waits again (and may be withdrawn).
      if (!committed && pass.taking) pass.taking.giving = false;
    }
    this.afterBatches(id, pass);
    return out;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The turns and holds that ran out by `now`, marked at their deadlines (MISSED; EXPIRED, add-ons dropped), counted on `out`. */
  private async runOut(tx: Db, d: LiveDrop, now: Date, out: LiveAdvance): Promise<void> {
    const missed = await tx
      .updateTable('live_entries')
      .set((eb) => ({ status: 'MISSED', ended_at: eb.ref('turn_expires_at') }))
      .where('drop_id', '=', d.id)
      .where('status', '=', 'TURN')
      .where('turn_expires_at', '<=', now)
      .returning('id')
      .execute();
    const expired = await tx
      .updateTable('live_entries')
      .set((eb) => ({ status: 'EXPIRED', ended_at: eb.ref('hold_expires_at') }))
      .where('drop_id', '=', d.id)
      .where('status', '=', 'SECURED')
      .where('hold_expires_at', '<=', now)
      .returning('id')
      .execute();
    if (expired.length) await tx.deleteFrom('live_entry_addons').where('entry_id', 'in', expired.map((e) => e.id)).execute();
    if (expired.length) await clearChoices(tx, 'live_entry_id', expired.map((e) => e.id));
    out.missed += missed.length;
    out.expired += expired.length;
  }

  /** The audit entries of a transaction, written last: no row is locked after the audit chain's lock. */
  private async record(tx: Db, notes: readonly AuditRecordInput[]): Promise<void> {
    for (const n of notes) await this.audit.record(n, tx);
  }

  /** An ACTIVE account, its row FOR SHARE (a lock under way finishes first; 403 ACCOUNT_LOCKED once locked). */
  private async actingAccount(tx: Db, accountId: string): Promise<void> {
    const account = await readActingAccount(tx, accountId);
    if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
  }

  /**
   * A published LIVE RELEASE's row, FOR NO KEY UPDATE or FOR SHARE (drops.id never changes, so the exclusive mode leaves
   * the FOR KEY SHARE of a foreign-key check on drops free: a bench item inserted for the release does not wait for it);
   * anything else is the same 404 as an unknown release.
   */
  private async lockLive(tx: Db, id: string, lock: Lock): Promise<LiveDrop> {
    const q = tx.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').where('published_at', 'is not', null);
    const d = await (lock === 'update' ? q.forNoKeyUpdate() : q.forShare()).executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  /**
   * A customer's action: the release's row (lockLive), then the clock; before its announcement the same 404 as an
   * unknown release, whatever else is true of it (a cancellation included), so an id says nothing of a release to come.
   * An after-room answers so to everyone but its guests, and to them before its T0 (after-room.ts afterRoomPlace);
   * `place` is then the guest's place in its line.
   */
  private async lockAnnouncedLive(tx: Db, id: string, lock: Lock, accountId: string): Promise<{ d: LiveDrop; now: Date; place: number | null }> {
    const d = await this.lockLive(tx, id, lock);
    const now = this.clock();
    if (!isAnnounced(d, now)) throw dropNotFound();
    if (!isAfterRoom(d)) return { d, now, place: null };
    const place = await afterRoomPlace(tx, d, accountId, now);
    if (place === null) throw dropNotFound();
    return { d, now, place };
  }

  /**
   * The account against the release's rules (accessOf), read before an action's transaction takes the release's row:
   * the rules of an announced release no longer change (the console sets them until the announcement), and a segment
   * or the releases taken part in are read live at each check either way; so INTEREST, ENTER and SECURE hold the row
   * only for what must be read under it (docs/reports/live-load.md). Null when the release is not an announced LIVE
   * RELEASE yet: the transaction then reads the access itself, after its own checks.
   */
  private async accessAhead(id: string, accountId: string): Promise<LiveAccess | null> {
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').where('published_at', 'is not', null).executeTakeFirst();
    const now = this.clock();
    return d && isAnnounced(d, now) ? accessOf(this.db, d, accountId, now) : null;
  }

  /** A LIVE RELEASE's row FOR NO KEY UPDATE (as lockLive), published or not; anything else is the same 404 as an unknown release. */
  private async lockAnyLive(tx: Db, id: string): Promise<LiveDrop> {
    const d = await tx.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').forNoKeyUpdate().executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  private async entryRow(tx: Db, entryId: string): Promise<EntryRow | undefined> {
    return tx.selectFrom('live_entries').select([...ENTRY_COLUMNS]).where('id', '=', entryId).forUpdate().executeTakeFirst();
  }

  private async lockEntry(tx: Db, dropId: string, accountId: string): Promise<EntryRow | undefined> {
    return tx.selectFrom('live_entries').select([...ENTRY_COLUMNS]).where('drop_id', '=', dropId).where('account_id', '=', accountId).forUpdate().executeTakeFirst();
  }

  /** The account's TURN, its secret matching and its deadline running, the release not paused. */
  private async runningTurn(tx: Db, d: LiveDrop, accountId: string, token: string, now: Date): Promise<EntryRow> {
    const e = await this.lockEntry(tx, d.id, accountId);
    if (!e) throw notEntered();
    // The engine may have marked the turn MISSED at its deadline a moment before this call took the entry's lock.
    if (e.status === 'MISSED') throw turnPassed();
    if (e.status !== 'TURN') throw notYourTurn();
    if (typeof token !== 'string' || token.length < 1 || token.length > 128 || !sameHash(e.turn_token_hash, turnTokenHash(token))) throw turnChanged();
    if (d.paused_at) throw livePaused();
    if (effectiveDeadline(e.turn_expires_at!, d, now).getTime() <= now.getTime()) throw turnPassed();
    return e;
  }

  /** The account's SECURED entry, its hold running (a pause in progress moves its deadline). */
  private async runningHold(tx: Db, d: LiveDrop, accountId: string, now: Date): Promise<EntryRow> {
    const e = await this.lockEntry(tx, d.id, accountId);
    if (!e) throw notEntered();
    // The engine may have marked the hold EXPIRED at its deadline a moment before this call took the entry's lock.
    if (e.status === 'EXPIRED') throw holdEnded();
    if (e.status !== 'SECURED') throw notSecured();
    if (effectiveDeadline(e.hold_expires_at!, d, now).getTime() <= now.getTime()) throw holdEnded();
    return e;
  }

  /**
   * What an entry or an interest names (macro scope K44 T1): a model's release's size (`choice`; `sizes` there, 400), or a
   * set's size per piece (`setChoice`; `sizeId` alone there, 422 LIVE_SET_SIZES), its first piece's as `size`.
   */
  private async chosen(
    tx: Db,
    d: LiveDrop,
    input: LiveSizeChoice | undefined,
    quantity: number | undefined,
    now: Date,
    guaranteedPieces?: number,
  ): Promise<{ size: { id: string; stock: number }; quantity: number; set: ChosenPiece[] | null }> {
    if (d.set_id === null) {
      if (input?.sizes !== undefined && input?.sizes !== null) throw notASet();
      return { ...(await this.choice(tx, d, input?.sizeId, quantity, guaranteedPieces)), set: null };
    }
    const { set, quantity: q } = await this.setChoice(tx, d, input?.sizes, quantity, now);
    return { size: set[0]!.size, quantity: q, set };
  }

  /**
   * A set's sizes per piece (macro scope K44 T1, T4): `given`, each piece of the set once, each a size of that piece with
   * stock (every piece, unless `base`, the sizes an entry has, keeps those not given); 422 LIVE_SET_SIZES otherwise, the
   * piece named by its model once the release's name is revealed (« piece 2 » before). Its quantity in sets, 1 to
   * `per_account` (LIVE_QUANTITY_INVALID), each size's stock at least that (LIVE_SIZE_SOLD_OUT). In the set's order.
   */
  private async setChoice(
    tx: Db,
    d: LiveDrop,
    given: LiveSizeChoice['sizes'] | undefined,
    quantity: number | undefined,
    now: Date,
    base?: readonly { piece: number; size_id: string }[],
  ): Promise<{ set: ChosenPiece[]; quantity: number }> {
    const pieces: ReleasePiece[] = await setPieces(tx, d.set_id!);
    const named = liveStages(d, stagesAt(d, now))?.name ?? false;
    const nameOf = (piece: number) => (named ? (pieces.find((p) => p.piece === piece)?.model.name ?? `piece ${piece}`) : `piece ${piece}`);
    const sizes = await tx.selectFrom('drop_sizes').select(['id', 'piece', 'stock']).where('drop_id', '=', d.id).execute();
    if (!Array.isArray(given) || given.length === 0) throw setSizes('Choose a size for each piece of the set.');
    const out: ChosenPiece[] = [];
    for (const x of given as unknown[]) {
      const piece = (x as { piece?: unknown } | null)?.piece;
      const sizeId = (x as { sizeId?: unknown } | null)?.sizeId;
      if (typeof piece !== 'number' || !pieces.some((p) => p.piece === piece)) throw setSizes('This set has no such piece.');
      if (out.some((c) => c.piece === piece)) throw setSizes(`Choose one size for ${nameOf(piece)}.`);
      const id = typeof sizeId === 'string' && UUID_RE.test(sizeId) ? sizeId.toLowerCase() : null;
      const size = id === null ? undefined : sizes.find((z) => z.id === id && z.piece === piece);
      if (!size) throw setSizes(`This size is not offered for ${nameOf(piece)}.`);
      out.push({ piece, size: { id: size.id, stock: size.stock } });
    }
    for (const b of base ?? []) {
      const size = sizes.find((z) => z.id === b.size_id);
      if (size && !out.some((c) => c.piece === b.piece)) out.push({ piece: b.piece, size: { id: size.id, stock: size.stock } });
    }
    for (const p of pieces) if (!out.some((c) => c.piece === p.piece)) throw setSizes(`Choose a size for ${nameOf(p.piece!)}.`);
    out.sort((a, b) => a.piece - b.piece);
    // T4: a set counts as one, so its sets per person are the release's per_account (1..5); its orders reach 5 × 4 pieces.
    const max = d.per_account ?? LIVE_PER_ACCOUNT.default;
    const q = quantity ?? 1;
    if (!Number.isInteger(q) || q < 1 || q > max) throw quantityInvalid(max, true);
    for (const c of out) if (c.size.stock < 1 || q > c.size.stock) throw sizeSoldOut();
    return { set: out, quantity: q };
  }

  /** CHANGE SIZE on a set's release (macro scope K44 T1): any of its pieces' sizes and its sets, in the caller's transaction. */
  private async changeSetSizes(tx: Db, d: LiveDrop, e: EntryRow, input: (LiveSizeChoice & { quantity?: number }) | undefined, now: Date, actor: Actor): Promise<void> {
    if (input?.sizes === undefined || input?.sizes === null) throw setSizes('Choose a size for each piece of the set.');
    const before = await tx.selectFrom('live_entry_sizes').select(['piece', 'size_id']).where('entry_id', '=', e.id).orderBy('piece').execute();
    const { set, quantity } = await this.setChoice(tx, d, input.sizes, input.quantity ?? e.quantity, now, before);
    if (quantity === e.quantity && sameSizes(set, before)) return;
    await tx.updateTable('live_entries').set({ size_id: set[0]!.size.id, quantity }).where('id', '=', e.id).where('status', '=', 'WAITING').execute();
    await writeLiveEntrySizes(tx, d.id, e.id, set);
    await this.audit.record(
      {
        actor,
        action: 'drop.live.size',
        targetType: 'drop',
        targetId: d.id,
        details: {
          entryId: e.id,
          sizeId: set[0]!.size.id,
          ...auditedSizes(set),
          quantity,
          before: { sizeId: e.size_id, sizes: before.map((x) => ({ piece: x.piece, sizeId: x.size_id })), quantity: e.quantity },
        },
      },
      tx,
    );
  }

  /**
   * A size of the release (with stock) and a quantity within `per_account` and that stock; IN-01: a holder of the house's
   * guarantee up to max(per_account, its pieces).
   */
  private async choice(tx: Db, d: LiveDrop, sizeId: string | null | undefined, quantity: number | undefined, guaranteedPieces?: number): Promise<{ size: { id: string; stock: number }; quantity: number }> {
    const sid = knownId(sizeId as string, sizeUnknown);
    const size = await tx.selectFrom('drop_sizes').select(['id', 'stock']).where('drop_id', '=', d.id).where('id', '=', sid).executeTakeFirst();
    if (!size) throw sizeUnknown();
    if (size.stock < 1) throw sizeSoldOut();
    const max = Math.max(d.per_account ?? LIVE_PER_ACCOUNT.default, guaranteedPieces ?? 0);
    const q = quantity ?? 1;
    if (!Number.isInteger(q) || q < 1 || q > max) throw quantityInvalid(max);
    if (q > size.stock) throw sizeSoldOut();
    return { size, quantity: q };
  }

  /**
   * IN-01: the guarantee an entry of `quantity` pieces in a size binds, or null. A size that can no longer serve it
   * (sizeServesGuarantee: its stock less the CONFIRMED pieces and those of the other guaranteed entries in it) refuses a
   * guarantee shown to the client (409 LIVE_GUARANTEE_SIZE_FULL). One not shown leaves no mark for its holder: the entry
   * is an ordinary one (within the release's per collector, as anyone's), the guarantee staying set aside and unused.
   */
  private async guaranteeInSize<G extends { id: string; visible: boolean }>(tx: Db, d: LiveDrop, g: G, sizeId: string, quantity: number, entryId: string | null): Promise<G | null> {
    if (await sizeServesGuarantee(tx, d.id, sizeId, quantity, entryId)) return g;
    if (g.visible) throw guaranteeSizeFull();
    const max = d.per_account ?? LIVE_PER_ACCOUNT.default;
    if (quantity > max) throw quantityInvalid(max);
    return null;
  }

  private async lastPosition(tx: Db, dropId: string): Promise<number> {
    const r = await tx.selectFrom('live_entries').select((eb) => eb.fn.max('position').as('top')).where('drop_id', '=', dropId).executeTakeFirstOrThrow();
    return Number(r.top ?? 0);
  }

  /** The per-tier windows of a release; an after-room's are its parent's (it inherits the turn and pay windows). */
  private async tierWindows(tx: Db, d: Pick<LiveDrop, 'id' | 'parent_drop_id'>): Promise<LiveTierWindow[]> {
    return tx.selectFrom('live_tier_windows').select(['tier', 'turn_seconds', 'pay_minutes']).where('drop_id', '=', d.parent_drop_id ?? d.id).execute();
  }

  /**
   * Each size of the release with the quantities of its entries in TURN, SECURED and CONFIRMED; macro scope K44 T1: on a
   * set's release, an entry counts in each of its sizes (`live_entry_sizes`), its quantity its sets.
   */
  private async sizeTotals(tx: Db, d: Pick<LiveDrop, 'id' | 'set_id'>): Promise<SizeTotal[]> {
    const sizes = await tx.selectFrom('drop_sizes').select(['id', 'label', 'piece', 'stock']).where('drop_id', '=', d.id).orderBy('position').execute();
    const held =
      d.set_id === null
        ? await tx
            .selectFrom('live_entries')
            .select((eb) => ['size_id', 'status', eb.fn.sum<number>('quantity').as('n')])
            .where('drop_id', '=', d.id)
            .where('status', 'in', [...LIVE_HOLDING_STATUSES])
            .groupBy(['size_id', 'status'])
            .execute()
        : await tx
            .selectFrom('live_entry_sizes as x')
            .innerJoin('live_entries as e', 'e.id', 'x.entry_id')
            .select((eb) => ['x.size_id', 'e.status', eb.fn.sum<number>('e.quantity').as('n')])
            .where('e.drop_id', '=', d.id)
            .where('e.status', 'in', [...LIVE_HOLDING_STATUSES])
            .groupBy(['x.size_id', 'e.status'])
            .execute();
    return sizes.map((s) => {
      const of = (status: LiveEntryStatus) => Number(held.find((h) => h.size_id === s.id && h.status === status)?.n ?? 0);
      return { id: s.id, label: s.label, piece: s.piece, stock: s.stock, turn: of('TURN'), secured: of('SECURED'), confirmed: of('CONFIRMED') };
    });
  }

  /**
   * The line: at T0 (no place given yet) every WAITING entry, its tier read now, ordered by `lineOrder`, places from 1,
   * `queued_at` T0 (noted for the audit log: `drop.live.queue`); afterwards an entry still WAITING (another instance's clock put it
   * before T0 after the line formed) goes behind, by arrival. Returns the entries placed; with `shut`, the frame gate's
   * mark of the change when it placed any (no batch reaches them before a frame shows their places).
   */
  private async formLine(tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[], shut?: { mark: number }): Promise<number> {
    const waiting = await tx.selectFrom('live_entries').select(['id', 'account_id', 'tier', 'joined_at', 'guarantee_id']).where('drop_id', '=', d.id).where('status', '=', 'WAITING').execute();
    if (waiting.length === 0) return 0;
    const start = await this.lastPosition(tx, d.id);
    let placed: { id: string; tier: number; queuedAt: Date }[];
    if (start === 0) {
      const standings = await clubStandings(tx, waiting.map((w) => w.account_id), now);
      const seed = openDropSeed(this.seedKey, d);
      try {
        placed = lineOrder(
          waiting.map((w) => ({ id: w.id, tier: standings.get(w.account_id.toLowerCase())?.tier ?? 0, queuedAt: maxDate(d.opens_at, w.joined_at), guaranteed: w.guarantee_id !== null })),
          seed,
          d.tier_priority ?? true,
        );
      } finally {
        seed.fill(0);
      }
    } else {
      placed = [...waiting]
        .sort((a, b) => a.joined_at.getTime() - b.joined_at.getTime() || compare(a.id, b.id))
        .map((w) => ({ id: w.id, tier: w.tier, queuedAt: maxDate(now, w.joined_at) }));
    }
    for (let i = 0; i < placed.length; i += 500) {
      const values = sql.join(
        placed.slice(i, i + 500).map((p, j) => sql`(${p.id}::uuid, ${start + i + j + 1}::int, ${p.tier}::smallint, ${p.queuedAt}::timestamptz)`),
      );
      await sql`
        UPDATE live_entries AS e
           SET status = 'QUEUED', position = v.position, tier = v.tier, queued_at = v.queued_at
          FROM (VALUES ${values}) AS v(id, position, tier, queued_at)
         WHERE e.id = v.id AND e.drop_id = ${d.id} AND e.status = 'WAITING'`.execute(tx);
    }
    if (start === 0) {
      const guaranteed = waiting.filter((w) => w.guarantee_id !== null).length;
      notes.push({ actor: SYSTEM_ACTOR, action: 'drop.live.queue', targetType: 'drop', targetId: d.id, details: { entries: placed.length, guaranteed } });
    }
    // Places given (D9): the next batch waits for a frame that shows them (live-frames.ts `changed`).
    if (shut && placed.length > 0) shut.mark = Math.max(shut.mark, this.frames.changed(d.id));
    return placed.length;
  }

  /**
   * The end that is due, begun now: SOLD_OUT when every piece is confirmed (at the last confirmation, before the close),
   * CLOSED once `closes_at` has passed (at `closes_at`). A pause in progress ends with it, the deadlines moved as by
   * RESUME (a turn in progress may still be secured, a hold confirmed, until its deadline). Returns its reason, or null.
   */
  private async settleEnd(tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[], changes?: LiveChanges): Promise<LiveEndReason | null> {
    if (d.ended_at) return null;
    const totals = await this.sizeTotals(tx, d);
    // Macro scope K44 T1: a set's release sells out by sets, its sets on sale confirmed (each counted once, in its first piece).
    const stock = onSaleOf(totals);
    const first = Math.min(...totals.map((s) => s.piece ?? 0));
    const confirmed = totals.filter((s) => (s.piece ?? 0) === first).reduce((n, s) => n + s.confirmed, 0);
    let soldOutAt: Date | null = null;
    if (stock > 0 && confirmed >= stock) {
      const last = await tx.selectFrom('live_entries').select((eb) => eb.fn.max('confirmed_at').as('at')).where('drop_id', '=', d.id).executeTakeFirstOrThrow();
      soldOutAt = last.at ? new Date(last.at as Date) : now;
    }
    const reason: LiveEndReason | null = soldOutAt && soldOutAt.getTime() < d.closes_at.getTime() ? 'SOLD_OUT' : now.getTime() >= d.closes_at.getTime() ? 'CLOSED' : null;
    if (!reason) return null;
    const pausedMs = d.paused_at ? await this.unpause(tx, d, now) : null;
    await this.endRelease(tx, d, reason, reason === 'SOLD_OUT' ? soldOutAt! : d.closes_at, SYSTEM_ACTOR, pausedMs === null ? {} : { pausedMs }, notes, changes);
    return reason;
  }

  /**
   * Begin the end at `at`: `ended_at` and its reason on the release (and on `d`); WAITING and QUEUED entries ENDED, and
   * TURN ones too for an ADMIN's END. Noted for the audit log: `drop.live.end` with the reason and the entries ended.
   */
  private async endRelease(
    tx: Db,
    d: LiveDrop,
    reason: LiveEndReason,
    at: Date,
    actor: Actor,
    extra: Record<string, unknown>,
    notes: AuditRecordInput[],
    changes?: LiveChanges,
  ): Promise<void> {
    const statuses: LiveEntryStatus[] = reason === 'ENDED' ? ['WAITING', 'QUEUED', 'TURN'] : ['WAITING', 'QUEUED'];
    // Its after-room first, while the line still says who waits in it: opened for them at a sell-out, never otherwise.
    const afterRoom: AuditRecordInput[] = [];
    await settleAfterRoom(tx, d, reason, at, actor, afterRoom);
    await tx.updateTable('drops').set({ ended_at: at, ended_reason: reason }).where('id', '=', d.id).execute();
    d.ended_at = at;
    d.ended_reason = reason;
    const ended = await tx
      .updateTable('live_entries')
      .set({ status: 'ENDED', ended_at: sql<Date>`greatest(${at}::timestamptz, joined_at)` })
      .where('drop_id', '=', d.id)
      .where('status', 'in', statuses)
      .returning('id')
      .execute();
    // IN-01: the guarantees set aside for it and not used, unbound from their entries: carried, or expired.
    const guarantees: AuditRecordInput[] = [];
    await releaseCovered(tx, d.id, 'ENDED', at, actor, guarantees, changes);
    notes.push({ actor, action: 'drop.live.end', targetType: 'drop', targetId: d.id, details: { reason, at: at.toISOString(), ended: ended.length, ...extra } }, ...afterRoom, ...guarantees);
  }

  /**
   * End a pause: the turns and holds still running when it began moved by its length (one that had already run out,
   * the engine not having marked it yet, keeps its deadline and is marked at it), the next batch of a pace too (W4), the
   * length added to `paused_ms_total`. Returns it.
   */
  private async unpause(tx: Db, d: LiveDrop, now: Date): Promise<number> {
    const pausedMs = pausedFor(d, now);
    const since = d.paused_at!;
    const shift = sql`(${pausedMs}::double precision * interval '1 millisecond')`;
    await tx
      .updateTable('live_entries')
      .set({ turn_expires_at: sql<Date>`turn_expires_at + ${shift}` })
      .where('drop_id', '=', d.id)
      .where('status', '=', 'TURN')
      .where('turn_expires_at', '>', since)
      .execute();
    await tx
      .updateTable('live_entries')
      .set({ hold_expires_at: sql<Date>`hold_expires_at + ${shift}` })
      .where('drop_id', '=', d.id)
      .where('status', '=', 'SECURED')
      .where('hold_expires_at', '>', since)
      .execute();
    // W4: the next batch moves too, by the time this pause alone held the pace (a stretch PAUSE PACE also held is moved
    // once, when the later of the two ends: paceShiftMs).
    const next = paceNextAt(d);
    const nextAt = next && next.getTime() > since.getTime() ? new Date(next.getTime() + paceShiftMs(since, d.pace_paused_at, now)) : next;
    await tx
      .updateTable('drops')
      .set({ paused_at: null, paused_ms_total: sql<number>`paused_ms_total + ${pausedMs}::bigint`, ...(nextAt ? { pace_next_at: nextAt } : {}) })
      .where('id', '=', d.id)
      .execute();
    if (nextAt) d.pace_next_at = nextAt;
    d.paused_at = null;
    d.paused_ms_total = Number(d.paused_ms_total) + pausedMs;
    return pausedMs;
  }

  /**
   * A transaction that may give a batch (NEXT BATCH NOW): the release's row FOR NO KEY UPDATE (as lockLive), then `fn`,
   * its audit entries last. Once it ends: the gate settled if it gave one, then afterBatches.
   */
  private async batches(id: string, fn: (tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[], pass: BatchPass) => Promise<void>): Promise<void> {
    const pass: BatchPass = { given: null, waiting: false, readings: false, gave: false, mark: 0, taking: null };
    let committed = false;
    try {
      await inTransaction(this.db, async (tx) => {
        const d = await this.lockLive(tx, id, 'update');
        const notes: AuditRecordInput[] = [];
        await fn(tx, d, this.clock(), notes, pass);
        await this.record(tx, notes);
      });
      committed = true;
    } finally {
      if (pass.mark) this.frames.settle(id, pass.mark);
      // Not given after all: the press waits again (and may be withdrawn).
      if (!committed && pass.taking) pass.taking.giving = false;
    }
    this.afterBatches(id, pass);
  }

  /** After a transaction that may have given a batch, committed: the NEXT BATCH NOW it gave answered; a frame asked for while a batch was given or one waits. */
  private afterBatches(id: string, pass: BatchPass): void {
    const press = pass.given?.press;
    if (press) {
      this.frames.drop(id, press);
      press.resolve(pass.given!.batch);
    }
    if (pass.given) void this.frames.ask(id);
  }

  /**
   * The batch due now on a paced release, at most one, and only once the frame begun after the last batch has been
   * published (live-frames.ts; else `pass.waiting`): the scheduled slot (`paceNextAt`, while neither PAUSE nor PAUSE
   * PACE holds the batches) or the first NEXT BATCH NOW waiting, whichever fell due first (the slot first at the same
   * time), so batches are numbered in the order due and each keeps its logical time. A slot gives its batch even when
   * it gives no turn (the clock moves on); a NEXT BATCH NOW that would give none is refused (LIVE_NOTHING_FREE), as are
   * those waiting when the release is PAUSED (LIVE_PAUSED) or has ended (LIVE_ENDED). Noted `drop.live.batch` (the
   * system's, counts) for a batch that gave turns; NEXT BATCH NOW's also `drop.live.pace.next` by who pressed it.
   */
  private async giveDue(tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[], pass: BatchPass): Promise<void> {
    if (d.pace_batch === null || d.pace_minutes === null) return;
    const live = now.getTime() >= d.opens_at.getTime() && !d.ended_at && now.getTime() < d.closes_at.getTime();
    for (;;) {
      const press = this.frames.firstPending(d.id);
      if (press && (!live || d.paused_at)) {
        this.frames.drop(d.id, press);
        press.reject(!live ? liveEnded() : livePaused());
        continue;
      }
      if (!live) return;
      const slot = paceHeld(d) ? null : paceNextAt(d)!;
      const slotDue = slot !== null && slot.getTime() <= now.getTime();
      if (!slotDue && !press) return;
      if (!this.frames.open(d.id)) {
        pass.waiting = true;
        return;
      }
      const batch = d.pace_batches + 1;
      if (slotDue && (!press || slot.getTime() <= press.at.getTime())) {
        const grants = await this.batchGrants(tx, d, slot, d.pace_batch);
        if (this.unread(d, grants, now, pass)) return;
        pass.mark = this.frames.giving(d.id, now);
        pass.gave = true;
        if (grants.length) await this.grant(tx, d, grants, now, null, notes, { at: slot, batch });
        const nextAt = new Date(slot.getTime() + d.pace_minutes * MINUTE_MS);
        await tx.updateTable('drops').set({ pace_next_at: nextAt, pace_batches: batch }).where('id', '=', d.id).execute();
        Object.assign(d, { pace_next_at: nextAt, pace_batches: batch });
        if (grants.length) notes.push({ actor: SYSTEM_ACTOR, action: 'drop.live.batch', targetType: 'drop', targetId: d.id, details: { batch, at: slot.toISOString(), turns: grants.length } });
        pass.given = { batch, turns: grants.length, press: null };
        return;
      }
      const p = press!;
      const grants = await this.batchGrants(tx, d, p.at, d.pace_batch);
      if (grants.length === 0) {
        this.frames.drop(d.id, p);
        p.reject(nothingFree());
        continue;
      }
      if (this.unread(d, grants, now, pass)) return;
      // Withdrawn while its turns were read (its request's wait over or closed): never given.
      if (p.settled) continue;
      p.giving = true;
      pass.taking = p;
      pass.mark = this.frames.giving(d.id, now);
      pass.gave = true;
      await this.grant(tx, d, grants, now, null, notes, { at: p.at, batch });
      // The batch clock keeps its time: the next scheduled batch (the first, during the hold) stays where it was, and
      // the hold lasts until it (holdEndsAt: an extra batch is counted apart).
      const nextAt = paceNextAt(d)!;
      const extra = Number(d.pace_extra_batches) + 1;
      await tx.updateTable('drops').set({ pace_batches: batch, pace_extra_batches: extra, pace_next_at: nextAt }).where('id', '=', d.id).execute();
      Object.assign(d, { pace_batches: batch, pace_extra_batches: extra, pace_next_at: nextAt });
      notes.push(
        { actor: { type: 'admin', id: p.actorId }, action: 'drop.live.pace.next', targetType: 'drop', targetId: d.id, details: { batch, turns: grants.length } },
        { actor: SYSTEM_ACTOR, action: 'drop.live.batch', targetType: 'drop', targetId: d.id, details: { batch, at: p.at.toISOString(), turns: grants.length, extra: true } },
      );
      pass.given = { batch, turns: grants.length, press: p };
      return;
    }
  }

  /**
   * G2 (PLAN amendment 1): whether a batch after the first, which would give `grants` their turns, waits for their
   * phones to read that they are next (live-frames.ts `unread`, capped at READ_WAIT_MS); noted on `pass`. The first
   * batch never waits: everyone has waited the hold for it.
   */
  private unread(d: LiveDrop, grants: readonly EntryRow[], now: Date, pass: BatchPass): boolean {
    if (d.pace_batches < 1 || !this.frames.unread(d.id, grants.map((e) => e.id), now)) return false;
    pass.waiting = true;
    pass.readings = true;
    return true;
  }

  /**
   * The turns one batch gives at its logical time `at` (D3, ANSWERS B3): up to `cap`, in the order of the turns (the
   * house's guarantee first, then the place: `guarantee_id IS NULL, position`), among the QUEUED entries placed by `at`,
   * only where the entry's size has a free piece for its quantity: one that wants more than its size can still give is
   * passed over, one that does not fit yet stops its size (those behind it in that size wait). Macro scope K44 T1: on a
   * set's release, the set rule (`setTurns`) within the same cap. Reads only.
   */
  private async batchGrants(tx: Db, d: LiveDrop, at: Date, cap: number): Promise<EntryRow[]> {
    if (cap <= 0) return [];
    const totals = await this.sizeTotals(tx, d);
    const open = totals.filter((s) => freeOf(s) > 0);
    if (open.length === 0) return [];
    if (d.set_id !== null) {
      const waiting = await tx
        .selectFrom('live_entries')
        .select([...ENTRY_COLUMNS])
        .where('drop_id', '=', d.id)
        .where('status', '=', 'QUEUED')
        .where('queued_at', '<=', at)
        .orderBy('position')
        .execute();
      if (waiting.length === 0) return [];
      const rows = await tx
        .selectFrom('live_entry_sizes as x')
        .innerJoin('live_entries as e', 'e.id', 'x.entry_id')
        .select(['x.entry_id', 'x.size_id'])
        .where('e.drop_id', '=', d.id)
        .where('e.status', '=', 'QUEUED')
        .execute();
      const sizeIds = new Map<string, string[]>();
      for (const r of rows) sizeIds.set(r.entry_id, [...(sizeIds.get(r.entry_id) ?? []), r.size_id]);
      return setTurns(
        waiting.map((e) => ({ ...e, sizeIds: sizeIds.get(e.id) ?? [] })),
        new Map(totals.map((s) => [s.id, { free: freeOf(s), servable: servableOf(s) }])),
      ).slice(0, cap);
    }
    const queued = await tx
      .selectFrom('live_entries')
      .select([...ENTRY_COLUMNS])
      .where('drop_id', '=', d.id)
      .where('status', '=', 'QUEUED')
      .where('queued_at', '<=', at)
      .where('size_id', 'in', open.map((s) => s.id))
      // IN-01: the places guaranteed by the house first, then the line.
      .orderBy(sql`guarantee_id IS NULL`)
      .orderBy('position')
      .execute();
    const free = new Map(open.map((s) => [s.id, freeOf(s)]));
    const servable = new Map(open.map((s) => [s.id, servableOf(s)]));
    const stopped = new Set<string>();
    const grants: EntryRow[] = [];
    for (const e of queued) {
      if (stopped.has(e.size_id) || e.quantity > servable.get(e.size_id)!) continue;
      const left = free.get(e.size_id)!;
      if (e.quantity > left) {
        stopped.add(e.size_id);
        continue;
      }
      grants.push(e);
      free.set(e.size_id, left - e.quantity);
      if (grants.length >= cap) break;
    }
    return grants;
  }

  /**
   * The turns due now in an after-room (no pace: D29, ANSWERS r11 "Returned pieces there go at once, as today (no
   * batches)"), when it is live (T0 passed, not ended, not paused, before its close): its entries admitted as they take
   * their place (admitAtOnce, counted on `out`), then for each size with free pieces, its QUEUED entries by place; one
   * that wants more than the size can still give is passed over, the first that fits takes a turn, one that does not fit
   * yet stops the size. On a paced release, nothing: its batches give its turns (giveDue). Returns the turns given.
   */
  private async giveTurnsAtOnce(tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[], out?: LiveAdvance): Promise<number> {
    if (d.pace_batch !== null) return 0;
    if (now.getTime() < d.opens_at.getTime() || d.ended_at || d.paused_at || now.getTime() >= d.closes_at.getTime()) return 0;
    const admitted = await this.admitAtOnce(tx, d, now);
    if (out) out.admitted += admitted;
    const totals = await this.sizeTotals(tx, d);
    const open = totals.filter((s) => freeOf(s) > 0);
    if (open.length === 0) return 0;
    const queued = await tx
      .selectFrom('live_entries')
      .select([...ENTRY_COLUMNS])
      .where('drop_id', '=', d.id)
      .where('status', '=', 'QUEUED')
      .where('admitted_at', 'is not', null)
      .where('size_id', 'in', open.map((s) => s.id))
      .orderBy(sql`guarantee_id IS NULL`)
      .orderBy('position')
      .execute();
    const grants: EntryRow[] = [];
    for (const s of open) {
      let free = freeOf(s);
      const servable = servableOf(s);
      for (const e of queued) {
        if (e.size_id !== s.id) continue;
        if (e.quantity > servable) continue;
        if (e.quantity > free) break;
        grants.push(e);
        free -= e.quantity;
        if (free === 0) break;
      }
    }
    if (grants.length) await this.grant(tx, d, grants, now, null, notes);
    return grants.length;
  }

  /** An after-room's QUEUED entries admitted as they take their place (batch 0, at their place's time). Returns how many. */
  private async admitAtOnce(tx: Db, d: LiveDrop, now: Date): Promise<number> {
    const r = await tx
      .updateTable('live_entries')
      .set((eb) => ({ admitted_at: eb.fn.coalesce('queued_at', sql<Date>`${now}::timestamptz`), admitted_batch: 0 }))
      .where('drop_id', '=', d.id)
      .where('status', '=', 'QUEUED')
      .where('admitted_at', 'is', null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  }

  /**
   * Turns for `entries` (QUEUED), each with its tier's turn window and its secret's hash, from `now`; `letInBy` for a LET
   * IN; `batch`: the batch that gives them, stamped on each (`admitted_at` its logical time, `admitted_batch` its number).
   * IN-01: a turn given uses the house's guarantee of its entry (USED; noted `guarantee.use` on `notes`).
   */
  private async grant(
    tx: Db,
    d: LiveDrop,
    entries: readonly EntryRow[],
    now: Date,
    letInBy: string | null,
    notes: AuditRecordInput[],
    batch?: { at: Date; batch: number },
  ): Promise<void> {
    const admission = batch ? sql`, admitted_at = ${batch.at}::timestamptz, admitted_batch = ${batch.batch}::int` : sql``;
    const overrides = await this.tierWindows(tx, d);
    for (let i = 0; i < entries.length; i += 500) {
      const values = sql.join(
        entries.slice(i, i + 500).map((e) => {
          const expires = new Date(now.getTime() + windowsFor(d, overrides, e.tier).turnSeconds * 1000);
          return sql`(${e.id}::uuid, ${expires}::timestamptz, ${turnTokenHash(liveTurnToken(this.turnKey, e.id, now))}::bytea)`;
        }),
      );
      await sql`
        UPDATE live_entries AS e
           SET status = 'TURN', turn_at = ${now}::timestamptz, turn_expires_at = v.expires, turn_token_hash = v.hash, let_in_by = ${letInBy}::uuid${admission}
          FROM (VALUES ${values}) AS v(id, expires, hash)
         WHERE e.id = v.id AND e.drop_id = ${d.id} AND e.status = 'QUEUED'`.execute(tx);
    }
    const guaranteed = entries.map((e) => e.guarantee_id).filter((g): g is string => g !== null);
    if (guaranteed.length > 0) await useGuarantees(tx, guaranteed, d.id, now, SYSTEM_ACTOR, notes, 'turn');
  }

  /**
   * A console control on a published LIVE RELEASE, under its row lock (FOR UPDATE); returns its state after. Every
   * control may change whom the next batches reach (SET PACE, SHORTEN or END THE HOLD, ADD PIECES, a place formed: D9,
   * plan §1.3 "recomputed at once"): the next batch waits for a frame read after it (live-frames.ts `changed`), and one
   * is asked for at once.
   */
  private async control(dropId: string, fn: (tx: Db, d: LiveDrop, now: Date, changes: LiveChanges) => Promise<void>): Promise<LiveReleaseState> {
    const id = knownId(dropId, dropNotFound);
    return this.changing(id, (mark, changes) =>
      inTransaction(this.db, async (tx) => {
        const d = await this.lockLive(tx, id, 'update');
        mark();
        const now = this.clock();
        if (d.cancelled_at) throw liveCancelled();
        await fn(tx, d, now, changes);
        return this.releaseState(tx, id);
      }),
    );
  }

  /**
   * A console control on an entry of a published LIVE RELEASE: the release's row, then the entry's (FOR UPDATE). As
   * `control`, the next batch waits for a frame read after it (LET IN, REMOVE and FREE change the queue).
   */
  private async entryControl(dropId: string, entryId: string, fn: (tx: Db, d: LiveDrop, e: EntryRow, now: Date) => Promise<void>): Promise<AdminLiveEntry> {
    const id = knownId(dropId, dropNotFound);
    const eid = knownId(entryId, entryNotFound);
    return this.changing(id, (mark) =>
      inTransaction(this.db, async (tx) => {
        const d = await this.lockLive(tx, id, 'update');
        mark();
        const now = this.clock();
        if (d.cancelled_at) throw liveCancelled();
        const e = await tx.selectFrom('live_entries').select([...ENTRY_COLUMNS]).where('id', '=', eid).where('drop_id', '=', id).forUpdate().executeTakeFirst();
        if (!e) throw entryNotFound();
        await fn(tx, d, e, now);
        return this.adminEntry(tx, d, eid, now);
      }),
    );
  }

  /**
   * A transaction that may change whom the next batches reach (D9): `run` takes the release's row lock first, and from
   * then on the frame gate is shut (live-frames.ts `changed`, taken lazily by `mark`) until a frame begun after it is
   * published; settled once it has ended, a frame then asked for. `changes` marks another release the same way (a
   * guarantee carried at this one's end to a running release, bound there to a QUEUED entry: guarantees.ts).
   */
  private async changing<T>(id: string, run: (mark: () => void, changes: LiveChanges) => Promise<T>): Promise<T> {
    return withLiveChanges(this.frames, (changes) => run(() => changes.changed(id), changes));
  }

  private async releaseState(db: Db, id: string): Promise<LiveReleaseState> {
    const d = await db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const sizes = await db.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'piece']).where('drop_id', '=', id).orderBy('position').execute();
    return {
      id,
      roomOpensAt: roomOpensAt(d),
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      pausedAt: d.paused_at,
      pausedMs: Number(d.paused_ms_total),
      endedAt: d.ended_at,
      endedReason: d.ended_reason,
      quantity: d.quantity,
      quantityLine: d.quantity_line ?? '',
      sizes: sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock, ...(s.piece !== null ? { piece: s.piece } : {}) })),
      pace: await livePaceState(db, d),
    };
  }

  private async adminEntry(db: Db, d: LiveDrop, entryId: string, now: Date): Promise<AdminLiveEntry> {
    const r = await db
      .selectFrom('live_entries as e')
      .innerJoin('accounts as a', 'a.id', 'e.account_id')
      .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
      .select([
        'e.id', 'e.account_id', 'a.email', 'e.status', 'e.size_id', 's.label', 'e.quantity', 'e.tier', 'e.position', 'e.joined_at', 'e.turn_at',
        'e.turn_expires_at', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at', 'e.gesture_ms', 'e.let_in_by', 'e.guarantee_id',
        'e.admitted_at', 'e.admitted_batch',
      ])
      .where('e.id', '=', entryId)
      .executeTakeFirstOrThrow();
    const running = await db.selectFrom('drops').select(['paused_at', 'pace_paused_at', 'pace_next_at', 'pace_batch', 'pace_minutes', 'pace_hold_minutes']).where('id', '=', d.id).executeTakeFirstOrThrow();
    const beyond = r.status === 'QUEUED' && d.pace_batch !== null ? (await liveBeyond(db, d)).entries.has(r.id) : false;
    const queue = r.status === 'QUEUED' ? await liveQueueSnapshot(db, { ...d, ...running }, now) : null;
    const pieces = d.set_id !== null ? await livePieceSizes(db, [r.id]) : new Map<string, LivePieceSize[]>();
    return {
      id: r.id,
      accountId: r.account_id,
      email: r.email,
      status: r.status,
      size: { id: r.size_id, label: r.label },
      ...(pieces.has(r.id) ? { sizes: pieces.get(r.id)! } : {}),
      quantity: r.quantity,
      tier: r.tier,
      position: r.position,
      joinedAt: r.joined_at,
      turnAt: r.turn_at,
      turnExpiresAt: r.status === 'TURN' && r.turn_expires_at ? effectiveDeadline(r.turn_expires_at, running, now) : r.turn_expires_at,
      securedAt: r.secured_at,
      holdExpiresAt: r.status === 'SECURED' && r.hold_expires_at ? effectiveDeadline(r.hold_expires_at, running, now) : r.hold_expires_at,
      confirmedAt: r.confirmed_at,
      endedAt: r.ended_at,
      gestureMs: r.gesture_ms,
      letIn: r.let_in_by !== null,
      guaranteed: r.guarantee_id !== null,
      admittedAt: r.admitted_at,
      batch: r.admitted_batch,
      beyond,
      ...adminQueueFigures(queue, r.id),
    };
  }

  private async viewerEntry(db: Db, accountId: string, dropId: string): Promise<LiveEntryView | null> {
    return (await liveEntryViews(db, this.turnKey, { dropId, accountIds: [accountId] }, this.clock())).get(accountId) ?? null;
  }

  private async interestView(db: Db, accountId: string, dropId: string): Promise<LiveInterestView | null> {
    const r = await db
      .selectFrom('live_interest as i')
      .innerJoin('drop_sizes as s', 's.id', 'i.size_id')
      .select(['i.drop_id', 'i.size_id', 's.label', 'i.created_at'])
      .where('i.drop_id', '=', dropId)
      .where('i.account_id', '=', accountId)
      .executeTakeFirst();
    if (!r) return null;
    // Macro scope K44 T1: an interest in a set's release, its size per piece.
    const sizes = await liveInterestPieceSizes(db, dropId, accountId);
    return { dropId: r.drop_id, size: { id: r.size_id, label: r.label }, ...(sizes.length ? { sizes } : {}), since: r.created_at };
  }
}

/**
 * The pace of a release as the console reads it, null without one (an after-room): X and Y, the next batch, the pace's
 * own pause, the batches so far, the hold (as set, and its end while it lasts), the entries in the queue, the turns
 * given (all ways, by the batches, by LET IN), those beyond the pieces, and the close guard (D10). A few counts on the
 * release's entries.
 */
export async function livePaceState(
  db: Db,
  d: LivePaceRow & Pick<DropRow, 'id' | 'set_id' | 'pace_batches' | 'pace_extra_batches' | 'quantity' | 'closes_at' | 'ended_at'>,
  /** liveBeyond's answer when the caller has read it already. */
  known?: { entries: Set<string> },
): Promise<LivePaceState | null> {
  if (d.pace_batch === null || d.pace_minutes === null) return null;
  const [c, beyond] = await Promise.all([
    db
      .selectFrom('live_entries')
      .select([
        sql<number>`count(*) FILTER (WHERE status = 'QUEUED' AND admitted_at IS NULL)`.as('waiting'),
        sql<number>`count(admitted_at)`.as('admitted'),
        sql<number>`count(admitted_at) FILTER (WHERE let_in_by IS NOT NULL)`.as('let_in'),
        sql<number>`coalesce(sum(quantity) FILTER (WHERE status = 'CONFIRMED'), 0)`.as('confirmed'),
      ])
      .where('drop_id', '=', d.id)
      .executeTakeFirstOrThrow(),
    known ?? liveBeyond(db, d),
  ]);
  const nextAt = paceNextAt(d)!;
  const admitted = Number(c.admitted);
  const letIn = Number(c.let_in);
  return {
    batch: d.pace_batch,
    minutes: d.pace_minutes,
    nextAt,
    pausedAt: d.pace_paused_at,
    paused: d.pace_paused_at !== null,
    batches: Number(d.pace_batches),
    waiting: Number(c.waiting),
    admitted,
    turnsGiven: admitted - letIn,
    letIn,
    holdMinutes: Number(d.pace_hold_minutes ?? 0),
    holdEndsAt: holdEndsAt(d),
    beyond: beyond.entries.size,
    closeGuard: closeGuard({ batch: d.pace_batch, minutes: d.pace_minutes, nextAt, closesAt: d.closes_at, ended: d.ended_at !== null, notConfirmed: d.quantity - Number(c.confirmed) }),
  };
}

/**
 * Beyond the pieces (D11; console only): the QUEUED entries whose place in their size (1 + those before them there, in
 * the order of the turns) is past the pieces of that size not yet confirmed; a set's entry when it is so in any of its
 * sizes. By entry, and their count per size.
 */
export async function liveBeyond(db: Db, d: Pick<DropRow, 'id' | 'set_id'>): Promise<{ entries: Set<string>; bySize: Map<string, number> }> {
  const members =
    d.set_id === null
      ? sql`SELECT e.id AS entry_id, e.size_id, e.guarantee_id, e.position FROM live_entries e WHERE e.drop_id = ${d.id} AND e.status = 'QUEUED'`
      : sql`SELECT e.id AS entry_id, x.size_id, e.guarantee_id, e.position FROM live_entry_sizes x JOIN live_entries e ON e.id = x.entry_id WHERE e.drop_id = ${d.id} AND e.status = 'QUEUED'`;
  const confirmed =
    d.set_id === null
      ? sql`SELECT size_id, sum(quantity) AS n FROM live_entries WHERE drop_id = ${d.id} AND status = 'CONFIRMED' GROUP BY size_id`
      : sql`SELECT x.size_id, sum(e.quantity) AS n FROM live_entry_sizes x JOIN live_entries e ON e.id = x.entry_id WHERE e.drop_id = ${d.id} AND e.status = 'CONFIRMED' GROUP BY x.size_id`;
  const r = await sql<{ entry_id: string; size_id: string }>`
    SELECT q.entry_id, q.size_id
      FROM (SELECT m.entry_id, m.size_id, row_number() OVER (PARTITION BY m.size_id ORDER BY (m.guarantee_id IS NULL), m.position) AS place
              FROM (${members}) AS m) AS q
      JOIN drop_sizes s ON s.id = q.size_id
      LEFT JOIN (${confirmed}) AS c ON c.size_id = q.size_id
     WHERE q.place > s.stock - coalesce(c.n, 0)`.execute(db);
  const entries = new Set<string>();
  const bySize = new Map<string, number>();
  for (const x of r.rows) {
    entries.add(x.entry_id);
    bySize.set(x.size_id, (bySize.get(x.size_id) ?? 0) + 1);
  }
  return { entries, bySize };
}

/** Whether a release is announced at `now` (its announcement, or its publication). */
export function isAnnounced(d: Pick<DropRow, 'announce_at' | 'published_at'>, now: Date): boolean {
  const at = announcedAt(d);
  return at !== null && now.getTime() >= at.getTime();
}

const noop = (): void => {};
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

const maxDate = (a: Date, b: Date): Date => (new Date(a).getTime() >= new Date(b).getTime() ? new Date(a) : new Date(b));
