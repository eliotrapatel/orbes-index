/**
 * THE VAULT — the rules (lot Q3, step Q3.3; plan §2.1, §2.5 states, §2.7; vault/SCOPE.md CURRENT STATE E1 "A
 * platform-wide concept. ONE vault, ONE house table for every source.", E5, E6, E10, ROUND 5, OPEN POINTS OP-26, OP-29).
 * Migrations 0061_the_vault and 0062_vault_rewards hold the tables; this file gives, reads and sets.
 *
 *   giveVault     (tx, occasion, now): a vault for an occasion of one of the seven sources (D3), in the caller's
 *                 transaction, after its own writes. Nothing when the source is switched off (a LIVE release also needs
 *                 its own switch, `drops.vault_on`, D4), the account is not ACTIVE, the account is a test entrant (ROUND 5
 *                 "Test accounts: NEVER get a vault", D9: every source, the house's GIVE A VAULT included; `isTestEntrant`)
 *                 or the cap of the source's scope is reached. The account's row is taken FOR KEY SHARE first (its
 *                 callers may hold it FOR SHARE: never raised to an update lock, step Q3.6); then `per_occasion` rows are
 *                 inserted at the lowest
 *                 free indexes of the occasion's key, `ON CONFLICT DO NOTHING` on the unique key (two passes, a retry or
 *                 two processes never give one twice: `vaults_occasion_key`). It delivers the arrival (§2.7) in the same
 *                 transaction and returns the vaults given and the audit entry `vault.give {source, occasionKey, count,
 *                 vaults}` (the system as actor; the staff member for HOUSE; never the house's note) for the caller to
 *                 record, as `ensureGrants` returns its own.
 *   the cap       OP-29: "every per-source limit is a setting in CLUB > THE VAULT". `per_occasion` is how many vaults one
 *                 occasion gives (1 to 10), `cap` how many occasions an account receives per the source's scope (LIVE per
 *                 release, PIECE per piece, TIER per tier, WORN per piece, FRIEND per friend, PROFILE ever; NULL: no cap;
 *                 HOUSE always NULL, each gift its own key). The vaults kept under one key are at most `per_occasion` ×
 *                 `cap` (the migration's index bound, 1 000); a revoked vault counts for nothing (it can be given again).
 *   the states    computed, never stored (D17, N27): WAITING (not opened, not revoked, before `waits_until` = given + 30
 *                 days), OPENED, EXPIRED (never opened, past `waits_until`: in no list but the console's), REVOKED (a
 *                 returned piece, D5).
 *   forAccount    THE VAULT page's data: YOUR VAULTS (waiting, oldest first, each with its source's label and detail and
 *                 WAITS UNTIL as a Paris day), OPENED (newest first: the Paris day opened, its source's label, what it
 *                 held), the ledger HOW TO OBTAIN A VAULT with this collector's state (N21: a source switched off is
 *                 hidden; A LIVE RELEASE's NEXT the next announced LIVE release with its vault on, a Paris day; A NEW
 *                 TIER's progress or the highest tier; YOUR PROFILE done or its percentage), and `waitingCount` (the quiet
 *                 number next to THE VAULT and NOW's line, D18; `waitingCount` alone for the summary).
 *   the arrival   E6 "A new vault: a FROM ORBES message": a `house_deliveries` row, source VAULT, `dedupe_key`
 *                 `VAULT:<the first vault given>`, its title and words rendered now (src/shared/house-words.ts
 *                 vaultArrivedWords, the "we" of ROUND 5) with the occasion and its WAITS UNTIL day. Not a moment: no
 *                 switch, it is part of the vault (D18).
 *   the settings  CLUB > THE VAULT's reads and writes (the routes are step Q3.9, the console Q3.12): the seven sources
 *                 (`setSource`: the switch, vaults per occasion, the cap; audited `vault.settings`), the one house table
 *                 (`createReward`, `updateReward`, `deactivateReward`, `orderRewards`; audited `vault.reward.*`), each
 *                 save under the floor row's lock, refused when the odds of the active rows add up to more than one in
 *                 one (409 VAULT_ODDS_OVER, N15: each row holds round(1 000 000 / N) of the draw's 1 000 000 parts), a
 *                 SERVICE add-on refused as a reward (409 VAULT_REWARD_SERVICE, E7, D64). `settings()` gives the floor's
 *                 published odds: the remainder's, `1 IN round(1 / remainder)`.
 *
 *   the opening  (step Q3.4; plan §2.2, §2.4, §2.7) `open`: in one transaction the vault FOR UPDATE (404 VAULT_NOT_FOUND
 *                for another account's; 409 VAULT_EXPIRED, VAULT_REVOKED; an opened vault's outcome read again, so a lost
 *                answer is never a second draw), the active rewards FOR KEY SHARE (the floor's row first, as the table's
 *                settings lock it, then by id: openings never wait for each other, a settings save waits for them), then
 *                the draw on the server
 *                (N26): `crypto.randomInt` over 1 000 000 parts, each active row its round(1 000 000 / N) in the table's
 *                order, the floor the rest (N15). A row drawn that cannot give (its quantity reached, its add-on set
 *                aside or no longer a PRODUCT, its model set aside or without a unit to reserve, THE PIECE of a vault
 *                without a LIVE release or a unit in the entry's size) gives I WAS THERE in its place, at the card's
 *                published odds: "a reward that runs out sends its odds to the card (published odds never change)"
 *                (E1, round 2). The outcome is written once (prize, line, odds `1 IN 200`, rare for GUARANTEED, VAULT
 *                EDITION and THE PIECE (N14), value, cost), its row's `given` + 1 (a row with a quantity counted in one
 *                statement before its delivery, the card in its place when its last one has just gone), delivered where it belongs (E9:
 *                credits in YOUR ACCOUNT, products in YOUR ORDERS) with a FROM ORBES receipt (`VAULT_OPENED:<vault>`),
 *                audited `vault.open` (its kind and rarity, never another row's odds).
 *   delivered    CREDIT a VAULT credit (services/tier-grants.ts) of the row's amount, 30 days; ADDON the vault's offer
 *                for 30 days, one unit at 0 attached to the next order at its creation (services/order-addons.ts
 *                attachVaultAddons), a PRODUCT add-on only (E7: never a service); GUARANTEED a house guarantee of scope
 *                LIVE (services/guarantees.ts grantFromVault); CREDIT TO GIVE a one-time link (`vault_gifts`, 30 days)
 *                whose friend, holding no piece, accepts a VAULT credit for a first piece (`acceptGift`; never
 *                `accounts.invited_by`: the FRIEND source stays the invitation link's alone); I WAS THERE nothing but its
 *                card. A PRODUCT under its RIGHT TO BUY is its 24-hour offer (round 2; `buy`, or an add-on's ADD on an
 *                order); a product won FREE, a VAULT EDITION and THE PIECE are a VAULT order at 0 holding the unit
 *                reserved for the winner at the opening, claimed within 30 days (`claim`) or cancelled by the
 *                housekeeping with its unit back to stock (`expireClaims`; step Q3.7, services/vault-orders.ts).
 *
 *   the sources  (step Q3.6; plan §2.3.2–7, §2.6) each one hook in the transaction that makes its occasion: PIECE and
 *                FRIEND at a first registration (`giveFirstRegistrationVaults`), TIER right after each `ensureGrants`
 *                (`giveTierVaults`), WORN at a publication (services/worn.ts), PROFILE at a save that completes it
 *                (`giveProfileVault`), HOUSE by GIVE A VAULT (`giveFromHouse`); a returned piece takes its unopened PIECE
 *                vault back (`revokeReturnedPieceVaults`); the personal invitation (`invitation`, `inviterOf`).
 *
 * No pity rule, no budget cap, no account-age rule (E10 "Not chosen: pity guarantee, budget cap (the quantities are the
 * limit), account-age rule", D22): none is built.
 */
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { sql, type ExpressionBuilder } from 'kysely';
import { utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { inRetriedTransaction, inTransaction, type Db } from '../db/connection.js';
import {
  CLUB_TIER_NAMES,
  HOUSE_CURRENCIES,
  INVITATION_CODE_PATTERN,
  VAULT_AMOUNT_MINOR_MAX,
  VAULT_CAP,
  VAULT_GIFT_DAYS,
  VAULT_ODDS_IN_MAX,
  VAULT_OCCASION_INDEX_MAX,
  VAULT_PER_OCCASION,
  VAULT_REWARD_KINDS,
  VAULT_REWARD_LINE_MAX,
  VAULT_REWARD_MODES,
  VAULT_REWARD_POSITION_MAX,
  VAULT_NOTE_MAX,
  VAULT_PRIZE_LINE_MAX,
  VAULT_PRIZE_MAX,
  VAULT_SOURCES,
  VAULT_WAIT_DAYS,
  type ClubTierName,
  type Database,
  type OrderRow,
  type VaultRewardKind,
  type VaultRewardMode,
  type VaultSource,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { SYSTEM_ACTOR, systemClock, type Actor, type Clock } from '../types.js';
import { VAULT_REVEAL, vaultArrivedWords, vaultMoney, vaultOpenedWords, vaultSourceLine, VAULT_SOURCE_LABELS, type VaultWhere } from '../../shared/house-words.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { customerAccountLocked, normalizeEmail } from './auth.js';
import { birthdayExpiry } from './birthday-credits.js';
import { CROCKFORD_ALPHABET, formatGrouped, normalizeCrockford, randomCrockford } from './claim-codes.js';
import { CLUB_TIER_THRESHOLDS, isTestEntrant, tierName, tierOf } from './club.js';
import { grantFromVault } from './guarantees.js';
import { deliveredBody, deliveredTitle, pieceName } from './house-moments.js';
import { withLiveChanges, type LiveChanges, type LiveFrameGate } from './live-frames.js';
import type { ProfileService } from './profiles.js';
import { parisDay, parisDayStart } from './schedule.js';
import { cleanCriteria, segmentCondition } from './segments.js';
import { lockAccountAddresses } from './addresses.js';
import {
  addressOf,
  checkOrderAddress,
  createOrder,
  recordChange,
  serveWaiting,
  shippable,
  shippingFor,
  step,
  updateOrder,
  writeOrderAddress,
  type OrderAddressInput,
  type OrderMail,
} from './orders.js';
import { offeredSizes, savedSizeAmong } from './sizes.js';
import { defaultLocationId, ensureSku, lockSku, sizeLabelOf, stockLevel } from './stock.js';
import {
  isThePiece,
  unclaimedVaultOrders,
  usualPrice,
  vaultAddressMissing,
  vaultFreeOrder,
  vaultOfferEnded,
  vaultSizeNoneLeft,
  vaultUnit,
  type VaultUnit,
} from './vault-orders.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 3_600_000;

/** An account's id checked and lowercased; `missing` thrown otherwise. */
function knownAccount(accountId: unknown, missing: () => DomainError): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw missing();
  return accountId.toLowerCase();
}
const orderNotFoundError = () => notFound('Order', 'ORDER_NOT_FOUND');

/** How long a vault waits: 30 days of 24 hours from its giving (D17; `vaults_waits`, whatever the summer time). */
export const VAULT_WAIT_MS = VAULT_WAIT_DAYS * 24 * HOUR_MS;
/** The draw's parts (N15): each active row holds round(VAULT_DRAW_PARTS / odds_in) of them, the floor the rest. */
export const VAULT_DRAW_PARTS = 1_000_000;

// ── The occasions ──────────────────────────────────────────────────────────

/** An occasion of a source, with the keys its vault names (`vaults_occasion`). */
export type VaultOccasion =
  | { source: 'LIVE'; accountId: string; dropId: string; entryId: string }
  | { source: 'PIECE'; accountId: string; productId: string }
  | { source: 'TIER'; accountId: string; tier: 1 | 2 | 3 }
  | { source: 'WORN'; accountId: string; productId: string; wornPhotoId: string }
  | { source: 'FRIEND'; accountId: string; friendAccountId: string }
  | { source: 'PROFILE'; accountId: string }
  /** The house's GIVE A VAULT: `giftId` names the gift (one per press, shared by a segment's members), `givenBy` its staff member. */
  | { source: 'HOUSE'; accountId: string; giftId: string; givenBy: string; segmentId?: string | null; note?: string | null };

/** The occasion's key, as the caps count it (`vaults_occasion`): `LIVE:<drop>`, `PIECE:<product>`, `TIER:<n>`… */
export function occasionKey(o: VaultOccasion): string {
  switch (o.source) {
    case 'LIVE':
      return `LIVE:${o.dropId.toLowerCase()}`;
    case 'PIECE':
      return `PIECE:${o.productId.toLowerCase()}`;
    case 'TIER':
      return `TIER:${o.tier}`;
    case 'WORN':
      return `WORN:${o.productId.toLowerCase()}`;
    case 'FRIEND':
      return `FRIEND:${o.friendAccountId.toLowerCase()}`;
    case 'PROFILE':
      return 'PROFILE';
    case 'HOUSE':
      return `HOUSE:${o.giftId.toLowerCase()}`;
  }
}

/** The occasion's own columns (every other one NULL). */
function occasionColumns(o: VaultOccasion) {
  const id = (s: string) => s.toLowerCase();
  switch (o.source) {
    case 'LIVE':
      return { drop_id: id(o.dropId), entry_id: id(o.entryId) };
    case 'PIECE':
      return { product_id: id(o.productId) };
    case 'TIER':
      return { tier: o.tier };
    case 'WORN':
      return { product_id: id(o.productId), worn_photo_id: id(o.wornPhotoId) };
    case 'FRIEND':
      return { friend_account_id: id(o.friendAccountId) };
    case 'PROFILE':
      return {};
    case 'HOUSE':
      return { given_by: id(o.givenBy), segment_id: o.segmentId ? id(o.segmentId) : null, note: o.note ?? null };
  }
}

/** The occasion checked: its source known and its ids UUIDs; a HOUSE note trimmed (1 to 500 characters) or none (a blank note is none). */
function checkOccasion(o: VaultOccasion): VaultOccasion {
  if (!o || typeof o !== 'object' || !(VAULT_SOURCES as readonly string[]).includes(o.source)) throw validationError('A vault needs one of its sources.');
  const uuids: unknown[] = [o.accountId];
  if (o.source === 'LIVE') uuids.push(o.dropId, o.entryId);
  if (o.source === 'PIECE') uuids.push(o.productId);
  if (o.source === 'WORN') uuids.push(o.productId, o.wornPhotoId);
  if (o.source === 'FRIEND') uuids.push(o.friendAccountId);
  if (o.source === 'HOUSE') uuids.push(o.giftId, o.givenBy, ...(o.segmentId ? [o.segmentId] : []));
  if (uuids.some((u) => typeof u !== 'string' || !UUID_RE.test(u))) throw validationError('A vault’s occasion names an unknown id.');
  if (o.source === 'TIER' && ![1, 2, 3].includes(o.tier)) throw validationError('A tier is 1, 2 or 3.');
  if (o.source === 'FRIEND' && o.friendAccountId.toLowerCase() === o.accountId.toLowerCase()) throw validationError('A friend is another account.');
  if (o.source === 'HOUSE' && o.note !== undefined && o.note !== null) return { ...o, note: houseNote(o.note) };
  return o;
}

/** A HOUSE vault's note: trimmed, 1 to 500 characters, or none (a blank note is none). */
function houseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw validationError(`A note is 1 to ${VAULT_NOTE_MAX} characters.`);
  const note = v.trim();
  if (note.length === 0) return null;
  if ([...note].length > VAULT_NOTE_MAX) throw validationError(`A note is 1 to ${VAULT_NOTE_MAX} characters.`);
  return note;
}

// ── The states ─────────────────────────────────────────────────────────────

export type VaultState = 'WAITING' | 'OPENED' | 'EXPIRED' | 'REVOKED';

/** A vault's state at `now`, computed (D17, N27): REVOKED, OPENED, then WAITING before `waits_until`, EXPIRED after. */
export function vaultState(v: { opened_at: Date | null; revoked_at: Date | null; waits_until: Date }, now: Date): VaultState {
  if (v.revoked_at) return 'REVOKED';
  if (v.opened_at) return 'OPENED';
  return now.getTime() < new Date(v.waits_until).getTime() ? 'WAITING' : 'EXPIRED';
}

// ── Giving ─────────────────────────────────────────────────────────────────

/** A vault given. */
export interface GivenVault {
  id: string;
  accountId: string;
  source: VaultSource;
  occasionKey: string;
  occasionIndex: number;
  givenAt: Date;
  waitsUntil: Date;
}

/** Why nothing was given. */
export type VaultSkip = 'SOURCE_OFF' | 'RELEASE_OFF' | 'NOT_ACTIVE' | 'TEST_ENTRANT' | 'CAP';

/** What `giveVault` did: the vaults given (none, and why), the arrival delivered, the audit entries to record. */
export interface VaultGiven {
  vaults: GivenVault[];
  skipped: VaultSkip | null;
  /** The FROM ORBES arrival (house_deliveries.id), or null when nothing was given. */
  deliveryId: string | null;
  notes: AuditRecordInput[];
}

/** A source's settings row. */
interface SourceRow {
  enabled: boolean;
  per_occasion: number;
  cap: number | null;
}

/** The lowest `count` indexes from 1 that `taken` does not hold, never above the bound. */
function freeIndexes(taken: readonly number[], count: number, max: number): number[] {
  const used = new Set(taken);
  const out: number[] = [];
  for (let i = 1; i <= max && out.length < count; i++) if (!used.has(i)) out.push(i);
  return out;
}

/** The occasion's detail as its door and its arrival say it: the release's piece, the new piece's, the tier reached. */
async function occasionDetail(tx: Db, o: VaultOccasion): Promise<string | null> {
  if (o.source === 'TIER') return CLUB_TIER_NAMES[o.tier - 1] ?? null;
  if (o.source === 'LIVE') {
    const r = await tx
      .selectFrom('drops as d')
      .leftJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('sets as s', 's.id', 'd.set_id')
      .select(['m.name as model', 'm.variant_label', 's.name as set'])
      .where('d.id', '=', o.dropId.toLowerCase())
      .executeTakeFirst();
    return r ? (r.model ? pieceName(r.model, r.variant_label) : (r.set ?? null)) : null;
  }
  if (o.source === 'PIECE' || o.source === 'WORN') {
    const r = await tx.selectFrom('products as p').innerJoin('models as m', 'm.id', 'p.model_id').select(['m.name', 'm.variant_label']).where('p.id', '=', o.productId.toLowerCase()).executeTakeFirst();
    return r ? pieceName(r.name, r.variant_label) : null;
  }
  return null;
}

/**
 * A vault for `occasion`, in the caller's transaction `tx` (see the head of this file). Returns the vaults given (none,
 * with why), the arrival delivered and the audit entries the caller records in `tx`.
 */
export async function giveVault(tx: Db, occasion: VaultOccasion, now: Date): Promise<VaultGiven> {
  const o = checkOccasion(occasion);
  const accountId = o.accountId.toLowerCase();
  const none = (skipped: VaultSkip): VaultGiven => ({ vaults: [], skipped, deliveryId: null, notes: [] });

  const source = (await tx.selectFrom('vault_sources').select(['enabled', 'per_occasion', 'cap']).where('source', '=', o.source).executeTakeFirst()) as SourceRow | undefined;
  if (!source?.enabled) return none('SOURCE_OFF');
  if (o.source === 'LIVE') {
    const d = await tx.selectFrom('drops').select('vault_on').where('id', '=', o.dropId.toLowerCase()).executeTakeFirst();
    if (!d?.vault_on) return none('RELEASE_OFF');
  }
  // The account's row FOR KEY SHARE: its status read and kept while the vault is given. Two gives of one occasion's key
  // at once are ordered by the unique key (`vaults_occasion_key`: the second insert of an index waits for the first and
  // gives nothing), the cap counts one key's vaults only, so no stronger lock is needed; and none may be taken: the
  // callers already hold the account's row FOR SHARE (a LIVE action, a first registration, an address saved) and two of
  // them raising it to an update lock at once would deadlock (step Q3.6).
  const account = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forKeyShare().executeTakeFirst();
  if (account?.status !== 'ACTIVE') return none('NOT_ACTIVE');
  if (await isTestEntrant(tx, accountId)) return none('TEST_ENTRANT');
  if (o.source === 'FRIEND' && (await isTestEntrant(tx, o.friendAccountId))) return none('TEST_ENTRANT');

  const key = occasionKey(o);
  const kept = await tx.selectFrom('vaults').select('occasion_index').where('account_id', '=', accountId).where('occasion_key', '=', key).where('revoked_at', 'is', null).execute();
  const most = source.cap === null ? VAULT_OCCASION_INDEX_MAX : Math.min(VAULT_OCCASION_INDEX_MAX, source.cap * source.per_occasion);
  const indexes = freeIndexes(
    kept.map((k) => k.occasion_index),
    Math.min(source.per_occasion, most - kept.length),
    VAULT_OCCASION_INDEX_MAX,
  );
  if (indexes.length === 0) return none('CAP');

  const waitsUntil = new Date(now.getTime() + VAULT_WAIT_MS);
  const columns = occasionColumns(o);
  const inserted = await tx
    .insertInto('vaults')
    .values(indexes.map((i) => ({ account_id: accountId, source: o.source, ...columns, occasion_key: key, occasion_index: i, given_at: now, waits_until: waitsUntil })))
    .onConflict((oc) => oc.doNothing())
    .returning(['id', 'occasion_index', 'given_at', 'waits_until'])
    .execute();
  if (inserted.length === 0) return none('CAP');
  const vaults: GivenVault[] = inserted
    .map((v) => ({ id: v.id, accountId, source: o.source, occasionKey: key, occasionIndex: v.occasion_index, givenAt: new Date(v.given_at), waitsUntil: new Date(v.waits_until) }))
    .sort((a, b) => a.occasionIndex - b.occasionIndex);

  // The arrival (E6): one FROM ORBES message for the occasion's vaults, in the "we" of ROUND 5.
  const words = vaultArrivedWords({ source: o.source, detail: await occasionDetail(tx, o), count: vaults.length, until: parisDay(waitsUntil) });
  const delivery = await tx
    .insertInto('house_deliveries')
    .values({ account_id: accountId, source: 'VAULT', title: deliveredTitle(words.title) ?? words.title, body: deliveredBody(words.body) ?? words.body, dedupe_key: `VAULT:${vaults[0]!.id}`, delivered_at: now })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .returning('id')
    .executeTakeFirst();

  const actor: Actor = o.source === 'HOUSE' ? { type: 'admin', id: o.givenBy.toLowerCase() } : SYSTEM_ACTOR;
  const notes: AuditRecordInput[] = [
    {
      actor,
      action: 'vault.give',
      targetType: 'account',
      targetId: accountId,
      details: {
        source: o.source,
        occasionKey: key,
        count: vaults.length,
        vaults: vaults.map((v) => v.id),
        ...(o.source === 'HOUSE' ? { segmentId: o.segmentId ?? null, note: o.note ? true : false } : {}),
      },
    },
  ];
  return { vaults, skipped: null, deliveryId: delivery?.id ?? null, notes };
}

// ── The LIVE source ────────────────────────────────────────────────────────

/** A LIVE release as its source reads it. */
export interface LiveVaultRelease {
  id: string;
  set_id: string | null;
  parent_drop_id: string | null;
  vault_on: boolean;
}

/**
 * THE VAULT's LIVE source (step Q3.5; plan §2.3.1; S E2 "late comers who joined and stayed included; leaving the line =
 * no vault; one per account per release; staff switch per LIVE release, off by default", round 2 trigger "WHEN YOUR
 * SIZE SELLS OUT", D4). In the transaction of the PAY that sold `sizeIds` out (services/live.ts `confirm`, its
 * `soldOutSizes`: each of its sizes now fully confirmed, every size when the release sold out whole, D6), before
 * `settleEnd` ENDS the line: a vault (`giveVault`'s rules: its source and the release's switches, its cap) for every
 * entry of those sizes still in the line, WAITING or QUEUED, a late comer who joined and stayed included; LEFT,
 * RELEASED, REMOVED, MISSED, EXPIRED never. Nothing on a release with its switch off, nor on an after-room
 * (`drops_vault_on`: its guests were given theirs at its parent's sell-out, N20; a piece won there never takes it back,
 * D7), nor for a test entrant (D9) or an account not ACTIVE. A release that CLOSES with pieces left sells no size out at
 * its end and gives none (D8; `confirm` gives nothing once `closes_at` has passed). The release's row is held by the
 * caller (FOR NO KEY UPDATE) for the whole give, so it is set-based, whatever the line's length: one read of the source,
 * one of the entries (their accounts FOR KEY SHARE, in their ids' order), the vaults inserted LIVE_GIVE_CHUNK rows a
 * statement (ON CONFLICT DO NOTHING on `vaults_occasion_key`), the occasion's detail read once and the FROM ORBES
 * arrivals inserted the same way (`dedupe_key` VAULT:<the account's first vault>). Returns the audit entries
 * (`vault.give` per account, as `giveVault` writes it) for the caller to record.
 */
export async function giveLiveVaults(tx: Db, d: LiveVaultRelease, sizeIds: readonly string[], now: Date): Promise<AuditRecordInput[]> {
  if (sizeIds.length === 0 || !d.vault_on || d.parent_drop_id !== null) return [];
  // The source and the release's switch read once (the caller holds the release's row, so `d.vault_on` is current).
  const source = (await tx.selectFrom('vault_sources').select(['enabled', 'per_occasion', 'cap']).where('source', '=', 'LIVE').executeTakeFirst()) as SourceRow | undefined;
  if (!source?.enabled) return [];
  const dropId = d.id.toLowerCase();
  const key = occasionKey({ source: 'LIVE', accountId: dropId, dropId, entryId: dropId });
  // The entries given to, in one read: still in the line, ACTIVE (the account's row FOR KEY SHARE, as `giveVault` takes
  // it for LIVE), never a test entrant, none already holding this release's vault (one entry per account per release).
  const entries = await tx
    .selectFrom('live_entries as e')
    .innerJoin('accounts as a', 'a.id', 'e.account_id')
    .select(['e.id', 'e.account_id'])
    .where('e.drop_id', '=', dropId)
    .where('e.status', 'in', ['WAITING', 'QUEUED'])
    .where((eb) =>
      d.set_id === null
        ? eb('e.size_id', 'in', [...sizeIds])
        : eb.exists(eb.selectFrom('live_entry_sizes as x').select('x.entry_id').whereRef('x.entry_id', '=', 'e.id').where('x.size_id', 'in', [...sizeIds])),
    )
    .where('a.status', '=', 'ACTIVE')
    .where((eb) => eb.not(eb.exists(eb.selectFrom('test_entrants as t').select('t.account_id').whereRef('t.account_id', '=', 'e.account_id'))))
    .where((eb) =>
      eb.not(eb.exists(eb.selectFrom('vaults as v').select('v.id').whereRef('v.account_id', '=', 'e.account_id').where('v.occasion_key', '=', key).where('v.revoked_at', 'is', null))),
    )
    .orderBy('e.account_id')
    .forKeyShare('a')
    .execute();
  if (entries.length === 0) return [];

  // Each account holds none under the key: its vaults are the indexes 1 to `per_occasion`, within the cap (as `giveVault`).
  const most = source.cap === null ? VAULT_OCCASION_INDEX_MAX : Math.min(VAULT_OCCASION_INDEX_MAX, source.cap * source.per_occasion);
  const count = Math.min(source.per_occasion, most);
  if (count <= 0) return [];
  const waitsUntil = new Date(now.getTime() + VAULT_WAIT_MS);
  const rows = entries.flatMap((e) =>
    Array.from({ length: count }, (_, i) => ({ account_id: e.account_id, source: 'LIVE' as const, drop_id: dropId, entry_id: e.id, occasion_key: key, occasion_index: i + 1, given_at: now, waits_until: waitsUntil })),
  );
  const given = new Map<string, { id: string; index: number }[]>();
  for (const chunk of chunked(rows, LIVE_GIVE_CHUNK)) {
    const inserted = await tx.insertInto('vaults').values(chunk).onConflict((oc) => oc.doNothing()).returning(['id', 'account_id', 'occasion_index']).execute();
    for (const v of inserted) given.set(v.account_id, [...(given.get(v.account_id) ?? []), { id: v.id, index: v.occasion_index }]);
  }
  if (given.size === 0) return [];

  // The arrivals (E6): one FROM ORBES message per account, the occasion's detail read once, in as few inserts.
  const detail = await occasionDetail(tx, { source: 'LIVE', accountId: dropId, dropId, entryId: dropId });
  const until = parisDay(waitsUntil);
  const accounts = [...given.keys()].sort();
  const vaultsOf = (accountId: string) => given.get(accountId)!.sort((a, b) => a.index - b.index);
  const deliveries = accounts.map((accountId) => {
    const vaults = vaultsOf(accountId);
    const words = vaultArrivedWords({ source: 'LIVE', detail, count: vaults.length, until });
    return { account_id: accountId, source: 'VAULT' as const, title: deliveredTitle(words.title) ?? words.title, body: deliveredBody(words.body) ?? words.body, dedupe_key: `VAULT:${vaults[0]!.id}`, delivered_at: now };
  });
  for (const chunk of chunked(deliveries, LIVE_GIVE_CHUNK)) await tx.insertInto('house_deliveries').values(chunk).onConflict((oc) => oc.column('dedupe_key').doNothing()).execute();

  return accounts.map((accountId) => {
    const vaults = vaultsOf(accountId);
    return { actor: SYSTEM_ACTOR, action: 'vault.give', targetType: 'account', targetId: accountId, details: { source: 'LIVE', occasionKey: key, count: vaults.length, vaults: vaults.map((v) => v.id) } };
  });
}

/** The rows one LIVE give inserts per statement (8 parameters each, far under PostgreSQL's 65 535). */
const LIVE_GIVE_CHUNK = 1_000;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── The other sources and the return (step Q3.6; plan §2.3.2–7, §2.6) ──────

/**
 * Whether a piece registered for the first time was bought (D5, round 5 "ONE VAULT PER PIECE; EVERY CHANNEL (LIVE,
 * draws, salon, later Shopify) once registered to the buyer"; his words 22 Oct 23:46 "everytime a piece is ordered, they
 * get a vault when the piece is registered"; N8). Its order is the latest one holding it that was neither CANCELLED nor
 * RETURNED (a returned piece sold again is its new order's): a welcome GIFT, an EXCHANGE's replacement (the exchanged
 * piece keeps its own) and a VAULT order at 0 (a product won free, a VAULT EDITION, THE PIECE) were not bought; a VAULT
 * order bought under its RIGHT TO BUY (its price above 0) was, as every LIVE, DRAW and SALON order. A piece no order holds
 * was sold outside the platform's orders (a counter sale, a piece claimed with its code; later a Shopify order, S6):
 * bought. Given `accountId` (the account registering it first), a piece its order holds counts only for that order's
 * buyer ("once registered to the buyer"): registered first by anyone else (a box given before its registration), it
 * opens no PIECE vault, for the buyer or for the registrant.
 */
export async function pieceBought(tx: Db, productUuid: string, accountId?: string): Promise<boolean> {
  const o = await tx
    .selectFrom('orders')
    .select(['channel', 'price_minor', 'account_id'])
    .where('product_id', '=', productUuid.toLowerCase())
    .where('status', 'not in', ['CANCELLED', 'RETURNED'])
    .orderBy('reserved_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!o) return true;
  if (accountId !== undefined && o.account_id.toLowerCase() !== accountId.toLowerCase()) return false;
  return orderOfABoughtPiece(o);
}

/**
 * Whether an order's piece was bought (N8): every LIVE, DRAW and SALON order (later a Shopify one, S6), a VAULT order
 * bought under its RIGHT TO BUY (its price above 0); never a welcome GIFT, an EXCHANGE's replacement nor a VAULT order at
 * 0. Its piece opens a PIECE vault at its first registration by its buyer (`pieceBought`), and its parcel carries THE
 * VAULT CARD (services/parcels.ts vaultCardOrders, §2.8, N9).
 */
export function orderOfABoughtPiece(o: Pick<OrderRow, 'channel' | 'price_minor'>): boolean {
  if (o.channel === 'GIFT' || o.channel === 'EXCHANGE') return false;
  if (o.channel === 'VAULT') return (o.price_minor ?? 0) > 0;
  return true;
}

/**
 * THE VAULT at a first registration (services/ownership.ts completeFirstRegistration, after the tiers' grants and
 * `giveTierVaults`), in its transaction: EACH PIECE BOUGHT (§2.3.2) a PIECE vault for the piece when it was bought
 * (`pieceBought`, by its order's buyer), one per piece ever while its last one is not revoked (the cap, default 1); A FRIEND'S FIRST PIECE
 * (§2.3.5) the inviter's FRIEND vault when this is the account's first ownership ever and it was invited
 * (`accounts.invited_by`, set only by the personal invitation link at sign-up: never by a credit to give, N10); the
 * inviter ACTIVE and neither a test entrant (`giveVault`). A transfer is never a first registration: no vault (D5 "FIRST
 * REGISTRATION ONLY (no vault for a second-hand piece)"). Returns the audit entries for the caller to record.
 */
export async function giveFirstRegistrationVaults(tx: Db, accountId: string, productUuid: string, now: Date): Promise<AuditRecordInput[]> {
  const account = accountId.toLowerCase();
  const notes: AuditRecordInput[] = [];
  if (await pieceBought(tx, productUuid, account)) notes.push(...(await giveVault(tx, { source: 'PIECE', accountId: account, productId: productUuid }, now)).notes);
  const owned = await tx.selectFrom('ownership').select((eb) => eb.fn.countAll<string>().as('n')).where('account_id', '=', account).executeTakeFirstOrThrow();
  if (Number(owned.n) === 1) {
    const a = await tx.selectFrom('accounts').select('invited_by').where('id', '=', account).executeTakeFirst();
    if (a?.invited_by) notes.push(...(await giveVault(tx, { source: 'FRIEND', accountId: a.invited_by, friendAccountId: account }, now)).notes);
  }
  return notes;
}

/**
 * A NEW TIER (§2.3.3; OP-29 "one per tier reached"; N6, N7, N34, D68), in the caller's transaction, right after
 * `ensureGrants` at each of its call sites (a first registration, a transfer accepted, a piece counted again, an order
 * created, a status read) and never inside it (its `tier < 2` early return would skip TITANE): a TIER vault for each tier
 * the account holds now (`tierOf`) that it first reached after the deployment, so TITANE at the first registration
 * itself. A tier whose `TIER:n` key is in `vault_occasions_before` (held at migration 0061) or was already given gives
 * none: the first status read after the deployment gives nothing to a collector already at a tier, and a tier lost and
 * reached again gives none (a tier is reached once; the cap holds the rest). Returns the audit entries to record.
 */
export async function giveTierVaults(tx: Db, accountId: string, now: Date): Promise<AuditRecordInput[]> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) return [];
  const account = accountId.toLowerCase();
  const { tier } = await tierOf(tx, account, now);
  if (tier < 1) return [];
  const keys = ([1, 2, 3] as const).filter((n) => n <= tier).map((n) => `TIER:${n}` as const);
  const [before, given] = [
    await tx.selectFrom('vault_occasions_before').select('occasion_key').where('account_id', '=', account).where('occasion_key', 'in', keys).execute(),
    await tx.selectFrom('vaults').select('occasion_key').where('account_id', '=', account).where('occasion_key', 'in', keys).execute(),
  ];
  const known = new Set<string>([...before.map((r) => r.occasion_key), ...given.map((r) => r.occasion_key)]);
  const notes: AuditRecordInput[] = [];
  for (const n of [1, 2, 3] as const) {
    if (n > tier || known.has(`TIER:${n}`)) continue;
    notes.push(...(await giveVault(tx, { source: 'TIER', accountId: account, tier: n }, now)).notes);
  }
  return notes;
}

/**
 * A COMPLETE PROFILE, once (§2.3.6; N34, D68), at a save `completion()` reads (YOUR PROFILE's, Client Services' edit and
 * date of birth, a first address saved as the default): `missingBefore` read before the save's writes and
 * `missingAfter` after them, in its transaction; only a save that moves `missing` from non-empty to empty gives a
 * vault, so a profile complete before the deployment and saved again gives none. Returns the audit entries to record.
 */
export async function giveProfileVault(tx: Db, accountId: string, missingBefore: readonly string[], missingAfter: readonly string[], now: Date): Promise<AuditRecordInput[]> {
  if (missingBefore.length === 0 || missingAfter.length > 0) return [];
  return (await giveVault(tx, { source: 'PROFILE', accountId }, now)).notes;
}

/**
 * A RETURNED PIECE TAKES ITS VAULT BACK (§2.6; round 5 "unopened vault removed, opened keeps what it held"), in the
 * return's transaction (services/orders.ts returnInTransaction: a return decided with the piece back to ORBES, a set's
 * whole return for each of its pieces, Client Services' RETURNED): the piece's PIECE vault still unopened is revoked
 * (`revoked_reason` RETURNED, the only taking-back, N36); an opened one keeps what it held; a WORN, TIER or FRIEND vault
 * is never taken back by a return. A size exchange keeps the vault (the caller does not call this). Returns the audit
 * entries (`vault.revoke`, the system as actor) for the caller to record.
 */
export async function revokeReturnedPieceVaults(tx: Db, productUuid: string, now: Date): Promise<AuditRecordInput[]> {
  const revoked = await tx
    .updateTable('vaults')
    .set({ revoked_at: sql<Date>`greatest(${now}::timestamptz, given_at)`, revoked_reason: 'RETURNED' })
    .where('source', '=', 'PIECE')
    .where('product_id', '=', productUuid.toLowerCase())
    .where('opened_at', 'is', null)
    .where('revoked_at', 'is', null)
    .returning(['id', 'account_id', 'occasion_key'])
    .execute();
  return revoked.map((v) => ({
    actor: SYSTEM_ACTOR,
    action: 'vault.revoke',
    targetType: 'account',
    targetId: v.account_id,
    details: { vaultId: v.id, source: 'PIECE', occasionKey: v.occasion_key, reason: 'RETURNED' },
  }));
}

/** A personal invitation's code: 12 Crockford characters (`invitations.code`, INVITATION_CODE_PATTERN). */
export const INVITATION_CODE_LENGTH = 12;

/**
 * The inviter a personal invitation's code names (any accepted spelling), or null: unknown, malformed or none. Read by
 * CREATE ACCOUNT (services/auth.ts registerAccount), which sets `accounts.invited_by` once; an unknown code never
 * refuses a sign-up.
 */
export async function inviterOf(db: Db, code: unknown): Promise<string | null> {
  const canonical = normalizeCrockford(code, INVITATION_CODE_LENGTH);
  if (canonical === undefined || !INVITATION_CODE_PATTERN.test(canonical)) return null;
  const r = await db.selectFrom('invitations').select('account_id').where('code', '=', canonical).executeTakeFirst();
  return r?.account_id ?? null;
}

/** THE HOUSE gives (GIVE A VAULT, §2.3.7): one collector (its account id or email) or a segment's members. */
export interface HouseGiveInput {
  accountId?: unknown;
  email?: unknown;
  segmentId?: unknown;
  note?: unknown;
  /** The reach only, nothing given. */
  dryRun?: unknown;
  /**
   * The gift's id chosen by the console (a UUID, the press's idempotency key): a press sent again with it gives under the
   * same `HOUSE:<giftId>` and skips the members it already reached (a batch given before one that failed). Absent: a new one.
   */
  giftId?: unknown;
}

/** What GIVE A VAULT did, or would do (`dryRun`). */
export interface HouseGiven {
  /** The gift's id (`HOUSE:<id>`), shared by a segment's members; null on a dry run. */
  giftId: string | null;
  dryRun: boolean;
  /** The accounts it reaches: ACTIVE, never a test entrant. */
  reach: number;
  /** The accounts given their vaults (a dry run: 0), and the vaults given. */
  accounts: number;
  vaults: number;
  /** Left out and counted apart (N25): the test entrants (D9) and the accounts not ACTIVE (an erased one is no collector). */
  leftOut: { testEntrants: number; inactive: number };
}

/** The accounts GIVE A VAULT gives to per transaction (N25). */
export const HOUSE_GIVE_BATCH = 500;

export const vaultSourceOff = () => conflict('VAULT_SOURCE_OFF', 'THE HOUSE is switched off in CLUB > THE VAULT. Switch it on first.');

// ── THE VAULT page ─────────────────────────────────────────────────────────

/** A waiting vault, a door of YOUR VAULTS. */
export interface VaultDoor {
  id: string;
  source: VaultSource;
  /** The source's label (`YOUR SIZE SOLD OUT`) and its detail (`MONOLITHE IN BLUE`, `PLATINE`; null without one). */
  label: string;
  detail: string | null;
  /** The two as the door's line says them: `YOUR SIZE SOLD OUT · MONOLITHE IN BLUE`. */
  line: string;
  givenAt: Date;
  waitsUntil: Date;
  /** WAITS UNTIL, a Paris day `YYYY-MM-DD`. */
  waitsUntilDay: string;
}

/** An opened vault, a row of OPENED. */
export interface VaultOpenedRow {
  id: string;
  source: VaultSource;
  /** The source's bare label (`A NEW PIECE`), as OPENED shows it. */
  label: string;
  /** Its occasion's detail (`MONOLITHE IN BLUE`, `PLATINE`; null without one) and the Paris day it was given, `YYYY-MM-DD`:
   *  the I WAS THERE image names the release (or the occasion) and its date (D11, N4). */
  detail: string | null;
  givenDay: string;
  openedAt: Date;
  /** The Paris day it was opened, `YYYY-MM-DD`. */
  openedDay: string;
  kind: VaultRewardKind;
  /** The reveal's large words (`€25`, `I WAS THERE`) and its line. */
  prize: string;
  prizeLine: string | null;
  /** What it held as OPENED says it (OP-32: `€25 · HOUSE CREDIT`, `I WAS THERE`, `€30 TO GIVE`). */
  held: string;
  /**
   * A credit to give (N10, N33): its link's code (XXXX-XXXX-XXXX) while it can be accepted (GIVE IT), and whether a
   * friend accepted it (GIVEN); null on every other reward.
   */
  gift: { code: string | null; given: boolean } | null;
}

/** HOW TO OBTAIN A VAULT: each source's row with this collector's state (N21), in the sources' order. */
export type VaultLedgerRow =
  | { source: 'LIVE'; /** The next announced LIVE release with its vault on, its opening's Paris day; null: none. */ next: string | null }
  | { source: 'PIECE' }
  | {
      source: 'TIER';
      /** The tier held now (null: none), the pieces held, and the next tier (null at PALLADIUM, the highest). */
      tier: ClubTierName | null;
      pieces: number;
      next: { tier: ClubTierName; pieces: number; away: number } | null;
    }
  | { source: 'WORN' }
  | { source: 'FRIEND' }
  | { source: 'PROFILE'; /** The profile complete (DONE), else how complete it is. */ done: boolean; percent: number }
  | { source: 'HOUSE' };

/** THE VAULT page's data (GET /api/v1/account/vaults, step Q3.9). */
export interface AccountVaults {
  waiting: VaultDoor[];
  opened: VaultOpenedRow[];
  ledger: VaultLedgerRow[];
  /** How many vaults wait: the quiet number next to THE VAULT and NOW's line. */
  waitingCount: number;
}

/**
 * A client's vault as the console's client sheet reads it (GET /api/admin/vault/vaults?account=, step Q3.9; §4.4):
 * read-only, every state (N27: an expired one stays in the console), what it held; no route takes one back (N36).
 */
export interface AdminVault {
  id: string;
  source: VaultSource;
  /** The source's label, its detail and the two as a door says them. */
  label: string;
  detail: string | null;
  line: string;
  givenAt: Date;
  waitsUntil: Date;
  state: VaultState;
  openedAt: Date | null;
  /** RETURNED, a returned piece's (D5): the only taking-back. */
  revokedAt: Date | null;
  revokedReason: 'RETURNED' | null;
  /** What it held (OPENED's words), its kind, odds and rarity; null while unopened. */
  kind: VaultRewardKind | null;
  held: string | null;
  odds: string | null;
  rare: boolean | null;
  /** Its VAULT order (a piece won free, a right to buy used), for Client Services. */
  orderId: string | null;
  /** THE HOUSE's gift: the staff member who gave it and the note for Client Services (never shown to the collector). */
  givenBy: { id: string; email: string } | null;
  note: string | null;
}

/** A sum of money in one currency. */
export interface VaultMoney {
  currency: string;
  minor: number;
}

/** A reward's figures over a period: how many were won, their value and their cost (N29; costUnknown: no supplier price). */
export interface VaultWonFigures {
  won: number;
  value: VaultMoney[];
  cost: VaultMoney[];
  costUnknown: number;
}

/**
 * THE VAULT's report for a period of Paris days (GET /api/admin/vault/report, step Q3.9; §4.3; D24, D25 OP-26 "each
 * reward's quantity is the limit; the report shows the cost (no monthly cap)", N29): the vaults given by source, opened,
 * still waiting, expired and revoked; the rewards won by kind and by row with their value and cost (credits at face value
 * given and used; a product or an add-on given free at its supplier unit price where known, else counted unknown; a
 * right to buy, a guarantee and the card cost nothing); the total cost; the quantities left (`rows`). Shipping and
 * packaging are M4's margin.
 */
export interface VaultReport {
  from: string;
  to: string;
  given: { source: VaultSource; count: number }[];
  givenTotal: number;
  opened: number;
  /** Given in the period and still waiting now. */
  waiting: number;
  /** Unopened at their 30 days' end, within the period. */
  expired: number;
  /** Taken back with a returned piece in the period (D5). */
  revoked: number;
  byKind: ({ kind: VaultRewardKind } & VaultWonFigures)[];
  /** Every row of the table, with what it gave in the period and its quantity left. */
  rows: (VaultRewardSetting & VaultWonFigures)[];
  credits: { given: VaultMoney[]; used: VaultMoney[] };
  totalCost: VaultMoney[];
  costUnknown: number;
}

/** What an opened vault held as OPENED writes it (OP-32 "KEEP € in the OPENED rows"): a credit's `€25 · HOUSE CREDIT`, else its prize. */
export function vaultHeld(kind: VaultRewardKind, prize: string): string {
  return kind === 'CREDIT' ? `${prize} · HOUSE CREDIT` : prize;
}

interface VaultReadRow {
  id: string;
  source: VaultSource;
  tier: number | null;
  given_at: Date;
  waits_until: Date;
  opened_at: Date | null;
  reward_kind: VaultRewardKind | null;
  prize: string | null;
  prize_line: string | null;
  drop_model: string | null;
  drop_variant: string | null;
  drop_set: string | null;
  piece_model: string | null;
  piece_variant: string | null;
  gift_id: string | null;
  gift_accepted_by: string | null;
  gift_expires_at: Date | null;
}

/** A vault's detail from its read row (as `occasionDetail`). */
function detailOf(r: VaultReadRow): string | null {
  if (r.source === 'TIER') return r.tier ? (CLUB_TIER_NAMES[r.tier - 1] ?? null) : null;
  if (r.source === 'LIVE') return r.drop_model ? pieceName(r.drop_model, r.drop_variant) : r.drop_set;
  if (r.source === 'PIECE' || r.source === 'WORN') return r.piece_model ? pieceName(r.piece_model, r.piece_variant) : null;
  return null;
}

// ── The settings (CLUB > THE VAULT) ────────────────────────────────────────

/** A source's settings as the console reads them. */
export interface VaultSourceSetting {
  source: VaultSource;
  enabled: boolean;
  /** Vaults one occasion gives, 1 to 10. */
  perOccasion: number;
  /** Occasions an account receives per the source's scope, 1 to 100; null: no cap (HOUSE always). */
  cap: number | null;
  updatedAt: Date;
  updatedBy: { id: string; email: string } | null;
}

/** A row of the house table as the console reads it. */
export interface VaultRewardSetting {
  id: string;
  kind: VaultRewardKind;
  /** "1 IN N"; null on the floor (its published odds are `floor.oddsIn`). */
  oddsIn: number | null;
  oddsText: string | null;
  /** The draw's parts it holds (of 1 000 000). */
  parts: number;
  /** The limit and how many were given; null on the floor (never running out). */
  quantity: number | null;
  given: number;
  left: number | null;
  amountMinor: number | null;
  currency: string | null;
  modelId: string | null;
  /** The model as the app says it (MONOLITHE IN BLUE), or the add-on's name. */
  modelName: string | null;
  addonId: string | null;
  addonName: string | null;
  mode: VaultRewardMode | null;
  line: string | null;
  active: boolean;
  position: number;
  rare: boolean;
}

/** CLUB > THE VAULT's settings: the sources, the table in its order, the odds' sum and the floor's published odds. */
export interface VaultSettings {
  sources: VaultSourceSetting[];
  rewards: VaultRewardSetting[];
  /** The active rows' parts (of 1 000 000), the floor's excepted: at most 1 000 000. */
  partsGiven: number;
  floor: { id: string; parts: number; oddsIn: number | null; oddsText: string | null };
}

/** The rare kinds (N14: as the mockup's grid marks them and the reference's demo plays them). */
export const VAULT_RARE_KINDS: readonly VaultRewardKind[] = Object.freeze(['GUARANTEED', 'VAULT_EDITION', 'THE_PIECE'] as const);

/**
 * WHAT A VAULT CAN HOLD (D42; MK #vault-page): the eight kinds in the grid's order, the rare ones marked; never an odd
 * (D22 "Not chosen: … odds table on any page").
 */
export const VAULT_GRID: readonly { kind: VaultRewardKind; rare: boolean }[] = Object.freeze(
  (['CREDIT', 'ADDON', 'GUARANTEED', 'PRODUCT', 'CREDIT_TO_GIVE', 'I_WAS_THERE', 'VAULT_EDITION', 'THE_PIECE'] as const).map((kind) => Object.freeze({ kind, rare: VAULT_RARE_KINDS.includes(kind) })),
);

/** "1 IN N" as the vault writes it (`vaults.odds_text`). */
export const oddsText = (n: number): string => `1 IN ${n}`;

/** The draw's parts a row of "1 IN `oddsIn`" holds. */
export function rewardParts(oddsIn: number): number {
  return Math.round(VAULT_DRAW_PARTS / oddsIn);
}

/** The floor's published odds for the parts it holds: `round(1 / remainder)`; null when the table leaves it none. */
export function floorOddsIn(floorParts: number): number | null {
  return floorParts > 0 ? Math.max(1, Math.round(VAULT_DRAW_PARTS / floorParts)) : null;
}

export const vaultOddsOver = () => conflict('VAULT_ODDS_OVER', 'The odds of the active rewards add up to more than one in one. Lower one first.');
export const vaultRewardService = () => conflict('VAULT_REWARD_SERVICE', 'A service cannot be a vault’s reward.');
export const vaultEditionModel = () => conflict('VAULT_EDITION_MODEL', 'A VAULT EDITION is a model marked vault-only. Mark the model first.');
export const vaultOnlyProduct = () => conflict('VAULT_ONLY_PRODUCT', 'A vault-only model is never sold: give it as a VAULT EDITION.');
export const vaultRewardGiven = () => conflict('VAULT_REWARD_GIVEN', 'This reward was given: add another row.');
export const vaultFloorFixed = () => conflict('VAULT_FLOOR_FIXED', 'I WAS THERE is the floor: it is always there, its odds the rest.');
export const vaultRewardNotFound = () => notFound('Reward', 'VAULT_REWARD_NOT_FOUND');

/** A reward's fields as the console sends them (the whole row for its kind). */
export interface VaultRewardInput {
  kind?: unknown;
  oddsIn?: unknown;
  quantity?: unknown;
  amountMinor?: unknown;
  currency?: unknown;
  modelId?: unknown;
  addonId?: unknown;
  mode?: unknown;
  line?: unknown;
  active?: unknown;
  position?: unknown;
}

/** A source's settings as the console sends them. */
export interface VaultSourceInput {
  enabled?: unknown;
  perOccasion?: unknown;
  cap?: unknown;
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw validationError(`${field} is a whole number from ${min} to ${max}.`);
  return v;
}

function uuidOrNull(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw validationError(`${field} is not known.`);
  return v.toLowerCase();
}

function assertStaff(actor: Actor, what: string): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only ORBES staff can ${what}.`);
  return actor.id.toLowerCase();
}

/** A row's fields cleaned for its kind; each kind its own and no other (`vault_rewards_*`). */
interface CleanReward {
  odds_in: number;
  quantity: number;
  amount_minor: number | null;
  currency: string | null;
  model_id: string | null;
  addon_id: string | null;
  mode: VaultRewardMode | null;
  line: string | null;
}

async function cleanReward(db: Db, kind: VaultRewardKind, input: VaultRewardInput): Promise<CleanReward> {
  const out: CleanReward = {
    odds_in: int(input.oddsIn, 'The odds', 1, VAULT_ODDS_IN_MAX),
    quantity: int(input.quantity, 'The quantity', 0, 100_000_000),
    amount_minor: null,
    currency: null,
    model_id: null,
    addon_id: null,
    mode: null,
    line: null,
  };
  if (kind === 'CREDIT' || kind === 'CREDIT_TO_GIVE') {
    out.amount_minor = int(input.amountMinor, 'The amount', 1, VAULT_AMOUNT_MINOR_MAX);
    if (typeof input.currency !== 'string' || !(HOUSE_CURRENCIES as readonly string[]).includes(input.currency)) throw validationError(`The currency is one of ${HOUSE_CURRENCIES.join(', ')}.`);
    out.currency = input.currency;
  }
  if (kind === 'PRODUCT') {
    if (typeof input.mode !== 'string' || !(VAULT_REWARD_MODES as readonly string[]).includes(input.mode)) throw validationError('A product is FREE or RIGHT_TO_BUY.');
    out.mode = input.mode as VaultRewardMode;
  }
  if (kind === 'ADDON' || kind === 'PRODUCT') out.addon_id = uuidOrNull(input.addonId, 'The add-on');
  if (kind === 'VAULT_EDITION' || kind === 'PRODUCT') out.model_id = uuidOrNull(input.modelId, 'The model');
  if (kind === 'ADDON' && !out.addon_id) throw validationError('An add-on reward names its add-on.');
  if (kind === 'VAULT_EDITION' && !out.model_id) throw validationError('A VAULT EDITION names its model.');
  if (kind === 'PRODUCT' && (out.model_id === null) === (out.addon_id === null)) throw validationError('A product names a model or an add-on, one of them.');
  if (kind === 'VAULT_EDITION' && input.line !== undefined && input.line !== null) {
    const line = typeof input.line === 'string' ? input.line.trim().replace(/\s+/g, ' ') : '';
    if (line.length === 0 || [...line].length > VAULT_REWARD_LINE_MAX) throw validationError(`A line is 1 to ${VAULT_REWARD_LINE_MAX} characters.`);
    out.line = line;
  }
  if (out.addon_id) {
    const a = await db.selectFrom('addon_items').select('kind').where('id', '=', out.addon_id).executeTakeFirst();
    if (!a) throw notFound('Add-on', 'ADDON_NOT_FOUND');
    if (a.kind === 'SERVICE') throw vaultRewardService();
  }
  if (out.model_id) {
    const m = await db.selectFrom('models').select('vault_only').where('id', '=', out.model_id).executeTakeFirst();
    if (!m) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (kind === 'VAULT_EDITION' && !m.vault_only) throw vaultEditionModel();
    if (kind === 'PRODUCT' && m.vault_only) throw vaultOnlyProduct();
  }
  return out;
}

/** The active rows' parts, the floor's excepted (N15). */
async function partsGiven(db: Db): Promise<number> {
  const rows = await db.selectFrom('vault_rewards').select('odds_in').where('active', '=', true).where('kind', '<>', 'I_WAS_THERE').execute();
  return rows.reduce((n, r) => n + (r.odds_in ? rewardParts(r.odds_in) : 0), 0);
}

/** The table saved under the floor row's lock: two saves at once check the odds one after the other. */
async function lockTable(tx: Db): Promise<string> {
  const floor = await tx.selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').forUpdate().executeTakeFirstOrThrow();
  return floor.id;
}

/**
 * A row's `given` counted once more while its quantity allows it (one statement: two openings at once never both take
 * its last one); false when its quantity is reached.
 */
async function countGiven(tx: Db, rewardId: string): Promise<boolean> {
  const r = await tx
    .updateTable('vault_rewards')
    .set({ given: sql<number>`given + 1` })
    .where('id', '=', rewardId)
    .where((eb) => eb.or([eb('quantity', 'is', null), eb('given', '<', eb.ref('quantity'))]))
    .returning('id')
    .executeTakeFirst();
  return r !== undefined;
}

async function checkOdds(tx: Db): Promise<void> {
  if ((await partsGiven(tx)) > VAULT_DRAW_PARTS) throw vaultOddsOver();
}

// ── The opening (step Q3.4; plan §2.2, §2.4, §2.7) ─────────────────────────

/** How long a reward won lasts (E10 "rewards expire"; round 2 "House credit: … (30 days)"): a credit, a free add-on's offer. */
export const VAULT_REWARD_DAYS = 30;
/** A RIGHT TO BUY's offer (round 2 "Right to buy: 24 HOURS, at its usual price"). */
export const VAULT_RIGHT_TO_BUY_MS = 24 * HOUR_MS;
/** A credit to give's code: 12 Crockford characters, shown XXXX-XXXX-XXXX (as a transfer code). */
export const VAULT_GIFT_CODE_LENGTH = 12;
/** HKDF `info` of the credit-to-give HMAC key (derived from COOKIE_SECRET, as the transfer codes' key). */
export const VAULT_GIFT_KEY_INFO = 'orbes/vault-gift/v1';

/**
 * When a reward won at `at` ends: the last instant (Paris) of its 30th day, the day of `at` being day 1, as the birthday
 * credit's expiry is computed (services/birthday-credits.ts birthdayExpiry).
 */
export function vaultRewardUntil(at: Date): Date {
  return birthdayExpiry(parisDay(at), VAULT_REWARD_DAYS);
}

/**
 * The row a draw lands on: `r`, 0 ≤ r < 1 000 000 (`crypto.randomInt`), walks the active rows other than the floor in the
 * table's order, each holding round(1 000 000 / N) parts; past them it lands on the floor (null).
 */
export function drawRow<T extends { kind: VaultRewardKind; odds_in: number | null }>(rows: readonly T[], r: number): T | null {
  let edge = 0;
  for (const row of rows) {
    if (row.kind === 'I_WAS_THERE' || !row.odds_in) continue;
    edge += rewardParts(row.odds_in);
    if (r < edge) return row;
  }
  return null;
}

/** Where what a kind holds goes (E9 "credits in YOUR ACCOUNT, products in YOUR ORDERS"); the card goes nowhere. */
export function vaultWhereOf(kind: VaultRewardKind): VaultWhere {
  if (kind === 'CREDIT' || kind === 'CREDIT_TO_GIVE' || kind === 'GUARANTEED') return 'ACCOUNT';
  if (kind === 'I_WAS_THERE') return 'NONE';
  return 'ORDERS';
}

/** A vault opened, as its reveal shows it (POST /api/v1/account/vaults/:id/open, step Q3.9). */
export interface VaultReveal {
  vaultId: string;
  kind: VaultRewardKind;
  /** The reveal's large words (`€25`, `I WAS THERE`) and its line. */
  prize: string;
  line: string | null;
  /** Its published odds, `1 IN 200` (the card's when the card was given). */
  odds: string;
  /** GUARANTEED, VAULT EDITION, THE PIECE (N14): the slower opening and the second note (D15). */
  rare: boolean;
  where: VaultWhere;
  openedAt: Date;
  /** A credit to give's one-time link code (XXXX-XXXX-XXXX), to its owner while it can be accepted; null otherwise. */
  giftCode: string | null;
}

export const vaultNotFound = () => notFound('Vault', 'VAULT_NOT_FOUND');
export const vaultExpired = () => conflict('VAULT_EXPIRED', 'This vault was kept 30 days and can no longer be opened.');
export const vaultRevoked = () => conflict('VAULT_REVOKED', 'This vault went back with its piece.');
export const vaultGiftNotFound = () => notFound('Gift', 'VAULT_GIFT_NOT_FOUND');
export const vaultGiftEnded = () => conflict('VAULT_GIFT_ENDED', 'This credit can no longer be accepted.');
export const vaultGiftNotForYou = (own: boolean) =>
  conflict('VAULT_GIFT_NOT_FOR_YOU', own ? 'This credit is yours to give to a friend.' : 'This credit is for a friend’s first piece: an account that holds a piece cannot accept it.');

/** The HMAC key of the credits to give: HKDF-SHA256 of COOKIE_SECRET, info `orbes/vault-gift/v1` (rotating it ends the open ones). */
export function deriveVaultGiftKey(config: Pick<AppConfig, 'cookieSecret'>): Uint8Array {
  return deriveSubkey(utf8(config.cookieSecret), VAULT_GIFT_KEY_INFO, { salt: 'ORBES' });
}

/**
 * A vault's credit-to-give code, canonical: 12 Crockford characters from HMAC-SHA256(key, `code:` + its vault), so the
 * server can show it again to its owner (OPENED's GIVE IT) while no one without the key can make it; one per vault.
 */
export function vaultGiftCode(vaultId: string, key: Uint8Array): string {
  const mac = createHmac('sha256', key).update(`code:${vaultId.toLowerCase()}`, 'utf8').digest();
  let out = '';
  for (let i = 0; i < VAULT_GIFT_CODE_LENGTH; i++) out += CROCKFORD_ALPHABET[mac[i]! & 0x1f];
  return out;
}

/**
 * The lookup value of a credit-to-give code (any accepted spelling): HMAC-SHA256 of the canonical code under the key, as
 * a transfer code's (`vault_gifts.code_hash`); undefined when malformed.
 */
export function hashVaultGiftCode(code: unknown, key: Uint8Array): Uint8Array | undefined {
  const canonical = normalizeCrockford(code, VAULT_GIFT_CODE_LENGTH);
  if (canonical === undefined) return undefined;
  return new Uint8Array(createHmac('sha256', key).update(canonical, 'utf8').digest());
}

/** A credit to give as its link reads it (GET …/vaults/gifts/:code, step Q3.9): never anything of the giver. */
export interface VaultGiftView {
  /** `€30`, as the vault writes it. */
  amount: string;
  amountMinor: number;
  currency: string;
  /** Until when it can be accepted, and its Paris day. */
  expiresAt: Date;
  expiresDay: string;
  /** OPEN, ACCEPTED (by this account: its credit), ENDED (past its 30 days, or accepted by another). */
  state: 'OPEN' | 'ACCEPTED' | 'ENDED';
  /** OPEN and this account may accept it; a signed-out reader: null. */
  canAccept: boolean | null;
  /** Why this account cannot accept it, in words; null when it can (or nobody is signed in). */
  refusal: string | null;
}

/** A piece won free claimed (POST /api/v1/account/orders/:id/claim): its size (only to one with a unit), its address. */
export interface VaultClaimInput {
  size?: string | null;
  address?: OrderAddressInput | null;
}

/** BUY under a right to buy (POST /api/v1/account/vaults/:id/buy): its size, its address (the default one otherwise). */
export interface VaultBuyInput {
  size?: string | null;
  address?: OrderAddressInput | null;
}

/** What a piece won free can be claimed in (YOUR ORDERS). */
export interface VaultClaimSizes {
  orderId: string;
  /** Its end to be claimed, and its Paris day ("Yours until 27 NOVEMBER"). */
  claimBy: Date;
  claimDay: string;
  /** Claimed already (or cancelled): nothing to choose. */
  claimed: boolean;
  /** THE PIECE: its size never changes. */
  sizeFixed: boolean;
  /** Its size now (null: ONE SIZE). */
  size: string | null;
  /** Its model's offered sizes: the current one, and whether each can be chosen (a unit left; its own always). */
  sizes: { label: string | null; current: boolean; available: boolean }[];
}

/** A right to buy a model, open (YOUR ORDERS: BUY within its 24 hours). */
export interface VaultRightToBuy {
  vaultId: string;
  modelId: string;
  /** The model's name with its variant (`MONOLITHE IN BLUE`). */
  name: string;
  priceMinor: number;
  currency: string;
  offerUntil: Date;
  /** Its offered sizes (null: ONE SIZE). */
  sizes: (string | null)[];
  /** The size YOUR SIZES preselects among them (plan CUSTOMER INTELLIGENCE §3.7), its label; null without one. */
  savedSize: string | null;
}

/** VAULT_OFFER_ENDED's words for a piece won free past its 30 days, and for a right to buy past its 24 hours. */
export const VAULT_CLAIM_ENDED = 'The 30 days to claim it are over.';
export const VAULT_BUY_ENDED = 'The 24 hours to buy it are over.';
/** The note of a piece won free cancelled at its `claim_by` (the order's history). */
export const VAULT_NOT_CLAIMED = 'Not claimed within 30 days.';

/** A row of the house table as the opening reads it. */
export interface DrawRow {
  id: string;
  kind: VaultRewardKind;
  odds_in: number | null;
  quantity: number | null;
  given: number;
  amount_minor: number | null;
  currency: string | null;
  model_id: string | null;
  addon_id: string | null;
  mode: VaultRewardMode | null;
  line: string | null;
  position: number;
  created_at: Date;
}

/** The vault as the opening reads it. */
interface OpeningVault {
  id: string;
  account_id: string;
  source: VaultSource;
  drop_id: string | null;
  entry_id: string | null;
}

/** What a row drawn can give now: its words and what its delivery needs; or why it cannot (its odds then go to the card). */
type RewardPick =
  | { ok: true; prize: string; line: string | null; addonId?: string; amountMinor?: number; currency?: string; unit?: VaultUnit }
  | { ok: false; why: 'QUANTITY' | 'ADDON' | 'MODEL' | 'PRICE' | 'NO_UNIT' | 'NOT_LIVE' };

/** Words cut to a column's length (`…` last). */
function fit(s: string, max: number): string {
  const chars = [...s.trim().replace(/\s+/g, ' ')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Whether a row drawn can give, and its words (plan §2.2): its quantity not reached; an add-on (ADDON, a PRODUCT of an
 * add-on) still active and of kind PRODUCT (E7: never a service); a model (a PRODUCT of a model, a VAULT EDITION) still
 * offered, a VAULT EDITION's marked vault-only and a PRODUCT's not; under its RIGHT TO BUY, a usual price to buy it at;
 * won FREE (a PRODUCT, a VAULT EDITION), the unit reserved for the winner (step Q3.7, N12: services/vault-orders.ts
 * vaultUnit, its SKU locked); THE PIECE only for a LIVE vault (N5), the release's model with a unit in the entry's size
 * outside the release.
 */
export async function rewardPick(tx: Db, row: DrawRow, v: OpeningVault): Promise<RewardPick> {
  if (row.quantity !== null && row.given >= row.quantity) return { ok: false, why: 'QUANTITY' };
  switch (row.kind) {
    case 'CREDIT': {
      const amount = vaultMoney(row.amount_minor!, row.currency!);
      return { ok: true, prize: amount, line: VAULT_REVEAL.credit, amountMinor: row.amount_minor!, currency: row.currency! };
    }
    case 'CREDIT_TO_GIVE':
      return { ok: true, prize: VAULT_REVEAL.toGive.prize(vaultMoney(row.amount_minor!, row.currency!)), line: VAULT_REVEAL.toGive.line, amountMinor: row.amount_minor!, currency: row.currency! };
    case 'GUARANTEED':
      // Never refused for want of a release: a guarantee waits for the next one (§2.4).
      return { ok: true, prize: VAULT_REVEAL.guaranteed.prize, line: VAULT_REVEAL.guaranteed.line };
    case 'I_WAS_THERE':
      return { ok: true, prize: VAULT_REVEAL.card.prize, line: v.source === 'LIVE' ? VAULT_REVEAL.card.release : VAULT_REVEAL.card.other };
    case 'ADDON':
    case 'PRODUCT': {
      if (row.addon_id) {
        const a = await tx.selectFrom('addon_items').select(['name', 'active', 'kind']).where('id', '=', row.addon_id).executeTakeFirst();
        if (!a || !a.active || a.kind !== 'PRODUCT') return { ok: false, why: 'ADDON' };
        const line = row.kind === 'PRODUCT' && row.mode === 'RIGHT_TO_BUY' ? VAULT_REVEAL.rightToBuy : VAULT_REVEAL.addon;
        return { ok: true, prize: fit(a.name.toUpperCase(), VAULT_PRIZE_MAX), line, addonId: row.addon_id };
      }
      const m = await tx.selectFrom('models').select(['name', 'variant_label', 'active', 'discontinued_at', 'vault_only']).where('id', '=', row.model_id!).executeTakeFirst();
      if (!m || !m.active || m.discontinued_at !== null || m.vault_only) return { ok: false, why: 'MODEL' };
      const prize = fit(pieceName(m.name, m.variant_label), VAULT_PRIZE_MAX);
      if (row.mode === 'RIGHT_TO_BUY') return (await usualPrice(tx, row.model_id!)) ? { ok: true, prize, line: VAULT_REVEAL.rightToBuy } : { ok: false, why: 'PRICE' };
      const unit = await vaultUnit(tx, v.account_id, row.model_id!);
      return unit ? { ok: true, prize, line: VAULT_REVEAL.free, unit } : { ok: false, why: 'NO_UNIT' };
    }
    case 'VAULT_EDITION': {
      const m = await tx.selectFrom('models').select(['active', 'discontinued_at', 'vault_only']).where('id', '=', row.model_id!).executeTakeFirst();
      if (!m || !m.active || m.discontinued_at !== null || !m.vault_only) return { ok: false, why: 'MODEL' };
      const unit = await vaultUnit(tx, v.account_id, row.model_id!);
      // The reveal says the kind (the reference's "VAULT EDITION"); the model's name is the VAULT order's, in YOUR ORDERS.
      return unit ? { ok: true, prize: VAULT_REVEAL.vaultEdition.prize, line: row.line ?? VAULT_REVEAL.vaultEdition.line, unit } : { ok: false, why: 'NO_UNIT' };
    }
    case 'THE_PIECE': {
      if (v.source !== 'LIVE' || !v.drop_id || !v.entry_id) return { ok: false, why: 'NOT_LIVE' };
      const r = await tx
        .selectFrom('live_entries as e')
        .innerJoin('drop_sizes as z', 'z.id', 'e.size_id')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .leftJoin('models as m', 'm.id', 'd.model_id')
        .select(['d.model_id', 'z.label', 'm.name', 'm.variant_label'])
        .where('e.id', '=', v.entry_id)
        .executeTakeFirst();
      if (!r?.model_id) return { ok: false, why: 'NOT_LIVE' };
      // The missed model in the entry's size, its size known (N5): never another size.
      const unit = await vaultUnit(tx, v.account_id, r.model_id, sizeLabelOf(r.label));
      if (!unit) return { ok: false, why: 'NO_UNIT' };
      return { ok: true, prize: VAULT_REVEAL.thePiece.prize, line: VAULT_REVEAL.thePiece.line(pieceName(r.name!, r.variant_label), unit.label), unit };
    }
  }
}

// ── The right of access (OwnerService.exportData) ──────────────────────────

/**
 * A vault in the account's copy of its data: its occasion (the source, its words and detail: a release's piece or set,
 * a piece's model, a tier), when it was given, until when it waits, its state, and once opened what it held (its kind,
 * prize, line, odds) and its offer's end; never the house's note, who gave it, nor a friend's account.
 */
export interface ExportedVault {
  source: VaultSource;
  occasion: string;
  detail: string | null;
  givenAt: Date;
  waitsUntil: Date;
  state: VaultState;
  openedAt: Date | null;
  revokedAt: Date | null;
  kind: VaultRewardKind | null;
  prize: string | null;
  line: string | null;
  odds: string | null;
  offerUntil: Date | null;
  offerUsedAt: Date | null;
}

/** A credit to give in the account's copy of its data: one it gave (its vault held it) or one it accepted; never the other account. */
export interface ExportedVaultGift {
  role: 'GAVE' | 'ACCEPTED';
  amountMinor: number;
  currency: string;
  state: 'OPEN' | 'ACCEPTED' | 'ENDED';
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

/** THE VAULT's data of an account for its export (lot Q3): its vaults, its invitation, whether it was invited, its credits to give. */
export interface ExportedVaultData {
  vaults: ExportedVault[];
  /** Its personal invitation link's code and when it was made; null before its first INVITE A FRIEND. */
  invitation: { code: string; createdAt: Date } | null;
  /** Whether it was created through a collector's invitation, and when; never who invited it. */
  invited: { invitedBy: boolean; invitedAt: Date | null };
  vaultGifts: ExportedVaultGift[];
}

/** Every vault of the account (oldest first), its invitation and its credits to give, for its copy of its data. */
export async function accountVaultData(db: Db, accountId: string, now: Date): Promise<ExportedVaultData> {
  const rows = await db
    .selectFrom('vaults as v')
    .leftJoin('drops as d', 'd.id', 'v.drop_id')
    .leftJoin('models as dm', 'dm.id', 'd.model_id')
    .leftJoin('sets as ds', 'ds.id', 'd.set_id')
    .leftJoin('products as p', 'p.id', 'v.product_id')
    .leftJoin('models as pm', 'pm.id', 'p.model_id')
    .select([
      'v.id',
      'v.source',
      'v.tier',
      'v.given_at',
      'v.waits_until',
      'v.opened_at',
      'v.revoked_at',
      'v.reward_kind',
      'v.prize',
      'v.prize_line',
      'v.odds_text',
      'v.offer_until',
      'v.offer_used_at',
      'dm.name as drop_model',
      'dm.variant_label as drop_variant',
      'ds.name as drop_set',
      'pm.name as piece_model',
      'pm.variant_label as piece_variant',
    ])
    .where('v.account_id', '=', accountId)
    .orderBy('v.given_at')
    .orderBy('v.id')
    .execute();
  const invitation = await db.selectFrom('invitations').select(['code', 'created_at']).where('account_id', '=', accountId).executeTakeFirst();
  const account = await db.selectFrom('accounts').select(['invited_by', 'invited_at']).where('id', '=', accountId).executeTakeFirst();
  const gifts = await db
    .selectFrom('vault_gifts as g')
    .innerJoin('vaults as v', 'v.id', 'g.vault_id')
    .select(['v.account_id as giver', 'g.accepted_by', 'g.amount_minor', 'g.currency', 'g.created_at', 'g.expires_at', 'g.accepted_at'])
    .where((eb) => eb.or([eb('v.account_id', '=', accountId), eb('g.accepted_by', '=', accountId)]))
    .orderBy('g.created_at')
    .orderBy('g.id')
    .execute();
  return {
    vaults: rows.map((r) => {
      const detail = detailOf({ ...r, gift_id: null, gift_accepted_by: null, gift_expires_at: null } as unknown as VaultReadRow);
      return {
        source: r.source,
        occasion: vaultSourceLine(r.source, detail),
        detail,
        givenAt: new Date(r.given_at),
        waitsUntil: new Date(r.waits_until),
        state: vaultState(r, now),
        openedAt: r.opened_at ? new Date(r.opened_at) : null,
        revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
        kind: r.reward_kind,
        prize: r.prize,
        line: r.prize_line,
        odds: r.odds_text,
        offerUntil: r.offer_until ? new Date(r.offer_until) : null,
        offerUsedAt: r.offer_used_at ? new Date(r.offer_used_at) : null,
      };
    }),
    invitation: invitation ? { code: invitation.code, createdAt: new Date(invitation.created_at) } : null,
    invited: { invitedBy: account?.invited_by != null, invitedAt: account?.invited_at ? new Date(account.invited_at) : null },
    vaultGifts: gifts.map((g) => ({
      role: g.giver === accountId ? ('GAVE' as const) : ('ACCEPTED' as const),
      amountMinor: g.amount_minor,
      currency: g.currency,
      state: g.accepted_at ? ('ACCEPTED' as const) : new Date(g.expires_at).getTime() > now.getTime() ? ('OPEN' as const) : ('ENDED' as const),
      createdAt: new Date(g.created_at),
      expiresAt: new Date(g.expires_at),
      acceptedAt: g.accepted_at ? new Date(g.accepted_at) : null,
    })),
  };
}

// ── The service ────────────────────────────────────────────────────────────

export interface VaultServiceDeps {
  db: Db;
  audit: AuditService;
  /** YOUR PROFILE's completion, for the ledger's row (N21). */
  profiles: ProfileService;
  clock?: Clock;
  /** The draw's source of randomness: an integer in [0, max). `crypto.randomInt`, a cryptographic source alone; a test injects its own. */
  random?: (max: number) => number;
  /** 32-byte HMAC key of the credits to give (deriveVaultGiftKey; the context always passes it, a test gets a random one). */
  giftKey?: Uint8Array;
  /** The LIVE releases' frame gate: a guarantee won and bound to a QUEUED entry changes whom the next batches reach (D9). */
  liveFrames?: LiveFrameGate;
  /** The buyer's emails at each step of a VAULT order (EmailTriggers.orderStep, as OrderService's); none when not given. */
  mail?: OrderMail;
}

export class VaultService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly profiles: ProfileService;
  private readonly clock: Clock;
  private readonly random: (max: number) => number;
  private readonly giftKey: Uint8Array;
  private readonly liveFrames: LiveFrameGate | null;
  private readonly mail: OrderMail;

  constructor(deps: VaultServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.profiles = deps.profiles;
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? ((max: number) => randomInt(max));
    const key = deps.giftKey ?? new Uint8Array(randomBytes(32));
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new RangeError('giftKey must be 32 bytes');
    this.giftKey = key;
    this.liveFrames = deps.liveFrames ?? null;
    this.mail = deps.mail ?? null;
  }

  /** `giveVault` in its own transaction, its audit recorded there (the house's gifts, the tests). */
  async give(occasion: VaultOccasion, now: Date = this.clock()): Promise<VaultGiven> {
    return inTransaction(this.db, async (tx) => {
      const given = await giveVault(tx, occasion, now);
      for (const n of given.notes) await this.audit.record(n, tx);
      return given;
    });
  }

  /**
   * GIVE A VAULT (§2.3.7, §4.4; D3 (7) "given by the house (to a collector or a segment)"; OP-29 "GIVE A VAULT to a
   * segment gives one to each member"; N25): to one collector (`accountId` or `email`; OPERATOR, the route's role) or to
   * each member of a segment as it reads now (`segmentId`; ADMIN, as the house messages' audience), `per_occasion` vaults
   * each under one gift's key `HOUSE:<giftId>`, with the staff member and the house's note (never audited, never shown).
   * The test entrants (D9) and the accounts not ACTIVE are left out and counted apart; an erased account is no collector.
   * Given in transactions of HOUSE_GIVE_BATCH accounts, each vault audited `vault.give` with its staff member; a press sent
   * again with its `giftId` after a failed batch gives only the members that gift has not reached yet. `dryRun`:
   * the reach and the left out, nothing given. 404 ACCOUNT_NOT_FOUND / SEGMENT_NOT_FOUND; 409 VAULT_SOURCE_OFF while THE
   * HOUSE is switched off.
   */
  async giveFromHouse(input: HouseGiveInput, actor: Actor): Promise<HouseGiven> {
    const by = assertStaff(actor, 'give a vault');
    const i = (input && typeof input === 'object' ? input : {}) as HouseGiveInput;
    const toOne = (i.accountId !== undefined && i.accountId !== null) || (i.email !== undefined && i.email !== null);
    const toSegment = i.segmentId !== undefined && i.segmentId !== null;
    if (toOne === toSegment) throw validationError('Choose a collector or a segment.');
    if (i.giftId !== undefined && i.giftId !== null && (typeof i.giftId !== 'string' || !UUID_RE.test(i.giftId))) throw validationError('The gift’s id is not valid.');
    const note = houseNote(i.note);
    const dryRun = i.dryRun === true;
    const now = this.clock();
    const source = await this.db.selectFrom('vault_sources').select('enabled').where('source', '=', 'HOUSE').executeTakeFirst();
    if (!source?.enabled) throw vaultSourceOff();

    let segmentId: string | null = null;
    let members: { id: string; status: string; test: boolean }[];
    const test = (eb: ExpressionBuilder<Database, 'accounts'>) => eb.exists(eb.selectFrom('test_entrants as t').select('t.account_id').whereRef('t.account_id', '=', 'accounts.id')).as('test');
    if (toOne) {
      let q = this.db.selectFrom('accounts').select((eb) => ['accounts.id', 'accounts.status', test(eb)]).where('accounts.status', '<>', 'DELETED');
      if (i.accountId !== undefined && i.accountId !== null) {
        if (typeof i.accountId !== 'string' || !UUID_RE.test(i.accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
        q = q.where('accounts.id', '=', i.accountId.toLowerCase());
      } else {
        const email = normalizeEmail(i.email);
        if (!email) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
        q = q.where('accounts.email_normalized', '=', email.normalized);
      }
      const one = await q.executeTakeFirst();
      if (!one) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      members = [{ id: one.id, status: one.status, test: Boolean(one.test) }];
    } else {
      if (typeof i.segmentId !== 'string' || !UUID_RE.test(i.segmentId)) throw notFound('Segment', 'SEGMENT_NOT_FOUND');
      segmentId = i.segmentId.toLowerCase();
      const s = await this.db.selectFrom('segments').select('criteria').where('id', '=', segmentId).executeTakeFirst();
      if (!s) throw notFound('Segment', 'SEGMENT_NOT_FOUND');
      const criteria = cleanCriteria(s.criteria);
      const rows = await this.db
        .selectFrom('accounts as a')
        .select((eb) => ['a.id', 'a.status', eb.exists(eb.selectFrom('test_entrants as t').select('t.account_id').whereRef('t.account_id', '=', 'a.id')).as('test')])
        .where('a.status', '<>', 'DELETED')
        .where((eb) => segmentCondition(this.db, eb, criteria, now))
        .orderBy('a.id')
        .execute();
      members = rows.map((r) => ({ id: r.id, status: r.status, test: Boolean(r.test) }));
    }

    const leftOut = { testEntrants: members.filter((m) => m.test).length, inactive: members.filter((m) => !m.test && m.status !== 'ACTIVE').length };
    const reach = members.filter((m) => !m.test && m.status === 'ACTIVE').map((m) => m.id);
    if (dryRun) return { giftId: null, dryRun, reach: reach.length, accounts: 0, vaults: 0, leftOut };

    const giftId = typeof i.giftId === 'string' ? i.giftId.toLowerCase() : randomUUID();
    let accounts = 0;
    let vaults = 0;
    const again = i.giftId !== undefined && i.giftId !== null;
    for (const batch of chunked(reach, HOUSE_GIVE_BATCH)) {
      await inTransaction(this.db, async (tx) => {
        // A press sent again: the members this gift already reached are skipped (its cap may allow more than one).
        const reached = again
          ? new Set((await tx.selectFrom('vaults').select('account_id').where('occasion_key', '=', `HOUSE:${giftId}`).where('account_id', 'in', batch).execute()).map((v) => v.account_id))
          : new Set<string>();
        // The batch's audit entries written once after its last vault (giveVault locks each account): no row is locked
        // after the audit chain's lock, and the chain's lock is held only for the batch's commit.
        const notes: AuditRecordInput[] = [];
        let batchAccounts = 0;
        let batchVaults = 0;
        for (const accountId of batch) {
          if (reached.has(accountId)) continue;
          const given = await giveVault(tx, { source: 'HOUSE', accountId, giftId, givenBy: by, segmentId, note }, now);
          if (given.vaults.length > 0) {
            batchAccounts += 1;
            batchVaults += given.vaults.length;
          }
          notes.push(...given.notes);
        }
        await this.audit.recordAll(notes, tx);
        accounts += batchAccounts;
        vaults += batchVaults;
      });
    }
    return { giftId, dryRun, reach: reach.length, accounts, vaults, leftOut };
  }

  /**
   * INVITE A FRIEND (§2.3.5; N10): the collector's personal invitation code, made at the first press and the same ever
   * after (`invitations`, never changed nor deleted); its link `/verify/join/<code>` names nobody. 404 ACCOUNT_NOT_FOUND,
   * 403 ACCOUNT_LOCKED for an account not ACTIVE.
   */
  async invitation(accountId: string): Promise<{ code: string }> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const id = accountId.toLowerCase();
    return inTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', id).forKeyShare().executeTakeFirst();
      if (!a || a.status === 'DELETED') throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (a.status !== 'ACTIVE') throw customerAccountLocked();
      for (let attempt = 0; attempt < 5; attempt++) {
        const made = await tx.selectFrom('invitations').select('code').where('account_id', '=', id).executeTakeFirst();
        if (made) return { code: made.code };
        // ON CONFLICT DO NOTHING on both keys: a second press at once keeps the first code; a code already taken
        // (32^12 codes: never in practice) draws another.
        await tx.insertInto('invitations').values({ account_id: id, code: randomCrockford(INVITATION_CODE_LENGTH), created_at: this.clock() }).onConflict((oc) => oc.doNothing()).execute();
      }
      throw new Error('invitation: no code could be made');
    });
  }

  // ── The opening ──────────────────────────────────────────────────────────

  /**
   * A vault opened by its account (POST /api/v1/account/vaults/:id/open, step Q3.9; see the head of this file): the draw,
   * the outcome written once, its delivery and its FROM ORBES receipt, in one transaction; an opened vault's outcome read
   * again. 404 VAULT_NOT_FOUND (unknown, another account's, an account not ACTIVE), 403 ACCOUNT_LOCKED, 409 VAULT_EXPIRED
   * and VAULT_REVOKED. Audited `vault.open`.
   */
  async open(accountId: string, vaultId: string, now: Date = this.clock()): Promise<VaultReveal> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId) || typeof vaultId !== 'string' || !UUID_RE.test(vaultId)) throw vaultNotFound();
    const account = accountId.toLowerCase();
    const id = vaultId.toLowerCase();
    return withLiveChanges(this.liveFrames, (changes) =>
      inTransaction(this.db, async (tx) => {
        const v = await tx.selectFrom('vaults').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!v || v.account_id !== account) throw vaultNotFound();
        // Opened already (a lost answer, a second press, two at once): its outcome, never a second draw.
        if (v.opened_at) return this.revealOf(tx, v, now);
        const state = vaultState(v, now);
        if (state === 'REVOKED') throw vaultRevoked();
        if (state === 'EXPIRED') throw vaultExpired();
        const a = await tx.selectFrom('accounts').select('status').where('id', '=', account).executeTakeFirst();
        if (a?.status === 'LOCKED') throw customerAccountLocked();
        if (a?.status !== 'ACTIVE') throw vaultNotFound();

        // The table, read in the order its settings lock it (the floor's row first, then every active row by id) but shared
        // (FOR KEY SHARE): openings never wait for each other here, while a change of CLUB > THE VAULT (FOR UPDATE) waits
        // for them and they for it, never in a circle; drawn in its own order (N15).
        await tx.selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').forKeyShare().executeTakeFirstOrThrow();
        const rows = (await tx
          .selectFrom('vault_rewards')
          .select(['id', 'kind', 'odds_in', 'quantity', 'given', 'amount_minor', 'currency', 'model_id', 'addon_id', 'mode', 'line', 'position', 'created_at'])
          .where('active', '=', true)
          .orderBy('id')
          .forKeyShare()
          .execute()) as DrawRow[];
        const ordered = [...rows].sort((x, y) => x.position - y.position || new Date(x.created_at).getTime() - new Date(y.created_at).getTime() || x.id.localeCompare(y.id));
        const floor = ordered.find((r) => r.kind === 'I_WAS_THERE')!;
        const others = ordered.filter((r) => r.kind !== 'I_WAS_THERE');
        const floorOdds = floorOddsIn(Math.max(0, VAULT_DRAW_PARTS - others.reduce((n, r) => n + (r.odds_in ? rewardParts(r.odds_in) : 0), 0)));
        const drawn = drawRow(others, this.random(VAULT_DRAW_PARTS));

        let row = drawn ?? floor;
        let pick = await rewardPick(tx, row, v);
        // A row with a quantity is counted before its delivery, at once: the last one goes to one opening only.
        let counted = false;
        if (pick.ok && row !== floor && row.quantity !== null) {
          counted = await countGiven(tx, row.id);
          if (!counted) pick = { ok: false, why: 'QUANTITY' };
        }
        let fellBack: string | null = null;
        if (!pick.ok) {
          // "A reward that runs out sends its odds to the card (published odds never change)": the card, at its own odds.
          fellBack = pick.why;
          row = floor;
          counted = false;
          pick = await rewardPick(tx, floor, v);
        }
        if (!pick.ok) throw new Error('the I WAS THERE floor always gives');
        // The published odds: the drawn row's own; the card's (the rest of the table) when the card is given. A table that
        // leaves the card no part gives it only in a row's place: that row's odds then.
        const odds = row === floor ? oddsText(floorOdds ?? drawn?.odds_in ?? 1) : oddsText(row.odds_in!);
        const rare = VAULT_RARE_KINDS.includes(row.kind);
        const notes: AuditRecordInput[] = [];
        const done = await this.deliver(tx, v, row, pick, now, notes, changes);

        await tx
          .updateTable('vaults')
          .set({
            opened_at: now,
            reward_id: row.id,
            reward_kind: row.kind,
            prize: pick.prize,
            prize_line: pick.line === null ? null : fit(pick.line, VAULT_PRIZE_LINE_MAX),
            odds_text: odds,
            rare,
            value_minor: done.valueMinor,
            currency: done.valueMinor === null ? null : done.currency,
            cost_minor: done.costMinor,
            grant_id: done.grantId,
            order_id: done.orderId,
            guarantee_id: done.guaranteeId,
            gift_id: done.giftId,
            offer_until: done.offerUntil,
          })
          .where('id', '=', v.id)
          .where('opened_at', 'is', null)
          .execute();
        // A row without a quantity (the card among them) counted last, its row's lock held only to the commit.
        if (!counted) await tx.updateTable('vault_rewards').set({ given: sql<number>`given + 1` }).where('id', '=', row.id).execute();

        // E9 "plus a FROM ORBES message": what it held and where it is.
        const where = vaultWhereOf(row.kind);
        const words = vaultOpenedWords({ prize: pick.prize, line: pick.line, where });
        await tx
          .insertInto('house_deliveries')
          .values({ account_id: account, source: 'VAULT', title: deliveredTitle(words.title) ?? words.title, body: deliveredBody(words.body) ?? words.body, dedupe_key: `VAULT_OPENED:${v.id}`, delivered_at: now })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();

        await this.audit.record(
          {
            actor: { type: 'account', id: account },
            action: 'vault.open',
            targetType: 'vault',
            targetId: v.id,
            details: {
              source: v.source,
              kind: row.kind,
              rare,
              rewardId: row.id,
              ...(fellBack ? { toTheCard: true } : {}),
              ...(done.grantId ? { grantId: done.grantId } : {}),
              ...(done.orderId ? { orderId: done.orderId } : {}),
              ...(done.guaranteeId ? { guaranteeId: done.guaranteeId } : {}),
              ...(done.giftId ? { giftId: done.giftId } : {}),
              ...(done.offerUntil ? { offerUntil: done.offerUntil.toISOString() } : {}),
            },
          },
          tx,
        );
        for (const n of notes) await this.audit.record(n, tx);
        return { vaultId: v.id, kind: row.kind, prize: pick.prize, line: pick.line, odds, rare, where, openedAt: now, giftCode: done.giftId ? formatGrouped(vaultGiftCode(v.id, this.giftKey)) : null };
      }),
    );
  }

  /**
   * What the row drawn gives, delivered where it belongs (plan §2.4), in the opening's transaction: the links the vault
   * keeps (its credit, guarantee, gift), its offer's end, its value (a credit's face value) and its cost (N29: a
   * credit's face value; the card nothing; a product's at the report, step Q3.12).
   */
  private async deliver(
    tx: Db,
    v: OpeningVault,
    row: DrawRow,
    pick: Extract<RewardPick, { ok: true }>,
    now: Date,
    notes: AuditRecordInput[],
    changes: LiveChanges,
  ): Promise<{ grantId: string | null; orderId: string | null; guaranteeId: string | null; giftId: string | null; offerUntil: Date | null; valueMinor: number | null; currency: string | null; costMinor: number | null }> {
    const none = { grantId: null, orderId: null, guaranteeId: null, giftId: null, offerUntil: null, valueMinor: null, currency: null, costMinor: null };
    if (pick.unit) {
      // A product won FREE, a VAULT EDITION, THE PIECE (step Q3.7, N12): a VAULT order at 0 holding the unit reserved for
      // the winner, to be claimed within 30 days (D20); its value the model's usual price where it has one.
      const order = await vaultFreeOrder(tx, v, pick.unit, vaultRewardUntil(now), now, notes);
      const price = await usualPrice(tx, pick.unit.modelId);
      return { ...none, orderId: order.id, valueMinor: price?.minor ?? null, currency: price?.currency ?? null };
    }
    switch (row.kind) {
      case 'CREDIT': {
        // A credit like the birthday and warranty credits: creditBalances, Apply credit, CREDIT · VAULT, the export.
        const grant = await tx
          .insertInto('tier_grants')
          .values({ account_id: v.account_id, tier: null, kind: 'VAULT', vault_id: v.id, granted_at: now, amount_minor: pick.amountMinor!, currency: pick.currency!, expires_at: vaultRewardUntil(now) })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { ...none, grantId: grant.id, valueMinor: pick.amountMinor!, currency: pick.currency!, costMinor: pick.amountMinor! };
      }
      case 'CREDIT_TO_GIVE': {
        const gift = await tx
          .insertInto('vault_gifts')
          .values({
            vault_id: v.id,
            code_hash: hashVaultGiftCode(vaultGiftCode(v.id, this.giftKey), this.giftKey)!,
            amount_minor: pick.amountMinor!,
            currency: pick.currency!,
            created_at: now,
            expires_at: new Date(now.getTime() + VAULT_GIFT_DAYS * 24 * HOUR_MS),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { ...none, giftId: gift.id, valueMinor: pick.amountMinor!, currency: pick.currency!, costMinor: pick.amountMinor! };
      }
      case 'GUARANTEED': {
        // A LIVE vault's own release is never the one it covers (OP-22 "the next LIVE release").
        const g = await grantFromVault(tx, { accountId: v.account_id, vaultId: v.id, dropId: v.source === 'LIVE' ? v.drop_id : null }, now, notes, changes);
        return { ...none, guaranteeId: g.id };
      }
      case 'ADDON':
        // A free add-on on the next order, within 30 days (N11).
        return { ...none, offerUntil: vaultRewardUntil(now) };
      case 'PRODUCT':
        // Under its RIGHT TO BUY, 24 hours at its usual price (round 2; BUY, or an add-on's ADD); an add-on won FREE, as
        // ADDON. A model won FREE holds its unit (above).
        return { ...none, offerUntil: row.mode === 'RIGHT_TO_BUY' ? new Date(now.getTime() + VAULT_RIGHT_TO_BUY_MS) : vaultRewardUntil(now) };
      case 'I_WAS_THERE':
        // Nothing but its card (saved as an image, D11).
        return { ...none, costMinor: 0 };
      default:
        // A VAULT EDITION and THE PIECE always hold their unit (rewardPick).
        throw new Error(`a ${row.kind} without its unit`);
    }
  }

  /** An opened vault's reveal as written at its opening (its gift's code while it can be accepted). */
  private async revealOf(db: Db, v: { id: string; reward_kind: VaultRewardKind | null; prize: string | null; prize_line: string | null; odds_text: string | null; rare: boolean | null; opened_at: Date | null; gift_id: string | null }, now: Date): Promise<VaultReveal> {
    const kind = v.reward_kind!;
    let giftCode: string | null = null;
    if (v.gift_id) {
      const g = await db.selectFrom('vault_gifts').select(['accepted_by', 'expires_at']).where('id', '=', v.gift_id).executeTakeFirst();
      if (g && g.accepted_by === null && new Date(g.expires_at).getTime() > now.getTime()) giftCode = formatGrouped(vaultGiftCode(v.id, this.giftKey));
    }
    return { vaultId: v.id, kind, prize: v.prize!, line: v.prize_line, odds: v.odds_text!, rare: v.rare === true, where: vaultWhereOf(kind), openedAt: new Date(v.opened_at!), giftCode };
  }

  // ── A credit to give (N10) ───────────────────────────────────────────────

  /**
   * A credit to give as its link reads it (GET /api/v1/account/vaults/gifts/:code, step Q3.9), for `accountId` when
   * signed in (null otherwise): its amount, until when, its state, and whether this account can accept it (holding no
   * piece, not its giver). 404 VAULT_GIFT_NOT_FOUND for a code not known. Nothing of the giver.
   */
  async gift(code: unknown, accountId: string | null, now: Date = this.clock()): Promise<VaultGiftView> {
    const hash = hashVaultGiftCode(code, this.giftKey);
    if (!hash) throw vaultGiftNotFound();
    const g = await this.db
      .selectFrom('vault_gifts as g')
      .innerJoin('vaults as v', 'v.id', 'g.vault_id')
      .select(['g.amount_minor', 'g.currency', 'g.expires_at', 'g.accepted_by', 'v.account_id as giver'])
      .where('g.code_hash', '=', hash)
      .executeTakeFirst();
    if (!g) throw vaultGiftNotFound();
    const me = accountId && UUID_RE.test(accountId) ? accountId.toLowerCase() : null;
    const expiresAt = new Date(g.expires_at);
    const state: VaultGiftView['state'] = g.accepted_by !== null ? (g.accepted_by === me ? 'ACCEPTED' : 'ENDED') : expiresAt.getTime() <= now.getTime() ? 'ENDED' : 'OPEN';
    let refusal: string | null = null;
    if (me && state === 'OPEN') refusal = await this.giftRefusal(this.db, g.giver, me, now);
    else if (me && state === 'ENDED') refusal = vaultGiftEnded().message;
    return {
      amount: vaultMoney(g.amount_minor, g.currency),
      amountMinor: g.amount_minor,
      currency: g.currency,
      expiresAt,
      expiresDay: parisDay(expiresAt),
      state,
      canAccept: me === null ? null : state === 'OPEN' && refusal === null,
      refusal,
    };
  }

  /** Why `me` cannot accept a giver's credit (its giver; an account holding a piece), in words; null when it can. */
  private async giftRefusal(db: Db, giver: string, me: string, now: Date): Promise<string | null> {
    if (giver === me) return vaultGiftNotForYou(true).message;
    if ((await tierOf(db, me, now)).pieces > 0) return vaultGiftNotForYou(false).message;
    return null;
  }

  /**
   * A credit to give accepted (POST /api/v1/account/vaults/gifts/:code/accept, step Q3.9) by a signed-in account that
   * holds no piece and is not its giver: a VAULT credit of its amount on that account, usable while it holds no piece
   * ("a credit for a friend's first piece", N10), for 30 days from now; the gift accepted once. Accepting writes nothing
   * else: never `accounts.invited_by` (the FRIEND source stays the personal invitation link's alone; round 3, N10).
   * The same account again: its credit, unchanged. 404 VAULT_GIFT_NOT_FOUND, 409 VAULT_GIFT_ENDED (past its 30 days, or
   * accepted by another), 409 VAULT_GIFT_NOT_FOR_YOU, 403 ACCOUNT_LOCKED. Audited `vault.gift.accept`.
   */
  async acceptGift(accountId: string, code: unknown, now: Date = this.clock()): Promise<{ grantId: string; amountMinor: number; currency: string; expiresAt: Date }> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw vaultGiftNotFound();
    const me = accountId.toLowerCase();
    const hash = hashVaultGiftCode(code, this.giftKey);
    if (!hash) throw vaultGiftNotFound();
    return inTransaction(this.db, async (tx) => {
      const g = await tx.selectFrom('vault_gifts').selectAll().where('code_hash', '=', hash).forUpdate().executeTakeFirst();
      if (!g) throw vaultGiftNotFound();
      if (g.accepted_by !== null) {
        if (g.accepted_by !== me) throw vaultGiftEnded();
        const credit = await tx.selectFrom('tier_grants').select(['id', 'amount_minor', 'currency', 'expires_at']).where('id', '=', g.grant_id!).executeTakeFirstOrThrow();
        return { grantId: credit.id, amountMinor: credit.amount_minor!, currency: credit.currency!, expiresAt: new Date(credit.expires_at!) };
      }
      if (new Date(g.expires_at).getTime() <= now.getTime()) throw vaultGiftEnded();
      // The friend's row: two first orders or two acceptances of one account count each other.
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', me).forNoKeyUpdate().executeTakeFirst();
      if (!a) throw vaultGiftNotFound();
      if (a.status === 'LOCKED') throw customerAccountLocked();
      if (a.status !== 'ACTIVE') throw vaultGiftNotFound();
      const giver = await tx.selectFrom('vaults').select('account_id').where('id', '=', g.vault_id).executeTakeFirstOrThrow();
      if (giver.account_id === me) throw vaultGiftNotForYou(true);
      if ((await tierOf(tx, me, now)).pieces > 0) throw vaultGiftNotForYou(false);
      const expiresAt = vaultRewardUntil(now);
      const grant = await tx
        .insertInto('tier_grants')
        .values({ account_id: me, tier: null, kind: 'VAULT', vault_id: g.vault_id, usable_while_no_piece: true, granted_at: now, amount_minor: g.amount_minor, currency: g.currency, expires_at: expiresAt })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('vault_gifts').set({ accepted_by: me, accepted_at: now, grant_id: grant.id }).where('id', '=', g.id).where('accepted_by', 'is', null).execute();
      await this.audit.record({ actor: { type: 'account', id: me }, action: 'vault.gift.accept', targetType: 'vault_gift', targetId: g.id, details: { vaultId: g.vault_id, grantId: grant.id } }, tx);
      return { grantId: grant.id, amountMinor: g.amount_minor, currency: g.currency, expiresAt };
    });
  }

  // ── Products from the vault (step Q3.7; services/vault-orders.ts) ─────────

  /**
   * What a piece won free can be claimed in (YOUR ORDERS, §3.8): its end to be claimed, its size (THE PIECE's fixed) and
   * each offered size of its model with whether it can be chosen (a unit available at its location, its own reserved
   * one always). Its own VAULT order at 0 only (404 ORDER_NOT_FOUND).
   */
  async claimSizes(accountId: string, orderId: string): Promise<VaultClaimSizes> {
    const o = await this.vaultFreeOrderOf(this.db, accountId, orderId);
    const fixed = await isThePiece(this.db, o.vault_id);
    const sizes: VaultClaimSizes['sizes'] = [];
    for (const z of await offeredSizes(this.db, o.model_id)) {
      const own = z.skuId === o.sku_id;
      sizes.push({ label: z.label, current: own, available: own || (!fixed && (await stockLevel(this.db, z.skuId, o.location_id)).available >= 1) });
    }
    return { orderId: o.id, claimBy: new Date(o.claim_by!), claimDay: parisDay(new Date(o.claim_by!)), claimed: o.status !== 'RESERVED', sizeFixed: fixed, size: o.size_label, sizes };
  }

  /**
   * A piece won free claimed by its winner (POST /api/v1/account/orders/:id/claim, step Q3.9; D20, N12): within its 30
   * days (409 VAULT_OFFER_ENDED after, or once the housekeeping has cancelled it), its size changed only to one with a unit
   * available (the reserved unit swaps under both SKUs' locks: the new one taken, the first back to stock where it serves
   * the next order waiting; 409 VAULT_SIZE_NONE_LEFT; THE PIECE's size never changes, 400), its address the one given
   * (one of YOUR ADDRESSES or a new one, saved when asked) or the one it holds (the default; 409 ORDER_ADDRESS_MISSING
   * without one), then PAID at 0 with its invoice and the buyer's email: the Orders board packs it with its card scan.
   * Claimed already: nothing changes. Its own VAULT order at 0 (404 ORDER_NOT_FOUND), the account ACTIVE (403
   * ACCOUNT_LOCKED). The account's lock, then the order's row. Audited `order.size` (a size changed, by the collector),
   * `order.pay` and `vault.claim`.
   */
  async claim(accountId: string, orderId: string, input: VaultClaimInput = {}, now?: Date): Promise<{ orderId: string; claimed: true }> {
    const i = (input && typeof input === 'object' ? input : {}) as VaultClaimInput;
    const size = i.size === undefined ? undefined : sizeLabelOf(typeof i.size === 'string' ? i.size : null);
    if (i.size !== undefined && i.size !== null && typeof i.size !== 'string') throw validationError('Choose one of this piece’s sizes.');
    const address = i.address === undefined || i.address === null ? null : checkOrderAddress(i.address);
    const account = knownAccount(accountId, () => orderNotFoundError());
    await inRetriedTransaction(this.db, async (tx) => {
      const at = now ?? this.clock();
      await lockAccountAddresses(tx, account);
      let o = await this.vaultFreeOrderOf(tx, account, orderId, { forUpdate: true });
      if (o.status !== 'RESERVED') {
        if (o.status === 'CANCELLED') throw vaultOfferEnded(VAULT_CLAIM_ENDED);
        return;
      }
      if (at.getTime() >= new Date(o.claim_by!).getTime()) throw vaultOfferEnded(VAULT_CLAIM_ENDED);
      const actor: Actor = { type: 'account', id: account };
      const notes: AuditRecordInput[] = [];
      const from = o.sku_id!;
      if (size !== undefined) {
        const want = (await offeredSizes(tx, o.model_id)).find((z) => (z.label === null ? size === null : size !== null && z.label.toUpperCase() === size.toUpperCase()));
        if (!want) throw validationError('Choose one of this piece’s sizes.');
        if (want.skuId !== o.sku_id) {
          if (await isThePiece(tx, o.vault_id)) throw validationError('THE PIECE comes in your size: its size does not change.');
          // Both SKUs locked in one order (their ids), so two claims swapping between them never wait in a circle.
          for (const k of [from, want.skuId].sort()) await lockSku(tx, k);
          if ((await stockLevel(tx, want.skuId, o.location_id)).available < 1) throw vaultSizeNoneLeft();
          const after = await updateOrder(tx, o.id, { sku_id: want.skuId, size_label: want.label });
          notes.push(await recordChange(tx, o, after, 'order.size', { details: { by: 'collector', from, skuId: want.skuId, reservation: 'STOCK' } }, actor, at));
          // The first unit back to stock: it serves the next order waiting for that size.
          notes.push(...(await serveWaiting(tx, from, o.location_id, actor, at)));
          o = after;
        }
      }
      if (address) {
        const written = await writeOrderAddress(tx, o, address, actor, at);
        o = written.order;
        notes.push(...written.notes);
      }
      if (!shippable(await addressOf(tx, o))) throw vaultAddressMissing();
      const paid = await step(tx, o, { to: 'PAID', note: null }, actor, at, notes, this.mail);
      notes.push({ actor, action: 'vault.claim', targetType: 'vault', targetId: o.vault_id!, details: { orderId: paid.id, skuId: paid.sku_id, sizeChanged: paid.sku_id !== from } });
      for (const n of notes) await this.audit.record(n, tx);
    });
    return { orderId: orderId.toLowerCase(), claimed: true };
  }

  /**
   * The rights to buy a model still open on the account's vaults (YOUR ORDERS, §3.8: BUY within "Until 21:14"), oldest
   * end first: the vault, the model, its usual price and currency, until when, and its offered sizes (null: ONE SIZE).
   * An add-on's right to buy is offered on each order (services/order-addons.ts).
   */
  async rightsToBuy(accountId: string, now: Date = this.clock()): Promise<VaultRightToBuy[]> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) return [];
    const rows = await this.db
      .selectFrom('vaults as v')
      .innerJoin('vault_rewards as r', 'r.id', 'v.reward_id')
      .innerJoin('models as m', 'm.id', 'r.model_id')
      .select(['v.id', 'v.offer_until', 'v.prize', 'r.model_id', 'm.name', 'm.variant_label'])
      .where('v.account_id', '=', accountId.toLowerCase())
      .where('v.reward_kind', '=', 'PRODUCT')
      .where('r.mode', '=', 'RIGHT_TO_BUY')
      .where('v.offer_until', '>', now)
      .where('v.offer_used_at', 'is', null)
      .where('v.order_id', 'is', null)
      .orderBy('v.offer_until')
      .orderBy('v.id')
      .execute();
    const out: VaultRightToBuy[] = [];
    for (const r of rows) {
      const price = await usualPrice(this.db, r.model_id!);
      if (!price) continue;
      const until = new Date(r.offer_until!);
      out.push({
        vaultId: r.id,
        modelId: r.model_id!,
        name: pieceName(r.name, r.variant_label),
        priceMinor: price.minor,
        currency: price.currency,
        offerUntil: until,
        sizes: (await offeredSizes(this.db, r.model_id!)).map((z) => z.label),
        savedSize: (await savedSizeAmong(this.db, accountId, r.model_id!, (await this.db.selectFrom('skus').select(['id', 'size_label', 'fit_min_mm', 'fit_max_mm']).where('model_id', '=', r.model_id!).where('set_aside_at', 'is', null).execute()).flatMap((k) => (k.size_label === null ? [] : [{ id: k.id, label: k.size_label, fitMinMm: k.fit_min_mm, fitMaxMm: k.fit_max_mm }]))))?.label ?? null,
      });
    }
    return out;
  }

  /**
   * BUY under a vault's right to buy (POST /api/v1/account/vaults/:id/buy, step Q3.9; round 2 "Right to buy: 24 HOURS, at
   * its usual price"; S2): within its 24 hours (409 VAULT_OFFER_ENDED after, or when its model is no longer offered or
   * priced), a VAULT order of the model at its usual price in its currency, in the size asked among its offered sizes
   * (400 otherwise; a model of one size needs none), shipping as the tier gives it, held as any order (STOCK, or AWAITING
   * supplier stock), the account's default address or the one given; RESERVED, paid as every platform order (Client
   * Services marks it PAID). Its piece opens a vault at its registration like any bought piece (N8). Bought already: its
   * order. A model's right to buy only (an add-on's is ADD on an order); its own vault (404 VAULT_NOT_FOUND); the account
   * ACTIVE (403 ACCOUNT_LOCKED). The account's lock, then the vault's row. Audited `order.create` (VAULT) and `vault.buy`.
   */
  async buy(accountId: string, vaultId: string, input: VaultBuyInput = {}, now?: Date): Promise<{ orderId: string }> {
    const i = (input && typeof input === 'object' ? input : {}) as VaultBuyInput;
    if (i.size !== undefined && i.size !== null && typeof i.size !== 'string') throw validationError('Choose one of this piece’s sizes.');
    const size = typeof i.size === 'string' ? sizeLabelOf(i.size) : null;
    const address = i.address === undefined || i.address === null ? null : checkOrderAddress(i.address);
    const account = knownAccount(accountId, vaultNotFound);
    if (typeof vaultId !== 'string' || !UUID_RE.test(vaultId)) throw vaultNotFound();
    const id = vaultId.toLowerCase();
    return inRetriedTransaction(this.db, async (tx) => {
      const at = now ?? this.clock();
      await lockAccountAddresses(tx, account);
      const v = await tx.selectFrom('vaults').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!v || v.account_id !== account) throw vaultNotFound();
      if (v.order_id) return { orderId: v.order_id };
      const r = v.reward_id ? await tx.selectFrom('vault_rewards').select(['model_id', 'mode']).where('id', '=', v.reward_id).executeTakeFirst() : undefined;
      if (v.reward_kind !== 'PRODUCT' || r?.mode !== 'RIGHT_TO_BUY' || !r.model_id) throw vaultNotFound();
      if (!v.offer_until || at.getTime() >= new Date(v.offer_until).getTime() || v.offer_used_at) throw vaultOfferEnded(VAULT_BUY_ENDED);
      const m = await tx.selectFrom('models').select(['active', 'discontinued_at', 'vault_only', 'size_type']).where('id', '=', r.model_id).executeTakeFirst();
      const price = await usualPrice(tx, r.model_id);
      if (!m || !m.active || m.discontinued_at !== null || m.vault_only || !price) throw vaultOfferEnded('This piece is no longer offered.');
      const sizes = await offeredSizes(tx, r.model_id);
      let sku: { skuId: string; label: string | null };
      if (sizes.length === 0 && m.size_type === null) {
        // A model with no type and no SKU yet: its one size, created as a welcome gift's is.
        sku = { skuId: await ensureSku(tx, r.model_id, null), label: null };
      } else {
        const want = sizes.length === 1 && size === null ? sizes[0] : sizes.find((z) => (z.label === null ? size === null : size !== null && z.label.toUpperCase() === size.toUpperCase()));
        if (!want) throw validationError('Choose one of this piece’s sizes.');
        sku = want;
      }
      const actor: Actor = { type: 'account', id: account };
      const notes: AuditRecordInput[] = [];
      let o = await createOrder(
        tx,
        {
          channel: 'VAULT',
          vaultId: v.id,
          dropId: null,
          accountId: account,
          modelId: r.model_id,
          sizeLabel: sku.label,
          skuId: sku.skuId,
          priceMinor: price.minor,
          currency: price.currency,
          addons: [],
          surprise: null,
          locationId: await defaultLocationId(tx),
          shipping: await shippingFor(tx, account, price.currency, at),
        },
        { hold: true },
        actor,
        at,
        notes,
      );
      if (address) {
        const written = await writeOrderAddress(tx, o, address, actor, at);
        o = written.order;
        notes.push(...written.notes);
      }
      await tx.updateTable('vaults').set({ order_id: o.id, offer_used_at: at }).where('id', '=', v.id).execute();
      notes.push({ actor, action: 'vault.buy', targetType: 'vault', targetId: v.id, details: { orderId: o.id, modelId: r.model_id, skuId: sku.skuId, priceMinor: price.minor, currency: price.currency } });
      for (const n of notes) await this.audit.record(n, tx);
      return { orderId: o.id };
    });
  }

  /**
   * The housekeeping job `vaults` (§2.5; D20 "claimed within 30 days or back to stock"): each VAULT order at 0 still
   * RESERVED at its `claim_by` CANCELLED by the system ("Not claimed within 30 days."), the unit reserved at the opening
   * back to stock where it serves the next order waiting, each in its own transaction (its row locked and read again),
   * audited `order.cancel` and `vault.claim_expired`. Returns how many were cancelled. Expired offers and vaults need no
   * write (computed). It never touches a test entrant: none holds a vault.
   */
  async expireClaims(now: Date = this.clock()): Promise<number> {
    let n = 0;
    for (;;) {
      const ids = await unclaimedVaultOrders(this.db, now, 100);
      if (ids.length === 0) return n;
      for (const orderId of ids) {
        const cancelled = await inRetriedTransaction(this.db, async (tx) => {
          const o = await tx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
          if (!o || o.status !== 'RESERVED' || o.claim_by === null || new Date(o.claim_by).getTime() > now.getTime()) return false;
          const notes: AuditRecordInput[] = [];
          await step(tx, o, { to: 'CANCELLED', note: VAULT_NOT_CLAIMED }, SYSTEM_ACTOR, now, notes, this.mail);
          notes.push({ actor: SYSTEM_ACTOR, action: 'vault.claim_expired', targetType: 'vault', targetId: o.vault_id!, details: { orderId: o.id, skuId: o.sku_id } });
          for (const x of notes) await this.audit.record(x, tx);
          return true;
        });
        if (cancelled) n += 1;
      }
      if (ids.length < 100) return n;
    }
  }

  /** The account's own VAULT order at 0 (404 ORDER_NOT_FOUND otherwise), FOR UPDATE when asked. */
  private async vaultFreeOrderOf(db: Db, accountId: string, orderId: string, opts: { forUpdate?: boolean } = {}): Promise<OrderRow> {
    const account = knownAccount(accountId, () => orderNotFoundError());
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw orderNotFoundError();
    let q = db.selectFrom('orders').selectAll().where('id', '=', orderId.toLowerCase()).where('account_id', '=', account).where('channel', '=', 'VAULT').where('claim_by', 'is not', null);
    if (opts.forUpdate) q = q.forUpdate();
    const o = await q.executeTakeFirst();
    if (!o) throw orderNotFoundError();
    return o;
  }

  /** How many of the account's vaults wait now (the quiet number, NOW's line; one indexed count). */
  async waitingCount(accountId: string, now: Date = this.clock()): Promise<number> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) return 0;
    const r = await this.db
      .selectFrom('vaults')
      .select((eb) => eb.fn.countAll<string | number>().as('n'))
      .where('account_id', '=', accountId.toLowerCase())
      .where('opened_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('waits_until', '>', now)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** THE VAULT page's data for the account (see AccountVaults). */
  async forAccount(accountId: string, now: Date = this.clock()): Promise<AccountVaults> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const id = accountId.toLowerCase();
    const rows = (await this.db
      .selectFrom('vaults as v')
      .leftJoin('drops as d', 'd.id', 'v.drop_id')
      .leftJoin('models as dm', 'dm.id', 'd.model_id')
      .leftJoin('sets as ds', 'ds.id', 'd.set_id')
      .leftJoin('products as p', 'p.id', 'v.product_id')
      .leftJoin('models as pm', 'pm.id', 'p.model_id')
      .leftJoin('vault_gifts as g', 'g.id', 'v.gift_id')
      .select([
        'v.id',
        'v.source',
        'v.tier',
        'v.given_at',
        'v.waits_until',
        'v.opened_at',
        'v.reward_kind',
        'v.prize',
        'v.prize_line',
        'dm.name as drop_model',
        'dm.variant_label as drop_variant',
        'ds.name as drop_set',
        'pm.name as piece_model',
        'pm.variant_label as piece_variant',
        'v.gift_id',
        'g.accepted_by as gift_accepted_by',
        'g.expires_at as gift_expires_at',
      ])
      .where('v.account_id', '=', id)
      .where('v.revoked_at', 'is', null)
      .where((eb) => eb.or([eb('v.opened_at', 'is not', null), eb('v.waits_until', '>', now)]))
      .execute()) as unknown as VaultReadRow[];

    const waiting = rows
      .filter((r) => r.opened_at === null)
      .sort((a, b) => new Date(a.given_at).getTime() - new Date(b.given_at).getTime() || a.id.localeCompare(b.id))
      .map((r): VaultDoor => {
        const detail = detailOf(r);
        const waitsUntil = new Date(r.waits_until);
        return { id: r.id, source: r.source, label: VAULT_SOURCE_LABELS[r.source], detail, line: vaultSourceLine(r.source, detail), givenAt: new Date(r.given_at), waitsUntil, waitsUntilDay: parisDay(waitsUntil) };
      });
    const opened = rows
      .filter((r) => r.opened_at !== null)
      .sort((a, b) => new Date(b.opened_at!).getTime() - new Date(a.opened_at!).getTime() || b.id.localeCompare(a.id))
      .map((r): VaultOpenedRow => {
        const openedAt = new Date(r.opened_at!);
        const kind = r.reward_kind!;
        const prize = r.prize ?? '';
        const gift = r.gift_id
          ? { code: r.gift_accepted_by === null && r.gift_expires_at !== null && new Date(r.gift_expires_at).getTime() > now.getTime() ? formatGrouped(vaultGiftCode(r.id, this.giftKey)) : null, given: r.gift_accepted_by !== null }
          : null;
        return { id: r.id, source: r.source, label: VAULT_SOURCE_LABELS[r.source], detail: detailOf(r), givenDay: parisDay(new Date(r.given_at)), openedAt, openedDay: parisDay(openedAt), kind, prize, prizeLine: r.prize_line, held: vaultHeld(kind, prize), gift };
      });
    return { waiting, opened, ledger: await this.ledger(id, now), waitingCount: waiting.length };
  }

  /** HOW TO OBTAIN A VAULT with this collector's state (N21): the sources switched on, in their order. */
  private async ledger(accountId: string, now: Date): Promise<VaultLedgerRow[]> {
    const on = await this.db.selectFrom('vault_sources').select('source').where('enabled', '=', true).execute();
    const enabled = new Set(on.map((s) => s.source));
    const out: VaultLedgerRow[] = [];
    for (const source of VAULT_SOURCES) {
      if (!enabled.has(source)) continue;
      switch (source) {
        case 'LIVE': {
          const next = await this.db
            .selectFrom('drops as d')
            .select('d.opens_at')
            .where('d.mode', '=', 'LIVE')
            .where('d.parent_drop_id', 'is', null)
            .where('d.vault_on', '=', true)
            .where('d.published_at', 'is not', null)
            .where('d.cancelled_at', 'is', null)
            .where('d.ended_at', 'is', null)
            .where('d.closes_at', '>', now)
            .where(sql<Date>`coalesce(d.announce_at, d.published_at)`, '<=', now)
            .orderBy('d.opens_at')
            .orderBy('d.id')
            .limit(1)
            .executeTakeFirst();
          out.push({ source, next: next ? parisDay(new Date(next.opens_at)) : null });
          break;
        }
        case 'TIER': {
          const standing = await tierOf(this.db, accountId, now);
          const nextTier = standing.tier < 3 ? ((standing.tier + 1) as 1 | 2 | 3) : null;
          const threshold = nextTier ? CLUB_TIER_THRESHOLDS[nextTier - 1]! : null;
          out.push({
            source,
            tier: tierName(standing.tier),
            pieces: standing.pieces,
            next: nextTier && threshold !== null ? { tier: CLUB_TIER_NAMES[nextTier - 1]!, pieces: threshold, away: Math.max(1, threshold - standing.pieces) } : null,
          });
          break;
        }
        case 'PROFILE': {
          const p = await this.profiles.forCollector(accountId).catch(() => null);
          const percent = p?.completion.percent ?? 0;
          out.push({ source, done: p !== null && p.completion.missing.length === 0, percent });
          break;
        }
        default:
          out.push({ source });
      }
    }
    return out;
  }

  // ── CLUB > THE VAULT ─────────────────────────────────────────────────────

  /** The sources, the table and the odds (GET /api/admin/vault/settings; AUDITOR reads). */
  async settings(db: Db = this.db): Promise<VaultSettings> {
    const sources = await db
      .selectFrom('vault_sources as s')
      .leftJoin('admin_users as u', 'u.id', 's.updated_by')
      .select(['s.source', 's.enabled', 's.per_occasion', 's.cap', 's.updated_at', 'u.id as by_id', 'u.email as by_email'])
      .execute();
    const order = new Map(VAULT_SOURCES.map((s, i) => [s, i]));
    const rows = await db
      .selectFrom('vault_rewards as r')
      .leftJoin('models as m', 'm.id', 'r.model_id')
      .leftJoin('addon_items as a', 'a.id', 'r.addon_id')
      .select([
        'r.id',
        'r.kind',
        'r.odds_in',
        'r.quantity',
        'r.given',
        'r.amount_minor',
        'r.currency',
        'r.model_id',
        'm.name as model_name',
        'm.variant_label',
        'r.addon_id',
        'a.name as addon_name',
        'r.mode',
        'r.line',
        'r.active',
        'r.position',
      ])
      .orderBy('r.position')
      .orderBy('r.created_at')
      .orderBy('r.id')
      .execute();
    const rewards = rows.map(
      (r): VaultRewardSetting => ({
        id: r.id,
        kind: r.kind,
        oddsIn: r.odds_in,
        oddsText: r.odds_in ? oddsText(r.odds_in) : null,
        parts: r.active && r.odds_in ? rewardParts(r.odds_in) : 0,
        quantity: r.quantity,
        given: r.given,
        left: r.quantity === null ? null : Math.max(0, r.quantity - r.given),
        amountMinor: r.amount_minor,
        currency: r.currency,
        modelId: r.model_id,
        modelName: r.model_name ? pieceName(r.model_name, r.variant_label) : null,
        addonId: r.addon_id,
        addonName: r.addon_name,
        mode: r.mode,
        line: r.line,
        active: r.active,
        position: r.position,
        rare: VAULT_RARE_KINDS.includes(r.kind),
      }),
    );
    const given = rewards.filter((r) => r.kind !== 'I_WAS_THERE').reduce((n, r) => n + r.parts, 0);
    const floorRow = rewards.find((r) => r.kind === 'I_WAS_THERE')!;
    const floorParts = Math.max(0, VAULT_DRAW_PARTS - given);
    const floorOdds = floorOddsIn(floorParts);
    floorRow.parts = floorParts;
    return {
      sources: sources
        .sort((a, b) => order.get(a.source)! - order.get(b.source)!)
        .map((s) => ({ source: s.source, enabled: s.enabled, perOccasion: s.per_occasion, cap: s.cap, updatedAt: new Date(s.updated_at), updatedBy: s.by_id && s.by_email ? { id: s.by_id, email: s.by_email } : null })),
      rewards,
      partsGiven: given,
      floor: { id: floorRow.id, parts: floorParts, oddsIn: floorOdds, oddsText: floorOdds === null ? null : oddsText(floorOdds) },
    };
  }

  /** A source's switch, vaults per occasion and cap (PUT /api/admin/vault/sources/:source, ADMIN). Audited `vault.settings`. */
  async setSource(source: string, input: VaultSourceInput, actor: Actor): Promise<VaultSettings> {
    const by = assertStaff(actor, 'change THE VAULT’s sources');
    if (!(VAULT_SOURCES as readonly string[]).includes(source)) throw notFound('Source', 'VAULT_SOURCE_NOT_FOUND');
    if (typeof input?.enabled !== 'boolean') throw validationError('Say whether the source is on.');
    const perOccasion = int(input.perOccasion, 'Vaults per occasion', VAULT_PER_OCCASION.min, VAULT_PER_OCCASION.max);
    const cap = input.cap === null ? null : int(input.cap, 'The cap', VAULT_CAP.min, VAULT_CAP.max);
    if (source === 'HOUSE' && cap !== null) throw validationError('The house’s gifts have no cap: each gift is its own.');
    return inTransaction(this.db, async (tx) => {
      const before = await tx.selectFrom('vault_sources').select(['enabled', 'per_occasion', 'cap']).where('source', '=', source as VaultSource).forUpdate().executeTakeFirstOrThrow();
      await tx.updateTable('vault_sources').set({ enabled: input.enabled as boolean, per_occasion: perOccasion, cap, updated_by: by }).where('source', '=', source as VaultSource).execute();
      await this.audit.record(
        {
          actor,
          action: 'vault.settings',
          targetType: 'vault_source',
          targetId: source,
          details: { source, before: { enabled: before.enabled, perOccasion: before.per_occasion, cap: before.cap }, after: { enabled: input.enabled, perOccasion, cap } },
        },
        tx,
      );
      return this.settings(tx);
    });
  }

  /** A new row of the house table (POST /api/admin/vault/rewards, OPERATOR). Audited `vault.reward.create`. */
  async createReward(input: VaultRewardInput, actor: Actor): Promise<VaultSettings> {
    const by = assertStaff(actor, 'change THE VAULT’s table');
    const kind = input?.kind;
    if (typeof kind !== 'string' || !(VAULT_REWARD_KINDS as readonly string[]).includes(kind)) throw validationError('A reward is one of the vault’s kinds.');
    if (kind === 'I_WAS_THERE') throw vaultFloorFixed();
    const position = input.position === undefined ? null : int(input.position, 'The position', 0, VAULT_REWARD_POSITION_MAX);
    return inTransaction(this.db, async (tx) => {
      await lockTable(tx);
      const clean = await cleanReward(tx, kind as VaultRewardKind, input);
      const last = await tx.selectFrom('vault_rewards').select((eb) => eb.fn.max('position').as('p')).executeTakeFirstOrThrow();
      const row = await tx
        .insertInto('vault_rewards')
        .values({ kind: kind as VaultRewardKind, ...clean, active: true, position: position ?? Math.min(VAULT_REWARD_POSITION_MAX, Number(last.p ?? 0) + 1), created_by: by, updated_by: by })
        .returning('id')
        .executeTakeFirstOrThrow();
      await checkOdds(tx);
      await this.audit.record({ actor, action: 'vault.reward.create', targetType: 'vault_reward', targetId: row.id, details: { kind, ...rewardDetails(clean) } }, tx);
      return this.settings(tx);
    });
  }

  /**
   * A row changed whole for its kind (PUT /api/admin/vault/rewards/:id, OPERATOR): its odds, quantity (never below what
   * was given), its own fields, active again or not. The floor only moves (`orderRewards`). Audited `vault.reward.update`.
   */
  async updateReward(rewardId: string, input: VaultRewardInput, actor: Actor): Promise<VaultSettings> {
    const by = assertStaff(actor, 'change THE VAULT’s table');
    if (typeof rewardId !== 'string' || !UUID_RE.test(rewardId)) throw vaultRewardNotFound();
    return inTransaction(this.db, async (tx) => {
      await lockTable(tx);
      const before = await tx.selectFrom('vault_rewards').selectAll().where('id', '=', rewardId.toLowerCase()).forUpdate().executeTakeFirst();
      if (!before) throw vaultRewardNotFound();
      if (before.kind === 'I_WAS_THERE') throw vaultFloorFixed();
      if (input?.kind !== undefined && input.kind !== before.kind) throw validationError('A reward keeps its kind: add another row.');
      const clean = await cleanReward(tx, before.kind, input ?? {});
      if (clean.quantity < before.given) throw validationError(`The quantity is at least what was given: ${before.given}.`);
      // What a row gave is delivered by reading the row (a right to buy, a free piece, a free add-on: its model, add-on
      // and mode): once given, those stay as they were won.
      if (before.given > 0 && (clean.model_id !== before.model_id || clean.addon_id !== before.addon_id || clean.mode !== before.mode)) throw vaultRewardGiven();
      const active = input.active === undefined ? before.active : input.active;
      if (typeof active !== 'boolean') throw validationError('Say whether the reward is active.');
      await tx
        .updateTable('vault_rewards')
        .set({ ...clean, active, updated_by: by })
        .where('id', '=', before.id)
        .execute();
      await checkOdds(tx);
      await this.audit.record(
        {
          actor,
          action: 'vault.reward.update',
          targetType: 'vault_reward',
          targetId: before.id,
          details: { kind: before.kind, before: { ...rewardDetails(before), active: before.active }, after: { ...rewardDetails(clean), active } },
        },
        tx,
      );
      return this.settings(tx);
    });
  }

  /** A row made inactive (POST /api/admin/vault/rewards/:id/deactivate, OPERATOR); never the floor. Audited `vault.reward.deactivate`. */
  async deactivateReward(rewardId: string, actor: Actor): Promise<VaultSettings> {
    const by = assertStaff(actor, 'change THE VAULT’s table');
    if (typeof rewardId !== 'string' || !UUID_RE.test(rewardId)) throw vaultRewardNotFound();
    return inTransaction(this.db, async (tx) => {
      await lockTable(tx);
      const r = await tx.selectFrom('vault_rewards').select(['id', 'kind', 'active']).where('id', '=', rewardId.toLowerCase()).executeTakeFirst();
      if (!r) throw vaultRewardNotFound();
      if (r.kind === 'I_WAS_THERE') throw vaultFloorFixed();
      if (r.active) {
        await tx.updateTable('vault_rewards').set({ active: false, updated_by: by }).where('id', '=', r.id).execute();
        await this.audit.record({ actor, action: 'vault.reward.deactivate', targetType: 'vault_reward', targetId: r.id, details: { kind: r.kind } }, tx);
      }
      return this.settings(tx);
    });
  }

  /** The table's order (POST /api/admin/vault/rewards/order, OPERATOR): every row named once, in its new order. Audited `vault.reward.order`. */
  async orderRewards(ids: unknown, actor: Actor): Promise<VaultSettings> {
    const by = assertStaff(actor, 'change THE VAULT’s table');
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) throw validationError('Name every reward once, in order.');
    const order = ids.map((x: string) => x.toLowerCase());
    return inTransaction(this.db, async (tx) => {
      await lockTable(tx);
      const all = await tx.selectFrom('vault_rewards').select('id').execute();
      const known = new Set(all.map((r) => r.id));
      if (order.length !== known.size || new Set(order).size !== order.length || order.some((x) => !known.has(x))) throw validationError('Name every reward once, in order.');
      if (order.length - 1 > VAULT_REWARD_POSITION_MAX) throw validationError('The table holds too many rows to order.');
      for (const [i, id] of order.entries()) await tx.updateTable('vault_rewards').set({ position: i, updated_by: by }).where('id', '=', id).where('position', '<>', i).execute();
      await this.audit.record({ actor, action: 'vault.reward.order', targetType: 'vault_reward', targetId: null, details: { order } }, tx);
      return this.settings(tx);
    });
  }

  // ── The routes' reads and the model's switch (step Q3.9) ─────────────────

  /**
   * The entry's own vault of a LIVE release while it waits (GET /api/v1/account/vaults/live/:dropId; §3.3, §3.4, N28):
   * the door on SOLD OUT for your size and on the end page. 404 VAULT_NOT_FOUND otherwise (none, opened or expired
   * elsewhere, another account's; an after-room has none of its own, N18, N20).
   */
  async liveVault(accountId: string, dropId: string, now: Date = this.clock()): Promise<VaultDoor> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId) || typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw vaultNotFound();
    const r = await this.db
      .selectFrom('vaults as v')
      .innerJoin('drops as d', 'd.id', 'v.drop_id')
      .leftJoin('models as m', 'm.id', 'd.model_id')
      .leftJoin('sets as s', 's.id', 'd.set_id')
      .select(['v.id', 'v.given_at', 'v.waits_until', 'm.name as model', 'm.variant_label', 's.name as set'])
      .where('v.account_id', '=', accountId.toLowerCase())
      .where('v.source', '=', 'LIVE')
      .where('v.drop_id', '=', dropId.toLowerCase())
      .where('v.opened_at', 'is', null)
      .where('v.revoked_at', 'is', null)
      .where('v.waits_until', '>', now)
      .orderBy('v.given_at')
      .orderBy('v.id')
      .executeTakeFirst();
    if (!r) throw vaultNotFound();
    const detail = r.model ? pieceName(r.model, r.variant_label) : (r.set ?? null);
    const waitsUntil = new Date(r.waits_until);
    return { id: r.id, source: 'LIVE', label: VAULT_SOURCE_LABELS.LIVE, detail, line: vaultSourceLine('LIVE', detail), givenAt: new Date(r.given_at), waitsUntil, waitsUntilDay: parisDay(waitsUntil) };
  }

  /**
   * A client's vaults for the console's client sheet (GET /api/admin/vault/vaults?account=; §4.4), newest given first,
   * every state, read-only: no revoke (N36). 404 ACCOUNT_NOT_FOUND.
   */
  async forConsole(accountId: string, now: Date = this.clock()): Promise<AdminVault[]> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const id = accountId.toLowerCase();
    if (!(await this.db.selectFrom('accounts').select('id').where('id', '=', id).executeTakeFirst())) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const rows = await this.db
      .selectFrom('vaults as v')
      .leftJoin('drops as d', 'd.id', 'v.drop_id')
      .leftJoin('models as dm', 'dm.id', 'd.model_id')
      .leftJoin('sets as ds', 'ds.id', 'd.set_id')
      .leftJoin('products as p', 'p.id', 'v.product_id')
      .leftJoin('models as pm', 'pm.id', 'p.model_id')
      .leftJoin('admin_users as u', 'u.id', 'v.given_by')
      .select([
        'v.id',
        'v.source',
        'v.tier',
        'v.given_at',
        'v.waits_until',
        'v.opened_at',
        'v.revoked_at',
        'v.revoked_reason',
        'v.reward_kind',
        'v.prize',
        'v.prize_line',
        'v.odds_text',
        'v.rare',
        'v.order_id',
        'v.note',
        'u.id as by_id',
        'u.email as by_email',
        'dm.name as drop_model',
        'dm.variant_label as drop_variant',
        'ds.name as drop_set',
        'pm.name as piece_model',
        'pm.variant_label as piece_variant',
      ])
      .where('v.account_id', '=', id)
      .orderBy('v.given_at', 'desc')
      .orderBy('v.id', 'desc')
      .execute();
    return rows.map((r) => {
      const detail = detailOf({ ...r, gift_id: null, gift_accepted_by: null, gift_expires_at: null } as unknown as VaultReadRow);
      return {
        id: r.id,
        source: r.source,
        label: VAULT_SOURCE_LABELS[r.source],
        detail,
        line: vaultSourceLine(r.source, detail),
        givenAt: new Date(r.given_at),
        waitsUntil: new Date(r.waits_until),
        state: vaultState(r, now),
        openedAt: r.opened_at ? new Date(r.opened_at) : null,
        revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
        revokedReason: r.revoked_reason ?? null,
        kind: r.reward_kind,
        held: r.reward_kind && r.prize !== null ? vaultHeld(r.reward_kind, r.prize) : null,
        odds: r.odds_text,
        rare: r.rare,
        orderId: r.order_id,
        givenBy: r.by_id && r.by_email ? { id: r.by_id, email: r.by_email } : null,
        note: r.note,
      };
    });
  }

  /** THE VAULT's report for the Paris days `from` to `to` (both or neither: the last 30 days; see VaultReport). 422 PERIOD_INVALID. */
  async report(q: { from?: string | undefined; to?: string | undefined } = {}, now: Date = this.clock()): Promise<VaultReport> {
    const p = vaultPeriod(q, now);
    const { start, end } = p;
    const db = this.db;
    const n = (v: unknown) => Number(v ?? 0);
    const inPeriod = (column: 'given_at' | 'opened_at' | 'revoked_at' | 'waits_until') => (eb: ExpressionBuilder<Database, 'vaults'>) => eb.and([eb(column, '>=', start), eb(column, '<', end)]);

    const given = new Map((await db.selectFrom('vaults').select(['source', (eb) => eb.fn.countAll<string | number>().as('n')]).where(inPeriod('given_at')).groupBy('source').execute()).map((r) => [r.source, n(r.n)]));
    const count = async (where: (eb: ExpressionBuilder<Database, 'vaults'>) => ReturnType<ExpressionBuilder<Database, 'vaults'>['and']>) =>
      n((await db.selectFrom('vaults').select((eb) => eb.fn.countAll<string | number>().as('n')).where(where).executeTakeFirstOrThrow()).n);
    const opened = await count(inPeriod('opened_at'));
    const revoked = await count(inPeriod('revoked_at'));
    const waiting = await count((eb) => eb.and([inPeriod('given_at')(eb), eb('opened_at', 'is', null), eb('revoked_at', 'is', null), eb('waits_until', '>', now)]));
    const expired = await count((eb) => eb.and([inPeriod('waits_until')(eb), eb('opened_at', 'is', null), eb('revoked_at', 'is', null), eb('waits_until', '<=', now)]));

    // What the period's openings gave, row by row.
    const figures = new Map<string, { kind: VaultRewardKind; won: number; value: Map<string, number>; cost: Map<string, number>; costUnknown: number }>();
    const of = (rewardId: string, kind: VaultRewardKind) => {
      let f = figures.get(rewardId);
      if (!f) figures.set(rewardId, (f = { kind, won: 0, value: new Map(), cost: new Map(), costUnknown: 0 }));
      return f;
    };
    const add = (m: Map<string, number>, currency: string, minor: number) => m.set(currency, (m.get(currency) ?? 0) + minor);
    const won = await db
      .selectFrom('vaults')
      .select(['reward_id', 'reward_kind', 'currency', (eb) => eb.fn.countAll<string | number>().as('n'), (eb) => eb.fn.sum<string | number | null>('value_minor').as('value'), (eb) => eb.fn.sum<string | number | null>('cost_minor').as('cost')])
      .where(inPeriod('opened_at'))
      .where('reward_id', 'is not', null)
      .groupBy(['reward_id', 'reward_kind', 'currency'])
      .execute();
    for (const r of won) {
      const f = of(r.reward_id!, r.reward_kind!);
      f.won += n(r.n);
      if (r.currency && r.value !== null) add(f.value, r.currency, n(r.value));
      // Written at the opening: a credit's face value (CREDIT, CREDIT TO GIVE).
      if (r.currency && r.cost !== null && n(r.cost) > 0) add(f.cost, r.currency, n(r.cost));
    }
    // A piece won free (a model, a VAULT EDITION, THE PIECE) still on its way (never one cancelled: its unit went back to
    // stock), and a free add-on's unit on an order: their supplier unit price where known.
    const units = [
      ...(await db
        .selectFrom('vaults as v')
        .innerJoin('orders as o', 'o.id', 'v.order_id')
        .select(['v.reward_id', 'v.reward_kind', 'o.sku_id'])
        .where((eb) => eb.and([eb('v.opened_at', '>=', start), eb('v.opened_at', '<', end)]))
        .where('o.price_minor', '=', 0)
        .where('o.status', '<>', 'CANCELLED')
        .execute()),
      ...(await db
        .selectFrom('vaults as v')
        .innerJoin('order_addon_items as u', 'u.vault_id', 'v.id')
        .select(['v.reward_id', 'v.reward_kind', 'u.sku_id'])
        .where((eb) => eb.and([eb('v.opened_at', '>=', start), eb('v.opened_at', '<', end)]))
        .where('u.status', 'not in', ['REMOVED', 'CANCELLED'])
        .execute()),
    ];
    const unitCost = await supplierUnitCosts(db, [...new Set(units.map((u) => u.sku_id).filter((s): s is string => s !== null))]);
    for (const u of units) {
      if (!u.reward_id || !u.reward_kind) continue;
      const f = of(u.reward_id, u.reward_kind);
      const c = u.sku_id ? unitCost.get(u.sku_id) : undefined;
      if (c) add(f.cost, c.currency, c.minor);
      else f.costUnknown += 1;
    }
    const credits = { given: new Map<string, number>(), used: new Map<string, number>() };
    for (const f of figures.values()) if (f.kind === 'CREDIT' || f.kind === 'CREDIT_TO_GIVE') for (const [c, m] of f.value) add(credits.given, c, m);
    const used = await db
      .selectFrom('credit_uses as cu')
      .innerJoin('tier_grants as g', 'g.id', 'cu.grant_id')
      .innerJoin('vaults as v', 'v.id', 'g.vault_id')
      .select(['g.currency', (eb) => eb.fn.sum<string | number>('cu.amount_minor').as('n')])
      .where('g.kind', '=', 'VAULT')
      .where('cu.released_at', 'is', null)
      .where((eb) => eb.and([eb('v.opened_at', '>=', start), eb('v.opened_at', '<', end)]))
      .groupBy('g.currency')
      .execute();
    for (const r of used) if (r.currency) add(credits.used, r.currency, n(r.n));

    const money = (m: Map<string, number>): VaultMoney[] => [...m].filter(([, minor]) => minor !== 0).map(([currency, minor]) => ({ currency, minor })).sort(byHouseCurrency);
    const none = () => ({ won: 0, value: new Map<string, number>(), cost: new Map<string, number>(), costUnknown: 0 });
    const out = (f: { won: number; value: Map<string, number>; cost: Map<string, number>; costUnknown: number }): VaultWonFigures => ({ won: f.won, value: money(f.value), cost: money(f.cost), costUnknown: f.costUnknown });
    const table = await this.settings();
    const byKind = VAULT_GRID.map(({ kind }) => {
      const sum = none();
      for (const f of figures.values()) {
        if (f.kind !== kind) continue;
        sum.won += f.won;
        sum.costUnknown += f.costUnknown;
        for (const [c, m] of f.value) add(sum.value, c, m);
        for (const [c, m] of f.cost) add(sum.cost, c, m);
      }
      return { kind, ...out(sum) };
    });
    const total = new Map<string, number>();
    let costUnknown = 0;
    for (const f of figures.values()) {
      for (const [c, m] of f.cost) add(total, c, m);
      costUnknown += f.costUnknown;
    }
    return {
      from: p.from,
      to: p.to,
      given: VAULT_SOURCES.map((source) => ({ source, count: given.get(source) ?? 0 })),
      givenTotal: [...given.values()].reduce((a, b) => a + b, 0),
      opened,
      waiting,
      expired,
      revoked,
      byKind,
      rows: table.rewards.map((r) => ({ ...r, ...out(figures.get(r.id) ?? none()) })),
      credits: { given: money(credits.given), used: money(credits.used) },
      totalCost: money(total),
      costUnknown,
    };
  }

  /**
   * The report as a CSV (GET /api/admin/vault/report.csv, AUDITOR; §4.3 "CSV export as the console's other reports"): one
   * figure per row (section, item, value, every field quoted, render/csv.ts), named by the period's Paris days.
   */
  async reportCsv(q: { from?: string | undefined; to?: string | undefined } = {}, now: Date = this.clock()): Promise<{ filename: string; contentType: string; body: string }> {
    const rep = await this.report(q, now);
    return { filename: `ORBES-vault-report-${rep.from}-to-${rep.to}.csv`, contentType: CSV_CONTENT_TYPE, body: vaultReportCsv(rep) };
  }

  /**
   * A model's VAULT ONLY (PUT /api/admin/models/:id/vault-only, OPERATOR; §4.5, D19 "rare VAULT EDITION (catalogue
   * product marked vault-only, never sold)"): on, every sales path refuses it (MODEL_VAULT_ONLY); off, it is sold again.
   * Refused while THE VAULT's table holds it the other way: on while an active PRODUCT row names it, off while an active
   * VAULT EDITION does (409, worded); on while it is on sale (a published release or draw of it or of a set holding it
   * not ended, an open salon request naming it: 409 VAULT_ONLY_PRODUCT, worded). 404 MODEL_NOT_FOUND. Audited
   * `model.vault_only`.
   */
  async setVaultOnly(modelId: string, on: unknown, actor: Actor): Promise<{ modelId: string; vaultOnly: boolean }> {
    assertStaff(actor, 'change a model');
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (typeof on !== 'boolean') throw validationError('VAULT ONLY is on or off.');
    const id = modelId.toLowerCase();
    return inTransaction(this.db, async (tx) => {
      await lockTable(tx);
      const m = await tx.selectFrom('models').select('vault_only').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!m) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (m.vault_only === on) return { modelId: id, vaultOnly: on };
      const row = await tx.selectFrom('vault_rewards').select('kind').where('model_id', '=', id).where('active', '=', true).where('kind', '=', on ? 'PRODUCT' : 'VAULT_EDITION').executeTakeFirst();
      if (row && on) throw conflict('VAULT_ONLY_PRODUCT', 'This model is a product of THE VAULT’s table: deactivate that row before marking it vault-only.');
      if (row) throw conflict('VAULT_EDITION_MODEL', 'This model is a VAULT EDITION of THE VAULT’s table: deactivate that row before selling it.');
      // On sale now (a published release or draw of the model, or of a set holding it, not ended; an open request of the
      // private salon naming it): marked vault-only, its sale could not go on, nor its settings be saved.
      if (on && (await onSale(tx, id))) throw conflict('VAULT_ONLY_PRODUCT', 'This model is on sale in a release, a draw or the private salon: wait for its end before marking it vault-only.');
      await tx.updateTable('models').set({ vault_only: on }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'model.vault_only', targetType: 'model', targetId: id, details: { before: m.vault_only, after: on } }, tx);
      return { modelId: id, vaultOnly: on };
    });
  }
}

/**
 * Whether a model is on sale now: a published release or draw of it, or of a set holding it, neither cancelled nor
 * ended (a LIVE RELEASE until its end, a draw until it is drawn), or an open request of the private salon naming it.
 */
async function onSale(db: Db, modelId: string): Promise<boolean> {
  const release = await db
    .selectFrom('drops as d')
    .select('d.id')
    .where((eb) => eb.or([eb('d.model_id', '=', modelId), eb('d.set_id', 'in', eb.selectFrom('set_models').select('set_id').where('model_id', '=', modelId))]))
    .where('d.published_at', 'is not', null)
    .where('d.cancelled_at', 'is', null)
    .where('d.ended_at', 'is', null)
    .where((eb) => eb.or([eb('d.mode', '=', 'LIVE'), eb('d.drawn_at', 'is', null)]))
    .executeTakeFirst();
  if (release) return true;
  return (await db.selectFrom('shop_requests').select('id').where('model_id', '=', modelId).where('status', '=', 'OPEN').executeTakeFirst()) !== undefined;
}

/** The house currencies' order (EUR, GBP, USD, CHF), any other after them. */
function byHouseCurrency(a: VaultMoney, b: VaultMoney): number {
  const rank = (c: string) => {
    const i = (HOUSE_CURRENCIES as readonly string[]).indexOf(c);
    return i === -1 ? HOUSE_CURRENCIES.length : i;
  };
  return rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency);
}

const VAULT_REPORT_DAYS = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const periodInvalid = (message: string) => new DomainError('PERIOD_INVALID', 422, message);

/** A Paris day `days` after `day` (calendar arithmetic). */
function dayPlus(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The report's Paris days and instants: both days or neither (the last 30 days, today included); 422 PERIOD_INVALID. */
export function vaultPeriod(q: { from?: string | undefined; to?: string | undefined }, now: Date): { from: string; to: string; start: Date; end: Date } {
  const from = q.from || null;
  const to = q.to || null;
  if ((from === null) !== (to === null)) throw periodInvalid('Give the first and the last day, or neither.');
  const today = parisDay(now);
  const period = from !== null && to !== null ? { from, to } : { from: dayPlus(today, 1 - VAULT_REPORT_DAYS), to: today };
  const isDay = (v: string) => DAY_RE.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
  if (!isDay(period.from) || !isDay(period.to)) throw periodInvalid('A day is YYYY-MM-DD.');
  if (period.to < period.from) throw periodInvalid('The last day is before the first.');
  return { ...period, start: parisDayStart(period.from), end: parisDayStart(dayPlus(period.to, 1)) };
}

/** An amount in minor units as the house's CSVs write it (`25.00`), as live-console.ts `majorUnits`. */
const csvMajor = (minor: number): string => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

/**
 * THE VAULT's report as a CSV (§4.3): the period, the vaults given by source, opened, waiting, expired and returned, the
 * rewards won by kind and by row (their count, value and cost per currency, the cost unknown, each row's quantity, given
 * and left), the credits given and used, the total cost. One figure per row: section, item, value.
 */
export function vaultReportCsv(rep: VaultReport): string {
  const rows: string[][] = [['section', 'item', 'value']];
  const add = (section: string, item: string, value: string | number) => rows.push([section, item, String(value)]);
  const money = (section: string, item: string, list: readonly VaultMoney[]) => {
    for (const m of list) add(section, `${item} ${m.currency}`, csvMajor(m.minor));
  };
  add('period', 'from', rep.from);
  add('period', 'to', rep.to);
  for (const g of rep.given) add('given', g.source.toLowerCase(), g.count);
  add('given', 'total', rep.givenTotal);
  add('vaults', 'opened', rep.opened);
  add('vaults', 'waiting', rep.waiting);
  add('vaults', 'expired', rep.expired);
  add('vaults', 'returned', rep.revoked);
  for (const k of rep.byKind) {
    const s = `kind ${k.kind.toLowerCase()}`;
    add(s, 'won', k.won);
    money(s, 'value', k.value);
    money(s, 'cost', k.cost);
    if (k.costUnknown > 0) add(s, 'cost unknown', k.costUnknown);
  }
  for (const [i, r] of rep.rows.entries()) {
    const s = `reward ${i + 1} ${r.kind.toLowerCase()}`;
    const what = r.kind === 'CREDIT' || r.kind === 'CREDIT_TO_GIVE' ? (r.amountMinor !== null && r.currency ? `${r.currency} ${csvMajor(r.amountMinor)}` : '') : (r.modelName ?? r.addonName ?? '');
    add(s, 'what', [what, r.mode ?? ''].filter(Boolean).join(' '));
    add(s, 'odds', r.kind === 'I_WAS_THERE' ? 'the rest' : (r.oddsText ?? ''));
    add(s, 'active', r.active ? 'yes' : 'no');
    add(s, 'won', r.won);
    money(s, 'value', r.value);
    money(s, 'cost', r.cost);
    if (r.costUnknown > 0) add(s, 'cost unknown', r.costUnknown);
    add(s, 'quantity', r.quantity === null ? '' : r.quantity);
    add(s, 'given', r.given);
    add(s, 'left', r.left === null ? '' : r.left);
  }
  money('credits', 'given', rep.credits.given);
  money('credits', 'used', rep.credits.used);
  money('cost', 'total', rep.totalCost);
  add('cost', 'unknown', rep.costUnknown);
  return csvDocument(rows);
}

/**
 * Each SKU's supplier unit price where known (N29): the price of its latest line on a supplier order that was sent, in
 * that order's currency; a SKU never ordered with a price is absent.
 */
async function supplierUnitCosts(db: Db, skuIds: readonly string[]): Promise<Map<string, VaultMoney>> {
  if (skuIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('supplier_order_lines as l')
    .innerJoin('supplier_orders as so', 'so.id', 'l.supplier_order_id')
    .select(['l.sku_id', 'l.unit_price_minor', 'so.currency'])
    .distinctOn('l.sku_id')
    .where('l.sku_id', 'in', [...skuIds])
    .where('l.unit_price_minor', 'is not', null)
    .where('so.currency', 'is not', null)
    .where('so.sent_at', 'is not', null)
    .orderBy('l.sku_id')
    .orderBy('so.sent_at', 'desc')
    .orderBy('l.id', 'desc')
    .execute();
  return new Map(rows.map((r) => [r.sku_id, { currency: r.currency!, minor: Number(r.unit_price_minor) }]));
}

/** A row's figures as the audit keeps them (no staff words beyond a VAULT EDITION's line's length). */
function rewardDetails(r: { odds_in: number | null; quantity: number | null; amount_minor: number | null; currency: string | null; model_id: string | null; addon_id: string | null; mode: string | null; line: string | null }) {
  return { oddsIn: r.odds_in, quantity: r.quantity, amountMinor: r.amount_minor, currency: r.currency, modelId: r.model_id, addonId: r.addon_id, mode: r.mode, lineLength: r.line === null ? null : [...r.line].length };
}
