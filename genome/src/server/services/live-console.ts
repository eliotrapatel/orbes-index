/**
 * The console of the LIVE RELEASES (plan of 2026-10-04, The console: Clients › Club › Drops; routes/admin/live.ts). The
 * release's rules and the live controls are services/live.ts's; what the public reads is live-room.ts's. Here:
 *
 *   create / edit   a LIVE RELEASE and every setting of it: its model, title and description; who may enter (a tier,
 *                   the owners of models or of a collection, the collectors who have taken part in a number of releases,
 *                   the members of a segment, and whether every rule is needed or any one: plan LIVE RELEASE+, choices 4
 *                   and 27); the surprise in every box (on or off, its description: internal, choice 3); the line's tier
 *                   priority; T0 (`opens_at`), the end of
 *                   the sales (`closes_at`), the room's opening, the turn and pay windows, the pieces per person, the
 *                   price and its currency; the sizes and their stock, the quantity line (« 25 PIECES » by default, at
 *                   most 40 characters); the add-ons (at most 6); the staged reveals (announcement, silhouette, name,
 *                   photograph); the per-tier turn and pay windows. Everything changes until the announcement (a DRAFT,
 *                   or published and announced later); after it, 409 LIVE_ANNOUNCED: only the stock rises, with ADD
 *                   PIECES (live.ts addPieces). The silhouette's image is MediaService's (setLiveSilhouette).
 *   publish         with, optionally, a post of the owners' circle linking the release (the plan's choice 9): a NOTE for
 *                   the release's tier (TITANE at least), shown from the announcement, kept in step with the release's
 *                   times while it is not shown yet, withdrawn if the release is cancelled before it shows; added or
 *                   withdrawn after the publication until the announcement, as every setting (setCirclePost).
 *   after-room      optional (plan LIVE RELEASE+, choice 2; services/after-room.ts): a second door the release's sell-out
 *                   opens for those still in its line, set with the release's settings (`afterRoom`: its model, price,
 *                   sizes and stock, add-ons, delay and length; null: none) and kept until the announcement as they are.
 *                   It is a child LIVE RELEASE written here, a DRAFT until the sell-out: its title the release's
 *                   « · THE AFTER-ROOM », its turn and pay windows, pieces per person and currency the release's (written
 *                   again with every save), its sizes linked to their SKUs; turned off, removed (nothing points to it before
 *                   the announcement). It is never listed on its own: the release's page shows it, and its own page
 *                   (`afterRoomOf`) has the live board and controls, never settings, a publication, a cancellation or a
 *                   board link of its own (409 LIVE_AFTER_ROOM).
 *   cancel          before the room opens (409 LIVE_ROOM_OPEN after: an ADMIN ends a release with END NOW); its after-room
 *                   with it.
 *   the live board  the counters (in the room, the line, the turns, the pieces secured and confirmed, the missed turns,
 *                   the holds that ended, per size and overall, the interest), the latest host message and the line
 *                   itself (its open entries by place, at most LIVE_CONSOLE_LINE_MAX), and from T0 until the release is
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
 * Audited (dotted lowercase, ids only, a description or a body as its length and SHA-256): `drop.live.create`,
 * `drop.live.update` (each setting before and after), `drop.live.publish`, `drop.live.cancel`, and the circle's own `circle.post.create`, `circle.post.update`, `circle.post.unpublish` for the
 * release's post.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { toHex } from '../../core/bytes.js';
import { inTransaction, type Db } from '../db/connection.js';
import type { AccessCombine, AdminRole, DropRow, LiveEndReason, LiveEntryStatus } from '../db/schema.js';
import { ACCESS_COMBINES, LIVE_ENTRY_STATUSES } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import type { LiveAlert, LiveSellOut, LiveSignals } from './live-insights.js';
import { cleanDescription, cleanTime, cleanTitle, DROP_QUANTITY_MAX, dropNotFound, newSealedSeed, PURCHASE_WINDOW_HOURS } from './drops.js';
import {
  announcedAt,
  effectiveDeadline,
  isAnnounced,
  liveAccessRule,
  livePhase,
  liveRuleText,
  liveStages,
  roomOpensAt,
  LIVE_ADDONS_MAX,
  LIVE_MIN_PARTICIPATIONS,
  LIVE_OPEN_STATUSES,
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_SIZE_STOCK_MAX,
  LIVE_SURPRISE_MAX,
  LIVE_TURN_SECONDS,
  type AdminLiveEntry,
  type LiveAccessRule,
  type LivePhase,
} from './live.js';
import { storyFingerprint } from './lookbook.js';
import { mediaUrl } from './media.js';
import { linkDropSizes } from './stock.js';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const PARIS = 'Europe/Paris';

/** The reference of an entry for ORBES Client Services: `LR-` and the first eight figures of its id (as /verify says it). */
export function liveReference(entryId: string): string {
  return `LR-${entryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** The quantity line a release says by default: « 25 PIECES ». */
export function defaultQuantityLine(quantity: number): string {
  return `${quantity} ${quantity === 1 ? 'PIECE' : 'PIECES'}`;
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
const liveAnnounced = () => conflict('LIVE_ANNOUNCED', 'This release is announced: its settings no longer change. Raise a size’s stock with ADD PIECES.');
const alreadyPublished = () => conflict('DROP_ALREADY_PUBLISHED', 'This release is already published.');
const notPublished = () => conflict('DROP_NOT_PUBLISHED', 'This release is not published: its post of the circle is chosen when it is published.');
const circlePosted = () => conflict('LIVE_CIRCLE_POSTED', 'This release’s post of the circle already waits for its announcement.');
const noCirclePost = () => conflict('LIVE_NO_CIRCLE_POST', 'This release has no post of the circle waiting for its announcement.');
const roomOpen = () => conflict('LIVE_ROOM_OPEN', 'The room of this release is open: an ADMIN ends it with END NOW.');
const roomPast = () => validationError('The room would already be open: set T0 later.');
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

/** Every setting of a LIVE RELEASE; those not given take their defaults (the plan's choices 15 and 16). */
export interface LiveSettingsInput {
  modelId: string;
  title: string;
  description?: string | null;
  /** T0. */
  opensAt: Date;
  /** The end of the sales. */
  closesAt: Date;
  roomOpensMinutes?: number;
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
  /** null: at the publication. */
  announceAt?: Date | null;
  /** null: at the announcement. */
  silhouetteAt?: Date | null;
  nameAt?: Date | null;
  photoAt?: Date | null;
  tierWindows?: LiveTierWindowInput[];
  /** The after-room (null or omitted at creation: none). */
  afterRoom?: AfterRoomInput | null;
}

/** An after-room's own settings; the rest is the release's (services/after-room.ts). */
export interface AfterRoomInput {
  modelId: string;
  priceMinor: number;
  sizes: LiveSizeInput[];
  addons?: LiveAddonInput[];
  /** After the sell-out: 1 to 60 minutes, 10 by default. */
  delayMinutes?: number;
  /** Open: 5 to 120 minutes, 15 by default. */
  lengthMinutes?: number;
}

/** A change of a LIVE RELEASE: any setting, until its announcement. A list given replaces the release's. */
export type LiveSettingsChange = Partial<LiveSettingsInput>;

interface Settings {
  modelId: string;
  title: string;
  description: string | null;
  opensAt: Date;
  closesAt: Date;
  roomOpensMinutes: number;
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
  sizes: { id: string | null; label: string; stock: number }[];
  quantityLine: string;
  addons: { id: string | null; label: string; line: string | null; priceMinor: number }[];
  announceAt: Date | null;
  silhouetteAt: Date | null;
  nameAt: Date | null;
  photoAt: Date | null;
  tierWindows: { tier: number; turnSeconds: number | null; payMinutes: number | null }[];
  afterRoom: AfterRoomSettings | null;
}

/** An after-room's settings, cleaned. */
export interface AfterRoomSettings {
  modelId: string;
  priceMinor: number;
  sizes: { id: string | null; label: string; stock: number }[];
  addons: { id: string | null; label: string; line: string | null; priceMinor: number }[];
  delayMinutes: number;
  lengthMinutes: number;
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

function cleanSizes(v: unknown): Settings['sizes'] {
  if (!Array.isArray(v) || v.length < LIVE_SIZES.min || v.length > LIVE_SIZES.max) throw validationError(`A release has ${LIVE_SIZES.min} to ${LIVE_SIZES.max} sizes.`);
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
    return { id, label, stock };
  });
  const total = out.reduce((n, s) => n + s.stock, 0);
  if (total < 1 || total > DROP_QUANTITY_MAX) throw validationError(`A release offers 1 to ${DROP_QUANTITY_MAX} pieces in all.`);
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

function cleanQuantityLine(v: unknown, quantity: number): string {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return defaultQuantityLine(quantity);
  return oneLine(v, LIVE_QUANTITY_LINE_MAX, 'The quantity line');
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
    sizes: cleanSizes(a.sizes),
    addons: a.addons === undefined ? (base?.addons ?? []) : cleanAddons(a.addons),
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

/** The settings a change gives, over the release's (or the defaults of a new one), each cleaned. */
function settingsOf(base: Settings | null, change: LiveSettingsChange): Settings {
  const pick = <K extends keyof LiveSettingsInput>(k: K): LiveSettingsInput[K] | undefined => (change[k] !== undefined ? change[k] : undefined);
  const sizes = pick('sizes') !== undefined ? cleanSizes(change.sizes) : base ? base.sizes : cleanSizes(undefined);
  const quantity = sizes.reduce((n, s) => n + s.stock, 0);
  // A quantity line left at its default follows the stock.
  const followsStock = base !== null && base.quantityLine === defaultQuantityLine(base.sizes.reduce((n, s) => n + s.stock, 0));
  const quantityLine =
    change.quantityLine !== undefined ? cleanQuantityLine(change.quantityLine, quantity) : base && !followsStock ? base.quantityLine : defaultQuantityLine(quantity);
  const currency = change.currency !== undefined ? change.currency : (base?.currency ?? 'EUR');
  if (!(LIVE_CURRENCIES as readonly string[]).includes(currency as string)) throw validationError(`A release is priced in ${LIVE_CURRENCIES.join(', ')}.`);
  return {
    modelId: change.modelId !== undefined ? knownId(change.modelId, () => notFound('Model', 'MODEL_NOT_FOUND')) : base ? base.modelId : knownId(undefined, () => notFound('Model', 'MODEL_NOT_FOUND')),
    title: change.title !== undefined || !base ? cleanTitle(change.title) : base.title,
    description: change.description !== undefined ? cleanDescription(change.description) : (base?.description ?? null),
    opensAt: change.opensAt !== undefined || !base ? cleanTime(change.opensAt, 'T0') : base.opensAt,
    closesAt: change.closesAt !== undefined || !base ? cleanTime(change.closesAt, 'The end') : base.closesAt,
    roomOpensMinutes: wholeIn(change.roomOpensMinutes ?? base?.roomOpensMinutes ?? LIVE_ROOM_OPENS_MINUTES.default, LIVE_ROOM_OPENS_MINUTES.min, LIVE_ROOM_OPENS_MINUTES.max, `The room opens ${LIVE_ROOM_OPENS_MINUTES.min} to ${LIVE_ROOM_OPENS_MINUTES.max} minutes before T0.`),
    turnSeconds: wholeIn(change.turnSeconds ?? base?.turnSeconds ?? LIVE_TURN_SECONDS.default, LIVE_TURN_SECONDS.min, LIVE_TURN_SECONDS.max, `A turn lasts ${LIVE_TURN_SECONDS.min} to ${LIVE_TURN_SECONDS.max} seconds.`),
    payMinutes: wholeIn(change.payMinutes ?? base?.payMinutes ?? LIVE_PAY_MINUTES.default, LIVE_PAY_MINUTES.min, LIVE_PAY_MINUTES.max, `The time to pay is ${LIVE_PAY_MINUTES.min} to ${LIVE_PAY_MINUTES.max} minutes.`),
    perAccount: wholeIn(change.perAccount ?? base?.perAccount ?? LIVE_PER_ACCOUNT.default, LIVE_PER_ACCOUNT.min, LIVE_PER_ACCOUNT.max, `A person secures ${LIVE_PER_ACCOUNT.min} to ${LIVE_PER_ACCOUNT.max} pieces.`),
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
    announceAt: change.announceAt !== undefined ? optionalTime(change.announceAt, 'The announcement') : (base?.announceAt ?? null),
    silhouetteAt: change.silhouetteAt !== undefined ? optionalTime(change.silhouetteAt, 'The silhouette') : (base?.silhouetteAt ?? null),
    nameAt: change.nameAt !== undefined ? optionalTime(change.nameAt, 'The name') : (base?.nameAt ?? null),
    photoAt: change.photoAt !== undefined ? optionalTime(change.photoAt, 'The photograph') : (base?.photoAt ?? null),
    tierWindows: change.tierWindows !== undefined ? cleanWindows(change.tierWindows) : (base?.tierWindows ?? []),
    afterRoom: change.afterRoom !== undefined ? cleanAfterRoom(change.afterRoom, base?.afterRoom ?? null) : (base?.afterRoom ?? null),
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
    title: s.title,
    description: storyFingerprint(s.description),
    opensAt: t(s.opensAt),
    closesAt: t(s.closesAt),
    roomOpensMinutes: s.roomOpensMinutes,
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
    sizes: s.sizes.map((x) => `${x.label}:${x.stock}`),
    quantityLine: s.quantityLine,
    addons: s.addons.map((a) => ({ label: a.label, line: a.line, priceMinor: a.priceMinor })),
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
          delayMinutes: s.afterRoom.delayMinutes,
          lengthMinutes: s.afterRoom.lengthMinutes,
        }
      : null,
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
  model: { id: string; name: string; type: string; active: boolean };
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

/** A LIVE RELEASE as the console reads and edits it: every setting, never its sealed seed. */
export interface AdminLiveRelease extends AdminLiveCard {
  description: string | null;
  /** Its settings still change (not announced, not cancelled). */
  editable: boolean;
  roomOpensMinutes: number;
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
  sizes: { id: string; label: string; stock: number }[];
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
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
  quantity: number;
  quantityLine: string;
  /** The sizes summed, and the people who are out of the release: places given back, left, removed, ended by its end. */
  totals: Omit<AdminLiveBoardSize, 'id' | 'label'> & { inRoom: number; released: number; departed: number; removed: number; ended: number };
  sizes: AdminLiveBoardSize[];
  message: { text: string; at: Date } | null;
  /** The open entries (in their turn, holding, in the line, in the room), by place then arrival: the first LIVE_CONSOLE_LINE_MAX. */
  line: AdminLiveEntry[];
  /** Every open entry. */
  lineTotal: number;
  /** The live alerts (services/live-insights.ts liveAlerts), from T0 on. */
  alerts: LiveAlert[];
  /** The live sell-out forecast, from T0 until the end; null otherwise. */
  sellOut: LiveSellOut | null;
}

const EMPTY_COUNTS = (): Record<LiveEntryStatus, number> => Object.fromEntries(LIVE_ENTRY_STATUSES.map((s) => [s, 0])) as Record<LiveEntryStatus, number>;

type ReadRow = DropRow & { model_name: string; model_type: string; model_active: boolean };

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
  clock?: Clock;
}

export class LiveConsoleService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly seedKey: Uint8Array;
  private readonly origin: string;
  private readonly insights: LiveConsoleServiceDeps['insights'];
  private readonly clock: Clock;

  constructor(deps: LiveConsoleServiceDeps) {
    if (!(deps.seedKey instanceof Uint8Array) || deps.seedKey.length !== 32) throw new RangeError('seedKey must be 32 bytes');
    this.db = deps.db;
    this.audit = deps.audit;
    this.seedKey = deps.seedKey;
    this.origin = deps.publicOrigin;
    this.insights = deps.insights;
    this.clock = deps.clock ?? systemClock;
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
    return makePage(
      rows.map((r) => this.card(r, now, counts.get(r.id), interest.get(r.id) ?? 0, open.has(r.id))),
      Number(total.n),
      page,
    );
  }

  /** One LIVE RELEASE (404 DROP_NOT_FOUND for anything else). */
  get(dropId: string): Promise<AdminLiveRelease> {
    return this.release(this.db, knownId(dropId, dropNotFound));
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
    const [sizes, counts, interest, message] = await Promise.all([
      this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', id).orderBy('position').execute(),
      this.db
        .selectFrom('live_entries')
        .select((eb) => ['size_id', 'status', eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('quantity').as('q')])
        .where('drop_id', '=', id)
        .groupBy(['size_id', 'status'])
        .execute(),
      this.db.selectFrom('live_interest').select((eb) => ['size_id', eb.fn.countAll<number>().as('n')]).where('drop_id', '=', id).groupBy('size_id').execute(),
      this.db.selectFrom('live_messages').select(['text', 'created_at']).where('drop_id', '=', id).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst(),
    ]);
    const people = (sizeId: string | null, statuses: readonly string[]) =>
      counts.filter((c) => (sizeId === null || c.size_id === sizeId) && statuses.includes(c.status)).reduce((n, c) => n + Number(c.n), 0);
    const pieces = (sizeId: string, statuses: readonly string[]) => counts.filter((c) => c.size_id === sizeId && statuses.includes(c.status)).reduce((n, c) => n + Number(c.q ?? 0), 0);
    const boardSizes: AdminLiveBoardSize[] = sizes.map((s) => {
      const held = pieces(s.id, ['TURN', 'SECURED']);
      const sold = pieces(s.id, ['CONFIRMED']);
      return {
        id: s.id,
        label: s.label,
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
        interest: Number(interest.find((i) => i.size_id === s.id)?.n ?? 0),
      };
    });
    const sum = (k: keyof AdminLiveBoardSize) => boardSizes.reduce((n, s) => n + (s[k] as number), 0);
    const holding = people(null, ['TURN', 'SECURED']);
    const phase = livePhase(d, now);
    // Over on the recorded end (the clock alone may run ahead of the engine's pass), with no turn or hold left.
    const over = d.ended_at !== null && holding === 0;
    const [line, lineTotal, signals] = await Promise.all([
      this.adminEntries(this.db, d, { statuses: [...LIVE_OPEN_STATUSES] }, LIVE_CONSOLE_LINE_MAX, 0, now),
      this.db.selectFrom('live_entries').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', id).where('status', 'in', [...LIVE_OPEN_STATUSES]).executeTakeFirstOrThrow(),
      // The alerts and the forecast from T0 while the release runs; once it is over, the report says the rest.
      this.insights && !over ? this.insights.signals(d, now) : Promise.resolve<LiveSignals>({ alerts: [], sellOut: null }),
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
      quantity: sizes.reduce((n, s) => n + s.stock, 0),
      quantityLine: d.quantity_line ?? '',
      totals: {
        stock: sum('stock'),
        left: sum('left'),
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
      },
      sizes: boardSizes,
      message: message ? { text: message.text, at: message.created_at } : null,
      line,
      lineTotal: Number(lineTotal.n),
      alerts: signals.alerts,
      sellOut: signals.sellOut,
    };
  }

  /** The entries of a release: one status, the open ones (OPEN), or all; by place, then arrival. */
  async entries(dropId: string, filter: { status?: LiveEntryStatus | 'OPEN' }, page: PageRequest): Promise<Page<AdminLiveEntry>> {
    const id = knownId(dropId, dropNotFound);
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').executeTakeFirst();
    if (!d) throw dropNotFound();
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
      await this.checkModel(tx, s.modelId);
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
   * a list given (sizes, add-ons, models, per-tier windows) replaces the release's. The same checks as a creation. A
   * post of the circle the publication scheduled follows the new times and rule. Audited `drop.live.update` with each
   * setting before and after; nothing changed, nothing written.
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
      if (after.modelId !== before.modelId) await this.checkModel(tx, after.modelId);
      if (after.afterRoom && after.afterRoom.modelId !== before.afterRoom?.modelId) await this.checkModel(tx, after.afterRoom.modelId);
      await this.checkAccess(tx, after);
      await tx.updateTable('drops').set(this.columns(after)).where('id', '=', id).execute();
      await this.writeLists(tx, id, after, before);
      // The after-room follows: its own settings, and what it takes from the release (written again whatever changed).
      await this.saveAfterRoom(tx, { id, ...this.columns(after) }, after.afterRoom, admin, now);
      const notes: AuditRecordInput[] = [
        {
          actor,
          action: 'drop.live.update',
          targetType: 'drop',
          targetId: id,
          details: { before: Object.fromEntries(changed.map((k) => [k, a[k]])), after: Object.fromEntries(changed.map((k) => [k, b[k]])) },
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
   * in Paris, its quantity and price, its rule), for its tier (TITANE at least), shown from the announcement. Audited
   * `drop.live.publish` (and `circle.post.create`).
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
      const model = await tx.selectFrom('models').select('active').where('id', '=', d.model_id).executeTakeFirstOrThrow();
      if (!model.active) throw modelInactive();
      if (settings.afterRoom) {
        const own = await tx.selectFrom('models').select('active').where('id', '=', settings.afterRoom.modelId).executeTakeFirstOrThrow();
        if (!own.active) throw afterRoomModelInactive();
      }
      await tx.updateTable('drops').set({ published_at: now }).where('id', '=', id).execute();
      const published = { ...d, published_at: now };
      const notes: AuditRecordInput[] = [];
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
        },
      });
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
    return inTransaction(this.db, async (tx) => {
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
      await this.audit.record({ actor, action: 'drop.live.cancel', targetType: 'drop', targetId: id, details: { published: d.published_at !== null, announced: isAnnounced(d, now), interest: Number(interest.n) } }, tx);
      for (const p of withdrawn) await this.audit.record({ actor, action: 'circle.post.unpublish', targetType: 'circle_post', targetId: p.id, details: { dropId: id, by: 'drop.live.cancel' } }, tx);
      for (const n of afterRoom) await this.audit.record(n, tx);
      return this.release(tx, id);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private reads(db: Db) {
    return db
      .selectFrom('drops as d')
      .innerJoin('models as m', 'm.id', 'd.model_id')
      .selectAll('d')
      .select(['m.name as model_name', 'm.type as model_type', 'm.active as model_active']);
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
      title: s.title,
      description: s.description,
      quantity: s.sizes.reduce((n, x) => n + x.stock, 0),
      opens_at: s.opensAt,
      closes_at: s.closesAt,
      live_min_tier: s.minTier,
      tier_priority: s.tierPriority,
      room_opens_minutes: s.roomOpensMinutes,
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
    };
  }

  /** A model a release (or its after-room) offers: known (404 MODEL_NOT_FOUND) and still offered (409 MODEL_INACTIVE). */
  private async checkModel(tx: Db, modelId: string): Promise<void> {
    const model = await tx.selectFrom('models').select(['id', 'active']).where('id', '=', modelId).executeTakeFirst();
    if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (!model.active) throw modelInactive();
  }

  /** The models, the collection and the segment a rule names exist (404 otherwise). */
  private async checkAccess(tx: Db, s: Settings): Promise<void> {
    if (s.accessSegmentId && !(await tx.selectFrom('segments').select('id').where('id', '=', s.accessSegmentId).executeTakeFirst())) {
      throw notFound('Segment', 'SEGMENT_NOT_FOUND');
    }
    if (s.accessModelIds.length > 0) {
      const found = await tx.selectFrom('models').select('id').where('id', 'in', s.accessModelIds).execute();
      if (found.length !== s.accessModelIds.length) throw notFound('Model', 'MODEL_NOT_FOUND');
    }
    if (s.accessCollectionId && !(await tx.selectFrom('collections').select('id').where('id', '=', s.accessCollectionId).executeTakeFirst())) {
      throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    }
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
  private async writeOffer(tx: Db, id: string, s: Pick<Settings, 'modelId' | 'sizes' | 'addons'>, before: Pick<Settings, 'modelId' | 'sizes' | 'addons'> | null): Promise<void> {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (!before || !same(before.sizes, s.sizes)) {
      const known = new Set((before?.sizes ?? []).map((x) => x.id));
      for (const x of s.sizes) if (x.id && !known.has(x.id)) throw validationError('A size to keep is one of the release’s.');
      await tx.deleteFrom('drop_sizes').where('drop_id', '=', id).execute();
      await tx
        .insertInto('drop_sizes')
        .values(s.sizes.map((x, i) => ({ ...(x.id ? { id: x.id } : {}), drop_id: id, label: x.label, position: i + 1, stock: x.stock })))
        .execute();
    }
    if (!before || !same(before.sizes, s.sizes) || before.modelId !== s.modelId) await linkDropSizes(tx, id, s.modelId);
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
  }

  /** A release's (or an after-room's) sizes and add-ons as stored. */
  private async offer(db: Db, id: string): Promise<Pick<Settings, 'sizes' | 'addons'>> {
    const [sizes, addons] = await Promise.all([
      db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', id).orderBy('position').execute(),
      db.selectFrom('live_addons').select(['id', 'label', 'line', 'price_minor']).where('drop_id', '=', id).orderBy('position').execute(),
    ]);
    return {
      sizes: sizes.map((x) => ({ id: x.id, label: x.label, stock: x.stock })),
      addons: addons.map((a) => ({ id: a.id, label: a.label, line: a.line, priceMinor: a.price_minor })),
    };
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
    if (!a) {
      if (child) {
        await tx.deleteFrom('live_addons').where('drop_id', '=', child.id).execute();
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
    await this.writeOffer(tx, id, a, child ? { modelId: child.model_id, ...(await this.offer(tx, id)) } : null);
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
      modelId: c.model_id,
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
    const [offer, counts, guests, holding] = await Promise.all([
      this.offer(db, c.id),
      this.counts(db, [c.id]),
      db.selectFrom('after_room_guests').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', c.id).executeTakeFirstOrThrow(),
      this.openHolds(db, [c.id]),
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
      model: { id: c.model_id, name: c.model_name, type: c.model_type, active: c.model_active },
      priceMinor: c.price_minor ?? 0,
      currency: c.currency ?? 'EUR',
      sizes: offer.sizes.map((x) => ({ id: x.id!, label: x.label, stock: x.stock })),
      quantity: c.quantity,
      addons: offer.addons.map((x) => ({ id: x.id!, label: x.label, line: x.line, priceMinor: x.priceMinor })),
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
    const [sizes, addons, models, windows] = await Promise.all([
      db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', d.id).orderBy('position').execute(),
      db.selectFrom('live_addons').select(['id', 'label', 'line', 'price_minor']).where('drop_id', '=', d.id).orderBy('position').execute(),
      db.selectFrom('live_access_models').select('model_id').where('drop_id', '=', d.id).orderBy('model_id').execute(),
      db.selectFrom('live_tier_windows').select(['tier', 'turn_seconds', 'pay_minutes']).where('drop_id', '=', d.id).orderBy('tier').execute(),
    ]);
    return {
      modelId: d.model_id,
      title: d.title,
      description: d.description,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      roomOpensMinutes: d.room_opens_minutes ?? LIVE_ROOM_OPENS_MINUTES.default,
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
      sizes: sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock })),
      quantityLine: d.quantity_line ?? defaultQuantityLine(d.quantity),
      addons: addons.map((a) => ({ id: a.id, label: a.label, line: a.line, priceMinor: a.price_minor })),
      announceAt: d.announce_at,
      silhouetteAt: d.silhouette_at,
      nameAt: d.name_at,
      photoAt: d.photo_at,
      tierWindows: windows.map((w) => ({ tier: w.tier, turnSeconds: w.turn_seconds, payMinutes: w.pay_minutes })),
      afterRoom: await this.afterRoomSettings(db, d.id),
    };
  }

  /**
   * The release's post of the circle, as the publication writes it: shown from the announcement (now when it is
   * already due), for the release's tier (TITANE at least: the circle is the owners'), its words from the times,
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
    return { body, minTier: Math.max(1, d.live_min_tier ?? 0), at: announced.getTime() > now.getTime() ? announced : now };
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
      model: { id: r.model_id, name: r.model_name, type: r.model_type, active: r.model_active },
      phase,
      over: r.ended_at !== null && !holding,
      announcedAt: announcedAt(r),
      roomOpensAt: roomOpensAt(r),
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      quantity: r.quantity,
      quantityLine: r.quantity_line ?? defaultQuantityLine(r.quantity),
      priceMinor: r.price_minor ?? 0,
      currency: r.currency ?? 'EUR',
      endedReason: r.ended_reason,
      entries: counts ?? EMPTY_COUNTS(),
      interest,
    };
  }

  private async release(db: Db, id: string): Promise<AdminLiveRelease> {
    const r = await this.reads(db).where('d.id', '=', id).where('d.mode', '=', 'LIVE').executeTakeFirst();
    if (!r) throw dropNotFound();
    const now = this.clock();
    const [s, counts, interest, holding, models, collection, segment, posts, creator, afterRoom, parent] = await Promise.all([
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
    ]);
    const stages = liveStages(r, now);
    const silhouette = r.silhouette_sha256 ? { sha256: r.silhouette_sha256, url: mediaUrl(r.silhouette_sha256)! } : null;
    return {
      ...this.card(r, now, counts.get(id), interest.get(id) ?? 0, holding.has(id)),
      description: r.description,
      // An after-room is set with its release, never on its own.
      editable: !r.cancelled_at && !isAnnounced(r, now) && !r.parent_drop_id,
      roomOpensMinutes: s.roomOpensMinutes,
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
      sizes: s.sizes.map((x) => ({ id: x.id!, label: x.label, stock: x.stock })),
      addons: s.addons.map((x) => ({ id: x.id!, label: x.label, line: x.line, priceMinor: x.priceMinor })),
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
    };
  }

  /** Entries as the console reads them, by place (the line), then arrival; deadlines as they stand now. */
  private async adminEntries(db: Db, d: DropRow, filter: { statuses: readonly LiveEntryStatus[] | null }, limit: number, offset: number, now: Date): Promise<AdminLiveEntry[]> {
    let q = db
      .selectFrom('live_entries as e')
      .innerJoin('accounts as a', 'a.id', 'e.account_id')
      .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
      .select([
        'e.id', 'e.account_id', 'a.email', 'e.status', 'e.size_id', 's.label', 'e.quantity', 'e.tier', 'e.position', 'e.joined_at', 'e.turn_at',
        'e.turn_expires_at', 'e.secured_at', 'e.hold_expires_at', 'e.confirmed_at', 'e.ended_at', 'e.gesture_ms', 'e.let_in_by',
      ])
      .where('e.drop_id', '=', d.id);
    if (filter.statuses) q = q.where('e.status', 'in', [...filter.statuses]);
    const rows = await q
      .orderBy(sql`e.position IS NULL`)
      .orderBy('e.position')
      .orderBy('e.joined_at')
      .orderBy('e.id')
      .limit(limit)
      .offset(offset)
      .execute();
    return rows.map((r) => ({
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
      turnExpiresAt: r.status === 'TURN' && r.turn_expires_at ? effectiveDeadline(r.turn_expires_at, d, now) : r.turn_expires_at,
      securedAt: r.secured_at,
      holdExpiresAt: r.status === 'SECURED' && r.hold_expires_at ? effectiveDeadline(r.hold_expires_at, d, now) : r.hold_expires_at,
      confirmedAt: r.confirmed_at,
      endedAt: r.ended_at,
      gestureMs: r.gesture_ms,
      letIn: r.let_in_by !== null,
    }));
  }
}
