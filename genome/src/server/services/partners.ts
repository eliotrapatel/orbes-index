/**
 * Partner-paid experiences (macro scope of 2026-10-20, K49 P1 to P4; lot M4 plan §2.1 and §2.2, step M4.6; migration
 * 0064): a brand pays ORBES for an experience offered to the circle; ORBES records the partner and its deals, invoices
 * it in its own series, records its payment, and gives it the guests who chose to share their name, or the headcount.
 * The partner pays by its own means (a transfer), outside the platform and any store (S1–S7): nothing here is a sale,
 * nothing is sent to a partner (ORBES downloads the guest list and sends it).
 *
 *   partners      `list`, `get`, `create`, `update`, `setAside` / `reinstate` (OPERATOR): the brand (1..80, one line,
 *                 unique whatever the case: 409 PARTNER_BRAND_TAKEN), its contact (name, email, phone), its billing
 *                 details as its invoices print them (name, address, country; the company number printed when given),
 *                 a note; ACTIVE, or SET ASIDE (offered for no new experience). Never deleted.
 *   experiences   `createExperience` (OPERATOR, an ACTIVE partner), `updateExperience` (OPERATOR: the amount and its
 *                 currency while DRAFT only; the title, the date and the note until it is cancelled), its states:
 *                 DRAFT → INVOICED (`issueInvoice`, ADMIN: the next P- number under ADVISORY_LOCK.PARTNER_INVOICE_NUMBER,
 *                 the PDF by render/invoice.ts with the partner as buyer; 409 PARTNER_BILLING_MISSING without the billing
 *                 name, address and country) → PAID (`recordPaid`, ADMIN: the Paris day the money arrived, never after
 *                 today; `correctPaid` changes it, audited with the previous date), or CANCELLED (`cancel`: OPERATOR on a
 *                 DRAFT; ADMIN on an INVOICED or PAID one, its PC- credit note issued in the same transaction). Any other
 *                 move is 409 PARTNER_EXPERIENCE_STATE.
 *   invoices      issued by INVOICE_ISSUER (CONGLOMERAT LLC) to the partner's billing details, one line « Partner
 *                 experience · <title> · <date> », in the experience's currency, without VAT (the house's rule), never
 *                 changed (migration 0064's trigger); numbered per kind and UTC year of issue, P-2026-0001 and
 *                 PC-2026-0001, apart from the collectors' INV- and CN- (P4). Read by month (`invoices`, `invoicesCsv`)
 *                 and one by one (`invoice`, `invoicePdf`).
 *   guests        `guests`: every YES to the experience's invitations (`circle_posts.partner_experience_id`) counted, the
 *                 names of the guests who ticked « Share my name » (P3: the account's first and last name, once per
 *                 account; a locked account's withheld, still counted), the test entrants left out; `guestsCsv`
 *                 (OPERATOR): the headcount line, then the names.
 *   history       audited `partner.create`, `.update`, `.set_aside`, `.reinstate`, `partner.experience.create`,
 *                 `.update`, `.invoice`, `.paid`, `.cancel`, `partner.guests.export` (its counts only, never a name;
 *                 the contact's email and phone, and a note, as whether they are written);
 *                 journaled `partner_invoice.issue` and `partner_invoice.credit` (the document without its buyer, for the
 *                 accounting connection, as `invoice.issue`).
 *
 * GROWTH reads the partners' income (growth.ts partnerIncomeRows), the margin its euros beside it; the circle links its
 * invitations to an experience and takes the guests' choice to share their name (services/circle.ts). The routes
 * (routes/admin/partners.ts) mask the contact's email and phone for an AUDITOR and give the guests' names to OPERATOR
 * and ADMIN only.
 */
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  HOUSE_CURRENCIES,
  jsonText,
  PARTNER_AMOUNT_MINOR_MAX,
  PARTNER_BILLING_ADDRESS_MAX,
  PARTNER_BRAND_MAX,
  PARTNER_COMPANY_NUMBER_MAX,
  PARTNER_EMAIL_MAX,
  PARTNER_EXPERIENCE_TITLE_MAX,
  PARTNER_INVOICE_KINDS,
  PARTNER_NAME_MAX,
  PARTNER_NOTE_MAX,
  PARTNER_PHONE_MAX,
  type HouseCurrency,
  type JsonObject,
  type PartnerExperienceStatus,
  type PartnerInvoiceKind,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { renderInvoicePdf, type InvoiceDocument } from '../render/invoice.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import { countryName, isCountryCode } from '../../shared/countries.js';
import type { AuditService } from './audit.js';
import { INVOICE_ISSUER, monthOf, monthRange } from './invoices.js';
import { writeJournal } from './journal.js';
import { majorUnits } from './live-console.js';
import { notTestEntrant } from './population.js';
import { parisDay } from './schedule.js';

// ── Rules ──────────────────────────────────────────────────────────────────

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

/** The prefix of each kind's numbers (P4): apart from the collectors' INV- and CN-. */
export const PARTNER_INVOICE_PREFIXES: Readonly<Record<PartnerInvoiceKind, string>> = Object.freeze({ INVOICE: 'P', CREDIT_NOTE: 'PC' });
/** The figures of a number's sequence, at least (P4: « P-2026-0001 »). */
export const PARTNER_INVOICE_DIGITS = 4;
/** The kind of a partner invoice's one line. */
export const PARTNER_LINE_KIND = 'PARTNER_EXPERIENCE';
/** The words of a partner invoice's one line, before its title and date. */
export const PARTNER_LINE_LABEL = 'Partner experience';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^(20\d{2})-(\d{2})-(\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** A partner document's number: `P-2026-0001`, `PC-2026-0001` (more figures past 9 999). */
export function partnerInvoiceNumber(kind: PartnerInvoiceKind, year: number, sequence: number): string {
  return `${PARTNER_INVOICE_PREFIXES[kind]}-${year}-${String(sequence).padStart(PARTNER_INVOICE_DIGITS, '0')}`;
}

/** An experience's date as its invoice line says it: `12 November 2026`. */
export function experienceDate(day: string): string {
  const m = DAY_RE.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** The one line of an experience's invoice (P1): « Partner experience · DINNER · 12 November 2026 ». */
export function partnerLine(title: string, eventOn: string, amountMinor: number): PartnerInvoiceLine {
  return { kind: PARTNER_LINE_KIND, label: `${PARTNER_LINE_LABEL} · ${title} · ${experienceDate(eventOn)}`, detail: null, amountMinor };
}

/** Text as the console types it: trimmed; one line unless `lines`; 1 to `max` characters; '' or null clears an optional one. */
function cleanText(v: unknown, max: number, label: string, opts: { lines?: boolean; required?: boolean } = {}): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw validationError(`${label} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = opts.lines ? v.replace(/\r\n?/g, '\n').trim() : v.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(s) || (!opts.lines && s.includes('\n'))) throw validationError(`${label} contains invalid characters.`);
  if ([...s].length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

/** A calendar day `YYYY-MM-DD` (from 2000 to 2099), checked. */
function cleanDay(v: unknown, label: string): string {
  const m = typeof v === 'string' ? DAY_RE.exec(v.trim()) : null;
  const d = m ? new Date(`${v as string}T00:00:00.000Z`) : null;
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== (v as string).trim()) throw validationError(`${label} is a date, YYYY-MM-DD.`);
  return (v as string).trim();
}

function cleanAmount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > PARTNER_AMOUNT_MINOR_MAX) {
    throw validationError(`The amount is a whole number of cents from 1 to ${PARTNER_AMOUNT_MINOR_MAX}.`);
  }
  return v;
}

function cleanHouseCurrency(v: unknown): HouseCurrency {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!(HOUSE_CURRENCIES as readonly string[]).includes(c)) throw validationError(`The currency is one of ${HOUSE_CURRENCIES.join(', ')}.`);
  return c as HouseCurrency;
}

function assertStaff(actor: Actor, what: string): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
}

/** An id as the routes pass it; anything else is the same 404 as an unknown one. */
function known(id: string, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

// ── Errors ─────────────────────────────────────────────────────────────────

export const partnerNotFound = () => notFound('Partner', 'PARTNER_NOT_FOUND');
export const partnerExperienceNotFound = () => notFound('Partner experience', 'PARTNER_EXPERIENCE_NOT_FOUND');
export const partnerExperienceState = (message: string) => conflict('PARTNER_EXPERIENCE_STATE', message);
const brandTaken = () => conflict('PARTNER_BRAND_TAKEN', 'Another partner has this brand.');
const billingMissing = () => conflict('PARTNER_BILLING_MISSING', 'Enter the partner’s billing name, address and country before issuing its invoice.');
const partnerInvoiceNotFound = () => notFound('Partner invoice', 'PARTNER_INVOICE_NOT_FOUND');

const STATE_WORDS: Readonly<Record<PartnerExperienceStatus, string>> = Object.freeze({ DRAFT: 'a draft', INVOICED: 'invoiced', PAID: 'paid', CANCELLED: 'cancelled' });

// ── Views ──────────────────────────────────────────────────────────────────

/** An amount in a currency. */
export interface PartnerAmount {
  currency: HouseCurrency;
  amountMinor: number;
}

/** A partner as the console reads it (the routes mask the contact's email and phone for an AUDITOR). */
export interface PartnerView {
  id: string;
  brand: string;
  contact: { name: string | null; email: string | null; phone: string | null };
  /** As its invoices print them; `country` ISO 3166-1 alpha-2. */
  billing: { name: string | null; address: string | null; country: string | null; companyNumber: string | null };
  note: string | null;
  /** false: SET ASIDE, offered for no new experience. */
  active: boolean;
  /** Its experiences, every state. */
  experienceCount: number;
  /** Its invoices less its credit notes, per currency. */
  invoiced: PartnerAmount[];
  /** Its experiences PAID, per currency. */
  paid: PartnerAmount[];
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
  updatedAt: Date;
}

/** One experience as its partner's page lists it. */
export interface PartnerExperienceCard {
  id: string;
  title: string;
  /** The event's date in Paris, `YYYY-MM-DD`. */
  eventOn: string;
  amountMinor: number;
  currency: HouseCurrency;
  status: PartnerExperienceStatus;
  invoice: { id: string; number: string; issuedAt: Date } | null;
  creditNote: { id: string; number: string; issuedAt: Date } | null;
  /** The Paris day the money arrived (PAID, and a cancelled one that was). */
  paidOn: string | null;
}

/** A partner and its experiences (GET /api/admin/partners/:id). */
export interface PartnerDetail extends PartnerView {
  experiences: PartnerExperienceCard[];
}

/** An invitation of the circle linked to an experience, as the experience's page lists it. */
export interface PartnerInvitation {
  id: string;
  title: string;
  minTier: number;
  segment: { id: string; name: string } | null;
  published: boolean;
  eventAt: Date | null;
  /** Its answers YES, and its places (null: no limit). */
  yes: number;
  capacity: number | null;
}

/** An experience as its page reads it (GET /api/admin/partner-experiences/:id). */
export interface PartnerExperienceView extends PartnerExperienceCard {
  partner: { id: string; brand: string; active: boolean };
  note: string | null;
  invoicedAt: Date | null;
  paidRecordedAt: Date | null;
  paidRecordedBy: { id: string; email: string } | null;
  cancelledAt: Date | null;
  cancelledBy: { id: string; email: string } | null;
  invitations: PartnerInvitation[];
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
  updatedAt: Date;
}

/** One line of a partner invoice, as issued. */
export interface PartnerInvoiceLine {
  kind: string;
  label: string;
  detail: string | null;
  amountMinor: number;
}

/** The partner as its invoice bills it, as issued: its billing details at the time; `country` by its English name. */
export interface PartnerBuyer {
  name: string | null;
  address: string | null;
  country: string | null;
  companyNumber: string | null;
}

/** A partner invoice or credit note. */
export interface PartnerInvoiceView {
  id: string;
  kind: PartnerInvoiceKind;
  number: string;
  issuedAt: Date;
  experience: { id: string; title: string; eventOn: string };
  partner: { id: string; brand: string };
  /** The invoice a credit note cancels. */
  credits: { id: string; number: string } | null;
  /** The credit note that cancels an invoice. */
  creditedBy: { id: string; number: string } | null;
  issuer: { name: string; address: string[] };
  buyer: PartnerBuyer;
  lines: PartnerInvoiceLine[];
  currency: HouseCurrency;
  totalMinor: number;
}

/** A month's partner documents (Invoices → Partners), and their totals per currency (a credit note counts against). */
export interface PartnerInvoiceList {
  month: string;
  /** The month now (UTC), the latest a page offers. */
  currentMonth: string;
  items: PartnerInvoiceView[];
  totals: { currency: HouseCurrency; invoiced: number; credited: number; net: number }[];
}

/** An experience's guests for its partner (P3): every YES counted; the names of those who chose to share them. */
export interface PartnerGuests {
  experienceId: string;
  headcount: number;
  sharedCount: number;
  /** By last name then first name; the routes give it to OPERATOR and ADMIN only. */
  shared: { firstName: string; lastName: string }[];
}

/** What a partner is created or changed with; `undefined` leaves a field as it is, `null` (or '') clears an optional one. */
export interface PartnerInput {
  brand?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billingName?: string | null;
  billingAddress?: string | null;
  billingCountry?: string | null;
  companyNumber?: string | null;
  note?: string | null;
}

/** What an experience is created with. */
export interface PartnerExperienceInput {
  title: string;
  /** The event's date in Paris, `YYYY-MM-DD`. */
  eventOn: string;
  amountMinor: number;
  currency: string;
  note?: string | null;
}

export type PartnerExperienceChange = Partial<PartnerExperienceInput>;

// ── Rows ───────────────────────────────────────────────────────────────────

type PartnerColumns = {
  brand?: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  billing_name?: string | null;
  billing_address?: string | null;
  billing_country?: string | null;
  company_number?: string | null;
  note?: string | null;
};

/** The fields of a partner and their columns, in the order an audit entry lists them. */
const PARTNER_FIELDS = [
  ['brand', 'brand'],
  ['contactName', 'contact_name'],
  ['contactEmail', 'contact_email'],
  ['contactPhone', 'contact_phone'],
  ['billingName', 'billing_name'],
  ['billingAddress', 'billing_address'],
  ['billingCountry', 'billing_country'],
  ['companyNumber', 'company_number'],
  ['note', 'note'],
] as const;

/** The columns a partner input sets, checked; only the fields given. */
function partnerColumns(input: PartnerInput, creating: boolean): PartnerColumns {
  const out: PartnerColumns = {};
  if (creating || input.brand !== undefined) out.brand = cleanText(input.brand, PARTNER_BRAND_MAX, 'The brand', { required: true })!;
  if (input.contactName !== undefined) out.contact_name = cleanText(input.contactName, PARTNER_NAME_MAX, 'The contact name');
  if (input.contactEmail !== undefined) {
    const email = cleanText(input.contactEmail, PARTNER_EMAIL_MAX, 'The email');
    if (email !== null && !EMAIL_RE.test(email)) throw validationError('Enter a valid email address.');
    out.contact_email = email;
  }
  if (input.contactPhone !== undefined) out.contact_phone = cleanText(input.contactPhone, PARTNER_PHONE_MAX, 'The phone');
  if (input.billingName !== undefined) out.billing_name = cleanText(input.billingName, PARTNER_NAME_MAX, 'The billing name');
  if (input.billingAddress !== undefined) out.billing_address = cleanText(input.billingAddress, PARTNER_BILLING_ADDRESS_MAX, 'The billing address', { lines: true });
  if (input.billingCountry !== undefined) {
    const c = cleanText(input.billingCountry, 2, 'The billing country');
    const code = c === null ? null : c.toUpperCase();
    if (code !== null && !isCountryCode(code)) throw validationError('The billing country is a country’s two-letter code, such as FR.');
    out.billing_country = code;
  }
  if (input.companyNumber !== undefined) out.company_number = cleanText(input.companyNumber, PARTNER_COMPANY_NUMBER_MAX, 'The company number');
  if (input.note !== undefined) out.note = cleanText(input.note, PARTNER_NOTE_MAX, 'The note', { lines: true });
  return out;
}

interface PartnerRow {
  id: string;
  brand: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_name: string | null;
  billing_address: string | null;
  billing_country: string | null;
  company_number: string | null;
  note: string | null;
  active: boolean;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
}

interface ExperienceRow {
  id: string;
  partner_id: string;
  title: string;
  event_on: string;
  amount_minor: number | string;
  currency: HouseCurrency;
  note: string | null;
  status: PartnerExperienceStatus;
  invoiced_at: Date | null;
  paid_on: string | null;
  paid_recorded_at: Date | null;
  paid_recorded_by: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
}

interface PartnerInvoiceRow {
  id: string;
  kind: PartnerInvoiceKind;
  year: number;
  sequence: number;
  experience_id: string;
  credits_invoice_id: string | null;
  issuer: JsonObject;
  buyer: JsonObject;
  lines: unknown[];
  currency: HouseCurrency;
  total_minor: number | string;
  issued_at: Date;
  issued_by: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** A date column as text (`YYYY-MM-DD`), whichever way the driver reads it. */
const dayText = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const later = (a: Date, b: Date | null): Date => (b && b.getTime() > a.getTime() ? b : a);

/** The lines as issued. */
function linesOf(raw: unknown[]): PartnerInvoiceLine[] {
  return raw.map((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    return { kind: str(x.kind) ?? PARTNER_LINE_KIND, label: str(x.label) ?? '', detail: str(x.detail), amountMinor: Number(x.amountMinor) || 0 };
  });
}

/** The document as the event journal says it: its facts and lines, never its buyer (as `invoice.issue`). */
function journalPayload(r: PartnerInvoiceRow, partnerId: string, credits: string | null): JsonObject {
  return {
    id: r.id,
    kind: r.kind,
    number: partnerInvoiceNumber(r.kind, r.year, r.sequence),
    experienceId: r.experience_id,
    partnerId,
    creditsInvoiceId: r.credits_invoice_id,
    credits,
    issuer: r.issuer,
    lines: r.lines as JsonObject[],
    currency: r.currency,
    totalMinor: Number(r.total_minor),
    issuedAt: r.issued_at.toISOString(),
  };
}

/**
 * The next number of a kind in a year and its time of issue, under its lock (held to the commit); the time is the
 * clock, or the last document's of that kind and year when that is later, so the numbers and the dates rise together
 * (as services/invoices.ts nextSequence).
 */
async function nextSequence(tx: Db, kind: PartnerInvoiceKind, year: number, now: Date): Promise<{ sequence: number; issuedAt: Date }> {
  await advisoryXactLock(tx, ADVISORY_LOCK.PARTNER_INVOICE_NUMBER, year * 2 + PARTNER_INVOICE_KINDS.indexOf(kind));
  const r = await tx
    .selectFrom('partner_invoices')
    .select((eb) => [eb.fn.max('sequence').as('n'), eb.fn.max('issued_at').as('last')])
    .where('kind', '=', kind)
    .where('year', '=', year)
    .executeTakeFirst();
  const last = r?.last ? new Date(r.last as Date | string) : null;
  return { sequence: Number(r?.n ?? 0) + 1, issuedAt: later(now, last) };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface PartnerServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class PartnerService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: PartnerServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Partners ─────────────────────────────────────────────────────────────

  /** Every partner, ACTIVE first, then by brand (whatever the case). */
  async list(): Promise<PartnerView[]> {
    const rows = (await this.db.selectFrom('partners').selectAll().orderBy('active', 'desc').orderBy(sql`lower(brand)`).orderBy('id').execute()) as PartnerRow[];
    return this.partnerViews(this.db, rows);
  }

  /** A partner and its experiences, the latest event first (404 PARTNER_NOT_FOUND). */
  async get(partnerId: string): Promise<PartnerDetail> {
    return this.detail(this.db, known(partnerId, partnerNotFound));
  }

  /** A new partner, ACTIVE (OPERATOR). Audited `partner.create` with its fields. 409 PARTNER_BRAND_TAKEN. */
  async create(input: PartnerInput, actor: Actor): Promise<PartnerDetail> {
    assertStaff(actor, 'record a partner');
    const cols = partnerColumns(input ?? {}, true);
    const now = this.clock();
    return this.uniqueBrand(() =>
      inTransaction(this.db, async (tx) => {
        const row = await tx
          .insertInto('partners')
          .values({ ...cols, brand: cols.brand!, created_by: actor.id!, created_at: now, updated_at: now })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'partner.create', targetType: 'partner', targetId: row.id, details: auditFields(cols) }, tx);
        return this.detail(tx, row.id);
      }),
    );
  }

  /**
   * A partner changed (OPERATOR), under its row lock: only the fields given; a field cleared with null or ''. Audited
   * `partner.update` with each value before and after; nothing changed, nothing written. 409 PARTNER_BRAND_TAKEN.
   */
  async update(partnerId: string, input: PartnerInput, actor: Actor): Promise<PartnerDetail> {
    assertStaff(actor, 'change a partner');
    const id = known(partnerId, partnerNotFound);
    const cols = partnerColumns(input ?? {}, false);
    return this.uniqueBrand(() =>
      inTransaction(this.db, async (tx) => {
        const p = await this.lockPartner(tx, id);
        const set: PartnerColumns = {};
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, column] of PARTNER_FIELDS) {
          const to = cols[column];
          if (to === undefined || to === p[column]) continue;
          (set as Record<string, unknown>)[column] = to;
          before[key] = auditValue(column, p[column]);
          after[key] = auditValue(column, to);
        }
        if (Object.keys(set).length > 0) {
          await tx.updateTable('partners').set(set).where('id', '=', id).execute();
          await this.audit.record({ actor, action: 'partner.update', targetType: 'partner', targetId: id, details: { before, after } }, tx);
        }
        return this.detail(tx, id);
      }),
    );
  }

  /** SET ASIDE (OPERATOR): offered for no new experience; its experiences go on. Audited `partner.set_aside`; again, nothing. */
  setAside(partnerId: string, actor: Actor): Promise<PartnerDetail> {
    return this.setActive(partnerId, false, actor);
  }

  /** ACTIVE again (OPERATOR). Audited `partner.reinstate`; again, nothing. */
  reinstate(partnerId: string, actor: Actor): Promise<PartnerDetail> {
    return this.setActive(partnerId, true, actor);
  }

  // ── Experiences ──────────────────────────────────────────────────────────

  /**
   * A new experience of an ACTIVE partner, a DRAFT (OPERATOR): its title, the event's date in Paris, the amount and its
   * house currency, a note. 404 PARTNER_NOT_FOUND; a partner set aside is 409 PARTNER_EXPERIENCE_STATE. Audited
   * `partner.experience.create`.
   */
  async createExperience(partnerId: string, input: PartnerExperienceInput, actor: Actor): Promise<PartnerExperienceView> {
    assertStaff(actor, 'record a partner experience');
    const pid = known(partnerId, partnerNotFound);
    const title = cleanText(input?.title, PARTNER_EXPERIENCE_TITLE_MAX, 'The title', { required: true })!;
    const eventOn = cleanDay(input?.eventOn, 'The event’s date');
    const amountMinor = cleanAmount(input?.amountMinor);
    const currency = cleanHouseCurrency(input?.currency);
    const note = cleanText(input?.note, PARTNER_NOTE_MAX, 'The note', { lines: true });
    return inTransaction(this.db, async (tx) => {
      // FOR SHARE: a partner set aside meanwhile waits for this experience, or this one sees it set aside.
      const p = await tx.selectFrom('partners').select(['id', 'active']).where('id', '=', pid).forShare().executeTakeFirst();
      if (!p) throw partnerNotFound();
      if (!p.active) throw partnerExperienceState('This partner is set aside: reinstate it to record an experience.');
      const now = this.clock();
      const row = await tx
        .insertInto('partner_experiences')
        .values({ partner_id: pid, title, event_on: eventOn, amount_minor: amountMinor, currency, note, created_by: actor.id!, created_at: now, updated_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        { actor, action: 'partner.experience.create', targetType: 'partner_experience', targetId: row.id, details: { partnerId: pid, title, eventOn, amountMinor, currency, note: note !== null } },
        tx,
      );
      return this.experienceView(tx, row.id);
    });
  }

  /** An experience (404 PARTNER_EXPERIENCE_NOT_FOUND). */
  async experience(experienceId: string): Promise<PartnerExperienceView> {
    return this.experienceView(this.db, known(experienceId, partnerExperienceNotFound));
  }

  /**
   * An experience changed (OPERATOR), under its row lock: the title, the date and the note until it is cancelled; the
   * amount and its currency while it is a DRAFT only (its invoice says them once issued). 409 PARTNER_EXPERIENCE_STATE
   * otherwise. Audited `partner.experience.update` with each value before and after; nothing changed, nothing written.
   */
  async updateExperience(experienceId: string, change: PartnerExperienceChange, actor: Actor): Promise<PartnerExperienceView> {
    assertStaff(actor, 'change a partner experience');
    const id = known(experienceId, partnerExperienceNotFound);
    const c = change ?? {};
    const next: { title?: string; event_on?: string; amount_minor?: number; currency?: HouseCurrency; note?: string | null } = {};
    if (c.title !== undefined) next.title = cleanText(c.title, PARTNER_EXPERIENCE_TITLE_MAX, 'The title', { required: true })!;
    if (c.eventOn !== undefined) next.event_on = cleanDay(c.eventOn, 'The event’s date');
    if (c.amountMinor !== undefined) next.amount_minor = cleanAmount(c.amountMinor);
    if (c.currency !== undefined) next.currency = cleanHouseCurrency(c.currency);
    if (c.note !== undefined) next.note = cleanText(c.note, PARTNER_NOTE_MAX, 'The note', { lines: true });
    return inTransaction(this.db, async (tx) => {
      const e = await this.lockExperience(tx, id);
      const was = { title: e.title, event_on: dayText(e.event_on), amount_minor: Number(e.amount_minor), currency: e.currency, note: e.note };
      const set: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const keys = { title: 'title', event_on: 'eventOn', amount_minor: 'amountMinor', currency: 'currency', note: 'note' } as const;
      for (const column of Object.keys(keys) as (keyof typeof keys)[]) {
        const to = next[column];
        if (to === undefined || to === was[column]) continue;
        set[column] = to;
        before[keys[column]] = column === 'note' ? was.note !== null : was[column];
        after[keys[column]] = column === 'note' ? to !== null : to;
      }
      if (Object.keys(set).length === 0) return this.experienceView(tx, id);
      if (e.status === 'CANCELLED') throw partnerExperienceState('This experience is cancelled: it no longer changes.');
      if ((set.amount_minor !== undefined || set.currency !== undefined) && e.status !== 'DRAFT') {
        throw partnerExperienceState(`This experience is ${STATE_WORDS[e.status]}: its amount and currency are those of its invoice.`);
      }
      await tx.updateTable('partner_experiences').set(set).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'partner.experience.update', targetType: 'partner_experience', targetId: id, details: { before, after } }, tx);
      return this.experienceView(tx, id);
    });
  }

  /**
   * ISSUE THE INVOICE (ADMIN): a DRAFT becomes INVOICED, its invoice issued in the P- series under its lock, to the
   * partner's billing details (409 PARTNER_BILLING_MISSING without its name, address and country), one line, without
   * VAT. Journaled `partner_invoice.issue`; audited `partner.experience.invoice` with its number and amount.
   */
  async issueInvoice(experienceId: string, actor: Actor): Promise<PartnerExperienceView> {
    assertStaff(actor, 'issue a partner invoice');
    const id = known(experienceId, partnerExperienceNotFound);
    return inTransaction(this.db, async (tx) => {
      const e = await this.lockExperience(tx, id);
      if (e.status !== 'DRAFT') throw partnerExperienceState(`This experience is ${STATE_WORDS[e.status]}: only a draft is invoiced.`);
      const p = (await tx.selectFrom('partners').selectAll().where('id', '=', e.partner_id).executeTakeFirstOrThrow()) as PartnerRow;
      if (!p.billing_name || !p.billing_address || !p.billing_country) throw billingMissing();
      const now = this.clock();
      const amount = Number(e.amount_minor);
      const buyer: PartnerBuyer = { name: p.billing_name, address: p.billing_address, country: countryName(p.billing_country.trim()), companyNumber: p.company_number };
      const doc = await this.insertDocument(tx, { kind: 'INVOICE', experienceId: id, partnerId: p.id, buyer, lines: [partnerLine(e.title, dayText(e.event_on), amount)], currency: e.currency, totalMinor: amount, issuedBy: actor.id! }, now);
      await tx.updateTable('partner_experiences').set({ status: 'INVOICED', invoiced_at: doc.row.issued_at }).where('id', '=', id).execute();
      await this.audit.record(
        { actor, action: 'partner.experience.invoice', targetType: 'partner_experience', targetId: id, details: { partnerId: p.id, invoiceId: doc.row.id, number: doc.number, amountMinor: amount, currency: e.currency } },
        tx,
      );
      return this.experienceView(tx, id);
    });
  }

  /**
   * RECORD PAYMENT (ADMIN): an INVOICED experience becomes PAID on `paidOn`, the Paris day the money arrived (never
   * after today); on a PAID one, the date is corrected (`correctPaid`). 409 PARTNER_EXPERIENCE_STATE otherwise. Audited
   * `partner.experience.paid` (a correction with the previous date).
   */
  async recordPaid(experienceId: string, paidOn: string, actor: Actor): Promise<PartnerExperienceView> {
    return this.pay(experienceId, paidOn, actor, 'any');
  }

  /** The payment date of a PAID experience corrected (ADMIN); audited `partner.experience.paid` with the previous date. */
  async correctPaid(experienceId: string, paidOn: string, actor: Actor): Promise<PartnerExperienceView> {
    return this.pay(experienceId, paidOn, actor, 'correct');
  }

  /**
   * CANCEL: a DRAFT by an OPERATOR; an INVOICED or PAID one by an ADMIN only (403 otherwise), its PC- credit note
   * cancelling its invoice in full issued in the same transaction (journaled `partner_invoice.credit`). Audited
   * `partner.experience.cancel` with the state it left and its credit note. A cancelled one is 409.
   */
  async cancel(experienceId: string, actor: Actor, opts: { admin: boolean }): Promise<PartnerExperienceView> {
    assertStaff(actor, 'cancel a partner experience');
    const id = known(experienceId, partnerExperienceNotFound);
    return inTransaction(this.db, async (tx) => {
      const e = await this.lockExperience(tx, id);
      if (e.status === 'CANCELLED') throw partnerExperienceState('This experience is cancelled already.');
      if (e.status !== 'DRAFT' && !opts.admin) throw forbidden('Only an ADMIN cancels an invoiced experience: its credit note is issued with it.');
      const now = this.clock();
      let note: { id: string; number: string } | null = null;
      if (e.status !== 'DRAFT') {
        const invoice = (await tx.selectFrom('partner_invoices').selectAll().where('experience_id', '=', id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()) as PartnerInvoiceRow;
        const doc = await this.insertDocument(
          tx,
          {
            kind: 'CREDIT_NOTE',
            experienceId: id,
            partnerId: e.partner_id,
            creditsInvoice: { id: invoice.id, number: partnerInvoiceNumber('INVOICE', invoice.year, invoice.sequence) },
            buyer: invoice.buyer as unknown as PartnerBuyer,
            lines: linesOf(invoice.lines),
            currency: invoice.currency,
            totalMinor: Number(invoice.total_minor),
            issuedBy: actor.id!,
          },
          now,
        );
        note = { id: doc.row.id, number: doc.number };
      }
      await tx
        .updateTable('partner_experiences')
        .set({ status: 'CANCELLED', cancelled_at: later(now, e.invoiced_at), cancelled_by: actor.id! })
        .where('id', '=', id)
        .execute();
      await this.audit.record(
        { actor, action: 'partner.experience.cancel', targetType: 'partner_experience', targetId: id, details: { from: e.status, creditNoteId: note?.id ?? null, creditNote: note?.number ?? null } },
        tx,
      );
      return this.experienceView(tx, id);
    });
  }

  // ── Guests (P3) ──────────────────────────────────────────────────────────

  /**
   * The experience's guests: every YES to its invitations counted (`headcount`), and the first and last names of the
   * guests who chose to share them (once per account, both names given, an ACTIVE account's only: a locked one's
   * holder can no longer untick it, so it is counted without its name), the test entrants left out. 404
   * PARTNER_EXPERIENCE_NOT_FOUND.
   */
  async guests(experienceId: string): Promise<PartnerGuests> {
    const id = known(experienceId, partnerExperienceNotFound);
    return guestsOf(this.db, id);
  }

  /**
   * The guest list ORBES sends the partner (OPERATOR): the headcount line, then each name shared (first name, last
   * name). Audited `partner.guests.export` with its counts only, never a name.
   */
  async guestsCsv(experienceId: string, actor: Actor): Promise<{ filename: string; contentType: string; body: string }> {
    assertStaff(actor, 'download a guest list');
    const id = known(experienceId, partnerExperienceNotFound);
    return inTransaction(this.db, async (tx) => {
      const g = await guestsOf(tx, id);
      const e = await tx.selectFrom('partner_experiences').select(['event_on']).where('id', '=', id).executeTakeFirstOrThrow();
      await this.audit.record({ actor, action: 'partner.guests.export', targetType: 'partner_experience', targetId: id, details: { headcount: g.headcount, names: g.sharedCount } }, tx);
      const body = csvDocument([['guests', String(g.headcount)], ['first name', 'last name'], ...g.shared.map((s) => [s.firstName, s.lastName])]);
      return { filename: `ORBES-guests-${dayText(e.event_on)}.csv`, contentType: CSV_CONTENT_TYPE, body };
    });
  }

  // ── Invoices (P1, P4) ────────────────────────────────────────────────────

  /** A month's partner documents (`YYYY-MM`, UTC; the current one by default), in order of issue, and their totals. */
  async invoices(month?: string): Promise<PartnerInvoiceList> {
    const currentMonth = monthOf(this.clock());
    const m = month ?? currentMonth;
    const { from, to } = monthRange(m);
    const items = await this.readInvoices(this.db, from, to);
    const totals = HOUSE_CURRENCIES.flatMap((currency) => {
      const of = items.filter((i) => i.currency === currency);
      if (of.length === 0) return [];
      const invoiced = of.filter((i) => i.kind === 'INVOICE').reduce((n, i) => n + i.totalMinor, 0);
      const credited = of.filter((i) => i.kind === 'CREDIT_NOTE').reduce((n, i) => n + i.totalMinor, 0);
      return [{ currency, invoiced, credited, net: invoiced - credited }];
    });
    return { month: m, currentMonth, items, totals };
  }

  /** One partner document (404 PARTNER_INVOICE_NOT_FOUND). */
  async invoice(invoiceId: string): Promise<PartnerInvoiceView> {
    const id = known(invoiceId, partnerInvoiceNotFound);
    const [v] = await this.readInvoices(this.db, null, null, id);
    if (!v) throw partnerInvoiceNotFound();
    return v;
  }

  /** A partner document's PDF (render/invoice.ts), the partner as buyer, no order. */
  async invoicePdf(invoiceId: string): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    return renderInvoicePdf(partnerInvoiceDocument(await this.invoice(invoiceId)));
  }

  /**
   * The month's partner CSV for the accountant (render/csv.ts: every field quoted, a formula never run), in order of
   * issue: each document's number, kind, time and date, experience, the invoice it cancels, the issuer, the buyer, the
   * lines, the currency and the total, as issued (no VAT: the fields stay empty).
   */
  async invoicesCsv(month: string): Promise<{ filename: string; contentType: string; body: string }> {
    const { from, to } = monthRange(month);
    const items = await this.readInvoices(this.db, from, to);
    const header = ['number', 'kind', 'issued at', 'date', 'partner', 'experience', 'cancels', 'issuer', 'buyer name', 'buyer address', 'buyer country', 'company number', 'lines', 'currency', 'vat rate', 'vat', 'total'];
    const body = csvDocument([
      header,
      ...items.map((v) => [
        v.number,
        v.kind,
        v.issuedAt.toISOString(),
        v.issuedAt.toISOString().slice(0, 10),
        v.partner.brand,
        `${v.experience.title} · ${v.experience.eventOn}`,
        v.credits?.number ?? '',
        v.issuer.name,
        v.buyer.name ?? '',
        v.buyer.address ?? '',
        v.buyer.country ?? '',
        v.buyer.companyNumber ?? '',
        v.lines.map((l) => `${l.label} (${majorUnits(l.amountMinor)})`).join('; '),
        v.currency,
        '',
        '',
        majorUnits(v.totalMinor),
      ]),
    ]);
    return { filename: `ORBES-partner-invoices-${month}.csv`, contentType: CSV_CONTENT_TYPE, body };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** A write that may meet another partner's brand (`partners_brand_key`): 409 PARTNER_BRAND_TAKEN. */
  private async uniqueBrand<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw brandTaken();
      throw e;
    }
  }

  private async setActive(partnerId: string, active: boolean, actor: Actor): Promise<PartnerDetail> {
    assertStaff(actor, active ? 'reinstate a partner' : 'set a partner aside');
    const id = known(partnerId, partnerNotFound);
    return inTransaction(this.db, async (tx) => {
      const p = await this.lockPartner(tx, id);
      if (p.active !== active) {
        await tx.updateTable('partners').set({ active }).where('id', '=', id).execute();
        await this.audit.record({ actor, action: active ? 'partner.reinstate' : 'partner.set_aside', targetType: 'partner', targetId: id, details: { brand: p.brand } }, tx);
      }
      return this.detail(tx, id);
    });
  }

  private async pay(experienceId: string, paidOn: string, actor: Actor, mode: 'any' | 'correct'): Promise<PartnerExperienceView> {
    assertStaff(actor, 'record a partner’s payment');
    const id = known(experienceId, partnerExperienceNotFound);
    const day = cleanDay(paidOn, 'The payment date');
    return inTransaction(this.db, async (tx) => {
      const e = await this.lockExperience(tx, id);
      const now = this.clock();
      if (day > parisDay(now)) throw validationError('The payment date is the day the money arrived: today at the latest.');
      const correcting = e.status === 'PAID';
      if (mode === 'correct' && !correcting) throw partnerExperienceState(`This experience is ${STATE_WORDS[e.status]}: only a paid experience has a payment date to correct.`);
      if (e.status !== 'INVOICED' && !correcting) throw partnerExperienceState(`This experience is ${STATE_WORDS[e.status]}: a payment is recorded on an invoiced experience.`);
      const previous = e.paid_on === null ? null : dayText(e.paid_on);
      if (correcting && previous === day) return this.experienceView(tx, id);
      await tx
        .updateTable('partner_experiences')
        .set({ status: 'PAID', paid_on: day, paid_recorded_at: later(now, e.invoiced_at), paid_recorded_by: actor.id! })
        .where('id', '=', id)
        .execute();
      await this.audit.record(
        { actor, action: 'partner.experience.paid', targetType: 'partner_experience', targetId: id, details: { paidOn: day, ...(correcting ? { previous } : {}), amountMinor: Number(e.amount_minor), currency: e.currency } },
        tx,
      );
      return this.experienceView(tx, id);
    });
  }

  /** Insert a partner document (its next number under its lock) and journal it; returns its row and number. */
  private async insertDocument(
    tx: Db,
    d: {
      kind: PartnerInvoiceKind;
      experienceId: string;
      partnerId: string;
      creditsInvoice?: { id: string; number: string };
      buyer: PartnerBuyer;
      lines: PartnerInvoiceLine[];
      currency: HouseCurrency;
      totalMinor: number;
      issuedBy: string;
    },
    now: Date,
  ): Promise<{ row: PartnerInvoiceRow; number: string }> {
    const year = now.getUTCFullYear();
    const { sequence, issuedAt } = await nextSequence(tx, d.kind, year, now);
    const row = (await tx
      .insertInto('partner_invoices')
      .values({
        kind: d.kind,
        year,
        sequence,
        experience_id: d.experienceId,
        credits_invoice_id: d.creditsInvoice?.id ?? null,
        issuer: jsonText({ name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] }),
        buyer: jsonText({ name: d.buyer.name, address: d.buyer.address, country: d.buyer.country, companyNumber: d.buyer.companyNumber }),
        lines: jsonText(d.lines.map((l) => ({ kind: l.kind, label: l.label, detail: l.detail, amountMinor: l.amountMinor }))),
        currency: d.currency,
        total_minor: d.totalMinor,
        issued_at: issuedAt,
        issued_by: d.issuedBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as PartnerInvoiceRow;
    const type = d.kind === 'INVOICE' ? 'partner_invoice.issue' : 'partner_invoice.credit';
    await writeJournal(tx, [{ type, entityType: 'partner_invoice', entityId: row.id, payload: journalPayload(row, d.partnerId, d.creditsInvoice?.number ?? null) }], issuedAt);
    return { row, number: partnerInvoiceNumber(d.kind, year, sequence) };
  }

  private async lockPartner(tx: Db, id: string): Promise<PartnerRow> {
    const p = await tx.selectFrom('partners').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw partnerNotFound();
    return p as PartnerRow;
  }

  private async lockExperience(tx: Db, id: string): Promise<ExperienceRow> {
    const e = await tx.selectFrom('partner_experiences').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!e) throw partnerExperienceNotFound();
    return e as unknown as ExperienceRow;
  }

  /** Who did it: a console login's id and email, or null. */
  private async staff(db: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const known = [...new Set(ids.filter((x): x is string => x !== null))];
    if (known.length === 0) return new Map();
    const rows = await db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', known).execute();
    return new Map(rows.map((r) => [r.id, r.email]));
  }

  /** Partners with their counts and amounts, read in one query each. */
  private async partnerViews(db: Db, rows: readonly PartnerRow[]): Promise<PartnerView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [counts, invoiced, paid, staff] = await Promise.all([
      db.selectFrom('partner_experiences').select(['partner_id', (eb) => eb.fn.countAll<number>().as('n')]).where('partner_id', 'in', ids).groupBy('partner_id').execute(),
      sql<{ partner_id: string; currency: HouseCurrency; net: string | number }>`
        SELECT e.partner_id, i.currency, sum(CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END)::bigint AS net
          FROM partner_invoices i JOIN partner_experiences e ON e.id = i.experience_id
         WHERE e.partner_id IN (${sql.join(ids)}) GROUP BY 1, 2`.execute(db),
      sql<{ partner_id: string; currency: HouseCurrency; paid: string | number }>`
        SELECT partner_id, currency, sum(amount_minor)::bigint AS paid FROM partner_experiences
         WHERE status = 'PAID' AND partner_id IN (${sql.join(ids)}) GROUP BY 1, 2`.execute(db),
      this.staff(db, rows.map((r) => r.created_by)),
    ]);
    const amounts = (list: readonly { partner_id: string; currency: HouseCurrency; v: number }[], id: string): PartnerAmount[] =>
      HOUSE_CURRENCIES.flatMap((c) => list.filter((x) => x.partner_id === id && x.currency === c).map((x) => ({ currency: c, amountMinor: x.v })));
    const inv = invoiced.rows.map((r) => ({ partner_id: r.partner_id, currency: r.currency, v: Number(r.net) }));
    const pd = paid.rows.map((r) => ({ partner_id: r.partner_id, currency: r.currency, v: Number(r.paid) }));
    return rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      contact: { name: r.contact_name, email: r.contact_email, phone: r.contact_phone },
      billing: { name: r.billing_name, address: r.billing_address, country: r.billing_country === null ? null : r.billing_country.trim(), companyNumber: r.company_number },
      note: r.note,
      active: r.active,
      experienceCount: Number(counts.find((c) => c.partner_id === r.id)?.n ?? 0),
      invoiced: amounts(inv, r.id),
      paid: amounts(pd, r.id),
      createdAt: r.created_at,
      createdBy: r.created_by && staff.has(r.created_by) ? { id: r.created_by, email: staff.get(r.created_by)! } : null,
      updatedAt: r.updated_at,
    }));
  }

  private async detail(db: Db, id: string): Promise<PartnerDetail> {
    const p = await db.selectFrom('partners').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) throw partnerNotFound();
    const [view] = await this.partnerViews(db, [p as PartnerRow]);
    const rows = (await db.selectFrom('partner_experiences').selectAll().where('partner_id', '=', id).orderBy('event_on', 'desc').orderBy('created_at', 'desc').orderBy('id').execute()) as unknown as ExperienceRow[];
    const docs = await this.documentsOf(db, rows.map((r) => r.id));
    return { ...view!, experiences: rows.map((r) => experienceCard(r, docs)) };
  }

  /** The invoice and the credit note of each experience. */
  private async documentsOf(db: Db, experienceIds: readonly string[]): Promise<Map<string, Partial<Record<PartnerInvoiceKind, { id: string; number: string; issuedAt: Date }>>>> {
    const out = new Map<string, Partial<Record<PartnerInvoiceKind, { id: string; number: string; issuedAt: Date }>>>();
    if (experienceIds.length === 0) return out;
    const rows = await db.selectFrom('partner_invoices').select(['id', 'kind', 'year', 'sequence', 'experience_id', 'issued_at']).where('experience_id', 'in', [...experienceIds]).execute();
    for (const r of rows) {
      const of = out.get(r.experience_id) ?? {};
      of[r.kind] = { id: r.id, number: partnerInvoiceNumber(r.kind, r.year, r.sequence), issuedAt: r.issued_at };
      out.set(r.experience_id, of);
    }
    return out;
  }

  private async experienceView(db: Db, id: string): Promise<PartnerExperienceView> {
    const e = (await db.selectFrom('partner_experiences').selectAll().where('id', '=', id).executeTakeFirst()) as unknown as ExperienceRow | undefined;
    if (!e) throw partnerExperienceNotFound();
    const [partner, docs, posts, staff] = await Promise.all([
      db.selectFrom('partners').select(['id', 'brand', 'active']).where('id', '=', e.partner_id).executeTakeFirstOrThrow(),
      this.documentsOf(db, [id]),
      db
        .selectFrom('circle_posts as p')
        .leftJoin('segments as s', 's.id', 'p.segment_id')
        .select(['p.id', 'p.title', 'p.min_tier', 'p.published_at', 'p.event_at', 'p.capacity', 's.id as segment_id', 's.name as segment_name'])
        .select((eb) => eb.selectFrom('circle_rsvps as r').select((x) => x.fn.countAll<number>().as('n')).whereRef('r.post_id', '=', 'p.id').where('r.answer', '=', 'YES').as('yes'))
        .where('p.partner_experience_id', '=', id)
        .orderBy('p.event_at')
        .orderBy('p.created_at')
        .orderBy('p.id')
        .execute(),
      this.staff(db, [e.paid_recorded_by, e.cancelled_by, e.created_by]),
    ]);
    const who = (x: string | null) => (x && staff.has(x) ? { id: x, email: staff.get(x)! } : null);
    return {
      ...experienceCard(e, docs),
      partner: { id: partner.id, brand: partner.brand, active: partner.active },
      note: e.note,
      invoicedAt: e.invoiced_at,
      paidRecordedAt: e.paid_recorded_at,
      paidRecordedBy: who(e.paid_recorded_by),
      cancelledAt: e.cancelled_at,
      cancelledBy: who(e.cancelled_by),
      invitations: posts.map((p) => ({
        id: p.id,
        title: p.title,
        minTier: p.min_tier,
        segment: p.segment_id && p.segment_name !== null ? { id: p.segment_id, name: p.segment_name } : null,
        published: p.published_at !== null,
        eventAt: p.event_at,
        yes: Number(p.yes ?? 0),
        capacity: p.capacity,
      })),
      createdAt: e.created_at,
      createdBy: who(e.created_by),
      updatedAt: e.updated_at,
    };
  }

  /** Partner documents issued in [from, to) (or the one `id`), in order of issue, with their experience and partner. */
  private async readInvoices(db: Db, from: Date | null, to: Date | null, id?: string): Promise<PartnerInvoiceView[]> {
    let q = db
      .selectFrom('partner_invoices as i')
      .innerJoin('partner_experiences as e', 'e.id', 'i.experience_id')
      .innerJoin('partners as p', 'p.id', 'e.partner_id')
      .leftJoin('partner_invoices as c', 'c.id', 'i.credits_invoice_id')
      .leftJoin('partner_invoices as n', 'n.credits_invoice_id', 'i.id')
      .selectAll('i')
      .select(['e.title', 'e.event_on', 'p.id as partner_id', 'p.brand', 'c.year as credits_year', 'c.sequence as credits_sequence', 'n.id as credited_by_id', 'n.year as credited_by_year', 'n.sequence as credited_by_sequence']);
    if (id !== undefined) q = q.where('i.id', '=', id);
    if (from && to) q = q.where('i.issued_at', '>=', from).where('i.issued_at', '<', to);
    const rows = await q.orderBy('i.issued_at').orderBy('i.kind', 'desc').orderBy('i.sequence').execute();
    return rows.map((r) => {
      const issuer = r.issuer as JsonObject;
      const buyer = r.buyer as JsonObject;
      return {
        id: r.id,
        kind: r.kind,
        number: partnerInvoiceNumber(r.kind, r.year, r.sequence),
        issuedAt: r.issued_at,
        experience: { id: r.experience_id, title: r.title, eventOn: dayText(r.event_on) },
        partner: { id: r.partner_id, brand: r.brand },
        credits: r.credits_invoice_id && r.credits_year !== null ? { id: r.credits_invoice_id, number: partnerInvoiceNumber('INVOICE', r.credits_year, r.credits_sequence!) } : null,
        creditedBy: r.credited_by_id && r.credited_by_year !== null ? { id: r.credited_by_id, number: partnerInvoiceNumber('CREDIT_NOTE', r.credited_by_year, r.credited_by_sequence!) } : null,
        issuer: { name: str(issuer.name) ?? INVOICE_ISSUER.name, address: Array.isArray(issuer.address) ? issuer.address.map(String) : [] },
        buyer: { name: str(buyer.name), address: str(buyer.address), country: str(buyer.country), companyNumber: str(buyer.companyNumber) },
        lines: linesOf(r.lines as unknown[]),
        currency: r.currency,
        totalMinor: Number(r.total_minor),
      };
    });
  }
}

/** An experience's card, with its documents. */
function experienceCard(e: ExperienceRow, docs: Map<string, Partial<Record<PartnerInvoiceKind, { id: string; number: string; issuedAt: Date }>>>): PartnerExperienceCard {
  const d = docs.get(e.id) ?? {};
  return {
    id: e.id,
    title: e.title,
    eventOn: dayText(e.event_on),
    amountMinor: Number(e.amount_minor),
    currency: e.currency,
    status: e.status,
    invoice: d.INVOICE ?? null,
    creditNote: d.CREDIT_NOTE ?? null,
    paidOn: e.paid_on === null ? null : dayText(e.paid_on),
  };
}

/**
 * How the audit log (permanent, read by an AUDITOR) records a partner's field: the contact's email and phone, which an
 * AUDITOR reads masked, and the note as whether one is written; every other field as it is.
 */
function auditValue(column: (typeof PARTNER_FIELDS)[number][1], v: unknown): unknown {
  return column === 'contact_email' || column === 'contact_phone' || column === 'note' ? v !== null && v !== undefined : v;
}

/** The audit's view of a partner's fields given (see `auditValue`). */
function auditFields(cols: PartnerColumns): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of PARTNER_FIELDS) {
    if (cols[column] === undefined) continue;
    out[key] = auditValue(column, cols[column]);
  }
  return out;
}

/** An experience's guests (see PartnerService.guests); 404 PARTNER_EXPERIENCE_NOT_FOUND. */
async function guestsOf(db: Db, id: string): Promise<PartnerGuests> {
  const e = await db.selectFrom('partner_experiences').select('id').where('id', '=', id).executeTakeFirst();
  if (!e) throw partnerExperienceNotFound();
  const rows = (
    await sql<{ account_id: string; share_name: boolean; active: boolean; first_name: string | null; last_name: string | null }>`
      SELECT r.account_id, r.share_name, a.status = 'ACTIVE' AS active, ap.first_name, ap.last_name
        FROM circle_rsvps r
        JOIN circle_posts p ON p.id = r.post_id
        JOIN accounts a ON a.id = r.account_id
        LEFT JOIN account_profiles ap ON ap.account_id = r.account_id
       WHERE p.partner_experience_id = ${id} AND r.answer = 'YES' AND ${notTestEntrant('r.account_id')}`.execute(db)
  ).rows;
  const names = new Map<string, { firstName: string; lastName: string }>();
  for (const r of rows) {
    // A locked account's name stays with ORBES (its holder can no longer untick it, as the RSVP refuses it); it is
    // still counted, so the headcount is every YES.
    if (!r.active) continue;
    if (!r.share_name || !r.first_name || !r.last_name) continue;
    names.set(r.account_id, { firstName: r.first_name, lastName: r.last_name });
  }
  const shared = [...names.values()].sort((a, b) => a.lastName.localeCompare(b.lastName, 'en') || a.firstName.localeCompare(b.firstName, 'en'));
  return { experienceId: id, headcount: rows.length, sharedCount: shared.length, shared };
}

/** A partner document as its PDF prints it (render/invoice.ts): no order, the partner as buyer. */
export function partnerInvoiceDocument(v: PartnerInvoiceView): InvoiceDocument {
  return {
    kind: v.kind,
    number: v.number,
    issuedAt: v.issuedAt,
    order: null,
    credits: v.credits?.number ?? null,
    issuer: v.issuer,
    buyer: { name: v.buyer.name, address: v.buyer.address, email: null, country: v.buyer.country, companyNumber: v.buyer.companyNumber },
    lines: v.lines.map((l) => ({ label: l.label, detail: l.detail, amountMinor: l.amountMinor })),
    currency: v.currency,
    totalMinor: v.totalMinor,
  };
}
