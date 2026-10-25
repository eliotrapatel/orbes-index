/**
 * THE VAULT — the rules (lot Q3, step Q3.3; plan §2.1, §2.5 states, §2.7; vault/SCOPE.md CURRENT STATE E1 "A
 * platform-wide concept. ONE vault, ONE house table for every source.", E5, E6, E10, ROUND 5, OPEN POINTS OP-26, OP-29).
 * Migrations 0061_the_vault and 0062_vault_rewards hold the tables; this file gives, reads and sets.
 *
 *   giveVault     (tx, occasion, now): a vault for an occasion of one of the seven sources (D3), in the caller's
 *                 transaction, after its own writes. Nothing when the source is switched off (a LIVE release also needs
 *                 its own switch, `drops.vault_on`, D4), the account is not ACTIVE, the account is a test entrant (ROUND 5
 *                 "Test accounts: NEVER get a vault", D9: every source, the house's GIVE A VAULT included; `isTestEntrant`)
 *                 or the cap of the source's scope is reached. The account's row is taken FOR NO KEY UPDATE first, so two
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
 * No pity rule, no budget cap, no account-age rule (E10 "Not chosen: pity guarantee, budget cap (the quantities are the
 * limit), account-age rule", D22): none is built. The draw at the opening and the rewards' delivery are step Q3.4.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import {
  CLUB_TIER_NAMES,
  HOUSE_CURRENCIES,
  VAULT_AMOUNT_MINOR_MAX,
  VAULT_CAP,
  VAULT_ODDS_IN_MAX,
  VAULT_OCCASION_INDEX_MAX,
  VAULT_PER_OCCASION,
  VAULT_REWARD_KINDS,
  VAULT_REWARD_LINE_MAX,
  VAULT_REWARD_MODES,
  VAULT_REWARD_POSITION_MAX,
  VAULT_NOTE_MAX,
  VAULT_SOURCES,
  VAULT_WAIT_DAYS,
  type ClubTierName,
  type VaultRewardKind,
  type VaultRewardMode,
  type VaultSource,
} from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { SYSTEM_ACTOR, systemClock, type Actor, type Clock } from '../types.js';
import { vaultArrivedWords, vaultSourceLine, VAULT_SOURCE_LABELS } from '../../shared/house-words.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { CLUB_TIER_THRESHOLDS, isTestEntrant, tierName, tierOf } from './club.js';
import { deliveredBody, deliveredTitle, pieceName } from './house-moments.js';
import type { ProfileService } from './profiles.js';
import { parisDay } from './schedule.js';

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
  // The account's row first: two occasions of one account at once count each other's vaults.
  const account = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forNoKeyUpdate().executeTakeFirst();
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

// ── The service ────────────────────────────────────────────────────────────

export interface VaultServiceDeps {
  db: Db;
  audit: AuditService;
  /** YOUR PROFILE's completion, for the ledger's row (N21). */
  profiles: ProfileService;
  clock?: Clock;
}

export class VaultService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly profiles: ProfileService;
  private readonly clock: Clock;

  constructor(deps: VaultServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.profiles = deps.profiles;
    this.clock = deps.clock ?? systemClock;
  }

  /** `giveVault` in its own transaction, its audit recorded there (the house's gifts, the tests). */
  async give(occasion: VaultOccasion, now: Date = this.clock()): Promise<VaultGiven> {
    return inTransaction(this.db, async (tx) => {
      const given = await giveVault(tx, occasion, now);
      for (const n of given.notes) await this.audit.record(n, tx);
      return given;
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
        return { id: r.id, source: r.source, label: VAULT_SOURCE_LABELS[r.source], openedAt, openedDay: parisDay(openedAt), kind, prize, prizeLine: r.prize_line, held: vaultHeld(kind, prize) };
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
