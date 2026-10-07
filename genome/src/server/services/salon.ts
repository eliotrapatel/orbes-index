/**
 * THE PRIVATE SALON (P-X08; API §10.9, §16.22; DATABASE §5.37): the
 * lookbook's RESERVED models, offered to the owners of a piece by tier, each
 * with its price, on request. No route of its own: it is the reserved section
 * of the lookbook (the plan's choice 14), read through the club.
 *
 *   cards    GET  /api/v1/club/lookbook (an owner): the RESERVED models whose
 *            tier (`private_min_tier`, 1 TITANE by default) the account
 *            reaches now, each with its price and tier; no story. When its
 *            tier reaches none, `opensAt`: the lowest tier above it from
 *            which one is shown, and the pieces it starts from (plan
 *            NOCTURNE, screen 5: locked below its tier, with what opens it),
 *            never the model.
 *   sheet    GET  /api/v1/club/lookbook/:slug (an owner): a sheet, PUBLIC or
 *            RESERVED; a RESERVED one carries its price, its tier and the
 *            account's open request (`salon.request`). Below the model's tier
 *            it is the same 404 LOOKBOOK_NOT_FOUND as a model not shown.
 *   request  POST /api/v1/club/lookbook/:slug/request (an owner who reaches
 *            the model's tier): REQUEST THIS PIECE, with an optional note
 *            (≤ 500 characters, the account's words) and, for a model of two
 *            sizes or more, the size asked (plan NEXT-NINE, AC-01: one of the
 *            model's, 400 otherwise; null: NOT SURE YET). One OPEN request per
 *            account and model (409 SHOP_REQUEST_OPEN); audited `shop.request`
 *            with the model and whether a size was given (`sized`), never the
 *            note nor the size. A RESERVED sheet carries the model's sizes and
 *            the one YOUR SIZES suggests (`suggestedSize`), which the collector
 *            confirms by its own press. ORBES Client Services then
 *            contacts the account: no email is sent, no payment taken.
 *   list     GET  /api/admin/club/requests (AUDITOR): the console's Requests
 *            tab, OPEN first, then the newest; emails masked for an AUDITOR by
 *            the routes (serialize.ts `clientEmail`).
 *   close    POST /api/admin/club/requests/:id/close (OPERATOR): CLOSED with a
 *            note (what was done) and its outcome: ACCEPTED, the sale
 *            concluded, creates its order in the same transaction (services/
 *            orders.ts orderForShopRequest, plan LIVE RELEASE+), or DECLINED.
 *            Audited `shop.request.close` with the outcome (never the note: it
 *            may name the client).
 *
 * The lock of an account closes its open requests in the lock's transaction
 * (OwnerService.lock: closeAccountShopRequests, DECLINED, then
 * auditClosedShopRequests after the audit chain's lock), and the right of
 * access exports every one (accountShopRequests). The tier is read again at
 * each request (services/club.ts tierOf): the access goes with the pieces.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { SHOP_REQUEST_OUTCOMES, SHOP_REQUEST_STATUSES, type ShopRequestOutcome, type ShopRequestStatus } from '../db/schema.js';
import { DomainError, conflict, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';
import { CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS, ownersOnly, type ClubService, type ClubTierName } from './club.js';
import type { LookbookService, LookbookSheet, SalonCard, SalonFacts } from './lookbook.js';
import { orderForShopRequest } from './orders.js';
import { matchSavedSize, modelSizeCandidates, savedMm, sizeKindOf } from './sizes.js';

/** The account's note on a request (shop_requests.note): at most this many characters once trimmed. */
export const SHOP_NOTE_MAX = 500;
/** The console's note when it closes a request (shop_requests.resolution_note). */
export const SHOP_RESOLUTION_MAX = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A PUBLIC model is in THE COLLECTION, not in the salon: it is not requested. */
export const notInSalon = () => new DomainError('NOT_IN_SALON', 404, 'This model is not offered in the private salon.');
export const shopRequestOpen = () => conflict('SHOP_REQUEST_OPEN', 'You have already requested this piece: ORBES Client Services will contact you.');
const shopRequestNotFound = () => notFound('Request', 'SHOP_REQUEST_NOT_FOUND');

/** Plain text, line breaks as \n, trimmed; '' and null are null. */
function cleanText(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') return null;
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

/** The account's note on a request: at most SHOP_NOTE_MAX characters; null without one. */
export function normalizeShopNote(v: unknown): string | null {
  return cleanText(v, SHOP_NOTE_MAX, 'The note');
}

/** An account's request as its own sheet reads it (and the answer to REQUEST THIS PIECE). */
export interface ShopRequestView {
  id: string;
  status: ShopRequestStatus;
  createdAt: Date;
  /** AC-01: the size asked (REQUESTED · SIZE 52); null: not sure yet, or a model of one size. */
  size: string | null;
  /** The model requested: what WRITE TO ORBES CLIENT SERVICES attaches on its sheet (plan NEXT-NINE, CS-01, MODEL). */
  modelId: string;
}

/**
 * THE PRIVATE SALON locked below the account's tier (plan NOCTURNE, screen 5): the lowest tier above it from which a model
 * is shown, and the pieces held it starts from (CLUB_TIER_THRESHOLDS). Never a model (terms, article 12).
 */
export interface SalonOpening {
  level: 2 | 3;
  name: ClubTierName;
  pieces: number;
}

/** GET /api/v1/club/lookbook: the models the account's tier reaches; when it reaches none, what opens the salon (else null). */
export interface SalonGrid {
  models: SalonCard[];
  opensAt: SalonOpening | null;
}

/**
 * What the salon adds to a RESERVED model of a sheet: its price, its tier and the account's open request; and (AC-01) its
 * sizes, from its SKUs (the picker shows from two), with the one the account's saved size suggests, or null.
 */
export type SalonRequestFacts = SalonFacts & { request: ShopRequestView | null; sizes: string[]; suggestedSize: string | null };

/**
 * A RESERVED sheet as the salon gives it to an owner: its price, its tier and the account's open request; and the same
 * on each RESERVED dot of its group (plan NOCTURNE, N1: the sheet switches the price and the request with the dot).
 */
export type SalonSheet = Omit<LookbookSheet, 'salon' | 'variants'> & {
  salon?: SalonRequestFacts;
  variants: (Omit<LookbookSheet['variants'][number], 'salon'> & { salon?: SalonRequestFacts })[];
};

/** One request as the console's Requests tab reads it (GET /api/admin/club/requests). */
export interface AdminShopRequest {
  id: string;
  status: ShopRequestStatus;
  createdAt: Date;
  /** The account's words; null without a note. */
  note: string | null;
  /** AC-01: the size asked; null: not given (not sure yet, or one size). */
  size: string | null;
  account: { id: string; email: string };
  model: { id: string; name: string; type: string; slug: string | null; priceLabel: string | null };
  /** Who closed it; null while open, or closed by a script. */
  handledBy: { id: string; email: string } | null;
  handledAt: Date | null;
  /** What was done (the console's note); null while open, or closed with a lock. */
  resolutionNote: string | null;
  /** ACCEPTED (its order created) or DECLINED once closed; null while open, or closed before the orders (migration 0022). */
  outcome: ShopRequestOutcome | null;
}

export interface ShopRequestFilters {
  status?: ShopRequestStatus;
}

/** An account's request, for its right-of-access export (OwnerService.exportData): never who closed it. */
export interface ExportedShopRequest {
  requestId: string;
  modelId: string;
  model: string;
  note: string | null;
  /** AC-01: the size asked; null: not given. */
  size: string | null;
  status: ShopRequestStatus;
  requestedAt: Date;
  handledAt: Date | null;
  resolutionNote: string | null;
  outcome: ShopRequestOutcome | null;
}

/** A request a lock closed, for its audit entry. */
export interface ClosedShopRequest {
  requestId: string;
  modelId: string;
}

function assertAccount(accountId: string): void {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
}

function adminIdOf(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

// ── Lock and right of access (OwnerService) ───────────────────────────────

/**
 * Close the open requests of an account in the transaction of its lock (OwnerService.lock), whose row lock on the
 * account is already held: CLOSED now, DECLINED (no sale follows), by the lock's ADMIN, without a note. Returns them
 * for their audit entries, written after the lock's row locks (auditClosedShopRequests).
 */
export async function closeAccountShopRequests(tx: Db, accountId: string, actor: Actor, now: Date): Promise<ClosedShopRequest[]> {
  assertAccount(accountId);
  const rows = await tx
    .updateTable('shop_requests')
    .set({ status: 'CLOSED', outcome: 'DECLINED', handled_by: adminIdOf(actor), handled_at: sql<Date>`greatest(${now}::timestamptz, created_at)` })
    .where('account_id', '=', accountId.toLowerCase())
    .where('status', '=', 'OPEN')
    .returning(['id', 'model_id'])
    .execute();
  return rows.map((r) => ({ requestId: r.id, modelId: r.model_id })).sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0));
}

/** One `shop.request.close` entry per request a lock closed, by the lock's ADMIN, with its reason. */
export async function auditClosedShopRequests(audit: AuditService, tx: Db, actor: Actor, closed: readonly ClosedShopRequest[], reason: 'account_locked'): Promise<void> {
  for (const r of closed) {
    await audit.record({ actor, action: 'shop.request.close', targetType: 'shop_request', targetId: r.requestId, details: { modelId: r.modelId, outcome: 'DECLINED', reason } }, tx);
  }
}

/** Every request of an account, oldest first, with the console's note on its closing (the privacy policy says ORBES records it). */
export async function accountShopRequests(db: Db, accountId: string): Promise<ExportedShopRequest[]> {
  assertAccount(accountId);
  const rows = await db
    .selectFrom('shop_requests as r')
    .innerJoin('models as m', 'm.id', 'r.model_id')
    .select(['r.id', 'r.model_id', 'm.name', 'r.note', 'r.size_label', 'r.status', 'r.created_at', 'r.handled_at', 'r.resolution_note', 'r.outcome'])
    .where('r.account_id', '=', accountId.toLowerCase())
    .orderBy('r.created_at')
    .orderBy('r.id')
    .execute();
  return rows.map((r) => ({
    requestId: r.id,
    modelId: r.model_id,
    model: r.name,
    note: r.note,
    size: r.size_label,
    status: r.status,
    requestedAt: r.created_at,
    handledAt: r.handled_at,
    resolutionNote: r.resolution_note,
    outcome: r.outcome,
  }));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface SalonServiceDeps {
  db: Db;
  audit: AuditService;
  lookbook: LookbookService;
  club: ClubService;
  clock?: Clock;
}

export class SalonService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly lookbook: LookbookService;
  private readonly club: ClubService;
  private readonly clock: Clock;

  constructor(deps: SalonServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.lookbook = deps.lookbook;
    this.club = deps.club;
    this.clock = deps.clock ?? systemClock;
  }

  /** The account's tier now; 403 OWNERS_ONLY for an account that holds no piece. */
  private async ownerTier(accountId: string): Promise<number> {
    const { tier } = await this.club.tierOf(accountId);
    if (tier < 1) throw ownersOnly();
    return tier;
  }

  /**
   * THE PRIVATE SALON for an owner (GET /api/v1/club/lookbook): the models its tier reaches, with their prices, no story;
   * when it reaches none, the lowest tier above it from which one is shown (`opensAt`), null when none is (the salon
   * then says nothing).
   */
  async grid(accountId: string): Promise<SalonGrid> {
    const tier = await this.ownerTier(accountId);
    const models = await this.lookbook.listReserved(tier);
    if (models.length > 0) return { models, opensAt: null };
    const from = await this.lookbook.reservedFromAbove(tier);
    return { models, opensAt: from === null ? null : { level: from, name: CLUB_TIER_NAMES[from - 1]!, pieces: CLUB_TIER_THRESHOLDS[from - 1]! } };
  }

  /**
   * A sheet for an owner (GET /api/v1/club/lookbook/:slug): PUBLIC, or RESERVED from its tier up with its price, its
   * tier and the account's open request; 404 LOOKBOOK_NOT_FOUND otherwise.
   */
  async sheet(accountId: string, slug: string): Promise<SalonSheet> {
    const tier = await this.ownerTier(accountId);
    const { modelId, sheet, variantIds } = await this.lookbook.sheetOf(slug, { tier });
    const variants: SalonSheet['variants'] = [];
    for (const v of sheet.variants) {
      const id = variantIds[v.slug];
      variants.push(v.salon && id ? { ...v, salon: await this.requestFacts(accountId, id, v.salon) } : (v as SalonSheet['variants'][number]));
    }
    if (!sheet.salon) return { ...sheet, variants } as SalonSheet;
    return { ...sheet, salon: await this.requestFacts(accountId, modelId, sheet.salon), variants };
  }

  /** A RESERVED model's facts for the account: its open request, its sizes and the one its saved size suggests (AC-01). */
  private async requestFacts(accountId: string, modelId: string, facts: SalonFacts): Promise<SalonRequestFacts> {
    const [request, sizes] = await Promise.all([this.openRequest(accountId, modelId), modelSizeCandidates(this.db, modelId)]);
    const kind = sizes.length >= 2 ? await sizeKindOf(this.db, modelId) : null;
    const suggested = kind === null ? null : matchSavedSize(kind, await savedMm(this.db, accountId.toLowerCase(), kind), sizes);
    return { ...facts, request, sizes: sizes.map((z) => z.label), suggestedSize: suggested?.label ?? null };
  }

  /** The account's open request for the model, or null. */
  private async openRequest(accountId: string, modelId: string): Promise<ShopRequestView | null> {
    const r = await this.db
      .selectFrom('shop_requests')
      .select(['id', 'status', 'created_at', 'size_label'])
      .where('account_id', '=', accountId.toLowerCase())
      .where('model_id', '=', modelId)
      .where('status', '=', 'OPEN')
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status, createdAt: r.created_at, size: r.size_label, modelId } : null;
  }

  /**
   * REQUEST THIS PIECE (POST /api/v1/club/lookbook/:slug/request): a RESERVED model whose tier the account reaches now
   * (403 OWNERS_ONLY without a piece, 404 LOOKBOOK_NOT_FOUND above it or not shown, 404 NOT_IN_SALON for a PUBLIC one),
   * with the account's optional note, and the size asked (AC-01: one of the model's sizes, whatever its case, stored as the
   * model's; 400 'Choose one of this model's sizes.' otherwise; null or left out: none). 409 SHOP_REQUEST_OPEN while one
   * is open for the model. Audited `shop.request` with the model and `sized`, never the note nor the size. The account's
   * row is read FOR SHARE: a lock under way finishes first, and closes it.
   */
  async request(accountId: string, slug: string, note: unknown, actor: Actor, size: unknown = null): Promise<{ request: ShopRequestView }> {
    assertAccount(accountId);
    const words = normalizeShopNote(note);
    const tier = await this.ownerTier(accountId);
    const { modelId, sheet } = await this.lookbook.sheetOf(slug, { tier });
    if (!sheet.salon) throw notInSalon();
    const sizeLabel = await this.sizeAsked(modelId, size);
    const account = accountId.toLowerCase();
    try {
      const created = await inTransaction(this.db, async (tx) => {
        const a = await tx.selectFrom('accounts').select('status').where('id', '=', account).forShare().executeTakeFirst();
        if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
        if (a.status !== 'ACTIVE') throw forbidden('This account cannot request a piece.');
        const r = await tx
          .insertInto('shop_requests')
          .values({ account_id: account, model_id: modelId, note: words, size_label: sizeLabel, created_at: this.clock() })
          .returning(['id', 'status', 'created_at'])
          .executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'shop.request', targetType: 'shop_request', targetId: r.id, details: { modelId, sized: sizeLabel !== null } }, tx);
        return r;
      });
      return { request: { id: created.id, status: created.status, createdAt: created.created_at, size: sizeLabel, modelId } };
    } catch (e) {
      if (isUniqueViolation(e, 'shop_requests_one_open')) throw shopRequestOpen();
      throw e;
    }
  }

  /** The size asked, as the model's SKU names it (AC-01): null for none; 400 for a size the model does not have. */
  private async sizeAsked(modelId: string, size: unknown): Promise<string | null> {
    if (size === null || size === undefined) return null;
    const asked = typeof size === 'string' ? size.trim().toUpperCase() : '';
    if (asked === '') return null;
    const found = (await modelSizeCandidates(this.db, modelId)).find((z) => z.label.toUpperCase() === asked);
    if (!found) throw validationError('Choose one of this model\u2019s sizes.');
    return found.label;
  }

  // ── The console (Club → Requests) ────────────────────────────────────────

  /** Every request, OPEN first, then the newest; or those of one status (GET /api/admin/club/requests). */
  async list(filters: ShopRequestFilters = {}, page: PageRequest): Promise<Page<AdminShopRequest>> {
    if (filters.status !== undefined && !SHOP_REQUEST_STATUSES.includes(filters.status)) throw validationError('Unknown request status.');
    const status = filters.status;
    const counted = await this.db
      .selectFrom('shop_requests as r')
      .$if(status !== undefined, (qb) => qb.where('r.status', '=', status!))
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();
    const rows = await this.query()
      .$if(status !== undefined, (qb) => qb.where('r.status', '=', status!))
      .orderBy(sql`r.status = 'OPEN'`, 'desc')
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(rows.map(toAdminRequest), Number(counted.total), page);
  }

  async get(id: string): Promise<AdminShopRequest> {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw shopRequestNotFound();
    const row = await this.query().where('r.id', '=', id.toLowerCase()).executeTakeFirst();
    if (!row) throw shopRequestNotFound();
    return toAdminRequest(row);
  }

  /**
   * Close a request with a note (POST /api/admin/club/requests/:id/close, OPERATOR): what was done for the client, or
   * why nothing was, and its outcome: ACCEPTED, the sale concluded, creates the request's order in the same transaction
   * (services/orders.ts orderForShopRequest: RESERVED, its size and price to be entered), or DECLINED. 409
   * SHOP_REQUEST_CLOSED when it already is. Audited `shop.request.close` with the model and the outcome.
   */
  async close(id: string, input: { note: unknown; outcome: ShopRequestOutcome }, actor: Actor): Promise<AdminShopRequest> {
    const by = adminIdOf(actor);
    if (by === null) throw forbidden('Only an ORBES admin closes a request.');
    const words = cleanText(input?.note, SHOP_RESOLUTION_MAX, 'The note');
    if (words === null) throw validationError('Say in the note what was done for the client.');
    if (!(SHOP_REQUEST_OUTCOMES as readonly string[]).includes(input.outcome)) throw validationError('Say whether the request is ACCEPTED or DECLINED.');
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw shopRequestNotFound();
    const requestId = id.toLowerCase();
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('shop_requests').select(['status', 'model_id', 'created_at']).where('id', '=', requestId).forUpdate().executeTakeFirst();
      if (!row) throw shopRequestNotFound();
      if (row.status === 'CLOSED') throw conflict('SHOP_REQUEST_CLOSED', 'This request is already closed.');
      const now = this.clock();
      const at = now.getTime() < row.created_at.getTime() ? row.created_at : now;
      await tx
        .updateTable('shop_requests')
        .set({ status: 'CLOSED', outcome: input.outcome, handled_by: by, handled_at: at, resolution_note: words })
        .where('id', '=', requestId)
        .execute();
      const order = input.outcome === 'ACCEPTED' ? await orderForShopRequest(tx, requestId, actor, at) : { order: null, notes: [] };
      const orderId = order.order ? { orderId: order.order.id } : {};
      await this.audit.record({ actor, action: 'shop.request.close', targetType: 'shop_request', targetId: requestId, details: { modelId: row.model_id, outcome: input.outcome, ...orderId } }, tx);
      for (const n of order.notes) await this.audit.record(n, tx);
    });
    return this.get(requestId);
  }

  /** A request with its account, its model and who closed it. */
  private query() {
    return this.db
      .selectFrom('shop_requests as r')
      .innerJoin('accounts as a', 'a.id', 'r.account_id')
      .innerJoin('models as m', 'm.id', 'r.model_id')
      .leftJoin('admin_users as u', 'u.id', 'r.handled_by')
      .select([
        'r.id',
        'r.status',
        'r.created_at',
        'r.note',
        'r.size_label',
        'r.handled_at',
        'r.resolution_note',
        'r.outcome',
        'a.id as account_id',
        'a.email as account_email',
        'm.id as model_id',
        'm.name as model_name',
        'm.type as model_type',
        'm.slug as model_slug',
        'm.price_label as model_price_label',
        'u.id as handled_by_id',
        'u.email as handled_by_email',
      ]);
  }
}

type AdminRequestRow = {
  id: string;
  status: ShopRequestStatus;
  created_at: Date;
  note: string | null;
  size_label: string | null;
  handled_at: Date | null;
  resolution_note: string | null;
  outcome: ShopRequestOutcome | null;
  account_id: string;
  account_email: string;
  model_id: string;
  model_name: string;
  model_type: string;
  model_slug: string | null;
  model_price_label: string | null;
  handled_by_id: string | null;
  handled_by_email: string | null;
};

function toAdminRequest(r: AdminRequestRow): AdminShopRequest {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    note: r.note,
    size: r.size_label,
    account: { id: r.account_id, email: r.account_email },
    model: { id: r.model_id, name: r.model_name, type: r.model_type, slug: r.model_slug, priceLabel: r.model_price_label },
    handledBy: r.handled_by_id ? { id: r.handled_by_id, email: r.handled_by_email ?? '' } : null,
    handledAt: r.handled_at,
    resolutionNote: r.resolution_note,
    outcome: r.outcome,
  };
}
