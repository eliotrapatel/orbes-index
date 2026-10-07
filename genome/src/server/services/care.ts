/**
 * The yearly care (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6; migration 0028; API §10.18 and §16.29): PLATINE's 1
 * piece a year and PALLADIUM's every piece (THE PROGRAM's `care_pieces_platine` and `care_pieces_palladium`), asked for
 * from the piece, with a prepaid label both ways, recorded in SERVICE HISTORY as YEARLY CARE.
 *
 *   status       GET /api/v1/account/products/:productId/care: the year (UTC), the tier now, its allowance (a number,
 *                'ALL' or 0), the pieces asked for this year, the piece's own request, and why it may or may not be
 *                asked for (`reason`). The tier is the one held now (services/club.ts tierOf); no grace period.
 *   addressHint  the buyer name and address of the account's latest order that has an address, to prefill the request's
 *                own form (its own account only), or null.
 *   request      POST …/care {name, address}: an ACTIVE account, holding the piece now (an open ownership), the piece
 *                REGISTERED, OWNED or TRANSFERRED (services/ownership.ts TRANSFERABLE_STATUSES: a piece received by
 *                transfer is included; LOST, STOLEN and SERVICED are refused), no transfer pending, a tier from
 *                PLATINE. The account FOR UPDATE, then the year's requests counted: once per piece and year
 *                (`care_requests_once`), within the allowance. 403 CARE_NOT_INCLUDED, 409 CARE_USED, 409
 *                CARE_ALREADY_REQUESTED, 409 CARE_UNAVAILABLE. The name and the address are stored with the request,
 *                never in the audit log (`care.request`).
 *   cancel       by the account while REQUESTED (`care.cancel`), which gives the year's allowance back; by ORBES before
 *                the piece is shipped back, with a note (an open record cancelled with it).
 *   staff        SEND LABEL (a PDF of at most 2 MiB, `%PDF-`; its carrier and tracking number) → LABEL_SENT; RECEIVED AT
 *                THE ATELIER → RECEIVED, opening the YEARLY_CARE record (WarrantyService.openService, the piece IN
 *                SERVICE); SHIP BACK (carrier, tracking) → RETURNING, to the address the collector gave; COMPLETE (the
 *                record's notes) → DONE, the record COMPLETED and the piece back to its status. Each step in one
 *                transaction with the record it opens or closes; audited `care.label`, `care.receive`, `care.return`,
 *                `care.complete`, `care.cancel`.
 *
 * Nothing is written in MESSAGES at any step: the label is shown only in the piece's SERVICE tab, and the console's
 * Messages board links an open request (`openCareOf`). The label's PDF is erased 30 days after the request ends
 * (`eraseCareLabels`, the housekeeping).
 *
 * Lock order: the account, then its care requests (a request, a collector's cancel); a care request, then its piece (a
 * staff step, through WarrantyService).
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { CARE_REQUEST_STATUSES, type CareRequestRow, type CareRequestStatus, type ClientConversationStatus } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';
import { tierName, tierOf, type ClubTierName } from './club.js';
import { readProgram, type ClubProgram } from './club-program.js';
import { findProduct } from './lifecycle.js';
import { trackingLink } from './orders.js';
import { TRANSFERABLE_STATUSES } from './ownership.js';
import type { WarrantyService } from './warranty.js';

/** The label's PDF: at most 2 MiB (the CHECK of migration 0028; the console's upload route takes as much). */
export const CARE_LABEL_MAX_BYTES = 2 * 1024 * 1024;
/** The label's PDF is erased this long after its request ends (DONE or CANCELLED). */
export const CARE_LABEL_RETENTION_MS = 30 * 86_400_000;
/** The return name and address, as an order's buyer (migration 0022): 1 to 200 and 1 to 1 000 characters, trimmed. */
export const CARE_ADDRESS_LIMITS = Object.freeze({ name: 200, address: 1000, note: 500 });
/** Where the atelier works: the location of the YEARLY_CARE record. */
export const CARE_LOCATION = 'ORBES atelier';

/** The steps still open: the piece is with ORBES, or on its way to or from it. */
export const CARE_OPEN_STATUSES: readonly CareRequestStatus[] = Object.freeze(['REQUESTED', 'LABEL_SENT', 'RECEIVED', 'RETURNING']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export const careNotIncluded = () => new DomainError('CARE_NOT_INCLUDED', 403, 'Your tier does not include the yearly care.');
export const careUsed = () => conflict('CARE_USED', 'Your yearly care for this year has been used for another piece.');
export const careAlreadyRequested = () => conflict('CARE_ALREADY_REQUESTED', 'The yearly care of this piece has already been requested this year.');
export const careUnavailable = () => conflict('CARE_UNAVAILABLE', 'The yearly care cannot be requested for this piece just now.');
export const careRequestNotFound = () => notFound('Care request', 'CARE_REQUEST_NOT_FOUND');
export const careStep = () => conflict('CARE_STEP', 'This yearly care is not at that step.');
export const fileNotPdf = () => new DomainError('FILE_NOT_PDF', 415, 'Send the label itself, as a PDF.');
export const fileTooLarge = () => new DomainError('FILE_TOO_LARGE', 413, 'The label is limited to 2 MB.');
const addressMissing = () => validationError('Enter the name and the address the piece returns to.');

/** How many pieces a tier's care covers a year: a number (0: none), or ALL (every piece, once a year each). */
export type CareAllowance = number | 'ALL';

/** Why the care may, or may not, be asked for now. */
export type CareReason = 'AVAILABLE' | 'NOT_INCLUDED' | 'USED' | 'PIECE_DONE' | 'UNAVAILABLE';

/** A shipment of the care: the carrier, the tracking number and its link, when it left. */
export interface CareShipment {
  carrier: { id: string; name: string };
  tracking: string;
  trackingUrl: string;
  at: Date;
}

/** A request as its collector reads it. */
export interface CareRequestView {
  id: string;
  status: CareRequestStatus;
  year: number;
  requestedAt: Date;
  returnName: string;
  returnAddress: string;
  /** The prepaid label: its shipment, and whether its PDF can still be downloaded. */
  label: (CareShipment & { pdf: boolean }) | null;
  receivedAt: Date | null;
  return: CareShipment | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
}

/** GET /api/v1/account/products/:productId/care. */
export interface CareStatus {
  /** The calendar year, in UTC. */
  year: number;
  tier: ClubTierName | null;
  allowance: CareAllowance;
  /** The account's requests of the year not cancelled. */
  used: number;
  /** The piece's request: an open one, else the account's latest of the year; null without one. */
  request: CareRequestView | null;
  reason: CareReason;
}

/** A row of the console's Yearly care board. */
export interface CareBoardRow {
  id: string;
  status: CareRequestStatus;
  requestedAt: Date;
  year: number;
  tier: ClubTierName;
  piece: { productId: string; model: string };
  account: { id: string; email: string };
}

/** A request as the console reads it (GET /api/admin/care/:id). */
export interface CareSheet extends CareBoardRow {
  returnName: string;
  returnAddress: string;
  label: (CareShipment & { pdf: boolean }) | null;
  receivedAt: Date | null;
  serviceRecordId: string | null;
  return: CareShipment | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: 'account' | 'admin' | null;
  note: string | null;
  handledBy: { id: string; email: string } | null;
  /** The client's MESSAGES conversation, or null (« No conversation yet. »). */
  conversation: { conversationId: string; status: ClientConversationStatus } | null;
}

/** A request in the account's export (right of access): with its return address. */
export interface ExportedCareRequest {
  id: string;
  productId: string;
  year: number;
  tier: ClubTierName;
  status: CareRequestStatus;
  requestedAt: Date;
  returnName: string;
  returnAddress: string;
  labelAt: Date | null;
  receivedAt: Date | null;
  returnShippedAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** The calendar year of an instant, in UTC. */
export function careYear(now: Date): number {
  return now.getUTCFullYear();
}

/** A tier's allowance in THE PROGRAM: PLATINE's number, PALLADIUM's number or every piece; nothing below PLATINE. */
export function careAllowance(p: Pick<ClubProgram, 'carePiecesPlatine' | 'carePiecesPalladium'>, tier: number): CareAllowance {
  if (tier >= 3) return p.carePiecesPalladium === null ? 'ALL' : p.carePiecesPalladium;
  if (tier === 2) return p.carePiecesPlatine;
  return 0;
}

/** The return name and address as given: trimmed, line breaks kept in the address, within their limits. */
export function cleanReturnAddress(input: { name?: unknown; address?: unknown } | null | undefined): { name: string; address: string } {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const address = typeof input?.address === 'string' ? input.address.replace(/\r\n?/g, '\n').trim() : '';
  if (name === '' || address === '') throw addressMissing();
  if (name.length > CARE_ADDRESS_LIMITS.name || address.length > CARE_ADDRESS_LIMITS.address) throw validationError('The name is limited to 200 characters and the address to 1,000.');
  if (/[\u0000-\u001f\u007f]/.test(name) || CONTROL.test(address)) throw validationError('The name or the address contains invalid characters.');
  return { name, address };
}

/** Whether the bytes are a PDF: its signature, and its size. */
export function checkLabelPdf(bytes: unknown): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw fileNotPdf();
  if (bytes.byteLength > CARE_LABEL_MAX_BYTES) throw fileTooLarge();
  if (!PDF_SIGNATURE.every((b, i) => bytes[i] === b)) throw fileNotPdf();
  return bytes;
}

function cleanTracking(v: unknown): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!TRACKING_RE.test(t)) throw validationError('A tracking number has 3 to 40 letters and digits.');
  return t;
}

function cleanNote(v: unknown, required: boolean): string | null {
  const s = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '';
  if (s === '') {
    if (required) throw validationError('Write a note.');
    return null;
  }
  if (s.length > CARE_ADDRESS_LIMITS.note) throw validationError('A note is limited to 500 characters.');
  if (CONTROL.test(s)) throw validationError('The note contains invalid characters.');
  return s;
}

function requestId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw careRequestNotFound();
  return id.toLowerCase();
}

function adminIdOf(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

/** A model's name as the console says it: MONOLITHE, or MONOLITHE IN STEEL. */
function modelName(name: string, variantLabel: string | null): string {
  return variantLabel ? `${name} IN ${variantLabel.toUpperCase()}` : name;
}

// ── Reading ────────────────────────────────────────────────────────────────

type ShipmentRow = Pick<CareRequestRow, 'label_carrier_id' | 'label_tracking' | 'label_at' | 'return_carrier_id' | 'return_tracking' | 'return_shipped_at'>;

async function shipments(db: Db, r: ShipmentRow): Promise<{ label: CareShipment | null; back: CareShipment | null }> {
  const ids = [r.label_carrier_id, r.return_carrier_id].filter((x): x is string => x !== null);
  const carriers = ids.length ? await db.selectFrom('carriers').select(['id', 'name', 'tracking_url']).where('id', 'in', ids).execute() : [];
  const of = (id: string | null, tracking: string | null, at: Date | null): CareShipment | null => {
    const c = carriers.find((x) => x.id === id);
    if (!c || !tracking || !at) return null;
    return { carrier: { id: c.id, name: c.name }, tracking, trackingUrl: trackingLink(c.tracking_url, tracking), at };
  };
  return { label: of(r.label_carrier_id, r.label_tracking, r.label_at), back: of(r.return_carrier_id, r.return_tracking, r.return_shipped_at) };
}

const VIEW_COLUMNS = [
  'id', 'account_id', 'product_id', 'year', 'tier', 'status', 'requested_at', 'return_name', 'return_address', 'label_carrier_id', 'label_tracking', 'label_at',
  'service_record_id', 'received_at', 'return_carrier_id', 'return_tracking', 'return_shipped_at', 'done_at', 'cancelled_at', 'cancelled_by', 'note', 'handled_by',
] as const;
type ViewRow = Pick<CareRequestRow, (typeof VIEW_COLUMNS)[number]> & { has_pdf: boolean };

function viewQuery(db: Db) {
  return db.selectFrom('care_requests').select([...VIEW_COLUMNS, sql<boolean>`label_pdf IS NOT NULL`.as('has_pdf')]);
}

async function toView(db: Db, r: ViewRow): Promise<CareRequestView> {
  const s = await shipments(db, r);
  return {
    id: r.id,
    status: r.status,
    year: r.year,
    requestedAt: r.requested_at,
    returnName: r.return_name,
    returnAddress: r.return_address,
    label: s.label ? { ...s.label, pdf: r.has_pdf } : null,
    receivedAt: r.received_at,
    return: s.back,
    doneAt: r.done_at,
    cancelledAt: r.cancelled_at,
  };
}

/** The open yearly care of each account (the newest when several), for the Messages board: its id and its piece's serial. */
export async function openCareOf(db: Db, accountIds: readonly string[]): Promise<Map<string, { id: string; serial: string }>> {
  const out = new Map<string, { id: string; serial: string }>();
  if (accountIds.length === 0) return out;
  const rows = await db
    .selectFrom('care_requests as c')
    .innerJoin('products as p', 'p.id', 'c.product_id')
    .select(['c.id', 'c.account_id', 'p.product_id as serial'])
    .where('c.account_id', 'in', [...accountIds])
    .where('c.status', 'in', [...CARE_OPEN_STATUSES])
    .orderBy('c.requested_at', 'desc')
    .orderBy('c.id')
    .execute();
  for (const r of rows) if (!out.has(r.account_id)) out.set(r.account_id, { id: r.id, serial: r.serial });
  return out;
}

/** The account's yearly cares this year: how many are asked for (not cancelled), and the allowance of its tier now. */
export async function careThisYear(db: Db, accountId: string, now: Date, program?: ClubProgram): Promise<{ year: number; used: number; allowance: CareAllowance; open: { id: string; productId: string } | null }> {
  const year = careYear(now);
  const p = program ?? (await readProgram(db));
  const standing = await tierOf(db, accountId, now);
  const rows = await db
    .selectFrom('care_requests as c')
    .innerJoin('products as p', 'p.id', 'c.product_id')
    .select(['c.id', 'c.status', 'c.year', 'p.product_id'])
    .where('c.account_id', '=', accountId)
    .where((eb) => eb.or([eb('c.year', '=', year), eb('c.status', 'in', [...CARE_OPEN_STATUSES])]))
    .orderBy('c.requested_at', 'desc')
    .execute();
  const open = rows.find((r) => CARE_OPEN_STATUSES.includes(r.status));
  return {
    year,
    used: rows.filter((r) => r.year === year && r.status !== 'CANCELLED').length,
    allowance: careAllowance(p, standing.tier),
    open: open ? { id: open.id, productId: open.product_id } : null,
  };
}

/** Every care request of an account, oldest first, with its return address: its right-of-access export. */
export async function accountCareRequests(db: Db, accountId: string): Promise<ExportedCareRequest[]> {
  const rows = await db
    .selectFrom('care_requests as c')
    .innerJoin('products as p', 'p.id', 'c.product_id')
    .select([
      'c.id', 'p.product_id', 'c.year', 'c.tier', 'c.status', 'c.requested_at', 'c.return_name', 'c.return_address', 'c.label_at', 'c.received_at', 'c.return_shipped_at', 'c.done_at', 'c.cancelled_at',
    ])
    .where('c.account_id', '=', accountId)
    .orderBy('c.requested_at')
    .orderBy('c.id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    year: r.year,
    tier: tierName(r.tier as 2 | 3)!,
    status: r.status,
    requestedAt: r.requested_at,
    returnName: r.return_name,
    returnAddress: r.return_address,
    labelAt: r.label_at,
    receivedAt: r.received_at,
    returnShippedAt: r.return_shipped_at,
    doneAt: r.done_at,
    cancelledAt: r.cancelled_at,
  }));
}

/** The housekeeping: the labels' PDFs erased 30 days after their request ended. Returns how many. */
export async function eraseCareLabels(db: Db, now: Date): Promise<number> {
  const before = new Date(now.getTime() - CARE_LABEL_RETENTION_MS);
  const r = await db
    .updateTable('care_requests')
    .set({ label_pdf: null })
    .where('label_pdf', 'is not', null)
    .where((eb) => eb.or([eb.and([eb('status', '=', 'DONE'), eb('done_at', '<', before)]), eb.and([eb('status', '=', 'CANCELLED'), eb('cancelled_at', '<', before)])]))
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}

// ── Service ────────────────────────────────────────────────────────────────

export interface CareServiceDeps {
  db: Db;
  audit: AuditService;
  warranty: WarrantyService;
  clock?: Clock;
}

export class CareService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly warranty: WarrantyService;
  private readonly clock: Clock;

  constructor(deps: CareServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.warranty = deps.warranty;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The collector ────────────────────────────────────────────────────────

  /** The piece's yearly care for the account (GET /api/v1/account/products/:productId/care). See the header. */
  async status(accountId: string, productRef: string): Promise<CareStatus> {
    const now = this.clock();
    const year = careYear(now);
    const product = await this.ownPiece(this.db, accountId, productRef);
    const program = await readProgram(this.db);
    const standing = await tierOf(this.db, accountId, now);
    const allowance = careAllowance(program, standing.tier);
    const mine = await viewQuery(this.db)
      .where('account_id', '=', accountId)
      .where((eb) => eb.or([eb('year', '=', year), eb('status', 'in', [...CARE_OPEN_STATUSES])]))
      .orderBy('requested_at', 'desc')
      .orderBy('id')
      .execute();
    const used = mine.filter((r) => r.year === year && r.status !== 'CANCELLED').length;
    const ofPiece = mine.filter((r) => r.product_id === product.id);
    const shown = ofPiece.find((r) => CARE_OPEN_STATUSES.includes(r.status)) ?? ofPiece.find((r) => r.year === year) ?? null;
    const reason = await this.reasonOf(this.db, product, allowance, used, year);
    return {
      year,
      tier: tierName(standing.tier),
      allowance,
      used,
      request: shown ? await toView(this.db, shown) : null,
      reason,
    };
  }

  /** The buyer name and address of the account's latest order that has an address: the request form's prefill. */
  async addressHint(accountId: string): Promise<{ name: string; address: string } | null> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) return null;
    const r = await this.db
      .selectFrom('orders')
      .select(['buyer_name', 'buyer_address'])
      .where('account_id', '=', accountId)
      .where('buyer_address', 'is not', null)
      .orderBy('reserved_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!r || !r.buyer_address) return null;
    return { name: r.buyer_name ?? '', address: r.buyer_address };
  }

  /** Ask for the yearly care of a piece (POST /api/v1/account/products/:productId/care). See the header. */
  async request(accountId: string, productRef: string, input: { name?: unknown; address?: unknown }, actor: Actor): Promise<CareStatus> {
    const to = cleanReturnAddress(input);
    const now = this.clock();
    const year = careYear(now);
    const out = await inTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forUpdate().executeTakeFirst();
      if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (a.status !== 'ACTIVE') throw customerAccountLocked();
      const product = await this.ownPiece(tx, accountId, productRef);
      const program = await readProgram(tx);
      const standing = await tierOf(tx, accountId, now);
      const allowance = careAllowance(program, standing.tier);
      const year_ = await tx
        .selectFrom('care_requests')
        .select(['product_id'])
        .where('account_id', '=', accountId)
        .where('year', '=', year)
        .where('status', '<>', 'CANCELLED')
        .execute();
      const reason = await this.reasonOf(tx, product, allowance, year_.length, year);
      if (reason === 'NOT_INCLUDED') throw careNotIncluded();
      if (reason === 'PIECE_DONE') throw careAlreadyRequested();
      if (reason === 'USED') throw careUsed();
      if (reason === 'UNAVAILABLE') throw careUnavailable();
      const row = await tx
        .insertInto('care_requests')
        .values({ account_id: accountId, product_id: product.id, year, tier: standing.tier, status: 'REQUESTED', requested_at: now, return_name: to.name, return_address: to.address })
        .returning('id')
        .executeTakeFirstOrThrow()
        .catch((e: unknown) => {
          if (isUniqueViolation(e, 'care_requests_once')) throw careAlreadyRequested();
          throw e;
        });
      await this.audit.record(
        { actor, action: 'care.request', targetType: 'care_request', targetId: row.id, details: { requestId: row.id, productId: product.product_id, year, tier: standing.tier } },
        tx,
      );
      return product.product_id;
    });
    return this.status(accountId, out);
  }

  /** The account cancels its request while it is REQUESTED (POST /api/v1/account/care/:id/cancel). */
  async cancelByAccount(accountId: string, id: string, actor: Actor): Promise<CareStatus> {
    const rid = requestId(id);
    const now = this.clock();
    const serial = await inTransaction(this.db, async (tx) => {
      await tx.selectFrom('accounts').select('id').where('id', '=', accountId).forUpdate().executeTakeFirst();
      const r = await tx.selectFrom('care_requests').select(['id', 'account_id', 'product_id', 'status', 'requested_at']).where('id', '=', rid).forUpdate().executeTakeFirst();
      if (!r || r.account_id !== accountId) throw careRequestNotFound();
      if (r.status !== 'REQUESTED') throw careStep();
      await tx
        .updateTable('care_requests')
        .set({ status: 'CANCELLED', cancelled_at: now < r.requested_at ? r.requested_at : now, cancelled_by: 'account' })
        .where('id', '=', rid)
        .execute();
      const p = await tx.selectFrom('products').select('product_id').where('id', '=', r.product_id).executeTakeFirstOrThrow();
      await this.audit.record({ actor, action: 'care.cancel', targetType: 'care_request', targetId: rid, details: { requestId: rid, productId: p.product_id, by: 'account', from: 'REQUESTED' } }, tx);
      return p.product_id;
    });
    return this.status(accountId, serial);
  }

  /** The prepaid label's PDF, for its own account only (404 otherwise, and once erased). */
  async labelPdf(accountId: string, id: string): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    const rid = requestId(id);
    const r = await this.db
      .selectFrom('care_requests as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .select(['c.account_id', 'c.label_pdf', 'c.year', 'p.product_id'])
      .where('c.id', '=', rid)
      .executeTakeFirst();
    if (!r || r.account_id !== accountId || !r.label_pdf) throw careRequestNotFound();
    return { contentType: 'application/pdf', body: r.label_pdf, filename: `ORBES-YEARLY-CARE-${r.product_id}-${r.year}-LABEL.pdf` };
  }

  // ── The console ──────────────────────────────────────────────────────────

  /** The Yearly care board (GET /api/admin/care): by status, oldest first; `year` optional. */
  async list(filter: { status?: CareRequestStatus; year?: number }, page: PageRequest): Promise<Page<CareBoardRow>> {
    if (filter.status !== undefined && !CARE_REQUEST_STATUSES.includes(filter.status)) throw validationError('Unknown care status.');
    let q = this.db
      .selectFrom('care_requests as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .innerJoin('accounts as a', 'a.id', 'c.account_id');
    if (filter.status) q = q.where('c.status', '=', filter.status);
    if (filter.year !== undefined) q = q.where('c.year', '=', filter.year);
    const [rows, count] = await Promise.all([
      q
        .select(['c.id', 'c.status', 'c.requested_at', 'c.year', 'c.tier', 'p.product_id', 'm.name', 'm.variant_label', 'a.id as account_id', 'a.email'])
        .orderBy('c.requested_at')
        .orderBy('c.id')
        .limit(page.pageSize)
        .offset(pageOffset(page))
        .execute(),
      q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return makePage(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        requestedAt: r.requested_at,
        year: r.year,
        tier: tierName(r.tier as 2 | 3)!,
        piece: { productId: r.product_id, model: modelName(r.name, r.variant_label) },
        account: { id: r.account_id, email: r.email },
      })),
      Number(count.n),
      page,
    );
  }

  /** A request as the console reads it (GET /api/admin/care/:id). */
  async sheet(id: string): Promise<CareSheet> {
    const rid = requestId(id);
    const r = await this.db
      .selectFrom('care_requests as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .innerJoin('accounts as a', 'a.id', 'c.account_id')
      .leftJoin('admin_users as u', 'u.id', 'c.handled_by')
      .leftJoin('client_conversations as v', 'v.account_id', 'c.account_id')
      .select([
        'c.id', 'c.status', 'c.requested_at', 'c.year', 'c.tier', 'c.return_name', 'c.return_address', 'c.label_carrier_id', 'c.label_tracking', 'c.label_at',
        sql<boolean>`c.label_pdf IS NOT NULL`.as('has_pdf'),
        'c.service_record_id', 'c.received_at', 'c.return_carrier_id', 'c.return_tracking', 'c.return_shipped_at', 'c.done_at', 'c.cancelled_at', 'c.cancelled_by', 'c.note',
        'c.handled_by', 'u.email as handled_email', 'p.product_id', 'm.name', 'm.variant_label', 'a.id as account_id', 'a.email', 'v.id as conversation_id', 'v.status as conversation_status',
      ])
      .where('c.id', '=', rid)
      .executeTakeFirst();
    if (!r) throw careRequestNotFound();
    const s = await shipments(this.db, r);
    return {
      id: r.id,
      status: r.status,
      requestedAt: r.requested_at,
      year: r.year,
      tier: tierName(r.tier as 2 | 3)!,
      piece: { productId: r.product_id, model: modelName(r.name, r.variant_label) },
      account: { id: r.account_id, email: r.email },
      returnName: r.return_name,
      returnAddress: r.return_address,
      label: s.label ? { ...s.label, pdf: r.has_pdf } : null,
      receivedAt: r.received_at,
      serviceRecordId: r.service_record_id,
      return: s.back,
      doneAt: r.done_at,
      cancelledAt: r.cancelled_at,
      cancelledBy: r.cancelled_by,
      note: r.note,
      handledBy: r.handled_by ? { id: r.handled_by, email: r.handled_email ?? '' } : null,
      conversation: r.conversation_id && r.conversation_status ? { conversationId: r.conversation_id, status: r.conversation_status } : null,
    };
  }

  /** SEND LABEL (POST /api/admin/care/:id/label, OPERATOR): the prepaid label's PDF, its carrier and tracking → LABEL_SENT. */
  async sendLabel(id: string, input: { pdf: unknown; carrierId: unknown; tracking: unknown }, actor: Actor): Promise<CareSheet> {
    const pdf = checkLabelPdf(input.pdf);
    const tracking = cleanTracking(input.tracking);
    return this.step(id, ['REQUESTED'], actor, 'care.label', async (tx, r, now, by) => {
      const carrier = await this.activeCarrier(tx, input.carrierId);
      await tx
        .updateTable('care_requests')
        .set({ status: 'LABEL_SENT', label_pdf: pdf, label_carrier_id: carrier, label_tracking: tracking, label_at: now < r.requested_at ? r.requested_at : now, handled_by: by })
        .where('id', '=', r.id)
        .execute();
      return { carrierId: carrier, bytes: pdf.byteLength };
    });
  }

  /** RECEIVED AT THE ATELIER (OPERATOR): the YEARLY_CARE record opened, the piece IN SERVICE, in the same transaction. */
  async receive(id: string, actor: Actor): Promise<CareSheet> {
    return this.step(id, ['LABEL_SENT'], actor, 'care.receive', async (tx, r, now, by) => {
      const record = await this.warranty.openService(r.product_id, { type: 'YEARLY_CARE', location: CARE_LOCATION, notes: null, performedBy: CARE_LOCATION }, actor, tx);
      await tx
        .updateTable('care_requests')
        .set({ status: 'RECEIVED', received_at: r.label_at && now < r.label_at ? r.label_at : now, service_record_id: record.id, handled_by: by })
        .where('id', '=', r.id)
        .execute();
      return { serviceId: record.id };
    });
  }

  /** SHIP BACK (OPERATOR): its carrier and tracking number, to the address the collector gave → RETURNING. */
  async shipBack(id: string, input: { carrierId: unknown; tracking: unknown }, actor: Actor): Promise<CareSheet> {
    const tracking = cleanTracking(input.tracking);
    return this.step(id, ['RECEIVED'], actor, 'care.return', async (tx, r, now, by) => {
      const carrier = await this.activeCarrier(tx, input.carrierId);
      await tx
        .updateTable('care_requests')
        .set({ status: 'RETURNING', return_carrier_id: carrier, return_tracking: tracking, return_shipped_at: r.received_at && now < r.received_at ? r.received_at : now, handled_by: by })
        .where('id', '=', r.id)
        .execute();
      return { carrierId: carrier };
    });
  }

  /** COMPLETE (OPERATOR): the record COMPLETED with its notes, the piece back to its status → DONE. */
  async complete(id: string, input: { notes?: unknown }, actor: Actor): Promise<CareSheet> {
    const notes = typeof input?.notes === 'string' && input.notes.trim() !== '' ? input.notes : null;
    return this.step(id, ['RETURNING'], actor, 'care.complete', async (tx, r, now, by) => {
      // A record no longer OPEN (closed outside the flow before the console refused it) does not hold the request back.
      const open = await tx.selectFrom('service_records').select('status').where('id', '=', r.service_record_id!).executeTakeFirst();
      if (open?.status === 'OPEN') await this.warranty.completeService(r.service_record_id!, { notes }, actor, tx);
      await tx
        .updateTable('care_requests')
        .set({ status: 'DONE', done_at: r.return_shipped_at && now < r.return_shipped_at ? r.return_shipped_at : now, handled_by: by })
        .where('id', '=', r.id)
        .execute();
      return { serviceId: r.service_record_id };
    });
  }

  /** CANCEL (OPERATOR, a note): before the piece is shipped back; an open record is cancelled with it. */
  async cancel(id: string, input: { note?: unknown }, actor: Actor): Promise<CareSheet> {
    const note = cleanNote(input?.note, true)!;
    return this.step(id, ['REQUESTED', 'LABEL_SENT', 'RECEIVED'], actor, 'care.cancel', async (tx, r, now, by) => {
      if (r.service_record_id) {
        const open = await tx.selectFrom('service_records').select('status').where('id', '=', r.service_record_id).executeTakeFirst();
        if (open?.status === 'OPEN') await this.warranty.cancelService(r.service_record_id, { reason: 'yearly care cancelled' }, actor, tx);
      }
      await tx
        .updateTable('care_requests')
        .set({ status: 'CANCELLED', cancelled_at: now < r.requested_at ? r.requested_at : now, cancelled_by: 'admin', note, handled_by: by })
        .where('id', '=', r.id)
        .execute();
      return { by: 'admin', from: r.status };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** A staff step: the request FOR UPDATE at one of `from`, the change, the audit entry; then the sheet read again. */
  private async step(
    id: string,
    from: readonly CareRequestStatus[],
    actor: Actor,
    action: string,
    apply: (tx: Db, r: CareRequestRow, now: Date, by: string) => Promise<Record<string, unknown>>,
  ): Promise<CareSheet> {
    const by = adminIdOf(actor);
    if (by === null) throw forbidden('Only ORBES Client Services handle a yearly care.');
    const rid = requestId(id);
    await inTransaction(this.db, async (tx) => {
      const r = await tx.selectFrom('care_requests').selectAll().where('id', '=', rid).forUpdate().executeTakeFirst();
      if (!r) throw careRequestNotFound();
      if (!from.includes(r.status)) throw careStep();
      const details = await apply(tx, r, this.clock(), by);
      const p = await tx.selectFrom('products').select('product_id').where('id', '=', r.product_id).executeTakeFirstOrThrow();
      await this.audit.record({ actor, action, targetType: 'care_request', targetId: rid, details: { requestId: rid, productId: p.product_id, year: r.year, ...details } }, tx);
    });
    return this.sheet(rid);
  }

  private async activeCarrier(tx: Db, carrierId: unknown): Promise<string> {
    if (typeof carrierId !== 'string' || !UUID_RE.test(carrierId)) throw validationError('Choose a carrier.');
    const c = await tx.selectFrom('carriers').select(['id', 'active']).where('id', '=', carrierId.toLowerCase()).executeTakeFirst();
    if (!c || !c.active) throw validationError('Choose an active carrier.');
    return c.id;
  }

  /** The piece, held by the account now (an open ownership); 404 PRODUCT_NOT_FOUND otherwise, as for any piece not its own. */
  private async ownPiece(db: Db, accountId: string, productRef: string) {
    const product = await findProduct(db, productRef);
    const notYours = () => notFound('Product', 'PRODUCT_NOT_FOUND');
    if (!product) throw notYours();
    const o = await db.selectFrom('ownership').select('id').where('product_id', '=', product.id).where('account_id', '=', accountId).where('ended_at', 'is', null).executeTakeFirst();
    if (!o) throw notYours();
    return product;
  }

  /** Why the care may or may not be asked for now (see CareReason). */
  private async reasonOf(db: Db, product: { id: string; status: string }, allowance: CareAllowance, used: number, year: number): Promise<CareReason> {
    if (allowance === 0) return 'NOT_INCLUDED';
    const taken = await db.selectFrom('care_requests').select('id').where('product_id', '=', product.id).where('year', '=', year).where('status', '<>', 'CANCELLED').executeTakeFirst();
    if (taken) return 'PIECE_DONE';
    if (allowance !== 'ALL' && used >= allowance) return 'USED';
    if (!TRANSFERABLE_STATUSES.includes(product.status as never)) return 'UNAVAILABLE';
    const pending = await db.selectFrom('ownership_transfers').select('id').where('product_id', '=', product.id).where('status', '=', 'PENDING').executeTakeFirst();
    if (pending) return 'UNAVAILABLE';
    return 'AVAILABLE';
  }
}
