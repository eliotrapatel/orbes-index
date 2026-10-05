/**
 * The Invoices page of the console (plan LIVE RELEASE+, choice 22, The console → Invoices) — pure helpers, no DOM.
 *
 *  - The page's filters read from its query, kept to the values the server takes: a month (`YYYY-MM`, UTC; none: the
 *    server's current one), one kind of document, a number or an order's reference.
 *  - The months it offers: the server's current one and the 23 before it, the latest first, named `October 2026`.
 *  - The words of a document: its kind, what it cancels or what cancels it, its buyer in one line, an amount with its
 *    sign (a month whose credit notes outweigh its invoices nets below zero).
 */
import { formatMoney } from './live.js';
import { INVOICE_KINDS, type Invoice, type InvoiceFilters, type InvoiceKind } from '../types.js';

const MONTH_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The months the page offers: the current one and the 23 before it. */
export const INVOICE_MONTHS = 24;
/** A search, at most (routes/admin/invoices.ts). */
export const INVOICE_SEARCH_MAX = 40;

/** The month (UTC) of an instant: `2026-10`. */
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

/** `2026-10` → `October 2026`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

/** The months offered, the latest first: `current` (`YYYY-MM`) and the INVOICE_MONTHS − 1 before it; `shown` too when older. */
export function invoiceMonths(current: string, shown?: string): string[] {
  const [y, m] = current.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 0; i < INVOICE_MONTHS; i++) out.push(monthOf(new Date(Date.UTC(y, m - 1 - i, 1))));
  if (shown && MONTH_RE.test(shown) && !out.includes(shown)) out.push(shown);
  return out;
}

/** The page's filters from its query: only the values the server takes (no month: the server's current one). */
export function invoiceFilters(query: Record<string, string>): InvoiceFilters {
  const f: InvoiceFilters = {};
  if (MONTH_RE.test(query.month ?? '')) f.month = query.month!;
  if ((INVOICE_KINDS as readonly string[]).includes(query.kind ?? '')) f.kind = query.kind as InvoiceKind;
  const q = (query.q ?? '').trim().slice(0, INVOICE_SEARCH_MAX);
  if (q) f.q = q;
  return f;
}

/** The kinds as the page's filter offers them. */
export const KIND_FILTER_LABELS: Readonly<Record<InvoiceKind, string>> = Object.freeze({ INVOICE: 'Invoices', CREDIT_NOTE: 'Credit notes' });

/** What a document cancels, or what cancels it: `Cancels INV-2026-000001`, `Cancelled by CN-2026-000001`, or ''. */
export function linkedDocument(i: Pick<Invoice, 'credits' | 'creditedBy'>): string {
  if (i.credits) return `Cancels ${i.credits.number}`;
  if (i.creditedBy) return `Cancelled by ${i.creditedBy.number}`;
  return '';
}

/** The buyer in one line: the name entered by Client Services, else the account's email. */
export function buyerLine(i: Pick<Invoice, 'buyer'>): string {
  return i.buyer.name ?? i.buyer.email ?? '—';
}

/** An amount with its sign: `€ 4 950`, `−€ 4 950`. */
export function signedMoney(minor: number, currency: string): string {
  return minor < 0 ? `−${formatMoney(-minor, currency)}` : formatMoney(minor, currency);
}
