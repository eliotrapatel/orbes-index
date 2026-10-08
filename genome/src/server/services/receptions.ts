/**
 * The receptions (plan NEXT LOT of 2026-10-07, §3.5.6.5; migration 0036; API §16.33, DATABASE §5.80 to §5.83): « The
 * agent records a reception against its supplier order », « an ORBES staff member confirms the reception: that issues
 * the identities », « the agent attaches the code and the claim card before storing the pieces ».
 *
 *   the way in     the agent types the supplier order's reference from the delivery note (`findForReception`): an open
 *                  order (SENT, EXPECTED, PARTLY_RECEIVED) delivering to one of its locations, with its lines without a
 *                  price (`linesFor`: model, variant, size, ordered, already received, the expected date); anything
 *                  else answers 404 SUPPLIER_ORDER_NOT_FOUND, so the agent can neither list nor probe the others.
 *                  ORBES staff see the orders on their way to a location (`expected`), never the agent.
 *   the count      `record` (one open reception per order: 409 RECEPTION_OPEN; the order still expecting: 409
 *                  SUPPLIER_ORDER_CLOSED; at least one piece: 422 RECEPTION_EMPTY; more pieces than a line expects, or
 *                  a size not on the order, need their line's note: 422 RECEPTION_NOTE_REQUIRED) → TO_CONFIRM; the
 *                  agent edits it (`update`) until ORBES confirms it; ORBES sends it back with a note (`sendBack`,
 *                  SENT_BACK: counted again, then TO_CONFIRM anew).
 *   confirmation   `confirm` (OPERATOR): the supplier order locked first (lock order: supplier_orders → receptions →
 *                  lines), so a reception is never confirmed onto an order closed meanwhile; every model with its
 *                  material (409 RECEPTION_MATERIAL_MISSING); CONFIRMED; the order's lines counted (accepted, rejected),
 *                  the rejected pieces listed TO_RETURN (`supplier_returns`), the order's status settled; then the
 *                  issuing worker is woken.
 *   issuing        `issuePending`, restart-safe and driven by the database: while a CONFIRMED reception has a line with
 *                  identities to issue, up to RECEPTION_ISSUE_CHUNK pieces of it, their claim codes generated and hashed
 *                  one at a time outside the transaction (scrypt), then one signing transaction (IssuanceService
 *                  .inSigningTransaction) under the line's advisory lock: each piece issued (`issueStockIdentity`:
 *                  serial, ISSUED, its code signed, `stock_entered_at`, its reception line; audited `product.issue`
 *                  with the reception), its claim code sealed for its card (`card_prints`, AES-256-GCM under the HKDF
 *                  subkey 'orbes/card-claim-codes/v1' of KEY_ENCRYPTION_KEY, or COOKIE_SECRET without one; AAD
 *                  'card:<product id>'), the line's `issued` counted, ONE RECEIVED movement of +n, then the orders
 *                  waiting for that size there served, the oldest first, a reshipment first (services/orders.ts
 *                  serveWaiting). Every line issued: `issued_at`, audited `reception.issued`. The process runs a chunk
 *                  every 250 ms while work remains and polls every 30 s (`start`, from src/server/index.ts beside the
 *                  housekeeping; `confirm` wakes it); tests call `issuePending` themselves (no timer without `start`).
 *   the cards      printed only once every identity is issued (409 RECEPTION_ISSUING), in runs fixed by serial: the
 *                  reception's cards ordered by serial, cut into blocks of 48 (A4 sheets) or 50 (one per page); a card
 *                  erased leaves a gap in its block and never shifts the next run. Each sealed code opened and drawn
 *                  through CertificateService.render (the 79t card, checked against the stored hash); a piece whose code
 *                  was replaced (a new claim code), which is registered, or whose sealed copy no longer opens is
 *                  skipped and its sealed copy erased (REPLACED, REGISTERED, UNREADABLE). Audited `card.print`.
 *                  `cardsAttached` erases every sealed copy left (ATTACHED): from then on a lost card needs a new claim
 *                  code (409 CARDS_ATTACHED).
 *   back to the    the rejected pieces sent back by the agent (`supplierReturnSent`: TO_RETURN → RETURNED, an optional
 *   supplier       carrier and tracking number); the supplier's answer is ORBES's (services/supplier-orders.ts).
 *
 * A LOGISTICS login reaches only its own locations (`scope`): any row of another answers 404, never 403. No price, no
 * total, no supplier's contact ever reaches it: the types here carry none. Audited `reception.record`, `.update`,
 * `.send_back`, `.confirm`, `.issued`, `card.print`, `card.attached`, `supplier_return.returned`, by ids and counts,
 * never a note's words nor a claim code; no claim code, sealed or clear, reaches a log, an event or the journal.
 */
import { sql } from 'kysely';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey, openText, seal, SecretboxError } from '../crypto/secretbox.js';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import type { CardErasedReason, ReceptionRow, SupplierOrderRow } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { MAX_CERTIFICATE_ITEMS, type CertificateLayout, type RenderedCertificates } from '../render/certificate.js';
import { noopLogger, SYSTEM_ACTOR, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import type { CertificateService } from './certificates.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import { issueStockIdentity, NOT_PRINTABLE, type IssuanceService } from './issuance.js';
import { writeJournal } from './journal.js';
import { serveWaiting } from './orders.js';
import { assertSkuOffered } from './sizes.js';
import { lockSku, recordMovement } from './stock.js';
import { lineExpected, receptionOpen, refreshStatus, SUPPLIER_ORDER_OPEN, supplierOrderClosed, supplierOrderNotFound, supplierOrderReference, type SupplierOrderSku } from './supplier-orders.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** Identities issued per transaction (§1.1 (l)): the shared box is never held long. */
export const RECEPTION_ISSUE_CHUNK = 50;
/** Cards per run: six full A4 sheets of eight, or fifty single pages (§1.1 (g); CertificateService's limit). */
export const RECEPTION_RUNS = Object.freeze({ sheet: 48, card: MAX_CERTIFICATE_ITEMS });
/** The worker's pace: the next chunk while work remains, a poll when idle. */
export const RECEPTION_WORKER = Object.freeze({ nextChunkMs: 250, pollMs: 30_000 });
/** The bounds of a reception's fields (the CHECKs of migration 0036). */
export const RECEPTION_LIMITS = Object.freeze({ pieces: 10_000, deliveryNote: 60, note: 1000, lineNote: 500, lines: 500 });
/** The HKDF info of the key that seals a reception's claim codes until their cards are attached (§1.1 (f)). */
export const CARD_CLAIM_KEY_INFO = 'orbes/card-claim-codes/v1';

/** The key that seals a reception's claim codes: KEY_ENCRYPTION_KEY, or COOKIE_SECRET without one (as the TOTP seeds). */
export function deriveCardClaimKey(config: Pick<AppConfig, 'keys' | 'cookieSecret'>): Uint8Array {
  const ikm = config.keys.encryptionKey ? fromBase64Url(config.keys.encryptionKey) : utf8(config.cookieSecret);
  return deriveSubkey(ikm, CARD_CLAIM_KEY_INFO, { salt: 'ORBES' });
}

/** The AAD that binds a sealed code to its own piece. */
export const cardAad = (productUuid: string) => `card:${productUuid}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE_RE = /^SO-?([0-9A-F]{8})$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

/** The locations a request may see: a LOGISTICS login's own, or null for ORBES staff (routes/admin/logistics.ts). */
export type LocationScope = ReadonlySet<string> | null;
const inScope = (scope: LocationScope, locationId: string) => scope === null || scope.has(locationId);

// ── Errors ─────────────────────────────────────────────────────────────────

const receptionNotFound = () => notFound('Reception', 'RECEPTION_NOT_FOUND');
const receptionConfirmed = () => conflict('RECEPTION_CONFIRMED', 'This reception is confirmed: it no longer changes.');
const receptionNotToConfirm = () => conflict('RECEPTION_SENT_BACK', 'This reception is sent back: the agent counts it again first.');
const receptionNotConfirmed = () => conflict('RECEPTION_NOT_CONFIRMED', 'ORBES has not confirmed this reception yet.');
const issuing = () => conflict('RECEPTION_ISSUING', 'The identities are still being issued: print the cards once they are all issued.');
const cardsAttached = () => conflict('CARDS_ATTACHED', 'These cards are attached: a lost card needs a new claim code from ORBES.');
const nothingToPrint = () => conflict('CARDS_NONE_TO_PRINT', 'No card of this run can be printed: each is attached, replaced or registered.');
const empty = () => new DomainError('RECEPTION_EMPTY', 422, 'Count at least one piece.');
const noteRequired = () => new DomainError('RECEPTION_NOTE_REQUIRED', 422, 'Say in a note why more pieces than expected, or a piece not on the order, came in.');
const returnNotFound = () => notFound('Supplier return', 'SUPPLIER_RETURN_NOT_FOUND');
const materialMissing = (named: string) => conflict('RECEPTION_MATERIAL_MISSING', `Set the material of ${named} in the Catalogue before confirming.`);

// ── Views ──────────────────────────────────────────────────────────────────

/** A supplier order's line as the agent counts against it: never a price. */
export interface ReceptionOrderLine {
  lineId: string;
  sku: SupplierOrderSku;
  ordered: number;
  /** What its CONFIRMED receptions brought in, good or not: accepted + rejected. */
  alreadyReceived: number;
  /** What the order still expects of it. */
  expected: number;
}

/** A supplier order as a reception reads it (`findForReception`, `linesFor`): the supplier's name, the lines, no price. */
export interface ReceptionOrder {
  id: string;
  reference: string;
  supplierName: string;
  location: { id: string; name: string };
  /** YYYY-MM-DD. */
  expectedOn: string | null;
  lines: ReceptionOrderLine[];
  /** The sizes « Add a piece not on this order » offers: the offered sizes of the models it names and of its supplier. */
  offered: SupplierOrderSku[];
}

/** A line of a reception. */
export interface ReceptionLineView {
  id: string;
  sku: SupplierOrderSku;
  /** On the supplier order (false: an extra size). */
  onOrder: boolean;
  accepted: number;
  rejected: number;
  issued: number;
  note: string | null;
}

/** A run of cards: its pieces still to print (sealed), and those printed already. */
export interface CardRun {
  run: number;
  cards: number;
  sealed: number;
  printed: number;
}

/** A reception as the Logistics page lists it. */
export interface ReceptionView {
  id: string;
  supplierOrder: { id: string; reference: string };
  /** ORBES staff's lists; null in the agent's (the name is on the reception page only). */
  supplierName: string | null;
  location: { id: string; name: string };
  status: string;
  deliveryNote: string | null;
  note: string | null;
  countedAt: Date;
  sentBack: { at: Date; note: string } | null;
  confirmedAt: Date | null;
  lines: ReceptionLineView[];
  accepted: number;
  rejected: number;
  issuing: { issued: number; accepted: number; done: boolean };
  cards: { sealed: number; printed: number; erased: Partial<Record<CardErasedReason, number>>; attachedAt: Date | null; runs: { sheet: CardRun[]; card: CardRun[] } };
}

/** Rejected pieces waiting to go back to their supplier. */
export interface SupplierReturnItem {
  id: string;
  supplierOrder: { id: string; reference: string };
  sku: SupplierOrderSku;
  quantity: number;
  status: string;
}

/** A supplier order on its way to a location (ORBES staff only). */
export interface ExpectedSupplierOrder {
  id: string;
  reference: string;
  supplierName: string;
  location: { id: string; name: string };
  expectedOn: string | null;
  piecesExpected: number;
}

export interface ReceptionsBoard {
  toConfirm: ReceptionView[];
  cardsToPrint: ReceptionView[];
  backToSupplier: SupplierReturnItem[];
  /** ORBES staff only (undefined for the agent): the supplier orders on their way. */
  expected?: ExpectedSupplierOrder[];
  /** The tab's counter: the agent's receptions waiting for ORBES or sent back, and its cards to print; ORBES's receptions to confirm. */
  count: number;
}

export interface ReceptionLineInput {
  skuId: string;
  accepted: number;
  rejected: number;
  note?: string | null;
}

export interface ReceptionInput {
  lines: ReceptionLineInput[];
  deliveryNote?: string | null;
  note?: string | null;
}

/** The cards of a run, and what it skipped. */
export interface PrintedCards {
  file: RenderedCertificates;
  printed: string[];
  skipped: { productId: string; reason: CardErasedReason | 'NOT_PRINTABLE' }[];
}

// ── Checks ─────────────────────────────────────────────────────────────────

function known(id: unknown, err: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw err();
  return id.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only ORBES staff and the logistics agent record a reception.');
}

function cleanText(v: unknown, max: number, label: string, required = false): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw validationError(`${label} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} has at most ${max} characters.`);
  return s;
}

function cleanCount(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > RECEPTION_LIMITS.pieces) throw validationError(`${label} is 0 to ${RECEPTION_LIMITS.pieces} pieces.`);
  return v;
}

function cleanInput(input: ReceptionInput): { lines: { skuId: string; accepted: number; rejected: number; note: string | null }[]; deliveryNote: string | null; note: string | null } {
  if (!input || typeof input !== 'object' || !Array.isArray(input.lines)) throw validationError('Count the pieces of each line.');
  if (input.lines.length > RECEPTION_LIMITS.lines) throw validationError(`A reception holds at most ${RECEPTION_LIMITS.lines} lines.`);
  const lines = input.lines
    .map((l) => ({
      skuId: known(l?.skuId, () => notFound('SKU', 'SKU_NOT_FOUND')),
      accepted: cleanCount(l?.accepted, 'Received OK'),
      rejected: cleanCount(l?.rejected, 'Rejected'),
      note: cleanText(l?.note, RECEPTION_LIMITS.lineNote, 'A line’s note'),
    }))
    .filter((l) => l.accepted + l.rejected > 0);
  if (new Set(lines.map((l) => l.skuId)).size !== lines.length) throw validationError('Each size is one line of the reception.');
  if (lines.length === 0) throw empty();
  const deliveryNote = cleanText(input.deliveryNote, RECEPTION_LIMITS.deliveryNote, 'The delivery note');
  if (deliveryNote?.includes('\n')) throw validationError('The delivery note is one line.');
  return { lines, deliveryNote, note: cleanText(input.note, RECEPTION_LIMITS.note, 'The note') };
}

const dateOf = (d: Date | string | null): string | null => (d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const lockKey = (uuid: string) => Number.parseInt(uuid.replace(/-/g, '').slice(0, 8), 16) | 0;

/** The SKUs named, as the supplier orders name them. */
export async function skusOf(db: Db, ids: readonly string[]): Promise<Map<string, SupplierOrderSku>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('skus as k')
    .innerJoin('models as m', 'm.id', 'k.model_id')
    .select(['k.id', 'k.code', 'k.size_label', 'k.set_aside_at', 'm.id as model_id', 'm.name', 'm.variant_label'])
    .where('k.id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((r) => [r.id, { id: r.id, code: r.code, model: { id: r.model_id, name: r.name }, variant: r.variant_label, sizeLabel: r.size_label, setAside: r.set_aside_at !== null }]));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface ReceptionServiceDeps {
  db: Db;
  audit: AuditService;
  issuance: Pick<IssuanceService, 'inSigningTransaction'>;
  certificates: Pick<CertificateService, 'render'>;
  /** deriveCardClaimKey(config). */
  cardKey: Uint8Array;
  clock?: Clock;
  log?: Logger;
  /** How a claim code is hashed (scrypt, `hashClaimCode`); tests may lower its cost. */
  hashClaim?: (code: string) => Promise<string>;
}

export class ReceptionService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly issuance: Pick<IssuanceService, 'inSigningTransaction'>;
  private readonly certificates: Pick<CertificateService, 'render'>;
  private readonly cardKey: Uint8Array;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly hashClaim: (code: string) => Promise<string>;
  private timers = false;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(deps: ReceptionServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.issuance = deps.issuance;
    this.certificates = deps.certificates;
    this.cardKey = deps.cardKey;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.hashClaim = deps.hashClaim ?? hashClaimCode;
  }

  // ── The worker ───────────────────────────────────────────────────────────

  /** At the process's start (src/server/index.ts): the worker issues what the last process left, then polls. */
  start(): void {
    this.timers = true;
    this.schedule(0);
  }

  /** At the process's close: no new chunk; the one under way commits or rolls back. */
  async stop(): Promise<void> {
    this.timers = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** A reception confirmed: the next chunk at once (without timers, as in tests, nothing). */
  wake(): void {
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (!this.timers) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    let more = false;
    this.running = (async () => {
      try {
        more = (await this.issueChunk()) > 0;
      } catch (e) {
        // SIGNING_UNAVAILABLE and the like: the chunk stays for the next poll.
        this.log.error({ err: { message: (e as Error)?.message, code: (e as DomainError)?.code } }, 'receptions: a chunk of identities could not be issued');
      }
    })();
    await this.running;
    this.running = null;
    this.schedule(more ? RECEPTION_WORKER.nextChunkMs : RECEPTION_WORKER.pollMs);
  }

  /** Every identity the confirmed receptions still owe, chunk after chunk. Returns how many were issued. */
  async issuePending(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.issueChunk();
      if (n === 0) return total;
      total += n;
    }
  }

  /**
   * One chunk (restart-safe: each chunk commits its identities, its movement and the line's `issued` together): up to
   * RECEPTION_ISSUE_CHUNK identities of the first line still owed, the oldest confirmed reception first. Returns how many
   * were issued (0: nothing left). A reception whose lines are all issued (one with rejected pieces only too) gets its
   * `issued_at` here.
   */
  async issueChunk(): Promise<number> {
    const next = await sql<{ id: string; reception_id: string; sku_id: string; accepted: number; issued: number; model_id: string; material: string | null; reference_id: string }>`
      SELECT rl.id, rl.reception_id, rl.sku_id, rl.accepted, rl.issued, k.model_id,
             coalesce(nullif(btrim(m.default_material), ''), nullif(btrim(main.default_material), '')) AS material,
             r.supplier_order_id AS reference_id
        FROM reception_lines rl
        JOIN receptions r ON r.id = rl.reception_id
        JOIN skus k ON k.id = rl.sku_id
        JOIN models m ON m.id = k.model_id
        LEFT JOIN models main ON main.id = m.variant_of
       WHERE r.status = 'CONFIRMED' AND rl.issued < rl.accepted
       ORDER BY r.confirmed_at, r.id, rl.id
       LIMIT 1`.execute(this.db);
    const line = next.rows[0];
    if (!line) {
      await this.finishIssued();
      return 0;
    }
    const k = Math.min(RECEPTION_ISSUE_CHUNK, Number(line.accepted) - Number(line.issued));
    // scrypt on the thread pool, one at a time, outside the transaction (as CertificateService paces it).
    const codes: { code: string; hash: string }[] = [];
    for (let i = 0; i < k; i++) {
      const code = generateClaimCode();
      codes.push({ code, hash: await this.hashClaim(code) });
    }
    const batch = supplierOrderReference(line.reference_id);
    return this.issuance.inSigningTransaction(async (trx, signFirst) => {
      await advisoryXactLock(trx, ADVISORY_LOCK.RECEPTION_LINE, lockKey(line.id));
      const l = await trx.selectFrom('reception_lines').selectAll().where('id', '=', line.id).forUpdate().executeTakeFirstOrThrow();
      const r = await trx.selectFrom('receptions').selectAll().where('id', '=', l.reception_id).executeTakeFirstOrThrow();
      const n = Math.min(codes.length, l.accepted - l.issued);
      if (r.status !== 'CONFIRMED' || n <= 0) return 0;
      if (!line.material) throw conflict('RECEPTION_MATERIAL_MISSING', 'The material of a model of this reception is missing.');
      const now = this.clock();
      const actor: Actor = r.confirmed_by ? { type: 'admin', id: r.confirmed_by } : SYSTEM_ACTOR;
      await lockSku(trx, l.sku_id);
      const notes: AuditRecordInput[] = [];
      for (let i = 0; i < n; i++) {
        const issued = await issueStockIdentity(
          trx,
          signFirst,
          { modelId: line.model_id, skuId: l.sku_id, material: line.material, productionBatch: batch, claimHash: codes[i]!.hash, receptionLineId: l.id },
          { receptionId: r.id },
          actor,
          now,
        );
        notes.push(issued.audit);
        await trx
          .insertInto('card_prints')
          .values({ product_id: issued.product.id, reception_id: r.id, sealed_claim_code: seal(this.cardKey, codes[i]!.code, cardAad(issued.product.id)) })
          .execute();
      }
      await trx.updateTable('reception_lines').set({ issued: l.issued + n }).where('id', '=', l.id).execute();
      await recordMovement(trx, { skuId: l.sku_id, locationId: r.location_id, delta: n, reason: 'RECEIVED', receptionLineId: l.id }, actor, now);
      notes.push(...(await serveWaiting(trx, l.sku_id, r.location_id, actor, now)));
      const left = await trx.selectFrom('reception_lines').select('id').where('reception_id', '=', r.id).whereRef('issued', '<', 'accepted').executeTakeFirst();
      if (!left) notes.push(...(await this.markIssued(trx, r, now)));
      for (const note of notes) await this.audit.record(note, trx);
      return n;
    });
  }

  /** The confirmed receptions with nothing left to issue and no `issued_at` yet (rejected pieces only): issued now. */
  private async finishIssued(): Promise<void> {
    const done = await this.db
      .selectFrom('receptions as r')
      .select('r.id')
      .where('r.status', '=', 'CONFIRMED')
      .where('r.issued_at', 'is', null)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('reception_lines as rl').select('rl.id').whereRef('rl.reception_id', '=', 'r.id').whereRef('rl.issued', '<', 'rl.accepted'))))
      .execute();
    for (const d of done) {
      await inTransaction(this.db, async (tx) => {
        const r = await tx.selectFrom('receptions').selectAll().where('id', '=', d.id).forUpdate().executeTakeFirstOrThrow();
        if (r.issued_at !== null) return;
        for (const note of await this.markIssued(tx, r, this.clock())) await this.audit.record(note, tx);
      });
    }
  }

  private async markIssued(tx: Db, r: ReceptionRow, now: Date): Promise<AuditRecordInput[]> {
    await tx.updateTable('receptions').set({ issued_at: now }).where('id', '=', r.id).execute();
    const issued = await tx.selectFrom('reception_lines').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('issued'), eb.lit(0)).as('n')).where('reception_id', '=', r.id).executeTakeFirstOrThrow();
    return [{ actor: SYSTEM_ACTOR, action: 'reception.issued', targetType: 'reception', targetId: r.id, details: { supplierOrderId: r.supplier_order_id, identities: Number(issued.n) } }];
  }

  // ── The way in ───────────────────────────────────────────────────────────

  /**
   * The supplier order a reception counts against, found by its reference only (SO-7C21A0B9, as the delivery note
   * repeats it): open (SENT, EXPECTED, PARTLY_RECEIVED) and delivering to one of the scope's locations, with its lines
   * without prices; anything else, 404 SUPPLIER_ORDER_NOT_FOUND (« No supplier order SO-… is expected here. »).
   */
  async findForReception(reference: string, scope: LocationScope): Promise<ReceptionOrder> {
    const m = REFERENCE_RE.exec(typeof reference === 'string' ? reference.trim() : '');
    const ref = m ? `SO-${m[1]!.toUpperCase()}` : null;
    const notExpected = () =>
      new DomainError('SUPPLIER_ORDER_NOT_FOUND', 404, ref ? `No supplier order ${ref} is expected here. Check the reference, or ask ORBES.` : 'No supplier order with this reference is expected here. Check the reference, or ask ORBES.');
    if (!m) throw notExpected();
    const rows = await this.db
      .selectFrom('supplier_orders')
      .select(['id', 'location_id'])
      .where(sql<boolean>`replace(id::text, '-', '') LIKE ${`${m[1]!.toLowerCase()}%`}`)
      .where('status', 'in', [...SUPPLIER_ORDER_OPEN])
      .execute();
    const mine = rows.filter((r) => inScope(scope, r.location_id));
    if (mine.length !== 1) throw notExpected();
    return this.linesFor(mine[0]!.id, scope, notExpected);
  }

  /**
   * An open supplier order's lines as a reception counts them (ordered, already received, the expected date), never a
   * price; for the agent, only an order of its locations (404 SUPPLIER_ORDER_NOT_FOUND otherwise).
   */
  async linesFor(supplierOrderId: string, scope: LocationScope, notFoundError: () => DomainError = supplierOrderNotFound): Promise<ReceptionOrder> {
    const id = known(supplierOrderId, notFoundError);
    const o = await this.db
      .selectFrom('supplier_orders as o')
      .innerJoin('suppliers as s', 's.id', 'o.supplier_id')
      .innerJoin('stock_locations as loc', 'loc.id', 'o.location_id')
      .select(['o.id', 'o.status', 'o.location_id', 'o.supplier_id', 'o.expected_on', 's.name as supplier', 'loc.name as location'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!o || !SUPPLIER_ORDER_OPEN.includes(o.status) || !inScope(scope, o.location_id)) throw notFoundError();
    const lines = await this.db.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', id).execute();
    // The sizes a piece not on the order may be: the offered sizes of the models the order names, and of its supplier.
    const offered = await sql<{ id: string }>`
      SELECT k.id FROM skus k
        JOIN models m ON m.id = k.model_id
        LEFT JOIN models main ON main.id = m.variant_of
       WHERE k.set_aside_at IS NULL AND m.active
         AND (k.model_id IN (SELECT k2.model_id FROM supplier_order_lines l JOIN skus k2 ON k2.id = l.sku_id WHERE l.supplier_order_id = ${id})
              OR coalesce(k.supplier_id, m.supplier_id, main.supplier_id) = ${o.supplier_id})`.execute(this.db);
    const skus = await skusOf(this.db, [...lines.map((l) => l.sku_id), ...offered.rows.map((r) => r.id)]);
    const natural = (a: SupplierOrderSku, b: SupplierOrderSku) =>
      a.model.name.localeCompare(b.model.name, 'en', { numeric: true }) || (a.variant ?? '').localeCompare(b.variant ?? '', 'en') || (a.sizeLabel ?? '').localeCompare(b.sizeLabel ?? '', 'en', { numeric: true }) || a.code.localeCompare(b.code);
    return {
      id: o.id,
      reference: supplierOrderReference(o.id),
      supplierName: o.supplier,
      location: { id: o.location_id, name: o.location },
      expectedOn: dateOf(o.expected_on),
      lines: lines
        .map((l) => ({ lineId: l.id, sku: skus.get(l.sku_id)!, ordered: l.quantity, alreadyReceived: l.accepted_quantity + l.rejected_quantity, expected: lineExpected(l) }))
        .sort((a, b) => natural(a.sku, b.sku)),
      offered: offered.rows.map((r) => skus.get(r.id)!).sort(natural),
    };
  }

  /** The supplier orders on their way to a location, or to every location (ORBES staff only: the routes never give it to LOGISTICS). */
  async expected(locationId?: string): Promise<ExpectedSupplierOrder[]> {
    const loc = locationId === undefined ? null : known(locationId, () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND'));
    const rows = await sql<{ id: string; supplier: string; location_id: string; location: string; expected_on: string | null; expected: number }>`
      SELECT o.id, s.name AS supplier, o.location_id, loc.name AS location, o.expected_on,
             coalesce(sum(greatest(0, l.quantity - l.accepted_quantity - l.credited_quantity - l.rest_cancelled_quantity)), 0)::int AS expected
        FROM supplier_orders o
        JOIN suppliers s ON s.id = o.supplier_id
        JOIN stock_locations loc ON loc.id = o.location_id
        LEFT JOIN supplier_order_lines l ON l.supplier_order_id = o.id
       WHERE o.status IN ('SENT', 'EXPECTED', 'PARTLY_RECEIVED') AND (${loc}::uuid IS NULL OR o.location_id = ${loc}::uuid)
       GROUP BY o.id, s.name, loc.name
       ORDER BY o.expected_on NULLS LAST, o.created_at, o.id`.execute(this.db);
    return rows.rows.map((r) => ({
      id: r.id,
      reference: supplierOrderReference(r.id),
      supplierName: r.supplier,
      location: { id: r.location_id, name: r.location },
      expectedOn: dateOf(r.expected_on),
      piecesExpected: Number(r.expected),
    }));
  }

  // ── The count ────────────────────────────────────────────────────────────

  /**
   * A delivery counted against its supplier order (TO_CONFIRM): each size once, its pieces OK and rejected; more pieces
   * than its line expects, or a size not on the order (an offered size), with its line's note. Audited
   * `reception.record` with the counts per SKU.
   */
  async record(supplierOrderId: string, input: ReceptionInput, actor: Actor, scope: LocationScope): Promise<ReceptionView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    const c = cleanInput(input);
    const receptionId = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOpenOrder(tx, id, scope);
      const open = await tx.selectFrom('receptions').select('id').where('supplier_order_id', '=', o.id).where('status', 'in', ['TO_CONFIRM', 'SENT_BACK']).executeTakeFirst();
      if (open) throw receptionOpen();
      const lines = await this.checkedLines(tx, o, c.lines);
      const r = await tx
        .insertInto('receptions')
        .values({ supplier_order_id: o.id, location_id: o.location_id, delivery_note: c.deliveryNote, note: c.note, counted_at: now, counted_by: actor.id!, created_at: now })
        .returningAll()
        .executeTakeFirstOrThrow();
      await tx.insertInto('reception_lines').values(lines.map((l) => ({ reception_id: r.id, ...l }))).execute();
      await this.audit.record(
        { actor, action: 'reception.record', targetType: 'reception', targetId: r.id, details: { supplierOrderId: o.id, reference: supplierOrderReference(o.id), lines: c.lines.map((l) => ({ skuId: l.skuId, accepted: l.accepted, rejected: l.rejected })) } },
        tx,
      );
      return r.id;
    });
    return this.view(receptionId, scope);
  }

  /** A reception counted again (TO_CONFIRM or SENT_BACK → TO_CONFIRM; 409 RECEPTION_CONFIRMED once confirmed). Audited `reception.update`. */
  async update(receptionId: string, input: ReceptionInput, actor: Actor, scope: LocationScope): Promise<ReceptionView> {
    assertStaff(actor);
    const id = known(receptionId, receptionNotFound);
    const c = cleanInput(input);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const peek = await this.peek(tx, id, scope);
      const o = await this.lockOpenOrder(tx, peek.supplier_order_id, scope);
      const r = await tx.selectFrom('receptions').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (r.status === 'CONFIRMED') throw receptionConfirmed();
      const lines = await this.checkedLines(tx, o, c.lines);
      await tx.deleteFrom('reception_lines').where('reception_id', '=', r.id).execute();
      await tx.insertInto('reception_lines').values(lines.map((l) => ({ reception_id: r.id, ...l }))).execute();
      await tx.updateTable('receptions').set({ status: 'TO_CONFIRM', delivery_note: c.deliveryNote, note: c.note, counted_at: now, counted_by: actor.id! }).where('id', '=', r.id).execute();
      await this.audit.record(
        { actor, action: 'reception.update', targetType: 'reception', targetId: r.id, details: { supplierOrderId: o.id, from: r.status, lines: c.lines.map((l) => ({ skuId: l.skuId, accepted: l.accepted, rejected: l.rejected })) } },
        tx,
      );
    });
    return this.view(id, scope);
  }

  /** ORBES sends a reception back to be counted again, with its note (TO_CONFIRM → SENT_BACK). Audited `reception.send_back`. */
  async sendBack(receptionId: string, input: { note: string }, actor: Actor): Promise<ReceptionView> {
    assertStaff(actor);
    const id = known(receptionId, receptionNotFound);
    const note = cleanText(input?.note, RECEPTION_LIMITS.note, 'The note', true)!;
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const peek = await this.peek(tx, id, null);
      await tx.selectFrom('supplier_orders').select('id').where('id', '=', peek.supplier_order_id).forUpdate().executeTakeFirstOrThrow();
      const r = await tx.selectFrom('receptions').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (r.status === 'CONFIRMED') throw receptionConfirmed();
      if (r.status === 'SENT_BACK') throw receptionNotToConfirm();
      await tx.updateTable('receptions').set({ status: 'SENT_BACK', sent_back_at: now, sent_back_by: actor.id!, sent_back_note: note }).where('id', '=', r.id).execute();
      await this.audit.record({ actor, action: 'reception.send_back', targetType: 'reception', targetId: r.id, details: { supplierOrderId: r.supplier_order_id, noted: true } }, tx);
    });
    return this.view(id, null);
  }

  /**
   * ORBES confirms a reception (TO_CONFIRM → CONFIRMED), the supplier order locked first: every model with its material
   * (409 RECEPTION_MATERIAL_MISSING), the order still open (409 SUPPLIER_ORDER_CLOSED); the order's lines counted, the
   * rejected pieces listed TO_RETURN, the order's status settled. The identities are then issued by the worker. Audited
   * `reception.confirm` with the counts.
   */
  async confirm(receptionId: string, actor: Actor): Promise<ReceptionView> {
    assertStaff(actor);
    const id = known(receptionId, receptionNotFound);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const peek = await this.peek(tx, id, null);
      const o = await tx.selectFrom('supplier_orders').selectAll().where('id', '=', peek.supplier_order_id).forUpdate().executeTakeFirstOrThrow();
      const r = await tx.selectFrom('receptions').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (r.status === 'CONFIRMED') throw receptionConfirmed();
      if (r.status === 'SENT_BACK') throw receptionNotToConfirm();
      if (!SUPPLIER_ORDER_OPEN.includes(o.status)) throw supplierOrderClosed();
      const lines = await tx.selectFrom('reception_lines').selectAll().where('reception_id', '=', r.id).forUpdate().execute();
      // Every model of the pieces to issue has its material (the main model's for a variant without one).
      const materials = await sql<{ sku_id: string; material: string | null }>`
        SELECT k.id AS sku_id, coalesce(nullif(btrim(m.default_material), ''), nullif(btrim(main.default_material), '')) AS material
          FROM skus k JOIN models m ON m.id = k.model_id LEFT JOIN models main ON main.id = m.variant_of
         WHERE k.id IN (${sql.join(lines.map((l) => sql`${l.sku_id}::uuid`))})`.execute(tx);
      const skus = await skusOf(tx, lines.map((l) => l.sku_id));
      const missing = lines.find((l) => l.accepted > 0 && !materials.rows.find((m) => m.sku_id === l.sku_id)?.material);
      if (missing) {
        const s = skus.get(missing.sku_id)!;
        throw materialMissing([s.model.name, s.variant].filter((x): x is string => x !== null).join(' · '));
      }
      await tx.updateTable('receptions').set({ status: 'CONFIRMED', confirmed_at: now, confirmed_by: actor.id! }).where('id', '=', r.id).execute();
      for (const l of lines) {
        if (l.supplier_order_line_id) {
          const ol = await tx.selectFrom('supplier_order_lines').selectAll().where('id', '=', l.supplier_order_line_id).forUpdate().executeTakeFirstOrThrow();
          await tx.updateTable('supplier_order_lines').set({ accepted_quantity: ol.accepted_quantity + l.accepted, rejected_quantity: ol.rejected_quantity + l.rejected }).where('id', '=', ol.id).execute();
        }
        if (l.rejected > 0) await tx.insertInto('supplier_returns').values({ supplier_order_id: o.id, reception_id: r.id, sku_id: l.sku_id, quantity: l.rejected, created_at: now }).execute();
      }
      const after = await refreshStatus(tx, o.id, now);
      await tx.updateTable('supplier_orders').set({ updated_at: now }).where('id', '=', o.id).execute();
      await writeJournal(tx, [{ type: 'reception.confirm', entityType: 'supplier_order', entityId: o.id, payload: { id: o.id, reference: supplierOrderReference(o.id), status: after.status, receptionId: r.id } }], now);
      const accepted = lines.reduce((n, l) => n + l.accepted, 0);
      const rejected = lines.reduce((n, l) => n + l.rejected, 0);
      await this.audit.record(
        { actor, action: 'reception.confirm', targetType: 'reception', targetId: r.id, details: { supplierOrderId: o.id, reference: supplierOrderReference(o.id), accepted, rejected, lines: lines.map((l) => ({ skuId: l.sku_id, accepted: l.accepted, rejected: l.rejected })), status: after.status } },
        tx,
      );
    });
    this.wake();
    return this.view(id, null);
  }

  // ── The cards ────────────────────────────────────────────────────────────

  /**
   * A run of a reception's cards (`layout` 'sheet': blocks of 48, A4 sheets of eight; 'card': blocks of 50, one per
   * page), once every identity is issued (409 RECEPTION_ISSUING) and before the cards are attached (409 CARDS_ATTACHED).
   * Each sealed code opened and drawn through CertificateService.render; a code replaced, a piece registered or a sealed
   * copy that no longer opens is skipped and erased (REPLACED, REGISTERED, UNREADABLE); a piece not printable (lost,
   * retired…) is skipped. Audited `card.print`.
   */
  async printCards(receptionId: string, input: { layout: CertificateLayout; run?: number }, actor: Actor, scope: LocationScope): Promise<PrintedCards> {
    assertStaff(actor);
    const id = known(receptionId, receptionNotFound);
    const layout = input?.layout;
    if (layout !== 'card' && layout !== 'sheet') throw validationError('Print A4 sheets (sheet) or one per page (card).');
    const run = input?.run ?? 1;
    if (!Number.isInteger(run) || run < 1) throw validationError('A run is 1 or more.');
    const r = await this.peek(this.db, id, scope);
    if (r.status !== 'CONFIRMED') throw receptionNotConfirmed();
    if (r.issued_at === null) throw issuing();
    if (r.cards_attached_at !== null) throw cardsAttached();
    const size = RECEPTION_RUNS[layout];
    const all = await this.cardRows(this.db, id);
    const block = all.slice((run - 1) * size, run * size);
    if (block.length === 0) throw validationError(`This reception has ${Math.ceil(all.length / size)} runs of ${size} cards.`);
    const skipped: PrintedCards['skipped'] = [];
    const erase = async (productUuid: string, reason: CardErasedReason) => {
      await this.db
        .updateTable('card_prints')
        .set({ sealed_claim_code: null, erased_at: this.clock(), erased_reason: reason })
        .where('product_id', '=', productUuid)
        .where('erased_at', 'is', null)
        .execute();
    };
    const renewed = new Set(
      (await this.db.selectFrom('claim_code_renewals').select('product_id').where('product_id', 'in', block.map((b) => b.product_id)).execute()).map((x) => x.product_id),
    );
    let items: { uuid: string; productId: string; claimCode: string }[] = [];
    for (const b of block) {
      if (b.sealed_claim_code === null) continue;
      if (b.registered) {
        await erase(b.product_id, 'REGISTERED');
        skipped.push({ productId: b.reference, reason: 'REGISTERED' });
        continue;
      }
      if (renewed.has(b.product_id)) {
        await erase(b.product_id, 'REPLACED');
        skipped.push({ productId: b.reference, reason: 'REPLACED' });
        continue;
      }
      if (NOT_PRINTABLE.has(b.status)) {
        skipped.push({ productId: b.reference, reason: 'NOT_PRINTABLE' });
        continue;
      }
      let code: string;
      try {
        code = openText(this.cardKey, b.sealed_claim_code, cardAad(b.product_id));
      } catch (e) {
        if (!(e instanceof SecretboxError)) throw e;
        await erase(b.product_id, 'UNREADABLE');
        skipped.push({ productId: b.reference, reason: 'UNREADABLE' });
        continue;
      }
      items.push({ uuid: b.product_id, productId: b.reference, claimCode: code });
    }
    // CertificateService checks each code against the stored hash: one replaced by a path not seen above is erased and
    // the run drawn again without it.
    let file: RenderedCertificates | null = null;
    while (items.length > 0 && file === null) {
      try {
        file = await this.certificates.render(items.map((it) => ({ productId: it.productId, claimCode: it.claimCode })), { format: 'pdf', layout }, actor);
      } catch (e) {
        const refused = e instanceof DomainError && Array.isArray(e.internal?.refused) ? (e.internal.refused as string[]) : null;
        if (!refused || refused.length === 0) throw e;
        for (const ref of refused) {
          const it = items.find((x) => x.productId === ref);
          if (!it) continue;
          if ((e as DomainError).code === 'CLAIM_CODE_MISMATCH') {
            await erase(it.uuid, 'REPLACED');
            skipped.push({ productId: ref, reason: 'REPLACED' });
          } else if ((e as DomainError).code === 'ALREADY_REGISTERED') {
            await erase(it.uuid, 'REGISTERED');
            skipped.push({ productId: ref, reason: 'REGISTERED' });
          } else skipped.push({ productId: ref, reason: 'NOT_PRINTABLE' });
        }
        items = items.filter((x) => !refused.includes(x.productId));
      }
    }
    if (file === null) throw nothingToPrint();
    const now = this.clock();
    await inTransaction(this.db, async (tx) => {
      await tx
        .updateTable('card_prints')
        .set((eb) => ({ printed_count: eb('printed_count', '+', 1), last_printed_at: now }))
        .where('product_id', 'in', items.map((i) => i.uuid))
        .execute();
      await this.audit.record(
        { actor, action: 'card.print', targetType: 'reception', targetId: id, details: { receptionId: id, run, layout, productIds: items.map((i) => i.productId), skipped: skipped.map((s) => ({ productId: s.productId, reason: s.reason })) } },
        tx,
      );
    });
    return { file, printed: items.map((i) => i.productId), skipped };
  }

  /**
   * Every card is with its piece: every sealed copy left is erased (ATTACHED); from then on a lost card needs a new claim
   * code. Only once every identity is issued (409 RECEPTION_ISSUING), once (409 CARDS_ATTACHED). Audited `card.attached`.
   */
  async cardsAttached(receptionId: string, actor: Actor, scope: LocationScope): Promise<ReceptionView> {
    assertStaff(actor);
    const id = known(receptionId, receptionNotFound);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      await this.peek(tx, id, scope);
      const r = await tx.selectFrom('receptions').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (r.status !== 'CONFIRMED') throw receptionNotConfirmed();
      if (r.issued_at === null) throw issuing();
      if (r.cards_attached_at !== null) throw cardsAttached();
      const erased = await tx
        .updateTable('card_prints')
        .set({ sealed_claim_code: null, erased_at: now, erased_reason: 'ATTACHED' })
        .where('reception_id', '=', id)
        .where('erased_at', 'is', null)
        .returning('product_id')
        .execute();
      await tx.updateTable('receptions').set({ cards_attached_at: now, cards_attached_by: actor.id! }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'card.attached', targetType: 'reception', targetId: id, details: { receptionId: id, cards: erased.length } }, tx);
    });
    return this.view(id, scope);
  }

  // ── Back to the supplier ─────────────────────────────────────────────────

  /** Rejected pieces sent back by the agent (TO_RETURN → RETURNED), with an optional carrier and tracking number. Audited `supplier_return.returned`. */
  async supplierReturnSent(supplierReturnId: string, input: { carrierId?: string | null; trackingNumber?: string | null }, actor: Actor, scope: LocationScope): Promise<SupplierReturnItem> {
    assertStaff(actor);
    const id = known(supplierReturnId, returnNotFound);
    const carrierId = input?.carrierId === undefined || input.carrierId === null || input.carrierId === '' ? null : known(input.carrierId, () => notFound('Carrier', 'CARRIER_NOT_FOUND'));
    const tracking = input?.trackingNumber === undefined || input.trackingNumber === null || input.trackingNumber.trim() === '' ? null : input.trackingNumber.trim();
    if (tracking !== null && !TRACKING_RE.test(tracking)) throw validationError('A tracking number has 3 to 40 letters and digits.');
    if (tracking !== null && carrierId === null) throw validationError('A tracking number comes with its carrier.');
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const peek = await tx
        .selectFrom('supplier_returns as x')
        .innerJoin('receptions as r', 'r.id', 'x.reception_id')
        .select(['x.supplier_order_id', 'r.location_id'])
        .where('x.id', '=', id)
        .executeTakeFirst();
      if (!peek || !inScope(scope, peek.location_id)) throw returnNotFound();
      await tx.selectFrom('supplier_orders').select('id').where('id', '=', peek.supplier_order_id).forUpdate().executeTakeFirstOrThrow();
      const x = await tx.selectFrom('supplier_returns').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (x.status !== 'TO_RETURN') throw conflict('SUPPLIER_RETURN_SENT', 'These pieces are already sent back.');
      if (carrierId) {
        const c = await tx.selectFrom('carriers').select('active').where('id', '=', carrierId).executeTakeFirst();
        if (!c || !c.active) throw notFound('Carrier', 'CARRIER_NOT_FOUND');
      }
      await tx.updateTable('supplier_returns').set({ status: 'RETURNED', returned_at: now, returned_by: actor.id!, carrier_id: carrierId, tracking_number: tracking }).where('id', '=', id).execute();
      await this.audit.record(
        { actor, action: 'supplier_return.returned', targetType: 'supplier_order', targetId: x.supplier_order_id, details: { reference: supplierOrderReference(x.supplier_order_id), supplierReturnId: id, skuId: x.sku_id, quantity: x.quantity, ...(carrierId ? { carrierId } : {}) } },
        tx,
      );
    });
    const [item] = await this.returns(this.db, scope, { id });
    return item!;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The Receptions tab: the receptions waiting for ORBES or sent back, those whose cards are to print (the progress of
   * their identities), the rejected pieces to send back; for ORBES staff, the supplier orders on their way too.
   */
  async board(scope: LocationScope, filter: { locationId?: string } = {}): Promise<ReceptionsBoard> {
    const loc = filter.locationId === undefined ? null : known(filter.locationId, () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND'));
    if (loc !== null && !inScope(scope, loc)) throw notFound('Location', 'STOCK_LOCATION_NOT_FOUND');
    const rows = await this.db
      .selectFrom('receptions')
      .select(['id', 'location_id', 'status', 'cards_attached_at'])
      .where((eb) => eb.or([eb('status', 'in', ['TO_CONFIRM', 'SENT_BACK']), eb.and([eb('status', '=', 'CONFIRMED'), eb('cards_attached_at', 'is', null)])]))
      .orderBy('counted_at')
      .orderBy('id')
      .execute();
    const kept = rows.filter((r) => inScope(scope, r.location_id) && (loc === null || r.location_id === loc));
    const views = await Promise.all(kept.map((r) => this.view(r.id, scope)));
    const toConfirm = views.filter((v) => v.status !== 'CONFIRMED');
    const cardsToPrint = views.filter((v) => v.status === 'CONFIRMED');
    const backToSupplier = await this.returns(this.db, scope, { status: 'TO_RETURN', locationId: loc });
    const out: ReceptionsBoard = {
      toConfirm,
      cardsToPrint,
      backToSupplier,
      count: scope === null ? toConfirm.filter((v) => v.status === 'TO_CONFIRM').length : toConfirm.length + cardsToPrint.length,
    };
    if (scope === null) out.expected = await this.expected(loc ?? undefined);
    return out;
  }

  /** One reception (404 RECEPTION_NOT_FOUND, also for a location outside the scope). */
  async view(receptionId: string, scope: LocationScope): Promise<ReceptionView> {
    const id = known(receptionId, receptionNotFound);
    const r = await this.db
      .selectFrom('receptions as r')
      .innerJoin('supplier_orders as o', 'o.id', 'r.supplier_order_id')
      .innerJoin('suppliers as s', 's.id', 'o.supplier_id')
      .innerJoin('stock_locations as loc', 'loc.id', 'r.location_id')
      .selectAll('r')
      .select(['s.name as supplier', 'loc.name as location'])
      .where('r.id', '=', id)
      .executeTakeFirst();
    if (!r || !inScope(scope, r.location_id)) throw receptionNotFound();
    const lines = await this.db.selectFrom('reception_lines').selectAll().where('reception_id', '=', id).orderBy('id').execute();
    const skus = await skusOf(this.db, lines.map((l) => l.sku_id));
    const cards = await this.cardRows(this.db, id);
    const runs = (size: number): CardRun[] => {
      const out: CardRun[] = [];
      for (let i = 0; i < cards.length; i += size) {
        const block = cards.slice(i, i + size);
        out.push({ run: i / size + 1, cards: block.length, sealed: block.filter((b) => b.sealed_claim_code !== null).length, printed: block.filter((b) => b.printed_count > 0).length });
      }
      return out;
    };
    const erased: Partial<Record<CardErasedReason, number>> = {};
    for (const c of cards) if (c.erased_reason) erased[c.erased_reason] = (erased[c.erased_reason] ?? 0) + 1;
    const accepted = lines.reduce((n, l) => n + l.accepted, 0);
    const issued = lines.reduce((n, l) => n + l.issued, 0);
    return {
      id: r.id,
      supplierOrder: { id: r.supplier_order_id, reference: supplierOrderReference(r.supplier_order_id) },
      supplierName: scope === null ? r.supplier : null,
      location: { id: r.location_id, name: r.location },
      status: r.status,
      deliveryNote: r.delivery_note,
      note: r.note,
      countedAt: r.counted_at,
      sentBack: r.sent_back_at ? { at: r.sent_back_at, note: r.sent_back_note! } : null,
      confirmedAt: r.confirmed_at,
      lines: lines.map((l) => ({ id: l.id, sku: skus.get(l.sku_id)!, onOrder: l.supplier_order_line_id !== null, accepted: l.accepted, rejected: l.rejected, issued: l.issued, note: l.note })),
      accepted,
      rejected: lines.reduce((n, l) => n + l.rejected, 0),
      issuing: { issued, accepted, done: r.issued_at !== null },
      cards: {
        sealed: cards.filter((c) => c.sealed_claim_code !== null).length,
        printed: cards.filter((c) => c.printed_count > 0).length,
        erased,
        attachedAt: r.cards_attached_at,
        runs: { sheet: runs(RECEPTION_RUNS.sheet), card: runs(RECEPTION_RUNS.card) },
      },
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** A reception's row (scope checked: 404 outside it), read in `db`. */
  private async peek(db: Db, id: string, scope: LocationScope): Promise<ReceptionRow> {
    const r = await db.selectFrom('receptions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r || !inScope(scope, r.location_id)) throw receptionNotFound();
    return r;
  }

  /** A supplier order a reception may count against, FOR UPDATE: in the scope (404), open (409 SUPPLIER_ORDER_CLOSED), sent (404 for a draft). */
  private async lockOpenOrder(tx: Db, id: string, scope: LocationScope): Promise<SupplierOrderRow> {
    const o = await tx.selectFrom('supplier_orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!o || !inScope(scope, o.location_id) || o.status === 'DRAFT') throw supplierOrderNotFound();
    if (!SUPPLIER_ORDER_OPEN.includes(o.status)) throw supplierOrderClosed();
    return o;
  }

  /** The lines of a count, matched to the order's lines; a note where more than expected, or a size not on the order, came in. */
  private async checkedLines(tx: Db, o: SupplierOrderRow, lines: { skuId: string; accepted: number; rejected: number; note: string | null }[]) {
    const orderLines = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).execute();
    const out: { sku_id: string; supplier_order_line_id: string | null; accepted: number; rejected: number; note: string | null }[] = [];
    for (const l of lines) {
      const ol = orderLines.find((x) => x.sku_id === l.skuId);
      if (!ol) {
        const sku = await tx.selectFrom('skus').select('id').where('id', '=', l.skuId).executeTakeFirst();
        if (!sku) throw notFound('SKU', 'SKU_NOT_FOUND');
        await assertSkuOffered(tx, l.skuId);
        if (l.note === null) throw noteRequired();
      } else if (l.accepted > lineExpected(ol) && l.note === null) throw noteRequired();
      out.push({ sku_id: l.skuId, supplier_order_line_id: ol?.id ?? null, accepted: l.accepted, rejected: l.rejected, note: l.note });
    }
    return out;
  }

  /** A reception's cards in serial order (the runs are cut from it), with what each piece is now. */
  private async cardRows(db: Db, receptionId: string) {
    return db
      .selectFrom('card_prints as cp')
      .innerJoin('products as p', 'p.id', 'cp.product_id')
      .select(['cp.product_id', 'cp.sealed_claim_code', 'cp.printed_count', 'cp.erased_reason', 'p.product_id as reference', 'p.status', 'p.serial', 'p.year'])
      .select(sql<boolean>`(p.ownership_state <> 'UNREGISTERED' OR EXISTS (SELECT 1 FROM ownership w WHERE w.product_id = p.id AND w.ended_at IS NULL))`.as('registered'))
      .where('cp.reception_id', '=', receptionId)
      .orderBy('p.year')
      .orderBy('p.serial')
      .execute();
  }

  /** The rejected pieces of the scope's receptions (one of them). */
  private async returns(db: Db, scope: LocationScope, filter: { id?: string; status?: 'TO_RETURN'; locationId?: string | null }): Promise<SupplierReturnItem[]> {
    let q = db
      .selectFrom('supplier_returns as x')
      .innerJoin('receptions as r', 'r.id', 'x.reception_id')
      .select(['x.id', 'x.supplier_order_id', 'x.sku_id', 'x.quantity', 'x.status', 'r.location_id'])
      .orderBy('x.created_at')
      .orderBy('x.id');
    if (filter.id) q = q.where('x.id', '=', filter.id);
    if (filter.status) q = q.where('x.status', '=', filter.status);
    if (filter.locationId) q = q.where('r.location_id', '=', filter.locationId);
    const rows = (await q.execute()).filter((x) => inScope(scope, x.location_id));
    const skus = await skusOf(db, rows.map((x) => x.sku_id));
    return rows.map((x) => ({ id: x.id, supplierOrder: { id: x.supplier_order_id, reference: supplierOrderReference(x.supplier_order_id) }, sku: skus.get(x.sku_id)!, quantity: x.quantity, status: x.status }));
  }
}

