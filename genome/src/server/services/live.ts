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
 *              may serve it again. The console may LET IN a QUEUED entry out of order, within the free pieces.
 *   secure     the seal pressed (PRESS: `press_started_at`, the server's clock) and held: SECURE needs the turn's secret
 *              (`liveTurnToken`, its SHA-256 stored), a press at least LIVE_GESTURE_MIN_MS (1.4 s) earlier and a turn
 *              still running; the gesture's length is kept (`gesture_ms`) for the console's bot radar. SECURED: the hold
 *              runs `pay_minutes`; the add-ons are chosen; PAY (CONFIRM) confirms it: one order per piece, RESERVED,
 *              created in the same transaction (services/orders.ts ordersForLiveEntry), which ORBES Client Services
 *              follows to its delivery; RELEASE gives the piece back.
 *   second     a turn that runs out (MISSED), a hold that runs out or is freed by the console (EXPIRED, its add-ons
 *   chance     dropped), a place given back (RELEASED), an entry that leaves its turn or is removed: the piece returns,
 *              and the next in line for that size gets a turn at once.
 *   pause      the console's PAUSE stops new turns and freezes the deadlines: nobody presses or secures during it (a hold
 *              may still be confirmed, given back, its add-ons chosen); RESUME moves the turns and holds that were still
 *              running when it began by the time paused (`paused_ms_total` adds it). Paused time never consumes a turn
 *              or a hold, and never revives one that had run out.
 *   the end    SOLD_OUT, every piece confirmed: WAITING and QUEUED entries ENDED at once. CLOSED at `closes_at`: no new
 *              turn, WAITING and QUEUED ENDED at once; a turn in progress may still be secured, a hold confirmed, until
 *              their deadlines. ENDED by an ADMIN: WAITING, QUEUED and TURN ENDED at once; holds may still be
 *              confirmed. `ended_at` and `ended_reason` say when it began; the release is over once no turn and no hold
 *              is left. EXTEND moves `closes_at`, ADD PIECES raises a size's stock, before the end only.
 *
 * Access (`accessOf`), read at INTEREST, ENTER and SECURE: an ACTIVE account whose tier (club.ts `tierOf`, the pieces
 * held now) reaches `live_min_tier`, and, when the release names models (`live_access_models`) or a collection
 * (`access_collection_id`), holding now a piece of one of them (a piece's own collection first, its model's otherwise).
 *
 * The engine (live-engine.ts) runs `advance` for each release in its live window every 250 ms: one transaction, the
 * release's row FOR UPDATE: the line at T0, the turns and holds run out (not while paused), the end, the turns. Every
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
 * SOLD_OUT and CLOSED, the system as actor) and the console's (`drop.live.pause`, `.resume`, `.extend`, `.stock`,
 * `.free`, `.let_in`, `.message`, `.end`, `.remove`, and the boutique board's link, `.board.issue` and `.board.revoke`,
 * never with its secret). A lock of an account (OwnerService) removes its open entries and
 * withdraws its interest in the releases not opened yet (`removeAccountLiveEntries`); the right of access exports every
 * entry with its add-ons, and its interest (`accountLiveData`).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { normalizeIP } from '@fastify/rate-limit';
import { sql } from 'kysely';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { DropRow, LiveEndReason, LiveEntryStatus, LiveResolution } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, SYSTEM_ACTOR, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { CLUB_EXCLUDED_STATUSES, clubStandings, tierName, tierOf, type ClubTier } from './club.js';
import { DROP_QUANTITY_MAX, drawKey, dropNotFound, openDropSeed } from './drops.js';
import { ordersForLiveEntry } from './orders.js';
import { readActingAccount } from './ownership.js';

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
/** The boutique board's link: a secret of 32 random bytes (256 bits), base64url, kept only as its SHA-256. */
export const LIVE_BOARD_TOKEN_BYTES = 32;
/** The network's hash of an entry is erased this many days after the release's end (or its cancellation). */
export const LIVE_NETWORK_RETENTION_DAYS = 30;

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

/** How long a pause in progress has lasted at `now` (0 without one). */
export function pausedFor(d: Pick<DropRow, 'paused_at'>, now: Date): number {
  return d.paused_at ? Math.max(0, now.getTime() - new Date(d.paused_at).getTime()) : 0;
}

/** A deadline as it stands at `now`: moved by the pause in progress (RESUME moves the stored one by the whole pause). */
export function effectiveDeadline(deadline: Date, d: Pick<DropRow, 'paused_at'>, now: Date): Date {
  return new Date(new Date(deadline).getTime() + pausedFor(d, now));
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
 * The line at T0 (pure): the tier (descending, when `tierPriority`), then `drawKey(seed, id)` (ascending), then the id.
 * Anyone with the seed, the entries and their tiers computes the same places.
 */
export function lineOrder<T extends { id: string; tier: number }>(entries: readonly T[], seed: Uint8Array, tierPriority: boolean): T[] {
  const keyed = entries.map((e) => ({ e, id: e.id.toLowerCase(), key: drawKey(seed, e.id) }));
  keyed.sort((a, b) => (tierPriority ? b.e.tier - a.e.tier : 0) || compare(a.key, b.key) || compare(a.id, b.id));
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
const quantityInvalid = (max: number) => new DomainError('LIVE_QUANTITY_INVALID', 400, max === 1 ? 'This release offers one piece per person.' : `This release offers 1 to ${max} pieces per person.`);
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

/** 403 LIVE_NOT_ELIGIBLE: the rule of the release, in words. */
export const liveNotEligible = (rule: LiveAccessRule) => new DomainError('LIVE_NOT_ELIGIBLE', 403, `This release is for ${liveRuleText(rule)}.`);
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

/** Who may enter a release: a tier, and the owners of its models or of its collection when it names any. */
export interface LiveAccessRule {
  minTier: ClubTier;
  models: { id: string; name: string }[];
  collection: { id: string; name: string } | null;
}

/** An account against the rule of a release, now. */
export interface LiveAccess {
  allowed: boolean;
  /** The account's tier now (club.ts tierOf). */
  tier: ClubTier;
  /** What it lacks: the tier, or a piece of the models or collection named; null when allowed. */
  missing: 'TIER' | 'PIECE' | null;
}

/** The rule in words, as an announcement says it after « FOR »: « owners from PLATINE », « owners of MONOLITHE ». */
export function liveRuleText(rule: LiveAccessRule): string {
  const collection = rule.collection && (rule.collection.name === LIVE_UNNAMED_COLLECTION ? LIVE_UNNAMED_COLLECTION : `the ${rule.collection.name} collection`);
  const names = [...rule.models.map((m) => m.name), ...(collection ? [collection] : [])];
  const of = names.length === 0 ? '' : ` of ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`}`;
  if (rule.minTier >= 2) return `owners from ${tierName(rule.minTier)}${of}`;
  if (rule.minTier === 1 || of) return `owners${of}`;
  return 'every ORBES account';
}

/** The model named in place of the release's own before its name's stage. */
export const LIVE_UNNAMED_MODEL = 'this model';
/** The collection named in place of the release's model's own before its name's stage. */
export const LIVE_UNNAMED_COLLECTION = 'this model’s collection';

/**
 * The rule of a release as anyone may read it at `now` (an announcement, a 403 LIVE_NOT_ELIGIBLE, the circle's post): a
 * model it names that is the release's own is « this model », and a collection that is its model's own « this model’s
 * collection », until the name's stage (liveStages), so no answer says the name or its collection before; `unnamed`:
 * so at any time (the circle's post, which never names the piece).
 */
export async function liveAccessRule(
  db: Db,
  d: Pick<DropRow, 'id' | 'model_id' | 'live_min_tier' | 'access_collection_id'> & LiveStageRow,
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
  const named = !unnamed && (liveStages(d, now)?.name ?? false);
  const own = collection && !named ? await db.selectFrom('models').select('collection_id').where('id', '=', d.model_id).executeTakeFirst() : undefined;
  return {
    minTier: Math.min(3, Math.max(0, d.live_min_tier ?? 0)) as ClubTier,
    models: named ? models : models.map((m) => (m.id === d.model_id ? { id: m.id, name: LIVE_UNNAMED_MODEL } : m)),
    collection: collection && own?.collection_id === collection.id ? { id: collection.id, name: LIVE_UNNAMED_COLLECTION } : collection,
  };
}

/**
 * The account against the rule of the release at `now`: its tier reaches `live_min_tier`, and, when the release names
 * models or a collection, it holds now a piece the club counts (club.ts) of one of those models or of that collection
 * (the piece's own collection first, its model's otherwise, as product_overview reads it).
 */
export async function accessOf(db: Db, d: Pick<DropRow, 'id' | 'live_min_tier' | 'access_collection_id'>, accountId: string, now: Date): Promise<LiveAccess> {
  const { tier } = await tierOf(db, accountId, now);
  if (tier < (d.live_min_tier ?? 0)) return { allowed: false, tier, missing: 'TIER' };
  const models = await db.selectFrom('live_access_models').select('model_id').where('drop_id', '=', d.id).execute();
  if (models.length === 0 && !d.access_collection_id) return { allowed: true, tier, missing: null };
  const ids = models.map((m) => m.model_id);
  const held = await db
    .selectFrom('ownership as o')
    .innerJoin('products as p', 'p.id', 'o.product_id')
    .innerJoin('models as m', 'm.id', 'p.model_id')
    .select('o.id')
    .where('o.account_id', '=', accountId)
    .where('o.ended_at', 'is', null)
    .where('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
    .where((eb) =>
      eb.or([
        ...(ids.length > 0 ? [eb('p.model_id', 'in', ids)] : []),
        ...(d.access_collection_id ? [eb(eb.fn.coalesce('p.collection_id', 'm.collection_id'), '=', d.access_collection_id)] : []),
      ]),
    )
    .limit(1)
    .executeTakeFirst();
  return held ? { allowed: true, tier, missing: null } : { allowed: false, tier, missing: 'PIECE' };
}

// ── Views ──────────────────────────────────────────────────────────────────

export interface LiveSizeRef {
  id: string;
  label: string;
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
  size: LiveSizeRef;
  quantity: number;
  /** The club's tier at entry, then at T0. */
  tier: number;
  /** The place in the line; null before T0. */
  position: number | null;
  /** While QUEUED: the entries of its size before it in the line (0: it is next); null otherwise. */
  ahead: number | null;
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
  /** quantity × (price + the add-ons). */
  totalMinor: number;
}

/** An account's interest (I'LL BE THERE). */
export interface LiveInterestView {
  dropId: string;
  size: LiveSizeRef;
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
  /** The sum of the sizes' stock. */
  quantity: number;
  quantityLine: string;
  sizes: (LiveSizeRef & { stock: number })[];
}

/** An entry as the console's controls return it; the routes mask the email for an AUDITOR. */
export interface AdminLiveEntry {
  id: string;
  accountId: string;
  /** As stored. */
  email: string;
  status: LiveEntryStatus;
  size: LiveSizeRef;
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
      await tx
        .updateTable('live_entries')
        .set({ status: 'REMOVED', removed_by: admin, removed_at: sql<Date>`greatest(${now}::timestamptz, joined_at)`, ended_at: sql<Date>`greatest(${now}::timestamptz, joined_at)` })
        .where('id', 'in', ids)
        .execute();
    }
    entries = before
      .map((e) => ({ dropId: e.drop_id, entryId: e.id, from: e.status }))
      .sort((a, b) => compare(`${a.dropId} ${a.entryId}`, `${b.dropId} ${b.entryId}`));
  }
  const withdrawn = await tx
    .deleteFrom('live_interest')
    .where('account_id', '=', account)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('drops as d')
          .select('d.id')
          .whereRef('d.id', '=', 'live_interest.drop_id')
          .where('d.opens_at', '>', now)
          .where('d.ended_at', 'is', null)
          .where('d.cancelled_at', 'is', null),
      ),
    )
    .returning('drop_id')
    .execute();
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
  size: string;
  quantity: number;
  status: LiveEntryStatus;
  tier: number;
  position: number | null;
  joinedAt: Date;
  queuedAt: Date | null;
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
}

export interface ExportedLiveInterest {
  dropId: string;
  title: string;
  size: string;
  since: Date;
}

export async function accountLiveData(db: Db, accountId: string): Promise<{ entries: ExportedLiveEntry[]; interest: ExportedLiveInterest[] }> {
  const account = assertAccount(accountId);
  const rows = await db
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select([
      'e.id', 'e.drop_id', 'd.title', 's.label', 'e.quantity', 'e.status', 'e.tier', 'e.position', 'e.joined_at', 'e.queued_at', 'e.turn_at',
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
  const interest = await db
    .selectFrom('live_interest as i')
    .innerJoin('drops as d', 'd.id', 'i.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'i.size_id')
    .select(['i.drop_id', 'd.title', 's.label', 'i.created_at'])
    .where('i.account_id', '=', account)
    .orderBy('i.created_at')
    .orderBy('i.drop_id')
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
    })),
    interest: interest.map((i) => ({ dropId: i.drop_id, title: i.title, size: i.label, since: i.created_at })),
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
 * entry of one account, by release id (MY PIECES). A few statements whatever the number of accounts: the entries, their add-ons, and
 * for those QUEUED how many of their size are before them (`ahead`). Deadlines as they stand at `now` (a pause in
 * progress moves them); the turn's secret only while it is TURN, to its own account.
 */
export async function liveEntryViews(
  db: Db,
  turnKey: Uint8Array,
  of: { dropId: string; accountIds: readonly string[] } | { accountId: string },
  now: Date,
): Promise<Map<string, LiveEntryView>> {
  const base = db
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select([
      'e.id', 'e.drop_id', 'e.account_id', 'e.status', 'e.size_id', 's.label', 'e.quantity', 'e.tier', 'e.position', 'e.joined_at', 'e.turn_at',
      'e.turn_expires_at', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at', 'e.let_in_by', 'd.paused_at', 'd.price_minor', 'd.currency',
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
  const queued = rows.filter((r) => r.status === 'QUEUED');
  const ahead = new Map<string, number>();
  for (const ids of chunks(queued.map((r) => r.id))) {
    const drops = [...new Set(queued.map((r) => r.drop_id))];
    const r = await sql<{ id: string; ahead: number }>`
      SELECT q.id, q.ahead
        FROM (SELECT id, (row_number() OVER (PARTITION BY drop_id, size_id ORDER BY position) - 1)::int AS ahead
                FROM live_entries
               WHERE drop_id IN (${sql.join(drops)}) AND status = 'QUEUED') AS q
       WHERE q.id IN (${sql.join(ids)})`.execute(db);
    for (const a of r.rows) ahead.set(a.id, Number(a.ahead));
  }
  for (const r of rows) {
    const own = addons.filter((a) => a.entry_id === r.id);
    const price = r.price_minor ?? 0;
    const unit = price + own.reduce((n, a) => n + a.price_minor, 0);
    out.set('accountId' in of ? r.drop_id : r.account_id, {
      id: r.id,
      dropId: r.drop_id,
      status: r.status,
      size: { id: r.size_id, label: r.label },
      quantity: r.quantity,
      tier: r.tier,
      position: r.position,
      ahead: r.status === 'QUEUED' ? (ahead.get(r.id) ?? 0) : null,
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
      totalMinor: r.quantity * unit,
    });
  }
  return out;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface LiveServiceDeps {
  db: Db;
  audit: AuditService;
  /** The key sealing the drops' seeds (drops.ts deriveDropSeedKey): the line at T0 is ordered with the release's seed. */
  seedKey: Uint8Array;
  /** The key of the turns' secrets (deriveLiveTurnKey). */
  turnKey: Uint8Array;
  clock?: Clock;
}

interface SizeTotal {
  id: string;
  label: string;
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
};

const ENTRY_COLUMNS = [
  'id', 'drop_id', 'account_id', 'size_id', 'quantity', 'status', 'tier', 'position', 'joined_at', 'turn_at', 'turn_expires_at', 'turn_token_hash',
  'press_started_at', 'secured_at', 'hold_expires_at',
] as const;

export class LiveService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly seedKey: Uint8Array;
  private readonly turnKey: Uint8Array;
  private readonly clock: Clock;

  constructor(deps: LiveServiceDeps) {
    for (const [name, key] of [['seedKey', deps.seedKey], ['turnKey', deps.turnKey]] as const) {
      if (!(key instanceof Uint8Array) || key.length !== 32) throw new RangeError(`${name} must be 32 bytes`);
    }
    this.db = deps.db;
    this.audit = deps.audit;
    this.seedKey = deps.seedKey;
    this.turnKey = deps.turnKey;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** The rule of a published LIVE RELEASE and where the account stands against it now (404 DROP_NOT_FOUND before its announcement). */
  async access(accountId: string, dropId: string): Promise<{ rule: LiveAccessRule; access: LiveAccess }> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const now = this.clock();
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').where('published_at', 'is not', null).executeTakeFirst();
    if (!d || !isAnnounced(d, now)) throw dropNotFound();
    return { rule: await liveAccessRule(this.db, d, now), access: await accessOf(this.db, d, account, now) };
  }

  /** The account's entry in a published LIVE RELEASE, or null. */
  async entry(accountId: string, dropId: string): Promise<LiveEntryView | null> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    return this.viewerEntry(this.db, account, id);
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
   * LIVE_ALREADY_ENTERED). Audited `drop.live.enter` with the entry, size and quantity.
   */
  async enter(
    accountId: string,
    dropId: string,
    input: { sizeId: string; quantity?: number },
    actor: Actor,
    client: { networkHash?: Uint8Array | null; country?: string | null } = {},
  ): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const networkHash = client.networkHash instanceof Uint8Array && client.networkHash.length === 32 ? client.networkHash : null;
    const country = typeof client.country === 'string' && /^[A-Z]{2}$/.test(client.country) ? client.country : null;
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update');
      const notes: AuditRecordInput[] = [];
      if (d.cancelled_at) throw liveCancelled();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveOver();
      if (now.getTime() < roomOpensAt(d).getTime()) throw roomNotOpen(roomOpensAt(d));
      const access = await accessOf(tx, d, account, now);
      if (!access.allowed) throw notEligible(await liveAccessRule(tx, d, now));
      const existing = await tx.selectFrom('live_entries').select(['id', 'status', 'position']).where('drop_id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (existing && !(existing.status === 'LEFT' && existing.position === null)) throw alreadyEntered();
      const { size, quantity } = await this.choice(tx, d, input.sizeId, input.quantity);
      const late = now.getTime() >= d.opens_at.getTime();
      if (late) {
        await this.formLine(tx, d, now, notes);
        const total = (await this.sizeTotals(tx, d.id)).find((s) => s.id === size.id)!;
        if (quantity > servableOf(total)) throw sizeSoldOut();
      }
      const place = late ? { status: 'QUEUED' as const, position: (await this.lastPosition(tx, id)) + 1, queued_at: now } : { status: 'WAITING' as const, position: null, queued_at: null };
      const values = { size_id: size.id, quantity, tier: access.tier, joined_at: now, ended_at: null, network_hash: networkHash, country, ...place };
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
      notes.push({
        actor,
        action: 'drop.live.enter',
        targetType: 'drop',
        targetId: id,
        details: { entryId, sizeId: size.id, quantity, ...(late ? { position: place.position } : {}), ...(existing ? { again: true } : {}) },
      });
      await this.record(tx, notes);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * CHANGE SIZE (and quantity) while WAITING, before T0 only (409 LIVE_SIZE_LOCKED from T0 on, the size never changes
   * after). Audited `drop.live.size`.
   */
  async changeSize(accountId: string, dropId: string, input: { sizeId: string; quantity?: number }, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update');
      if (d.cancelled_at) throw liveCancelled();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveOver();
      const e = await this.lockEntry(tx, id, account);
      if (!e || e.status === 'LEFT') throw notEntered();
      if (now.getTime() >= d.opens_at.getTime() || e.position !== null) throw sizeLocked();
      if (e.status !== 'WAITING') throw notInLine();
      const { size, quantity } = await this.choice(tx, d, input.sizeId, input.quantity ?? e.quantity);
      if (size.id === e.size_id && quantity === e.quantity) return;
      await tx.updateTable('live_entries').set({ size_id: size.id, quantity }).where('id', '=', e.id).where('status', '=', 'WAITING').execute();
      await this.audit.record({ actor, action: 'drop.live.size', targetType: 'drop', targetId: id, details: { entryId: e.id, sizeId: size.id, quantity, before: { sizeId: e.size_id, quantity: e.quantity } } }, tx);
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
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update');
      const e = await this.lockEntry(tx, id, account);
      if (!e) throw notEntered();
      if (e.status !== 'WAITING' && e.status !== 'QUEUED' && e.status !== 'TURN') throw notInLine();
      // A turn that has run out, the engine not having marked it yet: MISSED at its deadline, not LEFT.
      if (e.status === 'TURN' && effectiveDeadline(e.turn_expires_at!, d, now).getTime() <= now.getTime()) throw turnPassed();
      await tx.updateTable('live_entries').set({ status: 'LEFT', ended_at: maxDate(now, e.joined_at) }).where('id', '=', e.id).execute();
      if (e.status === 'TURN') await this.giveTurnsNow(tx, d, now);
      await this.audit.record({ actor, action: 'drop.live.leave', targetType: 'drop', targetId: id, details: { entryId: e.id, from: e.status } }, tx);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * I'LL BE THERE with a size, from the announcement to T0, for an account allowed in: one per account and release, its
   * size changed in place. Audited `drop.live.interest` with the size.
   */
  async setInterest(accountId: string, dropId: string, sizeId: string, actor: Actor): Promise<LiveInterestView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share');
      if (d.cancelled_at) throw liveCancelled();
      if (d.ended_at || now.getTime() >= d.opens_at.getTime()) throw interestClosed();
      const access = await accessOf(tx, d, account, now);
      if (!access.allowed) throw notEligible(await liveAccessRule(tx, d, now));
      const { size } = await this.choice(tx, d, sizeId, 1);
      const before = await tx.selectFrom('live_interest').select('size_id').where('drop_id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (before?.size_id === size.id) return;
      await tx
        .insertInto('live_interest')
        .values({ drop_id: id, account_id: account, size_id: size.id, created_at: now })
        .onConflict((oc) => oc.columns(['drop_id', 'account_id']).doUpdateSet({ size_id: size.id }))
        .execute();
      await this.audit.record({ actor, action: 'drop.live.interest', targetType: 'drop', targetId: id, details: { sizeId: size.id, ...(before ? { before: before.size_id } : {}) } }, tx);
    });
    return (await this.interestView(this.db, account, id))!;
  }

  /** Withdraw I'LL BE THERE, before T0 (409 LIVE_INTEREST_CLOSED after; LIVE_NOT_INTERESTED without one). Audited `drop.live.interest.withdraw`. */
  async withdrawInterest(accountId: string, dropId: string, actor: Actor): Promise<void> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share');
      if (now.getTime() >= d.opens_at.getTime()) throw interestClosed();
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
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share');
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
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share');
      const e = await this.runningTurn(tx, d, account, token, now);
      const gesture = e.press_started_at ? now.getTime() - e.press_started_at.getTime() : -1;
      if (gesture < LIVE_GESTURE_MIN_MS) throw holdTooShort();
      const access = await accessOf(tx, d, account, now);
      if (!access.allowed) throw notEligible(await liveAccessRule(tx, d, now));
      const { payMinutes } = windowsFor(d, await this.tierWindows(tx, d.id), e.tier);
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
   * previous choice, each with its price now. Audited `drop.live.addons` with their ids.
   */
  async setAddons(accountId: string, dropId: string, addonIds: readonly string[], actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    if (!Array.isArray(addonIds) || addonIds.length > LIVE_ADDONS_MAX) throw addonUnknown();
    const wanted = [...new Set(addonIds.map((a) => knownId(a, addonUnknown)))].sort();
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'share');
      const e = await this.runningHold(tx, d, account, now);
      const addons = wanted.length ? await tx.selectFrom('live_addons').select(['id', 'price_minor']).where('drop_id', '=', id).where('id', 'in', wanted).execute() : [];
      if (addons.length !== wanted.length) throw addonUnknown();
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      if (addons.length) await tx.insertInto('live_entry_addons').values(addons.map((a) => ({ entry_id: e.id, addon_id: a.id, price_minor: a.price_minor }))).execute();
      await this.audit.record({ actor, action: 'drop.live.addons', targetType: 'drop', targetId: id, details: { entryId: e.id, addonIds: wanted } }, tx);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /**
   * PAY (a placeholder for now): the held piece CONFIRMED, and its orders created in the same transaction, one per piece,
   * RESERVED (services/orders.ts ordersForLiveEntry: each holds a piece in stock or one to make), which ORBES Client
   * Services follows to their delivery. Its hold must be running (409 LIVE_HOLD_ENDED). The last piece confirmed ends
   * the release, SOLD_OUT. Audited `drop.live.confirm`, and `order.create` for each order.
   */
  async confirm(accountId: string, dropId: string, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update');
      const e = await this.runningHold(tx, d, account, now);
      await tx.updateTable('live_entries').set({ status: 'CONFIRMED', confirmed_at: now }).where('id', '=', e.id).where('status', '=', 'SECURED').execute();
      const notes: AuditRecordInput[] = [{ actor, action: 'drop.live.confirm', targetType: 'drop', targetId: id, details: { entryId: e.id, quantity: e.quantity } }];
      await this.settleEnd(tx, d, now, notes);
      notes.push(...(await ordersForLiveEntry(tx, e.id, actor, now)).notes);
      await this.record(tx, notes);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  /** RELEASE MY PLACE: the held piece given back (RELEASED, add-ons dropped); the next in line gets it. Audited `drop.live.release`. */
  async release(accountId: string, dropId: string, actor: Actor): Promise<LiveEntryView> {
    const account = assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    await inTransaction(this.db, async (tx) => {
      await this.actingAccount(tx, account);
      const { d, now } = await this.lockAnnouncedLive(tx, id, 'update');
      const e = await this.runningHold(tx, d, account, now);
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      await tx.updateTable('live_entries').set({ status: 'RELEASED', ended_at: now }).where('id', '=', e.id).where('status', '=', 'SECURED').execute();
      await this.giveTurnsNow(tx, d, now);
      await this.audit.record({ actor, action: 'drop.live.release', targetType: 'drop', targetId: id, details: { entryId: e.id } }, tx);
    });
    return (await this.viewerEntry(this.db, account, id))!;
  }

  // ── The console's controls (OPERATOR; END and REMOVE: ADMIN, by the routes) ─

  /** PAUSE a release that has opened and not ended: no new turn, the deadlines frozen. Audited `drop.live.pause`. */
  async pause(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'pause a release');
    return this.control(dropId, async (tx, d, now) => {
      if (now.getTime() < d.opens_at.getTime()) throw liveNotStarted();
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      if (d.paused_at) throw alreadyPaused();
      await tx.updateTable('drops').set({ paused_at: now }).where('id', '=', d.id).execute();
      await this.audit.record({ actor, action: 'drop.live.pause', targetType: 'drop', targetId: d.id, details: {} }, tx);
    });
  }

  /** RESUME: every running turn and hold moved by the time paused, then turns again. Audited `drop.live.resume` with the time paused. */
  async resume(dropId: string, actor: Actor): Promise<LiveReleaseState> {
    assertStaff(actor, 'resume a release');
    return this.control(dropId, async (tx, d, now) => {
      if (!d.paused_at) throw notPaused();
      const pausedMs = await this.unpause(tx, d, now);
      await this.giveTurnsNow(tx, d, now);
      await this.audit.record({ actor, action: 'drop.live.resume', targetType: 'drop', targetId: d.id, details: { pausedMs } }, tx);
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
   * setting until then) to the end: its stock and the release's quantity raised; a turn goes at
   * once to whoever they serve. Audited `drop.live.stock` with the stock before and after, and the quantity line the
   * announcement promised (the plan's choice 36: every addition reported).
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
      const s = await tx.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', d.id).where('id', '=', size).forUpdate().executeTakeFirst();
      if (!s) throw sizeUnknown();
      if (s.stock + pieces > LIVE_SIZE_STOCK_MAX || d.quantity + pieces > DROP_QUANTITY_MAX) {
        throw validationError(`A size holds at most ${LIVE_SIZE_STOCK_MAX} pieces, a release ${DROP_QUANTITY_MAX}.`);
      }
      await tx.updateTable('drop_sizes').set({ stock: s.stock + pieces }).where('id', '=', s.id).execute();
      await tx.updateTable('drops').set({ quantity: d.quantity + pieces }).where('id', '=', d.id).execute();
      await this.giveTurnsNow(tx, d, now);
      await this.audit.record(
        {
          actor,
          action: 'drop.live.stock',
          targetType: 'drop',
          targetId: d.id,
          details: { sizeId: s.id, size: s.label, pieces, before: s.stock, after: s.stock + pieces, quantity: d.quantity + pieces, quantityLine: d.quantity_line },
        },
        tx,
      );
    });
  }

  /**
   * FREE A HOLD: a SECURED entry EXPIRED now (at its deadline when that has already passed, the engine not having marked
   * it yet), its add-ons dropped; the next in line gets the piece. Audited `drop.live.free`.
   */
  async freeHold(dropId: string, entryId: string, actor: Actor): Promise<AdminLiveEntry> {
    assertStaff(actor, 'free a hold');
    return this.entryControl(dropId, entryId, async (tx, d, e, now) => {
      if (e.status !== 'SECURED') throw entryNotSecured();
      const ranOut = effectiveDeadline(e.hold_expires_at!, d, now).getTime() <= now.getTime();
      await tx.deleteFrom('live_entry_addons').where('entry_id', '=', e.id).execute();
      await tx.updateTable('live_entries').set({ status: 'EXPIRED', ended_at: ranOut ? e.hold_expires_at : now }).where('id', '=', e.id).execute();
      await this.giveTurnsNow(tx, d, now);
      await this.audit.record({ actor, action: 'drop.live.free', targetType: 'drop', targetId: d.id, details: { entryId: e.id } }, tx);
    });
  }

  /**
   * LET IN: a QUEUED entry takes its turn now, out of order, within the free pieces of its size (409
   * LIVE_NO_FREE_PIECE), while the release is live and not paused. Audited `drop.live.let_in` with its place.
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
      const total = (await this.sizeTotals(tx, d.id)).find((s) => s.id === entry.size_id)!;
      if (entry.quantity > freeOf(total)) throw noFreePiece();
      await this.grant(tx, d, [entry], now, admin);
      notes.push({ actor, action: 'drop.live.let_in', targetType: 'drop', targetId: d.id, details: { entryId: entry.id, position: entry.position } });
      await this.record(tx, notes);
    });
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
    return this.control(dropId, async (tx, d, now) => {
      if (d.ended_at || now.getTime() >= d.closes_at.getTime()) throw liveEnded();
      const resumed = d.paused_at ? await this.unpause(tx, d, now) : null;
      const notes: AuditRecordInput[] = [];
      await this.endRelease(tx, d, 'ENDED', now, actor, resumed === null ? {} : { pausedMs: resumed }, notes);
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
      await tx.updateTable('live_entries').set({ status: 'REMOVED', removed_by: admin, removed_at: at, ended_at: at }).where('id', '=', e.id).execute();
      if (e.status === 'TURN' || e.status === 'SECURED') await this.giveTurnsNow(tx, d, now);
      await this.audit.record({ actor, action: 'drop.live.remove', targetType: 'drop', targetId: d.id, details: { entryId: e.id, from: e.status } }, tx);
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
   * One pass of the engine on one release, in one transaction, its row FOR UPDATE: the line at T0, the turns and holds
   * that ran out (not while paused), the end (SOLD_OUT, CLOSED), then the turns. Null when it is not a live LIVE
   * RELEASE (any more).
   */
  async advance(dropId: string, db: Db = this.db): Promise<LiveAdvance | null> {
    const id = knownId(dropId, dropNotFound);
    return inTransaction(db, async (tx) => {
      const d = await tx.selectFrom('drops').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!d || d.mode !== 'LIVE' || !d.published_at || d.cancelled_at) return null;
      const now = this.clock();
      const out: LiveAdvance = { dropId: id, queued: 0, missed: 0, expired: 0, turns: 0, ended: null };
      if (now.getTime() < d.opens_at.getTime()) return out;
      const notes: AuditRecordInput[] = [];
      out.queued = await this.formLine(tx, d, now, notes);
      if (!d.paused_at) {
        const missed = await tx
          .updateTable('live_entries')
          .set((eb) => ({ status: 'MISSED', ended_at: eb.ref('turn_expires_at') }))
          .where('drop_id', '=', id)
          .where('status', '=', 'TURN')
          .where('turn_expires_at', '<=', now)
          .returning('id')
          .execute();
        const expired = await tx
          .updateTable('live_entries')
          .set((eb) => ({ status: 'EXPIRED', ended_at: eb.ref('hold_expires_at') }))
          .where('drop_id', '=', id)
          .where('status', '=', 'SECURED')
          .where('hold_expires_at', '<=', now)
          .returning('id')
          .execute();
        if (expired.length) await tx.deleteFrom('live_entry_addons').where('entry_id', 'in', expired.map((e) => e.id)).execute();
        out.missed = missed.length;
        out.expired = expired.length;
      }
      out.ended = await this.settleEnd(tx, d, now, notes);
      out.turns = await this.giveTurnsNow(tx, d, now);
      await this.record(tx, notes);
      return out;
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The audit entries of a transaction, written last: no row is locked after the audit chain's lock. */
  private async record(tx: Db, notes: readonly AuditRecordInput[]): Promise<void> {
    for (const n of notes) await this.audit.record(n, tx);
  }

  /** An ACTIVE account, its row FOR SHARE (a lock under way finishes first; 403 ACCOUNT_LOCKED once locked). */
  private async actingAccount(tx: Db, accountId: string): Promise<void> {
    const account = await readActingAccount(tx, accountId);
    if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
  }

  /** A published LIVE RELEASE's row, FOR UPDATE or FOR SHARE; anything else is the same 404 as an unknown release. */
  private async lockLive(tx: Db, id: string, lock: Lock): Promise<LiveDrop> {
    const q = tx.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').where('published_at', 'is not', null);
    const d = await (lock === 'update' ? q.forUpdate() : q.forShare()).executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  /**
   * A customer's action: the release's row (lockLive), then the clock; before its announcement the same 404 as an
   * unknown release, whatever else is true of it (a cancellation included), so an id says nothing of a release to come.
   */
  private async lockAnnouncedLive(tx: Db, id: string, lock: Lock): Promise<{ d: LiveDrop; now: Date }> {
    const d = await this.lockLive(tx, id, lock);
    const now = this.clock();
    if (!isAnnounced(d, now)) throw dropNotFound();
    return { d, now };
  }

  /** A LIVE RELEASE's row FOR UPDATE, published or not; anything else is the same 404 as an unknown release. */
  private async lockAnyLive(tx: Db, id: string): Promise<LiveDrop> {
    const d = await tx.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').forUpdate().executeTakeFirst();
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
    if (e.status !== 'SECURED') throw notSecured();
    if (effectiveDeadline(e.hold_expires_at!, d, now).getTime() <= now.getTime()) throw holdEnded();
    return e;
  }

  /** A size of the release (with stock) and a quantity within `per_account` and that stock. */
  private async choice(tx: Db, d: LiveDrop, sizeId: string, quantity: number | undefined): Promise<{ size: { id: string; stock: number }; quantity: number }> {
    const sid = knownId(sizeId, sizeUnknown);
    const size = await tx.selectFrom('drop_sizes').select(['id', 'stock']).where('drop_id', '=', d.id).where('id', '=', sid).executeTakeFirst();
    if (!size) throw sizeUnknown();
    if (size.stock < 1) throw sizeSoldOut();
    const max = d.per_account ?? LIVE_PER_ACCOUNT.default;
    const q = quantity ?? 1;
    if (!Number.isInteger(q) || q < 1 || q > max) throw quantityInvalid(max);
    if (q > size.stock) throw sizeSoldOut();
    return { size, quantity: q };
  }

  private async lastPosition(tx: Db, dropId: string): Promise<number> {
    const r = await tx.selectFrom('live_entries').select((eb) => eb.fn.max('position').as('top')).where('drop_id', '=', dropId).executeTakeFirstOrThrow();
    return Number(r.top ?? 0);
  }

  private async tierWindows(tx: Db, dropId: string): Promise<LiveTierWindow[]> {
    return tx.selectFrom('live_tier_windows').select(['tier', 'turn_seconds', 'pay_minutes']).where('drop_id', '=', dropId).execute();
  }

  /** Each size of the release with the quantities of its entries in TURN, SECURED and CONFIRMED. */
  private async sizeTotals(tx: Db, dropId: string): Promise<SizeTotal[]> {
    const sizes = await tx.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', dropId).orderBy('position').execute();
    const held = await tx
      .selectFrom('live_entries')
      .select((eb) => ['size_id', 'status', eb.fn.sum<number>('quantity').as('n')])
      .where('drop_id', '=', dropId)
      .where('status', 'in', [...LIVE_HOLDING_STATUSES])
      .groupBy(['size_id', 'status'])
      .execute();
    return sizes.map((s) => {
      const of = (status: LiveEntryStatus) => Number(held.find((h) => h.size_id === s.id && h.status === status)?.n ?? 0);
      return { id: s.id, label: s.label, stock: s.stock, turn: of('TURN'), secured: of('SECURED'), confirmed: of('CONFIRMED') };
    });
  }

  /**
   * The line: at T0 (no place given yet) every WAITING entry, its tier read now, ordered by `lineOrder`, places from 1,
   * `queued_at` T0 (noted for the audit log: `drop.live.queue`); afterwards an entry still WAITING (another instance's clock put it
   * before T0 after the line formed) goes behind, by arrival. Returns the entries placed.
   */
  private async formLine(tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[]): Promise<number> {
    const waiting = await tx.selectFrom('live_entries').select(['id', 'account_id', 'tier', 'joined_at']).where('drop_id', '=', d.id).where('status', '=', 'WAITING').execute();
    if (waiting.length === 0) return 0;
    const start = await this.lastPosition(tx, d.id);
    let placed: { id: string; tier: number; queuedAt: Date }[];
    if (start === 0) {
      const standings = await clubStandings(tx, waiting.map((w) => w.account_id), now);
      const seed = openDropSeed(this.seedKey, d);
      try {
        placed = lineOrder(
          waiting.map((w) => ({ id: w.id, tier: standings.get(w.account_id.toLowerCase())?.tier ?? 0, queuedAt: maxDate(d.opens_at, w.joined_at) })),
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
    if (start === 0) notes.push({ actor: SYSTEM_ACTOR, action: 'drop.live.queue', targetType: 'drop', targetId: d.id, details: { entries: placed.length } });
    return placed.length;
  }

  /**
   * The end that is due, begun now: SOLD_OUT when every piece is confirmed (at the last confirmation, before the close),
   * CLOSED once `closes_at` has passed (at `closes_at`). A pause in progress ends with it, the deadlines moved as by
   * RESUME (a turn in progress may still be secured, a hold confirmed, until its deadline). Returns its reason, or null.
   */
  private async settleEnd(tx: Db, d: LiveDrop, now: Date, notes: AuditRecordInput[]): Promise<LiveEndReason | null> {
    if (d.ended_at) return null;
    const totals = await this.sizeTotals(tx, d.id);
    const stock = totals.reduce((n, s) => n + s.stock, 0);
    const confirmed = totals.reduce((n, s) => n + s.confirmed, 0);
    let soldOutAt: Date | null = null;
    if (stock > 0 && confirmed >= stock) {
      const last = await tx.selectFrom('live_entries').select((eb) => eb.fn.max('confirmed_at').as('at')).where('drop_id', '=', d.id).executeTakeFirstOrThrow();
      soldOutAt = last.at ? new Date(last.at as Date) : now;
    }
    const reason: LiveEndReason | null = soldOutAt && soldOutAt.getTime() < d.closes_at.getTime() ? 'SOLD_OUT' : now.getTime() >= d.closes_at.getTime() ? 'CLOSED' : null;
    if (!reason) return null;
    const pausedMs = d.paused_at ? await this.unpause(tx, d, now) : null;
    await this.endRelease(tx, d, reason, reason === 'SOLD_OUT' ? soldOutAt! : d.closes_at, SYSTEM_ACTOR, pausedMs === null ? {} : { pausedMs }, notes);
    return reason;
  }

  /**
   * Begin the end at `at`: `ended_at` and its reason on the release (and on `d`); WAITING and QUEUED entries ENDED, and
   * TURN ones too for an ADMIN's END. Noted for the audit log: `drop.live.end` with the reason and the entries ended.
   */
  private async endRelease(tx: Db, d: LiveDrop, reason: LiveEndReason, at: Date, actor: Actor, extra: Record<string, unknown>, notes: AuditRecordInput[]): Promise<void> {
    const statuses: LiveEntryStatus[] = reason === 'ENDED' ? ['WAITING', 'QUEUED', 'TURN'] : ['WAITING', 'QUEUED'];
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
    notes.push({ actor, action: 'drop.live.end', targetType: 'drop', targetId: d.id, details: { reason, at: at.toISOString(), ended: ended.length, ...extra } });
  }

  /**
   * End a pause: the turns and holds still running when it began moved by its length (one that had already run out,
   * the engine not having marked it yet, keeps its deadline and is marked at it), the length added to
   * `paused_ms_total`. Returns it.
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
    await tx.updateTable('drops').set({ paused_at: null, paused_ms_total: sql<number>`paused_ms_total + ${pausedMs}::bigint` }).where('id', '=', d.id).execute();
    d.paused_at = null;
    d.paused_ms_total = Number(d.paused_ms_total) + pausedMs;
    return pausedMs;
  }

  /**
   * The turns due now, when the release is live (T0 passed, not ended, not paused, before its close): for each size with
   * free pieces, its QUEUED entries by place; one that wants more than the size can still give is passed over, the
   * first that fits takes a turn, one that does not fit yet stops the size. Returns the turns given.
   */
  private async giveTurnsNow(tx: Db, d: LiveDrop, now: Date): Promise<number> {
    if (now.getTime() < d.opens_at.getTime() || d.ended_at || d.paused_at || now.getTime() >= d.closes_at.getTime()) return 0;
    const open = (await this.sizeTotals(tx, d.id)).filter((s) => freeOf(s) > 0);
    if (open.length === 0) return 0;
    const queued = await tx
      .selectFrom('live_entries')
      .select([...ENTRY_COLUMNS])
      .where('drop_id', '=', d.id)
      .where('status', '=', 'QUEUED')
      .where('size_id', 'in', open.map((s) => s.id))
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
    if (grants.length) await this.grant(tx, d, grants, now, null);
    return grants.length;
  }

  /** Turns for `entries` (QUEUED), each with its tier's turn window and its secret's hash; `letInBy` for a LET IN. */
  private async grant(tx: Db, d: LiveDrop, entries: readonly EntryRow[], now: Date, letInBy: string | null): Promise<void> {
    const overrides = await this.tierWindows(tx, d.id);
    for (let i = 0; i < entries.length; i += 500) {
      const values = sql.join(
        entries.slice(i, i + 500).map((e) => {
          const expires = new Date(now.getTime() + windowsFor(d, overrides, e.tier).turnSeconds * 1000);
          return sql`(${e.id}::uuid, ${expires}::timestamptz, ${turnTokenHash(liveTurnToken(this.turnKey, e.id, now))}::bytea)`;
        }),
      );
      await sql`
        UPDATE live_entries AS e
           SET status = 'TURN', turn_at = ${now}::timestamptz, turn_expires_at = v.expires, turn_token_hash = v.hash, let_in_by = ${letInBy}::uuid
          FROM (VALUES ${values}) AS v(id, expires, hash)
         WHERE e.id = v.id AND e.drop_id = ${d.id} AND e.status = 'QUEUED'`.execute(tx);
    }
  }

  /** A console control on a published LIVE RELEASE, under its row lock (FOR UPDATE); returns its state after. */
  private async control(dropId: string, fn: (tx: Db, d: LiveDrop, now: Date) => Promise<void>): Promise<LiveReleaseState> {
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const d = await this.lockLive(tx, id, 'update');
      const now = this.clock();
      if (d.cancelled_at) throw liveCancelled();
      await fn(tx, d, now);
      return this.releaseState(tx, id);
    });
  }

  /** A console control on an entry of a published LIVE RELEASE: the release's row, then the entry's (FOR UPDATE). */
  private async entryControl(dropId: string, entryId: string, fn: (tx: Db, d: LiveDrop, e: EntryRow, now: Date) => Promise<void>): Promise<AdminLiveEntry> {
    const id = knownId(dropId, dropNotFound);
    const eid = knownId(entryId, entryNotFound);
    return inTransaction(this.db, async (tx) => {
      const d = await this.lockLive(tx, id, 'update');
      const now = this.clock();
      if (d.cancelled_at) throw liveCancelled();
      const e = await tx.selectFrom('live_entries').select([...ENTRY_COLUMNS]).where('id', '=', eid).where('drop_id', '=', id).forUpdate().executeTakeFirst();
      if (!e) throw entryNotFound();
      await fn(tx, d, e, now);
      return this.adminEntry(tx, d, eid, now);
    });
  }

  private async releaseState(db: Db, id: string): Promise<LiveReleaseState> {
    const d = await db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const sizes = await db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', id).orderBy('position').execute();
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
      sizes: sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock })),
    };
  }

  private async adminEntry(db: Db, d: LiveDrop, entryId: string, now: Date): Promise<AdminLiveEntry> {
    const r = await db
      .selectFrom('live_entries as e')
      .innerJoin('accounts as a', 'a.id', 'e.account_id')
      .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
      .select([
        'e.id', 'e.account_id', 'a.email', 'e.status', 'e.size_id', 's.label', 'e.quantity', 'e.tier', 'e.position', 'e.joined_at', 'e.turn_at',
        'e.turn_expires_at', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at', 'e.gesture_ms', 'e.let_in_by',
      ])
      .where('e.id', '=', entryId)
      .executeTakeFirstOrThrow();
    const running = await db.selectFrom('drops').select('paused_at').where('id', '=', d.id).executeTakeFirstOrThrow();
    return {
      id: r.id,
      accountId: r.account_id,
      email: r.email,
      status: r.status,
      size: { id: r.size_id, label: r.label },
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
    return r ? { dropId: r.drop_id, size: { id: r.size_id, label: r.label }, since: r.created_at } : null;
  }
}

/** Whether a release is announced at `now` (its announcement, or its publication). */
export function isAnnounced(d: Pick<DropRow, 'announce_at' | 'published_at'>, now: Date): boolean {
  const at = announcedAt(d);
  return at !== null && now.getTime() >= at.getTime();
}

const maxDate = (a: Date, b: Date): Date => (new Date(a).getTime() >= new Date(b).getTime() ? new Date(a) : new Date(b));
