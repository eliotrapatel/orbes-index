/**
 * Invoices and credit notes (plan LIVE RELEASE+ of 2026-10-04, choices 20, 21 and 22, M5 to M7; migration 0022): one
 * invoice per order, issued when it is PAID; a credit note when an order paid is cancelled or returned. Issued by
 * CONGLOMERAT LLC, in English, without VAT (the owner's decision: the VAT fields stay in the data, empty).
 *
 *   numbers      in sequence per kind and year of issue (UTC), from 1: `INV-2026-000001`, `CN-2026-000001`; allocated
 *                under a transaction-scoped advisory lock per kind and year (ADVISORY_LOCK.INVOICE_NUMBER), taken
 *                after the order's row and its SKU, before the audit chain's: two orders paid at once never share a
 *                number, and the unique key (kind, year, sequence) holds it anyway. Never reused: an invoice is never
 *                changed nor deleted (migration 0022's trigger); a credit note follows it.
 *   content      as issued, kept unchanged: the issuer (INVOICE_ISSUER), the buyer (the name and address ORBES Client
 *                Services entered on the order, and the account's email), the lines (the piece, its model and size,
 *                where it was sold; each add-on as sold), the currency, the subtotal and the total; `vat_rate_bp` and
 *                `vat_minor` NULL. A credit note repeats the lines, the buyer and the amounts of the invoice it
 *                cancels, in full, once (`credits_invoice_id`).
 *   history      issued in the transaction of the order's step (services/orders.ts): one entry of the event journal
 *                (`invoice.issue`, `invoice.credit`: the document without its buyer) and one audit entry, with ids,
 *                numbers and amounts, never the buyer's details.
 *   reading      the console's Invoices page (a month's documents, their PDFs, the month's CSV for the accountant; the
 *                buyer masked for an AUDITOR by the routes), an order's page, and its buyer in MY PIECES (the PDFs of
 *                their own orders only: `accountDocument`).
 */
import { sql, type RawBuilder } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, type Db } from '../db/connection.js';
import { INVOICE_KINDS, jsonText, type InvoiceKind, type JsonObject, type OrderChannel, type OrderRow } from '../db/schema.js';
import { notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { renderInvoicePdf, type InvoiceDocument } from '../render/invoice.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput } from './audit.js';
import { writeJournal } from './journal.js';
import { majorUnits } from './live-console.js';
import { orderReference } from './orders.js';

/**
 * The issuer of every invoice and credit note: the publisher's legal identity, as the legal notice gives it
 * (web/legal/content/notice.ts LEGAL_IDENTITY; test/services/invoices.test.ts holds the two together).
 */
export const INVOICE_ISSUER = Object.freeze({
  name: 'CONGLOMERAT LLC',
  address: Object.freeze(['30 N Gould St, Ste N', 'Sheridan, WY 82801', 'United States']),
});

/** The prefix of each kind's numbers. */
export const INVOICE_PREFIXES: Readonly<Record<InvoiceKind, string>> = Object.freeze({ INVOICE: 'INV', CREDIT_NOTE: 'CN' });
/** The documents one listing returns, at most (a month's, for the console). */
export const INVOICE_LIST_MAX = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;

/** A document's number: `INV-2026-000001`. */
export function invoiceNumber(kind: InvoiceKind, year: number, sequence: number): string {
  return `${INVOICE_PREFIXES[kind]}-${year}-${String(sequence).padStart(6, '0')}`;
}

/** A month `YYYY-MM` → its first instant and the next month's (UTC); a validation error otherwise. */
export function monthRange(month: unknown): { from: Date; to: Date } {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  if (!m) throw validationError('A month reads YYYY-MM.');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { from: new Date(Date.UTC(y, mo - 1, 1)), to: new Date(Date.UTC(y, mo, 1)) };
}

/** The month (UTC) of an instant: `2026-10`. */
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

/** Where a piece was sold, as its invoice line says it beneath the piece. */
const CHANNEL_WORDS: Readonly<Record<OrderChannel, string>> = Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW', SALON: 'THE PRIVATE SALON' });

/** One line as issued (`invoices.lines`). */
export interface InvoiceLine {
  kind: 'PIECE' | 'ADDON';
  label: string;
  detail: string | null;
  amountMinor: number;
}

/** The buyer as issued (`invoices.buyer`): personal data, never in the journal nor the audit log. */
export interface InvoiceBuyer {
  name: string | null;
  address: string | null;
  email: string | null;
}

/** An invoice or a credit note as the console and the account read it. */
export interface InvoiceView {
  id: string;
  kind: InvoiceKind;
  number: string;
  issuedAt: Date;
  order: { id: string; reference: string };
  /** The invoice a credit note cancels. */
  credits: { id: string; number: string } | null;
  /** The credit note that cancels an invoice. */
  creditedBy: { id: string; number: string } | null;
  issuer: { name: string; address: string[] };
  buyer: InvoiceBuyer;
  lines: InvoiceLine[];
  currency: string;
  subtotalMinor: number;
  vatRateBp: number | null;
  vatMinor: number | null;
  totalMinor: number;
}

/** A month's documents for the console, and their totals per currency (a credit note counts against). */
export interface InvoiceList {
  month: string;
  /** The month now (UTC), the latest a page offers. */
  currentMonth: string;
  items: InvoiceView[];
  totals: { currency: string; invoiced: number; credited: number; net: number }[];
}

export interface InvoiceFilter {
  /** `YYYY-MM` (UTC): the current month by default. */
  month?: string;
  kind?: InvoiceKind;
  /** A number (INV-…, CN-…) or an order's reference (OR-…), in part. */
  q?: string;
}

/** How a caller reads the buyer: in clear, or masked (an AUDITOR: routes/admin/serialize.ts). */
export type BuyerView = (b: InvoiceBuyer) => InvoiceBuyer;
const inClear: BuyerView = (b) => b;

interface InvoiceRow {
  id: string;
  kind: InvoiceKind;
  year: number;
  sequence: number;
  order_id: string;
  credits_invoice_id: string | null;
  issuer: JsonObject;
  buyer: JsonObject;
  lines: unknown[];
  currency: string;
  subtotal_minor: number;
  vat_rate_bp: number | null;
  vat_minor: number | null;
  total_minor: number;
  issued_at: Date;
}

/** The document as the event journal says it: its facts and lines, never its buyer. */
export function invoicePayload(r: InvoiceRow, credits: string | null): JsonObject {
  return {
    id: r.id,
    kind: r.kind,
    number: invoiceNumber(r.kind, r.year, r.sequence),
    orderId: r.order_id,
    creditsInvoiceId: r.credits_invoice_id,
    credits,
    issuer: r.issuer,
    lines: r.lines as JsonObject[],
    currency: r.currency,
    subtotalMinor: r.subtotal_minor,
    vatRateBp: r.vat_rate_bp,
    vatMinor: r.vat_minor,
    totalMinor: r.total_minor,
    issuedAt: r.issued_at.toISOString(),
  };
}

// ── Issue (inside the order's transaction) ────────────────────────────────

/** The next number of a kind in a year, under its lock (held to the commit). */
async function nextSequence(tx: Db, kind: InvoiceKind, year: number): Promise<number> {
  await advisoryXactLock(tx, ADVISORY_LOCK.INVOICE_NUMBER, year * 2 + INVOICE_KINDS.indexOf(kind));
  const r = await tx.selectFrom('invoices').select((eb) => eb.fn.max('sequence').as('n')).where('kind', '=', kind).where('year', '=', year).executeTakeFirst();
  return Number(r?.n ?? 0) + 1;
}

/**
 * The invoice of an order reaching PAID, in its transaction (the order's row locked, its price and currency known):
 * the piece and each add-on as sold, billed to the buyer entered on the order and the account's email. Journaled
 * `invoice.issue`; returns the audit entry for the caller to write last. None when the order already has one.
 */
export async function issueInvoice(tx: Db, o: OrderRow, actor: Actor, now: Date): Promise<AuditRecordInput | null> {
  if (o.price_minor === null || o.currency === null) throw new Error(`issueInvoice: order ${o.id} has no price`);
  if (await tx.selectFrom('invoices').select('id').where('order_id', '=', o.id).where('kind', '=', 'INVOICE').executeTakeFirst()) return null;
  const facts = await tx
    .selectFrom('orders as o')
    .innerJoin('models as m', 'm.id', 'o.model_id')
    .innerJoin('accounts as a', 'a.id', 'o.account_id')
    .leftJoin('drops as d', 'd.id', 'o.drop_id')
    .select(['m.name as model', 'a.email', 'd.title as release'])
    .where('o.id', '=', o.id)
    .executeTakeFirstOrThrow();
  const size = o.size_label ? ` · SIZE ${o.size_label}` : o.sku_id !== null ? ' · ONE SIZE' : '';
  const lines: InvoiceLine[] = [
    { kind: 'PIECE', label: `${facts.model}${size}`, detail: [CHANNEL_WORDS[o.channel], facts.release].filter(Boolean).join(' · '), amountMinor: o.price_minor },
    ...o.addons.map((a): InvoiceLine => ({ kind: 'ADDON', label: a.label, detail: null, amountMinor: a.priceMinor })),
  ];
  const total = lines.reduce((n, l) => n + l.amountMinor, 0);
  const buyer: InvoiceBuyer = { name: o.buyer_name, address: o.buyer_address, email: facts.email };
  const year = now.getUTCFullYear();
  const sequence = await nextSequence(tx, 'INVOICE', year);
  const row = await tx
    .insertInto('invoices')
    .values({
      kind: 'INVOICE',
      year,
      sequence,
      order_id: o.id,
      issuer: jsonText({ name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] }),
      buyer: jsonText(buyer),
      lines: jsonText(lines),
      currency: o.currency,
      subtotal_minor: total,
      total_minor: total,
      issued_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const number = invoiceNumber('INVOICE', year, sequence);
  await writeJournal(tx, [{ type: 'invoice.issue', entityType: 'invoice', entityId: row.id, payload: invoicePayload(row as InvoiceRow, null) }], now);
  return { actor, action: 'invoice.issue', targetType: 'invoice', targetId: row.id, details: { orderId: o.id, number, currency: o.currency, totalMinor: total } };
}

/**
 * The credit note of an order paid then cancelled or returned, in its transaction (the order's row locked): its
 * invoice cancelled in full, once. Journaled `invoice.credit`; returns the audit entry for the caller to write last.
 * None when the order has no invoice (never paid) or its invoice is credited already.
 */
export async function issueCreditNote(tx: Db, o: OrderRow, reason: 'cancel' | 'return', actor: Actor, now: Date): Promise<AuditRecordInput | null> {
  const invoice = await tx.selectFrom('invoices').selectAll().where('order_id', '=', o.id).where('kind', '=', 'INVOICE').executeTakeFirst();
  if (!invoice) return null;
  if (await tx.selectFrom('invoices').select('id').where('credits_invoice_id', '=', invoice.id).executeTakeFirst()) return null;
  const year = now.getUTCFullYear();
  const sequence = await nextSequence(tx, 'CREDIT_NOTE', year);
  const row = await tx
    .insertInto('invoices')
    .values({
      kind: 'CREDIT_NOTE',
      year,
      sequence,
      order_id: o.id,
      credits_invoice_id: invoice.id,
      issuer: jsonText({ name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] }),
      buyer: jsonText(invoice.buyer),
      lines: jsonText(invoice.lines),
      currency: invoice.currency,
      subtotal_minor: invoice.subtotal_minor,
      vat_rate_bp: invoice.vat_rate_bp,
      vat_minor: invoice.vat_minor,
      total_minor: invoice.total_minor,
      issued_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const number = invoiceNumber('CREDIT_NOTE', year, sequence);
  const credits = invoiceNumber('INVOICE', invoice.year, invoice.sequence);
  await writeJournal(tx, [{ type: 'invoice.credit', entityType: 'invoice', entityId: row.id, payload: invoicePayload(row as InvoiceRow, credits) }], now);
  return {
    actor,
    action: 'invoice.credit',
    targetType: 'invoice',
    targetId: row.id,
    details: { orderId: o.id, number, credits, reason, currency: invoice.currency, totalMinor: invoice.total_minor },
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function linesOf(raw: unknown[]): InvoiceLine[] {
  return raw.map((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    return { kind: x.kind === 'ADDON' ? 'ADDON' : 'PIECE', label: str(x.label) ?? '', detail: str(x.detail), amountMinor: Number(x.amountMinor) || 0 };
  });
}

/** Rows read with their order, the invoice they credit and the credit note that credits them. */
async function readInvoices(db: Db, where: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>): Promise<InvoiceView[]> {
  const rows = await where(baseQuery(db)).execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    number: invoiceNumber(r.kind, r.year, r.sequence),
    issuedAt: r.issued_at,
    order: { id: r.order_id, reference: orderReference(r.order_id) },
    credits: r.credits_invoice_id && r.credits_year !== null ? { id: r.credits_invoice_id, number: invoiceNumber('INVOICE', r.credits_year, r.credits_sequence!) } : null,
    creditedBy: r.credited_by_id && r.credited_by_year !== null ? { id: r.credited_by_id, number: invoiceNumber('CREDIT_NOTE', r.credited_by_year, r.credited_by_sequence!) } : null,
    issuer: { name: str(r.issuer.name) ?? INVOICE_ISSUER.name, address: Array.isArray(r.issuer.address) ? r.issuer.address.map(String) : [] },
    buyer: { name: str(r.buyer.name), address: str(r.buyer.address), email: str(r.buyer.email) },
    lines: linesOf(r.lines),
    currency: r.currency,
    subtotalMinor: r.subtotal_minor,
    vatRateBp: r.vat_rate_bp,
    vatMinor: r.vat_minor,
    totalMinor: r.total_minor,
  }));
}

function baseQuery(db: Db) {
  return db
    .selectFrom('invoices as i')
    .leftJoin('invoices as c', 'c.id', 'i.credits_invoice_id')
    .leftJoin('invoices as n', 'n.credits_invoice_id', 'i.id')
    .selectAll('i')
    .select(['c.year as credits_year', 'c.sequence as credits_sequence', 'n.id as credited_by_id', 'n.year as credited_by_year', 'n.sequence as credited_by_sequence']);
}

/** An order's documents, the invoice first (the console's order page, MY PIECES). */
export async function orderInvoices(db: Db, orderIds: readonly string[]): Promise<InvoiceView[]> {
  if (orderIds.length === 0) return [];
  return readInvoices(db, (q) => q.where('i.order_id', 'in', [...orderIds]).orderBy('i.issued_at').orderBy('i.kind', 'desc'));
}

/** A document as its PDF prints it, the buyer as the caller reads it. */
export function invoiceDocument(v: InvoiceView, view: BuyerView = inClear): InvoiceDocument {
  return {
    kind: v.kind,
    number: v.number,
    issuedAt: v.issuedAt,
    order: v.order.reference,
    credits: v.credits?.number ?? null,
    issuer: v.issuer,
    buyer: view(v.buyer),
    lines: v.lines.map((l) => ({ label: l.label, detail: l.detail, amountMinor: l.amountMinor })),
    currency: v.currency,
    totalMinor: v.totalMinor,
  };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface InvoiceServiceDeps {
  db: Db;
  clock?: Clock;
}

/** LIKE's own characters, taken literally. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A document's number in SQL, as invoiceNumber writes it (`INV-2026-000001`), for the search. */
function numberSql(kind: string | RawBuilder<unknown>, year: string, sequence: string): RawBuilder<string> {
  const k = typeof kind === 'string' ? sql.ref(kind) : kind;
  return sql<string>`(CASE ${k} WHEN 'INVOICE' THEN ${sql.lit(INVOICE_PREFIXES.INVOICE)} ELSE ${sql.lit(INVOICE_PREFIXES.CREDIT_NOTE)} END) || '-' || ${sql.ref(year)}::text || '-' || lpad(${sql.ref(sequence)}::text, 6, '0')`;
}

export class InvoiceService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: InvoiceServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * A month's invoices and credit notes (UTC; the current one by default), the latest first (INVOICE_LIST_MAX at most);
   * `kind` keeps one kind, `q` a number or an order's reference (in part), both in SQL before the limit. The totals per
   * currency are the whole month's, whatever the list keeps.
   */
  async list(filter: InvoiceFilter = {}): Promise<InvoiceList> {
    const currentMonth = monthOf(this.clock());
    const month = filter.month ?? currentMonth;
    const { from, to } = monthRange(month);
    if (filter.kind !== undefined && !INVOICE_KINDS.includes(filter.kind)) throw validationError('Unknown kind of document.');
    const q = (filter.q ?? '').trim().toUpperCase();
    if (q.length > 40) throw validationError('Search with a number or an order’s reference.');
    const like = `%${likeLiteral(q)}%`;
    const items = await readInvoices(this.db, (b) =>
      b
        .where('i.issued_at', '>=', from)
        .where('i.issued_at', '<', to)
        .$if(filter.kind !== undefined, (x) => x.where('i.kind', '=', filter.kind!))
        .$if(q.length > 0, (x) =>
          x.where((eb) =>
            eb.or([
              eb(numberSql('i.kind', 'i.year', 'i.sequence'), 'like', like),
              eb(sql<string>`'OR-' || upper(left(replace(i.order_id::text, '-', ''), 8))`, 'like', like),
              eb(numberSql(sql.lit('INVOICE'), 'c.year', 'c.sequence'), 'like', like),
            ]),
          ),
        )
        .orderBy('i.issued_at', 'desc')
        .orderBy('i.kind')
        .orderBy('i.sequence', 'desc')
        .limit(INVOICE_LIST_MAX),
    );
    const sums = await this.db
      .selectFrom('invoices')
      .select((eb) => ['currency', 'kind', eb.fn.sum<string>('total_minor').as('total')])
      .where('issued_at', '>=', from)
      .where('issued_at', '<', to)
      .groupBy(['currency', 'kind'])
      .execute();
    const totals = new Map<string, { currency: string; invoiced: number; credited: number; net: number }>();
    for (const r of sums) {
      const t = totals.get(r.currency) ?? { currency: r.currency, invoiced: 0, credited: 0, net: 0 };
      if (r.kind === 'INVOICE') t.invoiced += Number(r.total);
      else t.credited += Number(r.total);
      t.net = t.invoiced - t.credited;
      totals.set(r.currency, t);
    }
    return { month, currentMonth, items, totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)) };
  }

  /** One document (404 INVOICE_NOT_FOUND). */
  async get(invoiceId: string): Promise<InvoiceView> {
    if (typeof invoiceId !== 'string' || !UUID_RE.test(invoiceId)) throw invoiceNotFound();
    const [v] = await readInvoices(this.db, (q) => q.where('i.id', '=', invoiceId.toLowerCase()));
    if (!v) throw invoiceNotFound();
    return v;
  }

  /** A document's PDF, the buyer as the caller reads it. */
  async pdf(invoiceId: string, view: BuyerView = inClear): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    return renderInvoicePdf(invoiceDocument(await this.get(invoiceId), view));
  }

  /**
   * The PDF of an order's invoice or credit note for its own account (MY PIECES, M6): 404 INVOICE_NOT_FOUND for
   * another account's order, an unknown one, or a document it does not have.
   */
  async accountDocument(accountId: string, orderId: string, kind: InvoiceKind): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId) || typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw invoiceNotFound();
    const row = await this.db
      .selectFrom('invoices as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .select('i.id')
      .where('o.id', '=', orderId.toLowerCase())
      .where('o.account_id', '=', accountId.toLowerCase())
      .where('i.kind', '=', kind)
      .executeTakeFirst();
    if (!row) throw invoiceNotFound();
    return this.pdf(row.id);
  }

  /**
   * The month's CSV for the accountant (render/csv.ts: RFC 4180, every field quoted, a formula never run), in order of
   * issue: each document's number, kind, date, order, the invoice it cancels, the buyer (as `view` reads it), the lines,
   * the currency, the subtotal, the VAT rate and amount (empty: no VAT) and the total, as issued: a credit note's are
   * those of the invoice it cancels, its kind saying they are credited (a leading minus would open as text, csvField).
   */
  async csv(month: string, view: BuyerView = inClear): Promise<{ filename: string; contentType: string; body: string }> {
    const { from, to } = monthRange(month);
    const items = await readInvoices(this.db, (q) => q.where('i.issued_at', '>=', from).where('i.issued_at', '<', to).orderBy('i.issued_at').orderBy('i.kind', 'desc').orderBy('i.sequence'));
    const amount = (minor: number | null) => (minor === null ? '' : majorUnits(minor));
    const header = ['number', 'kind', 'issued at', 'date', 'order', 'cancels', 'issuer', 'buyer name', 'buyer address', 'buyer email', 'lines', 'currency', 'subtotal', 'vat rate', 'vat', 'total'];
    const body = csvDocument([
      header,
      ...items.map((v) => {
        const buyer = view(v.buyer);
        return [
          v.number,
          v.kind,
          v.issuedAt.toISOString(),
          v.issuedAt.toISOString().slice(0, 10),
          v.order.reference,
          v.credits?.number ?? '',
          v.issuer.name,
          buyer.name ?? '',
          buyer.address ?? '',
          buyer.email ?? '',
          v.lines.map((l) => `${l.label} (${majorUnits(l.amountMinor)})`).join('; '),
          v.currency,
          amount(v.subtotalMinor),
          v.vatRateBp === null ? '' : (v.vatRateBp / 100).toFixed(2),
          amount(v.vatMinor),
          amount(v.totalMinor),
        ];
      }),
    ]);
    return { filename: `ORBES-invoices-${month}.csv`, contentType: CSV_CONTENT_TYPE, body };
  }
}

const invoiceNotFound = () => notFound('Invoice', 'INVOICE_NOT_FOUND');
