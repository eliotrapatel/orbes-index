/**
 * Club → Partners (macro scope of 2026-10-20, K49 P1 to P4; lot M4 plan §2.3, step M4.7) — pure helpers, no DOM.
 *
 *  - A partner's dialog (New partner, Edit): the fields of P1 as the form holds them, what the server would refuse
 *    before anything is sent (the bounds of services/partners.ts), the body of a new one and the change of one (only
 *    what changed; a field emptied is cleared).
 *  - An experience's dialog (New experience, Edit): its title, the event's date in Paris, its amount and currency (while
 *    it is a DRAFT only: its invoice says them once issued), its note.
 *  - Who may do what now: OPERATOR records partners and experiences, sets a partner aside or back, cancels a DRAFT,
 *    reads the guests' names and downloads their list; ADMIN issues the invoice, records the payment (or corrects its
 *    date) and cancels an invoiced or paid experience (its credit note issued with it). An AUDITOR reads.
 *  - How the pages say it: amounts per currency, a state, ISSUE THE INVOICE's confirmation naming the number, the
 *    partner and the amount, the guests' line, the circle editor's PARTNER EXPERIENCE choices, Invoices' Partners
 *    documents and Growth's Partner experiences.
 *
 * The server keeps every rule (PartnerService): these only say a refusal before it is asked for.
 */
import { COUNTRY_CODES, countryName } from '../../../shared/countries.js';
import { formatCount } from '../format.js';
import {
  HOUSE_CURRENCIES,
  PARTNER_AMOUNT_MINOR_MAX,
  PARTNER_BILLING_ADDRESS_MAX,
  PARTNER_BRAND_MAX,
  PARTNER_COMPANY_NUMBER_MAX,
  PARTNER_EMAIL_MAX,
  PARTNER_EXPERIENCE_TITLE_MAX,
  PARTNER_NAME_MAX,
  PARTNER_NOTE_MAX,
  PARTNER_PHONE_MAX,
  type AdminRole,
  type HouseCurrency,
  type Partner,
  type PartnerAmount,
  type PartnerExperience,
  type PartnerExperienceCard,
  type PartnerExperienceInput,
  type PartnerExperienceStatus,
  type PartnerGuests,
  type PartnerIncome,
  type PartnerIncomeAmounts,
  type PartnerInput,
  type PartnerInvoice,
  type PartnerInvoiceKind,
  type PartnerInvoiceList,
} from '../types.js';
import { dayText } from './client-profile.js';
import { parisToday } from './guarantees.js';
import { monthLabel } from './invoices.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import { can } from './permissions.js';

/** The bounds the server holds a partner and an experience to (db/schema.ts, services/partners.ts PARTNER_LIMITS). */
export const PARTNER_LIMITS = Object.freeze({
  brand: PARTNER_BRAND_MAX,
  name: PARTNER_NAME_MAX,
  email: PARTNER_EMAIL_MAX,
  phone: PARTNER_PHONE_MAX,
  billingAddress: PARTNER_BILLING_ADDRESS_MAX,
  companyNumber: PARTNER_COMPANY_NUMBER_MAX,
  note: PARTNER_NOTE_MAX,
  title: PARTNER_EXPERIENCE_TITLE_MAX,
  amountMinor: PARTNER_AMOUNT_MINOR_MAX,
});

/** The words of the partners' pages. */
export const PARTNERS_TEXT = Object.freeze({
  title: 'Partners',
  eyebrow: 'Clients · Club',
  lead: 'The brands that pay ORBES for an experience offered to the circle: their details, their experiences, the invoices ORBES issues them in their own series (P-, PC-), and the guests who chose to share their name. A partner pays by transfer, outside the platform.',
  empty: 'No partner yet.',
  newPartner: 'New partner',
  edit: 'Edit',
  setAside: 'Set aside',
  reinstate: 'Reinstate',
  allPartners: 'All partners',
  circle: 'Circle',
  experiences: 'Experiences',
  noExperience: 'No experience yet.',
  newExperience: 'New experience',
  setAsideNote: 'Set aside: reinstate it to record an experience.',
  issue: 'Issue the invoice',
  issueTitle: 'ISSUE THE INVOICE',
  recordPayment: 'Record payment',
  recordPaymentTitle: 'RECORD PAYMENT',
  correctPayment: 'Correct the payment date',
  correctPaymentTitle: 'CORRECT THE PAYMENT DATE',
  cancel: 'Cancel the experience',
  cancelTitle: 'CANCEL THE EXPERIENCE',
  invitations: 'Invitations',
  noInvitation: 'No invitation yet. In Club → Circle, an invitation of a partner experience names this one in its PARTNER EXPERIENCE field.',
  guests: 'Guests for the partner',
  guestsLead: 'Every YES to its invitations is counted; only the guests who ticked « Share my name » are named. ORBES sends the list: the platform sends nothing to a partner.',
  noName: 'No guest has shared their name.',
  namesHidden: 'The names are read by an OPERATOR or an ADMIN.',
  download: 'Download the list',
  maskedNote: 'Masked for an AUDITOR.',
});

// ── A partner's dialog ─────────────────────────────────────────────────────

/** The billing country's choices: Not set, then every country by its English name. */
export function billingCountryOptions(): { value: string; label: string }[] {
  return [{ value: '', label: 'Not set' }, ...[...COUNTRY_CODES].sort((a, b) => countryName(a).localeCompare(countryName(b), 'en')).map((c) => ({ value: c, label: countryName(c) }))];
}

/** The dialog's values of a partner: its own, or a new one's. */
export function partnerFormValues(p: Pick<Partner, 'brand' | 'contact' | 'billing' | 'note'> | null): Record<string, string> {
  return {
    brand: p?.brand ?? '',
    contactName: p?.contact.name ?? '',
    contactEmail: p?.contact.email ?? '',
    contactPhone: p?.contact.phone ?? '',
    billingName: p?.billing.name ?? '',
    billingAddress: p?.billing.address ?? '',
    billingCountry: p?.billing.country ?? '',
    companyNumber: p?.billing.companyNumber ?? '',
    note: p?.note ?? '',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const chars = (s: string) => [...s].length;

/** What the server would refuse in a partner's values, said before anything is sent; null when they hold. */
export function partnerProblem(v: Record<string, string>): string | null {
  const brand = (v.brand ?? '').trim();
  if (!brand) return 'Give the partner its brand.';
  if (chars(brand) > PARTNER_LIMITS.brand) return `A brand has at most ${PARTNER_LIMITS.brand} characters.`;
  if (chars((v.contactName ?? '').trim()) > PARTNER_LIMITS.name) return `A contact name has at most ${PARTNER_LIMITS.name} characters.`;
  const email = (v.contactEmail ?? '').trim();
  if (email && (!EMAIL_RE.test(email) || chars(email) > PARTNER_LIMITS.email)) return 'Enter a valid email address.';
  if (chars((v.contactPhone ?? '').trim()) > PARTNER_LIMITS.phone) return `A phone has at most ${PARTNER_LIMITS.phone} characters.`;
  if (chars((v.billingName ?? '').trim()) > PARTNER_LIMITS.name) return `A billing name has at most ${PARTNER_LIMITS.name} characters.`;
  if (chars((v.billingAddress ?? '').trim()) > PARTNER_LIMITS.billingAddress) return `A billing address has at most ${formatCount(PARTNER_LIMITS.billingAddress)} characters.`;
  const country = (v.billingCountry ?? '').trim();
  if (country && !COUNTRY_CODES.includes(country)) return 'Choose the billing country in the list.';
  if (chars((v.companyNumber ?? '').trim()) > PARTNER_LIMITS.companyNumber) return `A company number has at most ${PARTNER_LIMITS.companyNumber} characters.`;
  if (chars((v.note ?? '').trim()) > PARTNER_LIMITS.note) return `A note has at most ${formatCount(PARTNER_LIMITS.note)} characters.`;
  return null;
}

/** A field as sent: trimmed; empty is null (cleared). */
const optional = (s: string | undefined): string | null => {
  const t = (s ?? '').replace(/\r\n?/g, '\n').trim();
  return t === '' ? null : t;
};

/** The body of a new partner (POST /api/admin/partners), from values partnerProblem accepted: the fields given only. */
export function partnerInput(v: Record<string, string>): PartnerInput {
  const out: PartnerInput = { brand: (v.brand ?? '').trim() };
  const fields = ['contactName', 'contactEmail', 'contactPhone', 'billingName', 'billingAddress', 'billingCountry', 'companyNumber', 'note'] as const;
  for (const f of fields) {
    const value = optional(v[f]);
    if (value !== null) out[f] = value;
  }
  return out;
}

/** The fields of a partner that differ from the dialog's values (PATCH /api/admin/partners/:id); {} when nothing changed. */
export function partnerChange(p: Pick<Partner, 'brand' | 'contact' | 'billing' | 'note'>, v: Record<string, string>): PartnerInput {
  const before: Record<string, string | null> = {
    contactName: p.contact.name,
    contactEmail: p.contact.email,
    contactPhone: p.contact.phone,
    billingName: p.billing.name,
    billingAddress: p.billing.address,
    billingCountry: p.billing.country,
    companyNumber: p.billing.companyNumber,
    note: p.note,
  };
  const out: PartnerInput = {};
  const brand = (v.brand ?? '').trim();
  if (brand !== p.brand) out.brand = brand;
  for (const [f, was] of Object.entries(before) as [keyof Omit<PartnerInput, 'brand'>, string | null][]) {
    const now = optional(v[f]);
    if (now !== was) out[f] = now;
  }
  return out;
}

// ── An experience's dialog ─────────────────────────────────────────────────

/** The dialog's values of an experience: its own, or a new one's (in euros, no date yet). */
export function experienceFormValues(e: Pick<PartnerExperience, 'title' | 'eventOn' | 'amountMinor' | 'currency' | 'note'> | null): Record<string, string> {
  return {
    title: e?.title ?? '',
    eventOn: e?.eventOn ?? '',
    amount: e ? moneyField(e.amountMinor) : '',
    currency: e?.currency ?? 'EUR',
    note: e?.note ?? '',
  };
}

const DAY_RE = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDay = (s: string) => DAY_RE.test(s) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;

/** What the server would refuse in an experience's values; `amount` false when the amount and currency are not asked (not a DRAFT). */
export function experienceProblem(v: Record<string, string>, opts: { amount: boolean } = { amount: true }): string | null {
  const title = (v.title ?? '').trim();
  if (!title) return 'Give the experience its title.';
  if (chars(title) > PARTNER_LIMITS.title) return `A title has at most ${PARTNER_LIMITS.title} characters.`;
  if (!isDay((v.eventOn ?? '').trim())) return 'Choose the event’s date (in Paris).';
  if (opts.amount) {
    const minor = parseMoney(v.amount);
    if (minor === null || minor < 1 || minor > PARTNER_LIMITS.amountMinor) return `The amount is from 0.01 to ${formatCount(PARTNER_LIMITS.amountMinor / 100)}, as 12000 or 12000.50.`;
    if (!(HOUSE_CURRENCIES as readonly string[]).includes(v.currency ?? '')) return `Choose its currency: ${HOUSE_CURRENCIES.join(', ')}.`;
  }
  if (chars((v.note ?? '').trim()) > PARTNER_LIMITS.note) return `A note has at most ${formatCount(PARTNER_LIMITS.note)} characters.`;
  return null;
}

/** The body of a new experience (POST /api/admin/partners/:id/experiences), from values experienceProblem accepted. */
export function experienceInput(v: Record<string, string>): { title: string; eventOn: string; amountMinor: number; currency: HouseCurrency; note?: string | null } {
  const note = optional(v.note);
  return { title: v.title.trim(), eventOn: v.eventOn.trim(), amountMinor: parseMoney(v.amount)!, currency: v.currency as HouseCurrency, ...(note !== null ? { note } : {}) };
}

/** The fields of an experience that differ (PATCH /api/admin/partner-experiences/:id): its amount and currency only while it is a DRAFT. */
export function experienceChange(e: Pick<PartnerExperience, 'title' | 'eventOn' | 'amountMinor' | 'currency' | 'note' | 'status'>, v: Record<string, string>): PartnerExperienceInput {
  const out: PartnerExperienceInput = {};
  const title = (v.title ?? '').trim();
  if (title !== e.title) out.title = title;
  const day = (v.eventOn ?? '').trim();
  if (day !== e.eventOn) out.eventOn = day;
  if (e.status === 'DRAFT') {
    const minor = parseMoney(v.amount);
    if (minor !== null && minor !== e.amountMinor) out.amountMinor = minor;
    if (v.currency && v.currency !== e.currency) out.currency = v.currency as HouseCurrency;
  }
  const note = optional(v.note);
  if (note !== e.note) out.note = note;
  return out;
}

// ── Who may do what ────────────────────────────────────────────────────────

export interface PartnerActions {
  /** New partner, Edit, Set aside, Reinstate. */
  manage: boolean;
  /** New experience: an OPERATOR, for an ACTIVE partner. */
  newExperience: boolean;
}

export function partnerActions(p: Pick<Partner, 'active'> | null, role: AdminRole | null | undefined): PartnerActions {
  const manage = can(role, 'managePartners');
  return { manage, newExperience: manage && (p?.active ?? true) };
}

export interface ExperienceActions {
  /** Its title, date and note (and its amount and currency while a DRAFT), until it is cancelled. */
  edit: boolean;
  /** ISSUE THE INVOICE: an ADMIN, on a DRAFT. */
  issue: boolean;
  /** RECORD PAYMENT on an INVOICED one, or its date corrected on a PAID one: an ADMIN. */
  pay: 'record' | 'correct' | null;
  /** A DRAFT by an OPERATOR; an INVOICED or PAID one by an ADMIN. */
  cancel: boolean;
  /** The guests' names and their list (CSV). */
  guests: boolean;
}

export function experienceActions(e: Pick<PartnerExperience, 'status'>, role: AdminRole | null | undefined): ExperienceActions {
  const operator = can(role, 'managePartners');
  const admin = can(role, 'invoicePartners');
  return {
    edit: operator && e.status !== 'CANCELLED',
    issue: admin && e.status === 'DRAFT',
    pay: admin && e.status === 'INVOICED' ? 'record' : admin && e.status === 'PAID' ? 'correct' : null,
    cancel: e.status === 'DRAFT' ? operator : e.status === 'CANCELLED' ? false : admin,
    guests: operator,
  };
}

// ── Words ──────────────────────────────────────────────────────────────────

export const EXPERIENCE_STATE_LABELS: Readonly<Record<PartnerExperienceStatus, string>> = Object.freeze({ DRAFT: 'Draft', INVOICED: 'Invoiced', PAID: 'Paid', CANCELLED: 'Cancelled' });

/** A partner's state: ACTIVE or SET ASIDE (its tone key). */
export function partnerState(p: Pick<Partner, 'active'>): { key: 'ACTIVE' | 'SET_ASIDE'; label: string } {
  return p.active ? { key: 'ACTIVE', label: 'Active' } : { key: 'SET_ASIDE', label: 'Set aside' };
}

/** Amounts per currency in one line, in the house's order: `€ 12 000 · £ 3 000`; '—' without any. */
export function amountsText(list: readonly PartnerAmount[]): string {
  const of = HOUSE_CURRENCIES.flatMap((c) => list.filter((a) => a.currency === c && a.amountMinor !== 0));
  return of.length ? of.map((a) => (a.amountMinor < 0 ? `−${formatMoney(-a.amountMinor, a.currency)}` : formatMoney(a.amountMinor, a.currency))).join(' · ') : '—';
}

/** An amount to the cent, as an invoice states it: `€ 12 000.00`. */
export function exactMoney(minor: number, currency: string): string {
  const text = formatMoney(minor, currency);
  return minor % 100 === 0 ? `${text}.00` : text;
}

/** An experience's date as the pages write it (a Paris day): `12 NOV 2026`. */
export function eventDay(day: string): string {
  return dayText(day);
}

/** The partner's contact in one line: its name, email and phone, as the caller reads them (masked for an AUDITOR). */
export function contactLine(p: Pick<Partner, 'contact'>): string {
  const parts = [p.contact.name, p.contact.email, p.contact.phone].filter((x): x is string => !!x);
  return parts.length ? parts.join(' · ') : '—';
}

/** The partner's billing details as its invoice prints them, one line each; null when none is entered. */
export function billingLines(p: Pick<Partner, 'billing'>): string[] {
  return [p.billing.name, ...(p.billing.address ?? '').split('\n'), p.billing.country ? countryName(p.billing.country) : null, p.billing.companyNumber ? `Company number ${p.billing.companyNumber}` : null].filter(
    (x): x is string => !!x && x.trim() !== '',
  );
}

/** What ISSUE THE INVOICE needs that the partner lacks (its billing name, address and country); [] when it has them. */
export function billingMissing(p: Pick<Partner, 'billing'>): string[] {
  return [!p.billing.name ? 'billing name' : null, !p.billing.address ? 'billing address' : null, !p.billing.country ? 'billing country' : null].filter((x): x is string => x !== null);
}

/** One line under an experience's title: what it is now. */
export function experienceLead(e: Pick<PartnerExperience, 'status' | 'invoice' | 'creditNote' | 'paidOn' | 'partner'>): string {
  switch (e.status) {
    case 'DRAFT':
      return `A draft: nothing is invoiced to ${e.partner.brand} yet. An ADMIN issues its invoice.`;
    case 'INVOICED':
      return `Invoiced to ${e.partner.brand} with ${e.invoice?.number ?? 'its invoice'}: waiting for the payment.`;
    case 'PAID':
      return `Paid by ${e.partner.brand} on ${e.paidOn ? eventDay(e.paidOn) : '—'} (Paris).`;
    default:
      return e.creditNote ? `Cancelled: ${e.creditNote.number} cancels ${e.invoice?.number ?? 'its invoice'} in full.` : 'Cancelled before it was invoiced.';
  }
}

/** The invoice number ISSUE THE INVOICE takes next, from this year's partner documents read month by month; null when unknown. */
export function nextInvoiceNumber(lists: readonly Pick<PartnerInvoiceList, 'items'>[], year: number): string {
  let last = 0;
  for (const l of lists) {
    for (const i of l.items) {
      const m = /^P-(\d{4})-(\d+)$/.exec(i.number);
      if (i.kind === 'INVOICE' && m && Number(m[1]) === year) last = Math.max(last, Number(m[2]));
    }
  }
  return `P-${year}-${String(last + 1).padStart(4, '0')}`;
}

/** The months to read, the latest first, for the year's last partner invoice: this one (UTC) back to January. */
export function monthsOfYearSoFar(now: Date): string[] {
  const y = now.getUTCFullYear();
  const out: string[] = [];
  for (let m = now.getUTCMonth(); m >= 0; m--) out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
  return out;
}

/**
 * ISSUE THE INVOICE's confirmation, naming the number, the partner and the amount: « This issues invoice P-2026-0001 to
 * MAISON X for € 12 000.00. An invoice is never changed. » (the next of the series when its number could not be read).
 */
export function issueText(number: string | null, brand: string, amountMinor: number, currency: string): string {
  return `This issues ${number ? `invoice ${number}` : 'the next partner invoice'} to ${brand} for ${exactMoney(amountMinor, currency)}. An invoice is never changed.`;
}

/** CANCEL's words: a DRAFT simply ends; an invoiced or paid one gets its credit note. */
export function cancelText(e: Pick<PartnerExperience, 'status' | 'invoice' | 'amountMinor' | 'currency' | 'partner'>): string {
  if (e.status === 'DRAFT') return 'Nothing was invoiced: the experience ends, and no invitation can be linked to it any more. Its invitations stay as they are.';
  const paid = e.status === 'PAID' ? ' The payment recorded is no longer counted on Growth.' : '';
  return `A credit note in the PC- series is issued at once to ${e.partner.brand}, cancelling ${e.invoice?.number ?? 'its invoice'} in full (${exactMoney(e.amountMinor, e.currency)}). A credit note is never changed.${paid}`;
}

/** The guests' line: `18 guests · 11 names shared`. */
export function guestsLine(g: Pick<PartnerGuests, 'headcount' | 'sharedCount'>): string {
  return `${formatCount(g.headcount)} ${g.headcount === 1 ? 'guest' : 'guests'} · ${formatCount(g.sharedCount)} ${g.sharedCount === 1 ? 'name' : 'names'} shared`;
}

/** RECORD PAYMENT's problem: a Paris day, never after today. */
export function paidOnProblem(day: string, now: Date): string | null {
  const d = (day ?? '').trim();
  if (!isDay(d)) return 'Choose the day the money arrived (in Paris).';
  if (d > parisToday(now)) return 'The money cannot arrive after today.';
  return null;
}

// ── The circle editor's PARTNER EXPERIENCE ─────────────────────────────────

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** An experience as the circle's select names it: `MAISON X · DINNER · 12 NOV`. */
export function experienceOptionLabel(brand: string, e: Pick<PartnerExperienceCard, 'title' | 'eventOn'>): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(e.eventOn);
  const day = m ? `${m[2]} ${MONTHS[Number(m[1]) - 1]}` : e.eventOn;
  return `${brand} · ${e.title} · ${day}`;
}

/**
 * The PARTNER EXPERIENCE select's options: None, then every experience not cancelled, the soonest event first (each
 * partner's, set aside or not); the post's own kept, even cancelled.
 */
export function partnerExperienceOptions(
  partners: readonly { brand: string; experiences: readonly Pick<PartnerExperienceCard, 'id' | 'title' | 'eventOn' | 'status'>[] }[],
  current: { id: string; title: string; eventOn: string; status: PartnerExperienceStatus; partner: { brand: string } } | null,
): { value: string; label: string }[] {
  const all = partners.flatMap((p) => p.experiences.filter((e) => e.status !== 'CANCELLED' || e.id === current?.id).map((e) => ({ brand: p.brand, e })));
  if (current && !all.some((x) => x.e.id === current.id)) all.push({ brand: current.partner.brand, e: current });
  all.sort((a, b) => (a.e.eventOn < b.e.eventOn ? -1 : a.e.eventOn > b.e.eventOn ? 1 : a.brand.localeCompare(b.brand, 'en')));
  return [{ value: '', label: 'None' }, ...all.map(({ brand, e }) => ({ value: e.id, label: `${experienceOptionLabel(brand, e)}${e.status === 'CANCELLED' ? ' (cancelled)' : ''}` }))];
}

// ── Invoices → Partners ────────────────────────────────────────────────────

/** Invoices' switch: the collectors' documents (by default) or the partners'. */
export const INVOICE_ISSUED_TO = ['collectors', 'partners'] as const;
export type InvoiceIssuedTo = (typeof INVOICE_ISSUED_TO)[number];
export const ISSUED_TO_LABELS: Readonly<Record<InvoiceIssuedTo, string>> = Object.freeze({ collectors: 'Collectors', partners: 'Partners' });

/** The switch read from the page's query (`to=partners`); the collectors' otherwise. */
export function invoiceIssuedTo(query: Record<string, string>): InvoiceIssuedTo {
  return query.to === 'partners' ? 'partners' : 'collectors';
}

export const PARTNER_DOCUMENT_LABELS: Readonly<Record<PartnerInvoiceKind, string>> = Object.freeze({ INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note' });

/** What a partner document cancels, or what cancels it; '' for neither. */
export function partnerLinked(i: Pick<PartnerInvoice, 'credits' | 'creditedBy'>): string {
  if (i.credits) return `Cancels ${i.credits.number}`;
  if (i.creditedBy) return `Cancelled by ${i.creditedBy.number}`;
  return '';
}

/** A partner document's experience in one line: `DINNER · 12 NOV 2026`. */
export function partnerDocumentExperience(i: Pick<PartnerInvoice, 'experience'>): string {
  return `${i.experience.title} · ${eventDay(i.experience.eventOn)}`;
}

// ── Growth's Partner experiences ───────────────────────────────────────────

/** Growth's empty Partner experiences. */
export const PARTNER_INCOME_EMPTY = 'No partner invoice in this window.';
/** Its note: per currency, never converted. */
export const PARTNER_INCOME_NOTE = 'Invoiced net of credit notes, paid by its payment date; each currency apart';

export interface PartnerIncomeRow {
  key: string;
  label: string;
  /** The partner's page, on a partner's row. */
  link: string | null;
  currency: HouseCurrency;
  invoiced: string;
  credited: string;
  paid: string;
}

const signed = (minor: number, currency: string) => (minor < 0 ? `−${formatMoney(-minor, currency)}` : formatMoney(minor, currency));

const rowOf = (key: string, label: string, link: string | null, a: PartnerIncomeAmounts): PartnerIncomeRow => ({
  key,
  label,
  link,
  currency: a.currency,
  invoiced: signed(a.netMinor, a.currency),
  credited: formatMoney(a.creditedMinor, a.currency),
  paid: formatMoney(a.paidMinor, a.currency),
});

/** Whether the window holds no partner income at all. */
export function partnerIncomeEmpty(p: PartnerIncome | undefined): boolean {
  return !p || p.total.length === 0;
}

/** The months with partner income, the newest first, a row per currency. */
export function partnerIncomeMonths(p: PartnerIncome): PartnerIncomeRow[] {
  return p.months.flatMap((m) => m.currencies.map((a) => rowOf(`${m.month}-${a.currency}`, monthLabel(m.month), null, a)));
}

/** Each partner over the window, by brand, a row per currency; `link` its page. */
export function partnerIncomeByPartner(p: PartnerIncome, linkOf: (partnerId: string) => string): PartnerIncomeRow[] {
  return p.byPartner.flatMap((x) => x.currencies.map((a) => rowOf(`${x.partnerId}-${a.currency}`, x.brand, linkOf(x.partnerId), a)));
}

/** The window's totals, a figure per currency: `€ 12 000 invoiced · € 8 000 paid`. */
export function partnerIncomeTotals(p: PartnerIncome): string[] {
  return p.total.map((a) => `${signed(a.netMinor, a.currency)} invoiced · ${formatMoney(a.paidMinor, a.currency)} paid`);
}
