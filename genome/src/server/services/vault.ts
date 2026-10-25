/**
 * THE VAULT — the rules (lot Q3, step Q3.3; plan §2.1, §2.5 states, §2.7; vault/SCOPE.md CURRENT STATE E1 "A
 * platform-wide concept. ONE vault, ONE house table for every source.", E5, E6, E10, ROUND 5, OPEN POINTS OP-26, OP-29).
 * Migrations 0061_the_vault and 0062_vault_rewards hold the tables; this file gives, reads and sets.
 *
 *   giveVault     (tx, occasion, now): a vault for an occasion of one of the seven sources (D3), in the caller's
 *                 transaction, after its own writes. Nothing when the source is switched off (a LIVE release also needs
 *                 its own switch, `drops.vault_on`, D4), the account is not ACTIVE, the account is a test entrant (ROUND 5
 *                 "Test accounts: NEVER get a vault", D9: every source, the house's GIVE A VAULT included; `isTestEntrant`)
 *                 or the cap of the source's scope is reached. The account's row is taken FOR NO KEY UPDATE first (FOR
 *                 KEY SHARE for LIVE, whose release's row orders its occasions), so two
 *                 occasions of one account at once count each other; then `per_occasion` rows are inserted at the lowest
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
 *                answer is never a second draw), the active rewards FOR UPDATE (the floor's row first, as the table's
 *                settings lock it, then by id), then the draw on the server
 *                (N26): `crypto.randomInt` over 1 000 000 parts, each active row its round(1 000 000 / N) in the table's
 *                order, the floor the rest (N15). A row drawn that cannot give (its quantity reached, its add-on set
 *                aside or no longer a PRODUCT, its model set aside or without a unit to reserve, THE PIECE of a vault
 *                without a LIVE release or a unit in the entry's size) gives I WAS THERE in its place, at the card's
 *                published odds: "a reward that runs out sends its odds to the card (published odds never change)"
 *                (E1, round 2). The outcome is written once (prize, line, odds `1 IN 200`, rare for GUARANTEED, VAULT
 *                EDITION and THE PIECE (N14), value, cost), its row's `given` + 1, delivered where it belongs (E9:
 *                credits in YOUR ACCOUNT, products in YOUR ORDERS) with a FROM ORBES receipt (`VAULT_OPENED:<vault>`),
 *                audited `vault.open` (its kind and rarity, never another row's odds).
 *   delivered    CREDIT a VAULT credit (services/tier-grants.ts) of the row's amount, 30 days; ADDON the vault's offer
 *                for 30 days, one unit at 0 attached to the next order at its creation (services/order-addons.ts
 *                attachVaultAddons), a PRODUCT add-on only (E7: never a service); GUARANTEED a house guarantee of scope
 *                LIVE (services/guarantees.ts grantFromVault); CREDIT TO GIVE a one-time link (`vault_gifts`, 30 days)
 *                whose friend, holding no piece, accepts a VAULT credit for a first piece (`acceptGift`; never
 *                `accounts.invited_by`: the FRIEND source stays the invitation link's alone); I WAS THERE nothing but its
 *                card. A PRODUCT under its RIGHT TO BUY is its 24-hour offer (round 2); a product won FREE, a VAULT
 *                EDITION and THE PIECE are a VAULT order with the winner's unit reserved (step Q3.7, plan §2.4: until it
 *                is built, such a row gives the card, as a row that cannot give).
 *
 * No pity rule, no budget cap, no account-age rule (E10 "Not chosen: pity guarantee, budget cap (the quantities are the
 * limit), account-age rule", D22): none is built.
 */
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import {
  CLUB_TIER_NAMES,
  HOUSE_CURRENCIES,
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
  type VaultRewardKind,
  type VaultRewardMode,
  type VaultSource,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { SYSTEM_ACTOR, systemClock, type Actor, type Clock } from '../types.js';
import { VAULT_REVEAL, vaultArrivedWords, vaultMoney, vaultOpenedWords, vaultSourceLine, VAULT_SOURCE_LABELS, type VaultWhere } from '../../shared/house-words.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';
import { birthdayExpiry } from './birthday-credits.js';
import { CROCKFORD_ALPHABET, formatGrouped, normalizeCrockford } from './claim-codes.js';
import { CLUB_TIER_THRESHOLDS, isTestEntrant, tierName, tierOf } from './club.js';
import { grantFromVault } from './guarantees.js';
import { deliveredBody, deliveredTitle, pieceName } from './house-moments.js';
import { withLiveChanges, type LiveChanges, type LiveFrameGate } from './live-frames.js';
import type { ProfileService } from './profiles.js';
import { parisDay } from './schedule.js';
import { defaultLocationId, stockLevel } from './stock.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 3_600_000;

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
  if (o.source === 'HOUSE' && o.note !== undefined && o.note !== null) {
    if (typeof o.note !== 'string') throw validationError(`A note is 1 to ${VAULT_NOTE_MAX} characters.`);
    const note = o.note.trim();
    if (note.length === 0) return { ...o, note: null };
    if ([...note].length > VAULT_NOTE_MAX) throw validationError(`A note is 1 to ${VAULT_NOTE_MAX} characters.`);
    return { ...o, note };
  }
  return o;
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
  // The account's row first: two occasions of one account at once count each other's vaults. A LIVE vault is given
  // under its release's row (services/live.ts, held FOR NO KEY UPDATE by every LIVE give), which already orders the
  // occasions of its one key, so the account's row is only FOR KEY SHARE there: a stronger lock would wait on the FOR
  // SHARE each LIVE action of that collector takes on its own account before the release's row (deadlock).
  const q = tx.selectFrom('accounts').select('status').where('id', '=', accountId);
  const account = await (o.source === 'LIVE' ? q.forKeyShare() : q.forNoKeyUpdate()).executeTakeFirst();
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
 * `settleEnd` ENDS the line: a vault (`giveVault`, its caps and switches) for every entry of those sizes still in the
 * line, WAITING or QUEUED, a late comer who joined and stayed included; LEFT, RELEASED, REMOVED, MISSED, EXPIRED never.
 * Nothing on a release with its switch off, nor on an after-room (`drops_vault_on`: its guests were given theirs at
 * its parent's sell-out, N20; a piece won there never takes it back, D7), nor for a test entrant (D9) or an account not
 * ACTIVE (left out here already, so a sell-out reads only those it gives to). A release that CLOSES with pieces left
 * sells no size out at its end and gives none (D8). The release's row is held by the caller (FOR NO KEY UPDATE), so the
 * accounts are visited in their ids' order. Returns the audit entries for the caller to record.
 */
export async function giveLiveVaults(tx: Db, d: LiveVaultRelease, sizeIds: readonly string[], now: Date): Promise<AuditRecordInput[]> {
  if (sizeIds.length === 0 || !d.vault_on || d.parent_drop_id !== null) return [];
  const source = await tx.selectFrom('vault_sources').select('enabled').where('source', '=', 'LIVE').executeTakeFirst();
  if (!source?.enabled) return [];
  const dropId = d.id.toLowerCase();
  const key = occasionKey({ source: 'LIVE', accountId: dropId, dropId, entryId: dropId });
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
    .execute();
  const notes: AuditRecordInput[] = [];
  for (const e of entries) notes.push(...(await giveVault(tx, { source: 'LIVE', accountId: e.account_id, dropId, entryId: e.id }, now)).notes);
  return notes;
}

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
  | { ok: true; prize: string; line: string | null; addonId?: string; amountMinor?: number; currency?: string }
  | { ok: false; why: 'QUANTITY' | 'ADDON' | 'MODEL' | 'NO_UNIT' | 'NOT_LIVE' | 'AWAITS_Q3_7' };

/** Words cut to a column's length (`…` last). */
function fit(s: string, max: number): string {
  const chars = [...s.trim().replace(/\s+/g, ' ')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** Whether a model has a unit to reserve for the winner at the house's location: in `size` when named (whatever its case), else in any size offered. */
async function modelHasUnit(tx: Db, modelId: string, size: string | null): Promise<boolean> {
  const location = await defaultLocationId(tx);
  const skus = await tx.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', modelId).where('set_aside_at', 'is', null).orderBy('code').execute();
  for (const k of skus) {
    if (size !== null && (k.size_label ?? '').toUpperCase() !== size.toUpperCase()) continue;
    if ((await stockLevel(tx, k.id, location)).available >= 1) return true;
  }
  return false;
}

/**
 * Whether a row drawn can give, and its words (plan §2.2): its quantity not reached; an add-on (ADDON, a PRODUCT of an
 * add-on) still active and of kind PRODUCT (E7: never a service); a model (a PRODUCT of a model, a VAULT EDITION) still
 * offered, a VAULT EDITION's marked vault-only and a PRODUCT's not, with a unit to reserve when won FREE (N12); THE PIECE
 * only for a LIVE vault (N5), the release's model with a unit in the entry's size outside the release. A product won
 * FREE, a VAULT EDITION and THE PIECE are VAULT orders (step Q3.7): until that step they give the card.
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
      if (row.mode === 'RIGHT_TO_BUY') return { ok: true, prize, line: VAULT_REVEAL.rightToBuy };
      if (!(await modelHasUnit(tx, row.model_id!, null))) return { ok: false, why: 'NO_UNIT' };
      return { ok: false, why: 'AWAITS_Q3_7' };
    }
    case 'VAULT_EDITION': {
      const m = await tx.selectFrom('models').select(['active', 'discontinued_at', 'vault_only']).where('id', '=', row.model_id!).executeTakeFirst();
      if (!m || !m.active || m.discontinued_at !== null || !m.vault_only) return { ok: false, why: 'MODEL' };
      if (!(await modelHasUnit(tx, row.model_id!, null))) return { ok: false, why: 'NO_UNIT' };
      return { ok: false, why: 'AWAITS_Q3_7' };
    }
    case 'THE_PIECE': {
      if (v.source !== 'LIVE' || !v.drop_id || !v.entry_id) return { ok: false, why: 'NOT_LIVE' };
      const r = await tx
        .selectFrom('live_entries as e')
        .innerJoin('drop_sizes as z', 'z.id', 'e.size_id')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .select(['d.model_id', 'z.label'])
        .where('e.id', '=', v.entry_id)
        .executeTakeFirst();
      if (!r?.model_id) return { ok: false, why: 'NOT_LIVE' };
      if (!(await modelHasUnit(tx, r.model_id, r.label))) return { ok: false, why: 'NO_UNIT' };
      return { ok: false, why: 'AWAITS_Q3_7' };
    }
  }
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
}

export class VaultService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly profiles: ProfileService;
  private readonly clock: Clock;
  private readonly random: (max: number) => number;
  private readonly giftKey: Uint8Array;
  private readonly liveFrames: LiveFrameGate | null;

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
  }

  /** `giveVault` in its own transaction, its audit recorded there (the house's gifts, the tests). */
  async give(occasion: VaultOccasion, now: Date = this.clock()): Promise<VaultGiven> {
    return inTransaction(this.db, async (tx) => {
      const given = await giveVault(tx, occasion, now);
      for (const n of given.notes) await this.audit.record(n, tx);
      return given;
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

        // The table, locked as its settings lock it (the floor's row first, then every active row by id), so an opening and
        // a change of CLUB > THE VAULT never wait for each other in a circle; drawn in its own order (N15).
        await lockTable(tx);
        const rows = (await tx
          .selectFrom('vault_rewards')
          .select(['id', 'kind', 'odds_in', 'quantity', 'given', 'amount_minor', 'currency', 'model_id', 'addon_id', 'mode', 'line', 'position', 'created_at'])
          .where('active', '=', true)
          .orderBy('id')
          .forUpdate()
          .execute()) as DrawRow[];
        const ordered = [...rows].sort((x, y) => x.position - y.position || new Date(x.created_at).getTime() - new Date(y.created_at).getTime() || x.id.localeCompare(y.id));
        const floor = ordered.find((r) => r.kind === 'I_WAS_THERE')!;
        const others = ordered.filter((r) => r.kind !== 'I_WAS_THERE');
        const floorOdds = floorOddsIn(Math.max(0, VAULT_DRAW_PARTS - others.reduce((n, r) => n + (r.odds_in ? rewardParts(r.odds_in) : 0), 0)));
        const drawn = drawRow(others, this.random(VAULT_DRAW_PARTS));

        let row = drawn ?? floor;
        let pick = await rewardPick(tx, row, v);
        let fellBack: string | null = null;
        if (!pick.ok) {
          // "A reward that runs out sends its odds to the card (published odds never change)": the card, at its own odds.
          fellBack = pick.why;
          row = floor;
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
            guarantee_id: done.guaranteeId,
            gift_id: done.giftId,
            offer_until: done.offerUntil,
          })
          .where('id', '=', v.id)
          .where('opened_at', 'is', null)
          .execute();
        await tx.updateTable('vault_rewards').set({ given: sql<number>`given + 1` }).where('id', '=', row.id).execute();

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
  ): Promise<{ grantId: string | null; guaranteeId: string | null; giftId: string | null; offerUntil: Date | null; valueMinor: number | null; currency: string | null; costMinor: number | null }> {
    const none = { grantId: null, guaranteeId: null, giftId: null, offerUntil: null, valueMinor: null, currency: null, costMinor: null };
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
        // Under its RIGHT TO BUY, 24 hours at its usual price (round 2); an add-on won FREE, as ADDON.
        return { ...none, offerUntil: row.mode === 'RIGHT_TO_BUY' ? new Date(now.getTime() + VAULT_RIGHT_TO_BUY_MS) : vaultRewardUntil(now) };
      case 'I_WAS_THERE':
        // Nothing but its card (saved as an image, D11).
        return { ...none, costMinor: 0 };
      default:
        // VAULT EDITION and THE PIECE give the card until step Q3.7 (rewardPick).
        throw new Error(`a ${row.kind} is not delivered at the opening yet`);
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
        return { id: r.id, source: r.source, label: VAULT_SOURCE_LABELS[r.source], openedAt, openedDay: parisDay(openedAt), kind, prize, prizeLine: r.prize_line, held: vaultHeld(kind, prize), gift };
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
}

/** A row's figures as the audit keeps them (no staff words beyond a VAULT EDITION's line's length). */
function rewardDetails(r: { odds_in: number | null; quantity: number | null; amount_minor: number | null; currency: string | null; model_id: string | null; addon_id: string | null; mode: string | null; line: string | null }) {
  return { oddsIn: r.odds_in, quantity: r.quantity, amountMinor: r.amount_minor, currency: r.currency, modelId: r.model_id, addonId: r.addon_id, mode: r.mode, lineLength: r.line === null ? null : [...r.line].length };
}
