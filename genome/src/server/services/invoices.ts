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
 *                where it was sold; each add-on as sold; since plan NEXT-NINE, BP-19 T4 and T5, its SHIPPING, a CREDIT
 *                taken off it, negative, and the welcome GIFT travelling with it, at 0: each line read back with its
 *                own kind), the currency, the subtotal and the total; `vat_rate_bp` and
 *                `vat_minor` NULL. A credit note repeats the lines, the buyer and the amounts of the invoice it
 *                cancels, in full, once (`credits_invoice_id`).
 *   engraving    (plan NEXT LOT §3.6.C) an engraving priced from Orders → Settings is an ENGRAVING line (`Engraving`,
 *                never its words) on the invoice issued at PAID; one bought as the release's add-on is already its
 *                ADDON line. Added after PAID, it gets a **supplementary invoice** of its own (`issueSupplementaryInvoice`:
 *                the next INV- number, `supplements_invoice_id` naming the order's invoice, its buyer as issued there);
 *                removed after PAID, a **credit note for that one line** (`issueLineCreditNote`, `credit_scope` LINES:
 *                on the supplementary invoice that carried it, or on the order's invoice). A later cancellation or return
 *                credits every invoice of the order for what is still invoiced (`issueCreditNote`, FULL), never a line
 *                twice. An issued invoice never changes.
 *   history      issued in the transaction of the order's step (services/orders.ts): one entry of the event journal
 *                (`invoice.issue`, `invoice.credit`: the document without its buyer) and one audit entry, with ids,
 *                numbers and amounts, never the buyer's details.
 *   reading      the console's Invoices page (a month's documents, their PDFs, the month's CSV for the accountant; the
 *                buyer masked for an AUDITOR by the routes), an order's page, and its buyer in MY PIECES (the PDFs of
 *                their own orders only: `accountDocument`).
 */
import { sql, type RawBuilder } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, type Db } from '../db/connection.js';
import { INVOICE_KINDS, jsonText, type CreditScope, type InvoiceKind, type JsonObject, type OrderChannel, type OrderRow } from '../db/schema.js';
import { notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { renderInvoicePdf, type InvoiceDocument } from '../render/invoice.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput } from './audit.js';
import { writeJournal } from './journal.js';
import { majorUnits } from './live-console.js';
import { addressOf, orderReference } from './orders.js';
import { countryName } from '../../shared/countries.js';

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
const CHANNEL_WORDS: Readonly<Record<OrderChannel, string>> = Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW', SALON: 'THE PRIVATE SALON', GIFT: 'WELCOME GIFT', EXCHANGE: 'SIZE EXCHANGE' });

/**
 * The kinds of an invoice's lines: the piece, an add-on, and (BP-19) its shipping, a credit taken off it, a welcome gift;
 * (plan NEXT LOT §3.6.C) an engraving priced from Orders → Settings.
 */
export const INVOICE_LINE_KINDS = Object.freeze(['PIECE', 'ADDON', 'SHIPPING', 'CREDIT', 'GIFT', 'ENGRAVING'] as const);
/** An engraving's line: its label only, never its words. */
export const ENGRAVING_LINE_LABEL = 'Engraving';
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

/** The tiers as a free shipping's or a credit's line names them. */
const TIER_WORDS: Readonly<Record<2 | 3, string>> = Object.freeze({ 2: 'PLATINE', 3: 'PALLADIUM' });

/** One line as issued (`invoices.lines`): a CREDIT's amount is negative. */
export interface InvoiceLine {
  kind: InvoiceLineKind;
  label: string;
  detail: string | null;
  amountMinor: number;
}

/**
 * The buyer as issued (`invoices.buyer`): personal data, never in the journal nor the audit log. Since plan NEXT LOT
 * §3.6.B, the delivery address's country, by its English name, printed as the address's last line (`country`; an
 * invoice of before has none and reads as before).
 */
export interface InvoiceBuyer {
  name: string | null;
  address: string | null;
  email: string | null;
  country?: string | null;
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
  /** The credit note that cancels an invoice in full (or what remains of it). */
  creditedBy: { id: string; number: string } | null;
  /** Plan NEXT LOT §3.6.C: a supplementary invoice's main invoice; null otherwise. */
  supplements: { id: string; number: string } | null;
  /** A credit note's scope: FULL (what remains of its invoice) or LINES (single lines); null on an invoice. */
  scope: CreditScope | null;
  /** A FULL credit note of an invoice whose lines were partly credited before: it cancels what remains. */
  remains: boolean;
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
  supplements_invoice_id?: string | null;
  credit_scope?: CreditScope | null;
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
    supplementsInvoiceId: r.supplements_invoice_id ?? null,
    creditScope: r.credit_scope ?? null,
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

/**
 * The next number of a kind in a year and its time of issue, under its lock (held to the commit). The time is the
 * order's clock (read when its transaction began), or the last document's of that kind and year when that is later: a
 * transaction that took the lock after another dated a moment earlier still issues after it, so the numbers and the
 * dates rise together (the accountant's monthly CSV, selected by date, reads them in order).
 */
async function nextSequence(tx: Db, kind: InvoiceKind, year: number, now: Date): Promise<{ sequence: number; issuedAt: Date }> {
  await advisoryXactLock(tx, ADVISORY_LOCK.INVOICE_NUMBER, year * 2 + INVOICE_KINDS.indexOf(kind));
  const r = await tx
    .selectFrom('invoices')
    .select((eb) => [eb.fn.max('sequence').as('n'), eb.fn.max('issued_at').as('last')])
    .where('kind', '=', kind)
    .where('year', '=', year)
    .executeTakeFirst();
  const last = r?.last ? new Date(r.last as Date | string) : null;
  return { sequence: Number(r?.n ?? 0) + 1, issuedAt: last && last.getTime() > now.getTime() ? last : now };
}

/**
 * The invoice of an order reaching PAID, in its transaction (the order's row locked, its price and currency known):
 * the piece and each add-on as sold, billed to the buyer entered on the order and the account's email. Journaled
 * `invoice.issue`; returns the audit entry for the caller to write last. None when the order already has one.
 */
export async function issueInvoice(tx: Db, o: OrderRow, actor: Actor, now: Date): Promise<AuditRecordInput | null> {
  // A welcome gift has no invoice of its own: its order's carries its GIFT line (BP-19 T5).
  if (o.channel === 'GIFT') return null;
  if (o.price_minor === null || o.currency === null) throw new Error(`issueInvoice: order ${o.id} has no price`);
  if (await tx.selectFrom('invoices').select('id').where('order_id', '=', o.id).where('kind', '=', 'INVOICE').where('supplements_invoice_id', 'is', null).executeTakeFirst()) return null;
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
    // Plan NEXT LOT §3.6.C: an engraving priced from the settings (one bought as the release's add-on is its ADDON line).
    ...(o.engraving_minor !== null ? [engravingLine(o.engraving_minor)] : []),
    // BP-19 T4: its shipping, free by its tier or at its fee; an order travelling with another has no line of its own.
    ...(o.shipping_service !== null && o.shipping_minor !== null && o.with_order_id === null
      ? [{ kind: 'SHIPPING' as const, label: `SHIPPING · ${o.shipping_service}`, detail: o.shipping_benefit === 2 || o.shipping_benefit === 3 ? `FREE · ${TIER_WORDS[o.shipping_benefit]}` : null, amountMinor: o.shipping_minor }]
      : []),
  ];
  // BP-19 T5: the credit taken off it (one line per grant, negative), then the welcome gift travelling with it (at 0).
  const credits = await tx
    .selectFrom('credit_uses as u')
    .innerJoin('tier_grants as g', 'g.id', 'u.grant_id')
    .select((eb) => ['g.tier', eb.fn.sum<string>('u.amount_minor').as('amount')])
    .where('u.order_id', '=', o.id)
    .where('u.released_at', 'is', null)
    .groupBy('g.tier')
    .orderBy('g.tier', 'desc')
    .execute();
  for (const c of credits) lines.push({ kind: 'CREDIT', label: `CREDIT · ${TIER_WORDS[c.tier as 2 | 3]}`, detail: null, amountMinor: -Number(c.amount) });
  const gifts = await tx
    .selectFrom('orders as g')
    .innerJoin('models as m', 'm.id', 'g.model_id')
    .select(['g.id', 'm.name', 'm.variant_label'])
    .where('g.with_order_id', '=', o.id)
    .where('g.channel', '=', 'GIFT')
    .where('g.status', '<>', 'CANCELLED')
    .orderBy('g.reserved_at')
    .orderBy('g.id')
    .execute();
  for (const g of gifts) {
    lines.push({ kind: 'GIFT', label: `WELCOME GIFT · ${g.name}${g.variant_label ? ` IN ${g.variant_label.toUpperCase()}` : ''}`, detail: `ORDER ${orderReference(g.id)}`, amountMinor: 0 });
  }
  const total = lines.reduce((n, l) => n + l.amountMinor, 0);
  // The delivery address (plan NEXT LOT §3.6.B): its own, or the order's it travels with, which it is delivered with.
  const delivery = await addressOf(tx, o);
  const buyer: InvoiceBuyer = { name: delivery.name, address: delivery.address, email: facts.email, ...(delivery.country ? { country: countryName(delivery.country) } : {}) };
  const year = now.getUTCFullYear();
  const { sequence, issuedAt } = await nextSequence(tx, 'INVOICE', year, now);
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
      issued_at: issuedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const number = invoiceNumber('INVOICE', year, sequence);
  await writeJournal(tx, [{ type: 'invoice.issue', entityType: 'invoice', entityId: row.id, payload: invoicePayload(row as InvoiceRow, null) }], now);
  return { actor, action: 'invoice.issue', targetType: 'invoice', targetId: row.id, details: { orderId: o.id, number, currency: o.currency, totalMinor: total } };
}

/** The ENGRAVING line of an engraving priced at `minor` (plan NEXT LOT §3.6.C): its label, never its words. */
export function engravingLine(minor: number): InvoiceLine {
  return { kind: 'ENGRAVING', label: ENGRAVING_LINE_LABEL, detail: null, amountMinor: minor };
}

const lineKey = (l: InvoiceLine) => JSON.stringify([l.kind, l.label, l.detail, l.amountMinor]);

/**
 * The lines of an invoice not credited yet: its lines minus those of the credit notes for single lines that credit it
 * (each line once); none once a credit note credits it in full.
 */
async function uncreditedLines(tx: Db, invoice: { id: string; lines: unknown[] }): Promise<InvoiceLine[]> {
  const credits = await tx.selectFrom('invoices').select(['lines', 'credit_scope']).where('credits_invoice_id', '=', invoice.id).execute();
  if (credits.some((c) => c.credit_scope === 'FULL')) return [];
  const taken = new Map<string, number>();
  for (const c of credits) for (const l of linesOf(c.lines as unknown[])) taken.set(lineKey(l), (taken.get(lineKey(l)) ?? 0) + 1);
  const out: InvoiceLine[] = [];
  for (const l of linesOf(invoice.lines)) {
    const k = lineKey(l);
    const n = taken.get(k) ?? 0;
    if (n > 0) taken.set(k, n - 1);
    else out.push(l);
  }
  return out;
}

/** Insert a document (its next number under its lock) and journal it; returns its row and number. */
async function insertDocument(
  tx: Db,
  d: { kind: InvoiceKind; orderId: string; creditsInvoiceId?: string; supplementsInvoiceId?: string; scope?: CreditScope; buyer: unknown; lines: InvoiceLine[]; currency: string; vatRateBp?: number | null; vatMinor?: number | null; totalMinor?: number },
  now: Date,
): Promise<{ row: InvoiceRow; number: string }> {
  const total = d.totalMinor ?? d.lines.reduce((n, l) => n + l.amountMinor, 0);
  const year = now.getUTCFullYear();
  const { sequence, issuedAt } = await nextSequence(tx, d.kind, year, now);
  const row = (await tx
    .insertInto('invoices')
    .values({
      kind: d.kind,
      year,
      sequence,
      order_id: d.orderId,
      credits_invoice_id: d.creditsInvoiceId ?? null,
      supplements_invoice_id: d.supplementsInvoiceId ?? null,
      // Migration 0039: a credit note says what it credits.
      credit_scope: d.kind === 'CREDIT_NOTE' ? (d.scope ?? 'FULL') : null,
      issuer: jsonText({ name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] }),
      buyer: jsonText(d.buyer as JsonObject),
      lines: jsonText(d.lines),
      currency: d.currency,
      subtotal_minor: d.vatMinor ? total - d.vatMinor : total,
      vat_rate_bp: d.vatRateBp ?? null,
      vat_minor: d.vatMinor ?? null,
      total_minor: total,
      issued_at: issuedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as InvoiceRow;
  return { row, number: invoiceNumber(d.kind, year, sequence) };
}

/**
 * The credit notes of an order paid then cancelled or returned, in its transaction (the order's row locked): every
 * invoice of the order, its own and (plan NEXT LOT §3.6.C) its supplementary ones, credited for what is still invoiced
 * (its lines less those already credited one by one), each once (FULL). Journaled `invoice.credit`; returns the audit
 * entries for the caller to write last. None when the order has no invoice (never paid), or nothing is left to credit.
 */
export async function issueCreditNote(tx: Db, o: OrderRow, reason: 'cancel' | 'return', actor: Actor, now: Date): Promise<AuditRecordInput[]> {
  const invoices = await tx.selectFrom('invoices').selectAll().where('order_id', '=', o.id).where('kind', '=', 'INVOICE').orderBy('issued_at').orderBy('sequence').execute();
  const notes: AuditRecordInput[] = [];
  for (const invoice of invoices) {
    const left = await uncreditedLines(tx, invoice as unknown as InvoiceRow);
    if (left.length === 0) continue;
    // A credit note of the whole invoice repeats its amounts as issued (its VAT included); of what remains, the lines' sum.
    const whole = left.length === (invoice.lines as unknown[]).length;
    const { row, number } = await insertDocument(
      tx,
      {
        kind: 'CREDIT_NOTE',
        orderId: o.id,
        creditsInvoiceId: invoice.id,
        scope: 'FULL',
        buyer: invoice.buyer,
        lines: left,
        currency: invoice.currency,
        ...(whole ? { vatRateBp: invoice.vat_rate_bp, vatMinor: invoice.vat_minor, totalMinor: invoice.total_minor } : {}),
      },
      now,
    );
    const credits = invoiceNumber('INVOICE', invoice.year, invoice.sequence);
    await writeJournal(tx, [{ type: 'invoice.credit', entityType: 'invoice', entityId: row.id, payload: invoicePayload(row, credits) }], now);
    notes.push({
      actor,
      action: 'invoice.credit',
      targetType: 'invoice',
      targetId: row.id,
      details: { orderId: o.id, number, credits, reason, currency: row.currency, totalMinor: row.total_minor, ...(whole ? {} : { scope: 'FULL', remains: true }) },
    });
  }
  return notes;
}

/**
 * A supplementary invoice of a PAID order (plan NEXT LOT §3.6.C: an engraving added after payment), in its transaction:
 * the next INV- number, naming the order's invoice (`supplements_invoice_id`), billed to the buyer as issued there, its
 * one line. Journaled `invoice.issue`; returns the audit entry (`supplements`: the invoice's number).
 */
export async function issueSupplementaryInvoice(tx: Db, o: OrderRow, line: InvoiceLine, actor: Actor, now: Date): Promise<AuditRecordInput> {
  const main = await tx.selectFrom('invoices').selectAll().where('order_id', '=', o.id).where('kind', '=', 'INVOICE').where('supplements_invoice_id', 'is', null).executeTakeFirst();
  if (!main) throw new Error(`issueSupplementaryInvoice: order ${o.id} has no invoice`);
  const { row, number } = await insertDocument(tx, { kind: 'INVOICE', orderId: o.id, supplementsInvoiceId: main.id, buyer: main.buyer, lines: [line], currency: main.currency }, now);
  const supplements = invoiceNumber('INVOICE', main.year, main.sequence);
  await writeJournal(tx, [{ type: 'invoice.issue', entityType: 'invoice', entityId: row.id, payload: invoicePayload(row, null) }], now);
  return { actor, action: 'invoice.issue', targetType: 'invoice', targetId: row.id, details: { orderId: o.id, number, currency: row.currency, totalMinor: row.total_minor, supplements } };
}

/**
 * A credit note for one line of an order's invoice (plan NEXT LOT §3.6.C: an engraving removed after payment), in its
 * transaction: the newest invoice of the order still carrying a line of `kind` not credited (a supplementary invoice that
 * carried it, or the order's invoice), that one line credited (`credit_scope` LINES, the next CN- number). Journaled
 * `invoice.credit`; returns the audit entry (`scope: 'LINES'`), or null when no such line is left.
 */
export async function issueLineCreditNote(tx: Db, o: OrderRow, kind: InvoiceLineKind, actor: Actor, now: Date): Promise<AuditRecordInput | null> {
  const invoices = await tx.selectFrom('invoices').selectAll().where('order_id', '=', o.id).where('kind', '=', 'INVOICE').orderBy('issued_at', 'desc').orderBy('sequence', 'desc').execute();
  for (const invoice of invoices) {
    const line = (await uncreditedLines(tx, invoice as unknown as InvoiceRow)).find((l) => l.kind === kind);
    if (!line) continue;
    const { row, number } = await insertDocument(tx, { kind: 'CREDIT_NOTE', orderId: o.id, creditsInvoiceId: invoice.id, scope: 'LINES', buyer: invoice.buyer, lines: [line], currency: invoice.currency }, now);
    const credits = invoiceNumber('INVOICE', invoice.year, invoice.sequence);
    await writeJournal(tx, [{ type: 'invoice.credit', entityType: 'invoice', entityId: row.id, payload: invoicePayload(row, credits) }], now);
    return { actor, action: 'invoice.credit', targetType: 'invoice', targetId: row.id, details: { orderId: o.id, number, credits, reason: 'engraving', scope: 'LINES', currency: row.currency, totalMinor: row.total_minor } };
  }
  return null;
}

// ── Reading ────────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The lines as issued, each known kind read as itself (an unknown stored kind reads as PIECE). */
export function linesOf(raw: unknown[]): InvoiceLine[] {
  return raw.map((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const kind = (INVOICE_LINE_KINDS as readonly unknown[]).includes(x.kind) ? (x.kind as InvoiceLineKind) : 'PIECE';
    return { kind, label: str(x.label) ?? '', detail: str(x.detail), amountMinor: Number(x.amountMinor) || 0 };
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
    supplements: r.supplements_invoice_id && r.supplements_year !== null ? { id: r.supplements_invoice_id, number: invoiceNumber('INVOICE', r.supplements_year, r.supplements_sequence!) } : null,
    scope: r.credit_scope,
    remains: r.credit_scope === 'FULL' && r.credits_total !== null && r.total_minor !== r.credits_total,
    issuer: { name: str(r.issuer.name) ?? INVOICE_ISSUER.name, address: Array.isArray(r.issuer.address) ? r.issuer.address.map(String) : [] },
    buyer: { name: str(r.buyer.name), address: str(r.buyer.address), email: str(r.buyer.email), ...(str(r.buyer.country) ? { country: str(r.buyer.country) } : {}) },
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
    // The credit note that cancels it in full (or what remains): one at most (invoices_full_credit_key).
    .leftJoin('invoices as n', (j) => j.onRef('n.credits_invoice_id', '=', 'i.id').on('n.credit_scope', '=', 'FULL'))
    .leftJoin('invoices as m', 'm.id', 'i.supplements_invoice_id')
    .selectAll('i')
    .select([
      'c.year as credits_year',
      'c.sequence as credits_sequence',
      'c.total_minor as credits_total',
      'n.id as credited_by_id',
      'n.year as credited_by_year',
      'n.sequence as credited_by_sequence',
      'm.year as supplements_year',
      'm.sequence as supplements_sequence',
    ]);
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
    supplements: v.supplements?.number ?? null,
    scope: v.scope,
    remains: v.remains,
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
    // The order's own invoice, and the credit note that cancels it (in full, or what remains); a supplementary invoice
    // and a credit note for single lines are read by their number (`accountDocumentByNumber`).
    const main = this.db
      .selectFrom('invoices as x')
      .select('x.id')
      .where('x.order_id', '=', orderId.toLowerCase())
      .where('x.kind', '=', 'INVOICE')
      .where('x.supplements_invoice_id', 'is', null);
    const row = await this.db
      .selectFrom('invoices as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .select('i.id')
      .where('o.id', '=', orderId.toLowerCase())
      .where('o.account_id', '=', accountId.toLowerCase())
      .where('i.kind', '=', kind)
      .$if(kind === 'INVOICE', (q) => q.where('i.supplements_invoice_id', 'is', null))
      .$if(kind === 'CREDIT_NOTE', (q) => q.where('i.credit_scope', '=', 'FULL').where('i.credits_invoice_id', 'in', main))
      .executeTakeFirst();
    if (!row) throw invoiceNotFound();
    return this.pdf(row.id);
  }

  /**
   * Any document of an order for its own account by its number (plan NEXT LOT §3.6.C: a supplementary invoice, a credit
   * note for single lines; `INV-2026-000003`): 404 INVOICE_NOT_FOUND for another account's order, an unknown number, or
   * a document of another order.
   */
  async accountDocumentByNumber(accountId: string, orderId: string, number: string): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId) || typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw invoiceNotFound();
    const m = typeof number === 'string' ? /^(INV|CN)-(20\d{2})-(\d{6})$/.exec(number.trim().toUpperCase()) : null;
    if (!m) throw invoiceNotFound();
    const row = await this.db
      .selectFrom('invoices as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .select('i.id')
      .where('o.id', '=', orderId.toLowerCase())
      .where('o.account_id', '=', accountId.toLowerCase())
      .where('i.kind', '=', m[1] === 'INV' ? 'INVOICE' : 'CREDIT_NOTE')
      .where('i.year', '=', Number(m[2]))
      .where('i.sequence', '=', Number(m[3]))
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
          [buyer.address, buyer.country].filter(Boolean).join('\n'),
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
