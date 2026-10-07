/**
 * Drops: a model released in a limited number of pieces, on a waiting list,
 * then drawn by tier (P-R03; API §8.9, §10.10, §16.19; DATABASE §5.29, §5.30).
 *
 * A drop is created by the console (OPERATOR) as a DRAFT, edited freely until
 * it is published; published, only its description changes, and it is
 * cancelled only before its draw. Its price (plan NOCTURNE, addition 5;
 * migration 0024) is optional, with its currency: shown on its card and page,
 * and taken by the order of each entry Client Services confirms
 * (orderForDrawEntry). Its state is computed (`dropState`):
 *
 *   DRAFT      not published: nowhere but the console;
 *   UPCOMING   published, before `opens_at` (its early access, P-X02, at
 *              the end of it: see below);
 *   OPEN       `opens_at` ≤ now < `closes_at`: any ORBES account enters;
 *   CLOSED     after `closes_at`, not drawn yet;
 *   DRAWN      the draw has run (ADMIN), its seed revealed;
 *   CANCELLED  cancelled before its draw.
 *
 * Entries (routes/club.ts): ENTER and WITHDRAW need a signed-in ORBES account
 * (any: an account that holds no piece is drawn after the tiers). Both take
 * the account's row FOR SHARE (a lock under way finishes first: a LOCKED
 * account is refused), then the drop's FOR SHARE, and are refused once
 * `drawn_at` is set (the draw takes the drop FOR UPDATE). WITHDRAW changes
 * the status of the row; an entry again sets the same row, with the same
 * id, back to ENTERED: never a deletion and a new row, which would let a
 * draw be run again with other ids.
 *
 * The early access (P-X02; by tier since plan NEXT-NINE, BP-19 T3, migration
 * 0026): `early_access_hours` before `opens_at` for PALLADIUM and
 * `early_access_platine_hours` for PLATINE (NULL, a drop published before:
 * PALLADIUM's time), 0 to 336 each, PLATINE's never longer; 0: none. A new
 * draw takes them from THE PROGRAM (services/club-program.ts: 4 and 2 hours
 * by default) unless the console gives its own. From the drop's publication
 * at the earliest (`earlyAccessOpensAt`, by tier), an account PLATINE or
 * PALLADIUM (the club's tier 2 or 3, read by `tierOf` at the moment of its
 * request) RESERVES a place directly from its tier's time (`reserve`): its
 * entry is SELECTED at once,
 * the place held for `purchase_window_hours` (`respond_by`), with the tier
 * and seniority of that moment and no rank. First come, first served,
 * under the drop's row lock (FOR UPDATE), within `quantity`: once the
 * places held or sold (SELECTED, CONFIRMED) reach it, the drop is full
 * (409 DROP_FULL). Any other account waits for `opens_at`, as does a
 * reservation asked outside that window (409) or by a lower tier (403).
 * From `opens_at` on, the places left follow the draw: the entries, then
 * the draw after `closes_at`, which draws only `quantity` less the places
 * held or sold. A reservation is never withdrawn by its account; ORBES
 * Client Services concludes it (CONFIRMED) or lets it lapse after its time
 * (LAPSED), as a place drawn, and its place then returns to the draw.
 *
 * The draw (ADMIN, a phrase typed in the console): refused before
 * `closes_at`, and a second time. Its seed, 32 random bytes, was drawn at
 * the drop's creation, sealed (`seed_enc`, a key derived from
 * KEY_ENCRYPTION_KEY like the console's TOTP secrets, the drop's id as
 * associated data) and committed by its SHA-256 (`seed_hash`), which the
 * public page shows from the publication on; no route returns the seed
 * before the draw, which stores it in clear and publishes it. Every entry
 * still ENTERED takes part: its account's tier and seniority are read at
 * that moment (club.ts `clubStandings`), never at entry, so pieces borrowed
 * for the entry count for nothing. The order (`drawOrder`): the tier
 * (descending), the seniority (descending), then
 * `sha256(32 bytes of the seed ‖ the entry's id in lower-case ASCII)` in
 * hexadecimal (ascending), ties by id. The places left (`quantity` less the
 * entries SELECTED or CONFIRMED already: the direct reservations of the
 * early access, P-X02) go SELECTED, held for
 * `purchase_window_hours` (`respond_by`); the others WAITLISTED; each keeps
 * its rank. With fewer entries than places, every one is SELECTED. The
 * public page then lists every entry drawn by its id, tier, seniority and
 * rank: anyone can check the order from the seed.
 *
 * After the draw, the console (OPERATOR, under the drop's lock): CONFIRMED
 * (the sale concluded by ORBES Client Services, its order created in the same
 * transaction: services/orders.ts orderForDrawEntry), LAPSED (only once
 * `respond_by` has passed: 409 before), and OFFER NEXT (the first of the
 * waiting list by rank, only while SELECTED and CONFIRMED stay under
 * `quantity`). A selection obliges no one: ORBES Client Services concludes
 * each sale; no email is sent (the account's page says it).
 *
 * THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01; services/guarantees.ts, migration 0029): a place granted by ORBES
 * Client Services and set aside for the release. Its holder's entry uses it (ENTER: `guarantee_id` and its `pieces`,
 * read after the entry's row; WITHDRAW and a lock unbind it, the guarantee staying ACTIVE). During its holder's own early
 * access, RESERVE uses it at once: SELECTED for its pieces, with no tier, the guarantee USED. Early access never takes a
 * guaranteed piece (DROP_FULL counts them), and a DRAFT's quantity never goes below them (409 DROP_GUARANTEES_EXCEED).
 * At the draw, the guaranteed entries are SELECTED first, without a rank or a tier, their guarantees USED; `drawOrder`
 * ranks only the other entries, for the places left (the quantity less the pieces held or sold and those just
 * selected); the guarantees set aside and not used are carried to the next release of their model or collection, or
 * expire with a chosen release (as at a cancellation). The page lists them apart once drawn (`guaranteed`: each entry's
 * id and pieces, never an account). CONFIRMED creates one order per piece (orderForDrawEntry). Every count of places
 * held is in pieces.
 *
 * A LIVE RELEASE (services/live.ts, migration 0021) is a row of the same table, `mode` LIVE: the draw's public pages, its
 * entries (ENTER, WITHDRAW, RESERVE), the console's list, change, publication and cancellation, the draw and OFFER NEXT
 * know only the drops whose `mode` is DRAW: a LIVE one is left out of a list, a 404 or a refusal (409 DROP_LIVE).
 *
 * The audit log names the drop and the entry's id, never an email: ENTER,
 * WITHDRAW and a direct reservation (`drop.enter`, `drop.withdraw`,
 * `drop.reserve` with the tier that allowed it, the account as actor), the draw
 * (`drop.draw`, with the seed it reveals and the guaranteed places and pieces) and every console action
 * (`drop.create`, `drop.update`, `drop.publish`, `drop.cancel`,
 * `drop.entry.confirm`, `drop.entry.lapse`, `drop.entry.offer`). A lock of
 * an account (OwnerService) withdraws its open entries
 * (`withdrawAccountEntries`).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { fromBase64Url, toHex, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey, open, seal } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { DropEntryStatus, DropRow, DropUpdate } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { CLUB_TIER_THRESHOLDS, clubStandings, tierName, tierOf, type ClubTier } from './club.js';
import { readProgram } from './club-program.js';
import { coverOnPublish, guaranteedPieces, holderGuarantee, releaseCovered, releaseGuaranteed, useGuarantees, type ReleaseGuaranteed } from './guarantees.js';
import { storyFingerprint } from './lookbook.js';
import { mediaUrl } from './media.js';
import { ORDER_AMOUNT_MAX_MINOR, ORDER_CURRENCIES, orderForDrawEntry } from './orders.js';
import { readActingAccount } from './ownership.js';

// ── Rules ──────────────────────────────────────────────────────────────────

export const DROP_STATES = ['DRAFT', 'UPCOMING', 'OPEN', 'CLOSED', 'DRAWN', 'CANCELLED'] as const;
export type DropState = (typeof DROP_STATES)[number];
/** What the public reads of a drop: a DRAFT is nowhere. */
export type PublicDropState = Exclude<DropState, 'DRAFT'>;

/** The seed of a draw: 32 random bytes, drawn at the drop's creation. */
export const DROP_SEED_BYTES = 32;
export const DROP_TITLE_MAX = 120;
export const DROP_DESCRIPTION_MAX = 2000;
/** The pieces a drop releases: 1 to 10 000 (the database asks for 1 at least; the request schema bounds the rest). */
export const DROP_QUANTITY_MAX = 10_000;
/** How long a place drawn is held, in hours: 1 to 336 (14 days), 48 by default (drop_entries.respond_by). */
export const PURCHASE_WINDOW_HOURS = Object.freeze({ min: 1, max: 336, default: 48 });
/**
 * The early access of a drop (P-X02), in hours before `opens_at`, PALLADIUM's (`early_access_hours`) and PLATINE's
 * (`early_access_platine_hours`, never longer): 0 (none) to 336 (14 days). The defaults of a new draw come from THE
 * PROGRAM (plan NEXT-NINE, BP-19 T3: 4 and 2 hours), set per drop.
 */
export const EARLY_ACCESS_HOURS = Object.freeze({ min: 0, max: 336 });
/** The lowest tier that reserves a place directly during an early access: PLATINE (then PALLADIUM). */
export const EARLY_ACCESS_MIN_TIER: ClubTier = 2;
/** The console's note on an entry it concludes (CONFIRMED, LAPSED). */
export const DROP_NOTE_MAX = 500;
/**
 * A draw's price (plan NOCTURNE, addition 5; migration 0024): 0 to 1 000 000.00 in minor units (an order's bound,
 * services/orders.ts ORDER_AMOUNT_MAX_MINOR), in one of the house's currencies (ORDER_CURRENCIES), or none. Shown on
 * the draw's card and page; an order of the draw takes it.
 */
export const DRAW_PRICE_MAX_MINOR = 100_000_000;
/** The public list of drops: the latest by their opening. */
export const DROP_LIST_LIMIT = 50;
/** An account's entries in the club's status: the latest drops first. */
export const ACCOUNT_ENTRIES_LIMIT = 50;

const HOUR_MS = 3_600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SEED_KEY_INFO = 'orbes/drop-seed/v1';
/** Entries written per statement by the draw. */
const DRAW_CHUNK = 500;

/** The state of a drop at `now` (see the file header): CANCELLED and DRAWN first, then DRAFT, then its window. */
export function dropState(d: Pick<DropRow, 'published_at' | 'cancelled_at' | 'drawn_at' | 'opens_at' | 'closes_at'>, now: Date): DropState {
  if (d.cancelled_at) return 'CANCELLED';
  if (d.drawn_at) return 'DRAWN';
  if (!d.published_at) return 'DRAFT';
  const t = now.getTime();
  if (t < new Date(d.opens_at).getTime()) return 'UPCOMING';
  if (t < new Date(d.closes_at).getTime()) return 'OPEN';
  return 'CLOSED';
}

/** PLATINE's early access of a drop, in hours: its own, or PALLADIUM's for a drop published before (NULL). */
export function platineHoursOf(d: Pick<DropRow, 'early_access_hours'> & { early_access_platine_hours?: number | null }): number {
  return d.early_access_platine_hours === null || d.early_access_platine_hours === undefined ? Number(d.early_access_hours) || 0 : Number(d.early_access_platine_hours) || 0;
}

/**
 * When the early access of a drop begins for a tier (P-X02; plan NEXT-NINE, BP-19 T3): PALLADIUM (3, the default)
 * `opens_at − early_access_hours`, PLATINE (2) `opens_at − coalesce(early_access_platine_hours, early_access_hours)`;
 * each from its publication when that came later (nothing of a drop is open before it is published); null without one
 * (0 hours, or a drop published at or after its opening).
 */
export function earlyAccessOpensAt(
  d: Pick<DropRow, 'opens_at' | 'early_access_hours' | 'published_at'> & { early_access_platine_hours?: number | null },
  tier: 2 | 3 = 3,
): Date | null {
  const hours = tier === 3 ? Number(d.early_access_hours) || 0 : platineHoursOf(d);
  if (hours <= 0) return null;
  const opens = new Date(d.opens_at).getTime();
  const published = d.published_at ? new Date(d.published_at).getTime() : null;
  if (published !== null && published >= opens) return null;
  return new Date(Math.max(opens - hours * HOUR_MS, published ?? Number.NEGATIVE_INFINITY));
}

/**
 * Whether direct reservations are open at `now` for a tier (PALLADIUM by default: from its start): a published drop,
 * neither cancelled nor drawn, within that tier's early access.
 */
export function inEarlyAccess(
  d: Pick<DropRow, 'opens_at' | 'early_access_hours' | 'published_at' | 'cancelled_at' | 'drawn_at'> & { early_access_platine_hours?: number | null },
  now: Date,
  tier: 2 | 3 = 3,
): boolean {
  if (!d.published_at || d.cancelled_at || d.drawn_at) return false;
  const from = earlyAccessOpensAt(d, tier);
  return from !== null && now.getTime() >= from.getTime() && now.getTime() < new Date(d.opens_at).getTime();
}

/** Whether an entry is a direct reservation of the early access: a tier read at its request, and no rank (never drawn). */
export function isReservation(e: { tier: number | null; rank: number | null }): boolean {
  return e.tier !== null && e.rank === null;
}

/** The draw's key of an entry: SHA-256 of the 32 bytes of the seed followed by the entry's id in lower-case ASCII, in hexadecimal. */
export function drawKey(seed: Uint8Array, entryId: string): string {
  return createHash('sha256').update(seed).update(entryId.toLowerCase(), 'ascii').digest('hex');
}

export interface DrawCandidate {
  id: string;
  tier: ClubTier;
  seniority: number;
}

export interface DrawnCandidate extends DrawCandidate {
  /** drawKey(seed, id). */
  key: string;
  /** 1-based place in the draw's order. */
  rank: number;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The rule of the draw, as the drop's page publishes it: the tier (descending), the seniority (descending), the
 * draw's key (ascending; hexadecimal strings of one length compare as their numbers), then the id. Pure: anyone with
 * the seed and the published entries computes the same ranks.
 */
export function drawOrder(entries: readonly DrawCandidate[], seed: Uint8Array): DrawnCandidate[] {
  if (!(seed instanceof Uint8Array) || seed.length !== DROP_SEED_BYTES) throw new RangeError(`a seed is ${DROP_SEED_BYTES} bytes`);
  const keyed = entries.map((e) => ({ id: e.id.toLowerCase(), tier: e.tier, seniority: e.seniority, key: drawKey(seed, e.id) }));
  keyed.sort((a, b) => b.tier - a.tier || b.seniority - a.seniority || compare(a.key, b.key) || compare(a.id, b.id));
  return keyed.map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Purpose-bound key for the seeds of the draws: HKDF from the key-encryption key when configured (local key
 * provider), else from the cookie secret, as for the console's TOTP secrets (auth.ts `deriveTotpEncryptionKey`).
 * Changing that source makes the seeds of drops not drawn yet unreadable: their draw then fails closed (503
 * DROP_SEED_UNAVAILABLE), and such a drop is cancelled and created again.
 */
export function deriveDropSeedKey(config: Pick<AppConfig, 'keys' | 'cookieSecret'>): Uint8Array {
  const ikm = config.keys.encryptionKey ? fromBase64Url(config.keys.encryptionKey) : utf8(config.cookieSecret);
  return deriveSubkey(ikm, SEED_KEY_INFO, { salt: 'ORBES' });
}

/** The associated data a seed is sealed with: its drop, so a sealed seed cannot be moved to another drop. */
const seedAad = (dropId: string): string => `orbes/drop/${dropId.toLowerCase()}`;
const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(b).digest());

/**
 * The seed of a drop, opened with its associated data and checked against its commitment; 503 DROP_SEED_UNAVAILABLE
 * otherwise. The draw reveals it; a LIVE RELEASE (services/live.ts) orders its line at T0 with it and never reveals it.
 * The caller zeroes it once used.
 */
export function openDropSeed(seedKey: Uint8Array, d: Pick<DropRow, 'id' | 'seed_enc' | 'seed_hash'>): Uint8Array {
  let seed: Uint8Array;
  try {
    seed = open(seedKey, d.seed_enc, seedAad(d.id));
  } catch (e) {
    throw seedUnavailable(e);
  }
  const hash = sha256(seed);
  if (seed.length !== DROP_SEED_BYTES || hash.length !== d.seed_hash.length || !hash.every((b, i) => b === d.seed_hash[i])) {
    throw seedUnavailable(new Error('seed does not match its commitment'));
  }
  return seed;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Said as the verification app's page says it (verify/copy.ts RELEASES.notFound). */
export const dropNotFound = () => new DomainError('DROP_NOT_FOUND', 404, 'This release is not known to ORBES.');
const dropEntryNotFound = () => notFound('Entry', 'DROP_ENTRY_NOT_FOUND');
const dropCancelled = () => conflict('DROP_CANCELLED', 'This release has been cancelled.');
const dropDrawn = () => conflict('DROP_ALREADY_DRAWN', 'This release has been drawn: its entries no longer change.');
const dropPublished = () => conflict('DROP_PUBLISHED', 'This release is published: only its description can change.');
const dropAlreadyPublished = () => conflict('DROP_ALREADY_PUBLISHED', 'This release is already published.');
const dropWindowPast = () => conflict('DROP_WINDOW_PAST', 'Its entries would already be closed: change its dates first.');
const dropNotPublished = () => conflict('DROP_NOT_PUBLISHED', 'This release is not published.');
const dropNotClosed = () => conflict('DROP_NOT_CLOSED', 'Its entries are still open: the draw follows their close.');
const dropNotOpen = () => conflict('DROP_NOT_OPEN', 'Entries to this release are not open.');
const dropNotDrawn = () => conflict('DROP_NOT_DRAWN', 'This release has not been drawn yet.');
const alreadyEntered = () => conflict('DROP_ALREADY_ENTERED', 'You are already entered in this draw.');
const alreadyReserved = () => conflict('DROP_ALREADY_RESERVED', 'You have already reserved a place in this release.');
/** A time of a refusal: `2026-10-10 10:00 UTC`. */
const utcMinute = (t: Date) => `${t.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const earlyAccessNotOpen = (from: Date) => conflict('DROP_EARLY_ACCESS_NOT_OPEN', `Direct reservations for this release open on ${utcMinute(from)}.`);
const earlyAccessClosed = (none: boolean) =>
  conflict('DROP_EARLY_ACCESS_CLOSED', none ? 'This release offers no direct reservation: its places go to the draw.' : 'Direct reservations for this release are closed: the places left go to the draw.');
const earlyAccessOrder = () => validationError('PALLADIUM’s early access starts no later than PLATINE’s.');
const tierRequired = () =>
  new DomainError('DROP_TIER_REQUIRED', 403, `Only ${tierName(EARLY_ACCESS_MIN_TIER)} and ${tierName(3)} owners reserve a place directly: from ${CLUB_TIER_THRESHOLDS[EARLY_ACCESS_MIN_TIER - 1]} pieces held.`);
const notEntered = () => conflict('DROP_NOT_ENTERED', 'You are not entered in this draw.');
const entryNotSelected = () => conflict('DROP_ENTRY_NOT_SELECTED', 'Only an entry whose place is held can be concluded.');
const placeHeld = (until: Date) => conflict('DROP_PLACE_HELD', `The place is held until ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC: it lapses only after that time.`);
const dropFull = () => conflict('DROP_FULL', 'Every piece of this release is held or sold.');
/** IN-01: a quantity below the pieces held or guaranteed by the house. */
const guaranteesExceed = (n: number) => conflict('DROP_GUARANTEES_EXCEED', `${n} ${n === 1 ? 'piece' : 'pieces'} of this release ${n === 1 ? 'is' : 'are'} guaranteed by the house.`);
const waitlistEmpty = () => conflict('DROP_WAITLIST_EMPTY', 'No entry is left on the waiting list.');
const modelInactive = () => conflict('MODEL_INACTIVE', 'This model is no longer offered for new products.');
const dropLive = () => conflict('DROP_LIVE', 'This release is a LIVE RELEASE: it has no draw and no waiting list.');
const seedUnavailable = (cause: unknown) =>
  new DomainError('DROP_SEED_UNAVAILABLE', 503, 'The seed of this draw cannot be read: the draw cannot run.', { detail: cause instanceof Error ? cause.name : 'unknown' });

function assertStaff(actor: Actor, what: string): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
}

function assertAccount(accountId: string): void {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
}

/** The id of a drop or an entry as the routes pass it; anything else is the same 404 as an unknown one. */
function knownId(id: string, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

// ── Input ──────────────────────────────────────────────────────────────────

export interface CreateDropInput {
  modelId: string;
  title: string;
  description?: string | null;
  quantity: number;
  opensAt: Date;
  closesAt: Date;
  purchaseWindowHours?: number;
  /** P-X02: PALLADIUM's hours of early access before `opensAt` (EARLY_ACCESS_HOURS; THE PROGRAM's when omitted, 0 for none). */
  earlyAccessHours?: number;
  /** BP-19 T3: PLATINE's hours, never more than PALLADIUM's (THE PROGRAM's when omitted, within PALLADIUM's). */
  earlyAccessPlatineHours?: number;
  /** NOCTURNE (addition 5): its price in minor units with its currency, both or neither (null: none, the default). */
  priceMinor?: number | null;
  currency?: string | null;
}

/** A change of a drop: any field while it is a DRAFT; once published, `description` only. */
export interface DropChange {
  modelId?: string;
  title?: string;
  description?: string | null;
  quantity?: number;
  opensAt?: Date;
  closesAt?: Date;
  purchaseWindowHours?: number;
  earlyAccessHours?: number;
  earlyAccessPlatineHours?: number;
  /** Its price and currency, given together; null for both clears it. */
  priceMinor?: number | null;
  currency?: string | null;
}

export function cleanTitle(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > DROP_TITLE_MAX || CONTROL_CHARS.test(s) || /\n/.test(s)) throw validationError(`A title is one line of 1 to ${DROP_TITLE_MAX} characters.`);
  return s;
}

/** Plain paragraphs, line breaks as \n; '' and null clear it. */
export function cleanDescription(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('The description must be text.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') return null;
  if (CONTROL_CHARS.test(s)) throw validationError('The description contains invalid characters.');
  if (s.length > DROP_DESCRIPTION_MAX) throw validationError(`The description must be at most ${DROP_DESCRIPTION_MAX} characters.`);
  return s;
}

function cleanQuantity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > DROP_QUANTITY_MAX) throw validationError(`A release has 1 to ${DROP_QUANTITY_MAX} pieces.`);
  return v;
}

function cleanWindow(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < PURCHASE_WINDOW_HOURS.min || v > PURCHASE_WINDOW_HOURS.max) {
    throw validationError(`A place is held ${PURCHASE_WINDOW_HOURS.min} to ${PURCHASE_WINDOW_HOURS.max} hours.`);
  }
  return v;
}

function cleanEarlyAccess(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < EARLY_ACCESS_HOURS.min || v > EARLY_ACCESS_HOURS.max) {
    throw validationError(`The early access lasts ${EARLY_ACCESS_HOURS.min} to ${EARLY_ACCESS_HOURS.max} hours.`);
  }
  return v;
}

/**
 * A draw's price as the console gives it (NOCTURNE, addition 5): a whole amount of minor units (0 to
 * DRAW_PRICE_MAX_MINOR) with one of the house's currencies (ORDER_CURRENCIES), or null for both (no price); one without
 * the other is refused.
 */
export function cleanDrawPrice(minor: unknown, currency: unknown): { minor: number; currency: string } | null {
  const none = (v: unknown) => v === null || v === undefined || v === '';
  if (none(minor) && none(currency)) return null;
  if (none(minor) || none(currency)) throw validationError('A draw’s price is given with its currency, or both are cleared.');
  if (typeof minor !== 'number' || !Number.isInteger(minor) || minor < 0 || minor > Math.min(DRAW_PRICE_MAX_MINOR, ORDER_AMOUNT_MAX_MINOR)) {
    throw validationError('A draw’s price is 0 to 1 000 000.00, in cents.');
  }
  if (typeof currency !== 'string' || !(ORDER_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`A draw is priced in ${ORDER_CURRENCIES.join(', ')}.`);
  return { minor, currency };
}

export function cleanTime(v: unknown, label: string): Date {
  const d = v instanceof Date ? v : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw validationError(`${label} must be a date and time.`);
  return d;
}

function checkWindow(opensAt: Date, closesAt: Date): void {
  if (!(closesAt.getTime() > opensAt.getTime())) throw validationError('Entries close after they open.');
}

/** How the audit log records a description: its length and SHA-256, never its words (as a model's story). */
const describedAs = (description: string | null) => storyFingerprint(description);

// ── Views ──────────────────────────────────────────────────────────────────

/** The model of a drop as the public reads it: `lookbook` is the address of its sheet when the model is PUBLIC there. */
export interface PublicDropModel {
  name: string;
  type: string;
  collection: string | null;
  /** The model's reference photograph (`/api/v1/media/<sha256>`), or null. */
  imageUrl: string | null;
  /** The `<slug>` of `/verify/lookbook/<slug>` when the model is PUBLIC in the lookbook, else null. */
  lookbook: string | null;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), or null for a model without one. */
  variant: string | null;
}

/** One drop of the public list (GET /api/v1/drops). */
export interface DropCard {
  id: string;
  title: string;
  state: PublicDropState;
  model: PublicDropModel;
  quantity: number;
  opensAt: Date;
  closesAt: Date;
  /** P-X02: PALLADIUM's hours of early access before `opensAt` the drop was published with (0: none). */
  earlyAccessHours: number;
  /** BP-19 T3: PLATINE's hours (PALLADIUM's for a drop published before the windows by tier). */
  earlyAccessPlatineHours: number;
  /** When PALLADIUM may reserve a place directly (earlyAccessOpensAt), the first; null without an early access. */
  earlyAccessOpensAt: Date | null;
  /** BP-19 T3: when PLATINE may (earlyAccessOpensAt for tier 2); null without one for PLATINE. */
  earlyAccessPlatineOpensAt: Date | null;
  /** Whether direct reservations are open now (inEarlyAccess: from PALLADIUM's time). */
  earlyAccessOpen: boolean;
  /** BP-19 T3: whether PLATINE's are open now. */
  earlyAccessPlatineOpen: boolean;
  /** NOCTURNE (addition 5): the price of a piece in minor units, with its currency; null for both when ORBES gave none. */
  priceMinor: number | null;
  currency: string | null;
}

/** A drop's page (GET /api/v1/drops/:id): its rule's commitment, then, once drawn, its seed and how many entries took part. */
export interface DropSheet extends DropCard {
  description: string | null;
  /** How long a place drawn is held. */
  purchaseWindowHours: number;
  publishedAt: Date;
  cancelledAt: Date | null;
  drawnAt: Date | null;
  /** SHA-256 of the seed, in hexadecimal: published from the publication on. */
  seedHash: string;
  /** The 32-byte seed in hexadecimal, once drawn (never before). */
  seed: string | null;
  /**
   * P-X02: the places reserved directly during the early access that are held or sold (SELECTED, CONFIRMED): before
   * the draw, `quantity` less this is what remains; at `quantity`, the drop is full. 0 once drawn: the release is over,
   * and its page says no end figure (plan LIVE RELEASE+, choice 5 and decision 30), nor how many took part.
   */
  reserved: number;
  /**
   * IN-01: the places guaranteed by the house, once drawn (empty before): each entry that used a guarantee here, by its
   * id, with its pieces, selected first and listed apart without a rank. No account marker of any kind: YOURS comes only
   * from the account's own entry (AccountDropEntry `guaranteed`, true only for a guarantee shown to the client).
   */
  guaranteed: { id: string; pieces: number }[];
}

/** An entry as the drawn drop's page lists it (GET /api/v1/drops/:id/entries): never its account. */
export interface DrawEntry {
  id: string;
  tier: number;
  seniority: number;
  rank: number;
}

/** An entry of the signed-in account (GET /api/v1/club/status): its own id is the one the draw's list publishes. */
export interface AccountDropEntry {
  id: string;
  dropId: string;
  title: string;
  /** The drop's state. */
  state: PublicDropState;
  status: DropEntryStatus;
  /** When the account first entered (an entry again keeps the row and its time). */
  enteredAt: Date;
  rank: number | null;
  /** A SELECTED (or concluded) entry: the end of the place held. */
  respondBy: Date | null;
  /** P-X02: a place reserved directly during the early access (isReservation, or with the house's guarantee), not drawn. */
  reserved: boolean;
  /**
   * IN-01: the entry uses the house's guarantee and the guarantee is shown to the client; false for a guarantee not
   * shown, which leaves no mark for its holder. The only signal the app uses for YOURS among GUARANTEED BY THE HOUSE.
   */
  guaranteed: boolean;
  /** IN-01: the pieces of the place (its shown guarantee's), 1 otherwise. */
  pieces: number;
  opensAt: Date;
  closesAt: Date;
  drawnAt: Date | null;
}

/** The entries of a drop by status (the console). */
export type DropEntryCounts = Record<DropEntryStatus, number>;

/** A drop as the console reads it: never its sealed seed, nor the seed itself before the draw. */
export interface AdminDrop {
  id: string;
  title: string;
  description: string | null;
  model: { id: string; name: string; type: string; active: boolean; variant: string | null };
  quantity: number;
  opensAt: Date;
  closesAt: Date;
  purchaseWindowHours: number;
  /** P-X02: PALLADIUM's hours of early access before `opensAt` (0: none). */
  earlyAccessHours: number;
  /** BP-19 T3: PLATINE's hours (PALLADIUM's for a drop created before the windows by tier). */
  earlyAccessPlatineHours: number;
  /** NOCTURNE (addition 5): its price in minor units with its currency, or null for both (none). */
  priceMinor: number | null;
  currency: string | null;
  /** When direct reservations begin, PALLADIUM's (earlyAccessOpensAt: a DRAFT's from its opening, a published drop's not before its publication); null without one. */
  earlyAccessOpensAt: Date | null;
  /** BP-19 T3: PLATINE's; null without one. */
  earlyAccessPlatineOpensAt: Date | null;
  state: DropState;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  drawnAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
  seedHash: string;
  seed: string | null;
  entries: DropEntryCounts;
  /** P-X02: the entries SELECTED or CONFIRMED that are direct reservations (the rest of `entries` SELECTED or CONFIRMED was drawn); the guaranteed ones apart. */
  reserved: number;
  /** IN-01: the house's guarantees set aside for the release or used in it: how many places, how many pieces. */
  guaranteed: ReleaseGuaranteed;
}

/** An entry as the console lists it; the routes mask the email for an AUDITOR. */
export interface AdminDropEntry {
  id: string;
  accountId: string;
  /** As stored. */
  email: string;
  status: DropEntryStatus;
  enteredAt: Date;
  tier: number | null;
  seniority: number | null;
  rank: number | null;
  respondBy: Date | null;
  /** P-X02: a place reserved directly during the early access (its tier and seniority those of its request). */
  reserved: boolean;
  /** IN-01: the entry uses the house's guarantee (GUARANTEED: no rank, no tier). */
  guaranteed: boolean;
  /** IN-01: the pieces of its place (1, or its guarantee's). */
  pieces: number;
  handledBy: { id: string; email: string } | null;
  handledAt: Date | null;
  note: string | null;
}

/** An account's entry the lock withdrew, for its audit entry after the row locks. */
export interface WithdrawnEntry {
  dropId: string;
  entryId: string;
}

/** POST /api/admin/drops/:id/draw. */
export interface DrawOutcome {
  drop: AdminDrop;
  /** The entries that took part. */
  entries: number;
  /** The places drawn (quantity less the places already held or sold). */
  places: number;
  selected: number;
  waitlisted: number;
  /** IN-01: the guaranteed places selected first, and their pieces. */
  guaranteed: number;
  guaranteedPieces: number;
}

const EMPTY_COUNTS = (): DropEntryCounts => ({ ENTERED: 0, SELECTED: 0, WAITLISTED: 0, CONFIRMED: 0, LAPSED: 0, WITHDRAWN: 0 });

/** The state the public reads: a drop it reads is published, never a DRAFT. */
function publicState(d: Pick<DropRow, 'published_at' | 'cancelled_at' | 'drawn_at' | 'opens_at' | 'closes_at'>, now: Date): PublicDropState {
  const s = dropState(d, now);
  return s === 'DRAFT' ? 'UPCOMING' : s;
}

type EntryRow = {
  id: string;
  account_id: string;
  email: string;
  status: DropEntryStatus;
  created_at: Date;
  tier: number | null;
  seniority: number | null;
  rank: number | null;
  respond_by: Date | null;
  handled_by: string | null;
  handled_email: string | null;
  handled_at: Date | null;
  note: string | null;
  guarantee_id: string | null;
  pieces: number;
};

function entryView(r: EntryRow): AdminDropEntry {
  return {
    id: r.id,
    accountId: r.account_id,
    email: r.email,
    status: r.status,
    enteredAt: r.created_at,
    tier: r.tier,
    seniority: r.seniority,
    rank: r.rank,
    respondBy: r.respond_by,
    reserved: isReservation(r),
    guaranteed: r.guarantee_id !== null,
    pieces: r.pieces,
    handledBy: r.handled_by && r.handled_email ? { id: r.handled_by, email: r.handled_email } : null,
    handledAt: r.handled_at,
    note: r.note,
  };
}

type AccountEntryRow = Pick<DropRow, 'title' | 'opens_at' | 'closes_at' | 'published_at' | 'cancelled_at' | 'drawn_at'> & {
  id: string;
  drop_id: string;
  status: DropEntryStatus;
  created_at: Date;
  tier: number | null;
  rank: number | null;
  respond_by: Date | null;
  pieces: number;
  guarantee_id: string | null;
  guarantee_visible: boolean | null;
  guarantee_used_at: Date | null;
};

function accountEntryView(r: AccountEntryRow, now: Date): AccountDropEntry {
  // A guarantee used before the release opened was used by a direct reservation of its holder's early access.
  const guaranteedReservation = r.guarantee_id !== null && r.guarantee_used_at !== null && r.guarantee_used_at.getTime() < new Date(r.opens_at).getTime();
  const shown = r.guarantee_id !== null && r.guarantee_visible === true;
  return {
    id: r.id,
    dropId: r.drop_id,
    title: r.title,
    state: publicState(r, now),
    status: r.status,
    enteredAt: r.created_at,
    rank: r.rank,
    respondBy: r.respond_by,
    reserved: isReservation(r) || guaranteedReservation,
    guaranteed: shown,
    pieces: shown ? r.pieces : 1,
    opensAt: r.opens_at,
    closesAt: r.closes_at,
    drawnAt: r.drawn_at,
  };
}

// ── Lock of an account (OwnerService) ──────────────────────────────────────

/**
 * Withdraw the open entries of an account (ENTERED, in drops neither drawn nor cancelled), in the transaction of its
 * lock (OwnerService.lock), whose row lock on the account is already held. The drops of those entries are read FOR
 * SHARE first, as ENTER and WITHDRAW read them: a draw under way finishes before, and the entries it drew are no
 * longer open. Returns them for their audit entries, written after the lock's row locks (auditWithdrawnEntries).
 */
export async function withdrawAccountEntries(tx: Db, accountId: string): Promise<WithdrawnEntry[]> {
  assertAccount(accountId);
  const open = await tx
    .selectFrom('drop_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .select('d.id')
    .where('e.account_id', '=', accountId)
    .where('e.status', '=', 'ENTERED')
    .where('d.drawn_at', 'is', null)
    .where('d.cancelled_at', 'is', null)
    .execute();
  const dropIds = [...new Set(open.map((r) => r.id))].sort();
  if (dropIds.length === 0) return [];
  await tx.selectFrom('drops').select('id').where('id', 'in', dropIds).orderBy('id').forShare().execute();
  const rows = await tx
    .updateTable('drop_entries as e')
    .from('drops as d')
    // IN-01: a guarantee it used is unbound and stays ACTIVE (a lock does not revoke it).
    .set({ status: 'WITHDRAWN', guarantee_id: null, pieces: 1 })
    .whereRef('d.id', '=', 'e.drop_id')
    .where('e.account_id', '=', accountId)
    .where('e.status', '=', 'ENTERED')
    .where('d.drawn_at', 'is', null)
    .where('d.cancelled_at', 'is', null)
    .returning(['e.id', 'e.drop_id'])
    .execute();
  return rows.map((r) => ({ dropId: r.drop_id, entryId: r.id })).sort((a, b) => compare(`${a.dropId} ${a.entryId}`, `${b.dropId} ${b.entryId}`));
}

/** One `drop.withdraw` entry per entry a lock withdrew, by the lock's ADMIN, with its reason. */
export async function auditWithdrawnEntries(audit: AuditService, tx: Db, actor: Actor, withdrawn: readonly WithdrawnEntry[], reason: 'account_locked'): Promise<void> {
  for (const e of withdrawn) {
    await audit.record({ actor, action: 'drop.withdraw', targetType: 'drop', targetId: e.dropId, details: { entryId: e.entryId, reason } }, tx);
  }
}

/**
 * An account's entries, for its right-of-access export (OwnerService.exportData): every one, oldest first, with the note
 * ORBES Client Services added when it concluded it (the privacy policy says ORBES records it); never who concluded it.
 */
export interface ExportedDropEntry {
  entryId: string;
  dropId: string;
  title: string;
  status: DropEntryStatus;
  enteredAt: Date;
  tier: number | null;
  seniority: number | null;
  rank: number | null;
  respondBy: Date | null;
  handledAt: Date | null;
  /** The console's note on the conclusion (CONFIRMED, LAPSED); null when none was given. */
  note: string | null;
}

export async function accountDropEntries(db: Db, accountId: string): Promise<ExportedDropEntry[]> {
  assertAccount(accountId);
  const rows = await db
    .selectFrom('drop_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .select(['e.id', 'e.drop_id', 'd.title', 'e.status', 'e.created_at', 'e.tier', 'e.seniority', 'e.rank', 'e.respond_by', 'e.handled_at', 'e.note'])
    .where('e.account_id', '=', accountId)
    .orderBy('e.created_at')
    .orderBy('e.id')
    .execute();
  return rows.map((r) => ({
    entryId: r.id,
    dropId: r.drop_id,
    title: r.title,
    status: r.status,
    enteredAt: r.created_at,
    tier: r.tier,
    seniority: r.seniority,
    rank: r.rank,
    respondBy: r.respond_by,
    handledAt: r.handled_at,
    note: r.note,
  }));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface DropServiceDeps {
  db: Db;
  audit: AuditService;
  /** 32-byte key sealing the seeds (deriveDropSeedKey; the context always passes it). Without it a random per-instance key, for single-instance tests only. */
  seedKey?: Uint8Array;
  clock?: Clock;
}

type DropReadRow = DropRow & {
  model_name: string;
  model_type: string;
  model_active: boolean;
  model_image: string | null;
  model_slug: string | null;
  model_lookbook: string;
  model_variant: string | null;
  collection: string | null;
};

export class DropService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly seedKey: Uint8Array;
  private readonly clock: Clock;

  constructor(deps: DropServiceDeps) {
    const key = deps.seedKey ?? new Uint8Array(randomBytes(32));
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new RangeError('seedKey must be 32 bytes');
    this.db = deps.db;
    this.audit = deps.audit;
    this.seedKey = key;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Public ───────────────────────────────────────────────────────────────

  /**
   * The published drops still to come or under way (THE RELEASES' LIVE tab: UPCOMING, OPEN, CLOSED), the latest opening
   * first (DROP_LIST_LIMIT): never a DRAFT, nor a cancelled one; once drawn, a drop is in THE RELEASES' PAST
   * (services/past-releases.ts), its page unchanged.
   */
  async listPublic(): Promise<DropCard[]> {
    const now = this.clock();
    const rows = await this.reads(this.db)
      .where('d.published_at', 'is not', null)
      .where('d.mode', '=', 'DRAW')
      .where('d.drawn_at', 'is', null)
      .where('d.cancelled_at', 'is', null)
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .limit(DROP_LIST_LIMIT)
      .execute();
    return rows.map((r) => this.card(r, now));
  }

  /** A published drop's page; a DRAFT, an unknown or malformed id: one 404 DROP_NOT_FOUND. */
  async sheet(dropId: string): Promise<DropSheet> {
    const id = knownId(dropId, dropNotFound);
    const now = this.clock();
    const r = await this.reads(this.db).where('d.id', '=', id).where('d.published_at', 'is not', null).where('d.mode', '=', 'DRAW').executeTakeFirst();
    if (!r) throw dropNotFound();
    // Drawn, the release is over: no end figure (plan LIVE RELEASE+, choice 5), the places reserved directly no longer counted.
    const reserved = r.drawn_at ? 0 : await this.reservedPieces(this.db, id);
    // IN-01: once drawn, the places the house guaranteed, by entry id and pieces, never their accounts.
    const guaranteed = r.drawn_at
      ? (await this.db.selectFrom('drop_entries').select(['id', 'pieces']).where('drop_id', '=', id).where('guarantee_id', 'is not', null).orderBy('id').execute()).map((e) => ({ id: e.id, pieces: e.pieces }))
      : [];
    return {
      ...this.card(r, now),
      description: r.description,
      purchaseWindowHours: r.purchase_window_hours,
      publishedAt: r.published_at!,
      cancelledAt: r.cancelled_at,
      drawnAt: r.drawn_at,
      seedHash: toHex(r.seed_hash),
      seed: r.drawn_at && r.seed ? toHex(r.seed) : null,
      reserved,
      guaranteed,
    };
  }

  /** The entries a published drop's draw ranked, by rank, never their accounts (409 DROP_NOT_DRAWN before the draw). */
  async drawEntries(dropId: string, page: PageRequest): Promise<Page<DrawEntry>> {
    const id = knownId(dropId, dropNotFound);
    const d = await this.db.selectFrom('drops').select(['id', 'drawn_at']).where('id', '=', id).where('published_at', 'is not', null).where('mode', '=', 'DRAW').executeTakeFirst();
    if (!d) throw dropNotFound();
    if (!d.drawn_at) throw dropNotDrawn();
    const ranked = this.db.selectFrom('drop_entries').where('drop_id', '=', id).where('rank', 'is not', null);
    const total = await ranked.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await ranked.select(['id', 'tier', 'seniority', 'rank']).orderBy('rank').limit(page.pageSize).offset(pageOffset(page)).execute();
    return makePage(
      rows.map((r) => ({ id: r.id, tier: r.tier ?? 0, seniority: r.seniority ?? 0, rank: r.rank! })),
      Number(total.n),
      page,
    );
  }

  // ── The account (routes/club.ts) ─────────────────────────────────────────

  /** The account's entries in published drops, the latest drop first (ACCOUNT_ENTRIES_LIMIT). */
  async accountEntries(accountId: string): Promise<AccountDropEntry[]> {
    assertAccount(accountId);
    const now = this.clock();
    const rows = await this.accountEntryRows(this.db)
      .where('e.account_id', '=', accountId)
      .where('d.published_at', 'is not', null)
      .orderBy('d.opens_at', 'desc')
      .orderBy('e.id')
      .limit(ACCOUNT_ENTRIES_LIMIT)
      .execute();
    return rows.map((r) => accountEntryView(r, now));
  }

  /**
   * ENTER: the account enters an OPEN drop. A WITHDRAWN entry becomes ENTERED again, the same row and id. Refused: a
   * LOCKED account (403 ACCOUNT_LOCKED), an unknown or unpublished drop (404 DROP_NOT_FOUND), a cancelled or drawn one,
   * one not open (409), an account already entered (409 DROP_ALREADY_ENTERED), or holding a place it reserved directly
   * during the early access (409 DROP_ALREADY_RESERVED). Audited `drop.enter`.
   */
  async enter(accountId: string, dropId: string, actor: Actor): Promise<AccountDropEntry> {
    assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const entryId = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await readActingAccount(tx, accountId);
      if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const d = await this.lockPublished(tx, id);
      if (d.cancelled_at) throw dropCancelled();
      if (d.drawn_at) throw dropDrawn();
      if (dropState(d, now) !== 'OPEN') throw dropNotOpen();
      const existing = await tx.selectFrom('drop_entries').select(['id', 'status', 'tier', 'rank', 'guarantee_id']).where('drop_id', '=', id).where('account_id', '=', accountId).forUpdate().executeTakeFirst();
      // A place reserved directly (IN-01: with the house's guarantee too, then without a tier) is not entered again.
      if (existing && (isReservation(existing) || (existing.guarantee_id !== null && existing.status !== 'ENTERED' && existing.status !== 'WITHDRAWN'))) throw alreadyReserved();
      if (existing && existing.status !== 'WITHDRAWN') throw alreadyEntered();
      // IN-01: the house's guarantee set aside for this release, after the entry's row (the lock order): the entry uses it.
      const g = await holderGuarantee(tx, accountId, d);
      const bound = g ? { guarantee_id: g.id, pieces: g.pieces } : { guarantee_id: null, pieces: 1 };
      let entry: string;
      let again = false;
      if (existing) {
        await tx.updateTable('drop_entries').set({ status: 'ENTERED', ...bound }).where('id', '=', existing.id).where('status', '=', 'WITHDRAWN').execute();
        entry = existing.id;
        again = true;
      } else {
        try {
          entry = (await tx.insertInto('drop_entries').values({ drop_id: id, account_id: accountId, created_at: now, ...bound }).returning('id').executeTakeFirstOrThrow()).id;
        } catch (e) {
          if (isUniqueViolation(e, 'drop_entries_drop_account_key')) throw alreadyEntered();
          throw e;
        }
      }
      await this.audit.record(
        { actor, action: 'drop.enter', targetType: 'drop', targetId: id, details: { entryId: entry, ...(again ? { again: true } : {}), ...(g ? { guaranteeId: g.id } : {}) } },
        tx,
      );
      return entry;
    });
    return this.accountEntry(accountId, entryId);
  }

  /** WITHDRAW: the account's ENTERED entry becomes WITHDRAWN, before the draw only (409 DROP_ALREADY_DRAWN after). Audited `drop.withdraw`. */
  async withdraw(accountId: string, dropId: string, actor: Actor): Promise<AccountDropEntry> {
    assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const entryId = await inTransaction(this.db, async (tx) => {
      const account = await readActingAccount(tx, accountId);
      if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const d = await this.lockPublished(tx, id);
      if (d.drawn_at) throw dropDrawn();
      if (d.cancelled_at) throw dropCancelled();
      const before = await tx.selectFrom('drop_entries').select(['id', 'guarantee_id']).where('drop_id', '=', id).where('account_id', '=', accountId).where('status', '=', 'ENTERED').forUpdate().executeTakeFirst();
      if (!before) throw notEntered();
      // IN-01: the guarantee it used is unbound and stays ACTIVE: entering again uses it again.
      await tx.updateTable('drop_entries').set({ status: 'WITHDRAWN', guarantee_id: null, pieces: 1 }).where('id', '=', before.id).execute();
      await this.audit.record(
        { actor, action: 'drop.withdraw', targetType: 'drop', targetId: id, details: { entryId: before.id, ...(before.guarantee_id ? { guaranteeId: before.guarantee_id } : {}) } },
        tx,
      );
      return before.id;
    });
    return this.accountEntry(accountId, entryId);
  }

  /**
   * RESERVE (P-X02): during the early access of a published drop, an account PLATINE or PALLADIUM at the moment of its
   * request (tierOf, read in this transaction) holds a place at once, from its tier's time (plan NEXT-NINE, BP-19 T3:
   * earlyAccessOpensAt of its tier ≤ now < `opens_at`): its entry
   * is SELECTED, the place held for `purchase_window_hours` (`respond_by`), its tier and seniority of that moment kept,
   * no rank (the draw ranks only the entries ENTERED). First come, first served: the drop's row FOR UPDATE, so two
   * requests count the places one after the other, within `quantity` (the entries SELECTED or CONFIRMED). Refused: a
   * LOCKED account (403 ACCOUNT_LOCKED), an unknown or unpublished drop (404 DROP_NOT_FOUND), a cancelled or drawn one
   * (409), without an early access or from `opens_at` on (409 DROP_EARLY_ACCESS_CLOSED), a tier below PLATINE (403
   * DROP_TIER_REQUIRED), before its tier's time (409 DROP_EARLY_ACCESS_NOT_OPEN, with that time; none for its tier: 409
   * DROP_EARLY_ACCESS_CLOSED), an account that already holds an entry in
   * it (409 DROP_ALREADY_RESERVED), a full drop (409 DROP_FULL). Audited `drop.reserve` with the entry and its tier.
   */
  async reserve(accountId: string, dropId: string, actor: Actor): Promise<AccountDropEntry> {
    assertAccount(accountId);
    const id = knownId(dropId, dropNotFound);
    const entryId = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await readActingAccount(tx, accountId);
      if (!account || account.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
      const d = await this.lockPublished(tx, id, 'update');
      if (d.cancelled_at) throw dropCancelled();
      if (d.drawn_at) throw dropDrawn();
      const first = earlyAccessOpensAt(d);
      if (first === null || now.getTime() >= d.opens_at.getTime()) throw earlyAccessClosed(first === null);
      // The tier first, then its own window (BP-19 T3): PALLADIUM from its time, PLATINE from its own.
      const standing = await tierOf(tx, accountId, now);
      if (standing.tier < EARLY_ACCESS_MIN_TIER) throw tierRequired();
      const from = earlyAccessOpensAt(d, standing.tier === 3 ? 3 : 2);
      if (from === null) throw earlyAccessClosed(true);
      if (now.getTime() < from.getTime()) throw earlyAccessNotOpen(from);
      const existing = await tx.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', id).where('account_id', '=', accountId).forUpdate().executeTakeFirst();
      if (existing && existing.status !== 'WITHDRAWN') throw alreadyReserved();
      // IN-01: a holder's reservation uses the house's guarantee, after the entry's row (the lock order); the pieces the
      // house guarantees to others are never taken by an early access (DROP_FULL counts them).
      const g = await holderGuarantee(tx, accountId, d);
      const held = await this.heldPieces(tx, id);
      const guaranteed = await guaranteedPieces(tx, id, g?.id);
      if (held + guaranteed + (g?.pieces ?? 1) > d.quantity) throw dropFull();
      const respondBy = new Date(now.getTime() + d.purchase_window_hours * HOUR_MS);
      const place = g
        ? { status: 'SELECTED' as const, tier: null, seniority: null, respond_by: respondBy, guarantee_id: g.id, pieces: g.pieces }
        : { status: 'SELECTED' as const, tier: standing.tier, seniority: standing.seniority, respond_by: respondBy, guarantee_id: null, pieces: 1 };
      let entry: string;
      if (existing) {
        // Never a deletion and a new row: a withdrawn entry (none can be before the opening, but the rule holds) is taken up.
        await tx.updateTable('drop_entries').set(place).where('id', '=', existing.id).where('status', '=', 'WITHDRAWN').execute();
        entry = existing.id;
      } else {
        try {
          entry = (await tx.insertInto('drop_entries').values({ drop_id: id, account_id: accountId, created_at: now, ...place }).returning('id').executeTakeFirstOrThrow()).id;
        } catch (e) {
          if (isUniqueViolation(e, 'drop_entries_drop_account_key')) throw alreadyReserved();
          throw e;
        }
      }
      const notes: AuditRecordInput[] = [];
      if (g) await useGuarantees(tx, [g.id], id, now, actor, notes, 'reserve');
      await this.audit.record(
        {
          actor,
          action: 'drop.reserve',
          targetType: 'drop',
          targetId: id,
          details: { entryId: entry, tier: standing.tier, respondBy: place.respond_by.toISOString(), ...(g ? { guaranteeId: g.id, pieces: g.pieces } : {}) },
        },
        tx,
      );
      for (const n of notes) await this.audit.record(n, tx);
      return entry;
    });
    return this.accountEntry(accountId, entryId);
  }

  // ── The console (routes/admin/drops.ts) ──────────────────────────────────

  /** Every drop of the draw (a LIVE RELEASE is not one), the latest created first. */
  async list(page: PageRequest): Promise<Page<AdminDrop>> {
    const total = await this.db.selectFrom('drops').select((eb) => eb.fn.countAll<number>().as('n')).where('mode', '=', 'DRAW').executeTakeFirstOrThrow();
    const rows = await this.reads(this.db).where('d.mode', '=', 'DRAW').orderBy('d.created_at', 'desc').orderBy('d.id').limit(page.pageSize).offset(pageOffset(page)).execute();
    const tallies = await this.tallies(this.db, rows.map((r) => r.id));
    const creators = await this.staffEmails(this.db, rows.map((r) => r.created_by));
    const guaranteed = await releaseGuaranteed(this.db, rows.map((r) => r.id));
    const now = this.clock();
    return makePage(
      rows.map((r) => this.adminView(r, now, tallies.get(r.id), creators, guaranteed.get(r.id))),
      Number(total.n),
      page,
    );
  }

  /** One drop (404 DROP_NOT_FOUND). */
  get(dropId: string): Promise<AdminDrop> {
    return this.adminDrop(this.db, knownId(dropId, dropNotFound));
  }

  /**
   * A new DRAFT, its seed drawn, sealed and committed now; its early access by tier given, or THE PROGRAM's (BP-19 T3:
   * PLATINE's within PALLADIUM's). OPERATOR; audited `drop.create` with the seed's SHA-256 and both windows.
   */
  async create(input: CreateDropInput, actor: Actor): Promise<AdminDrop> {
    assertStaff(actor, 'create a release');
    const title = cleanTitle(input.title);
    const description = cleanDescription(input.description ?? null);
    const quantity = cleanQuantity(input.quantity);
    const opensAt = cleanTime(input.opensAt, 'The opening');
    const closesAt = cleanTime(input.closesAt, 'The close');
    checkWindow(opensAt, closesAt);
    const hours = cleanWindow(input.purchaseWindowHours ?? PURCHASE_WINDOW_HOURS.default);
    const givenEarly = input.earlyAccessHours === undefined ? undefined : cleanEarlyAccess(input.earlyAccessHours);
    const givenPlatine = input.earlyAccessPlatineHours === undefined ? undefined : cleanEarlyAccess(input.earlyAccessPlatineHours);
    const price = cleanDrawPrice(input.priceMinor ?? null, input.currency ?? null);
    const modelId = knownId(input.modelId, () => notFound('Model', 'MODEL_NOT_FOUND'));
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const program = await readProgram(tx);
      const early = givenEarly ?? program.earlyAccessPalladiumHours;
      // PLATINE's window as given, or THE PROGRAM's, never longer than PALLADIUM's.
      const platine = givenPlatine ?? Math.min(program.earlyAccessPlatineHours, early);
      if (platine > early) throw earlyAccessOrder();
      const model = await tx.selectFrom('models').select(['id', 'active']).where('id', '=', modelId).executeTakeFirst();
      if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (!model.active) throw modelInactive();
      const id = randomUUID();
      const seed = new Uint8Array(randomBytes(DROP_SEED_BYTES));
      const seedHash = sha256(seed);
      const sealed = seal(this.seedKey, seed, seedAad(id));
      seed.fill(0);
      await tx
        .insertInto('drops')
        .values({
          id,
          model_id: modelId,
          title,
          description,
          quantity,
          opens_at: opensAt,
          closes_at: closesAt,
          purchase_window_hours: hours,
          early_access_hours: early,
          early_access_platine_hours: platine,
          price_minor: price?.minor ?? null,
          currency: price?.currency ?? null,
          seed_enc: sealed,
          seed_hash: seedHash,
          created_by: actor.id!,
          created_at: now,
        })
        .execute();
      await this.audit.record(
        {
          actor,
          action: 'drop.create',
          targetType: 'drop',
          targetId: id,
          details: {
            modelId,
            title,
            quantity,
            opensAt: opensAt.toISOString(),
            closesAt: closesAt.toISOString(),
            purchaseWindowHours: hours,
            earlyAccessHours: early,
            earlyAccessPlatineHours: platine,
            priceMinor: price?.minor ?? null,
            currency: price?.currency ?? null,
            seedHash: toHex(seedHash),
          },
        },
        tx,
      );
      return this.adminDrop(tx, id);
    });
  }

  /**
   * Change a drop: any field while it is a DRAFT (not cancelled), its early access included (P-X02); once published,
   * its description only (409 DROP_PUBLISHED). Audited `drop.update` with each value before and after (the description
   * as its length and SHA-256); nothing changed, nothing audited.
   */
  async update(dropId: string, change: DropChange, actor: Actor): Promise<AdminDrop> {
    assertStaff(actor, 'change a release');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const d = await this.lockDraw(tx, id);
      const set: DropUpdate = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const differs = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b);
      const note = <C extends keyof DropUpdate>(key: keyof DropChange, column: C, from: unknown, to: DropUpdate[C], shown: (v: unknown) => unknown = (v) => (v instanceof Date ? v.toISOString() : v)) => {
        if (!differs(from, to)) return;
        set[column] = to;
        before[key] = shown(from);
        after[key] = shown(to);
      };
      if (change.description !== undefined) note('description', 'description', d.description, cleanDescription(change.description), (v) => describedAs((v as string | null) ?? null));
      const structural = (['modelId', 'title', 'quantity', 'opensAt', 'closesAt', 'purchaseWindowHours', 'earlyAccessHours', 'earlyAccessPlatineHours', 'priceMinor', 'currency'] as const).filter(
        (k) => change[k] !== undefined,
      );
      if (structural.length > 0) {
        if (d.cancelled_at) throw dropCancelled();
        if (d.published_at) throw dropPublished();
        if (change.title !== undefined) note('title', 'title', d.title, cleanTitle(change.title));
        if (change.quantity !== undefined) {
          const quantity = cleanQuantity(change.quantity);
          // IN-01: never below the pieces held or guaranteed by the house.
          const floor = (await this.heldPieces(tx, id)) + (await guaranteedPieces(tx, id));
          if (quantity < floor) throw guaranteesExceed(await guaranteedPieces(tx, id));
          note('quantity', 'quantity', d.quantity, quantity);
        }
        if (change.purchaseWindowHours !== undefined) note('purchaseWindowHours', 'purchase_window_hours', d.purchase_window_hours, cleanWindow(change.purchaseWindowHours));
        if (change.earlyAccessHours !== undefined || change.earlyAccessPlatineHours !== undefined) {
          // Both windows by tier (BP-19 T3): PLATINE's never longer than PALLADIUM's; a drop of before keeps its NULL
          // (PALLADIUM's time) until PLATINE's is given.
          const early = change.earlyAccessHours !== undefined ? cleanEarlyAccess(change.earlyAccessHours) : d.early_access_hours;
          const platine = change.earlyAccessPlatineHours !== undefined ? cleanEarlyAccess(change.earlyAccessPlatineHours) : d.early_access_platine_hours;
          if (platine !== null && platine > early) throw earlyAccessOrder();
          note('earlyAccessHours', 'early_access_hours', d.early_access_hours, early);
          note('earlyAccessPlatineHours', 'early_access_platine_hours', d.early_access_platine_hours, platine);
        }
        if (change.priceMinor !== undefined || change.currency !== undefined) {
          const price = cleanDrawPrice(change.priceMinor ?? null, change.currency ?? null);
          note('priceMinor', 'price_minor', d.price_minor, price?.minor ?? null);
          note('currency', 'currency', d.currency, price?.currency ?? null);
        }
        const opensAt = change.opensAt !== undefined ? cleanTime(change.opensAt, 'The opening') : d.opens_at;
        const closesAt = change.closesAt !== undefined ? cleanTime(change.closesAt, 'The close') : d.closes_at;
        checkWindow(opensAt, closesAt);
        note('opensAt', 'opens_at', d.opens_at, opensAt);
        note('closesAt', 'closes_at', d.closes_at, closesAt);
        if (change.modelId !== undefined) {
          const modelId = knownId(change.modelId, () => notFound('Model', 'MODEL_NOT_FOUND'));
          if (modelId !== d.model_id) {
            const model = await tx.selectFrom('models').select(['id', 'active']).where('id', '=', modelId).executeTakeFirst();
            if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
            if (!model.active) throw modelInactive();
          }
          note('modelId', 'model_id', d.model_id, modelId);
        }
      }
      if (Object.keys(set).length > 0) {
        await tx.updateTable('drops').set(set).where('id', '=', id).execute();
        await this.audit.record({ actor, action: 'drop.update', targetType: 'drop', targetId: id, details: { before, after } }, tx);
      }
      return this.adminDrop(tx, id);
    });
  }

  /**
   * Publish a DRAFT: it shows on /verify/releases with the SHA-256 of its seed. Refused once published or cancelled,
   * when its entries would already be closed, and for a model no longer offered (409). Audited `drop.publish`, with the
   * time its direct reservations open (P-X02: its early access, from the publication at the earliest; null without one).
   */
  async publish(dropId: string, actor: Actor): Promise<AdminDrop> {
    assertStaff(actor, 'publish a release');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const d = await this.lockDraw(tx, id);
      if (d.cancelled_at) throw dropCancelled();
      if (d.published_at) throw dropAlreadyPublished();
      if (now.getTime() >= d.closes_at.getTime()) throw dropWindowPast();
      const model = await tx.selectFrom('models').select('active').where('id', '=', d.model_id).executeTakeFirstOrThrow();
      if (!model.active) throw modelInactive();
      await tx.updateTable('drops').set({ published_at: now }).where('id', '=', id).execute();
      const early = earlyAccessOpensAt({ ...d, published_at: now });
      const earlyPlatine = earlyAccessOpensAt({ ...d, published_at: now }, 2);
      // IN-01: the house's guarantees waiting for the next release of its model or collection, set aside while they fit.
      const covered: AuditRecordInput[] = [];
      await coverOnPublish(tx, { ...d, published_at: now }, now, actor, covered);
      await this.audit.record(
        {
          actor,
          action: 'drop.publish',
          targetType: 'drop',
          targetId: id,
          details: {
            seedHash: toHex(d.seed_hash),
            quantity: d.quantity,
            opensAt: d.opens_at.toISOString(),
            closesAt: d.closes_at.toISOString(),
            earlyAccessHours: d.early_access_hours,
            earlyAccessPlatineHours: platineHoursOf(d),
            earlyAccessOpensAt: early ? early.toISOString() : null,
            earlyAccessPlatineOpensAt: earlyPlatine ? earlyPlatine.toISOString() : null,
          },
        },
        tx,
      );
      for (const n of covered) await this.audit.record(n, tx);
      return this.adminDrop(tx, id);
    });
  }

  /** Cancel a drop before its draw (409 DROP_ALREADY_DRAWN after, DROP_CANCELLED twice). Audited `drop.cancel`. */
  async cancel(dropId: string, actor: Actor): Promise<AdminDrop> {
    assertStaff(actor, 'cancel a release');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const d = await this.lockDraw(tx, id);
      if (d.drawn_at) throw dropDrawn();
      if (d.cancelled_at) throw dropCancelled();
      await tx.updateTable('drops').set({ cancelled_at: now }).where('id', '=', id).execute();
      const counts = (await this.tallies(tx, [id])).get(id)?.counts ?? EMPTY_COUNTS();
      // IN-01: its guarantees not used, carried to the next release of their model or collection, or expired.
      const notes: AuditRecordInput[] = [];
      await releaseCovered(tx, id, 'CANCELLED', now, actor, notes);
      await this.audit.record({ actor, action: 'drop.cancel', targetType: 'drop', targetId: id, details: { published: d.published_at !== null, entered: counts.ENTERED } }, tx);
      for (const n of notes) await this.audit.record(n, tx);
      return this.adminDrop(tx, id);
    });
  }

  /**
   * The draw (ADMIN; see the file header). Under the drop's row lock: refused unless published, closed, neither
   * cancelled nor drawn; the seed opened and checked against its commitment (503 DROP_SEED_UNAVAILABLE otherwise);
   * every ENTERED entry ranked with its account's tier and seniority read now; the places left SELECTED until
   * `respond_by`, the others WAITLISTED; the seed stored in clear with `drawn_at`. Audited `drop.draw` with the counts
   * and the seed it reveals.
   */
  async draw(dropId: string, actor: Actor): Promise<DrawOutcome> {
    assertStaff(actor, 'draw a release');
    const id = knownId(dropId, dropNotFound);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const d = await this.lock(tx, id);
      if (d.mode === 'LIVE') throw dropLive();
      if (d.cancelled_at) throw dropCancelled();
      if (d.drawn_at) throw dropDrawn();
      if (!d.published_at) throw dropNotPublished();
      if (now.getTime() < d.closes_at.getTime()) throw dropNotClosed();
      const seed = openDropSeed(this.seedKey, d);
      const all = await tx.selectFrom('drop_entries').select(['id', 'account_id', 'guarantee_id', 'pieces']).where('drop_id', '=', id).where('status', '=', 'ENTERED').orderBy('id').execute();
      // IN-01: the entries with the house's guarantee are selected first, without a rank; the draw ranks the others.
      const guaranteedEntries = all.filter((e) => e.guarantee_id !== null);
      const entered = all.filter((e) => e.guarantee_id === null);
      const standings = await clubStandings(tx, entered.map((e) => e.account_id), now);
      const order = drawOrder(
        entered.map((e) => {
          const s = standings.get(e.account_id.toLowerCase());
          return { id: e.id, tier: s?.tier ?? 0, seniority: s?.seniority ?? 0 };
        }),
        seed,
      );
      const held = await this.heldPieces(tx, id);
      const respondBy = new Date(now.getTime() + d.purchase_window_hours * HOUR_MS);
      const notes: AuditRecordInput[] = [];
      const guaranteedPieceCount = guaranteedEntries.reduce((n, e) => n + e.pieces, 0);
      if (guaranteedEntries.length > 0) {
        await tx
          .updateTable('drop_entries')
          .set({ status: 'SELECTED', respond_by: respondBy, tier: null, seniority: null, rank: null })
          .where('id', 'in', guaranteedEntries.map((e) => e.id))
          .where('status', '=', 'ENTERED')
          .execute();
        await useGuarantees(tx, guaranteedEntries.map((e) => e.guarantee_id!), id, now, actor, notes, 'draw');
      }
      // The places left: the quantity less the pieces held or sold, and those the house's guarantees just took.
      const places = Math.max(0, d.quantity - held - guaranteedPieceCount);
      for (let i = 0; i < order.length; i += DRAW_CHUNK) {
        const chunk = order.slice(i, i + DRAW_CHUNK);
        const values = sql.join(
          chunk.map((e) => {
            const selected = e.rank <= places;
            return sql`(${e.id}::uuid, ${selected ? 'SELECTED' : 'WAITLISTED'}, ${e.tier}::smallint, ${e.seniority}::smallint, ${e.rank}::int, ${selected ? respondBy : null}::timestamptz)`;
          }),
        );
        await sql`
          UPDATE drop_entries AS e
             SET status = v.status, tier = v.tier, seniority = v.seniority, rank = v.rank, respond_by = v.respond_by
            FROM (VALUES ${values}) AS v(id, status, tier, seniority, rank, respond_by)
           WHERE e.id = v.id AND e.drop_id = ${id} AND e.status = 'ENTERED'`.execute(tx);
      }
      await tx.updateTable('drops').set({ seed, drawn_at: now }).where('id', '=', id).execute();
      // IN-01: the guarantees set aside for it and not used: a model's or a collection's carried, a chosen release's expired.
      await releaseCovered(tx, id, 'ENDED', now, actor, notes);
      const selected = Math.min(places, order.length);
      const waitlisted = order.length - selected;
      await this.audit.record(
        {
          actor,
          action: 'drop.draw',
          targetType: 'drop',
          targetId: id,
          details: { entries: order.length, places, selected, waitlisted, guaranteed: guaranteedEntries.length, guaranteedPieces: guaranteedPieceCount, seed: toHex(seed) },
        },
        tx,
      );
      for (const n of notes) await this.audit.record(n, tx);
      seed.fill(0);
      return {
        drop: await this.adminDrop(tx, id),
        entries: order.length,
        places,
        selected,
        waitlisted,
        guaranteed: guaranteedEntries.length,
        guaranteedPieces: guaranteedPieceCount,
      };
    });
  }

  /** A drop's entries for the console: by rank once drawn (the others after), else by entry; `status` narrows them. */
  async entries(dropId: string, filter: { status?: DropEntryStatus }, page: PageRequest): Promise<Page<AdminDropEntry>> {
    const id = knownId(dropId, dropNotFound);
    const d = await this.db.selectFrom('drops').select('id').where('id', '=', id).executeTakeFirst();
    if (!d) throw dropNotFound();
    const total = await this.db
      .selectFrom('drop_entries as e')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('e.drop_id', '=', id)
      .$if(filter.status !== undefined, (qb) => qb.where('e.status', '=', filter.status!))
      .executeTakeFirstOrThrow();
    const rows = await this.entryRows(this.db)
      .where('e.drop_id', '=', id)
      .$if(filter.status !== undefined, (qb) => qb.where('e.status', '=', filter.status!))
      .orderBy(sql`e.rank IS NULL`)
      .orderBy('e.rank')
      .orderBy('e.created_at')
      .orderBy('e.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      rows.map(entryView),
      Number(total.n),
      page,
    );
  }

  /**
   * CONFIRMED: the sale concluded by ORBES Client Services, for an entry whose place is held; never on a cancelled release
   * (409 DROP_CANCELLED). Its order is created in the same transaction, RESERVED at the drop's location, its size and
   * price to be entered (services/orders.ts orderForDrawEntry). OPERATOR; audited `drop.entry.confirm` and `order.create`.
   */
  confirm(dropId: string, entryId: string, note: string | null, actor: Actor): Promise<AdminDropEntry> {
    return this.conclude(dropId, entryId, 'CONFIRMED', note, actor);
  }

  /** LAPSED: the place held was not taken up in time; only once `respond_by` has passed (409 DROP_PLACE_HELD before). Audited `drop.entry.lapse`. */
  lapse(dropId: string, entryId: string, note: string | null, actor: Actor): Promise<AdminDropEntry> {
    return this.conclude(dropId, entryId, 'LAPSED', note, actor);
  }

  /**
   * OFFER NEXT: the first entry of the waiting list by rank is SELECTED, its place held for the drop's window, only
   * while the places held and sold stay under `quantity` (409 DROP_FULL), and while one is left (409
   * DROP_WAITLIST_EMPTY). Under the drop's row lock. Audited `drop.entry.offer`.
   */
  async offerNext(dropId: string, actor: Actor): Promise<AdminDropEntry> {
    assertStaff(actor, 'offer a place');
    const id = knownId(dropId, dropNotFound);
    const entryId = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const d = await this.lock(tx, id);
      if (d.mode === 'LIVE') throw dropLive();
      if (!d.drawn_at) throw dropNotDrawn();
      if ((await this.heldPieces(tx, id)) >= d.quantity) throw dropFull();
      const next = await tx.selectFrom('drop_entries').select(['id', 'rank']).where('drop_id', '=', id).where('status', '=', 'WAITLISTED').orderBy('rank').limit(1).forUpdate().executeTakeFirst();
      if (!next) throw waitlistEmpty();
      const respondBy = new Date(now.getTime() + d.purchase_window_hours * HOUR_MS);
      await tx.updateTable('drop_entries').set({ status: 'SELECTED', respond_by: respondBy }).where('id', '=', next.id).execute();
      await this.audit.record(
        { actor, action: 'drop.entry.offer', targetType: 'drop', targetId: id, details: { entryId: next.id, rank: next.rank, respondBy: respondBy.toISOString() } },
        tx,
      );
      return next.id;
    });
    return this.adminEntry(id, entryId);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async conclude(dropId: string, entryId: string, to: 'CONFIRMED' | 'LAPSED', note: string | null, actor: Actor): Promise<AdminDropEntry> {
    assertStaff(actor, to === 'CONFIRMED' ? 'confirm a sale' : 'lapse a place');
    const id = knownId(dropId, dropNotFound);
    const entry = knownId(entryId, dropEntryNotFound);
    const text = note === null || note === undefined ? null : note.trim() === '' ? null : note.trim();
    if (text !== null && (text.length > DROP_NOTE_MAX || CONTROL_CHARS.test(text))) throw validationError(`A note has at most ${DROP_NOTE_MAX} characters.`);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const d = await this.lock(tx, id);
      // No sale on a cancelled release (its direct reservations stay SELECTED); its places may still lapse.
      if (to === 'CONFIRMED' && d.cancelled_at) throw dropCancelled();
      const e = await tx.selectFrom('drop_entries').select(['id', 'status', 'rank', 'respond_by']).where('id', '=', entry).where('drop_id', '=', id).forUpdate().executeTakeFirst();
      if (!e) throw dropEntryNotFound();
      if (e.status !== 'SELECTED') throw entryNotSelected();
      if (to === 'LAPSED' && e.respond_by && now.getTime() < e.respond_by.getTime()) throw placeHeld(e.respond_by);
      await tx.updateTable('drop_entries').set({ status: to, handled_by: actor.id!, handled_at: now, note: text }).where('id', '=', e.id).execute();
      const order = to === 'CONFIRMED' ? await orderForDrawEntry(tx, e.id, actor, now) : { order: null, orders: [], notes: [] };
      await this.audit.record(
        {
          actor,
          action: to === 'CONFIRMED' ? 'drop.entry.confirm' : 'drop.entry.lapse',
          targetType: 'drop',
          targetId: id,
          details: {
            entryId: e.id,
            rank: e.rank,
            ...(text !== null ? { noted: true } : {}),
            ...(order.order ? { orderId: order.order.id } : {}),
            ...(order.orders.length > 1 ? { orderIds: order.orders.map((o) => o.id) } : {}),
          },
        },
        tx,
      );
      for (const n of order.notes) await this.audit.record(n, tx);
    });
    return this.adminEntry(id, entry);
  }

  /** The pieces of a drop's places held or sold (SELECTED, CONFIRMED): each entry's pieces (IN-01: a guaranteed place may hold several). */
  private async heldPieces(db: Db, id: string): Promise<number> {
    const r = await db
      .selectFrom('drop_entries')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('pieces'), sql<number>`0`).as('n'))
      .where('drop_id', '=', id)
      .where('status', 'in', ['SELECTED', 'CONFIRMED'])
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** The pieces reserved directly before the draw (SELECTED or CONFIRMED, never ranked): a holder's reservation with the house's guarantee included. */
  private async reservedPieces(db: Db, id: string): Promise<number> {
    const r = await db
      .selectFrom('drop_entries')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('pieces'), sql<number>`0`).as('n'))
      .where('drop_id', '=', id)
      .where('status', 'in', ['SELECTED', 'CONFIRMED'])
      .where('rank', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** The drop's row FOR UPDATE (every console action and the draw), any state; 404 DROP_NOT_FOUND. */
  private async lock(tx: Db, id: string): Promise<DropRow> {
    const d = await tx.selectFrom('drops').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  /** The same row for a change, a publication or a cancellation of a draw's drop; 409 DROP_LIVE for a LIVE RELEASE. */
  private async lockDraw(tx: Db, id: string): Promise<DropRow> {
    const d = await this.lock(tx, id);
    if (d.mode === 'LIVE') throw dropLive();
    return d;
  }

  /**
   * A published drop's row FOR SHARE (ENTER, WITHDRAW), or FOR UPDATE (RESERVE, P-X02: the places counted one request
   * after the other); a DRAFT, and a LIVE RELEASE, answer as an unknown drop.
   */
  private async lockPublished(tx: Db, id: string, mode: 'share' | 'update' = 'share'): Promise<DropRow> {
    const q = tx.selectFrom('drops').selectAll().where('id', '=', id).where('published_at', 'is not', null).where('mode', '=', 'DRAW');
    const d = await (mode === 'update' ? q.forUpdate() : q.forShare()).executeTakeFirst();
    if (!d) throw dropNotFound();
    return d;
  }

  private reads(db: Db) {
    return db
      .selectFrom('drops as d')
      .innerJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('collections as c', 'c.id', 'm.collection_id')
      .selectAll('d')
      .select([
        'm.name as model_name',
        'm.type as model_type',
        'm.active as model_active',
        'm.image_sha256 as model_image',
        'm.slug as model_slug',
        'm.lookbook as model_lookbook',
        'm.variant_label as model_variant',
        'c.name as collection',
      ]);
  }

  private card(r: DropReadRow, now: Date): DropCard {
    return {
      id: r.id,
      title: r.title,
      state: publicState(r, now),
      model: {
        name: r.model_name,
        type: r.model_type,
        collection: r.collection,
        imageUrl: mediaUrl(r.model_image),
        lookbook: r.model_lookbook === 'PUBLIC' && r.model_slug ? r.model_slug : null,
        variant: r.model_variant,
      },
      quantity: r.quantity,
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      earlyAccessHours: r.early_access_hours,
      earlyAccessPlatineHours: platineHoursOf(r),
      earlyAccessOpensAt: earlyAccessOpensAt(r),
      earlyAccessPlatineOpensAt: earlyAccessOpensAt(r, 2),
      earlyAccessOpen: inEarlyAccess(r, now),
      earlyAccessPlatineOpen: inEarlyAccess(r, now, 2),
      priceMinor: r.price_minor !== null && r.currency !== null ? r.price_minor : null,
      currency: r.price_minor !== null && r.currency !== null ? r.currency : null,
    };
  }

  /**
   * The entries of each drop of `ids` by status, and how many of those SELECTED or CONFIRMED are direct reservations of
   * the early access (P-X02; isReservation): what the places held or sold owe to it.
   */
  private async tallies(db: Db, ids: readonly string[]): Promise<Map<string, { counts: DropEntryCounts; reserved: number }>> {
    const out = new Map<string, { counts: DropEntryCounts; reserved: number }>();
    if (ids.length === 0) return out;
    const rows = await db
      .selectFrom('drop_entries')
      .select((eb) => [
        'drop_id',
        'status',
        eb.fn.countAll<number>().as('n'),
        eb.fn
          .countAll<number>()
          .filterWhere((w) => w.and([w('tier', 'is not', null), w('rank', 'is', null)]))
          .as('reserved'),
      ])
      .where('drop_id', 'in', [...ids])
      .groupBy(['drop_id', 'status'])
      .execute();
    for (const r of rows) {
      const t = out.get(r.drop_id) ?? { counts: EMPTY_COUNTS(), reserved: 0 };
      t.counts[r.status] = Number(r.n);
      if (r.status === 'SELECTED' || r.status === 'CONFIRMED') t.reserved += Number(r.reserved);
      out.set(r.drop_id, t);
    }
    return out;
  }

  private async staffEmails(db: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
    if (wanted.length === 0) return new Map();
    const rows = await db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', wanted).execute();
    return new Map(rows.map((r) => [r.id, r.email]));
  }

  private adminView(
    r: DropReadRow,
    now: Date,
    tally: { counts: DropEntryCounts; reserved: number } | undefined,
    creators: Map<string, string>,
    guaranteed: ReleaseGuaranteed | undefined,
  ): AdminDrop {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      model: { id: r.model_id, name: r.model_name, type: r.model_type, active: r.model_active, variant: r.model_variant },
      quantity: r.quantity,
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      purchaseWindowHours: r.purchase_window_hours,
      earlyAccessHours: r.early_access_hours,
      earlyAccessPlatineHours: platineHoursOf(r),
      priceMinor: r.price_minor !== null && r.currency !== null ? r.price_minor : null,
      currency: r.price_minor !== null && r.currency !== null ? r.currency : null,
      earlyAccessOpensAt: earlyAccessOpensAt(r),
      earlyAccessPlatineOpensAt: earlyAccessOpensAt(r, 2),
      state: dropState(r, now),
      publishedAt: r.published_at,
      cancelledAt: r.cancelled_at,
      drawnAt: r.drawn_at,
      createdAt: r.created_at,
      createdBy: r.created_by && creators.has(r.created_by) ? { id: r.created_by, email: creators.get(r.created_by)! } : null,
      seedHash: toHex(r.seed_hash),
      // Never before the draw: until then only the sealed seed exists, which no route returns.
      seed: r.drawn_at && r.seed ? toHex(r.seed) : null,
      entries: tally?.counts ?? EMPTY_COUNTS(),
      reserved: tally?.reserved ?? 0,
      guaranteed: guaranteed ?? { places: 0, pieces: 0 },
    };
  }

  private async adminDrop(db: Db, id: string): Promise<AdminDrop> {
    const r = await this.reads(db).where('d.id', '=', id).executeTakeFirst();
    if (!r) throw dropNotFound();
    const tallies = await this.tallies(db, [id]);
    const creators = await this.staffEmails(db, [r.created_by]);
    const guaranteed = await releaseGuaranteed(db, [id]);
    return this.adminView(r, this.clock(), tallies.get(id), creators, guaranteed.get(id));
  }

  /** The rows of a drop's entries as the console reads them: the account's email, the console user who concluded it. */
  private entryRows(db: Db) {
    return db
      .selectFrom('drop_entries as e')
      .innerJoin('accounts as a', 'a.id', 'e.account_id')
      .leftJoin('admin_users as h', 'h.id', 'e.handled_by')
      .select([
        'e.id', 'e.account_id', 'a.email', 'e.status', 'e.created_at', 'e.tier', 'e.seniority', 'e.rank', 'e.respond_by', 'e.handled_by', 'h.email as handled_email', 'e.handled_at', 'e.note',
        'e.guarantee_id', 'e.pieces',
      ]);
  }

  private async adminEntry(dropId: string, entryId: string): Promise<AdminDropEntry> {
    const r = await this.entryRows(this.db).where('e.id', '=', entryId).where('e.drop_id', '=', dropId).executeTakeFirst();
    if (!r) throw dropEntryNotFound();
    return entryView(r);
  }

  /** The rows of an account's entries with their drops (the club's status, ENTER, WITHDRAW and RESERVE). */
  private accountEntryRows(db: Db) {
    return db
      .selectFrom('drop_entries as e')
      .innerJoin('drops as d', 'd.id', 'e.drop_id')
      .leftJoin('house_guarantees as g', 'g.id', 'e.guarantee_id')
      .select([
        'e.id', 'e.drop_id', 'e.status', 'e.created_at', 'e.tier', 'e.rank', 'e.respond_by', 'e.pieces', 'e.guarantee_id', 'g.visible as guarantee_visible', 'g.used_at as guarantee_used_at',
        'd.title', 'd.opens_at', 'd.closes_at', 'd.published_at', 'd.cancelled_at', 'd.drawn_at',
      ]);
  }

  private async accountEntry(accountId: string, entryId: string): Promise<AccountDropEntry> {
    const r = await this.accountEntryRows(this.db).where('e.id', '=', entryId).where('e.account_id', '=', accountId).executeTakeFirstOrThrow();
    return accountEntryView(r, this.clock());
  }
}

/**
 * A new drop's seed (DropService.create draws its own the same way; a LIVE RELEASE's console, services/live-console.ts,
 * calls this one): 32 random bytes sealed for the drop `id` and committed by their SHA-256, the bytes zeroed once sealed.
 */
export function newSealedSeed(seedKey: Uint8Array, id: string): { sealed: string; seedHash: Uint8Array } {
  const seed = new Uint8Array(randomBytes(DROP_SEED_BYTES));
  const seedHash = sha256(seed);
  const sealed = seal(seedKey, seed, seedAad(id));
  seed.fill(0);
  return { sealed, seedHash };
}
