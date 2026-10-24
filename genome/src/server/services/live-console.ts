/**
 * The console of the LIVE RELEASES (plan of 2026-10-04, The console: Clients › Club › Drops; routes/admin/live.ts). The
 * release's rules and the live controls are services/live.ts's; what the public reads is live-room.ts's. Here:
 *
 *   create / edit   a LIVE RELEASE and every setting of it: its model, title and description; who may enter (a tier,
 *                   the owners of models or of a collection, the collectors who have taken part in a number of releases,
 *                   the members of a segment, and whether every rule is needed or any one: plan LIVE RELEASE+, choices 4
 *                   and 27); the surprise in every box (on or off, its description: internal, choice 3); the line's tier
 *                   priority; T0 (`opens_at`), the end of
 *                   the sales (`closes_at`), the room's opening, the pace and the hold (ONE QUEUE, D1: X people per
 *                   batch every Y minutes and a hold after the opening, 0 for none, both required; SET PACE in live.ts
 *                   changes the pace until the end, SHORTEN THE HOLD and END THE HOLD NOW the hold once announced), the
 *                   turn and pay windows, the pieces per person, the
 *                   price and its currency; the sizes and their stock, the quantity line (« 25 PIECES » by default, at
 *                   most 40 characters); the add-ons (at most 6); the catalogue add-ons it offers at its purchase
 *                   (`addonIds`, lot Q2 step Q2.3, D3: its pick, in its order, each active, its LIVE switch on and priced
 *                   in its currency, 409 ADDON_NOT_OFFERED naming it otherwise; at its creation, unless given, every such
 *                   add-on, N7; written to `drop_addons`); the staged reveals (announcement, silhouette, name,
 *                   photograph); the per-tier turn and pay windows. Everything changes until the announcement (a DRAFT,
 *                   or published and announced later); after it, 409 LIVE_ANNOUNCED: only the stock rises, with ADD
 *                   PIECES (live.ts addPieces). The silhouette's image is MediaService's (setLiveSilhouette).
 *   publish         with, optionally, a post of the owners' circle linking the release (the plan's choice 9): a NOTE for
 *                   the release's tier (TITANE at least), shown from the announcement, kept in step with the release's
 *                   times while it is not shown yet, withdrawn if the release is cancelled before it shows; added or
 *                   withdrawn after the publication until the announcement, as every setting (setCirclePost).
 *   after-room      optional (plan LIVE RELEASE+, choice 2; services/after-room.ts): a second door the release's sell-out
 *                   opens for those still in its line, set with the release's settings (`afterRoom`: its model, price,
 *                   sizes and stock, add-ons, its own pick of catalogue add-ons, `addonIds`, as the release's, delay and
 *                   length; null: none) and kept until the announcement as they are.
 *                   It is a child LIVE RELEASE written here, a DRAFT until the sell-out: its title the release's
 *                   « · THE AFTER-ROOM », its turn and pay windows, pieces per person and currency the release's (written
 *                   again with every save), its sizes linked to their SKUs; turned off, removed (nothing points to it before
 *                   the announcement). It is never listed on its own: the release's page shows it, and its own page
 *                   (`afterRoomOf`) has the live board and controls, never settings, a publication, a cancellation or a
 *                   board link of its own (409 LIVE_AFTER_ROOM).
 *   cancel          before the room opens (409 LIVE_ROOM_OPEN after: an ADMIN ends a release with END NOW); its after-room
 *                   with it.
 *   the live board  the counters (in the room, the line, the turns, the pieces secured and confirmed, the missed turns,
 *                   the holds that ended, per size and overall, the interest; on a paced release the pace's: in the
 *                   queue, admitted, the batches, the next batch, X every Y and its pause), the latest host message
 *                   and the line itself (its open entries by place, at most LIVE_CONSOLE_LINE_MAX), and from T0 until the release is
 *                   over its live alerts and live sell-out forecast (live-insights.ts, injected as `insights`): GET and
 *                   the console's stream (http/live-stream.ts) read the same `board`. The routes mask the emails for an
 *                   AUDITOR.
 *   entries         every entry of the release, by status, by place then arrival.
 *
 * Client Services follows each confirmed reservation through its orders (plan LIVE RELEASE+: the console's Orders
 * board, services/fulfilment.ts, replaces the LIVE plan's list and its CONCLUDED / CANCELLED resolution).
 *
 * The sizes of a release are linked to their SKUs (the release's model in each size, services/stock.ts) whenever they
 * or the model change.
 *
 * THE SET (macro scope K44 T1 and T4; plan MACRO M3 §5.2): a LIVE RELEASE sells a model or a set (`setId` in place of
 * `modelId`, exactly one, for good: a set's release may take another set, with its sizes, until its announcement). A
 * set's sizes are given per piece (each `piece` 1 to the set's pieces, 1 to 24 sizes each, each one of its piece's
 * model's sizes, every piece with at least one piece on sale), its quantity its sets on sale (the smallest of its
 * pieces' totals), « 25 SETS » by default; `perAccount` counts sets (T4: a set counts as one), 1 to LIVE_PER_ACCOUNT.max
 * as a model's pieces; it never has an after-room (409 AFTER_ROOM_SET) nor the house's guarantee. Its console views
 * carry `set` (its pieces) and the set itself in `model`; its sizes, entries and board read per piece.
 *
 * Audited (dotted lowercase, ids only, a description or a body as its length and SHA-256): `drop.live.create`,
 * `drop.live.update` (each setting before and after), `drop.live.publish`, `drop.live.cancel`, and the circle's own `circle.post.create`, `circle.post.update`, `circle.post.unpublish` for the
 * release's post.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { toHex } from '../../core/bytes.js';
import { inTransaction, type Db } from '../db/connection.js';
import type { AccessCombine, AdminRole, DropRow, LiveEndReason, LiveEntryStatus } from '../db/schema.js';
import { ACCESS_COMBINES, LIVE_ENTRY_STATUSES, SET_PIECES_MAX } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import type { LiveAlert, LiveSellOut, LiveSignals } from './live-insights.js';
import { cleanDescription, cleanTime, cleanTitle, DROP_QUANTITY_MAX, dropNotFound, newSealedSeed, offeredSet, PURCHASE_WINDOW_HOURS } from './drops.js';
import {
  announcedAt,
  effectiveDeadline,
  isAnnounced,
  liveAccessRule,
  adminQueueFigures,
  liveBeyond,
  liveBeyondRows,
  livePaceState,
  livePhase,
  livePieceSizes,
  liveRuleText,
  liveStages,
  onSaleOf,
  roomOpensAt,
  LIVE_ADDONS_MAX,
  LIVE_HOLD_MINUTES,
  LIVE_MIN_PARTICIPATIONS,
  LIVE_OPEN_STATUSES,
  LIVE_PACE_BATCH,
  LIVE_PACE_MINUTES,
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_SIZE_STOCK_MAX,
  LIVE_SURPRISE_MAX,
  LIVE_TURN_SECONDS,
  type AdminLiveEntry,
  type LiveAccessRule,
  type LivePieceSize,
  type LivePaceState,
  type LivePhase,
} from './live.js';
import { liveQueueSnapshot } from './live-queue.js';
import { coverOnPublish, guaranteedPieces, releaseCovered, releaseGuaranteed, type ReleaseGuaranteed } from './guarantees.js';
import { withLiveChanges, type LiveFrameGate } from './live-frames.js';
import { storyFingerprint } from './lookbook.js';
import { mediaUrl } from './media.js';
import { knownLocation, linkDropSizes } from './stock.js';
import { cleanQuestionWords, QuestionService, type AdminQuestion } from './question.js';
import { releaseFeasibility, type Feasibility, type FeasibilitySize } from './release-stock.js';
import { afterRoomModelId, setPieces, setPiecesOf, type ReleasePiece } from './release-offer.js';
import { checkPick, cleanPickIds, defaultPick, picksOf, writePick, type PickedAddon } from './addons.js';
import { cancelMovedAnnouncements, cancelReleaseEmails } from './email.js';
import { AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES, afterRoomTimes, afterRoomTitle, cancelAfterRoom, type AfterRoomSkip } from './after-room.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The currencies a release is priced in (the verification app writes each with its sign: € 4 800, £, $, CHF). */
export const LIVE_CURRENCIES = Object.freeze(['EUR', 'GBP', 'USD', 'CHF'] as const);
export type LiveCurrency = (typeof LIVE_CURRENCIES)[number];
/** A price, a piece's or an add-on's, in minor units: 0 to 1 000 000.00. */
export const LIVE_PRICE_MAX_MINOR = 100_000_000;
/** The sizes of a release: 1 to 24, each a label of 1 to 12 characters (migration 0021). */
export const LIVE_SIZES = Object.freeze({ min: 1, max: 24, label: 12 });
/** The quantity as the announcement says it: 1 to 40 characters; « <the sum of the stock> PIECES » by default. */
export const LIVE_QUANTITY_LINE_MAX = 40;
/** An add-on: a label of 40 characters, a line of 120. */
export const LIVE_ADDON_LIMITS = Object.freeze({ label: 40, line: 120 });
/** The models a release's rule may name. */
export const LIVE_ACCESS_MODELS_MAX = 20;
/** The open entries the live board carries, by place (the rest: the entries' list, page by page). */
export const LIVE_CONSOLE_LINE_MAX = 200;
/** The post of the circle a publication may write: its title (no figure: the display face sets it). */
export const LIVE_CIRCLE_TITLE = 'A LIVE RELEASE';

const MINUTE_MS = 60_000;
/** IN-01: fewer pieces than the house guarantees for the release (as drops.ts says it for a draw). */
const guaranteesExceed = (n: number) => conflict('DROP_GUARANTEES_EXCEED', `${n} ${n === 1 ? 'piece' : 'pieces'} of this release ${n === 1 ? 'is' : 'are'} guaranteed by the house.`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const PARIS = 'Europe/Paris';

/** The reference of an entry for ORBES Client Services: `LR-` and the first eight figures of its id (as /verify says it). */
export function liveReference(entryId: string): string {
  return `LR-${entryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** The quantity line a release says by default: « 25 PIECES »; a set's release (macro scope K44 T1), « 25 SETS ». */
export function defaultQuantityLine(quantity: number, set = false): string {
  return set ? `${quantity} ${quantity === 1 ? 'SET' : 'SETS'}` : `${quantity} ${quantity === 1 ? 'PIECE' : 'PIECES'}`;
}

/** A price in minor units, as a CSV holds it: `4800.00`. */
export function majorUnits(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

const SIGNS: Readonly<Record<string, string>> = Object.freeze({ EUR: '€', GBP: '£', USD: '$', CHF: 'CHF' });

/** A price as the house writes it (verify/live-model.ts formatMoney): `€ 4 800`, `€ 4 800.50`. */
export function liveMoney(minor: number, currency: string): string {
  const units = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = minor % 100;
  return `${SIGNS[currency] ?? currency} ${units}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

// ── Errors ─────────────────────────────────────────────────────────────────

const liveCancelled = () => conflict('DROP_CANCELLED', 'This release has been cancelled.');
/** Macro scope K44 (plan MACRO M3 §5.1): a set's release never has an after-room (the after-rooms stay a model's). */
const afterRoomSet = () => conflict('AFTER_ROOM_SET', 'A set’s release has no after-room.');
const liveAnnounced = () => conflict('LIVE_ANNOUNCED', 'This release is announced: its settings no longer change. Raise a size’s stock with ADD PIECES.');
const alreadyPublished = () => conflict('DROP_ALREADY_PUBLISHED', 'This release is already published.');
const notPublished = () => conflict('DROP_NOT_PUBLISHED', 'This release is not published: its post of the circle is chosen when it is published.');
const circlePosted = () => conflict('LIVE_CIRCLE_POSTED', 'This release’s post of the circle already waits for its announcement.');
const noCirclePost = () => conflict('LIVE_NO_CIRCLE_POST', 'This release has no post of the circle waiting for its announcement.');
const roomOpen = () => conflict('LIVE_ROOM_OPEN', 'The room of this release is open: an ADMIN ends it with END NOW.');
const roomPast = () => validationError('The room would already be open: set T0 later.');
// Macro scope K44 T1 (plan MACRO M3 §5.1): a set's LIVE RELEASE.
const oneOffer = () => validationError('A release sells a model or a set: give one of them.');
const setNotFound = () => notFound('Set', 'SET_NOT_FOUND');
const setOfferFixed = () => validationError('A set’s release sells its set: its pieces are the set’s.');
const modelOfferFixed = () => validationError('A model’s release sells its model: a set is sold by a release of its own.');
const setSizesGiven = () => validationError('Give the sizes of the new set’s pieces with it.');
const modelInactive = () => conflict('MODEL_INACTIVE', 'This model is no longer offered for new products.');
const entryNotFound = () => notFound('Entry', 'LIVE_ENTRY_NOT_FOUND');
const afterRoomModelInactive = () => conflict('MODEL_INACTIVE', 'The after-room’s model is no longer offered for new products: choose another in its settings.');
const afterRoomOwn = () => conflict('LIVE_AFTER_ROOM', 'This is the after-room of a release: it is set, published and cancelled with that release.');

function assertStaff(actor: Actor, what: string): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
  return actor.id.toLowerCase();
}

function knownId(id: unknown, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

// ── Input ──────────────────────────────────────────────────────────────────

export interface LiveSizeInput {
  /** A size of the release to keep (its id); none: a new size. */
  id?: string | null;
  label: string;
  stock: number;
  /** Macro scope K44 T1: on a set's release, the piece (1 to 4, the set's order) the size is of; never on a model's. */
  piece?: number | null;
}

export interface LiveAddonInput {
  id?: string | null;
  label: string;
  line?: string | null;
  priceMinor: number;
}

export interface LiveTierWindowInput {
  tier: number;
  /** null: the release's. */
  turnSeconds?: number | null;
  payMinutes?: number | null;
}

/** A release's pace: X people per batch (LIVE_PACE_BATCH), every Y minutes (LIVE_PACE_MINUTES). */
export interface LivePaceInput {
  batch: number;
  minutes: number;
}

/** Every setting of a LIVE RELEASE; those not given take their defaults (the plan's choices 15 and 16). */
export interface LiveSettingsInput {
  /** What it sells: a model, or (macro scope K44 T1) a set (`setId`): exactly one. */
  modelId?: string;
  setId?: string;
  title: string;
  description?: string | null;
  /** T0. */
  opensAt: Date;
  /** The end of the sales. */
  closesAt: Date;
  roomOpensMinutes?: number;
  /** The times part (D1, required at creation): X people per batch every Y minutes. */
  pace?: LivePaceInput | null;
  /** The hold after the opening, in minutes (LIVE_HOLD_MINUTES; 0: none), required at creation with the pace. */
  holdMinutes?: number;
  turnSeconds?: number;
  payMinutes?: number;
  perAccount?: number;
  priceMinor: number;
  currency?: string;
  /** 0 any ORBES account, 1 TITANE (owners), 2 PLATINE, 3 PALLADIUM. */
  minTier?: number;
  tierPriority?: boolean;
  accessModelIds?: string[];
  accessCollectionId?: string | null;
  /** The releases a collector has taken part in to enter, 1 to 100; null: no such rule. */
  minParticipations?: number | null;
  /** A segment whose members may enter; null: none. */
  accessSegmentId?: string | null;
  /** How the rules combine: AND (every one, the default) or OR (any one). */
  accessCombine?: AccessCombine;
  /** A surprise in every box (the release's page says so), its description internal (required while on). */
  surpriseEnabled?: boolean;
  surpriseText?: string | null;
  sizes: LiveSizeInput[];
  /** null or omitted at creation: « <the pieces> PIECES ». */
  quantityLine?: string | null;
  addons?: LiveAddonInput[];
  /**
   * Lot Q2, step Q2.3 (D3): the catalogue add-ons it offers at its purchase, in order (a list given replaces its pick);
   * omitted at its creation: every active add-on with its LIVE switch on and priced in its currency (N7).
   */
  addonIds?: string[];
  /** null: at the publication. */
  announceAt?: Date | null;
  /** null: at the announcement. */
  silhouetteAt?: Date | null;
  nameAt?: Date | null;
  photoAt?: Date | null;
  tierWindows?: LiveTierWindowInput[];
  /** The after-room (null or omitted at creation: none). */
  afterRoom?: AfterRoomInput | null;
  /** Where its orders hold or make their pieces (plan LIVE RELEASE+, choice 16); null: the default location. */
  stockLocationId?: string | null;
  /** The question after (choice 11): on by default; its words (both, or neither for the default question). */
  questionEnabled?: boolean;
  questionText?: string | null;
  questionAnswers?: string[] | null;
}

/** An after-room's own settings; the rest is the release's (services/after-room.ts). */
export interface AfterRoomInput {
  modelId: string;
  priceMinor: number;
  sizes: LiveSizeInput[];
  addons?: LiveAddonInput[];
  /** Its own pick of catalogue add-ons (Q2.3), as the release's: omitted when it is created, every such add-on (N7). */
  addonIds?: string[];
  /** After the sell-out: 1 to 60 minutes, 10 by default. */
  delayMinutes?: number;
  /** Open: 5 to 120 minutes, 15 by default. */
  lengthMinutes?: number;
}

/** A change of a LIVE RELEASE: any setting, until its announcement. A list given replaces the release's. */
export type LiveSettingsChange = Partial<LiveSettingsInput>;

interface Settings {
  /** A model's release: its model; a set's (macro scope K44 T1): null, and `setId` its set. */
  modelId: string | null;
  setId: string | null;
  title: string;
  description: string | null;
  opensAt: Date;
  closesAt: Date;
  roomOpensMinutes: number;
  pace: LivePaceInput;
  holdMinutes: number;
  turnSeconds: number;
  payMinutes: number;
  perAccount: number;
  priceMinor: number;
  currency: string;
  minTier: number;
  tierPriority: boolean;
  accessModelIds: string[];
  accessCollectionId: string | null;
  minParticipations: number | null;
  accessSegmentId: string | null;
  accessCombine: AccessCombine;
  surpriseEnabled: boolean;
  surpriseText: string | null;
  /** Each its piece on a set's release (macro scope K44 T1), null on a model's. */
  sizes: { id: string | null; label: string; stock: number; piece: number | null }[];
  quantityLine: string;
  addons: { id: string | null; label: string; line: string | null; priceMinor: number }[];
  /** Its pick of catalogue add-ons (Q2.3), each with its name once checked; null: the default of a new one (N7), until read. */
  addonPick: PickRow[] | null;
  announceAt: Date | null;
  silhouetteAt: Date | null;
  nameAt: Date | null;
  photoAt: Date | null;
  tierWindows: { tier: number; turnSeconds: number | null; payMinutes: number | null }[];
  afterRoom: AfterRoomSettings | null;
  stockLocationId: string | null;
  questionEnabled: boolean;
  questionText: string | null;
  questionAnswers: string[] | null;
}

/** An after-room's settings, cleaned. */
export interface AfterRoomSettings {
  modelId: string;
  priceMinor: number;
  sizes: { id: string | null; label: string; stock: number; piece: number | null }[];
  addons: { id: string | null; label: string; line: string | null; priceMinor: number }[];
  /** Its own pick (Q2.3), as the release's. */
  addonPick: PickRow[] | null;
  delayMinutes: number;
  lengthMinutes: number;
}

/** A catalogue add-on a release picks: its id, and its name (the audit log's), '' until checked. */
type PickRow = { id: string; name: string };
/** A pick as staff send it, its names read when it is checked. */
const pickOf = (v: unknown): PickRow[] => cleanPickIds(v).map((id) => ({ id, name: '' }));

/** What a LIVE RELEASE without its pace and hold is refused with (D1: both required at creation). */
const PACE_REQUIRED = 'A LIVE release needs a pace: people per batch, every how many minutes, and a hold after the opening (0 for none).';

/** A pace as the settings hold it: both figures within their bounds (D1: every LIVE release has one). */
function cleanPace(v: unknown): LivePaceInput {
  if (v === null || v === undefined || v === '' || typeof v !== 'object') throw validationError(PACE_REQUIRED);
  const p = v as Partial<LivePaceInput>;
  const message = `A pace gives ${LIVE_PACE_BATCH.min} to ${LIVE_PACE_BATCH.max} turns every ${LIVE_PACE_MINUTES.min} to ${LIVE_PACE_MINUTES.max} minutes.`;
  return { batch: wholeIn(p.batch, LIVE_PACE_BATCH.min, LIVE_PACE_BATCH.max, message), minutes: wholeIn(p.minutes, LIVE_PACE_MINUTES.min, LIVE_PACE_MINUTES.max, message) };
}

/** The hold after the opening as the settings hold it: 0 (none) to LIVE_HOLD_MINUTES.max minutes. */
function cleanHold(v: unknown): number {
  if (v === null || v === undefined || v === '') throw validationError(PACE_REQUIRED);
  return wholeIn(v, LIVE_HOLD_MINUTES.min, LIVE_HOLD_MINUTES.max, `A hold lasts ${LIVE_HOLD_MINUTES.min} to ${LIVE_HOLD_MINUTES.max} minutes after the opening (0 for none).`);
}

function wholeIn(v: unknown, min: number, max: number, message: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw validationError(message);
  return v;
}

function oneLine(v: unknown, max: number, what: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > max || CONTROL_CHARS.test(s)) throw validationError(`${what} is one line of 1 to ${max} characters.`);
  return s;
}

function optionalTime(v: unknown, label: string): Date | null {
  return v === null || v === undefined ? null : cleanTime(v, label);
}

const price = (v: unknown, what: string) => wholeIn(v, 0, LIVE_PRICE_MAX_MINOR, `${what} is 0 to ${majorUnits(LIVE_PRICE_MAX_MINOR)}, in cents.`);

/**
 * A release's sizes: 1 to 24, each a label once, 0 to 10 000 pieces, 1 to 10 000 in all. Macro scope K44 T1, `set`: each
 * names its piece (1 to SET_PIECES_MAX; the set's own count is checked with the set, `checkOffer`), and the rule holds
 * per piece (1 to 24 sizes, a label once, 1 to 10 000 pieces); a model's never names one.
 */
function cleanSizes(v: unknown, set = false): Settings['sizes'] {
  if (!set) {
    if (Array.isArray(v) && v.some((x) => (x as LiveSizeInput | null)?.piece !== undefined && (x as LiveSizeInput | null)?.piece !== null)) {
      throw validationError('A model’s release gives its sizes without a piece.');
    }
    return cleanSizeList(v, null);
  }
  if (!Array.isArray(v) || v.length < 1 || v.length > LIVE_SIZES.max * SET_PIECES_MAX) throw validationError(`Each piece of a set’s release has ${LIVE_SIZES.min} to ${LIVE_SIZES.max} sizes.`);
  const byPiece = new Map<number, unknown[]>();
  for (const x of v as unknown[]) {
    const piece = (x as LiveSizeInput | null)?.piece;
    if (typeof piece !== 'number' || !Number.isInteger(piece) || piece < 1 || piece > SET_PIECES_MAX) throw validationError(`Each size of a set’s release names its piece, 1 to ${SET_PIECES_MAX}.`);
    byPiece.set(piece, [...(byPiece.get(piece) ?? []), x]);
  }
  const out: Settings['sizes'] = [];
  const ids = new Set<string>();
  for (const piece of [...byPiece.keys()].sort((a, b) => a - b)) {
    for (const s of cleanSizeList(byPiece.get(piece), piece)) {
      if (s.id && ids.has(s.id)) throw validationError('A size is listed twice.');
      if (s.id) ids.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/** One list of sizes cleaned (a model's release, or one piece of a set's: `piece`). */
function cleanSizeList(v: unknown, piece: number | null): Settings['sizes'] {
  const what = piece === null ? 'A release has' : 'Each piece of a set’s release has';
  if (!Array.isArray(v) || v.length < LIVE_SIZES.min || v.length > LIVE_SIZES.max) throw validationError(`${what} ${LIVE_SIZES.min} to ${LIVE_SIZES.max} sizes.`);
  const seen = new Set<string>();
  const ids = new Set<string>();
  const out = v.map((s: LiveSizeInput) => {
    const label = oneLine(s?.label, LIVE_SIZES.label, 'A size');
    const stock = wholeIn(s?.stock, 0, LIVE_SIZE_STOCK_MAX, `A size holds 0 to ${LIVE_SIZE_STOCK_MAX} pieces.`);
    const key = label.toUpperCase();
    if (seen.has(key)) throw validationError(`The size ${label} is listed twice.`);
    seen.add(key);
    const id = s?.id === undefined || s?.id === null ? null : knownId(s.id, () => validationError('A size to keep is one of the release’s.'));
    if (id && ids.has(id)) throw validationError('A size is listed twice.');
    if (id) ids.add(id);
    return { id, label, stock, piece };
  });
  const total = out.reduce((n, s) => n + s.stock, 0);
  if (total < 1 || total > DROP_QUANTITY_MAX) {
    throw validationError(piece === null ? `A release offers 1 to ${DROP_QUANTITY_MAX} pieces in all.` : `Each piece of a set’s release offers 1 to ${DROP_QUANTITY_MAX} pieces in all.`);
  }
  return out;
}

function cleanAddons(v: unknown): Settings['addons'] {
  if (!Array.isArray(v) || v.length > LIVE_ADDONS_MAX) throw validationError(`A release offers at most ${LIVE_ADDONS_MAX} add-ons.`);
  const ids = new Set<string>();
  return v.map((a: LiveAddonInput) => {
    const id = a?.id === undefined || a?.id === null ? null : knownId(a.id, () => validationError('An add-on to keep is one of the release’s.'));
    if (id && ids.has(id)) throw validationError('An add-on is listed twice.');
    if (id) ids.add(id);
    const line = a?.line === undefined || a?.line === null || (typeof a.line === 'string' && a.line.trim() === '') ? null : oneLine(a.line, LIVE_ADDON_LIMITS.line, 'An add-on’s line');
    return { id, label: oneLine(a?.label, LIVE_ADDON_LIMITS.label, 'An add-on'), line, priceMinor: price(a?.priceMinor, 'An add-on’s price') };
  });
}

function cleanModels(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > LIVE_ACCESS_MODELS_MAX) throw validationError(`A release names at most ${LIVE_ACCESS_MODELS_MAX} models.`);
  const out = v.map((m) => knownId(m, () => notFound('Model', 'MODEL_NOT_FOUND')));
  return [...new Set(out)].sort();
}

function cleanWindows(v: unknown): Settings['tierWindows'] {
  if (!Array.isArray(v) || v.length > 4) throw validationError('A release sets at most one override per tier.');
  const tiers = new Set<number>();
  return v
    .map((w: LiveTierWindowInput) => {
      const tier = wholeIn(w?.tier, 0, 3, 'An override is for a tier: 0 (no tier) to 3 (PALLADIUM).');
      if (tiers.has(tier)) throw validationError('A tier has one override at most.');
      tiers.add(tier);
      const turnSeconds = w?.turnSeconds === undefined || w?.turnSeconds === null ? null : wholeIn(w.turnSeconds, LIVE_TURN_SECONDS.min, LIVE_TURN_SECONDS.max, `A turn lasts ${LIVE_TURN_SECONDS.min} to ${LIVE_TURN_SECONDS.max} seconds.`);
      const payMinutes = w?.payMinutes === undefined || w?.payMinutes === null ? null : wholeIn(w.payMinutes, LIVE_PAY_MINUTES.min, LIVE_PAY_MINUTES.max, `The time to pay is ${LIVE_PAY_MINUTES.min} to ${LIVE_PAY_MINUTES.max} minutes.`);
      if (turnSeconds === null && payMinutes === null) throw validationError('A tier’s override sets its turn, its time to pay, or both.');
      return { tier, turnSeconds, payMinutes };
    })
    .sort((a, b) => a.tier - b.tier);
}

/** The surprise's description: 1 to 500 characters (lines kept); '' and null: none. */
function cleanSurpriseText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The surprise’s description is text.');
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (t === '') return null;
  if (t.length > LIVE_SURPRISE_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(t)) throw validationError(`The surprise’s description has 1 to ${LIVE_SURPRISE_MAX} characters.`);
  return t;
}

function cleanQuantityLine(v: unknown, quantity: number, set = false): string {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return defaultQuantityLine(quantity, set);
  return oneLine(v, LIVE_QUANTITY_LINE_MAX, 'The quantity line');
}

/**
 * What a release sells as a change gives it (macro scope K44 T1): a new release, exactly one of `modelId` and `setId`
 * (400); a model's release keeps selling a model (its model may change), a set's a set (another set may be given).
 */
function offerOf(base: Settings | null, change: LiveSettingsChange): Pick<Settings, 'modelId' | 'setId'> {
  const model = change.modelId !== undefined ? knownId(change.modelId, () => notFound('Model', 'MODEL_NOT_FOUND')) : null;
  const set = change.setId !== undefined ? knownId(change.setId, setNotFound) : null;
  if (!base) {
    if ((model === null) === (set === null)) throw oneOffer();
    return { modelId: model, setId: set };
  }
  if (base.setId !== null) {
    if (change.modelId !== undefined) throw setOfferFixed();
    return { modelId: null, setId: set ?? base.setId };
  }
  if (change.setId !== undefined) throw modelOfferFixed();
  return { modelId: model ?? base.modelId, setId: null };
}

/**
 * An after-room's settings cleaned (null: none), as a release's own are: its model, its price, 1 to 24 sizes and their
 * stock, at most 6 add-ons; its delay and length within their bounds, those of `base` (or the defaults) when omitted.
 */
export function cleanAfterRoom(v: unknown, base: AfterRoomSettings | null): AfterRoomSettings | null {
  if (v === null) return null;
  if (typeof v !== 'object' || v === undefined) throw validationError('An after-room has its model, its price and its sizes.');
  const a = v as Partial<AfterRoomInput>;
  return {
    modelId: knownId(a.modelId, () => notFound('Model', 'MODEL_NOT_FOUND')),
    priceMinor: price(a.priceMinor, 'The after-room’s price'),
    sizes: cleanSizes(a.sizes, false),
    addons: a.addons === undefined ? (base?.addons ?? []) : cleanAddons(a.addons),
    addonPick: a.addonIds === undefined ? (base?.addonPick ?? null) : pickOf(a.addonIds),
    delayMinutes: wholeIn(
      a.delayMinutes ?? base?.delayMinutes ?? AFTER_ROOM_DELAY_MINUTES.default,
      AFTER_ROOM_DELAY_MINUTES.min,
      AFTER_ROOM_DELAY_MINUTES.max,
      `The after-room opens ${AFTER_ROOM_DELAY_MINUTES.min} to ${AFTER_ROOM_DELAY_MINUTES.max} minutes after the sell-out.`,
    ),
    lengthMinutes: wholeIn(
      a.lengthMinutes ?? base?.lengthMinutes ?? AFTER_ROOM_LENGTH_MINUTES.default,
      AFTER_ROOM_LENGTH_MINUTES.min,
      AFTER_ROOM_LENGTH_MINUTES.max,
      `The after-room is open ${AFTER_ROOM_LENGTH_MINUTES.min} to ${AFTER_ROOM_LENGTH_MINUTES.max} minutes.`,
    ),
  };
}

function cleanCombine(v: unknown): AccessCombine {
  if (!(ACCESS_COMBINES as readonly unknown[]).includes(v)) throw validationError('The rules combine with AND (every one) or OR (any one).');
  return v as AccessCombine;
}

/** The surprise a change gives: on with its description (400 without one), or off (its description kept for later). */
function cleanSurprise(change: LiveSettingsChange, base: Settings | null): Pick<Settings, 'surpriseEnabled' | 'surpriseText'> {
  const surpriseEnabled = change.surpriseEnabled !== undefined ? change.surpriseEnabled === true : (base?.surpriseEnabled ?? false);
  const surpriseText = change.surpriseText !== undefined ? cleanSurpriseText(change.surpriseText) : (base?.surpriseText ?? null);
  if (surpriseEnabled && !surpriseText) throw validationError('A surprise in every box needs its description: what goes in the box (internal).');
  return { surpriseEnabled, surpriseText };
}

/** The question after a change gives: on or off (on by default), its words (both or neither: the default question), kept when it is turned off. */
function cleanQuestion(change: LiveSettingsChange, base: Settings | null): Pick<Settings, 'questionEnabled' | 'questionText' | 'questionAnswers'> {
  const questionEnabled = change.questionEnabled !== undefined ? change.questionEnabled === true : (base?.questionEnabled ?? true);
  if (change.questionText === undefined && change.questionAnswers === undefined) {
    return { questionEnabled, questionText: base?.questionText ?? null, questionAnswers: base?.questionAnswers ?? null };
  }
  const words = cleanQuestionWords(
    change.questionText !== undefined ? change.questionText : (base?.questionText ?? null),
    change.questionAnswers !== undefined ? change.questionAnswers : (base?.questionAnswers ?? null),
  );
  return { questionEnabled, questionText: words.text, questionAnswers: words.answers };
}

/** The settings a change gives, over the release's (or the defaults of a new one), each cleaned. */
function settingsOf(base: Settings | null, change: LiveSettingsChange): Settings {
  const pick = <K extends keyof LiveSettingsInput>(k: K): LiveSettingsInput[K] | undefined => (change[k] !== undefined ? change[k] : undefined);
  const offer = offerOf(base, change);
  const isSet = offer.setId !== null;
  // A set's release given another set takes the new set's sizes with it.
  if (base?.setId && offer.setId !== base.setId && change.sizes === undefined) throw setSizesGiven();
  const sizes = pick('sizes') !== undefined ? cleanSizes(change.sizes, isSet) : base ? base.sizes : cleanSizes(undefined, isSet);
  const quantity = onSaleOf(sizes);
  // A quantity line left at its default follows the stock (a set's, its sets).
  const followsStock = base !== null && base.quantityLine === defaultQuantityLine(onSaleOf(base.sizes), base.setId !== null);
  const quantityLine =
    change.quantityLine !== undefined ? cleanQuantityLine(change.quantityLine, quantity, isSet) : base && !followsStock ? base.quantityLine : defaultQuantityLine(quantity, isSet);
  const currency = change.currency !== undefined ? change.currency : (base?.currency ?? 'EUR');
  if (!(LIVE_CURRENCIES as readonly string[]).includes(currency as string)) throw validationError(`A release is priced in ${LIVE_CURRENCIES.join(', ')}.`);
  return {
    ...offer,
    title: change.title !== undefined || !base ? cleanTitle(change.title) : base.title,
    description: change.description !== undefined ? cleanDescription(change.description) : (base?.description ?? null),
    opensAt: change.opensAt !== undefined || !base ? cleanTime(change.opensAt, 'T0') : base.opensAt,
    closesAt: change.closesAt !== undefined || !base ? cleanTime(change.closesAt, 'The end') : base.closesAt,
    roomOpensMinutes: wholeIn(change.roomOpensMinutes ?? base?.roomOpensMinutes ?? LIVE_ROOM_OPENS_MINUTES.default, LIVE_ROOM_OPENS_MINUTES.min, LIVE_ROOM_OPENS_MINUTES.max, `The room opens ${LIVE_ROOM_OPENS_MINUTES.min} to ${LIVE_ROOM_OPENS_MINUTES.max} minutes before T0.`),
    pace: change.pace !== undefined || !base ? cleanPace(change.pace) : base.pace,
    holdMinutes: change.holdMinutes !== undefined || !base ? cleanHold(change.holdMinutes) : base.holdMinutes,
    turnSeconds: wholeIn(change.turnSeconds ?? base?.turnSeconds ?? LIVE_TURN_SECONDS.default, LIVE_TURN_SECONDS.min, LIVE_TURN_SECONDS.max, `A turn lasts ${LIVE_TURN_SECONDS.min} to ${LIVE_TURN_SECONDS.max} seconds.`),
    payMinutes: wholeIn(change.payMinutes ?? base?.payMinutes ?? LIVE_PAY_MINUTES.default, LIVE_PAY_MINUTES.min, LIVE_PAY_MINUTES.max, `The time to pay is ${LIVE_PAY_MINUTES.min} to ${LIVE_PAY_MINUTES.max} minutes.`),
    perAccount: wholeIn(change.perAccount ?? base?.perAccount ?? LIVE_PER_ACCOUNT.default, LIVE_PER_ACCOUNT.min, LIVE_PER_ACCOUNT.max, `A person secures ${LIVE_PER_ACCOUNT.min} to ${LIVE_PER_ACCOUNT.max} ${isSet ? 'sets' : 'pieces'}.`),
    priceMinor: price(change.priceMinor !== undefined ? change.priceMinor : base?.priceMinor, 'The price'),
    currency: currency as string,
    minTier: wholeIn(change.minTier ?? base?.minTier ?? 0, 0, 3, 'The tier is 0 (every ORBES account) to 3 (PALLADIUM).'),
    tierPriority: change.tierPriority !== undefined ? change.tierPriority === true : (base?.tierPriority ?? true),
    accessModelIds: change.accessModelIds !== undefined ? cleanModels(change.accessModelIds) : (base?.accessModelIds ?? []),
    accessCollectionId:
      change.accessCollectionId !== undefined
        ? change.accessCollectionId === null || change.accessCollectionId === ''
          ? null
          : knownId(change.accessCollectionId, () => notFound('Collection', 'COLLECTION_NOT_FOUND'))
        : (base?.accessCollectionId ?? null),
    minParticipations:
      change.minParticipations !== undefined
        ? change.minParticipations === null
          ? null
          : wholeIn(change.minParticipations, LIVE_MIN_PARTICIPATIONS.min, LIVE_MIN_PARTICIPATIONS.max, `A release counts ${LIVE_MIN_PARTICIPATIONS.min} to ${LIVE_MIN_PARTICIPATIONS.max} releases taken part in.`)
        : (base?.minParticipations ?? null),
    accessSegmentId:
      change.accessSegmentId !== undefined
        ? change.accessSegmentId === null || change.accessSegmentId === ''
          ? null
          : knownId(change.accessSegmentId, () => notFound('Segment', 'SEGMENT_NOT_FOUND'))
        : (base?.accessSegmentId ?? null),
    accessCombine: cleanCombine(change.accessCombine !== undefined ? change.accessCombine : (base?.accessCombine ?? 'AND')),
    ...cleanSurprise(change, base),
    sizes,
    quantityLine,
    addons: change.addons !== undefined ? cleanAddons(change.addons) : (base?.addons ?? []),
    addonPick: change.addonIds !== undefined ? pickOf(change.addonIds) : (base?.addonPick ?? null),
    announceAt: change.announceAt !== undefined ? optionalTime(change.announceAt, 'The announcement') : (base?.announceAt ?? null),
    silhouetteAt: change.silhouetteAt !== undefined ? optionalTime(change.silhouetteAt, 'The silhouette') : (base?.silhouetteAt ?? null),
    nameAt: change.nameAt !== undefined ? optionalTime(change.nameAt, 'The name') : (base?.nameAt ?? null),
    photoAt: change.photoAt !== undefined ? optionalTime(change.photoAt, 'The photograph') : (base?.photoAt ?? null),
    tierWindows: change.tierWindows !== undefined ? cleanWindows(change.tierWindows) : (base?.tierWindows ?? []),
    afterRoom: change.afterRoom !== undefined ? cleanAfterRoom(change.afterRoom, base?.afterRoom ?? null) : (base?.afterRoom ?? null),
    stockLocationId:
      change.stockLocationId !== undefined
        ? change.stockLocationId === null || change.stockLocationId === ''
          ? null
          : knownId(change.stockLocationId, () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND'))
        : (base?.stockLocationId ?? null),
    ...cleanQuestion(change, base),
  };
}

/**
 * The times of a release that is not announced yet, at `now`: the end after T0, the room's opening still ahead, the
 * announcement ahead (none: at the publication, now; once published, one is kept) and before the room, each stage after the one it
 * follows and before the room, a NULL one read as the announcement (as `drops_live_stages` reads it: a stage set after
 * an empty one is refused, the empty one being earlier).
 */
function checkTimes(s: Settings, now: Date, publishedAt: Date | null): void {
  if (!(s.closesAt.getTime() > s.opensAt.getTime())) throw validationError('The release ends after T0.');
  // The hold ends before the close: the first batch comes while the release still sells.
  if (!(s.opensAt.getTime() + s.holdMinutes * MINUTE_MS < s.closesAt.getTime())) throw validationError('The hold after the opening ends before the end of the sales.');
  const room = s.opensAt.getTime() - s.roomOpensMinutes * MINUTE_MS;
  if (room <= now.getTime()) throw roomPast();
  if (s.announceAt && s.announceAt.getTime() <= now.getTime()) throw validationError('The announcement comes later than now; leave it empty to announce the release when it is published.');
  if (s.announceAt && s.announceAt.getTime() > room) throw validationError('The announcement comes before the room opens.');
  // Emptied once published, the announcement would be the publication, already past: the release announced at once.
  if (!s.announceAt && publishedAt) throw validationError('A published release keeps an announcement time; set one later than now.');
  // A stage left empty is at the announcement, as the database reads it (drops_live_stages): never before the one it follows.
  const base = (s.announceAt ?? now).getTime();
  let after = base;
  for (const [label, at] of [['The silhouette', s.silhouetteAt], ['The name', s.nameAt], ['The photograph', s.photoAt]] as const) {
    const t = at ? at.getTime() : base;
    if (t < after) throw validationError(`${label} is revealed after the announcement and the stages before it (a stage left empty: at the announcement).`);
    if (t > room) throw validationError(`${label} is revealed before the room opens.`);
    after = t;
  }
}

/** The settings as the audit log records them: the description as its length and SHA-256, times in ISO 8601. */
function auditSettings(s: Settings): Record<string, unknown> {
  const t = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    modelId: s.modelId,
    ...(s.setId !== null ? { setId: s.setId } : {}),
    title: s.title,
    description: storyFingerprint(s.description),
    opensAt: t(s.opensAt),
    closesAt: t(s.closesAt),
    roomOpensMinutes: s.roomOpensMinutes,
    pace: { batch: s.pace.batch, minutes: s.pace.minutes },
    holdMinutes: s.holdMinutes,
    turnSeconds: s.turnSeconds,
    payMinutes: s.payMinutes,
    perAccount: s.perAccount,
    priceMinor: s.priceMinor,
    currency: s.currency,
    minTier: s.minTier,
    tierPriority: s.tierPriority,
    accessModelIds: s.accessModelIds,
    accessCollectionId: s.accessCollectionId,
    minParticipations: s.minParticipations,
    accessSegmentId: s.accessSegmentId,
    accessCombine: s.accessCombine,
    surpriseEnabled: s.surpriseEnabled,
    surprise: storyFingerprint(s.surpriseText),
    // A set's size names its piece first (« 2:52:10 »).
    sizes: s.sizes.map((x) => (x.piece !== null ? `${x.piece}:${x.label}:${x.stock}` : `${x.label}:${x.stock}`)),
    quantityLine: s.quantityLine,
    addons: s.addons.map((a) => ({ label: a.label, line: a.line, priceMinor: a.priceMinor })),
    // Q2.3: the catalogue add-ons picked, by id and name.
    addonIds: (s.addonPick ?? []).map((a) => ({ id: a.id, name: a.name })),
    announceAt: t(s.announceAt),
    silhouetteAt: t(s.silhouetteAt),
    nameAt: t(s.nameAt),
    photoAt: t(s.photoAt),
    tierWindows: s.tierWindows,
    afterRoom: s.afterRoom
      ? {
          modelId: s.afterRoom.modelId,
          priceMinor: s.afterRoom.priceMinor,
          sizes: s.afterRoom.sizes.map((x) => `${x.label}:${x.stock}`),
          addons: s.afterRoom.addons.map((a) => ({ label: a.label, line: a.line, priceMinor: a.priceMinor })),
          addonIds: (s.afterRoom.addonPick ?? []).map((a) => ({ id: a.id, name: a.name })),
          delayMinutes: s.afterRoom.delayMinutes,
          lengthMinutes: s.afterRoom.lengthMinutes,
        }
      : null,
    stockLocationId: s.stockLocationId,
    questionEnabled: s.questionEnabled,
    question: s.questionText ? { text: s.questionText, answers: s.questionAnswers } : null,
  };
}

/** The rule of a release as its settings say it, every model and collection by its name (the console's own words). */
function consoleRule(s: Settings, models: { id: string; name: string }[], collection: { id: string; name: string } | null): LiveAccessRule {
  return {
    minTier: Math.min(3, Math.max(0, s.minTier)) as 0 | 1 | 2 | 3,
    models,
    collection,
    minParticipations: s.minParticipations,
    segment: s.accessSegmentId !== null,
    combine: s.accessCombine,
  };
}

// ── Views ──────────────────────────────────────────────────────────────────

/** A LIVE RELEASE in the console's list. */
export interface AdminLiveCard {
  id: string;
  title: string;
  /** Its model; a set's release (macro scope K44 T1): the set itself (its id and name, type SET, whether it is offered). */
  model: { id: string; name: string; type: string; active: boolean };
  /** Macro scope K44 T1: a set's release, its set and its pieces in order (each its model); absent on a model's. */
  set?: AdminLiveSet;
  phase: LivePhase;
  /** Ended, no turn or hold left. */
  over: boolean;
  announcedAt: Date | null;
  roomOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
  quantity: number;
  quantityLine: string;
  priceMinor: number;
  currency: string;
  endedReason: LiveEndReason | null;
  /** The entries by status. */
  entries: Record<LiveEntryStatus, number>;
  interest: number;
}

/** A set's LIVE RELEASE's set in the console (macro scope K44 T1). */
export interface AdminLiveSet {
  id: string;
  name: string;
  code: string;
  active: boolean;
  pieces: { piece: number; model: { id: string; name: string; variant: string | null; type: string; active: boolean } }[];
}

/** A LIVE RELEASE as the console reads and edits it: every setting, never its sealed seed. */
export interface AdminLiveRelease extends AdminLiveCard {
  description: string | null;
  /** Its settings still change (not announced, not cancelled). */
  editable: boolean;
  roomOpensMinutes: number;
  /**
   * D1: X people per batch every Y minutes; null on an after-room (no pace). The board's `pace` has its state. A release
   * ended or cancelled before ONE QUEUE may have none.
   */
  pace: LivePaceInput | null;
  /** The hold after the opening, in minutes (0: none; an after-room: 0). */
  holdMinutes: number;
  turnSeconds: number;
  payMinutes: number;
  perAccount: number;
  minTier: number;
  tierPriority: boolean;
  /**
   * Who may enter: the models and collection named, the releases taken part in (null: no such rule), the segment (its
   * name: the console's only), how the rules combine, and every rule as the public reads it (`text`).
   */
  access: {
    models: { id: string; name: string }[];
    collection: { id: string; name: string } | null;
    minParticipations: number | null;
    segment: { id: string; name: string } | null;
    combine: AccessCombine;
    text: string;
  };
  /** A surprise in every box: on or off, and its description (internal: packing slips and work sheets). */
  surprise: { enabled: boolean; text: string | null };
  /**
   * Where its orders hold or make their pieces: the location set (`locationId`, null: none, the default one) and the one
   * it means now (an after-room's: its release's).
   */
  locationId: string | null;
  /** Null only before the stock's first setup (no location yet). */
  location: { id: string; name: string } | null;
  /** The question after (plan LIVE RELEASE+, choice 11), its answers counted; null for an after-room, which asks none. */
  question: AdminQuestion | null;
  /** Its sizes in order; on a set's release, each with its piece (1 to 4). */
  sizes: { id: string; label: string; stock: number; piece?: number }[];
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
  /** Lot Q2, step Q2.3 (D3): the catalogue add-ons it offers at its purchase, in its order, priced in its currency now. */
  addonPick: PickedAddon[];
  tierWindows: { tier: number; turnSeconds: number | null; payMinutes: number | null }[];
  /** As set (null: at the publication; a NULL stage: at the announcement). */
  announceAt: Date | null;
  silhouetteAt: Date | null;
  nameAt: Date | null;
  photoAt: Date | null;
  /** Once published: when each stage is revealed. */
  stages: { silhouetteAt: Date; nameAt: Date; photoAt: Date } | null;
  silhouette: { sha256: string; url: string } | null;
  /** The boutique board's link: when it was issued (its secret is shown once, when issued). */
  boardLink: { issuedAt: Date } | null;
  /** The posts of the circle linking the release: shown from `publishedAt` (null: withdrawn). */
  circlePosts: { id: string; publishedAt: Date | null }[];
  publishedAt: Date | null;
  cancelledAt: Date | null;
  pausedAt: Date | null;
  pausedMs: number;
  endedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
  /** SHA-256 of the sealed seed that orders the line within a tier (never revealed for a LIVE RELEASE). */
  seedHash: string;
  /** Its after-room, set or opened; null without one (and for an after-room). */
  afterRoom: AdminAfterRoom | null;
  /** IN-01: the house's guarantees set aside for the release or used in it: how many places, how many pieces. */
  guaranteed: ReleaseGuaranteed;
  /** An after-room's own page: the release it follows; null for a release. */
  afterRoomOf: { id: string; title: string } | null;
}

/**
 * Where an after-room stands: WAITING for the release's sell-out (a DRAFT), OPENS (the sell-out passed, its T0 ahead),
 * OPEN, OVER (ended, no turn or hold left), NOT_OPENED (cancelled: `skipped` says why).
 */
export type AfterRoomState = 'WAITING' | 'OPENS' | 'OPEN' | 'OVER' | 'NOT_OPENED';

/** A release's after-room in the console: its settings, and once opened its times, guests and entries. */
export interface AdminAfterRoom {
  id: string;
  model: { id: string; name: string; type: string; active: boolean };
  priceMinor: number;
  currency: string;
  sizes: { id: string; label: string; stock: number }[];
  quantity: number;
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
  /** Its own pick of catalogue add-ons (Q2.3), in its order, priced in its currency now. */
  addonPick: PickedAddon[];
  delayMinutes: number;
  lengthMinutes: number;
  state: AfterRoomState;
  phase: LivePhase;
  /** Once the sell-out opened it: its T0 (the door appears) and its close. */
  opensAt: Date | null;
  closesAt: Date | null;
  endedReason: LiveEndReason | null;
  /** Why it never opened (NOT_OPENED), else null. */
  skipped: AfterRoomSkip | null;
  /** The entries remembered at the sell-out. */
  guests: number;
  entries: Record<LiveEntryStatus, number>;
}

/** A size on the live board: its pieces, and its people by where they stand. */
export interface AdminLiveBoardSize {
  id: string;
  label: string;
  /** Macro scope K44 T1: on a set's release, its piece (1 to 4; an entry counts in each of its sizes); absent on a model's. */
  piece?: number;
  stock: number;
  /** Pieces free now. */
  left: number;
  /** Pieces in a turn or held, which may return. */
  held: number;
  /** Pieces confirmed. */
  sold: number;
  waiting: number;
  line: number;
  turns: number;
  secured: number;
  confirmed: number;
  missed: number;
  /** Holds that ran out or were freed. */
  expired: number;
  interest: number;
  /** ONE QUEUE (D11): in the queue past the pieces of the size not yet confirmed (0 without a pace). */
  beyond: number;
}

/** The live board (GET /api/admin/live/:id/board and the console's stream): the counters and the line. */
export interface AdminLiveBoard {
  id: string;
  phase: LivePhase;
  paused: boolean;
  pausedAt: Date | null;
  over: boolean;
  endedAt: Date | null;
  endedReason: LiveEndReason | null;
  roomOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
  /** Its pieces on sale; a set's release (macro scope K44 T1): its sets on sale, the smallest of its pieces' totals. */
  quantity: number;
  quantityLine: string;
  /**
   * The sizes summed, and the people who are out of the release: places given back, left, removed, ended by its end. A
   * set's release (macro scope K44 T1): in sets, its people counted once (its first piece's sizes), its stock its sets on
   * sale, `left` the sets its pieces can still make (each piece's free pieces, the smallest).
   */
  totals: Omit<AdminLiveBoardSize, 'id' | 'label' | 'piece'> & { inRoom: number; released: number; departed: number; removed: number; ended: number };
  sizes: AdminLiveBoardSize[];
  /** Macro scope K44 T1: a set's release, each piece (its model) and its pieces on sale in all; absent on a model's. */
  pieces?: { piece: number; name: string; variant: string | null; stock: number }[];
  message: { text: string; at: Date } | null;
  /** The open entries (in their turn, holding, in the line, in the room), by place then arrival: the first LIVE_CONSOLE_LINE_MAX. */
  line: AdminLiveEntry[];
  /** Every open entry. */
  lineTotal: number;
  /** The live alerts (services/live-insights.ts liveAlerts), from T0 on. */
  alerts: LiveAlert[];
  /** The live sell-out forecast, from T0 until the end; null otherwise. */
  sellOut: LiveSellOut | null;
  /**
   * W4: the pace's figures, null without a pace: X every Y, the next batch, its own pause, the batches so far, those in
   * the queue (waiting for their batch) and those admitted; the line's entries carry their batch (`admittedAt`, `batch`).
   */
  pace: LivePaceState | null;
}

const EMPTY_COUNTS = (): Record<LiveEntryStatus, number> => Object.fromEntries(LIVE_ENTRY_STATUSES.map((s) => [s, 0])) as Record<LiveEntryStatus, number>;

/** A release with its model's (null on a set's release: macro scope K44 T1) and its set's (null on a model's). */
type ReadRow = DropRow & {
  model_name: string | null;
  model_type: string | null;
  model_active: boolean | null;
  set_name: string | null;
  set_code: string | null;
  set_active: boolean | null;
};

/** A set's release's set (`setId`, its words read with the release `r`) and its pieces (release-offer.ts), for its console views. */
const adminSetOf = (setId: string, r: ReadRow, pieces: readonly ReleasePiece[]): AdminLiveSet => ({
  id: setId,
  name: r.set_name ?? '',
  code: r.set_code ?? '',
  active: r.set_active === true,
  pieces: pieces.map((p) => ({ piece: p.piece!, model: { id: p.model.id, name: p.model.name, variant: p.model.variant, type: p.model.type, active: p.model.active } })),
});

// ── Service ────────────────────────────────────────────────────────────────

export interface LiveConsoleServiceDeps {
  db: Db;
  audit: AuditService;
  /** The key sealing the drops' seeds (drops.ts deriveDropSeedKey). */
  seedKey: Uint8Array;
  /** PUBLIC_ORIGIN: the boutique board's link. */
  publicOrigin: string;
  /** The live board's alerts and sell-out forecast (LiveInsightsService.signals); without it, none. */
  insights?: { signals(d: DropRow, now: Date): Promise<LiveSignals> };
  /** The question after's answers (services/question.ts); one of its own when none is given. */
  questions?: QuestionService;
  clock?: Clock;
  /**
   * The LIVE releases' frame gate (live-frames.ts; LiveService's): a guarantee this release's end carries to a running
   * LIVE release, bound there to a QUEUED entry, changes whom its next batches reach (D9). Without it, none is told.
   */
  liveFrames?: LiveFrameGate;
}

export class LiveConsoleService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly seedKey: Uint8Array;
  private readonly origin: string;
  private readonly insights: LiveConsoleServiceDeps['insights'];
  private readonly questions: QuestionService;
  private readonly clock: Clock;
  private readonly liveFrames: LiveFrameGate | null;

  constructor(deps: LiveConsoleServiceDeps) {
    if (!(deps.seedKey instanceof Uint8Array) || deps.seedKey.length !== 32) throw new RangeError('seedKey must be 32 bytes');
    this.db = deps.db;
    this.audit = deps.audit;
    this.seedKey = deps.seedKey;
    this.origin = deps.publicOrigin;
    this.insights = deps.insights;
    this.clock = deps.clock ?? systemClock;
    this.questions = deps.questions ?? new QuestionService({ db: deps.db, audit: deps.audit, clock: this.clock });
    this.liveFrames = deps.liveFrames ?? null;
  }

  /** The boutique board's address for a link's secret: the secret in the fragment, never sent to a server. */
  boardUrl(dropId: string, token: string): string {
    return `${this.origin}/verify/releases/${dropId}/board#${token}`;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Every LIVE RELEASE, the latest created first (an after-room is on its release's page, not listed on its own). */
  async list(page: PageRequest): Promise<Page<AdminLiveCard>> {
    const total = await this.db.selectFrom('drops').select((eb) => eb.fn.countAll<number>().as('n')).where('mode', '=', 'LIVE').where('parent_drop_id', 'is', null).executeTakeFirstOrThrow();
    const rows = await this.reads(this.db).where('d.mode', '=', 'LIVE').where('d.parent_drop_id', 'is', null).orderBy('d.created_at', 'desc').orderBy('d.id').limit(page.pageSize).offset(pageOffset(page)).execute();
    const now = this.clock();
    const [counts, interest, open] = await Promise.all([this.counts(this.db, rows.map((r) => r.id)), this.interest(this.db, rows.map((r) => r.id)), this.openHolds(this.db, rows.map((r) => r.id))]);
    // A set's release names its set and pieces: every set of the page in one read.
    const pieces = await setPiecesOf(this.db, rows.flatMap((r) => (r.set_id === null ? [] : [r.set_id])));
    const sets = new Map<string, AdminLiveSet>();
    for (const r of rows) if (r.set_id !== null) sets.set(r.id, adminSetOf(r.set_id, r, pieces.get(r.set_id) ?? []));
    return makePage(
      rows.map((r) => ({ ...this.card(r, now, counts.get(r.id), interest.get(r.id) ?? 0, open.has(r.id)), ...(sets.has(r.id) ? { set: sets.get(r.id)! } : {}) })),
      Number(total.n),
      page,
    );
  }

  /** One LIVE RELEASE (404 DROP_NOT_FOUND for anything else). */
  get(dropId: string): Promise<AdminLiveRelease> {
    return this.release(this.db, knownId(dropId, dropNotFound));
  }

  /**
   * The feasibility check (plan LIVE RELEASE+, choice 12, K5; services/release-stock.ts): per size, the pieces on sale
   * against the stock available at the release's location, its after-room's sizes after its own; the orders the stock
   * does not cover wait for supplier stock (plan NEXT LOT §3.5). A warning, never a refusal: the console
   * shows it before PUBLISH, and the publication records it. Read before the publication (a release published already
   * holds pieces for its own orders).
   */
  async feasibility(dropId: string): Promise<Feasibility> {
    const d = await this.liveRow(this.db, knownId(dropId, dropNotFound));
    if (d.parent_drop_id) throw afterRoomOwn();
    return this.checkFeasibility(this.db, d);
  }

  /**
   * The live board: the counters overall and per size, the latest host message and the open entries by place. Null
   * when the id is no LIVE RELEASE (the console's stream then ends). Emails as stored: the routes mask them.
   */
  async board(dropId: string): Promise<AdminLiveBoard | null> {
    if (typeof dropId !== 'string' || !UUID_RE.test(dropId)) return null;
    const id = dropId.toLowerCase();
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').executeTakeFirst();
    if (!d) return null;
    const now = this.clock();
    const isSet = d.set_id !== null;
    const [sizes, counts, interest, message, bySize, interestBySize, setOf] = await Promise.all([
      this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'piece']).where('drop_id', '=', id).orderBy('position').execute(),
      this.db
        .selectFrom('live_entries')
        .select((eb) => ['size_id', 'status', eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('quantity').as('q')])
        .where('drop_id', '=', id)
        .groupBy(['size_id', 'status'])
        .execute(),
      this.db.selectFrom('live_interest').select((eb) => ['size_id', eb.fn.countAll<number>().as('n')]).where('drop_id', '=', id).groupBy('size_id').execute(),
      this.db.selectFrom('live_messages').select(['text', 'created_at']).where('drop_id', '=', id).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst(),
      // Macro scope K44 T1: a set's entry and interest count in each of their sizes.
      isSet
        ? this.db
            .selectFrom('live_entry_sizes as x')
            .innerJoin('live_entries as e', 'e.id', 'x.entry_id')
            .select((eb) => ['x.size_id', 'e.status', eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('e.quantity').as('q')])
            .where('e.drop_id', '=', id)
            .groupBy(['x.size_id', 'e.status'])
            .execute()
        : Promise.resolve(null),
      isSet ? this.db.selectFrom('live_interest_sizes').select((eb) => ['size_id', eb.fn.countAll<number>().as('n')]).where('drop_id', '=', id).groupBy('size_id').execute() : Promise.resolve(null),
      isSet ? setPieces(this.db, d.set_id!) : Promise.resolve(null),
    ]);
    const perSize = bySize ?? counts;
    // ONE QUEUE (D11): those in the queue past the pieces of their size, read once for the figures and the line.
    const beyond = d.pace_batch !== null ? await liveBeyond(this.db, d) : null;
    const people = (sizeId: string | null, statuses: readonly string[]) =>
      (sizeId === null ? counts : perSize).filter((c) => (sizeId === null || c.size_id === sizeId) && statuses.includes(c.status)).reduce((n, c) => n + Number(c.n), 0);
    const pieces = (sizeId: string, statuses: readonly string[]) => perSize.filter((c) => c.size_id === sizeId && statuses.includes(c.status)).reduce((n, c) => n + Number(c.q ?? 0), 0);
    const boardSizes: AdminLiveBoardSize[] = sizes.map((s) => {
      const held = pieces(s.id, ['TURN', 'SECURED']);
      const sold = pieces(s.id, ['CONFIRMED']);
      return {
        id: s.id,
        label: s.label,
        ...(s.piece !== null ? { piece: s.piece } : {}),
        stock: s.stock,
        left: Math.max(0, s.stock - held - sold),
        held,
        sold,
        waiting: people(s.id, ['WAITING']),
        line: people(s.id, ['QUEUED']),
        turns: people(s.id, ['TURN']),
        secured: people(s.id, ['SECURED']),
        confirmed: people(s.id, ['CONFIRMED']),
        missed: people(s.id, ['MISSED']),
        expired: people(s.id, ['EXPIRED']),
        interest: Number((interestBySize ?? interest).find((i) => i.size_id === s.id)?.n ?? 0),
        beyond: beyond?.bySize.get(s.id) ?? 0,
      };
    });
    // A set's release: its people and sets counted once, in its first piece's sizes; its sets left, each piece's, the smallest.
    const first = Math.min(...boardSizes.map((s) => s.piece ?? 0));
    const counted = boardSizes.filter((s) => (s.piece ?? 0) === first);
    const sum = (k: keyof AdminLiveBoardSize) => counted.reduce((n, s) => n + (s[k] as number), 0);
    const boardPieces = setOf
      ? setOf.map((p) => ({ piece: p.piece!, name: p.model.name, variant: p.model.variant, stock: boardSizes.filter((s) => s.piece === p.piece).reduce((n, s) => n + s.stock, 0) }))
      : null;
    const leftSets = setOf ? Math.min(...setOf.map((p) => boardSizes.filter((s) => s.piece === p.piece).reduce((n, s) => n + s.left, 0))) : sum('left');
    const holding = people(null, ['TURN', 'SECURED']);
    const phase = livePhase(d, now);
    // Over on the recorded end (the clock alone may run ahead of the engine's pass), with no turn or hold left.
    const over = d.ended_at !== null && holding === 0;
    const [line, lineTotal, signals, pace] = await Promise.all([
      this.adminEntries(this.db, d, { statuses: [...LIVE_OPEN_STATUSES] }, LIVE_CONSOLE_LINE_MAX, 0, now, beyond),
      this.db.selectFrom('live_entries').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', id).where('status', 'in', [...LIVE_OPEN_STATUSES]).executeTakeFirstOrThrow(),
      // The alerts and the forecast from T0 while the release runs; once it is over, the report says the rest.
      this.insights && !over ? this.insights.signals(d, now) : Promise.resolve<LiveSignals>({ alerts: [], sellOut: null }),
      livePaceState(this.db, d, beyond ?? undefined),
    ]);
    return {
      id,
      phase,
      paused: d.paused_at !== null && !over,
      pausedAt: d.paused_at,
      over,
      endedAt: d.ended_at,
      endedReason: d.ended_reason,
      roomOpensAt: roomOpensAt(d),
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      quantity: onSaleOf(sizes),
      quantityLine: d.quantity_line ?? '',
      totals: {
        stock: setOf ? onSaleOf(sizes) : sum('stock'),
        left: leftSets,
        held: sum('held'),
        sold: sum('sold'),
        inRoom: people(null, LIVE_OPEN_STATUSES),
        waiting: sum('waiting'),
        line: sum('line'),
        turns: sum('turns'),
        secured: sum('secured'),
        confirmed: sum('confirmed'),
        missed: sum('missed'),
        expired: sum('expired'),
        released: people(null, ['RELEASED']),
        departed: people(null, ['LEFT']),
        removed: people(null, ['REMOVED']),
        ended: people(null, ['ENDED']),
        interest: sum('interest'),
        // Each entry once (a set's, past the pieces in any of its sizes).
        beyond: beyond?.entries.size ?? 0,
      },
      sizes: boardSizes,
      ...(boardPieces ? { pieces: boardPieces } : {}),
      message: message ? { text: message.text, at: message.created_at } : null,
      line,
      lineTotal: Number(lineTotal.n),
      alerts: signals.alerts,
      sellOut: signals.sellOut,
      pace,
    };
  }

  /**
   * The entries of a release: one status, the open ones (OPEN), those in the queue past the pieces of their size
   * (BEYOND, ONE QUEUE D11: none without a pace), or all; by place, then arrival.
   */
  async entries(dropId: string, filter: { status?: LiveEntryStatus | 'OPEN' | 'BEYOND' }, page: PageRequest): Promise<Page<AdminLiveEntry>> {
    const id = knownId(dropId, dropNotFound);
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').executeTakeFirst();
    if (!d) throw dropNotFound();
    if (filter.status === 'BEYOND') {
      if (d.pace_batch === null) return makePage([], 0, page);
      // Filtered and counted inside the query (liveBeyondRows): never a list of ids bound, whatever the queue's length.
      const total = await sql<{ n: string | number }>`SELECT count(DISTINCT b.entry_id) AS n FROM (${liveBeyondRows(d)}) AS b`.execute(this.db);
      const n = Number(total.rows[0]?.n ?? 0);
      const items = n ? await this.adminEntries(this.db, d, { statuses: ['QUEUED'], beyond: true }, page.pageSize, pageOffset(page), this.clock()) : [];
      return makePage(items, n, page);
    }
    const statuses = filter.status === 'OPEN' ? [...LIVE_OPEN_STATUSES] : filter.status ? [filter.status] : null;
    let q = this.db.selectFrom('live_entries').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', id);
    if (statuses) q = q.where('status', 'in', statuses);
    const total = await q.executeTakeFirstOrThrow();
    const items = await this.adminEntries(this.db, d, { statuses }, page.pageSize, pageOffset(page), this.clock());
    return makePage(items, Number(total.n), page);
  }

  /**
   * Which of these console sessions (SessionInfo.id) still open the console as sessionGuard would let them in, and
   * whether each reads the customers' emails in clear (OPERATOR, ADMIN) or masked (AUDITOR): one read for every console
   * stream of the process, so a stream ends at the next pulse once its session has (signed out, revoked, the staff
   * account disabled or under AUDITOR), and follows a change of role.
   */
  async consoleSessions(sessionIds: readonly string[]): Promise<Map<string, { inClear: boolean }>> {
    const ids = [...new Set(sessionIds.filter((x) => /^[0-9a-f]{64}$/.test(x)))];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('sessions as s')
      .innerJoin('admin_users as a', 'a.id', 's.subject_id')
      .select(['s.id_hash', 'a.role'])
      .where('s.id_hash', 'in', ids.map((x) => new Uint8Array(Buffer.from(x, 'hex'))))
      .where('s.subject_type', '=', 'admin')
      .where('s.expires_at', '>', this.clock())
      .where('a.disabled_at', 'is', null)
      .where('a.password_change_required', '=', false)
      .where('a.role', 'in', ['AUDITOR', 'OPERATOR', 'ADMIN'] satisfies AdminRole[])
      .execute();
    return new Map(rows.map((r) => [Buffer.from(r.id_hash).toString('hex'), { inClear: r.role !== 'AUDITOR' }]));
  }

  // ── Create, edit, publish, cancel ────────────────────────────────────────

  /**
   * A new LIVE RELEASE, a DRAFT: its seed drawn, sealed and committed now (the line's order within a tier), its settings
   * checked (the room still ahead, the stages in order). OPERATOR; audited `drop.live.create` with the seed's SHA-256.
   */
  async create(input: LiveSettingsInput, actor: Actor): Promise<AdminLiveRelease> {
    const admin = assertStaff(actor, 'create a release');
    const s = settingsOf(null, input ?? ({} as LiveSettingsInput));
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      checkTimes(s, now, null);
      await this.resolvePicks(tx, s, null);
      await this.checkOffer(tx, s);
      await this.checkAccess(tx, s);
      if (s.afterRoom) await this.checkModel(tx, s.afterRoom.modelId);
      const id = randomUUID();
      const { sealed, seedHash } = newSealedSeed(this.seedKey, id);
      await tx
        .insertInto('drops')
        .values({
          id,
          mode: 'LIVE',
          seed_enc: sealed,
          seed_hash: seedHash,
          purchase_window_hours: PURCHASE_WINDOW_HOURS.default,
          early_access_hours: 0,
          created_by: admin,
          created_at: now,
          ...this.columns(s),
        })
        .execute();
      await this.writeLists(tx, id, s, null);
      if (s.afterRoom) await this.saveAfterRoom(tx, { id, ...this.columns(s) }, s.afterRoom, admin, now);
      await this.audit.record({ actor, action: 'drop.live.create', targetType: 'drop', targetId: id, details: { ...auditSettings(s), seedHash: toHex(seedHash) } }, tx);
      return this.release(tx, id);
    });
  }

  /**
   * Change a LIVE RELEASE until its announcement (409 LIVE_ANNOUNCED after, DROP_CANCELLED once cancelled): any setting;
   * a list given (sizes, add-ons, the catalogue add-ons picked, models, per-tier windows) replaces the release's. The same
   * checks as a creation. A
   * post of the circle the publication scheduled follows the new times and rule; a new opening cancels the founding
   * announcements queued for the old one (cancelMovedAnnouncements). Audited `drop.live.update` with each setting before
   * and after (and `emailsCancelled`); nothing changed, nothing written.
   */
  async update(dropId: string, change: LiveSettingsChange, actor: Actor): Promise<AdminLiveRelease> {
    const admin = assertStaff(actor, 'change a release');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const d = await this.lock(tx, id);
      const now = this.clock();
      if (d.parent_drop_id) throw afterRoomOwn();
      if (d.cancelled_at) throw liveCancelled();
      if (isAnnounced(d, now)) throw liveAnnounced();
      const before = await this.settings(tx, d);
      const after = settingsOf(before, change ?? {});
      checkTimes(after, now, d.published_at);
      await this.resolvePicks(tx, after, before);
      const a = auditSettings(before);
      const b = auditSettings(after);
      // A list written again with other ids (sizes, add-ons sent as new) changes, even saying the same.
      const ids = (xs: readonly { id: string | null }[]) => JSON.stringify(xs.map((x) => x.id));
      const listIds = (x: Settings['afterRoom']) => (x ? `${ids(x.sizes)}${ids(x.addons)}` : '');
      const changed = Object.keys(b).filter(
        (k) =>
          JSON.stringify(a[k]) !== JSON.stringify(b[k]) ||
          (k === 'sizes' && ids(before.sizes) !== ids(after.sizes)) ||
          (k === 'addons' && ids(before.addons) !== ids(after.addons)) ||
          (k === 'afterRoom' && listIds(before.afterRoom) !== listIds(after.afterRoom)),
      );
      if (changed.length === 0) return this.release(tx, id);
      // IN-01: never fewer pieces than the house guarantees for the release.
      const guaranteed = await guaranteedPieces(tx, id);
      if (after.sizes.reduce((n, x) => n + x.stock, 0) < guaranteed) throw guaranteesExceed(guaranteed);
      // Its model or set offered; a set's sizes per piece and its sets per person checked again when they change.
      if (after.modelId !== before.modelId || after.setId !== before.setId || (after.setId !== null && (changed.includes('sizes') || changed.includes('perAccount')))) {
        await this.checkOffer(tx, after);
      }
      if (after.afterRoom && after.afterRoom.modelId !== before.afterRoom?.modelId) await this.checkModel(tx, after.afterRoom.modelId);
      await this.checkAccess(tx, after);
      await tx.updateTable('drops').set(this.columns(after)).where('id', '=', id).execute();
      await this.writeLists(tx, id, after, before);
      // The after-room follows: its own settings, and what it takes from the release (written again whatever changed).
      await this.saveAfterRoom(tx, { id, ...this.columns(after) }, after.afterRoom, admin, now);
      // Its founding announcements queued for the old opening (M1.17, F6) would go at it and say it: cancelled, to be
      // sent again for the new one.
      const emails = this.columns(after).opens_at.getTime() !== d.opens_at.getTime() ? await cancelMovedAnnouncements(tx, id, now) : 0;
      const notes: AuditRecordInput[] = [
        {
          actor,
          action: 'drop.live.update',
          targetType: 'drop',
          targetId: id,
          details: {
            before: Object.fromEntries(changed.map((k) => [k, a[k]])),
            after: Object.fromEntries(changed.map((k) => [k, b[k]])),
            ...(emails > 0 ? { emailsCancelled: emails } : {}),
          },
        },
      ];
      if (d.published_at) await this.syncCirclePosts(tx, { ...d, ...this.columns(after) } as DropRow, now, actor, notes);
      for (const n of notes) await this.audit.record(n, tx);
      return this.release(tx, id);
    });
  }

  /**
   * Publish a DRAFT: announced at `announce_at` (at once when NULL), its stages each at its time. Refused once published
   * or cancelled, when the room would already be open, when a stage is no longer after the announcement, and for a model
   * no longer offered. With `circlePost`, a post of the owners' circle linking the release (LIVE_CIRCLE_TITLE, its times
   * in Paris, its quantity and price, its rule), for its tier (TITANE at least; every owner when OR opens it beyond the
   * tier), shown from the announcement. Audited `drop.live.publish` (and `circle.post.create`).
   */
  async publish(dropId: string, opts: { circlePost?: boolean }, actor: Actor): Promise<AdminLiveRelease> {
    const admin = assertStaff(actor, 'publish a release');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const d = await this.lock(tx, id);
      const now = this.clock();
      if (d.parent_drop_id) throw afterRoomOwn();
      if (d.cancelled_at) throw liveCancelled();
      if (d.published_at) throw alreadyPublished();
      const settings = await this.settings(tx, d);
      checkTimes(settings, now, null);
      // Its model offered; a set's release (macro scope K44 T1): its set offered and each piece's model.
      if (d.set_id !== null) await offeredSet(tx, d.set_id);
      else if (!(await tx.selectFrom('models').select('active').where('id', '=', d.model_id!).executeTakeFirstOrThrow()).active) throw modelInactive();
      if (settings.afterRoom) {
        const own = await tx.selectFrom('models').select('active').where('id', '=', settings.afterRoom.modelId).executeTakeFirstOrThrow();
        if (!own.active) throw afterRoomModelInactive();
      }
      // The feasibility check, as the console showed it: recorded, never blocking (K5).
      const feasible = await this.checkFeasibility(tx, d);
      await tx.updateTable('drops').set({ published_at: now }).where('id', '=', id).execute();
      const published = { ...d, published_at: now };
      const notes: AuditRecordInput[] = [];
      // IN-01: the house's guarantees waiting for the next release of its model or collection, set aside while they fit.
      const covered: AuditRecordInput[] = [];
      await coverOnPublish(tx, published, now, actor, covered);
      let postId: string | null = null;
      if (opts?.circlePost === true) {
        const post = await this.circlePost(tx, published, now);
        postId = (
          await tx
            .insertInto('circle_posts')
            .values({ kind: 'NOTE', title: LIVE_CIRCLE_TITLE, body: post.body, min_tier: post.minTier, drop_id: id, published_at: post.at, created_by: admin, created_at: now })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        notes.push({
          actor,
          action: 'circle.post.create',
          targetType: 'circle_post',
          targetId: postId,
          details: { kind: 'NOTE', title: LIVE_CIRCLE_TITLE, body: storyFingerprint(post.body), minTier: post.minTier, dropId: id, publishedAt: post.at.toISOString(), by: 'drop.live.publish' },
        });
      }
      notes.unshift({
        actor,
        action: 'drop.live.publish',
        targetType: 'drop',
        targetId: id,
        details: {
          seedHash: toHex(d.seed_hash),
          quantity: d.quantity,
          quantityLine: d.quantity_line,
          announcedAt: announcedAt(published)!.toISOString(),
          roomOpensAt: roomOpensAt(d).toISOString(),
          opensAt: d.opens_at.toISOString(),
          closesAt: d.closes_at.toISOString(),
          circlePostId: postId,
          locationId: feasible.location?.id ?? null,
          waitForStock: feasible.short,
          shortSizes: [...feasible.sizes.map((l) => ({ l, after: false })), ...(feasible.afterRoom ?? []).map((l) => ({ l, after: true }))]
            .filter((x) => x.l.short > 0)
            .map((x) => `${x.after ? 'AFTER-ROOM ' : ''}${x.l.label}:${x.l.short}`),
        },
      });
      notes.push(...covered);
      for (const n of notes) await this.audit.record(n, tx);
      return this.release(tx, id);
    });
  }

  /**
   * The release's post of the circle after its publication, until its announcement (409 LIVE_ANNOUNCED after,
   * DROP_NOT_PUBLISHED for a draft, whose post is chosen when it is published; DROP_CANCELLED once cancelled): `on`, a
   * post written as the publication writes it, shown from the announcement (409 LIVE_CIRCLE_POSTED when one waits for
   * it already); off, the posts waiting for it withdrawn (409 LIVE_NO_CIRCLE_POST without one). Audited
   * `circle.post.create` or `circle.post.unpublish`, with the release's id.
   */
  async setCirclePost(dropId: string, on: boolean, actor: Actor): Promise<AdminLiveRelease> {
    const admin = assertStaff(actor, 'post a release in the circle');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const d = await this.lock(tx, id);
      const now = this.clock();
      if (d.parent_drop_id) throw afterRoomOwn();
      if (d.cancelled_at) throw liveCancelled();
      if (!d.published_at) throw notPublished();
      if (isAnnounced(d, now)) throw liveAnnounced();
      const waiting = await tx.selectFrom('circle_posts').select('id').where('drop_id', '=', id).where('published_at', '>', now).orderBy('created_at').orderBy('id').forUpdate().execute();
      if (on) {
        if (waiting.length > 0) throw circlePosted();
        const post = await this.circlePost(tx, d, now);
        const { id: postId } = await tx
          .insertInto('circle_posts')
          .values({ kind: 'NOTE', title: LIVE_CIRCLE_TITLE, body: post.body, min_tier: post.minTier, drop_id: id, published_at: post.at, created_by: admin, created_at: now })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(
          {
            actor,
            action: 'circle.post.create',
            targetType: 'circle_post',
            targetId: postId,
            details: { kind: 'NOTE', title: LIVE_CIRCLE_TITLE, body: storyFingerprint(post.body), minTier: post.minTier, dropId: id, publishedAt: post.at.toISOString() },
          },
          tx,
        );
      } else {
        if (waiting.length === 0) throw noCirclePost();
        await tx
          .updateTable('circle_posts')
          .set({ published_at: null })
          .where('id', 'in', waiting.map((p) => p.id))
          .execute();
        for (const p of waiting) await this.audit.record({ actor, action: 'circle.post.unpublish', targetType: 'circle_post', targetId: p.id, details: { dropId: id } }, tx);
      }
      return this.release(tx, id);
    });
  }

  /**
   * Cancel a LIVE RELEASE before its room opens (409 LIVE_ROOM_OPEN after; DROP_CANCELLED twice): its page answers 404
   * from then on, a post of the circle not shown yet is withdrawn, and its after-room never opens. Audited
   * `drop.live.cancel` (and `drop.live.after_room.skip`).
   */
  async cancel(dropId: string, actor: Actor): Promise<AdminLiveRelease> {
    assertStaff(actor, 'cancel a release');
    const id = knownId(dropId, dropNotFound);
    return withLiveChanges(this.liveFrames, (changes) => inTransaction(this.db, async (tx) => {
      const d = await this.lock(tx, id);
      const now = this.clock();
      if (d.parent_drop_id) throw afterRoomOwn();
      if (d.cancelled_at) throw liveCancelled();
      if (d.published_at && now.getTime() >= roomOpensAt(d).getTime()) throw roomOpen();
      await tx.updateTable('drops').set({ cancelled_at: now }).where('id', '=', id).execute();
      const afterRoom: AuditRecordInput[] = [];
      await cancelAfterRoom(tx, id, now, actor, afterRoom);
      const withdrawn = await tx
        .updateTable('circle_posts')
        .set({ published_at: null })
        .where('drop_id', '=', id)
        .where('published_at', '>', now)
        .returning(['id'])
        .execute();
      const interest = await tx.selectFrom('live_interest').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', id).executeTakeFirstOrThrow();
      // IN-01: its guarantees not used, carried to the next release of their model or collection, or expired.
      await releaseCovered(tx, id, 'CANCELLED', now, actor, afterRoom, changes);
      // Its founding announcements and release notices still queued are not sent (M1.17), as its posts are withdrawn.
      const emails = await cancelReleaseEmails(tx, id, now);
      await this.audit.record(
        {
          actor,
          action: 'drop.live.cancel',
          targetType: 'drop',
          targetId: id,
          details: { published: d.published_at !== null, announced: isAnnounced(d, now), interest: Number(interest.n), ...(emails > 0 ? { emailsCancelled: emails } : {}) },
        },
        tx,
      );
      for (const p of withdrawn) await this.audit.record({ actor, action: 'circle.post.unpublish', targetType: 'circle_post', targetId: p.id, details: { dropId: id, by: 'drop.live.cancel' } }, tx);
      for (const n of afterRoom) await this.audit.record(n, tx);
      return this.release(tx, id);
    }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The releases with their model, or (macro scope K44 T1) their set. */
  private reads(db: Db) {
    return db
      .selectFrom('drops as d')
      .leftJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('sets as t', 't.id', 'd.set_id')
      .selectAll('d')
      .select(['m.name as model_name', 'm.type as model_type', 'm.active as model_active', 't.name as set_name', 't.code as set_code', 't.active as set_active']);
  }

  /** A LIVE RELEASE's row FOR UPDATE; 404 for anything else. */
  private async lock(tx: Db, id: string): Promise<DropRow> {
    const d = await tx.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').forUpdate().executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  private async liveRow(db: Db, id: string): Promise<DropRow> {
    const d = await db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  /** The columns of `drops` the settings hold. */
  private columns(s: Settings) {
    return {
      model_id: s.modelId,
      set_id: s.setId,
      title: s.title,
      description: s.description,
      // Its pieces on sale; a set's, its sets (the smallest of its pieces' totals).
      quantity: onSaleOf(s.sizes),
      opens_at: s.opensAt,
      closes_at: s.closesAt,
      live_min_tier: s.minTier,
      tier_priority: s.tierPriority,
      room_opens_minutes: s.roomOpensMinutes,
      pace_batch: s.pace.batch,
      pace_minutes: s.pace.minutes,
      pace_hold_minutes: s.holdMinutes,
      turn_seconds: s.turnSeconds,
      pay_minutes: s.payMinutes,
      per_account: s.perAccount,
      price_minor: s.priceMinor,
      currency: s.currency,
      quantity_line: s.quantityLine,
      announce_at: s.announceAt,
      silhouette_at: s.silhouetteAt,
      name_at: s.nameAt,
      photo_at: s.photoAt,
      access_collection_id: s.accessCollectionId,
      min_participations: s.minParticipations,
      access_segment_id: s.accessSegmentId,
      access_combine: s.accessCombine,
      surprise_enabled: s.surpriseEnabled,
      surprise_text: s.surpriseText,
      stock_location_id: s.stockLocationId,
      question_enabled: s.questionEnabled,
      question_text: s.questionText,
      question_answers: s.questionAnswers,
    };
  }

  /**
   * What a release offers (macro scope K44 T1): its model (`checkModel`), or its set offered (drops.ts offeredSet: 404
   * SET_NOT_FOUND, 409 SET_SET_ASIDE, each piece's model active), every piece of the set given sizes and no other piece
   * (400); its sets per person are any of 1 to LIVE_PER_ACCOUNT.max (T4, as a model's pieces, read in `settingsOf`).
   */
  private async checkOffer(tx: Db, s: Settings): Promise<void> {
    if (s.setId === null) return this.checkModel(tx, s.modelId!);
    const set = await offeredSet(tx, s.setId);
    const n = set.pieces.length;
    for (const z of s.sizes) if (z.piece === null || z.piece > n) throw validationError(`Each size of a set’s release names its piece, 1 to ${n}.`);
    for (const p of set.pieces) if (!s.sizes.some((z) => z.piece === p.piece)) throw validationError(`Give ${p.model.name} its sizes: each piece of a set’s release has 1 to ${LIVE_SIZES.max} sizes.`);
  }

  /** A model a release (or its after-room) offers: known (404 MODEL_NOT_FOUND) and still offered (409 MODEL_INACTIVE). */
  private async checkModel(tx: Db, modelId: string): Promise<void> {
    const model = await tx.selectFrom('models').select(['id', 'active']).where('id', '=', modelId).executeTakeFirst();
    if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (!model.active) throw modelInactive();
  }

  /**
   * The models, the collection and the segment a rule names exist (404 otherwise). The segment is read FOR KEY SHARE: a
   * deletion under way waits for this transaction and then finds it in use (409 SEGMENT_IN_USE), or this one waits for
   * the deletion and finds it gone (404), never a foreign key refused.
   */
  private async checkAccess(tx: Db, s: Settings): Promise<void> {
    if (s.accessSegmentId && !(await tx.selectFrom('segments').select('id').where('id', '=', s.accessSegmentId).forKeyShare().executeTakeFirst())) {
      throw notFound('Segment', 'SEGMENT_NOT_FOUND');
    }
    if (s.accessModelIds.length > 0) {
      const found = await tx.selectFrom('models').select('id').where('id', 'in', s.accessModelIds).execute();
      if (found.length !== s.accessModelIds.length) throw notFound('Model', 'MODEL_NOT_FOUND');
    }
    if (s.accessCollectionId && !(await tx.selectFrom('collections').select('id').where('id', '=', s.accessCollectionId).executeTakeFirst())) {
      throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    }
    // A location is never deleted: known once, known for good.
    if (s.stockLocationId) await knownLocation(tx, s.stockLocationId);
  }

  /**
   * The sizes, add-ons, models and per-tier windows, written again when they changed. Before the announcement nothing
   * points to a size or an add-on yet (an interest, an entry): a list is replaced, the ids it keeps kept.
   */
  private async writeLists(tx: Db, id: string, s: Settings, before: Settings | null): Promise<void> {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    await this.writeOffer(tx, id, s, before);
    if (!before || !same(before.accessModelIds, s.accessModelIds)) {
      await tx.deleteFrom('live_access_models').where('drop_id', '=', id).execute();
      if (s.accessModelIds.length) await tx.insertInto('live_access_models').values(s.accessModelIds.map((m) => ({ drop_id: id, model_id: m }))).execute();
    }
    if (!before || !same(before.tierWindows, s.tierWindows)) {
      await tx.deleteFrom('live_tier_windows').where('drop_id', '=', id).execute();
      if (s.tierWindows.length) {
        await tx.insertInto('live_tier_windows').values(s.tierWindows.map((w) => ({ drop_id: id, tier: w.tier, turn_seconds: w.turnSeconds, pay_minutes: w.payMinutes }))).execute();
      }
    }
  }

  /**
   * A release's (or an after-room's) sizes and add-ons, written again when they changed: a list is replaced, the ids it
   * keeps kept (an id it names must be one of the release's: 400). Each size on sale is its model's SKU in that size
   * (migration 0022): linked again when the sizes or the model change.
   */
  private async writeOffer(
    tx: Db,
    id: string,
    s: { modelId: string | null; sizes: Settings['sizes']; addons: Settings['addons']; addonPick: Settings['addonPick']; setId?: string | null },
    before: { modelId: string | null; sizes: Settings['sizes']; addons: Settings['addons']; addonPick: Settings['addonPick']; setId?: string | null } | null,
  ): Promise<void> {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (!before || !same(before.sizes, s.sizes)) {
      const known = new Set((before?.sizes ?? []).map((x) => x.id));
      for (const x of s.sizes) if (x.id && !known.has(x.id)) throw validationError('A size to keep is one of the release’s.');
      await tx.deleteFrom('drop_sizes').where('drop_id', '=', id).execute();
      await tx
        .insertInto('drop_sizes')
        .values(s.sizes.map((x, i) => ({ ...(x.id ? { id: x.id } : {}), drop_id: id, piece: x.piece, label: x.label, position: i + 1, stock: x.stock })))
        .execute();
    }
    // Each size its model's SKU in that size; a set's, its piece's model's (stock.ts linkDropSizes reads the release's set).
    if (!before || !same(before.sizes, s.sizes) || before.modelId !== s.modelId || (before.setId ?? null) !== (s.setId ?? null)) await linkDropSizes(tx, id, s.modelId);
    if (!before || !same(before.addons, s.addons)) {
      const known = new Set((before?.addons ?? []).map((x) => x.id));
      for (const x of s.addons) if (x.id && !known.has(x.id)) throw validationError('An add-on to keep is one of the release’s.');
      await tx.deleteFrom('live_addons').where('drop_id', '=', id).execute();
      if (s.addons.length) {
        await tx
          .insertInto('live_addons')
          .values(s.addons.map((x, i) => ({ ...(x.id ? { id: x.id } : {}), drop_id: id, label: x.label, line: x.line, price_minor: x.priceMinor, position: i + 1 })))
          .execute();
      }
    }
    // Q2.3 (D3): the catalogue add-ons it offers at its purchase, in its order.
    const picked = (s.addonPick ?? []).map((a) => a.id);
    if (!before || !same((before.addonPick ?? []).map((a) => a.id), picked)) await writePick(tx, id, picked);
  }

  /** A release's (or an after-room's) sizes, add-ons and pick of catalogue add-ons as stored. */
  private async offer(db: Db, id: string): Promise<{ sizes: Settings['sizes']; addons: Settings['addons']; addonPick: PickRow[] }> {
    const [sizes, addons, addonPick] = await Promise.all([
      db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', id).orderBy('position').execute(),
      db.selectFrom('live_addons').select(['id', 'label', 'line', 'price_minor']).where('drop_id', '=', id).orderBy('position').execute(),
      this.pickRead(db, id),
    ]);
    return {
      sizes: sizes.map((x) => ({ id: x.id, label: x.label, stock: x.stock, piece: null })),
      addons: addons.map((a) => ({ id: a.id, label: a.label, line: a.line, priceMinor: a.price_minor })),
      addonPick,
    };
  }

  /** A release's pick of catalogue add-ons as stored (Q2.3), in its order, by id and name. */
  private async pickRead(db: Db, id: string): Promise<PickRow[]> {
    return db.selectFrom('drop_addons as x').innerJoin('addon_items as a', 'a.id', 'x.addon_id').select(['a.id', 'a.name']).where('x.drop_id', '=', id).orderBy('x.position').execute();
  }

  /**
   * The picks of a release and of its after-room made whole before they are compared and written (Q2.3, D3): a pick not
   * given at the creation (the release's, or a new after-room's) is every active add-on with its LIVE switch on and
   * priced in the release's currency (N7); a pick given is checked (addons.ts checkPick: 409 ADDON_NOT_OFFERED naming
   * it); a pick kept stays as it is (the hold offers only what is still offerable: order-addons.ts addonOffer).
   */
  private async resolvePicks(tx: Db, s: Settings, before: Settings | null): Promise<void> {
    const resolve = async (pick: PickRow[] | null, was: PickRow[] | null): Promise<PickRow[]> =>
      pick === null ? defaultPick(tx, 'LIVE', s.currency) : pick === was ? pick : checkPick(tx, 'LIVE', pick.map((a) => a.id), s.currency);
    s.addonPick = await resolve(s.addonPick, before?.addonPick ?? null);
    if (s.afterRoom) s.afterRoom = { ...s.afterRoom, addonPick: await resolve(s.afterRoom.addonPick, before?.afterRoom?.addonPick ?? null) };
  }

  /**
   * The release's after-room as its settings say, before its announcement (the release's row FOR UPDATE, then the
   * after-room's): none, removed when there is one (nothing points to an after-room before its release's sell-out); else
   * created, a DRAFT with its own sealed seed, or changed: its own settings, and what it takes from the release written
   * again (its title, turn and pay windows, pieces per person, currency; its times the latest it could open, from the
   * release's close: the sell-out sets them). services/after-room.ts says the rest.
   */
  private async saveAfterRoom(
    tx: Db,
    parent: Pick<DropRow, 'id' | 'title' | 'closes_at' | 'turn_seconds' | 'pay_minutes' | 'per_account' | 'currency'>,
    a: AfterRoomSettings | null,
    createdBy: string | null,
    now: Date,
  ): Promise<void> {
    const child = await tx.selectFrom('drops').select(['id', 'model_id']).where('parent_drop_id', '=', parent.id).forUpdate().executeTakeFirst();
    // Macro scope K44 (plan MACRO M3 §5.1, EXCLUDED): a set's release never has an after-room.
    if (a && (await tx.selectFrom('drops').select('set_id').where('id', '=', parent.id).executeTakeFirst())?.set_id) throw afterRoomSet();
    if (!a) {
      if (child) {
        await tx.deleteFrom('live_addons').where('drop_id', '=', child.id).execute();
        await tx.deleteFrom('drop_addons').where('drop_id', '=', child.id).execute();
        await tx.deleteFrom('drop_sizes').where('drop_id', '=', child.id).execute();
        await tx.deleteFrom('drops').where('id', '=', child.id).execute();
      }
      return;
    }
    const quantity = a.sizes.reduce((n, x) => n + x.stock, 0);
    const times = afterRoomTimes(parent.closes_at, a.delayMinutes, a.lengthMinutes);
    const columns = {
      model_id: a.modelId,
      title: afterRoomTitle(parent.title),
      description: null,
      quantity,
      opens_at: times.opensAt,
      closes_at: times.closesAt,
      live_min_tier: 0,
      // Its line is the release's order, never drawn.
      tier_priority: false,
      room_opens_minutes: LIVE_ROOM_OPENS_MINUTES.min,
      turn_seconds: parent.turn_seconds,
      pay_minutes: parent.pay_minutes,
      per_account: parent.per_account,
      price_minor: a.priceMinor,
      currency: parent.currency,
      quantity_line: defaultQuantityLine(quantity),
      after_room_delay_minutes: a.delayMinutes,
      after_room_length_minutes: a.lengthMinutes,
      surprise_enabled: false,
      question_enabled: false,
    };
    let id: string;
    if (child) {
      id = child.id;
      await tx.updateTable('drops').set(columns).where('id', '=', id).execute();
    } else {
      id = randomUUID();
      const { sealed, seedHash } = newSealedSeed(this.seedKey, id);
      await tx
        .insertInto('drops')
        .values({
          id,
          mode: 'LIVE',
          parent_drop_id: parent.id,
          seed_enc: sealed,
          seed_hash: seedHash,
          purchase_window_hours: PURCHASE_WINDOW_HOURS.default,
          early_access_hours: 0,
          created_by: createdBy,
          created_at: now,
          ...columns,
        })
        .execute();
    }
    await this.writeOffer(tx, id, a, child ? { modelId: afterRoomModelId(child), ...(await this.offer(tx, id)) } : null);
  }

  /** A release's after-room settings as stored; null without one. */
  private async afterRoomSettings(db: Db, parentId: string): Promise<AfterRoomSettings | null> {
    const c = await db
      .selectFrom('drops')
      .select(['id', 'model_id', 'price_minor', 'after_room_delay_minutes', 'after_room_length_minutes'])
      .where('parent_drop_id', '=', parentId)
      .executeTakeFirst();
    if (!c) return null;
    return {
      modelId: afterRoomModelId(c),
      priceMinor: c.price_minor ?? 0,
      ...(await this.offer(db, c.id)),
      delayMinutes: c.after_room_delay_minutes ?? AFTER_ROOM_DELAY_MINUTES.default,
      lengthMinutes: c.after_room_length_minutes ?? AFTER_ROOM_LENGTH_MINUTES.default,
    };
  }

  /** A release's after-room as the console reads it: its settings, where it stands, its guests and entries; null without one. */
  private async adminAfterRoom(db: Db, parent: DropRow, now: Date): Promise<AdminAfterRoom | null> {
    const c = await this.reads(db).where('d.parent_drop_id', '=', parent.id).executeTakeFirst();
    if (!c) return null;
    const [offer, counts, guests, holding, picks] = await Promise.all([
      this.offer(db, c.id),
      this.counts(db, [c.id]),
      db.selectFrom('after_room_guests').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', c.id).executeTakeFirstOrThrow(),
      this.openHolds(db, [c.id]),
      picksOf(db, [c.id], () => c.currency ?? 'EUR'),
    ]);
    const opened = c.published_at !== null && c.cancelled_at === null;
    const state: AfterRoomState = c.cancelled_at
      ? 'NOT_OPENED'
      : !c.published_at
        ? 'WAITING'
        : c.ended_at !== null && !holding.has(c.id)
          ? 'OVER'
          : now.getTime() < c.opens_at.getTime()
            ? 'OPENS'
            : 'OPEN';
    return {
      id: c.id,
      model: { id: afterRoomModelId(c), name: c.model_name ?? '', type: c.model_type ?? '', active: c.model_active === true },
      priceMinor: c.price_minor ?? 0,
      currency: c.currency ?? 'EUR',
      sizes: offer.sizes.map((x) => ({ id: x.id!, label: x.label, stock: x.stock })),
      quantity: c.quantity,
      addons: offer.addons.map((x) => ({ id: x.id!, label: x.label, line: x.line, priceMinor: x.priceMinor })),
      addonPick: picks.get(c.id) ?? [],
      delayMinutes: c.after_room_delay_minutes ?? AFTER_ROOM_DELAY_MINUTES.default,
      lengthMinutes: c.after_room_length_minutes ?? AFTER_ROOM_LENGTH_MINUTES.default,
      state,
      phase: livePhase(c, now),
      opensAt: opened ? c.opens_at : null,
      closesAt: opened ? c.closes_at : null,
      endedReason: c.ended_reason,
      skipped: c.cancelled_at ? (parent.cancelled_at ? 'CANCELLED' : parent.ended_reason === 'SOLD_OUT' ? 'NO_GUESTS' : 'NOT_SOLD_OUT') : null,
      guests: Number(guests.n),
      entries: counts.get(c.id) ?? EMPTY_COUNTS(),
    };
  }

  /** A release's settings as stored. */
  private async settings(db: Db, d: DropRow): Promise<Settings> {
    const [sizes, addons, addonPick, models, windows] = await Promise.all([
      db.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'piece']).where('drop_id', '=', d.id).orderBy('position').execute(),
      db.selectFrom('live_addons').select(['id', 'label', 'line', 'price_minor']).where('drop_id', '=', d.id).orderBy('position').execute(),
      this.pickRead(db, d.id),
      db.selectFrom('live_access_models').select('model_id').where('drop_id', '=', d.id).orderBy('model_id').execute(),
      db.selectFrom('live_tier_windows').select(['tier', 'turn_seconds', 'pay_minutes']).where('drop_id', '=', d.id).orderBy('tier').execute(),
    ]);
    return {
      // Macro scope K44 T1: what it sells, a model or a set.
      modelId: d.model_id,
      setId: d.set_id,
      title: d.title,
      description: d.description,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      roomOpensMinutes: d.room_opens_minutes ?? LIVE_ROOM_OPENS_MINUTES.default,
      // D1: every release that can still change has its pace (drops_live_paced); one ended before ONE QUEUE is read as
      // the smallest, never written again.
      pace: d.pace_batch !== null && d.pace_minutes !== null ? { batch: d.pace_batch, minutes: d.pace_minutes } : { batch: LIVE_PACE_BATCH.min, minutes: LIVE_PACE_MINUTES.min },
      holdMinutes: Number(d.pace_hold_minutes ?? 0),
      turnSeconds: d.turn_seconds ?? LIVE_TURN_SECONDS.default,
      payMinutes: d.pay_minutes ?? LIVE_PAY_MINUTES.default,
      perAccount: d.per_account ?? LIVE_PER_ACCOUNT.default,
      priceMinor: d.price_minor ?? 0,
      currency: d.currency ?? 'EUR',
      minTier: d.live_min_tier ?? 0,
      tierPriority: d.tier_priority ?? true,
      accessModelIds: models.map((m) => m.model_id),
      accessCollectionId: d.access_collection_id,
      minParticipations: d.min_participations ?? null,
      accessSegmentId: d.access_segment_id ?? null,
      accessCombine: d.access_combine ?? 'AND',
      surpriseEnabled: d.surprise_enabled === true,
      surpriseText: d.surprise_text ?? null,
      sizes: sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock, piece: s.piece })),
      quantityLine: d.quantity_line ?? defaultQuantityLine(d.quantity, d.set_id !== null),
      addons: addons.map((a) => ({ id: a.id, label: a.label, line: a.line, priceMinor: a.price_minor })),
      addonPick,
      announceAt: d.announce_at,
      silhouetteAt: d.silhouette_at,
      nameAt: d.name_at,
      photoAt: d.photo_at,
      tierWindows: windows.map((w) => ({ tier: w.tier, turnSeconds: w.turn_seconds, payMinutes: w.pay_minutes })),
      afterRoom: await this.afterRoomSettings(db, d.id),
      stockLocationId: d.stock_location_id ?? null,
      questionEnabled: d.question_enabled !== false,
      questionText: d.question_text ?? null,
      questionAnswers: d.question_answers ?? null,
    };
  }

  /**
   * The release's post of the circle, as the publication writes it: shown from the announcement (now when it is
   * already due), for the release's tier (TITANE at least: the circle is the owners'), or for every owner when the rules
   * combine by OR and the tier is not the only one (the tier then no longer limits who may enter), its words from the times,
   * quantity line, price and rule (a model of the rule that is the release's own says « this model », its collection
   * « this model’s collection »: the post never names the piece).
   */
  private async circlePost(db: Db, d: DropRow, now: Date): Promise<{ body: string; minTier: number; at: Date }> {
    const rule = await liveAccessRule(db, d, now, true);
    const room = roomOpensAt(d);
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(f.formatToParts(room).map((p) => [p.type, p.value]));
    const minutes = d.room_opens_minutes ?? LIVE_ROOM_OPENS_MINUTES.default;
    const body = [
      `The room opens on ${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute}, Paris time, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} before the release.`,
      `${d.quantity_line ?? defaultQuantityLine(d.quantity)} · ${liveMoney(d.price_minor ?? 0, d.currency ?? 'EUR')}. For ${liveRuleText(rule)}.`,
    ].join('\n\n');
    const announced = announcedAt(d) ?? now;
    const widened = d.access_combine === 'OR' && (rule.models.length > 0 || rule.collection !== null || !!rule.minParticipations || rule.segment);
    const minTier = widened ? 1 : Math.max(1, d.live_min_tier ?? 0);
    return { body, minTier, at: announced.getTime() > now.getTime() ? announced : now };
  }

  /** The posts the publication scheduled (linking the release, not shown yet), kept in step with its new settings. */
  private async syncCirclePosts(tx: Db, d: DropRow, now: Date, actor: Actor, notes: AuditRecordInput[]): Promise<void> {
    const scheduled = await tx.selectFrom('circle_posts').select(['id', 'body', 'min_tier', 'published_at']).where('drop_id', '=', d.id).where('published_at', '>', now).forUpdate().execute();
    if (scheduled.length === 0) return;
    const post = await this.circlePost(tx, d, now);
    for (const p of scheduled) {
      if (p.body === post.body && p.min_tier === post.minTier && p.published_at?.getTime() === post.at.getTime()) continue;
      await tx.updateTable('circle_posts').set({ body: post.body, min_tier: post.minTier, published_at: post.at }).where('id', '=', p.id).execute();
      notes.push({
        actor,
        action: 'circle.post.update',
        targetType: 'circle_post',
        targetId: p.id,
        details: {
          before: { body: storyFingerprint(p.body), minTier: p.min_tier, publishedAt: p.published_at?.toISOString() ?? null },
          after: { body: storyFingerprint(post.body), minTier: post.minTier, publishedAt: post.at.toISOString() },
          by: 'drop.live.update',
        },
      });
    }
  }

  private async counts(db: Db, ids: readonly string[]): Promise<Map<string, Record<LiveEntryStatus, number>>> {
    const out = new Map<string, Record<LiveEntryStatus, number>>();
    if (ids.length === 0) return out;
    const rows = await db.selectFrom('live_entries').select((eb) => ['drop_id', 'status', eb.fn.countAll<number>().as('n')]).where('drop_id', 'in', [...ids]).groupBy(['drop_id', 'status']).execute();
    for (const r of rows) {
      const c = out.get(r.drop_id) ?? EMPTY_COUNTS();
      c[r.status] = Number(r.n);
      out.set(r.drop_id, c);
    }
    return out;
  }

  private async interest(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db.selectFrom('live_interest').select((eb) => ['drop_id', eb.fn.countAll<number>().as('n')]).where('drop_id', 'in', [...ids]).groupBy('drop_id').execute();
    return new Map(rows.map((r) => [r.drop_id, Number(r.n)]));
  }

  /** The releases of `ids` with a turn or a hold still running. */
  private async openHolds(db: Db, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await db.selectFrom('live_entries').select('drop_id').distinct().where('drop_id', 'in', [...ids]).where('status', 'in', ['TURN', 'SECURED']).execute();
    return new Set(rows.map((r) => r.drop_id));
  }

  private card(r: ReadRow, now: Date, counts: Record<LiveEntryStatus, number> | undefined, interest: number, holding: boolean): AdminLiveCard {
    const phase = livePhase(r, now);
    return {
      id: r.id,
      title: r.title,
      // Macro scope K44 T1: a set's release names the set itself in its model's place, never one of its models.
      model:
        r.set_id !== null
          ? { id: r.set_id, name: r.set_name ?? '', type: 'SET', active: r.set_active === true }
          : { id: r.model_id!, name: r.model_name ?? '', type: r.model_type ?? '', active: r.model_active === true },
      phase,
      over: r.ended_at !== null && !holding,
      announcedAt: announcedAt(r),
      roomOpensAt: roomOpensAt(r),
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      quantity: r.quantity,
      quantityLine: r.quantity_line ?? defaultQuantityLine(r.quantity, r.set_id !== null),
      priceMinor: r.price_minor ?? 0,
      currency: r.currency ?? 'EUR',
      endedReason: r.ended_reason,
      entries: counts ?? EMPTY_COUNTS(),
      interest,
    };
  }

  /** Macro scope K44 T1: a set's release's set and its pieces, for its console views; null on a model's. */
  private async setOf(db: Db, r: ReadRow): Promise<AdminLiveSet | null> {
    return r.set_id === null ? null : adminSetOf(r.set_id, r, await setPieces(db, r.set_id));
  }

  /** Where a release's orders hold or make their pieces: the location it names (an after-room: its release's), else the default; null before any location exists. */
  private async locationOf(db: Db, d: Pick<DropRow, 'stock_location_id' | 'parent_drop_id'>): Promise<{ id: string; name: string } | null> {
    const set = d.parent_drop_id
      ? ((await db.selectFrom('drops').select('stock_location_id').where('id', '=', d.parent_drop_id).executeTakeFirst())?.stock_location_id ?? null)
      : d.stock_location_id;
    const row = await db
      .selectFrom('stock_locations')
      .select(['id', 'name'])
      .$if(set !== null, (q) => q.where('id', '=', set!))
      .$if(set === null, (q) => q.where('is_default', '=', true))
      .executeTakeFirst();
    return row ?? null;
  }

  /** A release's (or an after-room's) sizes as the feasibility check reads them: each with its SKU and its pieces on sale. */
  private async sizesOnSale(db: Db, dropId: string): Promise<FeasibilitySize[]> {
    const rows = await db.selectFrom('drop_sizes').select(['id', 'label', 'stock', 'sku_id', 'piece']).where('drop_id', '=', dropId).orderBy('position').execute();
    // Macro scope K44 T1: a set's size with its piece (each piece's SKU is its own model's).
    return rows.map((r) => ({ sizeId: r.id, label: r.label, skuId: r.sku_id, onSale: r.stock, ...(r.piece !== null ? { piece: r.piece } : {}) }));
  }

  private async checkFeasibility(db: Db, d: DropRow): Promise<Feasibility> {
    const location = await this.locationOf(db, d);
    const child = d.parent_drop_id ? undefined : await db.selectFrom('drops').select('id').where('parent_drop_id', '=', d.id).where('cancelled_at', 'is', null).executeTakeFirst();
    const [sizes, afterRoom] = await Promise.all([this.sizesOnSale(db, d.id), child ? this.sizesOnSale(db, child.id) : Promise.resolve(null)]);
    // Plan NEXT LOT §3.5.4.3: each size's SKU, its words and its supplier, and what is already ordered for it
    // (release-stock.ts releaseFeasibility, shared with a draw's).
    return releaseFeasibility(db, { location, sizes, afterRoom });
  }

  private async release(db: Db, id: string): Promise<AdminLiveRelease> {
    const r = await this.reads(db).where('d.id', '=', id).where('d.mode', '=', 'LIVE').executeTakeFirst();
    if (!r) throw dropNotFound();
    const now = this.clock();
    const [s, counts, interest, holding, models, collection, segment, posts, creator, afterRoom, parent, location, question] = await Promise.all([
      this.settings(db, r),
      this.counts(db, [id]),
      this.interest(db, [id]),
      this.openHolds(db, [id]),
      db.selectFrom('live_access_models as a').innerJoin('models as m', 'm.id', 'a.model_id').select(['m.id', 'm.name']).where('a.drop_id', '=', id).orderBy('m.name').orderBy('m.id').execute(),
      r.access_collection_id ? db.selectFrom('collections').select(['id', 'name']).where('id', '=', r.access_collection_id).executeTakeFirst() : undefined,
      r.access_segment_id ? db.selectFrom('segments').select(['id', 'name']).where('id', '=', r.access_segment_id).executeTakeFirst() : undefined,
      db.selectFrom('circle_posts').select(['id', 'published_at']).where('drop_id', '=', id).orderBy('created_at').orderBy('id').execute(),
      r.created_by ? db.selectFrom('admin_users').select(['id', 'email']).where('id', '=', r.created_by).executeTakeFirst() : undefined,
      r.parent_drop_id ? Promise.resolve(null) : this.adminAfterRoom(db, r, now),
      r.parent_drop_id ? db.selectFrom('drops').select(['id', 'title']).where('id', '=', r.parent_drop_id).executeTakeFirst() : undefined,
      this.locationOf(db, r),
      r.parent_drop_id ? Promise.resolve(null) : this.questions.tally(r, db),
    ]);
    const picks = await picksOf(db, [id], () => r.currency ?? 'EUR');
    const guaranteed = (await releaseGuaranteed(db, [id])).get(id) ?? { places: 0, pieces: 0 };
    const set = await this.setOf(db, r);
    const stages = liveStages(r, now);
    const silhouette = r.silhouette_sha256 ? { sha256: r.silhouette_sha256, url: mediaUrl(r.silhouette_sha256)! } : null;
    return {
      ...this.card(r, now, counts.get(id), interest.get(id) ?? 0, holding.has(id)),
      ...(set ? { set } : {}),
      description: r.description,
      // An after-room is set with its release, never on its own.
      editable: !r.cancelled_at && !isAnnounced(r, now) && !r.parent_drop_id,
      roomOpensMinutes: s.roomOpensMinutes,
      pace: r.pace_batch !== null && r.pace_minutes !== null ? s.pace : null,
      holdMinutes: s.holdMinutes,
      turnSeconds: s.turnSeconds,
      payMinutes: s.payMinutes,
      perAccount: s.perAccount,
      minTier: s.minTier,
      tierPriority: s.tierPriority,
      access: {
        models,
        collection: collection ?? null,
        minParticipations: s.minParticipations,
        segment: segment ?? null,
        combine: s.accessCombine,
        text: liveRuleText(consoleRule(s, models, collection ?? null)),
      },
      surprise: { enabled: s.surpriseEnabled, text: s.surpriseText },
      locationId: s.stockLocationId,
      location,
      question,
      sizes: s.sizes.map((x) => ({ id: x.id!, label: x.label, stock: x.stock, ...(x.piece !== null ? { piece: x.piece } : {}) })),
      addons: s.addons.map((x) => ({ id: x.id!, label: x.label, line: x.line, priceMinor: x.priceMinor })),
      addonPick: picks.get(id) ?? [],
      tierWindows: s.tierWindows,
      announceAt: r.announce_at,
      silhouetteAt: r.silhouette_at,
      nameAt: r.name_at,
      photoAt: r.photo_at,
      stages: stages ? { silhouetteAt: stages.silhouetteAt, nameAt: stages.nameAt, photoAt: stages.photoAt } : null,
      silhouette,
      boardLink: r.board_token_issued_at ? { issuedAt: r.board_token_issued_at } : null,
      circlePosts: posts.map((p) => ({ id: p.id, publishedAt: p.published_at })),
      publishedAt: r.published_at,
      cancelledAt: r.cancelled_at,
      pausedAt: r.paused_at,
      pausedMs: Number(r.paused_ms_total),
      endedAt: r.ended_at,
      createdAt: r.created_at,
      createdBy: creator ?? null,
      seedHash: toHex(r.seed_hash),
      afterRoom,
      afterRoomOf: parent ?? null,
      guaranteed,
    };
  }

  /**
   * Entries as the console reads them, by place (the line), then arrival; deadlines as they stand now; on a paced release
   * those QUEUED past the pieces of their size (`beyond`: liveBeyond, read here unless given).
   */
  private async adminEntries(
    db: Db,
    d: DropRow,
    filter: { statuses: readonly LiveEntryStatus[] | null; beyond?: boolean },
    limit: number,
    offset: number,
    now: Date,
    known?: { entries: Set<string> } | null,
  ): Promise<AdminLiveEntry[]> {
    let q = db
      .selectFrom('live_entries as e')
      .innerJoin('accounts as a', 'a.id', 'e.account_id')
      .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
      .select([
        'e.id', 'e.account_id', 'a.email', 'e.status', 'e.size_id', 's.label', 'e.quantity', 'e.tier', 'e.position', 'e.joined_at', 'e.turn_at',
        'e.turn_expires_at', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at', 'e.gesture_ms', 'e.let_in_by', 'e.guarantee_id',
        'e.admitted_at', 'e.admitted_batch',
      ])
      .where('e.drop_id', '=', d.id);
    if (filter.statuses) q = q.where('e.status', 'in', [...filter.statuses]);
    if (filter.beyond) q = q.where(sql<boolean>`e.id IN (SELECT b.entry_id FROM (${liveBeyondRows(d)}) AS b)`);
    const rows = await q
      .orderBy(sql`e.position IS NULL`)
      // IN-01: the places guaranteed by the house first, as the line gives them turns in their size.
      .orderBy(sql`e.guarantee_id IS NULL`)
      .orderBy('e.position')
      .orderBy('e.joined_at')
      .orderBy('e.id')
      .limit(limit)
      .offset(offset)
      .execute();
    // Macro scope K44 T1: a set's entries, their sizes per piece.
    const pieces = d.set_id !== null ? await livePieceSizes(db, rows.map((r) => r.id)) : new Map<string, LivePieceSize[]>();
    const beyond = known ?? (d.pace_batch !== null && rows.some((r) => r.status === 'QUEUED') ? await liveBeyond(db, d) : null);
    // D11: each person's queue place and estimated turn, from the queue's snapshot (live-queue.ts).
    const queue = rows.some((r) => r.status === 'QUEUED') ? await liveQueueSnapshot(db, d, now) : null;
    return rows.map((r) => ({
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
      turnExpiresAt: r.status === 'TURN' && r.turn_expires_at ? effectiveDeadline(r.turn_expires_at, d, now) : r.turn_expires_at,
      securedAt: r.secured_at,
      holdExpiresAt: r.status === 'SECURED' && r.hold_expires_at ? effectiveDeadline(r.hold_expires_at, d, now) : r.hold_expires_at,
      confirmedAt: r.confirmed_at,
      endedAt: r.ended_at,
      gestureMs: r.gesture_ms,
      letIn: r.let_in_by !== null,
      guaranteed: r.guarantee_id !== null,
      admittedAt: r.admitted_at,
      batch: r.admitted_batch,
      beyond: r.status === 'QUEUED' && (beyond?.entries.has(r.id) ?? false),
      ...adminQueueFigures(queue, r.id),
    }));
  }
}
