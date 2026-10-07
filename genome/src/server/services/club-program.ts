/**
 * The club's program (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T2; migration 0026): every figure of the tiers' benefits
 * the owner called configurable, set in the console's Club → Tiers, THE PROGRAM (ADMIN), and the optional shipping
 * rates of Orders → Settings, SHIPPING (ADMIN). The thresholds (1, 5 and 10 pieces held) stay a constant of the code
 * (services/club.ts CLUB_TIER_THRESHOLDS), never a setting.
 *
 *   THE PROGRAM   one row of `club_program_settings`, or none: the defaults are its columns' (DEFAULT_PROGRAM). A new
 *                 draw's early access by default (PALLADIUM 4 hours, PLATINE 2, PALLADIUM's window at least PLATINE's),
 *                 the free shipping of PLATINE (standard) and PALLADIUM (express), the yearly care (PLATINE 1 piece,
 *                 PALLADIUM every piece), the Messages board's priority (from PLATINE), the welcome gift of each tier
 *                 (a model of the catalogue, none by default), the credit (€ 50 and € 100, in one currency, valid 12
 *                 months, on a draw, a LIVE RELEASE or the private salon), and the tier each experience of the circle
 *                 invites from (the members' evening PLATINE, the launch previews and the partner experiences
 *                 PALLADIUM). Changed whole (`update`), each value within its bounds (PROGRAM_LIMITS), a gift's model
 *                 existing (404 MODEL_NOT_FOUND) and active (409 MODEL_INACTIVE). Audited `club.program.update`, before
 *                 and after.
 *   the lines     what each tier's program says, in English, as /verify shows it in YOUR TIER and THE CLUB and the
 *                 console's tiers list it (`programLines`): early access, shipping, care, priority, gift, credit, the
 *                 experiences, each only while its setting gives it.
 *   SHIPPING      `shipping_rates`: what an order's delivery costs below the free shipping of the tiers, per currency
 *                 and service, optional (none preset: an order then carries no shipping, as before). Set whole
 *                 (`setShippingRates`), audited `order.shipping_rates.update`, before and after.
 *
 * Nothing personal is stored here. The tier of each benefit is read when the benefit is used (services/drops.ts,
 * orders.ts, tier-grants.ts), never kept from an earlier reading.
 */
import { inTransaction, type Db } from '../db/connection.js';
import {
  CREDIT_CHANNELS,
  HOUSE_CURRENCIES,
  SHIPPING_FREE_LEVELS,
  SHIPPING_SERVICES,
  type CircleExperience,
  type ClubTierName,
  type CreditChannel,
  type HouseCurrency,
  type JsonObject,
  type ShippingFreeLevel,
  type ShippingService,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { liveMoney } from './live-console.js';
import { mediaUrl } from './media.js';
import { stockBalances } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** Each value's bounds, as the CHECKs of migration 0026 hold them. */
export const PROGRAM_LIMITS = Object.freeze({
  /** An early access, in hours before entries open to everyone (0: none), as a draw's (drops.ts EARLY_ACCESS_HOURS). */
  hours: Object.freeze({ min: 0, max: 336 }),
  /** Pieces cared for a year (0: none). */
  care: Object.freeze({ min: 0, max: 20 }),
  /** A credit, in minor units (0: none): an order's amounts (orders.ts ORDER_AMOUNT_MAX_MINOR). */
  credit: Object.freeze({ min: 0, max: 100_000_000 }),
  /** A credit's validity, in months. */
  validity: Object.freeze({ min: 1, max: 60 }),
  /** A shipping fee, in minor units. */
  fee: Object.freeze({ min: 0, max: 100_000_000 }),
});

/** The tiers the Messages board's priority may start from: 0 (off), 2 PLATINE, 3 PALLADIUM. */
export const PRIORITY_TIERS = Object.freeze([0, 2, 3] as const);
export type PriorityTier = (typeof PRIORITY_TIERS)[number];

/** THE PROGRAM, as the console sets it and the services read it. */
export interface ClubProgram {
  /** A new draw's early access by default, PALLADIUM's and PLATINE's (≤ PALLADIUM's), in hours; 0: none. */
  earlyAccessPalladiumHours: number;
  earlyAccessPlatineHours: number;
  shippingFreePlatine: ShippingFreeLevel;
  shippingFreePalladium: ShippingFreeLevel;
  /** Pieces cared for a year: 0 none; PALLADIUM's null is every piece. */
  carePiecesPlatine: number;
  carePiecesPalladium: number | null;
  /** The Messages board puts first, and marks, the conversations from this tier: 0 off. */
  messagesPriorityMinTier: PriorityTier;
  /** The welcome gift of each tier: a model of the catalogue, or none. */
  giftPlatineModelId: string | null;
  giftPalladiumModelId: string | null;
  /** The credit of each tier, in minor units of `creditCurrency` (0: none). */
  creditPlatineMinor: number;
  creditPalladiumMinor: number;
  creditCurrency: HouseCurrency;
  creditValidityMonths: number;
  /** The channels of the orders it is taken off, in CREDIT_CHANNELS' order. */
  creditChannels: CreditChannel[];
  /** The lowest tier (1 to 3) invited to each experience of the circle. */
  experienceMembersEveningMinTier: 1 | 2 | 3;
  experienceLaunchPreviewMinTier: 1 | 2 | 3;
  experiencePartnerMinTier: 1 | 2 | 3;
}

/** THE PROGRAM by default: the columns' defaults of migration 0026. */
export const DEFAULT_PROGRAM: Readonly<ClubProgram> = Object.freeze({
  earlyAccessPalladiumHours: 4,
  earlyAccessPlatineHours: 2,
  shippingFreePlatine: 'STANDARD',
  shippingFreePalladium: 'EXPRESS',
  carePiecesPlatine: 1,
  carePiecesPalladium: null,
  messagesPriorityMinTier: 2,
  giftPlatineModelId: null,
  giftPalladiumModelId: null,
  creditPlatineMinor: 5000,
  creditPalladiumMinor: 10000,
  creditCurrency: 'EUR',
  creditValidityMonths: 12,
  creditChannels: Object.freeze(['DRAW', 'LIVE', 'SALON']) as unknown as CreditChannel[],
  experienceMembersEveningMinTier: 2,
  experienceLaunchPreviewMinTier: 3,
  experiencePartnerMinTier: 3,
} satisfies ClubProgram);

/** The tier each experience invites from (circle_posts.experience). */
export function experienceTier(p: Pick<ClubProgram, 'experienceMembersEveningMinTier' | 'experienceLaunchPreviewMinTier' | 'experiencePartnerMinTier'>, e: CircleExperience): 1 | 2 | 3 {
  return e === 'MEMBERS_EVENING' ? p.experienceMembersEveningMinTier : e === 'LAUNCH_PREVIEW' ? p.experienceLaunchPreviewMinTier : p.experiencePartnerMinTier;
}

/** A model offered as a welcome gift, as THE PROGRAM's selects and the tiers' lines name it. */
export interface GiftModel {
  id: string;
  /** In capitals, its variant after it: `MONOLITHE IN STEEL`. */
  name: string;
  active: boolean;
  discontinued: boolean;
  /** Its sizes (SKUs) known, and the pieces of them available now, every location together. */
  sizes: number;
  available: number;
  imageUrl: string | null;
}

/** THE PROGRAM as the console reads it (GET /api/admin/club/program). */
export interface ClubProgramSheet extends ClubProgram {
  /** The gift model of each tier as it stands now; null without one. */
  gifts: { platine: GiftModel | null; palladium: GiftModel | null };
  /** The active models a gift may be: THE PROGRAM's selects. */
  giftOptions: GiftModel[];
  /** What each tier's program says now (programLines), as /verify shows it. */
  lines: Record<ClubTierName, string[]>;
  updatedAt: Date | null;
  updatedBy: { id: string; email: string } | null;
}

/** One rate of SHIPPING (Orders → Settings). */
export interface ShippingRate {
  currency: HouseCurrency;
  service: ShippingService;
  feeMinor: number;
}

/** SHIPPING as the console reads it (GET /api/admin/orders/shipping-rates): the rates set, currency then service. */
export interface ShippingRatesSheet {
  items: (ShippingRate & { updatedAt: Date; updatedBy: { id: string; email: string } | null })[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const earlyAccessOrder = () => new DomainError('PROGRAM_EARLY_ACCESS', 422, 'PALLADIUM’s early access starts no later than PLATINE’s.');
const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');
const modelInactive = () => conflict('MODEL_INACTIVE', 'This model is no longer offered: choose an active model for the welcome gift.');

// ── Reading ────────────────────────────────────────────────────────────────

/** THE PROGRAM now: its row, or DEFAULT_PROGRAM. */
export async function readProgram(db: Db): Promise<ClubProgram> {
  const r = await db.selectFrom('club_program_settings').selectAll().where('id', '=', 1).executeTakeFirst();
  if (!r) return { ...DEFAULT_PROGRAM, creditChannels: [...DEFAULT_PROGRAM.creditChannels] };
  return {
    earlyAccessPalladiumHours: r.early_access_palladium_hours,
    earlyAccessPlatineHours: r.early_access_platine_hours,
    shippingFreePlatine: r.shipping_free_platine,
    shippingFreePalladium: r.shipping_free_palladium,
    carePiecesPlatine: r.care_pieces_platine,
    carePiecesPalladium: r.care_pieces_palladium,
    messagesPriorityMinTier: r.messages_priority_min_tier as PriorityTier,
    giftPlatineModelId: r.gift_platine_model_id,
    giftPalladiumModelId: r.gift_palladium_model_id,
    creditPlatineMinor: r.credit_platine_minor,
    creditPalladiumMinor: r.credit_palladium_minor,
    creditCurrency: r.credit_currency,
    creditValidityMonths: r.credit_validity_months,
    creditChannels: CREDIT_CHANNELS.filter((c) => r.credit_channels.includes(c)),
    experienceMembersEveningMinTier: r.experience_members_evening_min_tier as 1 | 2 | 3,
    experienceLaunchPreviewMinTier: r.experience_launch_preview_min_tier as 1 | 2 | 3,
    experiencePartnerMinTier: r.experience_partner_min_tier as 1 | 2 | 3,
  };
}

/** The gift model of a tier (2 PLATINE, 3 PALLADIUM) in THE PROGRAM, or null. */
export function giftModelOf(p: Pick<ClubProgram, 'giftPlatineModelId' | 'giftPalladiumModelId'>, tier: 2 | 3): string | null {
  return tier === 3 ? p.giftPalladiumModelId : p.giftPlatineModelId;
}

/** The credit of a tier (2 PLATINE, 3 PALLADIUM) in minor units of THE PROGRAM's currency. */
export function creditOf(p: Pick<ClubProgram, 'creditPlatineMinor' | 'creditPalladiumMinor'>, tier: 2 | 3): number {
  return tier === 3 ? p.creditPalladiumMinor : p.creditPlatineMinor;
}

/** The models named, as THE PROGRAM shows them: their name, whether a gift may be one now, their sizes and availability. */
export async function giftModels(db: Db, ids: readonly (string | null)[]): Promise<Map<string, GiftModel>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))];
  const out = new Map<string, GiftModel>();
  if (wanted.length === 0) return out;
  const rows = await db
    .selectFrom('models')
    .select(['id', 'name', 'variant_label', 'active', 'discontinued_at', 'image_sha256'])
    .where('id', 'in', wanted)
    .execute();
  for (const r of rows) {
    const balances = await stockBalances(db, { modelId: r.id });
    const skus = await db.selectFrom('skus').select('id').where('model_id', '=', r.id).execute();
    out.set(r.id, {
      id: r.id,
      name: giftName(r.name, r.variant_label),
      active: r.active && r.discontinued_at === null,
      discontinued: r.discontinued_at !== null,
      sizes: skus.length,
      available: balances.reduce((n, b) => n + Math.max(0, b.available), 0),
      imageUrl: mediaUrl(r.image_sha256),
    });
  }
  return out;
}

/** A gift's name as the program says it: in capitals, its variant after it (`MONOLITHE IN STEEL`). */
export function giftName(name: string, variantLabel: string | null): string {
  return `${name.trim().toUpperCase()}${variantLabel ? ` IN ${variantLabel.trim().toUpperCase()}` : ''}`;
}

// ── The lines ──────────────────────────────────────────────────────────────

const CHANNEL_WORDS: Readonly<Record<CreditChannel, string>> = Object.freeze({ DRAW: 'a draw', LIVE: 'a LIVE RELEASE', SALON: 'THE PRIVATE SALON' });

/** `a, b or c`. */
function orList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * What a tier's program says (§3.2 T2, « The program lines »), in this order: its early access, its free shipping, its
 * yearly care, the priority with Client Services (on the tier it starts from), its welcome gift (while its model is
 * active: `gifts` names the active ones by tier), its credit, then the experiences of the circle (each on the tier it
 * invites from). A setting that gives nothing gives no line. TITANE (1) has no early access, shipping, care, gift nor
 * credit.
 */
export function programLines(p: ClubProgram, tier: 1 | 2 | 3, gifts: Partial<Record<2 | 3, string | null>> = {}): string[] {
  const lines: string[] = [];
  if (tier >= 2) {
    const t = tier as 2 | 3;
    const hours = t === 3 ? p.earlyAccessPalladiumHours : p.earlyAccessPlatineHours;
    if (hours > 0) lines.push(`Early access to each draw: a place reserved directly ${hours} ${hours === 1 ? 'hour' : 'hours'} before entries open to everyone, unless its page says otherwise.`);
    const shipping = t === 3 ? p.shippingFreePalladium : p.shippingFreePlatine;
    if (shipping === 'STANDARD') lines.push('Free shipping on every order.');
    if (shipping === 'EXPRESS') lines.push('Free express shipping on every order.');
    const care = t === 3 ? p.carePiecesPalladium : p.carePiecesPlatine;
    if (care === null) lines.push('The yearly care of every piece by the ORBES atelier, once a year each, asked for from the piece, with a prepaid label both ways.');
    else if (care > 0) lines.push(`The yearly care of ${care === 1 ? '1 piece' : `${care} pieces`} a year by the ORBES atelier, asked for from the piece, with a prepaid label both ways.`);
  }
  if (p.messagesPriorityMinTier !== 0 && p.messagesPriorityMinTier === tier) lines.push('Priority with ORBES Client Services: your messages are read first.');
  if (tier >= 2) {
    const t = tier as 2 | 3;
    const gift = gifts[t];
    if (gift) lines.push(`A welcome gift, ${gift}, added to your next order.`);
    const credit = creditOf(p, t);
    if (credit > 0 && p.creditChannels.length > 0) {
      const months = p.creditValidityMonths;
      lines.push(`A credit of ${liveMoney(credit, p.creditCurrency)}, valid ${months} ${months === 1 ? 'month' : 'months'}, on a piece from ${orList(p.creditChannels.map((c) => CHANNEL_WORDS[c]))}.`);
    }
  }
  if (p.experienceMembersEveningMinTier === tier) lines.push('The members’ evening, once a year, by invitation in THE CIRCLE.');
  const launch = p.experienceLaunchPreviewMinTier === tier;
  const partner = p.experiencePartnerMinTier === tier;
  if (launch && partner) lines.push('Launch previews and partner experiences, by invitation in THE CIRCLE.');
  else if (launch) lines.push('Launch previews, by invitation in THE CIRCLE.');
  else if (partner) lines.push('Partner experiences, by invitation in THE CIRCLE.');
  return lines;
}

/** The program lines of every tier, the gifts named while their model is active. */
export async function tierProgramLines(db: Db, p: ClubProgram): Promise<Record<ClubTierName, string[]>> {
  const models = await giftModels(db, [p.giftPlatineModelId, p.giftPalladiumModelId]);
  const active = (id: string | null) => {
    const m = id ? models.get(id) : undefined;
    return m && m.active ? m.name : null;
  };
  const gifts = { 2: active(p.giftPlatineModelId), 3: active(p.giftPalladiumModelId) };
  return { TITANE: programLines(p, 1, gifts), PLATINE: programLines(p, 2, gifts), PALLADIUM: programLines(p, 3, gifts) };
}

// ── Checks ─────────────────────────────────────────────────────────────────

function whole(v: unknown, { min, max }: { min: number; max: number }, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw validationError(`${label} is ${min} to ${max}.`);
  return v;
}

function oneOf<T extends string | number>(v: unknown, values: readonly T[], label: string): T {
  if (!(values as readonly unknown[]).includes(v)) throw validationError(`${label} is one of ${values.join(', ')}.`);
  return v as T;
}

/** THE PROGRAM as sent, checked value by value (its bounds, PALLADIUM's early access at least PLATINE's); the gift models are checked in the transaction. */
export function checkProgram(input: unknown): ClubProgram {
  if (!input || typeof input !== 'object') throw validationError('Send the whole program.');
  const v = input as Record<string, unknown>;
  const tier = (x: unknown, label: string) => oneOf(x, [1, 2, 3] as const, label);
  const model = (x: unknown) => {
    if (x === null || x === undefined || x === '') return null;
    if (typeof x !== 'string' || !UUID_RE.test(x)) throw modelNotFound();
    return x.toLowerCase();
  };
  const channels = v.creditChannels;
  if (!Array.isArray(channels) || channels.length === 0 || channels.some((c) => !(CREDIT_CHANNELS as readonly unknown[]).includes(c))) {
    throw validationError(`The credit is taken off at least one of ${CREDIT_CHANNELS.join(', ')}.`);
  }
  const p: ClubProgram = {
    earlyAccessPalladiumHours: whole(v.earlyAccessPalladiumHours, PROGRAM_LIMITS.hours, 'PALLADIUM’s early access, in hours,'),
    earlyAccessPlatineHours: whole(v.earlyAccessPlatineHours, PROGRAM_LIMITS.hours, 'PLATINE’s early access, in hours,'),
    shippingFreePlatine: oneOf(v.shippingFreePlatine, SHIPPING_FREE_LEVELS, 'PLATINE’s free shipping'),
    shippingFreePalladium: oneOf(v.shippingFreePalladium, SHIPPING_FREE_LEVELS, 'PALLADIUM’s free shipping'),
    carePiecesPlatine: whole(v.carePiecesPlatine, PROGRAM_LIMITS.care, 'PLATINE’s yearly care, in pieces,'),
    carePiecesPalladium: v.carePiecesPalladium === null ? null : whole(v.carePiecesPalladium, PROGRAM_LIMITS.care, 'PALLADIUM’s yearly care, in pieces,'),
    messagesPriorityMinTier: oneOf(v.messagesPriorityMinTier, PRIORITY_TIERS, 'The Messages priority'),
    giftPlatineModelId: model(v.giftPlatineModelId),
    giftPalladiumModelId: model(v.giftPalladiumModelId),
    creditPlatineMinor: whole(v.creditPlatineMinor, PROGRAM_LIMITS.credit, 'PLATINE’s credit, in minor units,'),
    creditPalladiumMinor: whole(v.creditPalladiumMinor, PROGRAM_LIMITS.credit, 'PALLADIUM’s credit, in minor units,'),
    creditCurrency: oneOf(v.creditCurrency, HOUSE_CURRENCIES, 'The credit’s currency'),
    creditValidityMonths: whole(v.creditValidityMonths, PROGRAM_LIMITS.validity, 'The credit’s validity, in months,'),
    creditChannels: CREDIT_CHANNELS.filter((c) => (channels as unknown[]).includes(c)),
    experienceMembersEveningMinTier: tier(v.experienceMembersEveningMinTier, 'The members’ evening tier'),
    experienceLaunchPreviewMinTier: tier(v.experienceLaunchPreviewMinTier, 'The launch previews tier'),
    experiencePartnerMinTier: tier(v.experiencePartnerMinTier, 'The partner experiences tier'),
  };
  if (p.earlyAccessPalladiumHours < p.earlyAccessPlatineHours) throw earlyAccessOrder();
  return p;
}

/** The program as the audit log keeps it (ids and figures only). */
function programDetails(p: ClubProgram): JsonObject {
  return { ...p, creditChannels: [...p.creditChannels] };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface ClubProgramServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class ClubProgramService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: ClubProgramServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** THE PROGRAM now: its row, or DEFAULT_PROGRAM. */
  read(db: Db = this.db): Promise<ClubProgram> {
    return readProgram(db);
  }

  /** THE PROGRAM as the console reads it: the figures, the gift models and the options, each tier's lines, who set it. */
  async sheet(): Promise<ClubProgramSheet> {
    const p = await readProgram(this.db);
    const meta = await this.db
      .selectFrom('club_program_settings as s')
      .leftJoin('admin_users as u', 'u.id', 's.updated_by')
      .select(['s.updated_at', 's.updated_by', 'u.email'])
      .where('s.id', '=', 1)
      .executeTakeFirst();
    const optionIds = (
      await this.db.selectFrom('models').select('id').where('active', '=', true).where('discontinued_at', 'is', null).orderBy('name').orderBy('variant_label').execute()
    ).map((r) => r.id);
    const models = await giftModels(this.db, [...optionIds, p.giftPlatineModelId, p.giftPalladiumModelId]);
    return {
      ...p,
      gifts: {
        platine: p.giftPlatineModelId ? models.get(p.giftPlatineModelId) ?? null : null,
        palladium: p.giftPalladiumModelId ? models.get(p.giftPalladiumModelId) ?? null : null,
      },
      giftOptions: optionIds.map((id) => models.get(id)!).filter((m) => m !== undefined),
      lines: await tierProgramLines(this.db, p),
      updatedAt: meta ? meta.updated_at : null,
      updatedBy: meta?.updated_by && meta.email ? { id: meta.updated_by, email: meta.email } : null,
    };
  }

  /**
   * THE PROGRAM changed whole (PUT /api/admin/club/program, ADMIN): each value within its bounds, PALLADIUM's early
   * access at least PLATINE's (422 PROGRAM_EARLY_ACCESS), a gift's model existing (404 MODEL_NOT_FOUND) and active (409
   * MODEL_INACTIVE; a model already chosen and discontinued since may stay: no gift is added until another is chosen).
   * Audited `club.program.update`, before and after.
   */
  async update(input: unknown, actor: Actor): Promise<ClubProgramSheet> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only an ORBES admin changes the program.');
    const next = checkProgram(input);
    await inTransaction(this.db, async (tx) => {
      const before = await readProgram(tx);
      for (const [id, was] of [
        [next.giftPlatineModelId, before.giftPlatineModelId],
        [next.giftPalladiumModelId, before.giftPalladiumModelId],
      ] as const) {
        if (id === null) continue;
        const m = await tx.selectFrom('models').select(['id', 'active', 'discontinued_at']).where('id', '=', id).executeTakeFirst();
        if (!m) throw modelNotFound();
        if ((!m.active || m.discontinued_at !== null) && id !== was) throw modelInactive();
      }
      const now = this.clock();
      const values = {
        early_access_palladium_hours: next.earlyAccessPalladiumHours,
        early_access_platine_hours: next.earlyAccessPlatineHours,
        shipping_free_platine: next.shippingFreePlatine,
        shipping_free_palladium: next.shippingFreePalladium,
        care_pieces_platine: next.carePiecesPlatine,
        care_pieces_palladium: next.carePiecesPalladium,
        messages_priority_min_tier: next.messagesPriorityMinTier,
        gift_platine_model_id: next.giftPlatineModelId,
        gift_palladium_model_id: next.giftPalladiumModelId,
        credit_platine_minor: next.creditPlatineMinor,
        credit_palladium_minor: next.creditPalladiumMinor,
        credit_currency: next.creditCurrency,
        credit_validity_months: next.creditValidityMonths,
        credit_channels: next.creditChannels,
        experience_members_evening_min_tier: next.experienceMembersEveningMinTier,
        experience_launch_preview_min_tier: next.experienceLaunchPreviewMinTier,
        experience_partner_min_tier: next.experiencePartnerMinTier,
        updated_by: actor.id!,
        updated_at: now,
      };
      await tx
        .insertInto('club_program_settings')
        .values({ id: 1, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet(values))
        .execute();
      await this.audit.record({ actor, action: 'club.program.update', targetType: 'club_program_settings', targetId: null, details: { before: programDetails(before), after: programDetails(next) } }, tx);
    });
    return this.sheet();
  }

  // ── SHIPPING (Orders → Settings) ─────────────────────────────────────────

  /** The shipping rates set, currency then service (GET /api/admin/orders/shipping-rates). */
  async shippingRates(): Promise<ShippingRatesSheet> {
    const rows = await this.db
      .selectFrom('shipping_rates as r')
      .leftJoin('admin_users as u', 'u.id', 'r.updated_by')
      .select(['r.currency', 'r.service', 'r.fee_minor', 'r.updated_at', 'r.updated_by', 'u.email'])
      .execute();
    const order = (r: { currency: string; service: string }) => HOUSE_CURRENCIES.indexOf(r.currency as HouseCurrency) * 2 + SHIPPING_SERVICES.indexOf(r.service as ShippingService);
    return {
      items: rows
        .sort((a, b) => order(a) - order(b))
        .map((r) => ({
          currency: r.currency,
          service: r.service,
          feeMinor: r.fee_minor,
          updatedAt: r.updated_at,
          updatedBy: r.updated_by && r.email ? { id: r.updated_by, email: r.email } : null,
        })),
    };
  }

  /**
   * SHIPPING set whole (PUT /api/admin/orders/shipping-rates, ADMIN): the rates given, each currency and service once,
   * each fee within its bounds; every rate not given is cleared ('—': an order in that currency carries no shipping
   * unless Client Services enters a fee). Audited `order.shipping_rates.update`, before and after.
   */
  async setShippingRates(input: unknown, actor: Actor): Promise<ShippingRatesSheet> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only an ORBES admin sets the shipping rates.');
    if (!Array.isArray(input)) throw validationError('Send the shipping rates.');
    const rates: ShippingRate[] = [];
    for (const x of input as unknown[]) {
      const r = (x ?? {}) as Record<string, unknown>;
      const rate: ShippingRate = {
        currency: oneOf(r.currency, HOUSE_CURRENCIES, 'A rate’s currency'),
        service: oneOf(r.service, SHIPPING_SERVICES, 'A rate’s service'),
        feeMinor: whole(r.feeMinor, PROGRAM_LIMITS.fee, 'A fee, in minor units,'),
      };
      if (rates.some((o) => o.currency === rate.currency && o.service === rate.service)) throw validationError('Each currency and service has one rate.');
      rates.push(rate);
    }
    await inTransaction(this.db, async (tx) => {
      const before = await tx.selectFrom('shipping_rates').select(['currency', 'service', 'fee_minor']).forUpdate().execute();
      const now = this.clock();
      await tx.deleteFrom('shipping_rates').execute();
      if (rates.length) {
        await tx
          .insertInto('shipping_rates')
          .values(rates.map((r) => ({ currency: r.currency, service: r.service, fee_minor: r.feeMinor, updated_by: actor.id!, updated_at: now })))
          .execute();
      }
      const key = (r: { currency: string; service: string }) => `${r.currency} ${r.service}`;
      await this.audit.record(
        {
          actor,
          action: 'order.shipping_rates.update',
          targetType: 'shipping_rates',
          targetId: null,
          details: {
            before: Object.fromEntries(before.map((r) => [key(r), r.fee_minor])),
            after: Object.fromEntries(rates.map((r) => [key(r), r.feeMinor])),
          },
        },
        tx,
      );
    });
    return this.shippingRates();
  }
}

/** The rate set for a currency and service, or null (none: the order carries no shipping unless Client Services enters a fee). */
export async function shippingRate(db: Db, currency: string | null, service: ShippingService): Promise<number | null> {
  if (currency === null) return null;
  const r = await db.selectFrom('shipping_rates').select('fee_minor').where('currency', '=', currency as HouseCurrency).where('service', '=', service).executeTakeFirst();
  return r ? r.fee_minor : null;
}

